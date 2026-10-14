/**
 * Special rooms, host side (`ingame/roomsHost.ts`): toasts for keys, rooms, the Boiler and the Wash lockers, and the pressure chip.
 * Keys are `roomsx.<key>`. The wing names and the locker lines live in `game/rooms.strings.ts` (`rooms.*`).
 */
export default {
  prefix: 'roomsx.',
  en: {
    'keys.dawn': 'A Wing Key. A sealed grille is waiting.',
    'keys.boss': 'The boss is down. A Wing Key for it.',
    'keys.manager': 'The Manager\'s Key. Only the Counting Room takes it.',
    'opened': '{wing} is open.',
    'noKey': 'No key to spend.',
    'noFunds': 'BUY costs {p} coins.',
    'locked': 'The grille will not give.',
    'blown': 'The Boiler blew. It is shut until the next Watch.',
    'ventNone': 'Nothing to vent.',
    'ventFail': 'No pull to spare for the lever.',
    'chip': 'BOILER {p}%  x{m}',
    'chipBlown': 'BOILER BLOWN',
    'office.none': 'The Back Office wants 3 Tickets.',
  },
  tr: {
    'keys.dawn': 'Bir Kanat Anahtarı. Mühürlü bir parmaklık bekliyor.',
    'keys.boss': 'Patron yenildi. Karşılığında bir Kanat Anahtarı.',
    'keys.manager': 'Müdürün Anahtarı. Yalnız Sayım Odası onu alır.',
    'opened': '{wing} açıldı.',
    'noKey': 'Harcanacak anahtar yok.',
    'noFunds': 'SATIN ALMA {p} jeton.',
    'locked': 'Parmaklık yerinden oynamıyor.',
    'blown': 'Kazan patladı. Sonraki Vardiyaya kadar kapalı.',
    'ventNone': 'Boşaltılacak bir şey yok.',
    'ventFail': 'Kol için boşta çekiş yok.',
    'chip': 'KAZAN %{p}  x{m}',
    'chipBlown': 'KAZAN PATLADI',
    'office.none': 'Arka Büro 3 Bilet istiyor.',
  },
};
