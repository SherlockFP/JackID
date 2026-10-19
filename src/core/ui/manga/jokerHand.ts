/**
 * LOKI'S HAND AND HIS INK (docs/JOKER.md §2.2, §4, §6, wave J3). The screen side of the Change of Hands and the Ink symptoms:
 *   the takeover    a card border in his green with J pips, a short chromatic pulse, his line, and the hands go green (the viewmodel)
 *   unasked, Calm   a 1 s plate ("Loki takes the hand.") before the border
 *   Ink 4+          his upside-down face shows in the glass for a moment when he speaks
 *   Ink 6+          a green vignette at the screen edges
 *   Ink 8+          the hands drift a beat out of step (the viewmodel)
 * Calm Mode keeps every rule: no pulse, a steady border, the face fades in slower, a weaker vignette. All timing is CSS, so there is
 * no clock here. The HUD number tints and lies live in menu/hud.ts.
 */
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { jokerIcon, jokerSay, lokiToast, calmNow } from './joker';

/** What the screen side needs from the session. */
export interface JokerHandHost {
  ink(): number;
  /** The viewmodel's hands (`ViewmodelHost.jokerHand`), when there are hands. */
  hands?(o: { flash?: boolean; lag?: boolean }): void;
}

/** Restarts a one-shot CSS animation on `el` by toggling `cls`. */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function mountJokerHand(host: JokerHandHost): () => void {
  if (typeof document === 'undefined') return () => {};
  const root = document.createElement('div');
  root.className = 'jk-hand';
  root.setAttribute('aria-hidden', 'true');
  const vig = Object.assign(document.createElement('div'), { className: 'jk-vig' });
  const border = Object.assign(document.createElement('div'), { className: 'jk-border' });
  for (const c of ['tl', 'tr', 'bl', 'br']) border.appendChild(Object.assign(document.createElement('b'), { className: `jk-pip ${c}`, textContent: 'J' }));
  const pulse = Object.assign(document.createElement('div'), { className: 'jk-pulse' });
  const face = Object.assign(document.createElement('div'), { className: 'jk-face' });
  face.appendChild(jokerIcon());
  root.append(vig, face, pulse, border);
  (document.querySelector('.px-root') ?? document.body).appendChild(root);   // inside the UI root: it carries the --u scale

  const ink = (n: number): void => {
    root.dataset.ink = String(n >= 6 ? 6 : 0);
    root.classList.toggle('calm', calmNow());
    host.hands?.({ lag: n >= 8 && !calmNow() });
  };
  ink(host.ink());
  const offs = [
    bus.on('joker:ink', (e) => ink(e.ink)),
    bus.on('joker:takeover', (e) => {
      const calm = calmNow();
      root.classList.toggle('calm', calm);
      // Calm: an unasked hand is announced first, and the border waits for the plate
      root.classList.toggle('wait', calm && !e.asked);
      if (calm && !e.asked) lokiToast(t('joker.takeover.calm'), 1);
      jokerSay(t('joker.takeover.ask'));
      replay(border, 'on');
      if (!calm) replay(pulse, 'on');
      host.hands?.({ flash: true });
    }),
    bus.on('joker:whisper', () => { if (host.ink() >= 4) replay(face, 'on'); }),
  ];
  return () => { for (const off of offs) off(); root.remove(); host.hands?.({ lag: false }); };
}
