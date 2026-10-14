/**
 * Cashier cage — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.cashier.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_go: 'EXCHANGE', h_leave: 'LEAVE',
  goal: "Trade coins for tickets, or sell tickets back. The cage pays less than it takes.",
  stNone: "NOTHING SELECTED",
  stReady: "READY TO EXCHANGE",
  stBlocked: "THIS EXCHANGE IS BLOCKED",
  nCoins: "COINS",
  nTickets: "TICKETS",
  nPrice: "AMOUNT",
  nRate: "RATE",
  cPick: "PICK",
  cGo: "EXCHANGE",
  cRules: "RULES",
  cLeave: "LEAVE",
  rule1: "Buy tickets with coins, sell them back for coins. The cage always pays less than it takes, so a round trip loses coins.",
  rule2: "House Credit (free casino only) lends coins against your stake. Tickets are capped at 99.",
  rule3: "Keys: up and down pick an offer, PRIMARY makes the exchange, numbers 1-5 jump straight to an offer.",
  tip1: "Trade coins for tickets here, or sell them back. Pick an offer first.",
  tip2: "[{move}] PICK AN OFFER  ·  [{go}] EXCHANGE",
  tip3: "The bar shows the price and the rate. [{help}] RULES",
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
  goal: "Paranı bilete çevir ya da biletlerini geri sat. Kasa aldığından az öder.",
  stNone: "BİR İŞLEM SEÇİLMEDİ",
  stReady: "İŞLEME HAZIR",
  stBlocked: "BU İŞLEM YAPILAMIYOR",
  nCoins: "PARA",
  nTickets: "BİLET",
  nPrice: "TUTAR",
  nRate: "KUR",
  cPick: "SEÇ",
  cGo: "İŞLEM YAP",
  cRules: "KURALLAR",
  cLeave: "AYRIL",
  rule1: "Paranla bilet al, biletleri paraya geri sat. Kasa her zaman aldığından az öder, bu yüzden gidiş-dönüş para kaybettirir.",
  rule2: "Kasa kredisi (yalnız serbest kumarhane) bahsine göre para verir. Bilet sınırı 99.",
  rule3: "Tuşlar: yukarı ve aşağı işlem seçer, BİRİNCİL işlemi yapar, 1-5 doğrudan bir işleme atlar.",
  tip1: "Burada paranla bilet alır ya da biletlerini geri satarsın. Önce bir işlem seç.",
  tip2: "[{move}] İŞLEM SEÇ  ·  [{go}] İŞLEM YAP",
  tip3: "Çubukta tutar ve kur görünür. [{help}] KURALLAR",
  s_coins: 'PARA', s_tickets: 'BİLET', s_offer: 'İŞLEM',
  ledger: 'KASA', ledgerHint: 'YUKARI/AŞAĞI SEÇ  BOŞLUK ONAYLA',
  buy1: '1 BİLET AL', buy5: '5 BİLET AL', sell1: '1 BİLET SAT', sell5: '5 BİLET SAT',
  loan: 'KASA KREDİSİ',
  bought: '{n} BİLET ALINDI', sold: '{n} BİLET SATILDI', lent: 'KASA KREDİSİ +{n}',
  funds: 'PARA YETMİYOR', tickets: 'BİLET YETMİYOR', cap: 'BİLET SINIRI', mode: 'BU MODDA KAPALI',
  rate: 'AL {b} / SAT {s}',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.cashier.', en, tr };
