/** The bank's toasts, the Settle interest line and the Settle countdown (wave 42, director decisions 2 and 4). Loaded by the `*.strings.ts` glob in main.ts. */
export default {
  prefix: 'bank.',
  en: {
    'deposit': 'Deposited {n} to the bank · pocket {p}',
    'credit': 'Phone deal: +{n} to the bank (it stays there until Dawn)',
    'settle': 'SETTLING · LEVER IN {s} S',
    'interest': 'BANK +{n} interest ({pct}%)',
    'interest.short': 'BANK +0 interest ({pct}%): pull {k} more to earn it',
    'interest.none': 'BANK +0 interest ({pct}%)',
  },
  tr: {
    'deposit': 'Bankaya {n} yatırıldı · cep {p}',
    'credit': 'Telefon anlaşması: bankaya +{n} (Şafağa kadar orada kalır)',
    'settle': 'KAPANIYOR · KOL {s} SN SONRA',
    'interest': 'BANKA +{n} FAİZ (%{pct})',
    'interest.short': 'BANKA +0 FAİZ (%{pct}): kazanmak için {k} çekiş daha',
    'interest.none': 'BANKA +0 FAİZ (%{pct})',
  },
};
