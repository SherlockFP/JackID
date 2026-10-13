/**
 * Mines Terminal — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts (default export
 * `{ prefix, en, tr }`); keys resolve as `m.mines.<key>`. `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Mines Terminal',
  desc: 'Five by five, a few of them are mines. Every safe tile raises the multiplier. Know when to cash out.',
  arm: 'Arm', reveal: 'Reveal', cash: 'Cash out', cashN: 'Cash {n}', mines: 'Mines', minesN: '{n} MINES',
  stake: 'Stake', next: 'NEXT ×{n}', now: 'NOW ×{n}', left: 'LEFT {n}', potential: 'WIN {n}',
  ready: 'READY', armed: 'ARMED', fair: 'FAIR {n}', seed: 'SEED {n}', layout: 'LAYOUT',
  safe: 'SAFE', boom: 'BOOM', defused: 'DEFUSED', cashed: 'CASHED', void: 'VOID', insured: 'INSURED {n}',
  needSafe: 'Reveal one safe tile first', idle: 'IDLE {n}', scan: 'SCAN', cap: 'CAP ×{n}',
  defuseOn: 'DEFUSE', burnt: 'SIGNAL LOST', finger: 'FINGER',
  hMove: 'Move', hPick: 'Reveal', hArm: 'Arm', hCash: 'Cash out {n}', hMines: 'Mines', hBet: 'Bet',
  hint: 'Arrows / WASD move · Space reveal · Q cash out · [ ] mines · 1–5 presets · H help',
  help: 'Pick the mine count, arm the field, then reveal tiles one at a time. Safe tiles raise the multiplier. A mine ends the round. Cash out whenever you like after the first safe tile.',
  sMines: 'MINES', sLadder: 'LADDER', sStake: 'STAKE',
};

const tr: Record<string, string> = {
  name: 'Mayın Tarlası Terminali',
  desc: 'Beşe beş, birkaçı mayın. Her güvenli kare çarpanı yükseltir. Ne zaman çekileceğini bil.',
  arm: 'Kur', reveal: 'Aç', cash: 'Çek', cashN: 'Çek {n}', mines: 'Mayın', minesN: '{n} MAYIN',
  stake: 'Bahis', next: 'SONRAKİ ×{n}', now: 'ŞİMDİ ×{n}', left: 'KALAN {n}', potential: 'KAZANÇ {n}',
  ready: 'HAZIR', armed: 'KURULDU', fair: 'ADİL {n}', seed: 'TOHUM {n}', layout: 'DİZİLİM',
  safe: 'GÜVENLİ', boom: 'PATLADI', defused: 'ETKİSİZ', cashed: 'ÇEKİLDİ', void: 'İPTAL', insured: 'SİGORTA {n}',
  needSafe: 'Önce bir güvenli kare aç', idle: 'BEKLEME {n}', scan: 'TARAMA', cap: 'TAVAN ×{n}',
  defuseOn: 'ETKİSİZ', burnt: 'SİNYAL YOK', finger: 'PARMAK',
  hMove: 'Hareket', hPick: 'Aç', hArm: 'Kur', hCash: 'Çek {n}', hMines: 'Mayın', hBet: 'Bahis',
  hint: 'Oklar / WASD hareket · Boşluk aç · Q çek · [ ] mayın · 1–5 hazır ayar · H yardım',
  help: 'Mayın sayısını seç, tarlayı kur, kareleri tek tek aç. Güvenli kareler çarpanı yükseltir. Mayına basarsan el biter. İlk güvenli kareden sonra istediğin an çekebilirsin.',
  sMines: 'MAYIN', sLadder: 'MERDİVEN', sStake: 'BAHİS',
};

export default { prefix: 'm.mines.', en, tr };
