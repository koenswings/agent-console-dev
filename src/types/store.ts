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
export type DiskType = 'app' | 'backup' | 'empty' | 'upgrade' | 'files' | 'system';
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
  /**
   * This Engine's address on the school LAN (IPv4, e.g. from eth0/wlan0),
   * published by the Engine so learner devices that cannot resolve mDNS
   * `.local` names can still open its apps (Console App links, issue: Open
   * on another Pi). Absent on Engines that do not publish it yet: the
   * Console then falls back to `<hostname>.local`.
   */
  lanAddress?: string | null;
  /**
   * Feature flags, rewritten as a whole list at every Engine startup
   * (idea#128/#129). Absent on Engines older than Files Disk step 0b.
   */
  capabilities?: string[];
  /**
   * The `lastBooted` value of the startup that wrote `capabilities` (ms).
   * A rolled-back Engine updates `lastBooted` but not this stamp, so a
   * mismatch means the flags are stale.
   */
  capabilitiesBootedAt?: Timestamp;

  /**
   * Whole non-system disks without an ext4 filesystem on this Engine
   * (files-disk.md §7.5, idea#136). Present once the Engine has eraseDisk.
   */
  unformattedDisks?: UnformattedDisk[];
  /** idea#201 §10: devices without IDEA META.yaml, never written (rule 1). */
  newDisks?: NewDisk[];
  /** idea#201 §10: card readers on this Engine (with or without a card). */
  cardReaders?: CardReader[];
  /** idea#201 §10: flashable removable media present now (subset view of newDisks). */
  clientCards?: ClientCard[];
  /** idea#303: one entry per physical non-IDEA disk (Axle's proposal, capability `diskCandidates`). */
  diskCandidates?: DiskCandidate[];
  /** idea#201 §10: client images stored on this Engine. */
  clientImages?: ClientImageStore | null;
  /** idea#201 §10: set for the whole run of a flash; one at a time per Engine. */
  flashInProgress?: FlashInProgress | null;
  /**
   * FAT/exFAT USB sticks mounted read-only by this Engine (idea#193 §3.3).
   * Absent on Engines that do not publish sticks yet. A stick also stays in
   * `unformattedDisks` (same `device`) so it can still be erased.
   */
  usbSticks?: UsbStickPublic[];
  /**
   * At most one erase in progress on this Engine (idea#136). Cleared when
   * eraseDisk finishes; used for progress while the Disk record is gone.
   */
  eraseInProgress?: EraseInProgress | null;
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
  /** Files role settings from FILES.yaml (idea#131); null or absent otherwise. */
  filesConfig?: FilesConfig | null;
  /** Busy unmount on the last undock (idea#126), any disk type; kept after undock. */
  unmountError?: UnmountError | null;
  /** Filesystem size and free space in bytes (docked disks, idea#131); null or absent otherwise. */
  sizeBytes?: number | null;
  freeBytes?: number | null;
}

/** Files Disk settings — mirrors Disk.filesConfig (files-disk.md §7.5). */
export interface FilesConfig {
  shareName: string;
  readOnly: boolean;
  passwordProtected: boolean;
  /** Only set for a password-protected disk (not mounted). */
  error: string | null;
}


/** Unformatted (non-ext4) whole disk published by the Engine (idea#136). */
// ---------------------------------------------------------------------------
// idea#201 §10: new (unknown) disks, card readers, client cards, client images.
// Mirrors Axle's Engine API contract v2 (2026-10-15). All optional: older
// Engines do not publish them (the Console gates on Engine.capabilities).
// ---------------------------------------------------------------------------
export type CandidateID = string;
export type ReaderID = string;
export type ClientImageVersion = string;

export type CardContents =
  | { kind: 'idea-client'; imageName: string; version: ClientImageVersion | null }
  | { kind: 'raspios' }
  | { kind: 'ubuntu' }
  | { kind: 'empty' }
  | { kind: 'other'; summary: string }
  | { kind: 'unknown' };

/** Whole device WITHOUT IDEA META.yaml, looked at read-only (rule 1). */
export interface NewDisk {
  candidateId: CandidateID;
  device: string;
  byId: string;
  sizeBytes: number;
  model: string | null;
  serial: string | null;
  removable: boolean;
  readerId: ReaderID | null;
  partitions: { label: string | null; fsType: string | null; sizeBytes: number }[];
  contents: CardContents;
  mountedReadOnly: boolean;
  firstSeen: Timestamp;
  /** idea#303 (diskRolesV2): physical kind; absent on older Engines. */
  kind?: DiskKind;
}

/** idea#303: physical kind of a candidate (Pixel's proposal; pending confirmation on idea#303). */
export type DiskKind = 'stick' | 'ssd' | 'sdReader';

/** idea#303: Axle's proposed per-disk entry (pending confirmation on idea#303). */
export type DiskCandidateAction = 'initialise' | 'erase' | 'flash';
export interface DiskCandidate {
  candidateId: CandidateID;
  kind: 'usbDisk' | 'sdCard';
  device: string;
  sizeBytes: number;
  model: string | null;
  serial: string | null;
  removable: boolean;
  readerId: ReaderID | null;
  partitions: { label: string | null; fsType: string | null; sizeBytes: number }[];
  contents: CardContents;
  actions: DiskCandidateAction[];
  flashRefusal: FlashRefusal | null;
  mountedReadOnly: boolean;
  firstSeen: Timestamp;
  /** idea#163: true when the disk carries the IDEA-IGNORE marker. Absent on older Engines. */
  ignored?: boolean;
}

export interface CardReader {
  id: ReaderID;
  name: string;
  usbPath: string;
  hasMedium: boolean;
  candidateId: CandidateID | null;
}

export type FlashRefusal = string;

export interface ClientCard {
  candidateId: CandidateID;
  sizeBytes: number;
  model: string | null;
  readerId: ReaderID | null;
  contents: CardContents;
  flashable: boolean;
  refusal: FlashRefusal | null;
  /** idea#303 (diskRolesV2): physical kind; absent on older Engines. */
  kind?: DiskKind;
}

export interface ClientImage {
  version: ClientImageVersion;
  fileName: string;
  sizeBytes: number;
  imageSizeBytes: number | null;
  sha256: string;
  state: 'arriving' | 'verified' | 'bad-sha';
  source: { type: 'disk'; diskId: string } | { type: 'engine'; engineId: string } | { type: 'local' };
  addedAt: Timestamp;
}

export interface ClientImageStore {
  current: ClientImageVersion | null;
  previous: ClientImageVersion | null;
  images: ClientImage[];
}

export type FlashStep = 'checking' | 'verifying-image' | 'writing' | 'reading-back' | 'flushing' | 'powering-off';

export interface FlashInProgress {
  operationId: string;
  candidateId: CandidateID;
  version: ClientImageVersion;
  step: FlashStep;
}

/** A read-only USB stick on an Engine (idea#193 §3.3). Never an IDEA disk. */
export interface UsbStickPublic {
  /** 'usb-' + filesystem UUID, stable per stick. */
  stickId: string;
  /** Kernel device, e.g. 'sdb1'. */
  device: string;
  /** Filesystem label, or model, or 'USB stick'. */
  label: string;
  /** 'USB: MARY-STICK' (unique per Engine). */
  displayName: string;
  fsType: 'vfat' | 'exfat';
  sizeBytes: number;
  usedBytes: number;
  mountedAt: Timestamp;
  readOnly: true;
  /** Top-level `kolibri` folder on the stick (idea#193 §8.2a). Absent = unknown/false. */
  hasKolibriFolder?: boolean;
}

export interface UnformattedDisk {
  candidateId: string;
  device: string;
  sizeBytes: number;
  model: string | null;
  fsType: string | null;
  label: string;
}

/** Progress of eraseDisk on an Engine (files-disk.md §7.5, idea#136). */
export type EraseStep =
  | 'checking'
  | 'stopping and unmounting'
  | 'partitioning'
  | 'creating filesystem'
  | 'mounting';

export interface EraseInProgress {
  targetId: string;
  label: string;
  step: EraseStep;
}

/**
 * Content summary from summariseDisk (CommandTrace.result JSON, idea#136).
 * partial counts are shown as "at least" in the Console.
 */
export interface ContentSummary {
  targetId: string;
  label: string;
  model: string | null;
  sizeBytes: number;
  usedBytes: number | null;
  fsType: string | null;
  apps: { name: string; version: string }[];
  instances: { id: string; name: string; running: boolean; dataBytes: number | null }[];
  backups: { instanceId: string; instanceName: string; lastBackup: number | null; snapshots: number | null }[];
  files: { fileCount: number; totalBytes: number; partial: boolean } | null;
  other: { entryCount: number; totalBytes: number; partial: boolean } | null;
  otherPartitions: { device: string; fsType: string | null }[];
  readable: boolean;
  serial: string | null;
  computedAt: number;
}

/** Busy unmount — mirrors agent-engine-dev UnmountError (idea#126). */
export interface UnmountError {
  engineId: EngineID;
  mountPoint: string;       // e.g. /disks/sdb1
  fsUuid: string | null;
  message: string;
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
  /** Files Disk opt-in from x-app.filesMount (files-disk.md §7.5); null or absent = not opted in. */
  filesMount?: { path: string; services: string[] } | null;
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
  /** Step-based progress for start/stop operations. Written by the engine via setStep(). */
  currentStep: number | null;
  totalSteps: number | null;
  stepLabel: string | null;
  /** Live Docker container metrics. Null when instance is not Running. */
  metrics: DockerMetrics | null;
  /** Files Disks mounted into this instance, written after a successful compose up (idea#133). */
  filesMounts?: DiskID[];
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
/** idea#201 contract v2: a cancel ends Failed with error 'CANCELLED: ...' (no Cancelled status). */
export type OperationStatus = 'Pending' | 'Running' | 'Done' | 'Failed';
export type OperationKind =
  | 'copyApp'
  | 'moveApp'
  | 'backupApp'
  | 'restoreApp'
  | 'upgradeApp'
  | 'upgradeEngine'
  | 'startApp'
  | 'stopApp'
  // idea#201 §10 (Engine API contract v2)
  | 'flashCard'
  | 'initialiseDisk';

export type OperationCause =
  | 'console-command'
  | 'cli-command'
  | 'cross-engine-cmd'
  | 'post-copy'
  | 'post-move'
  | 'disk-docked'
  | 'disk-undocked'
  | 'backup-pre-stop'
  | 'backup-post-start'
  | 'backup-stale-lock'
  | 'backup-app-docked'
  | 'crash-recovery';

export interface OperationSubject {
  type: 'instance' | 'disk' | 'engine';
  id: string;
}

export type OperationID = string;

export interface Operation {
  id: OperationID;
  kind: OperationKind;
  args: Record<string, string>;
  /** What triggered this operation. */
  cause: OperationCause;
  /** The primary entity this operation acts on (for O(1) UI lookup). */
  subject: OperationSubject | null;
  engineId: EngineID;
  status: OperationStatus;
  progressPercent: number | null;
  /** Step progress — mirrored from instance fields for startApp/stopApp. */
  currentStep: number | null;
  totalSteps: number | null;
  stepLabel: string | null;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  error: string | null;
  /**
   * idea#201 contract v2 (flashCard): set together with Done. true = card powered
   * off, safe to pull; false = eject first (POWER_OFF_FAILED). Absent on other kinds.
   */
  safeToRemove?: boolean;
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
