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
 *             optional `fetchPaused: { reason: 'thermal', bytesDone, bytesTotal, since }` (engine PR #274)
 *             (the agreed design's richer fields — diskId, major, fromVersion,
 *             toVersion, estimatedMinutes, sourceEngineId, sizeBytes, migrationNote —
 *             are read too when present)
 *  - op       kind `updateApp` (engine#268), steps in STEPS (12, engine#456), legacy 6 in LEGACY_STEPS,
 *             states running/done/failed/rolledBack, failure text `ROLLED BACK: <why>` (confirmed);
 *             failed rollback: instance Stopped, statusCondition `ROLLBACK FAILED: …` (confirmed);
 *             `restartFailed?: true` (engine#442 / agent-engine-dev#445) when the update failed
 *             before a swap and the old version could not be restarted
 *  - engine#456 / engine#505 7c20fd0: optional Instance.updatePending; Resume is also
 *             signalled by updateAvailable with fromVersion == toVersion (appId = instanceOf).
 *             Finish update sends `updateApp <id> <current appId>` (Engine also accepts the
 *             bare version), with no --source and no --allow-major.
 *  - command-log trace result `{ restartFailed: true }` on that error (JSON on the trace)
 *  - progress ephemeral `{ type: 'idea/updateProgress', engineId, instanceId, step, bytesDone, bytesTotal, phaseNote? }`
 *  - refusals `CODE: text` in the trace error
 *  - engine#469 / agent-engine-dev#472: a due major backup with no linked Backup Disk docked is
 *             a temporary backup on the system disk inside the Snapshot stop (op stepLabel
 *             `Temporary pre-update backup on the system disk …`, op args `tempBackup`,
 *             `tempBackupStamp`, `tempBackupState`); refusals `TEMP_BACKUP_NO_SPACE`,
 *             `TEMP_BACKUP_FAILED`, and `HELPER_OUTDATED` naming the temporary backup
 *  - console#230: op args `tempBackupState` (`created | deleted | delete-failed | kept`,
 *             UpdateApp.ts setTempBackupOpArgs), `tempBackup` (path), `tempBackupWarning`
 *             (delete-failed only); trace result `tempBackup: { path, sizeBytes, deleted }`
 *  - console#230 option A: stored `Engine.tempBackups` (store/tempBackups.ts) is the source
 *             when present; the op args above are the fallback for older Engines
 */
import { createSignal } from 'solid-js';
import { engineHasCapability } from './commands';
import type { App, Engine, Instance, Operation, Store, TempBackupEntry } from '../types/store';
import { tempBackupSize, tempBackupsForInstance } from './tempBackups';
import { plainEngineText } from './plainError';
import { logJson } from './logText';

// ── Capabilities ────────────────────────────────────────────────────────────
export const CAP_UPDATE = 'updateApp' as const;
export const CAP_FETCH = 'updateAppFetch' as const;
/** engine#268: the op kind is `updateApp` (UpdateApp.ts createOperation), not `upgradeApp`. */
export const OP_KIND = 'updateApp' as const;
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
  /** engine#505: true for a Resume offer (current version; no --source / --allow-major). */
  resume?: boolean;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rawOf = (o: unknown): Raw => (o && typeof o === 'object' ? (o as Raw) : {});

/** Version of an app id: appDB first, else the part after the last '-'. */
export const versionOf = (appDB: Record<string, App> | undefined, appId: string): string =>
  appDB?.[appId]?.version ?? (appId.includes('-') ? appId.slice(appId.lastIndexOf('-') + 1) : appId);

/**
 * Mirror of Engine `isUnversioned` (agent-engine-dev src/data/Version.ts, idea#76): a git SHA,
 * a date, a leading component >= 1000 or no number at all is not a release and sorts as 0.0.
 */
export const isUnversioned = (raw: string | null | undefined): boolean => {
  const s = String(raw ?? '').trim();
  const m = /(\d+(?:\.\d+)*)/.exec(s);
  if (!m) return true;
  if (/(^|[^0-9])\d{4}[-._]\d{1,2}[-._]\d{1,2}([^0-9]|$)/.test(s)) return true;
  for (const tok of s.split(/[^0-9A-Za-z]+/)) {
    if (!tok) continue;
    if (/^g?[0-9a-f]{7,40}$/i.test(tok) && /[a-f]/i.test(tok.replace(/^g/i, ''))) return true;
    if (/^\d{7,}$/.test(tok)) return true;
  }
  return Number(m[1].split('.')[0]) >= 1000;
};

/** Numeric parts of a proper tag; null when unversioned. Mirror of Engine Version.ts. */
export const parseVersion = (raw: string | null | undefined): number[] | null => {
  if (isUnversioned(raw)) return null;
  const m = /(\d+(?:\.\d+)*)/.exec(String(raw ?? ''))!;
  return m[1].split('.').map((n) => Number(n));
};

/**
 * <0, 0, >0 like a comparator between two proper tags; null when either side is
 * unversioned (Engine `compareVersions`). Missing trailing parts count as 0, so
 * 1.0 equals 1.0.0, and 1.10 is newer than 1.9.
 */
export const compareVersions = (a: string, b: string): number | null => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * Whether `to` is newer than `from`. An unversioned `from` sorts as 0.0 (Engine
 * `isUpgrade`). Returns null when `to` (or a versioned `from`) can't be parsed:
 * the caller should keep showing the offer rather than hide it (idea#459).
 */
export const isNewerVersion = (from: string, to: string): boolean | null => {
  if (!parseVersion(to)) return null;
  const c = compareVersions(to, isUnversioned(from) ? '0.0' : from);
  return c === null ? null : c > 0;
};

/** Major part; an unversioned version counts as 0, so unversioned -> 1.x is major (as on the Engine). */
const majorOf = (v: string): string => (isUnversioned(v) ? '0' : (/(\d+)/.exec(v)?.[1] ?? v));

/** The engine an instance runs on (its disk's dockedTo). */
export const engineIdOfInstance = (store: Store | null, inst: Instance | undefined): string | null => {
  const d = inst?.storedOn ? store?.diskDB?.[String(inst.storedOn)] : undefined;
  return d?.dockedTo ? String(d.dockedTo) : null;
};

/**
 * engine#505 / #456: Resume is `Instance.updatePending`, or `updateAvailable` with
 * both `fromVersion` and `toVersion` present and equal (the Engine writes appId =
 * instanceOf). A same-appId offer that is not a Resume is still a stale leftover
 * (idea#459) and stays hidden.
 */
export const isResumeUpdate = (inst: Instance | undefined): boolean => {
  if (!inst) return false;
  if (inst.updatePending === true) return true;
  const u = rawOf((inst as unknown as Raw).updateAvailable);
  const from = str(u.fromVersion);
  const to = str(u.toVersion);
  return !!from && from === to;
};

/**
 * The update on offer for `inst`, or null (no field, no capability, a
 * cross-Engine source the Engine can't fetch, or a stale offer of the version
 * already running / an older one — optional Console guard, agent-engine-dev#337).
 */
export const updateOfferFor = (store: Store | null, inst: Instance | undefined, engine: Engine | undefined): UpdateOffer | null => {
  if (!inst || !canUpdate(engine)) return null;
  // engine#505: resume the committed update, not a newer offered bundle.
  if (isResumeUpdate(inst)) {
    const u = rawOf((inst as unknown as Raw).updateAvailable);
    const toAppId = str(u.appId) || String(inst.instanceOf);
    const version = str(u.fromVersion) || str(u.toVersion) || versionOf(store?.appDB, String(inst.instanceOf));
    return { toAppId, fromVersion: version, toVersion: version,
      major: false, sourceDiskId: null, sourceEngineId: null, estimatedMinutes: null,
      sizeBytes: null, migrationNote: null, resume: true };
  }
  const u = rawOf((inst as unknown as Raw).updateAvailable);
  const toAppId = str(u.appId);
  if (!toAppId) return null;
  // Same bundle id as the running instance: a stale dock-time offer left on
  // an older Engine after a successful update (idea#459).
  if (toAppId === String(inst.instanceOf)) return null;
  const runningVersion = versionOf(store?.appDB, String(inst.instanceOf));
  const fromVersion = str(u.fromVersion) ?? runningVersion;
  const toVersion = str(u.toVersion) ?? versionOf(store?.appDB, toAppId);
  // Hide only when we can tell the target isn't newer than what's running.
  // If a version can't be parsed, keep the offer (idea#459).
  if (isNewerVersion(runningVersion, toVersion) === false) return null;
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
export const buildUpdateAppCommand = (instanceId: string, offer: Pick<UpdateOffer, 'toAppId' | 'sourceDiskId' | 'major' | 'resume'>): string =>
  offer.resume
    ? [COMMAND, instanceId, offer.toAppId].join(' ')
    : [COMMAND, instanceId, offer.toAppId,
      ...(offer.sourceDiskId ? ['--source', offer.sourceDiskId] : []),
      ...(offer.major ? ['--allow-major'] : [])].join(' ');

// ── Text ────────────────────────────────────────────────────────────────────
/** "from X to Y", or just "Y" when the current version is a SHA/date nobody can read. */
const fromTo = (o: Pick<UpdateOffer, 'fromVersion' | 'toVersion'>): string =>
  isUnversioned(o.fromVersion) ? o.toVersion : `${o.fromVersion} to ${o.toVersion}`;

export const badgeText = (o: UpdateOffer, sourceEngine: string | null): string =>
  `Update available: ${fromTo(o)}` + (sourceEngine ? ` (from the disk in ${sourceEngine})` : '');

/**
 * Shown in the confirm for a major update. Since idea#448 / engine#469 the Engine makes the
 * required backup itself (to a linked Backup Disk, else temporarily on its own disk), so a
 * missing backup no longer blocks Update; `backupFirst` says it will be made first.
 */
export const majorConfirmText = (app: string, o: Pick<UpdateOffer, 'toVersion'>, backupFirst = false): string =>
  `${app} ${o.toVersion} is a major update.` + (backupFirst ? ` IDEA makes a backup of ${app} first, so it takes a little longer.` : '');

export const confirmText = (app: string, o: UpdateOffer, sourceEngine: string | null, backupFirst = false): string[] => {
  const lines = [
    isUnversioned(o.fromVersion) ? `Update ${app} to ${o.toVersion}?` : `Update ${app} from ${o.fromVersion} to ${o.toVersion}?`,
    ...(o.major ? [majorConfirmText(app, o, backupFirst)] : []),
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

/** Hint after an Engine without engine#469 refused NEEDS_BACKUP (the badge stays disabled). */
export const NEEDS_BACKUP_TEXT = 'Dock a Backup Disk and make a backup first';
/** Engine UpdateAppPolicy.BACKUP_MAX_AGE_MS: a major needs a backup under 1 h old. */
export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * Whether a major update needs a backup first, from `instance.lastBackup` (the field the Engine
 * checks). Not a gate any more (engine#469): it only adds "IDEA makes a backup first" to the
 * confirm. A backup-method-none instance (idea#403, `isBackupMethodNone`) needs none.
 */
export const majorNeedsBackup = (
  o: Pick<UpdateOffer, 'major'> | null,
  lastBackup: number | null | undefined,
  now: number,
  methodNone = false,
): boolean =>
  !!o?.major && !methodNone && (lastBackup == null || now - Number(lastBackup) > BACKUP_MAX_AGE_MS);

/** Version as shown to people: an unversioned (SHA/date) build reads "development build (5ab9f64)". */
export const versionLabel = (v: string | null | undefined): string =>
  !v ? '-' : isUnversioned(v) ? `development build (${v.length > 12 ? v.slice(0, 7) : v})` : v;
/** NO_SUMS wording (Steve, 2026-10-28). */
export const NO_SUMS_TEXT = "This disk's new version can't be checked, so the app wasn't updated. Your app still works as before. Ask for a fresh copy of this App Disk.";

/** engine#268 helper text: `snapshot needs X bytes (…), free Y bytes`. Null when it doesn't parse. */
export const parseNoSpace = (detail: string): { needBytes: number; freeBytes: number } | null => {
  const m = /needs\s+(\d+)\s+bytes\b.*?\bfree\s+(\d+)\s+bytes/s.exec(detail);
  return m ? { needBytes: Number(m[1]), freeBytes: Number(m[2]) } : null;
};
const gbText = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);

/** Backup Disk name from the Engine's `BACKUP_FAILED: the pre-update backup to <name> failed: …` (idea#448). */
export const backupDiskFromDetail = (detail: string): string | null =>
  /^the pre-update backup to (.+?) failed\b/s.exec(detail.trim())?.[1]?.trim() || null;

export interface RefusalCtx {
  app: string;
  fromVersion: string;
  /** The source Engine for a cross-Engine update, else this Engine. */
  engine: string;
  diskName: string | null;
  toVersion?: string | null;
  /** The Engine the App runs on (engine#469: its own disk holds the temporary backup). */
  hostEngine?: string | null;
}

/** engine#469 `TEMP_BACKUP_NO_SPACE` text: need (own + the snapshot on the same disk) and free bytes. */
export const parseTempBackupNoSpace = (detail: string): { needBytes: number; freeBytes: number } | null => {
  const base = parseNoSpace(detail);
  if (!base) return null;
  const plus = /\bplus\s+(\d+)\s+bytes for the snapshot\b/.exec(detail);
  return { needBytes: base.needBytes + (plus ? Number(plus[1]) : 0), freeBytes: base.freeBytes };
};

/** engine#469: `HELPER_OUTDATED` refused because of the temporary backup on the system disk. */
const isTempBackupDetail = (detail: string): boolean => /\btemporary pre-update backup\b/.test(detail);
const ownDisk = (c: RefusalCtx): string => `${c.hostEngine || 'this Engine'}'s own disk`;
const dockBackupDisk = (c: RefusalCtx): string => `Dock a Backup Disk for ${c.app}`;

const newVersion = (c: RefusalCtx): string => (c.toVersion ? ` ${c.toVersion}` : '');

/** engine#456: the stored instance flag survives archived operations; undefined is false. */
export const isUpdatePending = (inst: Instance | undefined): boolean => inst?.updatePending === true;
export const updatePendingText = (app: string): string =>
  `${app} is working, but its update is not finished yet. Press Finish update to finish it.`;
export const setupFailedText = (app: string): string =>
  `The new version of ${app} could not be set up, so IDEA put the old version back. Your data is safe.`;
export const settleFailedText = (app: string): string =>
  `${app} runs the new version, but the last part of the update failed. Press Finish update to try again, or ask for help.`;
export const updatePendingFirstText = (app: string): string =>
  `The last update of ${app} is not finished yet. Press Finish update to finish it first. Nothing changed.`;
export const updatePendingStartFirstText = (app: string): string =>
  `Start ${app} first, then press Finish update to finish the update. Nothing changed.`;
export const rollbackStartFailedText = (app: string): string =>
  `IDEA put back the old version of ${app} and its data, but it does not start. Ask for help.`;
export const stagesUnsupportedText = (app: string): string =>
  `This version of ${app} needs a newer IDEA before it can be installed. Nothing changed.`;
export const contractInvalidText = (app: string): string =>
  `This version of ${app} is not set up correctly for an update. Nothing changed. Ask for help.`;
export const updateInFlightStartText = (app: string, engineName?: string | null): string =>
  engineName
    ? `IDEA is still updating ${app} and cannot start it until ${engineName} recovers that update. Ask for help if it stays like this.`
    : `IDEA is still updating ${app} and cannot start it until that update is recovered. Ask for help if it stays like this.`;

/** engine#505: `UPDATE_IN_FLIGHT: … (operation <opId> [of Engine <engineId>]); …` */
const IN_FLIGHT_OP_RE = /\boperation (\([^)]+\)|[A-Za-z0-9._:-]+)/;
const IN_FLIGHT_ENGINE_RE = /\bof Engine ([^);]+)/;

export const updateInFlightOpId = (message: string): string | null => {
  const m = IN_FLIGHT_OP_RE.exec(message);
  if (!m || m[1].startsWith('(')) return null;
  return m[1];
};

/**
 * Hostname of the Engine that owns the in-flight update, from the op's
 * `engineId` in the store, else the Engine id in the refusal text. Null when
 * no hostname is known (the teacher sentence then uses the nameless fallback).
 */
export const updateInFlightEngineName = (store: Store | null, message: string): string | null => {
  if (!message.trim().startsWith('UPDATE_IN_FLIGHT:')) return null;
  const opId = updateInFlightOpId(message);
  const engineId = (opId && store?.operationDB?.[opId]?.engineId) || IN_FLIGHT_ENGINE_RE.exec(message)?.[1]?.trim() || null;
  const host = engineId ? store?.engineDB?.[engineId]?.hostname : null;
  return typeof host === 'string' && host.trim() ? host.trim() : null;
};

export const REFUSAL_TEXT: Record<string, (c: RefusalCtx, detail: string) => string> = {
  PREPARE_FAILED: (c) => setupFailedText(c.app),
  VERIFY_FAILED: (c) => setupFailedText(c.app),
  MIGRATIONS_PENDING: (c) => updatePendingText(c.app),
  SETTLE_FAILED: (c) => settleFailedText(c.app),
  ROLLBACK_START_FAILED: (c) => rollbackStartFailedText(c.app),
  // engine#456 / #505: another target was sent while an update is still pending (only Resume is accepted).
  // The Engine also uses this code when Resume is sent while the App is not Running or Starting.
  UPDATE_PENDING: (c, detail) => /\bstart it\b/.test(detail) ? updatePendingStartFirstText(c.app) : updatePendingFirstText(c.app),
  UPDATE_STAGES_UNSUPPORTED: (c) => stagesUnsupportedText(c.app),
  UPDATE_CONTRACT_INVALID: (c) => contractInvalidText(c.app),
  NOT_DOCKED: (c) => `The disk with ${c.app} is not in this Engine. Nothing changed.`,
  BUSY: (c) => `Something else is running on ${c.app}. Try again when it is done.`,
  SOURCE_MISSING: (c) => `The disk with the new version is no longer in ${c.engine}. Nothing changed.`,
  DIFFERENT_APP: () => 'That disk has a different app, not a new version of this one. Nothing changed.',
  NOT_NEWER: (c) => `${c.app} is already on this version or newer. Nothing changed.`,
  // Generic on purpose (Axle): also returned for an App whose x-app.updatesFrom doesn't list the current major.
  MAJOR_NOT_ALLOWED: (c) => `This version of ${c.app} can't be installed over the one you have. Nothing changed.`,
  NEEDS_BACKUP: (c) => `Make a backup of ${c.app} before updating to${newVersion(c) || ' the new version'}. ${NEEDS_BACKUP_TEXT}. Your current version keeps working.`,
  NO_SPACE: (c, detail) => {
    const space = parseNoSpace(detail);
    const disk = c.diskName ?? 'The disk';
    if (space) return `${disk} is too full: the safety copy needs ${gbText(space.needBytes)} GB and only ${gbText(space.freeBytes)} GB is free. Make room and try again. Nothing changed.`;
    return `${c.diskName ?? (detail || 'The disk')} is full. Make room and try again. Nothing changed.`;
  },
  // Confirmed from engine#268
  NOT_FOUND: () => 'This app is no longer on this Engine. Nothing changed.',
  AMBIGUOUS: () => "IDEA couldn't tell which copy of this app to update. Nothing changed. Ask for help.",
  HELPER_OUTDATED: (c, detail) => (isTempBackupDetail(detail)
    ? `${c.hostEngine || 'This Engine'} needs a system update before it can back up ${c.app} on its own disk, so ${c.app} wasn't updated. Nothing changed. ${dockBackupDisk(c)} and try again, or ask for help.`
    : 'This Engine needs a system update before Apps can be updated. Nothing changed.'),
  NO_SUMS: () => NO_SUMS_TEXT,
  TRANSFER_FAILED: (c) => `The copy from ${c.engine} didn't finish, so nothing changed. ${c.app} is still on ${c.fromVersion}. Try again while ${c.engine} is switched on.`,
  SOURCE_UNSUPPORTED: (c) => `${c.engine} needs a newer IDEA version before it can share this update. Nothing changed.`,
  // idea#448 pre-update backup (console#213). HOOK_FAILED runs before anything is stopped.
  HOOK_FAILED: (c) => `${c.app} couldn't prepare its backup, so it wasn't updated. Nothing was stopped or changed: ${c.app} works as before. Try again later. If it happens again, ask for help.`,
  // BACKUP_FAILED may come inside the snapshot stop: the old version is started again, version and data unchanged.
  BACKUP_FAILED: (c, detail) => {
    const disk = backupDiskFromDetail(detail) ?? 'the Backup Disk';
    return `The backup to ${disk} didn't finish, so ${c.app} wasn't updated. Nothing changed: ${c.app} keeps its current version and all its data. Check that ${disk} is plugged in and has free space, then try again.`;
  },
  // engine#469: the temporary backup on the system disk (no Backup Disk linked). Refused at Check
  // before anything stops, or inside the Snapshot stop (the old version is started again).
  TEMP_BACKUP_NO_SPACE: (c, detail) => {
    const space = parseTempBackupNoSpace(detail);
    const amounts = space ? `: it needs ${gbText(space.needBytes)} GB and only ${gbText(space.freeBytes)} GB is free` : '';
    return `There isn't enough free space on ${ownDisk(c)} for the backup IDEA makes before this update${amounts}. Nothing changed: ${c.app} works as before. ${dockBackupDisk(c)}, or make room on ${c.hostEngine || 'this Engine'}, then try again.`;
  },
  TEMP_BACKUP_FAILED: (c) =>
    `IDEA couldn't make a backup of ${c.app} on ${ownDisk(c)}, so ${c.app} wasn't updated. Nothing changed: ${c.app} keeps its current version and all its data. ${dockBackupDisk(c)} and try again, or ask for help.`,
};

/** engine#469: the refusal is about the temporary pre-update backup on the system disk. */
export const isTempBackupRefusal = (message: string): boolean => {
  const { code, detail } = parseRefusal(message);
  return code === 'TEMP_BACKUP_NO_SPACE' || code === 'TEMP_BACKUP_FAILED' || (code === 'HELPER_OUTDATED' && isTempBackupDetail(detail));
};

/** engine#456: these codes are only codes at the start (`CODE: detail`), not in a path/log. */
const UPDATE_456_CODES = ['PREPARE_FAILED', 'VERIFY_FAILED', 'MIGRATIONS_PENDING', 'SETTLE_FAILED', 'ROLLBACK_START_FAILED', 'UPDATE_PENDING', 'UPDATE_STAGES_UNSUPPORTED', 'UPDATE_CONTRACT_INVALID', 'UPDATE_IN_FLIGHT'];
export const isUpdate456Error = (message: string): boolean =>
  UPDATE_456_CODES.some((code) => message.trim().startsWith(`${code}:`));

/** `CODE: text` → [code, text]; code is null when the message has no known code. */
export const parseRefusal = (message: string): { code: string | null; detail: string } => {
  const m = /\b([A-Z][A-Z_]+)\b:?\s*(.*)$/s.exec(message.trim());
  if (m && UPDATE_456_CODES.includes(m[1]) && !message.trim().startsWith(`${m[1]}:`)) return { code: null, detail: message };
  if (m && REFUSAL_TEXT[m[1]]) return { code: m[1], detail: m[2].trim() };
  return { code: null, detail: message };
};

/**
 * engine#442 / agent-engine-dev#445: the update never swapped, and the old
 * version could not be restarted. The App is stopped; do not say "Nothing changed".
 * Steve and Marco agreed this wording (App display name filled in).
 */
export const restartFailedText = (app: string): string =>
  `The update didn't start, and ${app} couldn't be started again, so it is stopped. Its version and data are unchanged. Start ${app} again, or ask for help if it doesn't start.`;

/** True only for the Engine's `restartFailed: true` (absent or false is ignored). */
export const isRestartFailed = (value: unknown): boolean => value === true;

/** Operation.restartFailed from the store (engine#442 / #445). */
export const restartFailedFromOp = (op: Operation | null | undefined): boolean =>
  isRestartFailed(op?.restartFailed);

/**
 * Command-log trace result (engine#442 / #445): the Engine writes
 * `error.traceResult = { restartFailed: true }` as JSON on the error trace.
 */
export const restartFailedFromTraceResult = (result: unknown): boolean => {
  try {
    const raw = logJson(result);
    return isRestartFailed((raw as { restartFailed?: unknown } | null | undefined)?.restartFailed);
  } catch {
    return false;
  }
};

export const friendlyUpdateError = (message: string, ctx: RefusalCtx, opts?: { restartFailed?: boolean }): string => {
  // Check the flag first, before the REFUSAL_TEXT lookup: it overrides every code.
  if (opts?.restartFailed) return restartFailedText(ctx.app);
  const { code, detail } = parseRefusal(message);
  return code ? REFUSAL_TEXT[code](ctx, detail) : plainEngineText(message);
};

// ── Operation / progress ────────────────────────────────────────────────────
export type UpdateStep = 'Fetch' | 'Check' | 'Backup' | 'Snapshot' | 'Swap' | 'LoadImages' | 'Prepare' | 'Start' | 'Health' | 'Verify' | 'Work' | 'Settle';
/** Final engine#456 contract; skipped steps are never entered. */
export const STEPS: UpdateStep[] = ['Fetch', 'Check', 'Backup', 'Snapshot', 'Swap', 'LoadImages', 'Prepare', 'Start', 'Health', 'Verify', 'Work', 'Settle'];
/** Older Engine index mapping. Never apply a 12-step index to a six-step Engine. */
export const LEGACY_STEPS: UpdateStep[] = ['Fetch', 'Check', 'Snapshot', 'Swap', 'Start', 'Health'];
export const BACKUP_STEP = 'Backup' as const;
export const BACKUP_STEP_TEXT = 'Making a backup first';
const STEP_LABEL: Record<Exclude<UpdateStep, 'Fetch'>, string> = {
  Check: 'Checking',
  Backup: BACKUP_STEP_TEXT,
  Snapshot: 'Saving a safety copy',
  Swap: 'Installing',
  LoadImages: 'Loading the new version',
  Prepare: 'Preparing the new version',
  Start: 'Starting',
  Health: 'Checking it works',
  Verify: 'Checking the new version',
  Work: 'Finishing the update',
  Settle: 'Finishing the update',
};

/** engine#469 backup stepLabel text, retained by engine#456 instead of the name Backup. */
const BACKUP_STEP_RE = /^(?:Temporary pre-update backup|Pre-update backup)\b/;
const stepName = (value: string | null | undefined): UpdateStep | null =>
  value === BACKUP_STEP || BACKUP_STEP_RE.test(value ?? '') ? BACKUP_STEP
    : STEPS.includes(value as UpdateStep) ? value as UpdateStep : null;

export interface UpdateProgress { step: string | null; bytesDone: number | null; bytesTotal: number | null; fetchPaused?: FetchPaused | null; phaseNote?: string | null; receivedAt: number }

const GB = 1024 ** 3;
const gb = (n: number): string => (n / GB).toFixed(1);

export const stepLabel = (step: string | null, p: UpdateProgress | null, sourceEngine: string): string | null => {
  if (!step) return null;
  if (step === 'Fetch') {
    if (p?.bytesDone != null && p.bytesTotal) return `Copying from ${sourceEngine}: ${gb(p.bytesDone)} of ${gb(p.bytesTotal)} GB`;
    return `Copying from ${sourceEngine}`;
  }
  if (step === BACKUP_STEP) return BACKUP_STEP_TEXT;
  return STEP_LABEL[step as keyof typeof STEP_LABEL] ?? step;
};

/**
 * Teacher sentence for a running hook step that reported a phaseNote. The raw
 * `ERROR:` / `not yet:` note stays behind Technical details (operators only).
 */
export const PHASE_NOTE_STEP_TEXT = "Finishing the app's own setup steps";
export const phaseNoteStepText = (step: string | null): string => {
  if (step === 'Prepare') return 'Preparing the new version';
  if (step === 'Verify') return 'Checking the new version';
  return PHASE_NOTE_STEP_TEXT;
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

/**
 * Named steps first (including the engine#469 Backup prose); indices only for a
 * known total: 12 for engine#456, or the old six-step list. No guessed mapping for
 * an unknown Engine (then the raw stepLabel, as before). A live Check/Snapshot
 * does not hide the more specific backup stepLabel of a running op.
 */
export const currentStep = (op: Operation | null, p: UpdateProgress | null): string | null => {
  const live = stepName(p?.step ?? str(rawOf(op as unknown as Raw).step));
  const label = stepName(op?.stepLabel);
  if (isUpdateRunning(op) && label === BACKUP_STEP && (!live || live === 'Check' || live === 'Snapshot' || live === BACKUP_STEP)) return BACKUP_STEP;
  if (live) return live;
  if (label && label !== BACKUP_STEP) return label;
  const steps = op?.totalSteps === STEPS.length ? STEPS : op?.totalSteps === LEGACY_STEPS.length ? LEGACY_STEPS : null;
  const i = op?.currentStep;
  const byIndex = steps && typeof i === 'number' && Number.isInteger(i) ? steps[i] ?? null : null;
  return byIndex ?? (label ? null : op?.stepLabel ?? null);
};

export interface FetchPaused { reason: string; bytesDone: number | null; bytesTotal: number | null; since: number | null }
const pausedFrom = (f: Raw): FetchPaused | null => {
  const reason = str(f.reason);
  return reason ? { reason, bytesDone: num(f.bytesDone), bytesTotal: num(f.bytesTotal), since: num(f.since) } : null;
};
/**
 * Engine PR #274: fetchPaused rides on the latest idea/updateProgress message
 * (a later message without it means the copy resumed). Instance/op fields are
 * kept as a fallback.
 */
export const fetchPausedOf = (inst: Instance | undefined, op: Operation | null): FetchPaused | null => {
  const live = inst ? progress()[inst.id] : undefined;
  if (live) return live.fetchPaused ?? null;
  return pausedFrom(rawOf(rawOf(inst as unknown as Raw).fetchPaused ?? rawOf(op as unknown as Raw).fetchPaused));
};

export const pausedText = (p: FetchPaused, sourceEngine: string): string =>
  p.reason === 'thermal' || p.reason === 'temperature'
    ? `Paused while ${sourceEngine} cools down. The copy continues by itself.`
    : `The copy from ${sourceEngine} is paused. It continues by itself.`;

/** Confirmed by Axle: a failed rollback leaves the instance Stopped with this statusCondition prefix. */
export const ROLLBACK_FAILED_PREFIX = 'ROLLBACK FAILED:';
/** engine#456: old data/version restored but the old App could not start. */
export const ROLLBACK_START_FAILED_PREFIX = 'ROLLBACK START FAILED:';
export const isRollbackStartFailed = (inst: Instance | undefined): boolean =>
  inst?.status === 'Stopped' && (inst.statusCondition ?? '').trim().startsWith(ROLLBACK_START_FAILED_PREFIX);
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
  const err = stripTempBackupKept(op.error ?? '');
  if (isRollbackStartFailed(inst) || err.trim().replace(/^INTERRUPTED:\s*/, '').startsWith(ROLLBACK_START_FAILED_PREFIX)) {
    return { kind: 'stopped', text: rollbackStartFailedText(app) };
  }
  // These errors already say exactly what happened, before the generic rolled-back case.
  if (isUpdate456Error(err)) return { kind: parseRefusal(err).code === 'ROLLBACK_START_FAILED' ? 'stopped' : 'failed', text: friendlyUpdateError(err, ctx) };
  if (s === 'done') return { kind: 'updated', text: `Updated from ${fromVersion}` };
  // engine#442: whatever the error code (including ROLLED_BACK), say the App is stopped.
  if (restartFailedFromOp(op)) return { kind: 'failed', text: restartFailedText(app) };
  if (isRollbackFailed(inst) || err.trim().replace(/^INTERRUPTED:\s*/, '').startsWith(ROLLBACK_FAILED_PREFIX)) {
    return { kind: 'stopped', text: `${app} is stopped. Nothing was deleted. Ask for help.` };
  }
  if (s === 'rolledback' || /ROLLED BACK:/.test(err)) {
    return { kind: 'rolledBack', text: `The update didn't work, so ${app} is back on ${fromVersion} with all its data.` };
  }
  return { kind: 'failed', text: friendlyUpdateError(err, ctx) };
};

// ── Leftover temporary pre-update backup (console#230) ──────────────────────
/** engine#469: a failed update's error ends with this clause naming the backup's path. */
const TEMP_BACKUP_KEPT_RE = /;\s*the temporary pre-update backup is kept at .*$/s;
/** The error without the kept-backup clause (the leftover line says it, without the path). */
export const stripTempBackupKept = (error: string): string => error.replace(TEMP_BACKUP_KEPT_RE, '');

export type LeftoverTempBackupState = 'delete-failed' | 'kept';
export interface LeftoverTempBackup {
  state: LeftoverTempBackupState;
  /** Raw path on the Engine's system disk (Technical details only). */
  path: string | null;
  sizeBytes: number | null;
  /** The Engine's own warning (`args.tempBackupWarning`), delete-failed only. */
  warning: string | null;
  /** From Engine.tempBackups only: how many backups of this instance are left (default 1). */
  count?: number;
  /** From Engine.tempBackups only: every leftover path, newest first (Technical details only). */
  paths?: string[];
}

/**
 * The temporary pre-update backup still on the Engine's system disk after a finished
 * updateApp op (engine#469 / agent-engine-dev#472): `delete-failed` after a Done update,
 * or `kept` after a failed one. Null for `created`, `deleted`, no state, or a running op.
 * The size comes from the matching ok trace result (`tempBackup.sizeBytes`); the op
 * args have no size.
 */
export const leftoverTempBackupOf = (op: Operation | null | undefined, traceResult?: unknown): LeftoverTempBackup | null => {
  if (!op || op.kind !== OP_KIND || isUpdateRunning(op)) return null;
  const args = rawOf(op.args);
  const state = str(args.tempBackupState);
  const done = stateOf(op) === 'done';
  if (!(state === 'delete-failed' && done) && !(state === 'kept' && !done)) return null;
  const path = str(args.tempBackup);
  let sizeBytes: number | null = null;
  if (state === 'delete-failed') {
    try {
      const tb = rawOf(rawOf(logJson(traceResult)).tempBackup);
      const size = num(tb.sizeBytes);
      if (size != null && size > 0 && tb.deleted !== true && (!path || str(tb.path) === path)) sizeBytes = size;
    } catch {
      sizeBytes = null;
    }
  }
  return { state, path, sizeBytes, warning: state === 'delete-failed' ? str(args.tempBackupWarning) : null };
};

/**
 * console#230 option A: the leftover line from the stored `Engine.tempBackups` entries of
 * one instance (newest first). The newest finished updateApp op only says whether the
 * newest backup was kept on purpose (Failed op, `tempBackupState` kept, same stamp) and
 * adds the Engine's warning; the size is the sum of the entries. Null when none are left
 * or while an update runs (its own backup is in the list then).
 */
export const leftoverFromTempBackups = (entries: readonly TempBackupEntry[], op: Operation | null | undefined): LeftoverTempBackup | null => {
  if (entries.length === 0) return null;
  if (op && isUpdateRunning(op)) return null;
  const newest = entries[0];
  const args = op && op.kind === OP_KIND ? rawOf(op.args) : {};
  const same = str(args.tempBackupStamp) === newest.stamp || (!!newest.path && str(args.tempBackup) === newest.path);
  const kept = !!op && same && str(args.tempBackupState) === 'kept' && stateOf(op) !== 'done';
  const total = entries.reduce((sum, b) => sum + tempBackupSize(b), 0);
  return {
    state: kept ? 'kept' : 'delete-failed',
    path: newest.path || null,
    sizeBytes: total > 0 ? total : null,
    warning: !kept && same ? str(args.tempBackupWarning) : null,
    count: entries.length,
    paths: entries.map((b) => b.path).filter((p) => !!p),
  };
};

/**
 * The leftover line for one instance: from `Engine.tempBackups` when the Engine publishes
 * it, else (older Engine, field undefined) from the newest updateApp op's args (#242).
 */
export const leftoverTempBackupFor = (
  engine: Engine | null | undefined,
  instanceId: string,
  op: Operation | null | undefined,
  traceResult?: unknown,
): LeftoverTempBackup | null => {
  const entries = tempBackupsForInstance(engine, instanceId);
  if (entries === undefined) return op ? leftoverTempBackupOf(op, traceResult) : null;
  return leftoverFromTempBackups(entries, op);
};

const aboutGb = (bytes: number): string => (bytes < GB / 10 ? 'less than 0.1 GB' : `about ${gb(bytes)} GB`);

/**
 * console#230 teacher sentence for a leftover backup (no path, no Engine words).
 * `engine` is the Engine's hostname, else "this Engine".
 */
export const leftoverTempBackupText = (lb: LeftoverTempBackup, app: string, engine: string | null): string => {
  const where = `${engine || 'this Engine'}'s own disk`;
  if (lb.state === 'kept') {
    return `IDEA kept the backup it made before the update on ${where}, in case ${app || UNKNOWN_APP_NAME} needs it. Ask for help before removing it.`;
  }
  if ((lb.count ?? 1) > 1) {
    const sizes = lb.sizeBytes != null ? `take ${aboutGb(lb.sizeBytes)}` : 'take up space';
    return `Backups made before updates are still on ${where} and ${sizes}. Ask for help to remove them when you no longer need them.`;
  }
  const size = lb.sizeBytes != null ? `takes ${aboutGb(lb.sizeBytes)}` : 'takes up space';
  return `A backup made before the update is still on ${where} and ${size}. Ask for help to remove it when you no longer need it.`;
};

/** Raw text behind Technical details: the Engine's warning, else the path(s). */
export const leftoverTempBackupRaw = (lb: LeftoverTempBackup): string => {
  if (lb.warning) return lb.warning;
  const paths = lb.paths && lb.paths.length > 0 ? lb.paths : lb.path ? [lb.path] : [];
  return paths.map((p) => `temporary pre-update backup kept at ${p}`).join('\n');
};

/** App display name for the agreed sentences: the App title, else the instance name. */
export const appTitleOf = (store: Store | null, inst: Instance | undefined): string => {
  if (!inst) return '';
  const title = str(rawOf(store?.appDB?.[String(inst.instanceOf)]).title);
  return title ?? String(inst.name ?? inst.id ?? '');
};

/**
 * console#227: the instance is still stopped after an update whose restart
 * failed (engine#442 / #445; forced on test Pis by engine#467). Read from Engine
 * state only, so it survives a page reload and shows in every Console:
 * the instance is in Error, and its newest updateApp op is finished and
 * restartFailed (Operation.restartFailed, or `{ restartFailed: true }` on the
 * matching command-log trace when given). Null once the instance runs again,
 * once a newer updateApp op exists without the flag, or once a later start
 * attempt (Instance.lastStarted after the op) has happened.
 */
export const restartFailedOpFor = (
  store: Store | null,
  inst: Instance | undefined,
  traceResult?: unknown,
): Operation | null => {
  if (!inst || inst.status !== 'Error') return null;
  const op = latestUpdateOp(store, String(inst.id));
  if (!op || isUpdateRunning(op)) return null;
  if (!restartFailedFromOp(op) && !restartFailedFromTraceResult(traceResult)) return null;
  const since = op.completedAt ?? op.startedAt;
  if (typeof inst.lastStarted === 'number' && typeof since === 'number' && inst.lastStarted > since) return null;
  return op;
};

/** Fallback App name when neither the instance nor its App is known. */
export const UNKNOWN_APP_NAME = 'the app';

const appNameForOp = (op: Operation, store: Store | null): string => {
  const inst = store?.instanceDB?.[String(op.args?.instanceId ?? '')];
  return appTitleOf(store, inst) || str(op.args?.instanceName) || UNKNOWN_APP_NAME;
};

/** Rolled-back updateApp error: `ROLLED BACK:` prefix, or a leading PREPARE_FAILED / VERIFY_FAILED. */
export const isRolledBackUpdateError = (error: string): boolean => {
  const err = error.trim().replace(/^INTERRUPTED:\s*/, '');
  return /ROLLED BACK:/.test(err) || /^(PREPARE_FAILED|VERIFY_FAILED):/.test(err);
};

/**
 * Plain card line for a Failed updateApp op whose restart failed (console#227):
 * the agreed sentence instead of the raw `ROLLED BACK: …` error. Null for any
 * other op, which keeps its existing text.
 */
export const updateOpRestartFailedText = (op: Operation, store: Store | null): string | null => {
  if (op.kind !== OP_KIND || !restartFailedFromOp(op)) return null;
  return restartFailedText(appNameForOp(op, store));
};

/**
 * Plain Failed-card line: restartFailed, rolled-back, and engine#456 updateApp
 * ops get the agreed sentence; any other error that names a leftover backup
 * path is shown without that path (stripTempBackupKept). Null keeps the card's
 * existing text. The raw Engine error stays behind Technical details in
 * OperationProgress.
 *
 * SETTLE_FAILED and MIGRATIONS_PENDING leave the instance Running, so they use
 * their own sentences and are not shown as "put the old version back".
 */
export const updateOpFailedPlainText = (op: Operation, store: Store | null): string | null => {
  const restart = updateOpRestartFailedText(op, store);
  if (restart) return restart;
  const error = op.error ?? '';
  if (op.kind === OP_KIND) {
    const app = appNameForOp(op, store);
    const err = error.trim().replace(/^INTERRUPTED:\s*/, '');
    // Named 456 codes first, including those that are not a rollback.
    if (isUpdate456Error(error) || isUpdate456Error(err)) {
      return friendlyUpdateError(isUpdate456Error(error) ? error : err, { app, fromVersion: '', engine: '', diskName: null });
    }
    if (isRolledBackUpdateError(error)) return setupFailedText(app);
    if (err.startsWith(ROLLBACK_START_FAILED_PREFIX)) return rollbackStartFailedText(app);
  }
  const stripped = stripTempBackupKept(error);
  if (stripped !== error) return plainEngineText(stripped);
  return null;
};

/** Same Failed-card mapping (engine#456 tests use this name). */
export const updateOpErrorText = (op: Operation, store: Store | null): string | null =>
  updateOpFailedPlainText(op, store);

/** Update badge title while the App is stopped after a failed restart (console#227). */
export const restartFailedBadgeTitle = (app: string): string =>
  `${app} is stopped. Start ${app} again first, or ask for help if it doesn't start.`;

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
  return { ...state, [id]: { step: str(m.step), bytesDone: num(m.bytesDone), bytesTotal: num(m.bytesTotal), fetchPaused: pausedFrom(rawOf(m.fetchPaused)), phaseNote: str(m.phaseNote), receivedAt } };
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

/** startInstance refusal while an in-flight update marker is on the App Disk (engine#505). */
export const startInstanceErrorText = (message: string, app: string, engineName?: string | null): string =>
  message.trim().startsWith('UPDATE_IN_FLIGHT:') ? updateInFlightStartText(app, engineName) : message;
