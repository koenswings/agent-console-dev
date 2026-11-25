# Console — IDEA Platform

The IDEA Console is the user interface for the IDEA system. It is a Solid.js web application served by the Engine over HTTP (port 80 on school kits; the port is the Engine's `settings.httpPort`).

Two audiences:
- **Users** (students, teachers) — browse the **Apps** page and open running apps with **Open**. No login required.
- **Operators** (authenticated through 👤 → **Operator Login**) — manage apps (start, stop, back up, restore, update, copy/move, rename, remove), disks (Files Disk, Backup Disk, erase, eject), classroom computer cards (Flash) and demo apps, and watch Engine health and Command History.

The Console connects to the Engine via Automerge WebSocket. Served from an Engine, it connects to that Engine (the page host) and lists every Engine from the shared store; if that Engine goes away it reconnects, or opens another live Engine's Console. In dev mode it probes the page host and Engines used before via `GET /api/store-url`; a browser cannot browse mDNS, so names are never guessed and other Engines are added by sticker name in Connection Management (🔌).

## Access

- At a school: `http://idea.local/` (whichever Engine answers) or `http://<sticker-name>.local/` (one Engine)
- Direct IP: `http://<engine-LAN-IP>/`
- Remote: `http://<engine-tailscale-hostname>[:<port>]/` via Tailscale (fleet pool Pis and production `idea` serve the Console on a non-80 port)

## Run locally

```bash
pnpm install
pnpm dev            # Vite dev server on http://<host>:5173 — Settings → Preview mode for mock data
pnpm test           # Vitest unit/component tests (mock store, no Engine needed)
pnpm typecheck
pnpm build          # production build into dist/ (see AGENTS.md for the dist swap)
```

A dev Console pointed at a real Engine sends real commands: see AGENTS.md before doing that.

## Built with

- **Solid.js** — fine-grained reactive UI
- **TypeScript** — strict mode
- **Vite** — builds to static `dist/` which the Engine serves
- **Automerge** — store sync with the Engine; bcryptjs for client-side operator login

## Repos

| Repo | Purpose |
|------|---------|
| `koenswings/agent-console-dev` | This repo — Console source |
| `koenswings/idea` | Org root — tasks, proposals, docs, fleet scripts |

## Documentation

- `docs/ARCHITECTURE.md` — how the Console works (authoritative)
- `docs/INDEX.md` — index of the authoritative docs
- `AGENTS.md` — build, test, deploy and QC rules
- `e2e/intents/README.md` — duration-test intent adapters
- `proposals/` — past design decisions and reasoning (not authoritative)
