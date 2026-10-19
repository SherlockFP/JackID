/**
 * Mahjong: Little Wall — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.mahjong.` (`prefix`).
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)` / the seat HUD.
 */
import type { MachineStrings } from '@/machines/_base/types';

const STRINGS: MachineStrings = {
  en: {
    name: 'Mahjong: Little Wall',
    desc: 'Seven tiles, six turns. Take or draw, then discard. Two melds and a pair win; sooner pays more.',
    take: 'TAKE', draw: 'DRAW', discards: 'DISCARDS', waits: 'WAITS', wall: 'WALL', turns: 'TURNS',
    mahjong: 'MAHJONG!', near: 'NEAR HAND', nearPay: 'NEAR HAND  {n}',
    bPure: 'PURE SUIT', bDragon: 'DRAGON', bTriplets: 'ALL TRIPLETS', bRuns: 'ALL RUNS',
    turnWin: 'Turn {n}',
    needPick: 'Take the upcard or draw from the wall first.',
    needDiscard: 'Discard a tile first.',
    hintOn: 'Hint ring on.', hintOff: 'Hint ring off.',
    suggestTake: 'Take this one', suggestDraw: 'Draw instead',

    // ── seat HUD (readability standard) ──
    goal: 'Build 2 melds and a pair before the beads run out. Sooner pays more.',
    rule1: 'You get 7 tiles and 6 turns (the brass beads). Each turn the House flips an upcard.',
    rule2: 'TAKE the upcard, or DRAW the next wall tile and the upcard is gone. Then discard one tile.',
    rule3: 'A hand of 8 tiles made of two melds and a pair is a MAHJONG and wins at once.',
    rule4: 'A meld is three of a kind, or a run of three in one suit (no wrapping). Dragons only make triplets.',
    rule5: 'Turn 1-3 pays x12, turn 4 x8, turn 5 x5, turn 6 x3. Pure suit x2.5, dragon triplet x1.5, all triplets x1.5, all runs x1.3. Top x60.',
    rule6: 'After the last turn, a hand one tile away (a NEAR HAND, the waits glow) pays x0.4.',
    rule7: 'Leaving mid-round plays the rest of the hand for you.',
    stBet: 'PLACE YOUR BET', stBetSub: 'Press [{deal}] to deal', stBusy: 'TILES MOVING…',
    stPick: 'TAKE OR DRAW?', stPickSub: 'Turn {n} of {t}  ·  a win now pays x{m}',
    stDisc: 'DISCARD ONE TILE', stDiscSub: 'Move [{left}] [{right}], then [{disc}]',
    stDone: 'ROUND OVER', stDoneSub: 'Press [{deal}] for a new hand',
    nTurn: 'TURN', nBet: 'BET', nPays: 'WIN PAYS', nWall: 'WALL', nBalance: 'BALANCE',
    cDeal: 'DEAL', cBet: 'BET', cTake: 'TAKE', cDraw: 'DRAW', cDiscard: 'DISCARD', cMove: 'MOVE',
    cHint: 'HINT', cRules: 'RULES', cLeave: 'LEAVE',
  },
  tr: {
    name: 'Mahjong: Küçük Duvar',
    desc: 'Yedi taş, altı tur. Al ya da çek, sonra at. İki per ve bir çift kazandırır; erken olan çok öder.',
    take: 'AL', draw: 'ÇEK', discards: 'ATILANLAR', waits: 'BEKLENEN', wall: 'DUVAR', turns: 'TURLAR',
    mahjong: 'MAHJONG!', near: 'YAKIN EL', nearPay: 'YAKIN EL  {n}',
    bPure: 'TEK TAKIM', bDragon: 'EJDERHA', bTriplets: 'HEP ÜÇLÜ', bRuns: 'HEP SIRA',
    turnWin: '{n}. tur',
    needPick: 'Önce açık taşı al ya da duvardan çek.',
    needDiscard: 'Önce bir taş at.',
    hintOn: 'İpucu halkası açık.', hintOff: 'İpucu halkası kapalı.',
    suggestTake: 'Bunu al', suggestDraw: 'Bunun yerine çek',

    // ── seat HUD (readability standard) ──
    goal: 'Boncuklar bitmeden 2 per ve bir çift kur. Erken olan çok öder.',
    rule1: '7 taşın ve 6 turun var (pirinç boncuklar). Her turda krupiye bir taş açar.',
    rule2: 'Açık taşı AL ya da duvardaki sıradaki taşı ÇEK; açık taş ölür. Sonra bir taş at.',
    rule3: 'İki per ve bir çiftten oluşan 8 taşlık el MAHJONG sayılır ve hemen kazandırır.',
    rule4: 'Per, üç aynı taş ya da aynı takımdan üçlü sıradır (başa dönmez). Ejderhalar yalnızca üçlü olur.',
    rule5: '1-3. tur x12, 4. tur x8, 5. tur x5, 6. tur x3 öder. Tek takım x2,5, ejderha üçlüsü x1,5, hep üçlü x1,5, hep sıra x1,3. En çok x60.',
    rule6: 'Son turdan sonra bir taş eksik el (YAKIN EL, beklenenler parlar) x0,4 öder.',
    rule7: 'Tur ortasında kalkarsan elin kalanı senin yerine oynanır.',
    stBet: 'BAHSİNİ YAP', stBetSub: '[{deal}] ile dağıt', stBusy: 'TAŞLAR HAREKET EDİYOR…',
    stPick: 'AL MI ÇEK Mİ?', stPickSub: '{n}. tur / {t}  ·  şimdi kazanırsan x{m}',
    stDisc: 'BİR TAŞ AT', stDiscSub: '[{left}] [{right}] ile seç, [{disc}] ile at',
    stDone: 'EL BİTTİ', stDoneSub: 'Yeni el için [{deal}]',
    nTurn: 'TUR', nBet: 'BAHİS', nPays: 'KAZANÇ', nWall: 'DUVAR', nBalance: 'BAKİYE',
    cDeal: 'DAĞIT', cBet: 'BAHİS', cTake: 'AL', cDraw: 'ÇEK', cDiscard: 'AT', cMove: 'GEZ',
    cHint: 'İPUCU', cRules: 'KURALLAR', cLeave: 'ÇIK',
  },
};

export default { prefix: 'm.mahjong.', en: STRINGS.en, tr: STRINGS.tr };
