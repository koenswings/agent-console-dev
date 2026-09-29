/**
 * Content-summary and erase-progress fixtures for idea#136 tests.
 */
import type { ContentSummary, EraseInProgress } from '../types/store';
import { FILES_IDS as I } from './filesFixtures';

export const SAMPLE_SUMMARY = (over: Partial<ContentSummary> = {}): ContentSummary => ({
  targetId: I.FA_APP,
  label: 'Kolibri Disk',
  model: 'Samsung',
  sizeBytes: 64_000_000_000,
  usedBytes: 12_000_000_000,
  fsType: 'ext4',
  apps: [{ name: 'nextcloud', version: '1.0' }],
  instances: [
    { id: I.INST_NC_A, name: 'nextcloud-01', running: true, dataBytes: 5_000_000_000 },
  ],
  backups: [],
  files: null,
  other: { entryCount: 3, totalBytes: 12_000, partial: false },
  otherPartitions: [],
  readable: true,
  serial: 'SN-FA-APP',
  computedAt: Date.now(),
  ...over,
});

export const UNREADABLE_SUMMARY = (over: Partial<ContentSummary> = {}): ContentSummary =>
  SAMPLE_SUMMARY({
    targetId: I.CAND_INTENSO,
    label: 'Intenso 32 GB',
    model: 'Intenso',
    sizeBytes: 32_000_000_000,
    usedBytes: null,
    fsType: 'exfat',
    apps: [],
    instances: [],
    backups: [],
    files: null,
    other: null,
    readable: false,
    serial: 'SN-INTENSO',
    ...over,
  });

export const ERASE_PROGRESS = (over: Partial<EraseInProgress> = {}): EraseInProgress => ({
  targetId: I.FA_APP,
  label: 'Kolibri Disk',
  step: 'partitioning',
  ...over,
});
