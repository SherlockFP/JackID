/**
 * THE BURNING WAGER, the board (DOM only; the clock is the caller's `update(dt)` on sim time). The match is Ada's flow (`flow.ts`) with
 * the Champion in her chair (`champion.ts`), drawn as a tall board on the left so the table on the stage stays in view.
 *
 * Keys: 1/2/3 throw, 4 the Gambler's Eye on his call (it shows whether he means his word), 5 Loki's word at match point, E to finish.
 * No Escape: nobody leaves the House's table. Loki whispers one of the Champion's old habits before each of his calls (true or a lie, by
 * his Trust and Ink). Friends speak at set moments (§10 helps). At match point the board goes red, the music cuts to a heartbeat, and
 * his silence gets the eye close-up. Original IP.
 */
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { h } from '@/core/ui/widgets';
import { innerLine } from '@/core/ui/manga/inner';
import { gamblersEye } from '@/core/ui/manga/eye';
import { glyph } from '@/core/ui/manga/glyph';
import { createFlow, type Flow, type FlowView } from './flow';
import { text } from './kitchen';
import { WAGER_GOAL, championFoe, matchPoint, trembles, wagerOutcome, type WagerHelps } from './champion';
import type { AiCall, Hand } from './rules';
import './promise.css';

export interface BurningResult { wager: 'win' | 'lose'; cracks: number; /** Loki's word was spent at match point. */ word: boolean }

export interface BurningDeps {
  parent: HTMLElement;
  seed: number;
  helps: WagerHelps;
  /** Loki, before each of the Champion's calls: one habit ('opens', 'quiet', 'left'). */
  whisper(fact: string): void;
  wordReady(): boolean;
  /** Spends Loki's word; true when he spoke. */
  spendWord(): boolean;
  /** A friend's line on the floor: speaker key, text key, voice. */
  say(speaker: string, key: string, voice: string): void;
  sfx(name: string, vol: number): void;
  /** The Champion's body: talking through his patter, or still (the quiet). */
  pose?(talk: boolean): void;
  playHand(h: Hand): void;
  done(r: BurningResult): void;
}

export interface Burning { update(dt: number): void; flow(): Flow; dispose(): void }

/** Seconds between two crowd murmurs, and between two heartbeats once the music has cut. */
const MURMUR_S = 6.5;
const BEAT_S = 0.9;

export function openBurning(d: BurningDeps): Burning {
  const root = h('div', 'pm-table pm-burning', d.parent);
  root.setAttribute('role', 'group');
  const title = h('div', 'pm-title', root);
  h('span', '', title, t('promise.title.champ'));
  h('span', '', title, t('promise.stake', { stake: t('promise.stake.card') }));
  const score = h('div', 'pm-score', root);
  const cracks = h('div', 'pm-cracks', root);
  const mp = h('div', 'pm-mp', root);
  const callEl = h('div', 'pm-call', root);
  const head = h('div', 'pm-head', root);
  const lines = h('div', 'pm-lines', root);
  const keys = h('div', 'pm-keys', root);
  h('div', 'pm-burn', root, t('promise.burn'));
  const button = (label: string, act: () => void): HTMLButtonElement => {
    const b = h('button', '', keys, label);
    b.type = 'button';
    b.addEventListener('click', act);
    return b;
  };
  const hands: Hand[] = ['rock', 'paper', 'scissors'];
  const btns = hands.map((hd, i) => button(`${i + 1} ${t(`promise.hand.${hd}`)}`, () => flow.press(i + 1)));
  const eyeBtn = button(t('promise.eye'), () => eye());
  const wordBtn = button(t('promise.word'), () => word());
  const fin = button(t('promise.continue'), () => flow.confirm());

  const h0 = d.helps;
  let call: AiCall | null = null;
  let hisCalls = 0;
  let eyes = h0.eyes;
  let eyeRound = -1;
  let spent = false;
  let final = false;
  let music = false;
  let beat = 0;
  let murmur = 2;
  let lastRound = -1;
  const said = new Set<string>();
  const once = (k: string, fn: () => void): void => { if (!said.has(k)) { said.add(k); fn(); } };
  const P = 'promise.';

  const setMusic = (on: boolean): void => {
    if (on === music) return;
    music = on;
    bus.emit('music:cue', { cue: 'burning_wager', on });
  };

  /** His call is on the table this round and you have not thrown yet. */
  const hisTurn = (): boolean => !!call && flow.phase() === 'throw' && flow.state().caller === 'b';

  const render = (v: FlowView): void => {
    const st = flow.state();
    score.textContent = t('promise.score.champ', { a: v.score.you, b: v.score.ada });
    cracks.textContent = t('promise.cracks.champ', { a: v.cracks.you, b: v.cracks.ada });
    // the deciding stretch: the board goes red and the music cuts to the clock and breathing
    final = !st.done && v.phase !== 'end' && matchPoint(st);
    root.classList.toggle('final', final);
    mp.textContent = final ? t('promise.final') : '';
    setMusic(v.phase !== 'end' && v.phase !== 'closed' && !final);
    // his call reads on its own line, big: the patter, or the bare word
    const first = v.lines[0];
    const his = !!first && (first.key === `${P}champ.promise` || first.key === `${P}champ.quiet`);
    callEl.textContent = his ? text(first) : '';
    head.textContent = v.head ? text(v.head) : '';
    lines.textContent = '';
    for (const l of his ? v.lines.slice(1) : v.lines) h('div', '', lines, text(l));
    for (const b of btns) { b.disabled = !v.pick; b.hidden = v.finish; }
    eyeBtn.textContent = `${t('promise.eye')} (${eyes})`;
    eyeBtn.disabled = !(hisTurn() && eyes > 0 && eyeRound !== st.round);
    eyeBtn.hidden = v.finish;
    wordBtn.hidden = v.finish || spent || !d.wordReady();
    wordBtn.disabled = !(hisTurn() && matchPoint(st));
    fin.hidden = !v.finish;
    // once a round: the tremble warning on your own call at your match point, and the friends who speak on your calls
    if (st.round !== lastRound && v.phase === 'promise') {
      lastRound = st.round;
      if (trembles(st, h0.water)) innerLine(t('promise.tremble'));
      once('friends', () => {
        if (h0.water) d.say('story.speaker.selim', `${P}help.selim`, 'bartender');
        if (h0.mimosa) d.say(`${P}who.mimosa`, `${P}help.mimosa`, 'dealer');
        if (h0.lucanAgainst) d.say(`${P}who.lucan`, `${P}help.lucan.betray`, 'dealer');
      });
    }
    if (st.done) once('end', () => { void glyph('menace'); d.sfx('stamp', 0.9); d.sfx('cheer', 0.6); });
  };

  const called = (c: AiCall): void => {
    call = c;
    hisCalls += 1;
    d.pose?.(!c.tell);
    const st = flow.state();
    d.whisper(hisCalls === 1 ? 'opens' : hisCalls % 2 === 0 ? 'quiet' : 'left');
    if (hisCalls === 2 && h0.tell) once('lucan.tell', () => d.say(`${P}who.lucan`, `${P}help.lucan.tell`, 'dealer'));
    if (c.tell && h0.silence) once('tamsin', () => d.say(`${P}who.tamsin`, 'story.duel.rival.tamsin.hint', 'dealer'));
    if (matchPoint(st)) {
      if (h0.howAda) once('lucan.ada', () => d.say(`${P}who.lucan`, 'story.duel.rival.lucan.hint.ada', 'dealer'));
      // the Champion going quiet at match point always gets the close-up (STORY_BIBLE §6.6)
      void gamblersEye({ kind: 'wide' });
    }
  };

  const eye = (): void => {
    const st = flow.state();
    if (!hisTurn() || !call || eyes <= 0 || eyeRound === st.round) return;
    eyes -= 1;
    eyeRound = st.round;
    void gamblersEye({ kind: 'wide', line: call.throw !== call.promise ? `${P}eye.break` : `${P}eye.keep` });
    render(flow.view());
  };

  const word = (): void => {
    const st = flow.state();
    if (spent || !hisTurn() || !matchPoint(st) || !d.wordReady() || !d.spendWord()) return;
    spent = true;
    render(flow.view());
  };

  const flow: Flow = createFlow({ seed: d.seed, stake: 'card', goal: WAGER_GOAL, foe: championFoe(h0.water) }, {
    render,
    // the quiet is named in your head only with Tamsin's help or Ada behind you (with her, it lasts twice as long)
    inner: (key) => { if (h0.silence || h0.ada) innerLine(t(key), h0.ada ? 4 : undefined); },
    playHand: d.playHand,
    called,
    done: (r) => { cleanup(); d.done(wagerOutcome(r, spent)); },
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = e.key;
    if (k === '1' || k === '2' || k === '3') flow.press(Number(k));
    else if (k === '4') eye();
    else if (k === '5') word();
    else if (k === 'e' || k === 'E' || k === 'Enter' || k === ' ') flow.confirm();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  let gone = false;
  function cleanup(): void {
    if (gone) return;
    gone = true;
    setMusic(false);
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }
  render(flow.view());
  if (h0.ada) d.say('evening.speaker.spouse', `${P}help.ada`, 'spouse');
  return {
    update(dt) {
      if (gone) return;
      flow.update(dt);
      // the crowd murmurs under the whole match (sound only, nobody walks); once the music cuts, a heartbeat
      if ((murmur -= dt) <= 0) { murmur = MURMUR_S; d.sfx('crowdMurmur', final ? 0.25 : 0.45); }
      if (final && (beat -= dt) <= 0) { beat = BEAT_S; d.sfx('heartbeat', 0.55); }
    },
    flow: () => flow,
    dispose: () => cleanup(),
  };
}
