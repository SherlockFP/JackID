/**
 * THE LUCK METER (Wave 73, pillar 2: luck is earned at home and in the Night's standing). A run-wide score from −2 to 5 stars,
 * moved by the bus events of the run itself: a quota paid (+1), an overshoot (+1), a quota failed (−2), a Collector Heat gain
 * (−1) or cool-off (+1), a missed Watch tithe (−1) and a rescue loan (−1).
 *
 * Director decision (Oct 2026): the meter no longer feeds the luck hook. Each star is a flat payout bonus instead:
 * `payout.mult` = 1 + 0.01 × stars (−2 % .. +5 %), added through the modifier pipeline by `provider()`.
 *
 * The meter listens to the bus itself. Each move emits `luck:change` (the HUD toasts it with the reason). The run creates it,
 * restores it from `resume.ext.luck`, saves `snapshot()`, and calls `dispose()` on exit.
 */
import { bus } from '@/core/events';
import type { ModProvider, ModSource } from './modifiers.types';

export const LUCK_MIN = -2;
export const LUCK_MAX = 5;
/** Payout multiplier per star: 1 % (payout.mult = 1 + 0.01 × stars). */
export const LUCK_PAYOUT_PER_STAR = 0.01;

/** One move of the meter. `why` is the source's reason key (`luck.why.<why>` in the strings), or '' when the event gives none. */
export interface LuckChange { delta: number; stars: number; why: string }

declare module '@/core/events' {
  interface GameEvents {
    /** The luck meter moved (wave 73 re-tune). `why` names the source event; the HUD toasts it. */
    'luck:change': LuckChange;
  }
}

export interface LuckMeter {
  /** The meter's stars, −2..5. */
  stars(): number;
  /** The payout multiplier the meter adds: 1 + 0.01 × stars. */
  payoutMult(): number;
  /** The meter's last move (null before the first one): the same change `luck:change` carries. */
  last(): LuckChange | null;
  /** The modifier provider the run registers: one `payout.mult` source while the stars are not zero; never a luck effect. */
  provider(): ModProvider;
  /** JSON-safe save slice. */
  snapshot(): unknown;
  /** Restores the stars from a save (a damaged slice reads as 0). Silent: no `luck:change`. */
  restore(s: unknown): void;
  /** Unsubscribes from the bus. */
  dispose(): void;
}

/** The run side the meter reads: nothing today, so the port stays open for later luck rules. */
export type LuckRunPort = object;

const clampStars = (v: number): number => Math.min(LUCK_MAX, Math.max(LUCK_MIN, Math.round(v)));

/** `touch` tells the run's modifier pipeline that a provider's answer changed (the run passes its `touch`). */
export function createLuckMeter(_run: LuckRunPort, touch: () => void = () => {}): LuckMeter {
  let stars = 0;
  let disposed = false;
  let lastMove: LuckChange | null = null;
  const move = (d: number, why = ''): void => {
    if (disposed || d === 0) return;
    const before = stars;
    stars = clampStars(stars + d);
    if (stars === before) return;
    touch();
    lastMove = { delta: stars - before, stars, why };
    bus.emit('luck:change', lastMove);
  };
  const offs = [
    bus.on('quota:met', () => move(1, 'quota')),
    bus.on('quota:overshoot', () => move(1, 'overshoot')),
    bus.on('quota:failed', () => move(-2, 'failed')),
    bus.on('home:heat', ({ delta, why }) => move(delta > 0 ? -1 : delta < 0 ? 1 : 0, why)),
    bus.on('run:tithe', (e) => { if (e.state === 'missed') move(-1, 'tithe'); }),
    bus.on('run:rescue', (e) => { if (e.state === 'taken') move(-1, 'loan'); }),
  ];
  const payoutMult = (): number => 1 + LUCK_PAYOUT_PER_STAR * stars;
  const source = (): ModSource[] => (stars === 0 ? [] : [{
    kind: 'house', id: 'luck', owner: 0,
    effects: [{ hook: 'payout.mult', op: 'mult', value: payoutMult() }],
  }]);
  const providerObj: ModProvider = {
    kind: 'house',
    collect(_q, out): void { if (!disposed) for (const s of source()) out.push(s); },
  };
  return {
    stars: (): number => stars,
    payoutMult,
    last: (): LuckChange | null => lastMove,
    provider: (): ModProvider => providerObj,
    snapshot: (): unknown => ({ v: 1, stars }),
    restore(s: unknown): void {
      const v = s && typeof s === 'object' ? (s as { stars?: unknown }).stars : undefined;
      stars = typeof v === 'number' && Number.isFinite(v) ? clampStars(v) : 0;
      touch();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
    },
  };
}
