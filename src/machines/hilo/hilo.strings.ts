/**
 * Hi-Lo Ladder — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.hilo.` (`prefix`).
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const STRINGS: MachineStrings = {
  en: {
    name: 'Hi-Lo Ladder',
    desc: 'Guess higher or lower on every card. Climb the ladder, or collect before a card busts you.',
    marquee: 'HI-LO LADDER',
    higher: 'Higher', lower: 'Lower', skip: 'Skip', collect: 'Collect', deal: 'Deal',
    runLabel: 'Run', stepsLabel: 'Steps',
    same: 'SAME!', refund: 'REFUND',
    noSkips: 'No skips left.', noGuess: 'That guess is certain. Pick the other side.',
    needStep: 'Make one correct guess before you collect.',
  },
  tr: {
    name: 'Yüksek-Alçak Merdiveni',
    desc: 'Her kartta yükseği ya da alçağı tahmin et. Merdiveni tırman, ya da kart seni yakmadan kasayı al.',
    marquee: 'YÜKSEK-ALÇAK',
    higher: 'Yüksek', lower: 'Alçak', skip: 'Atla', collect: 'Al', deal: 'Dağıt',
    runLabel: 'Çarpan', stepsLabel: 'Adım',
    same: 'AYNI!', refund: 'İADE',
    noSkips: 'Atlama hakkın kalmadı.', noGuess: 'Bu tahmin kesin. Diğer tarafı seç.',
    needStep: 'Almadan önce bir doğru tahmin yap.',
  },
};

export default { prefix: 'm.hilo.', en: STRINGS.en, tr: STRINGS.tr };
