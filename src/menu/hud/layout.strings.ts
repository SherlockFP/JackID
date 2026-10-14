/**
 * HUD layout strings (hud-layout lane): the seat STAKE readout and its high-stake confirm line. Loaded by the
 * `*.strings.ts` glob in main.ts. The top-band intermission line lives in `game/ingame/intermission.strings.ts`.
 */
export default {
  prefix: 'hud.',
  en: {
    'stake.label': 'STAKE / POCKET',
    'stake.confirm': 'CONFIRM HIGH STAKE',
    'paidTag': 'N{n} PAID',
    'lampChase.hot': 'HOT · {name}',
    'lampChase.dist': '{d}m {a}',
  },
  tr: {
    'stake.label': 'BAHİS / CEP',
    'stake.confirm': 'YÜKSEK BAHİS: ONAYLA',
    'paidTag': 'G{n} ÖDENDİ',
    'lampChase.hot': 'SICAK · {name}',
    'lampChase.dist': '{d}m {a}',
  },
};
