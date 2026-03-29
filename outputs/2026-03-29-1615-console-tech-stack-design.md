> **Task/Question:** Write a design doc explaining the technology stack choice for the Console UI. Include other technology stack options and a comparison. Document that Solid.js is chosen because of fine-grained reactivity matching the Engine's streaming update model. Add conclusions.

## What was done

Wrote `design/001-console-tech-stack.md` — the Console UI technology stack design doc.

**PR:** https://github.com/koenswings/agent-console-dev/pull/12

## Decisions captured in the doc

- **Selected:** Solid.js + Chrome Extension (Manifest V3)
- **Core rationale:** Solid.js signal-based reactivity is the precise match for the Engine's Automerge-backed streaming update model — only the affected DOM nodes update on each event, no virtual DOM diffing, no wasted work on low-end hardware
- **Flutter eliminated:** Cannot produce a Chrome Extension — hard blocker
- **Mobile path:** PWA on top of the same Solid.js codebase (no second codebase needed)

## Options compared

| Framework | Reactivity | Extension | Bundle | Verdict |
|---|---|---|---|---|
| Solid.js | Signal-based (fine-grained) | ✅ | ~7 KB | Selected |
| React | Virtual DOM | ✅ | ~45 KB | Capable but wrong model |
| Svelte | Compile-time | ✅ | ~0 KB | Strong second choice |
| Vanilla JS | Manual | ✅ | ~0 KB | Too fragile at scale |
| Flutter | N/A | ❌ | ~2–3 MB | Eliminated |

## Context

Koen challenged the existing Solid.js assumption, asking whether Flutter + Antigravity was worth evaluating. Conclusion: Flutter cannot target Chrome Extensions (hard blocker), and Antigravity is a dev tooling choice (AI IDE), not a deployment target. The analysis confirmed Solid.js is the right call.

The design doc should be read before the architecture doc task is started.
