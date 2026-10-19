/**
 * Cashier cage — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.cashier.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_go: 'EXCHANGE', h_leave: 'LEAVE',
  goal: "OUT OF COINS? Sell your Tickets for coins. Or spend 3 Tickets on one more Pull.",
  stNone: "NOTHING SELECTED",
  stReady: "READY TO EXCHANGE",
  stBlocked: "THIS EXCHANGE IS BLOCKED",
  stBroke: "POCKET EMPTY: SELL TICKETS",
  stBrokeSub: "Pick row 1: all your Tickets are worth {n} coins",
  nCoins: "COINS",
  nTickets: "TICKETS",
  nPrice: "AMOUNT",
  nRate: "RATE",
  cPick: "PICK",
  cGo: "EXCHANGE",
  cRules: "RULES",
  cLeave: "LEAVE",
  rule1: "SELL ALL TICKETS turns every Ticket into coins at once: the way out when your pocket is empty. SELL 1 sells a single Ticket.",
  rule2: "BUY +1 PULL spends 3 Tickets on one more play this Watch (up to 2 a Watch, only while the Watch is running).",
  rule3: "Buying Tickets costs more than selling them back, so a round trip loses coins. Tickets are capped at 99. House Credit (free casino only) lends coins.",
  rule4: "Keys: up and down pick an offer, PRIMARY makes the exchange, numbers 1-5 jump straight to an offer. Also try the phone (P) and the bank terminal's WITHDRAW.",
  s_coins: 'COINS', s_tickets: 'TICKETS', s_offer: 'OFFER',
  ledger: 'CAGE', ledgerHint: 'UP/DOWN PICK  SPACE GO',
  brokeLine: 'POCKET EMPTY: PRESS 1 = +{n} COINS',
  sellAll: 'SELL ALL TICKETS', sell1: 'SELL 1 TICKET', pull: 'BUY +1 PULL', buy1: 'BUY 1 TICKET', buy5: 'BUY 5 TICKETS',
  pullCost: '{n} TICKETS',
  loan: 'HOUSE CREDIT',
  bought: 'BOUGHT {n} TICKET', sold: 'SOLD {n} TICKET', lent: 'HOUSE CREDIT +{n}', pulled: '+1 PULL',
  funds: 'NOT ENOUGH COINS', tickets: 'NOT ENOUGH TICKETS', cap: 'TICKET LIMIT', mode: 'CLOSED IN THIS MODE', phase: 'ONLY WHILE A WATCH RUNS',
  rate: 'BUY {b} / SELL {s}',
  plaque: 'VEZNE', plaqueSub: 'CASHIER',
};

const tr: Record<string, string> = {
  h_pick: 'SEÇ', h_go: 'İŞLEM', h_leave: 'AYRIL',
  goal: "JETONUN MU BİTTİ? Biletlerini jetona çevir. Ya da 3 bileti bir çekiş daha için harca.",
  stNone: "BİR İŞLEM SEÇİLMEDİ",
  stReady: "İŞLEME HAZIR",
  stBlocked: "BU İŞLEM YAPILAMIYOR",
  stBroke: "CEP BOŞ: BİLET SAT",
  stBrokeSub: "1. satırı seç: tüm biletlerin {n} jeton eder",
  nCoins: "JETON",
  nTickets: "BİLET",
  nPrice: "TUTAR",
  nRate: "KUR",
  cPick: "SEÇ",
  cGo: "İŞLEM YAP",
  cRules: "KURALLAR",
  cLeave: "AYRIL",
  rule1: "TÜM BİLETLERİ SAT her bileti hemen jetona çevirir: cebin boşken çıkış yolu. 1 SAT tek bilet satar.",
  rule2: "+1 ÇEKİŞ AL, 3 bileti bu Vardiyada bir oyun daha için harcar (Vardiya başına en çok 2, yalnız Vardiya sürerken).",
  rule3: "Bilet almak geri satmaktan pahalıdır, bu yüzden gidiş-dönüş jeton kaybettirir. Bilet sınırı 99. Kasa kredisi (yalnız serbest kumarhane) jeton verir.",
  rule4: "Tuşlar: yukarı ve aşağı işlem seçer, BİRİNCİL işlemi yapar, 1-5 doğrudan bir işleme atlar. Telefonu (P) ve banka terminalinin ÇEK tuşunu da dene.",
  s_coins: 'JETON', s_tickets: 'BİLET', s_offer: 'İŞLEM',
  ledger: 'KASA', ledgerHint: 'YUKARI/AŞAĞI SEÇ  BOŞLUK ONAYLA',
  brokeLine: 'CEP BOŞ: 1 = +{n} JETON',
  sellAll: 'TÜM BİLETLERİ SAT', sell1: '1 BİLET SAT', pull: '+1 ÇEKİŞ AL', buy1: '1 BİLET AL', buy5: '5 BİLET AL',
  pullCost: '{n} BİLET',
  loan: 'KASA KREDİSİ',
  bought: '{n} BİLET ALINDI', sold: '{n} BİLET SATILDI', lent: 'KASA KREDİSİ +{n}', pulled: '+1 ÇEKİŞ',
  funds: 'JETON YETMİYOR', tickets: 'BİLET YETMİYOR', cap: 'BİLET SINIRI', mode: 'BU MODDA KAPALI', phase: 'YALNIZ VARDİYA SÜRERKEN',
  rate: 'AL {b} / SAT {s}',
  plaque: 'VEZNE', plaqueSub: 'CASHIER',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.cashier.', en, tr };
