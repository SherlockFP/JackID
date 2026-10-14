/**
 * Totem names and descriptions (`totem.<id>.name|desc`), registered here too so the shelf, bounty board and vendor can
 * read them before the item system boots. Values come from the catalogue (items/data.ts), so they never drift.
 */
import { TOTEM_DATA } from './data';

const table = (lang: 'en' | 'tr'): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const d of TOTEM_DATA) {
    out[`${d.id}.name`] = d.strings[lang].name;
    out[`${d.id}.desc`] = d.strings[lang].desc;
  }
  return out;
};

export default {
  prefix: 'totem.',
  en: table('en'),
  tr: table('tr'),
};
