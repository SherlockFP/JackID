/**
 * Pachinko "Deep Rain" — the lane graph (pure data + path generator; no three, no DOM).
 *
 * Field coordinates: origin = playfield bottom-left, X right, Y up, metres (0.48 × 0.48 m playfield).
 * Nine pin levels (1 = top, 9 = bottom), each a 6-column grid (x = 0.04 + 0.08k, k = 0..5). A node links to the next
 * level straight down or one column left/right, so a ball can drift from either rail to every pocket in a few hops.
 *
 * Pockets are physical (OUT, SIDE_L/R, TULIP_L/R, START, ECHU, ATTACKER). The rules decide a CATEGORY (SIDE, TULIP …);
 * the physical pocket is picked by the ball seed. A walk runs from a rail entry down to an entry node of its pocket,
 * only ever stepping to nodes that can still reach that pocket (reachability bitsets, precomputed once).
 */

export const LEVELS = 9;
export const LEVEL_Y0 = 0.43;
export const LEVEL_DY = 0.042;

export interface LaneNode { id: number; level: number; x: number; y: number; children: number[] }

/** Physical pockets, bit i in the reachability masks. */
export const POCKETS = ['OUT', 'SIDE_L', 'SIDE_R', 'TULIP_L', 'TULIP_R', 'START', 'ECHU', 'ATTACKER'] as const;
export type Pocket = (typeof POCKETS)[number];
export const POCKET_BIT: Readonly<Record<Pocket, number>> = Object.freeze(
  Object.fromEntries(POCKETS.map((p, i) => [p, 1 << i])) as Record<Pocket, number>,
);

export interface PocketDef { pos: [number, number]; entries: Array<[level: number, x: number]> }
export const POCKET_DEFS: Readonly<Record<Pocket, PocketDef>> = {
  OUT: { pos: [0.24, 0.0], entries: [[9, 0.12], [9, 0.20], [9, 0.28]] },
  SIDE_L: { pos: [0.03, 0.14], entries: [[8, 0.04]] },
  SIDE_R: { pos: [0.45, 0.14], entries: [[8, 0.44]] },
  TULIP_L: { pos: [0.13, 0.2], entries: [[6, 0.12]] },
  TULIP_R: { pos: [0.35, 0.2], entries: [[6, 0.36]] },
  START: { pos: [0.24, 0.3], entries: [[4, 0.2], [4, 0.28]] },
  ECHU: { pos: [0.24, 0.22], entries: [[6, 0.2], [6, 0.28]] },
  ATTACKER: { pos: [0.4, 0.02], entries: [[9, 0.36], [9, 0.44]] },
};

/** Launch rails: the entry node a shot drops from, by zone name (0.04 = far left, 0.44 = far right). */
export const RAIL_X = { LOW: 0.04, SWEET: 0.12, HIGH: 0.2, RIGHT: 0.44 } as const;

function buildNodes(): LaneNode[] {
  const nodes: LaneNode[] = [];
  for (let level = 1; level <= LEVELS; level++) {
    for (let k = 0; k < 6; k++) {
      nodes.push({ id: nodes.length, level, x: +(0.04 + 0.08 * k).toFixed(3), y: +(LEVEL_Y0 - (level - 1) * LEVEL_DY).toFixed(3), children: [] });
    }
  }
  for (const a of nodes) {
    if (a.level === LEVELS) continue;
    for (const b of nodes) {
      if (b.level !== a.level + 1) continue;
      if (Math.abs(b.x - a.x) < 0.04) a.children.push(b.id);                 // straight down
      else if (Math.abs(Math.abs(b.x - a.x) - 0.08) < 1e-6) a.children.push(b.id);   // one column aside
    }
  }
  return nodes;
}

export const LANE_NODES: readonly LaneNode[] = buildNodes();

function nodeAt(level: number, x: number): number {
  const n = LANE_NODES.find((q) => q.level === level && Math.abs(q.x - x) < 1e-3);
  if (!n) throw new Error(`pachinko: no lane node at level ${level} x ${x}`);
  return n.id;
}

/** Entry nodes of each pocket (node ids). */
export const POCKET_ENTRIES: Readonly<Record<Pocket, number[]>> = Object.freeze(
  Object.fromEntries(POCKETS.map((p) => [p, POCKET_DEFS[p].entries.map(([l, x]) => nodeAt(l, x))])) as Record<Pocket, number[]>,
);

/** reach[n] = bitset of pockets reachable from node n (its own pocket entries plus everything below). */
export const REACH: Readonly<Uint8Array> = (() => {
  const r = new Uint8Array(LANE_NODES.length);
  for (let level = LEVELS; level >= 1; level--) {
    for (const n of LANE_NODES) {
      if (n.level !== level) continue;
      let m = 0;
      for (const p of POCKETS) if (POCKET_ENTRIES[p].includes(n.id)) m |= POCKET_BIT[p];
      for (const c of n.children) m |= r[c];
      r[n.id] = m;
    }
  }
  return r;
})();

/** Rail entry node id for a zone (LOW/SWEET/HIGH/RIGHT). */
export function railNode(zone: 'LOW' | 'SWEET' | 'HIGH' | 'RIGHT'): number {
  return nodeAt(1, RAIL_X[zone]);
}

/** Tiny seeded xorshift32 (u16/u32 seed from the event). Deterministic on every peer. */
export function laneRng(seed: number): () => number {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/**
 * Node path for one ball from `entry` into `pocket`. Each step picks uniformly among children that can still reach
 * the pocket; at an entry node the ball drops in with probability 0.35 (or always when nothing below reaches it).
 * Always terminates on an entry node of the pocket (REACH invariant).
 */
export function walkPath(entry: number, pocket: Pocket, seed: number): number[] {
  const rnd = laneRng(seed);
  const bit = POCKET_BIT[pocket];
  const entries = new Set(POCKET_ENTRIES[pocket]);
  const path = [entry];
  let n = entry;
  for (let guard = 0; guard < 64; guard++) {
    const kids = LANE_NODES[n].children.filter((c) => (REACH[c] & bit) !== 0);
    if (entries.has(n) && (kids.length === 0 || rnd() < 0.35)) break;
    if (kids.length === 0) break;                       // unreachable by construction; never hit (see sim)
    n = kids[Math.floor(rnd() * kids.length)];
    path.push(n);
  }
  return path;
}
