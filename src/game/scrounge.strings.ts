/**
 * THE SCROUNGE copy (src/game/scrounge.ts): the critters on the floor while broke, the catch and sell prompts, the sell and watch
 * toasts. Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'scrounge.',
  en: {
    'label.rat': 'Catch the rat',
    'label.roach': 'Catch the cockroach',
    'label.sell': 'Sell the bugs',
    'label.watch': 'Sell the watch',
    'name.rat': 'rat',
    'name.roach': 'cockroach',
    'sub.carry': 'Carrying {n} of {max}',
    'sub.sell': 'Carrying {n} · {left} coins left tonight',
    'sub.watch': 'For {c} coins · once per run',
    'toast.caught': 'Caught a {kind}. Carrying {n} of {max}.',
    'toast.full': 'Your pockets are full. Sell the bugs first.',
    'toast.sold.other': 'Sold {n} bugs for {c} coins',
    'toast.sold.one': 'Sold 1 bug for {c} coins',
    'toast.capped': 'You cannot sell any more bugs tonight.',
    'toast.watch': 'You sold your watch for {c} coins.',
    'toast.notbroke': 'You can only sell the watch when you are broke.',
  },
  tr: {
    'label.rat': 'Sıçanı yakala',
    'label.roach': 'Hamamböceğini yakala',
    'label.sell': 'Böcekleri sat',
    'label.watch': 'Saati sat',
    'name.rat': 'sıçan',
    'name.roach': 'hamamböceği',
    'sub.carry': '{max} içinden {n} taşıyorsun',
    'sub.sell': '{n} taşıyorsun · bu gece {left} jeton kaldı',
    'sub.watch': '{c} jetona · oyun başına bir kez',
    'toast.caught': '{kind} yakaladın. {max} içinden {n} taşıyorsun.',
    'toast.full': 'Ceplerin dolu. Önce böcekleri sat.',
    'toast.sold.other': '{n} böceği {c} jetona sattın',
    'toast.sold.one': '1 böceği {c} jetona sattın',
    'toast.capped': 'Bu gece daha fazla böcek satamazsın.',
    'toast.watch': 'Saatini {c} jetona sattın.',
    'toast.notbroke': 'Saatini yalnızca param bittiğinde satabilirsin.',
  },
};
