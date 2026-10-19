/**
 * Plinko Board — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.plinko.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Plinko Board',
  desc: 'Drop pucks down the brass pegs. Edge slots pay the most, the centre pays the least. Golden slots double.',
  drop: 'Drop', risk: 'Risk', low: 'LOW', mid: 'MED', high: 'HIGH', pucks: 'Pucks {n}', stake: 'Stake {n}',
  hintDrop: 'Drop', hintRisk: 'Risk', hintPucks: 'Pucks', hintStake: 'Stake',
  golden: 'GOLD ×2', edge: 'EDGE', win: 'WIN {n}', last: 'LAST', bet: 'BET {n}', credit: 'CREDIT',
  extra: '+{n} FREE', multLabel: '×{n}', lost: 'Nothing this time',
  busy: 'Pucks are still falling', chaseEdge: 'EDGE!', potLabel: 'Bet',
  goal: 'Drop pucks and land them in the big multiplier slots at the edges.',
  stFall: 'PUCKS FALLING', stQueued: 'NEXT DROP QUEUED ×{n}', stReady: 'READY TO DROP', stTable: '{risk} · EDGE → CENTRE {table} · RTP {rtp}%',
  nBet: 'BET', nPucks: 'PUCKS', nRisk: 'RISK', nLast: 'LAST', nBalance: 'BALANCE',
  cDrop: 'DROP', cPucks: 'PUCKS', cRisk: 'RISK', cStake: 'STAKE', cRules: 'RULES', cLeave: 'LEAVE',
  rule1: 'Each puck bounces down the pegs and lands in one of 13 slots.',
  rule2: 'You pay the stake for every puck. The slot it lands in pays its multiplier.',
  rule3: 'Risk LOW keeps the multipliers close together. HIGH pays the edges much more.',
  rule4: 'Up to five pucks drop at once. {keys} or the wheel changes the stake per puck.',
  rule5: 'Golden slots double the multiplier. The HIGH edge alarm is a warning only.',
};

const tr: Record<string, string> = {
  name: 'Plinko Çivi Tahtası',
  desc: 'Pirinç çivilerin arasına top bırak. Kenar gözler en çok öder, orta en az. Altın gözler ikiye katlar.',
  drop: 'Bırak', risk: 'Risk', low: 'DÜŞÜK', mid: 'ORTA', high: 'YÜKSEK', pucks: 'Top {n}', stake: 'Bahis {n}',
  hintDrop: 'Bırak', hintRisk: 'Risk', hintPucks: 'Top', hintStake: 'Bahis',
  golden: 'ALTIN ×2', edge: 'KENAR', win: 'KAZANÇ {n}', last: 'SON', bet: 'BAHİS {n}', credit: 'KREDİ',
  extra: '+{n} BEDAVA', multLabel: '×{n}', lost: 'Bu sefer olmadı',
  busy: 'Toplar hâlâ düşüyor', chaseEdge: 'KENAR!', potLabel: 'Bahis',
  goal: 'Topları kenardaki büyük çarpanlı gözlere düşürerek kazan.',
  stFall: 'TOPLAR DÜŞÜYOR', stQueued: 'SONRAKİ BIRAKMA SIRADA ×{n}', stReady: 'BIRAKMAYA HAZIR', stTable: '{risk} · KENAR → ORTA {table} · RTP {rtp}%',
  nBet: 'BAHİS', nPucks: 'TOP', nRisk: 'RİSK', nLast: 'SON', nBalance: 'BAKİYE',
  cDrop: 'BIRAK', cPucks: 'TOP', cRisk: 'RİSK', cStake: 'BAHİS', cRules: 'KURALLAR', cLeave: 'AYRIL',
  rule1: 'Her top çivilerin arasında sekerek 13 gözden birine düşer.',
  rule2: 'Her top için bahis ödenir. Topun düştüğü gözün çarpanı kadar geri alırsın.',
  rule3: 'DÜŞÜK risk çarpanları birbirine yakın tutar. YÜKSEK risk kenarlara çok daha fazla öder.',
  rule4: 'Bir seferde beş topa kadar bırakılır. {keys} ya da tekerlek bahsi topa göre değiştirir.',
  rule5: 'Altın gözler çarpanı ikiye katlar. YÜKSEK risk kenar alarmı yalnızca uyarıdır.',
};

export default { prefix: 'm.plinko.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
