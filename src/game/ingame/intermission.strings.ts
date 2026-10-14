/**
 * Free-roam Intermission strings: the HUD hint and the Night summary toast (`inGameState`). Loaded by the
 * `*.strings.ts` glob in main.ts. The Intermission modal strings stay in `ingame.strings.ts`.
 */
export default {
  prefix: 'interm.',
  en: {
    'hintFloor': 'INTERMISSION — shop at the Pawn Window, then pull OPEN THE FLOOR at the Debt Terminal',
    'hintBell': 'BETWEEN WATCHES — shop at the Pawn Window, then pull the lever at the Debt Terminal to ring the Bell',
    'paidShort': 'NIGHT {n} PAID',
    'summary': 'NIGHT {n} PAID — deposited {dep}, interest {int}, carried over {carry}, tickets {tickets}',
  },
  tr: {
    'hintFloor': 'ARA — Rehinci Penceresi’nden alışveriş yap, sonra Borç Terminali’nde KATI AÇ kolunu çek',
    'hintBell': 'WATCH ARASI — Rehinci Penceresi’nden alışveriş yap, sonra zili çalmak için Borç Terminali’nin kolunu çek',
    'paidShort': '{n}. GECE ÖDENDİ',
    'summary': '{n}. GECE ÖDENDİ — yatırılan {dep}, faiz {int}, devreden {carry}, bilet {tickets}',
  },
};
