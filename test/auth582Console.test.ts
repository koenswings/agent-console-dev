/**
 * agent-engine-dev#582 Console wiring: the auth mode probe (fallback for older
 * Engines), the command router, the Engine's confirmation step, sign-in and
 * operator management through the auth facade, and relay discovery — run
 * against the in-page preview Engine API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { createMockApiTransport, MOCK_SETUP_CODE } from '../src/mock/mockEngineApi';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import {
  authMode,
  beginAuthProbe,
  isEngineAuth,
  pageAuthEngineId,
  probeAuthMode,
  setAuthModeForTest,
} from '../src/store/authMode';
import {
  clearCommandNotices,
  commandGate,
  commandNotices,
  configureCommandRouter,
  dispatchCommand,
  newerEngineMessage,
} from '../src/store/commandRouter';
import {
  answerEngineConfirm,
  confirmMode,
  expectedConfirmValue,
  formatBytes,
  pendingEngineConfirm,
  summaryRows,
} from '../src/store/engineConfirm';
import {
  addOperatorEverywhere,
  currentUser,
  engineIssues,
  isFirstTimeSetup,
  listPageOperators,
  logout,
  removeOperatorEverywhere,
  resetEngineIssues,
  setupWithCode,
  signIn,
} from '../src/store/auth';
import { clearEngineSessions, tokenFor } from '../src/store/engineTokens';
import { relayDiscovery, relayReachable } from '../src/store/relayDiscovery';
import { sendResultMessage } from '../src/store/sendResultText';
import type { EngineApiTransport } from '../src/store/engineApi';
import type { Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const admin = MOCK_STORE.userDB['user-demo-admin'];
const ADMIN_PW = 'admin911!';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function previewEngine(opts: { operators?: boolean } = {}) {
  const [store] = createSignal<Store | null>(MOCK_STORE);
  const sent: Array<{ engineId: string; command: string }> = [];
  const t = createMockApiTransport({
    selfEngineId: E1,
    store,
    send: (engineId, command) => { sent.push({ engineId, command }); },
    operators: opts.operators === false ? [] : [{ id: admin.id, username: admin.username, passwordHash: admin.passwordHash, created: 0 }],
  });
  return { t, sent, store };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Answer the next Engine confirmation once it opens. */
async function answerWhenOpen(value: (expected: string | null) => string | null): Promise<void> {
  for (let i = 0; i < 200 && !pendingEngineConfirm(); i++) await flush();
  const p = pendingEngineConfirm();
  if (!p) throw new Error('no confirmation opened');
  answerEngineConfirm(value(expectedConfirmValue(p.req)));
}

beforeEach(() => {
  clearEngineSessions();
  clearCommandNotices();
  resetEngineIssues();
});

afterEach(async () => {
  answerEngineConfirm(null);
  setAuthModeForTest('legacy');
  configureCommandRouter({ legacySend: null, store: () => null });
  clearEngineSessions();
  await logout();
});

describe('auth mode probe (mixed fleets)', () => {
  const transportAnswering = (fn: () => Promise<Response>): EngineApiTransport => ({ origin: '', selfEngineId: null, fetch: vi.fn(fn) });

  it('200 on /api/auth/info → engine mode with the reported Engine id', async () => {
    beginAuthProbe(previewEngine().t);
    expect(authMode()).toBe('probing');
    expect(await probeAuthMode()).toBe('engine');
    expect(isEngineAuth()).toBe(true);
    expect(pageAuthEngineId()).toBe(E1);
  });

  it('404 (an Engine from before #582) → legacy mode', async () => {
    beginAuthProbe(transportAnswering(async () => json(404, { error: 'NOT_SUPPORTED', message: 'x' })));
    expect(await probeAuthMode()).toBe('legacy');
  });

  it('a plain 404 without a body also counts as an older Engine', async () => {
    beginAuthProbe(transportAnswering(async () => new Response('Not found', { status: 404 })));
    expect(await probeAuthMode()).toBe('legacy');
  });

  it('no answer → stays probing (the caller retries)', async () => {
    beginAuthProbe(transportAnswering(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await probeAuthMode()).toBe('probing');
  });

  it('no transport → legacy', async () => {
    beginAuthProbe(null);
    expect(authMode()).toBe('legacy');
  });
});

describe('command router', () => {
  it('legacy: writes into the store as before, accepted without seq', async () => {
    const legacySend = vi.fn();
    configureCommandRouter({ legacySend, store: () => MOCK_STORE });
    setAuthModeForTest('legacy');
    const r = await dispatchCommand(E2, 'reboot');
    expect(r).toEqual({ kind: 'accepted', engineId: E2, seq: null });
    expect(legacySend).toHaveBeenCalledWith(E2, 'reboot');
  });

  it('legacy: an Engine that only takes signed commands is blocked with the message', async () => {
    const legacySend = vi.fn();
    configureCommandRouter({ legacySend, store: () => MOCK_STORE });
    setAuthModeForTest('legacy');
    const name = String(MOCK_STORE.engineDB[E1].hostname);
    expect(commandGate(MOCK_STORE.engineDB[E1])).toEqual({ ok: false, message: newerEngineMessage(name) });
    const r = await dispatchCommand(E1, 'reboot');
    expect(r.kind).toBe('blocked');
    expect(legacySend).not.toHaveBeenCalled();
    expect(commandNotices().map((n) => n.message)).toEqual([newerEngineMessage(name)]);
  });

  it('probing: nothing is sent', async () => {
    const legacySend = vi.fn();
    configureCommandRouter({ legacySend, store: () => MOCK_STORE });
    setAuthModeForTest('probing');
    expect((await dispatchCommand(E2, 'reboot')).kind).toBe('blocked');
    expect(legacySend).not.toHaveBeenCalled();
  });

  it('notices are de-duplicated and capped at three', async () => {
    configureCommandRouter({ legacySend: vi.fn(), store: () => MOCK_STORE });
    setAuthModeForTest('legacy');
    await dispatchCommand(E1, 'a');
    await dispatchCommand(E1, 'b');
    expect(commandNotices()).toHaveLength(1);
  });

  it('engine mode without a sign-in: signInRequired, reported to the app', async () => {
    const { t } = previewEngine();
    const onSignInRequired = vi.fn();
    configureCommandRouter({ legacySend: null, store: () => MOCK_STORE, onSignInRequired });
    beginAuthProbe(t);
    await probeAuthMode();
    const r = await dispatchCommand(E1, 'reboot');
    expect(r.kind).toBe('signInRequired');
    expect(onSignInRequired).toHaveBeenCalledWith([E1]);
  });
});

describe('preview Engine end to end', () => {
  async function signedIn() {
    const eng = previewEngine();
    configureCommandRouter({ legacySend: null, store: () => MOCK_STORE });
    beginAuthProbe(eng.t);
    await probeAuthMode();
    const out = await signIn(admin.username, ADMIN_PW, MOCK_STORE);
    return { ...eng, out };
  }

  it('signs in as admin / admin911! and gets a token for the page Engine', async () => {
    const { out } = await signedIn();
    expect(out.ok).toBe(true);
    expect(tokenFor(E1)).toBeTruthy();
    expect(currentUser()?.username).toBe(admin.username);
    // ENGINE_2 is an older Engine: not signed in to, no issue listed.
    expect(tokenFor(E2)).toBeNull();
    expect(engineIssues()).toEqual([]);
  });

  it('a wrong password is refused with the plain message and no session', async () => {
    const eng = previewEngine();
    beginAuthProbe(eng.t);
    await probeAuthMode();
    const out = await signIn(admin.username, 'nope', MOCK_STORE);
    expect(out).toMatchObject({ ok: false, message: 'Wrong username or password.' });
    expect(tokenFor(E1)).toBeNull();
  });

  it('a plain command is accepted with the Engine queue number', async () => {
    const { sent } = await signedIn();
    const r = await dispatchCommand(E1, 'reboot');
    expect(r).toMatchObject({ kind: 'accepted', engineId: E1 });
    expect(r.kind === 'accepted' && typeof r.seq === 'number').toBe(true);
    expect(sent).toEqual([{ engineId: E1, command: 'reboot' }]);
  });

  it('erase: the Engine summary opens, typing the label sends the same command once', async () => {
    const { sent } = await signedIn();
    const disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_1_ID];
    const cmd = `eraseDisk ${disk.id} sum-1 ${disk.name}`;
    const p = dispatchCommand(E1, cmd);
    await answerWhenOpen((expected) => expected);
    const r = await p;
    expect(r.kind).toBe('accepted');
    expect(sent).toEqual([{ engineId: E1, command: cmd }]);
  });

  it('erase: cancelling the Engine summary sends nothing', async () => {
    const { sent } = await signedIn();
    const disk = MOCK_STORE.diskDB[MOCK_IDS.DISK_1_ID];
    const p = dispatchCommand(E1, `eraseDisk ${disk.id} sum-1 ${disk.name}`);
    await answerWhenOpen(() => null);
    expect((await p).kind).toBe('cancelled');
    expect(sent).toEqual([]);
    expect(commandNotices()).toEqual([]);
  });

  it('flash: acknowledged with the card size from the summary', async () => {
    const { sent } = await signedIn();
    const cmd = 'flashCard CAND_X 1.2.3 31914983424';
    const p = dispatchCommand(E1, cmd);
    for (let i = 0; i < 200 && !pendingEngineConfirm(); i++) await flush();
    const req = pendingEngineConfirm()!.req;
    expect(confirmMode(req.confirmField)).toBe('acknowledge');
    answerEngineConfirm(String((req.summary as { sizeBytes: number }).sizeBytes));
    expect((await p).kind).toBe('accepted');
    expect(sent).toHaveLength(1);
  });

  it('a command to an older Engine is blocked, not sent', async () => {
    const { sent } = await signedIn();
    const r = await dispatchCommand(E2, 'reboot');
    expect(r.kind).toBe('blocked');
    expect(sent).toEqual([]);
  });

  it('operators: add, duplicate, list, and the last one cannot be removed', async () => {
    await signedIn();
    expect((await addOperatorEverywhere('mary', 'pass-1234', MOCK_STORE)).ok).toBe(true);
    const dup = await addOperatorEverywhere('mary', 'pass-1234', MOCK_STORE);
    expect(dup.ok).toBe(false);
    expect((await listPageOperators()).map((o) => o.username).sort()).toEqual([admin.username, 'mary']);
    expect((await removeOperatorEverywhere('mary', MOCK_STORE)).ok).toBe(true);
    const last = await removeOperatorEverywhere(admin.username, MOCK_STORE);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.message).toMatch(/needs at least one operator/);
  });

  it('first setup on a new Engine with its setup code', async () => {
    const eng = previewEngine({ operators: false });
    beginAuthProbe(eng.t);
    await probeAuthMode();
    expect(isFirstTimeSetup(MOCK_STORE)).toBe(true);
    const bad = await setupWithCode(E1, 'WRONG', 'first', 'pass-1234', MOCK_STORE);
    expect(bad.ok).toBe(false);
    const good = await setupWithCode(E1, MOCK_SETUP_CODE, 'first', 'pass-1234', MOCK_STORE);
    expect(good.ok).toBe(true);
    expect(tokenFor(E1)).toBeTruthy();
  });

  it('relay discovery keeps both Engines (an older one still answers through the relay)', async () => {
    const { t } = previewEngine();
    expect(await relayReachable(t, E2)).toBe(true);
    expect(await relayReachable(t, 'NOPE')).toBe(false);
    const found = await relayDiscovery(t, MOCK_STORE, 'ws://x/store');
    expect(found.map((f) => f.engineId).sort()).toEqual([E1, E2].sort());
  });
});

describe('Engine confirmation helpers', () => {
  it('summary rows hide ids and label the rest', () => {
    const rows = summaryRows({ command: 'eraseDisk', targetId: 'D1', label: 'Stick', sizeBytes: 2_000_000_000, device: '/dev/sda', apps: ['kolibri 1.0'] });
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('command');
    expect(labels).not.toContain('targetId');
    expect(labels).toEqual(expect.arrayContaining(['Disk', 'Size', 'Apps on it']));
  });

  it('confirm modes and sizes', () => {
    expect(confirmMode('label')).toBe('type');
    expect(confirmMode('sizeBytes')).toBe('acknowledge');
    expect(formatBytes(0)).toMatch(/0/);
  });

  it('send result text', () => {
    expect(sendResultMessage({ kind: 'blocked', engineId: 'x', message: 'Nope.' })).toBe('Nope.');
  });
});
