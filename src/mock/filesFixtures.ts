/**
 * Mock store fixtures for Files Disks (files-disk.md §8, idea#132): a Files
 * Disk in each state and combined disks. Kept apart from MOCK_STORE so the
 * existing fixture counts don't change.
 *
 *   Engine A (fresh 'filesDisk'): Nextcloud running and mounting Files Disks
 *     FA_FILES      ['files']                   mounted → "Available in: …"
 *     FA_APP_FILES  ['app', 'files']            combined, hosts Nextcloud, low space
 *     FA_ABF        ['app', 'backup', 'files']  combined, all three sections
 *     FA_PASSWORD   ['files']                   Not mounted: password-protected
 *     FA_UNMOUNT    ['files']                   Not mounted: stuck unmount
 *     FA_BACKUP     ['backup']                  pure Backup Disk (no eject), Add Files offered
 *     FA_APP        ['app']                     Add Files offered
 *   Engine B (fresh 'filesDisk'): Nextcloud installed but stopped
 *     FB_FILES      ['files']                   "Nextcloud supports Files Disks but isn't running"
 *   Engine C (no capabilities): no opted-in App
 *     FC_FILES      ['files']                   "No App on this Engine uses Files Disks yet"
 *     FC_APP        ['app']                     Add Files greyed out (old Engine)
 */
import type { App, Disk, Engine, FilesConfig, Instance, Store } from '../types/store';

const T = 1_790_000_000_000;
const GB = 1_000_000_000;

const engine = (id: string, hostname: string, caps?: string[]): Engine => ({
  id,
  hostname,
  version: '1.2.0',
  hostOS: 'Linux',
  created: T,
  lastBooted: T,
  lastRun: T,
  lastHalted: null,
  commands: [],
  ...(caps ? { capabilities: caps, capabilitiesBootedAt: T } : {}),
});

export const FILES_IDS = {
  ENGINE_A: 'ENGINE_FILES_A',
  ENGINE_B: 'ENGINE_FILES_B',
  ENGINE_C: 'ENGINE_FILES_C',
  FA_FILES: 'DISK_FA_FILES',
  FA_APP_FILES: 'DISK_FA_APP_FILES',
  FA_ABF: 'DISK_FA_ABF',
  FA_PASSWORD: 'DISK_FA_PASSWORD',
  FA_UNMOUNT: 'DISK_FA_UNMOUNT',
  FA_BACKUP: 'DISK_FA_BACKUP',
  FA_APP: 'DISK_FA_APP',
  FB_APP: 'DISK_FB_APP',
  FB_FILES: 'DISK_FB_FILES',
  FC_FILES: 'DISK_FC_FILES',
  FC_APP: 'DISK_FC_APP',
  APP_NEXTCLOUD: 'nextcloud-files',
  APP_KOLIBRI: 'kolibri-files',
  INST_NC_A: 'INST_NC_A',
  INST_NC_B: 'INST_NC_B',
  INST_KOLIBRI_A: 'INST_KOLIBRI_A',
  INST_KOLIBRI_C: 'INST_KOLIBRI_C',
} as const;
const I = FILES_IDS;

const filesConfig = (over: Partial<FilesConfig> = {}): FilesConfig => ({
  shareName: 'School Files',
  readOnly: false,
  passwordProtected: false,
  error: null,
  ...over,
});

const disk = (id: string, name: string, engineId: string, device: string, over: Partial<Disk>): Disk => ({
  id,
  name,
  device,
  created: T,
  lastDocked: T,
  dockedTo: engineId,
  diskTypes: [],
  backupConfig: null,
  filesConfig: null,
  unmountError: null,
  sizeBytes: 64 * GB,
  freeBytes: 40 * GB,
  ...over,
});

const app = (id: string, name: string, title: string, filesMount: App['filesMount']): App => ({
  id,
  name,
  version: '1.0',
  title,
  description: null,
  url: null,
  category: 'tools',
  icon: null,
  author: null,
  filesMount,
});

const instance = (id: string, appId: string, name: string, diskId: string, status: Instance['status'], filesMounts: string[] = []): Instance => ({
  id,
  instanceOf: appId,
  name,
  status,
  port: 8080,
  serviceImages: [],
  created: T,
  lastBackup: null,
  lastStarted: T,
  storedOn: diskId,
  statusCondition: null,
  currentStep: null,
  totalSteps: null,
  stepLabel: null,
  metrics: null,
  filesMounts,
});

const disks: Disk[] = [
  disk(I.FA_FILES, 'School Files', I.ENGINE_A, 'sdb1', { diskTypes: ['files'], filesConfig: filesConfig() }),
  disk(I.FA_APP_FILES, 'Apps and Files', I.ENGINE_A, 'sdc1', {
    diskTypes: ['app', 'files'],
    filesConfig: filesConfig({ shareName: 'Class Files' }),
    sizeBytes: 32 * GB,
    freeBytes: 1 * GB,
  }),
  disk(I.FA_ABF, 'All Roles', I.ENGINE_A, 'sdd1', {
    diskTypes: ['app', 'backup', 'files'],
    backupConfig: { mode: 'on-demand', links: [I.INST_KOLIBRI_A] },
    filesConfig: filesConfig({ shareName: 'Shared' }),
  }),
  disk(I.FA_PASSWORD, 'Locked Files', I.ENGINE_A, 'sde1', {
    diskTypes: ['files'],
    filesConfig: filesConfig({ passwordProtected: true, error: 'password-protected Files Disks are not supported yet' }),
  }),
  disk(I.FA_UNMOUNT, 'Stuck Files', I.ENGINE_A, 'sdf1', {
    diskTypes: ['files'],
    filesConfig: filesConfig(),
    unmountError: { engineId: I.ENGINE_A, mountPoint: '/disks/sdf1', fsUuid: 'uuid-sdf1', message: 'target is busy' },
  }),
  disk(I.FA_BACKUP, 'Backups Only', I.ENGINE_A, 'sdg1', {
    diskTypes: ['backup'],
    backupConfig: { mode: 'immediate', links: [I.INST_NC_A] },
  }),
  disk(I.FA_APP, 'Kolibri Disk', I.ENGINE_A, 'sdh1', { diskTypes: ['app'] }),
  disk(I.FB_APP, 'Nextcloud Disk', I.ENGINE_B, 'sdb1', { diskTypes: ['app'] }),
  disk(I.FB_FILES, 'Files B', I.ENGINE_B, 'sdc1', { diskTypes: ['files'], filesConfig: filesConfig() }),
  disk(I.FC_FILES, 'Files C', I.ENGINE_C, 'sdb1', { diskTypes: ['files'], filesConfig: filesConfig() }),
  disk(I.FC_APP, 'Old Engine Apps', I.ENGINE_C, 'sdc1', { diskTypes: ['app'] }),
];

const instances: Instance[] = [
  instance(I.INST_NC_A, I.APP_NEXTCLOUD, 'nextcloud-01', I.FA_APP_FILES, 'Running', [I.FA_FILES, I.FA_APP_FILES, I.FA_ABF]),
  instance(I.INST_KOLIBRI_A, I.APP_KOLIBRI, 'kolibri-01', I.FA_APP, 'Running'),
  instance(I.INST_NC_B, I.APP_NEXTCLOUD, 'nextcloud-02', I.FB_APP, 'Stopped'),
  instance(I.INST_KOLIBRI_C, I.APP_KOLIBRI, 'kolibri-02', I.FC_APP, 'Running'),
];

export const MOCK_FILES_STORE: Store = {
  engineDB: {
    [I.ENGINE_A]: engine(I.ENGINE_A, 'files-a', ['diskIdArgs', 'filesDisk']),
    [I.ENGINE_B]: engine(I.ENGINE_B, 'files-b', ['diskIdArgs', 'filesDisk']),
    [I.ENGINE_C]: engine(I.ENGINE_C, 'files-c'),
  },
  diskDB: Object.fromEntries(disks.map((d) => [d.id, d])),
  appDB: {
    [I.APP_NEXTCLOUD]: app(I.APP_NEXTCLOUD, 'nextcloud', 'Nextcloud', { path: '/mnt/idea-files', services: ['nextcloud-app'] }),
    [I.APP_KOLIBRI]: app(I.APP_KOLIBRI, 'kolibri', 'Kolibri', null),
  },
  instanceDB: Object.fromEntries(instances.map((i) => [i.id, i])),
  userDB: {},
  operationDB: {},
};
