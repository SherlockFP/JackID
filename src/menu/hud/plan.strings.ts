/**
 * NIGHT PLAN panel (top-right, under the quota; src/menu/hud.ts `updatePlan`). One line each, nowrap. Most copy stays under ~24
 * characters. Two lines run longer: the OVERSHOOT line (`over*`, `ov.*`, shown once the quota is banked) and the broke hint (`broke.*`,
 * EN about 39 characters, shown only while the pocket cannot cover the cheapest bet and tonight's quota is unpaid). The tithe lines
 * (`tithe`, `unpaid`) are optional too. Only glyphs the HUD fonts have.
 * Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'hud.plan.',
  en: {
    'bank': 'PROJECTED AT DAWN {p}/{q}',
    'pocket': 'POCKET {p} · DEPOSIT',
    'ends': 'W{w}/{n} · {p} PULLS · {c}',
    'next': 'NEXT WATCH {w}/{n}',
    'night': 'NEXT NIGHT {q} (×{k})',
    'paid': 'PAID · SURPLUS {n}',
    'tithe': 'NET WIN {e}/{n}',
    'unpaid': '+{n} unpaid tithe in quota',
    'broke.bank': 'POCKET EMPTY · WITHDRAW AT THE TERMINAL',
    'broke.phone': 'POCKET EMPTY · ANSWER THE PHONE',
    'over': 'OVERSHOOT: {b}/{q} → {r} ({g} to go)',
    'overTop': 'OVERSHOOT: TOP TIER',
    'overToast': 'OVERSHOOT {r} · PAYS AT DAWN',
    'ov.gratuity': '+2 TICKETS',
    'ov.favoured': '+1 FREE PAWN REROLL',
    'ov.uncommon': 'UNCOMMON CHARM',
    'ov.golden': 'RARE CHARM, -5% NEXT',
    'ov.seal': 'JACKPOT SEAL: 5 TICKETS + LEGENDARY (RARE before Night 5)',
    'ov.envy': 'HOUSE ENVY: SOUL MARK OR 3 OBOLS',
    'overForfeit': 'OVERSHOOT FORFEIT TONIGHT',
  },
  tr: {
    'bank': 'ŞAFAKTA PROJE {p}/{q}',
    'pocket': 'CEP {p} · YATIR',
    'ends': 'NÖBET {w}/{n} · {p} ÇEKİŞ · {c}',
    'next': 'SONRAKİ NÖBET {w}/{n}',
    'night': 'SONRAKİ GECE {q} (×{k})',
    'paid': 'ÖDENDİ · FAZLA {n}',
    'tithe': 'NET KAZANÇ {e}/{n}',
    'unpaid': '+{n} ödenmemiş vergi kotada',
    'broke.bank': 'CEP BOŞ · TERMİNALDEN ÇEK',
    'broke.phone': 'CEP BOŞ · TELEFONU AÇ',
    'over': 'AŞIM: {b}/{q} → {r} ({g} kaldı)',
    'overTop': 'AŞIM: EN ÜST KADEME',
    'overToast': 'AŞIM {r} · ŞAFAKTA ÖDENİR',
    'ov.gratuity': '+2 BİLET',
    'ov.favoured': '+1 ÜCRETSİZ YENİLEME',
    'ov.uncommon': 'SEYREK TILSIM',
    'ov.golden': 'NADİR TILSIM, SONRAKİ -%5',
    'ov.seal': 'JACKPOT MÜHRÜ: 5 BİLET + EFSANE (5. GECEDEN ÖNCE NADİR)',
    'ov.envy': 'EV KISKANCI: RUH MÜHRÜ YA DA 3 OBOL',
    'overForfeit': 'AŞIM BU GECE KAYIP',
  },
};
