/**
 * backup_schedule — set scheduled mode and a daily time on a Backup Disk
 * (BackupModeControls / setBackupMode), then assert the console#212 status line.
 * Does not wait for the daily slot. Fails clearly if the Engine lacks
 * scheduledBackups (controls are hidden).
 */
import type { IntentFn } from './types';
import { sel } from './selectors';
import { ensureBackupDiskPanel } from './backupDisk';

/** Keep in lockstep with src/store/backupStatus.ts (console#212). */
export const DEFAULT_BACKUP_TIME = '02:30';
export const FIRST_BACKUP_SHORTLY_COPY = 'First backup will start shortly.';
export const MISSED_BACKUP_SHORTLY_COPY = 'A missed backup will start shortly.';

export const BACKUP_SCHEDULE_TIME_ENV = 'DURATION_BACKUP_SCHEDULE_TIME';
export const MISSING_SCHEDULE_CONTROLS =
  'the docked Engine does not advertise scheduledBackups, or this disk has no backupConfig';

const ALT_BACKUP_TIME = '03:30';

const NEXT_RUN_CLAUSE = /^Next run (?:today|tomorrow) at \d{2}:\d{2}\.$/;

/** True when text is a #212 scheduled-status line (catch-up, first-run, or next-run). */
export function isScheduledBackupStatusLine(text: string): boolean {
  const trimmed = text.trim();
  const m = trimmed.match(/^Scheduled daily at (\d{2}:\d{2})\.(?: (.+))?$/);
  if (!m) return false;
  const clause = m[2];
  if (!clause) return true;
  if (clause === FIRST_BACKUP_SHORTLY_COPY) return true;
  if (clause === MISSED_BACKUP_SHORTLY_COPY) return true;
  return NEXT_RUN_CLAUSE.test(clause);
}

export function missingScheduledBackupsMessage(intent = 'backup_schedule'): string {
  return (
    `idea#168 ${intent}: [data-testid="backup-mode-controls"] is not visible — ` +
    `${MISSING_SCHEDULE_CONTROLS}. No soft-pass.`
  );
}

export function resolveBackupScheduleTime(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[BACKUP_SCHEDULE_TIME_ENV]?.trim();
  if (raw && /^\d{2}:\d{2}$/.test(raw)) return raw;
  return DEFAULT_BACKUP_TIME;
}

export const backup_schedule: IntentFn = async ({ page, diskId }) => {
  const intent = 'backup_schedule';
  await ensureBackupDiskPanel(page, { diskId }, intent);

  const controls = page.locator(sel.backupModeControls);
  if (!(await controls.isVisible().catch(() => false))) {
    try {
      await controls.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      /* fall through to the clear missing-capability error */
    }
  }
  if (!(await controls.isVisible().catch(() => false))) {
    throw new Error(missingScheduledBackupsMessage(intent));
  }

  const scheduled = page.locator(sel.backupMode('scheduled'));
  await scheduled.waitFor({ state: 'visible', timeout: 10_000 });
  await scheduled.click();

  const timeInput = page.locator(sel.backupModeTime);
  await timeInput.waitFor({ state: 'visible', timeout: 10_000 });
  let time = resolveBackupScheduleTime();
  const current = ((await timeInput.inputValue().catch(() => '')) ?? '').trim();
  const save = page.locator(sel.backupModeSave);
  if (current === time && (await save.isDisabled().catch(() => true))) {
    time = time === ALT_BACKUP_TIME ? DEFAULT_BACKUP_TIME : ALT_BACKUP_TIME;
  }
  await timeInput.fill(time);

  const timeErr = page.locator(sel.backupModeTimeError);
  if (await timeErr.isVisible().catch(() => false)) {
    const msg = ((await timeErr.textContent()) ?? '').trim();
    throw new Error(
      `idea#168 ${intent}: daily time "${time}" was rejected — "${msg}". No soft-pass.`,
    );
  }

  if (await save.isDisabled().catch(() => true)) {
    throw new Error(
      `idea#168 ${intent}: Save backup settings stayed disabled after setting scheduled ${time}. ` +
        `No soft-pass.`,
    );
  }
  await save.click();

  const deadline = Date.now() + 90_000;
  const success = page.locator(sel.backupModeSuccess);
  const err = page.locator(sel.backupModeError);
  const timeout = page.locator(sel.backupModeTimeout);
  while (Date.now() < deadline) {
    if (await err.isVisible().catch(() => false)) {
      const msg = ((await err.textContent()) ?? '').trim();
      throw new Error(`idea#168 ${intent}: setBackupMode failed — "${msg}". No soft-pass.`);
    }
    if (await timeout.isVisible().catch(() => false)) {
      const msg = ((await timeout.textContent()) ?? '').trim();
      throw new Error(`idea#168 ${intent}: setBackupMode timed out — "${msg}". No soft-pass.`);
    }
    if (await success.isVisible().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (!(await success.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 ${intent}: setBackupMode did not finish within 90s after Save. No soft-pass.`,
    );
  }

  const line = page.locator(sel.restoreDiskStatusSchedule);
  try {
    await line.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    throw new Error(
      `idea#168 ${intent}: [data-testid="restore-disk-status-schedule"] did not appear ` +
        `after saving scheduled ${time} (console#212). No soft-pass.`,
    );
  }
  const text = ((await line.textContent()) ?? '').trim();
  if (!isScheduledBackupStatusLine(text)) {
    throw new Error(
      `idea#168 ${intent}: schedule status line was not a console#212 catch-up, first-run, ` +
        `or next-run line — "${text}". No soft-pass.`,
    );
  }
};
