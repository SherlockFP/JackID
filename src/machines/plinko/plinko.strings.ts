/**
 * Plinko Board — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.plinko.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Plinko Board',
  desc: 'Drop pucks down the brass pegs. Edge slots pay the most, the centre pays the least. Golden slots double.',
  drop: 'Drop', risk: 'Risk', low: 'LOW', mid: 'MID', high: 'HIGH', pucks: 'Pucks {n}', stake: 'Stake {n}',
  hintDrop: 'Drop', hintRisk: 'Risk', hintPucks: 'Pucks', hintStake: 'Stake',
  golden: 'GOLD ×2', edge: 'EDGE', win: 'WIN {n}', last: 'LAST', bet: 'BET {n}', credit: 'CREDIT',
  extra: '+{n} FREE', multLabel: '×{n}', lost: 'Nothing this time',
  busy: 'Pucks are still falling', chaseEdge: 'EDGE!', potLabel: 'Bet',
};

const tr: Record<string, string> = {
  name: 'Plinko Çivi Tahtası',
  desc: 'Pirinç çivilerin arasına top bırak. Kenar gözler en çok öder, orta en az. Altın gözler ikiye katlar.',
  drop: 'Bırak', risk: 'Risk', low: 'DÜŞÜK', mid: 'ORTA', high: 'YÜKSEK', pucks: 'Top {n}', stake: 'Bahis {n}',
  hintDrop: 'Bırak', hintRisk: 'Risk', hintPucks: 'Top', hintStake: 'Bahis',
  golden: 'ALTIN ×2', edge: 'KENAR', win: 'KAZANÇ {n}', last: 'SON', bet: 'BAHİS {n}', credit: 'KREDİ',
  extra: '+{n} BEDAVA', multLabel: '×{n}', lost: 'Bu sefer olmadı',
  busy: 'Toplar hâlâ düşüyor', chaseEdge: 'KENAR!', potLabel: 'Bahis',
};

export default { prefix: 'm.plinko.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
