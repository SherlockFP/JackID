/**
 * Moth Shrine — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.shrine.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`. The owners' names are the pantheon's
 * own (`pantheon.god.<id>.name`).
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  goal: "Light a candle, then pick a statue. That owner's Favour goes up by one. At 3 the statue weeps.",
  stReady: "READY TO LIGHT A CANDLE",
  stReadySub: "Costs {n} coins",
  stChoose: "WHICH STATUE?",
  stChooseSub: "The candle costs {n} coins",
  stOnce: "ALREADY LIT THIS WATCH",
  stOnceSub: "Come back in the next Watch",
  stFunds: "NOT ENOUGH COINS",
  stFundsSub: "Short by {n} coins",
  stFull: "ALL FOUR ARE WEEPING",
  nCoins: "COINS",
  nCost: "CANDLE",
  nLit: "LIT",
  cLight: "LIGHT",
  cStatue: "{name} {f}/3",
  cBack: "BACK",
  cRules: "RULES",
  cLeave: "LEAVE",
  rule1: "Light one candle per Watch. The price shown is what you pay when you pick a statue, and it changes with your stake.",
  rule2: "The statue you pick gets one Favour, up to 3. At 2 its omen can fire. At 3 it weeps and offers its Rite.",
  rule3: "Keys: PRIMARY starts a candle, 1-4 or LEFT and RIGHT pick a statue, HELP opens this card, E leaves.",
  tip1: "Light a candle, then pick a statue. Its owner remembers.",
  tip2: "[{light}] LIGHT A CANDLE, one per Watch",
  tip3: "[{help}] RULES  ·  1-4 pick the statue",
  once: 'ONE CANDLE PER WATCH', funds: 'NOT ENOUGH COINS', full: 'ALL FOUR ARE WEEPING', maxed: 'THAT STATUE IS ALREADY WEEPING',
};

const tr: Record<string, string> = {
  goal: "Bir mum yak, sonra bir heykel seç. O sahibin Teveccühü bir artar. 3'te heykel ağlar.",
  stReady: "BİR MUM YAKMAYA HAZIRSIN",
  stReadySub: "{n} para tutar",
  stChoose: "HANGİ HEYKEL?",
  stChooseSub: "Mum {n} para",
  stOnce: "BU VARDİYA ZATEN YAKILDI",
  stOnceSub: "Bir sonraki Vardiya'da tekrar gel",
  stFunds: "PARA YETMİYOR",
  stFundsSub: "{n} para eksik",
  stFull: "DÖRDÜ DE AĞLIYOR",
  nCoins: "PARA",
  nCost: "MUM",
  nLit: "YANAN",
  cLight: "YAK",
  cStatue: "{name} {f}/3",
  cBack: "GERİ",
  cRules: "KURALLAR",
  cLeave: "AYRIL",
  rule1: "Vardiya başına bir mum yak. Gösterilen fiyatı heykeli seçtiğinde ödersin; bahsine göre değişir.",
  rule2: "Seçtiğin heykel bir Teveccüh alır, en çok 3. 2'de alameti çıkabilir. 3'te ağlar ve Ayini sunar.",
  rule3: "Tuşlar: BİRİNCİL mum başlatır, 1-4 ya da SOL ve SAĞ heykeli seçer, KURALLAR bu kartı açar, E ayrılır.",
  tip1: "Bir mum yak, sonra bir heykel seç. Sahibi hatırlar.",
  tip2: "[{light}] MUM YAK, Vardiya başına bir tane",
  tip3: "[{help}] KURALLAR  ·  1-4 heykeli seçer",
  once: 'VARDİYA BAŞINA BİR MUM', funds: 'PARA YETMİYOR', full: 'DÖRDÜ DE AĞLIYOR', maxed: 'O HEYKEL ZATEN AĞLIYOR',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.shrine.', en, tr };
