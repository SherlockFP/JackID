/**
 * Totem catalogue (BRIEF ADDENDUM 8, ORIGINAL names and effects inspired by radius items in co-op gambling games).
 * Every totem is a radius item: while placed, its `effects` are injected with `scope.radius` by items/totems.ts, so
 * machines and players only ever call `mod()`. Prices are coins from the Apothecary/curio stall.
 */
import type { TotemDef } from '@/game/types';

const T = (
  id: string, shape: string, color: number, radius: number, rarity: TotemDef['rarity'], price: number,
  carry: TotemDef['carry'], extra: Partial<TotemDef>, name: [string, string], desc: [string, string], icon: string,
): TotemDef => ({
  id, shape, color, radius, rarity, icon,
  affects: 'machines', carry, placeable: true, price: { currency: 'coin', amount: price },
  strings: {
    en: { name: name[0], desc: desc[0] },
    tr: { name: name[1], desc: desc[1] },
  },
  ...extra,
});

export const TOTEM_DATA: TotemDef[] = [
  T('lucky_idol', 'idol', 0xffd040, 4, 'common', 120, 'hand',
    { targets: 'allies', effects: [{ hook: 'luck', op: 'add', value: 1 }], uses: 40, durationS: 420, tags: ['luck'] },
    ['Lucky Idol', 'Şanslı Put'], ['+1 luck on machines inside its ring.', 'Halkası içindeki makinelerde +1 şans.'], 'icon.star'),
  T('loss_shield', 'ward', 0x60a0ff, 3, 'common', 150, 'hand',
    { targets: 'allies', effects: [{ hook: 'loss.refund', op: 'add', value: 0.2 }], uses: 6, durationS: 300, tags: ['shield'] },
    ['Loss Ward', 'Kayıp Muskası'], ['Losing rounds inside the ring refund 20 % (6 uses).', 'Halka içinde kaybeden turlar %20 iade eder (6 kullanım).'], 'icon.shield'),
  T('profit_bell', 'bell', 0xff8040, 5, 'uncommon', 260, 'hand',
    { targets: 'allies', effects: [{ hook: 'payout.mult', op: 'inc', value: 0.1 }], uses: 12, durationS: 360, tags: ['profit'] },
    ['Profit Bell', 'Kâr Çanı'], ['+10 % payouts on machines inside the ring (12 rounds).', 'Halka içindeki makinelerde +%10 ödeme (12 tur).'], 'icon.bell'),
  T('rewind_lantern', 'lantern', 0x80ff80, 2.5, 'rare', 300, 'backpack',
    { targets: 'owner', procs: [{ id: 'rewind', chance: 0.12, cooldownS: 60 }], durationS: 0, tags: ['rewind'] },
    ['Rewind Lantern', 'Geri Sarma Feneri'], ['12 % to rewind the last loss inside the ring. Cooldown 60 s.', 'Halka içinde son kaybı geri sarma şansı %12. Bekleme 60 sn.'], 'icon.candle'),
  T('magnet_horseshoe', 'horseshoe', 0xc0c0ff, 6, 'uncommon', 210, 'hand',
    { targets: 'owner', affects: 'players', effects: [{ hook: 'coin.magnet', op: 'add', value: 3 }], durationS: 300, tags: ['magnet'] },
    ['Coin Horseshoe', 'Madeni Nal'], ['Tray coins fly to you within 3 m of the ring.', 'Halka içinde tepsi paraları size uçar.'], 'icon.lock'),
  T('jinx_skull', 'skull', 0x8040ff, 4, 'legendary', 500, 'backpack',
    { targets: 'rivals', procs: [{ id: 'jinx', chance: 0.25, cooldownS: 30 }], effects: [{ hook: 'payout.mult', op: 'mult', value: 0.9 }], uses: 10, tags: ['jinx', 'versus'] },
    ['Jinx Skull', 'Uğursuz Kafatası'], ['Rivals inside the ring pay 10 % less. 25 % chance to jinx a round.', 'Halkadaki rakipler %10 az öder. Turda %25 uğursuzluk şansı.'], 'icon.skull'),
];
