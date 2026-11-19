/**
 * idea#168 Markov seed 42 FAIL@641 (harness f171032, Console df13dbfa, intents 66a96c1):
 * confirm_eject on a fixture that lives on a REMOTE Engine (after infra_move_disk: idea04) died with
 * "locator.getAttribute: Timeout 30000ms exceeded ... [data-testid="eject-notice-duration-kolibri-grade5a-001"]".
 * The Console shows `eject-notice-<id>` (state "sent") only while it waits for a remote Engine and removes it the moment
 * the Engine confirms / the disk row leaves the tree. The old loop read it with locator.count() then getAttribute():
 * the notice vanished in between and getAttribute auto-waited 30 s. The eject itself had succeeded.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readEjectDom } from '../e2e/intents/ejectDom';
import { confirm_eject } from '../e2e/intents/operatorActions';
import { sel } from '../e2e/intents/selectors';

const KOL = 'duration-kolibri-grade5a-001';

const html = (parts: { disk?: boolean; notice?: string; dialog?: boolean; marker?: string }) => {
  document.body.innerHTML = [
    parts.disk === false ? '' : `<div data-testid="disk-${KOL}" data-disk-id="${KOL}"></div>`,
    parts.dialog ? '<div data-testid="eject-confirm"><button data-testid="eject-confirm-ok"></button></div>' : '',
    parts.notice ? `<div data-testid="eject-notice-${KOL}" data-eject-state="${parts.notice}">Sent to idea04, waiting for confirmation…</div>` : '',
    parts.marker ?? '',
  ].join('');
};
const domSel = { notice: sel.ejectNotice(KOL), disk: sel.disk(KOL), marker: sel.ejectCommandResult };
const livePage = { evaluate: async <R, A>(fn: (a: A) => R, arg: A) => fn(arg) };

describe('readEjectDom (one atomic read)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reads notice state + text, disk presence and the command marker in one go', () => {
    html({ notice: 'sent', marker: '<div data-testid="eject-command-result" data-seq="3" data-status="error" data-error="busy"></div>' });
    return expect(readEjectDom(livePage, domSel)).resolves.toEqual({
      noticeStateRaw: 'sent',
      noticeMessage: 'Sent to idea04, waiting for confirmation…',
      diskPresent: true,
      marker: { seq: 3, status: 'error', error: 'busy' },
    });
  });

  it('absent notice / disk / marker never waits: null state, diskPresent false, marker null', async () => {
    html({ disk: false });
    expect(await readEjectDom(livePage, domSel)).toEqual({ noticeStateRaw: null, noticeMessage: null, diskPresent: false, marker: null });
    expect((await readEjectDom(livePage, { ...domSel, disk: null })).diskPresent).toBe(false);
  });
});

/**
 * Fake Playwright page over jsdom. Like Playwright, locator.getAttribute/textContent auto-wait for the element
 * (here: throw the 30 s timeout at once when it is gone). `afterRead` runs after every DOM read, so the Console's
 * "notice removed on confirmation" lands between two round trips — exactly the race.
 */
const fakePage = (afterRead: () => void) => {
  const q = (s: string) => document.querySelector(s);
  const timeout = (s: string) => new Error(`locator.getAttribute: Timeout 30000ms exceeded. waiting for locator('${s}').first()`);
  const page = {
    evaluate: async <R, A>(fn: (a: A) => R, arg: A) => { const r = fn(arg); afterRead(); return r; },
    waitForTimeout: async () => {},
    locator: (s: string) => ({
      first: () => page.locator(s),
      waitFor: async () => { if (!q(s)) throw new Error(`waitFor ${s}`); },
      click: async () => { (q(s) as HTMLElement).click(); },
      isVisible: async () => !!q(s),
      count: async () => { const n = document.querySelectorAll(s).length; afterRead(); return n; },
      getAttribute: async (a: string) => { const e = q(s); if (!e) throw timeout(s); const v = e.getAttribute(a); afterRead(); return v; },
      textContent: async () => { const e = q(s); if (!e) throw timeout(s); return e.textContent; },
    }),
  };
  return page;
};

describe('confirm_eject on a remote-Engine disk (seed 42 @641)', () => {
  it('notice present at one read and gone at the next: the eject is judged by the disk leaving the tree, no 30 s getAttribute wait', async () => {
    html({ dialog: true });
    // Eject confirm click: the dialog closes and the Console shows the "sent" notice for the remote Engine.
    document.querySelector('[data-testid="eject-confirm-ok"]')!.addEventListener('click', () => { html({ notice: 'sent' }); });
    // The Engine confirms right after the first look: notice and disk row are removed.
    let reads = 0;
    const page = fakePage(() => { if (++reads === 2) html({ disk: false }); });
    await expect(confirm_eject({ page: page as never, diskId: KOL } as never)).resolves.toBeUndefined();
  });

  it('a refusal shown in the notice still fails loud, with the Engine text', async () => {
    html({ dialog: true });
    document.querySelector('[data-testid="eject-confirm-ok"]')!.addEventListener('click', () => {
      html({});
      document.body.insertAdjacentHTML('beforeend', `<div data-testid="eject-notice-${KOL}" data-eject-state="error">Couldn't eject: Disk is busy</div>`);
    });
    await expect(confirm_eject({ page: fakePage(() => {}) as never, diskId: KOL } as never)).rejects.toThrow(/eject refused.*busy/);
  });
});
