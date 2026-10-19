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
    'quota.n': 'QUOTA', 'quota.d': 'The coins you must pay at dawn.',
    'seal.n': 'SEALS', 'seal.d': 'Your lives. Miss the quota and one is lost.',
    'luck.n': 'LUCK', 'luck.d': 'Each star adds 1% to every win.',
    'payout.n': 'PAYOUT', 'payout.d': 'Your wins are multiplied by this. MOOD is the House\'s temper, WITCHING a bonus in the 3 AM Watch.',
    'hunger.n': 'HUNGER', 'hunger.d': 'The chance the curse eats your next stake. It rises every spin; a strike or a new night resets it.',
    'series.n': 'SIZE / STREAK', 'series.d': 'Big One: how many spins one AUTO plays. Coin Flip: your wins in a row.',
    'stakes.n': 'SAFE / BOLD', 'stakes.d': 'Quick stakes: SAFE is about 5% of your coins, BOLD about 15%.',
    'harmony.n': 'HARMONY', 'harmony.d': 'How close you are to Ada. At zero she leaves.',
    'heat.n': 'HEAT', 'heat.d': 'The Collector\'s attention. From 3 he freezes your best investment at dawn.',
  },
  tr: {
    'say': '{name}: {d}',
    'page': 'Terimler',
    'goal.pay': 'Şafakta {n} jeton öde · {left} kaldı',
    'goal.met': 'Kota tamam. Şafağı bekle.',
    'goal.paid': 'Bu gece ödendi',
    'goal.sealed': 'Mühürle kapandı',
    'quota.n': 'KOTA', 'quota.d': 'Şafakta ödemen gereken jeton.',
    'seal.n': 'MÜHÜR', 'seal.d': 'Canların. Kotayı kaçırırsan biri gider.',
    'luck.n': 'ŞANS', 'luck.d': 'Her yıldız kazancına %1 ekler.',
    'payout.n': 'ÖDEME', 'payout.d': 'Kazançların bununla çarpılır. HAVA kasanın keyfi, CADI 03:00 Vardiyası\'nın bonusu.',
    'hunger.n': 'AÇLIK', 'hunger.d': 'Lanetin sıradaki bahsini yeme ihtimali. Her çevirmede artar; lanet vurunca ya da gece değişince sıfırlanır.',
    'series.n': 'SERİ', 'series.d': 'Büyük Vurgun: bir OTO\'nun kaç çevirme yapacağı. Yazı-Tura: üst üste kazandığın atış.',
    'stakes.n': 'GÜVENLİ / CESUR', 'stakes.d': 'Hızlı bahis: GÜVENLİ jetonlarının yaklaşık %5\'i, CESUR yaklaşık %15\'i.',
    'harmony.n': 'UYUM', 'harmony.d': 'Ada ile aran. Sıfıra düşerse yanından gider.',
    'heat.n': 'ISI', 'heat.d': 'Tahsildar\'ın dikkati. 3 olunca şafakta en iyi yatırımını dondurur.',
  },
};
