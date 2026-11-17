import { afterEach, describe, expect, it } from 'vitest';
import {
  clearEraseCommandResult,
  publishEraseCommandResult,
  readEraseCommandResult,
  ERASE_COMMAND_RESULT_TESTID,
} from '../src/store/eraseCommandResult';

afterEach(() => {
  clearEraseCommandResult();
});

describe('eraseCommandResult marker', () => {
  it('starts empty', () => {
    expect(readEraseCommandResult()).toBeNull();
    expect(document.querySelector(`[data-testid="${ERASE_COMMAND_RESULT_TESTID}"]`)).toBeNull();
  });

  it('publishes an ok result and increments seq', () => {
    publishEraseCommandResult({ status: 'ok', targetId: 'disk-a', diskId: 'disk-a' });
    expect(readEraseCommandResult()).toEqual({
      seq: 1,
      status: 'ok',
      targetId: 'disk-a',
      diskId: 'disk-a',
      error: null,
    });
    publishEraseCommandResult({
      status: 'error',
      targetId: 'disk-a',
      message: 'shares its physical disk',
    });
    expect(readEraseCommandResult()).toEqual({
      seq: 2,
      status: 'error',
      targetId: 'disk-a',
      diskId: null,
      error: 'shares its physical disk',
    });
  });

  it('survives being read after a later clear, then a fresh publish starts at seq 1', () => {
    publishEraseCommandResult({ status: 'ok', targetId: 'd1', diskId: 'd1' });
    clearEraseCommandResult();
    expect(readEraseCommandResult()).toBeNull();
    publishEraseCommandResult({ status: 'ok', targetId: 'd2', diskId: 'd2' });
    expect(readEraseCommandResult()?.seq).toBe(1);
    expect(readEraseCommandResult()?.targetId).toBe('d2');
  });
});
