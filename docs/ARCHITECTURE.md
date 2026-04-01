# Console Architecture

The IDEA Console is the primary user interface for IDEA's offline school computers. It serves
two audiences in a single application:

- **Users** (students, teachers) — browse available apps and open them with one click. No login
  required. This is the default experience.
- **Operators** (authenticated users) — manage the system: start/stop instances, eject disks,
  monitor engine health. Operators log in from within the Console, elevating their session.

It is built with Solid.js and TypeScript and ships as a Chrome Extension (Manifest V3) with
an optional production web-app mode served directly from an Engine.

---

## Deployment Contexts

The Console runs in three contexts detected at runtime:

| Context | How it starts | Hostname source | Store URL source |
|---|---|---|---|
| **Chrome Extension** | Toolbar icon click | Settings screen → `chrome.storage.local` | Auto-fetch from `GET /api/store-url` or manual entry |
| **Dev (Tailscale)** | `pnpm dev` → Vite dev server | Settings screen → `localStorage` | `VITE_STORE_URL` env var or manual entry |
| **Production web** | Engine HTTP server serves `dist/` on configurable port | `window.location.hostname` | `GET /api/store-url` on same origin |

Context detection (`src/store/engine.ts`):

```ts
export function isProductionWebMode(): boolean {
  if (import.meta.env.DEV) return false;
  if (isExtensionContext()) return false;
  const h = window.location.hostname;
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1' && !h.startsWith('100.');
}
```

### Production web deployment

The Engine serves Console `dist/` via `httpMonitor.ts`. Two `config.yaml` settings control it:

```yaml
settings:
  httpPort: 80          # or 8080 if not running with cap_net_bind_service
  consolePath: /home/pi/idea/agents/agent-console-dev/dist
```

`consolePath` is empty by default — the Console is not served until explicitly configured.
This keeps Engine and Console deployable independently. `GET /api/store-url` is always
available on the HTTP server regardless of whether `consolePath` is set.

---

## Dual-Mode UI

### User Mode (default — unauthenticated)

The Console opens in user mode when no operator session is active.

- App browser: grid of all instances across the network
- Running instances: **Open** button navigates to `http://<engine-hostname>:<port>`
- Stopped instances: card shown greyed out with "Not available"
- Small **Log in** link in the status bar

### Operator Mode (after login)

When an operator authenticates, the Console switches to operator mode reactively — no reload.

- Full management UI: NetworkTree (left) + InstanceList (right) with start/stop/eject actions
- Operator management panel: add/remove operators, change own password
- Username + **Log out** button in the status bar

### First-time Setup

When `userDB` is empty (fresh install or demo mode before any operator is created), the Console
shows a setup screen instead of the login form. Any user can create the initial admin account.
Once the first operator exists, this screen is never shown again.

---

## Component Structure

```
src/
├── App.tsx                      Root component — connection lifecycle, mode routing
├── main.tsx                     Solid.js mount point
├── components/
│   ├── Onboarding.tsx           Settings form — hostname, store URL, demo mode, display mode
│   ├── AppBrowser.tsx           User mode — grid of app cards
│   ├── AppCard.tsx              Single app card (running / greyed-out stopped)
│   ├── LoginForm.tsx            Operator login modal overlay
│   ├── FirstTimeSetup.tsx       Initial admin account creation screen
│   ├── OperatorManagement.tsx   Add/remove operators, change own password
│   ├── NetworkTree.tsx          Operator mode — engine/disk tree with selection state
│   ├── InstanceList.tsx         Operator mode — instances filtered by selection
│   ├── InstanceRow.tsx          Single instance row with start/stop/eject actions
│   └── StatusDot.tsx            Coloured status indicator (Running / Stopped / Error / …)
├── store/
│   ├── engine.ts                Real Automerge WebSocket connection
│   ├── signals.ts               Solid.js reactive accessors derived from the store
│   ├── commands.ts              Command builders and dispatcher
│   └── auth.ts                  Client-side authentication and operator management
├── mock/
│   └── mockStore.ts             In-memory mock store + StoreConnection interface
├── background/
│   └── background.ts            Chrome Extension service worker — display mode control
├── types/
│   └── store.ts                 TypeScript mirror of Engine data types
└── styles/
    └── main.css                 All styles (no external CSS frameworks)
```

### App.tsx — root lifecycle and mode routing

`App` owns the connection lifecycle and routes between UI modes:

```
onMount:
  read storage (hostname, demoMode)
  initConnection() → createMockConnection() or createEngineConnection()
  restoreSession(store) → set currentUser if stored session is still valid

Render:
  shouldShowOnboarding?   → <Onboarding />
  isFirstTimeSetup?       → <FirstTimeSetup />
  isOperator()?           → <OperatorLayout /> (NetworkTree + InstanceList + OperatorManagement)
  else                    → <AppBrowser />    (user mode — no login required)
```

Mode switching is fully reactive — login/logout updates a Solid.js signal and the UI follows
immediately without a page reload.

---

## Store Layer

### `StoreConnection` interface (`src/mock/mockStore.ts`)

Both the real and mock connections satisfy the same interface:

```ts
interface StoreConnection {
  store:      Accessor<Store | null>;              // reactive — updates on every Automerge change
  connected:  Accessor<boolean>;
  sendCommand: (engineId: string, command: string) => void;
  changeDoc:   (fn: (doc: Store) => void) => void; // general-purpose Store mutation
}
```

`changeDoc` is used by `auth.ts` to write operator accounts to `userDB`.

### `src/store/signals.ts` — reactive accessors

Module-level Solid.js signals derived from the `Store`. Components import these directly — no
prop-drilling for network state.

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
- Exports dispatching functions (`startInstance`, `stopInstance`, `ejectDisk`).

Command string format: `"<commandName> <arg1> <arg2>"` — mirrors Engine's `commandUtils.ts`.

### `src/store/auth.ts` — client-side authentication

All authentication and operator management is local — no API calls, no server sessions.
`userDB` in the Automerge Store contains bcrypt-hashed passwords. The Console authenticates
by comparing client-side using `bcryptjs` (pure JavaScript).

Key exports:

| Export | Purpose |
|---|---|
| `currentUser` | Solid.js signal — `User \| null` |
| `isOperator()` | Derived: `currentUser() !== null` |
| `isFirstTimeSetup(store)` | `true` when `userDB` is empty |
| `login(username, password, store)` | bcrypt compare → set signal + persist session |
| `logout()` | Clear signal + stored session |
| `restoreSession(store)` | Validate stored session against `userDB` on mount |
| `createOperator(username, password, store, changeDoc)` | Hash + write to `userDB` |
| `removeOperator(userId, changeDoc)` | Delete from `userDB` |
| `changePassword(userId, currentPw, newPw, store, changeDoc)` | Re-validate + re-hash + write |

Session persistence: `operatorSession: { userId, username }` in `chrome.storage.local` /
`localStorage`. Restored on page load by cross-checking `userId` against the live `userDB`.

### `src/store/engine.ts` — real connection

`createEngineConnection()` resolves the hostname and store URL, then:

1. Creates an Automerge `Repo` with a `BrowserWebSocketClientAdapter` connecting to
   `ws://<hostname>:4321`.
2. Calls `repo.find(storeUrl)` to get a document handle.
3. Listens to `handle.on('change')` to update the reactive `store` signal on every sync.
4. Returns a `StoreConnection` with `sendCommand` and `changeDoc` both implemented as
   `handle.change()` mutations.

Store URL discovery order:
1. `VITE_STORE_URL` env var (dev only)
2. `storeUrl` key in `chrome.storage.local` / `localStorage`
3. Auto-fetch from `GET /api/store-url` on the Engine

---

## Chrome Extension (Manifest V3)

### Permissions

```json
"permissions": ["storage", "tabs", "sidePanel", "windows"]
```

### Background service worker (`src/background/background.ts`)

Reads `displayMode` from `chrome.storage.local` and configures Chrome:

| Mode | Mechanism |
|---|---|
| `sidePanel` (default) | `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` — native, no service worker dormancy issue |
| `popup` | `action.setPopup({ popup: 'index.html' })` |
| `window` | `action.onClicked` handler calls `windows.create()` (960×680) |

Listens to `chrome.storage.onChanged` to apply mode changes in real time.

### Display mode storage

Key: `displayMode` in `chrome.storage.local`. Values: `sidePanel` | `popup` | `window`.
Default: `sidePanel`. Saved immediately on radio-button change (not deferred to form submit).

---

## Data Types (`src/types/store.ts`)

Plain TypeScript mirror of the Engine's Automerge document types. No branded types — the Console
reads and displays data; strict type safety at the Engine is sufficient. **Keep in sync with
`agent-engine-dev/src/data/*.ts`.**

```
Store {
  engineDB:   Record<EngineID,   Engine>
  diskDB:     Record<DiskID,     Disk>
  appDB:      Record<AppID,      App>
  instanceDB: Record<InstanceID, Instance>
  userDB:     Record<UserID,     User>
}

User {
  id:           UserID
  username:     string
  passwordHash: string    // bcrypt hash — never plaintext
  role:         'operator'
  created:      Timestamp
}
```

Engine online status: `engine.lastRun` within the last 2 minutes (matches Engine heartbeat).

---

## Demo / Mock Mode

`createMockConnection()` (`src/mock/mockStore.ts`) returns a `StoreConnection` backed by an
in-memory store: 2 engines, 3 disks (Kolibri, Nextcloud, Wikipedia), 5 instances in varied
states (Running, Stopped, Error, Docked). `userDB` starts empty.

Demo mode activates when:
- `demoMode` is `true` in `chrome.storage.local` / `localStorage`, **or**
- No engine hostname is configured (default-on so the UI works without a running Engine)

When active:
- A yellow **DEMO** badge appears in the status bar.
- `createEngineConnection` is never imported (no WebSocket attempt, no Automerge loaded).
- `changeDoc` mutations (operator creation) apply to the in-memory store and are persisted
  to `localStorage` under `ideaConsole_demoUserDB` — operators survive page reloads.
- First-time setup screen shows on first launch until an operator is created.

---

## Build System

| Tool | Role |
|---|---|
| Vite | Dev server + production bundler |
| pnpm | Package manager |
| Vitest + Testing Library | Unit tests (111 tests) |
| TypeScript strict | Type checking |
| bcryptjs | Client-side bcrypt (pure JS — no native bindings) |

Key Vite config:
- `cacheDir: '/tmp/idea-console-vite-cache'` — avoids ownership conflicts on Pi
- `server.allowedHosts: true` — permits Tailscale hostname in dev mode
- `build.outDir: 'dist'` — Chrome Extension loads from here; also served by Engine HTTP server

`pnpm package`: builds, zips `dist/` to `/tmp/idea-console-pkg/extension.zip`, serves on
port 8080 for download from the Pi.

---

## Engine API Contract

### 1. Automerge WebSocket sync

- **URL:** `ws://<hostname>:4321`
- **Protocol:** Automerge repo sync — Engine is server, Console connects as client.
- The Console calls `repo.find(storeUrl)` and receives live updates via `handle.on('change')`.

### 2. Store mutations via `handle.change()`

Both commands and user management write to the shared Automerge document:

```ts
// Instance command
handle.change((doc) => {
  doc.engineDB[engineId].commands.push(command);
});

// Operator creation
handle.change((doc) => {
  doc.userDB[newUser.id] = newUser;
});
```

The Engine processes command strings via its command loop. Format: `"<commandName> <arg1>"`.
User mutations replicate to all peers via Automerge sync.

### 3. Store URL discovery

- **Endpoint:** `GET /api/store-url` on Engine HTTP server (port configurable, default 80)
- **Response:** `{ "url": "automerge:<hash>" }`
- Returns 503 if the store is not yet initialised.
- CORS header included for dev-mode cross-origin requests.
- Implemented in Engine `httpMonitor.ts` (PR #26 / PR #28 merged).

### 4. Console static file serving

The Engine's `httpMonitor.ts` serves Console `dist/` as a single-page app when `consolePath`
is configured in `config.yaml`. Falls back to `index.html` for all unmatched routes (SPA
client-side routing). When `consolePath` is empty, only `/api/store-url` is served.
