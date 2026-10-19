/**
 * The HUD terms, explained (src/game/terms.ts): `<id>.n` the name as the HUD prints it, `<id>.d` the one-line meaning, shown
 * once as a toast and kept on the journal's TERMS page. `goal.*` is the goal strip under the quota box. Vars: {n} the quota, {left} what is still to pay.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'term.',
  en: {
    'say': '{name}: {d}',
    'page': 'Terms',
    'goal.pay': 'Pay {n} by dawn · {left} left',
    'goal.met': 'Quota covered. Wait for dawn.',
    'goal.paid': 'Paid for tonight',
    'goal.sealed': 'Closed with a seal',
    'quota.n': 'QUOTA', 'quota.d': 'Coins you must pay at dawn.',
    'seal.n': 'SEALS', 'seal.d': 'Your lives. Miss the quota, lose one.',
    'luck.n': 'LUCK', 'luck.d': 'Each star adds 2% to your wins and 3% to the Last Game odds.',
    'payout.n': 'PAYOUT', 'payout.d': 'Your wins are multiplied by this.',
    'hunger.n': 'HUNGER', 'hunger.d': 'Chance the curse eats your next bet. Grows each spin; resets on a hit or new night.',
    'series.n': 'SIZE / STREAK', 'series.d': 'Big One: spins per AUTO. Coin Flip: wins in a row.',
    'stakes.n': 'SAFE / BOLD', 'stakes.d': 'SAFE bets about 5% of your coins, BOLD about 15%.',
    'harmony.n': 'HARMONY', 'harmony.d': 'Your bond with Ada. At zero she leaves.',
    'heat.n': 'HEAT', 'heat.d': 'The Collector\'s eye. At 3 he freezes your best investment.',
    'pulls.n': 'PULLS', 'pulls.d': 'Spins you have left this Watch. Leftover pulls turn into tickets.',
    'lastGame.n': 'THE LAST GAME', 'lastGame.d': 'Opens once Night 8 is paid. Win it and the run is won; a loss burns a seal.',
  },
  tr: {
    'say': '{name}: {d}',
    'page': 'Terimler',
    'goal.pay': 'Şafakta {n} jeton öde · {left} kaldı',
    'goal.met': 'Kota tamam. Şafağı bekle.',
    'goal.paid': 'Bu gece ödendi',
    'goal.sealed': 'Mühürle kapandı',
    'quota.n': 'KOTA', 'quota.d': 'Şafakta ödeyeceğin jeton.',
    'seal.n': 'MÜHÜR', 'seal.d': 'Canların. Kotayı kaçırırsan biri gider.',
    'luck.n': 'ŞANS', 'luck.d': 'Her yıldız kazancına %2, Son Oyun şansına %3 ekler.',
    'payout.n': 'ÖDEME', 'payout.d': 'Kazançların bununla çarpılır.',
    'hunger.n': 'AÇLIK', 'hunger.d': 'Lanetin bahsini yeme şansı. Her çevirmede artar, vurunca sıfırlanır.',
    'series.n': 'SERİ', 'series.d': 'Büyük Vurgun: bir OTO\'daki çevirme. Yazı-Tura: üst üste kazanç.',
    'stakes.n': 'GÜVENLİ / CESUR', 'stakes.d': 'GÜVENLİ jetonun %5\'i, CESUR %15\'i kadar bahis.',
    'harmony.n': 'UYUM', 'harmony.d': 'Ada ile aran. Sıfırda yanından gider.',
    'heat.n': 'ISI', 'heat.d': 'Tahsildar\'ın dikkati. 3 olunca yatırımını dondurur.',
    'pulls.n': 'ÇEKİŞ', 'pulls.d': 'Bu vardiyada kalan çevirme hakkın. Artanlar bilet olur.',
    'lastGame.n': 'SON OYUN', 'lastGame.d': '8. gece ödenince açılır. Kazanırsan oyun biter, kaybedersen bir mühür yanar.',
  },
};
