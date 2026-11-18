/**
 * walk98 (cover-all-c1cc4bb step 98 backup_instance false fail): a fresh walker browser has dismissed
 * nothing, so an old Failed OperationProgress card (the 16 Nov scheduled backup hj8ch6cexyfoev7mvla,
 * "INTERRUPTED") was on screen from the first poll, and `card.first()` judged THAT card instead of the
 * backup op the click created (0xo3wv7fs9o7lh2o7vx, Done).
 *
 * Rule for every Intent that judges an Operation from the cards: snapshot the card ids that exist
 * BEFORE the click, and decide only on a card whose id is not in that snapshot. Cards carry no start
 * time, so "created by this click" is "id not seen before the click". Old Failed cards are ignored.
 */
import type { Page } from '@playwright/test';

export interface OpCardView {
  id: string;
  status: string;
  error: string;
}

export type OpCardReader = () => Promise<OpCardView[]>;

const CARD_PREFIX = 'operation-card-';

/** Reads the cards matching `selector` (kind + instance) from the page. */
export function pageCardReader(page: Page, selector: string): OpCardReader {
  return async () => {
    const rows = await page.locator(selector).evaluateAll((els) =>
      els.map((el) => ({
        testId: el.getAttribute('data-testid') ?? '',
        status: (el.getAttribute('data-op-status') ?? '').trim(),
        error: (el.querySelector('.operation-card__error')?.textContent ?? '').trim(),
      })),
    );
    return rows.map((r) => ({
      id: r.testId.startsWith(CARD_PREFIX) ? r.testId.slice(CARD_PREFIX.length) : r.testId,
      status: r.status,
      error: r.error,
    }));
  };
}

/** Ids of the cards visible now — call BEFORE the click that starts the Operation. */
export async function snapshotOpIds(read: OpCardReader): Promise<ReadonlySet<string>> {
  return new Set((await read()).map((c) => c.id));
}

export type NewOpOutcome =
  | { kind: 'seen'; op: OpCardView }
  | { kind: 'failed'; op: OpCardView }
  | { kind: 'refused'; message: string }
  | { kind: 'timeout'; ignoredStale: OpCardView[] };

export interface WaitNewOpDeps {
  read: OpCardReader;
  /** CommandFeedback error text for the instance, '' when none. */
  readRefusal: () => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Wait for a card that was not in `baseline`. Pending / Running / Done = accepted; Failed = failed;
 * a CommandFeedback refusal = refused. Cards in `baseline` are never judged.
 */
export async function waitForNewOp(
  baseline: ReadonlySet<string>,
  budgetMs: number,
  deps: WaitNewOpDeps,
  pollMs = 250,
): Promise<NewOpOutcome> {
  const deadline = deps.now() + budgetMs;
  let ignored: OpCardView[] = [];
  while (deps.now() < deadline) {
    const refusal = (await deps.readRefusal()).trim();
    if (refusal) return { kind: 'refused', message: refusal };
    const cards = await deps.read();
    const fresh = cards.find((c) => !baseline.has(c.id));
    if (fresh) return fresh.status === 'Failed' ? { kind: 'failed', op: fresh } : { kind: 'seen', op: fresh };
    ignored = cards;
    await deps.sleep(pollMs);
  }
  return { kind: 'timeout', ignoredStale: ignored };
}
