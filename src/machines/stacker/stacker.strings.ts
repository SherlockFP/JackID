/**
 * Stacker — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are registered
 * under `m.stacker.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Stacker',
  desc: 'Stop the bar over the stack. Miss and the overhang falls. Clear rows 4, 7 and 10 to cash out ×0.5, ×1 or ×1.6, or climb on to the gold MAJOR.',
  stop: 'Stop', start: 'Start', take: 'Take', climb: 'Climb', bet: 'Bet {n}', win: 'WIN {n}', credit: 'CREDIT',
  row: 'ROW {n}', rowShort: 'ROW', minorBanner: 'MINOR ×2.5', majorBanner: 'MAJOR ×25', minorTake: 'TAKE {n}',
  minorDecide: 'Take it, or climb?', climbing: 'CLIMB!', lost: 'The stack came down', saved: 'SAVED!',
  fallen: 'FALLEN', capsule: 'CHARM CAPSULE', ready: 'READY', potLabel: 'Stake', hintStop: 'Stop', hintStake: 'Stake',
  hintTake: 'Take', hintClimb: 'Climb', busy: 'The stack is still falling', stacked: 'STACKED',
  bigStack: 'TOWER UP', hintLeave: 'Leave',
};

const tr: Record<string, string> = {
  name: 'İstif Kulesi',
  desc: 'Hareketli çubuğu yığının üstüne durdur. Kaçırırsan sarkan bloklar düşer. 4., 7. ve 10. sıraları geçince ×0,5, ×1 ya da ×1,6 ile çık, ya da altın MAKSİMUM’a tırman.',
  stop: 'Dur', start: 'Başla', take: 'Al', climb: 'Tırman', bet: 'Bahis {n}', win: 'KAZANÇ {n}', credit: 'KREDİ',
  row: 'SIRA {n}', rowShort: 'SIRA', minorBanner: 'MİNİMUM ×2,5', majorBanner: 'MAKSİMUM ×25', minorTake: 'AL {n}',
  minorDecide: 'Al mı, tırmanmak mı?', climbing: 'TIRMAN!', lost: 'Yığın çöktü', saved: 'KURTARILDI!',
  fallen: 'DÜŞTÜ', capsule: 'TILSIM KAPSÜLÜ', ready: 'HAZIR', potLabel: 'Bahis', hintStop: 'Dur', hintStake: 'Bahis',
  hintTake: 'Al', hintClimb: 'Tırman', busy: 'Yığından bloklar hâlâ düşüyor', stacked: 'YIĞILDI',
  bigStack: 'KULE YÜKSELDİ', hintLeave: 'Ayrıl',
};

export default { prefix: 'm.stacker.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
