/**
 * A* over the patrol graph (`NAV_NODES` / `NAV_EDGES` in world/layout, GDD §8.8). Pure: no three, no DOM.
 * Points are plain [x, z] pairs in metres. Doorway edges are blocked while either end's zone is closed.
 */
import { NAV_EDGES, NAV_NODES } from '@/world/layout';

export type Vec2 = [number, number];
export interface NavOpts {
  /** True when a zone's grille is closed (its doorway edges are then impassable). */
  closedZone?: (zone: string) => boolean;
}

interface Edge { to: number; cost: number; doorway: boolean }
interface Graph { pos: Vec2[]; zone: string[]; adj: Edge[][]; ids: string[] }

let graph: Graph | null = null;

function build(): Graph {
  const ids = NAV_NODES.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const pos = NAV_NODES.map((n) => [n.pos[0], n.pos[1]] as Vec2);
  const zone = NAV_NODES.map((n) => String(n.zone));
  const adj: Edge[][] = ids.map((): Edge[] => []);
  for (const e of NAV_EDGES) {
    const a = index.get(e.a), b = index.get(e.b);
    if (a === undefined || b === undefined) continue;
    const cost = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
    const doorway = !!e.doorway;
    adj[a].push({ to: b, cost, doorway });
    adj[b].push({ to: a, cost, doorway });
  }
  return { pos, zone, adj, ids };
}

function g(): Graph {
  if (!graph) graph = build();
  return graph;
}

/** Index of the graph node nearest to `p`. */
export function nearestNode(p: Vec2): number {
  const { pos } = g();
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pos.length; i++) {
    const d = (pos[i][0] - p[0]) ** 2 + (pos[i][1] - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Node ids in graph order (for debug overlays and tests). */
export function navNodeIds(): readonly string[] { return g().ids; }

/**
 * Shortest walkable route from `from` to `to`, as waypoints including both ends. Returns null when the two points
 * cannot be connected (every route crosses a closed doorway). Start and goal snap to their nearest graph node.
 */
export function findPath(from: Vec2, to: Vec2, o: NavOpts = {}): Vec2[] | null {
  const { pos, zone, adj } = g();
  const s = nearestNode(from), goal = nearestNode(to);
  const blocked = (a: number, b: number): boolean => !!o.closedZone && (o.closedZone(zone[a]) || o.closedZone(zone[b]));
  const h = (i: number): number => Math.hypot(pos[i][0] - pos[goal][0], pos[i][1] - pos[goal][1]);

  const gScore = new Array<number>(pos.length).fill(Infinity);
  const came = new Array<number>(pos.length).fill(-1);
  const open = new Set<number>([s]);
  const closed = new Set<number>();
  gScore[s] = 0;

  while (open.size) {
    let cur = -1, bestF = Infinity;
    for (const i of open) {
      const f = gScore[i] + h(i);
      if (f < bestF) { bestF = f; cur = i; }
    }
    if (cur === goal) break;
    open.delete(cur);
    closed.add(cur);
    for (const e of adj[cur]) {
      if (closed.has(e.to)) continue;
      if (e.doorway && blocked(cur, e.to)) continue;
      const ng = gScore[cur] + e.cost;
      if (ng < gScore[e.to]) {
        gScore[e.to] = ng;
        came[e.to] = cur;
        open.add(e.to);
      }
    }
  }
  if (s !== goal && came[goal] < 0) return null;

  const nodes: number[] = [];
  for (let c = goal; c >= 0; c = c === s ? -1 : came[c]) { nodes.push(c); if (c === s) break; }
  nodes.reverse();
  const out: Vec2[] = [[from[0], from[1]]];
  for (const n of nodes) {
    const p = pos[n];
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) out.push([p[0], p[1]]);
  }
  const end = out[out.length - 1];
  if (Math.hypot(to[0] - end[0], to[1] - end[1]) > 1e-3) out.push([to[0], to[1]]);
  return out;
}

/** Every patrol-graph node as [x, z] (hall points for wandering actors). */
export const NAV_POINTS: readonly Vec2[] = NAV_NODES.map((n) => [n.pos[0], n.pos[1]] as Vec2);
