import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { swapDist } from '../scripts/swap-dist.mjs';

function writeTree(dir: string, marker: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), marker);
  writeFileSync(join(dir, 'background.js'), `// ${marker}`);
}

describe('swapDist', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'swap-dist-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it('swaps a new build into dist and keeps the previous tree as dist.prev', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeTree(join(root, 'dist.new-1'), 'new');

    swapDist({ root, newDir: 'dist.new-1' });

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'dist.prev/index.html'), 'utf8')).toBe('old');
    expect(existsSync(join(root, 'dist.new-1'))).toBe(false);
  });

  it('renames the new tree to dist when no live dist exists', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist.new-1'), 'new');

    swapDist({ root, newDir: 'dist.new-1' });

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('new');
    expect(existsSync(join(root, 'dist.prev'))).toBe(false);
  });

  it('keeps exactly one previous tree, replacing an older dist.prev', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist.prev'), 'older');
    writeTree(join(root, 'dist'), 'old');
    writeTree(join(root, 'dist.new-1'), 'new');

    swapDist({ root, newDir: 'dist.new-1' });

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'dist.prev/index.html'), 'utf8')).toBe('old');
  });

  it('restores dist.prev when live dist is missing, then swaps', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist.prev'), 'old');
    writeTree(join(root, 'dist.new-1'), 'new');

    swapDist({ root, newDir: 'dist.new-1' });

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 'dist.prev/index.html'), 'utf8')).toBe('old');
  });

  it('leaves the live dist intact when the new tree is missing', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');

    expect(() => swapDist({ root, newDir: 'dist.new-missing' })).toThrow(/missing or incomplete/);

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('old');
    expect(existsSync(join(root, 'dist.prev'))).toBe(false);
  });

  it('leaves the live dist intact when the new tree has no index.html', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    mkdirSync(join(root, 'dist.new-1'), { recursive: true });
    writeFileSync(join(root, 'dist.new-1', 'background.js'), '// leftover');

    expect(() => swapDist({ root, newDir: 'dist.new-1' })).toThrow(/missing or incomplete/);

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('old');
    expect(existsSync(join(root, 'dist.new-1/background.js'))).toBe(true);
  });

  it('restores the previous dist if renaming the new tree into place fails', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeTree(join(root, 'dist.new-1'), 'new');

    expect(() =>
      swapDist({
        root,
        newDir: 'dist.new-1',
        rename: (from, to) => {
          // Fail only the new tree → dist step; the restore rename must still run.
          if (from.includes('dist.new-1')) throw new Error('simulated rename failure');
          renameSync(from, to);
        },
      }),
    ).toThrow(/simulated rename failure/);

    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('old');
    expect(existsSync(join(root, 'dist.prev'))).toBe(false);
    expect(readFileSync(join(root, 'dist.new-1/index.html'), 'utf8')).toBe('new');
  });
});
