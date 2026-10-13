/**
 * The Elevator — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.elevator.` (`prefix`).
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const STRINGS: MachineStrings = {
  en: {
    name: 'The Elevator',
    desc: 'Ride the service car up the shaft. Step off before the cable snaps.',
    marquee: 'SERVICE CAR',
    board: 'BOARDING', doors: 'DOORS CLOSING', ride: 'RIDING', snap: 'SNAP!', roof: 'ROOF!', after: 'WINCH RETURNING',
    stepOff: 'Step off', ride2: 'Ride', auto: 'AUTO {n}', autoOff: 'AUTO OFF', mult: 'x{n}', fell: 'FELL',
    cashed: 'OUT {n}', refund: 'REFUND', insured: 'INSURED', bonus: 'FLOOR +{n}',
    history: 'LAST CRASHES', fair: 'FAIR', floor: 'FLOOR {n}', closed: 'Doors are closed.',
    badBet: 'Stake must be 1 to 500.', tooLate: 'Too late, the cable already snapped.',
    debtor: 'Debtor {n}', stake: 'Stake',
  },
  tr: {
    name: 'Asansör',
    desc: 'Servis kabinine binip şaftta yüksel. Halat kopmadan önce in.',
    marquee: 'SERVİS KABİNİ',
    board: 'BİNİŞ', doors: 'KAPILAR KAPANIYOR', ride: 'YÜKSELİYOR', snap: 'KOPTU!', roof: 'ÇATI!', after: 'VİNÇ DÖNÜYOR',
    stepOff: 'İn', ride2: 'Bin', auto: 'OTO {n}', autoOff: 'OTO KAPALI', mult: 'x{n}', fell: 'DÜŞTÜ',
    cashed: 'ÇIKIŞ {n}', refund: 'İADE', insured: 'SİGORTALI', bonus: 'KAT +{n}',
    history: 'SON KIRILMALAR', fair: 'ADİL', floor: 'KAT {n}', closed: 'Kapılar kapalı.',
    badBet: 'Bahis 1 ile 500 arasında olmalı.', tooLate: 'Çok geç, halat çoktan koptu.',
    debtor: 'Borçlu {n}', stake: 'Bahis',
  },
};

export default { prefix: 'm.elevator.', en: STRINGS.en, tr: STRINGS.tr };
