# Pixel — Console UI Developer Memory

## Agent Identity
- Name: **Pixel** 🖥️
- Role: Console UI Developer — builds IDEA Console (teacher/student UI)
- Workspace: `/home/node/workspace/agents/agent-console-dev/`
- Telegram group: `-5187034968`

## Infrastructure Facts
- MC API: `http://mission-control-backend:8000`
- MC Board ID: `ac508766-e9e3-48a0-b6a5-54c6ffcdc1a3`
- AUTH_TOKEN: in `.env` (board-scoped)
- MC_PLATFORM_TOKEN: in `.env` (admin, for cross-board writes)
- GITHUB_TOKEN: in `.env` (gitignored, never commit)
- GitHub repo: `koenswings/agent-console-dev`
- **Runtime:** OpenClaw native (systemd, user `pi`) since 2026-04-06 — no Docker container
- Pi hostname: `wizardly-hugle` (Linux), `openclaw-pi` (Tailscale: `openclaw-pi.tail2d60.ts.net`)
- OpenClaw config: `/home/pi/.openclaw/openclaw.json`
- **Direct hardware/network access** — `pnpm dev` runs on the Pi natively; no Docker workarounds needed

## Current State
- Console UI v1 — PRs #15–#19 all merged to main
- 111 tests passing; Solid.js + Chrome Extension MV3
- Three deployment modes: dev (Tailscale), extension, production web from Engine port 80
- Engine serves Console `dist/` on port 80 (Axle PR #26 merged) ✅
- `GET /api/store-url` endpoint live ✅
- User mode (no login, default) + Operator mode (authenticated) implemented
- bcryptjs client-side auth; `userDB` in Automerge Store; FirstTimeSetup for empty userDB
- Architecture doc live: `docs/ARCHITECTURE.md`

## Architecture
- Framework: Solid.js + Chrome Extension Manifest V3
- Language: TypeScript (strict)
- Build: Vite + pnpm; Tests: Vitest + Testing Library
- Console served by Engine HTTP server on port 80 from dist/
- Two modes: User mode (default, no login) and Operator mode (authenticated)
- State updates live via Engine's Automerge event stream
- Production web mode: auto-detects hostname from window.location, fetches store URL from /api/store-url

## Stack Decision (design/001-console-tech-stack.md, merged)
- Solid.js: signal-based reactivity matches Automerge streaming model exactly
- Only affected DOM nodes re-render on each event — critical for low-end hardware
- Flutter eliminated: cannot produce Chrome Extension (hard blocker)
- Mobile path: PWA on same Solid.js codebase if needed later

## Pi Details
- Pi path: `/home/pi/idea/agents/agent-console-dev`
- Tailscale IP: `100.115.60.6`; hostname: `wizardly-hugle.tail2d60.ts.net`
- Engine WS port: 4321
- Vite cache: `/tmp` (avoids workspace permission issues)
- Root-ownership issue resolved 2026-04-06: entire `/home/pi/idea` rechowned to `pi`; no more `sudo` workarounds needed for dist or .git

## Koen Preferences
- Light theme (no dark mode)
- No terminal operations unless necessary
- Prefers `pnpm dev` / `pnpm package` workflow

## Backlog Tasks (MC)
- e9491b4e — Document Console architecture (Solid.js, Chrome Extension, Engine API contract)
  → should reference design/001-console-tech-stack.md; start after memory/updates PR merges

## Open PRs
- PR #20: backup-disk-console-design (design/004) — awaiting review + Axle dependency confirmation

## Merged PRs
- PR #15: console-ui-v1 (81 tests)
- PR #16: architecture doc (docs/ARCHITECTURE.md + docs/INDEX.md) — merged 2026-04-01
- PR #17: memory/updates (AGENTS.md + identity fixes) — merged 2026-04-01
- PR #18: user-mode-design (design/003-console-user-management.md)
- PR #19: user-mode-impl (111 tests, full auth + AppBrowser + FirstTimeSetup) — merged 2026-04-01

## Cross-Agent Communication
- All cross-agent comms go through Koen (Telegram relay). Do not message agents directly.
- Send `📨 **For [Agent]:** [message]` in own Telegram group; Koen forwards.

## Cross-board task creation
Use `MC_PLATFORM_TOKEN` (from `.env`) with the admin route:
```bash
curl -s -X POST "http://mission-control-backend:8000/api/v1/boards/{board_id}/tasks" \
  -H "Authorization: Bearer ${MC_PLATFORM_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @payload.json
```
Agent token (`AUTH_TOKEN`) is board-scoped — 403 for any other board.

## Durable Decisions
- One task at a time. Do not pick up a new task until current task is fully complete.
- BASE_URL: `http://mission-control-backend:8000`
- Boards list endpoint: `{"items": [...], "total": N}` — use `.items[]` not `.[]` with jq
- Board `Console Dev`: `require_approval_for_done: true` — all task closures need Koen approval

## Communication Standards
- **No markdown tables or ASCII art tables in Telegram** — use `telegram-table` skill to render as PNG
- Skill at: `/home/node/workspace/skills/telegram-table/scripts/render_table.py`
- For simple label/value lists, use plain bullets instead

## Key Lessons
- Always check Engine's Automerge state model before building any write-state UI feature
- Run pnpm test before any commit; test with actual Engine running before PR
