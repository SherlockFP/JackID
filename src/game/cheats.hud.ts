/**
 * The HİLE tag: a small plate in the corner of the screen for as long as the run is cheated (src/game/cheats.ts). Its own DOM piece,
 * mounted with the home computer; the style is in src/game/home/konsol.css.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { h } from '@/core/ui/widgets';

/** `on`: the run is already cheated (a resumed save). Returns the disposer. */
export function mountCheatTag(on: boolean): () => void {
  const el = h('div', 'konsol-tag', app.ui.root, t('konsol.tag'));
  el.hidden = !on;
  const offs = [
    bus.on('cheat:marked', () => { el.hidden = false; }),
    bus.on('run:end', () => { el.hidden = true; }),
    bus.on('lang:changed', () => { el.textContent = t('konsol.tag'); }),
  ];
  return () => { for (const o of offs) o(); el.remove(); };
}
