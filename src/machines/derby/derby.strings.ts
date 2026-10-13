/**
 * Rat Derby "The Rat Run" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are
 * registered under `m.derby.` (MachineBase.t adds the prefix). `{n}`, `{a}`, `{b}`, `{c}`, `{rat}` are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Rat Derby "The Rat Run"',
  desc: 'Six clockwork rats, one glass track. Back a rat to win or place, or call the exacta. The Accountant always runs last.',
  rat1: 'Gutter Saint', rat2: 'Brass Tooth', rat3: 'Little Arson', rat4: "Widow's Pet", rat5: 'Drainpipe',
  rat6: 'The Accountant', rat7: 'The Albino',
  win: 'Win', place: 'Place', exacta: 'Exacta', quinella: 'Quinella',
  ready: 'Ready', placeBet: 'Place bet', clear: 'Clear', pick: 'Pick', second: 'Second',
  sOdds: 'Tote is up', sOpen: 'Place your bets', sOpenShared: 'Bets close in {n}s', sLock: 'No more bets',
  sGates: 'Gates loading', sRace: 'They are off!', sPhoto: 'Photo finish', sResult: 'Result {a}-{b}-{c}',
  sPay: 'Paying out', sReset: 'Rats wound back', sWait: 'Waiting for players',
  tWin: 'W', tPlace: 'P', tResult: 'RESULT', toteOdds: 'TOTE', toteLast: 'LAST 10', tPhoto: 'PHOTO', tNext: 'NEXT RACE',
  marquee: 'NEXT RACE', winNum: 'Rat {n} wins', noWinner: 'No bets on this race',
  win2: 'WIN {n}', lose: 'Lost {n}', deadHeat: 'DEAD HEAT', refund: 'Exacta refunded', nearMiss: 'Photo-close...',
  longshot: 'LONGSHOT', albino: 'The Albino joins the race', refundLuck: 'Luck: stake refunded',
  rerollLuck: 'Luck: the stewards re-run the race',
  peekLast: 'Rail spy: {rat} finishes last', potLabel: 'Stake', slip: 'Slip', odds: 'Odds {n}',
  badPick: 'Pick a rat first', pickTwo: 'Pick two rats for this bet', badRat: 'No such rat', badType: 'Unknown bet',
  limit: 'Each bet is 1 to 200 coins', raceLimit: '1,000 coins per seat per race', busy: 'The race is on', noFunds: 'Not enough coins for this bet',
  noBets: 'Place a bet first', tooMany: 'Too many bets on this race', hintRats: 'Rats', hintType: 'Bet type',
  hintPlace: 'Place bet', hintRules: 'Rules',
};

const tr: Record<string, string> = {
  name: 'Fare Derbisi "Sıçan Koşusu"',
  desc: 'Altı mekanik sıçan, bir cam pist. Birine kazanç ya da yer bahsi koy, ya da ikili tahmin et. Muhasebeci hep sonda koşar.',
  rat1: 'Oluk Azizi', rat2: 'Pirinç Diş', rat3: 'Küçük Yangın', rat4: 'Dul\'un Evcili', rat5: 'Oluk Borusu',
  rat6: 'Muhasebeci', rat7: 'Albino',
  win: 'Kazanç', place: 'Yer', exacta: 'İkili', quinella: 'İkili Karışık',
  ready: 'Hazır', placeBet: 'Bahis koy', clear: 'Temizle', pick: 'Seç', second: 'İkinci',
  sOdds: 'Tahta yukarıda', sOpen: 'Bahislerini koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok',
  sGates: 'Kapılar yükleniyor', sRace: 'Yarış başladı!', sPhoto: 'Fotoğraf bitişi', sResult: 'Sonuç {a}-{b}-{c}',
  sPay: 'Ödeme yapılıyor', sReset: 'Sıçanlar geri sarıldı', sWait: 'Oyuncular bekleniyor',
  tWin: 'K', tPlace: 'Y', tResult: 'SONUÇ', toteOdds: 'TAHTA', toteLast: 'SON 10', tPhoto: 'FOTO', tNext: 'SONRAKİ YARIŞ',
  marquee: 'SONRAKİ YARIŞ', winNum: '{n} numara kazandı', noWinner: 'Bu yarışa bahis yok',
  win2: 'KAZANÇ {n}', lose: 'Kayıp {n}', deadHeat: 'BERABERE', refund: 'İkili iade', nearMiss: 'Fotoğrafa çok az kaldı...',
  longshot: 'UZUN ATIŞ', albino: 'Albino yarışa katıldı', refundLuck: 'Şans: bahis iade edildi',
  rerollLuck: 'Şans: hakemler yarışı tekrarladı',
  peekLast: 'Ray casusu: {rat} en sonda bitirecek', potLabel: 'Bahis', slip: 'Fiş', odds: 'Oran {n}',
  badPick: 'Önce bir sıçan seç', pickTwo: 'Bu bahis için iki sıçan seç', badRat: 'Böyle bir sıçan yok', badType: 'Bilinmeyen bahis',
  limit: 'Her bahis 1 ile 200 jeton', raceLimit: 'Yarış başına koltuk başı 1.000 jeton', busy: 'Yarış sürüyor', noFunds: 'Bu bahis için yeterli jeton yok',
  noBets: 'Önce bir bahis koy', tooMany: 'Bu yarışta çok fazla bahis var', hintRats: 'Sıçanlar', hintType: 'Bahis türü',
  hintPlace: 'Bahis koy', hintRules: 'Kurallar',
};

export const STRINGS = { en, tr };
export default { prefix: 'm.derby.', en, tr };
