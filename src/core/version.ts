/**
 * Version check: a tab opened before a deploy refreshes itself to the live build. The build writes dist/version.json with the
 * same id it bakes into the bundle (vite.config.ts); we poll it on boot, on tab focus and every 5 minutes. On the menu we reload
 * at once; anywhere else (lobby, run, results) we toast once and reload when the app next reaches the menu. No service worker
 * exists, so there is nothing to unregister; the host serves index.html and version.json with `no-cache`.
 */
import { app } from './app';
import { bus } from './events';
import { t } from './i18n';

export type VersionAct = 'none' | 'toast' | 'reload';

const KEY = 'jackid.reloadedFor';
const EVERY_MS = 5 * 60 * 1000;

/** Pure rule. `reloadedFor` is the live id we already reloaded for (loop guard); `toasted` = the notice was shown. */
export function versionAct(baked: string, live: string | null, canReload: boolean, reloadedFor: string | null, toasted: boolean): VersionAct {
  if (!live || live === baked || live === reloadedFor) return 'none';
  if (canReload) return 'reload';
  return toasted ? 'none' : 'toast';
}

/** Production only (main.ts). `baked` is the build id inside this bundle. */
export function startVersionCheck(baked: string): void {
  let live: string | null = null;
  let toasted = false;

  const apply = (): void => {
    let done: string | null = null;
    try { done = sessionStorage.getItem(KEY); } catch { /* no storage: the mark below fails too, so we never reload */ }
    const act = versionAct(baked, live, app.state === 'boot' || app.state === 'menu', done, toasted);
    if (act === 'toast') { toasted = true; app.ui.toast(t('ui.version.new'), 'sys', 8); }
    if (act !== 'reload') return;
    try { sessionStorage.setItem(KEY, live!); } catch { return; }   // cannot mark it → could loop, so stay on this build
    location.reload();
  };

  const check = async (): Promise<void> => {
    try {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const v = r.ok ? ((await r.json()) as { v?: unknown }).v : null;
      if (typeof v === 'string' && v) live = v;
    } catch { /* offline or a bad body: ask again later */ }
    apply();
  };

  bus.on('app:state', ({ to }) => { if (to === 'menu') apply(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  setInterval((): void => { void check(); }, EVERY_MS);
  void check();
}
