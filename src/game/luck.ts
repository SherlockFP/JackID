/**
 * THE LUCK METER (Wave 73, pillar 2: luck is earned at home and in the Night's standing). A run-wide score from −2 to 5 stars,
 * moved by the bus events of the run itself: a quota paid (+1), an overshoot (+1), a quota failed (−2), a Collector Heat gain
 * (−1) or cool-off (+1), a missed Watch tithe (−1), a rescue loan (−1), a keepsake that comes back (+1), a ghost match (+1), a word
 * kept at the kitchen table (+1, reason `promise`) and the framed photo from the home computer (+1 when a Night begins).
 *
 * Director decision (Oct 2026): the meter no longer feeds the luck hook. Each star is a flat payout bonus instead:
 * `payout.mult` = 1 + 0.01 × stars (−2 % .. +5 %), added through the modifier pipeline by `provider()`.
 *
 * THE PANTHEON (docs/BLESSINGS.md §2.3): the Well's boons tune the meter through the run port: `x.luck.perStar` (First Penny),
 * `x.luck.failSoft` (Soft Landing: a missed Dawn or tithe costs a star less), `x.luck.max` (The Well Answers), and two duo
 * numbers (`sealedNoStars`, `depositPerStar`). The meter never reads the mods inside `collect` (that would recurse): the run
 * calls `retune()` when a boon is kept or spent, and the numbers are cached until then.
 *
 * The meter listens to the bus itself. Each move emits `luck:change` (the HUD toasts it with the reason). The run creates it,
 * restores it from `resume.ext.luck`, saves `snapshot()`, and calls `dispose()` on exit.
 */
import { bus } from '@/core/events';
import type { ModProvider, ModSource } from './modifiers.types';
import type { FrameEvent } from './economy/homeEconomy';   // brings the `econ:frame` event into the bus map

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
  /** Re-reads the boon numbers from the run port (call when a boon is kept or spent). */
  retune(): void;
  /** Unsubscribes from the bus. */
  dispose(): void;
}

/** The run side the meter reads: a run-level mod (`x.luck.*`) and a boon number (the pantheon's `fx`). Both optional. */
export interface LuckRunPort {
  x?(hook: `x.luck.${string}`, base: number): number;
  fx?(key: string): number;
}

/** `touch` tells the run's modifier pipeline that a provider's answer changed (the run passes its `touch`). */
export function createLuckMeter(run: LuckRunPort, touch: () => void = () => {}): LuckMeter {
  let stars = 0;
  let disposed = false;
  let lastMove: LuckChange | null = null;
  const tune = { perStar: LUCK_PAYOUT_PER_STAR, max: LUCK_MAX, soft: 0, sealedFree: false, depositPerStar: 0 };
  const clampStars = (v: number): number => Math.min(tune.max, Math.max(LUCK_MIN, Math.round(v)));
  /** A loss of `n` stars, softened by Soft Landing (never below 0). */
  const loss = (n: number): number => -Math.max(0, n - tune.soft);
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
    bus.on('quota:failed', () => move(loss(2), 'failed')),
    // a missed Dawn that cost a seal, not the run: the same two stars (none with Still Water)
    bus.on('quota:sealed', () => move(tune.sealedFree ? 0 : loss(2), 'failed')),
    bus.on('home:heat', ({ delta, why }) => move(delta > 0 ? -1 : delta < 0 ? 1 : 0, why)),
    bus.on('run:tithe', (e) => { if (e.state === 'missed') move(loss(1), 'tithe'); }),
    bus.on('run:rescue', (e) => { if (e.state === 'taken') move(-1, 'loan'); }),
    // THE KEEPSAKE STAKE and THE GHOST SEAT (wave 75): a keepsake that comes back, and a round that matches the ghost
    // the kitchen table's Rock, Paper, Promise (mid 'promise') is a kept word, not a keepsake coming back
    bus.on('keepsake:stake', (e) => { if (e.state === 'won') move(e.star, e.mid === 'promise' ? 'promise' : 'keepsake'); }),
    bus.on('ghost:match', (e) => move(e.star, 'ghost')),
    // THE CROOKED TABLE: a right call at the rigged table earns a star
    bus.on('floor:luck', (e) => move(e.star, e.why)),
    // THE HOME COMPUTER (wave 77): the framed photo bought on the MARKET gives its star when a Night begins
    bus.on('econ:frame', (e: FrameEvent) => move(e.star, 'frame')),
  ];
  const payoutMult = (): number => 1 + tune.perStar * stars;
  const source = (): ModSource[] => (stars === 0 ? [] : [{
    kind: 'house', id: 'luck', owner: 0,
    effects: tune.depositPerStar > 0 && stars > 0
      ? [{ hook: 'payout.mult', op: 'mult', value: payoutMult() }, { hook: 'deposit.bonus', op: 'add', value: tune.depositPerStar * stars }]   // Wishing Coin
      : [{ hook: 'payout.mult', op: 'mult', value: payoutMult() }],
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
    retune(): void {
      tune.perStar = run.x?.('x.luck.perStar', LUCK_PAYOUT_PER_STAR) ?? LUCK_PAYOUT_PER_STAR;
      tune.max = Math.max(LUCK_MAX, Math.round(run.x?.('x.luck.max', LUCK_MAX) ?? LUCK_MAX));
      tune.soft = Math.max(0, Math.round(run.x?.('x.luck.failSoft', 0) ?? 0));
      tune.sealedFree = (run.fx?.('sealedNoStars') ?? 0) > 0;
      tune.depositPerStar = Math.max(0, run.fx?.('depositPerStar') ?? 0);
      touch();
    },
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
