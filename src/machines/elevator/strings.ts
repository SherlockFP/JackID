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
    // seat HUD (readability standard)
    goal: 'Step off with your multiplier before the cable snaps',
    stBoard: 'PLACE YOUR STAKE AND RIDE', stBoardSub: 'The doors close in {n}s',
    stIn: 'YOU ARE ON BOARD', stInSub: 'Waiting for the doors to close',
    stDoors: 'DOORS CLOSING', stRide: 'STEP OFF BEFORE THE SNAP', stRideSub: 'Each doubling adds a floor. The cable can snap any time.',
    stWatch: 'CAR IS RISING', stWatchSub: 'Your next ride boards after this car',
    stOut: 'CASHED OUT', stOutSub: 'You stepped off at x{n}', stFell: 'THE CABLE SNAPPED', stFellSub: 'The car crashed at x{n}',
    stRoof: 'ROOF!', stAfter: 'WINCH RETURNING', stIdle: 'WAITING FOR THE NEXT CAR',
    nStake: 'YOUR STAKE', nMult: 'MULTIPLIER', nCash: 'CASH OUT NOW', nAuto: 'AUTO CASH-OUT', nLast: 'LAST CRASH',
    nBalance: 'BALANCE', nOff: 'OFF',
    cRide: 'RIDE', cStake: 'STAKE', cAuto: 'AUTO CASH-OUT', cStepOff: 'STEP OFF', cLeave: 'LEAVE', cRules: 'RULES',
    tip1: 'The car climbs and the multiplier grows. Step off before the cable snaps.',
    tip2: '[{ride}] RIDE to board · [{bet}] CHANGE STAKE · [{auto}] AUTO CASH-OUT',
    tip3: 'While riding: [{out}] STEP OFF to keep your win. [{help}] FULL RULES.',
    rule1: 'The car climbs. The multiplier grows over time, one floor per doubling.',
    rule2: 'The crash point is drawn before the ride. Nobody sees it until the snap.',
    rule3: 'Step off to cash out at the current multiplier. Late presses can miss the snap.',
    rule4: 'Auto cash-out pays at the target you pick, such as x2 or x10.',
    rule5: 'Your stake is locked once the doors close. Leaving before that is free.',
    rule6: 'Riders still aboard at the roof (x250) are paid at the roof multiplier.',
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
    // seat HUD (readability standard)
    goal: 'Halat kopmadan önce çarpanın büyürken in',
    stBoard: 'BAHSİNİ KOY VE BİN', stBoardSub: 'Kapılar {n} saniye içinde kapanır',
    stIn: 'KABİNDESİN', stInSub: 'Kapıların kapanması bekleniyor',
    stDoors: 'KAPILAR KAPANIYOR', stRide: 'KOPMADAN ÖNCE İN', stRideSub: 'Her iki katta bir kat eklenir. Halat her an kopabilir.',
    stWatch: 'KABİN YÜKSELİYOR', stWatchSub: 'Bir sonraki binişin bu kabinden sonra',
    stOut: 'ÇIKTIN', stOutSub: 'x{n} çarpanda indin', stFell: 'HALAT KOPTU', stFellSub: 'Kabin x{n} çarpanda düştü',
    stRoof: 'ÇATI!', stAfter: 'VİNÇ DÖNÜYOR', stIdle: 'SIRADAKİ KABİN BEKLENİYOR',
    nStake: 'BAHSİN', nMult: 'ÇARPAN', nCash: 'ŞİMDİ ÇIKSAN', nAuto: 'OTO ÇIKIŞ', nLast: 'SON KIRILMA',
    nBalance: 'BAKİYE', nOff: 'KAPALI',
    cRide: 'BİN', cStake: 'BAHİS', cAuto: 'OTO ÇIKIŞ', cStepOff: 'İN', cLeave: 'AYRIL', cRules: 'KURALLAR',
    tip1: 'Kabin yükselir, çarpan büyür. Halat kopmadan önce in.',
    tip2: '[{ride}] BİN · [{bet}] BAHSİ DEĞİŞTİR · [{auto}] OTO ÇIKIŞ',
    tip3: 'Yükselirken [{out}] İN, kazancını korur. [{help}] TAM KURALLAR.',
    rule1: 'Kabin yükselir. Çarpan zamanla büyür, her iki katta bir kat.',
    rule2: 'Kırılma noktası yolculuk başlamadan çekilir. Kopana kadar kimse görmez.',
    rule3: 'İnersen o anki çarpandan çıkarsın. Geç basarsan halat koparken kalabilirsin.',
    rule4: 'Oto çıkış seçtiğin hedefte öder, örneğin x2 ya da x10.',
    rule5: 'Kapılar kapanınca bahsin kilitlenir. Ondan önce ayrılmak bedavadır.',
    rule6: 'Çatıda (x250) kabinde kalanlar çatı çarpanından ödenir.',
  },
};

export default { prefix: 'm.elevator.', en: STRINGS.en, tr: STRINGS.tr };
