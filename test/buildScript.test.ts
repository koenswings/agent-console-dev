import { describe, expect, it } from 'vitest';
import {
  VITE_BUILD_MODE,
  forceProductionNodeEnv,
  viteProductionBuildOptions,
} from '../scripts/build-options.mjs';

describe('scripts/build.mjs production pin (duration asset hash)', () => {
  it('always passes mode production to Vite build(), ignoring a stray NODE_ENV', () => {
    expect(VITE_BUILD_MODE).toBe('production');
    const opts = viteProductionBuildOptions('dist.new-test', '/tmp/console-root');
    expect(opts.mode).toBe('production');
    expect(opts.root).toBe('/tmp/console-root');
    expect(opts.build).toEqual({ outDir: 'dist.new-test', emptyOutDir: true });
  });

  it('sets NODE_ENV to production even when the environment was test', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    expect(forceProductionNodeEnv(env)).toBe('production');
    expect(env.NODE_ENV).toBe('production');
  });
});
