/**
 * Charm proc juice + live peg counters (wave 8, item 9). Owner: HUD lane. Pure helpers; `hud.ts` wires them to the bus.
 *  - `playProcTick(tier)`: rising-pitch tick, ratio 1 + 0.06·tier (PlayOpts.pitch in semitones).
 *  - `createProcPops(root)`: gold pop text ("×1.48") stacked near the top centre of the screen.
 *  - `pegBadge(id, data)`: the charm's `badge(data)` as peg text ('' = none).
 */
import { app } from '@/core/app';
import type { Json } from '@/core/types';
import { h } from '@/core/ui/widgets';
import { charmDef } from '@/game/charms/engine';

const MAX_POPS = 4;
const POP_LIFE_MS = 900;

/** Semitones for a proc tier: frequency ratio 1 + 0.06·tier. Tier 0 (or junk) = no shift. */
export function procTickSemitones(tier: number): number {
  const t = Number.isFinite(tier) && tier > 0 ? tier : 0;
  return 12 * Math.log2(1 + 0.06 * t);
}

/** One proc tick on the UI bus. Silent when audio is not ready. */
export function playProcTick(tier: number): void {
  try { app.audio.play('charmTick', { bus: 'ui', vol: 0.8, pitch: procTickSemitones(tier) }); } catch { /* audio is optional */ }
}

/** Counter charms: the cap of their raw count, shown as "3/6". */
const COUNTER_MAX: Readonly<Record<string, number>> = { suit_ladder: 6, pressure_valve: 8, capacitor: 6, snowball_ledger: 3 };
/** Lampwick counts wicks; each wick is +8 % on the payout. */
const WICK_PCT = 8;

/** Live peg text from the charm's `badge(data)`, readable: "3/6", "+16%". '' when the charm shows none. */
export function pegBadge(id: string, data: Json | undefined): string {
  const bag = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, Json>) : {};
  const v = charmDef(id)?.badge?.(bag);
  if (v === null || v === undefined || v === '' || v === 0) return '';
  if (typeof v !== 'number') return String(v);
  if (id === 'lampwick') return `+${WICK_PCT * v}%`;
  const max = COUNTER_MAX[id];
  return max !== undefined ? `${v}/${max}` : String(v);
}

/**
 * How big a pop is: 0 small, 1 medium, 2 big. Big = a proc tier of 3 or more, a multiplier of 2× or more, or a +25 % or
 * more. Read from the tier and the label text, so a plain "+8%" stays small.
 */
export function popSize(text: string, tier = 0): 0 | 1 | 2 {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  const v = Number.isFinite(n) ? n : 0;
  const mult = text.includes('×');
  const pct = text.includes('%');
  if (tier >= 3 || (mult && v >= 2) || (pct && v >= 25)) return 2;
  if (tier >= 1 || (mult && v >= 1.5) || (pct && v >= 12)) return 1;
  return 0;
}

/**
 * Gold burst behind a pop or a win: a ring and a spray of sparks from the spot `top` (a CSS length in the root).
 * Removes itself. size 0 small, 1 medium, 2 big (more sparks, reach and life).
 */
export function goldBurst(root: HTMLElement, top: string, size: 0 | 1 | 2): void {
  const wrap = h('div', 'charm-burst', root);
  wrap.style.cssText = `position:absolute;left:50%;top:${top};width:0;height:0;pointer-events:none;`;
  const ring = h('div', '', wrap);
  ring.style.cssText = 'position:absolute;left:0;top:0;width:calc(var(--u) * 10);height:calc(var(--u) * 10);'
    + 'transform:translate(-50%,-50%) scale(0.2);border-radius:50%;border:calc(var(--u) * 2) solid #ffd23c;box-shadow:0 0 calc(var(--u) * 4) #ffd23c;';
  const n = 6 + size * 4;
  const reach = (size === 2 ? 15 : size === 1 ? 10 : 7);
  const life = size === 2 ? 900 : 650;
  const ease = 'cubic-bezier(.2,.8,.3,1)';
  // Web Animations: the ring grows and fades, the sparks fly out (offsets in --u units, rounded to keep the CSS plain)
  const u = (x: number): string => `calc(var(--u) * ${(Math.round(x * 100) / 100).toFixed(2)})`;
  ring.animate(
    [{ transform: 'translate(-50%,-50%) scale(0.2)', opacity: 1 },
      { transform: `translate(-50%,-50%) scale(${size === 2 ? 4 : 2.6})`, opacity: 0 }],
    { duration: life, easing: ease, fill: 'forwards' },
  );
  for (let k = 0; k < n; k++) {
    const sp = h('div', '', wrap);
    const a = (k / n) * Math.PI * 2;
    sp.style.cssText = 'position:absolute;left:0;top:0;width:calc(var(--u) * 2);height:calc(var(--u) * 2);'
      + 'margin:calc(var(--u) * -1) 0 0 calc(var(--u) * -1);background:#ffd23c;box-shadow:0 0 calc(var(--u)) #fff1b8;';
    sp.animate(
      [{ transform: 'translate(0,0)', opacity: 1 },
        { transform: `translate(${u(Math.cos(a) * reach)}, ${u(Math.sin(a) * reach)})`, opacity: 0 }],
      { duration: life, easing: ease, fill: 'forwards' },
    );
  }
  window.setTimeout(() => wrap.remove(), life + 60);
}

export interface ProcPops {
  /**
   * Shows gold pop text for one proc; empty text is ignored. At most MAX_POPS live at once (oldest dropped). `tier` (the
   * proc tier, optional) and the label size the pop: medium and big pops add a gold burst, a big one also scales up and
   * gives the camera a short shake (`app.fx`, which honours the shake setting).
   */
  show(text: string, tier?: number): void;
  dispose(): void;
}

/** Pop stack: each live pop sits one row lower than the one before (`--i`), removed after POP_LIFE_MS. */
export function createProcPops(root: HTMLElement): ProcPops {
  let live: HTMLElement[] = [];
  return {
    show(text: string, tier = 0): void {
      if (!text) return;
      while (live.length >= MAX_POPS) live.shift()?.remove();
      const el = h('div', 'charm-pop', root, text);
      const size = popSize(text, tier);
      const i = live.length;
      el.style.setProperty('--i', String(i));
      if (size === 2) el.style.fontSize = 'calc(26 * var(--u))';
      else if (size === 1) el.style.fontSize = 'calc(21 * var(--u))';
      el.style.textShadow = 'calc(var(--u) * 2) calc(var(--u) * 2) 0 #000';
      live.push(el);
      if (size > 0) goldBurst(root, `calc(30% + 12 * ${i} * var(--u))`, size);
      if (size === 2) {
        try { app.fx.shake(0.018, 0.3, { roll: 0.4 }); } catch { /* the shake is optional */ }
      }
      window.setTimeout(() => {
        el.remove();
        live = live.filter((p) => p !== el);
      }, POP_LIFE_MS);
    },
    dispose(): void {
      for (const el of live) el.remove();
      live = [];
      for (const b of root.querySelectorAll('.charm-burst')) b.remove();
    },
  };
}
