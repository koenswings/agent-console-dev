import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';

export default defineConfig({
  plugins: [solid(), wasm(), topLevelAwait()],
  // Store Vite's dep-optimisation cache in /tmp so it is always writable regardless
  // of which OS user runs the build (sandbox agent vs Pi user share the same filesystem).
  cacheDir: '/tmp/idea-console-vite-cache',
  server: {
    host: true, // binds to 0.0.0.0 for Tailscale access
    port: 5173,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
});
