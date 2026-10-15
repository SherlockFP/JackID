/** Pull grant toasts ("+N pulls · reason"). Moved out of run.ts so the i18n lint sees the keys. Loaded by the `*.strings.ts` glob in main.ts. */
export default {
  prefix: 'pulls.',
  en: {
    'grant.one': '+{n} pull · {reason}',
    'grant.other': '+{n} pulls · {reason}',
    'r.phone': 'phone deal',
    'r.bought': 'bought with Tickets',
    'r.watch': 'new Watch',
  },
  tr: {
    'grant.one': '+{n} çekiş · {reason}',
    'grant.other': '+{n} çekiş · {reason}',
    'r.phone': 'telefon anlaşması',
    'r.bought': 'biletle alındı',
    'r.watch': 'yeni vardiya',
  },
};
