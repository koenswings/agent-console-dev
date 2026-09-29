/**
 * idea#129 — EmptyDiskPanel on 0b, old and rolled-back Engines: disk ID vs
 * unique name, greyed-out Backup/Install with the update tooltip, and the
 * Files card shown only with a fresh 'filesDisk' flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import EmptyDiskPanel from '../src/components/EmptyDiskPanel';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_STORE, MOCK_ENGINE_VARIANTS } from '../src/mock/mockStore';
import type { App, Disk, Engine, Store } from '../src/types/store';

const ENGINE_ID = 'ENGINE_IDEA03';
const TOOLTIP = 'Update this Engine to manage this disk';

const target: Disk = {
  id: 'DISK_TARGET',
  name: 'IDEA-Disk',
  device: 'sdb1',
  created: 1,
  lastDocked: 1,
  dockedTo: ENGINE_ID,
  diskTypes: ['empty'],
  backupConfig: null,
};
// Second record with the same name on the same Engine (idea03 system-boot pattern)
const twin: Disk = { ...target, id: 'DISK_TWIN', device: null, diskTypes: [] };
const source: Disk = { ...target, id: 'DISK_SOURCE', name: 'catalog-disk', device: 'sdc1', diskTypes: ['app'] };

const diskApp: App = {
  id: 'kolibri-disk-app',
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri From Disk',
  description: null,
  url: null,
  category: 'education',
  icon: null,
  author: null,
  source: 'disk',
  sourceDiskId: source.id,
  sourceDiskName: source.name,
};

const asEngine = (variant: Engine, over: Partial<Engine> = {}): Engine => ({ ...variant, id: ENGINE_ID, ...over });
const current = asEngine(MOCK_ENGINE_VARIANTS.current);
const old = asEngine(MOCK_ENGINE_VARIANTS.old);
const rolledBack = asEngine(MOCK_ENGINE_VARIANTS.rolledBack);

const storeWith = (engine: Engine, disks: Disk[]): Store => ({
  ...MOCK_STORE,
  engineDB: { [ENGINE_ID]: engine } as Store['engineDB'],
  diskDB: Object.fromEntries(disks.map((d) => [d.id, d])) as Store['diskDB'],
  appDB: { [diskApp.id]: diskApp } as Store['appDB'],
});

const renderPanel = (store: Store) =>
  render(() => (
    <EmptyDiskPanel disk={() => target} store={() => store} engineId={() => ENGINE_ID} />
  ));

const card = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement;

const installFirstApp = () => {
  fireEvent.click(card('Install App'));
  fireEvent.click(screen.getAllByRole('radio')[0]);
  fireEvent.click(screen.getByRole('button', { name: /^install app$/i }));
};

const configureBackup = () => {
  fireEvent.click(card('Make this a Backup Disk'));
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.click(screen.getByRole('button', { name: /configure backup disk/i }));
};

describe('EmptyDiskPanel — disk arguments per Engine (idea#129)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  it('0b Engine: installApp sends the target and --source disk IDs', () => {
    renderPanel(storeWith(current, [target, twin, source]));
    installFirstApp();
    expect(sent).toHaveBeenCalledWith(ENGINE_ID, 'installApp kolibri-disk-app DISK_TARGET --source DISK_SOURCE');
  });

  it('0b Engine: createBackupDisk sends the disk ID even though the name is shared', () => {
    renderPanel(storeWith(current, [target, twin]));
    configureBackup();
    const [, cmd] = sent.mock.calls[0];
    expect(cmd).toMatch(/^createBackupDisk DISK_TARGET on-demand \S+/);
  });

  it('old Engine, unique name: installApp sends names (as before)', () => {
    renderPanel(storeWith(old, [target, source]));
    installFirstApp();
    expect(sent).toHaveBeenCalledWith(ENGINE_ID, 'installApp kolibri-disk-app IDEA-Disk --source catalog-disk');
  });

  it('rolled-back Engine, unique name: createBackupDisk sends the name', () => {
    renderPanel(storeWith(rolledBack, [target]));
    configureBackup();
    const [, cmd] = sent.mock.calls[0];
    expect(cmd).toMatch(/^createBackupDisk IDEA-Disk on-demand \S+/);
  });

  it.each([
    ['old', old],
    ['rolled-back', rolledBack],
  ])('%s Engine, shared name: Backup and Install are greyed out with the tooltip', (_label, engine) => {
    renderPanel(storeWith(engine, [target, twin]));
    for (const title of ['Make this a Backup Disk', 'Install App']) {
      const btn = card(title);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute('title')).toBe(TOOLTIP);
      fireEvent.click(btn);
    }
    // Still on the menu; nothing sent
    expect(screen.getByText('What would you like to do with this disk?')).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
  });

  it('0b Engine: Backup and Install are enabled with no tooltip', () => {
    renderPanel(storeWith(current, [target, twin]));
    for (const title of ['Make this a Backup Disk', 'Install App']) {
      const btn = card(title);
      expect(btn).not.toBeDisabled();
      expect(btn.hasAttribute('title')).toBe(false);
    }
  });
});

describe('EmptyDiskPanel — Make this a Files Disk behind the filesDisk flag (idea#129, idea#132)', () => {
  let sent: ReturnType<typeof vi.fn>;
  beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
  afterEach(() => cleanup());

  const expectGreyedOut = () => {
    const btn = card('Make this a Files Disk');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toBe(TOOLTIP);
    fireEvent.click(btn);
    expect(screen.getByText('What would you like to do with this disk?')).toBeInTheDocument();
  };

  it('greyed out when the capabilities field is missing', () => {
    renderPanel(storeWith(old, [target]));
    expectGreyedOut();
  });

  it('greyed out on a 0b Engine without filesDisk', () => {
    renderPanel(storeWith(current, [target]));
    expectGreyedOut();
  });

  it('greyed out when filesDisk is present but the stamp does not match lastBooted', () => {
    renderPanel(storeWith(asEngine(MOCK_ENGINE_VARIANTS.rolledBack, { capabilities: ['diskIdArgs', 'filesDisk'] }), [target]));
    expectGreyedOut();
  });

  it('enabled with a fresh filesDisk flag and sends createFilesDisk <diskId> School Files', () => {
    renderPanel(storeWith(asEngine(MOCK_ENGINE_VARIANTS.current, { capabilities: ['diskIdArgs', 'filesDisk'] }), [target]));
    const btn = card('Make this a Files Disk');
    expect(btn).not.toBeDisabled();
    expect(btn.hasAttribute('title')).toBe(false);
    fireEvent.click(btn);
    expect(screen.getByText(/Nothing on the disk is erased/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make this a Files Disk' }));
    expect(sent).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(ENGINE_ID, 'createFilesDisk DISK_TARGET School Files');
  });
});
