/**
 * World-owned player-facing strings (WORLD-SYS). Machine names and the "Play {name}" verb come from the shared
 * `common.*` and `m.<id>.*` tables; this file only holds the copy the world itself produces: prompts for pads,
 * locked wings and system devices, and the reasons a seat request can be refused.
 */
const strings = {
  prefix: 'world.',
  en: {
    'unavailable': 'Not available yet',
    'noSeat': 'No free seat',
    'betRange': 'Bet {min}–{max}',
    'use': 'Use {name}',
    'outOfOrder': 'Out of order',
    'forLease': 'FOR LEASE',
    'padLabel': 'Lease a machine',
    'padSub': 'Pad {size}',
    'wingClosed': 'Wing closed',
    'locked': 'Locked',
    'seat.busy': 'That seat is taken',
    'seat.locked': 'This machine is locked',
    'seat.ghost': 'Ghosts cannot play',
    'seat.seated': 'You are already seated',
    'seat.noseat': 'There is no such seat',
    'seat.timeout': 'The host did not answer',
  },
  tr: {
    'unavailable': 'Henüz kullanılamıyor',
    'noSeat': 'Boş koltuk yok',
    'betRange': 'Bahis {min}–{max}',
    'use': 'Kullan: {name}',
    'outOfOrder': 'Arızalı',
    'forLease': 'KİRALIK',
    'padLabel': 'Makine kirala',
    'padSub': 'Alan {size}',
    'wingClosed': 'Kanat kapalı',
    'locked': 'Kilitli',
    'seat.busy': 'O koltuk dolu',
    'seat.locked': 'Bu makine kilitli',
    'seat.ghost': 'Hayaletler oynayamaz',
    'seat.seated': 'Zaten oturuyorsun',
    'seat.noseat': 'Böyle bir koltuk yok',
    'seat.timeout': 'Ev sahibi yanıt vermedi',
  },
};

export default strings;
