/**
 * Smart-stake copy (`_base/stakePresets.ts`): the preset names, the BIG confirm prompt and the set-stake toast.
 * Loaded by the `*.strings.ts` glob.
 */
const en: Record<string, string> = {
  safe: 'SAFE',
  bold: 'BOLD',
  big: 'BIG',
  set: 'STAKE {name}: {amount}',
  armBig: 'PRESS {key} AGAIN FOR BIG: {amount}',
};

const tr: Record<string, string> = {
  safe: 'GÜVENLİ',
  bold: 'CESUR',
  big: 'BÜYÜK',
  set: 'BAHİS {name}: {amount}',
  armBig: 'BÜYÜK İÇİN {key} TEKRAR BAS: {amount}',
};

export default { prefix: 'stakePreset.', en, tr };
export const STRINGS = { en, tr };
