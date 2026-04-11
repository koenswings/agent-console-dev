import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import OperationProgress from '../components/OperationProgress';
import { MOCK_STORE } from '../mock/mockStore';
import type { Operation, Store } from '../types/store';

const NOW = Date.now();

const makeOp = (overrides: Partial<Operation>): Operation => ({
  id: 'op-001',
  kind: 'copyApp',
  args: { instanceName: 'kolibri', sourceDiskName: 'kolibri-disk', targetDiskName: 'target-disk' },
  engineId: 'ENGINE_001',
  status: 'Running',
  progressPercent: 42,
  startedAt: NOW,
  completedAt: null,
  error: null,
  ...overrides,
});

const storeWith = (ops: Record<string, Operation>): () => Store =>
  () => ({ ...MOCK_STORE, operationDB: ops });

describe('OperationProgress', () => {
  it('renders nothing when operationDB is empty', () => {
    const { container } = render(() => (
      <OperationProgress store={() => MOCK_STORE} />
    ));
    expect(container.querySelector('.operation-progress')).toBeNull();
  });

  it('renders nothing when all operations are Done', () => {
    const op = makeOp({ status: 'Done' });
    const { container } = render(() => (
      <OperationProgress store={storeWith({ [op.id]: op })} />
    ));
    expect(container.querySelector('.operation-progress')).toBeNull();
  });

  it('renders a Running operation', () => {
    const op = makeOp({ status: 'Running', progressPercent: 55 });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    expect(screen.getByText('Copy app')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders a Pending operation', () => {
    const op = makeOp({ status: 'Pending', progressPercent: 0 });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders the progress bar for Running ops', () => {
    const op = makeOp({ status: 'Running', progressPercent: 70 });
    const { container } = render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    const fill = container.querySelector('.operation-card__progress-fill') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('70%');
  });

  it('shows error message for Failed operations', () => {
    const op = makeOp({ status: 'Failed', error: 'Disk full' });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    expect(screen.getByText('Disk full')).toBeInTheDocument();
  });

  it('applies operation-card--failed class on failed ops', () => {
    const op = makeOp({ status: 'Failed', error: 'Something went wrong' });
    const { container } = render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    expect(container.querySelector('.operation-card--failed')).toBeTruthy();
  });

  it('shows args summary for copy ops', () => {
    const op = makeOp({
      kind: 'copyApp',
      args: { instanceName: 'kolibri', sourceDiskName: 'src-disk', targetDiskName: 'dst-disk' },
    });
    render(() => <OperationProgress store={storeWith({ [op.id]: op })} />);
    expect(screen.getByText(/kolibri/)).toBeInTheDocument();
    expect(screen.getByText(/src-disk.*dst-disk/)).toBeInTheDocument();
  });

  it('renders multiple active operations', () => {
    const op1 = makeOp({ id: 'op-1', kind: 'copyApp', status: 'Running' });
    const op2 = makeOp({ id: 'op-2', kind: 'moveApp', status: 'Pending' });
    render(() => <OperationProgress store={storeWith({ [op1.id]: op1, [op2.id]: op2 })} />);
    expect(screen.getByText('Copy app')).toBeInTheDocument();
    expect(screen.getByText('Move app')).toBeInTheDocument();
  });
});
