import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyRuntimeState, swapDist } from '../scripts/swap-dist.mjs';

const HIDE = 'hidden-instances.json';
const HIDE_BODY = '{"hidden":["fixture-1"]}\n';

function writeTree(dir: string, marker: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), marker);
  writeFileSync(join(dir, 'background.js'), `// ${marker}`);
}

describe('copyRuntimeState', () => {
  const roots: string[] = [];

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'copy-runtime-'));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it('copies hidden-instances.json from the live dist into the new tree, and the swap keeps it', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeFileSync(join(root, 'dist', HIDE), HIDE_BODY);
    writeTree(join(root, 'dist.new-1'), 'new');

    copyRuntimeState({ root, newDir: 'dist.new-1' });
    expect(readFileSync(join(root, 'dist.new-1', HIDE), 'utf8')).toBe(HIDE_BODY);
    expect(readFileSync(join(root, 'dist', HIDE), 'utf8')).toBe(HIDE_BODY);

    swapDist({ root, newDir: 'dist.new-1' });
    expect(readFileSync(join(root, 'dist', HIDE), 'utf8')).toBe(HIDE_BODY);
    expect(readFileSync(join(root, 'dist.prev', HIDE), 'utf8')).toBe(HIDE_BODY);
  });

  it('leaves the new tree without hidden-instances.json when the live dist has none', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeTree(join(root, 'dist.new-1'), 'new');

    copyRuntimeState({ root, newDir: 'dist.new-1' });

    expect(existsSync(join(root, 'dist.new-1', HIDE))).toBe(false);
    expect(existsSync(join(root, 'dist', HIDE))).toBe(false);
  });

  it('does not overwrite a hidden-instances.json the build itself produced', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeFileSync(join(root, 'dist', HIDE), HIDE_BODY);
    writeTree(join(root, 'dist.new-1'), 'new');
    writeFileSync(join(root, 'dist.new-1', HIDE), '{"hidden":["from-build"]}\n');

    copyRuntimeState({ root, newDir: 'dist.new-1' });

    expect(readFileSync(join(root, 'dist.new-1', HIDE), 'utf8')).toBe('{"hidden":["from-build"]}\n');
    expect(readFileSync(join(root, 'dist', HIDE), 'utf8')).toBe(HIDE_BODY);
  });

  it('leaves the live dist intact if the copy fails', () => {
    const root = tempRoot();
    writeTree(join(root, 'dist'), 'old');
    writeFileSync(join(root, 'dist', HIDE), HIDE_BODY);
    writeTree(join(root, 'dist.new-1'), 'new');

    expect(() =>
      copyRuntimeState({
        root,
        newDir: 'dist.new-1',
        copyFile: () => {
          throw new Error('simulated copy failure');
        },
      }),
    ).toThrow(/simulated copy failure/);

    expect(readFileSync(join(root, 'dist', HIDE), 'utf8')).toBe(HIDE_BODY);
    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toBe('old');
    expect(existsSync(join(root, 'dist.prev'))).toBe(false);
    expect(existsSync(join(root, 'dist.new-1', HIDE))).toBe(false);
  });
});
