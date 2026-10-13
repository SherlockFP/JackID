/**
 * Three Card Poker — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.threecard.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Three Card Poker',
  desc: 'Beat the Shuffler with three cards. Ante, then Play or Fold. The dealer needs Queen-high. Pair Plus pays on your hand alone.',
  ante: 'Ante', play: 'Play', fold: 'Fold', pairPlus: 'Pair Plus', bonus: 'Ante Bonus',
  ready: 'Ready', deal: 'Deal', bet: 'Bet', bot: 'Shuffler',
  sBet: 'Place your ante', sWait: 'Waiting for the others', sDeal: 'Dealing', sDecide: 'Play or fold?',
  sReveal: 'Dealer reveals', sQual: 'QUALIFIES', sNoQual: 'NO QUALIFY', sSettle: 'Settling', sShuffle: 'Shuffling',
  sFoldWait: 'Folded, waiting', sWin: 'You win {n}', sLose: 'Dealer takes it', sPush: 'Push, bet returned',
  hClear: 'Clear table',
  rWin: 'WIN', rLose: 'LOSE', rPush: 'PUSH', rNq: 'NO QUALIFY', rFold: 'FOLD', rNone: 'PAIR PLUS',
  rHigh: 'HIGH CARD', rPair: 'PAIR', rFlush: 'FLUSH', rStraight: 'STRAIGHT', rTrips: 'THREE OF A KIND',
  rSf: 'STRAIGHT FLUSH', rRoyal: 'MINI ROYAL',
  dealer: 'DEALER {n}', dealerHidden: 'DEALER ? ? ?', totalLabel: 'TOTAL', potLabel: 'Stake',
  pp: 'PAIR+ {n}', anteLabel: 'ANTE {n}', tagBet: 'ANTE', tagPlay: 'PLAY', tagFold: 'FOLD',
  badBet: 'That bet is not allowed', busy: 'A hand is in progress', notYourTurn: 'Not your decision',
  noFunds: 'Not enough coins', decided: 'Decision made',
  hintPlay: 'Play', hintFold: 'Fold', hintSide: 'Pair Plus', hintRules: 'Rules',
  side: 'Pair Plus', anteStep: 'Ante', refund: 'Luck: stake refunded',
};

const tr: Record<string, string> = {
  name: 'Üç Kart Poker',
  desc: 'Üç kartla Dağıtıcı\'yı yen. Ante koy, sonra Oyna ya da Katla. Krupiye en az Kız yüksekliğinde olmalı. Çift Artı yalnızca kendi elinde öder.',
  ante: 'Ante', play: 'Oyna', fold: 'Katla', pairPlus: 'Çift Artı', bonus: 'Ante Bonusu',
  ready: 'Hazır', deal: 'Dağıt', bet: 'Bahis', bot: 'Karıştırıcı',
  sBet: 'Antenini koy', sWait: 'Diğerleri bekleniyor', sDeal: 'Dağıtılıyor', sDecide: 'Oyna mı, katla mı?',
  sReveal: 'Krupiye açıyor', sQual: 'NİTELİKLİ', sNoQual: 'NİTELİKSİZ', sSettle: 'Hesaplanıyor', sShuffle: 'Karıştırılıyor',
  sFoldWait: 'Katladın, bekle', sWin: 'Kazandın {n}', sLose: 'Krupiye aldı', sPush: 'Berabere, bahis iade',
  hClear: 'Masa temizleniyor',
  rWin: 'KAZANDIN', rLose: 'KAYBETTİN', rPush: 'BERABERE', rNq: 'NİTELİKSİZ', rFold: 'KATLADI', rNone: 'ÇİFT ARTI',
  rHigh: 'YÜKSEK KART', rPair: 'ÇİFT', rFlush: 'RENK', rStraight: 'DÜZ', rTrips: 'ÜÇLÜ',
  rSf: 'RENKLİ DÜZ', rRoyal: 'MİNİ ROYAL',
  dealer: 'KRUPİYE {n}', dealerHidden: 'KRUPİYE ? ? ?', totalLabel: 'TOPLAM', potLabel: 'Bahis',
  pp: 'ÇİFT+ {n}', anteLabel: 'ANTE {n}', tagBet: 'ANTE', tagPlay: 'OYNA', tagFold: 'KATLA',
  badBet: 'Bu bahse izin verilmiyor', busy: 'Bir el devam ediyor', notYourTurn: 'Karar senin değil',
  noFunds: 'Yeterli jeton yok', decided: 'Karar verildi',
  hintPlay: 'Oyna', hintFold: 'Katla', hintSide: 'Çift Artı', hintRules: 'Kurallar',
  side: 'Çift Artı', anteStep: 'Ante', refund: 'Şans: bahis iade edildi',
};

export default { prefix: 'm.threecard.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
