/**
 * idea#166 Phase 4 — operator control data-testids for Intent stubs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@solidjs/testing-library';
import EjectConfirm from '../src/components/EjectConfirm';
import EmptyDiskPanel from '../src/components/EmptyDiskPanel';
import DiskView from '../src/components/DiskView';
import InstanceRow from '../src/components/InstanceRow';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { Disk, Instance, App, Engine } from '../src/types/store';

afterEach(() => cleanup());

describe('Operator control data-testid (idea#166 Phase 4)', () => {
  it('EjectConfirm exposes confirm dialog + Cancel/Eject buttons', () => {
    const disk = () => MOCK_FILES_STORE.diskDB[I.FA_APP] as Disk;
    const { container } = render(() => (
      <EjectConfirm disk={disk} store={() => MOCK_FILES_STORE} onCancel={() => {}} onConfirm={() => {}} />
    ));
    expect(container.querySelector('[data-testid="eject-confirm"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="eject-confirm-cancel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="eject-confirm-ok"]')).not.toBeNull();
  });

  it('EmptyDiskPanel exposes make-files-disk', () => {
    const empty: Disk = {
      ...(MOCK_FILES_STORE.diskDB[I.FA_GONE] as Disk),
      diskTypes: ['empty'],
      sizeBytes: 64 * 1024 ** 3,
      freeBytes: 64 * 1024 ** 3,
    };
    const { container } = render(() => (
      <EmptyDiskPanel
        disk={() => empty}
        store={() => MOCK_FILES_STORE}
        engineId={() => I.ENGINE_A}
      />
    ));
    expect(container.querySelector('[data-testid="make-files-disk"]')).not.toBeNull();
    expect(screen.getByText('Make this a Files Disk')).toBeInTheDocument();
  });

  it('DiskView App disk exposes add-files', () => {
    const { container } = render(() => (
      <DiskView diskId={I.FA_APP} store={() => MOCK_FILES_STORE} />
    ));
    expect(container.querySelector('[data-testid="add-files"]')).not.toBeNull();
  });

  it('InstanceRow start/stop are id-keyed', () => {
    const instanceId = I.INST_NC_A;
    const instance = () => MOCK_FILES_STORE.instanceDB[instanceId] as Instance;
    const app = () => MOCK_FILES_STORE.appDB[instance()!.instanceOf] as App;
    const engine = () => MOCK_FILES_STORE.engineDB[I.ENGINE_A] as Engine;
    const { container } = render(() => (
      <InstanceRow
        instanceId={instanceId}
        instance={instance}
        app={app}
        engine={engine}
        store={() => MOCK_FILES_STORE}
      />
    ));
    expect(container.querySelector(`[data-testid="start-instance-${instanceId}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="stop-instance-${instanceId}"]`)).not.toBeNull();
  });
});
