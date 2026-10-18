/**
 * ŞANS, the luck meter (src/game/luck.ts; the HUD row in src/menu/hud.ts). Each star is a payout bonus of 1 % (`bonus`, `s` is the
 * sign and `n` the size). The HUD toasts `toast`, or `toastWhy` with the reason from `why.<key>` when the source event gives one.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'luck.',
  en: {
    'label': 'LUCK',
    'toast': 'LUCK {n}',
    'toastWhy': 'LUCK {n} · {why}',
    'bonus': 'wins {s}{n}%',
    'tip': 'Each star adds 1 % to every win (−2 % to +5 %). Paid quotas, overshoots, Collector heat, tithes and rescue loans move it.',
    'why.quota': 'quota paid',
    'why.overshoot': 'quota overshoot',
    'why.failed': 'quota missed',
    'why.tithe': 'tithe missed',
    'why.loan': 'loan taken',
    'why.time': 'a late reply',
    'why.deal': 'a deal with the Collector',
    'why.thin': 'a thin Night',
    'why.quiet': 'a quiet Night',
  },
  tr: {
    'label': 'ŞANS',
    'toast': 'ŞANS {n}',
    'toastWhy': 'ŞANS {n} · {why}',
    'bonus': 'kazanç {s}%{n}',
    'tip': 'Her yıldız kazançlara %1 ekler (−%2 ile +%5 arası). Ödenen kota, fazla ödeme, Tahsildar ısısı, vergi ve borç ŞANS’ı değiştirir.',
    'why.quota': 'kota ödendi',
    'why.overshoot': 'kota fazlası',
    'why.failed': 'kota tutmadı',
    'why.tithe': 'vergi ödenmedi',
    'why.loan': 'borç alındı',
    'why.time': 'geç cevap',
    'why.deal': 'Tahsildar ile anlaşma',
    'why.thin': 'ince bir gece',
    'why.quiet': 'sessiz bir gece',
  },
};
