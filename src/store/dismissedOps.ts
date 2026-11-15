/**
 * Operation cards dismissed in this browser (idea#498). Dismissing a finished
 * card (Done, Failed, Cancelled) only hides it here; it never sends a command
 * to the Engine. Kept in localStorage so a dismissed Failed card stays hidden
 * after a reload and on both the desktop and the mobile layout.
 */
import { createSignal } from 'solid-js';
import type { Operation } from '../types/store';

const KEY = 'idea.dismissedOps';
/** Keep the newest ids only, so the list can't grow without bound. */
export const MAX_DISMISSED_OPS = 200;

const read = (): string[] => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const [ids, setIds] = createSignal<string[]>(read());

export const isOpDismissed = (opId: string): boolean => ids().includes(opId);

/**
 * Hide a card in this browser. `persist` (default true) keeps it hidden after a
 * reload; the Done auto-dismiss passes false, because a Done card is not shown
 * after a reload anyway and would only crowd out the Failed ids.
 */
export const dismissOp = (opId: string, persist = true): void => {
  if (!ids().includes(opId)) setIds([...ids(), opId].slice(-MAX_DISMISSED_OPS));
  if (!persist) return;
  const stored = read();
  if (stored.includes(opId)) return;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify([...stored, opId].slice(-MAX_DISMISSED_OPS))); } catch { /* private mode: in-memory only */ }
};

/** Only a Pending or Running op can be cancelled on the Engine. */
export const isCancellable = (op: Operation): boolean => op.status === 'Pending' || op.status === 'Running';

/** Test hook. */
export const resetDismissedOps = (): void => {
  setIds([]);
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ }
};
