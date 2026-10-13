/**
 * One-Armed Bandit — pure rules (no three, no DOM, no kit). Shared by the live machine (`index.ts`) and the headless
 * play contract (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP.
 *
 * Rules (MACHINES_machines §3): credits 1–3 × denomination {1, 5, 25}, centre payline only. Three reels of 22 physical
 * stops (= 22 symbol runs of the 64-stop virtual strip). Each reel draws one of 64 virtual stops with its weights, and
 * the weights map to a physical stop. Lucky Nudge: on a loss, with p = min(4 %, 0.4 % · luck), the best single-stop
 * nudge is applied (never creates STAR×3). Charm `jackpotChance` forces STAR×3 with extra chance (mult−1)/65 536.
 *
 * Every roll consumes exactly five RNG draws, so the stream position never depends on the outcome or on the charms.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Sym = 'STAR' | 'PLUM' | 'ORANGE' | 'MELON' | 'BAR' | '2BAR' | '3BAR' | 'SHOE' | 'BLANK';
export type LineKind = 'none' | 'top' | 'triple' | 'anyBar' | 'shoe';

/** The 22 physical stops of one strip, in order: a symbol run then a blank run, starting at STAR. */
export const SEGMENTS: readonly Sym[] = [
  'STAR', 'BLANK', 'PLUM', 'BLANK', 'BAR', 'BLANK', 'ORANGE', 'BLANK', '3BAR', 'BLANK', 'SHOE', 'BLANK',
  'MELON', 'BLANK', 'PLUM', 'BLANK', '2BAR', 'BLANK', 'ORANGE', 'BLANK', 'BAR', 'BLANK',
];
/** Virtual weights per physical stop (each reel sums to 64). Reels 0 and 1 share strip A; reel 2 uses strip B. */
const WEIGHTS_A = [2, 3, 5, 2, 4, 2, 5, 2, 3, 1, 4, 1, 6, 1, 5, 1, 5, 1, 4, 1, 3, 3];
const WEIGHTS_B = [1, 4, 5, 2, 4, 2, 4, 2, 3, 1, 4, 1, 5, 1, 5, 1, 4, 2, 4, 2, 3, 4];
export const REEL_WEIGHTS: readonly (readonly number[])[] = [WEIGHTS_A, WEIGHTS_A, WEIGHTS_B];
/** Reel 1 is rotated +7 stops against reel 0 (cosmetic: only the facet sitting on the payline changes). */
export const REEL_ROT: readonly number[] = [0, 7, 0];
export const STOPS = 22;
export const VIRTUAL = 64;
export const DENOMS: readonly number[] = [1, 5, 25];
export const MAX_CREDITS = 3;
/** Lucky Nudge: 0.4 % chance per luck point on a loss, capped at 4 % (luck 10 keeps RTP ≤ 99 %). */
export const NUDGE_STEP = 0.004;
export const NUDGE_CAP = 0.04;

/** Pays per credit for a triple (STAR is the top award, see `evalLine`). */
export const TRIPLE_PAY: Partial<Record<Sym, number>> = { PLUM: 20, ORANGE: 30, MELON: 100, BAR: 50, '2BAR': 100, '3BAR': 200, SHOE: 50 };
export const ANY_BAR_PAY = 15;
/** SHOE pays for exactly one / exactly two shoes (three is a triple). Per credit. */
export const SHOE_PAY: Readonly<Record<1 | 2, number>> = { 1: 2, 2: 6 };
export const TOP_AWARD = 1000;                 // per credit, credits 1–2
const TOP_3CR_BASE = 3000;                     // 3 credits: 5 000 total …
const TOP_3CR_BONUS = 2000;                    // … of which 2 000 is the 3rd-credit bonus (× thirdBonus charm)

const isBar = (s: Sym): boolean => s === 'BAR' || s === '2BAR' || s === '3BAR';
const FRUITS: readonly Sym[] = ['PLUM', 'ORANGE', 'MELON'];

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_LUCK = 'm.bandit.luckBonus' as ModHook;
export const HOOK_PAYOUT = 'm.bandit.payoutMult' as ModHook;
export const HOOK_JACKPOT = 'm.bandit.jackpotChance' as ModHook;
export const HOOK_SHOE_WILD = 'm.bandit.shoeWild' as ModHook;
export const HOOK_THIRD = 'm.bandit.thirdCoinBonus' as ModHook;
export const hookSymbolAdd = (s: Sym): ModHook => `m.bandit.symbolPayAdd.${s}` as ModHook;

export interface PayCfg {
  mult: number;                                  // payoutMult (all payouts)
  add: Partial<Record<Sym, number>>;             // symbolPayAdd per credit
  shoeWild: boolean;                             // SHOE substitutes for PLUM/ORANGE/MELON in a triple
  thirdBonus: number;                            // multiplier on the 3-credit top-award bonus part
}
export const BASE_CFG: PayCfg = { mult: 1, add: {}, shoeWild: false, thirdBonus: 1 };

/** Reads the charm hooks through a `mod(hook, base)` function (MachineBase.mod or HeadlessHooks.mod). */
export function readCfg(mod: (hook: ModHook, base: number) => number): PayCfg {
  const add: Partial<Record<Sym, number>> = {};
  for (const s of ['STAR', ...Object.keys(TRIPLE_PAY)] as Sym[]) {
    const v = mod(hookSymbolAdd(s), 0);
    if (v) add[s] = v;
  }
  return {
    mult: Math.max(0, mod(HOOK_PAYOUT, 1)),
    add,
    shoeWild: mod(HOOK_SHOE_WILD, 0) > 0,
    thirdBonus: Math.max(0, mod(HOOK_THIRD, 1)),
  };
}

export interface Line { units: number; kind: LineKind }   // units = credit-units paid (× denomination = coins)

/** Pays of one centre line for `credits` staked. Pure. */
export function evalLine(syms: readonly Sym[], credits: number, cfg: PayCfg): Line {
  const [a, b, c] = syms;
  if (a === 'STAR' && b === 'STAR' && c === 'STAR') {
    const base = credits >= MAX_CREDITS ? TOP_3CR_BASE + TOP_3CR_BONUS * cfg.thirdBonus : TOP_AWARD * credits;
    return { units: (base + (cfg.add.STAR ?? 0) * credits) * cfg.mult, kind: 'top' };
  }
  // SHOE wild: two equal fruits plus shoes make a triple of that fruit
  const nonShoe = syms.filter((s) => s !== 'SHOE');
  if (cfg.shoeWild && nonShoe.length > 0 && nonShoe.length < 3 && nonShoe.every((s) => s === nonShoe[0]) && FRUITS.includes(nonShoe[0])) {
    const s = nonShoe[0];
    return { units: ((TRIPLE_PAY[s] ?? 0) + (cfg.add[s] ?? 0)) * credits * cfg.mult, kind: 'triple' };
  }
  if (a === b && b === c) {
    return { units: ((TRIPLE_PAY[a] ?? 0) + (cfg.add[a] ?? 0)) * credits * cfg.mult, kind: 'triple' };
  }
  if (syms.every(isBar)) return { units: ANY_BAR_PAY * credits * cfg.mult, kind: 'anyBar' };
  const shoes = syms.filter((s) => s === 'SHOE').length;
  if (shoes === 1 || shoes === 2) return { units: SHOE_PAY[shoes] * credits * cfg.mult, kind: 'shoe' };
  return { units: 0, kind: 'none' };
}

/** Segment index (0..21) of one virtual draw `v` (0..63) on `reel`. */
export function segmentOf(reel: number, v: number): number {
  const w = REEL_WEIGHTS[reel];
  let acc = 0;
  for (let s = 0; s < w.length; s++) {
    acc += w[s];
    if (v < acc) return s;
  }
  return w.length - 1;
}

/** Facet index on the drum (what sits on the payline when `seg` is the stop). */
export const facetOf = (reel: number, seg: number): number => (seg + REEL_ROT[reel]) % STOPS;
/** Symbol shown on drum facet `f` of `reel`, in drum order (for the texture strip). */
export const facetSymbol = (reel: number, f: number): Sym => SEGMENTS[(((f - REEL_ROT[reel]) % STOPS) + STOPS) % STOPS];

export interface Nudge { reel: number; dir: 1 | -1 }
export interface Roll {
  /** Base stops (segment index) before any nudge. */
  base: [number, number, number];
  /** Final stops after nudge / forced jackpot. */
  seg: [number, number, number];
  syms: Sym[];
  nudge: Nudge | null;
  /** Charm jackpotChance forced STAR×3. */
  forced: boolean;
  /** Two STARs on the line and the third reel shows a STAR directly above or below the line. */
  near: boolean;
  line: Line;
}

const symsOf = (seg: readonly number[]): Sym[] => seg.map((s) => SEGMENTS[s]);
const isStar3 = (seg: readonly number[]): boolean => seg.every((s) => SEGMENTS[s] === 'STAR');

/** Best single-stop nudge (a loss only). Ties → rightmost reel, then downward (dir +1). Never creates STAR×3. */
export function bestNudge(seg: readonly number[], credits: number, cfg: PayCfg): { nudge: Nudge; seg: [number, number, number] } | null {
  let best: { nudge: Nudge; seg: [number, number, number] } | null = null;
  let bestUnits = 0;
  for (let r = REEL_WEIGHTS.length - 1; r >= 0; r--) {
    for (const dir of [1, -1] as const) {
      const s2: [number, number, number] = [seg[0], seg[1], seg[2]];
      s2[r] = (seg[r] + dir + STOPS) % STOPS;
      if (isStar3(s2)) continue;
      const u = evalLine(symsOf(s2), credits, cfg).units;
      if (u > bestUnits) { bestUnits = u; best = { nudge: { reel: r, dir }, seg: s2 }; }
    }
  }
  return best;
}

/** Near miss: exactly two STARs centred, and the third reel's neighbouring stop shows a STAR. Cosmetic tag. */
export function nearMiss(seg: readonly number[]): boolean {
  const centre = symsOf(seg);
  const stars = centre.filter((s) => s === 'STAR').length;
  if (stars !== 2) return false;
  return seg.some((s) => SEGMENTS[s] !== 'STAR'
    && (SEGMENTS[(s + 1) % STOPS] === 'STAR' || SEGMENTS[(s - 1 + STOPS) % STOPS] === 'STAR'));
}

export interface RollOpts { credits: number; luck: number; cfg: PayCfg; jackpot: number }

/**
 * One pull. Always five draws: three virtual stops, the nudge gate, the jackpot gate. `luck` is the percentage of the
 * Lucky Nudge (a negative value disables it). `jackpot` is the jackpotChance multiplier (1 = off).
 */
export function roll(rng: Rng, o: RollOpts): Roll {
  const v0 = rng.int(0, VIRTUAL - 1), v1 = rng.int(0, VIRTUAL - 1), v2 = rng.int(0, VIRTUAL - 1);
  const gate = rng.next(), jp = rng.next();
  const base: [number, number, number] = [segmentOf(0, v0), segmentOf(1, v1), segmentOf(2, v2)];
  let seg: [number, number, number] = [base[0], base[1], base[2]];
  let forced = false;
  if (!isStar3(seg) && o.jackpot > 1 && jp < (o.jackpot - 1) / 65536) {
    seg = [0, 0, 0];                           // STAR is segment 0 on every reel
    forced = true;
  }
  let line = evalLine(symsOf(seg), o.credits, o.cfg);
  let nudge: Nudge | null = null;
  if (line.units === 0 && o.luck > 0) {
    const p = Math.min(NUDGE_CAP, NUDGE_STEP * o.luck);
    if (gate < p) {
      const best = bestNudge(seg, o.credits, o.cfg);
      if (best) { nudge = best.nudge; seg = best.seg; line = evalLine(symsOf(seg), o.credits, o.cfg); }
    }
  }
  return { base, seg, syms: symsOf(seg), nudge, forced, near: line.units === 0 && nearMiss(seg), line };
}

/** Coins paid for `units` at denomination `denom` (floored; the machine keeps the remainder as dust). */
export const coinsFor = (units: number, denom: number): number => Math.floor(units * denom + 1e-9);

/** Splits a total bet into credits × denomination (credits 1–3, denomination from DENOMS). */
export function splitBet(bet: number): { credits: number; denom: number } {
  for (const c of [3, 2, 1]) {
    if (bet % c === 0 && DENOMS.includes(bet / c)) return { credits: c, denom: bet / c };
  }
  return { credits: 1, denom: bet };
}

/** Tags for the outcome (`win`/`loss` plus machine-specific ones). */
export function tagsOf(r: Roll): string[] {
  const t: string[] = [r.line.units > 0 ? 'win' : 'loss'];
  if (r.line.kind === 'top') t.push('jackpot');
  if (r.near) t.push('nearmiss');
  if (r.nudge && r.line.units > 0) t.push('lucky');
  return t;
}

/** Headless single pull (staff auto-play and balance sims). Same rules as the live machine. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const { credits, denom } = splitBet(bet);
  const cfg = readCfg((hook, base) => h.mod(hook, base));
  const r = roll(rng, { credits, luck: h.luck, cfg, jackpot: h.mod(HOOK_JACKPOT, 1) });
  return { gross: coinsFor(r.line.units, denom), tags: tagsOf(r) };
};
