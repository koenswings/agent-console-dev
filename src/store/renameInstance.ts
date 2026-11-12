/**
 * Rename an App instance's display name (agent-engine-dev#220, Engine PR #266).
 * Shape: `renameInstance <instanceId> <new name…>`, capability `renameInstance`.
 * Display name only; allowed while running. Pure helpers only.
 */
import { engineHasCapability } from './commands';
import type { Engine, Instance, Store } from '../types/store';
import { plainEngineText } from './plainError';

export const MAX_NAME_LENGTH = 64;

export const RENAME_REFUSALS: Record<string, string> = {
  EMPTY_NAME: 'Type a name.',
  NAME_TOO_LONG: `The name is too long. Use at most ${MAX_NAME_LENGTH} characters.`,
  BAD_NAME: 'The name has characters that can’t be used.',
  NAME_TAKEN: 'Another app on this Engine already has that name.',
  NOT_FOUND: 'This app is no longer on this Engine.',
  NOT_LOCAL: 'This app is on a disk in another Engine. Rename it there.',
  AMBIGUOUS: 'More than one app matches. Nothing was changed.',
  BUSY: 'The app is being copied, moved, backed up or restored. Try again when it is done.',
  COMPOSE_WRITE_FAILED: "The new name couldn't be saved. Nothing was changed.",
};

/** Collapse whitespace like the Engine (tokens joined with spaces). */
export const normaliseName = (raw: string): string => raw.trim().split(/\s+/).filter(Boolean).join(' ');

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/**
 * Local check before sending, mirroring the Engine's refusals; returns the
 * message, or null when the name may be sent. Same name = no-op (null + caller skips).
 */
export const renameProblem = (
  raw: string,
  inst: Instance | undefined,
  store: Store | null,
  engineId: string,
): string | null => {
  if (CONTROL_RE.test(raw)) return RENAME_REFUSALS.BAD_NAME;
  const name = normaliseName(raw);
  if (!name) return RENAME_REFUSALS.EMPTY_NAME;
  if (name.length > MAX_NAME_LENGTH) return RENAME_REFUSALS.NAME_TOO_LONG;
  const lower = name.toLowerCase();
  const disks = store?.diskDB ?? {};
  const taken = Object.values(store?.instanceDB ?? {}).some((o) =>
    o.id !== inst?.id
    && o.name.toLowerCase() === lower
    && String(disks[String(o.storedOn)]?.dockedTo ?? '') === engineId);
  return taken ? RENAME_REFUSALS.NAME_TAKEN : null;
};

export const isSameName = (raw: string, inst: Instance | undefined): boolean =>
  normaliseName(raw) === (inst?.name ?? '');

export const renameRefusalCode = (message: string): string | null => {
  const codes = Object.keys(RENAME_REFUSALS).sort((a, b) => b.length - a.length);
  return codes.find((c) => new RegExp(`(^|[^A-Z_])${c}([^A-Z_]|$)`).test(message)) ?? null;
};

export const friendlyRenameError = (message: string): string => {
  const code = renameRefusalCode(message);
  return code ? RENAME_REFUSALS[code] : plainEngineText(message);
};

export const canOfferRename = (engine: Engine | null | undefined): boolean =>
  engineHasCapability(engine, 'renameInstance');
