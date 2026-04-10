# Design 005 — Fine-grained Reactivity

**Status:** Proposed
**Author:** Pixel
**Date:** 2026-04-10

---

## Problem

The Console UI is fully reactive — no displayed data ever goes stale. But it is
**coarse-grained**: any change to the Automerge store causes every engine row,
every disk row, and every instance row to re-render, regardless of what actually
changed.

Root cause: Automerge produces entirely new object references on each document
change. Solid's `<For>` defaults to reference equality for item identity. New
references → `<For>` treats every item as replaced → destroys and recreates all
item scopes → all render callbacks fire.

On low-end school hardware (Pi 4, 4GB RAM) running 10+ instances, this means
full DOM reconciliation on every Automerge heartbeat (~30s) and on every
command. The UI stays correct but wastes CPU cycles that the Engine also needs.

---

## Goal

Make re-rendering proportional to what changed:
- One instance status changes → only that instance row re-renders
- One engine heartbeat ticks → only that engine's online/offline badge re-renders
- A new disk is docked → only the new disk row is added; existing rows untouched

---

## Approach: ID-keyed `<For>` with per-row accessors

### Core pattern

Instead of iterating over object values (snapshots), iterate over **IDs** and
let each row derive its own slice reactively:

```tsx
// Before: iterates over snapshots
<For each={Object.values(store()?.instanceDB ?? {})}>
  {(instance) => <InstanceRow instance={instance} />}
</For>

// After: iterates over IDs; each row reads its own slice
<For each={Object.keys(store()?.instanceDB ?? {})}>
  {(id) => (
    <InstanceRow
      instance={() => store()?.instanceDB[id]}
    />
  )}
</For>
```

When `store()` updates but `Object.keys(store().instanceDB)` returns the same
IDs (same order), Solid's `<For>` reuses all existing scopes — zero item
re-renders. Only the reactive expressions INSIDE each row that actually read the
changed field will update.

### ID stability

`Object.keys()` returns strings. String identity is stable — Solid can reuse
scopes across store updates. Only genuinely added/removed IDs cause scope
creation/destruction.

---

## Component changes

### 1. `InstanceRow`

Change all props from plain values to accessors:

```tsx
interface InstanceRowProps {
  instance:   () => Instance | undefined;
  app:        () => App | undefined;
  engine:     () => Engine | undefined;
  backupDisk: () => Disk | undefined;
}
```

Access via `props.instance()?.status`, `props.app()?.title`, etc. Solid tracks
these reads and surgically updates only the affected DOM nodes.

### 2. `InstanceList`

Replace the `<For>` body:

```tsx
// Derive the ordered list of IDs reactively
const instanceIds = createMemo((): string[] => {
  const s = props.store();
  if (!s) return [];
  return getInstanceIdsForSelection(s, props.selection);
});

<For each={instanceIds()}>
  {(id) => {
    // Each accessor reads fresh from the store on access
    const instance = () => props.store()?.instanceDB[id];
    const app      = () => {
      const inst = instance();
      return inst ? props.store()?.appDB[inst.instanceOf] : undefined;
    };
    const engine     = () => resolveEngine(props.store(), instance());
    const backupDisk = () => resolveBackupDisk(props.store(), instance());

    return (
      <Show when={instance()}>
        <InstanceRow
          instance={instance}
          app={app}
          engine={engine}
          backupDisk={backupDisk}
        />
      </Show>
    );
  }}
</For>
```

Add a pure helper `getInstanceIdsForSelection` alongside the existing
`getInstancesForSelection` — same logic, returns `string[]` instead of
`Instance[]`.

### 3. `NetworkTree`

Same treatment for engines and disks:

```tsx
const engineIds = createMemo(() =>
  Object.keys(store()?.engineDB ?? {})
);

<For each={engineIds()}>
  {(engineId) => {
    const engine = () => store()?.engineDB[engineId];
    const online = () => {
      const e = engine();
      return e ? isEngineOnline(e) : false;
    };
    const diskIds = createMemo(() =>
      Object.keys(store()?.diskDB ?? {}).filter(
        (id) => store()?.diskDB[id]?.dockedTo === engineId
      )
    );

    return (
      <Show when={engine()}>
        {/* engine row — only re-renders when engine() changes */}
        <div class="tree-item tree-item--engine ...">
          <span>{engine()?.hostname}</span>
          <span class={online() ? '...--online' : '...--offline'}>
            {online() ? 'online' : 'offline'}
          </span>
        </div>

        <For each={diskIds()}>
          {(diskId) => {
            const disk = () => store()?.diskDB[diskId];
            return (
              <Show when={disk()}>
                {/* disk row */}
              </Show>
            );
          }}
        </For>
      </Show>
    );
  }}
</For>
```

The online/offline badge now only re-renders when `engine().lastRun` actually
changes — not on every unrelated store update.

### 4. `AppBrowser`

Same pattern:

```tsx
const instanceIds = createMemo(() =>
  Object.entries(props.store()?.instanceDB ?? {})
    .filter(([, inst]) => inst.status === 'Running')
    .map(([id]) => id)
);

<For each={instanceIds()}>
  {(id) => {
    const instance = () => props.store()?.instanceDB[id];
    const app      = () => {
      const inst = instance();
      return inst ? props.store()?.appDB[inst.instanceOf] : undefined;
    };
    const hostname = () => resolveHostname(props.store(), id);
    return (
      <AppCard instance={instance} app={app} engineHostname={hostname} />
    );
  }}
</For>
```

`AppCard` props become accessors accordingly.

---

## `signals.ts` cleanup

- Remove `initStoreSignal` (dead code — App.tsx calls `setStoreSignal` directly)
- Keep `setStoreSignal` / `_store` for NetworkTree's global access, or pass
  `store: Accessor<Store|null>` as a prop to NetworkTree to eliminate the global
  signal entirely (preferred — one source of truth in App.tsx)
- `disksForEngine`, `instancesForDisk` can be removed once components use the
  ID-keyed pattern above (they read `_store` which would be redundant)
- `engines()` can be replaced by an ID accessor in NetworkTree

---

## What does NOT change

- The Automerge connection layer (engine.ts) — no change needed
- The `store` signal in App.tsx — stays as-is
- `commands.ts` — no change
- `auth.ts` — no change
- All existing tests — component interfaces change (props become accessors), so
  tests need updates, but the test structure (inject mock store, assert output)
  stays the same

---

## Migration path

1. Add `getInstanceIdsForSelection` to `signals.ts`
2. Refactor `InstanceRow` props to accessors + update its tests
3. Refactor `InstanceList` to ID-keyed `<For>` + update its tests
4. Refactor `NetworkTree` to ID-keyed `<For>` + update its tests
5. Refactor `AppBrowser` + `AppCard` to accessors
6. Clean up `signals.ts` (remove dead exports)
7. Pass `store` prop to `NetworkTree` from App.tsx; remove global `_store` path

Each step is independently testable and shippable. Steps 1–4 deliver the core
benefit; steps 5–7 are cleanup.

---

## Trade-offs

| | Current | Proposed |
|---|---|---|
| Re-render scope | All rows on any change | Only changed row |
| Solid.js alignment | Coarse signal | Fine-grained accessors |
| Prop types | Plain values | Accessor functions |
| Call site ergonomics | `props.instance.status` | `props.instance()?.status` |
| Test setup complexity | Low (pass plain objects) | Slightly higher (wrap in `()=>`) |
| Automerge compatibility | Works by accident | Works by design |

The accessor syntax (`props.instance()?.status`) is a mild ergonomic cost. It's
idiomatic Solid.js and consistent with how Solid signals always work elsewhere
in the codebase.

---

## Risk

Low. The change is additive at the component level (new prop interface → update
call sites → update tests). The connection layer, auth, and command paths are
untouched. The existing behaviour (full re-render) can only get better.
