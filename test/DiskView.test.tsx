/**
 * idea#132 — disk view: header badges in fixed order, sections per role,
 * Add Files (greyed out without a fresh 'filesDisk'), the share name field,
 * the createFilesDisk result, the Files section (three "available in"
 * states, Not mounted, low space, Eject).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import DiskView, { ADD_FILES_CONFIRMATION } from '../src/components/DiskView';
import { setSendCommandFn } from '../src/store/commands';
import { COMMAND_RESULT_TIMEOUT_MS, FILES_TIMEOUT_MESSAGE } from '../src/store/commandResult';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Disk, Engine, Store } from '../src/types/store';

const TOOLTIP = 'Update this Engine to manage this disk';

const renderView = (diskId: string, initial: Store = MOCK_FILES_STORE) => {
  const [store, setStore] = createSignal<Store | null>(initial);
  const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
  const utils = render(() => (
    <DiskView diskId={diskId} store={store} commandLogStore={cls} />
  ));
  return { ...utils, store, setStore, setCls };
};

const badges = (el: Element | null) =>
  Array.from(el?.querySelectorAll('[data-role]') ?? []).map((b) => b.getAttribute('data-role'));

const header = (c: HTMLElement) => c.querySelector('.disk-view__header');
const section = (c: HTMLElement, label: string) => c.querySelector(`section[aria-label="${label}"]`);
const addFilesButton = () => screen.getByRole('button', { name: 'Add Files to this disk' });

const trace = (over: Partial<CommandTrace>): CommandTrace => ({
  traceId: 't-new',
  command: 'createFilesDisk',
  args: { diskId: I.FA_APP, shareName: 'School Files' },
  startedAt: 0,
  completedAt: 0,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});
const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});

const withDisk = (s: Store, id: string, patch: Partial<Disk>): Store => ({
  ...s,
  diskDB: { ...s.diskDB, [id]: { ...s.diskDB[id], ...patch } },
});
const withEngine = (s: Store, id: string, patch: Partial<Engine>): Store => ({
  ...s,
  engineDB: { ...s.engineDB, [id]: { ...s.engineDB[id], ...patch } },
});

let sent: ReturnType<typeof vi.fn>;
beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('DiskView — header badges and sections per role', () => {
  it('app + backup + files: badges in fixed order and all three sections', () => {
    const { container } = renderView(I.FA_ABF);
    expect(header(container)!.textContent).toContain('All Roles');
    expect(badges(header(container))).toEqual(['app', 'backup', 'files']);
    expect(container.querySelector('.instance-list__title')!.textContent).toBe('Apps');
    expect(container.querySelector('.restore-panel__title')!.textContent).toBe('Backups');
    expect(section(container, 'Files')).not.toBeNull();
    expect(section(container, 'Add Files')).toBeNull();
  });

  it('app + files: Apps and Files sections, no Backups', () => {
    const { container } = renderView(I.FA_APP_FILES);
    expect(badges(header(container))).toEqual(['app', 'files']);
    expect(container.querySelector('.instance-list')).not.toBeNull();
    expect(container.querySelector('.restore-panel')).toBeNull();
    expect(section(container, 'Files')).not.toBeNull();
  });

  it('pure Backup Disk: Backups section and Add Files, no Apps or Files', () => {
    const { container } = renderView(I.FA_BACKUP);
    expect(badges(header(container))).toEqual(['backup']);
    expect(container.querySelector('.restore-panel')).not.toBeNull();
    expect(container.querySelector('.instance-list')).toBeNull();
    expect(section(container, 'Files')).toBeNull();
    expect(addFilesButton()).not.toBeDisabled();
  });

  it('Files Disk (alone): no Files button', () => {
    const { container } = renderView(I.FA_FILES);
    expect(section(container, 'Add Files')).toBeNull();
    expect(screen.queryByRole('button', { name: /add files/i })).toBeNull();
  });
});

describe('DiskView — Add Files behind the filesDisk capability', () => {
  it('enabled on a fresh filesDisk Engine (no tooltip)', () => {
    renderView(I.FA_APP);
    expect(addFilesButton()).not.toBeDisabled();
    expect(addFilesButton().hasAttribute('title')).toBe(false);
  });

  it('greyed out with the tooltip when capabilities are missing', () => {
    renderView(I.FC_APP);
    expect(addFilesButton()).toBeDisabled();
    expect(addFilesButton().getAttribute('title')).toBe(TOOLTIP);
  });

  it('greyed out when filesDisk is present but the stamp is stale', () => {
    renderView(I.FA_APP, withEngine(MOCK_FILES_STORE, I.ENGINE_A, { lastBooted: 1 }));
    expect(addFilesButton()).toBeDisabled();
    expect(addFilesButton().getAttribute('title')).toBe(TOOLTIP);
  });

  it('greyed out on a 0b Engine with diskIdArgs only', () => {
    renderView(I.FA_APP, withEngine(MOCK_FILES_STORE, I.ENGINE_A, { capabilities: ['diskIdArgs'] }));
    expect(addFilesButton()).toBeDisabled();
  });
});

describe('DiskView — Add Files flow and result', () => {
  const open = () => fireEvent.click(addFilesButton());
  const shareInput = () => screen.getByLabelText('Share name') as HTMLInputElement;
  const submit = () => screen.getByRole('button', { name: 'Add Files' });

  it('shows the confirmation and the share name pre-filled with "School Files"', () => {
    renderView(I.FA_APP);
    open();
    expect(screen.getByText(ADD_FILES_CONFIRMATION)).toBeInTheDocument();
    expect(shareInput().value).toBe('School Files');
    expect(submit()).not.toBeDisabled();
  });

  it('validates the share name as typed and disables the button', () => {
    renderView(I.FA_APP);
    open();
    fireEvent.input(shareInput(), { target: { value: 'Way too long share name' } });
    expect(screen.getByText('At most 16 characters.')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.input(shareInput(), { target: { value: 'Files/Docs' } });
    expect(screen.getByText(/Use only letters/)).toBeInTheDocument();
    fireEvent.input(shareInput(), { target: { value: 'Class 5 (A)' } });
    expect(screen.queryByText(/Use only letters|At most/)).toBeNull();
    expect(submit()).not.toBeDisabled();
  });

  it('sends createFilesDisk <diskId> <shareName>', () => {
    renderView(I.FA_APP);
    open();
    fireEvent.input(shareInput(), { target: { value: 'Class 5 (A)' } });
    fireEvent.click(submit());
    expect(sent).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `createFilesDisk ${I.FA_APP} Class 5 (A)`);
    expect(screen.getByText('Waiting for the Engine…')).toBeInTheDocument();
  });

  it('error: shows the Engine message in the flow', () => {
    const t = renderView(I.FA_APP);
    open();
    fireEvent.click(submit());
    t.setCls(log(trace({ status: 'error', errorMessage: 'Kolibri Disk has other files on it.' })));
    expect(screen.getByRole('alert').textContent).toBe('Kolibri Disk has other files on it.');
  });

  it('success: ok trace and the disk gains files → files badge and Files section appear', () => {
    const t = renderView(I.FA_APP);
    open();
    fireEvent.click(submit());
    t.setCls(log(trace({})));
    expect(screen.queryByText(/Done\./)).toBeNull(); // ok, but no 'files' yet
    t.setStore(withDisk(t.store()!, I.FA_APP, { diskTypes: ['app', 'files'], filesConfig: { shareName: 'School Files', readOnly: false, passwordProtected: false, error: null } }));
    expect(screen.getByText('Done. This disk is now a Files Disk.')).toBeInTheDocument();
    expect(badges(header(t.container))).toEqual(['app', 'files']);
    expect(section(t.container, 'Files')).not.toBeNull();
  });

  it('timeout: the Files message after 15 s', () => {
    vi.useFakeTimers();
    renderView(I.FA_APP);
    open();
    fireEvent.click(submit());
    vi.advanceTimersByTime(COMMAND_RESULT_TIMEOUT_MS);
    expect(screen.getByText(FILES_TIMEOUT_MESSAGE)).toBeInTheDocument();
    expect(FILES_TIMEOUT_MESSAGE).toBe("The Engine didn't respond. It may not support Files Disks yet.");
  });
});

describe('FilesSection — states', () => {
  const filesText = (c: HTMLElement) => section(c, 'Files')!.textContent ?? '';

  it('mounted: "Available in: Nextcloud (nextcloud-01)", share name, size', () => {
    const { container } = renderView(I.FA_FILES);
    expect(filesText(container)).toContain('Available in: Nextcloud (nextcloud-01)');
    expect(filesText(container)).toContain('Share name: School Files');
    expect(filesText(container)).toContain('40.0 GB free of 64.0 GB');
  });

  it("opted in but not running: \"Nextcloud supports Files Disks but isn't running\"", () => {
    const { container } = renderView(I.FB_FILES);
    expect(filesText(container)).toContain("Nextcloud supports Files Disks but isn't running");
  });

  it('none: "No App on this Engine uses Files Disks yet"', () => {
    const { container } = renderView(I.FC_FILES);
    expect(filesText(container)).toContain('No App on this Engine uses Files Disks yet');
  });

  it('Not mounted: password-protected', () => {
    const { container } = renderView(I.FA_PASSWORD);
    expect(screen.getByRole('alert').textContent).toBe('Not mounted: password-protected Files Disks are not supported yet');
    expect(filesText(container)).not.toContain('Available in');
  });

  it('Not mounted: stuck unmount (unmountError)', () => {
    renderView(I.FA_UNMOUNT);
    expect(screen.getByRole('alert').textContent).toBe("Not mounted: Stuck Files couldn't be unmounted cleanly. Restart this Pi.");
  });

  it('low space on a combined disk says the Apps need space too', () => {
    const { container } = renderView(I.FA_APP_FILES);
    expect(container.querySelector('.files-section__low-space')!.textContent).toBe(
      'Low space: 1.0 GB free of 32.0 GB. The Apps on this disk need space too.'
    );
  });

  it('Eject sends ejectDisk <diskId> and shows a refusal inline', () => {
    const t = renderView(I.FA_FILES);
    fireEvent.click(screen.getByRole('button', { name: 'Eject' }));
    expect(sent).toHaveBeenCalledWith(I.ENGINE_A, `ejectDisk ${I.FA_FILES}`);
    t.setCls(log(trace({ command: 'ejectDisk', args: { diskId: I.FA_FILES }, status: 'error', errorMessage: 'locked' })));
    expect(screen.getByRole('alert').textContent).toBe("Couldn't eject School Files: locked");
  });
});
