/**
 * The Devil's Table — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.devilstable.` by the registry.
 * `{n}` / `{live}` / `{blank}` / `{name}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';
export const STRINGS: MachineStrings = {
  en: {
    name: "The Devil's Table",
    desc: 'Two shells, a hidden order and a horned dealer. Shoot yourself and keep the turn, or shoot him and risk it.',
    stake: 'Stake {n}', fire: 'Fire', aim: 'Aim', lower: 'Lower', items: 'Items',
    ride: 'Ride ×1.9', collect: 'Collect', self: 'You', bot: 'The Devil', devil: 'The Devil',
    round: 'ROUND {n}', charges: 'CHARGES', potLabel: 'Pot', rounds: 'Round',
    sBet: 'Place your stake', sLoad: 'The Devil loads {live} LIVE · {blank} BLANK',
    sCounts: '{live} LIVE · {blank} BLANK',
    sRound: 'Round {n} to {name}',
    modeShells: 'SHELLS', shLive: 'Live', shBlank: 'Blank', bang: 'BANG', click: 'Click', misfire: 'Misfire',
    mirror: 'Mirror', steal: 'Stolen', eject: 'Ejected', whisper: 'Shell #{n}: {shell}', chamberSeen: 'Chamber: {shell}',
    item_loupe: 'Loupe', item_tonic: 'Bitter Tonic', item_cuffs: 'Cuffs', item_mint: 'Lucky Mint', item_hacksaw: 'Hacksaw',
    item_burner: 'Burner Phone', item_inverter: 'Inverter', item_adrenaline: 'Adrenaline', item_pills: 'Expired Pills',
    item_chip: 'Loaded Chip', item_mirror: 'Mirror', item_coin: "Collector's Coin",
    busy: 'A match is already in progress', badBet: 'That stake is not allowed',
    illegal: 'That is not allowed now', noTarget: 'Pick a target', notYourTurn: 'Not your turn',
  },
  tr: {
    name: 'Şeytanın Masası',
    desc: 'İki mermi, gizli bir sıra ve boynuzlu bir krupiye. Kendini vur ve sırayı koru, ya da ona ateş et ve riske gir.',
    stake: 'Bahis {n}', fire: 'Ateş', aim: 'Nişan', lower: 'İndir', items: 'Eşyalar',
    ride: 'Ya Katla ×1.9', collect: 'Kasayı Al', self: 'Sen', bot: 'Şeytan', devil: 'Şeytan',
    round: 'TUR {n}', charges: 'ŞARJ', potLabel: 'Kasa', rounds: 'Tur',
    sBet: 'Bahsini koy', sLoad: 'Şeytan {live} CANLI · {blank} BOŞ yüklüyor',
    sCounts: '{live} CANLI · {blank} BOŞ',
    sRound: '{n}. tur {name}',
    modeShells: 'MERMİLER', shLive: 'Canlı', shBlank: 'Boş', bang: 'PATLADI', click: 'Tıkırtı', misfire: 'Tutukluk',
    mirror: 'Ayna', steal: 'Çalındı', eject: 'Çıkarıldı', whisper: 'Mermi #{n}: {shell}', chamberSeen: 'Odacık: {shell}',
    item_loupe: 'Büyüteç', item_tonic: 'Acı İksir', item_cuffs: 'Kelepçe', item_mint: 'Şanslı Nane', item_hacksaw: 'Testere',
    item_burner: 'Dinleme Telefonu', item_inverter: 'Ters Çevirici', item_adrenaline: 'Adrenalin', item_pills: 'Son Kullanma Hapı',
    item_chip: 'Dolu Jeton', item_mirror: 'Ayna', item_coin: 'Koleksiyoncu Parası',
    busy: 'Bir maç zaten sürüyor', badBet: 'Bu bahis geçerli değil',
    illegal: 'Şu an buna izin yok', noTarget: 'Bir hedef seç', notYourTurn: 'Sıra sende değil',
  },
};
