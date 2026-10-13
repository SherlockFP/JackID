/**
 * Video Poker — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.videopoker.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`. Screen labels are kept short for the 5×7 bitmap font.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Video Poker',
    desc: 'Jacks Up or Deuces Down. Hold what pays, draw the rest, then double the win if you dare.',
    marquee: 'JACKS UP · DEUCES DOWN',
    gJacks: 'JACKS UP', gDeuces: 'DEUCES DOWN', game: 'Game',
    denom: 'Denom {n}', credits: 'CR {n}', bet: 'Bet', win: 'WIN {n}', pot: 'Win {n}',
    deal: 'Deal', draw: 'Draw', hold: 'Hold 1-5', held: 'HELD', pick: 'Pick 1-4', pickCard: 'PICK A CARD',
    double: 'Double x2', collect: 'Collect', hint: 'HINT', dealer: 'DEALER', doubles: 'DOUBLE {n}/5',
    lose: 'NO HIT', push: 'PUSH', bust: 'BUST', royal: 'ROYAL!', again: 'AGAIN',
    cat_royal: 'ROYAL', cat_naturalRoyal: 'NAT ROYAL', cat_wildRoyal: 'WILD ROYAL', cat_fourDeuces: '4 DEUCES',
    cat_kind5: '5 KIND', cat_sflush: 'S FLUSH', cat_quads: '4 KIND', cat_fullHouse: 'FULL HOUSE', cat_flush: 'FLUSH',
    cat_straight: 'STRAIGHT', cat_trips: '3 KIND', cat_twoPair: '2 PAIR', cat_jacks: 'JACKS+',
  },
  tr: {
    name: 'Video Poker',
    desc: 'Vale Yukarı ya da İkili Aşağı. Ödeyeni tut, kalanı çek, istersen kazancını ikiye kat.',
    marquee: 'VALE YUKARI · İKİLİ AŞAĞI',
    gJacks: 'VALE YUKARI', gDeuces: 'İKİLİ AŞAĞI', game: 'Oyun',
    denom: 'Değer {n}', credits: 'KR {n}', bet: 'Bahis', win: 'KAZANÇ {n}', pot: 'Kazanç {n}',
    deal: 'Dağıt', draw: 'Çek', hold: 'Tut 1-5', held: 'TUTULDU', pick: 'Seç 1-4', pickCard: 'KART SEÇ',
    double: 'İkiye Katla', collect: 'Topla', hint: 'İPUCU', dealer: 'KURPİYER', doubles: 'KATLAMA {n}/5',
    lose: 'OLMADI', push: 'BERABERE', bust: 'BATTI', royal: 'ROYAL!', again: 'TEKRAR',
    cat_royal: 'ROYAL', cat_naturalRoyal: 'DOĞAL ROYAL', cat_wildRoyal: 'JOKER ROYAL', cat_fourDeuces: '4 İKİLİ',
    cat_kind5: '5 AYNI', cat_sflush: 'DÜZ RENK', cat_quads: '4 AYNI', cat_fullHouse: 'FULL', cat_flush: 'RENK',
    cat_straight: 'DÜZ', cat_trips: '3 AYNI', cat_twoPair: 'İKİ ÇİFT', cat_jacks: 'VALE+',
  },
};
