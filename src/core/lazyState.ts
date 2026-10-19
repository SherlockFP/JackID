/**
 * A state whose code lives in a lazy chunk. `enter` loads it (once), then hands every call to the real handler.
 * Until `enter` has the handler the loop's fixedUpdate/frame/exit are no-ops, as for any state that is still entering.
 * `preload()` starts the load early (the menu does it once it is interactive) so the first `go()` finds the chunk ready.
 */
import type { AppStateHandler, AppStateId } from './states';

export interface LazyState<K extends AppStateId> extends AppStateHandler<K> {
  preload(): Promise<void>;
}

export function lazyState<K extends AppStateId>(load: () => Promise<AppStateHandler<K>>): LazyState<K> {
  let real: AppStateHandler<K> | null = null;
  let loading: Promise<AppStateHandler<K>> | null = null;
  const get = (): Promise<AppStateHandler<K>> => (loading ??= load().catch((e) => { loading = null; throw e; }));
  return {
    preload: () => get().then((): void => { /* loaded */ }, (): void => { /* enter() retries and reports */ }),
    async enter(params, from) { const h = await get(); real = h; await h.enter(params, from); },
    async exit(to) { await real?.exit(to); },
    fixedUpdate(dt) { real?.fixedUpdate(dt); },
    frame(dt, alpha) { real?.frame(dt, alpha); },
  };
}
