/**
 * Sic Bo "The Birdcage" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; keys are registered
 * under `m.sicbo.` (MachineBase.t adds the prefix). `{n}` / `{a}` `{b}` `{c}` / `{t}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  // seat HUD (readability standard)
  hGoal: 'Win when the three dice land on your bet',
  hWait: 'WAITING FOR PLAYERS', hBet: 'PLACE YOUR BETS', hSecs: 'BETS CLOSE IN {n}S',
  hReady: 'READY · WAITING FOR OTHERS', hLock: 'NO MORE BETS', hRoll: 'THE CAGE IS TURNING',
  hPay: 'PAYING OUT', hClear: 'CLEARING THE LAYOUT',
  hNBet: 'YOUR CHIP', hNLayout: 'YOUR LAYOUT', hNLast: 'LAST ROLL', hNBalance: 'BALANCE',
  hCBet: 'CHIP', hCRoll: 'ROLL', hCReady: 'READY', hCClear: 'CLEAR', hCRebet: 'REPEAT', hCSingle: 'SINGLE DIE',
  hCRules: 'RULES', hCLeave: 'LEAVE',
  hTip1: 'Set your chip with {up} and {down}, then click the layout to place it.',
  hTip2: 'Press {ready} to roll when you are alone, or to ready up at a shared table.',
  hTip3: 'Press {help} for the full rules. Any key closes a card.',
  hR1: 'Three dice, total 4 to 17. Bet small (4 to 10) or big (11 to 17), odd or even, a total, or a number.',
  hR2: 'Small, big, odd and even lose when all three dice match, unless a charm returns the stake.',
  hR3: 'A single number pays once for each die that shows it. A total pays by the table: 4 and 17 pay most.',
  hR4: 'A double wins when that pair shows. A triple wins on that exact triple. Any triple wins on any triple.',
  hR5: 'Keys [{quick}] put one chip on a single number. Even money 5 to 500, singles and totals 1 to 100, triples 1 to 20.',
  hR6: 'Ready when your layout is set. The cage rolls when all bettors are ready. [{rebet}] repeats your last layout.',
  name: 'Sic Bo "The Birdcage"',
  desc: 'Three dice in a brass cage. Bet on small or big, a total, a pair, or a triple, then crank the cage and pray the dice agree with you.',
  place: 'Place', clear: 'Clear', ready: 'Ready', roll: 'Roll', rebet: 'Repeat', quick: 'Quick {n}', bet: 'Bet',
  small: 'SMALL', big: 'BIG', odd: 'ODD', even: 'EVEN', anyTriple: 'ANY TRIPLE', triple: 'TRIPLE', potLabel: 'Layout', history: 'LAST 20',
  sOpen: 'Place your bets', sOpenShared: 'Bets close in {n}s', sLock: 'No more bets', sFlip: 'The cage turns',
  sTumble: 'The dice tumble', sSettle: 'The dice settle', sLights: 'Lighting the winners', sPay: 'Paying out',
  sClear: 'Clearing the layout', sWait: 'Waiting for players',
  rolled: '{a} {b} {c}  =  {t}', rTriple: 'TRIPLE {n}!', rAny: 'ANY TRIPLE', win: '+{n}', lose: 'Lost {n}', push: 'Push',
  refund: 'Refunded', lucky: 'LUCKY REROLL', nearMiss: 'So close...', shake: 'Cage shake',
  limit: 'Table limit {n}', badSpot: 'That spot is not on the layout', busy: 'The cage is turning',
  noChips: 'Place a chip first', noFunds: 'Not enough coins for this layout', fair: 'FAIR',
};

const tr: Record<string, string> = {
  // seat HUD (readability standard)
  hGoal: 'Üç zar bahsinin tuttuğu sonucu verirse kazan',
  hWait: 'OYUNCULAR BEKLENİYOR', hBet: 'BAHİSLERİNİ KOY', hSecs: 'BAHİSLER {n} SN SONRA KAPANIR',
  hReady: 'HAZIR · DİĞERLERİ BEKLENİYOR', hLock: 'ARTIK BAHİS YOK', hRoll: 'KAFES DÖNÜYOR',
  hPay: 'ÖDEME YAPILIYOR', hClear: 'MASA TEMİZLENİYOR',
  hNBet: 'FİŞİN', hNLayout: 'DİZİLİMİN', hNLast: 'SON ATIŞ', hNBalance: 'BAKİYE',
  hCBet: 'FİŞ', hCRoll: 'AT', hCReady: 'HAZIR', hCClear: 'TEMİZLE', hCRebet: 'TEKRAR', hCSingle: 'TEK ZAR',
  hCRules: 'KURALLAR', hCLeave: 'AYRIL',
  hTip1: 'Fişini {up} ve {down} ile seç, sonra masaya tıklayarak koy.',
  hTip2: 'Yalnızsan {ready} ile zarları at; masada başkaları varsa hazır ol.',
  hTip3: '{help} ile tam kuralları gör. Her tuş kartı kapatır.',
  hR1: 'Üç zar, toplam 4 ile 17. Küçük (4-10) ya da büyük (11-17), tek ya da çift, bir toplam ya da bir sayı üzerine oyna.',
  hR2: 'Küçük, büyük, tek ve çift, üç zar da aynı geldiğinde kaybettirir; bir tılsım bahsi iade etmedikçe.',
  hR3: 'Tek sayı, o sayıyı gösteren her zar için bir kez öder. Toplam masadaki orana göre öder; 4 ve 17 en çok öder.',
  hR4: 'Çift, o çiftin gelmesiyle kazandırır. Üçlü, tam o üçlüyle kazandırır. Herhangi üçlü, her üçlüde kazandırır.',
  hR5: '[{quick}] tuşları tek bir sayıya bir fiş koyar. Eşit para 5-500; tek sayı ve toplam 1-100; üçlü 1-20.',
  hR6: 'Dizilimin hazır olunca hazır ol. Tüm bahisçiler hazır olunca kafes atar. [{rebet}] son dizilimi tekrarlar.',
  name: 'Zar Kafesi (Sic Bo)',
  desc: 'Pirinç bir kafeste üç zar. Küçük ya da büyük, toplam, çift ya da üçlü üzerine oyna; sonra kafesi çevir ve zarların sana hak vermesini umut et.',
  place: 'Koy', clear: 'Temizle', ready: 'Hazır', roll: 'At', rebet: 'Tekrarla', quick: 'Hızlı {n}', bet: 'Bahis',
  small: 'KÜÇÜK', big: 'BÜYÜK', odd: 'TEK', even: 'ÇİFT', anyTriple: 'HERHANGİ ÜÇLÜ', triple: 'ÜÇLÜ', potLabel: 'Masa', history: 'SON 20',
  sOpen: 'Bahislerini koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok', sFlip: 'Kafes dönüyor',
  sTumble: 'Zarlar yuvarlanıyor', sSettle: 'Zarlar yerleşiyor', sLights: 'Kazananlar yanıyor', sPay: 'Ödeme yapılıyor',
  sClear: 'Masa temizleniyor', sWait: 'Oyuncular bekleniyor',
  rolled: '{a} {b} {c}  =  {t}', rTriple: 'ÜÇLÜ {n}!', rAny: 'HERHANGİ ÜÇLÜ', win: '+{n}', lose: 'Kayıp {n}', push: 'Beraberlik',
  refund: 'İade edildi', lucky: 'ŞANSLI YENİDEN ATIŞ', nearMiss: 'Çok az kaldı...', shake: 'Kafes sarsıntısı',
  limit: 'Masa limiti {n}', badSpot: 'Bu alan masada yok', busy: 'Kafes dönüyor',
  noChips: 'Önce bir fiş koy', noFunds: 'Bu masa için yeterli jeton yok', fair: 'ADİL',
};

export default { prefix: 'm.sicbo.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
