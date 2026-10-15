/**
 * The rescue call (`src/game/rescue.ts`): the Collector's loan, offered when the pocket hits 0 with the quota unmet.
 * Same `hotline.` prefix as the other deals, so the booth finds the name / boon / cost lines. Loaded by the `*.strings.ts` glob.
 */
export default {
  prefix: 'hotline.',
  en: {
    'call.rescue': 'Empty pockets already? The Collector can lend. What you borrow is added to tonight\'s quota, and then some.',
    'deal.rescue.name': 'THE LOAN',
    'deal.rescue.boon': 'Get {c} coins now',
    'deal.rescue.cost': 'Tonight\'s quota +{q}',
    'toast.pocketEmpty': 'Pocket empty — the Collector is calling',
    'broke.bell': 'BELL: at the Debt Terminal, ring the Bell. This Watch ends and the bank keeps growing.',
  },
  tr: {
    'call.rescue': 'Cepler şimdiden boş mu? Tahsildar borç verebilir. Aldığın, bu Gecenin kotasına eklenir, hem de fazlasıyla.',
    'deal.rescue.name': 'BORÇ',
    'deal.rescue.boon': 'Şimdi {c} jeton al',
    'deal.rescue.cost': 'Bu Gece kota +{q}',
    'toast.pocketEmpty': 'Cep boş — Tahsildar arıyor',
    'broke.bell': 'ZİL: Banka Terminali’nde zili çal. Bu nöbet biter, banka büyümeye devam eder.',
  },
};
