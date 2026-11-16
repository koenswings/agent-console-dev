/**
 * confirm_eject success / refusal / timeout (console#235).
 * A closed dialog is not success.
 */
import { describe, it, expect } from 'vitest';
import {
  CONFIRM_EJECT_TIMEOUT_MS,
  commandSignalFromEjectMarker,
  confirmEjectRefusalMessage,
  decideConfirmEject,
  type ConfirmEjectObservation,
} from '../e2e/intents/confirmEjectOutcome';
import { resolveConfirmEjectDiskId } from '../e2e/intents/operatorActions';

const base = (
  over: Partial<ConfirmEjectObservation> = {},
): ConfirmEjectObservation => ({
  dialogVisible: false,
  command: { status: 'absent' },
  noticeState: 'none',
  noticeMessage: null,
  diskLeftTree: false,
  elapsedMs: 1_000,
  timeoutMs: CONFIRM_EJECT_TIMEOUT_MS,
  ...over,
});

describe('resolveConfirmEjectDiskId', () => {
  it('is undefined when nothing is set (no silent Grade5A default)', () => {
    expect(resolveConfirmEjectDiskId({}, {})).toBeUndefined();
  });

  it('prefers DURATION_EJECT_DISK_ID over ctx.diskId', () => {
    expect(
      resolveConfirmEjectDiskId(
        { diskId: 'ctx-disk' },
        { DURATION_EJECT_DISK_ID: 'duration-kolibri-grade5a-001' },
      ),
    ).toBe('duration-kolibri-grade5a-001');
  });

  it('uses ctx.diskId when env is empty', () => {
    expect(resolveConfirmEjectDiskId({ diskId: 'ctx-disk' }, {})).toBe('ctx-disk');
  });
});

describe('commandSignalFromEjectMarker', () => {
  it('ignores a missing or stale marker', () => {
    expect(commandSignalFromEjectMarker(null, 0)).toEqual({ status: 'absent' });
    expect(commandSignalFromEjectMarker({ seq: 1, status: 'ok' }, 1)).toEqual({
      status: 'absent',
    });
  });

  it('accepts a newer ok, error, or timeout marker', () => {
    expect(commandSignalFromEjectMarker({ seq: 2, status: 'ok' }, 1)).toEqual({
      status: 'ok',
    });
    expect(
      commandSignalFromEjectMarker(
        { seq: 2, status: 'error', error: 'is locked by an active operation' },
        1,
      ),
    ).toEqual({ status: 'error', message: 'is locked by an active operation' });
    expect(
      commandSignalFromEjectMarker({ seq: 2, status: 'timeout' }, 1),
    ).toEqual({ status: 'timeout', message: undefined });
  });
});

describe('decideConfirmEject', () => {
  it('waits after the dialog closes if the Engine has not answered', () => {
    expect(decideConfirmEject(base({ dialogVisible: false }))).toEqual({ kind: 'wait' });
  });

  it('succeeds when the ejectDisk command result is ok', () => {
    expect(
      decideConfirmEject(base({ command: { status: 'ok' }, dialogVisible: false })),
    ).toEqual({ kind: 'success', reason: 'command-ok' });
  });

  it('succeeds when the disk has left the tree', () => {
    expect(decideConfirmEject(base({ diskLeftTree: true }))).toEqual({
      kind: 'success',
      reason: 'disk-left',
    });
  });

  it('does not treat a closed dialog as success', () => {
    expect(
      decideConfirmEject(base({ dialogVisible: false, diskLeftTree: false, elapsedMs: 2_000 })),
    ).toEqual({ kind: 'wait' });
  });

  it('surfaces an Engine refusal from the command result', () => {
    const msg = "Disk 'Kolibri Grade5A' (duration-kolibri-grade5a-001) is this Pi's system disk and cannot be ejected.";
    expect(
      decideConfirmEject(base({ command: { status: 'error', message: msg } })),
    ).toEqual({ kind: 'refusal', message: msg });
    expect(confirmEjectRefusalMessage(msg)).toContain(msg);
  });

  it('surfaces an Engine refusal from the inline eject notice', () => {
    const msg = "Couldn't eject Kolibri Grade5A: Disk is locked by an active 'backupApp' operation.";
    expect(
      decideConfirmEject(
        base({ noticeState: 'error', noticeMessage: msg, dialogVisible: false }),
      ),
    ).toEqual({ kind: 'refusal', message: msg });
  });

  it('prefers a refusal over the disk still being present or the dialog being closed', () => {
    expect(
      decideConfirmEject(
        base({
          dialogVisible: false,
          diskLeftTree: false,
          command: { status: 'error', message: 'is not currently docked' },
        }),
      ),
    ).toEqual({ kind: 'refusal', message: 'is not currently docked' });
  });

  it('times out clearly when the dialog closed without a success signal', () => {
    const decision = decideConfirmEject(
      base({ dialogVisible: false, elapsedMs: CONFIRM_EJECT_TIMEOUT_MS }),
    );
    expect(decision.kind).toBe('timeout');
    if (decision.kind !== 'timeout') return;
    expect(decision.message).toContain('did not complete within 20s');
    expect(decision.message).toContain('dialog closed without an ejectDisk command ok');
    expect(decision.message).toContain('A closed dialog is not success');
    expect(decision.message).toContain('No soft-pass');
  });

  it('treats the Console timeout notice as a clear timeout', () => {
    const decision = decideConfirmEject(
      base({ noticeState: 'timeout', noticeMessage: 'No response from the Engine', elapsedMs: 15_000 }),
    );
    expect(decision.kind).toBe('timeout');
  });
});
