/** NIGHT PLAN panel (top-right, under the quota; src/menu/hud.ts `updatePlan`). Four short lines. Loaded by the `*.strings.ts` glob in main.ts. */
export default {
  prefix: 'hud.plan.',
  en: {
    'head': 'QUOTA {q} · DAWN',
    'bank': 'BANK {b} → {p} BY DAWN ✓',
    'bankShort': 'BANK {b} → {p} BY DAWN ✗ SHORT {g}',
    'pocket': 'POCKET {p} (NOT COUNTED)',
    'ends': 'WATCH {w}/{n} · {p} PULLS · {c} · BELL',
    'next': 'NEXT WATCH {w}/{n}',
  },
  tr: {
    'head': 'KOTA {q} · ŞAFAK',
    'bank': 'BANKA {b} → {p} ŞAFAKTA ✓',
    'bankShort': 'BANKA {b} → {p} ŞAFAKTA ✗ EKSİK {g}',
    'pocket': 'CEP {p} (SAYILMAZ)',
    'ends': 'VARDİYA {w}/{n} · {p} ÇEKİŞ · {c} · ZİL',
    'next': 'SONRAKİ VARDİYA {w}/{n}',
  },
};
