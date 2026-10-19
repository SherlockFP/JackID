/**
 * Free-roam Intermission strings: the HUD hint and the Night summary toast (`inGameState`). Loaded by the
 * `*.strings.ts` glob in main.ts. The Intermission modal strings stay in `ingame.strings.ts`.
 */
export default {
  prefix: 'interm.',
  en: {
    'topBar': 'MOLA: shop, then pull the lever',
    'hintFloor': 'INTERMISSION: shop at the Pawn Window, then pull OPEN THE FLOOR at the Bank Terminal',
    'hintBell': 'BETWEEN WATCHES: shop at the Pawn Window, then pull the lever at the Bank Terminal to ring the Bell',
    'paidShort': 'NIGHT {n} PAID',
    'summary': 'NIGHT {n} PAID: deposited {dep}, interest {int}, carried over {carry}, tickets {tickets}',
  },
  tr: {
    'topBar': 'MOLA: alışveriş yap, kolu çek',
    'hintFloor': 'MOLA: Rehin Penceresi’nden alışveriş yap, sonra Banka Terminali’nde SALONU AÇ kolunu çek',
    'hintBell': 'VARDİYA ARASI: Rehin Penceresi’nden alışveriş yap, sonra Zil’i çalmak için Banka Terminali’ndeki kolu çek',
    'paidShort': '{n}. GECE ÖDENDİ',
    'summary': '{n}. GECE ÖDENDİ: yatırılan {dep}, faiz {int}, devreden {carry}, bilet {tickets}',
  },
};
