/**
 * Sign-in proof and password hashes for the Engine sign-in (agent-engine-dev#582 §2, §5).
 *
 *   h     = bcrypt(password, salt)              salt: 29-char prefix from /api/auth/challenge
 *   proof = hex(HMAC-SHA256(utf8(h), "idea-login-v1|" + engineId + "|" + challengeId + "|" + nonce))
 *
 * The password never leaves the page. `crypto.subtle` is missing on plain
 * http:// pages, so the HMAC is pure JS (@noble/hashes) and bcrypt is bcryptjs;
 * both are bundled into the Console build.
 */
import bcrypt from 'bcryptjs';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** bcrypt cost for new password hashes; the Engine accepts 10 to 12. */
export const PASSWORD_HASH_COST = 10;

/** Domain prefix of the sign-in proof message. */
export const LOGIN_PROOF_PREFIX = 'idea-login-v1';

/** A bcrypt salt prefix: `$2a$`/`$2b$`/`$2y$`, two-digit cost, `$`, 22 chars. */
const SALT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22}$/;

export const isBcryptSalt = (salt: string): boolean => SALT_RE.test(salt);

/** The message the proof signs. */
export const loginProofMessage = (engineId: string, challengeId: string, nonce: string): string =>
  `${LOGIN_PROOF_PREFIX}|${engineId}|${challengeId}|${nonce}`;

/** hex(HMAC-SHA256(utf8(key), utf8(message))). */
export const hmacSha256Hex = (key: string, message: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(message)));

/**
 * bcrypt(password, salt) off the current task, so the page can paint a
 * "Signing in…" state first (see bcryptCompare.ts for why not bcrypt.hash's
 * async form).
 */
export const bcryptWithSalt = (password: string, salt: string): Promise<string> => {
  if (!isBcryptSalt(salt)) return Promise.reject(new Error('Invalid salt from Engine'));
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(bcrypt.hashSync(password, salt));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  });
};

/** The proof for one challenge of one Engine, from the already computed `h`. */
export const loginProofFromHash = (h: string, engineId: string, challengeId: string, nonce: string): string =>
  hmacSha256Hex(h, loginProofMessage(engineId, challengeId, nonce));

/** The proof for one challenge of one Engine, from the password. */
export const computeLoginProof = async (
  password: string,
  challenge: { salt: string; challengeId: string; nonce: string },
  engineId: string,
): Promise<string> => {
  const h = await bcryptWithSalt(password, challenge.salt);
  return loginProofFromHash(h, engineId, challenge.challengeId, challenge.nonce);
};

/** A new password hash (bcryptjs, cost 10) for setup, add operator and password change. */
export const makePasswordHash = (password: string): Promise<string> =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(bcrypt.hashSync(password, PASSWORD_HASH_COST));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, 0);
  });
