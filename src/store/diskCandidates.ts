/**
 * Disk roles selector (idea#303 point 3; Engine shape: agent-engine-dev#247): one entry per physical non-IDEA disk
 * with the roles it can take. This is the ONLY place that knows how the
 * Engine describes them, so the shape can change here alone once Axle
 * confirms it on idea#303. Three sources, best first:
 *  1. `diskCandidates` capability: Engine.diskCandidates (Axle's proposal).
 *  2. `diskRolesV2` capability: merge newDisks / clientCards / unformattedDisks
 *     on one shared candidateId (Pixel's proposal).
 *  3. Neither (older Engine): today's behaviour, unchanged: Initialise list =
 *     newDisks minus clientCards ids (initialisableDisks), Flash = clientCards.
 */
import { clientCardsOf, hasCap, initialisableDisks, needsErase as listedUnformatted, newDisksOf } from './clientCards';
import type { CardContents, DiskCandidate, DiskKind, Engine } from '../types/store';

export type DiskRoleAction = 'makeIdeaDisk' | 'makeClientDisk';
export type DiskRolesSource = 'diskCandidates' | 'diskRolesV2' | 'legacy';

export interface DiskRoleEntry {
  candidateId: string;
  /** Display order: Make IDEA disk first, then Make classroom computer disk. */
  actions: DiskRoleAction[];
  /** Make IDEA disk must Erase first (no ext4 on the disk). */
  needsErase: boolean;
  kind: DiskKind | null;
  model: string | null;
  sizeBytes: number;
  contents: CardContents | null;
  /** Reader the medium sits in (SD cards), for the label. */
  readerId: string | null;
  /** Engine-reported reason flash can't run now (diskCandidates source only). */
  flashRefusal: string | null;
  /** idea#163: IDEA-IGNORE marker seen (diskCandidates source only; actions stay as sent). */
  ignored: boolean;
}

export const diskRolesSource = (engine: Engine | undefined): DiskRolesSource =>
  hasCap(engine, 'diskCandidates') ? 'diskCandidates' : hasCap(engine, 'diskRolesV2') ? 'diskRolesV2' : 'legacy';

/** One shared entry per disk applies (sources 1 and 2); legacy keeps two lists. */
export const hasDiskRoles = (engine: Engine | undefined): boolean => diskRolesSource(engine) !== 'legacy';

const ORDER: DiskRoleAction[] = ['makeIdeaDisk', 'makeClientDisk'];
const ordered = (s: Set<DiskRoleAction>): DiskRoleAction[] => ORDER.filter((a) => s.has(a));

/**
 * Engine #247: buttons come strictly from `actions`. `initialise` and `erase`
 * are never both set; an OS-rootfs disk (old Engine stick/SSD) gets ['flash']
 * only. `removable` (kernel rm flag) only picks the stick/SSD copy, never an action.
 */
/** idea#163: only an explicit `ignored: true` counts; missing = today's behaviour. */
export const isIgnoredCandidate = (c: DiskCandidate): boolean => c.ignored === true;

const fromCandidates = (engine: Engine | undefined): DiskRoleEntry[] =>
  (engine?.diskCandidates ?? []).map((c) => {
    const acts = new Set<DiskRoleAction>();
    if (c.actions.includes('initialise') || c.actions.includes('erase')) acts.add('makeIdeaDisk');
    if (c.actions.includes('flash')) acts.add('makeClientDisk');
    const kind: DiskKind = c.kind === 'sdCard' ? 'sdReader' : c.removable ? 'stick' : 'ssd';
    return {
      candidateId: c.candidateId,
      actions: ordered(acts),
      needsErase: c.actions.includes('erase') && !c.actions.includes('initialise'),
      kind,
      model: c.model,
      sizeBytes: c.sizeBytes,
      contents: c.contents,
      readerId: c.readerId,
      flashRefusal: c.flashRefusal,
      ignored: isIgnoredCandidate(c),
    };
  });

const merged = (engine: Engine | undefined): DiskRoleEntry[] => {
  const byId = new Map<string, DiskRoleEntry & { acts: Set<DiskRoleAction> }>();
  const get = (candidateId: string) => {
    let e = byId.get(candidateId);
    if (!e) {
      e = { candidateId, actions: [], acts: new Set(), needsErase: false, kind: null, model: null, sizeBytes: 0, contents: null, readerId: null, flashRefusal: null, ignored: false };
      byId.set(candidateId, e);
    }
    return e;
  };
  for (const d of newDisksOf(engine)) {
    const e = get(d.candidateId);
    e.acts.add('makeIdeaDisk');
    e.kind = e.kind ?? d.kind ?? null;
    e.model = e.model ?? d.model;
    e.sizeBytes = e.sizeBytes || d.sizeBytes;
    e.contents = e.contents ?? d.contents;
    e.readerId = e.readerId ?? d.readerId;
  }
  for (const c of clientCardsOf(engine)) {
    const e = get(c.candidateId);
    e.acts.add('makeClientDisk');
    e.kind = e.kind ?? c.kind ?? null;
    e.model = e.model ?? c.model;
    e.sizeBytes = e.sizeBytes || c.sizeBytes;
    e.contents = e.contents ?? c.contents;
    e.readerId = e.readerId ?? c.readerId;
  }
  // An SD card in a reader is never an IDEA disk, whatever list it shows up in.
  return [...byId.values()].map(({ acts, ...e }) => {
    if (e.kind === 'sdReader') acts.delete('makeIdeaDisk');
    const actions = ordered(acts);
    return { ...e, actions, needsErase: actions.includes('makeIdeaDisk') && listedUnformatted(engine, e.candidateId) };
  });
};

const legacy = (engine: Engine | undefined): DiskRoleEntry[] => [
  ...initialisableDisks(engine).map((d) => ({
    candidateId: d.candidateId, actions: ['makeIdeaDisk'] as DiskRoleAction[], needsErase: listedUnformatted(engine, d.candidateId),
    kind: null, model: d.model, sizeBytes: d.sizeBytes, contents: d.contents, readerId: d.readerId, flashRefusal: null, ignored: false,
  })),
  ...clientCardsOf(engine).map((c) => ({
    candidateId: c.candidateId, actions: ['makeClientDisk'] as DiskRoleAction[], needsErase: false,
    kind: null, model: c.model, sizeBytes: c.sizeBytes, contents: c.contents, readerId: c.readerId, flashRefusal: null, ignored: false,
  })),
];

/** Pure: one entry per candidateId (legacy: today's two lists, unchanged). */
export const diskRoleEntries = (engine: Engine | undefined): DiskRoleEntry[] => {
  switch (diskRolesSource(engine)) {
    case 'diskCandidates': return fromCandidates(engine);
    case 'diskRolesV2': return merged(engine);
    default: return legacy(engine);
  }
};

export const findDiskRoleEntry = (engine: Engine | undefined, candidateId: string): DiskRoleEntry | undefined =>
  diskRoleEntries(engine).find((e) => e.candidateId === candidateId);

export const ACTION_LABEL: Record<DiskRoleAction, string> = {
  makeIdeaDisk: 'Make IDEA disk',
  makeClientDisk: 'Make classroom computer disk',
};

/** Flash copy per kind; an SSD is for booting a classroom computer from USB. */
export const flashCopy = (kind: DiskKind | null): string =>
  kind === 'ssd'
    ? 'A flashed SSD is for booting a classroom computer from USB.'
    : 'Writes the classroom computer image to this disk. Everything on it is replaced.';
