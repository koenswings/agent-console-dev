# AGENTS.md — Console (agent-console-dev)

You are Grok Build running on an ARM64 Raspberry Pi runner.

## What this repo is

The IDEA Console — a Solid.js web app served by the Engine on port 80. Built via Vite → dist/ → deployed to Pi fleet via deploy-fleet.sh.

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
  deploy-fleet.sh      Build + deploy to all fleet Pis
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

## Deploy (Ops Bot calls deploy.sh — do not deploy manually)

The fleet scripts handle deployment. For reference:
```bash
./scripts/deploy-fleet.sh             # build + deploy to all Pis
./scripts/deploy-fleet.sh --skip-build  # deploy current dist/
```

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
