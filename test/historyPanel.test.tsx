/**
 * idea#454 — the collapsed History row shows a clearBackupLock nothing-to-clear
 * message in a neutral info tone, and a successful clear stays green.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import HistoryPanel from '../src/components/HistoryPanel';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';

afterEach(cleanup);

const inst = 'i-kolibri';
const NOTHING = `no backup lock to clear for ${inst}`;

const trace = (id: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: id,
  command: 'clearBackupLock',
  args: { instanceId: inst, backupDiskId: 'disk-backup' },
  startedAt: 0,
  completedAt: 1,
  status: 'ok',
  errorMessage: null,
  logs: [],
  ...over,
});

const log = (...traces: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(traces.map((t) => [t.traceId, t])),
  recentTraceIds: traces.map((t) => t.traceId),
});

const mount = (cls: CommandLogStore) =>
  render(() => <HistoryPanel commandLogStore={() => cls} onClose={() => {}} />);

describe('HistoryPanel collapsed row (idea#454)', () => {
  it('cleared:false shows result.message in info tone, not a green check or red error', () => {
    const result = JSON.stringify({
      instanceId: inst,
      backupDiskId: 'disk-backup',
      lockPath: '/mnt/backup/.backup-in-progress',
      startedAt: null,
      cleared: false,
      lockFileRemoved: false,
      message: NOTHING,
    });
    mount(log(trace('lock-info', { result })));
    const status = document.querySelector('[data-testid="history-entry-status-lock-info"]')!;
    const message = document.querySelector('[data-testid="history-entry-message-lock-info"]')!;
    expect(status.className).toContain('history-entry__status--info');
    expect(status.className).not.toContain('history-entry__status--ok');
    expect(status.className).not.toContain('history-entry__status--error');
    expect(status.textContent).toBe('ℹ');
    expect(message.className).toBe('history-entry__info-msg');
    expect(message.textContent).toBe(NOTHING);
    expect(document.querySelector('.history-entry__error-msg')).toBeNull();
    expect(document.querySelector('.history-entry__status--ok')).toBeNull();
  });

  it('cleared:true stays a green success with no info or error message', () => {
    const result = JSON.stringify({
      instanceId: inst,
      backupDiskId: 'disk-backup',
      lockPath: '/mnt/backup/.backup-in-progress',
      startedAt: 1,
      cleared: true,
      lockFileRemoved: true,
    });
    mount(log(trace('lock-ok', { result })));
    const status = document.querySelector('[data-testid="history-entry-status-lock-ok"]')!;
    expect(status.className).toContain('history-entry__status--ok');
    expect(status.className).not.toContain('history-entry__status--info');
    expect(status.textContent).toBe('✓');
    expect(document.querySelector('[data-testid="history-entry-message-lock-ok"]')).toBeNull();
    expect(document.querySelector('.history-entry__info-msg')).toBeNull();
    expect(document.querySelector('.history-entry__error-msg')).toBeNull();
  });
});
