/**
 * Temporary pre-update backups on an Engine's own disk (console#230 option A).
 *
 * Reads the stored `Engine.tempBackups` field (Axle's Engine PR; the Engine
 * refreshes it after a create, a delete and at boot). Every accessor returns
 * `undefined` when the field is absent, so callers can tell an older Engine
 * (fall back to the updateApp op args, #242) from "no backups left".
 */
import type { Disk, Engine, Instance, Store, TempBackupEntry } from '../types/store';
import { backupDateText } from './restoreConfirm';

const isEntry = (v: unknown): v is TempBackupEntry => {
  const o = v as Partial<TempBackupEntry> | null;
  return !!o && typeof o === 'object' && typeof o.instanceId === 'string' && !!o.instanceId
    && typeof o.stamp === 'string' && !!o.stamp;
};

/** A stable key per backup, for `<For>` lists and confirm state. */
export const tempBackupKey = (b: Pick<TempBackupEntry, 'instanceId' | 'stamp'>): string => `${b.instanceId}:${b.stamp}`;

const GiB = 1024 ** 3;
/**
 * Sizes in this view use the same GB as the teacher leftover line (store/updateApp.ts,
 * 1024³ bytes), so the operator list and the teacher sentence show the same number.
 */
export const tempBackupBytesText = (bytes: number): string =>
  bytes <= 0 ? '0 GB' : bytes < GiB / 10 ? 'less than 0.1 GB' : `${(bytes / GiB).toFixed(1)} GB`;

/** Size in bytes, 0 when the Engine sent no usable number. */
export const tempBackupSize = (b: TempBackupEntry): number =>
  typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) && b.sizeBytes > 0 ? b.sizeBytes : 0;

/**
 * The Engine's leftover backups, newest first (stamps sort as text).
 * `undefined` when the Engine does not publish the field (older Engine).
 */
export const tempBackupsOf = (engine: Engine | null | undefined): TempBackupEntry[] | undefined => {
  const raw = engine?.tempBackups;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isEntry).sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
};

/** The Engine's leftover backups of one instance, newest first; `undefined` on an older Engine. */
export const tempBackupsForInstance = (engine: Engine | null | undefined, instanceId: string): TempBackupEntry[] | undefined =>
  tempBackupsOf(engine)?.filter((b) => b.instanceId === instanceId);

/** Bytes the leftover backups take on the Engine's own disk; `undefined` on an older Engine. */
export const tempBackupsTotalBytes = (engine: Engine | null | undefined): number | undefined =>
  tempBackupsOf(engine)?.reduce((sum, b) => sum + tempBackupSize(b), 0);

/** Only a finished backup can be removed from the Console (an unfinished one may still be written). */
export const canRemoveTempBackup = (b: TempBackupEntry): boolean => b.complete === true;

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z$/;

/** The stamp (`YYYYMMDDTHHMMSSZ` or `YYYYMMDDTHHMMSSMMMZ`, UTC) as epoch ms; null when it has another shape. */
export const stampTime = (stamp: string): number | null => {
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms ? Number(ms) : 0);
  return Number.isFinite(t) ? t : null;
};

/** When the backup was made, as shown to teachers ("an unknown date" when the stamp is unreadable). */
export const tempBackupWhen = (b: Pick<TempBackupEntry, 'stamp'>): string => backupDateText(stampTime(b.stamp));

/** The Engine's own (system) disk record, if the Engine publishes one with sizes. */
export const systemDiskOf = (store: Store | null, engineId: string): Disk | null =>
  Object.values(store?.diskDB ?? {}).find(
    (d) => d?.dockedTo === engineId && (d.diskTypes ?? []).includes('system'),
  ) ?? null;

/** App title for a backup row: the instance's App title, else its name, else the instanceId (orphans of a removed App). */
export const tempBackupAppTitle = (store: Store | null, instanceId: string): string => {
  const inst = store?.instanceDB?.[instanceId] as Instance | undefined;
  if (!inst) return instanceId;
  const app = store?.appDB?.[String(inst.instanceOf)] as { title?: unknown } | undefined;
  return (typeof app?.title === 'string' && app.title) || String(inst.name ?? instanceId);
};

/**
 * deleteTempBackup refusals (engine#501): `CODE: text`, nothing deleted.
 * Teacher-friendly sentences; the raw Engine text stays behind Technical details.
 */
export const DELETE_TEMP_BACKUP_REFUSAL_TEXT: Record<string, (app: string) => string> = {
  NOT_FOUND: () => 'This backup is no longer on this Pi.',
  IN_USE: () => 'This backup is being used by an update that is still running. Try again when the update has finished.',
  UPDATE_PENDING: (app) => `The last update of ${app} is not finished yet. Press Finish update to finish it first. Nothing changed.`,
  BAD_PATH: () => 'IDEA could not remove this backup. Ask for help.',
  HELPER_OUTDATED: () => 'This Pi needs an IDEA update before it can remove backups. Ask for help.',
  DELETE_FAILED: () => 'IDEA could not remove this backup. Ask for help.',
};

/** `CODE: text` only when the code is a known deleteTempBackup refusal at the start of the message. */
export const parseDeleteTempBackupRefusal = (message: string): { code: string | null; detail: string } => {
  const m = /^\s*([A-Z][A-Z_]+):\s*(.*)$/s.exec(String(message ?? '').trim());
  if (m && DELETE_TEMP_BACKUP_REFUSAL_TEXT[m[1]]) return { code: m[1], detail: m[2].trim() };
  return { code: null, detail: message };
};

/** Plain sentence for a deleteTempBackup refusal, or null when the message has no known code. */
export const deleteTempBackupRefusalText = (message: string, app: string, code?: string | null): string | null => {
  const parsed = parseDeleteTempBackupRefusal(message);
  const c = parsed.code ?? (code && DELETE_TEMP_BACKUP_REFUSAL_TEXT[code] ? code : null);
  return c ? DELETE_TEMP_BACKUP_REFUSAL_TEXT[c](app) : null;
};

/** Confirm text for "Remove backup" (operator view). */
export const removeTempBackupConfirmText = (app: string, when: string, sizeText: string): string =>
  `Remove the backup of ${app} made on ${when}? This frees ${sizeText} on this Pi's own disk. It can't be undone.`;
