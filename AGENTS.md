# AGENTS.md — Console (agent-console-dev)

You are Grok Build running on an ARM64 Raspberry Pi runner.

## What this repo is

The IDEA Console — a Solid.js web app served by the Engine on port 80. Built via Vite → `dist/`. On the Pi fleet, Engine serves that build from the nested idea checkout (see Deploy).

Access:
- `http://<engine-hostname>.local/` — primary (local, mDNS)
- `http://<engine-LAN-IP>/` — local fallback
- `http://<engine-tailscale-hostname>/` — remote via Tailscale

Key constraints:
- Solid.js fine-grained reactivity: all <For> loops must be ID-keyed; no broad store subscriptions
- No external CSS frameworks — main.css only
- No CDNs or external dependencies at runtime (fully offline)
- TypeScript strict mode
- Chrome Extension (background.ts): legacy, keep building, never add logic

## Pi checkout layout (locked)

Authoritative path on fleet Pis (nested under the idea tree — not a sibling of `idea`):

- Agent checkout: `/home/pi/idea/agents/agent-console-dev`
- Engine `consolePath`: `/home/pi/idea/agents/agent-console-dev/dist` (Vite `dist/`)

Retired as primary (do not document or use as current deploy targets): `/home/pi/console-dist`, sibling `/home/pi/agent-console-dev`, `/home/pi/projects/engine`.

Layout decision: `koenswings/idea` PR #64 (`proposals/pi-checkout-layout.md`).

## Repo layout

```
src/
  App.tsx              Root — connection lifecycle, mode routing
  components/          UI components
  store/               Engine connection, signals, commands, auth
  mock/                Mock store for tests
  background/          Legacy Chrome Extension service worker
  types/               TypeScript types (mirrors Engine data model)
  styles/              main.css only — no CSS frameworks
test/                  Vitest unit tests
dist/                  Built output (gitignored)
docs/                  Authoritative docs — .md, .pdf, .png, .svg ONLY
proposals/             Proposals and historical design reasoning
scripts/
  dump-store.mjs       Debug helper
  screenshot-screens.ts Playwright screenshots
```

## Build

```bash
pnpm install        # first time or after package.json changes
pnpm build          # Vite build → dist/
pnpm typecheck      # TypeScript check only
```

## Test (required before any PR)

```bash
pnpm test       # vitest run — all tests must pass
pnpm typecheck  # must pass
```

## Deploy (Ops Bot — do not deploy manually)

Ops Bot deploys via the idea fleet scripts — **not** a script in this repo.

- Fleet entrypoint: `koenswings/idea` → `tools/fleet/deploy.sh` (and related fleet helpers)
- This Console repo has **no** `scripts/deploy-fleet.sh` (historical name only; do not invent or re-add it here)
- On the Pi, after deploy, Engine serves Console from `consolePath: /home/pi/idea/agents/agent-console-dev/dist`

## Quality rules (every PR, no exceptions)

- No source files in docs/ — .md, .pdf, .png, .svg only
- No hardcoded credentials — import.meta.env only
- No console.log in production paths
- No commented-out blocks >5 lines without explanation
- No TODO/FIXME without linked GitHub issue
- All <For> loops ID-keyed — never index-keyed
- No broad store subscriptions — use derived signals
- Build/deploy changed → update this file in same PR
- New doc in docs/ → update docs/INDEX.md in same PR

## Known gotchas

- pnpm build removes dist/ with sudo rm first. Fallback is plain rm.
- pnpm dev binds 0.0.0.0 — accessible at pi-tailscale-ip:5173 during dev.
- Use mock store in tests — avoids needing a live Engine.
- background.ts is legacy. Do not add feature logic there.
