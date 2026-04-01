> **Task/Question:** Document the UI component choice in the tech stack design doc and document everything else (setup, dev and build, testing scope) in a new design document. Start implementation after I approve the design docs.

## What was done

Updated `design/001-console-tech-stack.md`:
- Status changed from Proposed → Approved (PR #12 merged)
- Added UI Component Framework section: no library, custom CSS only. Rationale: bundle size, complexity, design principle "keep it minimal". Kobalte noted as future option if drag-and-drop is added.

Created `design/002-console-dev-setup-and-testing.md`:
- Project directory structure
- Dev workflow: `pnpm dev` (host: true) → Tailscale access at `http://<pi-tailscale-ip>:5173`
- Build + package: `pnpm build` → `pnpm package` (zip + serve on port 8080 for download)
- Extension install steps: download zip from Pi, unzip locally, load unpacked in Chrome
- Engine connection: WebSocket port 4321, document URL open question flagged (needs Axle cross-agent task)
- Testing scope: unit tests (store logic, status logic, commands), component tests (Solid Testing Library), mock Engine (2 engines, 3 disks, 5 instances in varied states), Playwright E2E (headless on Pi, screenshots to test-results/)
- What requires manual verification (real Engine + docked App Disk)
- Commands reference table

**PR:** https://github.com/koenswings/agent-console-dev/pull/14

## Next step

Waiting for Koen to approve PR #14. On merge, implementation begins on `feature/console-ui-v1`.
Also need to raise Axle cross-agent task for `GET /api/store-url` Engine endpoint.
