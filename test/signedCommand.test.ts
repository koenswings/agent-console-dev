/**
 * POST /api/command with confirmation, grants and the older-Engine gate
 * (agent-engine-dev#582 §3, §5), against mocked endpoints.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineApiTransport } from '../src/store/engineApi';
import { clearEngineSessions, putEngineSession, tokenFor } from '../src/store/engineTokens';
import {
  commandGateFor,
  olderEngineMessage,
  resetEngineVersionMismatches,
  sendSignedCommand,
  type ConfirmRequest,
  type SendDeps,
} from '../src/store/signedCommand';
import type { Engine } from '../src/types/store';

const engine = (id: string, hostname: string, opts: { signed?: boolean; version?: string; stale?: boolean } = {}): Engine =>
  ({
    id,
    hostname,
    version: opts.version ?? '2.0.0',
    lastBooted: 100,
    capabilities: opts.signed === false ? ['diskIdArgs'] : ['diskIdArgs', 'signedCommands1'],
    capabilitiesBootedAt: opts.stale ? 50 : 100,
    commands: [],
  }) as unknown as Engine;

const ENGINES: Record<string, Engine> = {
  'eng-a': engine('eng-a', 'idea03'),
  'eng-b': engine('eng-b', 'idea04'),
  'eng-old': engine('eng-old', 'idea01', { signed: false, version: '1.4.2' }),
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function transport(handler: (c: Call, n: number) => { status: number; body?: unknown }): { t: EngineApiTransport; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    const r = handler(call, calls.length);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { t: { origin: '', selfEngineId: 'eng-a', fetch: fetchFn }, calls };
}

const deps = (t: EngineApiTransport, confirm?: SendDeps['confirm']): SendDeps => ({ transport: t, engines: ENGINES, confirm });

beforeEach(() => {
  clearEngineSessions();
  resetEngineVersionMismatches();
  putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 900_000);
  putEngineSession('eng-b', 'tb', { id: 'op1', username: 'k' }, 900_000);
});

describe('older-Engine gate', () => {
  it('has the exact text', () => {
    expect(olderEngineMessage('idea01', '1.4.2')).toBe(
      'idea01 runs an older Engine version (1.4.2). Commands to it are switched off until it is updated. Its apps and disks keep syncing.',
    );
  });

  it('blocks an Engine without signedCommands1, or with a stale capability stamp', () => {
    expect(commandGateFor(ENGINES['eng-a'])).toEqual({ ok: true });
    expect(commandGateFor(ENGINES['eng-old'])).toEqual({ ok: false, message: olderEngineMessage('idea01', '1.4.2') });
    const stale = engine('eng-s', 'idea05', { stale: true, version: '2.0.0' });
    expect(commandGateFor(stale).ok).toBe(false);
    expect(commandGateFor(undefined)).toEqual({ ok: false, message: 'This Engine is not in the store.' });
  });

  it('sends nothing to an older Engine', async () => {
    const { t, calls } = transport(() => ({ status: 202, body: {} }));
    const r = await sendSignedCommand(deps(t), 'eng-old', 'reboot');
    expect(r).toEqual({ kind: 'blocked', engineId: 'eng-old', message: olderEngineMessage('idea01', '1.4.2') });
    expect(calls).toHaveLength(0);
  });

  it('ENGINE_VERSION_MISMATCH from the relay switches that Engine off for later commands', async () => {
    const { t, calls } = transport(() => ({ status: 409, body: { error: 'ENGINE_VERSION_MISMATCH', message: 'old', version: '1.9.9' } }));
    const r = await sendSignedCommand(deps(t), 'eng-b', 'reboot');
    expect(r).toEqual({ kind: 'blocked', engineId: 'eng-b', message: olderEngineMessage('idea04', '1.9.9') });
    expect(commandGateFor(ENGINES['eng-b']).ok).toBe(false);
    await sendSignedCommand(deps(t), 'eng-b', 'reboot');
    expect(calls).toHaveLength(1);
  });
});

describe('sendSignedCommand', () => {
  it('posts the plain command with the Engine token and returns the seq', async () => {
    const { t, calls } = transport(() => ({ status: 202, body: { engineId: 'eng-a', seq: 41 } }));
    expect(await sendSignedCommand(deps(t), 'eng-a', 'startInstance kolibri d1')).toEqual({ kind: 'accepted', engineId: 'eng-a', seq: 41 });
    expect(calls[0].url).toBe('/api/command');
    expect(calls[0].body).toEqual({ command: 'startInstance kolibri d1' });
    expect(calls[0].headers.Authorization).toBe('Bearer ta');
  });

  it('goes through the relay with that Engine\'s own token', async () => {
    const { t, calls } = transport(() => ({ status: 202, body: { engineId: 'eng-b', seq: 7 } }));
    await sendSignedCommand(deps(t), 'eng-b', 'reboot');
    expect(calls[0].url).toBe('/api/engines/eng-b/command');
    expect(calls[0].headers.Authorization).toBe('Bearer tb');
  });

  it('asks for sign-in when there is no token, and drops a token the Engine refuses', async () => {
    const { t, calls } = transport(() => ({ status: 401, body: { error: 'TOKEN_EXPIRED', message: 'x' } }));
    clearEngineSessions();
    expect(await sendSignedCommand(deps(t), 'eng-a', 'reboot')).toEqual({ kind: 'signInRequired', engineIds: ['eng-a'] });
    expect(calls).toHaveLength(0);
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 900_000);
    expect(await sendSignedCommand(deps(t), 'eng-a', 'reboot')).toEqual({ kind: 'signInRequired', engineIds: ['eng-a'] });
    expect(tokenFor('eng-a')).toBeNull();
  });

  it('428: shows the Engine summary and resends with confirmId and the typed text', async () => {
    const summary = { label: 'Spare', sizeBytes: 64e9, device: 'sdb', apps: ['kolibri'] };
    const { t, calls } = transport((c) =>
      c.body.confirmId
        ? { status: 202, body: { engineId: 'eng-a', seq: 9 } }
        : { status: 428, body: { error: 'CONFIRM_REQUIRED', message: 'Confirm', confirmId: 'cf1', summary, expiresInMs: 60_000, confirmField: 'label' } });
    const confirm = vi.fn(async (req: ConfirmRequest) => {
      expect(req.summary).toEqual(summary);
      expect(req.confirmField).toBe('label');
      return 'Spare';
    });
    const r = await sendSignedCommand(deps(t, confirm), 'eng-a', 'eraseDisk d1 tr1 Spare');
    expect(r).toEqual({ kind: 'accepted', engineId: 'eng-a', seq: 9 });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls[1].body).toEqual({ command: 'eraseDisk d1 tr1 Spare', confirmId: 'cf1', confirmText: 'Spare' });
  });

  it('428: cancel sends nothing more', async () => {
    const { t, calls } = transport(() => ({ status: 428, body: { error: 'CONFIRM_REQUIRED', message: 'c', confirmId: 'cf1', summary: {}, expiresInMs: 60_000, confirmField: 'appName' } }));
    expect(await sendSignedCommand(deps(t, async () => null), 'eng-a', 'installApp kolibri d1')).toEqual({ kind: 'cancelled' });
    expect(calls).toHaveLength(1);
  });

  it('409 CONFIRM_INVALID shows the contract text', async () => {
    const { t } = transport((c) =>
      c.body.confirmId
        ? { status: 409, body: { error: 'CONFIRM_INVALID', message: 'x' } }
        : { status: 428, body: { error: 'CONFIRM_REQUIRED', message: 'c', confirmId: 'cf1', summary: {}, expiresInMs: 60_000, confirmField: 'sizeBytes' } });
    const r = await sendSignedCommand(deps(t, async () => '64000000000'), 'eng-a', 'flashCard c1 v1 64000000000');
    expect(r).toMatchObject({ kind: 'error', code: 'CONFIRM_INVALID', message: 'The confirmation expired or did not match. Start again.' });
  });

  it('409 GRANT_REQUIRED: gets a grant from each listed Engine and resends', async () => {
    const { t, calls } = transport((c) => {
      if (c.url === '/api/engines/eng-b/auth/grant') return { status: 200, body: { grant: 'v1.eng-b.eng-a.g1.mac', expiresInMs: 21_600_000 } };
      if (c.body.grants) return { status: 202, body: { engineId: 'eng-a', seq: 12 } };
      return { status: 409, body: { error: 'GRANT_REQUIRED', message: 'g', engineIds: ['eng-b'] } };
    });
    const r = await sendSignedCommand(deps(t), 'eng-a', 'copyApp kolibri d1 d2');
    expect(r).toEqual({ kind: 'accepted', engineId: 'eng-a', seq: 12 });
    expect(calls[1].body).toEqual({ toEngineId: 'eng-a' });
    expect(calls[1].headers.Authorization).toBe('Bearer tb');
    expect(calls[2].body).toEqual({ command: 'copyApp kolibri d1 d2', grants: { 'eng-b': 'v1.eng-b.eng-a.g1.mac' } });
  });

  it('GRANT_REQUIRED for an Engine without a token asks to sign in there, sending nothing more', async () => {
    clearEngineSessions();
    putEngineSession('eng-a', 'ta', { id: 'op1', username: 'k' }, 900_000);
    const { t, calls } = transport(() => ({ status: 409, body: { error: 'GRANT_REQUIRED', message: 'g', engineIds: ['eng-b'] } }));
    expect(await sendSignedCommand(deps(t), 'eng-a', 'moveApp x d1 d2')).toEqual({ kind: 'signInRequired', engineIds: ['eng-b'] });
    expect(calls).toHaveLength(1);
  });

  it('GRANT_REQUIRED for an older Engine shows the older-Engine message', async () => {
    const { t, calls } = transport(() => ({ status: 409, body: { error: 'GRANT_REQUIRED', message: 'g', engineIds: ['eng-old'] } }));
    putEngineSession('eng-old', 'to', { id: 'op1', username: 'k' }, 900_000);
    expect(await sendSignedCommand(deps(t), 'eng-a', 'copyApp x d1 d2')).toEqual({
      kind: 'blocked', engineId: 'eng-old', message: olderEngineMessage('idea01', '1.4.2'),
    });
    expect(calls).toHaveLength(1);
  });

  it('confirmation and grants in one command', async () => {
    const { t, calls } = transport((c) => {
      if (c.url.endsWith('/auth/grant')) return { status: 200, body: { grant: 'gr', expiresInMs: 1 } };
      if (!c.body.confirmId) return { status: 428, body: { error: 'CONFIRM_REQUIRED', message: 'c', confirmId: 'cf', summary: {}, expiresInMs: 60_000, confirmField: 'appName' } };
      if (!c.body.grants) return { status: 409, body: { error: 'GRANT_REQUIRED', message: 'g', engineIds: ['eng-b'] } };
      return { status: 202, body: { engineId: 'eng-a', seq: 3 } };
    });
    const r = await sendSignedCommand(deps(t, async () => 'kolibri'), 'eng-a', 'installApp kolibri d1 --source d9');
    expect(r).toEqual({ kind: 'accepted', engineId: 'eng-a', seq: 3 });
    expect(calls.at(-1)!.body).toEqual({ command: 'installApp kolibri d1 --source d9', confirmId: 'cf', confirmText: 'kolibri', grants: { 'eng-b': 'gr' } });
  });

  it('maps relay and refusal errors to the contract texts', async () => {
    const cases: Array<[unknown, string]> = [
      [{ error: 'ENGINE_UNREACHABLE', message: 'x' }, 'idea04 cannot be reached right now.'],
      [{ error: 'ENGINE_UNKNOWN', message: 'x' }, 'This Engine is not in the store.'],
      [{ error: 'GRANT_EXPIRED', message: 'x', engineId: 'eng-b' }, 'Permission from idea04 expired. Start again.'],
      [{ error: 'COMMAND_REFUSED', message: 'Refused: not on this Engine.', reason: 'r' }, 'Refused: not on this Engine.'],
    ];
    for (const [body, text] of cases) {
      const { t } = transport(() => ({ status: 409, body }));
      const r = await sendSignedCommand(deps(t), 'eng-b', 'reboot');
      expect(r).toMatchObject({ kind: 'error', message: text });
    }
  });

  it('a network failure is an error, not a throw', async () => {
    const t: EngineApiTransport = { origin: '', selfEngineId: 'eng-a', fetch: () => Promise.reject(new TypeError('Failed to fetch')) };
    expect(await sendSignedCommand(deps(t), 'eng-b', 'reboot')).toMatchObject({ kind: 'error', code: 'NETWORK_ERROR', message: 'idea04 cannot be reached right now.' });
  });

  it('stops after a bounded number of rounds', async () => {
    const { t, calls } = transport(() => ({ status: 428, body: { error: 'CONFIRM_REQUIRED', message: 'again', confirmId: 'cf', summary: {}, expiresInMs: 1, confirmField: 'label' } }));
    const r = await sendSignedCommand(deps(t, async () => 'x'), 'eng-a', 'eraseDisk d1 t1 x');
    expect(r.kind).toBe('error');
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});
