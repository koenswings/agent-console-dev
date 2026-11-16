/**
 * engine#471 (b): command-log text fields arrive as a plain string (old logs)
 * or an Automerge ImmutableString (new Engine). Every reader must accept both.
 */
import { describe, it, expect } from 'vitest';
import { ImmutableString } from '@automerge/automerge-repo';
import { isImmutableString, logJson, logText } from '../src/store/logText';
import { historyRowView, parseTraceResult } from '../src/store/historyRow';
import { findCommandOutcome, traceArg, traceArgsObject, traceErrorCode } from '../src/store/commandResult';
import { restartFailedFromTraceResult } from '../src/store/updateApp';
import { findEjectOutcome } from '../src/store/ejectResult';
import { parseContentSummary } from '../src/store/erase';
import { parseFlashResult } from '../src/store/clientCards';
import type { CommandLogStore, CommandTrace, LogTextValue } from '../src/types/commandLog';

/** The automerge class itself, as the repo hands it out. */
const imm = (s: string): LogTextValue => new ImmutableString(s) as unknown as LogTextValue;
/** A second bundled copy of automerge: same registry symbol, different class. */
const foreignImm = (s: string): LogTextValue => {
  const o = { val: s, toString: () => s, toJSON: () => s };
  Object.defineProperty(o, Symbol.for('_am_immutableString'), { value: true });
  return o;
};

describe('isImmutableString', () => {
  it('detects the automerge class and a foreign copy by symbol, not instanceof', () => {
    expect(isImmutableString(new ImmutableString('x'))).toBe(true);
    expect(isImmutableString(foreignImm('x'))).toBe(true);
  });
  it('rejects plain strings, null and objects that only happen to have a val', () => {
    expect(isImmutableString('x')).toBe(false);
    expect(isImmutableString(null)).toBe(false);
    expect(isImmutableString(undefined)).toBe(false);
    expect(isImmutableString({ val: 'x' })).toBe(false);
  });
});

describe('logText', () => {
  it('plain string passes through', () => {
    expect(logText('boom')).toBe('boom');
    expect(logText('')).toBe('');
  });
  it('ImmutableString yields its val', () => {
    expect(logText(imm('boom'))).toBe('boom');
    expect(logText(foreignImm('boom'))).toBe('boom');
  });
  it('null and undefined yield null', () => {
    expect(logText(null)).toBeNull();
    expect(logText(undefined)).toBeNull();
  });
});

describe('logJson', () => {
  it('parses a plain JSON string', () => {
    expect(logJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses an ImmutableString holding JSON', () => {
    expect(logJson(imm('{"restartFailed":true}'))).toEqual({ restartFailed: true });
    expect(logJson(foreignImm('["d1"]'))).toEqual(['d1']);
  });
  it('null, undefined and empty text yield null', () => {
    expect(logJson(null)).toBeNull();
    expect(logJson(undefined)).toBeNull();
    expect(logJson('')).toBeNull();
    expect(logJson(imm(''))).toBeNull();
  });
  it('a legacy/mock object passes through unchanged', () => {
    const o = { instanceId: 'i1' };
    expect(logJson(o)).toBe(o);
  });
  it('bad JSON throws, for a string and an ImmutableString', () => {
    expect(() => logJson('{nope')).toThrow(SyntaxError);
    expect(() => logJson(imm('{nope'))).toThrow(SyntaxError);
  });
});

const trace = (id: string, over: Partial<CommandTrace> = {}): CommandTrace => ({
  traceId: id,
  command: 'updateApp',
  args: imm(JSON.stringify({ instanceId: 'i1' })),
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

describe('mixed command log (old plain-string traces next to ImmutableString traces)', () => {
  const newRestart = trace('new-restart', {
    status: 'error',
    errorMessage: imm('\u001b[31mBACKUP_FAILED: the pre-update backup failed\u001b[0m'),
    errorCode: 'BACKUP_FAILED',
    result: imm(JSON.stringify({ restartFailed: true })),
    logs: [{ level: 'error', message: imm('last error line'), timestamp: 1 }],
  });
  const oldRestart = trace('old-restart', {
    args: JSON.stringify({ instanceId: 'i2' }),
    status: 'error',
    errorMessage: 'BACKUP_FAILED: old engine',
    result: JSON.stringify({ restartFailed: true }),
  });
  const newLock = trace('new-lock', {
    command: 'clearBackupLock',
    args: imm(JSON.stringify({ instanceId: 'i3', backupDiskId: 'b1' })),
    result: imm(JSON.stringify({ cleared: false, message: 'no backup lock to clear' })),
  });
  const newCode = trace('new-code', {
    args: imm(JSON.stringify({ instanceId: 'i4' })),
    status: 'error',
    errorMessage: null,
    result: imm(JSON.stringify({ code: 'NO_SUMS' })),
    logs: [{ level: 'error', message: imm('\u001b[33mfrom the log\u001b[0m'), timestamp: 1 }],
  });
  const l = log(oldRestart, newRestart, newLock, newCode);

  it('updateApp restartFailed is seen on an ImmutableString result and on a plain one', () => {
    expect(restartFailedFromTraceResult(newRestart.result)).toBe(true);
    expect(restartFailedFromTraceResult(oldRestart.result)).toBe(true);
    expect(findCommandOutcome(l, new Set(), 'updateApp', 'instanceId', 'i1')).toEqual({
      kind: 'error',
      message: 'BACKUP_FAILED: the pre-update backup failed',
      code: 'BACKUP_FAILED',
      restartFailed: true,
    });
    expect(findCommandOutcome(l, new Set(), 'updateApp', 'instanceId', 'i2')).toEqual({
      kind: 'error',
      message: 'BACKUP_FAILED: old engine',
      restartFailed: true,
    });
  });

  it('commandResult reads ImmutableString args, result codes and error log lines', () => {
    expect(traceArg(newRestart, 'instanceId')).toBe('i1');
    expect(traceArgsObject(newLock)).toEqual({ instanceId: 'i3', backupDiskId: 'b1' });
    expect(traceErrorCode(newCode)).toBe('NO_SUMS');
    expect(findCommandOutcome(l, new Set(), 'updateApp', 'instanceId', 'i4')).toEqual({
      kind: 'error',
      message: 'from the log',
      code: 'NO_SUMS',
    });
    expect(findCommandOutcome(l, new Set(), 'updateApp', 'instanceId', 'i1', 'substring')).toMatchObject({ kind: 'error' });
  });

  it('historyRow reads ImmutableString result and errorMessage', () => {
    expect(parseTraceResult(newLock)).toEqual({ cleared: false, message: 'no backup lock to clear' });
    expect(historyRowView(newLock)).toEqual({ tone: 'info', icon: 'ℹ', message: 'no backup lock to clear' });
    const row = historyRowView(newRestart);
    expect(row.tone).toBe('error');
    expect(row.message).toBeTruthy();
    expect(row.message).not.toContain('[object');
    expect(parseTraceResult(trace('empty', { result: imm('') }))).toBeNull();
    const mb = historyRowView(trace('mb', {
      command: 'makeBackupDisk',
      status: 'error',
      errorMessage: imm('TOO_SMALL: this disk is 2000000000 bytes; a Backup Disk must be at least 8589934592 bytes (8 GiB).'),
      errorCode: 'TOO_SMALL',
    }));
    expect(mb).toEqual({
      tone: 'error',
      icon: '✗',
      message: 'Too small: needs more than 8 GB. Choose a disk larger than all the App data on this Pi.',
    });
  });

  it('eject, erase and flash readers accept ImmutableString', () => {
    const eject = trace('ej', {
      command: 'ejectDisk',
      args: imm(JSON.stringify({ diskId: 'D1' })),
      status: 'error',
      errorMessage: imm('not currently docked'),
    });
    expect(findEjectOutcome(log(eject), new Set(), 'D1')).toEqual({ kind: 'error', message: 'not currently docked' });
    const summary = trace('sum', { command: 'summariseDisk', result: imm(JSON.stringify({ label: 'IDEA-1' })) });
    expect(parseContentSummary(summary)).toMatchObject({ label: 'IDEA-1' });
    const flash = trace('fl', { command: 'flashClientCard', result: imm(JSON.stringify({ safeToRemove: true })) });
    expect(parseFlashResult(flash)).toEqual({ safeToRemove: true });
  });
});
