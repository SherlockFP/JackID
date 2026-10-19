/**
 * LOKI'S VOICE (docs/JOKER.md §6, wave J2). His lines go into the one subtitle bar as source `joker`: phosphor-green text, a
 * card-corner speaker plate (an upside-down J), a card riffle as the line starts, typed at the bar's 40 cps. The inner line keeps
 * its own italic style. Also here: the card chip next to the ŞANS stars (seven grin frames, no numbers), the "He liked that." /
 * "He'll remember that." toasts, and the once-a-Night dare prompt. Core layer: it hears the run on the bus and answers the dare
 * through the host the session passes in.
 */
import './joker.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import type { BindingKey } from '@/core/input/types';
import { subtitles } from '../subtitles';
import { iconEl, uiSfx } from '../widgets';
import type { UIOverlayX } from '../ui';

export const JOKER_SOURCE = 'joker';
/** The ask and catch-a-lie keys (core/keymap.ts). C is the Crooked Table's call and the seated `m.alt`, so the lie call is L. */
export const JOKER_ASK_KEY = 'jokerAsk' as BindingKey;
export const JOKER_LIAR_KEY = 'callLiar' as BindingKey;
/** Give him the hand at the seat (I: free walking and seated). */
export const JOKER_HAND_KEY = 'jokerHand' as BindingKey;

/** His sigil as two CSS images on the root (--jk-ico, and --jk-ico2 with the eyes shut): the plate, the chip and the god card draw it with CSS. */
let iconsOn = false;
function iconVars(): void {
  if (iconsOn || typeof document === 'undefined') return;
  const src = (id: string): string => (iconEl(id, 16).querySelector('img') as HTMLImageElement | null)?.src ?? '';
  const a = src('icon.joker'), b = src('icon.joker2');
  if (!a) return;   // no texgen yet (a test, a menu before the first scene): try again at the next call
  iconsOn = true;
  document.documentElement.style.setProperty('--jk-ico', `url(${a})`);
  document.documentElement.style.setProperty('--jk-ico2', `url(${b})`);
}

/** The sigil as a small element (`.jk-ico`); it blinks when he speaks (see joker.css). */
export function jokerIcon(cls = ''): HTMLElement {
  iconVars();
  const el = document.createElement('i');
  el.className = `jk-ico ${cls}`.trim();
  el.setAttribute('aria-hidden', 'true');
  return el;
}

let watching = false;
/** Keeps `data-joker` on the subtitle bar true only while one of his lines is on screen. */
function watch(): void {
  iconVars();
  if (watching || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const bar = document.querySelector('.px-subtitle');
  if (!bar) return;
  watching = true;
  const sync = (): void => { if (subtitles.current()?.source === JOKER_SOURCE) bar.setAttribute('data-joker', calmNow() ? 'calm' : 'talk'); else bar.removeAttribute('data-joker'); };
  new MutationObserver(sync).observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-phase', 'class'] });
  sync();
}

/** One of his lines in the bar. A new line replaces the one he is saying. */
export function jokerSay(text: string): void {
  if (!text) return;
  watch();
  subtitles.say({ text, speaker: t('story.speaker.loki'), voice: 'loki', source: JOKER_SOURCE, lane: 'story' });
  app.audio?.play('cardFlip', { vol: 0.45 });
}

/** One of his lines is coming in or typing now: the apparition's grin flaps and he shows (game/joker/apparition.ts). */
export function jokerTalking(): boolean {
  const c = subtitles.current();
  return c?.source === JOKER_SOURCE && (c.phase === 'in' || c.phase === 'typing');
}

/** Calm Mode, reduced motion or reduced flashing: his visuals soften (docs/JOKER.md §6). */
export const calmNow = (): boolean => { const s = app.save?.data?.settings; return !!s && (s.calm === true || !!s.reduceMotion || !!s.reduceFlashing); };

/** A toast with his sigil (green bar, icon.joker); every toast of his goes through here. */
export function lokiToast(text: string, dur = 2.5): void { (app.ui as UIOverlayX).toast(text, 'loki', dur); }

let keysEl: HTMLElement | null = null;
/** His three keys as a small strip of chips (jester icon, then ask / call / hand) in the right stack's corner; it fades itself (joker.css). */
export function showJokerKeys(): void {
  const root = document.querySelector('.px-root');
  if (!root) return;
  if (!keysEl || !keysEl.isConnected) {
    keysEl = document.createElement('div');
    keysEl.className = 'jk-keys';
    keysEl.setAttribute('aria-hidden', 'true');
    keysEl.addEventListener('animationend', () => keysEl?.classList.remove('on'));
    root.appendChild(keysEl);
  }
  keysEl.replaceChildren(jokerIcon(), ...([['ask', JOKER_ASK_KEY], ['call', JOKER_LIAR_KEY], ['hand', JOKER_HAND_KEY]] as const).map(([id, key]) => {
    const c = document.createElement('span');
    c.textContent = `${app.input.keyLabel(key)} ${t(`joker.ui.k.${id}`)}`;
    return c;
  }));
  keysEl.classList.remove('on');
  void keysEl.offsetWidth;   // restart the fade
  keysEl.classList.add('on');
}

/** What the voice needs back from the run. */
export interface JokerVoiceHost { dare(accept: boolean): void }

/** Hooks his voice to the bus for one session: whispers, toasts, the dare and a first-time key hint. Returns the disposer. */
export function mountJokerVoice(host: JokerVoiceHost): () => void {
  watch();
  let hinted = false;
  const offs = [
    bus.on('joker:whisper', ({ keys, ask }) => {
      jokerSay(keys.map((k) => t(k)).join(' '));
      if (ask) uiSfx('coinDrop', 0.5);   // asking him costs you
      if (hinted) return;
      hinted = true;
      showJokerKeys();
    }),
    // no numbers: a warmer or a colder face, and his Dawn drift is silent
    bus.on('joker:trust', ({ delta, why }) => {
      if (why === 'dawn' || delta === 0) return;
      uiSfx(delta > 0 ? 'sparkle' : 'whisper', 0.35);
      lokiToast(t(delta > 0 ? 'joker.ui.liked' : 'joker.ui.remember'), 2.5);
    }),
    // a lie caught is a bright ping, a truth called a lie is a flat buzz
    bus.on('joker:call', ({ right }) => { uiSfx(right ? 'win1' : 'buzzer', right ? 0.6 : 0.4); }),
    bus.on('joker:dare', () => {
      void app.ui.choice(t('joker.ui.dare'), [t('joker.ui.take'), t('joker.ui.refuse')], { timeout: 8 })
        .then((i) => { if (i >= 0) { uiSfx(i === 0 ? 'sparkle' : 'back', 0.5); host.dare(i === 0); } });   // no answer is no answer: he asks again at the next seat
    }),
  ];
  return () => { for (const off of offs) off(); };
}

export interface GrinChip {
  readonly el: HTMLElement;
  /** The frame to show (0 bared teeth .. 6 wide grin) and whether it is a lie (Ink 6+); Calm Mode tints a lying frame green. */
  set(frame: number, lie: boolean): void;
  dispose(): void;
}

/** The corner of your card: his sigil and his grin. Its width is his mood in seven frames; it moves when he talks (not in Calm). */
export function grinChip(parent: HTMLElement): GrinChip {
  const el = document.createElement('span');
  el.className = 'jk-chip';
  el.title = t('joker.ui.chip');
  el.addEventListener('click', showJokerKeys);   // the keys again, on demand
  el.append(jokerIcon(), Object.assign(document.createElement('i'), { className: 'jk-mouth' }));
  parent.appendChild(el);
  const off = bus.on('joker:whisper', () => {
    if (calmNow()) return;
    el.classList.remove('talk');
    void el.offsetWidth;
    el.classList.add('talk');
  });
  return {
    el,
    set(frame, lie) {
      el.dataset.f = String(Math.max(0, Math.min(6, Math.round(frame))));
      el.classList.toggle('lie', lie && calmNow());
    },
    dispose() { off(); el.remove(); },
  };
}
