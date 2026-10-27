# X et O en ligne

Jeu de morpion (X et O) en ligne à deux joueurs. Crée une partie, envoie le lien à un ami, et jouez en temps réel.

- Lien d'invitation (copier, partager, WhatsApp) ou code de partie
- Temps réel via WebSocket
- Score, matchs nuls, revanche (le premier joueur alterne)
- Reconnexion automatique : un joueur garde sa place après un rafraîchissement
- Les personnes en plus regardent en spectateurs

## Technique

- `public/` : la page du jeu (HTML/CSS/JS, sans framework)
- `src/index.js` : un Cloudflare Worker + un Durable Object `GameRoom` (une instance par partie) qui garde l'état et relaie les coups
- Une partie inactive est supprimée après 24 h

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:8787

## Déployer sur Cloudflare

```bash
npx wrangler login
npm run deploy
```

Le jeu sera disponible sur `https://xo-en-ligne.<ton-sous-domaine>.workers.dev`.
