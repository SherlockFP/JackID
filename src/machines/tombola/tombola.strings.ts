/**
 * Tombola Raffle Drum — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys register
 * under `m.tombola.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Tombola Raffle Drum',
  desc: 'Pay for a paper ticket, crank the drum and pull. Ends in 0 or 5 and the cubby pays. The Widow restocks when the drum runs low.',
  play: 'Play', pay: 'PAY {n}', crank: 'CRANK', pull: 'PULL', unfold: 'UNFOLD', feel: 'FEEL',
  left: 'TICKETS LEFT', ticket: 'TICKET {n}', blank: 'BLANK', win: 'WIN {n}', grand: 'GRAND PRIZE!',
  prize: '{n} COINS', prizeShort: '{n}P', ev: 'LIVE EV {n}%', restock: 'RESTOCK',
  queue: 'Someone is at the drum', ready: 'Ready', spectate: 'Watching the drum',
  sPay: 'Pay to play', sCrank: 'Crank the drum', sPull: 'Pull a ticket', sUnfold: 'Unfold your ticket',
  sRestock: 'The Widow is refilling the drum', sWait: 'Waiting for the next pull',
  busy: 'The drum is busy', alreadyPaid: 'You already paid for a ticket', noFunds: 'Not enough coins for a ticket',
  payFirst: 'Pay for a ticket first', crankFirst: 'Crank the drum first', noTicket: 'Pull a ticket first',
  feelNone: 'Only a blank can be dropped back', feelUsed: 'You already felt this ticket', noCharge: 'No feel left',
  badStake: 'Ticket stake 10 to 100 coins', notYours: 'Only the puller can do that',
  spare: 'Spare Number: the better ticket kept', lucky: 'Lucky slip',
  dropped: 'Blank dropped back', tchTch: 'Tch tch',
  hintPay: 'Pay', hintCrank: 'Crank', hintPull: 'Pull', hintUnfold: 'Unfold', hintFeel: 'Feel',
  hintRate: 'Stake', boardLabel: 'PRIZE SHELF', drumLabel: 'TOMBOLA',
  statEV: 'EV', statLeft: 'Left', statPrice: 'Price',
};

const tr: Record<string, string> = {
  name: 'Piyango Tamburu',
  desc: 'Bir kağıt bilet için öde, tamburu çevir ve çek. Sonu 0 veya 5 biten bilet, gözündeki ödülü kazandırır. Tamburu azalınca Dul Bilet Satıcısı yeniler.',
  play: 'Oyna', pay: 'ÖDE {n}', crank: 'ÇEVİR', pull: 'ÇEK', unfold: 'AÇ', feel: 'HİSSET',
  left: 'KALAN BİLET', ticket: 'BİLET {n}', blank: 'BOŞ', win: 'KAZANÇ {n}', grand: 'BÜYÜK İKRAMİYE!',
  prize: '{n} JETON', prizeShort: '{n}P', ev: 'CANLI BEKLENEN {n}%', restock: 'YENİLEME',
  queue: 'Tamburda biri var', ready: 'Hazır', spectate: 'Tamburu izliyorsun',
  sPay: 'Oynamak için öde', sCrank: 'Tamburu çevir', sPull: 'Bir bilet çek', sUnfold: 'Biletini aç',
  sRestock: 'Dul Bilet Satıcısı tamburu dolduruyor', sWait: 'Sıradaki çekiş bekleniyor',
  busy: 'Tamburu meşgul', alreadyPaid: 'Zaten bir bilet için ödedin', noFunds: 'Bilet için yeterli jeton yok',
  payFirst: 'Önce bir bilet için öde', crankFirst: 'Önce tamburu çevir', noTicket: 'Önce bir bilet çek',
  feelNone: 'Yalnızca boş bilet geri atılabilir', feelUsed: 'Bu bileti zaten hissettin', noCharge: 'Hissetme hakkı kalmadı',
  badStake: 'Bilet bahsi 10 ile 100 jeton arası', notYours: 'Bunu yalnızca çeken oyuncu yapabilir',
  spare: 'Yedek Numara: daha iyi bilet tutuldu', lucky: 'Şanslı kayma',
  dropped: 'Boş bilet geri atıldı', tchTch: 'Tık tık',
  hintPay: 'Öde', hintCrank: 'Çevir', hintPull: 'Çek', hintUnfold: 'Aç', hintFeel: 'Hisset',
  hintRate: 'Bahis', boardLabel: 'ÖDÜL RAFI', drumLabel: 'TOMBALA',
  statEV: 'BEKLENEN', statLeft: 'Kalan', statPrice: 'Fiyat',
};

export default { prefix: 'm.tombola.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
