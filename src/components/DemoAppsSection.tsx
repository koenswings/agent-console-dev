/**
 * Settings → Demo apps (idea#235, Engine design engine#369).
 *
 * Operators only (Koen, 14 Nov 2026 10:15): the parent renders this only when
 * `isOperator()`, and every Engine is offered only with a fresh `demoApps`
 * capability. Set up sends `setupDemo <targetDiskId>`; Remove sends
 * `removeDemo <instanceId>...` naming exactly the instances in the confirm.
 * Progress is read from the newest setupDemo/removeDemo Operation in the
 * store (`Operation.demo`), so every Console sees it and it survives a reload.
 */
import { For, Show, createMemo, createSignal, type Accessor, type Component } from 'solid-js';
import { removeDemo, setupDemo } from '../store/commands';
import { createCommandResult } from '../store/commandResult';
import type { CommandLogState } from '../store/commandLog';
import { remoteWatchFor } from '../store/remoteConfirm';
import { connectedEngineId } from '../store/connectedEngine';
import { live } from '../store/live';
import {
  DEMO_APPS_CAPABILITY,
  DEMO_REFRESH_HINT,
  DEMO_SETUP_LABEL,
  DEMO_STEP_STATUS_TEXT,
  REMOVE_DEMO_COMMAND,
  SETUP_DEMO_COMMAND,
  demoAppName,
  demoAppProgress,
  demoCodeOf,
  demoElsewhereText,
  demoEnginesElsewhere,
  demoErrorText,
  demoInstancesOnEngine,
  demoOperationResultText,
  demoProgressAppIds,
  demoSetupGate,
  demoStepIds,
  demoStepLabel,
  demoTargetDisks,
  isDemoOperationActive,
  latestDemoOperation,
  removeDemoConfirmText,
} from '../store/demoApps';
import { engineHasCapability } from '../store/commands';
import CommandFeedback from './CommandFeedback';
import type { Store } from '../types/store';

interface Props {
  store: Accessor<Store | null>;
  commandLog: Accessor<CommandLogState>;
}

const GB = 1_000_000_000;
const freeText = (bytes: number | null | undefined): string =>
  typeof bytes === 'number' && bytes >= 0 ? `${(bytes / GB).toFixed(1)} GB free` : 'free space unknown';

const DemoAppsSection: Component<Props> = (props) => {
  /** Engines with a fresh demoApps capability, connected Engine first. */
  const engineIds = createMemo(() => {
    const s = props.store();
    if (!s) return [] as string[];
    const own = connectedEngineId(s);
    return Object.values(s.engineDB ?? {})
      .filter((e) => engineHasCapability(e, DEMO_APPS_CAPABILITY))
      .map((e) => String(e.id))
      .sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)));
  });
  const [pickedEngine, setPickedEngine] = createSignal<string | null>(null);
  const engineId = createMemo(() => {
    const ids = engineIds();
    const p = pickedEngine();
    return p && ids.includes(p) ? p : ids[0] ?? null;
  });
  const engineName = (id: string | null) => String((id && props.store()?.engineDB?.[id]?.hostname) || id || '');

  const targetIds = createMemo(() => demoTargetDisks(props.store(), engineId()).map((d) => d.id));
  const demoIds = createMemo(() => demoInstancesOnEngine(props.store(), engineId()).map((i) => i.id));
  const [pickedDisk, setPickedDisk] = createSignal<string | null>(null);
  /** Default target: the disk already holding demo apps (resume), else the most free space. */
  const targetDiskId = createMemo(() => {
    const ids = targetIds();
    const p = pickedDisk();
    if (p && ids.includes(p)) return p;
    const s = props.store();
    const withDemo = demoIds().map((id) => s?.instanceDB?.[id]?.storedOn).find((d) => d && ids.includes(d));
    return withDemo ?? ids[0] ?? null;
  });

  const gate = createMemo(() => demoSetupGate({ store: props.store(), engineId: engineId(), live: live(), targetDiskId: targetDiskId() }));
  const op = createMemo(() => latestDemoOperation(props.store(), engineId()));
  const opActive = () => isDemoOperationActive(op());
  const elsewhere = createMemo(() => demoEnginesElsewhere(props.store(), engineId()));
  const demoNames = () => demoIds().map((id) => props.store()?.instanceDB?.[id]?.name ?? id);

  const [confirming, setConfirming] = createSignal(false);
  const result = createCommandResult({ commandLog: props.commandLog, longRunning: true });
  const sending = () => { const k = result.state().kind; return k === 'pending' || k === 'sent'; };

  /** Remote watch: a new demo Operation for that Engine proves it accepted the command. */
  const watchFor = (eid: string, command: string) => {
    const before = latestDemoOperation(props.store(), eid)?.id ?? null;
    return remoteWatchFor(props.store, eid, command, () => {
      const now = latestDemoOperation(props.store(), eid);
      return now && now.id !== before ? 'ok' : null;
    });
  };

  const sendSetup = () => {
    const eid = engineId();
    const disk = targetDiskId();
    if (!eid || !disk || gate().reason) return;
    result.start(disk, () => setupDemo(eid, disk), {
      command: SETUP_DEMO_COMMAND, argKey: 'targetDiskId', matchMode: 'includes', longRunning: true,
      engineId: eid, remote: watchFor(eid, SETUP_DEMO_COMMAND),
    });
  };

  const sendRemove = () => {
    const eid = engineId();
    const ids = demoIds();
    setConfirming(false);
    if (!eid || ids.length === 0) return;
    result.start(ids[0], () => removeDemo(eid, ids), {
      command: REMOVE_DEMO_COMMAND, argKey: 'instanceId', matchMode: 'includes', longRunning: true,
      engineId: eid, remote: watchFor(eid, REMOVE_DEMO_COMMAND),
    });
  };

  return (
    <div class="settings-panel__section demo-apps" data-testid="demo-apps-section">
      <h2 class="settings-panel__heading">Demo apps</h2>
      <p class="form-field__hint">
        Installs separate "Kolibri Demo" and "Nextcloud Demo" apps with a demo school, users and files.
        Real apps are never touched.
      </p>

      <Show when={engineIds().length > 1}>
        <label class="form-field">
          <span class="form-field__label">Engine</span>
          <select class="form-field__input" data-testid="demo-apps-engine" value={engineId() ?? ''} onChange={(e) => setPickedEngine(e.currentTarget.value)}>
            <For each={engineIds()}>{(id) => <option value={id}>{engineName(id)}</option>}</For>
          </select>
        </label>
      </Show>

      <Show when={elsewhere().length > 0}>
        <p class="demo-apps__note" data-testid="demo-apps-elsewhere">{demoElsewhereText(elsewhere())}</p>
      </Show>

      {/* Set up */}
      <div class="demo-apps__block">
        <Show when={targetIds().length > 0}>
          <label class="form-field">
            <span class="form-field__label">Disk for the demo apps</span>
            <select
              class="form-field__input"
              data-testid="demo-apps-disk"
              value={targetDiskId() ?? ''}
              disabled={opActive() || sending()}
              onChange={(e) => setPickedDisk(e.currentTarget.value)}
            >
              <For each={targetIds()}>
                {(id) => {
                  const disk = () => props.store()?.diskDB?.[id];
                  return <option value={id}>{`${disk()?.name ?? id} (${freeText(disk()?.freeBytes)})`}</option>;
                }}
              </For>
            </select>
          </label>
        </Show>
        <button
          class="btn btn--primary"
          data-testid="demo-apps-setup"
          disabled={!!gate().reason || sending()}
          title={gate().reason ?? undefined}
          onClick={sendSetup}
        >
          {DEMO_SETUP_LABEL[gate().mode]}
        </button>
        <Show when={gate().reason}>
          <p class="edp-form__hint" data-testid="demo-apps-setup-reason">{gate().reason}</p>
        </Show>
        <Show when={!gate().reason && gate().mode === 'refresh'}>
          <p class="edp-form__hint" data-testid="demo-apps-refresh-hint">{DEMO_REFRESH_HINT}</p>
        </Show>
      </div>

      {/* Remove */}
      <Show when={demoIds().length > 0}>
        <div class="demo-apps__block">
          <p class="form-field__hint" data-testid="demo-apps-list">On this Engine: {demoNames().join(', ')}</p>
          <Show
            when={confirming()}
            fallback={
              <button
                class="btn btn--remove"
                data-testid="demo-apps-remove"
                disabled={opActive() || sending()}
                onClick={() => { result.reset(); setConfirming(true); }}
              >
                Remove demo apps…
              </button>
            }
          >
            <div class="demo-apps__confirm" role="alertdialog" aria-label="Remove demo apps">
              <p data-testid="demo-apps-remove-text">{removeDemoConfirmText(demoNames())}</p>
              <div class="instance-remove__buttons">
                <button class="btn btn--remove" data-testid="demo-apps-remove-confirm" onClick={sendRemove}>Remove</button>
                <button class="btn" data-testid="demo-apps-remove-cancel" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <CommandFeedback
        result={result}
        subject={() => engineName(engineId())}
        testId="demo-apps-cmd"
        formatLine={(message, code) => demoErrorText(code && !demoCodeOf(message) ? `${code}: ${message}` : message)}
      />

      {/* Progress (Operation.demo, step ids from engine#369) */}
      <Show when={op()}>
        {(o) => (
          <div class="demo-apps__progress" data-testid="demo-apps-progress" data-op-id={o().id}>
            <For each={demoProgressAppIds(o())}>
              {(app) => (
                <div class="demo-apps__app" data-testid={`demo-apps-app-${app}`}>
                  <span class="demo-apps__app-name">{demoAppName(app)}</span>
                  <ol class="demo-apps__steps">
                    <For each={demoStepIds(o(), app)}>
                      {(stepId) => {
                        const step = () => demoAppProgress(o(), app)?.steps.find((st) => st.id === stepId);
                        return (
                          <li
                            class={`demo-apps__step demo-apps__step--${step()?.status ?? 'pending'}`}
                            data-testid={`demo-apps-step-${app}-${stepId}`}
                          >
                            <span>{demoStepLabel(step() ?? { id: stepId })}</span>
                            <span class="demo-apps__step-status">{DEMO_STEP_STATUS_TEXT[step()?.status ?? 'pending']}</span>
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                </div>
              )}
            </For>
            <Show when={demoOperationResultText(o())}>
              <p
                class={o().status === 'Failed' ? 'edp-form__error' : 'form-success'}
                role={o().status === 'Failed' ? 'alert' : 'status'}
                data-testid="demo-apps-result"
              >
                {demoOperationResultText(o())}
              </p>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};

export default DemoAppsSection;
