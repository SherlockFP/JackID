// Vite dev config for the QA bench (scripts/qa/bench.mjs). The root vite.config.ts, with HMR and the file watcher off for
// src/ and scripts/. A source edit made while a run is up (an editor, another worker, a *.strings.ts change) would otherwise
// send a full page reload: the bench veil comes back, the seat or the round is lost, and the run fails with a bare
// "Cannot read properties of undefined". The bench starts a fresh server per run, so it always serves the current source.
import { mergeConfig } from 'vite';
import base from '../../vite.config.ts';

export default mergeConfig(base, {
  server: {
    hmr: false,
    watch: { ignored: ['**/src/**', '**/scripts/**', '**/docs/**'] },
  },
});
