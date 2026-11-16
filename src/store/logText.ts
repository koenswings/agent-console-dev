/**
 * Tolerant readers for command-log text fields (engine#471 b).
 *
 * The Engine writes trace `args`, `result`, `errorMessage`, `error` and
 * `logs[].message` as Automerge ImmutableString. Older logs (and a rotation day
 * that mixes carried traces with remote logs) still return plain strings.
 * Every Console read of those fields goes through `logText` / `logJson`.
 *
 * Detection uses the registry symbol automerge 3.x puts on ImmutableString
 * (`Symbol.for('_am_immutableString')`), not `instanceof`, so it also works
 * when the bundle carries a second copy of automerge.
 */
import type { ImmutableStringLike } from '../types/commandLog';

const IMMUTABLE_STRING = Symbol.for('_am_immutableString');

/** True for an automerge ImmutableString (any bundled copy). */
export const isImmutableString = (v: unknown): v is ImmutableStringLike =>
  typeof v === 'object' &&
  v !== null &&
  (v as Record<symbol, unknown>)[IMMUTABLE_STRING] === true &&
  typeof (v as { val?: unknown }).val === 'string';

/** Command-log text field: string | ImmutableString | null/undefined -> string | null. */
export const logText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (isImmutableString(v)) return v.val;
  return String(v);
};

/**
 * Command-log JSON field (`args`, `result`): JSON text as a string or
 * ImmutableString is parsed; an empty string is null; a legacy/mock object
 * passes through unchanged. Throws on bad JSON, like a bare JSON.parse.
 */
export const logJson = (v: unknown): unknown => {
  if (v == null) return null;
  if (typeof v === 'string' || isImmutableString(v)) {
    const s = logText(v) ?? '';
    return s === '' ? null : JSON.parse(s);
  }
  return v;
};
