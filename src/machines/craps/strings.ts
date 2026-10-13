/**
 * Craps "The Bone Pit" — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.craps.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`. `lay.*` keys are printed on the felt (model.ts).
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Craps "The Bone Pit"',
    desc: 'Sunken tub, black felt, a hooked stick and two red dice. Back the shooter or bet against them, and listen for the Hook.',
    // felt print
    'lay.pass': 'PASS LINE', 'lay.dpass': "DON'T PASS BAR", 'lay.come': 'COME', 'lay.dcome': "DON'T COME",
    'lay.odds': 'ODDS', 'lay.dodds': 'LAY ODDS', 'lay.field': 'FIELD', 'lay.any7': 'ANY SEVEN', 'lay.anycraps': 'ANY CRAPS',
    'lay.horn': 'HORN', 'lay.ce': 'C & E', 'lay.furnace': 'FURNACE', 'lay.big': 'BIG', 'lay.hard': 'HARD',
    'lay.p': 'PROP', 'lay.buy': 'BUY', 'lay.place': 'PLACE',
    // controls and hints
    throw: 'Throw', working: 'Working', maxOdds: 'Max odds', pressBet: 'Press', takeDown: 'Take down', horn: 'Horn',
    takeOdds: 'Take odds', leave: 'Leave', bet: 'Chip',
    // table calls and phases
    comeout: 'Come-out', point: 'Point {n}', pointOff: 'Puck off', sComeout: 'Come-out: any throw', sPoint: 'Point {n}: make it or seven out',
    sThrow: 'The Hook holds the dice', sRoll: 'Rolling', sSettle: 'Settling the layout', sSevenOut: 'Seven out',
    sNoRoll: 'No roll, throw again', sClose: 'Bets closed', sWait: 'Waiting for players',
    shooter: 'Shooter: {n}', youShoot: 'You shoot', callSeven: 'SEVEN', callYo: 'YO-ELEVEN', callCraps: 'CRAPS',
    callPointMade: 'POINT MADE', callHard: 'HARD {n}', callEasy: '{n}', callNoRoll: 'NO ROLL',
    shieldCaught: 'Hollow Dice catch the seven', newShooter: 'Dice go to {n}',
    // results
    win: 'WIN {n}', lose: 'Lost {n}', push: 'Push', furnace: 'FURNACE {n}', flames: '{n} flames',
    pot: 'LAYOUT {n}', potLabel: 'Layout', last: 'LAST 10', stake: 'Stake {n}',
    // refusals
    limit: 'Table limit {n}', propLimit: 'Props up to {n}', busy: 'Dice are in the air', notShooter: 'Only the shooter throws',
    needPass: 'Pass and Don’t Pass close on the come-out', needPoint: 'Come bets go on a point', noPass: 'Place a Pass line bet first',
    noComeBet: 'Place a Come bet first', oddsCap: 'Odds up to {n}', noFunds: 'Not enough coins for this bet',
    badSpot: 'That spot is not on the layout', hornUnit: 'Horn goes in fours', ceEven: 'C and E goes in twos',
    furnaceLimit: 'Furnace up to {n}', nothingToTake: 'Nothing to take down',
    fair: 'FAIR', rail: 'Rail {n}',
  },
  tr: {
    name: 'Craps «Kemik Çukuru»',
    desc: 'Çukur masa, siyah çuha, kancalı bir değnek ve iki kırmızı zar. Atıcıya oyna ya da karşısında dur; Kanca’yı dinle.',
    'lay.pass': 'PAS HATTI', 'lay.dpass': 'PAS DEĞİL ÇUBUK', 'lay.come': 'GEL', 'lay.dcome': 'GELME',
    'lay.odds': 'ORAN', 'lay.dodds': 'TERS ORAN', 'lay.field': 'SAHA', 'lay.any7': 'HERHANGİ YEDİ', 'lay.anycraps': 'HERHANGİ CRAPS',
    'lay.horn': 'BORAZAN', 'lay.ce': 'C & E', 'lay.furnace': 'OCAK', 'lay.big': 'BÜYÜK', 'lay.hard': 'ÇİFT',
    'lay.p': 'ÖZEL', 'lay.buy': 'AL', 'lay.place': 'YERLEŞTİR',
    throw: 'At', working: 'Çalışıyor', maxOdds: 'Maks oran', pressBet: 'Katla', takeDown: 'Geri al', horn: 'Borazan',
    takeOdds: 'Oranı al', leave: 'Ayrıl', bet: 'Fiş',
    comeout: 'Çıkış atışı', point: 'Puan {n}', pointOff: 'Kemik kapalı', sComeout: 'Çıkış: her atış geçerli', sPoint: 'Puan {n}: tut ya da yedi',
    sThrow: 'Kanca zarları tutuyor', sRoll: 'Zarlar dönüyor', sSettle: 'Masa hesaplanıyor', sSevenOut: 'Yedi, el bitti',
    sNoRoll: 'Atış geçersiz, tekrar at', sClose: 'Bahisler kapandı', sWait: 'Oyuncular bekleniyor',
    shooter: 'Atıcı: {n}', youShoot: 'Sen atıyorsun', callSeven: 'YEDİ', callYo: 'YO-ON BİR', callCraps: 'CRAPS',
    callPointMade: 'PUAN TUTTU', callHard: 'ÇİFT {n}', callEasy: '{n}', callNoRoll: 'ATIŞ GEÇERSİZ',
    shieldCaught: 'Içi Boş Zar yediyi tuttu', newShooter: 'Zarlar {n} kişisine geçti',
    win: 'KAZANÇ {n}', lose: 'Kayıp {n}', push: 'Berabere', furnace: 'OCAK {n}', flames: '{n} alev',
    pot: 'MASA {n}', potLabel: 'Masa', last: 'SON 10', stake: 'Bahis {n}',
    limit: 'Masa limiti {n}', propLimit: 'Özel bahisler en çok {n}', busy: 'Zarlar havada', notShooter: 'Yalnızca atıcı atabilir',
    needPass: 'Pas ve Pas Değil çıkış atışında kapanır', needPoint: 'Gel bahisleri bir puanda konur', noPass: 'Önce bir Pas hattı bahsi koy',
    noComeBet: 'Önce bir Gel bahsi koy', oddsCap: 'Oran en çok {n}', noFunds: 'Bu bahis için yeterli jeton yok',
    badSpot: 'Bu alan masada yok', hornUnit: 'Borazan dörderli konur', ceEven: 'C ve E ikişerli konur',
    furnaceLimit: 'Ocak en çok {n}', nothingToTake: 'Geri alınacak bir şey yok',
    fair: 'ADİL', rail: 'Kenar {n}',
  },
};
