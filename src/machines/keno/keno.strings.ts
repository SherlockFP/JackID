/**
 * Keno Lounge — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys register under
 * `m.keno.` (MachineBase.t adds the prefix). `{n}` / `{color}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Keno Lounge',
  desc: 'Pick up to ten numbers from eighty and buy a ticket. The relay brain draws twenty. Match enough and the lounge pays.',
  play: 'Play', submit: 'Submit', ready: 'Live', quickPick: 'Quick Pick', spots: 'Spots {n}', draws: 'Draws x{n}',
  slot: 'Slot {n}', clear: 'Clear', boardCam: 'Board cam', callSpots: 'Spots',
  ticket: 'TICKET {n}', picks: 'PICKS {n}/{s}', live: 'LIVE', empty: 'EMPTY', drawNo: 'DRAW #{n}',
  sOpen: 'Tickets open', sOpenShared: 'Sales close in {n}s', sLock: 'Sales closed', sDraw: 'The relays are drawing',
  sTally: 'Checking tickets', sPay: 'Paying out', sWait: 'Waiting for players',
  next: 'NEXT {n}', lock: 'LOCK', hit: 'HIT', hits: 'HITS {n}',
  win: 'WIN {n}', lose: 'Lost {n}', jackpot: 'JACKPOT', nearMiss: 'So close...', zeroPay: 'Zero pays {n}',
  luck: 'Lucky reroll', spare: 'Spare number {n}', hot: 'HOT {n}', cold: 'COLD {n}',
  noPicks: 'Pick at least one number', badPicks: 'Pick 1 to 10 different numbers from 1 to 80',
  badStake: 'Stake 1 to 100 per draw', badDraws: 'Choose 1, 5, 10 or 20 draws', badSlot: 'That slot is not on the ticket',
  busy: 'Sales are closed for this draw', noFunds: 'Not enough coins for this ticket', limit: 'Too many tickets',
  stake: 'Stake', pays: 'Pays', paytable: 'PAYTABLE', noHits: 'No hits', hitsOn: 'hits on {n} spots',
  drawDone: 'Draw {n}: {nums}', bigMiss: 'Board is cold', tagHit: 'HIT',
  hintPlay: 'Play', hintQuick: 'Quick Pick', hintSpots: 'Spots', hintDraws: 'Draws', hintSlot: 'Slot',
  hintCam: 'Board cam', hintClear: 'Clear', hintStake: 'Stake',
  boardLabel: 'NUMBERS 1-80', nextLabel: 'NEXT GAME',
};

const tr: Record<string, string> = {
  name: 'Keno Salonu',
  desc: 'Seksen sayıdan en fazla on tane seç ve bilet al. Röle beyni yirmi sayı çeker. Yeterince tutturursan salon öder.',
  play: 'Oyna', submit: 'Gönder', ready: 'Canlı', quickPick: 'Hızlı Seçim', spots: 'Sayı {n}', draws: 'Çekiliş x{n}',
  slot: 'Yuva {n}', clear: 'Temizle', boardCam: 'Pano kamerası', callSpots: 'Sayı',
  ticket: 'BİLET {n}', picks: 'SEÇİM {n}/{s}', live: 'CANLI', empty: 'BOŞ', drawNo: 'ÇEKİLİŞ #{n}',
  sOpen: 'Biletler açık', sOpenShared: 'Satış {n} sn sonra kapanır', sLock: 'Satış kapandı', sDraw: 'Röleler çekiliyor',
  sTally: 'Biletler kontrol ediliyor', sPay: 'Ödeme yapılıyor', sWait: 'Oyuncular bekleniyor',
  next: 'SONRAKİ {n}', lock: 'KİLİT', hit: 'İSABET', hits: 'İSABET {n}',
  win: 'KAZANÇ {n}', lose: 'Kayıp {n}', jackpot: 'BÜYÜK İKRAMİYE', nearMiss: 'Çok az kaldı...', zeroPay: 'Sıfır ödemesi {n}',
  luck: 'Şanslı yeniden çekim', spare: 'Yedek sayı {n}', hot: 'SICAK {n}', cold: 'SOĞUK {n}',
  noPicks: 'En az bir sayı seç', badPicks: '1 ile 80 arasından 1 ile 10 farklı sayı seç',
  badStake: 'Çekiliş başına 1 ile 100 arasında bahis', badDraws: '1, 5, 10 veya 20 çekiliş seç', badSlot: 'Bu yuva biletinde yok',
  busy: 'Bu çekiliş için satış kapalı', noFunds: 'Bu bilet için yeterli jeton yok', limit: 'Çok fazla bilet',
  stake: 'Bahis', pays: 'Öder', paytable: 'ÖDEME TABLOSU', noHits: 'İsabet yok', hitsOn: '{n} sayıda isabet',
  drawDone: 'Çekiliş {n}: {nums}', bigMiss: 'Pano soğuk', tagHit: 'İSABET',
  hintPlay: 'Oyna', hintQuick: 'Hızlı Seçim', hintSpots: 'Sayı', hintDraws: 'Çekiliş', hintSlot: 'Yuva',
  hintCam: 'Pano kamerası', hintClear: 'Temizle', hintStake: 'Bahis',
  boardLabel: '1-80 SAYILAR', nextLabel: 'SONRAKİ OYUN',
};

export default { prefix: 'm.keno.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
