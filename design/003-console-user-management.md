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

All user management — registration, login, logout, password changes, removal — is handled
entirely within the Console UI. No CLI tools or Engine-side user management needed.

This design describes:
1. The dual-mode UI (user mode / operator mode)
2. The user/operator data model in the Engine Store
3. The authentication and registration flow
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
- Operator management panel: add/remove operators, change own password
- A **Log out** button in the status bar
- Operator username shown in the status bar

**Switching back:** Logging out returns to user mode. No page reload — mode switch is
reactive via Solid.js auth signals.

### First-time Setup Mode

When `userDB` is empty (no operators exist yet — fresh install), the Console shows a
**first-time setup screen** instead of the regular login form. Any user can create the
initial admin account from this screen. Once the first operator is created, the setup screen
is never shown again.

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
Engine network automatically. A new operator created on one Engine is immediately available
on all peers.

---

## Authentication & Registration Flow

All auth and user management operations are **entirely client-side and local**. The Console
reads `userDB` from the Automerge Store and writes back to it via `handle.change()` — the
same mechanism used for instance commands. No API, no server session, no token round-trip.

This is correct for an offline-first system: works even if the Engine's HTTP server is
unreachable, and requires no additional server infrastructure.

### Login

1. Operator enters username and password in `LoginForm`
2. Console looks up the username in `userDB` (live Store signal)
3. Console runs `bcrypt.compare(enteredPassword, user.passwordHash)` client-side
   using `bcryptjs` (pure JavaScript, no native bindings)
4. If match: set `currentUser` signal, persist `operatorSession: { userId, username }` to
   `chrome.storage.local` / `localStorage`
5. UI switches to operator mode reactively — no page reload

### Session Restore on Page Load

On mount, Console reads `operatorSession` from storage. If present, cross-checks `userId`
against `userDB` in the current Store. If user still exists: session restored silently.
If user has been removed: session cleared, returns to user mode.

### Logout

Clear `operatorSession` from storage and reset `currentUser` to null. UI returns to user mode.

### Registration (operator creates operator)

Only a logged-in operator can create new operators. Registration writes directly to the
Automerge Store:

1. Logged-in operator opens the operator management panel
2. Enters new username and password (+ confirm password)
3. Console validates: username not already taken, password meets minimum requirements
4. Console hashes the password: `bcrypt.hash(password, 12)`
5. Writes new `User` to `userDB` via `handle.change()`:
   ```ts
   handle.change((doc) => {
     doc.userDB[newUser.id] = newUser;
   });
   ```
6. New operator is immediately available across all Engine peers via Automerge sync

### First-time Setup

When `userDB` is empty:
1. Console shows a **First-time Setup** screen (replaces login form)
2. Any user can create the initial admin account — no existing auth required
3. Same flow as registration (hash + write to `userDB`)
4. After creation, Console logs in as the new admin automatically
5. Once `userDB` has at least one entry, the first-time setup screen is never shown again

### Password Change

Logged-in operator can change their own password:
1. Enter current password (re-validated via bcrypt)
2. Enter new password + confirm
3. Console hashes new password and overwrites `passwordHash` in `userDB` via `handle.change()`

### Remove Operator

Logged-in operator can remove another operator:
1. Select operator from list
2. Confirm removal
3. Console deletes the entry from `userDB` via `handle.change()`
4. If the removed operator has an active session on another device, their session restore
   will fail (userId no longer in `userDB`) and they will be logged out automatically

---

## Console Component Changes

### New components

| Component | Purpose |
|---|---|
| `AppBrowser` | User mode: grid of app cards (running + greyed-out stopped) |
| `AppCard` | Single app card — title, description, category, Open button (disabled if not running) |
| `LoginForm` | Username/password form, shown as modal overlay |
| `FirstTimeSetup` | Initial admin account creation screen (shown when `userDB` is empty) |
| `OperatorManagement` | Operator-mode panel: list operators, add, remove, change password |

### New store module

`src/store/auth.ts` — client-side auth and user management:

- `currentUser` signal (`User | null`)
- `isOperator()` — derived: `currentUser() !== null`
- `isFirstTimeSetup(store)` — derived: `Object.keys(store.userDB).length === 0`
- `login(username, password, store)` — bcrypt compare, sets signal + storage
- `logout()` — clears signal + storage
- `restoreSession(store)` — validates stored session against `userDB` on mount
- `createOperator(username, password, handle)` — hash + `handle.change()` write
- `removeOperator(userId, handle)` — `handle.change()` delete
- `changePassword(userId, currentPassword, newPassword, store, handle)` — re-validate + hash + write

### Updated `App.tsx`

```
onMount:
  restoreSession(store)

Render:
  if !ready                    → null
  if shouldShowOnboarding      → <Onboarding />
  if isFirstTimeSetup(store)   → <FirstTimeSetup />
  else if isOperator()         → <OperatorLayout />   (NetworkTree + InstanceList + OperatorManagement)
  else                         → <AppBrowser />
```

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

Initialize `userDB` as an empty object `{}` on Store creation. The Console handles first-time
setup — no default admin account needed from the Engine.

### 2. No auth endpoints or CLI tools required

All user management is done by the Console writing directly to `userDB` in the Automerge
document. The Engine does not need to expose any auth API endpoints or CLI user management
commands.

### 3. Protect management write paths (future hardening)

For v1, Automerge write-back is unauthenticated — acceptable on a trusted school LAN. In a
future hardening pass, the Engine should verify that `userDB` mutations and command mutations
originate from authenticated clients. Mechanism TBD — not a blocker for v1.

---

## Open Questions

1. **Multi-Engine user sync** — `userDB` replicates via Automerge, so an operator created on
   one Engine appears on all peers. Assumed: this is the intended behaviour.

2. **App browser scope** — `AppBrowser` shows instances from `instanceDB`, which contains the
   full network view via Automerge sync — all Engines, not just the connected one. Assumed correct.

3. **Session TTL** — No automatic expiry for v1. Can be added if needed.

---

## Implementation Plan

| Phase | Work | Owner |
|---|---|---|
| 1 | Engine: add `userDB` to Store schema, initialise as `{}` | Axle |
| 1 | Console: `src/store/auth.ts`, update `App.tsx` routing, `LoginForm`, `FirstTimeSetup` | Pixel |
| 2 | Console: `AppBrowser` + `AppCard` components | Pixel |
| 2 | Console: `OperatorManagement` panel (add/remove/change password) | Pixel |
| 3 | Engine: harden write paths against unauthenticated mutations (future) | Axle |

Phase 1 (Console) can start once `userDB` shape is agreed with Axle. The mock store already
includes a stub `userDB`, so Console development does not block on the Engine.
