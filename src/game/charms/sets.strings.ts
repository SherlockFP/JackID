/**
 * Archetype set and evolution strings (charms/sets.ts, charms/engines.ts, menu/hud/charmProc.ts).
 *  - `set.<id>.name|desc`: a set's chip name and its hover text;
 *  - `evo.label`: "EVOLVED" (the peg title of an evolved charm); `evo.<id>`: what each engine charm's evolution does.
 */
export default {
  prefix: 'hud.',
  en: {
    'set.hot.name': 'Hot Set', 'set.hot.desc': 'Hot multiplier +0.1.',
    'set.clutch.name': 'Clutch Set', 'set.clutch.desc': 'Last Call +6 s.',
    'set.banker.name': 'Banker Set', 'set.banker.desc': 'Interest +1%.',
    'set.whale.name': 'Whale Set', 'set.whale.desc': 'House Limit ×1.25.',
    'set.rotation.name': 'Rotation Set', 'set.rotation.desc': 'Tilt grace +1 pull.',
    'set.copycat.name': 'Copycat Set', 'set.copycat.desc': 'The Understudy copies one extra effect.',
    'evo.label': 'EVOLVED',
    'evo.suit_ladder': 'Wins pay ×(1 + 0.16 per Rung), up to 8 Rungs.',
    'evo.pressure_valve': 'Wins pay ×(1 + 0.14 per Pressure), up to 10 Pressure.',
    'evo.capacitor': 'Hot wins pay ×(1 + 0.30 per charge), up to 7 charge.',
    'evo.lampwick': 'Each wick adds +0.10 to the Hot multiplier.',
    'evo.ticket_press': 'Payouts get +3% per 3 Tickets held (max +20%).',
    'evo.snowball_ledger': 'Up to 4 Watches count: interest +1% each (max +4%).',
    'evo.last_gasp': 'Payouts ×1.6 during the last Watch\'s Last Call while the quota is unmet.',
    'evo.gilded_chip': 'At max bet: payouts ×1.4. Below half of max bet: payouts ×0.8.',
    'evo.false_ceiling': 'House Limit ×2.9 (from 5× to 14.5× the quota). Dread +10 while held.',
    'evo.understudy': 'Copies the two most expensive charms that are not Legendary or Cursed.',
  },
  tr: {
    'set.hot.name': 'Sıcak Seti', 'set.hot.desc': 'Sıcak çarpanı +0,1.',
    'set.clutch.name': 'Son Anlar Seti', 'set.clutch.desc': 'Son Çağrı +6 sn.',
    'set.banker.name': 'Bankacı Seti', 'set.banker.desc': 'Faiz +%1.',
    'set.whale.name': 'Balina Seti', 'set.whale.desc': 'Ev Limiti ×1,25.',
    'set.rotation.name': 'Rotasyon Seti', 'set.rotation.desc': 'TİLT ek süresi +1 çekiş.',
    'set.copycat.name': 'Taklitçi Seti', 'set.copycat.desc': 'Dublör bir etki daha kopyalar.',
    'evo.label': 'GELİŞMİŞ',
    'evo.suit_ladder': 'Kazançlar Basamak başına ×(1 + 0,16) öder, en fazla 8 Basamak.',
    'evo.pressure_valve': 'Kazançlar Basınç başına ×(1 + 0,14) öder, en fazla 10 Basınç.',
    'evo.capacitor': 'Sıcak kazançlar şarj başına ×(1 + 0,30) öder, en fazla 7 şarj.',
    'evo.lampwick': 'Her fitil Sıcak çarpanına +0,10 ekler.',
    'evo.ticket_press': 'Elindeki her 3 Bilet için kazançlara +%3 (en fazla +%20).',
    'evo.snowball_ledger': 'En fazla 4 Vardiya sayılır: her biri +%1 faiz (en fazla +%4).',
    'evo.last_gasp': 'Kota tutmadığı sürece, son Vardiya\'nın Son Çağrısı sırasında kazançlar ×1,6.',
    'evo.gilded_chip': 'Maksimum bahiste kazançlar ×1,4. Maksimum bahsin yarısının altında ×0,8.',
    'evo.false_ceiling': 'Ev Limiti ×2,9 (kotanın 5 katından 14,5 katına). Tutarken Korku +10.',
    'evo.understudy': 'Legendary ya da Lanetli olmayan en pahalı iki tılsımın etkilerini kopyalar.',
  },
};
