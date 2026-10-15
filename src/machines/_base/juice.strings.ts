/**
 * Juice copy (`_base/juice.ts`): the win-streak tag shown on the 3rd and later wins in a row.
 * Loaded by the `*.strings.ts` glob.
 */
const en: Record<string, string> = {
  streak: 'x{n} STREAK',
};

const tr: Record<string, string> = {
  streak: 'x{n} SERİ',
};

export default { prefix: 'juice.', en, tr };
export const STRINGS = { en, tr };
