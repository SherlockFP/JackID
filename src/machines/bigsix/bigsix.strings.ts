/**
 * Big Six Money Wheel — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.bigsix.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Big Six "The Six-Score Wheel"',
  desc: 'Back a symbol on the wall wheel. The flapper picks a segment and that symbol pays. HOUSE takes every bet, and the eye closes.',
  spin: 'Pull', ready: 'Ready', clear: 'Clear', rebet: 'Repeat', nudge: 'Ratchet', pull: 'Pull handle',
  symEye: 'EYE', symHouse: 'HOUSE',
  sOpen: 'Back a symbol', sOpenShared: 'Bets close in {n}s', sLock: 'No more bets',
  sSpin: 'The flapper is spinning', sSettle: 'Wheel slowing', sPay: 'Paying out', sClear: 'Clearing the counter',
  sWait: 'Waiting for players',
  win: 'WIN {n}', lose: 'Lost {n}', push: 'PUSH {n}', house: 'HOUSE takes it', eyeWin: 'THE EYE OPENS {n}',
  stopped: 'Stopped on {s}', pot: 'COUNTER {n}', potLabel: 'Counter', last: 'LAST 12',
  noChips: 'Back a symbol first', badSpot: 'That symbol is not on the counter',
  limit: 'Limit {n}', busy: 'The wheel is busy', noFunds: 'Not enough coins for this bet',
  ratchetOn: 'Ratchet armed: 25 % of your stake', ratchetNone: 'Back a symbol to use the Ratchet',
  ratchetLocked: 'The Ratchet is only for the owner', ratchetPaid: 'Ratchet nudged the wheel',
  mult: 'x2 SEGMENT', creep: 'Creeps onto {s}', nearMiss: 'So close...',
  peekOne: 'The next result is a 1', peekNotOne: 'The next result is not a 1',
  fair: 'FAIR', bell: 'NO MORE BETS', rim: 'MARQUEE',
  hintQuick: 'Quick bet',
  // seat HUD (readability standard)
  hGoal: 'Back the symbol the flapper stops on. HOUSE takes every bet',
  hWait: 'WAITING FOR PLAYERS', hBet: 'BACK A SYMBOL', hSecs: 'BETS CLOSE IN {n}S',
  hReady: 'READY · WAITING FOR OTHERS', hLock: 'NO MORE BETS', hSpin: 'THE FLAPPER IS SPINNING',
  hPay: 'PAYING OUT', hClear: 'CLEARING THE COUNTER',
  hNBet: 'YOUR CHIP', hNCounter: 'YOUR COUNTER', hNLast: 'LAST STOP', hNX2: 'DOUBLE ON',
  hNRatchet: 'RATCHET', hRatchetOn: 'ARMED', hRatchetOff: 'OFF', hNBalance: 'BALANCE',
  hCBet: 'CHIP', hCSym: 'BACK SYMBOL', hCPull: 'PULL', hCReady: 'READY', hCClear: 'CLEAR',
  hCRebet: 'REPEAT', hCNudge: 'RATCHET', hCRules: 'RULES', hCLeave: 'LEAVE',
  hTip1: 'Set your chip with {up} and {down}, then press {syms} to back a symbol.',
  hTip2: 'Press {pull} to pull the handle. At a shared table it readies you up.',
  hTip3: 'Press {help} for the full rules and payouts. Any key closes a card.',
  hR1: 'The flapper stops on one of 54 segments. Back 1, 3, 6, 12, 25 or EYE on the counter.',
  hR2: 'Pays 1 to 1 on 1, 3 to 1 on 3, 6, 12, 25 to 1, and 50 to 1 on the EYE. A win returns your stake too.',
  hR3: 'HOUSE beats every bet: the stake is lost and the eye closes.',
  hR4: 'Shared table: bets close when the timer runs out or every bettor is ready. Alone, pull once ready.',
  hR5: 'With the Golden Ratchet, [{nudge}] pays 25% of your stake to nudge the wheel toward your symbol.',
  hR6: 'Limits: 1 to 200 per symbol, 1000 per player in total. [{rebet}] repeats your last layout.',
};

const tr: Record<string, string> = {
  name: 'Büyük Altı Para Çarkı',
  desc: 'Duvardaki çarka bir sembol koy. Tırnak bir segment seçer ve o sembol öder. KASA herkesin bahsini alır, göz kapanır.',
  spin: 'Çek', ready: 'Hazır', clear: 'Temizle', rebet: 'Tekrarla', nudge: 'Cırcır', pull: 'Kolu çek',
  symEye: 'GÖZ', symHouse: 'KASA',
  sOpen: 'Bir sembole bahis koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok',
  sSpin: 'Tırnak dönüyor', sSettle: 'Çark yavaşlıyor', sPay: 'Ödeme yapılıyor', sClear: 'Tezgâh temizleniyor',
  sWait: 'Oyuncular bekleniyor',
  win: 'KAZANÇ {n}', lose: 'Kayıp {n}', push: 'İADE {n}', house: 'KASA alıyor', eyeWin: 'GÖZ AÇILDI {n}',
  stopped: 'Durdu: {s}', pot: 'TEZGÂH {n}', potLabel: 'Tezgâh', last: 'SON 12',
  noChips: 'Önce bir sembole bahis koy', badSpot: 'Bu sembol tezgâhta yok',
  limit: 'Limit {n}', busy: 'Çark meşgul', noFunds: 'Bu bahis için yeterli jeton yok',
  ratchetOn: 'Cırcır hazır: bahsinin %25\'i', ratchetNone: 'Cırcırı kullanmak için bahis koy',
  ratchetLocked: 'Cırcır yalnızca sahibine ait', ratchetPaid: 'Cırcır çarkı döndürdü',
  mult: 'x2 SEGMENT', creep: '{s} üzerine kaydı', nearMiss: 'Çok az kaldı...',
  peekOne: 'Sonraki sonuç 1', peekNotOne: 'Sonraki sonuç 1 değil',
  fair: 'ADİL', bell: 'ARTIK BAHİS YOK', rim: 'ÇERÇEVE',
  hintQuick: 'Hızlı bahis',
  // seat HUD (readability standard)
  hGoal: 'Tırnağın duracağı sembole bahis koy. KASA tüm bahisleri alır',
  hWait: 'OYUNCULAR BEKLENİYOR', hBet: 'BİR SEMBOLE BAHİS KOY', hSecs: 'BAHİSLER {n} SN SONRA KAPANIR',
  hReady: 'HAZIR · DİĞERLERİ BEKLENİYOR', hLock: 'ARTIK BAHİS YOK', hSpin: 'TIRNAK DÖNÜYOR',
  hPay: 'ÖDEME YAPILIYOR', hClear: 'TEZGÂH TEMİZLENİYOR',
  hNBet: 'FİŞİN', hNCounter: 'TEZGÂHIN', hNLast: 'SON DURUŞ', hNX2: 'ÇİFT ÖDEME',
  hNRatchet: 'CIRCIR', hRatchetOn: 'HAZIR', hRatchetOff: 'KAPALI', hNBalance: 'BAKİYE',
  hCBet: 'FİŞ', hCSym: 'SEMBOL KOY', hCPull: 'ÇEK', hCReady: 'HAZIR', hCClear: 'TEMİZLE',
  hCRebet: 'TEKRAR', hCNudge: 'CIRCIR', hCRules: 'KURALLAR', hCLeave: 'AYRIL',
  hTip1: 'Fişini {up} ve {down} ile seç, sonra {syms} tuşlarıyla bir sembole koy.',
  hTip2: '{pull} ile kolu çek. Ortak masada bu tuş seni hazır yapar.',
  hTip3: '{help} ile tam kuralları ve ödemeleri gör. Her tuş kartı kapatır.',
  hR1: 'Tırnak 54 segmentin birinde durur. Tezgâha 1, 3, 6, 12, 25 ya da GÖZ bahsi koy.',
  hR2: '1\'e 1, 3, 6, 12 ve 25\'e katları, GÖZ\'e 50\'ye 1 öder. Kazanınca bahsin de geri gelir.',
  hR3: 'KASA tüm bahisleri yener: bahsin kaybolur ve göz kapanır.',
  hR4: 'Ortak masada bahisler süre dolunca ya da herkes hazır olunca kapanır. Yalnızsan hazır olunca çek.',
  hR5: 'Altın Cırcır ile [{nudge}] bahsinin %25\'ini öder ve çarkı sembolüne doğru bir adım iter.',
  hR6: 'Limitler: sembol başına 1-200, oyuncu başına toplam 1000. [{rebet}] son dizilimi tekrarlar.',
};

export default { prefix: 'm.bigsix.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
