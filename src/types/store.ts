/**
 * Console-side mirror of Engine data types.
 * Plain TypeScript — no brand types needed in the Console.
 * Keep in sync with agent-engine-dev/src/data/*.ts
 */

// Primitive aliases (plain strings/numbers — no brands)
export type EngineID = string;
export type DiskID = string;
export type AppID = string;
export type InstanceID = string;
export type AppName = string;
export type InstanceName = string;
export type Version = string;
export type Hostname = string;
export type DiskName = string;
export type DeviceName = string;
export type PortNumber = number;
export type ServiceImage = string;
export type Timestamp = number;
export type Command = string;
export type AppURL = string;
export type AppCategory = string;

// Disk types — mirrors CommonTypes.ts
export type DiskType = 'app' | 'backup' | 'empty' | 'upgrade' | 'files';
export type BackupMode = 'immediate' | 'on-demand' | 'scheduled';

export interface BackupConfig {
  mode: BackupMode;
  links: InstanceID[]; // instance IDs this backup disk is configured for
}

// ---------------------------------------------------------------------------
// Engine — mirrors agent-engine-dev/src/data/Engine.ts
// ---------------------------------------------------------------------------
export interface Engine {
  id: EngineID;
  hostname: Hostname;
  version: Version;
  hostOS: string;
  created: Timestamp;
  lastBooted: Timestamp;
  lastRun: Timestamp;
  lastHalted: Timestamp | null;
  commands: Command[];
}

// ---------------------------------------------------------------------------
// Disk — mirrors agent-engine-dev/src/data/Disk.ts
// ---------------------------------------------------------------------------
export interface Disk {
  id: DiskID;
  name: DiskName;
  device: DeviceName | null;
  created: Timestamp;
  lastDocked: Timestamp;
  dockedTo: EngineID | null;
  diskTypes: DiskType[];              // types detected for this disk; empty array = unknown
  backupConfig: BackupConfig | null;  // set when disk is a Backup Disk; null otherwise
}

// ---------------------------------------------------------------------------
// App — mirrors agent-engine-dev/src/data/App.ts
// ---------------------------------------------------------------------------
export interface App {
  id: AppID;
  name: AppName;
  version: Version;
  title: string;
  description: string | null;
  url: AppURL | null;
  category: AppCategory;
  icon: AppURL | null;
  author: string | null;
  // Extended fields present on entries from Backup/Catalog Disks
  source?: 'disk' | 'github';
  sourceDiskId?: DiskID;
  sourceDiskName?: DiskName;
}

// ---------------------------------------------------------------------------
// DockerMetrics — live container stats written by the Engine on each heartbeat.
// Mirrors agent-engine-dev/src/data/Instance.ts (DockerMetrics sub-type).
// All fields are null when the instance is not Running.
// ---------------------------------------------------------------------------
export interface DockerMetrics {
  /** CPU usage as a percentage of all available cores (e.g. 2.34 = 2.34%) */
  cpuPercent:    number | null;
  /** Memory currently used by the container, in bytes */
  memUsageBytes: number | null;
  /** Hard memory limit for the container, in bytes (from cgroup) */
  memLimitBytes: number | null;
  /** Memory usage as a percentage of the limit */
  memPercent:    number | null;
  /** Total bytes received over the network since container start */
  netRxBytes:    number | null;
  /** Total bytes transmitted over the network since container start */
  netTxBytes:    number | null;
  /** Total bytes read from block devices since container start */
  blockReadBytes:  number | null;
  /** Total bytes written to block devices since container start */
  blockWriteBytes: number | null;
  /** Unix ms when these metrics were last sampled by the Engine */
  sampledAt:     Timestamp | null;
}

// ---------------------------------------------------------------------------
// Instance — mirrors agent-engine-dev/src/data/Instance.ts
// ---------------------------------------------------------------------------
export type Status =
  | 'Undocked'
  | 'Docked'
  | 'Starting'
  | 'Running'
  | 'Pauzed'
  | 'Stopped'
  | 'Missing'
  | 'Error';

export interface Instance {
  id: InstanceID;
  instanceOf: AppID;
  name: InstanceName;
  status: Status;
  port: PortNumber;
  serviceImages: ServiceImage[];
  created: Timestamp;
  lastBackup: Timestamp | null; // unix ms of last successful backup; null if never backed up
  lastStarted: Timestamp;
  storedOn: DiskID | null;
  /**
   * Human-readable description of why the instance is in Error state.
   * Written by the Engine when status transitions to 'Error'.
   * Null when status is not Error or no diagnosis is available.
   */
  statusCondition: string | null;
  /** Live Docker container metrics. Null when instance is not Running. */
  metrics: DockerMetrics | null;
}

// ---------------------------------------------------------------------------
// User — mirrors agent-engine-dev/src/data/User.ts
// Operators only — anonymous users are not stored.
// ---------------------------------------------------------------------------
export type UserID = string;
export type Username = string;
export type PasswordHash = string; // bcrypt hash — never plaintext

export interface User {
  id: UserID;
  username: Username;
  passwordHash: PasswordHash;
  role: 'operator';
  created: Timestamp;
}

// ---------------------------------------------------------------------------
// Operation — mirrors agent-engine-dev/src/data/Operation.ts
// Progress tracking for long-running engine operations written to operationDB.
// ---------------------------------------------------------------------------
export type OperationStatus = 'Pending' | 'Running' | 'Done' | 'Failed';
export type OperationKind = 'copyApp' | 'moveApp' | 'backupApp' | 'restoreApp' | 'upgradeApp' | 'upgradeEngine';
export type OperationID = string;

export interface Operation {
  id: OperationID;
  kind: OperationKind;
  args: Record<string, string>;
  engineId: EngineID;
  status: OperationStatus;
  progressPercent: number | null;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Store — mirrors agent-engine-dev/src/data/Store.ts
// ---------------------------------------------------------------------------
export interface Store {
  engineDB: Record<EngineID, Engine>;
  diskDB: Record<DiskID, Disk>;
  appDB: Record<AppID, App>;
  instanceDB: Record<InstanceID, Instance>;
  userDB: Record<UserID, User>;
  operationDB: Record<OperationID, Operation>;
}
