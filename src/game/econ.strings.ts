/**
 * Wave 19 economy strings: the paid-Night summary toast (`inGameState.ts`, figures from `run.nightLedger()`) and the Night 1 spin
 * step that counts rounds on any machine (`tutorial.ts`). Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'econ.',
  en: {
    'summary': 'QUOTA {n} PAID · float +{float} · interest +{int} · tickets +{tickets}',
    'spinAny': 'Press {key}. Spin 4 times on any machine, then rotate — TILT lowers repeat pay.',
  },
  tr: {
    'summary': '{n}. GECE KOTASI ÖDENDİ · kasa +{float} · faiz +{int} · bilet +{tickets}',
    'spinAny': '{key} ile çevir. Herhangi bir makinede 4 kez çevir, sonra değiştir — TİLT aynı makinede ödemeyi düşürür.',
  },
};
