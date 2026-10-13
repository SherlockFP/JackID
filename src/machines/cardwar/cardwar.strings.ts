/**
 * War Table — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are registered
 * under `m.cardwar.` (MachineBase.t adds the prefix). `{n}`, `{card}`, `{v}` and `{s}` are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'War Table (War / Dragon-Tiger)',
  desc: 'Casino War on the lacquer table, or Dragon-Tiger between two carved heads. Bet, watch the cards turn, go to war on a tie or surrender. The Twin never blinks.',
  plaque: 'WAR · DRAGON-TIGER', variantWar: 'WAR', variantDt: 'DRAGON-TIGER',
  dragon: 'DRAGON', tiger: 'TIGER', tie: 'TIE', suited: 'SUITED TIE', big: 'BIG', small: 'SMALL', odd: 'ODD', even: 'EVEN',
  main: 'WAR', tieSide: 'TIE 10:1', war: 'WAR', burn: 'BURN 3', twin: 'THE TWIN',
  sOpen: 'Place your bets', sOpenWait: 'Waiting for the others', sLocked: 'Bets locked', sLock: 'No more bets',
  sDeal: 'Dealing', sCompare: 'Turning the cards', sTie: 'Tie! Go to war or surrender', sWar: 'WAR!',
  sReveal: 'Turning the heads', sSettle: 'Paying out', sShuffle: 'Shuffling the shoe', sIdle: 'The table is quiet',
  sVariant: 'Table switched to {v}', sVariantBusy: 'Clear the bets before you switch',
  rWin: 'WIN {n}', rLose: 'Lost', rPush: 'Push, stake back', rSurr: 'Surrendered, half back',
  rWarWon: 'War won', rWarLost: 'War lost', rDragon: 'DRAGON WINS', rTiger: 'TIGER WINS', rTie: 'TIE',
  rSuited: 'SUITED TIE', rComm: 'Tie {n}',
  hLock: 'Lock bets', hWar: 'Go to war', hSurrender: 'Surrender', hDragon: 'Dragon', hTiger: 'Tiger', hTieBet: 'Tie',
  hMain: 'Bet war', hClear: 'Clear', hReady: 'Ready', hSkip: 'Reveal',
  potLabel: 'Stake', roadLabel: 'ROAD', raiseLabel: 'Raise {n}', timerLabel: 'Decide: {s}s',
  peek: 'Dealer war card: {card}', peekRed: 'Dragon card is {c}', red: 'red', black: 'black',
  warBonusLine: 'The war pays the original too', tieHint: 'Your card tied the dealer',
  badBet: 'That bet is not allowed', limit: 'Limit {n} on that spot', busy: 'The table is busy',
  noBets: 'Place a bet first', notSeated: 'Sit down first', badSeat: 'Seats 7 and 8 are closed for War',
  noRaise: 'Not enough coins to go to war', notYourTie: 'Not your decision', noDecision: 'Nothing to decide',
  tableMax: 'Table limit {n} per seat', variantNo: 'Only the table can switch rules',
};

const tr: Record<string, string> = {
  name: 'Savaş Masası (Kart Savaşı / Ejder-Kaplan)',
  desc: 'Lake masasında Casino War, ya da iki oyulmuş kafa arasında Ejder-Kaplan. Bahsini koy, kartların dönmesini izle; beraberlikte savaşa gir ya da teslim ol. Dealer hiç göz kırpmaz.',
  plaque: 'SAVAŞ · EJDER-KAPLAN', variantWar: 'SAVAŞ', variantDt: 'EJDER-KAPLAN',
  dragon: 'EJDER', tiger: 'KAPLAN', tie: 'BERABERE', suited: 'AYNI KART', big: 'BÜYÜK', small: 'KÜÇÜK', odd: 'TEK', even: 'ÇİFT',
  main: 'SAVAŞ', tieSide: 'BERABERE 10:1', war: 'SAVAŞ', burn: 'YAK 3', twin: 'İKİZ',
  sOpen: 'Bahislerini koy', sOpenWait: 'Diğerleri bekleniyor', sLocked: 'Bahisler kilitlendi', sLock: 'Artık bahis yok',
  sDeal: 'Dağıtılıyor', sCompare: 'Kartlar çevriliyor', sTie: 'Berabere! Savaş ya da teslim', sWar: 'SAVAŞ!',
  sReveal: 'Başlar açılıyor', sSettle: 'Ödeniyor', sShuffle: 'Sabot karıştırılıyor', sIdle: 'Masa sessiz',
  sVariant: 'Masa {v} kurallarına geçti', sVariantBusy: 'Geçmeden önce bahisleri temizle',
  rWin: 'KAZANÇ {n}', rLose: 'Kaybettin', rPush: 'Berabere, bahis iade', rSurr: 'Teslim, yarısı iade',
  rWarWon: 'Savaş kazanıldı', rWarLost: 'Savaş kaybedildi', rDragon: 'EJDER KAZANDI', rTiger: 'KAPLAN KAZANDI', rTie: 'BERABERE',
  rSuited: 'AYNI KART', rComm: 'Beraberlik {n}',
  hLock: 'Bahisi kilitle', hWar: 'Savaşa gir', hSurrender: 'Teslim ol', hDragon: 'Ejder', hTiger: 'Kaplan', hTieBet: 'Beraberlik',
  hMain: 'Savaşa bahis', hClear: 'Temizle', hReady: 'Hazır', hSkip: 'Aç',
  potLabel: 'Bahis', roadLabel: 'YOL', raiseLabel: 'Artış {n}', timerLabel: 'Karar: {s}s',
  peek: 'Dealer savaş kartı: {card}', peekRed: 'Ejder kartı {c}', red: 'kırmızı', black: 'siyah',
  warBonusLine: 'Savaş öncekini de öder', tieHint: 'Kartın dealerinkiyle berabere',
  badBet: 'Bu bahis geçerli değil', limit: 'Bu noktada limit {n}', busy: 'Masa meşgul',
  noBets: 'Önce bir bahis koy', notSeated: 'Önce otur', badSeat: 'Savaşta 7. ve 8. koltuklar kapalı',
  noRaise: 'Savaşa girmek için yeterli jeton yok', notYourTie: 'Bu karar senin değil', noDecision: 'Karar bekleyen yok',
  tableMax: 'Koltuk başına masa limiti {n}', variantNo: 'Kuralları yalnızca masa değiştirir',
};

export default { prefix: 'm.cardwar.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
