/**
 * Erase helpers (files-disk.md §4 / §8, idea#136): eligibility, summary
 * parsing, timeouts. Pure over store snapshots; components wrap in signals.
 */
import { engineHasCapability, UPDATE_ENGINE_TOOLTIP } from './commands';
import { isDiskLocked } from './operations';
import { formatBytes } from './diskRoles';
import { traceArg } from './commandResult';
import type { CommandLogState } from './commandLog';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import type {
  ContentSummary,
  Disk,
  Engine,
  EraseStep,
  Store,
  UnformattedDisk,
} from '../types/store';

/** Summary older than this (Console clock) is refused; typed-name box is replaced. */
export const SUMMARY_MAX_AGE_MS = 10 * 60 * 1000;
/** No progress and no eraseDisk trace yet. */
export const ERASE_NO_RESPONSE_MS = 15_000;
/** Still running after this: show the slow warning, keep watching. */
export const ERASE_SLOW_MS = 5 * 60 * 1000;

export const ERASE_NO_RESPONSE_MESSAGE = "The Engine didn't respond.";
export const ERASE_SLOW_MESSAGE = "This is taking longer than expected. Don't unplug the disk.";
export const SUMMARY_STALE_MESSAGE = 'The summary is out of date. Check the disk again.';
export const DISK_REMOVED_MESSAGE = 'This disk was removed.';
export const ERASE_WARNING =
  'This erases everything on the disk. Apps, backups and files cannot be recovered.';

export const ERASE_STEPS: EraseStep[] = [
  'checking',
  'stopping and unmounting',
  'partitioning',
  'creating filesystem',
  'mounting',
];

/** Extra progress step only for the Files erase-first shortcut. */
export const MAKING_FILES_STEP = 'making a Files Disk';

/** True for a docked non-system Disk (Erase this disk…). */
export const canEraseDisk = (disk: Disk): boolean => {
  const types = disk.diskTypes ?? [];
  return disk.device !== null && !types.includes('system');
};

/**
 * Why Erase is greyed out, or null when it may be offered.
 * Same lock as eject (active ops on the disk); capability 'eraseDisk' fresh;
 * Engine already erasing something.
 */
export const eraseBlockedReason = (
  engine: Engine | null | undefined,
  store: Store | null,
  targetId: string
): string | undefined => {
  if (!engineHasCapability(engine, 'eraseDisk')) return UPDATE_ENGINE_TOOLTIP;
  if (engine?.eraseInProgress) {
    return `An erase of ${engine.eraseInProgress.label} is already in progress.`;
  }
  // Lock only applies to Disk targets that still have a store entry
  if (store?.diskDB[targetId] && isDiskLocked(store, targetId)) {
    return 'Operation in progress — cannot erase';
  }
  return undefined;
};

/** Unformatted disks for one Engine, keyed by candidateId (stable <For>). */
export const unformattedDiskIds = (engine: Engine | null | undefined): string[] =>
  (engine?.unformattedDisks ?? []).map((u) => u.candidateId);

export const findUnformatted = (
  store: Store | null,
  engineId: string,
  candidateId: string
): UnformattedDisk | undefined =>
  store?.engineDB[engineId]?.unformattedDisks?.find((u) => u.candidateId === candidateId);

const orderedTraces = (cls: CommandLogStore): CommandTrace[] => {
  const traces = cls.traces ?? {};
  const seen = new Set<string>();
  const out: CommandTrace[] = [];
  for (const id of cls.recentTraceIds ?? []) {
    const t = traces[id];
    if (t && !seen.has(id)) { seen.add(id); out.push(t); }
  }
  for (const [id, t] of Object.entries(traces)) {
    if (!seen.has(id)) out.push(t);
  }
  return out;
};

/** First new trace of `command` whose args.targetId (or args.diskId) matches. */
export const findTargetTrace = (
  cls: CommandLogState,
  baseline: Set<string>,
  command: string,
  targetId: string
): CommandTrace | null => {
  if (!cls || 'error' in cls) return null;
  return orderedTraces(cls).find((t) =>
    !baseline.has(t.traceId)
    && t.command === command
    && (traceArg(t, 'targetId') === targetId || traceArg(t, 'diskId') === targetId)
  ) ?? null;
};

/** Parse contentSummary from a summariseDisk trace's result, or null. */
export const parseContentSummary = (trace: CommandTrace | null | undefined): ContentSummary | null => {
  if (!trace?.result) return null;
  try {
    const raw = typeof trace.result === 'string' ? JSON.parse(trace.result) : trace.result;
    if (!raw || typeof raw !== 'object' || typeof (raw as ContentSummary).label !== 'string') return null;
    return raw as ContentSummary;
  } catch {
    return null;
  }
};

export const isSummaryStale = (summary: ContentSummary, now: number): boolean =>
  now - summary.computedAt > SUMMARY_MAX_AGE_MS;

/** Human size, or "unknown". */
export const sizeText = (n: number | null | undefined): string =>
  n == null ? 'unknown' : formatBytes(n);

/** "at least N" when partial. */
export const countText = (n: number, partial: boolean): string =>
  partial ? `at least ${n}` : String(n);

/** Disk republished after erase with the same ID and exactly ['empty']. */
export const isErasedEmptyDisk = (disk: Disk | undefined): boolean =>
  !!disk && (disk.diskTypes ?? []).length === 1 && disk.diskTypes![0] === 'empty';
