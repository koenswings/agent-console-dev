> **Task/Question:** What is next? (followed by: PR #15 merged, write architecture doc)

## What was done

PR #15 (Console UI v1) confirmed working by Koen on the Pi and merged.

Wrote `docs/ARCHITECTURE.md` on branch `feature/architecture-doc`:

- Deployment contexts: Chrome Extension, dev (Tailscale), production web (served from Engine port 80)
- Solid.js component structure with roles of each component
- Store layer: `StoreConnection` interface, `signals.ts` reactive accessors, `commands.ts` dispatcher, `engine.ts` Automerge WebSocket connection
- Chrome Extension service worker: display mode control (side panel / popup / window), `chrome.storage.onChanged` listener
- Data types: plain TypeScript mirror of Engine types, `Store` structure
- Demo/mock mode: activation conditions, behaviour, `createMockConnection()`
- Build system: Vite, pnpm, Vitest, key config choices
- Engine API contract: Automerge WebSocket (port 4321), command write-back format, `GET /api/store-url` (pending Engine implementation)

Updated `docs/INDEX.md` to register the new doc.

81 tests pass. PR opened.

## Outputs

- PR #16: https://github.com/koenswings/agent-console-dev/pull/16
- Task `e9491b4e` addressed by PR #16
- Task `5629de17` — needs Koen to mark done on MC board (board gate blocks agent)
