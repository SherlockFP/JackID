/**
 * Cyclone Light Ring — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are
 * registered under `m.cyclone.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Cyclone Light Ring',
  desc: 'Stop the light on the best lamp. Forty-eight bulbs, one chase. Rarely the Eye opens and the jackpot lamp goes gold.',
  start: 'Start', stop: 'Stop', stakeLabel: 'Stake', stake: 'Stake {n}', bet: 'BET {n}', win: 'WIN {n}',
  credit: 'CREDIT', last: 'LAST', btnStart: 'START', btnStop: 'STOP',
  hintStart: 'Start', hintStop: 'Stop', hintStake: 'Stake', hintNudge: 'Nudge',
  armed: 'THE EYE OPENS', jackpot: 'JACKPOT', multLabel: '×{n}', nudge: 'NUDGE', nudged: 'NUDGED ×{n}',
  lost: 'Nothing this time', auto: 'Too slow, the ring stopped itself', busy: 'The ring is still turning',
  second: 'SECOND ×{n}', jp: 'JP',
};

const tr: Record<string, string> = {
  name: 'Siklon Işık Çemberi',
  desc: 'Işığı en iyi lambada durdur. Kırk sekiz ampul, tek kovalamaca. Nadiren Göz açılır ve jackpot lambası altın olur.',
  start: 'Başlat', stop: 'Dur', stakeLabel: 'Bahis', stake: 'Bahis {n}', bet: 'BAHİS {n}', win: 'KAZANÇ {n}',
  credit: 'KREDİ', last: 'SON', btnStart: 'BAŞLAT', btnStop: 'DUR',
  hintStart: 'Başlat', hintStop: 'Dur', hintStake: 'Bahis', hintNudge: 'Dürt',
  armed: 'GÖZ AÇILDI', jackpot: 'JACKPOT', multLabel: '×{n}', nudge: 'DÜRT', nudged: 'DÜRTÜLDÜ ×{n}',
  lost: 'Bu sefer olmadı', auto: 'Çok geç kaldın, çember kendi durdu', busy: 'Çember hâlâ dönüyor',
  second: 'İKİNCİ ×{n}', jp: 'JP',
};

export default { prefix: 'm.cyclone.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
