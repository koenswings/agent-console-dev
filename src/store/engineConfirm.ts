/**
 * The Engine's own confirmation step (428 CONFIRM_REQUIRED, agent-engine-dev#582 §2(1)b).
 *
 * The Engine answers a disk wipe or a card flash with a summary it built from
 * its own data and a confirmId. The Console shows that summary and asks the
 * operator to type the confirmation field; the command is then sent again.
 * One request at a time; a new request cancels an open one.
 */
import { createSignal } from 'solid-js';
import type { ConfirmRequest } from './signedCommand';
import { contentsLabel } from './clientCards';
import type { CardContents } from '../types/store';

export interface PendingEngineConfirm {
  req: ConfirmRequest;
  engineName: string;
  /** performance.now() after which the Engine no longer accepts the confirmId. */
  expiresAt: number;
  resolve: (typed: string | null) => void;
}

const [pending, setPending] = createSignal<PendingEngineConfirm | null>(null);

/** The open confirmation, or null. */
export const pendingEngineConfirm = pending;

export const requestEngineConfirm = (req: ConfirmRequest, engineName: string): Promise<string | null> =>
  new Promise((resolve) => {
    pending()?.resolve(null);
    setPending({ req, engineName, expiresAt: performance.now() + Math.max(0, req.expiresInMs), resolve });
  });

/** Close the dialog: the typed text, or null for Cancel / expiry. */
export const answerEngineConfirm = (typed: string | null): void => {
  const p = pending();
  if (!p) return;
  setPending(null);
  p.resolve(typed);
};

/** One row of the summary, for display. */
export interface SummaryRow {
  key: string;
  label: string;
  value: string;
}

/**
 * Summary fields (agent-engine-dev#582, pixel-answers 5):
 *   eraseDisk / makeBackupDisk: { command, targetId, label, sizeBytes, device, apps: ["<name> <version>"] }
 *   flashCard:                  { command, candidateId, sizeBytes, model, version, contents }
 *                               (contents as Engine.clientCards[].contents, pixel-answers F6)
 * Ids and the command name are not shown; unknown keys are shown as they are.
 */
const LABELS: Record<string, string> = {
  label: 'Disk',
  sizeBytes: 'Size',
  device: 'Device',
  apps: 'Apps on it',
  model: 'Card',
  version: 'Image version',
  contents: 'Now on the card',
};

const HIDDEN = new Set(['command', 'targetId', 'candidateId']);

/** Bytes as the Console shows sizes elsewhere (decimal GB/MB). */
export const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${n} bytes`;
};

const show = (key: string, v: unknown): string => {
  if (key === 'contents' && v && typeof v === 'object') return contentsLabel(v as CardContents);
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length === 0 ? 'none' : v.map((x) => (typeof x === 'object' && x ? String((x as { name?: unknown }).name ?? JSON.stringify(x)) : String(x))).join(', ');
  if (typeof v === 'number' && /size/i.test(key)) return formatBytes(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** The Engine's summary as rows, in the Engine's order (see LABELS). */
export const summaryRows = (summary: unknown): SummaryRow[] => {
  if (!summary || typeof summary !== 'object') {
    return summary ? [{ key: 'summary', label: 'Summary', value: String(summary) }] : [];
  }
  return Object.entries(summary as Record<string, unknown>).filter(([key]) => !HIDDEN.has(key)).map(([key, v]) => ({
    key,
    label: LABELS[key] ?? key,
    value: show(key, v),
  }));
};

/**
 * How the operator confirms, by confirmField (pixel-answers 5):
 *   'type'        — label: types the disk label once, here;
 *   'acknowledge' — sizeBytes: no typing; Confirm sends String(summary.sizeBytes).
 */
export const confirmMode = (field: string): 'type' | 'acknowledge' => (field === 'sizeBytes' ? 'acknowledge' : 'type');

/** What the operator is asked to type, for confirmMode 'type'. */
export const confirmPrompt = (field: string): string =>
  field === 'label' ? 'Type the disk name to confirm' : 'Type the value shown above to confirm';

/** The value the operator should type, when the summary carries it (for the input check). */
export const expectedConfirmValue = (req: ConfirmRequest): string | null => {
  const s = req.summary;
  if (!s || typeof s !== 'object') return null;
  const v = (s as Record<string, unknown>)[req.confirmField];
  return v === undefined || v === null ? null : String(v);
};
