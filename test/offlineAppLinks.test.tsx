// @vitest-environment-options {"url":"http://10.42.0.127/"}
/** Follow-up to PR #162: App links to an offline Engine are greyed out and not clickable. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import MobileAppList from '../src/components/MobileAppList';
import AppBrowser from '../src/components/AppBrowser';
import InstanceRow from '../src/components/InstanceRow';
import { isAppEngineOffline, offlineAppHint } from '../src/store/appUrl';
import { emptyLive, receiveEphemeral, resetLive } from '../src/store/live';
import { KIT, KIT_APP, kitStore } from './fixtures/kitStore';
import type { Store } from '../src/types/store';

vi.mock('../src/store/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/store/engine')>();
  return { ...mod, isProductionWebMode: () => true };
});

/** Kit store with happy-zebra offline (old lastRun, no live beat). */
const storeWithOfflineHZ = (): Store => {
  const s = kitStore();
  s.engineDB[KIT.HZ] = { ...s.engineDB[KIT.HZ], lastRun: 0 };
  return s;
};
const HZ = KIT_APP[KIT.HZ].inst;
const KP = KIT_APP[KIT.KP].inst;
const HINT = "happy-zebra is offline, so this app can't be opened right now.";

afterEach(() => { cleanup(); resetLive(); });

describe('offline rule (same as the Engine badge)', () => {
  const e = { id: 'e1', lastRun: 0 };
  it('live hb within 30 s → online; older → offline', () => {
    const live = { ...emptyLive(), beats: { e1: { receivedAt: 1_000, engineNow: null, bootedAt: null } } };
    expect(isAppEngineOffline(e, live, 1_000 + 30_000)).toBe(false);
    expect(isAppEngineOffline(e, live, 1_000 + 30_001)).toBe(true);
  });
  it('old Engines: stored lastRun within 90 s', () => {
    expect(isAppEngineOffline({ id: 'e1', lastRun: 100_000 }, emptyLive(), 150_000)).toBe(false);
    expect(isAppEngineOffline({ id: 'e1', lastRun: 0 }, emptyLive(), 150_000)).toBe(true);
  });
  it('no Engine known is not "offline" (the existing no-address rule applies)', () => {
    expect(isAppEngineOffline(undefined, emptyLive(), 0)).toBe(false);
  });
  it('plain hint names the Engine', () => {
    expect(offlineAppHint('happy-zebra.local')).toBe(HINT);
    expect(offlineAppHint(undefined)).toBe("This Engine is offline, so this app can't be opened right now.");
  });
});

describe('greyed-out Open controls', () => {
  it('AppBrowser card: offline Engine → disabled Open + hint; online Engine unchanged', () => {
    const s = storeWithOfflineHZ();
    const r = render(() => <AppBrowser store={() => s} connected={() => true} loadHidden={async () => []} />);
    const hz = r.getByTestId(`open-instance-${HZ}`) as HTMLButtonElement;
    expect(hz.disabled).toBe(true);
    expect(hz.title).toBe(HINT);
    expect(r.getByTestId(`app-offline-hint-${HZ}`).textContent).toBe(HINT);
    expect(r.getByTestId(`instance-${HZ}`).classList.contains('app-card--offline')).toBe(true);
    expect((r.getByTestId(`open-instance-${KP}`) as HTMLButtonElement).disabled).toBe(false);
    expect(r.queryByTestId(`app-offline-hint-${KP}`)).toBeNull();
  });
  it('MobileAppList: offline Engine → a disabled button, no link, plus hint', () => {
    const s = storeWithOfflineHZ();
    const r = render(() => <MobileAppList store={() => s} loadHidden={async () => []} />);
    const hz = r.getByTestId(`mobile-open-instance-${HZ}`);
    expect(hz.tagName).toBe('BUTTON');
    expect(hz.hasAttribute('href')).toBe(false);
    expect(r.getByTestId(`mobile-app-offline-hint-${HZ}`).textContent).toBe(HINT);
    expect(r.getByTestId(`mobile-open-instance-${KP}`).tagName).toBe('A');
  });
  it('InstanceRow: offline Engine → disabled Open + hint; a live hb turns it back into a link', () => {
    const s = storeWithOfflineHZ();
    const inst = s.instanceDB[HZ];
    const r = render(() => (
      <InstanceRow instance={() => inst} app={() => s.appDB[inst.instanceOf]} engine={() => s.engineDB[KIT.HZ]} store={() => s} />
    ));
    expect(r.getByTestId(`open-instance-${HZ}`).tagName).toBe('BUTTON');
    expect(r.getByTestId(`app-offline-hint-${HZ}`).textContent).toBe(HINT);
    receiveEphemeral({ type: 'idea/hb', v: 1, engineId: KIT.HZ, now: Date.now(), bootedAt: 0 });
    expect(r.getByTestId(`open-instance-${HZ}`).tagName).toBe('A');
    expect(r.queryByTestId(`app-offline-hint-${HZ}`)).toBeNull();
  });
});
