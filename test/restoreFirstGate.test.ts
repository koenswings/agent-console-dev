/**
 * restore_from_backup first gate (console#236).
 * A hidden confirm dialog is not an Engine signal.
 */
import { describe, it, expect } from 'vitest';
import {
  RESTORE_FIRST_GATE_TIMEOUT_MS,
  decideRestoreFirstGate,
  restoreRefusalMessage,
  type RestoreFirstGateObservation,
} from '../e2e/intents/restoreFirstGate';

const base = (
  over: Partial<RestoreFirstGateObservation> = {},
): RestoreFirstGateObservation => ({
  confirmVisible: false,
  operationInProgress: false,
  feedbackSent: false,
  feedbackError: null,
  feedbackTimeout: false,
  opStatus: 'absent',
  opError: null,
  elapsedMs: 1_000,
  timeoutMs: RESTORE_FIRST_GATE_TIMEOUT_MS,
  ...over,
});

describe('decideRestoreFirstGate', () => {
  it('waits after the dialog closes if the Engine has not signalled', () => {
    expect(decideRestoreFirstGate(base({ confirmVisible: false }))).toEqual({ kind: 'wait' });
  });

  it('accepts "Operation in progress" as the Engine op starting', () => {
    expect(decideRestoreFirstGate(base({ operationInProgress: true }))).toEqual({
      kind: 'signal',
      reason: 'operation',
    });
  });

  it('accepts the harness waitOperation hook seeing Running or Done', () => {
    expect(decideRestoreFirstGate(base({ opStatus: 'Running' }))).toEqual({
      kind: 'signal',
      reason: 'op-hook',
    });
    expect(decideRestoreFirstGate(base({ opStatus: 'Done' }))).toEqual({
      kind: 'signal',
      reason: 'op-hook',
    });
  });

  it('accepts CommandFeedback "Sent to …" as a command result', () => {
    expect(decideRestoreFirstGate(base({ feedbackSent: true }))).toEqual({
      kind: 'signal',
      reason: 'feedback-sent',
    });
  });

  it('does not treat a closed confirm dialog as the first gate', () => {
    expect(
      decideRestoreFirstGate(base({ confirmVisible: false, elapsedMs: 2_000 })),
    ).toEqual({ kind: 'wait' });
  });

  it('surfaces an Engine refusal from CommandFeedback', () => {
    const msg = "Couldn't restore Kolibri Grade5A: Target disk is not docked to this engine.";
    expect(
      decideRestoreFirstGate(base({ feedbackError: msg, confirmVisible: false })),
    ).toEqual({ kind: 'refusal', message: msg });
    expect(restoreRefusalMessage(msg)).toContain(msg);
  });

  it('surfaces a waitOperation Error as a refusal', () => {
    expect(
      decideRestoreFirstGate(
        base({ opStatus: 'Error', opError: 'restoreApp ended Error — no space' }),
      ),
    ).toEqual({ kind: 'refusal', message: 'restoreApp ended Error — no space' });
  });

  it('prefers a refusal over a closed dialog', () => {
    expect(
      decideRestoreFirstGate(
        base({
          confirmVisible: false,
          operationInProgress: false,
          feedbackError: 'Too many arguments',
        }),
      ),
    ).toEqual({ kind: 'refusal', message: 'Too many arguments' });
  });

  it('times out clearly when the dialog closed without an Engine signal', () => {
    const decision = decideRestoreFirstGate(
      base({ confirmVisible: false, elapsedMs: RESTORE_FIRST_GATE_TIMEOUT_MS }),
    );
    expect(decision.kind).toBe('timeout');
    if (decision.kind !== 'timeout') return;
    expect(decision.message).toContain('no Engine restore signal within 15s');
    expect(decision.message).toContain('confirm dialog closed without the restoreApp operation');
    expect(decision.message).toContain('A closed dialog is not an Engine signal');
    expect(decision.message).toContain('No soft-pass');
  });

  it('treats CommandFeedback timeout as a clear first-gate timeout', () => {
    const decision = decideRestoreFirstGate(base({ feedbackTimeout: true, elapsedMs: 8_000 }));
    expect(decision.kind).toBe('timeout');
  });
});
