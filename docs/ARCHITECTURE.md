# Console Architecture

The IDEA Console is the primary user interface for IDEA's offline school computers. It serves
two audiences in a single application:

- **Users** (students, teachers) — browse available apps and open them with one click. No login
  required. This is the default experience.
- **Operators** (authenticated users) — manage the system: start/stop/back up/update apps, manage
  disks and backups, flash classroom computer cards, monitor Engine health. Operators log in from
  within the Console (👤 Account), elevating their session.

It is built with Solid.js and TypeScript and ships as a static web app that the Engine serves
(production web mode, the normal case on every Pi and kit). The Chrome Extension (Manifest V3)
build is legacy: it still builds, but gets no new logic.

---

## Deployment Contexts

The Console runs in three contexts detected at runtime:

| Context | How it starts | Hostname source | Store URL source |
|---|---|---|---|
| **Production web** (normal) | Engine HTTP server serves `dist/` on its `httpPort` (80 on kits; pool Pis and production `idea` use other ports) | `window.location.hostname` (+ `window.location.port`) | `GET /api/store-url` on same origin |
| **Dev (Tailscale)** | `pnpm dev` → Vite dev server on port 5173 | Connection Management → `localStorage` | `VITE_STORE_URL` env var or `GET /api/store-url` |
| **Chrome Extension** (legacy) | Toolbar icon click | Connection Management → `chrome.storage.local` | Auto-fetch from `GET /api/store-url` or manual entry |

Context detection (`src/store/engine.ts`):

```ts
export function isProductionWebMode(): boolean {
  if (import.meta.env.DEV) return false;
  if (isExtensionContext()) return false;
  const h = window.location.hostname;
  // Any non-empty host counts, including Tailscale IPs (100.x) and fleet hostnames
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1';
}
```

### Production web deployment

The Engine serves Console `dist/` via `httpMonitor.ts`. Two `config.yaml` settings control it:

```yaml
settings:
  httpPort: 80          # or 8080 if not running with cap_net_bind_service
  consolePath: /home/pi/idea/agents/agent-console-dev/dist
```

The Engine's default `config.yaml` sets `consolePath` to the nested Console checkout's build
output, `/home/pi/idea/agents/agent-console-dev/dist`, so a Pi using the standard checkout layout
serves the Console as soon as `pnpm build` has produced `dist/`. The Engine checks the folder once
at startup: if it is missing, it logs `consolePath "…" not found — Console UI will not be served`
and carries on (non-API routes return 404 "Console UI not configured on this Engine"). Restart the
Engine after the first build so it picks up `dist/`. Setting `consolePath` to an empty string
disables Console serving explicitly. This keeps Engine and Console deployable independently.
`GET /api/store-url` is always available on the HTTP server regardless of whether the Console is
being served.

---

## Dual-Mode UI

### Status bar (always shown)

The top bar shows **IDEA Console v\<version\>**, a connection dot with the connected Engine's
name (`connectionIndicator.ts`), a yellow **PREVIEW** badge in preview mode, the signed-in
operator's username, and four icon buttons (each toggles its panel; ✕ closes it):

| Button | Panel | Notes |
|---|---|---|
| 🔌 | Connection Management (`ConnectionManagement.tsx`) | Hidden in preview mode. Scan results, Engines from the store, manual `host[:port]` entry |
| 👤 | Account (`AccountScreen.tsx`) | Signed out: **Operator Login** form (username, password with show/hide eye, **Log in**). Signed in: name, role **Operator**, **Change Password**, **Manage Operators** (`OperatorManagement.tsx`), **Log out** |
| 📋 | Command History (`HistoryPanel.tsx`) | Recent commands from the Engine's CommandLog with ✓ / ✗ / ℹ and "Ns/m/h ago" |
| ⚙ | Settings (`SettingsPanel.tsx`) | Tabs: **Engine Connection** (connected Engine, change Engine, preview mode), **Account** (operators only: change password), **Demo apps** (operators only, when an Engine supports demo apps), **About** |

There is no separate "Log in" link: login lives in the 👤 Account panel.

### User Mode (default — unauthenticated)

The Console opens in user mode when no operator session is active (`AppBrowser.tsx`, heading
**Apps**, `data-testid="console-overview"`).

- One card per instance across the network (`AppCard.tsx`): the instance's display name, the App
  title, a short description, **on \<engine\>**, a **DEMO** badge for demo apps, and an **Open**
  button that opens `http://<host>:<port>` in a new tab (`appUrl.ts`).
- Stopped instances: card greyed out with **Not available**.
- An instance on an Engine that is offline (or still connecting) keeps its card, but **Open** is
  disabled with "\<engine\> is offline, so this app can't be opened right now." (or "Connecting to
  \<engine\>…") (`offlineAppHint` / `connectingAppHint`, console#175 / #191).
- Cards listed in the served `dist/hidden-instances.json` are left out (idea#212, see AGENTS.md).

### Operator Mode (after login)

When an operator authenticates, the Console switches to operator mode reactively — no reload.

- **Desktop** (`data-testid="op-overview"`): `NetworkTree` on the left (**Network**, **All apps**,
  each Engine with liveness dot and ↺ Reboot, its disks with role badges and eject, unformatted
  candidates, USB sticks) and the right pane: `CopyMoveFeedback`, `OperationProgress`
  (**Operations** cards), then `InstanceList` (All apps / an Engine), `DiskView`,
  `EmptyDiskPanel` or `UnformattedDiskView` for the selection. An Engine selection also shows
  **Client cards** (`ClientCardsSection`, card readers + Flash) and the Engine's temporary
  pre-update backups (`TempBackupsSection`). Drag an app onto a disk to Copy or Move it
  (`CopyMoveModal`).
- **Mobile**: when an operator is signed in **and** `window.innerWidth <= 600`, `MobileLayout`
  replaces the desktop layout, with the tabs **Apps** (`MobileAppList`), **Network**,
  **Activity** and **History**; copy/move uses a bottom sheet (`MobileCopyMoveSheet`). Signed
  out, every width gets the AppBrowser card grid.
- Per app row (`InstanceRow`): status dot (click for details), rename (with the `renameInstance`
  capability), **Start**, **Stop**, **Back up** (when a Backup Disk links the app), **Update**
  (with the `updateApp` capability and an offered update), **Open ↗**, and in the expanded
  details **Remove** (with the `removeInstance` capability).

### First-time Setup

When `userDB` is empty and nobody is signed in, the Console shows **Welcome to IDEA Console**
(`FirstTimeSetup.tsx`) instead of the main view: any user can create the initial operator
account (username, password, confirm; at least 8 characters). Once the first operator exists,
this screen is never shown again.

---

## Component Structure

```
src/
├── App.tsx                      Root component — connection lifecycle, status bar, mode routing
├── main.tsx                     Solid.js mount point
├── components/
│   ├── ConnectionManagement.tsx 🔌 panel and onboarding: scanning, Engine picker, manual host[:port]
│   ├── SettingsPanel.tsx        ⚙ panel: Engine Connection, Account, Demo apps, About
│   ├── AccountScreen.tsx        👤 panel: Operator Login form, or account + Manage Operators + Log out
│   ├── OperatorManagement.tsx   Add/remove operators, change own password
│   ├── FirstTimeSetup.tsx       Initial operator account creation screen
│   ├── HistoryPanel.tsx         📋 Command History (desktop panel and mobile History tab)
│   ├── AppBrowser.tsx           User mode — grid of app cards
│   ├── AppCard.tsx              Single app card (running / Not available / offline / connecting, DEMO badge)
│   ├── NetworkTree.tsx          Operator mode — Engine/disk tree with selection, eject, reboot
│   ├── UsbStickRow.tsx          Read-only USB stick row under its Engine (idea#193)
│   ├── InstanceList.tsx         Operator mode — instances filtered by selection
│   ├── InstanceRow.tsx          One app row: start/stop/backup/update/open, details, op failure line
│   ├── RenameInstanceName.tsx   Inline rename of the display name (renameInstance capability)
│   ├── RemoveInstanceControl.tsx Remove app from its disk (removeInstance capability, idea#347)
│   ├── UpdateAppControl.tsx     updateApp badge, confirm, steps and result (console#168)
│   ├── StepProgressBar.tsx      Segmented step bar for operations with steps
│   ├── LogLines.tsx             Engine log lines (ANSI stripped)
│   ├── TechnicalDetails.tsx     Plain sentence + closed "Technical details" toggle (idea#76)
│   ├── CommandFeedback.tsx      The Engine's answer to a command a panel sent
│   ├── OperationProgress.tsx    Operations cards from operationDB (Pending / Running / Failed, Cancel, ✕)
│   ├── CopyMoveModal.tsx        Copy or Move? dialog after dropping an app on a disk
│   ├── CopyMoveFeedback.tsx     Copy/move result and cross-Engine Move steps (idea#498)
│   ├── CrossMoveStatus.tsx      Steps of a cross-Engine Move (idea#79)
│   ├── DiskView.tsx             Right pane for a disk: role badges, one section per role, Add Files
│   ├── EmptyDiskPanel.tsx       Empty disk: Make this a Files Disk / Make this a Backup Disk / Install App
│   ├── RestorePanel.tsx         Backups section (restore from a Backup Disk; idea#400 controls, idea#404 status lines)
│   ├── BackupModeControls.tsx   setBackupMode: mode + daily time, gated on scheduledBackups (idea#400)
│   ├── BackupStatusLines.tsx    Schedule, last run, missed runs, clock, full/cleaning, interrupted
│   ├── BackupSizingLine.tsx     How much App data this Pi holds (engine#441)
│   ├── TempBackupsSection.tsx   Per Engine: own disk space and temporary pre-update backups (console#230)
│   ├── DemoAppsSection.tsx      Settings → Demo apps: setupDemo / removeDemo and progress, operators only (idea#235)
│   ├── ClientCardsSection.tsx   Per Engine: card readers, client image, Flash…, Initialise (idea#201)
│   ├── FlashDialog.tsx          Flash client card: pick → confirm → steps → "Done – safe to remove"
│   ├── FilesSection.tsx         Files section: share name, size, "available in", Not mounted, Eject
│   ├── FilesRoleForm.tsx        Share name field + createFilesDisk result (Make this a Files Disk / Add Files)
│   ├── RoleBadges.tsx           One badge per disk role, fixed order app, backup, files
│   ├── EjectConfirm.tsx         Eject confirmation for combined disks: roles + everything affected
│   ├── EraseDialog.tsx          summariseDisk → typed label → eraseDisk (and Files erase-first)
│   ├── UnformattedDiskView.tsx  Right pane for Engine.unformattedDisks candidates
│   ├── MobileLayout.tsx         Signed-in phone layout: Apps / Network / Activity / History tabs
│   ├── MobileAppList.tsx        Mobile Apps tab
│   ├── MobileCopyMoveSheet.tsx  Mobile ⋯ bottom sheet for Copy / Move
│   ├── StatusDot.tsx            Coloured status indicator (Running / Stopped / Error / …)
│   ├── LoginForm.tsx            Legacy login modal; not rendered (login is in AccountScreen)
│   └── CommandHistory.tsx       Legacy history list; not rendered (HistoryPanel replaced it)
├── store/                       Connection, signals, commands, auth and per-feature wording/logic
│   ├── engine.ts                Real Automerge WebSocket connection
│   ├── commandLog.ts            CommandLog doc via /api/command-log-url (daily rotation, idea#183)
│   ├── signals.ts               Pure helper functions for deriving data from a Store snapshot
│   ├── commands.ts              Command builders and dispatcher, per-Engine capability helpers
│   ├── commandResult.ts         Wait for a command's result (new trace ID + args, store confirmation)
│   ├── traceInstance.ts         Which trace arg names the instance + the sent-name second match (engine#399)
│   ├── discovery.ts             Engine discovery — probes the page host and Engines used before
│   ├── prodFailover.ts          Served from an Engine: reconnect, or open another live Engine's Console (idea#203)
│   ├── appUrl.ts                App link construction, offline / connecting hints
│   ├── auth.ts                  Client-side authentication and operator management
│   ├── diskRoles.ts             Role badges, canEject, Add Files, "available in", low space, right pane
│   ├── setBackupMode.ts, backupStatus.ts, backupSizing.ts, backupDiskSizeGate.ts   Backup Disk logic and wording
│   ├── moveApp.ts, moveChecking.ts, parkedMove.ts, dragCopyMove.ts                 Copy / Move
│   ├── updateApp.ts, tempBackups.ts, removeInstance.ts, renameInstance.ts           App lifecycle
│   ├── clientCards.ts, usbSticks.ts, erase.ts, demoApps.ts                          Cards, sticks, erase, demo apps
│   └── …                        One module per concern (see the file header of each)
├── mock/
│   ├── mockStore.ts             In-memory mock store + StoreConnection interface
│   ├── filesFixtures.ts         Files Disk fixtures: every Files state and combined disks
│   └── eraseFixtures.ts         Erase fixtures
├── background/
│   └── background.ts            Legacy Chrome Extension service worker — display mode control
├── workers/
│   └── bcrypt.worker.ts         bcrypt compare off the main thread
├── types/
│   ├── store.ts                 TypeScript mirror of Engine data types
│   ├── commandLog.ts            CommandLog trace types
│   └── drag.ts                  Drag payload types
└── styles/
    └── main.css                 All styles (no external CSS frameworks)
```

### App.tsx — root lifecycle and mode routing

`App` owns the connection lifecycle and routes between UI modes:

```
onMount:
  production web mode (served by an Engine)?
    → hostname = window.location.hostname; initConnection() at once
      (an Engine picked in Connection Management overrides the page host, issue #150)
  else (dev / legacy extension):
    read stored hostname + previewMode
    if preview or hostname known → initConnection()
    else → runDiscovery() — probe the page host and Engines used before
      1 found          → auto-connect (saveHostnameAndStoreUrl + initConnection)
      0 or 2+ found, or nothing after 5 s → show Connection Management (re-probes every 10 s)
  initConnection() → createMockConnection() (preview) or createEngineConnection() (real)
  restoreSession(store) → remove any stored session entry; the Console starts in user mode

Not connected:
  dev / extension: 15 s without first data, or 15 s disconnected → back to discovery
  production web: prodFailover — reconnect when the page host answers again, else open another
                  live Engine's Console (idea#203)

Render (status bar, then exactly one of):
  🔌 open or onboarding needed → <ConnectionManagement />
  ⚙ open                       → <SettingsPanel />
  👤 open                       → <AccountScreen />
  📋 open                       → <HistoryPanel />
  isFirstTimeSetup?            → <FirstTimeSetup />
  isOperator()?                → desktop main layout, or <MobileLayout /> at ≤ 600 px
  else                         → <AppBrowser />    (user mode — no login required)
```

Mode switching is fully reactive — login/logout updates a Solid.js signal and the UI follows
immediately without a page reload.

---

## Store Layer

### `StoreConnection` interface (`src/mock/mockStore.ts`)

Both the real and mock connections satisfy the same interface:

```ts
interface StoreConnection {
  store:           Accessor<Store | null>;              // reactive — updates on every Automerge change
  connected:       Accessor<boolean>;
  socketState?:    Accessor<SocketState>;               // store socket liveness (socketLiveness.ts); absent = 'live'
  sendCommand:     (engineId: string, command: string) => void;
  changeDoc:       (fn: (doc: Store) => void) => void;  // general-purpose Store mutation
  commandLogStore: Accessor<CommandLogState>;           // the Engine's CommandLog doc (commandLog.ts)
  dispose?:        () => void;                          // tear down sockets and timers
  hostname?:       string;                              // host the Console connected to (connectedEngine.ts)
  commandLogFor?:  (hostname: string) => Accessor<CommandLogState> | null; // another Engine's CommandLog
}
```

`changeDoc` is used by `auth.ts` to write operator accounts to `userDB`. `commandLogStore` is
loaded from `GET /api/command-log-url` and re-read every 60 s to follow the Engine's daily
CommandLog rotation (idea#183); command results, History and operation logs read it.

### `src/store/signals.ts` — pure store helpers

Pure functions that derive data from a `Store` snapshot. No global reactive state — components
receive the store as a prop (`Accessor<Store|null>`) and call these inside their own reactive
closures. This enables fine-grained reactivity: Solid.js tracks reads at the field level and
only re-renders the DOM nodes that actually changed.

Key exports:

| Export | Returns |
|---|---|
| `engineLiveness(engine)` / `isEngineOnline(engine)` | `connecting` / `online` / `offline` (see live.ts); `isEngineOnline` is true only when online |
| `getEngineTree(store)` | `EngineTreeNode[]` for rendering the network tree |
| `getInstancesForEngine(store, engineId)` | `Instance[]` for one engine |
| `getInstancesForSelection(store, sel)` | `Instance[]` filtered by network / engine / disk |
| `getInstanceIdsForSelection(store, sel)` | `string[]` — ID-keyed variant for `<For>` loops |

**Fine-grained reactivity pattern** (design 005): Components iterate over ID lists rather than
object snapshots. `<For each={instanceIds()}>` reuses Solid.js scopes for unchanged IDs — only
rows whose data actually changed re-render. Props passed to row components are accessor functions
(`() => store()?.instanceDB[id]`) so Solid tracks reads surgically.

### `src/store/commands.ts` — command dispatcher

The Engine processes commands by reading strings appended to `engine.commands[]` in the
Automerge document. The commands module:

- Holds a module-level `sendCommand` function set by `App.tsx` after connection.
- Exports typed command builders (`buildStartInstanceCommand`, etc.) as pure functions.
- Exports dispatching functions: `startInstance`, `stopInstance`, `ejectDisk`, `rebootEngine`,
  `cancelOperation`, `backupApp`, `restoreApp`, `createBackupDisk`, `setBackupMode`,
  `createFilesDisk`, `summariseDisk`, `eraseDisk`, `copyApp`, `moveApp`, `installApp`,
  `renameInstance`, `removeInstance`, `deleteTempBackup`, `setupDemo`, `removeDemo`, and
  `sendRawCommand` (used by updateApp). `clientCards.ts` sends `initialiseDisk`, `flashCard` and
  `cancelFlash` through the same dispatcher (`getSendCommandFn`).
- Exports `engineHasCapability` (fresh `Engine.capabilities` flags) so newer actions are
  greyed out or hidden on older Engines.

Command string format: `"<commandName> <arg1> <arg2>"` — mirrors Engine's `commandUtils.ts`.

Argument contract (r30): disks always go by **id** (names may contain spaces / em-dashes,
which the Engine's space-split breaks). `backupApp` / `restoreApp` also send the **instance
id** (`backupApp <instanceId> <backupDiskId>`, `restoreApp <instanceId> <targetDiskId>`);
they need the Engine fix that resolves both id-first (`resolveInstanceArg` / `resolveDiskArg`,
idea#168). `startInstance` / `stopInstance` / `copyApp` / `moveApp` keep the instance
**name**, because no Engine resolves an instance id for them yet.

Cross-Engine `moveApp` keeps the instance id and name (engine#381, Engine 53f151d),
including its Backup Disk link. A plain `copyApp` still gets a fresh id. There is one
`instanceDB` row, and `move.targetInstanceId` equals `sourceInstanceId`. During Copying
and Checking, that row stays on the source disk. At the start of "Removing the old copy",
after verification and the source-changed checks, the Engine flips `storedOn` to the
target disk and clears the port and metrics. It then quarantines the source folder.
For move feedback, a matching new operation takes precedence over `storedOn` proof:
Pending or Running keeps waiting, Done confirms, and Failed or Cancelled fails. The
`storedOn` fallback confirms only when no matching new move operation is visible,
on desktop and mobile. `TARGET_EXISTS` is a refusal (trace `errorCode`, no operation):
the id is already stored on a disk of the target Engine, or its folder is already on
the target disk. The Console shows a plain sentence instead of the raw Engine error.

### Technical details (`TechnicalDetails.tsx`)

Debug views (expanded instance details, History panel, command history) show the
`plainEngineText` sentence first; the raw Engine text sits in a closed native
`<details>` "Technical details" toggle, left out when it is empty or equals the sentence (idea#76).

A `clearBackupLock` trace that closed `ok` with `result.cleared === false` (the
Engine refused to clear anything but did not throw; result shape `{ cleared, message }`,
agent-engine-dev#332) is shown on the collapsed History row as a neutral info line
with `result.message`, not a green check and not red (`historyRow.ts`, idea#454).
`clearBackupLock` is not wired through `commandResult`.

### Command feedback (`commandResult.ts`, `CommandFeedback.tsx`, `remoteConfirm.ts`)

Panels follow each command's trace in the connected Engine's command log: red
(`edp-form__error`, `role=alert`) on an error trace, a neutral "No response" hint after
15 s without any trace. Commands to **another** Engine (`connectedEngine.ts` decides; an
unknown connected Engine counts as remote) can't be followed in our own log, so they show
a neutral "Sent to <engine>, waiting for confirmation" and resolve:

1. from the target Engine's command log when the Console could load it (approach i,
   `StoreConnection.commandLogFor` / `remoteCommandLogs.ts`; red on its error trace), else
2. from the store change that proves the command worked (approach ii).

**Which trace is ours (instance commands, engine#399).** A trace is matched by a new
trace id plus one named arg (or, for a pre-execute refusal, a token of the positional
args array). For startInstance, stopInstance, backupApp, restoreApp, copyApp and moveApp
(desktop and mobile) the arg is chosen by `traceInstanceMatch` (`store/traceInstance.ts`),
asking the Engine the command goes to (the trace producer; for copy/move the source Engine):

- the Engine advertises a fresh `traceInstanceId` capability (agent-engine-dev#403):
  match `args.instanceId` against the instance id. That Engine writes the resolved id
  there (or the raw argument when it does not resolve) and the display name, or null,
  in `args.instanceName`, so two instances that share a name are told apart;
- otherwise (an older Engine): match `args.instanceName` against the value sent (the id
  for backup / restore, the name for start / stop / copy / move).

**Second match value (sent by name).** What the Console sends is unchanged: start, stop,
copy and move name the instance by NAME. For those `traceInstanceMatch` adds a
`TraceAltMatch` (`commandResult.ts`): the sent name, followed in the args by the
instance's disk (`diskId`, or the copy/move `sourceDiskId`). It also matches:

- (a) a name that did not resolve on a new Engine: `args.instanceId` = the raw name and
  `args.instanceName` null. A resolved trace (`instanceName` set) never matches the name,
  so an instance whose id equals our name is not taken for ours;
- (b) a refusal before execution (positional tokens). The Engine splits the unquoted line
  on single spaces, so a multi-word name arrives as several tokens; it matches as a
  contiguous run followed by the disk. startInstance's variadic `options` take the shifted
  rest of a multi-word name, so its named values are checked the same way, in order.
  A refusal holding only the name ("Insufficient arguments") matches on the name alone.

On an older Engine the name match itself also needs the disk to follow, so a namesake on
another disk (same Engine) is not ours. Not matched reliably: a name containing a double
quote (the Engine's quote handling regroups the tokens), and a name-only refusal from a
namesake (nothing in it tells them apart). backupApp / restoreApp send the id and have no
second value. The InstanceRow trace list (expanded steps) matches `args.instanceId` or
`args.instanceName`, or for a positional trace the first token of the first arg
(`traceIsForInstance`, console#227): updateApp's trace args are
`["<instance> <newAppId> [--allow-major] [--source <diskId>]"]` (one unnamed rest-of-line
arg, agent-engine-dev `src/data/Commands.ts:726`, `src/utils/commandUtils.ts:104,153`).
renameInstance, removeInstance and updateApp match the id anywhere
in the raw args (`matchMode: 'includes'`), which works with both shapes. The
OperationProgress log matches by command kind only.

| command | store confirmation (ok) | store failure (red) | timeout → red |
|---|---|---|---|
| startInstance | status changed to Running after the send, or a new startApp op Done | status → Error, new startApp op Failed | 5 min |
| stopInstance | status changed to Stopped / Docked after the send, or a new stopApp op Done | status → Error, new stopApp op Failed | 5 min |
| backupApp | new backupApp op Done, or lastBackup advanced | new op Failed / Cancelled | 30 min |
| restoreApp | new restoreApp op Done | new op Failed / Cancelled | 30 min |
| copyApp | new copyApp op Done, or a newly created instance (same app + name) on the target disk | new op Failed / Cancelled | 30 min |
| moveApp | new moveApp op Done, or storedOn changed to the target disk | new op Failed / Cancelled | 30 min |
| installApp | newly created instance of the app on the disk | — | 20 min |
| reboot | engine.lastBooted changed | — | 10 min |
| ejectDisk | disk gone / undocked / no device | — | 3 min |
| cancelOperation | op no longer Pending / Running | — | 3 min |
| createBackupDisk / createFilesDisk | disk gets the backup / files role | — | 10 min (default) |

"New" / "newly created" means created after the send, never a record that already
existed: the op / instance id was not in the store at send time (Engine ids are fresh
uuids, so no clock is needed), plus matching attributes (op kind, `args.instanceId`,
target / backup disk, cause `console-command` or `cross-engine-cmd`). Clock skew: an
Engine timestamp (`op.startedAt`, `instance.created`) is never compared with the
Console's clock (school Pis may have no RTC / NTP); as defence in depth it is only
compared with the same Engine's `lastRun` seen at send, minus 5 min slack.

### `src/store/discovery.ts` — engine hostname discovery

Sticker-name bootstrap (idea#184). Pis have free, unique two-word names (e.g. `brave-otter`)
printed on a sticker; there is no number scheme and no shared alias. A browser cannot browse
mDNS, so the Console never guesses names: it probes only the host the page was served from
(the operator opened `http://<sticker-name>.local:<port>`) plus Engines used before (history),
via `GET /api/store-url`. Once connected, every Engine is listed from the network database
(`enginesFromStore(store)` → `engineDB[*].hostname` as `<name>.local`). Used by `App.tsx` on
first load when no hostname is stored (dev / legacy extension; served from an Engine the Console
connects to its page host straight away):

- 1 result → auto-connect silently
- 0 or 2+ results, or no single result after 5 s → show Connection Management, which lists the
  results and the store's Engines and accepts a typed sticker name or `host[:port]`; while it is
  open the scan repeats every 10 s (`DISCOVERY_REFRESH_INTERVAL_MS`) and adds new Engines

### `src/store/appUrl.ts` — App link construction

Single helper used by `InstanceRow.tsx` (Open link) and `AppBrowser.tsx` (host passed to
`AppCard`) to build `http://<host>:<port>` for an App instance. `.local` names only resolve
via mDNS on the Engine's LAN, so the host depends on where the App runs (koenswings/idea#102):

| Case | Host used |
|---|---|
| Connected engine, production web mode | `window.location.hostname` (e.g. `idea02.local`, `idea02`, `100.x.y.z`; IPv6 bracketed) |
| Other engine on the LAN | `ensureLocal(hostname)` → `<hostname>.local` (IPs, `localhost` and `.local` names unchanged) |
| Dev / extension mode (`!isProductionWebMode()`) | `ensureLocal(hostname)` for every engine |

The connected engine is the one named by the page host, i.e. the host `App.tsx` connects to in
production web mode: its hostname matches the first DNS label of `window.location.hostname`
(case-insensitive). An IP page host carries no name, so it is attributed to an engine only
when the store holds exactly one engine; otherwise every engine keeps its `.local` link.

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
| `login(username, password, store)` | bcrypt compare (in `workers/bcrypt.worker.ts`) → set signal |
| `setAuthenticatedUser(user)` | Set the signal (used after first-time setup) |
| `logout()` | Clear signal + stored session |
| `restoreSession(store)` | On mount: remove the `operatorSession` entry earlier versions stored |
| `createOperator(username, password, store, changeDoc)` | Hash + write to `userDB` |
| `removeOperator(userId, changeDoc)` | Delete from `userDB` |
| `changePassword(userId, currentPw, newPw, store, changeDoc)` | Re-validate + re-hash + write |

Session lifetime: the operator session is the `currentUser` signal of the open page only. Nothing is
written to `chrome.storage.local` / `localStorage`, so a reload or a new Console window needs a new
sign-in. `restoreSession` and `logout` remove the `operatorSession` entry earlier versions stored.

### `src/store/engine.ts` — real connection

`createEngineConnection()` resolves the hostname and store URL, then:

1. Creates an Automerge `Repo` with a `BrowserWebSocketClientAdapter` connecting to
   `ws://<hostname>:<wsPort>`, where `wsPort` is advertised by `GET /api/store-url`
   (falls back to `4321` when absent).
2. Calls `repo.find(storeUrl)` to get a document handle.
3. Listens to `handle.on('change')` to update the reactive `store` signal on every sync.
4. Returns a `StoreConnection` with `sendCommand` and `changeDoc` both implemented as
   `handle.change()` mutations.

Store URL discovery order:
- Production web mode, or an Engine picked in Connection Management: `GET /api/store-url` on
  that Engine (retried when picked), then the saved `storeUrl` in `localStorage` as fallback.
- Dev / legacy extension: `VITE_STORE_URL` env var, then the saved `storeUrl` key in
  `chrome.storage.local` / `localStorage`, then `GET /api/store-url` on the Engine (always asked,
  for `wsPort`).

HTTP calls (`/api/store-url`, `/api/command-log-url`) go to `http://<hostname>[:<port>]`.
The port comes from a manual `host:port` entry in Connection Management (persisted as
`enginePort` next to `engineHostname`/`storeUrl`; absent = default port 80), or from
`window.location.port` in production web mode. See koenswings/idea#100.

---

## Chrome Extension (Manifest V3, legacy)

Legacy: it still builds (`background.js` entry) but gets no new logic, and is not how the
Console is deployed.

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
Default: `sidePanel`. The current UI has no display-mode control any more; `storage.ts` and
`background.ts` still read the key.

---

## Data Types (`src/types/store.ts`)

Plain TypeScript mirror of the Engine's Automerge document types. No branded types — the Console
reads and displays data; strict type safety at the Engine is sufficient. **Keep in sync with
`agent-engine-dev/src/data/*.ts`.**

```
Store {
  engineDB:    Record<EngineID,    Engine>
  diskDB:      Record<DiskID,      Disk>
  appDB:       Record<AppID,       App>
  instanceDB:  Record<InstanceID,  Instance>
  userDB:      Record<UserID,      User>
  operationDB: Record<OperationID, Operation>   // long-running ops (backup, restore, copy, move, update, flash, …)
}

Disk {
  id:           DiskID
  name:         string
  device:       string | null       // null = not physically inserted
  dockedTo:     EngineID | null
  diskTypes:    DiskType[]           // 'app' | 'backup' | 'empty' | 'upgrade' | 'files' | 'system'; several roles possible
  backupConfig: BackupConfig | null  // set on backup disks; null otherwise
                                        // backupConfig.schedule?: { daily: "02:30" } | null
                                        // backupConfig.scheduleError?: string | null — invalid schedule (Engine f114a28)
                                        // backupConfig.orphanLinks?: InstanceID[] — BACKUP.yaml links not in the store (Engine #356)
  filesConfig?:  { shareName; readOnly; passwordProtected; error } | null   // Files role (idea#131)
  unmountError?: { engineId; mountPoint; fsUuid; message } | null          // busy unmount (idea#126)
  sizeBytes?, freeBytes?: number | null                                    // docked disks (idea#131)
  backupStaleLocks?: { instanceId; startedAt; detectedAt }[] | null        // idea#446; Engine 71fc2c6 shape
  // idea#400 store summary — all optional, agreed names:
  freePct?, clockTrusted?, clockReason?, missedRuns?, cleaning?,
  cleaningStartedAt?, lastAttempt?
}

App.filesMount?:       { path; services[] } | null   // Files Disk opt-in (x-app.filesMount)
Instance.filesMounts?: DiskID[]                      // Files Disks mounted into the instance
Engine.capabilities?, Engine.capabilitiesBootedAt?   // per-Engine flags: 'diskIdArgs', 'filesDisk', 'eraseDisk',
                                                     // 'scheduledBackups' (Engine f114a28 / PR #353);
                                                     // 'backupCleanup' helper-gated like flashCard (Engine PR #354)
                                                     // 'traceInstanceId' (engine#399 / PR #403, see Command feedback)
Engine.unformattedDisks?  // non-ext4 whole disks { candidateId, device, sizeBytes, model, fsType, label }[]
Engine.eraseInProgress?   // { targetId, label, step } | null during eraseDisk
CommandTrace.result?      // JSON string; summariseDisk returns contentSummary
CommandTrace text fields  // args, result, errorMessage, error, logs[].message: plain string (old logs)
                          // or Automerge ImmutableString (engine#471 b); always read via logText /
                          // logJson in src/store/logText.ts (symbol check, not instanceof)

Instance {
  ...                               // standard fields
  status:     Status                // includes 'Missing' in addition to standard statuses
  lastBackup: Timestamp | null      // last successful backup; null = never backed up
  lastResult?, backupHistory?       // idea#400 summary, optional; lastResult.time is the result time
                                    // (no Instance.lastAttempt)
  backupMethod?                     // 'stop' | 'hook' | 'none' (idea#403, Engine PR #404); unset on older Engines
  dataBytes?, dataBytesAt?          // engine#430 / engine#441: App data size in bytes (whole MB of
                                    // 1,000,000 bytes) and Unix ms of that measurement; null/absent
                                    // when never measured; optional on older Engines
}

User {
  id:           UserID
  username:     string
  passwordHash: string    // bcrypt hash — never plaintext
  role:         'operator'
  created:      Timestamp
}
```

Engine liveness (`src/store/live.ts` `engineStatus`): `connecting` until a heartbeat has been observed or the connecting grace (`LIVE_CONNECTING_MS`, 15 s after the Console starts listening) has passed with a stale `lastRun`; `online` when a live heartbeat arrived within 30 s (Console clock), or — for old Engines that never send heartbeats — when stored `lastRun` is within 90 s; `offline` only once that status is known (heartbeat expired, or grace over and `lastRun` stale).


### Backup sizing line (engine#441)

`RestorePanel` (the Backup Disk section) and the "Make this a Backup Disk" form
on `EmptyDiskPanel` show a short line for how much App data this Pi holds, so
an operator can judge Backup Disk size. The copy comes from
`src/store/backupSizing.ts` (`deriveBackupSizing`): it sums
`Instance.dataBytes` over instances stored on disks whose `dockedTo` is this
Engine. Only non-null values are added; undocked disks and disks docked to
another Engine are excluded.

- No Apps on this Pi: "No Apps on this Pi yet"
- None measured: "This Pi's Apps haven't been measured yet"
- Some measured: "This Pi's Apps use about X GB (N Apps not measured yet)"
  (singular: "1 App not measured yet")
- All measured: "This Pi's Apps use about X GB"

Sizes use decimal GB (1 GB = 1,000,000,000 bytes, matching Engine DiskSize).
A total under 1 GB is "This Pi's Apps use less than 1 GB" (never "0 GB" or
"about"); the same phrasing is kept when some Apps are unmeasured. Under 10 GB
uses one decimal place; 10 GB and above are whole numbers. The line is not gated on
`scheduledBackups`. `dataBytesAt` is on the type but not shown.

### Backup Disk size gate (console#219)

Before the Console sends `createBackupDisk` (EmptyDiskPanel) or
`initialiseDisk … backup` (Client cards → Initialise), it checks the chosen
disk against the Engine's 8 GiB minimum and against 1.5× the measured App
data that disk will copy. The helper is `src/store/backupDiskSizeGate.ts`
(`assessBackupDiskSize`). The 8 GiB floor is `8 × 1024³` bytes, the same
constant as Engine `MAKE_BACKUP_DISK_MIN_BYTES`, and is compared with total
`Disk.sizeBytes` or the candidate's `sizeBytes`. The 1.5× rule uses the same
capacity on an empty or new disk; a later caller (console#211) can pass
`freeBytes` for a disk that already holds App or Files data.

- EmptyDiskPanel: the ticked Apps, excluding `backupMethod: 'none'`.
- Initialise as a Backup Disk: every instance on a disk docked to this Engine,
  excluding demos, instances stored on the target disk, and `backupMethod: 'none'`.

If the data is known and the disk is too small, the action is disabled and
the command is not sent. If `dataBytes` is unknown, or the disk's size is
unknown, the Console warns and does not block (unless the disk is already
under 8 GiB). When both rules fail, the App-data wording is used if 1.5× the
measured data is above 8 GiB; otherwise the 8 GiB wording.

Wording uses the same size phrases as the backup-sizing line
(`formatAppDataSize`: decimal GB, "less than 1 GB" without "about"). The
8 GiB floor reads "Too small: needs more than 8 GB. Choose a disk larger
than all the App data on this Pi." (a stick sold as "8 GB" is under 8 GiB).
The Client cards Backup Disk option also shows the backup-sizing line.

The Engine's `createBackupDisk` and `initialiseDisk … backup` do not themselves
enforce 8 GiB or a dataBytes check; this gate is Console-only until an Engine
follow-up exists.

### Backup Disk status lines (idea#404)

When the docked Engine advertises a fresh `scheduledBackups` capability (idea#400,
Engine main f114a28), `RestorePanel` and the instance row show store-summary status
lines: schedule and next run (computed from `schedule.daily`, or 02:30 when the
schedule is absent or invalid, and only while `clockTrusted` is true; if
`Disk.lastAttempt` is older than the most recent slot the Next run clause
is "A missed backup will start shortly.", and if there is no `lastAttempt`
yet it is "First backup will start shortly." — console#210; once
`lastAttempt` passes the slot the normal "Next run today/tomorrow at HH:MM"
returns),
`backupConfig.scheduleError` (plain wording; the disk still runs at 02:30 until
it is fixed), `backupConfig.orphanLinks` (Engine #356: a calm info line when
non-empty, nothing when missing or empty; no delete action), last attempt
(`Disk.lastAttempt` or `lastResult.time`) and result,
missed runs, clock not trusted (grey "Backup time unknown: this Pi's clock may be
wrong"), cleaning / Backup Disk full, a pre-run "This Pi needs an update before
backups can clean up old copies" when `scheduledBackups` is fresh but
`backupCleanup` is not (Engine PR #354; omitted when capabilities are stale or
`scheduledBackups` is missing), "Cleanup paused: Pi needs an update"
(`HELPER_OUTDATED` on a result, the runtime fallback; not shown again when the
pre-run warning already applies),
"App was briefly stopped" (`HOOK_FALLBACK`), "Done, with a warning"
(`HOOK_POST_WARNING`), "This App's disk isn't plugged in." (`APP_DISK_NOT_DOCKED`),
`FAILED` ("The backup did not finish."), and interrupted backups (including
`backupStaleLocks`). An `OK` result with method `stop` is a successful stop-method
backup, not a hook fallback. There is no `Instance.lastAttempt` and no `nextRun`
field. All new store fields are optional; with the flag absent the UI is unchanged.
Copy is plain language (no borg, YAML, helper, or result-code tokens). See
`src/store/backupStatus.ts`.

**Backup method `none` (idea#403, agent-engine-dev#404).** An App with
`x-app.backup.method: none` copies nothing and never gets `lastBackup`; each attempt
(including the pre-update backup) records `lastResult = {method: 'none', result: 'OK'}`.
`isBackupMethodNone(instance)` (`backupStatus.ts`) reads `Instance.backupMethod`
(`'stop' | 'hook' | 'none'`, agent-engine-dev#404; defaults to `'stop'`, unset on an
invalid spec or an older Engine/record) when it is set, so a fresh none App that has
never run a backup is covered, and `'stop'` / `'hook'` win over an older
`lastResult.method: 'none'` (the method changed). Only when `backupMethod` is unset does
it fall back to `lastResult.method === 'none'`. For such an instance:

- a major update needs no backup: `majorNeedsBackup(..., methodNone)` is false (the
  confirm has no "IDEA makes a backup first" line) and an Engine `NEEDS_BACKUP` refusal
  does not lock the badge (`UpdateAppControl`; the refusal's error line still shows);
- `RestorePanel` shows "Not backed up: its content is on the App Disk"
  (`METHOD_NONE_COPY`, once: the same status line is not repeated) instead of
  "Never backed up", and offers no target disk or Restore. A none instance that still
  has an older `lastBackup` (a real archive from before the method changed) keeps its
  date and Restore.

**Pre-update backup of a major update (idea#448, engine#469 / agent-engine-dev#472).** The
Engine makes the backup a major update needs itself: to a linked Backup Disk docked on the
same Engine, else a temporary backup on the Engine's own (system) disk, deleted after the
health gate and kept when the update fails. So the Console no longer blocks Update when
`lastBackup` is older than an hour: `majorNeedsBackup` only adds "IDEA makes a backup of
<App> first, so it takes a little longer." to the confirm. An older Engine that still
refuses `NEEDS_BACKUP` (nothing stopped) locks the badge with "Dock a Backup Disk and make a
backup first", as before. While the op's `stepLabel` starts with `Pre-update backup` or
`Temporary pre-update backup` and live progress is at most Snapshot, the step reads "Making
a backup first" (`currentStep` → `BACKUP_STEP`); without live progress (reload, another
Console) the step comes from `currentStep` / `totalSteps`, not the long Engine label. The
refusals `TEMP_BACKUP_NO_SPACE` (need = the backup plus, on the same disk, the snapshot),
`TEMP_BACKUP_FAILED` and `HELPER_OUTDATED` for the temporary backup have plain sentences
(`REFUSAL_TEXT`, naming the Engine the App runs on: `RefusalCtx.hostEngine`). They come
before the operation, so History shows the same sentence (`historyTempBackupText`) with the
raw text behind Technical details. The Ops card still shows the Engine's `stepLabel` and
error text.

**Stopped after a failed update restart (console#227, engine#442 / #445).** While the
instance is `Error` and its newest updateApp op is finished with `restartFailed: true` (or
the matching trace result says so), `restartFailedOpFor` holds and the Console shows, from
store state alone (so after a reload and in every Console): the agreed #217 sentence in
`update-outcome-<id>` (`data-kind="failed"`), the Update badge disabled with "Start <App>
again first, or ask for help", and Stop disabled ("Already stopped"). The Operations card
and the History row show the same sentence, with the raw `ROLLED BACK: …` text behind
Technical details. It clears once the instance leaves `Error`, a newer updateApp op exists
without the flag, or `lastStarted` is later than the op.

**Leftover temporary pre-update backup (console#230, engine#469 / agent-engine-dev#472).**
`leftoverTempBackupOf` reads the newest finished updateApp op's args: `tempBackupState`
`delete-failed` on a Done op (the Engine could not delete the backup after the health gate),
or `kept` on a Failed op (kept on purpose for a manual restore). `created`, `deleted`, no
state or a running op show nothing. Below the update outcome, from store state alone,
`update-leftover-backup-<id>` says (`leftoverTempBackupText`): "A backup made before the update
is still on <Engine>'s own disk and takes about X GB. Ask for help to remove it when you no
longer need it." (the size from the matching ok trace result `tempBackup.sizeBytes`;
without it "takes up space"), or for `kept`: "IDEA kept the backup it made before the update
on <Engine>'s own disk, in case <App> needs it. Ask for help before removing it." The path
and the Engine's `tempBackupWarning` are behind Technical details only, and the failed
outcome line drops the Engine's "; the temporary pre-update backup is kept at <path>"
clause. There is no delete button on the line: removal is an operator action (below). On an
older Engine (no `Engine.tempBackups`) the line stays until a newer updateApp op or the op
leaves the store.

**Stored temporary backups (console#230 option A, Axle's Engine PR).** When the Engine
publishes `Engine.tempBackups?: { instanceId, stamp, path, sizeBytes, complete }[]` (stored,
refreshed after a create, a delete and at boot), it is the only source: `store/tempBackups.ts`
(`tempBackupsOf`, `tempBackupsForInstance`, `tempBackupsTotalBytes`) returns `undefined` only
when the field is absent, and only then does `leftoverTempBackupFor` fall back to the op args
above. With the field, the leftover line shows whenever the instance has an entry (also after
the op was archived), never while its update runs, with the summed size; the newest op only
decides `kept` (Failed op, `tempBackupState` kept, same stamp) and supplies the Engine warning.
Two or more backups of one App read "Backups made before updates are still on <Engine>'s own
disk and take about X GB. Ask for help to remove them when you no longer need them."
Selecting an Engine shows `TempBackupsSection` ("This Pi's own disk") under its app list when
at least one backup is left: free space of its system disk (if published), "Backups left from
updates" with the total, and one row per backup (App title, when it was made from the UTC
stamp, size, Complete / not finished; the path behind Technical details). A leftover of an App
that is no longer on the Pi still appears and can be removed; the label falls back to the
`instanceId` (the exact folder name). A complete backup has "Remove backup" with a confirm; it
is disabled while that App's update runs and absent for an unfinished backup. It sends
`buildDeleteTempBackupCommand` (commands.ts) through `sendCommand`: `deleteTempBackup
<instanceId> <stamp>` (engine#501). Success is the entry leaving `Engine.tempBackups`.
Refusals `NOT_FOUND`, `IN_USE`, `UPDATE_PENDING`, `BAD_PATH`, `HELPER_OUTDATED` and
`DELETE_FAILED` show a plain sentence, with the raw `CODE: text` behind Technical details.
Sizes in this view use the same 1024³ GB as the teacher line.

**Update steps, pending work and Resume (engine#456, aligned to engine#505 `7c20fd0`).**
`STEPS` is the 12-step list: Fetch, Check, Backup, Snapshot, Swap, LoadImages, Prepare,
Start, Health, Verify, Work, Settle. `totalSteps` is 12. Backup runs only when a pre-update
backup is due; Prepare, Verify, Work and Settle run only when the new bundle declares them.
The Console reads `updateProgress.step` and `op.stepLabel` names first. A Backup stepLabel can
still be the engine#469 backup sentence. Only after the names does it use an index: through
`STEPS` for 12 steps, or `LEGACY_STEPS` (Fetch, Check, Snapshot, Swap, Start, Health) for an
older six-step Engine (`totalSteps` 6). Labels: LoadImages "Loading the new version", Prepare
"Preparing the new version", Verify "Checking the new version", Work/Settle "Finishing the
update". Ephemeral `idea/updateProgress` may include `phaseNote` (the step's last `ERROR:` /
`not yet:` line, ≤ 200 characters). The running step line then uses a short teacher sentence
instead of the raw note: Prepare "Preparing the new version", Verify "Checking the new
version", Work/Settle (and any other hook step) "Finishing the app's own setup steps". The
raw note stays behind Technical details for operators.

Resume is signalled by `Instance.updatePending` (absent means false) **or** by
`updateAvailable` with both `fromVersion` and `toVersion` present and equal (`appId` =
`instanceOf`). Either signal shows "<App> is working, but its update is not finished yet.
Press Finish update to finish it." and a "Finish update" button (no confirm). That button
sends `updateApp <id> <current appId>` with no `--source` and no `--allow-major` (the Engine
also accepts the bare current version). A same-`appId` offer that is not a Resume is still a
stale leftover (idea#459) and stays hidden. Resume needs the App Running or Starting; if it
is not, the button is disabled and the line says "Start <App> first, then press Finish update
to finish the update. Nothing changed." Sending a different target while pending is refused
`UPDATE_PENDING`.

Leading op error codes get plain teacher text; the raw codes stay behind Technical details in
Ops. `updateOpFailedPlainText` (also exported as `updateOpErrorText`) is the Failed-card
helper. PREPARE_FAILED and VERIFY_FAILED roll back (and a `ROLLED BACK:` error) use the "put
the old version back" sentence. After the point of no return (Verify passed) the new version
keeps Running and `updatePending` stays set: MIGRATIONS_PENDING (a Work failure, Settle still
"not yet" at its deadline, or an Engine restart after Verify) uses the pending sentence;
SETTLE_FAILED (any other Settle exit) asks teachers to press Finish update again. Those two
are not shown as a rollback. ROLLBACK_START_FAILED, or a Stopped statusCondition starting
`ROLLBACK START FAILED:`, says the old version and data are back but the app does not start.
`ROLLBACK FAILED:` now means the data itself could not be restored. Check refusals before
anything is stopped: `UPDATE_STAGES_UNSUPPORTED` (unknown stage key) and
`UPDATE_CONTRACT_INVALID` (wrong shape); both say nothing changed. A `startInstance` refused
`UPDATE_IN_FLIGHT` (in-flight marker on the App Disk) says "IDEA is still updating <App> and
cannot start it until <Engine> recovers that update. Ask for help if it stays like this."
`<Engine>` is that op's hostname from `operationDB[opId].engineId` in the store (the op id is
in the refusal text). When the hostname is not known, the sentence falls back to "until that
update is recovered".

### Backup Disk schedule controls (idea#400)

When the docked Engine advertises a fresh `scheduledBackups` capability
(`capabilitiesBootedAt === lastBooted`; Engine main f114a28), `RestorePanel`
shows mode and daily-time controls (`BackupModeControls`). The current mode
and time are read from `Disk.backupConfig` (`mode`, `schedule.daily`, and
`scheduleError` when the stored time is invalid). Saving sends
`setBackupMode <backupDiskId> <immediate|on-demand|scheduled> [HH:MM]` to the
Engine in `Disk.dockedTo`, always by id, never by name. A time is sent only
with `scheduled` and is also validated on the client (`HH:MM` or `H:MM`,
00:00–23:59). The result's `changed` and `note` fields are shown in plain
wording; refusals `NOT_DOCKED`, `AMBIGUOUS`, `SYSTEM_DISK`, `NOT_A_BACKUP_DISK`,
`BAD_BACKUP_YAML`, `BAD_MODE`, `BAD_TIME` and `BUSY` are mapped the same way.
Saving `scheduled` on a disk with no `Disk.lastAttempt` (the store field #186
reads for the last scheduled run; Engine `lastRun` is not in the store) shows
"A first backup starts now, then daily at HH:MM." The Console never writes
`lastRun`. Without the flag the existing read-only mode badge is unchanged.
See `src/store/setBackupMode.ts`.

### Demo apps (idea#235, Engine design engine#369)

Settings → **Demo apps** sets up and removes separate "Kolibri Demo" and
"Nextcloud Demo" instances. Real instances are never touched. The tab is shown
only to **operators** (`isOperator()`; Koen, idea#235, 14 Nov 2026 10:15). The
Engine has no role model, so this check lives only in the Console. The tab
also needs at least one Engine with a fresh `demoApps` capability
(`capabilitiesBootedAt === lastBooted`); the section offers only such Engines,
with the connected Engine first.

- **Set up** sends `setupDemo <targetDiskId>` to that Engine, by disk id. The
  disk picker lists only disks docked to that Engine whose `diskTypes` include
  `app` or `empty`, never `system` (engine#369 Q1). The default is the disk that
  already holds demo apps (a resume), else the one with the most `freeBytes`.
  The button is greyed out, with the reason shown, when:
  - a `setupDemo`/`removeDemo` Operation for that Engine is Pending or Running;
  - there is no usable disk;
  - two demo instances of one app are docked there (mirrors `DEMO_AMBIGUOUS`);
  - demo apps are on another disk of that Engine (mirrors `DEMO_EXISTS`);
  - the Engine's ephemeral `idea/hb` says `internet: false` **and**
    `demoLocal: false` ("Set up demo apps needs internet. Connect the Engine,
    or insert a disk with the IDEA demo pack.").
  Missing hb fields (older Engine, or no hb yet) count as unknown, and the
  Engine decides (`NO_SOURCE`). When some demo apps exist on the chosen disk,
  or the last setup failed (for example `INTERRUPTED`), the button reads
  "Continue setting up demo apps": setupDemo is idempotent and resumes. When
  the full set is there, it reads "Check and refresh demo apps" and sends the
  same `setupDemo`: the Engine re-verifies the demo content (downloading it
  when needed) and re-runs the idempotent seed steps, never installing a second
  copy. This is how a demo pack that fell below a new `minVersion` after
  `updateApp` is brought up to date (engine#369 addendum, decision 5).
  Demo apps are matched by their App record's `name` (`kolibri`, `nextcloud`),
  because app ids are versioned and `instanceOf` changes on `updateApp`.
- **Remove** opens a confirm that names the exact demo instances, then sends
  `removeDemo <instanceId>...` with those ids. The bare `removeDemo` (all demo
  instances) is never sent.
- **Progress** comes from the newest `setupDemo`/`removeDemo` Operation for that
  Engine (`Operation.demo`): one block per app, one row per step id (`install`,
  `download`, `verify`, `seed`, `start`, `ready`, `classwork`; removal `stop`,
  `remove`), with plain wording. Every engine#369 §9 code (refusals, failures,
  `DEMO_READY`, `DEMO_REMOVED`) has a plain sentence; `REMOVE_FAILED` adds the
  inner removeInstance reason. `CHECKSUM_MISMATCH` is only a sha mismatch of a
  downloaded pack; `INVALID_PACK` is a bad pack.json, a missing or empty CREDITS
  file, or an unsafe tar member (Steve, 14 Nov 2026, for engine#374).
  `NO_SOURCE` (a refusal when no app has a source, or when an app named in
  `--apps` has none) uses "Set up demo apps needs internet. Connect the Engine,
  or insert a disk with the IDEA demo pack." when the Engine heartbeat says
  `internet` is false or unknown. When `internet` is true, it names the app
  parsed from the error text, e.g. "Demo content for Nextcloud isn't available
  on this Engine yet.", or "Demo content for one of the apps isn't available
  on this Engine yet." if the app can't be parsed. The sentence is used for
  both the command-trace refusal (no Operation) and `Operation.error` /
  `Operation.demo.code`. Unknown codes go through `plainEngineText`.
  When the Engine can set up some apps and skips others, `setupDemo` still
  ends `Done`. `Operation.demo.skipped` lists those apps (`{ app, code:
  'NO_SOURCE', detail }`; `[]` means nothing was skipped; the field is absent
  on older Engines). Skipped apps are not in `Operation.demo.apps`. After a
  Done setupDemo the section keeps the success wording and adds a note per
  skipped app, e.g. "Nextcloud Demo was skipped: its demo content isn't
  available on this Engine yet.", or, when the heartbeat says `internet` is
  false, "Nextcloud Demo was skipped because the Engine has no internet and
  no local demo pack." That note is never shown as a failure. The trace
  `skipped` arg is a comma string (`nextcloud:NO_SOURCE`) or an array of the
  same tokens.
- **Network:** when another Engine's docked disks hold demo instances, a note
  says "IDEA demo apps already run on <engine>." It never blocks (engine#369 Q2).
- **DEMO badge:** the signed-in operator instance list (`InstanceRow`), app
  cards, and the mobile list show a DEMO badge next to the instance-name title
  (#192) only when `Instance.demo === true`, which the Engine mirrors from
  `x-app.demo` in the instance's compose.yaml. It is never inferred from the
  name. `updateApp` keeps `x-app.demo` (engine#369 addendum A), and the Console
  never writes instance records, so the badge stays after an update.

- **Outdated demo content:** `Instance.demoPackWarning`
  (`{ code: 'PACK_OUTDATED', packVersion, minVersion }`) is set by `updateApp`
  when the demo pack is older than the new app version needs, and cleared by a
  successful `setupDemo` verify. The card, the mobile row and the Demo apps
  section then say "Demo content is out of date (pack v3, needs v4). Press
  Check and refresh demo apps in Settings → Demo apps." It's a warning only;
  the Engine never downloads on its own.
- **Results:** the Console follows the command trace by its named args:
  setupDemo `{ targetDiskId, apps }` (`apps` absent or null = both) and
  removeDemo `{ instanceIds }` (a comma-separated string, matched as the
  whole list; an array of the same ids is also accepted).
  The trace `errorCode` and `Operation.demo.code` are bare codes; the trace
  `errorMessage` and `Operation.error` are `CODE: text`. Only the plain sentence
  is shown, never the code, and only once: when an Operation exists the
  progress result shows it, and command feedback is used only for a refusal
  (no Operation). A failed `removeDemo` whose inner code is `BUSY` says "A
  demo app couldn't be removed because the Engine reported it as busy. If this
  keeps happening, the Engine may need an update." `Operation.args.apps` is a
  comma string and is not read; the per-app list comes from `Operation.demo.apps`.
- **Live download bytes:** while the `download` step runs, an ephemeral
  `{ type: 'idea/progress', opId, step, bytesDone, bytesTotal }` (when the
  Engine sends it) shows "X of Y MB". Without it the step shows `bytesTotal` only.
- **Gate:** the `demoApps` capability with `capabilitiesBootedAt === lastBooted`,
  never `Engine.version` (that is the system disk's META version).

All new store fields (`Instance.demo`, `Instance.demoPackWarning`,
`Operation.demo`, the `setupDemo` and `removeDemo` kinds) and hb fields are
optional, so older Engines look as before. Contract: engine#369, its addendum,
and Axle's answers (comment 6875670232). See `src/store/demoApps.ts`.

### Move: parked and resumed (engine#509 / engine#511)

A `moveApp` can pause and resume in the same operation. While it is parked (`Pending` plus `RESUME_WAITING` or `RESUME_PENDING`) or running again after a resume, and it stopped a running source (`args.wasRunning` `'1'`), the Operations card and the source App row (desktop) or card (mobile) show: "Source stopped until the move resumes or gives up". The Operations card (and the row's progress label) uses "Waiting for the disk to come back" for `RESUME_WAITING` and "Waiting to try again" for `RESUME_PENDING`. Parked raw text (`RESUME_…` or a `RESUME_PARKED` trace starting `MOVE PAUSED: RESUME_…`) stays behind closed Technical details; the trace is not an end state. The hint is hidden when the source was already stopped (`wasRunning` `'0'`), when the move finishes, gives up (`Failed` `RESUME_GAVE_UP`, with `move.code` the same and `move.phase` `failed`), or is cancelled. Unknown `RESUME_` prefixes never appear in the teacher-facing text. Helpers live in `src/store/parkedMove.ts`.

- **Local** (no `op.move`, `args.phase` set): the hint uses phases `copying` or `verified`.
- **Cross-Engine** (`op.move` present and `args.crossResume` `'1'`; engine#497 option A / engine#511): the same parked/resuming markers. `args.phase === op.move.phase` while in flight or parked. Phases are `copying` → `checking` → `removing` → `done` / `failed` (no `verified`). The hint shows only when the source is on this Engine (`isSourceEngineOp`: `op.move.sourceEngineId` when present, else `op.engineId`), status is `Pending` or `Running`, phase is `copying`, `checking` or `removing`, and `instance.storedOn === args.sourceDiskId` (so a park in `removing` still shows the hint until the flip). Older cross ops without `crossResume` get no hint. A Done `SOURCE_CHANGED` op (source kept and restarted, target quarantined) is the existing amber "Not moved" card, with no hint. `TARGET_OUTDATED` and `HELPER_OUTDATED` already have sentences in the Move code maps.

### Cross-Engine Move: live Checking progress (idea#498)

During a cross-Engine Move's Checking step, the target Engine sends an ephemeral
message, never stored, about once a second:
`{ type: 'idea/progress', opId, step: 'Checking', bytesDone, bytesTotal, checking: { phase, label, stableElapsedMs, stableTargetMs } }`.
`src/store/moveChecking.ts` keeps the latest message for each `opId`. It accepts the
message from any Engine, because the target Engine sends it and Engines relay
ephemeral messages to each other. The desktop and mobile Move feedback
(`CrossMoveStatus`, inside `CopyMoveFeedback`) adds one line under "Step 2 of 3: Checking the copy on <Engine>".
The operation card (`OperationProgress`, desktop and mobile) shows the same line in
place of the stored `stepLabel`:

- `starting`: "Starting on the new Engine"
- `stabilising`: "Checking it stays up: N of 10 seconds". The count is built from
  `stableElapsedMs` / `stableTargetMs`, and it can go back to 0 and `starting`.
- `stable`: "It stayed up for 10 seconds"
- unknown phase: the Engine's `checking.label`

The line shows only while the op is Pending or Running on the Checking step, and
for up to 15 s after the last message (`MOVE_CHECKING_STALE_MS`, checked with
`liveNow`). Engines that don't send it show the plain Checking step as before.
The stored `stepLabel` / `currentStep` are unchanged.

### Copy/move feedback panel and operation cards (idea#498)

`CopyMoveFeedback` holds the copy/move `CommandFeedback` and the cross-Engine Move lines
(`CrossMoveStatus`) in one `.copy-move-feedback` panel. Desktop mounts it above the
Operations panel in the right pane; mobile mounts it at the top of the tab content. It
renders nothing when it has nothing to say. "Sent to <engine>, waiting for confirmation…"
shows only until the Engine's moveApp op is in the store; from then on the step line
replaces it. A Failed op still ends in the CommandFeedback error line.
The cross-Engine Move outcome line uses one colour per kind: green `cross-move--success` for moved ("<app> moved to <target>."), amber `cross-move--warning` for a warning, and the error line stays red.

Operation cards (`OperationProgress`, desktop and mobile Activity tab) are keyed by op id.
Dismissing a finished card (the Done auto-dismiss after 3 s, or ✕ on a Failed card) only
hides it in this browser (`store/dismissedOps.ts`, localStorage `idea.dismissedOps`, newest
200 ids; Done ids are not stored). It never sends a command. Only Cancel on a Pending or
Running op sends `cancelOperation`. Before idea#498 the ✕ on a Failed card sent
`cancelOperation`, which marked the op Cancelled for every Console; now a Failed card stays
visible in other browsers until each one dismisses it.

The failed-op message on an app's row (`InstanceRow`, "Failed: … - Try again", for
backupApp, restoreApp, upgradeApp and updateApp) clears on its own, since a Failed op is
no longer marked Cancelled for everyone (`store/rowFailure.ts`):

- the newest finished op (Done, Failed or Cancelled, any kind) of that instance decides,
  compared by `completedAt`, else `startedAt`. A newer Failed op of a shown kind replaces
  the message; any other newer finished op clears it.
- otherwise it hides `ROW_FAILURE_TTL_MS` (24 h) after the op failed, measured on that
  op's Engine clock (`engineClockOf`: last hb, else stored lastRun), falling back to the
  Console clock only when the Engine's clock is unknown. No new timer: it re-checks on the
  shared 5 s `liveNow` tick.
- it hides when this browser dismissed that op's card (`isOpDismissed`).

Per row it is two memos: one picks the newest finished op (store changes only), the
other applies the expiry and dismiss on the clock tick. moveApp and copyApp failures are
not shown on the row (they stay in the copy/move panel and the op cards).

When a cross-Engine Move ends Done with the source not removed (`SOURCE_CHANGED`,
`SOURCE_NOT_REMOVED`, or the `MOVED, source not removed:` text), the wording follows where
the instance row is when the op ends (`movePlacement`), never the result text (engine#388):

- row on the target disk (removeSource failed after storedOn flipped):
  "<app> moved to <target>. The old copy on <source> couldn't be removed."
- row on the source disk, `SOURCE_CHANGED`: "<app> was not moved: it changed on <source>
  while it was being copied, so it stays there. A leftover copy is on <target>."
- row on the source disk, any other code: "<app> was not moved, so it stays on <source>.
  A leftover copy is on <target>."
- row on neither: "The move of <app> didn't finish cleanly. Check <source> and <target>
  to see where it is."

The target-copy sentence is the single constant `MOVE_TARGET_LEFTOVER`.

**engine#388 (agent-engine-dev #390, merged as 4a30798).** If a cross-Engine Move fails before
storedOn flips, the target Engine stops the copy and quarantines it. It records
`move.targetCleanup`: `'quarantined'`, `'failed'`, or null when it didn't try (COPY_FAILED, refusals,
older Engines). The Console reads only these codes:

- **Success** (`moveOutcome(...).moved`): only MOVED or SOURCE_NOT_REMOVED, and only when the row is
  on the target disk. MOVED with the row's place unknown also counts. Op Done or an ok trace alone
  never counts. SOURCE_CHANGED is a Done op with an ok trace that left the app on the source.
  - **Desktop and mobile:** `confirmNewOperation` (store confirmation) returns `{ warning }` for it.
    The `settle` hook of `commandResult` turns an ok trace into a `warning` state. That covers the
    desktop drag (`dragCopyMove`) and the mobile Move sheet (`MobileAppList`).
  - **Warning line:** `CommandFeedback` shows the warning as an amber line (`command-feedback--warning`).
    `CopyMoveFeedback` hides that line once the outcome line shows the same sentence.
  - **Op cards:** `OperationProgress` shows such a card as "⚠ Not moved" (amber) with its sentence.
    The card has no 3 s auto-dismiss and stays like a Failed card until it is dismissed locally.
- **Target-copy sentence by `targetCleanup`:** `'quarantined'` gives "The unfinished copy on
  <target> was set aside." (`MOVE_TARGET_SET_ASIDE`). `'failed'` gives "A leftover copy is on
  <target>." (`MOVE_TARGET_LEFTOVER`). Null keeps the older storedOn-based wording.
  - It is added only after SOURCE_KEPT, SOURCE_CHANGED and the VERIFY_* codes
    (`MOVE_CLEANUP_CODES`), never after COPY_FAILED or a refusal.
- **Sentences:**
  - SOURCE_KEPT (Failed): "<app> was not moved, so it stays on <source>."
  - SOURCE_CHANGED: "<app> was not moved: it changed on <source> while it was being copied, so it
    stays there."
  - VERIFY_*: keep their "Nothing was removed: it is still on <source>." sentences.
  - Each of these gets the target-copy sentence after it.
  - Failed move cards show the same Console sentence instead of the raw Engine text.
- **Older Engines:** no code means the storedOn logic above applies unchanged.

**engine#395 (fd52c8a): the cleanup lands after the op ends.** The source Engine marks the op
Failed (or Done for SOURCE_CHANGED) first, then asks the target to clean up and waits up to 60 s.
So `move.targetCleanup` / `targetCleanupDetail` arrive after the op is terminal. A failure after a
finished copy is SOURCE_KEPT with the cleanup set later; COPY_FAILED always has null cleanup.

- **Pending sentence (`cleanupView` in `moveApp.ts`):** a MOVE_CLEANUP_CODES code with
  `targetCleanup` still null says "Cleaning up the copy on <target>…" (`MOVE_TARGET_CLEANING`).
  It never shows the leftover sentence first. When the field lands, the sentence becomes the
  set-aside or leftover one.
- **Not forever:** the leftover sentence replaces it `MOVE_CLEANUP_WAIT_MS` (70 s) after the op
  ended, or as soon as `targetCleanupDetail` or the op / result text says it timed out ("timed out
  waiting for <Engine> to confirm the target cleanup").
  - The 70 s are measured from `completedAt` on the op's Engine clock (`moveEngineNow`: its last hb,
    as the 24 h row expiry), else the Console clock. Not the stored `lastRun`: it does not advance,
    so the 70 s could never pass.
  - It reads the shared 5 s `liveNow` tick, so the sentence flips without user action and there is
    no extra timer.
- **Codeless older Engines** keep the storedOn-based leftover fallback; "Cleaning up…" needs a code.
- **Reactive, never frozen at settle:** `commandResult` stores the warning or error once. The panel
  re-derives the sentence from the newest move op while rendering:
  - the outcome line (`createCrossMoveView`);
  - the error line (`formatLine` → `moveErrorLineFor`);
  - the warning line (the new `CommandFeedback.formatWarning` → `moveWarningLineFor`; desktop
    `dragCopyMove` and the mobile Move sheet).
  - Op cards (`moveOpOutcome` in an `OpCard` memo) follow the same way.
  - The app row (`InstanceRow`) shows no move text: moveApp is not one of its row-failure kinds.
- The amber "⚠ Not moved" card behaviour is unchanged.

**App name on a move card whose app is gone (idea#498).** A Not-moved or Failed move card stays until it is
dismissed, so it can outlive its app. Engine fd52c8a moveApp / copyApp ops carry only `args.instanceId`; no
name is on the op, its move info or its text. `moveCtxOf` uses the source row's name, then the target row's
name (an older Engine's fresh-id copy), then `args.instanceName` / `args.name`. Without any of these it uses
"The app" (`MOVE_APP_UNKNOWN`), or "the app" inside a sentence, and never the raw id. The card's subtitle
(`argsSummary` in OperationProgress) already leaves the name out when it is unknown.

### Disk roles in the right pane (Files Disk, idea#132)

A disk can have several roles (`['app', 'backup', 'files']`). The tree row and the disk header
show one badge per role in the fixed order app, backup, files. `rightPanelFor`
(`src/store/diskRoles.ts`) picks the Empty Disk panel for an empty disk without instances and
`DiskView` for any other disk; `DiskView` shows one section per role (Apps, Backups, Files).
Eject is hidden only on a pure Backup Disk (and the system disk). Files actions
(**Make this a Files Disk**, **Add Files to this disk**) are greyed out with "Update this Engine
to manage this disk" unless the target Engine has a fresh `'filesDisk'` capability
(`engineHasCapability`). Their result comes from `createCommandResult`: the first new
`createFilesDisk` trace with that `args.diskId`, success when it is ok and the disk shows
`'files'`, 15 s timeout.

Ejecting a combined disk (two or more roles), from the tree or the Files section, first opens
`EjectConfirm` (idea#157). `ejectImpact` lists the instances stored on the disk (they stop),
instances elsewhere that mount it as a Files Disk (they lose its files) and the instances it
backs up (backups become unavailable). Single-role disks eject immediately. A disk with
`unmountError` shows "<name> couldn't be unmounted cleanly. Restart this Pi." under the row of
the Engine named in `unmountError.engineId`, for every disk type, docked or not.

### Erase (idea#136)

`Erase this disk…` is a danger-styled text button at the bottom of every non-system disk view
(and on unformatted candidates under the Engine row). It is greyed out unless the Engine has a
fresh `'eraseDisk'` capability, and under the same lock as eject. The dialog sends
`summariseDisk <targetId>`, shows `CommandTrace.result` as a content summary (or "contents
unknown"), requires typing the summary `label` exactly, then sends
`eraseDisk <targetId> <summaryTraceId> <label>`. Progress comes from `Engine.eraseInProgress.step`
(15 s no-response / 5 min slow warning on the Console clock). On success the disk is republished
`['empty']` and the Empty Disk panel opens. The Files shortcut **Erase the disk first** runs the
same dialog then `createFilesDisk` once the empty disk appears.

---

## Preview / Mock Mode

`createMockConnection()` (`src/mock/mockStore.ts`) returns a `StoreConnection` backed by an
in-memory store: 2 Engines, 6 disks (Kolibri, Nextcloud, Wikipedia, a Backup Disk, an empty
disk, a Channel Builder disk), 6 apps and 6 instances in varied states (Running, Stopped, Docked,
Error), an empty `operationDB` and a mock CommandLog with a few traces. `userDB` holds one
pre-provisioned operator (below).

Preview mode activates when `previewMode` is `true` in `chrome.storage.local` / `localStorage`
(Settings → Engine Connection → Preview mode). It is refused in production web mode: a Console
served by an Engine always stays on that Engine's store.
A leftover `demoMode` key is read once, copied to `previewMode`, and then removed.

When active:
- A yellow **PREVIEW** badge appears in the status bar.
- `createEngineConnection` is never imported (no WebSocket attempt, no Automerge loaded).
- The mock store includes a pre-provisioned operator (`admin`; its password is in the hash
  comment in `mockStore.ts`) so there is no first-time setup in preview mode; the Console opens
  on the app browser and the operator logs in through 👤.
- `changeDoc` mutations (operator creation/removal) apply to the in-memory store and are
  persisted to `localStorage` under `ideaConsole_demoUserDB` — operators survive page reloads.
  If persisted operators exist, they replace the pre-provisioned admin.

---

## Build System

| Tool | Role |
|---|---|
| Vite | Dev server + production bundler |
| pnpm | Package manager |
| Vitest + Testing Library | Unit and component tests under `test/` (`pnpm test`) |
| Playwright | Live/e2e specs and duration-walk intents under `e2e/` (`pnpm test:e2e`, `pnpm e2e:kit`) |
| TypeScript strict | Type checking |
| bcryptjs | Client-side bcrypt (pure JS — no native bindings) |

Key Vite config:
- `cacheDir: '/tmp/idea-console-vite-cache'` — avoids ownership conflicts on Pi
- `server.allowedHosts: true` — permits Tailscale hostname in dev mode
- `build.outDir: 'dist'` — Chrome Extension loads from here; also served by Engine HTTP server
- `build.emptyOutDir: false` — a direct `vite build` must not wipe a live `dist/` the Engine is serving

`pnpm build` runs `scripts/build.mjs`, which always calls Vite `build()` with `mode: 'production'`
and sets `NODE_ENV=production` so a stray env (for example `test`) cannot change the bundle.
`pnpm dev` still starts the Vite dev server and is unchanged. Vite writes to a fresh
`dist.new-<timestamp>/` (with `emptyOutDir: true` only for that folder) and, only on success,
swaps it into `dist/` (`dist/` → `dist.prev`, then the new folder → `dist/`). Exactly one
previous tree is kept for rollback. A failed build leaves the live `dist/` in place, so the
Engine never serves an empty or half-written Console. The Chrome Extension entry
(`src/background/background.ts` → `background.js`) is unchanged.

`pnpm package` (legacy extension only): builds, zips `dist/` to
`/tmp/idea-console-pkg/extension.zip`, serves on port 8080 for download from the Pi.

Fleet deploys are not done from this repo: Ops runs `koenswings/idea` → `tools/fleet/deploy.sh`
(or `tools/fleet/build-console-pi.sh`), which runs `pnpm build` in
`/home/pi/idea/agents/agent-console-dev` (see AGENTS.md).

---

## Engine API Contract

### 1. Automerge WebSocket sync

- **URL:** `ws://<hostname>:<wsPort>`; `wsPort` from `/api/store-url`, default `4321`
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

- **Endpoint:** `GET /api/store-url` on Engine HTTP server (`settings.httpPort`, default 80)
- **Response:** `{ "url": "automerge:<hash>", "wsPort"?: <number>, "engineId"?: <string> }`
  (`wsPort` optional; Console falls back to `4321` when missing or invalid. `engineId`, when
  present, tells the Console which Engine serves the page)
- Returns 503 if the store is not yet initialised.
- CORS header included for dev-mode cross-origin requests.
- Implemented in Engine `httpMonitor.ts` (PR #26 / PR #28 merged).

### 4. CommandLog discovery

- **Endpoint:** `GET /api/command-log-url` → `{ "url": "automerge:<hash>" }`, the Engine's
  current CommandLog document (traces of every command: args, status, result, logs).
- The Console opens it on the same repo and re-reads the endpoint every 60 s, because the Engine
  starts a fresh CommandLog each local day and carries open traces into it (idea#183).

### 5. Console static file serving

The Engine's `httpMonitor.ts` serves Console `dist/` as a single-page app from `consolePath`
in `config.yaml` (default `/home/pi/idea/agents/agent-console-dev/dist`). Falls back to
`index.html` for all unmatched routes (SPA client-side routing). When `consolePath` is empty or
the folder does not exist at Engine startup, the Engine logs it and continues, and only the
`/api/*` endpoints are served.


### Duration-walk selectors (idea#166)

Console surfaces used by the duration-tests walker expose id-keyed `data-testid`s
(`engine-<id>`, `disk-<id>`, `instance-<id>`, `candidate-<id>`, `disk-view-<id>`,
`console-overview`, `op-entry`, `op-overview`, `eject-confirm`, `erase-dialog`).
Playwright Intent adapters live under `e2e/intents/`, registry keyed by Axle
ACTIONS.md / school-day.yaml (`open_console_as_teacher`, `open_kolibri_as_teacher`,
`open_nextcloud_as_learner`, `open_disk_inventory`, `backup_schedule`, `rename_instance`, `update_restart_failed`, …). Defaults bind to Kid
fixture IDs (`kolibri-grade5a-001`, `nextcloud-grade5a-001`,
`duration-kolibri-grade5a-001`). Engine-owned `infra_*` Intents are not registered here.
`update_restart_failed` (console#217, engine#442) is hook-gated: it is registered, but
it loud-fails unless `DURATION_UPDATE_RESTART_FAILED_HOOK` is set, which says the Engine
under test runs with engine#467's `IDEA_TEST_FAIL_UPDATE_RESTART=<instanceId>` hook
(testMode only) for the same instance. See `e2e/intents/README.md`.
