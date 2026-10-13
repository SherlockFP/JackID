/**
 * Baccarat "The Mirror Table" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys
 * are registered under `m.baccarat.` (MachineBase.t adds the prefix). `{n}`, `{card}` and `{pot}` are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Baccarat "The Mirror Table"',
  desc: 'Punto Banco at the mirror table: bet Player, Banker or Tie, squeeze your cards for luck and read the roadmap. The Banker never looks at you.',
  boxP: 'PLAYER', boxB: 'BANKER',
  banker: 'BANKER', player: 'PLAYER', tie: 'TIE', ppair: 'P PAIR', bpair: 'B PAIR',
  spotBanker: 'Banker', spotPlayer: 'Player', spotTie: 'Tie', spotPpair: 'Player pair', spotBpair: 'Banker pair',
  sOpen: 'Place your bets', sOpenWait: 'Waiting for the others', sLocked: 'Bets locked', sLock: 'No more bets',
  sDeal: 'Dealing', sSqueeze: 'Squeeze your cards', sSqueezeOther: 'Someone is squeezing',
  sReveal: 'Turning the cards', sThird: 'Third card', sResult: 'Result', sPayout: 'Paying out',
  sShuffle: 'Shuffling the shoe', sIdle: 'The shoe is quiet',
  rPlayer: 'PLAYER WINS', rBanker: 'BANKER WINS', rTie: 'TIE', rNat: 'NATURAL {n}', rPair: 'PAIR',
  rWin: 'WIN {n}', rLose: 'Banker keeps it', rPush: 'Push, stake back', rComm: 'Commission {n}',
  hLock: 'Lock bets', hReveal: 'Reveal', hSkip: 'Reveal all', hDrag: 'Drag down', hClear: 'Clear',
  hPlayer: 'Player', hBanker: 'Banker', hTie: 'Tie', hBet: 'Bet', hShoe: 'SHOE {n}',
  totalP: 'P {n}', totalB: 'B {n}', potLabel: 'Stake', roadLabel: 'ROAD',
  peek: 'Next card: {card}', mirrorFigure: 'Something stands behind you',
  bot: 'The Banker',
  badBet: 'That bet is not allowed', limit: 'Limit {n} on that spot', busy: 'The table is busy',
  noBets: 'Place a bet first', notSquad: 'Not your card to squeeze', notSeated: 'Sit down first',
  tableMax: 'Table limit {n} per seat',
};

const tr: Record<string, string> = {
  name: 'Bakara «Aynalı Masa»',
  desc: 'Aynalı masada Punto Banco: Oyuncu, Banker ya da Beraberlik\'e bahis koy, kartlarını sıkarak şans topla ve yol haritasını oku. Bankacı sana asla bakmaz.',
  boxP: 'OYUNCU', boxB: 'BANKER',
  banker: 'BANKER', player: 'OYUNCU', tie: 'BERABERE', ppair: 'O ÇİFT', bpair: 'B ÇİFT',
  spotBanker: 'Banker', spotPlayer: 'Oyuncu', spotTie: 'Beraberlik', spotPpair: 'Oyuncu çifti', spotBpair: 'Banker çifti',
  sOpen: 'Bahislerini koy', sOpenWait: 'Diğerleri bekleniyor', sLocked: 'Bahisler kilitlendi', sLock: 'Artık bahis yok',
  sDeal: 'Dağıtılıyor', sSqueeze: 'Kartlarını sık', sSqueezeOther: 'Biri kartını sıkıyor',
  sReveal: 'Kartlar çevriliyor', sThird: 'Üçüncü kart', sResult: 'Sonuç', sPayout: 'Ödeniyor',
  sShuffle: 'Sabot karıştırılıyor', sIdle: 'Sabot sessiz',
  rPlayer: 'OYUNCU KAZANDI', rBanker: 'BANKER KAZANDI', rTie: 'BERABERE', rNat: 'DOĞAL {n}', rPair: 'ÇİFT',
  rWin: 'KAZANÇ {n}', rLose: 'Banker aldı', rPush: 'Berabere, bahis iade', rComm: 'Komisyon {n}',
  hLock: 'Bahisi kilitle', hReveal: 'Aç', hSkip: 'Hepsini aç', hDrag: 'Aşağı çek', hClear: 'Temizle',
  hPlayer: 'Oyuncu', hBanker: 'Banker', hTie: 'Beraberlik', hBet: 'Bahis', hShoe: 'SABOT {n}',
  totalP: 'O {n}', totalB: 'B {n}', potLabel: 'Bahis', roadLabel: 'YOL',
  peek: 'Sıradaki kart: {card}', mirrorFigure: 'Arkanda biri duruyor',
  bot: 'Banker',
  badBet: 'Bu bahis geçerli değil', limit: 'Bu noktada limit {n}', busy: 'Masa meşgul',
  noBets: 'Önce bir bahis koy', notSquad: 'Bu kart senin değil', notSeated: 'Önce otur',
  tableMax: 'Koltuk başına masa limiti {n}',
};

export default { prefix: 'm.baccarat.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
