# Design Doc 004 — Console: Backup Disk Management

| Field | Value |
|---|---|
| Status | Proposed |
| Author | Pixel |
| Date | 2026-04-04 |
| Supersedes | — |
| Engine design | agent-engine-dev/design/backup-disk.md (Axle, 2026-04-04) |

---

## Problem

Operators need a way to protect app instance data against disk failure. The Engine's backup
design (Axle's `backup-disk.md`) defines the storage layer: BorgBackup archives, `BACKUP.yaml`
on disk, `lastBackup` in the Automerge store.

The Console is the only management interface. Operators use it to:
1. **Provision** an empty disk as a Backup Disk (write `BACKUP.yaml`, configure links and mode)
2. **Trigger** an on-demand backup for a specific instance
3. **Monitor** last backup time per instance

This design covers the Console side of all three.

---

## Engine Dependencies

This design requires four additions from Axle. These are blockers before implementation.

### 1. `Disk.diskType` field

The Console needs to classify each docked disk without reading the filesystem. The Engine sets
this during `processDisk`:

```typescript
export type DiskType = 'app' | 'backup' | 'empty';

export interface Disk {
  // ... existing fields ...
  diskType: DiskType;         // set by Engine during processDisk
  backupConfig: BackupDiskConfig | null;  // non-null for 'backup' disks; see below
}
```

`diskType` maps directly to the existing detection logic:

| `isAppDisk` | `isBackupDisk` | Result |
|---|---|---|
| true | false | `'app'` |
| false | true | `'backup'` |
| false | false | `'empty'` |

Multi-purpose disks (app + backup simultaneously) are out of scope for V1; set `diskType` to the
first match in the order above.

### 2. `Disk.backupConfig` field

When `diskType === 'backup'`, the Engine reads `BACKUP.yaml` and reflects its contents into
the store so the Console can display links and mode without filesystem access:

```typescript
export interface BackupDiskConfig {
  mode: 'immediate' | 'on-demand';
  links: InstanceID[];         // list of linked instance IDs
}
```

Set by `processBackupDisk`. Cleared to `null` when the disk undocks.

### 3. `Instance.lastBackup` field

Axle's design specifies `lastBackup: Timestamp | null`. The current Engine code has
`lastBackedUp: Timestamp` (initialised to `0`). Axle should reconcile these:

- **Preferred:** rename `lastBackedUp` → `lastBackup` and change type to `Timestamp | null`,
  where `null` means never backed up (instead of the current sentinel `0`).
- **If rename causes migration pain:** add `lastBackup` alongside `lastBackedUp` and deprecate
  the old field. Console will read `lastBackup` only.

The Console treats `null`, `undefined`, and `0` identically: "never backed up".

### 4. `createBackupDisk` command

A new Engine command that provisions an empty disk as a Backup Disk:

```
createBackupDisk <diskName> <mode> <instanceId> [<instanceId> ...]
```

- `diskName` — the `Disk.name` of the target empty disk
- `mode` — `immediate` or `on-demand`
- `instanceId` — one or more instance IDs to link

**Engine behaviour on receiving this command:**
1. Verify `diskName` resolves to a docked disk with `diskType === 'empty'`; error if not
2. Write `BACKUP.yaml` to `/disks/<device>/` with the given mode and links
3. Run `processDisk` on the disk (which calls `processBackupDisk`, sets `diskType` and
   `backupConfig` in the store, and may trigger auto-backup if `mode === 'immediate'`)

`borg init` is **not** called here — it runs on first `backupInstance` as specified in
Axle's design.

---

## Store Type Changes (Console-side)

Update `src/types/store.ts` to mirror the Engine changes above:

```typescript
// New types
export type DiskType = 'app' | 'backup' | 'empty';

export interface BackupDiskConfig {
  mode: 'immediate' | 'on-demand';
  links: InstanceID[];
}

// Updated Disk interface
export interface Disk {
  id: DiskID;
  name: DiskName;
  device: DeviceName | null;
  created: Timestamp;
  lastDocked: Timestamp;
  dockedTo: EngineID | null;
  diskType: DiskType;                        // NEW
  backupConfig: BackupDiskConfig | null;     // NEW — non-null when diskType === 'backup'
}

// Updated Instance interface
export interface Instance {
  id: InstanceID;
  instanceOf: AppID;
  name: InstanceName;
  status: Status;
  port: PortNumber;
  serviceImages: ServiceImage[];
  created: Timestamp;
  lastBackup: Timestamp | null;              // UPDATED — was lastBackedUp: Timestamp
  lastStarted: Timestamp;
  storedOn: DiskID | null;
}
```

---

## UI Design

Backup disk management is **operator-only**. Nothing in this design touches the user mode UI.

### Where it appears

The operator view already has a header bar and `OperatorManagement` panel. Backup features
appear in two places:

1. **DiskManager panel** — new operator section; shows all docked disks; entry point for
   provisioning and backup triggers
2. **AppCard (operator mode)** — `lastBackup` annotation and "Backup Now" button added to
   each instance card

The DiskManager is a new tab/section alongside the existing `OperatorManagement`. Exact
placement TBD with Koen — for now, design it as a collapsible section below `OperatorManagement`
within the operator sidebar/panel.

---

### Component: `DiskManager`

**File:** `src/components/DiskManager.tsx`  
**Visibility:** operator mode only  
**Data:** reads `store.diskDB` from the Automerge signal

Renders three groups, each only shown if non-empty:

#### Empty Disks
```
📀 sdb1 (Empty)        [Configure as Backup Disk]
```
- One row per empty disk (where `disk.diskType === 'empty'` and `disk.dockedTo` is non-null)
- "Configure as Backup Disk" button opens `BackupDiskSetup` modal

#### Backup Disks
```
💾 backup-disk-1 (Backup · on-demand)
   Linked instances:
     • kolibri-abc123    Last backup: 2 hours ago      [Backup Now]
     • nextcloud-def456  Last backup: Never            [Backup Now]
```
- One section per backup disk (`diskType === 'backup'`)
- Shows mode badge: `immediate` or `on-demand`
- For each linked instance (`backupConfig.links`): name, `lastBackup` formatted time,
  "Backup Now" button
- "Backup Now" disabled if instance is not currently docked (i.e. `instance.storedOn === null`
  or instance not in `instanceDB`)
- `immediate` mode note: "Backups run automatically when both disks are docked"

#### App Disks
```
💿 app-disk-1 (App Disk)   3 instances
```
- One row per app disk
- Shows instance count; no actions here (instances managed via AppBrowser)

If no disks of any type are docked, shows: *"No disks docked."*

---

### Component: `BackupDiskSetup` (modal)

**File:** `src/components/BackupDiskSetup.tsx`  
**Trigger:** "Configure as Backup Disk" button in DiskManager  
**Props:** `disk: Disk; onClose: () => void`

```
Configure Backup Disk
──────────────────────────────
Disk:  backup-disk-1

Mode:
  ○ Immediate  — backs up automatically when both disks are docked
  ● On-demand  — backs up only when you click "Backup Now"

Link instances:
  ☑ kolibri-abc123   (Kolibri)
  ☐ nextcloud-def456 (Nextcloud)

  [Cancel]   [Create Backup Disk]
```

**Behaviour:**
- Mode defaults to `on-demand` (safer for first-time users)
- Instance list is the full `instanceDB`; all start unchecked
- At least one instance must be checked to enable "Create Backup Disk"
- On submit: `sendCommand(engineId, 'createBackupDisk ${disk.name} ${mode} ${selectedIds.join(' ')}')`
- Button text changes to "Creating…" while waiting for `disk.diskType` to update to `'backup'`
  in the store (reactive: closes automatically when `disk.diskType === 'backup'`)
- If the store update does not arrive within 10 seconds, show error: "Command sent — check
  Engine logs if the disk does not appear as a Backup Disk"

**`engineId` resolution:** use the `disk.dockedTo` field to target the correct Engine's command
queue. This is important in multi-engine networks where the Console connects to the local Engine
but the disk may be docked to a different peer Engine.

---

### AppCard changes (operator mode)

The existing `AppCard` already has running/stopped states. In operator mode, add:

**`lastBackup` line:**
```
Last backup: 2 hours ago
```
or
```
Last backup: Never
```
Shown for all instances in operator mode. Uses `formatRelativeTime(instance.lastBackup)` helper
(see below).

**"Backup Now" button:**
- Visible in operator mode only
- Enabled when: `instanceHasLinkedBackupDisk(store, instance.id)` returns true
  (i.e. at least one docked Backup Disk has this instance in its `backupConfig.links`)
- Disabled (with tooltip "No Backup Disk linked") when no linked disk is docked
- On click: `sendCommand(engineId, 'backupApp ${instance.id}')`
- After click: button becomes "Backing up…" until `instance.lastBackup` updates in the store
  (reactive). If no update within 30 seconds, revert label and show brief error note.

**`engineId` for `backupApp`:** resolve via `instance.storedOn → diskDB[...].dockedTo`.

---

## Helper Functions

Two pure utility functions added to `src/store/backup.ts` (new file):

### `formatRelativeTime(ts: Timestamp | null | undefined): string`

```typescript
export function formatRelativeTime(ts: Timestamp | null | undefined): string {
  if (!ts) return 'Never';
  const diffMs = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}
```

### `instanceHasLinkedBackupDisk(store: Store, instanceId: InstanceID): boolean`

```typescript
export function instanceHasLinkedBackupDisk(store: Store, instanceId: InstanceID): boolean {
  return Object.values(store.diskDB).some(
    disk =>
      disk.diskType === 'backup' &&
      disk.dockedTo !== null &&
      disk.backupConfig?.links.includes(instanceId)
  );
}
```

---

## Mock Store Updates

`src/mock/mockStore.ts` needs:
1. `diskType: 'app'` added to all existing mock `Disk` entries
2. `backupConfig: null` added to all existing mock `Disk` entries
3. `lastBackup: null` on all mock `Instance` entries (replacing `lastBackedUp: 0`)
4. A mock `Backup Disk` entry with `diskType: 'backup'`, `backupConfig: { mode: 'on-demand', links: ['kolibri-...'] }` — enables rendering DiskManager in demo mode

---

## Tests

New test file: `src/__tests__/backup.test.ts`

| Test | Coverage |
|---|---|
| `formatRelativeTime(null)` → `'Never'` | null/undefined handling |
| `formatRelativeTime(Date.now())` → `'Just now'` | zero-delta |
| `formatRelativeTime(Date.now() - 90_000)` → `'1 minute ago'` | minutes |
| `formatRelativeTime(Date.now() - 3_600_000 * 3)` → `'3 hours ago'` | hours |
| `formatRelativeTime(Date.now() - 86_400_000 * 2)` → `'2 days ago'` | days |
| `instanceHasLinkedBackupDisk` — linked disk docked → true | happy path |
| `instanceHasLinkedBackupDisk` — no backup disk in store → false | no disk |
| `instanceHasLinkedBackupDisk` — backup disk undocked (dockedTo null) → false | undocked |
| `instanceHasLinkedBackupDisk` — disk docked but instance not in links → false | unlinked |
| `DiskManager` renders empty state when diskDB empty | render |
| `DiskManager` renders empty disk with "Configure" button | empty disk |
| `DiskManager` renders backup disk with linked instances | backup disk |
| `BackupDiskSetup` shows all instances from instanceDB | instance list |
| `BackupDiskSetup` disables submit with no instances selected | validation |
| `BackupDiskSetup` calls sendCommand with correct args on submit | command |
| `AppCard` (operator mode) shows "Never" when lastBackup null | display |
| `AppCard` (operator mode) shows "Backup Now" when disk linked | button |
| `AppCard` (operator mode) hides "Backup Now" when no disk linked | button |

---

## Out of Scope (V1)

- **Scheduled mode** (`mode: 'scheduled'`) — deferred by Axle; no Console support until Engine implements it
- **Restore flow** — `restoreApp` command exists in Axle's design; Console UI for it is a separate task
- **Editing links after creation** — adding/removing linked instances from an existing Backup Disk is a future iteration
- **Cross-engine backup** — deferred; both disks must be on the same Engine (V1 constraint from Axle's design)
- **Multiple Backup Disks for one instance** — not supported in V1; first docked disk is used
- **Backup progress indicator** — the Engine doesn't expose backup-in-progress state in the store; add when available

---

## Implementation Order

1. Confirm Engine dependencies with Axle (store fields + `createBackupDisk` command)
2. Update `src/types/store.ts` — new fields
3. Update `src/mock/mockStore.ts` — demo data
4. Implement `src/store/backup.ts` — pure helper functions + tests
5. Implement `BackupDiskSetup` modal + tests
6. Implement `DiskManager` + tests
7. Update `AppCard` for operator mode — `lastBackup` + "Backup Now" + tests
8. Wire `DiskManager` into the operator layout in `App.tsx`
9. Run `pnpm test` — all tests pass before PR
