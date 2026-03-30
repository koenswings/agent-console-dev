# Console UI — Development Setup, Build Workflow, and Testing Scope

**Status:** Proposed  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-03-29  
**Depends on:** `design/001-console-tech-stack.md`

---

## Context

This document covers the practical development workflow for the Console UI: how the
project is set up, how a developer runs and builds it, how the built extension is
installed in Chrome, and what the testing strategy covers.

The Console runs on a headless Raspberry Pi 5. Koen (CEO) accesses it remotely over
Tailscale. There is no display attached to the Pi.

---

## Project Structure

```
agent-console-dev/
├── src/
│   ├── background/          # Chrome Extension service worker
│   │   └── background.ts
│   ├── components/          # Solid.js UI components
│   │   ├── NetworkTree.tsx  # Left pane: engine/disk tree
│   │   ├── InstanceList.tsx # Right pane: instances for selection
│   │   ├── InstanceRow.tsx  # Single instance with status + controls
│   │   ├── StatusDot.tsx    # Coloured status indicator
│   │   └── Onboarding.tsx   # First-run engine hostname setup
│   ├── store/               # Automerge connection + reactive signals
│   │   ├── engine.ts        # createClientStore wrapper for browser
│   │   ├── signals.ts       # Solid.js signals derived from store doc
│   │   └── commands.ts      # sendCommand helper (writes to store)
│   ├── mock/
│   │   └── mockStore.ts     # Mock store for dev/test (no Engine needed)
│   ├── types/               # Shared TypeScript types mirrored from Engine
│   │   └── store.ts         # Engine, Disk, App, Instance interfaces
│   ├── App.tsx              # Root component (layout, routing)
│   ├── index.html           # Entry point for web app dev mode
│   └── styles/
│       └── main.css         # All CSS — layout, status colours, tree
├── manifest.json            # Chrome Extension Manifest V3
├── vite.config.ts
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

---

## Tech Stack (summary)

| Concern | Choice |
|---|---|
| Framework | Solid.js |
| Language | TypeScript (strict) |
| Build | Vite |
| Package manager | pnpm |
| Extension target | Chrome Manifest V3 |
| Styles | Custom CSS — no component library |
| Engine connection | `@automerge/automerge-repo` + `BrowserWebSocketClientAdapter` |
| Tests | Vitest + Solid Testing Library |

See `design/001-console-tech-stack.md` for full rationale.

---

## Pi Path

The Console project lives at:

```
/home/pi/idea/agents/agent-console-dev
```

All commands in this document should be run from that directory.

## Development Workflow

### Prerequisites

```bash
cd /home/pi/idea/agents/agent-console-dev
pnpm install
```

### Running in dev mode (web app)

```bash
pnpm dev
```

Vite is configured with `host: true` (binds to `0.0.0.0`). The dev server is
accessible at:

```
http://<pi-tailscale-ip>:5173
```

The Tailscale IP for the Pi can be found in the Vite startup output (the `100.x.x.x`
network address). Open this URL in Chrome on any machine connected to the Tailscale
network. No extension install required. Hot-reload is active — changes in `src/`
reflect immediately.

**By default, dev mode connects to the mock Engine** (see Testing section below).
To connect to the real Engine, set the engine hostname in the onboarding screen or
via the `VITE_ENGINE_HOST` environment variable:

```bash
VITE_ENGINE_HOST=appdocker01.local pnpm dev
```

The Engine WebSocket port is **4321**.

---

## Build Workflow

### Building the extension

```bash
pnpm build
```

Produces a `dist/` directory containing the complete Chrome Extension (Manifest V3
format): `manifest.json`, bundled JS, HTML entry points, and all assets.

### Packaging for download

```bash
pnpm package
```

This script (defined in `package.json`) zips `dist/` into `extension.zip` and starts
a temporary HTTP server on port **8080** that serves it:

```
http://<pi-tailscale-ip>:8080/extension.zip
```

Koen downloads the zip, unpacks it on his local machine, and loads it in Chrome.

---

## Installing and Testing the Extension

1. Run `pnpm package` on the Pi (see above)
2. Download `http://<pi-tailscale-ip>:8080/extension.zip` in Chrome
3. Unzip the downloaded file on your local machine
4. In Chrome: navigate to `chrome://extensions`
5. Enable **Developer Mode** (toggle, top right)
6. Click **Load unpacked**
7. Select the unzipped `dist/` folder
8. The IDEA Console extension appears in the toolbar

To update after a new build: re-download, unzip, click the refresh icon on the extension
card in `chrome://extensions`.

---

## Engine Connection

The Console connects to the Engine via WebSocket using the Automerge
`BrowserWebSocketClientAdapter`. It requires:

- **Engine hostname** — entered by the user on first run, stored in
  `chrome.storage.local`. Default: `appdocker01.local`.
- **WebSocket port** — fixed at **4321** (Engine default).
- **Automerge document URL** — the store document ID the Engine writes to
  `store-identity/store-url.txt` at boot.

### Open question: document URL discovery

The Console needs the Automerge document URL to bind to the correct store document.
Currently the Engine does not expose this via HTTP. **A cross-agent request has been
raised with Axle** (Engine developer) to add a single endpoint to the Engine's existing
HTTP server (port 80):

```
GET /api/store-url
→ { "url": "automerge:<document-id>" }
```

Until this is implemented, the document URL is configured via the onboarding screen
(user pastes it in) or via the `VITE_STORE_URL` environment variable in dev.

---

## Testing Scope

### What is tested automatically

#### 1. Unit tests (Vitest)

Pure logic with no DOM:

- Store data → view model mapping (e.g. `getEngineTree(store)` returns the correct
  nested structure)
- `isOnline(engine)` — engine heartbeat freshness logic
- `statusColour(status)` — returns correct CSS class for each `Status` value
- `buildCommand(commandName, args)` — command string formatting
- `sendCommand` — verifies the correct mutation is written to the Automerge document

#### 2. Component tests (Vitest + Solid Testing Library)

Mount individual components with mock props and assert on rendered output:

- `<StatusDot status="Running" />` renders a green indicator
- `<StatusDot status="Error" />` renders a red indicator
- `<InstanceRow />` shows the app title, status dot, start/stop buttons
- `<NetworkTree />` renders the correct number of engine and disk nodes from mock data
- `<Onboarding />` calls the save handler when a valid hostname is submitted

#### 3. Mock Engine (dev + test)

`src/mock/mockStore.ts` provides a pre-populated in-memory Automerge store with:

- 2 engines (`appdocker01`, `appdocker02`)
- 3 disks (1 docked to engine 1, 2 docked to engine 2)
- 5 instances in varied states: Running, Stopped, Docked, Error, Undocked

This mock is used by the dev server (no real Engine needed for UI development) and
by component tests. It is never compiled into the production extension build.

#### 4. Playwright (headless, on Pi)

End-to-end tests that run on the Pi against the dev server (mock Engine mode):

- Console loads and shows the network tree
- Selecting an engine shows its instances in the right pane
- Clicking "Stop" on a Running instance sends the correct command to the mock store
- Onboarding flow: entering a hostname saves it and proceeds to the main view
- Status dot colours match instance statuses in the mock store

Playwright runs headlessly (`pnpm test:e2e`). Screenshots are written to
`test-results/` and can be inspected remotely.

### What requires manual verification (real Engine)

The following cannot be confirmed by automated tests and require a real Engine with a
docked App Disk:

- WebSocket connection to `ws://appdocker01.local:4321` succeeds and data appears in the UI
- Real instance statuses match what Docker reports on the Pi
- Start/stop commands round-trip correctly: UI → Automerge → Engine store monitor → Docker → status update back to UI
- App links open the correct URL in a new tab and the app loads in the browser

This step requires Koen to:
1. Dock an App Disk into the Pi (or use a test fixture)
2. Run `pnpm dev` on the Pi
3. Open `http://<pi-tailscale-ip>:5173` in Chrome
4. Confirm the UI shows correct data and that start/stop works

**PR will not be opened until this manual verification is completed.**

---

## Commands Reference

Run all commands from `/home/pi/idea/agents/agent-console-dev`.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start dev server at `0.0.0.0:5173` (mock Engine) |
| `VITE_ENGINE_HOST=<host> pnpm dev` | Dev server connected to real Engine |
| `pnpm build` | Build extension to `dist/` |
| `pnpm package` | Build + zip to `/tmp/idea-console-pkg/extension.zip` + serve on port 8080 |
| `pnpm test` | Run all unit + component tests (Vitest) |
| `pnpm test:e2e` | Run Playwright E2E tests headlessly on Pi |
| `pnpm typecheck` | TypeScript strict type check |

After running `pnpm package`, navigate to `http://<pi-tailscale-ip>:8080/extension.zip`
to download the built extension. The root URL (`/`) shows a directory listing — click
`extension.zip` from there if you prefer.

---

## Open Items

- Axle cross-agent request: `GET /api/store-url` endpoint on Engine HTTP server (port 80)
- Engine WebSocket port (4321) is fixed; will need to be configurable if the Engine
  config changes
