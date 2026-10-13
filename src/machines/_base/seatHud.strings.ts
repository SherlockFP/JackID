/**
 * Seat HUD (`_base/seatHud.ts`) — shared UI strings for the readability standard. Keys are registered under
 * `hud.seat.` (the prefix below). Turkish copy is written in capitals already (İ / I stay correct without CSS).
 */
const en: Record<string, string> = {
  anyKey: 'PRESS ANY KEY',
  firstSit: 'HOW TO PLAY',
  rulesTitle: 'RULES',
  rHelpHint: '[{help}] RULES',
  kWin: 'WIN',
  kLose: 'LOSE',
  kPush: 'PUSH',
  kBlackjack: 'BLACKJACK',
  kBust: 'BUST',
  kSurrender: 'SURRENDER',
  kEven: 'EVEN MONEY',
};

const tr: Record<string, string> = {
  anyKey: 'BİR TUŞA BAS',
  firstSit: 'NASIL OYNANIR',
  rulesTitle: 'KURALLAR',
  rHelpHint: '[{help}] KURALLAR',
  kWin: 'KAZANDIN',
  kLose: 'KAYBETTİN',
  kPush: 'BERABERE',
  kBlackjack: 'BLACKJACK',
  kBust: 'BATTI',
  kSurrender: 'TESLİM',
  kEven: 'EŞİT PARA',
};

export default { prefix: 'hud.seat.', en, tr };
export const STRINGS = { en, tr };
