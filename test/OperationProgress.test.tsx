import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import OperationProgress from '../src/components/OperationProgress';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import { noteConnectedEngine, resetConnectedEngine } from '../src/store/connectedEngine';
import { setupFailedText } from '../src/store/updateApp';
import type { Instance, Operation, Store } from '../src/types/store';
import type { CommandLogStore } from '../src/types/commandLog';

const NOW = Date.now();

const makeOp = (overrides: Partial<Operation>): Operation => ({
  id: 'op-001',
  kind: 'copyApp',
  args: { instanceName: 'kolibri', sourceDiskName: 'kolibri-disk', targetDiskName: 'target-disk' },
  cause: 'console-command' as const,
  subject: { type: 'instance' as const, id: 'inst-001' },
  engineId: 'ENGINE_001',
  status: 'Running',
  progressPercent: 42,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  startedAt: NOW,
  completedAt: null,
  error: null,
  ...overrides,
});

const storeWith = (ops: Record<string, Operation>, extra: Partial<Store> = {}): () => Store =>
  () => ({ ...MOCK_STORE, ...extra, operationDB: ops, instanceDB: { ...MOCK_STORE.instanceDB, ...(extra.instanceDB ?? {}) } });

const srcInstance = (storedOn = 'disk-src'): Instance => ({
  id: 'inst-src',
  instanceOf: 'kolibri-1.0',
  name: 'kolibri',
  status: 'Stopped',
  port: 8080,
  serviceImages: [],
  created: 0,
  lastBackup: null,
  lastStarted: 0,
  storedOn,
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
});

const nullCommandLog = (): CommandLogStore | null => null;

describe('OperationProgress', () => {
  it('renders nothing when operationDB is empty', () => {
    const { container } = render(() => (
      <OperationProgress store={() => MOCK_STORE} commandLogStore={nullCommandLog} />
    ));
    expect(container.querySelector('.operation-progress')).toBeNull();
  });

  it('shows Done operations briefly with done class before auto-dismiss', () => {
    const op = makeOp({ status: 'Done', progressPercent: 100, completedAt: Date.now() });
    const { container } = render(() => (
      <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />
    ));
    // Done ops are visible until auto-dismissed after 3s
    expect(container.querySelector('.operation-card--done')).toBeTruthy();
    expect(screen.getByText('✓ Done')).toBeInTheDocument();
  });

  it('renders a Running operation', () => {
    const op = makeOp({ status: 'Running', progressPercent: 55 });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Copy app')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders a Pending operation', () => {
    const op = makeOp({ status: 'Pending', progressPercent: 0 });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders the progress bar for Running ops', () => {
    const op = makeOp({ status: 'Running', progressPercent: 70 });
    const { container } = render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    const fill = container.querySelector('.step-progress-bar__fill') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('70%');
  });

  it('shows error message for Failed operations', () => {
    const op = makeOp({ status: 'Failed', error: 'Disk full' });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Disk full')).toBeInTheDocument();
  });

  it('applies operation-card--failed class on failed ops', () => {
    const op = makeOp({ status: 'Failed', error: 'Something went wrong' });
    const { container } = render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(container.querySelector('.operation-card--failed')).toBeTruthy();
  });

  it('shows args summary for copy ops', () => {
    const op = makeOp({
      kind: 'copyApp',
      args: { instanceName: 'kolibri', sourceDiskName: 'src-disk', targetDiskName: 'dst-disk' },
    });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText(/kolibri/)).toBeInTheDocument();
    expect(screen.getByText(/src-disk.*dst-disk/)).toBeInTheDocument();
  });

  it('renders multiple active operations', () => {
    const op1 = makeOp({ id: 'op-1', kind: 'copyApp', status: 'Running' });
    const op2 = makeOp({ id: 'op-2', kind: 'moveApp', status: 'Pending' });
    render(() => <OperationProgress store={storeWith({ [op1.id]: op1, [op2.id]: op2 })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Copy app')).toBeInTheDocument();
    expect(screen.getByText('Move app')).toBeInTheDocument();
  });

  it('exposes data-testid / data-op-* for Intent waiters (r42 backup_instance)', () => {
    const op = makeOp({
      id: 'op-backup-1',
      kind: 'backupApp',
      status: 'Running',
      args: { instanceId: 'kolibri-grade5a-001', backupDiskId: 'DISK_BACKUP' },
      subject: { type: 'instance', id: 'kolibri-grade5a-001' },
    });
    const { container } = render(() => (
      <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />
    ));
    const card = container.querySelector('[data-testid="operation-card-op-backup-1"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('data-op-kind')).toBe('backupApp');
    expect(card.getAttribute('data-op-status')).toBe('Running');
    expect(card.getAttribute('data-op-instance')).toBe('kolibri-grade5a-001');
    expect(container.querySelector('[data-testid="operation-progress"]')).toBeTruthy();
    expect(screen.getByText('Back up')).toBeInTheDocument();
  });

  // Text a user sees without opening any closed <details>.
  const visibleText = (root: HTMLElement): string => {
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('details:not([open])').forEach((d) => {
      d.querySelectorAll(':scope > :not(summary)').forEach((n) => n.remove());
    });
    return clone.textContent ?? '';
  };

  const KEPT_PATH = '/.idea-temp-backups/kolibri-inst-001/20261117T080000Z';
  const SETUP = setupFailedText('Kolibri Learning Platform');

  it.each([
    `ROLLED BACK: Health failed: hook; the temporary pre-update backup is kept at ${KEPT_PATH}`,
    `PREPARE_FAILED: exit 2; the temporary pre-update backup is kept at ${KEPT_PATH}`,
    `VERIFY_FAILED: exit 1; the temporary pre-update backup is kept at ${KEPT_PATH}`,
  ])('Failed rolled-back updateApp: plain sentence, no kept-at path, raw error in closed Technical details', (error) => {
    const op = makeOp({
      id: 'upd-fail',
      kind: 'updateApp',
      status: 'Failed',
      error,
      args: { instanceId: 'kolibri-inst-001' },
    });
    const { getByTestId } = render(() => (
      <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />
    ));
    const details = getByTestId('operation-error-upd-fail');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe(SETUP);
    expect(visibleText(details)).toContain(SETUP);
    expect(visibleText(details)).not.toContain('kept at');
    expect(visibleText(details)).not.toContain(KEPT_PATH);
    const toggle = details.querySelector('details.tech-details__toggle') as HTMLDetailsElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle!.open).toBe(false);
    expect(toggle!.querySelector('summary')?.textContent).toBe('Technical details');
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe(error);
  });

  it('other Failed op with a kept-at path: current text, path only in closed Technical details', () => {
    const error = `The update stopped early; the temporary pre-update backup is kept at ${KEPT_PATH}`;
    const op = makeOp({
      id: 'upd-kept',
      kind: 'updateApp',
      status: 'Failed',
      error,
      args: { instanceId: 'kolibri-inst-001' },
    });
    const { getByTestId } = render(() => (
      <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />
    ));
    const details = getByTestId('operation-error-upd-kept');
    expect(details.querySelector('.tech-details__plain')?.textContent).toBe('The update stopped early');
    expect(visibleText(details)).toContain('The update stopped early');
    expect(visibleText(details)).not.toContain('kept at');
    expect(visibleText(details)).not.toContain(KEPT_PATH);
    const toggle = details.querySelector('details.tech-details__toggle') as HTMLDetailsElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle!.open).toBe(false);
    expect(toggle!.querySelector('summary')?.textContent).toBe('Technical details');
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe(error);
  });


  const localMove = (overrides: Partial<Operation> = {}): Operation => makeOp({
    id: 'mv-parked',
    kind: 'moveApp',
    status: 'Pending',
    args: {
      instanceId: 'inst-src',
      sourceDiskId: 'disk-src',
      targetDiskId: 'disk-tgt',
      phase: 'copying',
      wasRunning: '1',
    },
    error: 'RESUME_WAITING: source disk left',
    ...overrides,
  });

  it('parked local move: waiting status, source-stopped hint, no raw RESUME_ code', () => {
    const op = localMove();
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Waiting for the disk to come back')).toBeInTheDocument();
    const card = screen.getByTestId('operation-card-mv-parked');
    expect(screen.getByTestId('operation-source-stopped-mv-parked').textContent).toBe(
      'Source stopped until the move resumes or gives up',
    );
    expect(visibleText(card)).not.toMatch(/RESUME_/);
    const details = screen.getByTestId('operation-parked-mv-parked');
    expect(details.querySelector('.tech-details__raw')?.textContent).toBe('RESUME_WAITING: source disk left');
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("parked local move with wasRunning 0: waiting status, no source-stopped hint", () => {
    const op = localMove({ args: { instanceId: 'inst-src', phase: 'copying', wasRunning: '0' } });
    const { container } = render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Waiting for the disk to come back')).toBeInTheDocument();
    expect(screen.queryByTestId('operation-source-stopped-mv-parked')).toBeNull();
    expect(visibleText(container as HTMLElement)).not.toMatch(/RESUME_/);
  });

  it('resumed running local move shows the hint and keeps Running', () => {
    const op = localMove({ status: 'Running', error: 'Retrying after interrupted run' });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} commandLogStore={nullCommandLog} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByTestId('operation-source-stopped-mv-parked').textContent).toBe(
      'Source stopped until the move resumes or gives up',
    );
  });


  describe('cross-Engine parked move hint (engine#511)', () => {
    const E1 = MOCK_IDS.ENGINE_1_ID;
    const E2 = MOCK_IDS.ENGINE_2_ID;
    beforeEach(() => resetConnectedEngine());
    afterEach(() => resetConnectedEngine());

    const withInst = (op: Operation, storedOn = 'disk-src') =>
      storeWith({ [op.id]: op }, { instanceDB: { 'inst-src': srcInstance(storedOn) } });

    const crossParked = (overrides: Partial<Operation> & { args?: Record<string, string>; move?: Record<string, unknown> } = {}): Operation => {
      const op = localMove({
        id: 'mv-cross',
        engineId: E1,
        args: {
          instanceId: 'inst-src',
          sourceDiskId: 'disk-src',
          targetDiskId: 'disk-tgt',
          phase: 'copying',
          wasRunning: '1',
          crossEngine: 'true',
          crossResume: '1',
          ...(overrides.args ?? {}),
        },
        error: 'RESUME_WAITING: source disk left',
        ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'args' && k !== 'move')),
      } as Partial<Operation>);
      (op as unknown as Record<string, unknown>).move = {
        phase: overrides.args?.phase ?? 'copying',
        sourceEngineId: E1,
        targetEngineId: E2,
        sourceInstanceId: 'inst-src',
        targetInstanceId: 'inst-src',
        code: null,
        resultText: null,
        ...(overrides.move ?? {}),
      };
      return op;
    };

    it('shows the hint when this Console is the source Engine', () => {
      noteConnectedEngine(E1);
      const op = crossParked();
      render(() => <OperationProgress store={withInst(op)} commandLogStore={nullCommandLog} />);
      const card = screen.getByTestId('operation-card-mv-cross');
      expect(screen.getByTestId('operation-source-stopped-mv-cross').textContent).toBe(
        'Source stopped until the move resumes or gives up',
      );
      expect(screen.getByText('Waiting for the disk to come back')).toBeInTheDocument();
      expect(visibleText(card)).not.toMatch(/RESUME_/);
      const details = screen.getByTestId('operation-parked-mv-cross');
      expect(details.querySelector('.tech-details__raw')?.textContent).toBe('RESUME_WAITING: source disk left');
      expect((details as HTMLDetailsElement).open).toBe(false);
    });

    it('hides the hint when this Console is the target Engine', () => {
      noteConnectedEngine(E2);
      const op = crossParked();
      const { container } = render(() => <OperationProgress store={withInst(op)} commandLogStore={nullCommandLog} />);
      expect(screen.queryByTestId('operation-source-stopped-mv-cross')).toBeNull();
      expect(screen.getByText('Waiting for the disk to come back')).toBeInTheDocument();
      expect(visibleText(container as HTMLElement)).not.toMatch(/RESUME_/);
    });

    it('removing still on the source disk shows the hint; flipped storedOn does not', () => {
      noteConnectedEngine(E1);
      const onSource = crossParked({ args: { phase: 'removing', wasRunning: '1', crossEngine: 'true', crossResume: '1' } });
      const first = render(() => <OperationProgress store={withInst(onSource, 'disk-src')} commandLogStore={nullCommandLog} />);
      expect(screen.getByTestId('operation-source-stopped-mv-cross')).toBeTruthy();
      first.unmount();
      const flipped = crossParked({ args: { phase: 'removing', wasRunning: '1', crossEngine: 'true', crossResume: '1' } });
      render(() => <OperationProgress store={withInst(flipped, 'disk-tgt')} commandLogStore={nullCommandLog} />);
      expect(screen.queryByTestId('operation-source-stopped-mv-cross')).toBeNull();
    });

    it('Failed RESUME_GAVE_UP: plain sentence, raw error behind Technical details, no hint', () => {
      noteConnectedEngine(E1);
      const op = crossParked({
        status: 'Failed',
        error: 'RESUME_GAVE_UP: rsync failed',
        completedAt: Date.now(),
        args: { phase: 'checking', wasRunning: '1', crossEngine: 'true', crossResume: '1', resumeFailures: '3' },
        move: { phase: 'failed', code: 'RESUME_GAVE_UP' },
      });
      const { container } = render(() => <OperationProgress store={withInst(op)} commandLogStore={nullCommandLog} />);
      expect(screen.queryByTestId('operation-source-stopped-mv-cross')).toBeNull();
      const details = screen.getByTestId('operation-error-mv-cross');
      expect(details.querySelector('.tech-details__plain')?.textContent).toMatch(/tried several times and then stopped/);
      expect(visibleText(container as HTMLElement)).not.toMatch(/RESUME_GAVE_UP/);
      expect(details.querySelector('.tech-details__raw')?.textContent).toBe('RESUME_GAVE_UP: rsync failed');
      expect((details.querySelector('details.tech-details__toggle') as HTMLDetailsElement).open).toBe(false);
    });

    it('Done SOURCE_CHANGED: Not moved sentence, no source-stopped hint', () => {
      noteConnectedEngine(E1);
      const op = crossParked({
        status: 'Done',
        error: 'MOVE STOPPED: the source was started; source kept',
        completedAt: Date.now(),
        args: { phase: 'done', wasRunning: '1', crossEngine: 'true', crossResume: '1' },
        move: { phase: 'done', code: 'SOURCE_CHANGED' },
      });
      render(() => <OperationProgress store={withInst(op)} commandLogStore={nullCommandLog} />);
      expect(screen.getByText('⚠ Not moved')).toBeInTheDocument();
      expect(screen.getByTestId('operation-warning-mv-cross').textContent).toMatch(/was not moved: it changed/);
      expect(screen.queryByTestId('operation-source-stopped-mv-cross')).toBeNull();
    });
  });

});
