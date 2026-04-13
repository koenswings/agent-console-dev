# Console UI Review Session — April 12, 2026

## PRs opened today (all open, awaiting merge)

| PR | Title | Branch |
|----|-------|--------|
| #37 | fix: demo toggle immediately updates App status bar | fix/demo-toggle-status-bar |
| #38 | fix: settings panel UX redesign + ChangeEngineDialog | fix/settings-panel-ux |
| #39 | fix: login hang + all storage/chrome.extension fixes | fix/login-ux |

**Merge order: #37 → #38 → #39** (each builds on the previous)

## Bugs fixed

### Settings
- Demo toggle closed the panel instead of staying open
- Engine Connection tab showed duplicate hostname, confusing buttons
- Display mode shown in wrong place (moved to About tab)
- Display mode shown even in web/non-extension mode (now hidden via IS_EXTENSION)
- "Switch to demo mode" shown even when already in demo mode

### Login
- Login hung indefinitely (root cause: chrome.storage.local silent hang in web tabs)
- Login did nothing when store not yet synced (now shows "Connecting…" state)
- No show/hide password button (added)
- createEffect accumulation on reconnect caused signal conflicts

### Connection  
- "Connecting…" forever after demo→real engine switch (connected() now set on WS ready)
- Session restore blocked login button (removed gate, added 3s fallback)

## Architecture decisions

### IS_EXTENSION flag (src/store/context.ts)
Single synchronous boolean evaluated at module load:
```ts
export const IS_EXTENSION: boolean =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime !== 'undefined' &&
  typeof chrome.runtime.id === 'string' &&
  chrome.runtime.id.length > 0;
```
Used everywhere chrome.storage is accessed. Prevents all silent hangs in web mode.

### createEffect placement
All reactive effects now at App component top level, tracking the `connection()` signal.
Never created inside async functions.

### Automerge ImmutableString
All values from Automerge store coerced with `String()` before passing to bcrypt or serialising.

## What still needs doing

1. **Merge PRs** #37 → #38 → #39
2. **Playwright e2e tests** — see MEMORY.md for plan
3. **Autonomous testing** — never ask Koen to test UI again; use Playwright + console capture
4. **Markov-model UI walker** — inspired by Axle's duration-tests design

## Current state
- Built app: `http://100.115.60.6:5173/` (python3 http.server on Pi)
- Demo mode login: works perfectly
- Real engine login: works after ~2-5s store sync, button shows "Connecting…" while waiting
- All 259 unit tests passing
