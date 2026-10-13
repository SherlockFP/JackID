/**
 * Bingo "Hall of Calls" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; keys register under
 * `m.bingo.` (MachineBase.t adds the prefix). `{n}`, `{p}` and `{s}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Bingo "Hall of Calls"',
  desc: 'Buy paper cards, watch the Caller crank the cage, and daub your numbers. Complete a frame and the hall goes wild.',
  hintBuy: 'Buy', hintReady: 'Ready', hintCards: 'Cards', hintExtra: 'Extra ball', hintDecline: 'Decline',
  hintCam: 'Caller cam', hintChip: 'Chip', hintLeave: 'Leave',
  sBuy: 'Buy window {n}s', sBuyOpen: 'Buy your cards', sLock: 'Cage spinning', sCall: 'Calling {n}/40',
  sOffer: 'Extra ball offer {n}s', sAward: 'Paying out', sWait: 'Waiting for players', sIdle: 'Hall closed',
  cards: 'Cards {n}', stake: 'Stake {n}', total: 'Total {n}', ballNo: 'Ball {n}', balls: 'Balls',
  offerTitle: 'EXTRA BALL', offerBody: 'Price {n} · completes {p}', offerPeek: 'Next ball: {n}', peeked: 'Peek used',
  noCards: 'Buy at least one card', busy: 'The hall is busy', noFunds: 'Not enough chips', badStake: 'Stake must be 2 to 50',
  badCount: 'Invalid card count', already: 'You already have cards', offerGone: 'Offer closed',
  boughtExtra: 'Extra ball bought for {n}', declined: 'Declined', cardCount: 'Cards to buy: {n}',
  win: 'WIN {n}', jackpot: 'FRAME! {n}', oneToGo: 'ONE TO GO', shout: 'Pattern!',
  pLine: 'LINE', pCorners: 'CORNERS', pDouble: 'DOUBLE LINE', pTriple: 'TRIPLE LINE', pX: 'X', pFrame: 'FRAME', pNone: 'NO PATTERN',
  legend: 'LINE x0.8 · CORNERS x1.5 · DOUBLE x2.5 · TRIPLE x10 · X x30 · FRAME x250',
  hdr: 'B  I  N  G  O', free: 'FREE', header: 'BINGO', statusLbl: 'Status', cardsLbl: 'Cards',
};

const tr: Record<string, string> = {
  name: 'Tombala Salonu (Bingo)',
  desc: 'Kağıt kartları al, Sunucunun kafesi çevirişini izle ve sayılarını işaretle. Bir çerçeve tamamlanınca salon ayağa kalkar.',
  hintBuy: 'Al', hintReady: 'Hazır', hintCards: 'Kart', hintExtra: 'Ekstra top', hintDecline: 'Reddet',
  hintCam: 'Sunucu kamerası', hintChip: 'Jeton', hintLeave: 'Ayrıl',
  sBuy: 'Alım penceresi {n}sn', sBuyOpen: 'Kartlarını al', sLock: 'Kafes dönüyor', sCall: 'Çekiliş {n}/40',
  sOffer: 'Ekstra top teklifi {n}sn', sAward: 'Ödeniyor', sWait: 'Oyuncular bekleniyor', sIdle: 'Salon kapalı',
  cards: 'Kart {n}', stake: 'Bahis {n}', total: 'Toplam {n}', ballNo: 'Top {n}', balls: 'Top',
  offerTitle: 'EKSTRA TOP', offerBody: 'Fiyat {n} · tamamlar {p}', offerPeek: 'Sıradaki top: {n}', peeked: 'Gözetleme kullanıldı',
  noCards: 'En az bir kart al', busy: 'Salon meşgul', noFunds: 'Yeterli jeton yok', badStake: 'Bahis 2 ile 50 arasında olmalı',
  badCount: 'Geçersiz kart sayısı', already: 'Zaten kartın var', offerGone: 'Teklif kapandı',
  boughtExtra: 'Ekstra top alındı: {n}', declined: 'Reddedildi', cardCount: 'Alınacak kart: {n}',
  win: 'KAZANÇ {n}', jackpot: 'ÇERÇEVE! {n}', oneToGo: 'BİR KALDI', shout: 'Desen!',
  pLine: 'ÇİZGİ', pCorners: 'KÖŞELER', pDouble: 'ÇİFT ÇİZGİ', pTriple: 'ÜÇLÜ ÇİZGİ', pX: 'X', pFrame: 'ÇERÇEVE', pNone: 'DESEN YOK',
  legend: 'ÇİZGİ x0.8 · KÖŞELER x1.5 · ÇİFT x2.5 · ÜÇLÜ x10 · X x30 · ÇERÇEVE x250',
  hdr: 'B  I  N  G  O', free: 'BEDAVA', header: 'TOMBALA', statusLbl: 'Durum', cardsLbl: 'Kart',
};

export default { prefix: 'm.bingo.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
