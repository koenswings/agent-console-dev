# Console UI — Build, Deployment, and Testing

**Status:** Approved  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-03-29 (updated 2026-04-07)  
**Depends on:** `design/001-console-tech-stack.md`

---

## Context

This document covers how the Console UI is built, how it is deployed in each of its
three delivery modes, and what the testing strategy covers.

The Console runs on a headless Raspberry Pi 5 at `/home/pi/idea/agents/agent-console-dev`.
Koen (CEO) accesses it remotely over Tailscale. There is no display attached to the Pi.

---

## Project Structure

```
agent-console-dev/
├── src/
│   ├── background/          # Chrome Extension service worker
│   ├── components/          # Solid.js UI components
│   │   ├── NetworkTree.tsx  # Left pane: engine/disk tree
│   │   ├── InstanceList.tsx # Right pane: instances for selection
│   │   ├── InstanceRow.tsx  # Single instance with status + controls
│   │   ├── StatusDot.tsx    # Coloured status indicator
│   │   └── Onboarding.tsx   # Settings: hostname, demo mode, display mode
│   ├── store/
│   │   ├── engine.ts        # Automerge connection + production web mode detection
│   │   ├── signals.ts       # Solid.js signals derived from store doc
│   │   └── commands.ts      # sendCommand helper
│   ├── mock/
│   │   └── mockStore.ts     # Mock store for dev/test (no Engine needed)
│   ├── types/
│   │   └── store.ts         # Engine, Disk, App, Instance interfaces
│   ├── App.tsx              # Root component
│   └── styles/
│       └── main.css         # All CSS — no external fonts, no CDN
├── public/
│   └── manifest.json        # Chrome Extension Manifest V3
├── vite.config.ts
├── tsconfig.json
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

## Deployment Modes

The same `dist/` build artefact is used in all three modes. No separate builds.

| Mode | Access | Hostname | Store URL | Status |
|---|---|---|---|---|
| Dev (Tailscale) | `http://<pi-tailscale-ip>:5173` | Mock / env var | env var | ✅ Working |
| Chrome Extension | Toolbar icon | Settings screen | Settings screen or auto | ✅ Working |
| Production web app | `http://<engine-hostname>/` | Auto from URL | `GET /api/store-url` | ⏳ Needs Engine changes |

### Mode 1 — Development (Vite dev server)

Used during UI development. Served by the `idea-console-dev` systemd user service on the Pi, accessible over Tailscale.

- **Demo mode** is on by default — uses mock Engine data, no real Engine required
- Hot-reload active; port 5173
- Chrome Extension APIs not available (display mode selector is hidden)
- To use a real Engine: toggle off Demo mode in settings and enter the hostname
- **URL:** `http://100.115.60.6:5173/` (Tailscale IP)

#### systemd service (persistent dev server)

The dev server runs as a systemd user service — it starts automatically on boot and
restarts on failure. It does not need to be started manually.

```bash
# Check status
systemctl --user status idea-console-dev

# Restart (e.g. after a code change that breaks hot-reload)
systemctl --user restart idea-console-dev

# View logs
journalctl --user -u idea-console-dev -f
```

Service file: `~/.config/systemd/user/idea-console-dev.service`

```ini
[Unit]
Description=IDEA Console Vite Dev Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/idea/agents/agent-console-dev
ExecStart=/usr/bin/env bash -c 'source /home/pi/.nvm/nvm.sh 2>/dev/null; export PATH="/home/pi/.local/bin:/usr/local/bin:$PATH"; pnpm dev'
Restart=on-failure
RestartSec=5
Environment=HOME=/home/pi
Environment=NODE_ENV=development

[Install]
WantedBy=default.target
```

The service was enabled with `systemctl --user enable idea-console-dev` so it
persists across reboots.

### Mode 2 — Chrome Extension

Packaged as a Chrome Extension (Manifest V3), installed via Load Unpacked in Chrome.

**Display modes** (runtime-switchable via the ⚙ settings screen):
- **Side panel** (default) — docked right of browser, stays open across tabs; uses
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` for reliable
  click handling without depending on the service worker being awake
- **Popup** — opens on icon click; min size 380×480px
- **Standalone window** — separate Chrome window (960×680px)

Display mode is saved immediately on radio change — no need to submit the form.

**Hostname and store URL:** entered in the settings screen (⚙). The Console also
tries `GET http://<hostname>/api/store-url` automatically — once the Engine exposes
that endpoint, the operator never needs to paste the store URL manually.

**Demo mode:** available in settings. When on, uses mock data regardless of
Engine availability. Shown as a yellow **DEMO** badge in the status bar.

**Install steps:**
1. `pnpm package` on the Pi — builds, zips, serves zip on port 8080
2. Download `http://<pi-tailscale-ip>:8080/extension.zip`
3. Unzip on local machine
4. Chrome → `chrome://extensions` → Developer Mode → Load unpacked → select `dist/`

To update: re-download, unzip, click refresh on the extension card.

### Mode 3 — Production Web App (served from Engine port 80)

The primary deployment target for school use. No extension install, no Tailscale,
no configuration — just open a browser on the school LAN.

**How it works:**
1. The IT coordinator opens `http://appdocker01.local/` in any browser on the LAN
2. The Engine's HTTP server (port 80) serves the Console's `dist/` as static files
3. The Console detects it is running from an Engine URL (not localhost, not Tailscale,
   not Chrome Extension) and skips onboarding entirely
4. Hostname is `window.location.hostname` — already known
5. `GET /api/store-url` on the same origin returns the Automerge document URL
6. WebSocket connects to `ws://<hostname>:4321`

**Detection logic** (in `src/store/engine.ts`):
```ts
// Production web mode when:
// - Not a Vite dev build
// - Not running as a Chrome Extension
// - window.location.hostname is not localhost / loopback / Tailscale (100.x.x.x)
```

**Required Engine changes** — cross-agent request raised with Axle:

1. **Serve `dist/` as static files from port 80**
   The Engine's HTTP server (`src/monitors/instancesMonitor.ts`) currently serves only
   `appnet.html`. It needs to serve the Console's built assets:
   ```
   GET /          → Console's index.html
   GET /assets/*  → compiled JS, CSS, WASM
   GET /appnet    → existing appnet.html (moved to /appnet path)
   ```

2. **Expose store URL via HTTP**
   ```
   GET /api/store-url
   → 200 { "url": "automerge:<document-id>" }
   ```
   The document URL is already written to `store-identity/store-url.txt` at boot.
   This endpoint just reads and returns it.

**Deployment comparison:**

| | Dev | Extension | Production web |
|---|---|---|---|
| Needs Chrome Extension install | ✗ | ✓ | ✗ |
| Works in any browser | ✓ (Chrome/Tailscale) | ✗ (Chrome only) | ✓ |
| Works on any device on LAN | ✗ | ✗ | ✓ |
| Auto-detects Engine | ✓ (mock) | ✗ (settings) | ✓ |
| Internet required | ✗ | ✗ | ✗ |
| Requires Engine running | ✗ (demo mode) | Optional (demo mode) | ✓ |

---

## Build and Package Commands

Run all commands from `/home/pi/idea/agents/agent-console-dev`.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start dev server at `0.0.0.0:5173` |
| `pnpm build` | Build to `dist/` (clears old build first via sudo rm fallback) |
| `pnpm package` | Build + zip + serve on port 8080 for download |
| `pnpm test` | Run all unit + component tests (Vitest) |
| `pnpm test:e2e` | Run Playwright E2E tests headlessly on Pi |
| `pnpm typecheck` | TypeScript type check |

**Permissions note:** Vite's dependency cache is stored in `/tmp/idea-console-vite-cache`
(not `node_modules/.vite`) to avoid ownership conflicts between the sandbox agent and
the Pi user. `pnpm build` clears `dist/` with a `sudo` fallback before building.

---

## Testing Scope

### 1. Unit tests (Vitest) — pure logic

- Store data → view model mapping
- `isOnline(engine)` — heartbeat freshness
- `statusColour(status)` — CSS class per Status value
- Command string formatting and mutation
- `isProductionWebMode()` — host detection logic

### 2. Component tests (Vitest + Solid Testing Library)

- `<StatusDot>` renders correct colour for each Status
- `<InstanceRow>` — start/stop buttons disabled in correct states
- `<NetworkTree>` — correct node count from mock data
- `<Onboarding>` — form saves on submit; display mode saves on change

### 3. Mock Engine (dev + test)

`src/mock/mockStore.ts` — pre-populated store:
- 2 engines (`appdocker01`, `appdocker02`)
- 3 disks, 5 instances in varied states (Running, Stopped, Docked, Error, Undocked)

Used by dev server and all tests. Never compiled into the production build.

### 4. Playwright (headless on Pi)

E2E tests against dev server (mock mode). Screenshots written to `test-results/`.

### 5. Manual verification (requires real Engine + docked App Disk)

- WebSocket connects and real data appears
- Start/stop commands round-trip (UI → Automerge → Engine → Docker → status update)
- App links open correctly in new tabs
- Production web mode: `http://appdocker01.local/` loads Console without onboarding

---

## Open Items

- [ ] **Axle:** `GET /api/store-url` endpoint on Engine HTTP server
- [ ] **Axle:** Serve Console `dist/` as static files from port 80
- [ ] Engine WebSocket port (4321) — will need to be configurable if Engine config changes
