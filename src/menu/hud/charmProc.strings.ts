/**
 * Engine charm peg readouts (charmProc.ts): the full live label shown on a peg (hover title and screen readers).
 * Placeholders: {n} count, {max} cap, {x} next-win multiplier, {pct} bonus percent.
 */
export default {
  prefix: 'hud.',
  en: {
    'charm.peg.suit_ladder': 'RUNG {n}/{max} · next win ×{x}',
    'charm.peg.pressure_valve': 'PRESSURE {n}/{max} · next win ×{x}',
    'charm.peg.capacitor': 'CHARGE {n}/{max} · next Hot win ×{x}',
    'charm.peg.lampwick': 'WICKS {n}/{max} · Hot +{pct}%',
    'charm.peg.snowball_ledger': 'WATCH {n}/{max} · interest +{pct}%',
  },
  tr: {
    'charm.peg.suit_ladder': 'BASAMAK {n}/{max} · sonraki kazanç ×{x}',
    'charm.peg.pressure_valve': 'BASINÇ {n}/{max} · sonraki kazanç ×{x}',
    'charm.peg.capacitor': 'ŞARJ {n}/{max} · sonraki Sıcak kazanç ×{x}',
    'charm.peg.lampwick': 'FİTİL {n}/{max} · Sıcak +%{pct}',
    'charm.peg.snowball_ledger': 'VARDİYA {n}/{max} · faiz +%{pct}',
  },
};
