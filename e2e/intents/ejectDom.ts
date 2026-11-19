/**
 * One atomic DOM read for confirm_eject (idea#168 Markov seed 42 FAIL@641 on harness f171032).
 *
 * The eject notice (`eject-notice-<diskId>`) is rendered while the Console waits for a REMOTE Engine
 * ("Sent to idea04, waiting for confirmation…") and is removed the moment the Engine confirms — or when the disk
 * row leaves the tree. A Playwright `locator.count()` followed by `locator.getAttribute()` is two round trips: if the
 * notice is removed in between, `getAttribute` auto-waits 30 s for an element that is gone and throws
 * "locator.getAttribute: Timeout 30000ms exceeded" although the eject succeeded. Reading everything in ONE
 * `page.evaluate` sees a consistent snapshot and never waits.
 */
export interface EjectDomSnapshot {
  /** Raw data-eject-state of the first matching notice, or null when no notice is in the DOM. */
  noticeStateRaw: string | null;
  noticeMessage: string | null;
  /** True while a row matching the disk selector is in the tree (false when no disk selector was given). */
  diskPresent: boolean;
  /** The eject-command-result marker, or null when absent / without a status. */
  marker: { seq: number; status: string; error: string | null } | null;
}

export interface EjectDomPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

export interface EjectDomSelectors {
  notice: string;
  /** null when the target disk id is unknown. */
  disk: string | null;
  marker: string;
}

export async function readEjectDom(page: EjectDomPage, selectors: EjectDomSelectors): Promise<EjectDomSnapshot> {
  return page.evaluate((s: EjectDomSelectors): EjectDomSnapshot => {
    const notice = document.querySelector(s.notice);
    const marker = document.querySelector(s.marker);
    const status = marker?.getAttribute('data-status') ?? '';
    return {
      noticeStateRaw: notice ? (notice.getAttribute('data-eject-state') ?? 'none') : null,
      noticeMessage: notice ? ((notice.textContent ?? '').trim() || null) : null,
      diskPresent: s.disk ? document.querySelector(s.disk) !== null : false,
      marker: marker && status
        ? { seq: Number(marker.getAttribute('data-seq') ?? '0') || 0, status, error: marker.getAttribute('data-error') }
        : null,
    };
  }, selectors);
}
