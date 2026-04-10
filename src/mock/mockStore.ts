import { createSignal } from 'solid-js';
import type { Accessor } from 'solid-js';
import type {
  Store,
  Engine,
  Disk,
  App,
  Instance,
  BackupMode,
} from '../types/store';

// ---------------------------------------------------------------------------
// StoreConnection interface — shared by mock and real store implementations
// ---------------------------------------------------------------------------
export interface StoreConnection {
  store: Accessor<Store | null>;
  connected: Accessor<boolean>;
  sendCommand: (engineId: string, command: string) => void;
  changeDoc: (fn: (doc: Store) => void) => void;
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------
const NOW = Date.now();
const TWO_MINS_AGO = NOW - 2 * 60 * 1000;
const ONE_HOUR_AGO = NOW - 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------
const ENGINE_1_ID = 'ENGINE_DISK001';
const ENGINE_2_ID = 'ENGINE_DISK002';

const engine1: Engine = {
  id: ENGINE_1_ID,
  hostname: 'appdocker01',
  version: '1.2.0',
  hostOS: 'Linux',
  created: ONE_HOUR_AGO,
  lastBooted: ONE_HOUR_AGO,
  lastRun: NOW - 30 * 1000,       // 30 seconds ago — online
  lastHalted: null,
  commands: [],
};

const engine2: Engine = {
  id: ENGINE_2_ID,
  hostname: 'appdocker02',
  version: '1.2.0',
  hostOS: 'Linux',
  created: ONE_HOUR_AGO,
  lastBooted: ONE_HOUR_AGO,
  lastRun: NOW - 45 * 1000,       // 45 seconds ago — online
  lastHalted: null,
  commands: [],
};

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------
const DISK_1_ID = 'DISK001';
const DISK_2_ID = 'DISK002';
const DISK_3_ID = 'DISK003';
const DISK_4_ID = 'DISK004';
const DISK_5_ID = 'DISK005';

const kolibriDisk: Disk = {
  id: DISK_1_ID,
  name: 'kolibri-disk',
  device: 'sda',
  created: ONE_HOUR_AGO,
  lastDocked: ONE_HOUR_AGO,
  dockedTo: ENGINE_1_ID,
  diskTypes: ['app'],
  backupConfig: null,
};

const nextcloudDisk: Disk = {
  id: DISK_2_ID,
  name: 'nextcloud-disk',
  device: 'sdb',
  created: ONE_HOUR_AGO,
  lastDocked: ONE_HOUR_AGO,
  dockedTo: ENGINE_2_ID,
  diskTypes: ['app'],
  backupConfig: null,
};

const wikipediaDisk: Disk = {
  id: DISK_3_ID,
  name: 'wikipedia-disk',
  device: 'sdc',
  created: ONE_HOUR_AGO,
  lastDocked: ONE_HOUR_AGO,
  dockedTo: ENGINE_2_ID,
  diskTypes: ['app'],
  backupConfig: null,
};

// Empty disk — for testing provisioning flow
const emptyDisk: Disk = {
  id: DISK_5_ID,
  name: 'empty-disk',
  device: 'sde',
  created: ONE_HOUR_AGO,
  lastDocked: ONE_HOUR_AGO,
  dockedTo: ENGINE_1_ID,
  diskTypes: ['empty'],
  backupConfig: null,
};

// Backup disk — linked to kolibri instance
const backupDisk: Disk = {
  id: DISK_4_ID,
  name: 'backup-disk',
  device: 'sdd',
  created: ONE_HOUR_AGO,
  lastDocked: ONE_HOUR_AGO,
  dockedTo: ENGINE_1_ID,
  diskTypes: ['backup'],
  backupConfig: {
    mode: 'on-demand' as BackupMode,
    links: ['kolibri-inst-001'], // = INST_KOLIBRI_ID (forward ref workaround)
  },
};

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------
const APP_KOLIBRI_ID = 'kolibri-1.0';
const APP_NEXTCLOUD_ID = 'nextcloud-1.0';
const APP_WIKIPEDIA_ID = 'wikipedia-1.0';
const APP_EMPTY_ID = 'empty-disk-app-1.0';
const APP_BROKEN_ID = 'broken-app-1.0';

const kolibriApp: App = {
  id: APP_KOLIBRI_ID,
  name: 'kolibri',
  version: '1.0',
  title: 'Kolibri Learning Platform',
  description: 'Offline learning platform for underserved communities',
  url: null,
  category: 'education',
  icon: null,
  author: 'Learning Equality',
};

const nextcloudApp: App = {
  id: APP_NEXTCLOUD_ID,
  name: 'nextcloud',
  version: '1.0',
  title: 'Nextcloud',
  description: 'Self-hosted file sharing and collaboration',
  url: null,
  category: 'office',
  icon: null,
  author: 'Nextcloud GmbH',
};

const wikipediaApp: App = {
  id: APP_WIKIPEDIA_ID,
  name: 'wikipedia',
  version: '1.0',
  title: 'Wikipedia Offline',
  description: 'Offline Wikipedia mirror',
  url: null,
  category: 'education',
  icon: null,
  author: 'Kiwix',
};

const emptyDiskApp: App = {
  id: APP_EMPTY_ID,
  name: 'empty-disk-app',
  version: '1.0',
  title: 'Empty Disk App',
  description: null,
  url: null,
  category: 'utilities',
  icon: null,
  author: null,
};

const brokenApp: App = {
  id: APP_BROKEN_ID,
  name: 'broken-app',
  version: '1.0',
  title: 'Broken App',
  description: null,
  url: null,
  category: 'utilities',
  icon: null,
  author: null,
};

// ---------------------------------------------------------------------------
// Instances (5 instances in varied states)
// ---------------------------------------------------------------------------
const INST_KOLIBRI_ID = 'kolibri-inst-001';
const INST_NEXTCLOUD_ID = 'nextcloud-inst-001';
const INST_WIKIPEDIA_ID = 'wikipedia-inst-001';
const INST_EMPTY_ID = 'empty-disk-instance-001';
const INST_BROKEN_ID = 'broken-app-inst-001';

const kolibriInstance: Instance = {
  id: INST_KOLIBRI_ID,
  instanceOf: APP_KOLIBRI_ID,
  name: 'kolibri',
  status: 'Running',
  port: 8080,
  serviceImages: ['learningequality/kolibri:latest'],
  created: ONE_HOUR_AGO,
  lastBackup: TWO_MINS_AGO,
  lastStarted: ONE_HOUR_AGO,
  storedOn: DISK_1_ID,
  metrics: {
    cpuPercent:      1.82,
    memUsageBytes:   312_000_000,
    memLimitBytes:   4_000_000_000,
    memPercent:      7.8,
    netRxBytes:      1_240_000,
    netTxBytes:      380_000,
    blockReadBytes:  52_000_000,
    blockWriteBytes: 18_000_000,
    sampledAt:       NOW - 15_000,
  },
};

const nextcloudInstance: Instance = {
  id: INST_NEXTCLOUD_ID,
  instanceOf: APP_NEXTCLOUD_ID,
  name: 'nextcloud',
  status: 'Running',
  port: 8081,
  serviceImages: ['nextcloud:latest'],
  created: ONE_HOUR_AGO,
  lastBackup: null,
  lastStarted: ONE_HOUR_AGO,
  storedOn: DISK_2_ID,
  metrics: {
    cpuPercent:      0.41,
    memUsageBytes:   198_000_000,
    memLimitBytes:   4_000_000_000,
    memPercent:      4.95,
    netRxBytes:      880_000,
    netTxBytes:      210_000,
    blockReadBytes:  8_000_000,
    blockWriteBytes: 3_200_000,
    sampledAt:       NOW - 15_000,
  },
};

const wikipediaInstance: Instance = {
  id: INST_WIKIPEDIA_ID,
  instanceOf: APP_WIKIPEDIA_ID,
  name: 'wikipedia',
  status: 'Stopped',
  port: 8082,
  serviceImages: ['kiwix/kiwix-serve:latest'],
  created: ONE_HOUR_AGO,
  lastBackup: null,
  lastStarted: TWO_MINS_AGO,
  storedOn: DISK_3_ID,
  metrics: null,
};

const emptyDiskInstance: Instance = {
  id: INST_EMPTY_ID,
  instanceOf: APP_EMPTY_ID,
  name: 'empty-disk-instance',
  status: 'Docked',
  port: 0,
  serviceImages: [],
  created: ONE_HOUR_AGO,
  lastBackup: null,
  lastStarted: 0,
  storedOn: DISK_3_ID,
  metrics: null,
};

const brokenAppInstance: Instance = {
  id: INST_BROKEN_ID,
  instanceOf: APP_BROKEN_ID,
  name: 'broken-app',
  status: 'Error',
  port: 8083,
  serviceImages: ['broken/image:latest'],
  created: ONE_HOUR_AGO,
  lastBackup: null,
  lastStarted: ONE_HOUR_AGO,
  storedOn: DISK_2_ID,
  metrics: null,
};

// ---------------------------------------------------------------------------
// Assemble the mock Store
// ---------------------------------------------------------------------------
export const MOCK_STORE: Store = {
  engineDB: {
    [ENGINE_1_ID]: engine1,
    [ENGINE_2_ID]: engine2,
  },
  diskDB: {
    [DISK_1_ID]: kolibriDisk,
    [DISK_2_ID]: nextcloudDisk,
    [DISK_3_ID]: wikipediaDisk,
    [DISK_4_ID]: backupDisk,
    [DISK_5_ID]: emptyDisk,
  },
  appDB: {
    [APP_KOLIBRI_ID]: kolibriApp,
    [APP_NEXTCLOUD_ID]: nextcloudApp,
    [APP_WIKIPEDIA_ID]: wikipediaApp,
    [APP_EMPTY_ID]: emptyDiskApp,
    [APP_BROKEN_ID]: brokenApp,
  },
  instanceDB: {
    [INST_KOLIBRI_ID]: kolibriInstance,
    [INST_NEXTCLOUD_ID]: nextcloudInstance,
    [INST_WIKIPEDIA_ID]: wikipediaInstance,
    [INST_EMPTY_ID]: emptyDiskInstance,
    [INST_BROKEN_ID]: brokenAppInstance,
  },
  userDB: {
    // Pre-provisioned demo admin — no first-time setup required in demo mode
    'user-demo-admin': {
      id: 'user-demo-admin',
      username: 'admin',
      // bcrypt hash of 'admin911!' (cost 12)
      passwordHash: '$2b$12$0OrL1qEVSWi22JYNgbP/u.hP8ig1RjSueV8bbRpg6pPH3E/kFmssq',
      role: 'operator' as const,
      created: 0,
    },
  },
};

// ---------------------------------------------------------------------------
// createMockConnection — returns a StoreConnection backed by the in-memory mock
// ---------------------------------------------------------------------------
const DEMO_USERDB_KEY = 'ideaConsole_demoUserDB';

function loadPersistedUserDB(): Store['userDB'] {
  try {
    const raw = localStorage.getItem(DEMO_USERDB_KEY);
    if (raw) return JSON.parse(raw) as Store['userDB'];
  } catch {
    // ignore
  }
  return {};
}

function persistUserDB(userDB: Store['userDB']): void {
  try {
    localStorage.setItem(DEMO_USERDB_KEY, JSON.stringify(userDB));
  } catch {
    // ignore — e.g. extension context without localStorage
  }
}

export function createMockConnection(): StoreConnection {
  const persistedUserDB = loadPersistedUserDB();
  const initialStore: Store = {
    ...MOCK_STORE,
    // Merge: pre-provisioned admin is always present; persisted users layer on top
    userDB: Object.keys(persistedUserDB).length > 0
      ? persistedUserDB
      : MOCK_STORE.userDB,
  };
  const [store, setStore] = createSignal<Store | null>(initialStore);
  const [connected] = createSignal(true);
  const commandLog: Array<{ engineId: string; command: string }> = [];

  const sendCommand = (engineId: string, command: string): void => {
    console.log(`[Mock] Command → ${engineId}: ${command}`);
    commandLog.push({ engineId, command });
    // Simulate writing the command into the engine's commands array
    setStore((prev) => {
      if (!prev) return prev;
      const engine = prev.engineDB[engineId];
      if (!engine) return prev;
      return {
        ...prev,
        engineDB: {
          ...prev.engineDB,
          [engineId]: {
            ...engine,
            commands: [...engine.commands, command],
          },
        },
      };
    });
  };

  const changeDoc = (fn: (doc: Store) => void): void => {
    setStore((prev) => {
      if (!prev) return prev;
      // Deep clone so mutations don't affect the previous snapshot
      const copy = JSON.parse(JSON.stringify(prev)) as Store;
      fn(copy);
      // Persist userDB so operators survive page reloads in demo mode
      persistUserDB(copy.userDB ?? {});
      return copy;
    });
  };

  return { store, connected, sendCommand, changeDoc };
}

// ---------------------------------------------------------------------------
// Export IDs for use in tests
// ---------------------------------------------------------------------------
export const MOCK_IDS = {
  ENGINE_1_ID,
  ENGINE_2_ID,
  DISK_1_ID,
  DISK_2_ID,
  DISK_3_ID,
  DISK_4_ID,
  DISK_5_ID,
  APP_KOLIBRI_ID,
  APP_NEXTCLOUD_ID,
  INST_KOLIBRI_ID,
  INST_NEXTCLOUD_ID,
  INST_WIKIPEDIA_ID,
  INST_EMPTY_ID,
  INST_BROKEN_ID,
} as const;
