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

export const JOKER_SOURCE = 'joker';
/** The ask and catch-a-lie keys (core/keymap.ts). C is the Crooked Table's call and the seated `m.alt`, so the lie call is L. */
export const JOKER_ASK_KEY = 'jokerAsk' as BindingKey;
export const JOKER_LIAR_KEY = 'callLiar' as BindingKey;

let watching = false;
/** Keeps `data-joker` on the subtitle bar true only while one of his lines is on screen. */
function watch(): void {
  if (watching || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const bar = document.querySelector('.px-subtitle');
  if (!bar) return;
  watching = true;
  const sync = (): void => { bar.toggleAttribute('data-joker', subtitles.current()?.source === JOKER_SOURCE); };
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

const calmNow = (): boolean => { const s = app.save?.data?.settings; return !!s && ((s as { calm?: boolean }).calm === true || !!s.reduceMotion); };

/** What the voice needs back from the run. */
export interface JokerVoiceHost { dare(accept: boolean): void }

/** Hooks his voice to the bus for one session: whispers, toasts, the dare and a first-time key hint. Returns the disposer. */
export function mountJokerVoice(host: JokerVoiceHost): () => void {
  watch();
  let hinted = false;
  const offs = [
    bus.on('joker:whisper', ({ keys }) => {
      jokerSay(keys.map((k) => t(k)).join(' '));
      if (hinted) return;
      hinted = true;
      app.ui.toast(t('joker.ui.keys', { ask: app.input.keyLabel(JOKER_ASK_KEY), call: app.input.keyLabel(JOKER_LIAR_KEY) }), 'sys', 6);
    }),
    // no numbers: a warmer or a colder face, and his Dawn drift is silent
    bus.on('joker:trust', ({ delta, why }) => {
      if (why === 'dawn' || delta === 0) return;
      app.ui.toast(t(delta > 0 ? 'joker.ui.liked' : 'joker.ui.remember'), delta > 0 ? 'good' : 'bad', 2.5);
    }),
    bus.on('joker:dare', () => {
      void app.ui.choice(t('joker.ui.dare'), [t('joker.ui.take'), t('joker.ui.refuse')], { timeout: 8 })
        .then((i) => { if (i >= 0) host.dare(i === 0); });   // no answer is no answer: he asks again at the next seat
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

/** The corner of your card: a J and his grin. Its width is his mood in seven frames; it moves when he talks (not in Calm). */
export function grinChip(parent: HTMLElement): GrinChip {
  const el = document.createElement('span');
  el.className = 'jk-chip';
  el.title = t('joker.ui.chip');
  el.innerHTML = '<i class="jk-j">J</i><i class="jk-mouth"></i>';
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
