/**
 * Bingo Pinball "Tombala Langırtı" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are
 * registered under `m.bingopin.`. `{n}` placeholders are filled by `t(key, vars)`. Backglass and LED text must fit the canvas:
 * TR strings stay within 1.3 × the EN length (the backglass card uses only numbers and the short labels below).
 */
const en: Record<string, string> = {
  name: 'Bingo Pinball',
  desc: 'Plunge five balls into the numbered holes. Light the lines on the card. Buy an extra ball if you dare.',
  plunger: 'Plunger', nudge: 'Nudge', stake: 'Stake', buyBall: 'Buy ball', collect: 'Collect', hintInfo: 'Info', hintLeave: 'Leave',
  stakeLabel: 'Stake', ballLabel: 'BALL {n}/5', extrasLabel: 'EXTRA {n}/3', linesLabel: 'LINES',
  powerLabel: 'POWER {n}%', zoneSoft: 'SOFT', zoneMedium: 'MEDIUM', zoneHard: 'HARD',
  stBalls: 'READY', stRoll: 'ROLL', stOffer: 'OFFER', stPayout: 'PAYOUT', stTilt: 'TILT',
  card: 'CARD', tiltLamp: 'TILT', extraLamp: 'EXTRA', priceTag: 'PRICE {n}', freeSpace: 'FREE',
  line3: 'LINE x1', line4: 'LINE x20', line5: 'LINE x250', noLine: 'NO LINES',
  offerTitle: 'EXTRA BALL', offerHint: 'Space buys, C collects', offerCost: 'Buy for {n}',
  bought: 'Extra ball for {n}', collected: 'Collected', extrasDone: 'No more extras',
  rolledBack: 'Rolled back, free relaunch', boardFull: 'Board full', busy: 'Ball in flight',
  tilted: 'TILT! No pay', guardUsed: 'Tilt guard', hopped: 'Hop!', leaving: 'Finishing the balls...',
  goal: 'Light a line of five cells on your card with five balls.',
  bReady: 'PULL THE PLUNGER', bReadySub: 'Hold {fire}, let go to fire', bNext: 'NEXT BALL', bPull: 'POWER {n}%',
  bRoll: 'BALL ROLLING', bNudge: 'NUDGE NOW', bNudgeSub: 'Last moment: {nudge} moves the ball',
  bOffer: 'EXTRA BALL?', bOfferSub: 'Buy for {price} - {n}s left', bTilt: 'TILT', bTiltSub: 'No pay this game',
  bLeave: 'FINISHING THE BALLS',
  nBet: 'BET', nBall: 'BALL', nLines: 'LINES', nPower: 'POWER', nPrice: 'PRICE', nBalance: 'BALANCE',
  cPlunger: 'PLUNGER', cStake: 'STAKE', cNudge: 'NUDGE', cBuy: 'BUY BALL', cCollect: 'COLLECT', cRules: 'RULES', cLeave: 'LEAVE',
  rule1: 'Five balls drop into numbered holes and light the matching numbers on your card.',
  rule2: 'A line of three, four or five lit cells pays x1, x20 or x250 of the stake. Lines add up.',
  rule3: 'The plunger power picks the hole zone: soft, medium or hard. Weak shots roll back for free.',
  rule4: '{nudge} nudges the ball in its last 0.8 seconds, but a nudge can tilt the table and void the game.',
  rule5: 'After five balls you may buy up to three extra balls, priced on the LED.',
  infoTitle: 'BINGO PINBALL RULES',
  infoBody: 'Hold Space to pull the plunger, release to fire a ball. Five balls drop into the holes and light the matching numbers on your card. Any line of five lit cells pays. A and D nudge the ball in its last moments, but a nudge can tilt the table and void the game. After five balls you may buy extra balls.',
};

const tr: Record<string, string> = {
  name: 'Tombala Langırtı',
  desc: 'Beş bilyeyi numaralı deliklere fırlat. Karttaki çizgileri yak. Cesaret edersen ekstra bilye al.',
  plunger: 'Tetik', nudge: 'Sars', stake: 'Bahis', buyBall: 'Bilye al', collect: 'Topla', hintInfo: 'Bilgi', hintLeave: 'Ayrıl',
  stakeLabel: 'Bahis', ballLabel: 'BİLYE {n}/5', extrasLabel: 'EKSTRA {n}/3', linesLabel: 'ÇİZGİ',
  powerLabel: 'GÜÇ %{n}', zoneSoft: 'YUMUŞAK', zoneMedium: 'ORTA', zoneHard: 'SERT',
  stBalls: 'HAZIR', stRoll: 'YUVARLANIYOR', stOffer: 'TEKLİF', stPayout: 'ÖDEME', stTilt: 'TİLT',
  card: 'KART', tiltLamp: 'TİLT', extraLamp: 'EKSTRA', priceTag: 'FİYAT {n}', freeSpace: 'BEDAVA',
  line3: 'ÇİZGİ x1', line4: 'ÇİZGİ x20', line5: 'ÇİZGİ x250', noLine: 'ÇİZGİ YOK',
  offerTitle: 'EKSTRA BİLYE', offerHint: 'Boşluk alır, C toplar', offerCost: '{n} karşılığı al',
  bought: '{n} karşılığı ekstra bilye', collected: 'Toplandı', extrasDone: 'Ekstra kalmadı',
  rolledBack: 'Geri yuvarlandı, bedava tekrar', boardFull: 'Tahta dolu', busy: 'Bilye yolda',
  tilted: 'TİLT! Ödeme yok', guardUsed: 'Tilt koruması', hopped: 'Zıpladı!', leaving: 'Bilyeler bitiriliyor...',
  goal: 'Beş bilyeyle kartında beş hücrelik bir çizgiyi yak.',
  bReady: 'TETİĞİ ÇEK', bReadySub: '{fire} basılı tut, bırakınca ateşlenir', bNext: 'SIRADAKİ BİLYE', bPull: 'GÜÇ %{n}',
  bRoll: 'BİLYE YUVARLANIYOR', bNudge: 'ŞİMDİ SARS', bNudgeSub: 'Son anda {nudge} bilyeyi oynatır',
  bOffer: 'EKSTRA BİLYE?', bOfferSub: '{price} karşılığı al - {n} sn kaldı', bTilt: 'TİLT', bTiltSub: 'Bu oyunda ödeme yok',
  bLeave: 'BİLYELER BİTİRİLİYOR',
  nBet: 'BAHİS', nBall: 'BİLYE', nLines: 'ÇİZGİ', nPower: 'GÜÇ', nPrice: 'FİYAT', nBalance: 'BAKİYE',
  cPlunger: 'TETİK', cStake: 'BAHİS', cNudge: 'SARS', cBuy: 'BİLYE AL', cCollect: 'TOPLA', cRules: 'KURALLAR', cLeave: 'AYRIL',
  rule1: 'Beş bilye numaralı deliklere düşer ve kartındaki eşleşen sayıları yakar.',
  rule2: 'Üç, dört ya da beş yanan hücreli çizgi bahsin x1, x20 ya da x250’sini öder. Çizgiler toplanır.',
  rule3: 'Tetik gücü delik bölgesini seçer: yumuşak, orta ya da sert. Zayıf atışlar parasız geri döner.',
  rule4: '{nudge} bilyeyi son 0,8 saniyede sarsar, ama sarsıntı tilt yapıp oyunu boşa çıkarabilir.',
  rule5: 'Beş bilyeden sonra LED’de fiyatı yazan en fazla üç ekstra bilye alabilirsin.',
  infoTitle: 'TOMBALA LANGIRTI KURALLARI',
  infoBody: 'Tetiği basılı tutup Boşluk ile bırak, bilye fırlar. Beş bilye deliklere düşer ve kartındaki eşleşen sayıları yakar. Beş hücreli her çizgi öder. A ve D bilyeyi son anında sarsar, ama sarsıntı tilt yapıp oyunu boşa çıkarabilir. Beş bilyeden sonra ekstra bilye alabilirsin.',
};

export default { prefix: 'm.bingopin.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
