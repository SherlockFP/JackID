/**
 * Hot / cold streaks and machine overheat (BRIEF ADDENDUM 3: "win streaks heat a machine up").
 * Per machine instance: a win streak and a loss streak, plus a 0..100 heat meter. The buffs themselves are plain
 * `hot`, `cold` and `overheat` instance buffs from data/buffs.ts; this file only decides when they start and stop.
 * Heat gain is scaled by the `heat.gain` hook, so Power Surge and charms apply without special cases.
 */
import type { InstanceId, MachineId, PlayerId } from '@/core/types';
import type { RunApi } from '@/game/types';
import type { Rng } from '@/core/rng';
import type { Buffs } from './engine';

export interface StreakHost {
  run(): RunApi;
  rng: Rng;
  readonly isHost: boolean;
}

interface Track { win: number; loss: number; heat: number }

const HEAT_MAX = 100;
const HEAT_AFTER_OVERHEAT = 55;
const HEAT_DECAY_PER_S = 3;
const HOT_FROM_WINS = 3;
const COLD_FROM_LOSSES = 4;
const HOT_MAX_STACKS = 3;

export class Streaks {
  private readonly tracks = new Map<InstanceId, Track>();

  constructor(private readonly host: StreakHost, private readonly buffs: Buffs) {}

  private track(mid: InstanceId): Track {
    let t = this.tracks.get(mid);
    if (!t) { t = { win: 0, loss: 0, heat: 0 }; this.tracks.set(mid, t); }
    return t;
  }

  heat(mid: InstanceId): number { return this.tracks.get(mid)?.heat ?? 0; }
  winStreak(mid: InstanceId): number { return this.tracks.get(mid)?.win ?? 0; }
  lossStreak(mid: InstanceId): number { return this.tracks.get(mid)?.loss ?? 0; }

  /** Settled round on a machine: `gross > 0` is a win. */
  onResult(pid: PlayerId, mid: InstanceId, machineId: MachineId, gross: number, bet: number): void {
    if (!this.host.isHost) return;
    const t = this.track(mid);
    const run = this.host.run();
    if (gross > 0) {
      t.win += 1;
      t.loss = 0;
      const ratio = bet > 0 ? Math.min(16, gross / bet) : 0;
      t.heat = Math.min(HEAT_MAX, t.heat + 8 * run.mod('heat.gain', machineId, 1, { pid, instance: mid }) + ratio);
      this.buffs.remove('cold', { mid });
      if (t.win >= HOT_FROM_WINS) this.buffs.add('hot', { pid, mid, stacks: Math.min(HOT_MAX_STACKS, t.win - HOT_FROM_WINS + 1) });
    } else {
      t.loss += 1;
      t.win = 0;
      t.heat = Math.max(0, t.heat - 6);
      this.buffs.remove('hot', { mid });
      if (t.loss >= COLD_FROM_LOSSES) this.buffs.add('cold', { pid, mid });
    }
    if (t.heat >= HEAT_MAX) {
      this.buffs.add('overheat', { pid, mid });
      t.heat = HEAT_AFTER_OVERHEAT;
    }
  }

  /** A round started: nightly fire risk (`x.surge.fire` probability per round) can overheat the machine. */
  onRound(pid: PlayerId, mid: InstanceId, machineId: MachineId): void {
    if (!this.host.isHost) return;
    const p = this.host.run().mod('x.surge.fire', machineId, 0, { pid, instance: mid });
    if (p > 0 && this.host.rng.chance(Math.min(1, p))) this.buffs.add('overheat', { pid, mid });
  }

  /** Real-time decay of heat (once per frame). */
  tick(dt: number): void {
    if (!this.host.isHost) return;
    for (const t of this.tracks.values()) if (t.heat > 0) t.heat = Math.max(0, t.heat - HEAT_DECAY_PER_S * dt);
  }

  /** Shift end: streaks reset, heat cools. */
  onShiftEnd(): void {
    for (const t of this.tracks.values()) { t.win = 0; t.loss = 0; t.heat = 0; }
  }
}
