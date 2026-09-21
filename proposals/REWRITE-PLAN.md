# IDEA Console — Rewrite Plan

**Date:** 2026-04-25  
**Context:** Login modal does not dismiss after successful login. This is a persistent bug that has been "fixed" multiple times (batch(), disposal-order guards, Portal, Switch/Match, post-finally callback patterns) without lasting success. The root cause is deeper than individual patches.

---

## The Real Problem

The login bug is a symptom of a deeper issue: **I do not have sufficient mastery of SolidJS's fine-grained reactivity model to safely author this app.**

Solid's reactive system — `createSignal`, `createEffect`, `Show`, `Switch/Match` — has strict rules:
- Reactive reads are only tracked inside *owner contexts*
- `Show`/`Switch` destroy and recreate DOM/component trees when their condition changes
- Writing to signals that affect an ancestor `Show` while you are still inside it destroys your reactive root
- `batch()` defers signal notifications, but does not change which component owns what

These rules are well-documented but subtle in practice. An engineer who uses Solid daily internalises them. I do not. The result: I keep writing patches that seem correct but break other invariants.

---

## Two Options

### Option A: Learn Solid Properly, Then Rewrite

**What this means:**
1. Deep-read the Solid documentation: reactivity primitives, ownership model, control flow components, stores vs signals, `untrack`, `batch`, cleanup
2. Write a small isolated test harness (outside this app) to validate my understanding of the specific pattern causing the bug
3. Once I can prove I understand the model, do a clean rewrite of the login/auth flow specifically — not the whole app
4. Then continue building on Solid

**Pros:**
- No framework migration cost
- Existing component logic (InstanceRow, NetworkTree, etc.) is mostly fine — the bug is localised to auth/modal state
- Solid's performance and fine-grained reactivity are genuinely good for this use case (live synced store data)
- Community is smaller but documentation is solid (pun intended)

**Cons:**
- I might keep hitting edge cases I don't anticipate
- The learning investment is real — and I'm the one paying it, not Koen

**Verdict:** Viable if I can demonstrate I understand the specific failure mode before touching production code.

---

### Option B: Switch Framework

Migrate from SolidJS to a more mainstream fine-grained reactive framework with a larger user base and more documented real-world usage.

**Candidate frameworks:**

| Framework | Users | Reactivity model | Notes |
|---|---|---|---|
| **Vue 3 (Composition API)** | Huge | `ref()` / `reactive()` / `computed()` / `watch()` | Most documented, largest community after React. Fine-grained but forgiving — no ownership traps. `v-if` / `v-show` are straightforward. |
| **Svelte 5 (Runes)** | Large, growing | `$state` / `$derived` / `$effect` | Compile-time reactivity, minimal runtime. Very clean syntax. `{#if}` blocks are safe. |
| **Preact Signals** | Medium | `signal()` / `computed()` / `effect()` | Works with JSX like React/Solid. Signals are framework-agnostic primitives. Less "gotcha" than Solid. |
| **React + Zustand/Jotai** | Enormous | Component re-renders + atomic state | The safe default. Less elegant than signals but zero surprises. Massive ecosystem. |

**Recommended if we switch: Vue 3**

Reasons:
- Most real-world documentation for exactly the patterns we use (conditional rendering, modal state, async auth flows)
- `v-if`/`v-show` do exactly what they look like — no ownership model to fight
- Composition API is comparable in structure to SolidJS
- Large enough community that any bug I hit has a StackOverflow answer

**Migration cost estimate:**
- ~2–3 days of Claude Code work
- Components are logically clean, just need syntax translation
- The store layer (`automerge-repo` connection, commands) is framework-agnostic — stays as-is
- Tests would need rewriting (Playwright e2e tests stay; Vitest unit tests need updating)

**Cons:**
- Full migration is disruptive
- Vue's template syntax vs JSX is a style change
- If we hit framework-specific bugs in Vue, same problem recurs

---

## My Recommendation

**Option A first, with a hard deadline.**

Specifically:
1. I write a small isolated Solid test proving I understand the modal-dismiss pattern
2. If I can fix it cleanly in isolation → apply the fix, close the bug, keep Solid
3. If I cannot demonstrate a clean fix within one focused session → switch to Vue 3

This avoids a full migration for what might be a solvable problem, while setting a clear exit condition if it isn't.

The UI Design doc (`UI-DESIGN.md`) is framework-agnostic and remains valid either way.

---

## Next Steps

1. **Koen reviews this plan** and picks Option A or B (or sets the deadline for Option A)
2. **Screenshots added to UI-DESIGN.md** (see screenshot checklist at end of that doc)
3. **Option A:** Pixel writes isolated Solid test → fixes auth modal → confirms with Playwright
4. **Option B:** Pixel scopes Vue migration → Claude Code implements → Playwright tests validate

---

## What Is NOT Changing

Regardless of framework choice:
- The UI design (screens, flows, components) — documented in `UI-DESIGN.md`
- The store/engine layer (`automerge-repo`, `commands.ts`, `discovery.ts`)
- The deployment target (web-first, served from engine HTTP server)
- The Playwright e2e test structure (login flow, demo mode, settings)
