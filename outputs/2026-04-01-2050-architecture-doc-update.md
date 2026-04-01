> **Task/Question:** Do the architecture update

## What was done

Updated `docs/ARCHITECTURE.md` on branch `feature/architecture-doc` (PR #16). Rebased onto main to include all changes from PRs #18 and #19.

### Changes from original doc

- Opening: "operator-facing" → dual-mode (users + operators)
- Deployment contexts: `consolePath` config documented; `GET /api/store-url` marked as implemented
- Added: Dual-Mode UI section (user mode / operator mode / first-time setup)
- Component structure: added AppBrowser, AppCard, LoginForm, FirstTimeSetup, OperatorManagement, auth.ts
- App.tsx routing: updated to reflect mode-based routing
- StoreConnection: added `changeDoc`
- Added: full `auth.ts` module documentation (signals, all exports)
- Data types: added `userDB` and `User` to Store schema
- Demo mode: empty `userDB` by default, localStorage persistence documented
- Build: test count 81 → 111; bcryptjs noted
- Engine API contract: added `userDB` write-back; `GET /api/store-url` marked implemented; Console static file serving section added

## Output
- PR #16: https://github.com/koenswings/agent-console-dev/pull/16
