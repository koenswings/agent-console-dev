/**
 * idea#201 §10.2 — Client cards section, Flash dialog (pick → confirm → progress
 * → done), Initialise for new disks, error paths, capability gates, adapter
 * commands and the demo store. Engine API: Axle's contract v2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import ClientCardsSection from '../src/components/ClientCardsSection';
import FlashDialog, { SAFE_TO_REMOVE_TEXT, EJECT_FIRST_TEXT, CARD_GONE_TEXT, UNLABELLED_UBUNTU_TEXT } from '../src/components/FlashDialog';
import { setSendCommandFn } from '../src/store/commands';
import { MOCK_STORE, MOCK_IDS } from '../src/mock/mockStore';
import { resolveDemoMode } from '../src/store/demoMode';
import {
  ERROR_TEXT,
  buildCancelFlashCommand,
  buildFlashCardCommand,
  buildInitialiseDiskCommand,
  contentsLabel,
  errorText,
  flashableImages,
  initialisableDisks,
  parseEngineError,
  flashStepNumber,
} from '../src/store/clientCards';
import type { CommandLogState } from '../src/store/commandLog';
import type { CommandLogStore, CommandTrace } from '../src/types/commandLog';
import type { Engine, Operation, Store } from '../src/types/store';

const E = MOCK_IDS.ENGINE_1_ID;
const CARD = MOCK_IDS.DEMO_CARD_ID;
const DISK = MOCK_IDS.DEMO_UNKNOWN_DISK_ID;
const READER = MOCK_IDS.DEMO_READER_ID;
const CUR = '26.04-20261015-ab12cd3';
const PREV = '26.04-20261001-9f8e7d6';
const SIZE = 31_914_983_424;

const base = (): Store => structuredClone(MOCK_STORE) as Store;
const withEngine = (s: Store, over: Partial<Engine>): Store => {
  s.engineDB[E] = { ...s.engineDB[E], ...over } as Engine;
  return s;
};
const log = (...t: CommandTrace[]): CommandLogStore => ({
  traces: Object.fromEntries(t.map((x) => [x.traceId, x])),
  recentTraceIds: t.map((x) => x.traceId),
});
const trace = (over: Partial<CommandTrace>): CommandTrace => ({
  traceId: 't1', command: 'flashCard', args: { candidateId: CARD, version: CUR, confirmSizeBytes: String(SIZE) },
  startedAt: Date.now(), completedAt: null, status: 'running', errorMessage: null, logs: [], ...over,
});
const flashOp = (over: Partial<Operation>): Operation => ({
  id: 'op-1', kind: 'flashCard', args: {}, cause: 'console-command', subject: { type: 'disk', id: CARD },
  engineId: E, status: 'Running', progressPercent: null, currentStep: 0, totalSteps: 6, stepLabel: 'checking',
  startedAt: Date.now(), completedAt: null, error: null, ...over,
} as Operation);

let sent: ReturnType<typeof vi.fn>;
beforeEach(() => { sent = vi.fn(); setSendCommandFn(sent); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const harness = (store: Store = base()) => {
  const [s, setS] = createSignal<Store | null>(store);
  const [cls, setCls] = createSignal<CommandLogState>({ traces: {}, recentTraceIds: [] });
  return { s, setS, cls, setCls };
};
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

// ─────────────────────────────────────────────────────────────────────────────
describe('Client cards section', () => {
  it('lists the reader, card size and current contents', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    const card = q(container, `client-card-${CARD}`)!;
    expect(card).not.toBeNull();
    expect(q(card, 'client-card-reader')!.textContent).toBe('Generic STORAGE DEVICE (port 1-1.2)');
    expect(q(card, 'client-card-size')!.textContent).toBe('31.9 GB');
    expect(q(card, 'client-card-contents')!.textContent).toBe('Raspberry Pi OS');
    expect(q(container, 'client-images-line')!.textContent).toContain(CUR);
    expect(q(container, 'client-images-line')!.textContent).toContain(PREV);
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a reader without a card says "no card"', () => {
    const s = withEngine(base(), {
      cardReaders: [{ id: READER, name: 'Generic STORAGE DEVICE', usbPath: '1-1.2', hasMedium: false, candidateId: null }],
      clientCards: [],
      newDisks: [],
    });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, 'card-reader-empty')!.textContent).toContain('no card');
  });

  it('a card outside any reader (external SSD) is listed by model', () => {
    const s = base();
    s.engineDB[E].cardReaders = [];
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(q(container, `client-card-${CARD}`)!, 'client-card-reader')!.textContent).toBe('STORAGE DEVICE');
  });

  it.each([
    [{ kind: 'idea-client', imageName: 'idea-client', version: '26.04-20261001-x' }, 'IDEA client image 26.04-20261001-x'],
    [{ kind: 'ubuntu' }, 'Ubuntu'],
    [{ kind: 'empty' }, 'empty'],
    [{ kind: 'other', summary: "1 × exfat 'SANDISK'" }, "1 × exfat 'SANDISK'"],
    [{ kind: 'unknown' }, 'unknown (could not be read)'],
  ] as const)('contents %j reads "%s"', (c, text) => {
    expect(contentsLabel(c as never)).toBe(text);
  });

  it('without the clientCards capability: a hint, no cards, no new disks', () => {
    const s = withEngine(base(), { capabilities: ['diskIdArgs'] });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, 'client-cards-unsupported')).not.toBeNull();
    expect(q(container, `client-card-${CARD}`)).toBeNull();
    expect(q(container, `new-disk-${DISK}`)).toBeNull();
  });

  it('without flashCard: Flash disabled with the hint', () => {
    const s = withEngine(base(), { capabilities: ['diskIdArgs', 'clientCards', 'clientImages', 'unknownDiskReadOnly'] });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(true);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toMatch(/cannot flash cards yet/);
  });

  it('stale capabilities (Engine rolled back) disable Flash too', () => {
    const s = withEngine(base(), { capabilitiesBootedAt: 1 });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, 'client-cards-unsupported')).not.toBeNull();
  });

  it('a card the Engine refuses shows the refusal in plain text and Flash disabled', () => {
    const s = base();
    s.engineDB[E].clientCards![0] = { ...s.engineDB[E].clientCards![0], flashable: false, refusal: 'MOUNTED' };
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(true);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toBe(ERROR_TEXT.MOUNTED);
  });

  it.each(['MOUNTED', 'BUSY', 'HELPER_MISSING'] as const)('#219 refusal %s: plain text hint, Flash disabled, no code shown', (code) => {
    const s = base();
    s.engineDB[E].clientCards![0] = { ...s.engineDB[E].clientCards![0], flashable: false, refusal: code };
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(true);
    const hint = q(container, `client-card-hint-${CARD}`)!.textContent!;
    expect(hint).toBe(ERROR_TEXT[code]);
    expect(hint).not.toContain(code);
  });

  it('#219: a ubuntu card row reads "Ubuntu" with Flash enabled (no foreign/broken wording)', () => {
    const s = base();
    s.engineDB[E].clientCards![0] = { ...s.engineDB[E].clientCards![0], contents: { kind: 'ubuntu' } };
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    const card = q(container, `client-card-${CARD}`)!;
    expect(q(card, 'client-card-contents')!.textContent).toBe('Ubuntu');
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(false);
    expect(card.textContent).not.toMatch(/foreign|broken|unknown|damaged/i);
  });

  it('no verified image: Flash disabled (arriving / bad-sha images are never offered)', () => {
    const s = base();
    s.engineDB[E].clientImages = {
      current: null, previous: null,
      images: [{ ...s.engineDB[E].clientImages!.images[0], state: 'arriving' }, { ...s.engineDB[E].clientImages!.images[1], state: 'bad-sha' }],
    };
    expect(flashableImages(s.engineDB[E])).toEqual([]);
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toMatch(/no verified client image/);
  });

  it('another flash running on this Engine: Flash disabled with BUSY text', () => {
    const s = base();
    s.engineDB[E].clientCards!.push({ ...s.engineDB[E].clientCards![0], candidateId: 'ffffffffffffffff', readerId: null });
    s.engineDB[E].flashInProgress = { operationId: 'op-x', candidateId: 'ffffffffffffffff', version: CUR, step: 'writing' };
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toBe(ERROR_TEXT.BUSY);
  });

  it('BUSY hint is not cached: it clears as soon as the Engine drops the refusal and flashInProgress (agent-engine-dev#219 2240d42)', () => {
    const s = base();
    s.engineDB[E].clientCards![0] = { ...s.engineDB[E].clientCards![0], flashable: false, refusal: 'BUSY' };
    s.engineDB[E].flashInProgress = { operationId: 'op-x', candidateId: 'ffffffffffffffff', version: CUR, step: 'writing' }; // another card: the target is never BUSY
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toBe(ERROR_TEXT.BUSY);
    const after = base();
    after.engineDB[E].flashInProgress = null as never;
    h.setS(after);
    expect(q(container, `client-card-hint-${CARD}`)).toBeNull();
    expect((q(container, `client-card-flash-${CARD}`) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Flash dialog', () => {
  const open = (store: Store = base()) => {
    const h = harness(store);
    const onClose = vi.fn();
    const r = render(() => <FlashDialog engineId={E} candidateId={CARD} store={h.s} commandLogStore={h.cls} onClose={onClose} />);
    return { ...r, h, onClose };
  };
  const toConfirm = (c: HTMLElement) => fireEvent.click(q(c, 'flash-next')!);
  const confirm = (c: HTMLElement) => fireEvent.click(q(c, 'flash-confirm')!);

  it('step 1: versions offered (verified only), current preselected', () => {
    const { container } = open();
    expect(q(container, 'flash-step-pick')).not.toBeNull();
    const cur = q(container, `flash-version-${CUR}`)!;
    expect(cur.textContent).toContain('(current)');
    expect((cur.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(q(container, `flash-version-${PREV}`)!.textContent).toContain('(previous)');
  });

  it('step 2: confirm repeats target name, size and contents, with a wipe warning; nothing sent yet', () => {
    const { container } = open();
    toConfirm(container);
    expect(q(container, 'flash-confirm-target')!.textContent).toBe('Generic STORAGE DEVICE (port 1-1.2)');
    expect(q(container, 'flash-confirm-size')!.textContent).toBe('31.9 GB');
    expect(q(container, 'flash-confirm-contents')!.textContent).toBe('Raspberry Pi OS');
    expect(q(container, 'flash-confirm-version')!.textContent).toBe(CUR);
    const w = q(container, 'flash-wipe-warning')!;
    expect(w.getAttribute('role')).toBe('alert');
    expect(w.textContent).toContain('Everything on this card will be wiped');
    expect(w.textContent).toContain('Raspberry Pi OS');
    expect(w.textContent).toContain('31.9 GB');
    expect(w.textContent).toContain('cannot be undone');
    expect(sent).not.toHaveBeenCalled();
  });

  it('Back returns to the version step; choosing previous flashes previous', () => {
    const { container } = open();
    fireEvent.click(q(container, `flash-version-${PREV}`)!.querySelector('input')!);
    toConfirm(container);
    expect(q(container, 'flash-confirm-version')!.textContent).toBe(PREV);
    fireEvent.click(q(container, 'flash-back')!);
    expect(q(container, 'flash-step-pick')).not.toBeNull();
    toConfirm(container);
    confirm(container);
    expect(sent).toHaveBeenCalledWith(E, `flashCard ${CARD} ${PREV} ${SIZE}`);
  });

  it('confirm sends flashCard <candidateId> <version> <confirmSizeBytes> (ids only) and shows progress', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(E, `flashCard ${CARD} ${CUR} ${SIZE}`);
    expect(q(container, 'flash-progress')).not.toBeNull();
    // Engine opens a trace and an Operation; writing at 42 %
    h.setCls(log(trace({})));
    const s = base();
    s.operationDB = { 'op-1': flashOp({ currentStep: 2, stepLabel: 'writing', progressPercent: 42.4 }) };
    h.setS(s);
    expect(q(container, 'flash-step-label')!.textContent).toBe('Step 3 of 6: Writing');
    expect((q(container, 'flash-progress-bar') as HTMLProgressElement).value).toBe(42.4);
    expect(q(container, 'flash-progress-percent')!.textContent).toContain('42%');
  });

  it('contract v2: Operation.safeToRemove:true is enough (no trace needed)', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ status: 'Done', safeToRemove: true }) };
    h.setS(s);
    expect(q(container, 'flash-done')!.textContent).toBe(SAFE_TO_REMOVE_TEXT);
  });

  it('contract v2: Operation.safeToRemove:false wins over a trace that says true (POWER_OFF_FAILED)', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ status: 'Done', safeToRemove: false }) };
    h.setS(s);
    h.setCls(log(trace({ status: 'ok', completedAt: Date.now(), result: JSON.stringify({ safeToRemove: true }) })));
    expect(q(container, 'flash-done')).toBeNull();
    expect(q(container, 'flash-done-eject')!.textContent).toBe(EJECT_FIRST_TEXT);
    expect(q(container, 'flash-done-note')!.textContent).toBe(ERROR_TEXT.POWER_OFF_FAILED);
  });

  it('matches the trace on the named arg candidateId only (another card\'s trace is ignored)', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    // A different card's flash whose other args happen to contain our id.
    h.setCls(log(trace({ args: { candidateId: 'aaaaaaaaaaaaaaaa', version: CARD, confirmSizeBytes: '1' }, status: 'error', completedAt: Date.now(), errorMessage: 'BUSY: x' })));
    expect(q(container, 'flash-feedback-error')).toBeNull();
  });

  it('fallback (no Operation.safeToRemove): Done + trace safeToRemove:true → "Done – safe to remove"', () => {
    const { container, h, onClose } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ status: 'Done', currentStep: 6, stepLabel: 'powering-off', progressPercent: 100 }) };
    h.setS(s);
    // Op Done but trace still running: not yet declared safe.
    h.setCls(log(trace({})));
    expect(q(container, 'flash-done')).toBeNull();
    h.setCls(log(trace({ status: 'ok', completedAt: Date.now(), result: JSON.stringify({ candidateId: CARD, safeToRemove: true }) })));
    expect(q(container, 'flash-done')!.textContent).toBe(SAFE_TO_REMOVE_TEXT);
    expect(q(container, 'flash-cancel')).toBeNull();
    fireEvent.click(q(container, 'flash-close')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('Done with POWER_OFF_FAILED (safeToRemove:false) → eject before removing', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ status: 'Done' }) };
    h.setS(s);
    h.setCls(log(trace({ status: 'ok', completedAt: Date.now(), errorMessage: 'POWER_OFF_FAILED: udisksctl failed', result: JSON.stringify({ safeToRemove: false }) })));
    expect(q(container, 'flash-done')).toBeNull();
    expect(q(container, 'flash-done-eject')!.textContent).toBe(EJECT_FIRST_TEXT);
    expect(q(container, 'flash-done-note')!.textContent).toBe(ERROR_TEXT.POWER_OFF_FAILED);
  });

  it('Done but the trace has no safeToRemove → not safe, says so (no soft pass)', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ status: 'Done' }) };
    h.setS(s);
    h.setCls(log(trace({ status: 'ok', completedAt: Date.now(), result: null })));
    expect(q(container, 'flash-done')).toBeNull();
    expect(q(container, 'flash-done-note')!.textContent).toMatch(/did not confirm/);
  });

  it.each(['VERIFY_FAILED', 'MEDIUM_SWAPPED', 'SIZE_CHANGED', 'WRITE_FAILED', 'INTERRUPTED'])(
    'Operation Failed "%s: …" shows the plain text',
    (code) => {
      const { container, h } = open();
      toConfirm(container);
      confirm(container);
      const s = base();
      s.operationDB = { 'op-1': flashOp({ status: 'Failed', error: `${code}: engine detail` }) };
      h.setS(s);
      const f = q(container, 'flash-failed')!;
      expect(f.textContent).toBe(`Flash failed: ${ERROR_TEXT[code]}`);
      expect(f.getAttribute('data-code')).toBe(code);
      expect(q(container, 'flash-done')).toBeNull();
    },
  );

  it('a refused command (trace error, no Operation) shows through CommandFeedback in plain text', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    h.setCls(log(trace({ status: 'error', completedAt: Date.now(), errorMessage: 'HAS_IDEA_META: /dev/sdh2 has META.yaml' })));
    const e = q(container, 'flash-feedback-error')!;
    expect(e.textContent).toContain(ERROR_TEXT.HAS_IDEA_META);
    expect(e.textContent).toContain("Couldn't flash");
    expect(q(container, 'flash-close')).not.toBeNull();
  });

  it('an unknown error code keeps the Engine text', () => {
    expect(parseEngineError('NEW_CODE: something new')).toEqual({ code: 'NEW_CODE', text: 'something new (NEW_CODE)' });
    expect(errorText('plain message')).toBe('plain message');
    expect(errorText('')).toMatch(/without a message/);
  });

  it('no answer from the Engine → timeout feedback', () => {
    vi.useFakeTimers();
    const { container } = open();
    toConfirm(container);
    confirm(container);
    vi.advanceTimersByTime(16_000);
    expect(q(container, 'flash-feedback-timeout')).not.toBeNull();
  });

  it('Cancel during checking/writing sends cancelFlash <operationId>; Failed CANCELLED shows the wiped warning', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ currentStep: 2, stepLabel: 'writing', progressPercent: 10 }) };
    h.setS(s);
    fireEvent.click(q(container, 'flash-cancel')!);
    expect(sent).toHaveBeenLastCalledWith(E, 'cancelFlash op-1');
    expect(q(container, 'flash-cancel')).toBeNull(); // sent once only
    const s2 = base();
    s2.operationDB = { 'op-1': flashOp({ status: 'Failed', error: 'CANCELLED: cancelled by operator' }) };
    h.setS(s2);
    expect(q(container, 'flash-cancelled')!.textContent).toBe(ERROR_TEXT.CANCELLED);
  });

  it('no Cancel once reading-back started (contract: cancel only before writing completes)', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ currentStep: 4, stepLabel: 'reading-back' }) };
    h.setS(s);
    expect(q(container, 'flash-cancel')).toBeNull();
  });

  it('a card that disappears before confirm blocks the flash (NOT_FOUND), nothing sent', () => {
    const { container, h } = open();
    toConfirm(container);
    const s = base();
    s.engineDB[E].clientCards = [];
    h.setS(s);
    expect(q(container, 'flash-blocked')!.textContent).toBe(CARD_GONE_TEXT);
    expect((q(container, 'flash-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(q(container, 'flash-confirm')!);
    expect(sent).not.toHaveBeenCalled();
  });

  it('#219: card swapped while the dialog is open (new candidateId) → "removed or swapped", nothing sent to either id', () => {
    const { container, h } = open();
    toConfirm(container);
    const s = base();
    s.engineDB[E].clientCards = [{ ...s.engineDB[E].clientCards![0], candidateId: 'CAND_SWAPPED' }];
    s.engineDB[E].cardReaders = s.engineDB[E].cardReaders!.map((r) => ({ ...r, candidateId: 'CAND_SWAPPED' }));
    h.setS(s);
    expect(q(container, 'flash-blocked')!.textContent).toBe(CARD_GONE_TEXT);
    expect(CARD_GONE_TEXT).toMatch(/removed or swapped/);
    fireEvent.click(q(container, 'flash-confirm')!);
    expect(sent).not.toHaveBeenCalled();
  });

  it('#219: swapped in the pick step → Next disabled with the same text', () => {
    const { container, h } = open();
    const s = base();
    s.engineDB[E].clientCards = [];
    h.setS(s);
    expect(q(container, 'flash-blocked')!.textContent).toBe(CARD_GONE_TEXT);
    expect((q(container, 'flash-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('#219: card leaves clientCards during progress → the Operation is followed by id to Done', () => {
    const { container, h } = open();
    toConfirm(container);
    confirm(container);
    const s = base();
    s.operationDB = { 'op-1': flashOp({ currentStep: 2, stepLabel: 'writing', progressPercent: 50 }) };
    h.setS(s);
    expect(q(container, 'flash-step-label')!.textContent).toContain('Writing');
    const s2 = base();
    s2.engineDB[E].clientCards = [];
    s2.engineDB[E].cardReaders = s2.engineDB[E].cardReaders!.map((r) => ({ ...r, hasMedium: false, candidateId: null }));
    // subject id changed too: only the operation id links it
    s2.operationDB = { 'op-1': flashOp({ subject: { type: 'disk', id: 'CAND_OTHER' }, status: 'Done', safeToRemove: true, currentStep: 5, stepLabel: 'powering-off' } as Partial<Operation>) };
    h.setS(s2);
    expect(q(container, 'flash-done')!.textContent).toBe(SAFE_TO_REMOVE_TEXT);
    expect(q(container, 'flash-blocked')).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('#219: a freshly flashed card (contents ubuntu) reads neutrally and can be flashed again', () => {
    const s = base();
    s.engineDB[E].clientCards![0] = { ...s.engineDB[E].clientCards![0], contents: { kind: 'ubuntu' } };
    const { container } = open(s);
    expect(q(container, 'flash-blocked')).toBeNull();
    toConfirm(container);
    expect(q(container, 'flash-confirm-contents')!.textContent).toBe('Ubuntu');
    expect(q(container, 'flash-ubuntu-note')!.textContent).toBe(UNLABELLED_UBUNTU_TEXT);
    const all = container.textContent!;
    expect(all).not.toMatch(/foreign|broken|unknown|damaged|not an IDEA/i);
    confirm(container);
    expect(sent).toHaveBeenCalledWith(E, `flashCard ${CARD} ${CUR} ${SIZE}`);
  });

  it('an image larger than the card blocks Next with IMAGE_TOO_LARGE text', () => {
    const s = base();
    s.engineDB[E].clientImages!.images[0].imageSizeBytes = SIZE + 1;
    const { container } = open(s);
    expect(q(container, 'flash-too-small')!.textContent).toBe(ERROR_TEXT.IMAGE_TOO_LARGE);
    expect((q(container, 'flash-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opened from the section: Flash… opens the dialog', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    fireEvent.click(q(container, `client-card-flash-${CARD}`)!);
    expect(q(container, 'flash-dialog')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Initialise new disks', () => {
  it('lists unknown disks (not the client card) with size and contents', () => {
    expect(initialisableDisks(MOCK_STORE.engineDB[E]).map((d) => d.candidateId)).toEqual([DISK]);
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    const row = q(container, `new-disk-${DISK}`)!;
    expect(q(row, 'new-disk-label')!.textContent).toBe('WD Elements 2620 (1.0 TB)');
    expect(q(row, 'new-disk-contents')!.textContent).toBe("1 × ext4 'DATA'");
    expect(q(container, `new-disk-${CARD}`)).toBeNull();
  });

  it('Initialise sends initialiseDisk <candidateId> <type> and reports success', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    fireEvent.change(q(container, `new-disk-type-${DISK}`)!, { target: { value: 'files' } });
    fireEvent.click(q(container, `new-disk-initialise-${DISK}`)!);
    expect(sent).toHaveBeenCalledWith(E, `initialiseDisk ${DISK} files`);
    expect(q(container, `new-disk-initialise-${DISK}`)!.textContent).toBe('Initialising…');
    h.setCls(log(trace({ traceId: 'i1', command: 'initialiseDisk', args: { candidateId: DISK, role: 'files' }, status: 'ok', completedAt: Date.now() })));
    expect(q(container, `new-disk-done-${DISK}`)).not.toBeNull();
  });

  it('ID-keyed rows: a store update with new objects keeps the row and its "Initialising…" state', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    fireEvent.click(q(container, `new-disk-initialise-${DISK}`)!);
    const row = q(container, `new-disk-${DISK}`);
    const cardRow = q(container, `client-card-${CARD}`);
    h.setS(base()); // every engine/disk/card object is new (as after an Automerge change)
    expect(q(container, `new-disk-${DISK}`)).toBe(row);
    expect(q(container, `client-card-${CARD}`)).toBe(cardRow);
    expect(q(container, `new-disk-initialise-${DISK}`)!.textContent).toBe('Initialising…');
  });

  it('a refusal shows in plain text through CommandFeedback', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    fireEvent.click(q(container, `new-disk-initialise-${DISK}`)!);
    expect(sent).toHaveBeenCalledWith(E, `initialiseDisk ${DISK} empty`);
    h.setCls(log(trace({ traceId: 'i1', command: 'initialiseDisk', args: { candidateId: DISK, role: 'empty' }, status: 'error', completedAt: Date.now(), errorMessage: 'IN_USE_BY_APP: holder kolibri' })));
    expect(q(container, `new-disk-feedback-${DISK}-error`)!.textContent).toContain(ERROR_TEXT.IN_USE_BY_APP);
  });

  it('without unknownDiskReadOnly: Initialise disabled with the hint', () => {
    const s = withEngine(base(), { capabilities: ['diskIdArgs', 'clientCards', 'flashCard', 'clientImages'] });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect((q(container, `new-disk-initialise-${DISK}`) as HTMLButtonElement).disabled).toBe(true);
    expect(q(container, `new-disk-hint-${DISK}`)!.textContent).toMatch(/claims new disks/);
  });

  it('contract v2: a non-ext4 new disk (also in unformattedDisks, same id) offers Erase first, Initialise disabled with NOT_EXT4', () => {
    const s = withEngine(base(), {
      unformattedDisks: [{ candidateId: DISK, device: 'sdb', sizeBytes: 1_000_204_886_016, model: 'WD Elements 2620', fsType: 'ntfs', label: 'WD' }],
      capabilities: [...(base().engineDB[E].capabilities ?? []), 'eraseDisk'],
    });
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect((q(container, `new-disk-initialise-${DISK}`) as HTMLButtonElement).disabled).toBe(true);
    expect(q(container, `new-disk-hint-${DISK}`)!.textContent).toBe(ERROR_TEXT.NOT_EXT4);
    fireEvent.click(q(container, `new-disk-erase-${DISK}`)!);
    expect(q(container, 'erase-dialog')).not.toBeNull();
    expect(sent).toHaveBeenCalledWith(E, `summariseDisk ${DISK}`);
    expect(sent).not.toHaveBeenCalledWith(E, expect.stringMatching(/^initialiseDisk/));
    // Once erased (ext4, gone from unformattedDisks), Initialise is offered.
    h.setS(withEngine(base(), { unformattedDisks: [] }));
    expect(q(container, `new-disk-erase-${DISK}`)).toBeNull();
    expect((q(container, `new-disk-initialise-${DISK}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('an ext4 new disk has no Erase button', () => {
    const h = harness();
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `new-disk-erase-${DISK}`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Adapter commands (ids only, fail loudly)', () => {
  it('Engine #219: step number comes from the label (currentStep is 0-based)', () => {
    expect(flashStepNumber('checking', 0)).toBe(1);
    expect(flashStepNumber('writing', 2)).toBe(3);
    expect(flashStepNumber('powering-off', 5)).toBe(6);
    expect(flashStepNumber('something-new', 3)).toBe(4);
    expect(flashStepNumber(null, null)).toBe(0);
  });

  it('builds the contract strings', () => {
    expect(buildFlashCardCommand(CARD, 'current', SIZE)).toBe(`flashCard ${CARD} current ${SIZE}`);
    expect(buildInitialiseDiskCommand(DISK)).toBe(`initialiseDisk ${DISK} empty`);
    expect(buildInitialiseDiskCommand(DISK, 'backup')).toBe(`initialiseDisk ${DISK} backup`);
    expect(buildCancelFlashCommand('op-1')).toBe('cancelFlash op-1');
  });
  it('throws on whitespace or empty ids and on a bad size (never sends a broken command)', () => {
    expect(() => buildFlashCardCommand('a b', CUR, SIZE)).toThrow(/whitespace/);
    expect(() => buildFlashCardCommand(CARD, '', SIZE)).toThrow();
    expect(() => buildFlashCardCommand(CARD, CUR, 0)).toThrow(/size/);
    expect(() => buildFlashCardCommand(CARD, CUR, 1.5)).toThrow(/size/);
    expect(() => buildInitialiseDiskCommand('')).toThrow();
    expect(() => buildCancelFlashCommand('op 1')).toThrow();
  });
  it('every contract §5 code has plain text', () => {
    for (const c of ['NOT_FOUND', 'NOT_REMOVABLE', 'SYSTEM_DISK', 'BOOT_DEVICE', 'HAS_IDEA_META', 'ALREADY_IDEA', 'MOUNTED', 'IN_USE_BY_APP', 'BUSY', 'SIZE_CHANGED', 'MEDIUM_SWAPPED', 'IMAGE_NOT_FOUND', 'IMAGE_BAD_SHA', 'IMAGE_TOO_LARGE', 'WRITE_FAILED', 'VERIFY_FAILED', 'POWER_OFF_FAILED', 'INTERRUPTED', 'CANCELLED', 'HELPER_MISSING', 'NOT_EXT4', 'BAD_ARGS']) {
      expect(ERROR_TEXT[c], c).toBeTruthy();
      expect(errorText(`${c}: x`)).toBe(ERROR_TEXT[c]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Demo mode (idea#201)', () => {
  const e = MOCK_STORE.engineDB[E];
  it('has a reader with a card, an unknown disk and image versions', () => {
    expect(e.cardReaders).toEqual([expect.objectContaining({ id: READER, hasMedium: true, candidateId: CARD })]);
    expect(e.clientCards).toEqual([expect.objectContaining({ candidateId: CARD, readerId: READER, flashable: true })]);
    expect(e.newDisks!.map((d) => d.candidateId).sort()).toEqual([CARD, DISK].sort());
    expect(e.clientImages!.current).toBe(CUR);
    expect(e.clientImages!.previous).toBe(PREV);
    expect(flashableImages(e).map((i) => i.version)).toEqual([CUR, PREV]);
    for (const c of ['clientCards', 'flashCard', 'clientImages', 'unknownDiskReadOnly']) expect(e.capabilities).toContain(c);
    // every id is space-free (commands are space-split)
    for (const id of [READER, CARD, DISK, CUR, PREV]) expect(id).not.toMatch(/\s/);
  });
  it('production web never uses demo data', () => {
    for (const storedDemo of [true, false]) {
      for (const searchParams of ['', '?demo=1', '?demo=true']) {
        expect(resolveDemoMode({ productionWeb: true, storedDemo, searchParams }).isDemo).toBe(false);
      }
    }
  });
});
describe('Stale BUSY after a flash (idea04 13:18 / 16:11)', () => {
  const OTHER = 'ffffffffffffffff';
  const twoCards = (): Store => {
    const s = base();
    s.engineDB[E].clientCards!.push({ ...s.engineDB[E].clientCards![0], candidateId: OTHER, readerId: null, model: 'Other SSD' });
    return s;
  };
  const allBusy = (s: Store, opStatus: Operation['status'] = 'Running'): Store => {
    s.engineDB[E].clientCards = s.engineDB[E].clientCards!.map((c) => ({ ...c, flashable: false, refusal: 'BUSY' }));
    s.engineDB[E].flashInProgress = { operationId: 'op-1', candidateId: CARD, version: CUR, step: 'writing' };
    s.operationDB = { 'op-1': flashOp({ status: opStatus, currentStep: 2, stepLabel: 'writing', progressPercent: 40 }) };
    return s;
  };
  const startFromSection = () => {
    const h = harness(twoCards());
    const r = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    fireEvent.click(q(r.container, `client-card-flash-${CARD}`)!);
    fireEvent.click(q(r.container, 'flash-next')!);
    fireEvent.click(q(r.container, 'flash-confirm')!);
    return { ...r, h };
  };

  it('during the flash: no BUSY hint on the target card (the dialog shows progress); other card says BUSY', () => {
    const { container, h } = startFromSection();
    h.setS(allBusy(twoCards()));
    expect(q(container, `client-card-hint-${CARD}`)).toBeNull();
    expect(q(container, 'flash-step-label')!.textContent).toContain('Writing');
    expect(q(container, `client-card-hint-${OTHER}`)!.textContent).toBe(ERROR_TEXT.BUSY);
  });

  it('op Done + target gone from clientCards: no BUSY hint, no stale row, Flash enabled for the other card', () => {
    const { container, h } = startFromSection();
    h.setS(allBusy(twoCards()));
    // Exact Engine sequence: op Done, the target powers off and leaves clientCards
    // (its reader keeps hasMedium for a moment); the remaining card is still
    // marked BUSY in the same doc change.
    const done = allBusy(twoCards(), 'Done');
    done.operationDB['op-1'] = { ...done.operationDB['op-1'], safeToRemove: true, currentStep: 5, stepLabel: 'powering-off', completedAt: Date.now() } as Operation;
    done.engineDB[E].clientCards = done.engineDB[E].clientCards!.filter((c) => c.candidateId !== CARD);
    h.setS(done);
    expect(q(container, 'flash-done')!.textContent).toBe(SAFE_TO_REMOVE_TEXT);
    expect(q(container, `client-card-${CARD}`)).toBeNull();
    expect(container.textContent).not.toContain(ERROR_TEXT.BUSY);
    fireEvent.click(q(container, 'flash-close')!);
    expect((q(container, `client-card-flash-${OTHER}`) as HTMLButtonElement).disabled).toBe(false);
    expect(container.textContent).not.toContain(ERROR_TEXT.BUSY);
    // Engine then cleans its store: still no row and no hint.
    const clean = twoCards();
    clean.engineDB[E].clientCards = clean.engineDB[E].clientCards!.filter((c) => c.candidateId !== CARD);
    h.setS(clean);
    expect(q(container, `client-card-${CARD}`)).toBeNull();
    expect((q(container, `client-card-flash-${OTHER}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a lingering flashInProgress for a Done op does not mark other cards BUSY', () => {
    const s = allBusy(twoCards(), 'Done');
    s.engineDB[E].clientCards = s.engineDB[E].clientCards!.map((c) => ({ ...c, flashable: true, refusal: null }));
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `client-card-hint-${OTHER}`)).toBeNull();
    expect(q(container, `client-card-hint-${CARD}`)).toBeNull();
  });

  it('a real BUSY (another op still running) is still shown', () => {
    const s = allBusy(twoCards());
    s.engineDB[E].flashInProgress = { operationId: 'op-1', candidateId: OTHER, version: CUR, step: 'writing' };
    s.operationDB['op-1'] = { ...s.operationDB['op-1'], subject: { type: 'disk', id: OTHER } } as Operation;
    const h = harness(s);
    const { container } = render(() => <ClientCardsSection engineId={E} store={h.s} commandLogStore={h.cls} />);
    expect(q(container, `client-card-hint-${CARD}`)!.textContent).toBe(ERROR_TEXT.BUSY);
  });
});
