/**
 * Circuit lamp glow (WORLD-SYS). Listens to `circuit:lamps` (fired at each Bell and empty at Settle) and puts a pooled
 * light over every Hot and Cold machine, so the Lamps can be read from across the pit:
 *   Hot  warm amber, breathing (about 0.4 Hz, ±30 %), bright enough to win a pool slot near the player.
 *   Cold dim blue, steady, a faint tint only.
 * The lights live in the shared LightPool (world/sys/lightPool), so the pool's six slots still decide what is real.
 * Reduce flashing shrinks the breathing to a quarter. Seeded or timed only; no randomness.
 */
import { bus } from '@/core/events';
import type { Hex, InstanceId, Unsub } from '@/core/types';
import type { LightPool } from './lightPool';

const HOT_COLOR: Hex = 0xffa040;
const COLD_COLOR: Hex = 0x3f6fff;
const HOT_BASE = 1.9;
const COLD_BASE = 0.5;
const HOT_RANGE = 4.5;
const COLD_RANGE = 3;
/** Metres above the slot origin (over the cabinet top). */
const MOUNT_Y = 2.1;
const BREATH_HZ = 0.4;

export interface LampGlowOpts {
  pool: Pick<LightPool, 'add' | 'api'>;
  /** World position of an instance's slot, or null when it has none. */
  at(mid: InstanceId): { x: number; y: number; z: number } | null;
  /** Accessibility: reduce flashing. */
  reduced(): boolean;
}

export interface LampGlow {
  /** Per frame: breathing levels for the live Hot lamps. */
  update(dt: number): void;
  /** Removes every light and the bus subscription. */
  dispose(): void;
}

interface Live { owner: string; hot: boolean; off: () => void; phase: number }

export function createLampGlow(o: LampGlowOpts): LampGlow {
  const live: Live[] = [];
  let clock = 0;
  let serial = 0;

  const clear = (): void => {
    for (const l of live) l.off();
    live.length = 0;
  };

  const add = (mid: InstanceId, hot: boolean): void => {
    const p = o.at(mid);
    if (!p) return;
    const owner = `lamp:${hot ? 'hot' : 'cold'}:${mid}`;
    const off = o.pool.add({
      id: owner, owner,
      pos: { x: p.x, y: p.y + MOUNT_Y, z: p.z },
      color: hot ? HOT_COLOR : COLD_COLOR,
      intensity: hot ? HOT_BASE : COLD_BASE,
      range: hot ? HOT_RANGE : COLD_RANGE,
      flicker: 'STEADY',
    });
    live.push({ owner, hot, off, phase: (serial++ * 0.618) % 1 });
  };

  const unsub: Unsub = bus.on('circuit:lamps', (e) => {
    clear();
    for (const m of e.hot) add(m.mid, true);
    for (const m of e.cold) add(m.mid, false);
  });

  return {
    update(dt: number): void {
      if (live.length === 0) return;
      clock += dt;
      const amp = o.reduced() ? 0.25 : 1;
      for (const l of live) {
        const s = 0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * BREATH_HZ + l.phase * Math.PI * 2);
        const level = l.hot ? 1 + amp * (0.6 * s - 0.3) : 1 - amp * 0.1 * s;
        o.pool.api.setLevel(l.owner, level, 0);
      }
    },
    dispose(): void {
      unsub();
      clear();
    },
  };
}
