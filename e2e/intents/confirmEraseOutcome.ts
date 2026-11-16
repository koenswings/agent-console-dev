/**
 * confirm_erase success / refusal / timeout decision (console#233, engine#488).
 *
 * A closed dialog is not success. r86t false-passed when EmptyDiskPanel
 * unmounted after the Engine deleted the disk row and idea-erase-disk refused.
 * Success requires the Engine eraseDisk command result (ok, after the disk is
 * republished Empty), the Console erase-complete signal, or the disk coming
 * back Empty in the Console UI/store after the click.
 */
export const CONFIRM_ERASE_TIMEOUT_MS = 180_000;

export type EraseCommandSignal =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'running' }
  | { status: 'absent' };

export interface ConfirmEraseObservation {
  dialogVisible: boolean;
  eraseCompleteVisible: boolean;
  /** Visible dialog alert; "Type … to confirm" is a typing hint, not a refusal. */
  dialogError: string | null;
  command: EraseCommandSignal;
  /** Target disk is present as Empty in the Console UI/store. */
  diskEmpty: boolean;
  /** Disk left the tree after confirm and came back Empty (republish). */
  diskRepublishedEmpty: boolean;
  elapsedMs: number;
  timeoutMs?: number;
  progressStep?: string;
  progressVisible?: boolean;
}

export type ConfirmEraseDecision =
  | { kind: 'success'; reason: 'erase-complete' | 'command-ok' | 'disk-empty' }
  | { kind: 'refusal'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'wait' };

export const isTypedConfirmHint = (msg: string): boolean =>
  /Type .+ to confirm/i.test(msg);

/** Map a durable erase-command-result marker to a signal, ignoring stale seq. */
export function commandSignalFromMarker(
  marker: { seq: number; status: string; error?: string | null } | null,
  baselineSeq: number,
): EraseCommandSignal {
  if (!marker || marker.seq <= baselineSeq) return { status: 'absent' };
  if (marker.status === 'ok') return { status: 'ok' };
  if (marker.status === 'error') {
    return { status: 'error', message: marker.error?.trim() || 'Erase failed.' };
  }
  if (marker.status === 'running') return { status: 'running' };
  return { status: 'absent' };
}

export function decideConfirmErase(obs: ConfirmEraseObservation): ConfirmEraseDecision {
  const timeoutMs = obs.timeoutMs ?? CONFIRM_ERASE_TIMEOUT_MS;

  if (obs.command.status === 'error') {
    return { kind: 'refusal', message: obs.command.message.trim() || 'Erase failed.' };
  }
  const dialogErr = obs.dialogError?.trim() ?? '';
  if (dialogErr && !isTypedConfirmHint(dialogErr)) {
    return { kind: 'refusal', message: dialogErr };
  }

  if (obs.eraseCompleteVisible) {
    return { kind: 'success', reason: 'erase-complete' };
  }
  if (obs.command.status === 'ok') {
    return { kind: 'success', reason: 'command-ok' };
  }
  if (obs.diskRepublishedEmpty && obs.diskEmpty) {
    return { kind: 'success', reason: 'disk-empty' };
  }

  if (obs.elapsedMs >= timeoutMs) {
    const step = obs.progressStep?.trim() ?? '';
    const stuck = obs.progressVisible ? 'true' : 'false';
    const why = !obs.dialogVisible
      ? 'dialog closed without erase-complete, an eraseDisk command ok, or the disk coming back Empty'
      : `stuck progress=${stuck}, data-erase-step="${step}"`;
    return {
      kind: 'timeout',
      message:
        `idea#168 confirm_erase: erase did not complete within ${Math.round(timeoutMs / 1000)}s ` +
        `(${why}). A closed dialog is not success. No soft-pass.`,
    };
  }
  return { kind: 'wait' };
}
