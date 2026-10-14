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

export interface ProcPops {
  /** Shows gold pop text for one proc; empty text is ignored. At most MAX_POPS live at once (oldest dropped). */
  show(text: string): void;
  dispose(): void;
}

/** Pop stack: each live pop sits one row lower than the one before (`--i`), removed after POP_LIFE_MS. */
export function createProcPops(root: HTMLElement): ProcPops {
  let live: HTMLElement[] = [];
  return {
    show(text: string): void {
      if (!text) return;
      while (live.length >= MAX_POPS) live.shift()?.remove();
      const el = h('div', 'charm-pop', root, text);
      el.style.setProperty('--i', String(live.length));
      live.push(el);
      window.setTimeout(() => {
        el.remove();
        live = live.filter((p) => p !== el);
      }, POP_LIFE_MS);
    },
    dispose(): void {
      for (const el of live) el.remove();
      live = [];
    },
  };
}
