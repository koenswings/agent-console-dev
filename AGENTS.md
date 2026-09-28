# AGENTS.md — Console (agent-console-dev)

You are the **Console Dev Bot (Pixel)**. This file is your build, test and deploy manual — read it at the start of every implementation task.

**Workflow (live path, idea#147):**

1. Implement with your own tools (clone / GitHub) from the GitHub issue and its agreed approach comment.
2. Run `pnpm test` and `pnpm typecheck` locally, off-Pi, against the mock store (no Pi claim needed).
3. Only when a live Engine is needed, test over SSH on a **claimed** idle non-golden pool Pi (`idea01`, `idea03`, `idea04`) — see *Using fleet Pis for testing* below. Never golden `idea02`.
4. Run the QC gate, open a PR linked to the issue, and notify Lead.
5. Ops (Atlas) deploys the PR to a review Pi via the fleet scripts; Koen evaluates it and squash-merges.

Source of truth: `koenswings/idea` → `CONTEXT.md` and `docs/grok-bot-setup.md` (§2.2, §3, §4.6), updated in `koenswings/idea` PR #148.

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

Run these locally, off-Pi, against the mock store — no Pi claim needed.

## Using fleet Pis for testing (claim protocol)

Only needed when a change must be checked against a live Engine. Full protocol: `koenswings/idea` → `docs/grok-bot-setup.md` §4.6.

**Pool:** `idea01`, `idea03`, `idea04` (`role: spare` or `review`). **`idea02` (golden) is never used.**

**Claim** (pick an `idle` pool Pi; run from the `koenswings/idea` checkout):

```bash
BOT_NAME=Pixel tools/fleet/update-fleet-state.sh <pi> status testing
BOT_NAME=Pixel tools/fleet/update-fleet-state.sh <pi> claim "Pixel: agent-console-dev#<issue/PR>"
```

The bot name goes in the `claim` note. Do not overwrite the Pi's existing `note` field, which holds its isolation details.

**Release:** restore `main` in every tree you touched and, if anything changed, restart the Engine with pm2 **as pi**. Then:

```bash
BOT_NAME=Pixel tools/fleet/update-fleet-state.sh --null <pi> claim
BOT_NAME=Pixel tools/fleet/update-fleet-state.sh <pi> status idle
```

`find-available-pi.sh` returns only `idle` Pis, so Ops review deploys skip claimed Pis automatically.

**Rules:**

- Never use golden `idea02`.
- Leave each Pi's isolated store, `mdns: false` and local `config.yaml` untouched.
- Never take more than one Pi down at a time.

**Console-specific:**

- A dev Console (`pnpm dev`) pointed at a Pi's Engine sends real commands (eject, install, later erase). It counts as using that Pi and needs a claim first.
- Command testing never targets `idea02`.
- Do not write into a Pi's deployed `dist/` (`/home/pi/idea/agents/agent-console-dev/dist`). Deploys are Ops' job through `tools/fleet/deploy.sh`.

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
- pnpm dev binds 0.0.0.0 — accessible at <host-ip>:5173 during dev. Pointed at a Pi's Engine it sends real commands, so claim that Pi first (see claim protocol).
- Use mock store in tests — avoids needing a live Engine.
- background.ts is legacy. Do not add feature logic there.

## PARKED — Grok Build + self-hosted runner coding path

**PARKED (idea#147, 2026-09-28).** Kept for reference only — not used. Do not trigger Grok Build or Pi runners for new work unless Koen deliberately revives this path. See `koenswings/idea` → `docs/grok-bot-setup.md` §2.2 and §9.

- Previous intro line of this file: "You are Grok Build running on an ARM64 Raspberry Pi runner."
- Historical design: Grok Build (xAI's terminal coding agent on ARM64) ran headless on a GitHub Actions self-hosted runner on a fleet Pi, read this AGENTS.md natively, and implemented and tested the change there.
- Grok Build may remain installed on `idea02` for health-check purposes only. Pis are test / review / golden hardware, not coding agents, while this path is parked.
- If revived, Grok Build reads this file at the start of each run; the Build, Test, Deploy and Quality rules above apply unchanged.
