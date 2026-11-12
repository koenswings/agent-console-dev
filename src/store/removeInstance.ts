/**
 * Remove an App instance from its disk (idea#347, option A: quarantine).
 * Engine shape (Axle's approach comment on idea#347): `removeInstance <instanceId>`,
 * capability `removeInstance`. Nothing is deleted: the instance folder moves to
 * `<disk>/.idea-quarantine/…` and its volumes are kept. Pure helpers only.
 */
import { engineHasCapability } from './commands';
import type { Engine, Instance } from '../types/store';
import { plainEngineText } from './plainError';

/** Plain words for teachers, shown in the confirm. */
export const removeConfirmText = (name: string): string =>
  `Remove ${name} from this disk? The app is taken off this disk. Its data is kept aside on the disk, not deleted.`;

export const REMOVE_STOP_FIRST = 'Stop the app first, then remove it.';
export const REMOVE_BUSY_HINT = 'Wait until the current operation is finished.';

/** Engine refusal codes → plain sentences (unknown codes: the Engine's own text). */
export const REMOVE_REFUSALS: Record<string, string> = {
  NOT_FOUND: 'This app is no longer on this disk.',
  NOT_LOCAL: 'This app is on a disk in another Engine. Remove it from that Engine.',
  AMBIGUOUS: 'More than one app matches. Nothing was removed.',
  RUNNING: 'The app is still running. Stop it first. Nothing was removed.',
  BUSY_BACKUP: 'A backup or restore of this app is running. Try again when it is done.',
  BUSY_MOVE: 'This app is being copied or moved. Try again when it is done.',
  BUSY: 'Something else is running on this app. Try again when it is done.',
  COMPOSE_DOWN_FAILED: "The app couldn't be shut down. Nothing was removed.",
  QUARANTINE_FAILED: "The app's data couldn't be put aside. Nothing was removed.",
};

/** Finds a known refusal code in the Engine's message (longest code first). */
export const removeRefusalCode = (message: string): string | null => {
  const codes = Object.keys(REMOVE_REFUSALS).sort((a, b) => b.length - a.length);
  return codes.find((c) => new RegExp(`(^|[^A-Z_])${c}([^A-Z_]|$)`).test(message)) ?? null;
};

export const friendlyRemoveError = (message: string): string => {
  const code = removeRefusalCode(message);
  return code ? REMOVE_REFUSALS[code] : plainEngineText(message);
};

/** Offer Remove at all? Only when the Engine advertises it (older Engines: unchanged UI). */
export const canOfferRemove = (engine: Engine | null | undefined): boolean =>
  engineHasCapability(engine, 'removeInstance');

/** Why Remove is greyed out, or null when it can be sent. */
export const removeBlockedReason = (inst: Instance | undefined, locked: boolean): string | null => {
  if (!inst) return null;
  if (locked) return REMOVE_BUSY_HINT;
  if (inst.status === 'Running' || inst.status === 'Starting') return REMOVE_STOP_FIRST;
  return null;
};
