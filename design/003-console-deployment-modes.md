# Console UI — Deployment Modes

**Status:** Proposed  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-03-30  
**Depends on:** `design/001-console-tech-stack.md`, `design/002-console-dev-setup-and-testing.md`

---

## Overview

The Console UI is a single Solid.js application that can be delivered in three ways.
The same built artefact (`dist/`) works in all three — no separate builds or code paths.

| Mode | How accessed | Hostname discovery | Store URL discovery |
|---|---|---|---|
| Dev (Tailscale) | `http://<pi-tailscale-ip>:5173` | Mock or env var | env var |
| Chrome Extension | Toolbar icon (side panel / popup / window) | Settings screen | Settings screen |
| Production web app | `http://<engine-hostname>/` | Auto from `window.location` | `GET /api/store-url` |

---

## Mode 1 — Development (Vite dev server)

Used during UI development. Served by `pnpm dev` on the Pi, accessible via Tailscale.

- Always uses mock Engine data (`createMockConnection`)
- Hot-reload active
- Port: 5173
- Chrome Extension APIs not available; display mode selector is hidden

See `design/002-console-dev-setup-and-testing.md` for full dev workflow.

---

## Mode 2 — Chrome Extension

The Console is packaged as a Chrome Extension (Manifest V3) and installed in Chrome.

**Installation path:** `pnpm package` → zip → download via Tailscale → load unpacked.

**Display modes** (runtime-switchable via the ⚙ settings screen):
- **Side panel** — docked to the right of the browser, stays open across tabs
- **Popup** — opens on icon click, closes on blur. Min size: 380×480px.
- **Standalone window** — opens as a separate Chrome window (960×680px)

**Hostname discovery:** User enters the Engine hostname in the onboarding/settings screen.
Saved to `chrome.storage.local` and used for WebSocket connection on port 4321.

**Store URL discovery:** User optionally pastes the Automerge document URL. The Console
also tries `GET http://<hostname>/api/store-url` on every connect (see Mode 3 below).

---

## Mode 3 — Production Web App (served from Engine port 80)

The most frictionless deployment path for school IT coordinators. No extension install,
no Tailscale, no configuration — just open a browser and navigate to the Engine.

**How it works:**
1. The school IT coordinator opens `http://appdocker01.local/` (or the engine's IP) in
   any browser on the school LAN.
2. The Engine's HTTP server (already running on port 80) serves the Console's `dist/`
   folder as a static web application.
3. The Console detects it is running in production web mode from `window.location.hostname`
   (not localhost, not a Tailscale/dev address) and skips the onboarding screen.
4. The hostname is known automatically — it's `window.location.hostname`.
5. The Console fetches `GET /api/store-url` from the same origin to discover the
   Automerge document URL, then connects via WebSocket on port 4321.

**UX outcome:** Zero configuration. Open a URL → see the live network.

### Detection logic

```ts
// Console is in production web mode when:
// - Not a development build (import.meta.env.DEV === false)
// - Not running as a Chrome Extension (chrome.storage unavailable)
// - window.location.hostname is set and is not localhost/loopback
const isProductionWebMode =
  !import.meta.env.DEV &&
  !isExtensionContext() &&
  window.location.hostname !== '' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1';
```

When detected, the Console:
- Uses `window.location.hostname` as the Engine hostname
- Attempts `GET /api/store-url` to discover the Automerge document URL
- Falls back to a stored URL (localStorage) if the endpoint is not yet available
- Shows a "not connected" state if connection fails, with the detected hostname visible

### Required Engine changes (cross-agent: Axle)

Two changes needed in the Engine to support Mode 3:

**1. Serve `dist/` as static files on port 80**

The Engine's HTTP server (`src/monitors/instancesMonitor.ts`) currently serves only
`appnet.html`. It needs to also serve the Console's `dist/` folder as static assets.
Suggested path structure:

```
GET /          → serves Console's index.html
GET /assets/*  → serves Console's compiled JS/CSS/WASM
GET /appnet    → existing appnet.html (moved to /appnet)
```

Or with a sub-path if the root is reserved:

```
GET /console/  → Console's index.html
GET /console/assets/* → static assets
```

**2. Expose store URL via HTTP**

```
GET /api/store-url
→ 200 { "url": "automerge:<document-id>" }
```

The document URL is already written to `store-identity/store-url.txt` at Engine boot.
The endpoint just reads and returns it.

**Cross-agent task status:** Pending — to be raised on Axle's board.

---

## Deployment comparison

| | Dev | Extension | Production web |
|---|---|---|---|
| Needs Chrome Extension install | ✗ | ✓ | ✗ |
| Works in any browser | ✓ (Chrome/Tailscale) | ✗ (Chrome only) | ✓ |
| Works on any device on LAN | ✗ | ✗ | ✓ |
| Auto-detects Engine | ✓ (mock) | ✗ (manual) | ✓ |
| Internet required | ✗ | ✗ | ✗ |
| Requires Engine running | ✗ (mock) | Optional (demo mode) | ✓ |

For school deployments, **Mode 3 is the target**. The Chrome Extension (Mode 2) is
useful for operators who prefer a persistent browser panel and work on multiple networks.

---

## Open items

- [ ] Axle: `GET /api/store-url` endpoint on Engine HTTP server (port 80)
- [ ] Axle: Serve Console `dist/` from Engine HTTP server (static files)
- [ ] Pixel: Confirm detection logic handles all edge cases (VPN, NAT, etc.)
