import { BUFF_DATA } from '../data/buffs';

/** Tonic names and descriptions (`buff.tonic.<id>.name|desc`), derived from the catalogue so the Apothecary reads them at any boot. */
const tonicTable = (lang: 'en' | 'tr'): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const d of BUFF_DATA) {
    if (!d.id.startsWith('tonic.')) continue;
    out[`${d.id}.name`] = d.strings[lang].name;
    out[`${d.id}.desc`] = d.strings[lang].desc;
  }
  return out;
};

/**
 * Buff / event UI strings (HUD banners, buff bar labels). Per-definition names and descriptions live with their
 * data (`BuffDef.strings`, `NightEventDef.strings`) and are registered by buffs/index.ts. Tonics are also listed here.
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
    ...tonicTable('en'),
  },
  tr: {
    'banner.ended': 'BİTTİ: {name}',
    'hud.title': 'ETKİLER',
    'hud.none': 'Etki yok',
    'hud.stacks': '×{n}',
    'hud.debuff': 'LANET',
    'hud.buff': 'GÜÇLENME',
    'hud.permanent': 'SÜREKLİ',
    ...tonicTable('tr'),
  },
};
