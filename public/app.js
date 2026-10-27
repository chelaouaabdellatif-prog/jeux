(() => {
  const $ = (id) => document.getElementById(id);
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch {}
    },
  };

  function randomCode(len) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  }

  // Identifiant du joueur : garde sa place (X ou O) même après un rafraîchissement.
  let pid = store.get("xo-pid");
  if (!pid) {
    pid = randomCode(16);
    store.set("xo-pid", pid);
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function getName() {
    return ($("name").value || store.get("xo-name") || "").trim().slice(0, 20);
  }

  // ---------- Accueil ----------
  function showHome() {
    $("home").hidden = false;
    $("name").value = store.get("xo-name") || "";
    $("create").onclick = () => {
      if (!saveName()) return;
      goToRoom(randomCode(6));
    };
    $("join-form").onsubmit = (e) => {
      e.preventDefault();
      const code = $("code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length < 4) return toast("Code invalide");
      if (!saveName()) return;
      goToRoom(code);
    };
  }

  function saveName() {
    const name = getName();
    if (!name) {
      $("name").focus();
      toast("Entre ton prénom");
      return false;
    }
    store.set("xo-name", name);
    return true;
  }

  function goToRoom(code) {
    location.href = "/?partie=" + code;
  }

  // ---------- Partie ----------
  const room = (new URLSearchParams(location.search).get("partie") || "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

  if (!room) {
    showHome();
    return;
  }

  let name = store.get("xo-name");
  if (!name) {
    name = (prompt("Ton prénom ?") || "").trim().slice(0, 20) || "Joueur";
    store.set("xo-name", name);
  }

  $("game").hidden = false;
  const link = location.origin + "/?partie=" + room;
  $("link").value = link;
  $("room-code").textContent = room;
  $("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent("Viens jouer au X et O avec moi ! " + link);
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      $("link").select();
      document.execCommand("copy");
    }
    toast("Lien copié !");
  };
  if (navigator.share) {
    $("share").hidden = false;
    $("share").onclick = () =>
      navigator.share({ title: "X et O", text: "Viens jouer au X et O avec moi !", url: link }).catch(() => {});
  }

  const cells = [];
  for (let i = 0; i < 9; i++) {
    const b = document.createElement("button");
    b.className = "cell";
    b.setAttribute("aria-label", "Case " + (i + 1));
    b.onclick = () => send({ type: "move", index: i });
    $("board").appendChild(b);
    cells.push(b);
  }
  $("rematch").onclick = () => send({ type: "rematch" });

  let ws;
  let retry = 0;
  let last = null;

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const qs = new URLSearchParams({ pid, name });
    ws = new WebSocket(`${proto}://${location.host}/ws/${room}?${qs}`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "state") render(msg);
    };
    ws.onclose = () => {
      $("status").textContent = "Connexion perdue, reconnexion…";
      setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function render(s) {
    const me = s.you;
    const other = me === "X" ? "O" : me === "O" ? "X" : null;
    const ready = s.players.X && s.players.O;

    for (const seat of ["X", "O"]) {
      const el = $("p" + seat);
      const p = s.players[seat];
      el.querySelector(".pname").textContent = p ? p.name : "En attente…";
      el.querySelector(".dot").classList.toggle("on", !!p?.online);
      el.querySelector(".score").textContent = s.scores[seat];
      el.classList.toggle("me", me === seat);
      el.classList.toggle("active", ready && !s.winner && s.turn === seat);
    }
    $("draws").textContent = s.scores.draw;

    const myTurn = ready && !s.winner && s.turn === me;
    s.board.forEach((v, i) => {
      const c = cells[i];
      const fresh = v && last && !last.board[i];
      c.textContent = v;
      c.className = "cell" + (v ? " " + v : "") + (fresh ? " pop" : "");
      if (s.line?.includes(i)) c.classList.add("win");
      const playable = myTurn && !v;
      c.disabled = !playable;
      c.classList.toggle("playable", playable);
    });

    // Message d'état
    let text;
    if (me === "spectator") {
      text = s.winner
        ? s.winner === "draw" ? "Match nul" : `${s.players[s.winner].name} gagne !`
        : `Tu regardes la partie — au tour de ${s.players[s.turn]?.name || s.turn}`;
    } else if (!ready) {
      text = "En attente de ton ami… envoie-lui le lien !";
    } else if (s.winner === "draw") {
      text = "Match nul 🤝";
    } else if (s.winner) {
      text = s.winner === me ? "Tu as gagné ! 🎉" : `${s.players[s.winner].name} a gagné`;
    } else if (myTurn) {
      text = `À toi de jouer (${me})`;
    } else {
      text = `Au tour de ${s.players[other].name}…`;
    }
    if (ready && !s.players[other]?.online && me !== "spectator" && !s.winner) {
      text += " (ton ami est hors ligne)";
    }
    $("status").textContent = text;

    // Bouton Rejouer
    const canRematch = s.winner && me !== "spectator";
    $("rematch").hidden = !canRematch;
    if (canRematch) {
      const asked = s.rematch.includes(me);
      const otherAsked = s.rematch.includes(other);
      $("rematch").disabled = asked;
      $("rematch").textContent = asked
        ? "En attente de ton ami…"
        : otherAsked ? "Ton ami veut rejouer — Accepter" : "Rejouer";
    }

    $("invite").hidden = !!ready && me !== "spectator";
    $("spectators").textContent = s.spectators
      ? `${s.spectators} spectateur${s.spectators > 1 ? "s" : ""}`
      : "";

    if (me === "spectator" && !last) toast("La partie est complète : tu es spectateur");
    last = s;
  }

  connect();
})();
