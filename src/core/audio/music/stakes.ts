/**
 * The stakes layer (CORE-AUDIO / music): how much the moment is worth, 0..1, fed by game events, and the overlay every
 * floor bed wears for it. The conductor keeps one {@link StakesMeter} (sources set by bus events, combined, slewed) and
 * writes its value into the arrangement as the gates' `s`. The overlay parts enter at fixed thresholds:
 *
 *   0.2 low drums  ·  0.4 driving bass ostinato  ·  0.6 brass stabs  ·  0.8 choir pad
 *
 * They are written from the bed's own chart and bar clock, so they are in key and tempo-locked with it.
 * Pure (no audio): the mapping and the smoothing are unit-tested (scripts/tests/music.stakes.test.mjs).
 */
import { D } from './dsp';
import { byS, type PartDef, type SongDef } from './model';
import { bassPat, comp, note, pad } from './parts';

/** Where each overlay layer comes in. */
export const LAYER_AT = { drums: 0.2, bass: 0.4, stabs: 0.6, choir: 0.8 } as const;
/** Calm: the stakes stop below the stabs (no sudden hits) and rise half as fast. */
export const CALM_CAP = 0.5;
/** Slew time constants (s): up fast enough to follow a bet, down slowly so a moment lingers. */
export const RISE_TAU = 1.2, FALL_TAU = 4;
/** Fixed source values for the event kinds that are not a sliding scale. */
export const STAKE = { lastCall: 0.5, tease: 0.75, duel: 0.35, final: 0.85, chase: 0.9 } as const;
/** How far the stakes lift the bed's own intensity (busier, a little faster) on top of the overlay. */
export const STAKES_TO_I = 0.7;
/** Seconds a bet / a tease / an open gamble keeps the stakes up when nothing closes it. */
export const HOLD = { bet: 8, tease: 4, gamble: 20 } as const;

/** A bet over 25 % of the pocket climbs from 0.5 (to 1 at all-in); otherwise a bet 3x the usual one is 0.4; else 0. */
export function betStakes(bet: number, pocket: number, usual: number): number {
  if (!(bet > 0)) return 0;
  const r = pocket > 0 ? bet / pocket : 1;
  if (r >= 0.25) return 0.5 + 0.5 * Math.min(1, (r - 0.25) / 0.75);
  return usual > 0 && bet >= 3 * usual ? 0.4 : 0;
}

/** `gamble:fx` kind → stakes while the gamble is open; null = it closed (collect, lose, cancel). */
export function gambleStakes(kind: string, step: number): number | null {
  switch (kind) {
    case 'offer': case 'open': case 'hsOn': case 'hsBoost': return 0.5;
    case 'tension': case 'flip': case 'win': return Math.min(0.95, 0.6 + 0.08 * Math.max(0, step));
    case 'max': return 0.9;
    case 'allinArm': return 0.85;
    case 'allinFire': return 1;
    default: return null;
  }
}

/** Dread above 0.4 adds up to 0.6 (the horror overlay carries the rest). */
export const dreadStakes = (d: number): number => (d > 0.4 ? 0.6 * Math.min(1, (d - 0.4) / 0.6) : 0);

/** Named sources, each 0..1 with an optional expiry, combined as 1 − Π(1 − v) and slewed. Times are seconds. */
export class StakesMeter {
  value = 0;
  calm = false;
  private readonly src = new Map<string, { v: number; until: number }>();

  /** Source `id` at `v` (≤ 0 clears it) for `hold` seconds, or until changed. */
  set(id: string, v: number, now: number, hold = Infinity): void {
    if (!(v > 0)) this.src.delete(id);
    else this.src.set(id, { v: Math.min(1, v), until: now + hold });
  }
  clear(): void { this.src.clear(); }

  target(now: number): number {
    let keep = 1;
    for (const [id, e] of this.src) {
      if (now >= e.until) { this.src.delete(id); continue; }
      keep *= 1 - e.v;
    }
    const t = 1 - keep;
    return this.calm ? Math.min(CALM_CAP, t) : t;
  }

  /** Advance by `dt` seconds toward the target; returns the new value. */
  tick(now: number, dt: number): number {
    const t = this.target(now);
    const tau = t > this.value ? RISE_TAU * (this.calm ? 2 : 1) : FALL_TAU;
    this.value += (t - this.value) * (1 - Math.exp(-Math.max(0, dt) / tau));
    if (Math.abs(this.value - t) < 1e-3) this.value = t;
    return this.value;
  }
}

// ── the overlay ─────────────────────────────────────────────────────────────────────────────────
/** Low drums: a boom on the one, low toms on the other beats, a tom roll into every fourth bar. Any meter. */
const lowDrums = (): PartDef => ({
  id: 'stk.drums', inst: 'drums', gate: byS(LAYER_AT.drums),
  make: () => (b, push) => {
    for (let p = 0; p < b.beats; p++) note(push, b, 'drums', p, 0.1, p === 0 ? D.BOOM : D.TOM_LO, p === 0 ? 0.8 : 0.42);
    if (b.phraseBar === 3) for (let p = b.beats - 1; p < b.beats - 1e-6; p += 0.25) note(push, b, 'drums', p, 0.1, D.TOM_MID, 0.3 + (p - b.beats + 1) * 0.5);
  },
});

/** The high-stakes overlay, from the bed's own chart: low drums → bass ostinato → brass stabs → choir. */
export function stakesLayer(): PartDef[] {
  return [
    lowDrums(),
    bassPat('stk.bass', 'synBass', { pat: 'root8', lo: 28, hi: 45, vel: 0.62, gate: byS(LAYER_AT.bass) }),
    comp('stk.stabs', 'brass', { rh: 'stab16', kind: 'triad', lo: 53, hi: 74, vel: 0.42, gate: byS(LAYER_AT.stabs) }),
    pad('stk.choir', 'choir', { kind: 'open', lo: 50, hi: 74, vel: 0.5, gate: byS(LAYER_AT.choir), x: 2 }),
  ];
}

/** Bed with the stakes overlay appended (floor beds). */
export const withStakes = (song: SongDef): SongDef => ({ ...song, parts: [...song.parts, ...stakesLayer()] });
