/**
 * School kit LAN fixture (fix/kit-app-links): three Engines sharing one store.
 *   kind-panda 10.42.0.127, happy-zebra 10.42.0.3, sunny-robin 10.42.0.4.
 * One running app per Engine, each on its own port.
 */
import type { App, Disk, Engine, Instance, Store } from '../../src/types/store';

export const KIT = {
  KP: 'eng-kind-panda',
  HZ: 'eng-happy-zebra',
  SR: 'eng-sunny-robin',
} as const;

export const KIT_IP: Record<string, string> = {
  [KIT.KP]: '10.42.0.127',
  [KIT.HZ]: '10.42.0.3',
  [KIT.SR]: '10.42.0.4',
};

export const KIT_NAME: Record<string, string> = {
  [KIT.KP]: 'kind-panda',
  [KIT.HZ]: 'happy-zebra',
  [KIT.SR]: 'sunny-robin',
};

/** Instance id and port of the app on each Engine. */
export const KIT_APP: Record<string, { inst: string; port: number }> = {
  [KIT.KP]: { inst: 'inst-kp-kolibri', port: 8080 },
  [KIT.HZ]: { inst: 'inst-hz-nextcloud', port: 8081 },
  [KIT.SR]: { inst: 'inst-sr-wikipedia', port: 8082 },
};

export const kitEngine = (id: string, withLan: boolean): Engine => ({
  id, hostname: KIT_NAME[id], version: '1.0', hostOS: 'Linux',
  created: 0, lastBooted: 0, lastRun: Date.now(), lastHalted: null, commands: [], // online: Open links are greyed out for an offline Engine
  ...(withLan ? { lanAddress: KIT_IP[id] } : {}),
});

const app = (id: string, name: string): App => ({
  id, name, version: '1.0', title: name, description: null,
  url: null, category: 'education', icon: null, author: null,
});

const instance = (engineId: string, appId: string, name: string, port: number | undefined): Instance => ({
  id: KIT_APP[engineId].inst, instanceOf: appId, name, status: 'Running',
  port: port as number,
  serviceImages: [], created: 0, lastBackup: null, lastStarted: 0, storedOn: `disk-${engineId}`,
  statusCondition: null, currentStep: null, totalSteps: null, stepLabel: null, metrics: null,
});

const disk = (engineId: string): Disk => ({
  id: `disk-${engineId}`, name: `Disk ${KIT_NAME[engineId]}`, device: 'sda', created: 0, lastDocked: 0,
  dockedTo: engineId, diskTypes: ['app'], backupConfig: null,
} as unknown as Disk);

/**
 * The kit store. `withLan` = Engines publish lanAddress (the live kit does
 * not, 2026-10-17). `ports` overrides an instance port (undefined / 0 = broken).
 */
export function kitStore(opts: { withLan?: boolean; ports?: Partial<Record<string, number | undefined>> } = {}): Store {
  const withLan = opts.withLan ?? false;
  const portOf = (e: string): number | undefined =>
    opts.ports && e in opts.ports ? opts.ports[e] : KIT_APP[e].port;
  const ids = [KIT.KP, KIT.HZ, KIT.SR];
  return {
    engineDB: Object.fromEntries(ids.map((e) => [e, kitEngine(e, withLan)])),
    diskDB: Object.fromEntries(ids.map((e) => [`disk-${e}`, disk(e)])),
    appDB: {
      'app-kolibri': app('app-kolibri', 'kolibri'),
      'app-nextcloud': app('app-nextcloud', 'nextcloud'),
      'app-wikipedia': app('app-wikipedia', 'wikipedia'),
    },
    instanceDB: {
      [KIT_APP[KIT.KP].inst]: instance(KIT.KP, 'app-kolibri', 'kolibri', portOf(KIT.KP)),
      [KIT_APP[KIT.HZ].inst]: instance(KIT.HZ, 'app-nextcloud', 'nextcloud', portOf(KIT.HZ)),
      [KIT_APP[KIT.SR].inst]: instance(KIT.SR, 'app-wikipedia', 'wikipedia', portOf(KIT.SR)),
    },
    userDB: {},
    operationDB: {},
  } as unknown as Store;
}
