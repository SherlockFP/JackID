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
};

const tr: Record<string, string> = {
  name: 'Büyük Altı Para Çarkı',
  desc: 'Duvardaki çarka bir sembol koy. Tırnak bir segment seçer ve o sembol öder. EV herkesin bahsini alır, göz kapanır.',
  spin: 'Çek', ready: 'Hazır', clear: 'Temizle', rebet: 'Tekrarla', nudge: 'Cırcır', pull: 'Kolu çek',
  symEye: 'GÖZ', symHouse: 'EV',
  sOpen: 'Bir sembole bahis koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok',
  sSpin: 'Tırnak dönüyor', sSettle: 'Çark yavaşlıyor', sPay: 'Ödeme yapılıyor', sClear: 'Tezgâh temizleniyor',
  sWait: 'Oyuncular bekleniyor',
  win: 'KAZANÇ {n}', lose: 'Kayıp {n}', push: 'İADE {n}', house: 'EV alıyor', eyeWin: 'GÖZ AÇILDI {n}',
  stopped: 'Durdu: {s}', pot: 'TEZGÂH {n}', potLabel: 'Tezgâh', last: 'SON 12',
  noChips: 'Önce bir sembole bahis koy', badSpot: 'Bu sembol tezgâhta yok',
  limit: 'Limit {n}', busy: 'Çark meşgul', noFunds: 'Bu bahis için yeterli jeton yok',
  ratchetOn: 'Cırcır hazır: bahsinin %25\'i', ratchetNone: 'Cırcırı kullanmak için bahis koy',
  ratchetLocked: 'Cırcır yalnızca sahibine ait', ratchetPaid: 'Cırcır çarkı döndürdü',
  mult: 'x2 SEGMENT', creep: '{s} üzerine kaydı', nearMiss: 'Çok az kaldı...',
  peekOne: 'Sonraki sonuç 1', peekNotOne: 'Sonraki sonuç 1 değil',
  fair: 'ADİL', bell: 'ARTIK BAHİS YOK', rim: 'ÇERÇEVE',
  hintQuick: 'Hızlı bahis',
};

export default { prefix: 'm.bigsix.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
