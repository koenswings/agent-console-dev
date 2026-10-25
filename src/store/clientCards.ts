/**
 * Client cards adapter (idea#201 §10.2): the ONE place that knows the Engine's
 * client-card store fields and commands (Engine #219, contract v2). Commands
 * are space-split by the Engine: ids only; an id with whitespace throws.
 */
import { engineHasCapability, getSendCommandFn } from './commands';
import type { CommandTrace } from '../types/commandLog';
import type {
  CardContents,
  CardReader,
  ClientCard,
  ClientImage,
  ClientImageStore,
  Engine,
  FlashStep,
  NewDisk,
  Operation,
  Store,
} from '../types/store';

// ── Capabilities (contract §0) ──────────────────────────────────────────────
export const CAP = {
  unknownDiskReadOnly: 'unknownDiskReadOnly',
  clientCards: 'clientCards',
  flashCard: 'flashCard',
  clientImages: 'clientImages',
  diskRolesV2: 'diskRolesV2',
  diskCandidates: 'diskCandidates',
} as const;

export const hasCap = (engine: Engine | null | undefined, cap: keyof typeof CAP): boolean =>
  engineHasCapability(engine, CAP[cap]);

/** Hints shown when a capability is missing (the action is disabled, never faked). */
export const CAP_HINT = {
  clientCards: 'This Engine does not list client cards yet. Update the Engine to flash cards here.',
  flashCard: 'This Engine cannot flash cards yet (flash helper not installed or Engine too old).',
  clientImages: 'This Engine has no client image list yet. Update the Engine.',
  unknownDiskReadOnly: 'This Engine still claims new disks by itself. Update the Engine to initialise disks here.',
} as const;

// ── Store access (contract §1) ──────────────────────────────────────────────
export const engineOf = (store: Store | null, engineId: string): Engine | undefined =>
  store?.engineDB?.[engineId];

export const clientCardsOf = (engine: Engine | undefined): ClientCard[] => engine?.clientCards ?? [];
export const cardReadersOf = (engine: Engine | undefined): CardReader[] => engine?.cardReaders ?? [];
export const newDisksOf = (engine: Engine | undefined): NewDisk[] => engine?.newDisks ?? [];
export const clientImagesOf = (engine: Engine | undefined): ClientImageStore | null => engine?.clientImages ?? null;

export const findClientCard = (engine: Engine | undefined, candidateId: string): ClientCard | undefined =>
  clientCardsOf(engine).find((c) => c.candidateId === candidateId);

export const findNewDisk = (engine: Engine | undefined, candidateId: string): NewDisk | undefined =>
  newDisksOf(engine).find((d) => d.candidateId === candidateId);

/** The reader a card sits in (by readerId, else the reader that names this candidate). */
export const readerForCard = (engine: Engine | undefined, card: Pick<ClientCard, 'candidateId' | 'readerId'>): CardReader | undefined => {
  const readers = cardReadersOf(engine);
  return (card.readerId ? readers.find((r) => r.id === card.readerId) : undefined)
    ?? readers.find((r) => r.candidateId === card.candidateId);
};

/** New disks that are not client cards: candidates for Initialise. */
export const initialisableDisks = (engine: Engine | undefined): NewDisk[] => {
  const cards = new Set(clientCardsOf(engine).map((c) => c.candidateId));
  return newDisksOf(engine).filter((d) => !cards.has(d.candidateId));
};

/** Only verified images can be flashed, current first, then previous, then the rest. */
export const flashableImages = (engine: Engine | undefined): ClientImage[] => {
  const st = clientImagesOf(engine);
  if (!st) return [];
  const rank = (v: string) => (v === st.current ? 0 : v === st.previous ? 1 : 2);
  return st.images.filter((i) => i.state === 'verified').sort((a, b) => rank(a.version) - rank(b.version));
};

export const currentImageVersion = (engine: Engine | undefined): string | null => clientImagesOf(engine)?.current ?? null;

/**
 * Contract v2 (one id space): a non-ext4 new disk is listed in newDisks AND in
 * unformattedDisks under the same candidateId. It must be erased before
 * initialiseDisk (which otherwise refuses with NOT_EXT4).
 */
export const needsErase = (engine: Engine | undefined, candidateId: string): boolean =>
  (engine?.unformattedDisks ?? []).some((u) => u?.candidateId === candidateId);

/** The Operation for a flash/initialise on this candidate (newest first). */
export const findDiskOperation = (
  store: Store | null,
  engineId: string,
  kind: 'flashCard' | 'initialiseDisk',
  candidateId: string,
  since = 0,
): Operation | undefined =>
  Object.values(store?.operationDB ?? {})
    .filter((o) => o && o.kind === kind && String(o.engineId) === engineId && o.subject?.type === 'disk'
      && o.subject.id === candidateId && (o.startedAt ?? 0) >= since)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];

/**
 * BUSY, derived from the Operations (agent-engine-dev#219): during a flash the
 * Engine marks EVERY card BUSY, the target included, and the remaining cards'
 * refusal can lag behind the Operation going Done. So:
 *  - the card being flashed is never BUSY (the dialog's progress covers it);
 *  - once the flash Operation is terminal and no disk Operation is active,
 *    a leftover BUSY refusal (or a lingering flashInProgress) is ignored;
 *  - with no Operation info at all, the Engine's refusal is honoured.
 */
const DISK_OP_KINDS = new Set(['flashCard', 'initialiseDisk', 'eraseDisk']);
const isActive = (o: Operation | undefined): boolean => !!o && (o.status === 'Pending' || o.status === 'Running');

export interface BusyState {
  /** A disk Operation (or an unconfirmed flashInProgress) is running on this Engine. */
  active: boolean;
  /** candidateIds the active Operations work on (exempt from their own BUSY). */
  targets: Set<string>;
  /** A disk Operation on this Engine reached Done/Failed: a BUSY refusal can be stale. */
  anyTerminal: boolean;
}

export const busyState = (store: Store | null, engineId: string): BusyState => {
  const engine = engineOf(store, engineId);
  const ops = Object.values(store?.operationDB ?? {})
    .filter((o) => o && DISK_OP_KINDS.has(o.kind) && String(o.engineId) === engineId);
  const active = ops.filter(isActive);
  const targets = new Set(active.filter((o) => o.subject?.type === 'disk').map((o) => String(o.subject!.id)));
  const fip = engine?.flashInProgress;
  const fipOp = fip?.operationId ? store?.operationDB?.[fip.operationId] : undefined;
  const fipLive = !!fip && (!fipOp || isActive(fipOp));
  if (fipLive && fip!.candidateId) targets.add(fip!.candidateId);
  return { active: active.length > 0 || fipLive, targets, anyTerminal: ops.some((o) => !isActive(o)) };
};

/** The refusal to show for a card, with BUSY corrected per busyState. */
export const effectiveRefusal = (b: BusyState, card: ClientCard): { flashable: boolean; refusal: ClientCard['refusal'] } => {
  const isTarget = b.targets.has(card.candidateId);
  if (card.refusal === 'BUSY' && (isTarget || (!b.active && b.anyTerminal))) return { flashable: true, refusal: null };
  if (!card.flashable || card.refusal) return { flashable: card.flashable, refusal: card.refusal };
  if (b.active && !isTarget) return { flashable: false, refusal: 'BUSY' };
  return { flashable: true, refusal: null };
};

// ── Display text ────────────────────────────────────────────────────────────
export const contentsLabel = (c: CardContents | null | undefined): string => {
  switch (c?.kind) {
    case 'idea-client':
      return c.version ? `IDEA client image ${c.version}` : (c.imageName || 'IDEA client image');
    case 'raspios': return 'Raspberry Pi OS';
    case 'ubuntu': return 'Ubuntu';
    case 'empty': return 'empty';
    case 'other': return c.summary || 'other files';
    case 'unknown': return 'unknown (could not be read)';
    default: return 'unknown (could not be read)';
  }
};

export const FLASH_STEP_LABELS: Record<FlashStep, string> = {
  checking: 'Checking the card',
  'verifying-image': 'Checking the image',
  writing: 'Writing',
  'reading-back': 'Reading back to verify',
  flushing: 'Finishing the write',
  'powering-off': 'Switching the card off',
};
export const FLASH_STEP_COUNT = 6;
const FLASH_STEP_ORDER = Object.keys(FLASH_STEP_LABELS);

/**
 * 1-based step number for "Step N of 6". Engine #219 writes a 0-based
 * `currentStep` (index into its FLASH_STEPS), so the number comes from the
 * step label; currentStep + 1 is only the fallback for an unknown label.
 */
export const flashStepNumber = (stepLabel: string | null | undefined, currentStep: number | null | undefined): number => {
  const i = stepLabel ? FLASH_STEP_ORDER.indexOf(stepLabel) : -1;
  if (i >= 0) return i + 1;
  return currentStep != null ? currentStep + 1 : 0;
};

/** Plain, teacher-facing text per contract §5 code. */
export const ERROR_TEXT: Record<string, string> = {
  NOT_FOUND: 'The card is no longer in the reader.',
  NOT_REMOVABLE: 'This is not a removable card or USB disk, so it cannot be flashed.',
  SYSTEM_DISK: "This is the Pi's own system disk. It is never flashed.",
  BOOT_DEVICE: 'The Engine runs from this disk. It is never flashed.',
  HAS_IDEA_META: 'This is an IDEA disk. IDEA disks are never flashed.',
  ALREADY_IDEA: 'This disk is already an IDEA disk.',
  MOUNTED: 'The disk is in use (a part of it is mounted). Remove it from use first.',
  IN_USE_BY_APP: 'An app is using this disk. Stop the app first.',
  BUSY: 'Another flash, erase or initialise is running on this Pi. Wait for it to finish.',
  SIZE_CHANGED: 'The card changed since you opened this dialog. Check the card and try again.',
  MEDIUM_SWAPPED: 'The card was swapped or removed during the write. Put the card back and flash again.',
  IMAGE_NOT_FOUND: 'That image version is not on this Pi.',
  IMAGE_BAD_SHA: 'The image file on this Pi is damaged. It will be copied again.',
  IMAGE_TOO_LARGE: 'The image does not fit on this card. Use a bigger card.',
  WRITE_FAILED: 'Writing to the card failed. The card may be faulty; try another card.',
  VERIFY_FAILED: 'The check after writing failed. The card may be faulty; try another card.',
  NOT_EXT4: 'This disk is not formatted for IDEA yet. Erase it first, then initialise it.',
  POWER_OFF_FAILED: 'The card was written, but could not be switched off. Eject it before removing it.',
  INTERRUPTED: 'The Pi restarted during the operation. Flash the card again.',
  CANCELLED: 'Flash cancelled. The card is now wiped; flash it again before use.',
  BAD_ARGS: 'The Engine did not understand the request. Update the Console or the Engine.',
  HELPER_MISSING: 'This Pi cannot flash cards yet (flash helper not installed).',
};

/** "CODE: text" → { code, text }. Unknown codes keep the Engine's text (never hidden). */
export const parseEngineError = (raw: string | null | undefined): { code: string | null; text: string } => {
  const msg = String(raw ?? '').trim();
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(msg);
  if (!m) return { code: null, text: msg || 'The Engine reported an error without a message.' };
  const code = m[1];
  return { code, text: ERROR_TEXT[code] ?? `${m[2] || code} (${code})` };
};

export const errorText = (raw: string | null | undefined): string => parseEngineError(raw).text;

// ── Trace result (contract §3) ──────────────────────────────────────────────
export interface FlashTraceResult {
  candidateId?: string;
  version?: string;
  bytesWritten?: number;
  safeToRemove?: boolean;
}

export const parseFlashResult = (trace: CommandTrace | null | undefined): FlashTraceResult | null => {
  if (!trace?.result) return null;
  try {
    const r = typeof trace.result === 'string' ? JSON.parse(trace.result) : trace.result;
    return r && typeof r === 'object' ? (r as FlashTraceResult) : null;
  } catch {
    return null;
  }
};

// ── Commands (contract §2) ──────────────────────────────────────────────────
const assertId = (what: string, v: string): string => {
  const s = String(v ?? '');
  if (!s || /\s/.test(s)) throw new Error(`Refusing to send a ${what} with whitespace or empty: "${s}"`);
  return s;
};

export type InitialiseType = 'empty' | 'files' | 'backup';

export const buildInitialiseDiskCommand = (candidateId: string, diskType: InitialiseType = 'empty'): string =>
  `initialiseDisk ${assertId('candidateId', candidateId)} ${diskType}`;

export const buildFlashCardCommand = (candidateId: string, version: string, confirmSizeBytes: number): string => {
  if (!Number.isSafeInteger(confirmSizeBytes) || confirmSizeBytes <= 0) {
    throw new Error(`Refusing to flash: invalid confirm size ${confirmSizeBytes}`);
  }
  return `flashCard ${assertId('candidateId', candidateId)} ${assertId('version', version)} ${confirmSizeBytes}`;
};

export const buildCancelFlashCommand = (operationId: string): string =>
  `cancelFlash ${assertId('operationId', operationId)}`;

export const initialiseDisk = (engineId: string, candidateId: string, diskType: InitialiseType = 'empty'): void =>
  getSendCommandFn()(engineId, buildInitialiseDiskCommand(candidateId, diskType));

export const flashCard = (engineId: string, candidateId: string, version: string, confirmSizeBytes: number): void =>
  getSendCommandFn()(engineId, buildFlashCardCommand(candidateId, version, confirmSizeBytes));

export const cancelFlash = (engineId: string, operationId: string): void =>
  getSendCommandFn()(engineId, buildCancelFlashCommand(operationId));

/** Trace commands, for following the target Engine's command log. */
export const TRACE = { flash: 'flashCard', initialise: 'initialiseDisk', cancel: 'cancelFlash' } as const;
