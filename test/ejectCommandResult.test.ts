import { afterEach, describe, expect, it } from 'vitest';
import {
  clearEjectCommandResult,
  publishEjectCommandResult,
  readEjectCommandResult,
} from '../src/store/ejectCommandResult';

afterEach(() => {
  clearEjectCommandResult();
});

describe('ejectCommandResult marker', () => {
  it('publishes ok then a later error with incrementing seq', () => {
    publishEjectCommandResult({ status: 'ok', targetId: 'disk-a' });
    expect(readEjectCommandResult()).toEqual({
      seq: 1,
      status: 'ok',
      targetId: 'disk-a',
      error: null,
    });
    publishEjectCommandResult({
      status: 'error',
      targetId: 'disk-a',
      message: 'is locked by an active operation',
    });
    expect(readEjectCommandResult()).toMatchObject({
      seq: 2,
      status: 'error',
      error: 'is locked by an active operation',
    });
  });

  it('clears so a fresh publish starts at seq 1', () => {
    publishEjectCommandResult({ status: 'ok', targetId: 'd1' });
    clearEjectCommandResult();
    expect(readEjectCommandResult()).toBeNull();
    publishEjectCommandResult({ status: 'timeout', targetId: 'd2', message: 'No response from the Engine.' });
    expect(readEjectCommandResult()?.seq).toBe(1);
    expect(readEjectCommandResult()?.status).toBe('timeout');
  });
});
