/**
 * Charm proc juice + live peg counters (wave 8, item 9). Owner: HUD lane. Pure helpers; `hud.ts` wires them to the bus.
 *  - `playProcTick(tier)`: rising-pitch tick, ratio 1 + 0.06·tier (PlayOpts.pitch in semitones).
 *  - `createProcPops(root)`: gold pop text ("×1.48") stacked near the top centre of the screen.
 *  - `pegBadge(id, data)`: the charm's `badge(data)` as short peg face text, "3/8" ('' = none).
 *  - `pegLabel(id, data)`: the full localised readout, "PRESSURE 3/8 · next win ×1.3" (for the peg's hover title).
 *  - An evolved engine charm (its bag has `evo`, wave 7) shows a "+" on its peg and "EVOLVED" first in its label.
 *  - `renderSetChips(root, sets)`: the active archetype sets (sets.ts) as small chips in the peg strip.
 */
import { app } from '@/core/app';
import { type I18nVars, lang, t } from '@/core/i18n';
import type { Json } from '@/core/types';
import { h } from '@/core/ui/widgets';
import { charmDef } from '@/game/charms/engine';
import { type EngineTune, isEvo, tuneOf } from '@/game/charms/engines';
import { type SetId } from '@/game/charms/sets';

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

/**
 * Engine counter readouts. `max` is the cap of the raw count (per tune: base or evolved); `next` is the multiplier the next
 * win pays at count n, `pct` the bonus percent at count n. Rates come from the tune, so the label cannot drift from the payout.
 */
interface Readout {
  max: (tu: EngineTune) => number;
  next?: (n: number, tu: EngineTune) => number;
  pct?: (n: number, tu: EngineTune) => number;
}
const READOUTS: Readonly<Record<string, Readout>> = {
  suit_ladder: { max: (tu) => tu.rungMax, next: (n, tu) => 1 + tu.rung * n },
  pressure_valve: { max: (tu) => tu.pressureMax, next: (n, tu) => 1 + tu.pressure * n },
  capacitor: { max: (tu) => tu.chargeMax, next: (n, tu) => 1 + tu.charge * n },
  lampwick: { max: (tu) => tu.wickMax, pct: (n, tu) => Math.round(tu.wickHot * n * 100) },
  snowball_ledger: { max: (tu) => tu.watchMax, pct: (n, tu) => Math.round(tu.watchInterest * n * 100) },
};

const bagOf = (data: Json | undefined): Record<string, Json> =>
  data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, Json>) : {};

/** The charm's live count from its `badge(data)`; 0 when it has none. */
function countOf(id: string, data: Json | undefined): number {
  const v = charmDef(id)?.badge?.(bagOf(data));
  return typeof v === 'number' && v > 0 ? v : 0;
}

/** A multiplier for the label: "1.3", "1.24" (Turkish "1,3"). */
function fmtX(m: number): string {
  const s = String(Number(m.toFixed(2)));
  return lang() === 'tr' ? s.replace('.', ',') : s;
}

/**
 * Short peg face text from the charm's `badge(data)`: "3/8" for counters, "+16%" for wicks. '' when the charm shows none.
 * An evolved charm adds "+" after it ("3/10+"), or shows "+" alone when it has no count.
 */
export function pegBadge(id: string, data: Json | undefined): string {
  const bag = bagOf(data);
  const text = pegCountText(id, charmDef(id)?.badge?.(bag), tuneOf(bag));
  if (!isEvo(bag)) return text;
  return text ? `${text}+` : '+';
}

function pegCountText(id: string, v: Json | null | undefined, tu: EngineTune): string {
  if (v === null || v === undefined || v === '' || v === 0) return '';
  if (typeof v !== 'number') return String(v);
  const r = READOUTS[id];
  if (r?.pct) return `+${r.pct(v, tu)}%`;
  return r ? `${v}/${r.max(tu)}` : String(v);
}

/**
 * Full readable peg label for an engine counter, localised: "PRESSURE 3/8 · next win ×1.3", "WICKS 2/6 · Hot +16%".
 * '' when the charm has no live count (the peg then shows its initial). For the peg's hover title. An evolved charm
 * leads with "EVOLVED"; without a count it reads "EVOLVED · <what the evolution does>".
 */
export function pegLabel(id: string, data: Json | undefined): string {
  const bag = bagOf(data);
  const evo = isEvo(bag);
  const r = READOUTS[id];
  const n = countOf(id, data);
  if (!r || n <= 0) return evo ? `${t('hud.evo.label')} · ${t(`hud.evo.${id}`)}` : '';
  const tu = tuneOf(bag);
  const vars: I18nVars = { n, max: r.max(tu) };
  if (r.next) vars.x = fmtX(r.next(n, tu));
  if (r.pct) vars.pct = r.pct(n, tu);
  const line = t(`hud.charm.peg.${id}`, vars);
  return evo ? `${t('hud.evo.label')} · ${line}` : line;
}

/** A set's name as its chip shows it, localised ("Hot Set"). */
export function setChipName(id: SetId): string { return t(`hud.set.${id}.name`); }

/**
 * Shows the active archetype sets as small chips in `root` (the strip of pegs), replacing the chips already there. A set
 * off is simply not in `sets`, so its chip goes. Each chip's hover text is the set's bonus. Returns the chips, in `sets` order.
 */
export function renderSetChips(root: HTMLElement, sets: readonly SetId[]): HTMLElement[] {
  for (const old of root.querySelectorAll('.set-chip')) old.remove();
  return sets.map((s) => {
    const chip = h('span', 'set-chip', root, setChipName(s));
    chip.title = t(`hud.set.${s}.desc`);
    chip.style.cssText = 'display:inline-block;margin:0 calc(var(--u) * 3) calc(var(--u) * 2) 0;padding:calc(var(--u) * 1) calc(var(--u) * 3);'
      + 'font-size:calc(var(--u) * 7);line-height:1.2;color:#1b1206;background:#ffd23c;border:calc(var(--u) * 1) solid #000;'
      + 'box-shadow:calc(var(--u) * 2) calc(var(--u) * 2) 0 #000;pointer-events:none;white-space:nowrap;';
    return chip;
  });
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
  // Reduced motion: the burst is motion, so it is not drawn (the pop text and the figure still read).
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
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
