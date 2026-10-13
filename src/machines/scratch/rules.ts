/**
 * Scratch-Card Vendor — pure rules (MACHINES §6). Shared by the live machine (`index.ts`) and the headless play
 * contract (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP.
 *
 * No three, kit, DOM or Math.random: every draw comes from the Rng passed in.
 *
 * Five cards (index = card type, see `CARD_PRICE`). A card is rolled as: prize tier (weight table out of 1 000 000,
 * the rest is a loss) → luck upgrade of a loss to the lowest prize → independent charm-stamp roll → face generation
 * (`cells`, deterministic from the outcome; the painter in `faces.ts` reads them). Payout = floor(price × mult).
 *
 * Face layouts (`cells`), fixed per card type:
 *  - PIT PENNY (0): 9 amounts, the prize amount is `price × mult`.
 *  - LUCKY LADDER (1): [reached rung 0..7]; rung 2 → ×1 … rung 7 → ×250, rungs 0–1 lose.
 *  - HOUSE vs YOU (2): [HOUSE, Y1, L1, … Y5, L5] (11 ints); a YOUR above HOUSE wins its label.
 *  - BLOOD MOON (3): 12 symbols (0 MOON, 1 BAT, 2 OWL, 3 SKULL, 4 BLOOD MOON) + prize box mult (index 12).
 *  - THE DEEP END (4): [PRIZE (0 = SUNK), DEPTH] — mult = PRIZE × DEPTH, DEPTH is always shown.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const CARD_COUNT = 5;
export const CARD_PRICE = [2, 5, 10, 20, 50] as const;
/** Scratch zones per card (the painter lays them out; a zone is revealed at ≥ ZONE_REVEAL cleared). */
export const CARD_ZONES = [9, 7, 6, 13, 2] as const;
export const ZONE_REVEAL = 0.55;
export const MAX_QTY = 5;
export const WEIGHT_TOTAL = 1_000_000;
export const SECOND_CHANCE_EVERY = 10;
export const LUCK_P_PER_POINT = 0.005;
export const LUCK_P_CAP = 0.15;
export const DISCOUNT_FLOOR = 1;

export const RARITY_NONE = 0, RARITY_COMMON = 1, RARITY_UNCOMMON = 2, RARITY_RARE = 3;

/** Prize multiplier per non-losing tier, and the weight of that tier out of WEIGHT_TOTAL (the rest loses). */
export const PRIZE_MULTS: ReadonlyArray<readonly number[]> = [
  [1, 2, 3, 5, 20, 100, 500],          // PIT PENNY
  [1, 2, 4, 10, 50, 250],              // LUCKY LADDER (rung 2..7)
  [1, 2, 4, 10, 50, 250],              // HOUSE vs YOU (label)
  [1, 2, 5, 10, 50, 1000],             // BLOOD MOON (prize box)
  [1, 2, 5, 20, 100],                  // THE DEEP END (PRIZE window; 0 = SUNK)
];
export const PRIZE_WEIGHTS: ReadonlyArray<readonly number[]> = [
  [250000, 125000, 25000, 25000, 4000, 200, 10],
  [250000, 125000, 40000, 10000, 1000, 40],
  [222222, 111111, 40000, 16667, 1000, 50],
  [200000, 100000, 50000, 10000, 1250, 40],
  [180000, 80000, 30000, 6000, 400],
];
/** THE DEEP END DEPTH window, out of 1 000. */
export const DEPTH_MULTS = [1, 2, 5, 10] as const;
export const DEPTH_WEIGHTS = [850, 100, 40, 10] as const;
/** Charm stamp odds per card: 1 in N (before `extraCharmSpot`). */
export const CHARM_ODDS = [200, 120, 100, 60, 40] as const;
export const HOUSE_LABELS = [1, 2, 4, 10, 50, 250] as const;

/** Hooks this machine honours (documented in `def.modHooks`). Milestone features are read by the machine. */
export const HOOK_TOP = 'm.scratch.topPrizeMult' as ModHook;     // × weight of the top prize row (default 1)
export const HOOK_CHARM = 'm.scratch.extraCharmSpot' as ModHook; // × charm-spot chance (default 1)
export const HOOK_SECOND = 'm.scratch.secondChance' as ModHook;  // > 0 enables the 2nd-chance bin
export const HOOK_DISCOUNT = 'm.scratch.discount' as ModHook;    // price −N % (default 0)
export const HOOK_XRAY = 'm.scratch.xray' as ModHook;            // > 0 shows one glowing zone per card

/** One rolled card. `cells` layout: see the header. `gross` = the coins it pays (stake already paid). */
export type Card = {
  t: number; price: number; mult: number; gross: number; cells: number[];
  charm: number; near: boolean; lucky: boolean; free: boolean;
};
export interface CardOpts { luck: number; top: number; charm: number; free?: boolean }

export const priceOf = (t: number, discountPct: number): number => {
  const base = CARD_PRICE[t] ?? CARD_PRICE[0];
  const d = Math.min(100, Math.max(0, discountPct));
  return Math.max(DISCOUNT_FLOOR, Math.floor(base * (1 - d / 100)));
};
export const clampQty = (n: number): number => Math.min(MAX_QTY, Math.max(1, Math.round(n)));
export const luckChance = (luck: number): number => Math.min(LUCK_P_CAP, Math.max(0, luck) * LUCK_P_PER_POINT);

/** Weighted draw over the prize table with `top` scaling the last (top) row. Returns the index, or -1 for a loss. */
function drawTier(rng: Rng, t: number, top: number): number {
  const w = PRIZE_WEIGHTS[t].slice();
  const last = w.length - 1;
  const others = w.slice(0, last).reduce((a, b) => a + b, 0);
  w[last] = Math.min(Math.round(w[last] * Math.max(0, top)), WEIGHT_TOTAL - others);
  const u = rng.next() * WEIGHT_TOTAL;
  let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i]; if (u < acc) return i; }
  return -1;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length) % xs.length];

// ── face generation (deterministic from the outcome; the rng is the outcome stream) ───────────────
function facePit(rng: Rng, price: number, mult: number): number[] {
  const set = PRIZE_MULTS[0].map((m) => price * m);          // 7 amounts, the prize amount = price × mult
  const cells: number[] = new Array(9).fill(0);
  const count = new Map<number, number>();
  const put = (i: number, v: number) => { cells[i] = v; count.set(v, (count.get(v) ?? 0) + 1); };
  if (mult > 0) {
    const a = price * mult;
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    rng.shuffle(order);
    for (let k = 0; k < 3; k++) put(order[k], a);
    const others = set.filter((v) => v !== a);
    for (let k = 3; k < 9; k++) {
      let v = pick(rng, others);
      while ((count.get(v) ?? 0) >= 2) v = pick(rng, others);
      put(order[k], v);
    }
    return cells;
  }
  const near = rng.next() < 0.35;
  let i = 0;
  if (near) {                                                 // two of one of the two top amounts (no win)
    const top = rng.next() < 0.5 ? price * 100 : price * 500;
    put(i++, top); put(i++, top);
  }
  while (i < 9) {
    const v = pick(rng, set);
    if ((count.get(v) ?? 0) >= 2) continue;
    put(i++, v);
  }
  return cells;
}

function faceLadder(rng: Rng, tier: number): number[] {
  if (tier >= 0) return [tier + 2];                           // PRIZE index 0 → rung 2 (×1) … 5 → rung 7 (×250)
  return [rng.next() < 0.4 ? 0 : 1];
}

function faceHouse(rng: Rng, label: number): number[] {
  const cells: number[] = [];
  const slot = Math.floor(rng.next() * 5);
  if (label > 0) {
    const h = 1 + Math.floor(rng.next() * 19);               // 1..19 so a higher YOUR exists
    cells.push(h);
    for (let s = 0; s < 5; s++) {
      if (s === slot) { cells.push(h + 1 + Math.floor(rng.next() * (20 - h)), label); }
      else { cells.push(1 + Math.floor(rng.next() * h), pick(rng, HOUSE_LABELS)); }
    }
    return cells;
  }
  const h = 1 + Math.floor(rng.next() * 20);
  cells.push(h);
  const tie = rng.next() < 0.3 ? Math.floor(rng.next() * 5) : -1;
  for (let s = 0; s < 5; s++) {
    cells.push(s === tie ? h : 1 + Math.floor(rng.next() * h), pick(rng, HOUSE_LABELS));
  }
  return cells;
}

function faceBlood(rng: Rng, mult: number): number[] {
  const cells: number[] = new Array(12).fill(0);
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const fillers = (i: number) => { cells[i] = 1 + Math.floor(rng.next() * 3); };   // BAT / OWL / SKULL
  if (mult > 0) {
    rng.shuffle(order);
    if (mult >= 10 && rng.next() < 0.3) {                     // BLOOD MOON instant win: one cell, no MOON trio
      cells[order[0]] = 4;
      for (let k = 1; k < 12; k++) fillers(order[k]);
    } else {
      for (let k = 0; k < 3; k++) cells[order[k]] = 0;
      for (let k = 3; k < 12; k++) fillers(order[k]);
    }
    return [...cells, mult];
  }
  const moons = rng.next() < 0.4 ? 2 : Math.floor(rng.next() * 2);
  rng.shuffle(order);
  for (let k = 0; k < 12; k++) {
    if (k < moons) cells[order[k]] = 0; else fillers(order[k]);
  }
  return [...cells, 0];
}

function faceDeep(rng: Rng, prize: number, depth: number): number[] {
  return [prize, depth];
}

/** Roll one card (`price` is what it costs; the coins it pays are `floor(price × mult)`). Consumes its own draws. */
export function rollCard(rng: Rng, t: number, price: number, o: CardOpts): Card {
  let tier = drawTier(rng, t, o.top);
  let mult = tier >= 0 ? PRIZE_MULTS[t][tier] : 0;
  let lucky = false;
  let depth = 1;
  if (t === 4) {                                               // THE DEEP END: depth is an independent window
    const u = rng.next() * 1000;
    let acc = 0; depth = DEPTH_MULTS[DEPTH_MULTS.length - 1];
    for (let i = 0; i < DEPTH_MULTS.length; i++) { acc += DEPTH_WEIGHTS[i]; if (u < acc) { depth = DEPTH_MULTS[i]; break; } }
    if (tier < 0 && rng.next() < luckChance(o.luck)) { lucky = true; tier = 0; mult = 1; depth = 1; }
    else if (tier >= 0 && mult > 0) mult = mult * depth;
  } else if (tier < 0 && rng.next() < luckChance(o.luck)) {
    lucky = true; tier = 0; mult = 1;                          // luck upgrade: the lowest prize
  }
  // charm stamp: an independent roll, not counted in coin RTP
  const odds = CHARM_ODDS[t] / Math.max(0, o.charm);      // charm 0 → odds ∞ → never
  let charm = RARITY_NONE;
  if (rng.next() < 1 / odds) charm = t === 4 ? (rng.next() < 0.9 ? RARITY_UNCOMMON : RARITY_RARE) : t === 3 ? RARITY_UNCOMMON : RARITY_COMMON;

  let cells: number[];
  let near = false;
  if (t === 0) { cells = facePit(rng, price, mult); near = mult === 0 && cells.filter((v) => v === price * 100 || v === price * 500).length === 2; }
  else if (t === 1) cells = faceLadder(rng, lucky ? 0 : tier);
  else if (t === 2) cells = faceHouse(rng, mult);
  else if (t === 3) cells = faceBlood(rng, mult);
  else cells = faceDeep(rng, mult > 0 ? (mult / depth) : 0, depth);
  if (t === 2 && mult === 0) near = [1, 3, 5, 7, 9].some((i) => cells[i] === cells[0]);   // a tie (printed rule: ties lose)
  const gross = Math.floor(price * mult);
  return { t, price, mult, gross, cells, charm, near, lucky, free: !!o.free };
}

/** Headless single card, collected immediately: the card type is the largest base price ≤ `bet` (PIT PENNY below 2). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  let t = 0;
  for (let i = 0; i < CARD_COUNT; i++) if (CARD_PRICE[i] <= bet) t = i;
  const card = rollCard(rng, t, Math.max(1, bet), { luck: h.luck, top: h.mod(HOOK_TOP, 1), charm: h.mod(HOOK_CHARM, 1) });
  return { gross: card.gross, tags: [...(card.lucky ? ['lucky'] : []), ...(card.near ? ['nearmiss'] : [])] };
};
