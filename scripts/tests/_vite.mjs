// Shared helper for the unit tests (not a test file itself). Loads TypeScript modules from src/ through Vite's SSR
// loader, the same loader scripts/check.mjs uses, so the tests exercise the real code rather than copies of it.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let serverP = null;
function viteServer() {
  serverP ??= import('vite').then(({ createServer }) => createServer({
    root: ROOT, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  }));
  return serverP;
}

/** True when a source file exists. Tests for modules owned by other work packages skip until it does. */
export const hasModule = (rel) => existsSync(join(ROOT, rel));

/**
 * Loads a module by its path relative to the project root, e.g. 'src/core/rng.ts'. Call it from `before()` or from a
 * test body, never at module top level: the suites share one process and must not race the teardown.
 */
export async function load(rel) {
  const server = await viteServer();
  return server.ssrLoadModule('/' + rel);
}

/** Pass to `after()` in every test file. The server holds handles, so it must be closed for the process to exit. */
export async function closeVite() {
  if (!serverP) return;
  const server = await serverP;
  serverP = null;
  await server.close();
}
