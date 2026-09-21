# Console — IDEA Platform

The IDEA Console is the user interface for the IDEA system. It is a Solid.js web application served by the Engine on port 80.

Two audiences:
- **Users** (students, teachers) — browse and open running apps. No login required.
- **Operators** (authenticated) — manage instances, eject disks, monitor fleet health.

The Console connects to the Engine via Automerge WebSocket and auto-discovers Engines on the local network via mDNS hostname probing.

## Access

- Local network: `http://<engine-hostname>.local/` (primary)
- Direct IP: `http://<engine-LAN-IP>/`
- Remote: `http://<engine-tailscale-hostname>/` via Tailscale

## Built with

- **Solid.js** — fine-grained reactive UI
- **TypeScript** — strict mode
- **Vite** — builds to static `dist/` which the Engine serves

## Repos

| Repo | Purpose |
|------|---------|
| `koenswings/agent-console-dev` | This repo — Console source |
| `koenswings/idea` | Org root — tasks, proposals, docs |

## Documentation

- `docs/ARCHITECTURE.md` — how the Console works (authoritative)
- `proposals/` — past design decisions and reasoning
