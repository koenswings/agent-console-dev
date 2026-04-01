> **Task/Question:** Update design docs and identity files: Console is not only for operators — it is primarily the UI for users (students, teachers). Add user management design with dual-mode UI, users in Store, Engine requirements.

## What was done

### Scope correction
- `AGENTS.md` updated: Console is now described as the primary user interface for all users, with operators as authenticated users who unlock management functions.
- `IDENTITY.md` already correct ("teacher and student UI for offline learning systems") — no change needed.

### Design doc 003 written (`design/003-console-user-management.md`)
Covers:
- **Dual-mode UI:** user mode (default, no login — app browser) and operator mode (after login — full management)
- **User/operator data model:** `User` entity with id, username, passwordHash (bcrypt), role: 'operator', created. Stored in `userDB` in the Engine's Automerge Store.
- **Authentication flow:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` on Engine HTTP port 80. Token stored in chrome.storage.local / localStorage.
- **Console component changes:** new `AppBrowser`, `AppCard`, `LoginForm`, `src/store/auth.ts`; updated `App.tsx` routing
- **Engine requirements (for Axle, not yet sent):** add userDB to Store, auth endpoints, protect management write paths
- **Open questions:** stopped apps visibility, session TTL, password reset, first-time setup
- **Phased implementation plan**

### Code changes (type-level only)
- `src/types/store.ts`: added `User`, `UserID`, `Username`, `PasswordHash` types and `userDB` to `Store`
- `src/mock/mockStore.ts`: added mock operator to satisfy updated `Store` type

### Tests
81/81 passing after type changes.

## Outputs
- PR #18: https://github.com/koenswings/agent-console-dev/pull/18

## Next steps
1. Koen reviews/merges PR #16 (architecture doc) and PR #18 (user management design)
2. Send Engine requirements to Axle once design approved
3. Implement user mode UI: AppBrowser, AppCard, LoginForm, auth.ts
