/**
 * confirm_erase success / refusal / timeout (console#233, engine#488).
 * A closed dialog is not success.
 */
import { describe, it, expect } from 'vitest';
import {
  CONFIRM_ERASE_TIMEOUT_MS,
  commandSignalFromMarker,
  decideConfirmErase,
  type ConfirmEraseObservation,
} from '../e2e/intents/confirmEraseOutcome';
import { resolveConfirmEraseDiskId } from '../e2e/intents/operatorActions';

const base = (
  over: Partial<ConfirmEraseObservation> = {},
): ConfirmEraseObservation => ({
  dialogVisible: true,
  eraseCompleteVisible: false,
  dialogError: null,
  command: { status: 'absent' },
  diskEmpty: false,
  diskRepublishedEmpty: false,
  elapsedMs: 1_000,
  timeoutMs: CONFIRM_ERASE_TIMEOUT_MS,
  progressStep: 'checking',
  progressVisible: true,
  ...over,
});

describe('resolveConfirmEraseDiskId', () => {
  it('is undefined when nothing is set (no silent Grade5A default)', () => {
    expect(resolveConfirmEraseDiskId({}, {})).toBeUndefined();
  });

  it('prefers DURATION_EMPTY_DISK_ID over ctx.diskId', () => {
    expect(
      resolveConfirmEraseDiskId(
        { diskId: 'ctx-disk' },
        { DURATION_EMPTY_DISK_ID: 'duration-empty-001' },
      ),
    ).toBe('duration-empty-001');
  });

  it('uses ctx.diskId when env is empty', () => {
    expect(resolveConfirmEraseDiskId({ diskId: 'ctx-disk' }, {})).toBe('ctx-disk');
  });
});

describe('commandSignalFromMarker', () => {
  it('ignores a missing or stale marker (seq at or below baseline)', () => {
    expect(commandSignalFromMarker(null, 0)).toEqual({ status: 'absent' });
    expect(
      commandSignalFromMarker({ seq: 1, status: 'ok' }, 1),
    ).toEqual({ status: 'absent' });
  });

  it('accepts a newer ok or error marker', () => {
    expect(commandSignalFromMarker({ seq: 2, status: 'ok' }, 1)).toEqual({
      status: 'ok',
    });
    expect(
      commandSignalFromMarker(
        { seq: 2, status: 'error', error: 'shares its physical disk' },
        1,
      ),
    ).toEqual({ status: 'error', message: 'shares its physical disk' });
  });

  it('defaults a blank error message', () => {
    expect(
      commandSignalFromMarker({ seq: 1, status: 'error', error: '  ' }, 0),
    ).toEqual({ status: 'error', message: 'Erase failed.' });
  });
});

describe('decideConfirmErase', () => {
  it('waits while the dialog is open and erase is still running', () => {
    expect(
      decideConfirmErase(
        base({ command: { status: 'running' }, progressStep: 'checking' }),
      ),
    ).toEqual({ kind: 'wait' });
  });

  it('succeeds when erase-complete is visible', () => {
    expect(
      decideConfirmErase(base({ eraseCompleteVisible: true, diskEmpty: true })),
    ).toEqual({ kind: 'success', reason: 'erase-complete' });
  });

  it('succeeds on the Engine eraseDisk command ok after the dialog closes', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          command: { status: 'ok' },
          diskEmpty: true,
        }),
      ),
    ).toEqual({ kind: 'success', reason: 'command-ok' });
  });

  it('succeeds when the disk comes back Empty after leaving the tree', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          diskEmpty: true,
          diskRepublishedEmpty: true,
        }),
      ),
    ).toEqual({ kind: 'success', reason: 'disk-empty' });
  });

  it('does not treat a closed dialog as success (r86t false pass)', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          diskEmpty: false,
          elapsedMs: 2_000,
        }),
      ),
    ).toEqual({ kind: 'wait' });
  });

  it('does not pass just because an already-empty disk is still Empty after the dialog vanishes', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          diskEmpty: true,
          diskRepublishedEmpty: false,
          elapsedMs: 2_000,
        }),
      ),
    ).toEqual({ kind: 'wait' });
  });

  it('surfaces a dialog refusal with the Engine reason (shared-disk guard)', () => {
    const msg =
      'Duration Tests — Empty Disk 001 shares its physical disk (/dev/sdb) with sdb1 mounted at /disks/sdb1. Erasing wipes the whole disk, so nothing was erased.';
    expect(decideConfirmErase(base({ dialogError: msg }))).toEqual({
      kind: 'refusal',
      message: msg,
    });
  });

  it('surfaces a command-log refusal even if the dialog has already closed', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          command: { status: 'error', message: 'shares its physical disk' },
          diskEmpty: true,
        }),
      ),
    ).toEqual({ kind: 'refusal', message: 'shares its physical disk' });
  });

  it('ignores the "Type … to confirm" hint as a refusal', () => {
    expect(
      decideConfirmErase(base({ dialogError: 'Type Duration Tests — Empty Disk 001 to confirm' })),
    ).toEqual({ kind: 'wait' });
  });

  it('times out clearly when the dialog closed without a success signal', () => {
    const decision = decideConfirmErase(
      base({
        dialogVisible: false,
        diskEmpty: true,
        diskRepublishedEmpty: false,
        elapsedMs: CONFIRM_ERASE_TIMEOUT_MS,
      }),
    );
    expect(decision.kind).toBe('timeout');
    if (decision.kind !== 'timeout') return;
    expect(decision.message).toContain('did not complete within 180s');
    expect(decision.message).toContain('dialog closed without erase-complete');
    expect(decision.message).toContain('A closed dialog is not success');
    expect(decision.message).toContain('No soft-pass');
  });

  it('times out clearly while still on "checking…" with the dialog open', () => {
    const decision = decideConfirmErase(
      base({
        elapsedMs: CONFIRM_ERASE_TIMEOUT_MS,
        progressStep: 'checking',
        progressVisible: true,
      }),
    );
    expect(decision.kind).toBe('timeout');
    if (decision.kind !== 'timeout') return;
    expect(decision.message).toContain('stuck progress=true, data-erase-step="checking"');
    expect(decision.message).toContain('A closed dialog is not success');
  });

  it('prefers a refusal over a closed dialog or an empty disk', () => {
    expect(
      decideConfirmErase(
        base({
          dialogVisible: false,
          diskEmpty: true,
          diskRepublishedEmpty: true,
          command: { status: 'error', message: 'nothing was erased' },
        }),
      ),
    ).toEqual({ kind: 'refusal', message: 'nothing was erased' });
  });
});
