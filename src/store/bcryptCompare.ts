/**
 * bcryptCompare — runs bcrypt.compareSync on the main thread via setTimeout(0).
 *
 * This yields to the event loop before the blocking work, keeping the UI
 * responsive. We deliberately avoid Web Workers: in Chromium-based browsers
 * the worker message callback can be silently delayed or dropped when the
 * main thread is handling reactive updates, causing the login form to hang
 * on "Verifying…" indefinitely.
 *
 * setTimeout(0) + compareSync is reliable across all environments
 * (extension, web, dev server, production) and adds no extra round-trip.
 */
import bcrypt from 'bcryptjs';

export function bcryptCompare(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try { resolve(bcrypt.compareSync(password, hash)); }
      catch (e) { reject(e); }
    }, 0)
  );
}
