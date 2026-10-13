/**
 * Blackjack — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.blackjack.` (MachineBase.t adds the prefix). `{n}` / `{pot}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Blackjack "Twenty-One"',
  desc: 'Beat the dealer to 21. Blackjack pays 3 to 2, the dealer draws to 17. Twin Souls pays on a matching first pair.',
  hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender',
  insurance: 'Insurance', even: 'Even money', decline: 'No', take: 'Take',
  ready: 'Ready', deal: 'Deal', bet: 'Bet', side: 'Twin Souls', bot: 'Undertaker',
  sBet: 'Place your bets', sWait: 'Waiting for the others', sIns: 'Insurance?', sTurn: 'Your decision',
  sDealer: 'Dealer draws', sPeek: 'Dealer checks for blackjack', sSettle: 'Settling', sShuffle: 'Shuffling',
  sWin: 'You win {n}', sLose: 'Dealer takes it', sPush: 'Push, bet returned', sBj: 'Blackjack! Pays 3 to 2',
  sDealerBj: 'Dealer blackjack', sEven: 'Even money paid',
  rBj: 'BLACKJACK', rWin: 'WIN', rPush: 'PUSH', rLoss: 'LOSE', rBust: 'BUST', rSurr: 'SURRENDER',
  dealer: 'DEALER {n}', soft: '{n} SOFT', insOn: 'INSURANCE {n}', totalLabel: 'TOTAL',
  shoe: 'SHOE {n}', potLabel: 'Stake', badBet: 'That bet is not allowed', busy: 'A hand is in progress',
  notYourTurn: 'Not your turn', noSideBet: 'No Twin Souls stake on this table',
  hintSide: 'Twin Souls', hintRules: 'Rules',
  r_win: 'W', r_bj: 'BJ', r_push: 'P', r_loss: 'L', r_bust: 'X', r_surr: 'S', r_even: 'E',
  tagBet: 'BET', tagBj: 'BJ',
};

const tr: Record<string, string> = {
  name: 'Blackjack (Yirmi Bir)',
  desc: 'Krupiyeyi 21\'e yaklaş. Blackjack 3\'e 2 öder, krupiye 17\'ye kadar çeker. İkiz Ruhlar ilk çiftte öder.',
  hit: 'Kart', stand: 'Dur', double: 'İkiye katla', split: 'Ayır', surrender: 'Teslim',
  insurance: 'Sigorta', even: 'Eşit para', decline: 'Hayır', take: 'Al',
  ready: 'Hazır', deal: 'Dağıt', bet: 'Bahis', side: 'İkiz Ruhlar', bot: 'Müteahhit',
  sBet: 'Bahislerini koy', sWait: 'Diğerleri bekleniyor', sIns: 'Sigorta?', sTurn: 'Senin sıran',
  sDealer: 'Krupiye çekiyor', sPeek: 'Krupiye blackjack\'e bakıyor', sSettle: 'Hesaplanıyor', sShuffle: 'Karışıyor',
  sWin: 'Kazandın {n}', sLose: 'Krupiye aldı', sPush: 'Berabere, bahis iade', sBj: 'Blackjack! 3\'e 2 öder',
  sDealerBj: 'Krupiyenin blackjack\'i', sEven: 'Eşit para ödendi',
  rBj: 'BLACKJACK', rWin: 'KAZANÇ', rPush: 'BERABERE', rLoss: 'KAYIP', rBust: 'BATTI', rSurr: 'TESLİM',
  dealer: 'KRUPİYE {n}', soft: '{n} YUMUŞAK', insOn: 'SİGORTA {n}', totalLabel: 'TOPLAM',
  shoe: 'SEPET {n}', potLabel: 'Bahis', badBet: 'Bu bahis geçerli değil', busy: 'Bir el oynanıyor',
  notYourTurn: 'Sıra sende değil', noSideBet: 'Bu masada İkiz Ruhlar bahsi yok',
  hintSide: 'İkiz Ruhlar', hintRules: 'Kurallar',
  r_win: 'K', r_bj: 'BJ', r_push: 'B', r_loss: 'Y', r_bust: 'X', r_surr: 'T', r_even: 'E',
  tagBet: 'BAHİS', tagBj: 'BJ',
};

export default { prefix: 'm.blackjack.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
