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
  // seat HUD (readability standard)
  goal: 'Stop all three reels to line up a role and win medals',
  stLever: 'PULL THE LEVER', stLeverSub: 'BET {n}', stFree: 'REPLAY · FREE GAME', stFreeSub: 'Pull the lever, no stake',
  stHoldOni: 'HOLD ONI', stHoldLantern: 'HOLD LANTERN', stHoldSub: 'The carried bonus waits to line up',
  stStop: 'STOP THE REELS', stStopSub: 'Time each press on the payline', stBusy: 'PAYING OUT', stBonus: 'BONUS {n}/{of}',
  nBet: 'YOUR BET', nFree: 'FREE', nGame: 'GAME', nLast: 'LAST PAY', nBonus: 'BONUS', nBalance: 'BALANCE', medalsN: '{n} MEDALS',
  cLever: 'LEVER', cStop: 'STOP {n}', cBet: 'BET', cMax: 'MAX', cRoles: 'ROLES', cLeave: 'LEAVE',
  tip1: 'Pull the lever ({lever}) to start a game. The reels spin.',
  tip2: 'Stop each reel with {l}, {c} or {r} (left, centre, right) on the payline.',
  tip3: 'Set the bet with {bet} and max with {max}. Press {help} for the roles.',
  rule1: 'Three reels, one payline. Line up a role to win medals. Each stop is yours to time.',
  rule2: 'A bonus opens a feast or a parade. Its games run by themselves and pay at the end.',
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
  // seat HUD (readability standard)
  goal: 'Üç makarayı da durdurup bir rol yakala, madalya kazan',
  stLever: 'KOLU ÇEK', stLeverSub: 'BAHİS {n}', stFree: 'TEKRAR · BEDAVA OYUN', stFreeSub: 'Kolu çek, bahis yok',
  stHoldOni: 'ONI TUTULUYOR', stHoldLantern: 'FENER TUTULUYOR', stHoldSub: 'Taşınan bonus hizalanmayı bekler',
  stStop: 'MAKARALARI DURDUR', stStopSub: 'Her basışı ödeme hattında zamanla', stBusy: 'ÖDEME YAPILIYOR', stBonus: 'BONUS {n}/{of}',
  nBet: 'BAHSİN', nFree: 'BEDAVA', nGame: 'OYUN', nLast: 'SON ÖDEME', nBonus: 'BONUS', nBalance: 'BAKİYE', medalsN: '{n} MADENİ',
  cLever: 'KOL', cStop: 'DUR {n}', cBet: 'BAHİS', cMax: 'MAKS', cRoles: 'ROLLER', cLeave: 'ÇIK',
  tip1: 'Oyunu başlatmak için {lever} ile kolu çek. Makaralar döner.',
  tip2: 'Her makarayı {l}, {c} ya da {r} ile durdur (sol, orta, sağ). Ödeme hattında zamanla.',
  tip3: 'Bahsi {bet} ile, azamiyi {max} ile ayarla. Rolleri görmek için {help} tuşuna bas.',
  rule1: 'Üç makara, tek ödeme hattı. Bir rolü hizalayınca madalya kazanırsın; her durdurmayı sen zamanlarsın.',
  rule2: 'Bonus bir ziyafet ya da geçit açar. Oyunları kendiliğinden döner ve sonunda öder.',
};

export default { prefix: 'm.pachislot.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
