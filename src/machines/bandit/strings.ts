/**
 * One-Armed Bandit — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.bandit.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'One-Armed Bandit',
    desc: 'Three reels, one line, one lever.',
    pull: 'Pull', credits: 'Credits {n}', denom: 'Coin {n}', max: 'Max', thump: 'Thump',
    tilt: 'TILT', tiltMsg: 'The cabinet is locked. Wait.', nudge: 'LUCKY NUDGE', nearmiss: 'SO CLOSE',
    jackpot: 'JACKPOT', win: 'WIN {n}', hungry: 'The maw is hungry', swallowed: 'The maw swallows them',
    paytable: 'PAYTABLE', anyBar: 'ANY BAR', credit: 'CREDIT', bet: 'BET', lastWin: 'WIN',
    sym_STAR: 'STAR', sym_PLUM: 'PLUM', sym_ORANGE: 'ORANGE', sym_MELON: 'MELON', sym_BAR: 'BAR',
    sym_2BAR: '2BAR', sym_3BAR: '3BAR', sym_SHOE: 'SHOE',
    // seat HUD (readability standard)
    goal: 'Land a winning combination on the centre line',
    hi: 'HI', lo: 'LO', sym_BLANK: 'BLANK', gCard: 'Card {card}', gWin: 'RIGHT · x{n}', gPush: 'EQUAL · PUSH', gLose: 'WRONG · POT LOST',
    stGamble: 'HI OR LO ON THE NEXT CARD', stGambleSub: 'HI {hi} · LO {lo} · PUSH {tie}', nPot: 'POT', nOn: 'ON THE TABLE',
    cHi: 'HI', cLo: 'LO', cTake: 'COLLECT',
    stReady: 'PULL THE LEVER', stReadySub: 'STAKE {n}', stSpin: 'REELS SPINNING',
    stTilt: 'TILT · CABINET LOCKED', stTiltSub: 'Wait for it to reset',
    nBet: 'BET', nCredits: 'CREDITS', nCoin: 'COIN', nBalance: 'BALANCE', nLast: 'LAST WIN',
    cPull: 'PULL', cCredits: 'CREDITS', cCoin: 'COIN', cMax: 'MAX', cThump: 'THUMP', cRules: 'RULES', cLeave: 'LEAVE',
    rule1: 'Matching symbols on the centre line win. The paytable is on the glass.',
    rule2: 'Any three BARs pay a small win. More credits raise every payout.',
    rule3: 'Your bet is credits times coin. Stake changes are locked while the reels turn.',
    rule4: 'LUCKY NUDGE can move one reel one stop after a pull.',
    rule5: 'Five losses in a row and the maw swallows the pile. THUMP 3 times in 10 s locks the cabinet for 8 s.',
    rule6: 'Pays per credit: STAR 1000 · 3BAR 200 · 2BAR 100 · BAR 50 · MELON 100 · ORANGE 30 · PLUM 20 · SHOE 50 · any BAR 15.',
    rule7: 'After a win, HI or LO on the next card. A right guess multiplies the pot, an equal card keeps it, a wrong one loses it. COLLECT takes the pot.',
  },
  tr: {
    name: 'Tek Kollu Haydut',
    desc: 'Üç makara, tek hat, tek kol.',
    pull: 'Çek', credits: 'Kredi {n}', denom: 'Jeton {n}', max: 'Maks', thump: 'Vur',
    tilt: 'SARSINTI', tiltMsg: 'Makine kilitli. Bekle.', nudge: 'ŞANSLI İTME', nearmiss: 'ÇOK YAKIN',
    jackpot: 'JACKPOT', win: 'KAZANÇ {n}', hungry: 'Ağız aç', swallowed: 'Ağız hepsini yuttu',
    paytable: 'ÖDEME', anyBar: 'HER BAR', credit: 'KREDİ', bet: 'BAHİS', lastWin: 'KAZANÇ',
    sym_STAR: 'YILDIZ', sym_PLUM: 'EROZ', sym_ORANGE: 'PORTAKAL', sym_MELON: 'KAVUN', sym_BAR: 'BAR',
    sym_2BAR: '2BAR', sym_3BAR: '3BAR', sym_SHOE: 'NAL',
    // seat HUD (readability standard)
    goal: 'Ortadaki hatta kazandıran bir kombinasyon yakala',
    hi: 'ÜST', lo: 'ALT', sym_BLANK: 'BOŞ', gCard: 'Kart {card}', gWin: 'DOĞRU · x{n}', gPush: 'EŞİT · BERABERE', gLose: 'YANLIŞ · POT KAYBEDİLDİ',
    stGamble: 'SONRAKİ KARTTA ÜST YA DA ALT', stGambleSub: 'ÜST {hi} · ALT {lo} · BERABERE {tie}', nPot: 'POT', nOn: 'MASADAKİ',
    cHi: 'ÜST', cLo: 'ALT', cTake: 'AL',
    stReady: 'KOLU ÇEK', stReadySub: 'BAHİS {n}', stSpin: 'MAKARALAR DÖNÜYOR',
    stTilt: 'SARSINTI · MAKİNE KİLİTLİ', stTiltSub: 'Sıfırlanmasını bekle',
    nBet: 'BAHİS', nCredits: 'KREDİ', nCoin: 'JETON', nBalance: 'BAKİYE', nLast: 'SON KAZANÇ',
    cPull: 'ÇEK', cCredits: 'KREDİ', cCoin: 'JETON', cMax: 'MAKS', cThump: 'VUR', cRules: 'KURALLAR', cLeave: 'ÇIK',
    rule1: 'Ortadaki hatta aynı semboller kazandırır. Ödeme tablosu camda yazar.',
    rule2: 'Herhangi üç BAR küçük bir kazanç verir. Kredi arttıkça tüm ödemeler büyür.',
    rule3: 'Bahis = kredi × jeton. Makaralar dönerken bahis değiştirilemez.',
    rule4: 'ŞANSLI İTME, çekişten sonra bir makarayı bir adım oynatabilir.',
    rule5: 'Arka arkaya beş kayıpta ağız parayı yutar. 10 sn içinde 3 kez VUR, makineyi 8 sn kilitler.',
    rule6: 'Kredi başına ödeme: YILDIZ 1000 · 3BAR 200 · 2BAR 100 · BAR 50 · KAVUN 100 · PORTAKAL 30 · EROZ 20 · NAL 50 · her BAR 15.',
    rule7: 'Kazançtan sonra bir sonraki karta ÜST ya da ALT de: doğru tahmin potu çarpar, eşit kart potu korur, yanlış olan potu kaybettirir. AL potu çeker.',
  },
};
