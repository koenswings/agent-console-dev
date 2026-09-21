# Proposals Index — Console (agent-console-dev)

Ideas seeking or having sought a decision in the Console repo. See `koenswings/idea/proposals/README.md` for format and lifecycle.

---

## console-tech-stack.md
**Status:** Approved · **Author:** Pixel
Framework comparison and decision: Solid.js + Chrome Extension (now web app primary), no component library, light theme default.

## console-build-deployment-testing.md
**Status:** Approved · **Author:** Pixel
Build workflow, three deployment contexts (dev / extension / production web), testing scope.

## console-user-management.md
**Status:** Implemented · **Author:** Pixel
Dual-mode UI (user/operator), user data model in Store, auth flow, Engine requirements.

## backup-disk-console.md
**Status:** Proposed · **Author:** Pixel
Backup Disk creation from Empty Disk, on-demand backup trigger, lastBackup display, Engine dependencies.

## engine-auto-discovery.md
**Status:** Implemented · **Author:** Pixel
Auto-discover Engine hostname on first load by probing candidate names on the LAN.

## fine-grained-reactivity.md
**Status:** Implemented · **Author:** Pixel
ID-keyed For loops + accessor props for surgical per-row re-renders. No full-list reconciliation on Automerge events.

## onboarding-redesign.md
**Status:** Proposed · **Author:** Pixel
Redesign of the initial onboarding and settings flow.

## rewrite-plan.md
**Status:** Implemented · **Author:** Pixel
Plan for the fine-grained reactivity overhaul (PR #25). 112 tests passing.

## ui-design.md
**Status:** Reference · **Author:** Pixel
UI design notes: layout, component structure, mobile mockups.
