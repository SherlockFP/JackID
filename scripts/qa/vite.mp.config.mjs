// Vite dev config for the two-page multiplayer smoke (scripts/qa/mp.mjs). Same as the root vite.config.ts, except the
// /lobby and /api proxy points at the lobby server that run started (QA_MP_LOBBY_PORT), not the fixed :8787.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const LOBBY = process.env.QA_MP_LOBBY_PORT || '8787';

export default defineConfig({
  root: ROOT,
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    {
      name: 'jackid-html-version',
      transformIndexHtml: (html) => html.replace(/__APP_VERSION__/g, pkg.version),
    },
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/lobby': { target: `ws://127.0.0.1:${LOBBY}`, ws: true },
      '/api': { target: `http://127.0.0.1:${LOBBY}`, changeOrigin: true },
    },
  },
});
