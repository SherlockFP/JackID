/**
 * Three Card Poker — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.threecard.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Three Card Poker',
  desc: 'Beat the Shuffler with three cards. Ante, then Play or Fold. The dealer needs Queen-high. Pair Plus pays on your hand alone.',
  ante: 'Ante', play: 'Play', fold: 'Fold', pairPlus: 'Pair Plus', bonus: 'Ante Bonus',
  ready: 'Ready', deal: 'Deal', bet: 'Bet', bot: 'Shuffler',
  sBet: 'Place your ante', sWait: 'Waiting for the others', sDeal: 'Dealing', sDecide: 'Play or fold?',
  sReveal: 'Dealer reveals', sQual: 'QUALIFIES', sNoQual: 'NO QUALIFY', sSettle: 'Settling', sShuffle: 'Shuffling',
  sFoldWait: 'Folded, waiting', sWin: 'You win {n}', sLose: 'Dealer takes it', sPush: 'Push, bet returned',
  hClear: 'Clear table',
  rWin: 'WIN', rLose: 'LOSE', rPush: 'PUSH', rNq: 'NO QUALIFY', rFold: 'FOLD', rNone: 'PAIR PLUS',
  rHigh: 'HIGH CARD', rPair: 'PAIR', rFlush: 'FLUSH', rStraight: 'STRAIGHT', rTrips: 'THREE OF A KIND',
  rSf: 'STRAIGHT FLUSH', rRoyal: 'MINI ROYAL',
  dealer: 'DEALER {n}', dealerHidden: 'DEALER ? ? ?', totalLabel: 'TOTAL', potLabel: 'Stake',
  pp: 'PAIR+ {n}', anteLabel: 'ANTE {n}', tagBet: 'ANTE', tagPlay: 'PLAY', tagFold: 'FOLD',
  badBet: 'That bet is not allowed', busy: 'A hand is in progress', notYourTurn: 'Not your decision',
  noFunds: 'Not enough coins', decided: 'Decision made',
  hintPlay: 'Play', hintFold: 'Fold', hintSide: 'Pair Plus', hintRules: 'Rules',
  side: 'Pair Plus', anteStep: 'Ante', refund: 'Luck: stake refunded',

  // ── seat HUD (readability standard) ──
  hGoal: 'Beat the dealer with your three cards. The dealer needs Queen-high or better.',
  hTip1: 'Set your ante with [{down}]/[{up}]. [{pp}] adds the optional Pair Plus bet.',
  hTip2: 'Press [{ready}] to be dealt in. Then [{play}] PLAY (same as ante) or [{fold}] FOLD.',
  hTip3: '[{help}] FULL RULES  ·  any key closes a card',
  hRule1: 'Three cards each. Straight flush beats three of a kind, straight, flush, pair, then high card.',
  hRule2: 'Ante, then PLAY (same amount as the ante) or FOLD (the ante is lost). The dealer needs Queen-high or better.',
  hRule3: 'Beat the dealer: ante and play pay 1 to 1. Dealer does not qualify: the ante pays 1 to 1 and play is returned.',
  hRule4: 'ANTE BONUS pays when you play: straight 1 to 1, three of a kind 4 to 1, straight flush 5 to 1.',
  hRule5: 'PAIR PLUS pays on your hand alone, from a pair (1 to 1) up to straight flush (40 to 1). It needs no play.',
  hStWait: 'WAITING FOR THE OTHERS', hStBet: 'PLACE YOUR ANTE', hStBetSub: 'Press [{ready}] when ready',
  hStDeal: 'DEALING', hStDecide: 'PLAY OR FOLD?', hStDecideSub: 'Play adds {n} more. Fold loses the ante.',
  hStFolded: 'FOLDED, WAITING', hStPlayed: 'PLAYED, WAITING', hStReveal: 'DEALER REVEALS',
  hStSettle: 'SETTLING', hStEnd: 'ROUND OVER',
  hNAnte: 'ANTE', hNPp: 'PAIR PLUS', hNPlay: 'PLAY BET', hNHand: 'YOUR HAND', hNDealer: 'DEALER', hNBalance: 'BALANCE',
  hCReady: 'READY', hCAnte: 'ANTE', hCPp: 'PAIR PLUS', hCPlay: 'PLAY', hCFold: 'FOLD', hCRules: 'RULES', hCLeave: 'LEAVE',
};

const tr: Record<string, string> = {
  name: 'Üç Kart Poker',
  desc: 'Üç kartla Dağıtıcı\'yı yen. Ante koy, sonra Oyna ya da Katla. Krupiye en az Kız yüksekliğinde olmalı. Çift Artı yalnızca kendi elinde öder.',
  ante: 'Ante', play: 'Oyna', fold: 'Katla', pairPlus: 'Çift Artı', bonus: 'Ante Bonusu',
  ready: 'Hazır', deal: 'Dağıt', bet: 'Bahis', bot: 'Karıştırıcı',
  sBet: 'Antenini koy', sWait: 'Diğerleri bekleniyor', sDeal: 'Dağıtılıyor', sDecide: 'Oyna mı, katla mı?',
  sReveal: 'Krupiye açıyor', sQual: 'NİTELİKLİ', sNoQual: 'NİTELİKSİZ', sSettle: 'Hesaplanıyor', sShuffle: 'Karıştırılıyor',
  sFoldWait: 'Katladın, bekle', sWin: 'Kazandın {n}', sLose: 'Krupiye aldı', sPush: 'Berabere, bahis iade',
  hClear: 'Masa temizleniyor',
  rWin: 'KAZANDIN', rLose: 'KAYBETTİN', rPush: 'BERABERE', rNq: 'NİTELİKSİZ', rFold: 'KATLADI', rNone: 'ÇİFT ARTI',
  rHigh: 'YÜKSEK KART', rPair: 'ÇİFT', rFlush: 'RENK', rStraight: 'DÜZ', rTrips: 'ÜÇLÜ',
  rSf: 'RENKLİ DÜZ', rRoyal: 'MİNİ ROYAL',
  dealer: 'KRUPİYE {n}', dealerHidden: 'KRUPİYE ? ? ?', totalLabel: 'TOPLAM', potLabel: 'Bahis',
  pp: 'ÇİFT+ {n}', anteLabel: 'ANTE {n}', tagBet: 'ANTE', tagPlay: 'OYNA', tagFold: 'KATLA',
  badBet: 'Bu bahse izin verilmiyor', busy: 'Bir el devam ediyor', notYourTurn: 'Karar senin değil',
  noFunds: 'Yeterli jeton yok', decided: 'Karar verildi',
  hintPlay: 'Oyna', hintFold: 'Katla', hintSide: 'Çift Artı', hintRules: 'Kurallar',
  side: 'Çift Artı', anteStep: 'Ante', refund: 'Şans: bahis iade edildi',

  // ── seat HUD (readability standard) ──
  hGoal: 'Üç kartınla krupiyeyi yen. Krupiyenin en az Kız yüksekliğinde olması gerekir.',
  hTip1: 'Antenini [{down}]/[{up}] ile ayarla. [{pp}] isteğe bağlı Çift Artı bahsini ekler.',
  hTip2: 'Dağıtılmak için [{ready}] tuşuna bas. Sonra [{play}] OYNA (antenle aynı) ya da [{fold}] KATLA.',
  hTip3: '[{help}] TAM KURALLAR  ·  herhangi bir tuş kartı kapatır',
  hRule1: 'Herkese üç kart. Renkli düz, üçlü, düz, renk, çift ve yüksek kartı yener.',
  hRule2: 'Ante koy, sonra OYNA (antenle aynı tutar) ya da KATLA (ante kaybolur). Krupiye Kız yüksekliğinde ya da üstü olmalı.',
  hRule3: 'Krupiyeyi yenersen ante ve oyna 1\'e 1 öder. Krupiye nitelikli değilse ante 1\'e 1 öder, oyna iade edilir.',
  hRule4: 'ANTE BONUSU oynarsan öder: düz 1\'e 1, üçlü 4\'e 1, renkli düz 5\'e 1.',
  hRule5: 'ÇİFT ARTI yalnızca kendi elinde öder: çiftten (1\'e 1) renkli düze (40\'a 1) kadar. Oynamadan da koyabilirsin.',
  hStWait: 'DİĞERLERİ BEKLENİYOR', hStBet: 'ANTENİ KOY', hStBetSub: '[{ready}] ile hazır ol',
  hStDeal: 'DAĞITILIYOR', hStDecide: 'OYNA MI, KATLA MI?', hStDecideSub: 'Oynamak {n} daha koyar. Katlarsan ante kaybolur.',
  hStFolded: 'KATLADIN, BEKLE', hStPlayed: 'OYNADIN, BEKLE', hStReveal: 'KRUPİYE AÇIYOR',
  hStSettle: 'HESAPLANIYOR', hStEnd: 'EL BİTTİ',
  hNAnte: 'ANTE', hNPp: 'ÇİFT ARTI', hNPlay: 'OYNA BAHSİ', hNHand: 'SENİN ELİN', hNDealer: 'KRUPİYE', hNBalance: 'BAKİYE',
  hCReady: 'HAZIR', hCAnte: 'ANTE', hCPp: 'ÇİFT ARTI', hCPlay: 'OYNA', hCFold: 'KATLA', hCRules: 'KURALLAR', hCLeave: 'ÇIK',
};

export default { prefix: 'm.threecard.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
