/**
 * Juice → world bridge (WORLD-SYS). Listens to the pit-wide juice events declared in machines/_base/juice.ts and
 * drives the light pool, so machines never touch fixtures directly:
 *  - `juice:pitWave`: four gold rings of light pulses roll out from the jackpot machine across the floor (≈1.4 s).
 *  - `juice:floorStrobe`: the pit strobe. The pool only lights the sources near the camera, so the flash reads as
 *    "nearby fixtures flash" without a position in the event.
 *
 * Cheap and capped: one wave at a time (a second wave while one runs is dropped), ~32 pulses per wave, sample
 * spacing matched to the pool's 6 m reach, strobes never faster than 3 Hz (photosensitivity ceiling; with
 * reduceFlashing the pool turns strobes into a soft pulse and shrinks pulse peaks). Runs on the frame clock.
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { bus } from '@/core/events';
import { clamp } from '@/core/math';
import type { WorldLights } from '../types';

const WAVE_RINGS = 4;
const RING_GAP_S = 0.35;
const RING_STEP_M = 5;
const RING_PULSE_MAX = 10;
const RING_RISE_Y = 1.2;
const PULSE_MUL = 1.6;
const PULSE_DUR = 0.7;
const STROBE_HZ_MAX = 3;
const GOLD: Hex = 0xffe27a;

interface Job { at: number; run(): void }

export interface JuiceFx {
  /** Advance queued wave rings. Call once per frame, before the light pool updates. */
  update(dt: number): void;
  dispose(): void;
}

export function createJuiceFx(lights: WorldLights): JuiceFx {
  // one reusable probe object: `pulse` resolves its target synchronously, so a single probe is enough
  const probe = new THREE.Object3D();
  const jobs: Job[] = [];
  let clock = 0;
  let disposed = false;

  const offs: Array<() => void> = [
    bus.on('juice:pitWave', ({ x, y, z, radius }) => {
      if (disposed || jobs.length > 0) return;
      for (let r = 0; r < WAVE_RINGS; r++) {
        const rad = radius * (r + 1) / WAVE_RINGS;
        const n = clamp(Math.round((2 * Math.PI * rad) / RING_STEP_M), 4, RING_PULSE_MAX);
        jobs.push({
          at: clock + r * RING_GAP_S,
          run: () => {
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2;
              probe.position.set(x + Math.cos(a) * rad, y + RING_RISE_Y, z + Math.sin(a) * rad);
              lights.pulse(probe, { color: GOLD, mul: PULSE_MUL, dur: PULSE_DUR });
            }
          },
        });
      }
    }),
    bus.on('juice:floorStrobe', ({ hz, dur, color }) => {
      if (disposed || !(dur > 0)) return;
      lights.strobe('all', Math.min(hz, STROBE_HZ_MAX), dur, color);
    }),
  ];

  return {
    update(dt) {
      if (disposed) return;
      clock += dt;
      while (jobs.length > 0 && jobs[0].at <= clock) jobs.shift()!.run();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      jobs.length = 0;
    },
  };
}
