/**
 * Shell Automaton "Monsieur Thimble" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts
 * (default export `{ prefix, en, tr }`); keys resolve as `m.shellgame.<key>`. `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Monsieur Thimble',
  desc: 'Three cups, one pearl, and a very polite automaton. Follow the pearl, or call the cheat. Win too often and he stops playing.',
  insert: 'Insert', pick: 'Lift', cheat: 'Call Cheat', cheatN: 'CHEAT ×{n}', cupN: 'CUP {n}',
  heat: 'HEAT {n}', stake: 'Stake', win: 'WIN {n}', lose: 'LOSE', pearl: 'PEARL',
  palmed: 'PALMED', empty: 'EMPTY', cheatHit: 'CAUGHT', cheatMiss: 'NO PALM', second: 'SECOND GUESS', tooSlow: 'TOO SLOW',
  walked: 'WALKED OFF', jam: 'OUT OF ORDER', jamSign: 'OUT OF ORDER',
  jammed: 'Out of order until the next Night.', noFunds: 'Not enough coins.',
  pickNow: 'Lift a cup', secondNow: 'One more cup, a half pays', sameCup: 'That cup is already lifted',
  cheatOnly: 'Cheat calls are not allowed now', hint: '1 2 3 cup · 4 Call Cheat · Space insert · H help',
  help: 'Insert a coin. Watch the pearl under the middle cup, then the cups move. Lift the cup that holds the pearl and win one to one. Call Cheat if you think he palmed it: that pays three to one. The more wins in a row, the more he palms. Five in a row and he goes out of order.',
  sStake: 'STAKE', sHeat: 'HEAT', sTimer: 'TIME', hInsert: 'Insert', hCup: 'Lift {n}', hCheat: 'Call Cheat',
  hBet: 'Bet', hHelp: 'Help',
};

const tr: Record<string, string> = {
  name: 'Mösyö Yüksük',
  desc: 'Üç bardak, bir inci ve çok kibar bir otomat. İnciyi takip et ya da hile çağır. Çok kazanırsan çalışmayı bırakır.',
  insert: 'Para at', pick: 'Kaldır', cheat: 'Hile Çağır', cheatN: 'HİLE ×{n}', cupN: 'BARDAK {n}',
  heat: 'ISI {n}', stake: 'Bahis', win: 'KAZANÇ {n}', lose: 'KAYBETTİN', pearl: 'İNCİ',
  palmed: 'AVUÇTA', empty: 'BOŞ', cheatHit: 'YAKALANDI', cheatMiss: 'AVUÇ YOK', second: 'İKİNCİ TAHMİN', tooSlow: 'ÇOK YAVAŞ',
  walked: 'TERK EDİLDİ', jam: 'ARIZALI', jamSign: 'ARIZALI',
  jammed: 'Bir sonraki Gece\'ye kadar arızalı.', noFunds: 'Yeterli jeton yok.',
  pickNow: 'Bir bardak kaldır', secondNow: 'Bir bardak daha, yarım ödül', sameCup: 'Bu bardak zaten kaldırıldı',
  cheatOnly: 'Bu anda hile çağrılamaz', hint: '1 2 3 bardak · 4 Hile Çağır · Boşluk para at · H yardım',
  help: 'Bir jeton at. Ortadaki bardağın altındaki inciyi izle, sonra bardaklar karışır. İnciyi taşıyan bardağı kaldır: bire bir kazanırsın. Avucunda sakladığını düşünüyorsan Hile Çağır: üçe bir öder. Arka arkaya kazandıkça daha çok saklar. Beş üst üste kazanırsan arızalanır.',
  sStake: 'BAHİS', sHeat: 'ISI', sTimer: 'SÜRE', hInsert: 'Para at', hCup: 'Kaldır {n}', hCheat: 'Hile Çağır',
  hBet: 'Bahis', hHelp: 'Yardım',
};

export default { prefix: 'm.shellgame.', en, tr };
