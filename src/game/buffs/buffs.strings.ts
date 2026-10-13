/**
 * Buff / event UI strings (HUD banners, buff bar labels). Per-definition names and descriptions live with their
 * data (`BuffDef.strings`, `NightEventDef.strings`) and are registered by buffs/index.ts.
 */
export default {
  prefix: 'buff.',
  en: {
    'banner.ended': 'ENDED: {name}',
    'hud.title': 'EFFECTS',
    'hud.none': 'No effects',
    'hud.stacks': '×{n}',
    'hud.debuff': 'CURSE',
    'hud.buff': 'BUFF',
    'hud.permanent': 'ALWAYS',
  },
  tr: {
    'banner.ended': 'BİTTİ: {name}',
    'hud.title': 'ETKİLER',
    'hud.none': 'Etki yok',
    'hud.stacks': '×{n}',
    'hud.debuff': 'LANET',
    'hud.buff': 'GÜÇLENME',
    'hud.permanent': 'SÜREKLİ',
  },
};
