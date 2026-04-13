/**
 * bcrypt.worker.ts — runs bcrypt.compareSync in a dedicated thread.
 *
 * Offloading bcrypt to a worker prevents the main UI thread from freezing
 * during the hash computation (cost 10–12 can take 100ms–10s on slow devices).
 */
import bcrypt from 'bcryptjs';

self.onmessage = (e: MessageEvent<{ password: string; hash: string }>) => {
  const { password, hash } = e.data;
  try {
    const result = bcrypt.compareSync(password, hash);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
