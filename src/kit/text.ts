/**
 * `TextSource` plumbing. A plain string is drawn as is (numbers/symbols only by contract); `{ key, vars }` is
 * translated and REDRAWN automatically on `lang:changed` and when the web fonts finish loading. A binding is tied
 * to the canvas texture it paints: when that texture is disposed (machine teardown) the binding dies.
 * `watch` is the same for multi-label canvases that need one repaint pass over several sources.
 */
import type * as THREE from 'three';
import { bus } from '@/core/events';
import { t as tr } from '@/core/i18n';
import { log } from '@/core/log';
import type { TextSource } from './types';

export function resolveText(src: TextSource): string {
  return typeof src === 'string' ? src : tr(src.key, src.vars);
}

/** Handle returned by `bind`: swaps the source and repaints immediately (the old source stops updating). */
export interface TextBinding { set(src: TextSource): void }

interface Entry { dead: boolean; run(): void }

export interface TextHub {
  resolve(src: TextSource): string;
  /** Paint now via `draw(string)`, and again whenever the language or the loaded fonts change. */
  bind(src: TextSource, owner: THREE.Texture, draw: (s: string) => void): TextBinding;
  /** Run `fn` now and on every language / font change for as long as `owner` lives. */
  watch(owner: THREE.Texture, fn: () => void): void;
}

export function createTextHub(): TextHub {
  const all = new Set<Entry>();
  const redraw = (): void => {
    for (const e of all) {
      if (e.dead) { all.delete(e); continue; }
      try { e.run(); } catch (err) { log.error('kit', 'text redraw failed', err); }
    }
  };
  const add = (owner: THREE.Texture, run: () => void): Entry => {
    const e: Entry = { dead: false, run };
    all.add(e);
    owner.addEventListener('dispose', () => { e.dead = true; all.delete(e); });
    return e;
  };
  bus.on('lang:changed', redraw);
  if (typeof document !== 'undefined' && document.fonts) {
    // Canvas text drawn before a web font finished loading used the fallback face — repaint once it is there.
    document.fonts.addEventListener?.('loadingdone', redraw);
  }
  return {
    resolve: resolveText,
    bind(src, owner, draw) {
      let cur = src;
      const e = add(owner, () => draw(resolveText(cur)));
      e.run();
      return {
        set(s) { cur = s; if (!e.dead) e.run(); },
      };
    },
    watch(owner, fn) {
      add(owner, fn).run();
    },
  };
}
