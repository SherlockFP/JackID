/**
 * Oni Feast pachislot — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.pachislot.` (MachineBase.t adds the prefix). `{n}` / `{of}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Oni Feast',
  desc: 'Skill-stop slots. Stop the lanterns, catch the oni, feed the setting.',
  lever: 'Lever', stop: 'Stop {n}', medal: 'Medal', max: 'Max', roles: 'Roles', hint: 'Hint',
  game: 'GAME {n}', pay: 'PAY {n}', set: 'SET {n}', feast: 'FEAST {n}/{of}', parade: 'PARADE {n}/{of}',
  holdBig: 'HOLD ONI', holdReg: 'HOLD LANTERN', replayFree: 'REPLAY FREE', ready: 'READY',
  rBig: 'ONI FEAST', rReg: 'LANTERN PARADE', rLantern: 'LANTERN', rKoi: 'KOI', rReplay: 'REPLAY', rFan: 'FAN',
  rMiss: 'NO ROLE', rBigPay: '24 GAMES, 3 IN / 13 OUT', rRegPay: '8 GAMES, 3 IN / 14 OUT',
  announceBig: 'ONI FEAST!', announceReg: 'LANTERN PARADE!', feastEnd: 'FEAST OVER', tease: 'SO CLOSE',
  lost: 'LOST', hintLabel: 'HINT', hintWhite: 'WHITE', hintBlue: 'BLUE', hintPurple: 'PURPLE', hintGold: 'GOLD',
  rolesTitle: 'ROLES', rolesHelp: 'Bonuses carry until aligned. Replay returns the bet.',
  autoStop: 'Reels stopped for you', fullBonus: 'Oni feast in progress',
};

const tr: Record<string, string> = {
  name: 'Oni Ziyafeti',
  desc: 'Beceri durdurmalı slot. Fenerleri durdur, oni\'yi yakala, ayarı besle.',
  lever: 'Kol', stop: 'Dur {n}', medal: 'Madeni para', max: 'Maks', roles: 'Roller', hint: 'İpucu',
  game: 'OYUN {n}', pay: 'ÖDEME {n}', set: 'AYAR {n}', feast: 'ZİYAFET {n}/{of}', parade: 'GEÇİT {n}/{of}',
  holdBig: 'ONI TUTULUYOR', holdReg: 'FENER TUTULUYOR', replayFree: 'TEKRAR BEDAVA', ready: 'HAZIR',
  rBig: 'ONI ZİYAFETİ', rReg: 'FENER GEÇİDİ', rLantern: 'FENER', rKoi: 'KOİ', rReplay: 'TEKRAR', rFan: 'YELPAZE',
  rMiss: 'ROL YOK', rBigPay: '24 OYUN, 3 GİR / 13 ÇIK', rRegPay: '8 OYUN, 3 GİR / 14 ÇIK',
  announceBig: 'ONI ZİYAFETİ!', announceReg: 'FENER GEÇİDİ!', feastEnd: 'ZİYAFET BİTTİ', tease: 'ÇOK AZ KALDI',
  lost: 'KAÇTI', hintLabel: 'İPUCU', hintWhite: 'BEYAZ', hintBlue: 'MAVİ', hintPurple: 'MOR', hintGold: 'ALTIN',
  rolesTitle: 'ROLLER', rolesHelp: 'Bonuslar hizalanana kadar taşınır. Tekrar, bahsi iade eder.',
  autoStop: 'Makaralar senin yerine durdu', fullBonus: 'Oni ziyafeti sürüyor',
};

export default { prefix: 'm.pachislot.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
