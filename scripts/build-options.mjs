/** Vite `mode` for `pnpm build`. Always production so a stray NODE_ENV cannot change the bundle. */
export const VITE_BUILD_MODE = 'production';

/**
 * Options passed to Vite `build()`. `mode` is hard-coded to production.
 * `pnpm dev` still uses `vite` (dev server) and is unchanged.
 */
export const viteProductionBuildOptions = (outDirName, projectRoot) => ({
  root: projectRoot,
  mode: VITE_BUILD_MODE,
  build: {
    outDir: outDirName,
    emptyOutDir: true,
  },
});

/** Force NODE_ENV=production for the Vite process (Vite otherwise inherits a stray test/dev value). */
export const forceProductionNodeEnv = (env = process.env) => {
  env.NODE_ENV = 'production';
  return env.NODE_ENV;
};
