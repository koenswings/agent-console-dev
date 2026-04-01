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
- A grid of app cards — one per running instance on the network
- Each card: app title, short description, category, and an **Open** button
- Clicking **Open** navigates to the app at `http://<engine-hostname>:<port>`
- A small **Log in** link in the status bar (unobtrusive — not the focus of the UI)
- Apps that are not running are either hidden or shown as unavailable (TBD — see Open Questions)

**What the user cannot see or do:**
- Engine/disk/instance management controls
- System health or network topology
- Any management action (start, stop, eject)

### Operator Mode (after login)

When an operator authenticates, the Console switches to operator mode in the same session.

**What the operator sees:**
- Full current Console: NetworkTree, InstanceList, instance controls (start/stop/eject)
- A **Log out** button in the status bar
- Operator identity shown in the status bar

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
  engineDB:  Record<EngineID,  Engine>;
  diskDB:    Record<DiskID,    Disk>;
  appDB:     Record<AppID,     App>;
  instanceDB: Record<InstanceID, Instance>;
  userDB:    Record<UserID,   User>;   // NEW
}
```

`userDB` is part of the shared Automerge document, so operator accounts replicate across the
Engine network automatically.

---

## Authentication Flow

Authentication uses a lightweight REST API on the Engine's HTTP server (port 80).
The Automerge WebSocket is read-only from the Console side — auth state is managed separately.

### Login

```
POST /api/auth/login
Body: { "username": "admin", "password": "..." }
Response 200: { "token": "<session-token>", "user": { "id", "username", "role" } }
Response 401: { "error": "Invalid credentials" }
```

The Console stores the token in `chrome.storage.local` (extension) or `localStorage` (web),
keyed as `operatorToken`. On subsequent page loads the Console checks for a stored token and
calls `GET /api/auth/me` to restore the session without re-entering credentials.

### Token validation

```
GET /api/auth/me
Header: Authorization: Bearer <token>
Response 200: { "id", "username", "role" }
Response 401: token invalid or expired
```

### Logout

```
POST /api/auth/logout
Header: Authorization: Bearer <token>
Response 200: {}
```

Clears the stored token from local storage. Console returns to user mode.

### Token handling in management requests

All management API calls (future REST API for start/stop/eject, if added) include the
`Authorization: Bearer <token>` header. The Automerge command write-back (`engine.commands[]`)
will also need to be gated behind operator auth — see Engine requirements below.

---

## Console Component Changes

### New components

| Component | Purpose |
|---|---|
| `AppBrowser` | User mode: grid of app cards with Open buttons |
| `AppCard` | Single app card (title, description, category, Open button) |
| `LoginForm` | Username/password form shown as overlay or inline panel |

### New store module

`src/store/auth.ts` — manages auth state:
- `authToken` signal (string | null)
- `currentUser` signal (User | null)
- `login(username, password)` — calls `POST /api/auth/login`, stores token
- `logout()` — calls `POST /api/auth/logout`, clears token
- `restoreSession()` — calls `GET /api/auth/me` on mount if token is present
- `isOperator()` derived signal — `currentUser() !== null`

### Updated `App.tsx`

```
onMount:
  restoreSession()  →  sets currentUser if token is valid

Render:
  if !ready → null
  if shouldShowOnboarding → <Onboarding />
  else if isOperator() → <OperatorLayout />   (current NetworkTree + InstanceList)
  else → <AppBrowser />                        (new user-mode layout)
```

The mode switch is fully reactive — no page reload required when login/logout fires.

### Status bar

- User mode: `IDEA Console` title + connection indicator + **Log in** link (small)
- Operator mode: `IDEA Console` title + connection indicator + username + **Log out** button
- Demo badge shown in both modes when active

---

## Requirements for the Engine (Axle)

_Document only — do not involve Axle yet._

### 1. Add `userDB` to the Store

Extend the Automerge document schema:

```ts
userDB: Record<UserID, User>
```

`User` fields: `id`, `username`, `passwordHash` (bcrypt), `role: 'operator'`, `created: Timestamp`.

The `userDB` replicates across the network with the rest of the Store. Password hashes are
safe to replicate — plaintext passwords never enter the Store.

### 2. Auth endpoints on Engine HTTP server (port 80)

| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Validate credentials, return session token |
| POST | `/api/auth/logout` | Bearer token | Invalidate session |
| GET | `/api/auth/me` | Bearer token | Return current user from token |

Session tokens can be JWTs (stateless) or server-side sessions — Axle's choice, but JWT is
preferred to avoid shared session state across Engine nodes.

### 3. Protect management write paths

Once auth is in place, the Engine's command processing should reject `engine.commands[]`
mutations from unauthenticated Automerge clients. The mechanism for this is TBD — the
Automerge protocol itself does not carry auth headers, so this may require an out-of-band
check or a separate auth-gated REST endpoint for management commands.

**Note:** This is a security hardening requirement, not a blocker for the first iteration.
For v1, command write-back without auth is acceptable given the school LAN context.

### 4. Serve `userDB` in the Automerge Store

The Console reads `userDB` from the Store for display purposes (e.g. showing the logged-in
username). No Console-side write to `userDB` — user management (add/remove operators) is an
Engine-side admin operation for v1.

---

## Open Questions

1. **Stopped apps in user mode** — Should apps with `status !== 'Running'` be hidden entirely,
   or shown as greyed-out ("not available right now")? Greyed-out is more transparent but may
   confuse students. Recommendation: hide for v1.

2. **Session token TTL** — How long should an operator session last? Suggestion: 8 hours
   (school day), with an option to extend. Schools with multiple shifts may want shorter TTL.

3. **Password reset** — No internet means no email reset flow. Operators should be able to
   reset another operator's password via CLI on the Engine host, or via a local admin tool.
   This is an Engine-side concern.

4. **Multi-Engine user sync** — `userDB` replicates via Automerge, so an operator account
   created on one Engine will appear on all peers. Is that the intended behaviour? Assumed yes.

5. **First-time setup** — How is the first operator account created? Suggestion: Engine creates
   a default admin account on first boot with a known default password, printed to the console
   log. Must be changed on first login.

---

## Implementation Plan

| Phase | Work | Owner |
|---|---|---|
| 1 | Engine: add `userDB` to Store, auth endpoints | Axle |
| 1 | Console: update `Store` type, add `auth.ts`, update `App.tsx` routing | Pixel |
| 2 | Console: build `AppBrowser` + `AppCard` components | Pixel |
| 2 | Console: `LoginForm` component + status bar updates | Pixel |
| 3 | Engine: protect management write paths | Axle |
| 3 | Console: attach token to management calls | Pixel |

Phase 1 and 2 can proceed in parallel once Axle confirms the auth API contract.
