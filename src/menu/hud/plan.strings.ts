/**
 * NIGHT PLAN panel (top-right, under the quota; src/menu/hud.ts `updatePlan`). At most four short lines, one line each: the copy
 * stays under ~24 characters so the panel never wraps at 1280x720 or 1920x1080 (uiScale 0.75). The OVERSHOOT line (`over*`, `ov.*`)
 * is the one longer line, shown only once the quota is banked. Only glyphs the HUD fonts have.
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
    'tithe': 'WATCH TITHE {e}/{n}',
    'over': 'OVERSHOOT: {b}/{q} → {r} (+{g})',
    'overTop': 'OVERSHOOT: TOP TIER',
    'overToast': 'OVERSHOOT {r} · PAYS AT DAWN',
    'ov.gratuity': '+2 TICKETS',
    'ov.favoured': '+1 FREE PAWN REROLL',
    'ov.uncommon': 'UNCOMMON CHARM',
    'ov.golden': 'RARE CHARM, -5% NEXT',
  },
  tr: {
    'bank': 'ŞAFAK {p}/{q}',
    'pocket': 'CEP {p} · YATIR',
    'ends': 'V{w}/{n} · {p} ÇEKİŞ · {c}',
    'next': 'SONRAKİ V{w}/{n}',
    'night': 'SONRAKİ GECE {q} (×{k})',
    'paid': 'ÖDENDİ · FAZLA {n}',
    'tithe': 'NÖBET ÖŞÜR {e}/{n}',
    'over': 'AŞIM: {b}/{q} → {r} (+{g})',
    'overTop': 'AŞIM: EN ÜST KADEME',
    'overToast': 'AŞIM {r} · ŞAFAKTA ÖDENİR',
    'ov.gratuity': '+2 BİLET',
    'ov.favoured': '+1 ÜCRETSİZ YENİLEME',
    'ov.uncommon': 'SEYREK TILSIM',
    'ov.golden': 'NADİR TILSIM, SONRAKİ -%5',
  },
};
