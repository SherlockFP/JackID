/**
 * Lotto Ball Blower — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; keys register under
 * `m.lottoblower.` (MachineBase.t adds the prefix). `{n}` / `{nums}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Lotto Ball Blower',
  desc: 'Pick five numbers from thirty and a Moon from eight. The blower breathes out five balls and a Moon. Match them all for the jackpot.',
  draw: 'Draw', quick: 'Quick Pick', add: 'Add line', batch: 'Batch x{n}', clear: 'Clear', cam: 'Sphere cam',
  line: 'LINE {n}', lines: 'LINES {n}/{m}', pick: 'PICK {n}/5', moon: 'MOON {n}', noMoon: 'MOON -',
  ticket: 'TICKET', live: 'LIVE', empty: 'EMPTY', drawNo: 'DRAW #{n}', jackpotLbl: 'JACKPOT {n}',
  sOpen: 'Sales open', sOpenShared: 'Sales close in {n}s', sLock: 'Sales closed', sBlow: 'The breath rises',
  sDraw: 'Ball {n} of 5', sMoon: 'The Moon ball', sPay: 'Paying out', sIdle: 'Waiting for lines',
  lastDraw: 'LAST {nums}', winners: 'WINNERS', peek: 'MOON PEEK {n}', closing: 'CLOSE',
  jackpot: 'JACKPOT', win: 'WIN {n}', lose: 'Lost {n}', refund: 'Refund {n}', nearMiss: 'So close...',
  zeroPay: 'No hits', hit: 'HIT', hits: 'HITS {n}', luck: 'Lucky refund', lucky: 'Lucky reroll',
  noPicks: 'Pick five different numbers from 1 to 30', noMoonPick: 'Pick a Moon from 1 to 8', noLines: 'Add at least one line',
  badLine: 'Each line is five numbers from 1 to 30 and a Moon from 1 to 8', badBet: 'Line price 5 to 100 coins',
  busy: 'Sales are closed for this draw', noFunds: 'Not enough coins for these lines', limit: 'Up to 20 lines per draw',
  stake: 'Stake', pays: 'Pays', paytable: 'PAYTABLE', drawDone: 'Draw {n}: {nums}', tagHit: 'HIT',
  hintDraw: 'Draw', hintQuick: 'Quick Pick', hintAdd: 'Add line', hintBatch: 'Batch', hintClear: 'Clear',
  hintCam: 'Sphere cam', hintBatchSize: 'Batch size', hintMoon: 'Moon',
  boardLabel: 'NUMBERS 1-30 / MOON 1-8', winnersLabel: 'WINNERS', lineLabel: 'LINES',
  pullLabel: 'DRAW', lineFull: 'Line full',
};

const tr: Record<string, string> = {
  name: 'Loto Küresi',
  desc: 'Otuz sayıdan beş sayı ve sekizden bir Ay seç. Küre beş top ile bir Ay topu üfler. Hepsini tutturursan büyük ikramiye senin.',
  draw: 'Çek', quick: 'Hızlı Seçim', add: 'Satır ekle', batch: 'Toplu x{n}', clear: 'Temizle', cam: 'Küre kamerası',
  line: 'SATIR {n}', lines: 'SATIR {n}/{m}', pick: 'SEÇİM {n}/5', moon: 'AY {n}', noMoon: 'AY -',
  ticket: 'BİLET', live: 'CANLI', empty: 'BOŞ', drawNo: 'ÇEKİLİŞ #{n}', jackpotLbl: 'BÜYÜK İKRAMİYE {n}',
  sOpen: 'Satış açık', sOpenShared: 'Satış {n} sn sonra kapanır', sLock: 'Satış kapandı', sBlow: 'Nefes yükseliyor',
  sDraw: 'Top {n} / 5', sMoon: 'Ay topu', sPay: 'Ödeme yapılıyor', sIdle: 'Satır bekleniyor',
  lastDraw: 'SON {nums}', winners: 'KAZANANLAR', peek: 'AY GÖZETLEME {n}', closing: 'KAPANIŞ',
  jackpot: 'BÜYÜK İKRAMİYE', win: 'KAZANÇ {n}', lose: 'Kayıp {n}', refund: 'İade {n}', nearMiss: 'Çok az kaldı...',
  zeroPay: 'İsabet yok', hit: 'İSABET', hits: 'İSABET {n}', luck: 'Şanslı iade', lucky: 'Şanslı yeniden çekim',
  noPicks: '1 ile 30 arasından beş farklı sayı seç', noMoonPick: '1 ile 8 arasından bir Ay seç', noLines: 'En az bir satır ekle',
  badLine: 'Her satır 1 ile 30 arası beş sayı ve 1 ile 8 arası bir Aydan oluşur', badBet: 'Satır bedeli 5 ile 100 jeton arası',
  busy: 'Bu çekiliş için satış kapalı', noFunds: 'Bu satırlar için yeterli jeton yok', limit: 'Çekiliş başına en fazla 20 satır',
  stake: 'Bahis', pays: 'Öder', paytable: 'ÖDEME TABLOSU', drawDone: 'Çekiliş {n}: {nums}', tagHit: 'İSABET',
  hintDraw: 'Çek', hintQuick: 'Hızlı Seçim', hintAdd: 'Satır ekle', hintBatch: 'Toplu', hintClear: 'Temizle',
  hintCam: 'Küre kamerası', hintBatchSize: 'Toplu boyutu', hintMoon: 'Ay',
  boardLabel: 'SAYILAR 1-30 / AY 1-8', winnersLabel: 'KAZANANLAR', lineLabel: 'SATIRLAR',
  pullLabel: 'ÇEK', lineFull: 'Satır dolu',
};

export default { prefix: 'm.lottoblower.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
