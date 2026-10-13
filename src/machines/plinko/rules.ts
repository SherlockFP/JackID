/**
 * Plinko Board — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the headless play
 * contract (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP.
 *
 * Rules (MACHINES_machines §9): pick a risk (LOW / MID / HIGH), a stake per puck (1–100) and 1–5 pucks. Each puck
 * takes 12 left/right bounces; slot k = number of rights (binomial 1:12:66:220:495:792:924…/4096). It pays
 * stake × multiplier[slot]. Stake is debited per puck; extra pucks (charm) are free.
 *
 * Randomness: every puck consumes exactly 24 draws (bit + repeat per row) and every drop 2 golden draws, whatever
 * the luck or charms, so a seed replays identically. Expected return is capped at PAYOUT_CAP (97 %), which compensates
 * the Rubber Pegs repeats, extra pucks, golden slots, edge and floor charms (base tables stay at 96.4 / 96.7 / 96.4 %). Money: the exact float payout is rounded with a carry
 * (stochastic / dust rounding), so the average is unbiased even for 1-coin stakes.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const ROWS = 12;                 // hops per puck
export const SLOTS = 13;                // bottom slots 0..12
export const PUCK_GAP_MS = 300;         // drops are spaced 0.30 s apart
export const MAX_PUCKS = 5;             // paid pucks per drop
export const MAX_EXTRA = 3;             // charm extra pucks cap (free, same stake)
export const LUCK_STEP = 0.01;          // Rubber Pegs: per luck point 1 % repeat chance per row …
export const LUCK_CAP = 0.2;            // … capped at 20 %

export type Risk = 0 | 1 | 2;           // 0 LOW · 1 MID · 2 HIGH
export const RISK_KEYS = ['low', 'mid', 'high'] as const;   // i18n keys

/** Multipliers for slots 0..6 (slot k and 12 − k share one entry, symmetric). */
export const HALF_MULT: readonly (readonly number[])[] = [
  [8, 3, 1.5, 1.2, 1.1, 1.0, 0.5],        // LOW  96.4 %
  [24, 8, 3, 1.5, 1.2, 0.7, 0.4],         // MID  96.7 %
  [170, 24, 8, 2, 0.6, 0.2, 0.2],         // HIGH 96.4 %
];
/** Target RTP per risk (informational; the sim in scripts must hit ±1 %). */
export const RTP: readonly number[] = [0.964, 0.967, 0.964];
/** Binomial weights for n = 12, /4 096. */
export const BINOM: readonly number[] = [1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1];

// Hooks (documented in def.modHooks). Machine hooks use `m.plinko.*`; the Glass Funnel charm already emits
// `x.plinko.extraPuck`, so that exact name is kept.
export const HOOK_GOLDEN = 'm.plinko.goldenSlot' as ModHook;   // chance per drop that one slot shows ×2 (base 0)
export const HOOK_EXTRA = 'x.plinko.extraPuck' as ModHook;     // extra free pucks per drop, int (base 0)
export const HOOK_EDGE = 'm.plinko.edgeMult' as ModHook;       // × on slots 0 / 12 (base 1)
export const HOOK_FLOOR = 'm.plinko.safetyFloor' as ModHook;   // multipliers below this are raised to it (base 0)

export const MAX_MULT = 170 * 2 * 2;   // HIGH edge with edgeMult ×2 and a golden hit (per puck)

export interface DropOpts {
  risk: Risk;
  /** Stake per puck (coins). */
  stake: number;
  /** Paid pucks, 1..MAX_PUCKS. */
  pucks: number;
  /** Luck points (Rubber Pegs). */
  luck: number;
  /** Chance per drop that a golden slot is drawn (0..1). */
  goldenChance: number;
  /** Free extra pucks (rounded, 0..MAX_EXTRA). */
  extra: number;
  /** × on the edge slots (default 1). */
  edgeMult: number;
  /** Floor for every multiplier (default 0). */
  floor: number;
}

export interface Puck {
  /** 12 path bits, bit i = 1 when hop i went right. */
  bits: number;
  /** Bottom slot = popcount(bits). */
  slot: number;
  /** Multiplier applied to this puck (after floor, edge and golden). */
  mult: number;
  golden: boolean;
  /** Free charm puck (not debited). */
  free: boolean;
  /** Start delay after the drop, ms. */
  delayMs: number;
}

export interface DropRoll {
  risk: Risk;
  stake: number;
  /** Debited pucks (the bet is stake × paid). */
  paid: number;
  pucks: Puck[];
  /** Slot shown as golden before the drop, −1 for none. */
  goldenSlot: number;
  /** Exact float payout of the whole drop (before rounding). */
  exact: number;
  /** Any puck landed on slot 0 or 12. */
  edge: boolean;
  tags: string[];
}

export const clampRisk = (r: number): Risk => (r <= 0 ? 0 : r >= 2 ? 2 : (Math.round(r) as Risk));
export const clampPucks = (n: number): number => Math.min(MAX_PUCKS, Math.max(1, Math.round(n)));
export const clampExtra = (n: number): number => Math.min(MAX_EXTRA, Math.max(0, Math.round(n)));
export const clampChance = (p: number): number => Math.min(1, Math.max(0, p));

/** Multiplier of a bottom slot before charms (symmetric table). */
export function baseMult(risk: Risk, slot: number): number {
  return HALF_MULT[risk][Math.min(slot, ROWS - slot)];
}

/** Number of rights in a path (= bottom slot). */
export function popcount(bits: number): number {
  let n = 0;
  for (let b = bits; b; b &= b - 1) n++;
  return n;
}

/**
 * One puck's 12 hops. Always 2 draws per row: `u` picks the hop, `v` decides a Rubber Pegs repeat. With luck 0 the
 * bits are fair coins; with luck L each row repeats the previous direction with p = min(0.20, 0.01·L), which
 * widens the spread of landings.
 */
export function pathBits(rng: Rng, luck: number): number {
  const p = Math.min(LUCK_CAP, Math.max(0, luck) * LUCK_STEP);
  let bits = 0, prev = 0;
  for (let i = 0; i < ROWS; i++) {
    const u = rng.next(), v = rng.next();
    let dir = u < 0.5 ? 1 : 0;
    if (i > 0 && v < p) dir = prev;
    bits |= dir << i;
    prev = dir;
  }
  return bits;
}

/** Exact landing distribution over the 13 slots for Rubber Pegs repeat chance p (same law as pathBits, by DP). */
const slotCache = new Map<number, number[]>();
export function slotDist(p: number): number[] {
  const key = Math.round(p * 1e6);
  const hit = slotCache.get(key);
  if (hit) return hit;
  const same = p + (1 - p) / 2, diff = (1 - p) / 2;
  // dp[d][c]: prob that the last hop went d (1 = right) with c rights so far
  let dp: number[][] = [new Array<number>(ROWS + 1).fill(0), new Array<number>(ROWS + 1).fill(0)];
  dp[0][0] = 0.5; dp[1][1] = 0.5;                       // hop 0 is a fair coin
  for (let i = 1; i < ROWS; i++) {
    const nd: number[][] = [new Array<number>(ROWS + 1).fill(0), new Array<number>(ROWS + 1).fill(0)];
    for (let d = 0; d < 2; d++) for (let c = 0; c <= ROWS; c++) {
      const pr = dp[d][c];
      if (!pr) continue;
      nd[d][c + d] += pr * same;
      nd[1 - d][c + (1 - d)] += pr * diff;
    }
    dp = nd;
  }
  const out = Array.from({ length: SLOTS }, (_, k) => dp[0][k] + dp[1][k]);
  slotCache.set(key, out);
  return out;
}

/** Expected multiplier of one puck (before the payout cap), exact over the path law, edge, floor and golden chance. */
export function puckEV(risk: Risk, luck: number, goldenChance: number, edgeMult: number, floor: number): number {
  const p = Math.min(LUCK_CAP, Math.max(0, luck) * LUCK_STEP);
  const dist = slotDist(p);
  const g = clampChance(goldenChance) / SLOTS;            // chance that a given slot is the golden one
  const edge = Math.max(1, edgeMult), fl = Math.max(0, floor);
  let e = 0;
  for (let k = 0; k < SLOTS; k++) {
    let m = Math.max(baseMult(risk, k), fl);
    if (k === 0 || k === SLOTS - 1) m *= edge;
    e += dist[k] * m * (1 + g);
  }
  return e;
}

/**
 * Payout cap (director balance pass): Rubber Pegs, Glass Funnel extra pucks, golden slots, edge and floor charms may
 * lift the expected return, so every puck is scaled down when the drop expectation passes PAYOUT_CAP. Base tables
 * (≈ 96.4 %) are below the cap, so the cap only binds with charms and luck. Pure, so live and headless agree.
 */
export const PAYOUT_CAP = 0.97;
export function payoutScale(risk: Risk, paid: number, total: number, o: { luck: number; goldenChance: number; edgeMult: number; floor: number }): number {
  const e = puckEV(risk, o.luck, o.goldenChance, o.edgeMult, o.floor);
  const perStake = (total * e) / Math.max(1, paid);
  return perStake > PAYOUT_CAP ? PAYOUT_CAP / perStake : 1;
}

/** One drop: golden slot, then every puck (paid first, then free extras). Pure. */
export function rollDrop(rng: Rng, o: DropOpts): DropRoll {
  const risk = clampRisk(o.risk);
  const paid = clampPucks(o.pucks);
  const stake = Math.max(0, Math.floor(o.stake));
  const gU = rng.next(), gS = rng.int(0, SLOTS - 1);       // always two draws
  const goldenSlot = gU < clampChance(o.goldenChance) ? gS : -1;
  const total = paid + clampExtra(o.extra);
  const floor = Math.max(0, o.floor), edge = Math.max(1, o.edgeMult);
  const scale = payoutScale(risk, paid, total, { luck: o.luck, goldenChance: o.goldenChance, edgeMult: edge, floor });
  const pucks: Puck[] = [];
  let exact = 0, anyEdge = false;
  for (let i = 0; i < total; i++) {
    const bits = pathBits(rng, o.luck);
    const slot = popcount(bits);
    let m = Math.max(baseMult(risk, slot), floor) * scale;
    if (slot === 0 || slot === SLOTS - 1) { m *= edge; anyEdge = true; }
    const golden = slot === goldenSlot;
    if (golden) m *= 2;
    exact += stake * m;
    pucks.push({ bits, slot, mult: m, golden, free: i >= paid, delayMs: i * PUCK_GAP_MS });
  }
  const tags: string[] = [];
  if (anyEdge) tags.push('plinko:edge');
  if (pucks.some((p) => p.golden)) tags.push('plinko:golden');
  return { risk, stake, paid, pucks, goldenSlot, exact, edge: anyEdge, tags };
}

/**
 * Unbiased money rounding: `gross = floor(exact + carry)`, the remainder goes back as the new carry (the per-instance
 * dust accumulator on the live machine). `carry` in [0, 1).
 */
export function roundPayout(exact: number, carry: number): { gross: number; carry: number } {
  const t = exact + carry;
  const gross = Math.max(0, Math.floor(t + 1e-9));
  return { gross, carry: Math.max(0, t - gross) };
}

/** Peg grid: row k (1..12) has k + 2 pegs at x = −(k+1)·dx/2 + j·dx, y = top − 0.30 − (k−1)·dy (machine-local). */
export const PEG_DX = 0.08, PEG_DY = 0.09;
export const pegCount = (row: number): number => row + 2;

/** Headless single drop (staff auto-play, bench Sim): one puck, LOW risk, the bet is the stake. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = rollDrop(rng, {
    risk: 0, stake: bet, pucks: 1, luck: h.luck,
    goldenChance: h.mod(HOOK_GOLDEN, 0), extra: h.mod(HOOK_EXTRA, 0),
    edgeMult: h.mod(HOOK_EDGE, 1), floor: h.mod(HOOK_FLOOR, 0),
  });
  const { gross } = roundPayout(r.exact, rng.next());
  return { gross, tags: r.tags };
};
