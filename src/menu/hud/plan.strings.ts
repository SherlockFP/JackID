/**
 * NIGHT PLAN panel (top-right, under the quota; src/menu/hud.ts `updatePlan`). At most four short lines, one line each: the copy
 * stays under ~24 characters so the panel never wraps at 1280x720 or 1920x1080 (uiScale 0.75). Only glyphs the HUD fonts have.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'hud.plan.',
  en: {
    'bank': 'DAWN {p}/{q}',
    'pocket': 'POCKET {p} · DEPOSIT',
    'ends': 'W{w}/{n} · {p} PULLS · {c}',
    'next': 'NEXT WATCH {w}/{n}',
    'night': 'NEXT NIGHT {q} (×{k})',
    'paid': 'PAID · SURPLUS {n}',
    'tithe': 'TITHE {e}/{n}',
  },
  tr: {
    'bank': 'ŞAFAK {p}/{q}',
    'pocket': 'CEP {p} · YATIR',
    'ends': 'V{w}/{n} · {p} ÇEKİŞ · {c}',
    'next': 'SONRAKİ V{w}/{n}',
    'night': 'SONRAKİ GECE {q} (×{k})',
    'paid': 'ÖDENDİ · FAZLA {n}',
    'tithe': 'ÖŞÜR {e}/{n}',
  },
};
