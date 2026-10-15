/** NIGHT PLAN panel (top-right, under the quota; src/menu/hud.ts `updatePlan`). Loaded by the `*.strings.ts` glob in main.ts. */
export default {
  prefix: 'hud.plan.',
  en: {
    'head': 'QUOTA {q} DUE AT DAWN · WATCH {w} OF {n}',
    'headNext': 'QUOTA {q} DUE AT DAWN · NEXT WATCH {w} OF {n}',
    'bank': 'BANK {b} → +{r}% EACH WATCH',
    'bankFlat': 'BANK {b} · NO INTEREST',
    'proj': 'PROJECTED AT DAWN: {p} ✓',
    'projShort': 'PROJECTED AT DAWN: {p} · SHORT {g}',
    'met': 'QUOTA MET ✓',
    'pocket': 'POCKET {p} (NOT COUNTED UNTIL DEPOSITED)',
    'ends': 'WATCH ENDS: PULLS {p} · CLOCK {c} · OR RING THE BELL',
  },
  tr: {
    'head': 'KOTA {q} ŞAFAKTA ÖDENİR · VARDİYA {w} / {n}',
    'headNext': 'KOTA {q} ŞAFAKTA ÖDENİR · SONRAKİ VARDİYA {w} / {n}',
    'bank': 'BANKA {b} → HER VARDİYA +%{r}',
    'bankFlat': 'BANKA {b} · FAİZ YOK',
    'proj': 'ŞAFAKTA TAHMİN: {p} ✓',
    'projShort': 'ŞAFAKTA TAHMİN: {p} · EKSİK {g}',
    'met': 'KOTA TAMAM ✓',
    'pocket': 'CEP {p} (YATIRILANA KADAR SAYILMAZ)',
    'ends': 'VARDİYA BİTER: ÇEKİŞ {p} · SAAT {c} · VEYA ZİLİ ÇAL',
  },
};
