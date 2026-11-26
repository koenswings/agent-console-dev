/**
 * agent-engine-dev#582 retest answers (pixel-answers F8–F11): 503 STORE_NOT_READY,
 * 422 COMMAND_REFUSED local-only (createInstance), 413 PAYLOAD_TOO_LARGE, and a
 * follow-up trace refused with GRANT_EXPIRED shown in History with the issuer named.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineApiTransport } from '../src/store/engineApi';
import { clearEngineSessions, putEngineSession } from '../src/store/engineTokens';
import { commandGateFor, localOnlyText, olderEngineMessage, resetEngineVersionMismatches, sendSignedCommand, storeNotReadyText } from '../src/store/signedCommand';
import { historyGrantText, historyRowView } from '../src/store/historyRow';
import { GENERIC_ERROR_TEXT, plainEngineText, withEngineNames } from '../src/store/plainError';
import type { CommandTrace } from '../src/types/commandLog';
import type { Engine } from '../src/types/store';

const engine = (id: string, hostname: string): Engine =>
  ({ id, hostname, version: '1.0', lastBooted: 100, capabilities: ['signedCommands1'], capabilitiesBootedAt: 100, commands: [] }) as unknown as Engine;
const ENGINES: Record<string, Engine> = { 'eng-a': engine('eng-a', 'box-engine-a'), 'eng-b': engine('eng-b', 'box-engine-b') };

const answer = (status: number, body: unknown): EngineApiTransport => ({
  origin: '',
  selfEngineId: 'eng-a',
  fetch: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
});

beforeEach(() => {
  clearEngineSessions();
  resetEngineVersionMismatches();
  putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 900_000);
  putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 900_000);
});

describe('command answers with their own text', () => {
  it('503 STORE_NOT_READY: the Engine is named and the operator can try again', async () => {
    const t = answer(503, { error: 'STORE_NOT_READY', message: 'The store is not ready yet.' });
    const r = await sendSignedCommand({ transport: t, engines: ENGINES }, 'eng-b', 'summariseDisk d1');
    expect(r).toEqual({ kind: 'error', code: 'STORE_NOT_READY', status: 503, message: storeNotReadyText('box-engine-b') });
    expect(storeNotReadyText('box-engine-b')).toBe('box-engine-b is still starting and is not ready for commands yet. Try again in a moment.');
  });

  it('422 COMMAND_REFUSED local-only (createInstance): plain text, never a confirmation', async () => {
    const confirm = vi.fn();
    const t = answer(422, { error: 'COMMAND_REFUSED', reason: 'local-only', message: "'createInstance' only runs from the command line on this Engine. Use installApp instead." });
    const r = await sendSignedCommand({ transport: t, engines: ENGINES, confirm }, 'eng-a', 'createInstance kolibri koenswings d1');
    expect(r).toMatchObject({ kind: 'error', code: 'COMMAND_REFUSED', status: 422, message: localOnlyText('box-engine-a') });
    expect(localOnlyText('box-engine-a')).not.toMatch(/createInstance|installApp|command line/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('other COMMAND_REFUSED reasons keep the Engine sentence', async () => {
    const t = answer(422, { error: 'COMMAND_REFUSED', reason: 'validation', message: 'Card c1 is not present on this Engine.' });
    const r = await sendSignedCommand({ transport: t, engines: ENGINES }, 'eng-a', 'flashCard c1 current 1');
    expect(r).toMatchObject({ kind: 'error', message: 'Card c1 is not present on this Engine.' });
  });

  it('413 PAYLOAD_TOO_LARGE (checked before the token) is the "too long" text', async () => {
    const t = answer(413, { error: 'PAYLOAD_TOO_LARGE', message: 'Request body is larger than 16 KB.' });
    const r = await sendSignedCommand({ transport: t, engines: ENGINES }, 'eng-a', 'x');
    expect(r).toMatchObject({ kind: 'error', code: 'BODY_TOO_LARGE', message: 'That command is too long for the Engine.' });
  });
});

describe('GRANT_EXPIRED on a follow-up trace (F11)', () => {
  const trace = (over: Partial<CommandTrace>): CommandTrace => ({
    traceId: 't1', command: 'startInstance', args: '["i1","d-b"]', startedAt: 1, completedAt: 2, status: 'error',
    errorMessage: 'This permission has expired.', errorCode: 'GRANT_EXPIRED',
    result: JSON.stringify({ dispatchedTo: 'eng-b', issuerEngineId: 'eng-b' }), logs: [], ...over,
  } as CommandTrace);
  const name = (id: string) => String(ENGINES[id]?.hostname ?? id);

  it('names the issuing Engine and says to start again', () => {
    expect(historyGrantText(trace({}), name)).toBe(
      'Permission from box-engine-b expired, so this step did not run there. Start the copy, move or update again.',
    );
    expect(historyRowView(trace({}), null, name)).toEqual({
      tone: 'error', icon: '✗',
      message: 'Permission from box-engine-b expired, so this step did not run there. Start the copy, move or update again.',
    });
  });

  it('falls back to dispatchedTo, then to a neutral name', () => {
    expect(historyGrantText(trace({ result: JSON.stringify({ dispatchedTo: 'eng-b' }) }), name)).toContain('Permission from box-engine-b');
    expect(historyGrantText(trace({ result: null }), name)).toContain('Permission from another Engine');
  });

  it('only for grant codes on error traces', () => {
    expect(historyGrantText(trace({ status: 'ok', errorCode: null }), name)).toBeNull();
    expect(historyGrantText(trace({ errorCode: 'BUSY' }), name)).toBeNull();
  });
});

describe('plainEngineText hides stack traces and shell failures (#582 box retest)', () => {
  it('maps a failed erase helper message with a stack frame to the generic text', () => {
    const raw = 'sudo: /usr/local/sbin/idea-app-data: command not found\n    at Object.runSlotErase (file:///opt/engine/dist/src/data/EraseDisk.js:70:29) exit code: 1';
    expect(plainEngineText(raw)).toBe(GENERIC_ERROR_TEXT);
  });
  it('keeps a plain Engine sentence', () => {
    expect(plainEngineText('The disk was removed before the erase finished.')).toBe('The disk was removed before the erase finished.');
  });
});

describe('plainEngineText hides Node fs errors (#582 pool proof)', () => {
  it('maps a failed Restore mkdir to the generic text', () => {
    expect(plainEngineText("permission denied, mkdir '/disks/sdb3/instances'")).toBe(GENERIC_ERROR_TEXT);
    expect(plainEngineText("EACCES: permission denied, mkdir '/disks/sdb3/instances'")).toBe(GENERIC_ERROR_TEXT);
    expect(plainEngineText("no such file or directory, open '/disks/sdb1/META.yaml'")).toBe(GENERIC_ERROR_TEXT);
  });
  it('keeps plain sentences that mention permission', () => {
    expect(plainEngineText('Permission from idea03 expired. Start again.')).toBe('Permission from idea03 expired. Start again.');
  });
});

describe('409 ENGINE_VERSION_MISMATCH names the Engine in the body (console#265)', () => {
  const POOL: Record<string, Engine> = {
    ENGINE_idea04: engine('ENGINE_idea04', 'idea04'),
    ENGINE_idea01: engine('ENGINE_idea01', 'idea01'),
  };
  beforeEach(() => { putEngineSession('ENGINE_idea04', 't4', { id: 'op1', username: 'k' }, 900_000); });

  it('idea04 → idea01: blames and marks idea01, not idea04', async () => {
    const t = answer(409, { error: 'ENGINE_VERSION_MISMATCH', message: 'Engine ENGINE_idea01 runs an older Engine version (1.0).', engineId: 'ENGINE_idea01', version: '1.0' });
    const r = await sendSignedCommand({ transport: t, engines: POOL }, 'ENGINE_idea04', 'copyApp i1 d-a d-b');
    expect(r).toEqual({ kind: 'blocked', engineId: 'ENGINE_idea01', message: olderEngineMessage('idea01', '1.0') });
    expect(commandGateFor(POOL.ENGINE_idea04)).toEqual({ ok: true });
    expect(commandGateFor(POOL.ENGINE_idea01)).toEqual({ ok: false, message: olderEngineMessage('idea01', '1.0') });
  });

  it('without engineId in the body, falls back to the Engine the command went to', async () => {
    const t = answer(409, { error: 'ENGINE_VERSION_MISMATCH', message: 'Older Engine.', version: '0.9' });
    const r = await sendSignedCommand({ transport: t, engines: POOL }, 'ENGINE_idea04', 'disks');
    expect(r).toEqual({ kind: 'blocked', engineId: 'ENGINE_idea04', message: olderEngineMessage('idea04', '0.9') });
    expect(commandGateFor(POOL.ENGINE_idea04).ok).toBe(false);
  });
});

describe('History shows Engine hostnames, never raw ids (console#265)', () => {
  const name = (id: string) => ({ ENGINE_5vyahbut147hw5dp4e1: 'idea04', ENGINE_AA000000000000055000: 'idea01' } as Record<string, string>)[id] ?? null;
  const failed = (errorMessage: string): CommandTrace => ({
    traceId: 't9', command: 'copyApp', args: '[]', startedAt: 1, completedAt: 2, status: 'error', errorMessage, result: null, logs: [],
  } as unknown as CommandTrace);

  it('replaces a known id with its hostname', () => {
    expect(historyRowView(failed('Engine ENGINE_AA000000000000055000 runs an older Engine version (1.0).'), null, name).message)
      .toBe('Engine idea01 runs an older Engine version (1.0).');
  });
  it('uses a neutral phrase for an unknown id, never the raw id', () => {
    const msg = historyRowView(failed('Engine ENGINE_zz9unknown01 is not reachable.'), null, name).message ?? '';
    expect(msg).toBe('Another Engine is not reachable.');
    expect(msg).not.toMatch(/ENGINE_/);
    expect(historyRowView(failed('Could not reach ENGINE_5vyahbut147hw5dp4e1.'), null).message).toBe('Could not reach another Engine.');
  });
  it('names the grant issuer by hostname, else another Engine', () => {
    const g = (issuer: string): CommandTrace => ({ ...failed('expired'), errorCode: 'GRANT_EXPIRED', result: JSON.stringify({ issuerEngineId: issuer }) } as unknown as CommandTrace);
    expect(historyGrantText(g('ENGINE_5vyahbut147hw5dp4e1'), name)).toContain('Permission from idea04 expired');
    expect(historyGrantText(g('ENGINE_qq1unknown'), name)).toContain('Permission from another Engine expired');
    expect(historyGrantText(g('ENGINE_qq1unknown'))).not.toMatch(/ENGINE_/);
  });
  it('withEngineNames handles several ids', () => {
    expect(withEngineNames('Engines ENGINE_5vyahbut147hw5dp4e1, ENGINE_AA000000000000055000', name)).toBe('Engines idea04, idea01');
  });
});
