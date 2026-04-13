/**
 * bcryptCompare — runs bcrypt.compareSync off the main thread via a Web Worker.
 *
 * Falls back to compareSync on the main thread if workers aren't available
 * (e.g. strict CSP, extension sandboxes).
 */
import bcrypt from 'bcryptjs';

export function bcryptCompare(password: string, hash: string): Promise<boolean> {
  // Web Workers require a non-null origin — not available in file:// context.
  if (typeof Worker === 'undefined') {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        try { resolve(bcrypt.compareSync(password, hash)); }
        catch (e) { reject(e); }
      }, 0)
    );
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/bcrypt.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      // Worker construction failed (e.g. CSP) — fall back to main thread
      return setTimeout(() => {
        try { resolve(bcrypt.compareSync(password, hash)); }
        catch (e) { reject(e); }
      }, 0);
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('bcrypt timed out'));
    }, 30_000);

    worker.onmessage = (e: MessageEvent<{ result?: boolean; error?: string }>) => {
      clearTimeout(timeout);
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result ?? false);
    };

    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(e.message));
    };

    worker.postMessage({ password, hash });
  });
}
