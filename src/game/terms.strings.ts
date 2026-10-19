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
    'payout.n': 'PAYOUT', 'payout.d': 'Your wins are multiplied by this. MOOD is the House\'s temper, WITCHING a night bonus.',
    'hunger.n': 'HUNGER', 'hunger.d': 'The curse eats part of your stake. It resets each night.',
    'series.n': 'RUN', 'series.d': 'Rounds in a row: a win streak, or auto spins.',
    'stakes.n': 'SAFE / BOLD', 'stakes.d': 'Quick bets. Safe is small, bold is bigger.',
    'harmony.n': 'HARMONY', 'harmony.d': 'How close you are to Ada. At zero she leaves.',
    'heat.n': 'HEAT', 'heat.d': 'The Collector\'s attention. When it is high he freezes your investments.',
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
    'payout.n': 'ÖDEME', 'payout.d': 'Kazançların bununla çarpılır. HAVA kasanın keyfi, CADI gece bonusu.',
    'hunger.n': 'AÇLIK', 'hunger.d': 'Lanet bahsinden pay yer. Her gece sıfırlanır.',
    'series.n': 'SERİ', 'series.d': 'Üst üste tur: kazanç serisi ya da oto çevirme.',
    'stakes.n': 'GÜVENLİ / CESUR', 'stakes.d': 'Hızlı bahis. Güvenli küçük, cesur daha büyük.',
    'harmony.n': 'UYUM', 'harmony.d': 'Ada ile aran. Sıfırlanırsa yanından gider.',
    'heat.n': 'ISI', 'heat.d': 'Tahsildar\'ın dikkati. Yükselirse yatırımlarını dondurur.',
  },
};
