import { copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

/** Runtime state files written into live dist/ (not produced by the Vite build). */
export const RUNTIME_DIST_FILES = Object.freeze(['hidden-instances.json']);

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

/**
 * Copy allowlisted runtime state from the live `dist/` into a finished new
 * build tree, before `swapDist`. Existing files in the new tree are left
 * alone so a file the build itself produced is never overwritten. The live
 * `dist/` is not modified.
 *
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.newDir  Absolute path, or a name under `root`
 * @param {string} [opts.distName='dist']
 * @param {readonly string[]} [opts.files=RUNTIME_DIST_FILES]
 * @param {(p: string) => boolean} [opts.exists]
 * @param {(from: string, to: string) => void} [opts.copyFile]
 * @param {(p: string) => { isFile(): boolean }} [opts.stat]
 */
export function copyRuntimeState({
  root,
  newDir,
  distName = 'dist',
  files = RUNTIME_DIST_FILES,
  exists = existsSync,
  copyFile = copyFileSync,
  stat = statSync,
}) {
  const distPath = join(root, distName);
  const newPath = isAbsolute(newDir) ? newDir : join(root, newDir);
  if (!exists(newPath)) {
    throw new Error(`new build directory is missing: ${newPath}`);
  }

  for (const name of files) {
    if (name !== basename(name) || name === '' || name === '.' || name === '..') {
      throw new Error(`runtime dist file must be a bare filename: ${name}`);
    }
    const from = join(distPath, name);
    const to = join(newPath, name);
    if (!exists(from) || !stat(from).isFile()) continue;
    if (exists(to)) continue;
    copyFile(from, to);
  }
}
