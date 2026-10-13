// Vite config (TD-owned). Alias @ → src, dev proxy to the lobby server, __APP_VERSION__ define.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    {
      // index.html is static; substitute the version token in the BIOS line.
      name: 'jackid-html-version',
      transformIndexHtml: (html: string) => html.replace(/__APP_VERSION__/g, pkg.version),
    },
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/lobby': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
