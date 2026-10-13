/**
 * Red Dog "The Kennel" — UI and in-world strings (EN + TR). Registered under `m.reddog.` (MachineBase.t adds the prefix).
 * `{n}`, `{s}`, `{p}` and `{card}` are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Red Dog "The Kennel"',
  desc: 'One shared hand, six seats. Two cards turn up and the dog barks the gap between them. Raise on a wide gap, then the third card has to land inside it. The dog knows when to bark.',
  felt: 'THE KENNEL', box: 'BET', spreadBar: 'SPREAD',
  sOpen: 'Place your bets', sOpenWait: 'Waiting for the others', sLocked: 'Bet locked', sDeal: 'Dealing',
  sSpread: 'The dog counts: spread {n}', sConsec: 'Consecutive, the dog whimpers', sPair: 'A pair! Third card for trips',
  sRaise: 'Raise window: {s}s', sRaised: 'Raises are in', sThird: 'Third card', sSettle: 'Paying out',
  sShuffle: 'Shuffling the six decks', sIdle: 'The Kennel is quiet',
  rWin: 'WIN {n}', rLose: 'Outside the spread', rPush: 'Push, stake back', rTrips: 'TRIPS! {n}',
  rConsec: 'Consecutive, push', rPairNo: 'Pair, no trips, push', rRaised: 'Raised {n}',
  hLock: 'Bet', hRaise: 'Raise', hHalf: 'Half raise', hPass: 'No raise', hReady: 'Ready', hClear: 'Clear',
  hRaiseFull: 'Raise {n}', hReveal: 'Turn',
  potLabel: 'Bet', raiseLabel: 'Raise {n}', timerLabel: 'Raise: {s}s', odds: 'Win chance {p} %',
  countLabel: 'Count {n}', trueLabel: 'True {n}',
  peekHigh: 'The ears go up: the next card is 8 or higher', peekLow: 'The ears go down: the next card is under 8',
  noBet: 'Place a bet first', badBet: 'That bet is not allowed', busy: 'The Kennel is busy', notSeated: 'Sit down first',
  noRaise: 'Not enough coins to raise', raiseClosed: 'The raise window is closed', notYourRaise: 'No raise on this hand',
  refundLuck: 'The dog lost the third card: stake back',
};

const tr: Record<string, string> = {
  name: 'Kırmızı Köpek «Kulübe»',
  desc: 'Tek ortak el, altı koltuk. İki kart açılır ve köpek aradaki farkı havlar. Geniş farkta artır; üçüncü kart onun içine düşmeli. Köpek ne zaman havlayacağını bilir.',
  felt: 'KULÜBE', box: 'BAHİS', spreadBar: 'FARK',
  sOpen: 'Bahislerini koy', sOpenWait: 'Diğerleri bekleniyor', sLocked: 'Bahis kilitlendi', sDeal: 'Dağıtılıyor',
  sSpread: 'Köpek sayıyor: fark {n}', sConsec: 'Ardışık, köpek inliyor', sPair: 'Çift! Üçlü için üçüncü kart',
  sRaise: 'Artırma penceresi: {s} sn', sRaised: 'Artırmalar alındı', sThird: 'Üçüncü kart', sSettle: 'Ödeniyor',
  sShuffle: 'Altı deste karıştırılıyor', sIdle: 'Kulübe sessiz',
  rWin: 'KAZANÇ {n}', rLose: 'Fark dışında', rPush: 'Berabere, bahis iade', rTrips: 'ÜÇLÜ! {n}',
  rConsec: 'Ardışık, berabere', rPairNo: 'Çift, üçlü yok, berabere', rRaised: 'Artırıldı {n}',
  hLock: 'Bahis', hRaise: 'Artır', hHalf: 'Yarı artır', hPass: 'Artırma', hReady: 'Hazır', hClear: 'Temizle',
  hRaiseFull: 'Artır {n}', hReveal: 'Çevir',
  potLabel: 'Bahis', raiseLabel: 'Artırma {n}', timerLabel: 'Artırma: {s} sn', odds: 'Kazanma şansı %{p}',
  countLabel: 'Sayım {n}', trueLabel: 'Gerçek {n}',
  peekHigh: 'Kulaklar kalktı: sıradaki kart 8 ya da üzeri', peekLow: 'Kulaklar indi: sıradaki kart 8 altı',
  noBet: 'Önce bir bahis koy', badBet: 'Bu bahis geçerli değil', busy: 'Kulübe meşgul', notSeated: 'Önce otur',
  noRaise: 'Artırmak için yeterli jeton yok', raiseClosed: 'Artırma penceresi kapandı', notYourRaise: 'Bu elde artırma yok',
  refundLuck: 'Köpek üçüncü kartı kaçırdı: bahis iade',
};

export default { prefix: 'm.reddog.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
