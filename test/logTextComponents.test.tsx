/**
 * engine#471 (b): History and log lines render ImmutableString command-log
 * fields as text, never `[object Object]` or a `val` key.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ImmutableString } from '@automerge/automerge-repo';
import HistoryPanel from '../src/components/HistoryPanel';
import LogLines from '../src/components/LogLines';
import type { CommandLogStore, CommandTrace, LogTextValue } from '../src/types/commandLog';

afterEach(cleanup);

const imm = (s: string): LogTextValue => new ImmutableString(s) as unknown as LogTextValue;

const trace: CommandTrace = {
  traceId: 'imm-1',
  command: 'backupApp',
  args: imm(JSON.stringify({ instanceId: 'i-kolibri', backupDiskId: 'disk-b' })),
  startedAt: 0,
  completedAt: 1000,
  status: 'error',
  errorMessage: imm('backup failed: disk full'),
  logs: [{ level: 'error', message: imm('\u001b[31mrsync: no space left\u001b[0m'), timestamp: 500 }],
};
const log: CommandLogStore = { traces: { [trace.traceId]: trace }, recentTraceIds: [trace.traceId] };

describe('ImmutableString command-log fields in the UI (engine#471 b)', () => {
  it('HistoryPanel shows the error text and named args of an ImmutableString trace', () => {
    render(() => <HistoryPanel commandLogStore={() => log} onClose={() => {}} />);
    const row = document.querySelector('[data-testid="history-entry-status-imm-1"]')!.closest('button')!;
    fireEvent.click(row);
    const text = document.body.textContent ?? '';
    expect(text).toContain('disk full');
    expect(text).toContain('instanceId');
    expect(text).toContain('i-kolibri');
    expect(text).toContain('backupDiskId');
    expect(text).not.toContain('[object Object]');
    const keys = [...document.querySelectorAll('.history-entry__meta dt')].map((d) => d.textContent);
    expect(keys).toContain('instanceId');
    expect(keys).toContain('backupDiskId');
    expect(keys).not.toContain('val');
  });

  it('LogLines renders an ImmutableString message without ANSI codes', () => {
    render(() => <LogLines logs={trace.logs} />);
    const row = document.querySelector('.log-lines__row')!;
    expect(row.textContent).toContain('rsync: no space left');
    expect(row.textContent).not.toContain('\u001b');
    expect(row.textContent).not.toContain('[object Object]');
  });
});
