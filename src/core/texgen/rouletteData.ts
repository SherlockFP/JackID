/**
 * European roulette data: wheel order, red pockets and pocket colour. Pure data and pure functions only (no three,
 * no DOM, no i18n), so machine `rules.ts` and the Node RTP sims can import it. Owner: CORE-TEXGEN.
 * `tabletop.ts` paints the wheel and layout from these; `texgen.ts` re-exports them for existing importers.
 */

/** European wheel, clockwise from 0 (ART_BIBLE §3.8). */
export const ROULETTE_ORDER: readonly number[] = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

/** Red pockets of the European wheel (0 is green, every other pocket is black). */
export const RED_NUMBERS: readonly number[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export type RouletteColor = 'red' | 'black' | 'green';

export const rouletteColor = (n: number): RouletteColor => (n === 0 ? 'green' : RED_NUMBERS.includes(n) ? 'red' : 'black');
