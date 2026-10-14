/**
 * Bounty Board — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.bounty_board.` (MachineBase.t adds the prefix). Contract text lives here too: `c.<id>.t` (title) and
 * `c.<id>.d` (one line, what it pays). rules.ts reads these tables into each ContractDef.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_sign: 'SIGN', h_cash: 'CASH IN', h_drop: 'DROP', h_leave: 'LEAVE',
  ledger: 'BOUNTY BOARD', offers: 'OFFERS', active: 'SIGNED',
  pays: 'PAYS {n}', none: 'NO SLIPS TONIGHT', full: 'THREE SLIPS ALREADY',
  gone: 'SLIP TAKEN', notdone: 'NOT FINISHED', claimed: 'ALREADY PAID', expired: 'EXPIRED AT DAWN',
  signed: 'SIGNED: {n}', cashed: 'PAID: {n}', dropped: 'DROPPED: {n}',
  stamp: 'PAID', tickets: '{n} TICKETS', quota: '{n} % OF QUOTA',
  s_slips: 'SLIPS', s_tickets: 'TICKETS', s_pick: 'SLIP',
};

const tr: Record<string, string> = {
  h_pick: 'SEÇ', h_sign: 'İMZALA', h_cash: 'TAHSİL ET', h_drop: 'BIRAK', h_leave: 'AYRIL',
  ledger: 'İLAN PANOSU', offers: 'TEKLİFLER', active: 'İMZALI',
  pays: '{n} ÖDER', none: 'BU GECE PUSULA YOK', full: 'ZATEN ÜÇ PUSULA VAR',
  gone: 'PUSULA ALINDI', notdone: 'BİTMEDİ', claimed: 'ZATEN ÖDENDİ', expired: 'ŞAFAKTA SÜRESİ DOLDU',
  signed: 'İMZALANDI: {n}', cashed: 'ÖDENDİ: {n}', dropped: 'BIRAKILDI: {n}',
  stamp: 'ÖDENDİ', tickets: '{n} BİLET', quota: 'KOTANIN %{n}’İ',
  s_slips: 'PUSULA', s_tickets: 'BİLET', s_pick: 'PUSULA',

  'c.b_bj_streak.t': 'Üst Üste Üç El',
  'c.b_bj_streak.d': 'Blackjack’te üst üste 3 el kazan. 3 bilet.',
  'c.b_cross.t': 'Çapraz Vuruş',
  'c.b_cross.d': 'Büyük Çark’te ÇAPRAZ veya üstü tut. Kotanın %10’u.',
  'c.b_elevator5.t': 'Asansör Beş',
  'c.b_elevator5.d': 'Asansörü en az ×5’te boşalt. 2 bilet + kotanın %5’i.',
  'c.b_four_suits.t': 'Dört Takım',
  'c.b_four_suits.d': 'Bir Vardiyada 4 farklı takımda kazan. Sonraki molada Seyrek bir tılsım.',
  'c.b_point.t': 'Nokta',
  'c.b_point.d': 'Zar masasında bir nokta yap. 3 bilet.',
  'c.b_mines8.t': 'Sekiz Güvenli Kare',
  'c.b_mines8.d': 'Tek bir Mayın turunda 8 güvenli kare aç. Kotanın %5’i.',
  'c.b_derby6.t': 'Yarış ×6',
  'c.b_derby6.d': 'Derbi bahsini en az ×6’da kazan. 3 bilet.',
  'c.b_holdem_2p.t': 'İki Çift',
  'c.b_holdem_2p.d': 'Hold’em potunu iki çift veya üstüyle kazan. Kotanın %5’i.',
  'c.b_devil2.t': 'Şeytanın Masası',
  'c.b_devil2.d': 'Şeytanın Masası’nda iki el hayatta kal ve TOPLA. Bir sonraki ziyarette tezgâh altı yuvada Nadir çıkar.',
  'c.b_early_half.t': 'Erken Ödeme',
  'c.b_early_half.d': 'İkinci Vardiya’dan önce kotanın %50’sini yatır. Bu gece +%2 faiz.',
  'c.b_two_punch.t': 'Çift Delik',
  'c.b_two_punch.d': 'Bir Vardiya’da 2 hücre delik aç. 2 bilet.',
  'c.b_claw.t': 'Pençe Teslimatı',
  'c.b_claw.d': 'Pençe kapsülünü teslim et. 2 bilet.',
  'c.b_bigwin.t': 'Dev Kazanç',
  'c.b_bigwin.d': 'Herhangi bir ×25+ kazanç. Kotanın %10’u.',
  'c.b_ride5.t': 'Beş Yolculuk',
  'c.b_ride5.d': 'Yazı-tura yolculuklarında üst üste 5 kazan. 4 bilet.',
  'c.b_natural.t': 'Doğal',
  'c.b_natural.d': 'Baccarat’ta doğal ile kazan. 2 bilet.',
  'c.b_milestone.t': 'Kilometre Taşı',
  'c.b_milestone.d': 'Bir yükseltme kilometre taşına ulaş (S10 / 25 / 50 / 100). 3 bilet.',
  'c.b_staff25.t': 'Personel Payı',
  'c.b_staff25.d': 'Bu gece kotanın %25’ini personelden kazan. Kotanın %5’i.',
  'c.b_bell_night.t': 'Kâr Çanı Gecesi',
  'c.b_bell_night.d': 'Üç kez büyük veya üstü kazan. Bir Kâr Çanı tılsımı.',
};

const en2: Record<string, string> = {
  'c.b_bj_streak.t': 'Three in a Row',
  'c.b_bj_streak.d': 'Win 3 blackjack hands in a row. 3 Tickets.',
  'c.b_cross.t': 'Cross Hit',
  'c.b_cross.d': 'Hit a CROSS or better on The Big One. 10 % of quota.',
  'c.b_elevator5.t': 'Elevator Five',
  'c.b_elevator5.d': 'Cash out The Elevator at ×5 or more. 2 Tickets + 5 % of quota.',
  'c.b_four_suits.t': 'Four Suits',
  'c.b_four_suits.d': 'Win on 4 different suits in one Watch. An Uncommon charm next intermission.',
  'c.b_point.t': 'Point',
  'c.b_point.d': 'Make a point on craps. 3 Tickets.',
  'c.b_mines8.t': 'Eight Safe',
  'c.b_mines8.d': 'Clear 8 safe tiles in one Mines round. 5 % of quota.',
  'c.b_derby6.t': 'Derby Six',
  'c.b_derby6.d': 'Win a derby bet at ×6 or more. 3 Tickets.',
  'c.b_holdem_2p.t': 'Two Pair',
  'c.b_holdem_2p.d': 'Win a hold’em pot with two pair or better. 5 % of quota.',
  'c.b_devil2.t': "The Devil's Table",
  'c.b_devil2.d': "Survive 2 pulls at the Devil's Table and COLLECT. A Rare shows in the under-counter slot next visit.",
  'c.b_early_half.t': 'Early Half',
  'c.b_early_half.d': 'Deposit 50 % of quota before Watch 2. +2 % interest this Night.',
  'c.b_two_punch.t': 'Two Punches',
  'c.b_two_punch.d': 'Punch 2 cells in one Watch. 2 Tickets.',
  'c.b_claw.t': 'Capsule Delivery',
  'c.b_claw.d': 'Deliver a claw capsule. 2 Tickets.',
  'c.b_bigwin.t': 'Big Win',
  'c.b_bigwin.d': 'Any ×25+ win. 10 % of quota.',
  'c.b_ride5.t': 'Five Rides',
  'c.b_ride5.d': 'Win 5 coin-flip rides in a row. 4 Tickets.',
  'c.b_natural.t': 'Natural',
  'c.b_natural.d': 'Win a baccarat coup with a natural. 2 Tickets.',
  'c.b_milestone.t': 'Milestone',
  'c.b_milestone.d': 'Reach any upgrade milestone (L10 / 25 / 50 / 100). 3 Tickets.',
  'c.b_staff25.t': 'Staff Share',
  'c.b_staff25.d': 'Earn 25 % of the quota from staff this Night. 5 % of quota.',
  'c.b_bell_night.t': 'Bell Night',
  'c.b_bell_night.d': 'Win three times at BIG or better. Pays a Profit Bell totem.',
};

Object.assign(en, en2);

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.bounty_board.', en, tr };
