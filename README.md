# Neon Table Tennis

A neon 3D table tennis game in the browser: challenge a colleague with one link, or practise against a bot.
Hosted on Cloudflare Workers (static assets + Worker API; Durable Object session rooms come with multiplayer).

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Local dev server at http://localhost:5173 (Worker runs locally too) |
| `npm test` | Unit tests for physics, rules and scoring |
| `npm run typecheck` | TypeScript checks for client, shared code and Worker |
| `npm run deploy` | Build and deploy to Cloudflare (run `npx wrangler login` once first) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |

## Layout

```
src/shared/   Physics, racket model, ITTF rules and scoring. Pure TypeScript, runs in browser and Worker.
src/client/   Three.js renderer, input, bot, practice match loop and UI.
src/worker/   Cloudflare Worker: /api/* routes.
```

World units are metres; the origin is the centre of the table surface. Player 0 stands at +z, player 1 at -z.
Each player's "local frame" puts their own end at +z (player 1's is the world rotated 180° about y).
