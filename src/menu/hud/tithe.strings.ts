/**
 * Watch tithe toasts (src/menu/hud.ts, on `run:tithe`): the Settle's result, read in play as one toast. run.ts still books the
 * tithe and emits its banner; the toast goes first, so claimAnnounce drops the banner's repeat of the same news.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'hud.tithe.',
  en: {
    'missed': 'TITHE MISSED: quota +{n}',
    'met': 'TITHE MET: +{n} TICKET',
  },
  tr: {
    'missed': 'ÖŞÜR KAÇTI: kota +{n}',
    'met': 'ÖŞÜR TAMAM: +{n} BİLET',
  },
};
