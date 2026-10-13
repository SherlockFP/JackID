/**
 * Pişti — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.pisti.` (MachineBase.t adds the prefix). `{n}` / `{pot}` / `{pts}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Pişti',
  desc: 'Classic Turkish card table for 2 to 4 players. Match the table card or take it with a Jack. Pişti pays 10, a Jack pişti 20.',
  ready: 'Ready', bet: 'Stake', pot: 'Pot {pot}', bot: 'Bot', bot1: 'Apprentice', bot2: 'Regular', bot3: 'Shark',
  sBet: 'Stake and ready', sWait: 'Waiting for the others', sTurn: 'Your turn', sWatch: '{n} to play',
  sDeal: 'Dealing', sShuffle: 'Shuffling', sEnd: 'Final count', sSitOut: 'Sit out this hand',
  card: 'Card {n}', help: 'Rules', pisti: 'PİŞTİ!', jackPisti: 'JACK PİŞTİ!', take: 'TAKE', pass: 'PASS',
  win: 'WIN {n}', lose: 'LOST', refund: 'Stake returned', away: 'Left: auto-play',
  deckLeft: 'DECK {n}', tableLabel: 'TABLE', pts: '{n} PTS', majority: 'MOST CARDS +3',
  lblCards: 'cards', lblPisti: 'pişti', lblPts: 'points', scoreTitle: 'FINAL COUNT',
  badBet: 'That stake is not allowed', busy: 'A hand is in progress', notYourTurn: 'Not your turn',
  badCard: 'That card is not in your hand', noFunds: 'Not enough coins',
  rulesTitle: 'Pişti — rules',
  okLabel: 'OK',
  rule1: 'Players: 2 to 4. Each gets 4 cards, 4 go face up on the table.',
  rule2: 'On your turn play one card. Same rank as the table top takes the table.',
  rule3: 'A Jack takes the table whatever is on it.',
  rule4: 'Taking a one-card table with a match is PİŞTİ: 10 points. Jack on a Jack: 20.',
  rule5: 'A pişti on the last card of the game does not count.',
  rule6: 'Last capturer takes the leftovers. Count: A and J 1 each, 2♣ 2, 10♦ 3.',
  rule7: 'Most cards: 3 points. Pot goes to the top score; ties split.',
  rule8: 'Stake: coins from you into the pot. Hands are hidden; only your own cards show.',
};

const tr: Record<string, string> = {
  name: 'Pişti',
  desc: '2 ila 4 oyunculu klasik Türk kart masası. Masadaki kartla eşleş ya da Vale ile al. Pişti 10, Vale pişti 20 puan.',
  ready: 'Hazır', bet: 'Bahis', pot: 'Havuz {pot}', bot: 'Bot', bot1: 'Çırak', bot2: 'Müdavim', bot3: 'Köpekbalığı',
  sBet: 'Bahsini koy ve hazır ol', sWait: 'Diğerleri bekleniyor', sTurn: 'Sıra sende', sWatch: '{n} oynuyor',
  sDeal: 'Dağıtılıyor', sShuffle: 'Karışıyor', sEnd: 'Son sayım', sSitOut: 'Bu elde bekle',
  card: 'Kart {n}', help: 'Kurallar', pisti: 'PİŞTİ!', jackPisti: 'VALE PİŞTİ!', take: 'ALDI', pass: 'PAS',
  win: 'KAZANÇ {n}', lose: 'KAYBETTİN', refund: 'Bahis iade', away: 'Ayrıldı: otomatik oynanıyor',
  deckLeft: 'DESTE {n}', tableLabel: 'MASA', pts: '{n} PUAN', majority: 'EN ÇOK KART +3',
  lblCards: 'kart', lblPisti: 'pişti', lblPts: 'puan', scoreTitle: 'SON SAYIM',
  badBet: 'Bu bahis geçerli değil', busy: 'Bir el oynanıyor', notYourTurn: 'Sıra sende değil',
  badCard: 'Bu kart elinde yok', noFunds: 'Yeterli jeton yok',
  rulesTitle: 'Pişti — kurallar',
  okLabel: 'Tamam',
  rule1: 'Oyuncu: 2 ila 4. Herkese 4 kart, masaya 4 açık kart.',
  rule2: 'Sıran gelince bir kart oyna. Masanın üstüyle aynı değerdeki kart masayı alır.',
  rule3: 'Vale, üstünde ne olursa olsun masayı alır.',
  rule4: 'Tek kartlı masayı eşleşerek almak PİŞTİ: 10 puan. Valenin üstüne vale: 20.',
  rule5: 'Oyunun son kartıyla yapılan pişti sayılmaz.',
  rule6: 'Kalanları son alan kişi alır. Sayım: As ve Vale 1 er, 2♣ 2, 10♦ 3.',
  rule7: 'En çok kart: 3 puan. Havuz en yüksek puana gider; eşitlikte bölüşülür.',
  rule8: 'Bahis: senin jetonların havuza gider. Eller gizlidir; yalnız kendi kartların görünür.',
};

export default { prefix: 'm.pisti.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
