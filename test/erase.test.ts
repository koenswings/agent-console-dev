/**
 * idea#136 — erase helpers: capability gate, summary parse/stale, command strings.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEraseDiskCommand,
  buildSummariseDiskCommand,
  engineHasCapability,
  UPDATE_ENGINE_TOOLTIP,
} from '../src/store/commands';
import {
  SUMMARY_MAX_AGE_MS,
  SUMMARY_STALE_MESSAGE,
  canEraseDisk,
  eraseBlockedReason,
  isErasedEmptyDisk,
  isSummaryStale,
  parseContentSummary,
  sizeText,
  countText,
} from '../src/store/erase';
import { MOCK_FILES_STORE, FILES_IDS as I } from '../src/mock/filesFixtures';
import { SAMPLE_SUMMARY, UNREADABLE_SUMMARY } from '../src/mock/eraseFixtures';
import type { CommandTrace } from '../src/types/commandLog';
import type { Disk, Engine, Store } from '../src/types/store';

const S = MOCK_FILES_STORE;
const d = (id: string): Disk => S.diskDB[id];
const eng = (id: string): Engine => S.engineDB[id];

describe('buildSummariseDiskCommand / buildEraseDiskCommand', () => {
  it('ID-only summarise and erase with summaryTraceId and confirm name last', () => {
    expect(buildSummariseDiskCommand('DISK_1')).toBe('summariseDisk DISK_1');
    expect(buildEraseDiskCommand('DISK_1', 'trace-abc', 'MilkWise Apps')).toBe(
      'eraseDisk DISK_1 trace-abc MilkWise Apps',
    );
    expect(buildEraseDiskCommand(I.CAND_INTENSO, 't1', 'Intenso 32 GB')).toBe(
      `eraseDisk ${I.CAND_INTENSO} t1 Intenso 32 GB`,
    );
  });
});

describe('canEraseDisk / eraseBlockedReason', () => {
  it('offers erase on every non-system docked disk', () => {
    expect(canEraseDisk(d(I.FA_APP))).toBe(true);
    expect(canEraseDisk(d(I.FA_FILES))).toBe(true);
    expect(canEraseDisk(d(I.FA_BACKUP))).toBe(true);
    expect(canEraseDisk(d(I.FA_ABF))).toBe(true);
  });
  it('refuses the system disk and undocked disks', () => {
    expect(canEraseDisk({ ...d(I.FA_APP), diskTypes: ['system'] })).toBe(false);
    expect(canEraseDisk({ ...d(I.FA_APP), device: null })).toBe(false);
  });
  it('greys out without a fresh eraseDisk capability', () => {
    expect(eraseBlockedReason(eng(I.ENGINE_C), S, I.FC_APP)).toBe(UPDATE_ENGINE_TOOLTIP);
    const stale: Engine = { ...eng(I.ENGINE_A), capabilitiesBootedAt: eng(I.ENGINE_A).lastBooted - 1 };
    expect(eraseBlockedReason(stale, S, I.FA_APP)).toBe(UPDATE_ENGINE_TOOLTIP);
    expect(engineHasCapability(eng(I.ENGINE_A), 'eraseDisk')).toBe(true);
    expect(eraseBlockedReason(eng(I.ENGINE_A), S, I.FA_APP)).toBeUndefined();
  });
  it('greys out while eraseInProgress is set', () => {
    const busy: Engine = {
      ...eng(I.ENGINE_A),
      eraseInProgress: { targetId: 'other', label: 'Other', step: 'partitioning' },
    };
    expect(eraseBlockedReason(busy, S, I.FA_APP)).toContain('already in progress');
  });
  it('greys out when the disk is locked by an active operation', () => {
    const locked: Store = {
      ...S,
      operationDB: {
        op1: {
          id: 'op1',
          kind: 'backupApp',
          status: 'Running',
          startedAt: 1,
          completedAt: null,
          subject: { type: 'instance', id: I.INST_NC_A },
          args: { backupDiskId: I.FA_BACKUP, instanceId: I.INST_NC_A },
          error: null,
          cause: 'console-command',
          engineId: I.ENGINE_A,
          progressPercent: null,
          currentStep: null,
          totalSteps: null,
          stepLabel: null,
        },
      },
    };
    expect(eraseBlockedReason(eng(I.ENGINE_A), locked, I.FA_BACKUP)).toContain('Operation in progress');
  });
});

describe('parseContentSummary / stale', () => {
  it('parses a summariseDisk result', () => {
    const summary = SAMPLE_SUMMARY({ label: 'School Apps' });
    const trace: CommandTrace = {
      traceId: 't1',
      command: 'summariseDisk',
      args: { targetId: I.FA_APP },
      startedAt: 1,
      completedAt: 2,
      status: 'ok',
      errorMessage: null,
      logs: [],
      result: JSON.stringify(summary),
    };
    expect(parseContentSummary(trace)?.label).toBe('School Apps');
    expect(parseContentSummary({ ...trace, result: null })).toBeNull();
  });
  it('marks a summary older than 10 minutes as stale', () => {
    const old = SAMPLE_SUMMARY({ computedAt: Date.now() - SUMMARY_MAX_AGE_MS - 1 });
    expect(isSummaryStale(old, Date.now())).toBe(true);
    expect(isSummaryStale(SAMPLE_SUMMARY({ computedAt: Date.now() }), Date.now())).toBe(false);
    expect(SUMMARY_STALE_MESSAGE).toContain('out of date');
  });
  it('unreadable summaries carry contents-unknown data', () => {
    const u = UNREADABLE_SUMMARY();
    expect(u.readable).toBe(false);
    expect(u.instances).toEqual([]);
  });
  it('countText / sizeText helpers', () => {
    expect(countText(10, true)).toBe('at least 10');
    expect(countText(10, false)).toBe('10');
    expect(sizeText(null)).toBe('unknown');
    expect(sizeText(1_000_000_000)).toContain('GB');
  });
});

describe('isErasedEmptyDisk', () => {
  it('is true only for exactly [empty]', () => {
    expect(isErasedEmptyDisk({ ...d(I.FA_APP), diskTypes: ['empty'] })).toBe(true);
    expect(isErasedEmptyDisk(d(I.FA_APP))).toBe(false);
    expect(isErasedEmptyDisk(undefined)).toBe(false);
  });
});
