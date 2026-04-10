# Console UI — Design Docs Index

| File | Status | Summary |
|---|---|---|
| `001-console-tech-stack.md` | Approved | Framework comparison and decision: Solid.js + Chrome Extension, no component library, light theme default |
| `002-console-build-deployment-testing.md` | Approved | Build workflow, three deployment modes (dev / extension / production web), testing scope |
| `003-console-user-management.md` | Proposed | Dual-mode UI (user/operator), user data model in Store, auth flow, Engine requirements |
| `004-engine-auto-discovery.md` | Proposed | Auto-discover Engine hostname on first load by probing candidate names (appdocker01, idea01, engine01, …) |
| `005-fine-grained-reactivity.md` | Implemented | ID-keyed `<For>` + accessor props for surgical per-row re-renders instead of full-list reconciliation on every Automerge event |
