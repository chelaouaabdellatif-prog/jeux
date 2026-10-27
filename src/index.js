import { DurableObject } from "cloudflare:workers";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// Une partie inactive est effacée après 24 h.
const EXPIRE_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{4,12})$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket attendu", { status: 426 });
      }
      const room = m[1].toUpperCase();
      const stub = env.GAME.get(env.GAME.idFromName(room));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

function freshState() {
  return {
    players: { X: null, O: null },
    board: Array(9).fill(""),
    turn: "X",
    starter: "X",
    winner: null, // "X" | "O" | "draw" | null
    line: null,
    scores: { X: 0, O: 0, draw: 0 },
    rematch: [],
  };
}

function cleanName(name) {
  return (name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
}

function seatOf(state, pid) {
  if (state.players.X?.pid === pid) return "X";
  if (state.players.O?.pid === pid) return "O";
  return null;
}

function findWinner(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every(Boolean)) return { winner: "draw", line: null };
  return null;
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get("state")) ?? freshState();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pid = (url.searchParams.get("pid") || "").slice(0, 64);
    if (!pid) return new Response("pid manquant", { status: 400 });
    const name = cleanName(url.searchParams.get("name")) || "Joueur";

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid });

    const s = this.state;
    const seat = seatOf(s, pid) ?? (!s.players.X ? "X" : !s.players.O ? "O" : null);
    if (seat) s.players[seat] = { pid, name };

    await this.save();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { pid } = ws.deserializeAttachment() || {};
    const s = this.state;
    const seat = seatOf(s, pid);
    if (!seat) return;

    if (msg.type === "move") {
      const i = Number(msg.index);
      const ready = s.players.X && s.players.O;
      if (!ready || s.winner || s.turn !== seat) return;
      if (!Number.isInteger(i) || i < 0 || i > 8 || s.board[i]) return;

      s.board[i] = seat;
      const result = findWinner(s.board);
      if (result) {
        s.winner = result.winner;
        s.line = result.line;
        s.scores[result.winner === "draw" ? "draw" : result.winner]++;
      } else {
        s.turn = seat === "X" ? "O" : "X";
      }
    } else if (msg.type === "rematch") {
      if (!s.winner) return;
      if (!s.rematch.includes(seat)) s.rematch.push(seat);
      if (s.rematch.length === 2) {
        // Le joueur qui a commencé change à chaque manche.
        s.starter = s.starter === "X" ? "O" : "X";
        s.board = Array(9).fill("");
        s.turn = s.starter;
        s.winner = null;
        s.line = null;
        s.rematch = [];
      }
    } else if (msg.type === "rename") {
      const name = cleanName(msg.name);
      if (name) s.players[seat].name = name;
    } else {
      return;
    }

    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
    this.broadcast(ws);
  }

  async webSocketError(ws) {
    this.broadcast(ws);
  }

  async alarm() {
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.state = freshState();
    } else {
      await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    }
  }

  async save() {
    await this.ctx.storage.put("state", this.state);
    await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
  }

  broadcast(closing) {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== closing);
    const online = new Set(sockets.map((ws) => ws.deserializeAttachment()?.pid));
    const s = this.state;
    const players = {};
    for (const seat of ["X", "O"]) {
      const p = s.players[seat];
      players[seat] = p ? { name: p.name, online: online.has(p.pid) } : null;
    }
    const base = {
      type: "state",
      players,
      board: s.board,
      turn: s.turn,
      winner: s.winner,
      line: s.line,
      scores: s.scores,
      rematch: s.rematch,
      spectators: sockets.filter((ws) => !seatOf(s, ws.deserializeAttachment()?.pid)).length,
    };
    for (const ws of sockets) {
      const you = seatOf(s, ws.deserializeAttachment()?.pid) ?? "spectator";
      try {
        ws.send(JSON.stringify({ ...base, you }));
      } catch {}
    }
  }
}
