# Console UI — Technology Stack Decision

**Status:** Approved  
**Author:** Pixel (Console UI Developer)  
**Date:** 2026-03-29

---

## Context

The IDEA Console is the operator-facing interface for the Engine network. It gives a real-time
view of all connected engines, inserted App Disks, and running app instances — and lets operators
send commands to manage them.

The Console must:

- Reflect live Engine state with minimal latency — the Engine emits frequent small updates via
  its event stream, and the UI must update surgically in response
- Run offline — no internet, served over LAN from a local engine
- Run on any operating system used in schools (Windows, macOS, Linux, Chromebook)
- Run on low-end hardware — small payload, no heavy runtimes
- Be installable without an app store or internet connection
- Target school IT coordinators — not developers; clarity over cleverness

The primary delivery target is a **Chrome Extension**, installed directly from the local engine
server over LAN. This requires no internet, no app store, and works on any machine with Chrome
installed — which is the lowest common denominator across all school hardware.

---

## The Core Reactivity Requirement

The Engine exposes its state via an Automerge-backed document that changes continuously as
engines connect and disconnect, disks are inserted, and app instances start or stop.

The Console receives these changes as a stream of small, granular updates. The UI must reflect
each change immediately and precisely — only the affected component should re-render. A
framework that diffs the entire virtual DOM on each update would waste CPU cycles on low-end
machines and introduce unnecessary flicker.

**Fine-grained reactivity is a hard requirement, not a nice-to-have.** This is the primary
technical driver for framework selection.

---

## Options Considered

### Option A — Solid.js + Chrome Extension ✅ Selected

Solid.js uses a signal-based reactivity model. Unlike virtual DOM frameworks (React, Vue),
Solid compiles templates to real DOM operations at build time. When a signal changes, only
the exact DOM nodes that depend on that signal update — no diffing, no component tree
re-render, no wasted work.

This makes it the best match for the Engine's streaming update model: a change to a single
engine's status triggers an update to exactly the DOM node showing that status, and nothing
else.

**Bundle size:** ~7 KB (core runtime). Minimal overhead on low-end hardware.

**Chrome Extension:** Fully compatible. Solid.js outputs standard JS + HTML; it compiles to
no framework runtime in the extension context. Vite handles the extension build with standard
plugins (`vite-plugin-web-extension`).

**Offline:** All assets bundled into the extension. No CDN, no external dependencies at
runtime.

**Tradeoffs:**
- Smaller ecosystem than React
- Fewer ready-made component libraries (acceptable: our UI is simple and custom)
- Less familiar to contributors who know React — mitigated by Solid's React-like syntax

---

### Option B — React + Chrome Extension

React is the most widely used UI framework. It has a large ecosystem and extensive Chrome
Extension support.

**Reactivity model:** Virtual DOM. On each state change, React diffs the previous and next
virtual DOM trees and reconciles the result. For the Console's use case — many small, frequent
updates to distinct parts of the state — this is wasteful: every update triggers reconciliation
of the full component tree, even if only one value changed.

React 18's concurrent features and memoization (`useMemo`, `useCallback`, `React.memo`) can
reduce unnecessary renders, but require deliberate effort and add complexity.

**Bundle size:** ~45 KB (React + ReactDOM minified). Larger than Solid; not ideal for
low-end hardware.

**Verdict:** Capable, but the virtual DOM is a poor fit for the Engine's high-frequency, fine-grained
update stream. Would require significant memoization discipline to achieve what Solid does by
default.

---

### Option C — Svelte + Chrome Extension

Svelte is a compile-time framework: it generates minimal, framework-free JavaScript at build
time. There is no runtime library — the output is plain imperative DOM code.

**Reactivity model:** Compile-time reactive assignments. Svelte tracks which variables are
used in each template block and generates targeted update code. Similar in spirit to Solid,
but less granular: updates are scoped to component boundaries, not individual DOM nodes.

**Bundle size:** Near-zero runtime overhead. Very small output.

**Chrome Extension:** Compatible via Vite.

**Tradeoffs:**
- Smaller ecosystem than React or Solid
- Svelte 5's rune-based reactivity (released 2024) is more granular, but the paradigm shift
  is disruptive and community tooling is still maturing
- Less suitable for deeply nested reactive trees compared to Solid's signal graph

**Verdict:** A strong second choice. If Solid.js proves problematic in practice, Svelte is the
next candidate. Not selected because Solid's signal model is a closer match to the real-time
update pattern the Console requires.

---

### Option D — Vanilla JS / Web Components

No framework — hand-written DOM manipulation or Web Components using the browser's native
Custom Elements API.

**Reactivity:** Manual. Every update requires explicit DOM queries and mutations. For a small,
stable UI this is maintainable; for a live dashboard with dozens of independently updating
elements it becomes error-prone and hard to extend.

**Bundle size:** Smallest possible.

**Verdict:** Too much manual work for the complexity of the Console's real-time state. The
productivity cost outweighs the bundle size benefit.

---

### Option E — Flutter (Web or Mobile)

Flutter is Google's cross-platform framework targeting iOS, Android, macOS, Windows, Linux,
and Web (as a standalone app).

**Chrome Extension support:** None. Flutter does not compile to a Chrome Extension. Its web
output is a standalone HTML/JS app; it cannot produce the service workers, background scripts,
and Manifest V3 structure that Chrome Extensions require. This is a hard blocker.

**Antigravity (Google's AI-assisted Flutter IDE):** A developer tooling choice, not a deployment
target. It accelerates Flutter development but does not change what Flutter can deploy to.

**Bundle size:** Flutter Web adds a ~2–3 MB runtime (Skia/CanvasKit or HTML renderer). Not
appropriate for low-end hardware.

**Verdict:** Eliminated. Cannot produce a Chrome Extension. Larger runtime payload conflicts
with the low-bandwidth, low-end-hardware requirement.

---

## Comparison Summary

| | Solid.js | React | Svelte | Vanilla JS | Flutter |
|---|---|---|---|---|---|
| Fine-grained reactivity | ✅ Signal-based | ⚠️ Virtual DOM | ✅ Compile-time | ❌ Manual | N/A |
| Chrome Extension | ✅ | ✅ | ✅ | ✅ | ❌ |
| Bundle size | ~7 KB | ~45 KB | ~0 KB | ~0 KB | ~2–3 MB |
| Offline-first | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Ecosystem maturity | Medium | High | Medium | High | High |
| Fit for real-time updates | ✅ Best | ⚠️ Acceptable | ✅ Good | ❌ Fragile | ❌ |

---

## UI Component Framework

**Decision: No component library — custom CSS only.**

The Console UI requires a small, well-defined set of visual elements: a two-pane layout,
a tree list, status indicator dots, buttons, and a single onboarding dialog. This does
not justify a component library dependency.

**Rationale:**
- Every library adds bundle weight. On low-end hardware, payload size is a first-class
  constraint.
- The Solid.js component library ecosystem is young. Dependency risk outweighs the benefit
  for a UI of this complexity.
- Custom CSS is fully auditable, has no CDN dependency, and requires no extra build step.
- The design principle is "keep it minimal" — a component library conflicts with this
  from day one.

A small set of project-local utility CSS classes (layout, status colours, tree
indentation, typography) covers all visual needs for v1.

**If this decision should be revisited:**
[Kobalte](https://kobalte.dev) is the best current option in the Solid.js ecosystem —
headless (unstyled), accessible, signal-native. Appropriate if drag-and-drop or complex
keyboard navigation is added in a later version.

---

## Future: Mobile Reach Without a Second Codebase

If mobile access for operators becomes a requirement, the recommended path is to add
**Progressive Web App (PWA)** support to the same Solid.js codebase:

- The Console is already served locally by the engine over LAN
- A PWA manifest + service worker makes it installable on iOS and Android as a home-screen app
- No app store, no internet required for installation
- The Chrome Extension and PWA share the same application code — no duplication

This means Solid.js + Chrome Extension + PWA gives us desktop, browser, and mobile from
a single codebase. Flutter cannot achieve this because it cannot produce a Chrome Extension.

---

## Decision

**Selected: Solid.js + Chrome Extension (Manifest V3)**

Rationale:
1. Fine-grained signal-based reactivity is the correct match for the Engine's streaming
   update model — updates propagate to exactly the affected DOM nodes, nothing more
2. Smallest framework runtime of the DOM-based options — appropriate for low-end hardware
3. Full Chrome Extension compatibility via standard Vite build tooling
4. PWA path available for future mobile reach from the same codebase
5. No framework dependency at runtime in the extension context — the compiled output is
   standard JS

---

## Open Questions

None at time of writing. This document captures an active decision made before the
architecture doc (backlog task: *Document Console architecture: Solid.js, Chrome Extension,
Engine API contract*) is written. That architecture doc should reference this design as the
source of the tech stack rationale.
