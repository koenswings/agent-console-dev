import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'jsdom',
    // Console pages on port 80 by default; tests that need a page port mock it.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    globals: true,
    // Inline the websocket adapter so tests can swap its socket for a mock (socketReconnect.test.ts).
    alias: { 'isomorphic-ws': fileURLToPath(new URL('./test/fixtures/isomorphicWs.ts', import.meta.url)) },
    server: { deps: { inline: [/automerge-repo-network-websocket/] } },
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
