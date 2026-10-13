/**
 * Coin Pusher "The Shelf" (`coinpusher`) — pure rules: no three, kit or DOM (DECISIONS C20). MACHINES_machines §10.
 *
 * Units: one unit = one coin = D (the instance denomination). A player drop stakes one unit; every coin that reaches a
 * tray credits its units (1, or GOLD_UNITS when gold). The shelf is abstracted: a coin falls into the gutter (house) with
 * `gutterLoss(width)`, otherwise it is credited to the station it crosses to (CROSS chance: the neighbour's tray).
 * Bonus shower coins are house coins credited the same way; the golden plate and the jackpot pay PLATE_UNITS.
 *
 * Economy (per drop, expected): RTP ≈ (1 − g) · (1 + p_gate · (12.5·shower + 3)) + p_gate · E[prize]. The GOVERNOR
 * steers the gutter width toward TARGET_RTP from the realised return of the last WINDOW coins, every GOV_EVERY coins.
 * Its shower knob (×0.8–1.2) takes over only at the gutter limits. `playHeadless` uses the equilibrium knobs, so
 * staff auto-play and live play share the same RTP target.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const BLOCK = 10;                 // coins per outcome block (bet = BLOCK · D)
export const TARGET_RTP = 0.88;
export const RTP_TOL = 0.03;             // per-window tolerance (informational, see tests)
export const WINDOW = 400;               // coins in the governor's rolling window
export const GOV_EVERY = 50;             // governor step cadence, coins
export const GOV_GAIN = 0.006;           // m of gutter width per unit of RTP error (low: the window is lumpy)
export const GUTTER_MIN = 0.015, GUTTER_MAX = 0.035;   // side-gutter effective width, m
export const SHOWER_MIN = 0.8, SHOWER_MAX = 1.2;
export const SHOWER_STEP = 0.01;
/** Gutter width at which the headless (uniform-aim) RTP equals TARGET_RTP. Calibrated in scratchpad sims. */
export const EQ_GUTTER = 0.0217;
export const SHOWER_S = 10, SHOWER_L = 30;
export const WALLS_S = 20;               // default walls duration, s
export const PLATE_UNITS = 50;
export const JACKPOT_COINS = 100;
export const GOLD_UNITS = 5;
export const TRAY_CAP = 50;              // coins held for an unattended station
export const SHELF_CAP = 260;            // coin pool size (shelf pile + 4 flying coins)
export const CROSS = 0.2;                // chance a coin crosses to the neighbouring station's tray
export const CENTRE = 0.2;               // |aim| below this is a centre drop
export const GATE_CENTER = 0.06, GATE_OTHER = 0.01;
export const GATE_LUCK = 0.01, GATE_LUCK_CAP = 0.15;   // +1 % absolute gate chance per luck point, cap +15 %
export const THUMP_TILT_S = 20;          // second thump within this many s → tilt
export const TILT_S = 30;
export const TRAY_TOKEN_RATE = 3;        // drops per second (hold to fire)

export const HOOK_GOLD = 'm.coinpusher.goldCoin' as ModHook;       // absolute gold chance (base 0)
export const HOOK_WALLS = 'm.coinpusher.wallsUp' as ModHook;       // walls seconds (base 20)
export const HOOK_SHOWER = 'm.coinpusher.showerSize' as ModHook;   // shower multiplier (base 1)
export const HOOK_PRIZE = 'm.coinpusher.prizeChance' as ModHook;   // prize weight multiplier (base 1)
export const HOOK_MAGNET = 'm.coinpusher.trayMagnet' as ModHook;   // crossing reduction, 0..1 (base 0)

export type Bonus = 'S' | 'L' | 'W' | 'P' | 'J';
export type Prize = 'common' | 'uncommon' | 'rare';
export type Tag = 'coin' | 'shower' | 'prize' | 'plate';
export type StationIx = 0 | 1;

export const BONUS_WEIGHTS: readonly number[] = [50, 25, 15, 8, 2];   // S, L, W, P, J (× prizeChance on P)
export const BONUS_KINDS: readonly Bonus[] = ['S', 'L', 'W', 'P', 'J'];
export const PRIZE_WEIGHTS: readonly number[] = [70, 25, 5];
export const PRIZE_KINDS: readonly Prize[] = ['common', 'uncommon', 'rare'];
export const PRIZE_UNITS: Readonly<Record<Prize, number>> = { common: 5, uncommon: 15, rare: 40 };

/** Per-round knobs, read from the governor plus the hooks. */
export interface Knobs {
  gutter: number;      // side-gutter width, m
  shower: number;      // shower size multiplier (governor × hook)
  gold: number;        // gold chance 0..1
  magnet: number;      // tray magnet 0..1 (reduces crossing)
  prize: number;       // prize weight multiplier
  walls: boolean;      // walls up: no gutter loss
  gateAdd: number;     // absolute gate-chance add (luck), already capped
}

/** One coin's fate: credited `units` to station `st` (or lost to the house when `lost`). */
export interface Fate { st: StationIx; lost: boolean; units: number; gold: boolean; tag: Tag; prize: Prize | null }
export interface Roll { coin: Fate; kind: Bonus | null; fates: Fate[]; prize: Prize | null }

/** Gutter loss probability per shelf coin: 30 % at the narrowest gutter, 60 % at the widest. */
export function gutterLoss(width: number): number {
  const k = clamp01((width - GUTTER_MIN) / (GUTTER_MAX - GUTTER_MIN));
  return 0.20 + 0.40 * k;
}

export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }

/** Chance that a drop at aim `a` (−1..1) triggers the lucky gate. */
export function gateChance(aim: number, gateAdd: number): number {
  const base = Math.abs(aim) < CENTRE ? GATE_CENTER : GATE_OTHER;
  return base + clamp(gateAdd, 0, GATE_LUCK_CAP);
}

/** Resolve where one shelf coin ends: gutter (house), or the tray it crosses to. */
function fall(rng: Rng, k: Knobs, st: StationIx, tag: Tag, units: number, gold: boolean, prize: Prize | null): Fate {
  const lost = !k.walls && rng.next() < gutterLoss(k.gutter);
  const crossP = CROSS * (1 - clamp01(k.magnet));
  const crosses = rng.next() < crossP;
  const to: StationIx = crosses ? (st === 0 ? 1 : 0) : st;
  return { st: to, lost, units: lost ? 0 : units, gold, tag, prize };
}

/** One drop by station `st` at aim `aim`: the coin, and any lucky-gate bonus it triggers. */
export function rollDrop(rng: Rng, k: Knobs, st: StationIx, aim: number): Roll {
  const gate = rng.next() < gateChance(aim, k.gateAdd);
  const gold = rng.next() < k.gold;
  const coin = fall(rng, k, st, 'coin', gold ? GOLD_UNITS : 1, gold, null);
  const out: Roll = { coin, kind: null, fates: [], prize: null };
  if (!gate) return out;
  const weights = [BONUS_WEIGHTS[0], BONUS_WEIGHTS[1], BONUS_WEIGHTS[2], BONUS_WEIGHTS[3] * Math.max(0, k.prize), BONUS_WEIGHTS[4]];
  const kind = BONUS_KINDS[rng.weightedIndex(weights)];
  out.kind = kind;
  if (kind === 'S' || kind === 'L') {
    const n = Math.round((kind === 'S' ? SHOWER_S : SHOWER_L) * k.shower);
    for (let i = 0; i < n; i++) out.fates.push(fall(rng, k, st, 'shower', 1, false, null));
  } else if (kind === 'P') {
    const p = PRIZE_KINDS[rng.weightedIndex(PRIZE_WEIGHTS)];
    out.prize = p;
    out.fates.push(fall(rng, k, st, 'prize', PRIZE_UNITS[p], false, p));
  } else if (kind === 'J') {
    for (let i = 0; i < JACKPOT_COINS; i++) out.fates.push(fall(rng, k, st, 'shower', 1, false, null));
    out.fates.push(fall(rng, k, st, 'plate', PLATE_UNITS, false, null));
  }
  return out;
}

/** Units credited by a roll (coin + bonus). */
export function rollUnits(r: Roll): number {
  let u = r.coin.units;
  for (const f of r.fates) u += f.units;
  return u;
}

// ── governor ──────────────────────────────────────────────────────────────────────────────────────
export type Gov = { w: number; ss: number; acc: [number, number]; hist: [number, number][] };

export function makeGov(): Gov { return { w: EQ_GUTTER, ss: 1, acc: [0, 0], hist: [] }; }

/** Record one coin (stake `stake` units, paid `pay` units). Returns true when a governor step ran. */
export function govRecord(g: Gov, stake: number, pay: number): boolean {
  g.acc = [g.acc[0] + stake, g.acc[1] + pay];
  if (g.acc[0] < GOV_EVERY) return false;
  g.hist.push([g.acc[0], g.acc[1]]);
  g.acc = [0, 0];
  while (g.hist.length > WINDOW / GOV_EVERY) g.hist.shift();
  govStep(g);
  return true;
}

/** Realised RTP over the rolling window (1 when nothing has been recorded yet). */
export function govRtp(g: Gov): number {
  let s = 0, p = 0;
  for (const [a, b] of g.hist) { s += a; p += b; }
  return s > 0 ? p / s : TARGET_RTP;
}

/** Proportional step: too much return → widen the gutter; at the limit, trim the shower instead (and the reverse). */
export function govStep(g: Gov): void {
  const e = govRtp(g) - TARGET_RTP;
  g.w = clamp(g.w + GOV_GAIN * e, GUTTER_MIN, GUTTER_MAX);
  if (e > 0 && g.w >= GUTTER_MAX) g.ss = clamp(g.ss - SHOWER_STEP, SHOWER_MIN, SHOWER_MAX);
  if (e < 0 && g.w <= GUTTER_MIN) g.ss = clamp(g.ss + SHOWER_STEP, SHOWER_MIN, SHOWER_MAX);
}

/** Knobs from the governor plus the hook pipeline (`mod(hook, base)`). */
export function knobsFor(g: Gov, mod: (hook: ModHook, base: number) => number, luck: number, walls: boolean): Knobs {
  return {
    gutter: g.w,
    shower: clamp(g.ss * mod(HOOK_SHOWER, 1), 0, 3),
    gold: clamp01(mod(HOOK_GOLD, 0)),
    magnet: clamp01(mod(HOOK_MAGNET, 0)),
    prize: Math.max(0, mod(HOOK_PRIZE, 1)),
    walls,
    gateAdd: clamp(luck * GATE_LUCK, 0, GATE_LUCK_CAP),
  };
}

/** Headless block (staff auto-play, bench sim): uniform aim, equilibrium knobs, same economy as the live shelf. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const k = knobsFor(makeGov(), h.mod, h.luck, false);
  let units = 0;
  const tags: string[] = [];
  for (let i = 0; i < BLOCK; i++) {
    const r = rollDrop(rng, k, rng.chance(0.5) ? 0 : 1, rng.float(-1, 1));
    units += rollUnits(r);
    if (r.kind) tags.push('bonus');
    if (r.kind === 'J') tags.push('jackpot');
  }
  return { gross: units * (bet / BLOCK), tags };
};
