/**
 * idea#136 — Erase this disk… dialog: summary, typed label, erase, progress,
 * stale summary, unformatted contents-unknown, capability gate on the button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import DiskView from '../src/components/DiskView';
import NetworkTree from '../src/components/NetworkTree';
import EraseDialog from '../src/components/EraseDialog';
import { setSendCommandFn } from '../src/store/commands';
import { SUMMARY_MAX_AGE_MS } from '../src/store/erase';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { SAMPLE_SUMMARY, UNREADABLE_SUMMARY } from '../src/mock/eraseFixtures';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Store } from '../src/types/store';

const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});

const summariseOk = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'sum-1',
  command: 'summariseDisk',
  args: { targetId: I.FA_APP },
  startedAt: 1,
  completedAt: 2,
  status: 'ok',
  errorMessage: null,
  logs: [],
  result: JSON.stringify(SAMPLE_SUMMARY({ label: MOCK_FILES_STORE.diskDB[I.FA_APP].name, targetId: I.FA_APP })),
  ...over,
});

const eraseOk = (over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: 'erase-1',
  command: 'eraseDisk',
  args: { targetId: I.FA_APP },
  startedAt: 3,
  completedAt: 4,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

let sent: ReturnType<typeof vi.fn>;
beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('DiskView — Erase this disk… gate (idea#136)', () => {
  const renderView = (diskId: string, store: Store = MOCK_FILES_STORE) => {
    const [s] = createSignal<Store | null>(store);
    const [cls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
    return render(() => <DiskView diskId={diskId} store={s} commandLogStore={cls} />);
  };

  it('shows the danger text button on a non-system disk when eraseDisk is fresh', () => {
    const { container } = renderView(I.FA_APP);
    const btn = container.querySelector('[data-testid="erase-this-disk"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Erase this disk…');
  });

  it('greys out with Update tooltip when eraseDisk is missing', () => {
    const store: Store = {
      ...MOCK_FILES_STORE,
      engineDB: {
        ...MOCK_FILES_STORE.engineDB,
        [I.ENGINE_A]: {
          ...MOCK_FILES_STORE.engineDB[I.ENGINE_A],
          capabilities: ['diskIdArgs', 'filesDisk'],
        },
      },
    };
    const { container } = renderView(I.FA_APP, store);
    const btn = container.querySelector('[data-testid="erase-this-disk"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Update this Engine to manage this disk');
  });

  it('greys out when capabilitiesBootedAt !== lastBooted', () => {
    const a = MOCK_FILES_STORE.engineDB[I.ENGINE_A];
    const store: Store = {
      ...MOCK_FILES_STORE,
      engineDB: {
        ...MOCK_FILES_STORE.engineDB,
        [I.ENGINE_A]: { ...a, capabilitiesBootedAt: a.lastBooted - 5 } as Engine,
      },
    };
    const { container } = renderView(I.FA_APP, store);
    expect((container.querySelector('[data-testid="erase-this-disk"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('NetworkTree — unformatted disks (idea#136)', () => {
  it('lists unformatted candidates under the Engine by candidateId', () => {
    const { container } = render(() => (
      <NetworkTree
        store={() => MOCK_FILES_STORE}
        selection={{ type: 'network', id: '' }}
        onSelect={() => {}}
        dragData={() => null}
        onDrop={() => {}}
      />
    ));
    const rows = container.querySelectorAll('[data-candidate-id]');
    expect([...rows].map((r) => r.getAttribute('data-candidate-id')).sort()).toEqual(
      [I.CAND_INTENSO, I.CAND_INTENSO_2].sort(),
    );
    expect(container.textContent).toContain('Intenso 32 GB (2)');
  });
});

describe('EraseDialog flow (idea#136)', () => {
  const renderDialog = (
    opts: { mode?: 'erase' | 'erase-then-files'; targetId?: string; store?: Store } = {},
  ) => {
    const [store, setStore] = createSignal<Store | null>(opts.store ?? MOCK_FILES_STORE);
    const [cls, setCls] = createSignal<CommandLogState>(log());
    const onErasedEmpty = vi.fn();
    const onClose = vi.fn();
    const targetId = opts.targetId ?? I.FA_APP;
    const utils = render(() => (
      <EraseDialog
        targetId={targetId}
        engineId={I.ENGINE_A}
        fallbackLabel={MOCK_FILES_STORE.diskDB[targetId]?.name ?? 'Intenso 32 GB'}
        mode={opts.mode ?? 'erase'}
        store={store}
        commandLogStore={cls}
        onClose={onClose}
        onErasedEmpty={onErasedEmpty}
      />
    ));
    return { ...utils, setCls, setStore, onErasedEmpty, onClose, store, cls };
  };

  it('sends summariseDisk on open and shows the summary', () => {
    const t = renderDialog();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `summariseDisk ${I.FA_APP}`);
    t.setCls(log(summariseOk()));
    expect(t.container.textContent).toContain('will be stopped');
    expect(t.container.textContent).toContain('This erases everything');
  });

  it('keeps Erase disabled until the typed name matches exactly', () => {
    const t = renderDialog();
    t.setCls(log(summariseOk()));
    const name = MOCK_FILES_STORE.diskDB[I.FA_APP].name;
    const input = t.container.querySelector('#erase-confirm-name') as HTMLInputElement;
    const eraseBtn = () => [...t.container.querySelectorAll('button')].find((b) => b.textContent === 'Erase this disk')!;
    expect(eraseBtn().disabled).toBe(true);
    fireEvent.input(input, { target: { value: name + 'x' } });
    expect(eraseBtn().disabled).toBe(true);
    fireEvent.input(input, { target: { value: name } });
    expect(eraseBtn().disabled).toBe(false);
  });

  it('sends eraseDisk with summaryTraceId and label, then shows success after empty republish', () => {
    const t = renderDialog();
    t.setCls(log(summariseOk()));
    const name = MOCK_FILES_STORE.diskDB[I.FA_APP].name;
    fireEvent.input(t.container.querySelector('#erase-confirm-name')!, { target: { value: name } });
    fireEvent.click([...t.container.querySelectorAll('button')].find((b) => b.textContent === 'Erase this disk')!);
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `eraseDisk ${I.FA_APP} sum-1 ${name}`);
    t.setCls(log(summariseOk(), eraseOk()));
    // Republish as empty
    t.setStore({
      ...t.store()!,
      diskDB: {
        ...t.store()!.diskDB,
        [I.FA_APP]: { ...t.store()!.diskDB[I.FA_APP], diskTypes: ['empty'], backupConfig: null, filesConfig: null },
      },
      instanceDB: {},
    });
    expect(t.container.textContent).toContain('Removed instances');
    expect(t.onErasedEmpty).toHaveBeenCalledWith(I.FA_APP);
  });

  it('replaces the typed-name box when the summary is older than 10 minutes', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const t = renderDialog();
    t.setCls(log(summariseOk({
      result: JSON.stringify(SAMPLE_SUMMARY({
        label: MOCK_FILES_STORE.diskDB[I.FA_APP].name,
        computedAt: now - SUMMARY_MAX_AGE_MS - 1000,
      })),
    })));
    // advance the dialog's 1s tick
    vi.advanceTimersByTime(1100);
    expect(t.container.textContent).toContain('The summary is out of date');
    expect(t.container.querySelector('#erase-confirm-name')).toBeNull();
  });

  it('shows contents unknown for an unreadable (unformatted) summary', () => {
    const t = renderDialog({ targetId: I.CAND_INTENSO });
    t.setCls(log({
      ...summariseOk({ args: { targetId: I.CAND_INTENSO }, result: JSON.stringify(UNREADABLE_SUMMARY()) }),
    }));
    expect(t.container.textContent).toContain('Contents unknown');
  });

  it('closes with removed message when the disk disappears mid-dialog', () => {
    const t = renderDialog();
    t.setCls(log(summariseOk()));
    const { [I.FA_APP]: _gone, ...rest } = t.store()!.diskDB;
    t.setStore({ ...t.store()!, diskDB: rest });
    expect(t.container.textContent).toContain('This disk was removed');
  });
});
