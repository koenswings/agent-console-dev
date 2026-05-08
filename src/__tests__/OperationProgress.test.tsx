import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import OperationProgress from '../components/OperationProgress';
import { MOCK_STORE } from '../mock/mockStore';
import type { Operation, Store } from '../types/store';
import type { CommandLogStore } from '../types/commandLog';

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

const storeWith = (ops: Record<string, Operation>): () => Store =>
  () => ({ ...MOCK_STORE, operationDB: ops });

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
    const fill = container.querySelector('.operation-card__progress-fill') as HTMLElement;
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
});
