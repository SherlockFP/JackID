/**
 * Dice Tower "Zar Kulesi" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; keys are registered
 * under `m.dicetower.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`. `lay.*` keys are printed on the felt.
 */
const en: Record<string, string> = {
  name: 'Dice Tower',
  desc: 'A walnut tower on a purple felt table. Put chips on the spot you like, the shooter drops two dice, and the whole table watches the roll.',
  'lay.under': 'UNDER 7', 'lay.over': 'OVER 7', 'lay.lucky7': 'LUCKY 7', 'lay.doubles': 'DOUBLES', 'lay.field': 'FIELD',
  'lay.corners': 'CORNERS', 'lay.exact': 'EXACT {n}',
  sIdle: 'The tower ticks quietly. Sit down to play.', sBet: 'Place your chips', sBetWait: 'Waiting for the others',
  sLock: 'Bets locked', sShooter: 'Shooter: {n}', sYou: 'Your drop: press Space', sRoll: 'Dice in the air',
  sResult: 'Total {n}', sDoubles: 'DOUBLES!', sSnake: 'SNAKE EYES', sBoxcars: 'BOXCARS', sSettle: 'Paying out',
  hReady: 'Ready', hDrop: 'Drop', hRepeat: 'Repeat', hClear: 'Clear', hChip: 'Chip', hRules: 'Rules',
  shooterYou: 'You shoot', bot: 'Regular',
  win: 'WIN {n}', lose: 'Lost {n}', refund: 'Lucky Chip returns {n}', ride: 'RIDE {n}', paid: 'PARLAY {n}',
  noFunds: 'Not enough coins for this bet', closed: 'Bets are closed for this roll', spotMax: 'That spot is full',
  spotsMax: 'Four spots at most per roll', badSpot: 'That spot is not on the felt', riding: 'That spot is riding',
  notShooter: 'Only the shooter drops', nothing: 'Nothing to repeat', notSeated: 'Sit down first', busy: 'Dice are in the air',
  rulesTitle: 'Dice Tower: rules',
  rule1: 'Chips come in multiples of 2, up to 200 per spot and four spots per roll. Bets lock when the dice are dropped.',
  rule2: 'UNDER 7 and OVER 7 pay 1:1; a 7 returns half. LUCKY 7 pays 9:2. DOUBLES pays 9:2 on any pair.',
  rule3: 'FIELD pays 1:1 on 3, 4, 9, 10, 11 and 2:1 on 2 and 12. CORNERS pays 15:1 on 2 or 12.',
  rule4: 'EXACT pays on one total: 31:1 on 2 and 12, 15:1 on 3 and 11, 10:1 on 4 and 10, 7:1 on 5 and 9, 11:2 on 6 and 8.',
  rulesOk: 'OK',
  pot: 'Stake', fair: 'FAIR', last12: 'LAST 12', seed: 'SEED {n}', boardBet: 'BET', boardRoll: 'ROLL',
};

const tr: Record<string, string> = {
  name: 'Zar Kulesi',
  desc: 'Mor çuha masada ceviz bir kule. İstediğin alana fiş koy, atıcı iki zarı bırakır ve bütün masa atışı izler.',
  'lay.under': 'YEDİ ALTI', 'lay.over': 'YEDİ ÜSTÜ', 'lay.lucky7': 'ŞANSLI YEDİ', 'lay.doubles': 'ÇİFTLER', 'lay.field': 'SAHA',
  'lay.corners': 'KÖŞELER', 'lay.exact': 'TAM {n}',
  sIdle: 'Kule sessiz tıkırdıyor. Oynamak için otur.', sBet: 'Fişlerini koy', sBetWait: 'Diğerleri bekleniyor',
  sLock: 'Bahisler kapandı', sShooter: 'Atıcı: {n}', sYou: 'Senin atışın: Boşluk’a bas', sRoll: 'Zarlar havada',
  sResult: 'Toplam {n}', sDoubles: 'ÇİFTLER!', sSnake: 'YILAN GÖZLERİ', sBoxcars: 'KUTU ARABALAR', sSettle: 'Ödeniyor',
  hReady: 'Hazır', hDrop: 'Bırak', hRepeat: 'Tekrarla', hClear: 'Temizle', hChip: 'Fiş', hRules: 'Kurallar',
  shooterYou: 'Sen atıyorsun', bot: 'Müdavim',
  win: 'KAZANÇ {n}', lose: 'Kayıp {n}', refund: 'Şanslı Fiş iadesi {n}', ride: 'DEVAM {n}', paid: 'PARLAY {n}',
  noFunds: 'Bu bahis için yeterli jeton yok', closed: 'Bu atış için bahisler kapandı', spotMax: 'Bu alan dolu',
  spotsMax: 'Atış başına en çok dört alan', badSpot: 'Bu alan masada yok', riding: 'Bu alan devam ediyor',
  notShooter: 'Yalnızca atıcı bırakabilir', nothing: 'Tekrarlanacak bahis yok', notSeated: 'Önce otur', busy: 'Zarlar havada',
  rulesTitle: 'Zar Kulesi: kurallar',
  rule1: 'Fişler 2’nin katı, alan başına en çok 200, atış başına en çok dört alan. Zar bırakılınca bahisler kilitlenir.',
  rule2: 'YEDİ ALTI ve YEDİ ÜSTÜ 1:1 öder; 7 gelirse yarısı iade. ŞANSLI YEDİ 9:2. ÇİFTLER her çiftte 9:2.',
  rule3: 'SAHA 3, 4, 9, 10, 11’de 1:1; 2 ve 12’de 2:1 öder. KÖŞELER 2 ya da 12’de 15:1.',
  rule4: 'TAM tek toplama bahistir: 2 ve 12’de 31:1, 3 ve 11’de 15:1, 4 ve 10’da 10:1, 5 ve 9’da 7:1, 6 ve 8’de 11:2.',
  rulesOk: 'Tamam',
  pot: 'Bahis', fair: 'ADİL', last12: 'SON 12', seed: 'TOHUM {n}', boardBet: 'BAHİS', boardRoll: 'ZAR',
};

export default { prefix: 'm.dicetower.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
