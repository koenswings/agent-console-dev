/**
 * restore_from_backup first gate (console#236).
 *
 * RestorePanel closes the confirm dialog as soon as Confirm is clicked,
 * before the Engine has accepted restoreApp. A hidden dialog is not an
 * Engine signal. The first gate is the restore op starting/running, a
 * command result, or a CommandFeedback sent/error line.
 */
export const RESTORE_FIRST_GATE_TIMEOUT_MS = 15_000;

export type RestoreOpSignal = 'Running' | 'Done' | 'Error' | 'Timeout' | 'NotSeen' | 'absent';

export interface RestoreFirstGateObservation {
  confirmVisible: boolean;
  /** Restore button shows "Operation in progress" (instance locked by the op). */
  operationInProgress: boolean;
  feedbackSent: boolean;
  feedbackError: string | null;
  feedbackTimeout: boolean;
  /** Harness waitOperation status, if the hook is wired. */
  opStatus: RestoreOpSignal;
  opError: string | null;
  elapsedMs: number;
  timeoutMs?: number;
}

export type RestoreFirstGateDecision =
  | { kind: 'signal'; reason: 'operation' | 'feedback-sent' | 'op-hook' }
  | { kind: 'refusal'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'wait' };

export function restoreRefusalMessage(engineText: string): string {
  return `idea#168 restore_from_backup: restore refused — "${engineText}". No soft-pass.`;
}

export function decideRestoreFirstGate(obs: RestoreFirstGateObservation): RestoreFirstGateDecision {
  const timeoutMs = obs.timeoutMs ?? RESTORE_FIRST_GATE_TIMEOUT_MS;

  if (obs.opStatus === 'Error') {
    return { kind: 'refusal', message: obs.opError?.trim() || 'Restore failed.' };
  }
  const err = obs.feedbackError?.trim() ?? '';
  if (err) {
    return { kind: 'refusal', message: err };
  }

  if (obs.operationInProgress) {
    return { kind: 'signal', reason: 'operation' };
  }
  if (obs.opStatus === 'Running' || obs.opStatus === 'Done') {
    return { kind: 'signal', reason: 'op-hook' };
  }
  if (obs.feedbackSent) {
    return { kind: 'signal', reason: 'feedback-sent' };
  }

  if (obs.elapsedMs >= timeoutMs || obs.feedbackTimeout || obs.opStatus === 'Timeout') {
    const why = obs.confirmVisible
      ? 'restore confirm still visible'
      : 'confirm dialog closed without the restoreApp operation starting, a command result, or CommandFeedback';
    return {
      kind: 'timeout',
      message:
        `idea#168 restore_from_backup: no Engine restore signal within ${Math.round(timeoutMs / 1000)}s ` +
        `(${why}). A closed dialog is not an Engine signal. No soft-pass.`,
    };
  }
  return { kind: 'wait' };
}
