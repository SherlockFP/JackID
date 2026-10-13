/**
 * Moth Shrine — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered
 * under `m.shrine.` (MachineBase.t adds the prefix). `{n}` is filled by `t(key, vars)`. Omen names are the shrine's own
 * wording of the buff ids (`bl.<id>` blessings, `cu.<id>` curses); the buff effects themselves are the game's.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_light: 'LIGHT', h_leave: 'LEAVE',
  s_coins: 'COINS', s_cost: 'CANDLE', s_odds: 'ODDS', s_lit: 'LIT',
  ledger: 'MOTH SHRINE', lit: 'CANDLES LIT: {n}', ledgerHint: 'SPACE LIGHT A CANDLE',
  blessing: 'BLESSING', curse: 'CURSE', none: 'NO OMEN YET',
  once: 'ONE CANDLE PER WATCH', funds: 'NOT ENOUGH COINS', full: 'THE CASE IS FULL',
  cost: '{n} COINS', flame: 'The flame bends toward you', dark: 'The flame dies blue',
  'bl.blessing_steady_hand.n': 'Steady Hand', 'bl.blessing_steady_hand.d': 'Tilt grace +2 this Watch.',
  'bl.blessing_open_purse.n': 'Open Purse', 'bl.blessing_open_purse.d': '+15 % on your next 3 wins.',
  'bl.blessing_quiet.n': 'Quiet Mind', 'bl.blessing_quiet.d': 'Dread −15 this Watch.',
  'bl.blessing_far_sight.n': 'Far Sight', 'bl.blessing_far_sight.d': 'The next Watch’s lamps are shown now.',
  'cu.curse_heavy_pockets.n': 'Heavy Pockets', 'cu.curse_heavy_pockets.d': 'Walk and sprint −15 % this Watch.',
  'cu.curse_sour_luck.n': 'Sour Luck', 'cu.curse_sour_luck.d': 'Luck −4 for 6 plays.',
  'cu.curse_tithe.n': 'Tithe', 'cu.curse_tithe.d': 'Your next win is cut by 25 %.',
  'cu.curse_attention.n': 'Attention', 'cu.curse_attention.d': 'A Collector sighting this Watch. Dread +15.',
};

const tr: Record<string, string> = {
  h_light: 'YAK', h_leave: 'AYRIL',
  s_coins: 'PARA', s_cost: 'MUM', s_odds: 'ŞANS', s_lit: 'YANAN',
  ledger: 'GÜVE TAPINAĞI', lit: 'YANAN MUM: {n}', ledgerHint: 'BOŞLUK MUM YAK',
  blessing: 'NİMET', curse: 'LANET', none: 'HENÜZ ALAMET YOK',
  once: 'WATCH BAŞINA BİR MUM', funds: 'PARA YETMİYOR', full: 'KUTU DOLU',
  cost: '{n} PARA', flame: 'Alev sana doğru eğiliyor', dark: 'Alev mavi sönüyor',
  'bl.blessing_steady_hand.n': 'Sabit El', 'bl.blessing_steady_hand.d': 'Bu Watch eğim toleransı +2.',
  'bl.blessing_open_purse.n': 'Açık Cüzdan', 'bl.blessing_open_purse.d': 'Sonraki 3 kazancında +%15.',
  'bl.blessing_quiet.n': 'Sakin Zihin', 'bl.blessing_quiet.d': 'Bu Watch korku −15.',
  'bl.blessing_far_sight.n': 'Uzak Görüş', 'bl.blessing_far_sight.d': 'Sonraki Watch’ın lambaları şimdi görünür.',
  'cu.curse_heavy_pockets.n': 'Ağır Cepler', 'cu.curse_heavy_pockets.d': 'Bu Watch yürüme ve koşma −%15.',
  'cu.curse_sour_luck.n': 'Ekşi Şans', 'cu.curse_sour_luck.d': '6 oyun boyunca şans −4.',
  'cu.curse_tithe.n': 'Öşür', 'cu.curse_tithe.d': 'Bir sonraki kazancın %25 kesilir.',
  'cu.curse_attention.n': 'Dikkat', 'cu.curse_attention.d': 'Bu Watch bir Tahsildar görülür. Korku +15.',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.shrine.', en, tr };
