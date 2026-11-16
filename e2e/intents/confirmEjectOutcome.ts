/**
 * confirm_eject success / refusal / timeout (console#235).
 * A closed dialog is not success: NetworkTree closes EjectConfirm as soon as
 * Eject is clicked, before the Engine ejectDisk trace finishes.
 */
/** Longer than the Console's EJECT_TIMEOUT_MS (15s), so a timeout notice can appear. */
export const CONFIRM_EJECT_TIMEOUT_MS = 20_000;

export type EjectCommandSignal =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'timeout'; message?: string }
  | { status: 'absent' };

export interface ConfirmEjectObservation {
  dialogVisible: boolean;
  command: EjectCommandSignal;
  noticeState: 'error' | 'timeout' | 'sent' | 'none';
  noticeMessage: string | null;
  /** The disk row left the NetworkTree (dockedTo null). */
  diskLeftTree: boolean;
  elapsedMs: number;
  timeoutMs?: number;
}

export type ConfirmEjectDecision =
  | { kind: 'success'; reason: 'command-ok' | 'disk-left' }
  | { kind: 'refusal'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'wait' };

export function confirmEjectRefusalMessage(engineText: string): string {
  return `idea#168 confirm_eject: eject refused — "${engineText}". No soft-pass.`;
}

export function commandSignalFromEjectMarker(
  marker: { seq: number; status: string; error?: string | null } | null,
  baselineSeq: number,
): EjectCommandSignal {
  if (!marker || marker.seq <= baselineSeq) return { status: 'absent' };
  if (marker.status === 'ok') return { status: 'ok' };
  if (marker.status === 'error') {
    return { status: 'error', message: marker.error?.trim() || 'Eject failed.' };
  }
  if (marker.status === 'timeout') {
    return { status: 'timeout', message: marker.error?.trim() || undefined };
  }
  return { status: 'absent' };
}

export function decideConfirmEject(obs: ConfirmEjectObservation): ConfirmEjectDecision {
  const timeoutMs = obs.timeoutMs ?? CONFIRM_EJECT_TIMEOUT_MS;

  if (obs.command.status === 'error') {
    return { kind: 'refusal', message: obs.command.message.trim() || 'Eject failed.' };
  }
  const noticeErr = obs.noticeState === 'error' ? obs.noticeMessage?.trim() : '';
  if (noticeErr) {
    return { kind: 'refusal', message: noticeErr };
  }

  if (obs.command.status === 'ok') {
    return { kind: 'success', reason: 'command-ok' };
  }
  if (obs.diskLeftTree) {
    return { kind: 'success', reason: 'disk-left' };
  }

  const timedOutNotice =
    obs.command.status === 'timeout' || obs.noticeState === 'timeout';
  if (obs.elapsedMs >= timeoutMs || timedOutNotice) {
    const why = obs.dialogVisible
      ? 'eject-confirm still visible'
      : 'dialog closed without an ejectDisk command ok or the disk leaving the tree';
    return {
      kind: 'timeout',
      message:
        `idea#168 confirm_eject: eject did not complete within ${Math.round(timeoutMs / 1000)}s ` +
        `(${why}). A closed dialog is not success. No soft-pass.`,
    };
  }
  return { kind: 'wait' };
}
