import { createSignal, createEffect, createMemo, For, Show, onCleanup, type Accessor, type Component } from 'solid-js';
import StatusDot from './StatusDot';
import MobileCopyMoveSheet from './MobileCopyMoveSheet';
import { startInstance, stopInstance, backupApp } from '../store/commands';
import { getActiveOpsForInstance } from '../store/operations';
import type { Store, Instance, Disk, Engine, Operation } from '../types/store';
import type { CommandLogStore } from '../types/commandLog';

interface MobileAppListProps {
  store: Accessor<Store | null>;
  commandLogStore?: Accessor<CommandLogStore | null | false>;
}

const statusSortOrder = (status: string): number => {
  if (status === 'Running') return 0;
  if (status === 'Stopped') return 1;
  return 2;
};

const formatMB = (bytes: number | null): string => {
  if (bytes == null) return '';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

const MobileAppList: Component<MobileAppListProps> = (props) => {
  const [selectedEngineId, setSelectedEngineId] = createSignal<string | null>(null);
  const [copyMoveInstance, setCopyMoveInstance] = createSignal<Instance | null>(null);
  const [pendingActions, setPendingActions] = createSignal<Map<string, 'starting' | 'stopping'>>(new Map());
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const setPending = (id: string, action: 'starting' | 'stopping' | null) => {
    const existing = pendingTimers.get(id);
    if (existing !== undefined) { clearTimeout(existing); pendingTimers.delete(id); }
    setPendingActions((prev) => {
      const next = new Map(prev);
      if (action === null) next.delete(id);
      else next.set(id, action);
      return next;
    });
    if (action !== null) {
      pendingTimers.set(id, setTimeout(() => {
        pendingTimers.delete(id);
        setPendingActions((prev) => { const next = new Map(prev); next.delete(id); return next; });
      }, 15000));
    }
  };
  onCleanup(() => { for (const t of pendingTimers.values()) clearTimeout(t); pendingTimers.clear(); });

  // Auto-clear pending start/stop when instance reaches expected status
  createEffect(() => {
    const s = props.store();
    if (!s) return;
    const pending = pendingActions();
    for (const [id, action] of pending) {
      const inst = s.instanceDB[id];
      if (!inst) continue;
      if (action === 'starting' && (inst.status === 'Running' || inst.status === 'Error')) {
        setPending(id, null);
      }
      if (action === 'stopping' && (inst.status === 'Stopped' || inst.status === 'Docked' || inst.status === 'Error')) {
        setPending(id, null);
      }
    }
  });

  const engines = createMemo(() => {
    const s = props.store();
    if (!s) return [];
    return Object.values(s.engineDB);
  });

  const allInstances = createMemo((): Instance[] => {
    const s = props.store();
    if (!s) return [];
    const sel = selectedEngineId();

    const instances = Object.values(s.instanceDB ?? {}).filter((inst) => {
      if (!sel) return true;
      if (!inst.storedOn) return false;
      const disk = s.diskDB[inst.storedOn];
      return disk?.dockedTo != null && String(disk.dockedTo) === sel;
    });

    return [...instances].sort(
      (a, b) => statusSortOrder(a.status) - statusSortOrder(b.status)
    );
  });

  const resolveDisk = (inst: Instance): Disk | undefined => {
    const s = props.store();
    if (!s || !inst.storedOn) return undefined;
    return s.diskDB[inst.storedOn];
  };

  const resolveEngine = (inst: Instance): Engine | undefined => {
    const s = props.store();
    if (!s || !inst.storedOn) return undefined;
    const disk = s.diskDB[inst.storedOn];
    if (!disk?.dockedTo) return undefined;
    return s.engineDB[disk.dockedTo];
  };

  const resolveBackupDisks = (inst: Instance): Disk[] => {
    const s = props.store();
    if (!s) return [];
    const engineDisk = inst.storedOn ? s.diskDB[inst.storedOn] : undefined;
    const engineId = engineDisk?.dockedTo;
    if (!engineId) return [];
    return Object.values(s.diskDB).filter(
      (d) =>
        String(d.dockedTo) === String(engineId) &&
        d.device !== null &&
        d.diskTypes?.includes('backup') &&
        d.backupConfig?.links.includes(inst.id)
    );
  };

  const getBackupOp = (inst: Instance): Operation | undefined => {
    const s = props.store();
    if (!s) return undefined;
    return Object.values(s.operationDB ?? {}).find(
      (op) =>
        (op.status === 'Running' || op.status === 'Pending') &&
        op.kind === 'backupApp' &&
        String(op.args['instanceId']) === String(inst.id)
    );
  };

  const statusText = (inst: Instance): string => {
    const m = inst.metrics;
    if (inst.status === 'Running' && m) {
      const parts: string[] = ['Running'];
      if (m.cpuPercent != null) parts.push(`CPU ${m.cpuPercent.toFixed(0)}%`);
      if (m.memUsageBytes != null) parts.push(`RAM ${formatMB(m.memUsageBytes)}`);
      return parts.join(' · ');
    }
    return inst.status;
  };

  const handleStart = (inst: Instance) => {
    const engine = resolveEngine(inst);
    if (!engine || !inst.storedOn) return;
    startInstance(engine.id, inst.name, inst.storedOn);
    setPending(inst.id, 'starting');
  };

  const handleStop = (inst: Instance) => {
    const engine = resolveEngine(inst);
    if (!engine || !inst.storedOn) return;
    stopInstance(engine.id, inst.name, inst.storedOn);
    setPending(inst.id, 'stopping');
  };

  const handleBackup = (inst: Instance) => {
    const engine = resolveEngine(inst);
    const disks = resolveBackupDisks(inst);
    if (!engine || disks.length === 0) return;
    backupApp(engine.id, inst.name, disks[0].name);
  };

  return (
    <>
    <div class="mobile-app-list">
      {/* Filter chips */}
      <div class="mobile-filter-chips">
        <button
          class={`mobile-filter-chip${selectedEngineId() === null ? ' mobile-filter-chip--active' : ''}`}
          onClick={() => setSelectedEngineId(null)}
        >
          All
        </button>
        <For each={engines()}>
          {(engine) => (
            <button
              class={`mobile-filter-chip${selectedEngineId() === engine.id ? ' mobile-filter-chip--active' : ''}`}
              onClick={() => setSelectedEngineId(engine.id)}
            >
              {engine.hostname}
            </button>
          )}
        </For>
      </div>

      {/* App cards */}
      <For each={allInstances()}>
        {(inst) => {
          const disk = () => resolveDisk(inst);
          const engine = () => resolveEngine(inst);
          const backupOp = () => getBackupOp(inst);
          const isOpRunning = () => getActiveOpsForInstance(props.store(), inst.id).length > 0;
          const hasBackupDisks = () => resolveBackupDisks(inst).length > 0;
          const pendingAction = () => pendingActions().get(inst.id) ?? null;

          return (
            <div class={`mobile-app-card${inst.status === 'Error' ? ' mobile-app-card--error' : ''}`}>
              <div class="mobile-app-card__top">
                <StatusDot status={inst.status} size={9} />
                <span class="mobile-app-card__name">{inst.name}</span>
                <span class="mobile-app-card__disk">{disk()?.name ?? '—'}</span>
                <button
                  class="mobile-app-card__more-btn"
                  title="More actions"
                  aria-label="More actions"
                  onClick={() => setCopyMoveInstance(inst)}
                >⋯</button>
              </div>

              <div class="mobile-app-card__status">{statusText(inst)}</div>

              {/* Backup progress bar */}
              <Show when={backupOp()}>
                {(op) => (
                  <>
                    <div class="mobile-app-card__progress">
                      <div
                        class="mobile-app-card__progress-fill"
                        style={`width:${op().progressPercent ?? 0}%`}
                      />
                    </div>
                    <div class="mobile-app-card__progress-label">
                      Backup running — {op().progressPercent ?? 0}%
                    </div>
                  </>
                )}
              </Show>

              {/* Pending start/stop feedback */}
              <Show when={pendingAction() && !isOpRunning()}>
                <div class="mobile-app-card__progress-label">
                  {pendingAction() === 'starting' ? 'Starting…' : 'Stopping…'}
                </div>
              </Show>

              {/* Action buttons */}
              <Show when={inst.status === 'Running'}>
                <div class="mobile-app-card__actions">
                  <button class="btn btn--stop" onClick={() => handleStop(inst)}>Stop</button>
                  <Show when={engine()}>
                    {(eng) => (
                      <a
                        class="btn btn--open"
                        href={`http://${eng().hostname}:${inst.port}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open ↗
                      </a>
                    )}
                  </Show>
                  <Show when={hasBackupDisks()}>
                    <button
                      class="btn btn--backup"
                      onClick={() => handleBackup(inst)}
                      disabled={isOpRunning()}
                    >
                      Back up
                    </button>
                  </Show>
                </div>
              </Show>

              <Show when={inst.status === 'Stopped'}>
                <div class="mobile-app-card__actions">
                  <button class="btn btn--start" onClick={() => handleStart(inst)}>Start</button>
                  <Show when={hasBackupDisks()}>
                    <button
                      class="btn btn--backup"
                      onClick={() => handleBackup(inst)}
                      disabled={isOpRunning()}
                    >
                      Back up
                    </button>
                  </Show>
                </div>
              </Show>

              <Show when={inst.status === 'Error'}>
                <div class="mobile-app-card__actions">
                  <button class="btn btn--start" onClick={() => handleStart(inst)}>Restart</button>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>

    {/* Copy/Move bottom sheet */}
    <Show when={copyMoveInstance()}>
      {(inst) => (
        <MobileCopyMoveSheet
          instance={inst()}
          store={props.store}
          onClose={() => setCopyMoveInstance(null)}
        />
      )}
    </Show>
    </>
  );
};

export default MobileAppList;
