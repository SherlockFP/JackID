/**
 * WHEEL SPIN (wave 75 floor event). A four-segment wheel spins for 2 s and stops on one floor rule that holds for 30 s. The
 * segments are equal. Each segment is a plain ModEffect the modifier fold already reads, so no machine changes. The +1 pull
 * is read at Watch start, so the wheel must be rolled before `startWatch` (the same order as the Cold Snap).
 */
import type { Rng } from '@/core/rng';
import type { ModEffect } from '@/game/modifiers.types';

export const WHEEL_S = 30;
export const WHEEL_SPIN_S = 2;
export const WHEEL_SEGMENTS = ['extra_pull', 'hot_lamp', 'tilt_grace', 'payout_dip'] as const;
export type WheelSegment = typeof WHEEL_SEGMENTS[number];

export function spinWheel(rng: Rng): WheelSegment {
  return rng.pick(WHEEL_SEGMENTS);
}

export function wheelEffects(seg: WheelSegment): ModEffect[] {
  switch (seg) {
    case 'extra_pull': return [{ hook: 'x.run.pullsAdd', op: 'add', value: 1 }];
    case 'hot_lamp': return [{ hook: 'x.lamp.hotMult', op: 'set', value: 2 }];
    case 'tilt_grace': return [{ hook: 'x.tilt.grace', op: 'add', value: 2 }];
    case 'payout_dip': return [{ hook: 'payout.mult', op: 'mult', value: 0.9 }];
  }
}

/** True while the wheel is still spinning (the HUD shows the spin; the rule already counts). */
export function wheelSpinning(elapsedS: number): boolean {
  return elapsedS < WHEEL_SPIN_S;
}
