/**
 * THE CIRCUIT, minimum slice (GDD §3.4): Tilt (anti-camping) and Hot / Cold Lamps. Pure rules, no three, no DOM.
 *
 * Tilt: pulls spent on one instance this Watch. Pulls 1..4 pay in full, then ×0.8 / ×0.6 / ×0.4 (7+). Grace shifts the
 * threshold (charms, upgrades). Hot Lamp machines ignore Tilt. Everything resets at Settle.
 * Lamps: at every Bell a seeded roll names Hot machines (×1.5, no Tilt) and a Cold one (×0.75).
 * `run.ts` owns one `Circuit`, feeds the payout through the mod pipeline and publishes the read-only `CircuitView`.
 */
import type { Rng } from '@/core/rng';
import type { InstanceId, MachineId } from '@/core/types';
import { TILT_FREE_PULLS } from './data/schedule';

/** Payout factors by tier (0 = full value, 3 = deepest Tilt). GDD §3.4.3. */
export const TILT_FACTORS: readonly [number, number, number, number] = [1, 0.8, 0.6, 0.4];
/** Tilt Switch charm: every instance except the most played one tilts harder. */
export const TILT_FACTORS_HARSH: readonly [number, number, number, number] = [1, 0.75, 0.55, 0.35];
export const HOT_MULT = 1.5;
export const COLD_MULT = 0.75;

/** Tier 0..3 for `plays` pulls on an instance with `grace` extra full-value pulls. */
export function tiltStep(plays: number, grace = 0): number {
  const over = plays - Math.round(grace) - TILT_FREE_PULLS;
  return over <= 0 ? 0 : Math.min(3, over);
}

/** Payout factor (M) after `plays` pulls on the instance this Watch. */
export function tiltFactor(plays: number, grace = 0, harsh = false): number {
  return (harsh ? TILT_FACTORS_HARSH : TILT_FACTORS)[tiltStep(plays, grace)];
}

/** Amber bulbs still lit on the marquee (0..4): full-value pulls left. */
export function tiltBulbs(plays: number, grace = 0): number {
  return Math.max(0, Math.min(4, TILT_FREE_PULLS + Math.round(grace) - plays));
}

// ── lamps ───────────────────────────────────────────────────────────────────────────────────────────
export interface LampCandidate { mid: InstanceId; machineId: MachineId; weight?: number }
export interface LampRoll { hot: InstanceId[]; cold: InstanceId[] }

/**
 * Seeded Lamp roll. Candidates are sorted by instance id first, so the result depends only on the rng stream and the set
 * of candidates, never on world order. The same instance is never Hot two Watches running (`prevHot`); a machine that is
 * new this Watch (`fresh`) is never Cold; Hot and Cold never share an instance.
 */
export function rollLamps(
  rng: Rng, cands: readonly LampCandidate[], o: { hot: number; cold: number; prevHot?: readonly InstanceId[]; fresh?: readonly InstanceId[] },
): LampRoll {
  // One entry per instance: a machine listed twice must never be both Hot and Cold.
  const seen = new Set<InstanceId>();
  const sorted = [...cands]
    .sort((a, b) => (a.mid < b.mid ? -1 : a.mid > b.mid ? 1 : 0))
    .filter((c) => { if (seen.has(c.mid)) return false; seen.add(c.mid); return true; });
  const prev = new Set(o.prevHot ?? []);
  const fresh = new Set(o.fresh ?? []);
  const draw = (pool: LampCandidate[], n: number): InstanceId[] => {
    const out: InstanceId[] = [];
    const left = [...pool];
    for (let i = 0; i < n && left.length > 0; i++) {
      const k = rng.weightedIndex(left.map((c) => Math.max(0.0001, c.weight ?? 1)));
      out.push(left[k].mid);
      left.splice(k, 1);
    }
    return out;
  };
  const hot = draw(sorted.filter((c) => !prev.has(c.mid)), Math.max(0, Math.floor(o.hot)));
  const hotSet = new Set(hot);
  const cold = draw(sorted.filter((c) => !hotSet.has(c.mid) && !fresh.has(c.mid)), Math.max(0, Math.floor(o.cold)));
  return { hot, cold };
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────
/** JSON-safe state stored under `RunExt.circuit`. */
export interface CircuitSave {
  plays: Record<string, number>;
  first: string | null;
  hot: string[];
  cold: string[];
  prevHot: string[];
  known: string[];
  /** Machine id of every lamp instance (the HUD names them). */
  names: Record<string, string>;
}

export class Circuit {
  private plays = new Map<InstanceId, number>();
  private first: InstanceId | null = null;
  private hotIds: InstanceId[] = [];
  private coldIds: InstanceId[] = [];
  private prevHot: InstanceId[] = [];
  private known = new Set<InstanceId>();
  private names = new Map<InstanceId, MachineId>();

  /** Pulls spent on the instance this Watch. */
  playsOf(mid: InstanceId): number { return this.plays.get(mid) ?? 0; }
  /** Adds pulls to the instance (the first instance played in a Watch is remembered for Red Thread). Returns the new count. */
  addPlays(mid: InstanceId, pulls: number): number {
    if (pulls <= 0) return this.playsOf(mid);
    if (this.first === null) this.first = mid;
    const n = this.playsOf(mid) + pulls;
    this.plays.set(mid, n);
    return n;
  }
  /** The first instance played this Watch (null before any play). */
  firstPlayed(): InstanceId | null { return this.first; }
  /** The instance with the most pulls this Watch; ties go to the one played first. */
  mostPlayed(): InstanceId | null {
    let best: InstanceId | null = null;
    let top = 0;
    for (const [mid, n] of this.plays) if (n > top) { top = n; best = mid; }
    return best;
  }

  isHot(mid: InstanceId): boolean { return this.hotIds.includes(mid); }
  isCold(mid: InstanceId): boolean { return this.coldIds.includes(mid); }
  hot(): readonly InstanceId[] { return this.hotIds; }
  cold(): readonly InstanceId[] { return this.coldIds; }
  machineOf(mid: InstanceId): MachineId { return this.names.get(mid) ?? ''; }
  /** Remembers which machine an instance is (the bet source knows it even when the world link does not list it). */
  note(mid: InstanceId, machineId: MachineId): void { this.names.set(mid, machineId); }

  /**
   * Bell: rolls the Lamps. `bonusHot` machines are Hot on top of the roll (Grand Opening Ribbon: machines new this Watch).
   * `lamps` false (before Night 2) clears them. Returns the new lamps.
   */
  startWatch(rng: Rng, cands: readonly LampCandidate[], o: { lamps: boolean; hot: number; cold: number; newIsHot: boolean }): LampRoll {
    const current = new Set(cands.map((c) => c.mid));
    const fresh = this.known.size === 0 ? [] : cands.filter((c) => !this.known.has(c.mid)).map((c) => c.mid);
    this.plays.clear();
    this.first = null;
    this.names.clear();
    for (const c of cands) this.names.set(c.mid, c.machineId);
    let roll: LampRoll = { hot: [], cold: [] };
    if (o.lamps) {
      roll = rollLamps(rng, cands, { hot: o.hot, cold: o.cold, prevHot: this.prevHot, fresh });
      if (o.newIsHot) for (const mid of fresh) if (!roll.hot.includes(mid) && !roll.cold.includes(mid)) roll.hot.push(mid);
    }
    roll.cold = roll.cold.filter((mid) => !roll.hot.includes(mid));   // Hot and Cold never share an instance
    this.hotIds = roll.hot;
    this.coldIds = roll.cold;
    this.prevHot = [...roll.hot];
    this.known = current;
    return roll;
  }

  /** Settle: Tilt resets and the Lamps go dark. */
  settle(): void {
    this.plays.clear();
    this.first = null;
    this.hotIds = [];
    this.coldIds = [];
  }

  snapshot(): CircuitSave {
    return {
      plays: Object.fromEntries(this.plays), first: this.first, hot: [...this.hotIds], cold: [...this.coldIds],
      prevHot: [...this.prevHot], known: [...this.known], names: Object.fromEntries(this.names),
    };
  }

  restore(s: Partial<CircuitSave> | undefined): void {
    if (!s) return;
    this.plays = new Map(Object.entries(s.plays ?? {}));
    this.first = s.first ?? null;
    this.hotIds = [...(s.hot ?? [])];
    this.coldIds = [...(s.cold ?? [])];
    this.prevHot = [...(s.prevHot ?? [])];
    this.known = new Set(s.known ?? []);
    this.names = new Map(Object.entries(s.names ?? {}));
  }
}

// ── read-only surface for the HUD, the seat HUD and the world (beacons) ────────────────────────────
export interface TiltView {
  /** Pulls spent on this instance this Watch. */
  plays: number;
  /** Bulbs still lit (0..4). */
  lit: number;
  /** 0 = full value … 3 = deepest Tilt. */
  step: number;
  /** Payout factor from Tilt alone (1 on a Hot machine or when Tilt is ignored). */
  factor: number;
  hot: boolean;
  cold: boolean;
  /** Lamp factor alone: Hot ×1.5 (charms may change it), Cold ×0.75, otherwise 1. */
  lamp: number;
}
export interface LampEntry { mid: InstanceId; machineId: MachineId }
export interface LampView { hot: LampEntry[]; cold: LampEntry[] }
export interface CircuitView {
  /** True while the Circuit applies (a timed quota Watch). */
  active(): boolean;
  /** Tilt state of one instance, or null when the Circuit is off. */
  tilt(mid: InstanceId): TiltView | null;
  /** Current Lamps (empty between Watches and on Night 1). */
  lamps(): LampView;
}

/**
 * Event payloads. `circuit:lamps` fires at the Bell (and empty at Settle). `circuit:tilt` fires when the local player sits at
 * an instance, after every counted play and after the Lamps change; `tilt` is null when no Tilt applies there (system device,
 * between Watches, Free Casino). The seat HUD is driven by this event alone.
 */
export interface CircuitLampsEvent extends LampView { night: number; watch: number }
export interface CircuitTiltEvent { pid: number; mid: InstanceId; machineId: MachineId; tilt: TiltView | null }
declare module '@/core/events' {
  interface GameEvents {
    'circuit:lamps': CircuitLampsEvent;
    'circuit:tilt': CircuitTiltEvent;
  }
}

/** The Circuit view of a run facade (`app.run`), or null when it has none (benches, menus). */
export function circuitView(run: unknown): CircuitView | null {
  const c = (run as { circuit?: CircuitView } | null | undefined)?.circuit;
  return c && typeof c.tilt === 'function' ? c : null;
}
