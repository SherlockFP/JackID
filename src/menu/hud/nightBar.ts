/**
 * Night timeline maths (HUD). Pure: no DOM, no app. `hud.ts` reads `barView` once a frame and only does the presentation.
 * The bar has one segment per Watch (equal widths: a Night's Watches share one clock length), a gap between them (the Mola), and
 * a sun at the end (Dawn). Tested by scripts/tests/nightBar.test.mjs.
 */

/** The last stretch of a Watch: the bar and the time turn amber (red in the Night's last Watch) and pulse. */
export const SOON_SEC = 60;

export interface BarIn {
  /** The shift phase. */
  phase: string;
  /** The segment index the run reports (during a Mola it is the Watch just played, until the next Bell). */
  seg: number;
  count: number;
  /** Seconds left on the Watch clock (0 outside play). */
  left: number;
  /** The Watch clock's full length. */
  duration: number;
  /** The Watch `seg` has been settled (the Mola after it, until the next Bell). */
  settled: boolean;
}

export interface BarView {
  /** Fill 0..1 per Watch: finished = 1, the one in play = its elapsed fraction. */
  fill: number[];
  /** The Watch in play (-1 in a Mola, at Dawn). */
  cur: number;
  /** The Watch the Mola leads to (-1 in a Watch, at Dawn, after the last Watch). */
  next: number;
  /** Every Watch is done (Dawn). */
  dawn: boolean;
  /** The Watch in play is the Night's last: the bar is red. */
  last: boolean;
  /** Inside the last SOON_SEC of the Watch in play: the pulse. */
  soon: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

export function barView(i: BarIn): BarView {
  const count = Math.max(1, Math.floor(i.count));
  const inWatch = i.phase === 'bell' || i.phase === 'play' || i.phase === 'lastCall' || i.phase === 'closing';
  const frac = i.phase === 'bell' ? 0 : i.phase === 'closing' ? 1 : i.duration > 0 ? clamp01(1 - i.left / i.duration) : 0;
  const done = inWatch ? i.seg
    : i.phase === 'collection' ? count
    : i.phase === 'settle' || i.settled ? i.seg + 1
    : i.seg;
  const fill: number[] = [];
  for (let k = 0; k < count; k++) fill.push(k < done ? 1 : k === done && inWatch ? frac : 0);
  return {
    fill,
    cur: inWatch ? i.seg : -1,
    next: !inWatch && done < count ? done : -1,
    dawn: !inWatch && done >= count,
    last: inWatch && i.seg === count - 1,
    soon: inWatch && i.phase !== 'bell' && i.left <= SOON_SEC,
  };
}

/** "4:53" for the readout: whole minutes, two-digit seconds, rounded up like the old mm:ss. */
export function leftText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
