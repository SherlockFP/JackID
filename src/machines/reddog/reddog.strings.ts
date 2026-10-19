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

  // ── seat HUD (readability standard) ──
  hGoal: 'Bet that the third card lands strictly between the two cards shown.',
  hRule1: 'Two cards turn up. Bet that the third card lands strictly between them.',
  hRule2: 'Cards between them: 1 pays 5 to 1, 2 pays 4 to 1, 3 pays 2 to 1, 4 or more pay 1 to 1.',
  hRule3: 'Consecutive cards have no gap and push. A pair pays 11 to 1 if the third card matches it (trips).',
  hRule4: 'A pair without trips pushes. A third card outside the two cards, or equal to one of them, loses the bet.',
  hRule5: 'With a spread of 7 or more, RAISE adds your bet again (or half of it) before the third card. PASS keeps your bet alone.',
  hRule6: 'Leaving before the cards are dealt returns your bet.',
  hStBet: 'PLACE YOUR BET', hStBetSub: 'Press [{bet}] to lock it',
  hStLocked: 'BET LOCKED', hStLockedSub: 'Waiting for the others',
  hStDeal: 'DEALING', hStConsec: 'CONSECUTIVE: NO GAP, PUSH',
  hStPair: 'PAIR! THIRD CARD FOR TRIPS', hStPairSub: 'Trips pays 11 to 1',
  hStSpread: 'SPREAD {n}', hStSpreadSub: 'Lands between them: pays {n} to 1',
  hStRaise: 'RAISE OR PASS?', hStRaiseSub: 'Raising adds {n} to your bet',
  hStRaiseSent: 'RAISE SENT, WAITING', hStRaiseWait: 'RAISE WINDOW',
  hStThird: 'THIRD CARD', hStShuffle: 'SHUFFLING THE SIX DECKS',
  hResWin: 'WIN', hResLose: 'OUTSIDE THE SPREAD', hResPush: 'PUSH', hResTrips: 'TRIPS!',
  hResConsec: 'CONSECUTIVE, PUSH', hResPairNo: 'PAIR, PUSH', hResRefund: 'STAKE REFUNDED',
  hNBet: 'BET', hNRaise: 'RAISE', hNCards: 'THE CARDS', hNPays: 'PAYS', hNPaysV: '{n} TO 1',
  hNThird: 'THIRD CARD', hNBalance: 'BALANCE',
  hCBet: 'BET', hCAmount: 'AMOUNT', hCRaise: 'RAISE', hCHalf: 'HALF RAISE', hCPass: 'PASS',
  hCRules: 'RULES', hCLeave: 'LEAVE',
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

  // ── seat HUD (readability standard) ──
  hGoal: 'Üçüncü kartın gösterilen iki kartın tam arasına düşeceğine bahis koy.',
  hRule1: 'İki kart açılır. Üçüncü kartın ikisinin tam arasına düşeceğine bahis koy.',
  hRule2: 'Aradaki kart sayısı: 1 kart 5\'e 1, 2 kart 4\'e 1, 3 kart 2\'ye 1, 4 ve üstü 1\'e 1 öder.',
  hRule3: 'Ardışık kartların arasında boşluk yoktur, berabere kalır. Üçüncü kart çiftle aynıysa üçlü olur ve 11\'e 1 öder.',
  hRule4: 'Üçlü olmayan çift berabere kalır. Üçüncü kart iki kartın dışında ya da birine eşitse bahis kaybolur.',
  hRule5: 'Fark 7 ya da üzeriyse ARTIR, üçüncü karttan önce bahsini bir kez daha (ya da yarısı kadar) ekler. ARTIRMA bahsini olduğu gibi bırakır.',
  hRule6: 'Kartlar dağıtılmadan masadan kalkarsan bahsin iade edilir.',
  hStBet: 'BAHSİNİ YAP', hStBetSub: '[{bet}] ile kilitle',
  hStLocked: 'BAHİS KİLİTLENDİ', hStLockedSub: 'Diğerleri bekleniyor',
  hStDeal: 'DAĞITILIYOR', hStConsec: 'ARDIŞIK: BOŞLUK YOK, BERABERE',
  hStPair: 'ÇİFT! ÜÇLÜ İÇİN ÜÇÜNCÜ KART', hStPairSub: 'Üçlü 11\'e 1 öder',
  hStSpread: 'FARK {n}', hStSpreadSub: 'Arasına düşerse {n}\'e 1 öder',
  hStRaise: 'ARTIR MI, ARTIRMA MI?', hStRaiseSub: 'Artırmak bahsine {n} ekler',
  hStRaiseSent: 'ARTIRMA GÖNDERİLDİ, BEKLE', hStRaiseWait: 'ARTIRMA PENCERESİ',
  hStThird: 'ÜÇÜNCÜ KART', hStShuffle: 'ALTI DESTE KARIŞTIRILIYOR',
  hResWin: 'KAZANDIN', hResLose: 'FARK DIŞINDA', hResPush: 'BERABERE', hResTrips: 'ÜÇLÜ!',
  hResConsec: 'ARDIŞIK, BERABERE', hResPairNo: 'ÇİFT, BERABERE', hResRefund: 'BAHİS İADE',
  hNBet: 'BAHİS', hNRaise: 'ARTIRMA', hNCards: 'KARTLAR', hNPays: 'ÖDER', hNPaysV: '{n}\'E 1',
  hNThird: 'ÜÇÜNCÜ KART', hNBalance: 'BAKİYE',
  hCBet: 'BAHİS', hCAmount: 'TUTAR', hCRaise: 'ARTIR', hCHalf: 'YARI ARTIR', hCPass: 'ARTIRMA',
  hCRules: 'KURALLAR', hCLeave: 'ÇIK',
};

export default { prefix: 'm.reddog.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
