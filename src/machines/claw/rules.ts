/**
 * Claw Crane (`claw`) — pure rules (MACHINES_machines §15). No three, no DOM, no kit: shared by the live machine
 * (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * Round: the stake buys a 15 s move window. The authority moves the gantry, then drops at a centre (x, z).
 *  - aim: the target is the nearest reachable prize (top layer first). Alignment a = clamp(1 − d / R, 0, 1),
 *    R = 0.05 m + 0.01 m per magnet stack.
 *  - lift: the prize lifts with p = √a × g (g = grabbability of its kind). A failed lift nudges it ±0.03 m.
 *  - carry: a strong grip (rolled at commit, p = 0.10 × jackpotChance + 1.5 % per luck point, luck part capped at 10 %,
 *    total capped at 20 %) keeps the
 *    prize with 0.98 × 0.95 = 0.93; a weak grip with 0.35 × 0.40 = 0.14 (× weakCarry, capped at 0.5). The golden egg
 *    never survives a weak grip.
 *  - tumble: a prize left within 0.08 m of the chute falls in by itself with p = 0.03 (at most one per round).
 *
 * Draw order (a given seed replays identically): strong grip (commit, 1 draw), then per drop: lift (1), lift carry,
 * travel carry, nudge (2, only when not won), tumble (1 per prize within reach of the chute). The pile is drawn
 * from its own rng at each restock.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const STAKE_MIN = 2;
export const STAKE_MAX = 50;
export const TIMER_S = 15;             // move window, seconds (before claw.timer)
export const GANTRY_SPEED = 0.25;      // m/s
export const GANTRY_LIM = 0.35;        // |x|, |z| of the claw centre
export const PILE_LIM = 0.30;          // |x|, |z| of prize centres
export const TOP_COUNT = 9;            // prizes on the top layer at restock
export const DROP_R = 0.05;            // alignment radius, m
export const MAGNET_STEP = 0.01;       // + radius per claw.magnet stack
export const P_STRONG = 0.10;          // strong grip chance (before luck / jackpotChance)
export const LUCK_STEP = 0.015;        // per luck point
export const LUCK_CAP = 0.10;          // luck contribution cap (director: strong grip ≤ 0.2 at any luck)
export const STRONG_MAX = 0.20;        // hard cap on the strong grip chance, after jackpotChance
export const LIFT_STRONG = 0.98;
export const TRAVEL_STRONG = 0.95;
export const LIFT_WEAK = 0.35;
export const WEAK_BASE = 0.14;         // 0.35 × 0.40, weak total carry
export const WEAK_CAP = 0.5;           // cap on weak total carry after claw.weakCarry
export const TUMBLE_P = 0.03;
export const TUMBLE_R = 0.08;          // m from the chute
export const NUDGE = 0.03;             // m
export const CHUTE = { x: -0.30, z: 0.30 } as const;   // front-left, box-local
/** Average-player alignment for headless staff play: √a = 0.75 (DECISIONS C27 "average"). */
export const HEADLESS_A = 0.5625;

export const HOOK_XRAY = 'm.claw.xray' as ModHook;               // > 0: claw lamp shows the grip before the drop
export const HOOK_TIMER = 'm.claw.timer' as ModHook;             // + seconds of move time
export const HOOK_WEAK = 'm.claw.weakCarry' as ModHook;          // × weak carry survival (base 1)
export const HOOK_MAGNET = 'm.claw.magnet' as ModHook;           // + alignment radius stacks (base 0)
export const HOOK_JACKPOT = 'm.claw.jackpotChance' as ModHook;   // × strong grip chance (base 1)

export type Kind = 'sackS' | 'sackM' | 'sackL' | 'capC' | 'capR' | 'egg';
export interface KindDef { g: number; mult: number; charm?: 'common' | 'rare'; strong?: boolean }
/** Grabbability g, coin value as × stake (0 = no coins), charm reward, strong-grip-only flag. */
/** Capsules carry a coin value too (× stake): the base RTP sits near 80 % (DECISIONS: director balance pass). */
export const CAP_C = 1;
export const CAP_R = 2.5;
export const KIND: Readonly<Record<Kind, KindDef>> = {
  sackS: { g: 1.00, mult: 5 },
  sackM: { g: 0.65, mult: 8 },
  sackL: { g: 0.25, mult: 20 },
  capC: { g: 0.90, mult: CAP_C, charm: 'common' },
  capR: { g: 0.60, mult: CAP_R, charm: 'rare' },
  egg: { g: 0.35, mult: 35, strong: true },
};
/** Restock mix: 8 S, 5 M, 2 L, 3 common capsules, 1 rare capsule, 1 golden egg. */
export const PILE_MIX: readonly Kind[] = [
  ...Array<Kind>(8).fill('sackS'), ...Array<Kind>(5).fill('sackM'), ...Array<Kind>(2).fill('sackL'),
  ...Array<Kind>(3).fill('capC'), 'capR', 'egg',
];
export const PILE_SIZE = PILE_MIX.length;

export type Prize = { id: number; kind: Kind; x: number; z: number; layer: 0 | 1; rotY: number };
export type Aim = { target: Prize | null; a: number };
export type Dropped = 'lift' | 'travel' | null;
export type Grab = {
  target: number | null; a: number; lift: boolean; strong: boolean; dropAt: Dropped;
  won: number | null; shift: { id: number; dx: number; dz: number } | null; tumble: number | null;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const dist = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

/** Restock: 20 prizes, shuffled, scattered over the pile; the first TOP_COUNT lie on the top layer. */
export function buildPile(rng: Rng): Prize[] {
  const kinds = rng.shuffle(PILE_MIX.slice());
  return kinds.map((kind, i) => {
    let x = 0, z = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = rng.float(-PILE_LIM, PILE_LIM);
      z = rng.float(-PILE_LIM, PILE_LIM);
      if (dist(x, z, CHUTE.x, CHUTE.z) > TUMBLE_R + 0.04) break;
    }
    return { id: i, kind, x, z, layer: i < TOP_COUNT ? 1 : 0, rotY: rng.float(0, 360) };
  });
}

/** Prizes the claw can reach: the top layer, or the whole pile once the top layer is gone. */
export function reachable(pile: readonly Prize[]): Prize[] {
  const top = pile.filter((p) => p.layer === 1);
  return top.length ? top : pile.slice();
}

/** Nearest reachable prize to the claw centre and the alignment a = clamp(1 − d / R, 0, 1). */
export function aimAt(pile: readonly Prize[], x: number, z: number, magnet: number): Aim {
  const reach = reachable(pile);
  if (!reach.length) return { target: null, a: 0 };
  let best = reach[0], bd = Infinity;
  for (const p of reach) {
    const d = dist(x, z, p.x, p.z);
    if (d < bd) { bd = d; best = p; }
  }
  const r = DROP_R + MAGNET_STEP * Math.max(0, magnet);
  return { target: best, a: clamp(1 - bd / r, 0, 1) };
}

/** Commit-time strong grip chance: 0.10 × jackpotChance + min(10 %, 1.5 % per luck point), capped at 20 %. */
export function strongChance(luck: number, jackpotMult: number): number {
  return clamp(P_STRONG * jackpotMult + Math.min(LUCK_CAP, LUCK_STEP * Math.max(0, luck)), 0, STRONG_MAX);
}

/** Weak total carry after claw.weakCarry (× base, capped). */
export const weakSurvival = (weakMult: number): number => Math.min(WEAK_CAP, WEAK_BASE * Math.max(0, weakMult));

/**
 * One drop: lift roll, carry rolls, nudge, tumble. Returns the grab record, the pile after the round and the
 * delivered kinds (won prize first, then a tumble). Pure: the input pile is not mutated.
 */
export function settleDrop(
  rng: Rng, pile: readonly Prize[], aimed: Aim, strong: boolean, o: { weakMult: number },
): { grab: Grab; pile: Prize[]; delivered: Kind[] } {
  const t = aimed.target;
  const grab: Grab = { target: t?.id ?? null, a: aimed.a, lift: false, strong, dropAt: null, won: null, shift: null, tumble: null };
  if (!t) return { grab, pile: pile.slice(), delivered: [] };
  const delivered: Kind[] = [];

  const g = KIND[t.kind].g;
  grab.lift = rng.next() < Math.sqrt(aimed.a) * g;
  let won = false;
  if (grab.lift) {
    const egg = KIND[t.kind].strong === true;
    const pLift = strong ? LIFT_STRONG : egg ? 0 : LIFT_WEAK;
    if (!(rng.next() < pLift)) grab.dropAt = 'lift';
    else {
      const pTravel = strong ? TRAVEL_STRONG : Math.min(1, weakSurvival(o.weakMult) / LIFT_WEAK);
      if (!(rng.next() < pTravel)) grab.dropAt = 'travel';
      else won = true;
    }
  }
  if (won) {
    grab.won = t.id;
    delivered.push(t.kind);
  } else {
    grab.shift = { id: t.id, dx: rng.float(-NUDGE, NUDGE), dz: rng.float(-NUDGE, NUDGE) };
  }

  // tumble: at most one prize falls in by itself (checked after the nudge)
  for (const p of applyGrab(pile, grab)) {
    if (dist(p.x, p.z, CHUTE.x, CHUTE.z) > TUMBLE_R) continue;
    if (rng.chance(TUMBLE_P)) {
      grab.tumble = p.id;
      delivered.push(p.kind);
      break;
    }
  }
  return { grab, pile: applyGrab(pile, grab), delivered };
}

/**
 * Applies a grab to a pile, deterministically (no draws): removes the won and tumbled prizes and nudges the shifted
 * one (clamped). Presentation uses it too, so every peer converges on the authority's pile.
 */
export function applyGrab(pile: readonly Prize[], grab: Grab): Prize[] {
  const gone = new Set<number>();
  if (grab.won !== null) gone.add(grab.won);
  if (grab.tumble !== null) gone.add(grab.tumble);
  return pile.filter((p) => !gone.has(p.id)).map((p) => {
    if (!grab.shift || grab.shift.id !== p.id) return { ...p };
    return {
      ...p,
      x: clamp(p.x + grab.shift.dx, -PILE_LIM, PILE_LIM),
      z: clamp(p.z + grab.shift.dz, -PILE_LIM, PILE_LIM),
    };
  });
}

/** Coins for delivered kinds at a stake (sacks and eggs scale with the stake of the play that wins them). */
export const grossOf = (kinds: readonly Kind[], stake: number): number =>
  kinds.reduce((s, k) => s + KIND[k].mult * stake, 0);

/** Charm rewards among delivered kinds (capsules). */
export const charmsOf = (kinds: readonly Kind[]): Array<'common' | 'rare'> =>
  kinds.map((k) => KIND[k].charm).filter((c): c is 'common' | 'rare' => c !== undefined);

/** Headless staff round: fresh pile, commit, the average player picks a reachable prize at fixed alignment. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const pile = buildPile(rng);
  const strong = rng.chance(strongChance(h.luck, h.mod(HOOK_JACKPOT, 1)));
  const target = rng.pick(reachable(pile));
  const r = settleDrop(rng, pile, { target, a: HEADLESS_A }, strong, { weakMult: h.mod(HOOK_WEAK, 1) });
  const tags: string[] = [];
  if (r.grab.won !== null) tags.push('claw-win');
  if (r.delivered.includes('egg')) tags.push('golden');
  for (const c of charmsOf(r.delivered)) tags.push(`charm-${c}`);
  return { gross: grossOf(r.delivered, bet), tags };
};
