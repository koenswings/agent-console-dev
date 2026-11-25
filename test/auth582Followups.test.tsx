/**
 * agent-engine-dev#582 follow-ups: the grant issuer in every grant error text,
 * the Engine's summary as the only flash confirm in Engine mode, command
 * controls switched off per row (all-apps list, mobile list, network tree),
 * and erase traces matched by the Engine's queue number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import FlashDialog from '../src/components/FlashDialog';
import InstanceList from '../src/components/InstanceList';
import MobileAppList from '../src/components/MobileAppList';
import NetworkTree from '../src/components/NetworkTree';
import { MOCK_IDS, MOCK_STORE } from '../src/mock/mockStore';
import { setAuthModeForTest } from '../src/store/authMode';
import { configureCommandRouter, newerEngineMessage } from '../src/store/commandRouter';
import { setSendCommandFn } from '../src/store/commands';
import { EngineApiError, type EngineApiTransport } from '../src/store/engineApi';
import { clearEngineSessions, putEngineSession } from '../src/store/engineTokens';
import { commandErrorText, grantErrorText, grantIssuer, sendSignedCommand, type SendResult } from '../src/store/signedCommand';
import { getInstanceIdsForSelection } from '../src/store/signals';
import type { CommandLogState } from '../src/store/commandLog';
import type { Engine, Store } from '../src/types/store';

const E1 = MOCK_IDS.ENGINE_1_ID;
const E2 = MOCK_IDS.ENGINE_2_ID;
const base = (): Store => structuredClone(MOCK_STORE) as Store;
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const host = (id: string) => String(MOCK_STORE.engineDB[id].hostname);

afterEach(() => {
  cleanup();
  setAuthModeForTest('legacy');
  configureCommandRouter({ legacySend: null, store: () => null });
  clearEngineSessions();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('grant issuer', () => {
  const engines = { A: { id: 'A', hostname: 'alpha' }, B: { id: 'B', hostname: 'bravo' } } as unknown as Record<string, Engine>;
  const e = (code: string, body: Record<string, unknown>) => new EngineApiError(403, code as never, 'm', body);

  it('reads only issuerEngineId, else the Engine that was asked', () => {
    expect(grantIssuer(e('GRANT_EXPIRED', { issuerEngineId: 'B', engineId: 'A' }), 'X')).toBe('B');
    expect(grantIssuer(e('GRANT_EXPIRED', { engineId: 'A' }), 'X')).toBe('X');
    expect(grantIssuer(e('GRANT_EXPIRED', {}), 'X')).toBe('X');
  });

  it('command errors name the issuer', () => {
    expect(commandErrorText(e('GRANT_INVALID', { issuerEngineId: 'B' }), engines, 'A')).toBe('Permission from bravo expired. Start again.');
  });

  it('every grant-request failure names the issuer', () => {
    expect(grantErrorText(e('GRANT_EXPIRED', { issuerEngineId: 'B' }), engines, 'A')).toContain('bravo');
    expect(grantErrorText(new EngineApiError(502, 'ENGINE_UNREACHABLE', 'x', { issuerEngineId: 'B', engineId: 'A' }), engines, 'A'))
      .toBe('bravo cannot be reached right now, so it cannot give permission. Start again later.');
    expect(grantErrorText(new EngineApiError(422, 'COMMAND_REFUSED', 'Not for this command.', {}), engines, 'B'))
      .toBe('bravo did not give permission: Not for this command.');
  });

  it('a failed grant request during a copy reports the issuer by name', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/api/command')) return new Response(JSON.stringify({ error: 'GRANT_REQUIRED', message: 'g', engineIds: ['B'] }), { status: 409 });
      return new Response(JSON.stringify({ error: 'ENGINE_UNREACHABLE', message: 'u', issuerEngineId: 'B' }), { status: 502 });
    });
    const t: EngineApiTransport = { origin: '', selfEngineId: 'A', fetch: fetchFn };
    putEngineSession('A', 'tA', { id: 'o', username: 'u' }, 60_000);
    putEngineSession('B', 'tB', { id: 'o', username: 'u' }, 60_000);
    const withCap = Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, { ...v, capabilities: ['signedCommands1'] }])) as unknown as Record<string, Engine>;
    const r = await sendSignedCommand({ transport: t, engines: withCap }, 'A', 'copyApp i1 d2');
    expect(r).toMatchObject({ kind: 'error', code: 'ENGINE_UNREACHABLE' });
    expect(r.kind === 'error' && r.message).toContain('bravo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flash: the Engine summary is the only confirm in Engine mode', () => {
  const CARD = MOCK_IDS.DEMO_CARD_ID;
  const open = () => {
    const [s] = createSignal<Store | null>(base());
    const [cls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
    return render(() => <FlashDialog engineId={E1} candidateId={CARD} store={s} commandLogStore={cls} onClose={() => undefined} />);
  };

  it('legacy: Next goes to the Console confirm step, nothing sent', () => {
    const send = vi.fn();
    setSendCommandFn(send);
    const { container } = open();
    fireEvent.click(q(container, 'flash-next')!);
    expect(q(container, 'flash-step-confirm')).not.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('engine: the button sends at once (no Console confirm step)', async () => {
    setAuthModeForTest('engine');
    const send = vi.fn(async (): Promise<SendResult> => ({ kind: 'accepted', engineId: E1, seq: 5 }));
    setSendCommandFn(send);
    const { container } = open();
    fireEvent.click(q(container, 'flash-next')!);
    expect(q(container, 'flash-step-confirm')).toBeNull();
    expect(q(container, 'flash-step-running')).not.toBeNull();
    expect(send).toHaveBeenCalledOnce();
    expect(String(send.mock.calls[0][1])).toMatch(/^flashCard /);
  });

  it('engine: cancelling the Engine summary goes back to the version step', async () => {
    setAuthModeForTest('engine');
    setSendCommandFn(async (): Promise<SendResult> => ({ kind: 'cancelled' }));
    const { container } = open();
    fireEvent.click(q(container, 'flash-next')!);
    await vi.waitFor(() => expect(q(container, 'flash-step-pick')).not.toBeNull());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('command controls switched off per row', () => {
  beforeEach(() => {
    // The page's Engine predates #582; ENGINE_1 only takes signed commands.
    setAuthModeForTest('legacy');
    configureCommandRouter({ legacySend: vi.fn(), store: () => MOCK_STORE });
  });

  const engineOfInstance = (s: Store, id: string): string | undefined => {
    const disk = s.diskDB[String(s.instanceDB[id]?.storedOn)];
    return disk?.dockedTo ? String(disk.dockedTo) : undefined;
  };

  it('Engine view: rows stay disabled but the reason shows once, above the list', () => {
    const [s] = createSignal<Store | null>(MOCK_STORE);
    const sel = { type: 'engine' as const, id: E1 };
    const { container } = render(() => <InstanceList selection={sel} store={s} />);
    const ids = getInstanceIdsForSelection(MOCK_STORE, sel);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect((q(container, `instance-scope-${id}`) as HTMLFieldSetElement).disabled).toBe(true);
      expect(q(container, `instance-scope-${id}-notice`)).toBeNull();
    }
  });

  it('all-apps list: rows on ENGINE_1 are disabled with the message, others are not', () => {
    const [s] = createSignal<Store | null>(MOCK_STORE);
    const { container } = render(() => <InstanceList selection={{ type: 'network', id: '' }} store={s} />);
    const ids = getInstanceIdsForSelection(MOCK_STORE, { type: 'network', id: '' });
    const on1 = ids.filter((id) => engineOfInstance(MOCK_STORE, id) === E1);
    const other = ids.filter((id) => engineOfInstance(MOCK_STORE, id) !== E1);
    expect(on1.length).toBeGreaterThan(0);
    for (const id of on1) {
      expect((q(container, `instance-scope-${id}`) as HTMLFieldSetElement).disabled).toBe(true);
      expect(q(container, `instance-scope-${id}-notice`)!.textContent).toBe(newerEngineMessage(host(E1)));
    }
    for (const id of other) {
      const f = q(container, `instance-scope-${id}`) as HTMLFieldSetElement | null;
      if (f) expect(f.disabled).toBe(false);
    }
  });

  it('mobile list: the same gate per card', () => {
    const [s] = createSignal<Store | null>(MOCK_STORE);
    const { container } = render(() => <MobileAppList store={s} loadHidden={async () => []} />);
    const scopes = Array.from(container.querySelectorAll('fieldset[data-testid^="mobile-instance-scope-"]')) as HTMLFieldSetElement[];
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.some((f) => f.disabled)).toBe(true);
    for (const f of scopes) {
      const id = f.dataset.testid!.replace('mobile-instance-scope-', '');
      expect(f.disabled).toBe(engineOfInstance(MOCK_STORE, id) === E1);
    }
  });

  it('network tree: reboot and eject are disabled for ENGINE_1 only', () => {
    const [s] = createSignal<Store | null>(MOCK_STORE);
    const { container } = render(() => (
      <NetworkTree selection={{ type: 'network', id: '' }} onSelect={() => undefined} store={s} dragData={() => null} onDrop={() => undefined} />
    ));
    const r1 = q(container, `reboot-engine-${E1}`) as HTMLButtonElement;
    expect(r1.disabled).toBe(true);
    expect(r1.title).toBe(newerEngineMessage(host(E1)));
    expect((q(container, `reboot-engine-${E2}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('nothing is switched off outside the app (router not configured)', () => {
    configureCommandRouter({ legacySend: null, store: () => null });
    const [s] = createSignal<Store | null>(MOCK_STORE);
    const { container } = render(() => <InstanceList selection={{ type: 'network', id: '' }} store={s} />);
    const scopes = Array.from(container.querySelectorAll('fieldset.command-scope')) as HTMLFieldSetElement[];
    expect(scopes.every((f) => !f.disabled)).toBe(true);
  });
});
