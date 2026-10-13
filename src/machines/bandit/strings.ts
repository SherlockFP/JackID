/**
 * One-Armed Bandit — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.bandit.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'One-Armed Bandit',
    desc: 'Three reels, one line, one lever. The lever wants to be pulled a little harder.',
    pull: 'Pull', credits: 'Credits {n}', denom: 'Coin {n}', max: 'Max', thump: 'Thump',
    tilt: 'TILT', tiltMsg: 'The cabinet is locked. Wait.', nudge: 'LUCKY NUDGE', nearmiss: 'SO CLOSE',
    jackpot: 'JACKPOT', win: 'WIN {n}', hungry: 'The maw is hungry', swallowed: 'The maw swallows them',
    paytable: 'PAYTABLE', anyBar: 'ANY BAR', credit: 'CREDIT', bet: 'BET', lastWin: 'WIN',
    sym_STAR: 'STAR', sym_PLUM: 'PLUM', sym_ORANGE: 'ORANGE', sym_MELON: 'MELON', sym_BAR: 'BAR',
    sym_2BAR: '2BAR', sym_3BAR: '3BAR', sym_SHOE: 'SHOE',
  },
  tr: {
    name: 'Tek Kollu Haydut',
    desc: 'Üç makara, tek hat, tek kol. Kol her seferinde biraz daha sert çekilmek istiyor.',
    pull: 'Çek', credits: 'Kredi {n}', denom: 'Jeton {n}', max: 'Maks', thump: 'Vur',
    tilt: 'SARSINTI', tiltMsg: 'Makine kilitli. Bekle.', nudge: 'ŞANSLI İTME', nearmiss: 'ÇOK YAKIN',
    jackpot: 'JACKPOT', win: 'KAZANÇ {n}', hungry: 'Ağız aç', swallowed: 'Ağız hepsini yuttu',
    paytable: 'ÖDEME', anyBar: 'HER BAR', credit: 'KREDİ', bet: 'BAHİS', lastWin: 'KAZANÇ',
    sym_STAR: 'YILDIZ', sym_PLUM: 'EROZ', sym_ORANGE: 'PORTAKAL', sym_MELON: 'KAVUN', sym_BAR: 'BAR',
    sym_2BAR: '2BAR', sym_3BAR: '3BAR', sym_SHOE: 'NAL',
  },
};
