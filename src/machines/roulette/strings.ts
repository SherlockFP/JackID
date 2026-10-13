/**
 * European Roulette — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.roulette.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Roulette "The Bone Wheel"',
    desc: 'A single-zero wheel run by the Rake. Place your chips, watch the bone ball, and pray the zero stays shut.',
    place: 'Place', remove: 'Remove', clear: 'Clear', spin: 'Spin', ready: 'Ready', rebet: 'Repeat',
    racetrack: 'Racetrack', neighbours: 'Neighbours {n}', callZero: 'Neighbours of Zero', callThird: 'Third of the Wheel',
    callOrphans: 'Orphans', callZeroGame: 'Zero Game',
    sOpen: 'Place your bets', sOpenShared: 'Bets close in {n}s', sLock: 'No more bets',
    sSpin: 'The ball is launched', sSettle: 'Ball settling', sPay: 'Paying out', sClear: 'Clearing the layout',
    sWait: 'Waiting for players',
    winNum: 'No. {n} {color}', red: 'RED', black: 'BLACK', green: 'ZERO',
    laPartage: 'La partage', zeroShield: 'Zero shield', nearMiss: 'So close...',
    win: 'WIN {n}', lose: 'Lost {n}', ghost: 'Ghost chip', hot: 'HOT {n}', cold: 'COLD {n}',
    pot: 'LAYOUT {n}', potLabel: 'Layout', history: 'LAST', noChips: 'Place a chip first', badSpot: 'That spot is not on the layout',
    limit: 'Table limit {n}', busy: 'The wheel is busy', noFunds: 'Not enough coins for this layout',
    fair: 'FAIR', wheelCam: 'Wheel cam', neighbourWidth: 'Neighbours ±{n}',
  },
  tr: {
    name: 'Rulet «Kemik Çark»',
    desc: 'Tek sıfırlı çark, Rake tarafından yönetiliyor. Fişlerini koy, kemik topu izle ve sıfırın kapalı kalmasına dua et.',
    place: 'Koy', remove: 'Kaldır', clear: 'Temizle', spin: 'Çevir', ready: 'Hazır', rebet: 'Tekrarla',
    racetrack: 'Pist', neighbours: 'Komşular {n}', callZero: 'Sıfır Komşuları', callThird: 'Çarkın Üçte Biri',
    callOrphans: 'Yetimler', callZeroGame: 'Sıfır Oyunu',
    sOpen: 'Bahislerini koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok',
    sSpin: 'Top fırlatıldı', sSettle: 'Top yerleşiyor', sPay: 'Ödeme yapılıyor', sClear: 'Masa temizleniyor',
    sWait: 'Oyuncular bekleniyor',
    winNum: '{n} {color}', red: 'KIRMIZI', black: 'SİYAH', green: 'SIFIR',
    laPartage: 'La partage', zeroShield: 'Sıfır kalkanı', nearMiss: 'Çok az kaldı...',
    win: 'KAZANÇ {n}', lose: 'Kayıp {n}', ghost: 'Hayalet fiş', hot: 'SICAK {n}', cold: 'SOĞUK {n}',
    pot: 'MASA {n}', potLabel: 'Masa', history: 'SON', noChips: 'Önce bir fiş koy', badSpot: 'Bu alan masada yok',
    limit: 'Masa limiti {n}', busy: 'Çark meşgul', noFunds: 'Bu masa için yeterli jeton yok',
    fair: 'ADİL', wheelCam: 'Çark kamerası', neighbourWidth: 'Komşular ±{n}',
  },
};
