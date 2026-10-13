/**
 * Scratch-Card Vendor — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.scratch.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 *
 * Keys starting with `lab` are painted onto the card canvases with the px5 bitmap font, which has no Turkish glyphs,
 * so those stay ASCII in both languages.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Scratch-Card Vendor',
    desc: 'Five cards, five prize tables. Pick a card, feed the slot, and scratch the foil before it gives up its secret.',
    marquee: 'SCRATCH & WIN',
    c0: 'PIT PENNY', c1: 'LUCKY LADDER', c2: 'HOUSE vs YOU', c3: 'BLOOD MOON', c4: 'THE DEEP END',
    vend: 'Vend', scratchAll: 'Scratch all', qty: 'Qty {n}', card: 'Card', prizes: 'Prizes', leftLabel: 'Left',
    price: 'Price {n}', paid: 'PAID {n}', won: 'WIN {n}', lost: 'No win', nearmiss: 'So close...', lucky: 'Lucky!',
    feat: 'HOUSE FEAT!', charm: 'Charm stamp', charmC: 'Common stamp', charmU: 'Uncommon stamp', charmR: 'Rare stamp',
    bin: 'Second chance {n}/10', binFree: 'Free PIT PENNY earned', free: 'FREE', scratchHint: 'Drag the coin over the foil',
    revealed: 'Revealed', batchLeft: '{n} to scratch', xray: 'X-ray on', discount: 'Discount {n}%',
    pleaseWait: 'Wait for the card', noVoucher: 'No voucher',
    tblTitle: 'PRIZE TABLE', tblLine: 'x{m}  {p}%',
    lab_snap: 'SNAP', lab_house: 'HOUSE', lab_yours: 'YOURS', lab_sunk: 'SUNK', lab_prize: 'PRIZE', lab_depth: 'DEPTH',
    lab_sym_bat: 'BAT', lab_sym_owl: 'OWL', lab_sym_skull: 'SKULL', lab_sym_blood: 'BLOOD',
  },
  tr: {
    name: 'Kazı Kazan Otomatı',
    desc: 'Beş kart, beş ödül tablosu. Bir kart seç, yuvayı besle ve sırrını vermeden folyoyu kazı.',
    marquee: 'KAZI & KAZAN',
    c0: 'KUYU KURUŞU', c1: 'ŞANSLI MERDİVEN', c2: 'EV ile SEN', c3: 'KAN AYI', c4: 'DERİN UÇ',
    vend: 'Çıkar', scratchAll: 'Hepsini kazı', qty: 'Adet {n}', card: 'Kart', prizes: 'Ödüller', leftLabel: 'Kalan',
    price: 'Fiyat {n}', paid: 'ÖDENDİ {n}', won: 'KAZANÇ {n}', lost: 'Kazanç yok', nearmiss: 'Çok az kaldı...', lucky: 'Şanslı!',
    feat: 'EV ÖZEL!', charm: 'Tılsım mührü', charmC: 'Yaygın mühür', charmU: 'Nadir mühür', charmR: 'Çok nadir mühür',
    bin: 'İkinci şans {n}/10', binFree: 'Bedava KUYU KURUŞU kazanıldı', free: 'BEDAVA', scratchHint: 'Madeni parayı folyo üstünde sürükle',
    revealed: 'Açıldı', batchLeft: '{n} kazınacak', xray: 'Röntgen açık', discount: 'İndirim %{n}',
    pleaseWait: 'Kartı bekle', noVoucher: 'Fiş yok',
    tblTitle: 'ÖDÜL TABLOSU', tblLine: 'x{m}  %{p}',
    lab_snap: 'KAPAN', lab_house: 'EV', lab_yours: 'SEN', lab_sunk: 'BATTI', lab_prize: 'ODUL', lab_depth: 'DERIN',
    lab_sym_bat: 'YARASA', lab_sym_owl: 'BAYKUS', lab_sym_skull: 'KAFATASI', lab_sym_blood: 'KAN',
  },
};
