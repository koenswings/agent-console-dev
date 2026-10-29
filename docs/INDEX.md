# Authoritative Documentation Index — Pixel (agent-console-dev)

This index lists the authoritative docs for the Console. Org-level docs are in [`koenswings/idea` → docs/INDEX.md](https://github.com/koenswings/idea/blob/main/docs/INDEX.md). On a fleet Pi, that file is at `../../docs/INDEX.md` from this checkout.

Update this file whenever a doc in `docs/` is added, removed or significantly revised. `docs/` holds only `.md`, `.pdf`, `.png` and `.svg` files, never source.

---

## Docs in `docs/`

| Doc | Description | Status |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Console architecture: deployment contexts, dual-mode UI, components, store layer, data types, mock mode, build, Engine API contract (the Chrome Extension is legacy) | Current |
| [INDEX.md](INDEX.md) | This index | Current |

## Related (outside `docs/`)

| Doc | Description |
|---|---|
| [../README.md](../README.md) | What the Console is, its two audiences, and how to run it |
| [../AGENTS.md](../AGENTS.md) | Build, test, deploy and QC rules for the Console Dev bot. Read it at the start of every task |
| [../e2e/intents/README.md](../e2e/intents/README.md) | Duration-test intent adapters (Playwright) and their Engine wiring |
| [../proposals/INDEX.md](../proposals/INDEX.md) | Proposals and historical design reasoning (not authoritative); format in [../proposals/README.md](../proposals/README.md) |
