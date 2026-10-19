/**
 * ADA'S KITCHEN TABLE, the overlay: draws the flow (`flow.ts`) as a small readable panel, routes the keys 1/2/3, E and Esc,
 * and shows Ada's tell as an inner line. DOM only here; the clock is the caller's `update(dt)` (sim time).
 */
import { bus } from '@/core/events';
import { registerStrings, t } from '@/core/i18n';
import { h } from '@/core/ui/widgets';
import { innerLine } from '@/core/ui/manga/inner';
import { createFlow, type Flow, type FlowResult, type FlowView, type Ref, type Stake } from './flow';
import type { EchoCtx, Hand } from './rules';
import strings from './promise.strings';
import './promise.css';

registerStrings(strings.prefix, { en: strings.en, tr: strings.tr });

export interface KitchenDeps {
  /** Where the panel goes (the UI's HUD layer). */
  parent: HTMLElement;
  seed: number;
  stake: Stake;
  /** Set = the N8 wager (the story's trust in Ada's echo); the stake is then her name. */
  wager?: EchoCtx;
  /** The first-person hand pose (viewmodel `rpsRock` / `rpsPaper` / `rpsScissors`). */
  playHand(h: Hand): void;
  done(r: FlowResult): void;
}

export interface Kitchen { update(dt: number): void; flow(): Flow; dispose(): void }

const text = (r: Ref): string => {
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(r.vars ?? {})) vars[k] = typeof v === 'string' && v.startsWith('promise.') ? t(v) : v;
  return t(r.key, vars);
};

export function openKitchen(d: KitchenDeps): Kitchen {
  const root = h('div', 'pm-table', d.parent);
  root.setAttribute('role', 'group');
  const title = h('div', 'pm-title', root);
  const ttl = h('span', '', title, t('promise.title'));
  const stk = h('span', '', title);
  const score = h('div', 'pm-score', root);
  const cracks = h('div', 'pm-cracks', root);
  const head = h('div', 'pm-head', root);
  const lines = h('div', 'pm-lines', root);
  const keys = h('div', 'pm-keys', root);
  const hint = h('div', 'pm-hint', root);
  void ttl;
  const hands: Hand[] = ['rock', 'paper', 'scissors'];
  const btns = hands.map((hd, i) => {
    const b = h('button', '', keys, `${i + 1} ${t(`promise.hand.${hd}`)}`);
    b.type = 'button';
    b.addEventListener('click', () => flow.press(i + 1));
    return b;
  });
  const me = h('button', '', keys, `4 ${t('promise.metoo')}`);
  me.type = 'button';
  me.addEventListener('click', () => flow.press(4));
  const fin = h('button', '', keys, t('promise.continue'));
  fin.type = 'button';
  fin.addEventListener('click', () => flow.confirm());

  const render = (v: FlowView): void => {
    // Ada's music box (music/songs/cues.ts) turns dark on match point
    bus.emit('music:cue', { cue: 'duel:ada', on: v.phase !== 'end' && v.phase !== 'closed', final: Math.max(v.score.you, v.score.ada) >= v.goal - 1 });
    stk.textContent = t('promise.stake', { stake: t(`promise.stake.${v.stake}`) });
    score.textContent = t('promise.score', { a: v.score.you, b: v.score.ada });
    cracks.textContent = t('promise.cracks', { a: v.cracks.you, b: v.cracks.ada });
    head.textContent = v.head ? text(v.head) : '';
    lines.textContent = '';
    for (const l of v.lines) h('div', '', lines, text(l));
    for (const b of btns) b.disabled = !v.pick;
    me.disabled = !(v.pick && v.head?.key === 'promise.turn.throw.ada') || !!d.wager;
    me.hidden = v.finish || !!d.wager;
    fin.hidden = !v.finish;
    for (const b of btns) b.hidden = v.finish;
    hint.textContent = t('promise.keys');
  };

  const flow: Flow = createFlow({ seed: d.seed, stake: d.stake, wager: d.wager }, {
    render,
    inner: (key) => innerLine(t(key)),
    playHand: d.playHand,
    done: (r) => { cleanup(); d.done(r); },
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const k = e.key;
    if (k === '1' || k === '2' || k === '3') flow.press(Number(k));
    else if (k === '4') flow.press(4);
    else if (k === 'e' || k === 'E' || k === 'Enter' || k === ' ') flow.confirm();
    else if (k === 'Escape') flow.leave();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  let gone = false;
  function cleanup(): void {
    if (gone) return;
    gone = true;
    bus.emit('music:cue', { cue: 'duel:ada', on: false });
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }
  render(flow.view());
  return {
    update: (dt) => { if (!gone) flow.update(dt); },
    flow: () => flow,
    dispose: () => cleanup(),
  };
}
