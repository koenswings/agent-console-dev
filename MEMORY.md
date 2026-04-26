# MEMORY.md — Pixel's Long-Term Memory

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

## What to do at next session start
- main is up to date as of PR #47 (v0.2.3) — login works, empty disk panel redesigned, settings close button removed
- LoginDebug.tsx removed in PR #48 — main is clean

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
