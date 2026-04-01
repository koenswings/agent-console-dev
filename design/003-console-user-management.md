# Design Doc 003 — Console User Management & Dual-Mode UI

| Field | Value |
|---|---|
| Status | Proposed |
| Author | Pixel |
| Date | 2026-04-01 |
| Supersedes | — |

---

## Problem

The Console was initially conceived as an operator-only tool. The complete system requires a
user-facing layer: students and teachers must be able to browse and launch apps without any login
or technical knowledge. Operators use the same application, authenticating within it to unlock
management functions.

This design describes:
1. The dual-mode UI (user mode / operator mode)
2. The user/operator data model in the Engine Store
3. The authentication flow
4. Requirements for the Engine developer (Axle)

---

## Audiences

| Audience | Who | Default? | Requires login? |
|---|---|---|---|
| User | Student, teacher | Yes | No |
| Operator | IT coordinator, admin | No | Yes |

Operators are a subset of users. There is no separate account type for anonymous users — the
system simply starts unauthenticated.

---

## Two-Mode UI

### User Mode (default — unauthenticated)

The Console opens in user mode when no operator session is active.

**What the user sees:**
- A grid of app cards — one per instance on the network
- Running instances: card with title, description, category, and an **Open** button
- Stopped/unavailable instances: same card, greyed out, Open button disabled
- A small **Log in** link in the status bar (unobtrusive — not the focus of the UI)

**What the user cannot see or do:**
- Engine/disk/instance management controls
- System health or network topology
- Any management action (start, stop, eject)

### Operator Mode (after login)

When an operator authenticates, the Console switches to operator mode in the same session.

**What the operator sees:**
- Full current Console: NetworkTree, InstanceList, instance controls (start/stop/eject)
- A **Log out** button in the status bar
- Operator username shown in the status bar

**Switching back:** Logging out returns to user mode. The browser/extension does not need to
reload — mode switch is reactive via a Solid.js auth signal.

---

## User / Operator Data Model

Users (operators) are stored in the Engine's Automerge Store under `userDB`.

Only operators have accounts. Anonymous users are not tracked or stored.

### `User` entity

```ts
export type UserID = string;
export type Username = string;
export type PasswordHash = string;   // bcrypt hash — never plaintext

export interface User {
  id: UserID;
  username: Username;
  passwordHash: PasswordHash;
  role: 'operator';
  created: Timestamp;
}
```

### Store extension

```ts
export interface Store {
  engineDB:   Record<EngineID,   Engine>;
  diskDB:     Record<DiskID,     Disk>;
  appDB:      Record<AppID,      App>;
  instanceDB: Record<InstanceID, Instance>;
  userDB:     Record<UserID,     User>;   // NEW
}
```

`userDB` is part of the shared Automerge document, so operator accounts replicate across the
Engine network automatically.

---

## Authentication Flow

Authentication is **entirely local** — no API call, no server session, no token round-trip.
The Store already contains `userDB` with bcrypt password hashes. The Console authenticates
client-side by comparing the entered password against the stored hash.

This is the correct design for an offline-first system:
- Works even if the Engine's HTTP server is unreachable (only Automerge WebSocket needed)
- Requires no additional server-side infrastructure
- Operator accounts replicate automatically via the Store

### Login

1. Operator enters username and password in the `LoginForm`
2. Console looks up the username in `userDB` (from the live Store signal)
3. Console runs `bcrypt.compare(enteredPassword, user.passwordHash)` client-side
   using `bcryptjs` (pure JavaScript, no native bindings needed)
4. If match: set `currentUser` signal, persist to `chrome.storage.local` / `localStorage`
   as `operatorSession: { userId, username }`
5. Solid.js reactivity switches the UI to operator mode immediately — no page reload

### Session restore on page load

On mount, Console reads `operatorSession` from storage. If present, it cross-checks `userId`
against `userDB` in the current Store. If the user still exists: session restored silently.
If the user has been removed from `userDB`: session cleared, returns to user mode.

### Logout

Clear `operatorSession` from storage and reset `currentUser` to null. The UI returns to user
mode reactively.

---

## Console Component Changes

### New components

| Component | Purpose |
|---|---|
| `AppBrowser` | User mode: grid of app cards (running + greyed-out stopped) |
| `AppCard` | Single app card — title, description, category, Open button (disabled if not running) |
| `LoginForm` | Username/password form shown as modal overlay |

### New store module

`src/store/auth.ts` — manages auth state entirely client-side:
- `currentUser` signal (`User | null`)
- `login(username, password, store)` — bcrypt compare against `userDB`, sets signal + storage
- `logout()` — clears signal + storage
- `restoreSession(store)` — on mount, validates stored session against current `userDB`
- `isOperator()` derived signal — `currentUser() !== null`

### Updated `App.tsx`

```
onMount:
  restoreSession(store)  →  sets currentUser if stored session is valid

Render:
  if !ready              → null
  if shouldShowOnboarding → <Onboarding />
  else if isOperator()   → <OperatorLayout />   (current NetworkTree + InstanceList)
  else                   → <AppBrowser />        (new user-mode layout)
```

The mode switch is fully reactive — login/logout updates the signal and the UI follows
immediately.

### Status bar

- User mode: `IDEA Console` + connection indicator + small **Log in** link
- Operator mode: `IDEA Console` + connection indicator + username + **Log out** button
- Demo badge shown in both modes when active

---

## Requirements for the Engine (Axle)

_Document only — do not involve Axle yet._

### 1. Add `userDB` to the Store

Extend the Automerge document schema with `userDB: Record<UserID, User>`.

`User` fields: `id`, `username`, `passwordHash` (bcrypt, cost factor >= 10), `role: 'operator'`,
`created: Timestamp`.

Password hashes are safe to include in the replicated Store — plaintext passwords never enter
the document.

### 2. User management (Engine-side CLI or admin tool)

Since the Console itself does not write to `userDB` in v1 (no "create operator" UI), the
Engine must provide a way to manage operator accounts:

- Create operator: `engine user add <username>` — prompts for password, writes bcrypt hash
  to `userDB`
- Remove operator: `engine user remove <username>`
- Reset password: `engine user reset-password <username>`

First-time setup: Engine should create a default `admin` account on first boot with a
randomised password printed to the console log. Must be changed on first use.

### 3. No auth API endpoints required

Authentication is done client-side by the Console reading `userDB` from the Store. The Engine
does not need to expose any `/api/auth/*` endpoints. This simplifies both sides.

### 4. Protect management write paths (future)

For v1, command write-back via Automerge (`engine.commands[]`) is unauthenticated — acceptable
on a trusted school LAN. In a future hardening pass, the Engine should verify that command
mutations originate from an authenticated client. The mechanism (e.g. signed mutations or a
separate auth-gated REST command endpoint) is TBD and not a blocker for v1.

---

## Open Questions

1. **Multi-Engine user sync** — `userDB` replicates via Automerge, so an operator account
   created on one Engine appears on all peers. Is that intended? Assumed yes.

2. **Session TTL** — Should the stored `operatorSession` expire? Suggestion: no automatic
   expiry for v1 (school IT coordinators don't want to re-login daily). Can be added later.

3. **App browser scope** — Does `AppBrowser` show instances from all Engines on the network,
   or only the Engine the Console is connected to? Assumed: all (from `instanceDB`, which
   contains the full network view via Automerge sync).

---

## Implementation Plan

| Phase | Work | Owner |
|---|---|---|
| 1 | Engine: add `userDB` to Store, CLI user management, default admin account | Axle |
| 1 | Console: `src/store/auth.ts`, update `App.tsx` routing | Pixel |
| 2 | Console: `AppBrowser` + `AppCard` components (running + greyed-out stopped) | Pixel |
| 2 | Console: `LoginForm` + status bar auth controls | Pixel |
| 3 | Engine: protect management write paths (hardening, future) | Axle |

Phase 1 (Console side) can start once the `userDB` shape is agreed — no need to wait for Axle
to implement it, as the mock store already includes a stub `userDB`.
