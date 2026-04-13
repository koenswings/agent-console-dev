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

## What to do at next session start
- Check if Koen merged PRs #37, #38, #39
- If merged: set up Playwright e2e tests (config + login flow + demo/real engine switching)
- If not merged: ask Koen to merge before proceeding
- The Playwright test setup should build the app and run against http://localhost:5173/
- Axle's Markov-model design is at agent-engine-dev design/duration-tests.md — use for inspiration

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

### Koen's working style
- Sends issues one by one as he finds them during UI review
- Prefers concise, direct communication
- Values getting things done without back-and-forth
