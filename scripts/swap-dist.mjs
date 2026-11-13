import { existsSync, renameSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Swap a successful build directory into place as `dist/`.
 *
 * Flow:
 *   1. If `dist/` is missing but `dist.prev` exists (a crash mid-swap), restore it first.
 *   2. Remove any older `dist.prev` so at most one previous tree is kept.
 *   3. Rename live `dist/` → `dist.prev` (if it exists).
 *   4. Rename the new tree → `dist/`.
 *
 * If step 4 fails after step 3, `dist.prev` is renamed back to `dist/` so a live
 * tree is never left missing. The existing `dist/` is not touched when the new
 * tree is missing or does not look like a finished build.
 *
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.newDir  Absolute path, or a name under `root`
 * @param {string} [opts.distName='dist']
 * @param {string} [opts.prevName='dist.prev']
 * @param {(p: string) => boolean} [opts.exists]
 * @param {(from: string, to: string) => void} [opts.rename]
 * @param {(p: string, opts: object) => void} [opts.rm]
 */
export function swapDist({
  root,
  newDir,
  distName = 'dist',
  prevName = 'dist.prev',
  exists = existsSync,
  rename = renameSync,
  rm = rmSync,
}) {
  const distPath = join(root, distName);
  const prevPath = join(root, prevName);
  const newPath = isAbsolute(newDir) ? newDir : join(root, newDir);

  if (!exists(newPath) || !exists(join(newPath, 'index.html'))) {
    throw new Error(`new build directory is missing or incomplete: ${newPath}`);
  }

  // Recover a previous tree if an earlier swap died after moving dist → dist.prev.
  if (!exists(distPath) && exists(prevPath)) {
    rename(prevPath, distPath);
  }

  try {
    if (exists(prevPath)) {
      rm(prevPath, { recursive: true, force: true });
    }
    if (exists(distPath)) {
      rename(distPath, prevPath);
    }
    rename(newPath, distPath);
  } catch (err) {
    if (!exists(distPath) && exists(prevPath)) {
      try {
        rename(prevPath, distPath);
      } catch {
        // Keep the original error; dist.prev may still be used to recover by hand.
      }
    }
    throw err;
  }
}
