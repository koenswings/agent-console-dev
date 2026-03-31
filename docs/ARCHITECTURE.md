# Console Architecture

The IDEA Console is an operator-facing UI that shows a real-time view of all Engines, App Disks,
and running app instances across the school network — and lets operators send commands to manage
them. It is built with Solid.js and TypeScript and ships as a Chrome Extension (Manifest V3) with
an optional production web-app mode served directly from an Engine.

---

## Deployment Contexts

The Console runs in three contexts detected at runtime:

| Context | How it starts | Hostname source | Store URL source |
|---|---|---|---|
| **Chrome Extension** | Toolbar icon click | Settings screen → `chrome.storage.local` | Settings screen or `GET /api/store-url` auto-fetch |
| **Dev (Tailscale)** | `pnpm dev` → Vite dev server | Settings screen → `localStorage` | Settings screen |
| **Production web** | Engine HTTP server serves `dist/` on port 80 | `window.location.hostname` | `GET /api/store-url` on same origin |

Context detection (`src/store/engine.ts`):

```ts
export function isProductionWebMode(): boolean {
  if (import.meta.env.DEV) return false;
  if (isExtensionContext()) return false;
  const h = window.location.hostname;
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1' && !h.startsWith('100.');
}
```

---

## Component Structure

```
src/
├── App.tsx                    Root component — layout, connection lifecycle
├── main.tsx                   Solid.js mount point
├── components/
│   ├── Onboarding.tsx         Settings form — hostname, store URL, demo mode, display mode
│   ├── NetworkTree.tsx        Left panel — engine/disk tree with selection state
│   ├── InstanceList.tsx       Right panel — instances filtered by current selection
│   ├── InstanceRow.tsx        Single instance row with start/stop/eject actions
│   └── StatusDot.tsx         Coloured status indicator (Running / Stopped / Error / …)
├── store/
│   ├── engine.ts              Real Automerge WebSocket connection
│   ├── signals.ts             Solid.js reactive accessors derived from the store
│   └── commands.ts            Command builders and dispatcher
├── mock/
│   └── mockStore.ts           In-memory mock store + StoreConnection interface
├── background/
│   └── background.ts          Chrome Extension service worker — display mode control
├── types/
│   └── store.ts               TypeScript mirror of Engine data types
└── styles/
    └── main.css               All styles (no external CSS frameworks)
```

### App.tsx — root lifecycle

`App` owns the connection lifecycle:

1. On mount: reads `demoMode` and `engineHostname` from storage (async).
2. If demo mode: calls `createMockConnection()` synchronously — no network needed.
3. If real mode: dynamically imports `createEngineConnection()` to avoid loading Automerge
   in demo sessions.
4. Wires the connection's `store` accessor into the module-level signal via `setStoreSignal`.
5. Wires `sendCommand` into the commands module via `setSendCommandFn`.

The settings overlay (`Onboarding`) is shown on mount when no hostname is configured and demo
mode is off, or when the operator clicks the ⚙ button in the status bar.

---

## Store Layer

### `StoreConnection` interface (`src/mock/mockStore.ts`)

Both the real and mock connections satisfy the same interface:

```ts
interface StoreConnection {
  store: Accessor<Store | null>;   // reactive — updates on every Automerge change
  connected: Accessor<boolean>;
  sendCommand: (engineId: string, command: string) => void;
}
```

### `src/store/signals.ts` — reactive accessors

Module-level Solid.js signals derived from the `Store`. Components import these directly — no
prop-drilling for the network state.

Key exports:

| Export | Returns |
|---|---|
| `engines` | `Engine[]` — all engines in the store |
| `engineDB` | `Record<EngineID, Engine>` |
| `disksForEngine(engineId)` | `Disk[]` filtered by `dockedTo` |
| `instancesForDisk(diskId)` | `Instance[]` filtered by `storedOn` |
| `appForInstance(instanceOf)` | `App \| undefined` |
| `allInstances` | `Instance[]` — full network |
| `isEngineOnline(engine)` | `boolean` — `lastRun` within last 2 minutes |
| `getEngineTree(store)` | Pure: `EngineTreeNode[]` for rendering the network tree |
| `getInstancesForSelection(store, sel)` | Pure: filtered by network / engine / disk |

### `src/store/commands.ts` — command dispatcher

The Engine processes commands by reading strings appended to `engine.commands[]` in the
Automerge document. The commands module:

- Holds a module-level `sendCommand` function set by `App.tsx` after connection.
- Exports typed command builders (`buildStartInstanceCommand`, etc.) as pure functions.
- Exports dispatching functions (`startInstance`, `stopInstance`, `ejectDisk`) that call
  `sendCommand` with the correct engine ID and command string.

Command string format: `"<commandName> <arg1> <arg2>"` — mirrors Engine's `commandUtils.ts`.

### `src/store/engine.ts` — real connection

`createEngineConnection()` resolves the hostname and store URL, then:

1. Creates an Automerge `Repo` with a `BrowserWebSocketClientAdapter` connecting to
   `ws://<hostname>:4321`.
2. Calls `repo.find(storeUrl)` to get a document handle.
3. Listens to `handle.on('change')` to update the reactive `store` signal on every sync.
4. Returns a `StoreConnection` with `sendCommand` implemented as an Automerge
   `handle.change()` mutation — writes the command string into `engine.commands[]`.

Store URL discovery order (extension / dev context):
1. `VITE_STORE_URL` env var (dev only)
2. `storeUrl` key in `chrome.storage.local` / `localStorage`
3. Auto-fetch from `GET /api/store-url` on the Engine — so operators don't need to paste
   the URL manually once the Engine ships that endpoint.

---

## Chrome Extension (Manifest V3)

### Permissions

```json
"permissions": ["storage", "tabs", "sidePanel", "windows"]
```

### Background service worker (`src/background/background.ts`)

Runs on every browser start and on extension install. Reads `displayMode` from
`chrome.storage.local` and applies the appropriate Chrome API configuration:

| Mode | Mechanism |
|---|---|
| `sidePanel` (default) | `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` — Chrome opens the panel natively; does not depend on the service worker being awake |
| `popup` | `action.setPopup({ popup: 'index.html' })` |
| `window` | `action.onClicked` handler calls `windows.create()` (960×680) |

Listens to `chrome.storage.onChanged` to apply mode changes in real time when the operator
updates the setting without restarting.

### Display mode storage

Key: `displayMode` in `chrome.storage.local`.  
Values: `sidePanel` | `popup` | `window`.  
Default: `sidePanel`.

The settings form (`Onboarding.tsx`) saves the mode immediately on radio-button change — not
deferred to form submit — so the background service worker picks it up without requiring
a settings-save action.

---

## Data Types (`src/types/store.ts`)

Plain TypeScript mirror of the Engine's Automerge document types. No branded types — the Console
reads and displays data; strict type safety at the Engine is sufficient. **Keep in sync with
`agent-engine-dev/src/data/*.ts`.**

```
Store {
  engineDB:  Record<EngineID,   Engine>
  diskDB:    Record<DiskID,     Disk>
  appDB:     Record<AppID,      App>
  instanceDB: Record<InstanceID, Instance>
}
```

Engine online status is derived from `engine.lastRun`: an engine is considered online if
`lastRun` is within the last 2 minutes (matches Engine's heartbeat interval).

---

## Demo / Mock Mode

`createMockConnection()` (`src/mock/mockStore.ts`) returns a `StoreConnection` backed by an
in-memory store snapshot: 2 engines, 3 disks (Kolibri, Nextcloud, Wikipedia), 5 instances
in varied states (Running, Stopped, Error, Docked).

Demo mode activates when:
- `demoMode` is `true` in `chrome.storage.local` / `localStorage`, **or**
- No engine hostname is configured (default-on, so the UI is usable without a running Engine).

When active:
- A yellow **DEMO** badge appears in the status bar.
- `createEngineConnection` is never imported (no WebSocket attempt, no Automerge loaded).
- Commands are logged to the console and written into the in-memory store (for testability).

---

## Build System

| Tool | Role |
|---|---|
| Vite | Dev server + production bundler |
| pnpm | Package manager |
| Vitest + Testing Library | Unit tests (81 tests) |
| TypeScript strict | Type checking |

Key Vite config choices:
- `cacheDir: '/tmp/idea-console-vite-cache'` — avoids `node_modules/.vite/` ownership
  conflicts between sandbox (root) and Pi (`pi` user).
- `server.allowedHosts: true` — permits the Tailscale hostname in dev mode.
- `build.outDir: 'dist'` — Chrome Extension loads from here after `pnpm build`.

`pnpm package` script: builds, zips `dist/` to `/tmp/idea-console-pkg/extension.zip`, and
serves on port 8080 for download from the Pi.

---

## Engine API Contract

The Console depends on two Engine interfaces:

### 1. Automerge WebSocket sync

- **URL:** `ws://<hostname>:4321`
- **Protocol:** Automerge repo sync — the Engine is the server; Console connects as a client.
- **Store URL format:** Automerge document URL (e.g. `automerge:<hash>`)
- The Console calls `repo.find(storeUrl)` and receives incremental updates via `handle.on('change')`.

### 2. Command write-back

Commands are sent by mutating `engine.commands[]` in the shared Automerge document:

```ts
handle.change((doc) => {
  doc.engineDB[engineId].commands.push(command);
});
```

The Engine processes these strings via its command loop. Format: `"<commandName> <arg1> <arg2>"`.

### 3. Store URL discovery (pending Engine implementation)

- **Endpoint:** `GET /api/store-url` on Engine HTTP port 80
- **Response:** `{ "url": "automerge:<hash>" }`
- Without this endpoint, operators must enter the store URL manually in the settings screen.
