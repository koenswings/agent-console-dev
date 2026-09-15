# MEMORY.md — Pixel's Long-Term Memory

## MC-Native Platform (migrated 2026-05-30)

### Work cycle
- All tasks come from MC board — no BACKLOG.md
- Task states: inbox → in_progress (CEO initiates) → review (agent moves when done) → done (CEO approves)
- Work on a **feature branch**, never commit directly to main during active work
- Post branch name as MC task comment when created: `feat/<description>`
- When done: open a GitHub PR (no auto-merge), post PR URL as MC task comment, move task to `review`
- CEO reviews via MC task thread + GitHub PR diff; CEO merges the PR on GitHub
- CEO moves MC task to `done` and messages Pixel in Telegram to continue
- Pixel posts merge confirmation as MC task comment

### Session model
- Sessions reset after **36 hours of inactivity** (no daily 4 AM reset)
- Use `/new` in Telegram to start a fresh session on demand (archived, not deleted)
- Substantial work (code, builds, deploys) → spawn isolated sub-session via `sessions_spawn` or `coding-agent` skill; never work inline in the Telegram session
- Cron sessions are isolated and short; never touch the main Telegram session

### MC task pickup
- Isolated cron job polls the board every 15 min for `in_progress` tasks
- On pickup: post acknowledgement comment, spawn isolated sub-session for the work, move to `review` when done
- For immediate pickup: Koen sends a Telegram message (bypasses 15-min cron wait)

### MC heartbeat
- Post `POST /api/v1/agents/{mc_agent_id}/heartbeat` at the start of **every Telegram session** (not cron sessions)
- MC agent ID and board ID are in TOOLS.md and .env

### GitHub PR workflow
- Agent opens a GitHub PR (no auto-merge); posts PR URL as MC task comment
- CEO reviews via task thread + PR diff on GitHub; CEO merges the PR
- CEO moves MC task to `done` and messages agent in Telegram to continue
- **No agent self-merge** — only CEO merges to main

## Kit 🎒 Agent — Procedures (agreed 2026-05-31)

### Cross-agent task convention
- Title format: `[From <Sender>] <Type>: <description>`
- Types: `Feasibility` | `Review` | `Opinion` | `Done` | `FYI`
- Always tag: `cross-agent`; one ask per task; depth-1 only; reply by comment
- If a Feasibility or Review task is unanswered for 5 days → escalate via Telegram to Koen

### Incoming work from Kit (future)
- When Kit is bootstrapped and `requires_engine_min` is implemented in the Engine, Pixel will need to surface `IncompatibleVersion` disk state in the Console UI
- This task will arrive as `[From Kit] FYI` or be created by Atlas — not yet active

### GitHub PR workflow
- Agent opens a GitHub PR (no auto-merge), posts PR URL as MC task comment
- CEO merges on GitHub, moves MC task to `done`, messages agent in Telegram to continue
- **No agent self-merge** — only CEO merges to main

## Critical: chrome.storage in web/dev mode
- `chrome.storage.local` exists in regular Chrome tabs — its async calls **never resolve and never throw** (silent hang)
- Must use `chrome.runtime?.id` to detect a real extension context, NOT `chrome.storage?.local`
- Always guard `chrome.storage.local.get/set/remove` with `isExtensionContext()` → `!!chrome.runtime?.id`
- Same applies to `persistSession`, `csGet`, `csSet`, `readFromStorage` — any async chrome.storage call
- Also: Automerge stores strings as `ImmutableString` objects — always `String(value)` before passing to bcrypt or other libs

## Design Principles

### Usability First
- **Never surprise the user with navigation they didn't ask for.** Saving a setting should not close the panel or jump to another screen unless the user explicitly clicked something that implies that (e.g. "Save & Connect" on an onboarding screen).
- **Don't duplicate information.** If the status bar already shows the connection state, don't repeat it on the settings page. If a list shows the current hostname, don't also show it in a separate "current connection" box.
- **Labels should tell the user what matters, not what the system sees.** "Connected" is more useful than a raw IP. "Demo mode — simulated data" beats a generic DEMO badge with no explanation in context.
- **Avoid presenting the same thing twice.** A one-Pi system should not show the same address in two separate lists.
- **Settings panels stay open until explicitly closed.** Changing a toggle or scanning should update state in the background, not dismiss the panel.

## UI Design Doc (MANDATORY — do not skip)
- `design/UI-DESIGN.md` must be kept in sync with the app
- Every PR that results in a visual change must include an update to UI-DESIGN.md
- Re-run `scripts/screenshot-screens.ts` after the change to capture fresh screenshots
- **Both** the text in UI-DESIGN.md AND the screenshots must be updated and committed in the PR
- ⚠️ I forgot this in PR #47 — I ran the screenshots but did not update the doc text. Don't repeat this.

## Dev Server & Version Process (MANDATORY)
- Dev server runs at `http://100.115.60.6:5173` (Tailscale) and `http://192.168.0.231:5173` (LAN)
- Vite HMR is live — file edits hot-reload instantly, no restart needed
- **Every time I make a code change:** bump the patch version in `package.json` (e.g. 0.2.0 → 0.2.1) and tell Koen the new version number so he can verify the status bar
- Version is displayed in the UI as `v{pkg.version}` in the status bar (imported from `package.json`)
- Always state the version number when reporting changes to Koen
- **Always give the full URL after every change:** `http://100.115.60.6:5173` (Tailscale) or `http://192.168.0.231:5173` (LAN)

## Fleet Deploy Script (MANDATORY)

- **Every code change must be deployed** to all active fleet targets via:
  ```
  cd /home/node/workspace/agents/agent-console-dev && bash scripts/deploy-fleet.sh
  ```
- Script builds the console, rsyncs dist/, updates `consolePath` in engine config, restarts engine via pm2
- Targets: wizardly-hugle (local), idea01–idea04 (skip gracefully if unreachable)
- Use `--skip-build` flag if dist/ is already fresh
- Script lives at: `scripts/deploy-fleet.sh`

## Fleet Architecture Shift (implemented 2026-06-05)

- **Wizardly-hugle** = agents workspace + code store only. No app servers.
- **Fleet Pis** = where IDEA Apps run. Accessible via Tailscale.
- Console is now deployed to fleet Pis (v0.2.85 on idea02 + idea03), not served from wizardly-hugle.
- Engine `consolePath` config field controls whether the console is served — set to `/home/pi/console-dist` on each Pi.
- idea02: `192.168.0.180` / `idea02.tail2d60.ts.net` / `100.85.108.118` — console on port 3333 (httpPort config says 80 but engine binds 3333 — check engine version)
- idea03: `100.126.117.80` / `idea03.tail2d60.ts.net` — console on port 80 ✅
- Full design doc: `/home/pi/idea/agents/agent-app-dev/design/fleet-architecture-shift.md`
- Phase 2 (Console on fleet Pis) complete. Phase 3 (Caddy cleanup on wizardly-hugle) is Kit's task.

## What to do at next session start
- main is up to date as of PR #112 (v0.2.85) — UI redesign batch 1 merged
  - AccountScreen replaces login modal (👤 button in status bar)
  - ChangeEngineDialog removed; engine tab has demo toggle only
  - ConnectionManagement renamed from Onboarding
  - RestorePanel redesigned with per-instance inline restore flow
  - History promoted to full content-area screen
  - e2e tests updated for new UI
- Clean working tree, on main branch
  - PR #90: `host:port` syntax in ChangeEngineDialog manual input
  - PR #91: better history error msg (shows URL tried + ask Axle), demo toggle in Settings panel, login btn in status bar
  - PR #92: always-visible status bar buttons (login + history), simplified scan panel with corner spinner
- Clean working tree, on main branch
  - Lesson: SolidJS <Show when={a && b}> — child accessor returns LAST value of &&. Put the truthy object last.
  - Lesson: Signal reads inside a Show child accessor are NOT individually tracked. Use createMemo for any derived value that needs to update reactively inside a Show child.
  - Lesson: Never use the {(accessor) => ...} pattern inside Show to read reactive props — same issue. Always extract to createMemo outside the JSX.
  - Lesson: CSS animations can be killed by inline style overrides. When a fallback/indeterminate state needs animation, never apply an inline width/height style — render the element unconditionally and only add the style attribute when a concrete value exists.
  - PR #77: History panel button (📋) replaces inline CommandHistory
  - PR #80: Remove mock running op, add History panel screenshot
  - PR #81: Fix isProductionWebMode — Tailscale IPs (100.x) now treated as production web mode; fixes command history on fleet Pis
  - PR #73: auto-clear Starting… spinner after 15s timeout
  - PR #74: live command log in expanded panel
  - PR #75: inline log detail (latest line beneath Starting/Stopping)
  - PR #76: strip ANSI codes from log output, clear pending on trace error
  - PR #78: integrate engine PR #93 — startApp/stopApp in operationDB with cause/subject/stepLabel
- Clean working tree, on main branch

## Autonomous testing plan (to implement)
- Write Playwright e2e tests that actually run the UI
- Capture browser console output in tests — no more guessing what JS sees
- Test scenarios: demo login, real engine login, demo→engine switch, settings open/close
- Markov-model UI walker: states × transitions × invariants
- Never ask Koen to test something I can test myself with Playwright

## Project Context

### IDEA — Console UI Developer (Pixel)
- Work only in `agent-console-dev` repo
- Koen merges PRs himself; open PR with URL
- Claude Code for heavy implementation; Pixel for orchestration and review
- Console v1 feature-complete as of PR #36 (April 11, 2026)

### Deployment context (important)
- **Primary use case: web server** — app is served from an HTTP server (Vite dev server now, production web server on the engine later)
- **NOT primarily the Chrome extension** — extension exists but web mode is dominant
- `isProductionWebMode()` returns true when served from a real hostname (not localhost, not extension)
- In production web mode: hostname auto-detected from `window.location.hostname`, no localStorage dance
- Playwright tests run against the production build (`pnpm build && python3 -m http.server 5173`) — NOT against the real engine web server
- Tests use `localStorage.setItem('demoMode', 'true')` which is correct for web mode (not extension)

### Koen's working style
- Sends issues one by one as he finds them during UI review
- Prefers concise, direct communication
- Values getting things done without back-and-forth
