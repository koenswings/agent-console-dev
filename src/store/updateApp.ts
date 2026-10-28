/**
 * updateApp adapter (console#168; Engine agent-engine-dev#230 / #263).
 *
 * The ONLY module that knows the Engine's updateApp shapes. They are
 * PROVISIONAL (Axle, console#168 comment 6469232793; Engine draft PR #268), so
 * a field rename later is a change to this file alone. Everything is gated on
 * the `updateApp` capability (and `updateAppFetch` for a cross-Engine source);
 * an Engine without them gets no badge, no button and no new text.
 *
 * Provisional shapes used here:
 *  - command  `updateApp <instanceId> <newAppId> [--source <diskId>] [--allow-major]`
 *  - caps     `updateApp`, `updateAppFetch`
 *  - instance `updateAvailable: { appId, sourceDiskId?, engineId? }`, `previousAppId`,
 *             optional `fetchPaused: { reason, bytesDone, bytesTotal, since }`
 *             (the agreed design's richer fields — diskId, major, fromVersion,
 *             toVersion, estimatedMinutes, sourceEngineId, sizeBytes, migrationNote —
 *             are read too when present)
 *  - op       kind `upgradeApp`, steps Fetch/Check/Snapshot/Swap/Start/Health,
 *             states running/done/failed/rolledBack, failure text `ROLLED BACK: <why>` (confirmed);
 *             failed rollback: instance Stopped, statusCondition `ROLLBACK FAILED: …` (confirmed)
 *  - progress ephemeral `{ type: 'idea/updateProgress', engineId, instanceId, step, bytesDone, bytesTotal }`
 *  - refusals `CODE: text` in the trace error
 */
import { createSignal } from 'solid-js';
import { engineHasCapability } from './commands';
import type { App, Engine, Instance, Operation, Store } from '../types/store';

// ── Capabilities ────────────────────────────────────────────────────────────
export const CAP_UPDATE = 'updateApp' as const;
export const CAP_FETCH = 'updateAppFetch' as const;
export const OP_KIND = 'upgradeApp' as const;
export const COMMAND = 'updateApp' as const;

export const canUpdate = (engine: Engine | null | undefined): boolean => engineHasCapability(engine, CAP_UPDATE);
export const canFetch = (engine: Engine | null | undefined): boolean => engineHasCapability(engine, CAP_FETCH);

// ── Offer (normalised updateAvailable) ──────────────────────────────────────
export interface UpdateOffer {
  toAppId: string;
  fromVersion: string;
  toVersion: string;
  major: boolean;
  estimatedMinutes: number | null;
  sourceDiskId: string | null;
  /** Set only when the new version is on a disk in ANOTHER Engine. */
  sourceEngineId: string | null;
  sizeBytes: number | null;
  migrationNote: string | null;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rawOf = (o: unknown): Raw => (o && typeof o === 'object' ? (o as Raw) : {});

/** Version of an app id: appDB first, else the part after the last '-'. */
export const versionOf = (appDB: Record<string, App> | undefined, appId: string): string =>
  appDB?.[appId]?.version ?? (appId.includes('-') ? appId.slice(appId.lastIndexOf('-') + 1) : appId);

const majorOf = (v: string): string => v.split('.')[0] ?? v;

/** The engine an instance runs on (its disk's dockedTo). */
export const engineIdOfInstance = (store: Store | null, inst: Instance | undefined): string | null => {
  const d = inst?.storedOn ? store?.diskDB?.[String(inst.storedOn)] : undefined;
  return d?.dockedTo ? String(d.dockedTo) : null;
};

/**
 * The update on offer for `inst`, or null (no field, no capability, or a
 * cross-Engine source the Engine can't fetch).
 */
export const updateOfferFor = (store: Store | null, inst: Instance | undefined, engine: Engine | undefined): UpdateOffer | null => {
  if (!inst || !canUpdate(engine)) return null;
  const u = rawOf((inst as unknown as Raw).updateAvailable);
  const toAppId = str(u.appId);
  if (!toAppId) return null;
  const fromVersion = str(u.fromVersion) ?? versionOf(store?.appDB, String(inst.instanceOf));
  const toVersion = str(u.toVersion) ?? versionOf(store?.appDB, toAppId);
  const src = str(u.sourceEngineId) ?? str(u.engineId);
  const sourceEngineId = src && src !== engine?.id ? src : null;
  if (sourceEngineId && !canFetch(engine)) return null;
  const toApp = rawOf(store?.appDB?.[toAppId]);
  return {
    toAppId,
    fromVersion,
    toVersion,
    major: typeof u.major === 'boolean' ? u.major : majorOf(fromVersion) !== majorOf(toVersion),
    estimatedMinutes: num(u.estimatedMinutes),
    sourceDiskId: str(u.sourceDiskId) ?? str(u.diskId),
    sourceEngineId,
    sizeBytes: num(u.sizeBytes),
    migrationNote: str(u.migrationNote) ?? str(toApp.migrationNote),
  };
};

export const engineLabel = (store: Store | null, engineId: string | null): string =>
  (engineId && String(store?.engineDB?.[engineId]?.hostname ?? engineId)) || 'the other Engine';

// ── Command ─────────────────────────────────────────────────────────────────
export const buildUpdateAppCommand = (instanceId: string, offer: Pick<UpdateOffer, 'toAppId' | 'sourceDiskId' | 'major'>): string =>
  [COMMAND, instanceId, offer.toAppId,
    ...(offer.sourceDiskId ? ['--source', offer.sourceDiskId] : []),
    ...(offer.major ? ['--allow-major'] : [])].join(' ');

// ── Text ────────────────────────────────────────────────────────────────────
export const badgeText = (o: UpdateOffer, sourceEngine: string | null): string =>
  `Update available: ${o.fromVersion} to ${o.toVersion}` + (sourceEngine ? ` (on a disk in ${sourceEngine})` : '');

export const confirmText = (app: string, o: UpdateOffer, sourceEngine: string | null): string[] => {
  const lines = [
    `Update ${app} from ${o.fromVersion} to ${o.toVersion}?`,
    "Your learners' work is kept.",
    o.estimatedMinutes != null
      ? `${app} is unavailable for up to ${o.estimatedMinutes} minutes.`
      : 'This can take a while.',
    "If the new version doesn't work, IDEA switches back to the old one by itself.",
  ];
  if (sourceEngine) {
    lines.push(`The new version is on a disk in ${sourceEngine}. IDEA copies it here first, and ${app} keeps working while it copies. Keep ${sourceEngine} switched on until the copy is done.`);
  }
  return lines;
};

export const NEEDS_BACKUP_TEXT = 'Dock a Backup Disk and make a backup first';
/** NO_SUMS wording (Steve, 2026-10-28). */
export const NO_SUMS_TEXT = "This disk's new version can't be checked, so the app wasn't updated. Your app still works as before. Ask for a fresh copy of this App Disk.";

export interface RefusalCtx { app: string; fromVersion: string; engine: string; diskName: string | null }

export const REFUSAL_TEXT: Record<string, (c: RefusalCtx, detail: string) => string> = {
  NOT_DOCKED: (c) => `The disk with ${c.app} is not in this Engine. Nothing changed.`,
  BUSY: (c) => `Something else is running on ${c.app}. Try again when it is done.`,
  SOURCE_MISSING: (c) => `The disk with the new version is no longer in ${c.engine}. Nothing changed.`,
  DIFFERENT_APP: () => 'That disk has a different app, not a new version of this one. Nothing changed.',
  NOT_NEWER: (c) => `${c.app} is already on this version or newer. Nothing changed.`,
  MAJOR_NOT_ALLOWED: (c) => `This is a big update for ${c.app} and was not confirmed. Nothing changed.`,
  NEEDS_BACKUP: () => NEEDS_BACKUP_TEXT,
  NO_SPACE: (c, detail) => `${c.diskName ?? (detail || 'The disk')} is full. Make room and try again. Nothing changed.`,
  NO_SUMS: () => NO_SUMS_TEXT,
  TRANSFER_FAILED: (c) => `The copy from ${c.engine} didn't finish, so nothing changed. ${c.app} is still on ${c.fromVersion}. Try again while ${c.engine} is switched on.`,
  SOURCE_UNSUPPORTED: (c) => `${c.engine} needs a newer IDEA version before it can share this update. Nothing changed.`,
};

/** `CODE: text` → [code, text]; code is null when the message has no known code. */
export const parseRefusal = (message: string): { code: string | null; detail: string } => {
  const m = /\b([A-Z][A-Z_]+)\b:?\s*(.*)$/s.exec(message.trim());
  if (m && REFUSAL_TEXT[m[1]]) return { code: m[1], detail: m[2].trim() };
  return { code: null, detail: message };
};

export const friendlyUpdateError = (message: string, ctx: RefusalCtx): string => {
  const { code, detail } = parseRefusal(message);
  return code ? REFUSAL_TEXT[code](ctx, detail) : message;
};

// ── Operation / progress ────────────────────────────────────────────────────
export type UpdateStep = 'Fetch' | 'Check' | 'Snapshot' | 'Swap' | 'Start' | 'Health';
export const STEPS: UpdateStep[] = ['Fetch', 'Check', 'Snapshot', 'Swap', 'Start', 'Health'];
const STEP_LABEL: Record<Exclude<UpdateStep, 'Fetch'>, string> = {
  Check: 'Checking',
  Snapshot: 'Saving a safety copy',
  Swap: 'Installing',
  Start: 'Starting',
  Health: 'Checking it works',
};

export interface UpdateProgress { step: string | null; bytesDone: number | null; bytesTotal: number | null; receivedAt: number }

const GB = 1024 ** 3;
const gb = (n: number): string => (n / GB).toFixed(1);

export const stepLabel = (step: string | null, p: UpdateProgress | null, sourceEngine: string): string | null => {
  if (!step) return null;
  if (step === 'Fetch') {
    if (p?.bytesDone != null && p.bytesTotal) return `Copying from ${sourceEngine}: ${gb(p.bytesDone)} of ${gb(p.bytesTotal)} GB`;
    return `Copying from ${sourceEngine}`;
  }
  return STEP_LABEL[step as keyof typeof STEP_LABEL] ?? step;
};

/** The newest upgradeApp operation for this instance. */
export const latestUpdateOp = (store: Store | null, instanceId: string): Operation | null =>
  Object.values(store?.operationDB ?? {})
    .filter((op) => op.kind === OP_KIND && String(op.args?.instanceId) === instanceId)
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;

const stateOf = (op: Operation): string => {
  const raw = rawOf(op as unknown as Raw);
  return String(str(raw.state) ?? op.status).toLowerCase();
};

export const isUpdateRunning = (op: Operation | null): boolean => {
  if (!op) return false;
  const s = stateOf(op);
  return s === 'running' || s === 'pending';
};

export const currentStep = (op: Operation | null, p: UpdateProgress | null): string | null =>
  p?.step ?? str(rawOf(op as unknown as Raw).step) ?? op?.stepLabel ?? null;

export interface FetchPaused { reason: string; bytesDone: number | null; bytesTotal: number | null }
export const fetchPausedOf = (inst: Instance | undefined, op: Operation | null): FetchPaused | null => {
  const f = rawOf(rawOf(inst as unknown as Raw).fetchPaused ?? rawOf(op as unknown as Raw).fetchPaused);
  const reason = str(f.reason);
  return reason ? { reason, bytesDone: num(f.bytesDone), bytesTotal: num(f.bytesTotal) } : null;
};

export const pausedText = (p: FetchPaused, sourceEngine: string): string =>
  p.reason === 'temperature'
    ? `Paused while ${sourceEngine} cools down. The copy continues by itself.`
    : `The copy from ${sourceEngine} is paused. It continues by itself.`;

/** Confirmed by Axle: a failed rollback leaves the instance Stopped with this statusCondition prefix. */
export const ROLLBACK_FAILED_PREFIX = 'ROLLBACK FAILED:';
export const isRollbackFailed = (inst: Instance | undefined): boolean =>
  inst?.status === 'Stopped' && (inst.statusCondition ?? '').trim().startsWith(ROLLBACK_FAILED_PREFIX);

export type UpdateOutcome =
  | { kind: 'updated'; text: string }
  | { kind: 'rolledBack'; text: string }
  | { kind: 'stopped'; text: string }
  | { kind: 'failed'; text: string };

/** Final outcome of a finished update op (null while running or none). */
export const updateOutcome = (
  op: Operation | null,
  inst: Instance | undefined,
  app: string,
  fromVersion: string,
  ctx: RefusalCtx,
): UpdateOutcome | null => {
  if (!op || isUpdateRunning(op)) return null;
  const s = stateOf(op);
  const err = op.error ?? '';
  if (s === 'done') return { kind: 'updated', text: `Updated from ${fromVersion}` };
  if (isRollbackFailed(inst) || err.trim().startsWith(ROLLBACK_FAILED_PREFIX)) {
    return { kind: 'stopped', text: `${app} is stopped. Nothing was deleted. Ask for help.` };
  }
  if (s === 'rolledback' || /ROLLED BACK:/.test(err)) {
    return { kind: 'rolledBack', text: `The update didn't work, so ${app} is back on ${fromVersion} with all its data.` };
  }
  return { kind: 'failed', text: friendlyUpdateError(err, ctx) };
};

/** The version the instance came from, for "Updated from X" (previousAppId). */
export const previousVersionOf = (store: Store | null, inst: Instance | undefined): string | null => {
  const prev = str(rawOf(inst as unknown as Raw).previousAppId);
  return prev ? versionOf(store?.appDB, prev) : null;
};

// ── Ephemeral progress (separate from live.ts heartbeats) ──────────────────
export const PROGRESS_TYPE = 'idea/updateProgress';
const [progress, setProgress] = createSignal<Record<string, UpdateProgress>>({});
export { progress as updateProgress };

/** Pure: the next map after one ephemeral message (unchanged if not ours). */
export const applyUpdateProgress = (
  state: Record<string, UpdateProgress>, message: unknown, receivedAt: number,
): Record<string, UpdateProgress> => {
  const m = rawOf(message);
  if (m.type !== PROGRESS_TYPE) return state;
  const id = str(m.instanceId);
  if (!id) return state;
  return { ...state, [id]: { step: str(m.step), bytesDone: num(m.bytesDone), bytesTotal: num(m.bytesTotal), receivedAt } };
};

export const receiveUpdateProgress = (message: unknown, receivedAt: number = Date.now()): void => {
  const m = rawOf(message);
  if (m.type !== PROGRESS_TYPE) return;
  setProgress((s) => applyUpdateProgress(s, message, receivedAt));
};

// ── "Not now" (this browser only) ───────────────────────────────────────────
const DISMISS_KEY = 'idea.updateNotNow';
const readDismissed = (): Record<string, true> => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(DISMISS_KEY) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
};
const [dismissed, setDismissed] = createSignal<Record<string, true>>(readDismissed());
const dismissKey = (instanceId: string, toAppId: string): string => `${instanceId}>${toAppId}`;

export const isDismissed = (instanceId: string, toAppId: string): boolean => dismissed()[dismissKey(instanceId, toAppId)] === true;
export const dismissUpdate = (instanceId: string, toAppId: string): void => {
  const next = { ...dismissed(), [dismissKey(instanceId, toAppId)]: true as const };
  setDismissed(next);
  try { globalThis.localStorage?.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* private mode: in-memory only */ }
};
export const resetDismissed = (): void => { setDismissed({}); };
