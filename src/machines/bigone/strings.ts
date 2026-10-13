/**
 * The Big One — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.bigone.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'The Big One',
    desc: 'Five reels, fourteen patterns. Feed the curse, chase the jackpot.',
    spin: 'Spin', auto: 'Auto', autoStop: 'Stop', autoOn: 'AUTO {n}', autoSize: 'SIZE {n}',
    card: 'Patterns', fast: 'Fast', fastOn: 'Fast on',
    hunger: 'HUNGER', jackpot: 'JACKPOT', bet: 'Bet', eaten: 'EATEN', win: 'WIN {n}',
    hold: 'HOLD {n}', holdOff: 'Released', tease: 'So close...', respin: 'RESPIN', ward: 'WARD',
    cardTitle: 'PATTERNS', curseWarn: 'The Maw wakes',
    sym_MOTH: 'Moth', sym_TOOTH: 'Tooth', sym_KEY: 'Key', sym_CANDLE: 'Candle', sym_RING: 'Ring',
    sym_CROWN: 'Crown', sym_SUN: 'Sun', sym_MAW: 'Maw', sym_GHOST: 'Ghost',
    pat_TREY: 'Trey', pat_QUAD: 'Quad', pat_RAIL: 'Rail', pat_PILLAR: 'Pillar', pat_SLASH: 'Slash',
    pat_VALLEY: 'Valley', pat_PEAK: 'Peak', pat_CROSS: 'Cross', pat_PENTACLE: 'Pentacle', pat_HALO: 'Halo',
    pat_CLUSTER: 'Cluster', pat_FULL: 'Full', pat_TWIN_RAILS: 'Twin Rails', pat_CORNERSTONE: 'Cornerstone',
  },
  tr: {
    name: 'Büyük Vurgun',
    desc: 'Beş makara, on dört desen. Laneti besle, jackpot\'un peşinde ol.',
    spin: 'Çevir', auto: 'Oto', autoStop: 'Dur', autoOn: 'OTO {n}', autoSize: 'BOY {n}',
    card: 'Desenler', fast: 'Hızlı', fastOn: 'Hızlı açık',
    hunger: 'AÇLIK', jackpot: 'JACKPOT', bet: 'Bahis', eaten: 'YENDİ', win: 'KAZANÇ {n}',
    hold: 'TUT {n}', holdOff: 'Serbest', tease: 'Çok az kaldı...', respin: 'YENİDEN', ward: 'MUHAFIZ',
    cardTitle: 'DESENLER', curseWarn: 'Ağız uyanıyor',
    sym_MOTH: 'Güve', sym_TOOTH: 'Diş', sym_KEY: 'Anahtar', sym_CANDLE: 'Mum', sym_RING: 'Yüzük',
    sym_CROWN: 'Taç', sym_SUN: 'Güneş', sym_MAW: 'Ağız', sym_GHOST: 'Hayalet',
    pat_TREY: 'Üçlü', pat_QUAD: 'Dörtlü', pat_RAIL: 'Ray', pat_PILLAR: 'Sütun', pat_SLASH: 'Eğik',
    pat_VALLEY: 'Vadi', pat_PEAK: 'Zirve', pat_CROSS: 'Haç', pat_PENTACLE: 'Pentakl', pat_HALO: 'Hale',
    pat_CLUSTER: 'Küme', pat_FULL: 'Dolu', pat_TWIN_RAILS: 'İkiz Ray', pat_CORNERSTONE: 'Köşe Taşı',
  },
};
