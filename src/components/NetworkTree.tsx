import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor, type Component } from 'solid-js';
import { isEngineOnline } from '../store/signals';

// Reactive clock — ticks every 15 s so online badges flip promptly
const [now, setNow] = createSignal(Date.now());
const _clockInterval = setInterval(() => setNow(Date.now()), 15_000);
import { ejectDisk, rebootEngine } from '../store/commands';
import { isDiskLocked } from '../store/operations';
import { EJECT_TIMEOUT_MS, findEjectOutcome, traceIdSnapshot } from '../store/ejectResult';
import type { CommandLogState } from '../store/commandLog';
import type { Disk, Store, UnformattedDisk } from '../types/store';
import { formatBytes } from '../store/diskRoles';
import { canEject, isCombinedDisk, unmountWarningDiskIds, unmountWarningText } from '../store/diskRoles';
import EjectConfirm from './EjectConfirm';
import RoleBadges from './RoleBadges';
import type { DragAppData } from '../types/drag';
import { DRAG_TYPE } from '../types/drag';

// Eject rule and role badges live in ../store/diskRoles (idea#132).
export { canEject };

/**
 * Per-disk eject feedback (idea#152).
 *   pending — eject sent; waiting for a new ejectDisk trace after `baseline`
 *   error   — the Engine reported a failure (message shown inline)
 *   timeout — no trace within EJECT_TIMEOUT_MS
 */
type EjectState =
  | { kind: 'idle' }
  | { kind: 'pending'; baseline: Set<string> }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

// ---------------------------------------------------------------------------
// Selection type
// ---------------------------------------------------------------------------
export interface Selection {
  type: 'network' | 'engine' | 'disk' | 'unformatted';
  id: string;
  /** Required when type is 'unformatted' (the Engine that published the candidate). */
  engineId?: string;
}

interface NetworkTreeProps {
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Reactive store accessor — passed from App.tsx */
  store: () => Store | null;
  /** Current drag payload — set by App when a row drag starts. */
  dragData: () => DragAppData | null;
  /** Called when an app is dropped onto a disk. */
  onDrop: (data: DragAppData, targetDiskId: string) => void;
  /** Engine command log — used to surface eject failures inline. */
  commandLogStore?: Accessor<CommandLogState>;
}

// ---------------------------------------------------------------------------
// NetworkTree component
// ---------------------------------------------------------------------------
const NetworkTree: Component<NetworkTreeProps> = (props) => {
  const isSelected = (type: Selection['type'], id: string): boolean =>
    props.selection.type === type && props.selection.id === id;

  // ID list — stable strings so <For> reuses scopes on store updates
  const engineIds = createMemo(() =>
    Object.keys(props.store()?.engineDB ?? {})
  );

  // Local drop-target highlight state
  const [dropTargetDiskId, setDropTargetDiskId] = createSignal<string | null>(null);

  return (
    <nav class="network-tree" aria-label="Network tree" data-testid="network-tree">
      <div class="network-tree__header">Network</div>

      {/* ── "All apps" row ──────────────────────────────────────── */}
      <div
        class={`tree-item tree-item--network ${isSelected('network', '') ? 'tree-item--selected' : ''}`}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected('network', '')}
        onClick={() => props.onSelect({ type: 'network', id: '' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            props.onSelect({ type: 'network', id: '' });
          }
        }}
      >
        <span class="tree-item__icon">🌐</span>
        <span class="tree-item__label">All apps</span>
      </div>

      {/* ── Per-engine rows ──────────────────────────────────────── */}
      <For each={engineIds()}>
        {(engineId) => {
          const engine = () => props.store()?.engineDB[engineId];
          const online = () => {
            const e = engine();
            return e ? isEngineOnline(e, now()) : false;
          };

          // Disk IDs docked to this engine
          const diskIds = createMemo(() =>
            Object.keys(props.store()?.diskDB ?? {}).filter(
              (id) => String(props.store()?.diskDB[id]?.dockedTo) === engineId
            )
          );

          // Stuck unmounts on this Engine, by unmountError.engineId: an undocked
          // disk has dockedTo null and would otherwise appear nowhere (idea#157).
          const unmountIds = createMemo(
            () => unmountWarningDiskIds(props.store(), engineId),
            [],
            { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) }
          );

          return (
            <Show when={engine()}>
              <div
                data-testid={`engine-${engineId}`}
                data-engine-id={engineId}
                class={`tree-item tree-item--engine ${isSelected('engine', engineId) ? 'tree-item--selected' : ''}`}
                role="treeitem"
                tabIndex={0}
                aria-selected={isSelected('engine', engineId)}
                onClick={() => props.onSelect({ type: 'engine', id: engineId })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    props.onSelect({ type: 'engine', id: engineId });
                  }
                }}
              >
                <span class="tree-item__icon tree-item__icon--engine">
                  <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden="true" style="display:block">
                    <rect x="1" y="2" width="14" height="4" rx="1"/>
                    <rect x="1" y="8" width="14" height="4" rx="1"/>
                    <circle cx="12.5" cy="4" r="0.9"/>
                    <circle cx="12.5" cy="10" r="0.9"/>
                  </svg>
                </span>
                <span class="tree-item__label">{engine()?.hostname}</span>
                <button
                  class="tree-item__reboot-btn"
                  title={`Reboot ${engine()?.hostname}`}
                  aria-label={`Reboot engine ${engine()?.hostname}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const eng = engine();
                    if (eng && confirm(`Reboot ${eng.hostname}?`)) {
                      rebootEngine(eng.id);
                    }
                  }}
                >
                  ↺
                </button>
                <span
                  class={`tree-item__status-dot ${online() ? 'tree-item__status-dot--online' : 'tree-item__status-dot--offline'}`}
                  title={online() ? 'Online' : 'Offline'}
                  aria-label={online() ? 'Online' : 'Offline'}
                />
              </div>

              {/* ── Stuck-unmount warnings (all disk types, idea#157) ── */}
              <For each={unmountIds()}>
                {(diskId) => (
                  <Show when={props.store()?.diskDB[diskId]}>
                    {(d) => (
                      <div class="tree-item__unmount-warning" role="alert" data-engine-id={engineId} data-unmount-disk-id={diskId}>
                        {unmountWarningText(d())}
                      </div>
                    )}
                  </Show>
                )}
              </For>

              {/* ── Unformatted disks (idea#136) ─────────────────── */}
              <For each={(engine()?.unformattedDisks ?? []).map((u: UnformattedDisk) => u.candidateId)}>
                {(candidateId) => {
                  const cand = () => engine()?.unformattedDisks?.find((u) => u.candidateId === candidateId);
                  return (
                    <Show when={cand()}>
                      {(u) => (
                        <div
                          data-testid={`candidate-${candidateId}`}
                          data-candidate-id={candidateId}
                          data-engine-id={engineId}
                          class={`tree-item tree-item--disk tree-item--unformatted ${isSelected('unformatted', candidateId) && props.selection.engineId === engineId ? 'tree-item--selected' : ''}`}
                          role="treeitem"
                          tabIndex={0}
                          aria-selected={isSelected('unformatted', candidateId) && props.selection.engineId === engineId}
                          onClick={() => props.onSelect({ type: 'unformatted', id: candidateId, engineId })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              props.onSelect({ type: 'unformatted', id: candidateId, engineId });
                            }
                          }}
                        >
                          <span class="tree-item__icon" aria-hidden="true">💾</span>
                          <span class="tree-item__label">
                            {u().label}
                            <span class="tree-item__meta"> — {formatBytes(u().sizeBytes)}{u().fsType ? `, ${u().fsType}` : ''}</span>
                          </span>
                          <span class="tree-item__badge-unformatted">unformatted</span>
                        </div>
                      )}
                    </Show>
                  );
                }}
              </For>

              {/* ── Per-disk sub-rows ────────────────────────────── */}
              <For each={diskIds()}>
                {(diskId) => {
                  const disk = () => props.store()?.diskDB[diskId] as Disk | undefined;

                  // ── Eject feedback ──────────────────────────────────
                  const [ejectState, setEjectState] = createSignal<EjectState>({ kind: 'idle' });
                  // Combined disks confirm first, listing everything affected (idea#157)
                  const [confirmingEject, setConfirmingEject] = createSignal(false);
                  let ejectTimer: ReturnType<typeof setTimeout> | null = null;
                  const clearEjectTimer = () => {
                    if (ejectTimer !== null) { clearTimeout(ejectTimer); ejectTimer = null; }
                  };
                  onCleanup(clearEjectTimer);

                  // Reads the command log only while an eject is pending.
                  const ejectOutcome = createMemo(() => {
                    const s = ejectState();
                    if (s.kind !== 'pending') return null;
                    return findEjectOutcome(props.commandLogStore?.() ?? null, s.baseline, diskId);
                  });
                  createEffect(() => {
                    const outcome = ejectOutcome();
                    if (!outcome) return;
                    clearEjectTimer();
                    if (outcome.kind === 'error') {
                      console.warn(`[eject] ${disk()?.name ?? diskId} (${diskId}): ${outcome.message}`);
                      setEjectState({ kind: 'error', message: outcome.message });
                    } else {
                      setEjectState({ kind: 'idle' });
                    }
                  });

                  const startEject = (engineId: string) => {
                    clearEjectTimer();
                    setEjectState({
                      kind: 'pending',
                      baseline: traceIdSnapshot(props.commandLogStore?.() ?? null),
                    });
                    ejectTimer = setTimeout(() => {
                      ejectTimer = null;
                      if (ejectState().kind === 'pending') setEjectState({ kind: 'timeout' });
                    }, EJECT_TIMEOUT_MS);
                    ejectDisk(engineId, diskId);
                  };

                  const ejectNotice = createMemo((): { tone: 'error' | 'info'; text: string } | null => {
                    const s = ejectState();
                    const name = disk()?.name ?? diskId;
                    if (s.kind === 'error') return { tone: 'error', text: `Couldn't eject ${name}: ${s.message}` };
                    if (s.kind === 'timeout') return { tone: 'info', text: `No response from the Engine for ejecting ${name}. Check History for details.` };
                    return null;
                  });

                  const isDragOver = () => dropTargetDiskId() === diskId;
                  const isDragTarget = () => props.dragData() !== null
                    && props.dragData()!.sourceDiskId !== diskId;

                  return (
                    <Show when={disk()}>
                      <div
                        data-testid={`disk-${diskId}`}
                        data-disk-id={diskId}
                        class={`tree-item tree-item--disk ${isSelected('disk', diskId) ? 'tree-item--selected' : ''} ${isDragOver() && isDragTarget() ? 'tree-item--drag-over' : ''}`}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={isSelected('disk', diskId)}
                        onClick={() => props.onSelect({ type: 'disk', id: diskId })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            props.onSelect({ type: 'disk', id: diskId });
                          }
                        }}
                        onDragOver={(e) => {
                          if (props.dragData() && isDragTarget()) {
                            e.preventDefault();
                            setDropTargetDiskId(diskId);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTargetDiskId() === diskId) setDropTargetDiskId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetDiskId(null);
                          const data = props.dragData();
                          if (data && data.sourceDiskId !== diskId) {
                            props.onDrop(data, diskId);
                          }
                        }}
                      >
                        <span class="tree-item__icon">💾</span>
                        <span class="tree-item__label">{disk()?.name}</span>
                        <Show when={canEject(disk()!)}>
                          <button
                            class="tree-item__eject-btn"
                            data-testid={`eject-${diskId}`}
                            disabled={isDiskLocked(props.store(), diskId)}
                            title={
                              isDiskLocked(props.store(), diskId)
                                ? 'Operation in progress — cannot eject'
                                : `Eject ${disk()?.name}`
                            }
                            aria-label={`Eject disk ${disk()?.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const eng = engine();
                              const d = disk();
                              if (!eng || !d) return;
                              if (isCombinedDisk(d, props.store())) setConfirmingEject(true);
                              else startEject(eng.id);
                            }}
                          >
                            ⏏
                          </button>
                        </Show>
                        <span class="tree-item__badges">
                          <RoleBadges disk={disk} store={props.store} />
                        </span>
                      </div>
                      <Show when={confirmingEject()}>
                        <EjectConfirm
                          disk={disk}
                          store={props.store}
                          onCancel={() => setConfirmingEject(false)}
                          onConfirm={() => {
                            setConfirmingEject(false);
                            const eng = engine();
                            if (eng && !isDiskLocked(props.store(), diskId)) startEject(eng.id);
                          }}
                        />
                      </Show>
                      <Show when={ejectNotice()}>
                        {(notice) => (
                          <div
                            class={`tree-item__eject-notice tree-item__eject-notice--${notice().tone}`}
                            role={notice().tone === 'error' ? 'alert' : 'status'}
                            title="Click to dismiss"
                            onClick={() => setEjectState({ kind: 'idle' })}
                          >
                            {notice().text}
                          </div>
                        )}
                      </Show>
                    </Show>
                  );
                }}
              </For>
            </Show>
          );
        }}
      </For>
    </nav>
  );
};

export default NetworkTree;
