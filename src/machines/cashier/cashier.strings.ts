/**
 * Cashier cage — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.cashier.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_go: 'EXCHANGE', h_leave: 'LEAVE',
  s_coins: 'COINS', s_tickets: 'TICKETS', s_offer: 'OFFER',
  ledger: 'CAGE', ledgerHint: 'UP/DOWN PICK  SPACE GO',
  buy1: 'BUY 1 TICKET', buy5: 'BUY 5 TICKETS', sell1: 'SELL 1 TICKET', sell5: 'SELL 5 TICKETS',
  loan: 'HOUSE CREDIT',
  bought: 'BOUGHT {n} TICKET', sold: 'SOLD {n} TICKET', lent: 'HOUSE CREDIT +{n}',
  funds: 'NOT ENOUGH COINS', tickets: 'NOT ENOUGH TICKETS', cap: 'TICKET LIMIT', mode: 'CLOSED IN THIS MODE',
  rate: 'BUY {b} / SELL {s}',
};

const tr: Record<string, string> = {
  h_pick: 'SEÇ', h_go: 'İŞLEM', h_leave: 'AYRIL',
  s_coins: 'PARA', s_tickets: 'BİLET', s_offer: 'İŞLEM',
  ledger: 'KASA', ledgerHint: 'YUKARI/AŞAĞI SEÇ  BOŞLUK ONAYLA',
  buy1: '1 BİLET AL', buy5: '5 BİLET AL', sell1: '1 BİLET SAT', sell5: '5 BİLET SAT',
  loan: 'EV KREDİSİ',
  bought: '{n} BİLET ALINDI', sold: '{n} BİLET SATILDI', lent: 'EV KREDİSİ +{n}',
  funds: 'PARA YETMİYOR', tickets: 'BİLET YETMİYOR', cap: 'BİLET SINIRI', mode: 'BU MODDA KAPALI',
  rate: 'AL {b} / SAT {s}',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.cashier.', en, tr };
