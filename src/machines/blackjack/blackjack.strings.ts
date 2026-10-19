/**
 * Blackjack — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.blackjack.` (MachineBase.t adds the prefix). `{n}` / `{pot}` placeholders are filled by `t(key, vars)`.
 * Seat HUD copy (goal, banners, buttons, rules card) lives here too; the shared chrome is in `_base/seatHud.strings.ts`.
 */
const en: Record<string, string> = {
  name: 'Blackjack "Twenty-One"',
  desc: 'Beat the dealer to 21. Blackjack pays 3 to 2, the dealer draws to 17. Twin Souls pays on a matching first pair.',
  hit: 'HIT', stand: 'STAND', double: 'DOUBLE', split: 'SPLIT', surrender: 'SURRENDER',
  insurance: 'INSURANCE', even: 'EVEN MONEY', decline: 'NO', take: 'TAKE',
  ready: 'READY', deal: 'DEAL', bet: 'BET', side: 'TWIN SOULS', bot: 'Undertaker',
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
  tagBet: 'BET', tagBj: 'BJ', tagBust: 'BUST', tagWait: '-',

  // ── seat HUD (readability standard) ─────────────────────────────────────────────────────────
  goal: 'Beat the dealer without going over 21',
  stBet: 'PLACE YOUR BET', stReady: 'WAITING FOR OTHERS', stDeal: 'DEALING', stIns: 'INSURANCE?',
  stInsEven: 'EVEN MONEY? 1 TO 1 NOW', stInsOffer: 'PAYS 2:1 IF DEALER HAS BJ ({pct}% CHANCE) · COSTS {n}',
  stTurn: 'YOUR TURN', stTurnOdds: 'HIT BUSTS {pct}% · STAND ON {total}', stOther: 'ANOTHER PLAYER\'S TURN', stDealerPlays: 'DEALER PLAYS',
  stPayout: 'PAYING OUT', stEnd: 'ROUND OVER', stShuffle: 'SHUFFLING', stSecs: '{n}s',
  nBet: 'BET', nSide: 'TWIN SOULS', nBalance: 'BALANCE', nHand: 'YOUR HAND',
  nDealer: 'DEALER', nDealerHole: 'DEALER · HOLE CARD DOWN', nIns: 'INSURANCE', nShowing: '{n}',
  nHidden: '{n} + ?', nBust: 'BUST', nBjShort: 'BLACKJACK',
  cReady: 'READY', cBet: 'BET', cSide: 'TWIN SOULS', cLeave: 'LEAVE', cRules: 'RULES',
  cEvenMoney: 'EVEN MONEY', cInsure: 'INSURE', cNoIns: 'NO',
  rule1: 'Hands total their cards. Aces count 1 or 11, face cards count 10.',
  rule2: 'Blackjack (ace + ten-value card) pays 3 to 2. A tie returns your bet.',
  rule3: 'The dealer draws to 17 and stands on all 17s. Over 21 is a bust.',
  rule4: 'HIT takes a card. STAND keeps your hand. DOUBLE takes one card for twice the bet.',
  rule5: 'SPLIT a pair into two hands. SURRENDER gives back half your bet.',
  rule6: 'Insurance pays 2 to 1 if the dealer has blackjack. Twin Souls pays on a matching first pair.',
};

const tr: Record<string, string> = {
  name: 'Blackjack (Yirmi Bir)',
  desc: 'Krupiyeyi 21\'e yaklaş. Blackjack 3\'e 2 öder, krupiye 17\'ye kadar çeker. İkiz Ruhlar ilk çiftte öder.',
  hit: 'KART', stand: 'DUR', double: 'İKİYE KAT', split: 'AYIR', surrender: 'TESLİM',
  insurance: 'SİGORTA', even: 'EŞİT PARA', decline: 'HAYIR', take: 'AL',
  ready: 'HAZIR', deal: 'DAĞIT', bet: 'BAHİS', side: 'İKİZ RUHLAR', bot: 'Müteahhit',
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
  tagBet: 'BAHİS', tagBj: 'BJ', tagBust: 'BATTI', tagWait: '-',

  // ── seat HUD (readability standard) ─────────────────────────────────────────────────────────
  goal: 'Krupiyeyi 21\'i geçmeden yenmeye çalış',
  stBet: 'BAHSİNİ KOY', stReady: 'DİĞERLERİ BEKLENİYOR', stDeal: 'KARTLAR DAĞITILIYOR', stIns: 'SİGORTA?',
  stInsEven: 'EŞİT PARA? ŞİMDİ 1\'E 1', stInsOffer: 'KRUPİYEDE BJ VARSA 2\'YE 1 ({pct}% ŞANS) · BEDEL {n}',
  stTurn: 'SIRA SENDE', stTurnOdds: 'KART ÇEKMEK {pct}% PATLATIR · ELİN {total}', stOther: 'BAŞKA OYUNCUNUN SIRASI', stDealerPlays: 'KRUPİYE OYNUYOR',
  stPayout: 'ÖDEMELER YAPILIYOR', stEnd: 'EL BİTTİ', stShuffle: 'KARIŞTIRILIYOR', stSecs: '{n} sn',
  nBet: 'BAHİS', nSide: 'İKİZ RUHLAR', nBalance: 'BAKİYE', nHand: 'SENİN ELİN',
  nDealer: 'KRUPİYE', nDealerHole: 'KRUPİYE · KAPALI KART', nIns: 'SİGORTA', nShowing: '{n}',
  nHidden: '{n} + ?', nBust: 'BATTI', nBjShort: 'BLACKJACK',
  cReady: 'HAZIR', cBet: 'BAHİS', cSide: 'İKİZ RUHLAR', cLeave: 'ÇIK', cRules: 'KURALLAR',
  cEvenMoney: 'EŞİT PARA', cInsure: 'SİGORTA AL', cNoIns: 'HAYIR',
  rule1: 'Eller kartlarının toplamıdır. As 1 ya da 11, resimli kartlar 10 sayar.',
  rule2: 'Blackjack (as + 10 değerli kart) 3\'e 2 öder. Berabere kalınca bahis iade.',
  rule3: 'Krupiye 17\'ye kadar çeker, tüm 17\'lerde durur. 21\'i geçerse batar.',
  rule4: 'KART bir kart alır. DUR elini korur. İKİYE KAT tek kart alır, bahsi ikiye katlar.',
  rule5: 'AYIR bir çifti iki ele böler. TESLİM bahsinin yarısını geri verir.',
  rule6: 'Sigorta krupiyede blackjack varsa 2\'ye 1 öder. İkiz Ruhlar ilk çiftte öder.',
};

export default { prefix: 'm.blackjack.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
