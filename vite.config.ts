// Vite config (TD-owned). Alias @ → src, dev proxy to the lobby server, __APP_VERSION__ define.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// Build id for the version check (core/version.ts): Render's commit, else git, else the build time.
const buildId = process.env.RENDER_GIT_COMMIT?.slice(0, 7)
  || (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()
  || Date.now().toString(36);

export default defineConfig(({ mode }) => ({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(buildId), __DEMO__: JSON.stringify(mode === 'demo') },   // the Steam demo: npm run build:demo
  plugins: [
    {
      // dist/version.json holds the id the bundle was built with; open tabs poll it (core/version.ts).
      name: 'jackid-version-json',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: buildId }) }); },
    },
    {
      // index.html is static; substitute the version token in the BIOS line.
      name: 'jackid-html-version',
      transformIndexHtml: (html: string) => html.replace(/__APP_VERSION__/g, pkg.version),
    },
    {
      // The two pixel fonts sit behind CSS, so the browser finds them only after the stylesheet: preload them with the script.
      name: 'jackid-font-preload',
      transformIndexHtml: {
        order: 'post',
        handler(html: string, ctx: { bundle?: Record<string, unknown> }) {
          const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(vt323|press-start-2p)-latin(-ext)?-400-normal-.*\.woff2$/.test(f));
          const tags = fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${f}" />`).join('\n  ');
          return tags ? html.replace('</head>', `  ${tags}
</head>`) : html;
        },
      },
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
}));
