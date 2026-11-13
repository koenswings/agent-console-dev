import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { copyRuntimeState, swapDist } from './swap-dist.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const newDirName = `dist.new-${Date.now()}`;
const newDir = join(root, newDirName);

function removeNewDir() {
  rmSync(newDir, { recursive: true, force: true });
}

try {
  await build({
    root,
    build: {
      outDir: newDirName,
      emptyOutDir: true,
    },
  });
  copyRuntimeState({ root, newDir });
  swapDist({ root, newDir });
  process.stdout.write(`Build swapped into dist/ (previous kept as dist.prev if one existed)\n`);
} catch (err) {
  removeNewDir();
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
