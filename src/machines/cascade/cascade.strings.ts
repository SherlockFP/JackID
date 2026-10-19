/**
 * Gilded Cascade — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob; the keys are registered under
 * `m.cascade.` (MachineBase.t adds the prefix). `{n}` / `{of}` placeholders are filled by `t(key, vars)`. The screen
 * lines are short on purpose: the cabinet canvas is 216 px wide and the bitmap font is 6 px a letter.
 */
const en: Record<string, string> = {
  name: 'Gilded Cascade',
  desc: 'Eight of a kind pays anywhere. Winners burst, new symbols fall, and orbs stack the multiplier.',
  // seat HUD
  goal: 'Land 8 or more of one symbol anywhere on the grid to win',
  stSpin: 'SPIN THE GRID', stSpinSub: 'BET {n}',
  stBusy: 'TUMBLING', stBusySub: 'Winners burst and new symbols fall',
  stFree: 'FREE SPINS {n}/{of}', stFreeSub: 'Every orb adds to the total multiplier',
  nBet: 'BET', nWin: 'THIS ROUND', nLast: 'LAST WIN', nBalance: 'BALANCE', nMult: 'MULTIPLIER', nSpins: 'SPINS LEFT',
  cSpin: 'SPIN', cBet: 'BET', cMax: 'MAX', cFast: 'FAST', cRules: 'RULES', cLeave: 'LEAVE',
  rule1: 'The House pays eight or more of one symbol, anywhere on the grid. More of them pay more.',
  rule2: 'Winning symbols burst, the rest fall and new ones drop in. The tumbling goes on while anything pays.',
  rule3: 'Orbs (x2 to x50) stay on the grid. When the tumbling stops, they add up and multiply that spin.',
  rule4: 'Four or more wheels pay 3x, 5x or 100x and start 15 free spins. Three wheels in a free spin add 5.',
  rule5: 'In free spins every orb adds to a total multiplier that never drops. Top win: 5000x the bet.',
  fastOn: 'Fast spins on', fastOff: 'Fast spins off',
  // cabinet screen
  hdrBet: 'BET {n}', hdrFree: 'FREE {n}/{of}', tumble: 'TUMBLE {n}',
  meterOrbs: 'ORBS', meterTotal: 'TOTAL',
  footWin: 'WIN', footRound: 'ROUND',
  // banners
  bMult: 'x{n}', bMultSub: 'ORBS MULTIPLY THE WIN',
  bFree: 'FREE SPINS', bFreeSub: '{n} SPINS',
  bMore: '+{n} SPINS', bMoreSub: 'THE WHEELS KEEP TURNING',
  bTease: 'ONE WHEEL SHORT',
  bBig: 'BIG WIN', bHuge: 'HUGE WIN', bMega: 'MEGA WIN', bMax: 'MAX WIN',
  bEnd: 'FREE SPINS OVER', bEndSub: 'TOTAL {n}',
};

const tr: Record<string, string> = {
  name: 'Yaldızlı Çağlayan',
  desc: 'Sekiz aynı sembol her yerde öder. Kazananlar patlar, yenileri düşer, küreler çarpanı katlar.',
  // seat HUD
  goal: 'Izgarada herhangi bir yerde 8 ya da daha fazla aynı sembolü yakala',
  stSpin: 'IZGARAYI ÇEVİR', stSpinSub: 'BAHİS {n}',
  stBusy: 'DÜŞÜYOR', stBusySub: 'Kazananlar patlar, yeni semboller düşer',
  stFree: 'BEDAVA DÖNÜŞ {n}/{of}', stFreeSub: 'Her küre toplam çarpana eklenir',
  nBet: 'BAHİS', nWin: 'BU TUR', nLast: 'SON KAZANÇ', nBalance: 'BAKİYE', nMult: 'ÇARPAN', nSpins: 'KALAN DÖNÜŞ',
  cSpin: 'ÇEVİR', cBet: 'BAHİS', cMax: 'MAKS', cFast: 'HIZLI', cRules: 'KURALLAR', cLeave: 'ÇIK',
  rule1: 'Kasa, ızgaranın herhangi bir yerinde sekiz ya da daha fazla aynı sembolü öder. Ne kadar çoksa o kadar çok öder.',
  rule2: 'Kazanan semboller patlar, kalanlar düşer, yenileri üstten gelir. Bir şey ödediği sürece düşüş sürer.',
  rule3: 'Küreler (x2 ile x50 arası) ızgarada kalır. Düşüş bitince toplanır ve o dönüşün kazancını çarpar.',
  rule4: 'Dört ya da daha fazla çark bahsin 3, 5 veya 100 katını öder ve 15 bedava dönüş açar. Bedava dönüşte üç çark 5 dönüş ekler.',
  rule5: 'Bedava dönüşlerde her küre, hiç düşmeyen bir toplam çarpana eklenir. En yüksek kazanç bahsin 5000 katıdır.',
  fastOn: 'Hızlı dönüş açık', fastOff: 'Hızlı dönüş kapalı',
  // cabinet screen
  hdrBet: 'BAHİS {n}', hdrFree: 'BEDAVA {n}/{of}', tumble: 'DÜŞÜŞ {n}',
  meterOrbs: 'KÜRE', meterTotal: 'TOPLAM',
  footWin: 'KAZANÇ', footRound: 'TUR',
  // banners
  bMult: 'x{n}', bMultSub: 'KÜRELER KAZANCI ÇARPAR',
  bFree: 'BEDAVA DÖNÜŞ', bFreeSub: '{n} DÖNÜŞ',
  bMore: '+{n} DÖNÜŞ', bMoreSub: 'ÇARKLAR DÖNMEYE DEVAM EDİYOR',
  bTease: 'BİR ÇARK EKSİK',
  bBig: 'BÜYÜK KAZANÇ', bHuge: 'DEV KAZANÇ', bMega: 'MEGA KAZANÇ', bMax: 'EN YÜKSEK KAZANÇ',
  bEnd: 'BEDAVA DÖNÜŞ BİTTİ', bEndSub: 'TOPLAM {n}',
};

export default { prefix: 'm.cascade.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
