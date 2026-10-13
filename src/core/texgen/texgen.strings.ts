/**
 * Texgen strings: the labels baked into language-dependent textures (the roulette felt layout). Loaded by the
 * `*.strings.ts` glob in main.ts; the texture is rebuilt per language, so a locale switch needs no extra work.
 * Keep each label short: they are drawn in the 3×5 micro font inside 20–40 px cells.
 */
export default {
  prefix: 'tex.',
  en: {
    'roulette.dozen1': '1ST 12',
    'roulette.dozen2': '2ND 12',
    'roulette.dozen3': '3RD 12',
    'roulette.even': 'EVEN',
    'roulette.odd': 'ODD',
  },
  tr: {
    'roulette.dozen1': '1. 12',
    'roulette.dozen2': '2. 12',
    'roulette.dozen3': '3. 12',
    'roulette.even': 'ÇİFT',
    'roulette.odd': 'TEK',
  },
};
