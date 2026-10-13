/**
 * Sic Bo "The Birdcage" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; keys are registered
 * under `m.sicbo.` (MachineBase.t adds the prefix). `{n}` / `{a}` `{b}` `{c}` / `{t}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
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
