/**
 * Run-side Tally Bench lines (Wave 25 integrator): the pause card's BLANK mark, the Pledge charm banner, the Audit tax and
 * the lost-Mark toast. Keys are `duelrun.<key>`.
 */
export default {
  prefix: 'duelrun.',
  en: {
    'blank': 'BLANK',
    'marks.lost': 'A Mark is taken. {n} left on the card.',
    'marks.blank': 'The JackID reads BLANK. The House no longer says your name.',
    'pledge': 'The Pledge is yours: {charm}.',
    'tax': 'The Clerk takes {n} coins from the prize. The Audit is the Audit.',
  },
  tr: {
    'blank': 'BOŞ',
    'marks.lost': 'Bir Damga alındı. Kartta {n} kaldı.',
    'marks.blank': 'JackID boş görünüyor. Kasa artık adını anmıyor.',
    'pledge': 'Rehin senin: {charm}.',
    'tax': 'Katip ödülden {n} jeton alır. Denetim denetimdir.',
  },
}
