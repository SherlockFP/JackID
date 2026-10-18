/**
 * Stake safety lines (`run.ts` stake confirm, the stake limit, the pulls and funds refusals, the bet clamp). The seat
 * HUD / machine toast reads these through `MachineBase.toastRefusal()` and `fitBet()`. Loaded by the `*.strings.ts` glob.
 */
export default {
  prefix: 'stake.',
  en: {
    'confirm': 'PRESS AGAIN TO CONFIRM: {amount} of your {pocket} coins',
    'cap': 'Above this Night\'s stake limit: max {max}',
    'highMin': 'HIGH TABLE minimum: {min}',
    'pulls': 'No pulls left this Watch. Ring the bell or wait for Mola',
    'phase': 'The floor is closed right now',
    'clamped': 'Bet lowered to {bet} (pocket {pocket})',
    'minBet': 'Min bet {min}, pocket {pocket}',
  },
  tr: {
    'confirm': 'ONAYLAMAK İÇİN TEKRAR BAS: {pocket} jetonun {amount} tanesi',
    'cap': 'Bu Gece’nin bahis sınırının üstü: en çok {max}',
    'highMin': 'HIGH TABLE asgarisi: {min}',
    'pulls': 'Bu Vardiyada çekiş kalmadı. Zili çal ya da Mola’yı bekle',
    'phase': 'Salon şu an kapalı',
    'clamped': 'Bahis {bet} değerine indirildi (cep {pocket})',
    'minBet': 'Min bahis {min}, cep {pocket}',
  },
};
