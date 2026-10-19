/**
 * Pop text motion (popText.ts), kept pure so it is unit-tested: the whole-pixel squash and stretch, the JACKPOT slam and
 * the odometer roll of a counting number. Every value is an integer pixel scale, so the text stays crisp (PSX look).
 */

/** Seconds a slam takes to fall from its huge size to rest. */
export const SLAM_S = 0.16;

/**
 * Glyph scale [x, y] at `t` s after a landing (spawn, a count's end, a slam's impact) for the rest scale `ps`: a wide
 * squash for 0.06 s, a tall stretch to 0.13 s, then rest. A slam (`slam`, `age` since spawn) first falls from ps + 5.
 */
export function popScale(age: number, t: number, ps: number, slam: boolean, out: number[]): void {
  if (slam && age < SLAM_S) {
    const s = ps + Math.ceil(5 * (1 - age / SLAM_S));
    out[0] = s; out[1] = s;
    return;
  }
  const dx = t >= 0 && t < 0.06 ? 1 : 0;
  const dy = t >= 0.06 && t < 0.13 ? 1 : 0;
  out[0] = ps + dx; out[1] = ps + dy;
}

/** The odometer's value `age` s into a `dur` s roll up to `target` (ease-out, whole numbers, exact at the end). */
export function countValue(target: number, age: number, dur: number): number {
  if (!(dur > 0) || age >= dur) return target;
  const k = Math.max(0, age / dur);
  return Math.floor(target * (1 - (1 - k) * (1 - k) * (1 - k)));
}

/** Digit slots of a text and the whole number they spell, read left to right ("+1,250" → slots [1,3,4,5], 1250). */
export function digitSlots(text: string): { slots: number[]; value: number } {
  const slots: number[] = [];
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    const d = text.charCodeAt(i) - 48;
    if (d >= 0 && d <= 9) { slots.push(i); value = value * 10 + d; }
  }
  return { slots, value };
}
