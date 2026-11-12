/**
 * Last line of defence for Engine error text shown to teachers (idea#76).
 * Adapters map known refusal codes to plain sentences; anything else goes
 * through `plainEngineText`, which never lets CLI wording through: no `--flags`,
 * no `Usage:` lines, no command syntax and no CAPS_SNAKE code tokens.
 * Operator-only History/diagnostics keep the raw text.
 */

/** Shown when the Engine's own text is not fit for a teacher. */
export const GENERIC_ERROR_TEXT = "IDEA couldn't finish this. Try again, or ask for help.";

const FLAG_RE = /(^|\s)--?[a-z][a-z0-9-]*/i;
const CODE_RE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const LEADING_CODE_RE = /^\s*[A-Z][A-Z0-9_]{2,}:\s*/;
const CLI_RE = /\busage:|\b(too many|insufficient) arguments\b|\bunknown command\b|<[a-z][\w|-]*>|\[[a-z-]+\]|\bat \S+\.(ts|js):\d+|\berrno\b/i;
/** errno names such as ENOENT, EACCES (case-sensitive). */
const ERRNO_RE = /\bE(NOENT|ACCES|PERM|BUSY|EXIST|NOSPC|IO|INVAL|CONNREFUSED|TIMEDOUT)\b/;
/** Quoted ids ('DISK_LIVE_BOOT') are names, not codes. */
const QUOTED_RE = /'[^']*'|"[^"]*"/g;
const ANSI_RE = /\u001b\[[0-9;]*m/g;

/** True when `text` would show CLI wording or an Engine code to a teacher. */
export const looksLikeCli = (text: string): boolean => {
  const t = text.replace(QUOTED_RE, "''");
  return FLAG_RE.test(t) || CODE_RE.test(t) || CLI_RE.test(t) || ERRNO_RE.test(t);
};

/**
 * Plain text for an unmapped Engine message: the Engine's sentence when it is
 * already plain (a leading `CODE:` is dropped), otherwise GENERIC_ERROR_TEXT.
 */
export const plainEngineText = (raw: string | null | undefined): string => {
  const msg = String(raw ?? '').replace(ANSI_RE, '').trim();
  if (!msg) return GENERIC_ERROR_TEXT;
  const body = msg.replace(LEADING_CODE_RE, '').trim();
  if (!body || looksLikeCli(body) || /^[A-Z][A-Z0-9_]*$/.test(body)) return GENERIC_ERROR_TEXT;
  return body;
};
