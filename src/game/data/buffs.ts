/**
 * Buff, streak and nightly-event catalogue (BRIEF ADDENDUM 3, ADDENDUM 5 "Nightly random events").
 * Pure data: every number is a ModEffect the modifier pipeline folds. Code hooks live in src/game/buffs/*.
 * Strings are inline (BuffDef.strings / NightEventDef.strings) and registered by src/game/buffs/index.ts.
 */
import type { BuffDef, NightEventDef } from '@/game/types';
import type { ModEffect } from '@/game/modifiers.types';

const S = (en: { name: string; desc: string }, tr: { name: string; desc: string }): BuffDef['strings'] => ({ en, tr });

const tonic = (
  id: string, icon: string, kind: BuffDef['kind'], s: number, maxStacks: number, effects: ModEffect[],
  name: [string, string], desc: [string, string], extra: Partial<BuffDef> = {},
): BuffDef => ({
  id: `tonic.${id}`, kind, scope: 'player', icon, maxStacks, duration: { kind: 'seconds', s }, reapply: 'extend',
  effects, tags: ['tonic', ...(kind === 'debuff' ? ['curse'] : [])],
  strings: S({ name: name[0], desc: desc[0] }, { name: name[1], desc: desc[1] }),
  ...extra,
});

export const BUFF_DATA: BuffDef[] = [
  // ── tonics (Apothecary tonic_vendor) ──
  tonic('lucky_mint', 'icon.mint', 'buff', 120, 3, [{ hook: 'luck', op: 'add', value: 2 }],
    ['Lucky Mint', 'Lucky Mint'], ['+2 luck on every machine. Stacks.', 'Her makinede +2 şans. Üst üste eklenir.']),
  tonic('iron_nerve', 'icon.hand', 'buff', 90, 2, [{ hook: 'loss.refund', op: 'add', value: 0.05 }],
    ['Iron Nerve', 'Demir Sinir'], ['Losing rounds refund 5 % of the bet.', 'Kaybeden turlarda bahsin %5\'i iade.']),
  tonic('quick_pulse', 'icon.bolt', 'buff', 60, 1, [{ hook: 'speed.mult', op: 'mult', value: 0.8 }],
    ['Quick Pulse', 'Hızlı Nabız'], ['Machines resolve 20 % faster.', 'Makineler %20 daha hızlı sonuçlanır.']),
  tonic('cold_coffee', 'icon.drop', 'buff', 60, 2, [{ hook: 'player.actionSpeed', op: 'inc', value: 0.25 }],
    ['Cold Coffee', 'Soğuk Kahve'], ['Your hands move 25 % quicker.', 'Ellerin %25 daha hızlı hareket eder.']),
  tonic('dread_salts', 'icon.moon', 'buff', 45, 1, [{ hook: 'dread.add', op: 'add', value: -8 }],
    ['Dread Salts', 'Korku Tuzu'], ['The walls breathe less. Dread −8.', 'Duvarlar daha az nefes alır. Korku −8.']),
  tonic('energy_drink', 'icon.clock', 'buff', 0, 1, [{ hook: 'time.bonus', op: 'add', value: 20 }],
    ['Vending Energy', 'Otomat Enerjisi'], ['+20 s on this Watch clock.', 'Bu Watch saatine +20 sn.'], { duration: { kind: 'shift' } }),
  tonic('cursed_candy', 'icon.skull', 'debuff', 90, 2, [{ hook: 'luck', op: 'add', value: 6 }, { hook: 'dread.add', op: 'add', value: 6 }],
    ['Cursed Candy', 'Lanetli Şeker'], ['+6 luck, but the House whispers (+6 dread).', '+6 şans, ama Ev fısıldar (+6 korku).']),

  // ── hot / cold streaks (per machine instance, owner = instance) ──
  {
    id: 'hot', kind: 'buff', scope: 'instance', icon: 'icon.flame', maxStacks: 3,
    duration: { kind: 'seconds', s: 40 }, reapply: 'replace', tags: ['streak'],
    effects: [
      { hook: 'payout.mult', op: 'inc', value: 0.15 },
      { hook: 'heat.gain', op: 'mult', value: 1.5 },
    ],
    strings: S({ name: 'Hot Streak', desc: 'Winning heats this machine: +15 % payout per stack.' },
      { name: 'Sıcak Seri', desc: 'Kazanmak bu makineyi ısıtır: kademe başına +%15 ödeme.' }),
  },
  {
    id: 'cold', kind: 'debuff', scope: 'instance', icon: 'icon.eye', maxStacks: 1,
    duration: { kind: 'seconds', s: 60 }, reapply: 'refresh', tags: ['streak', 'curse'],
    effects: [{ hook: 'payout.mult', op: 'mult', value: 0.85 }],
    strings: S({ name: 'Cold Streak', desc: 'The machine has gone cold: payouts −15 %.' },
      { name: 'Soğuk Seri', desc: 'Makine soğudu: ödemeler −%15.' }),
  },
  {
    id: 'overheat', kind: 'debuff', scope: 'instance', icon: 'icon.flame', maxStacks: 1,
    duration: { kind: 'seconds', s: 25 }, reapply: 'refresh', tags: ['overheat', 'curse'],
    effects: [{ hook: 'speed.mult', op: 'mult', value: 1.5 }],
    strings: S({ name: 'Overheat', desc: 'Smoke curls out of the cabinet. It runs slower.' },
      { name: 'Aşırı Isınma', desc: 'Dolaptan duman yükseliyor. Daha yavaş çalışır.' }),
  },

  // ── bounty rewards ──
  {
    id: 'bounty.early_interest', kind: 'buff', scope: 'player', icon: 'icon.clock', maxStacks: 1,
    duration: { kind: 'shift' }, reapply: 'refresh', tags: ['bounty'],
    effects: [{ hook: 'interest.add', op: 'add', value: 0.1 }],
    strings: S({ name: 'Early Interest', desc: 'Interest at settle is +10 % higher this Night.' },
      { name: 'Erken Faiz', desc: 'Bu Gece kapanıştaki faiz +%10 daha yüksek.' }),
  },

  // ── co-op aura (player; refreshed every second while an ally stands near) ──
  {
    id: 'friend_glow', kind: 'buff', scope: 'player', icon: 'icon.heart', maxStacks: 3,
    duration: { kind: 'seconds', s: 4 }, reapply: 'replace', tags: ['aura'],
    aura: { radius: 3, needs: 'ally', perUnit: true },
    effects: [{ hook: 'luck', op: 'add', value: 1 }],
    strings: S({ name: 'Friendly Glow', desc: 'Standing near a friend: +1 luck per friend nearby.' },
      { name: 'Dost Işığı', desc: 'Bir dostun yanında: yakındaki dost başına +1 şans.' }),
  },
];


// ── nightly / global events ─────────────────────────────────────────────────────────────────────
const ev = (
  id: string, icon: string, weight: number, duration: number, effects: ModEffect[], exclusive: string,
  world: NightEventDef['world'],
  s: { name: [string, string]; desc: [string, string]; announce: [string, string] },
  extra: Partial<NightEventDef> = {},
): NightEventDef => ({
  id, icon, weight, duration, effects, exclusive, world,
  strings: {
    en: { name: s.name[0], desc: s.desc[0], announce: s.announce[0] },
    tr: { name: s.name[1], desc: s.desc[1], announce: s.announce[1] },
  },
  ...extra,
});

export const NIGHT_EVENT_DATA: NightEventDef[] = [
  ev('happy_hour', 'icon.star', 3, 90,
    [{ hook: 'payout.mult', op: 'mult', value: 1.25 }], 'mood', { lightColor: 0xffb060, lightLevel: 1.15 },
    { name: ['Happy Hour', 'Neşe Saati'], desc: ['Every payout +25 % for 90 s.', '90 sn boyunca her ödeme +%25.'],
      announce: ['HAPPY HOUR. THE HOUSE IS GENEROUS.', 'NEŞE SAATİ. EV CÖMERT.'] }),
  ev('blackout', 'icon.lamp', 2, 45,
    [{ hook: 'dread.add', op: 'add', value: 10 }], 'lights', { lightLevel: 0, keepLit: ['screens', 'phaseLamps'], dread: 12 },
    { name: ['Blackout', 'Karartma'], desc: ['The floor goes dark. Only screens stay lit. Dread +10.', 'Salon kararır. Yalnızca ekranlar yanar. Korku +10.'],
      announce: ['POWER FAILURE. DO NOT MOVE.', 'ELEKTRİK KESİLDİ. KIPIRDAMA.'] }),
  ev('lucky_moon', 'icon.moon', 2, 120,
    [{ hook: 'luck', op: 'add', value: 3 }, { hook: 'payout.mult', op: 'inc', value: 0.1 }], 'moon', { lightColor: 0xb8c8ff, fogMul: 0.7 },
    { name: ['Lucky Moon', 'Şanslı Ay'], desc: ['+3 luck and +10 % payouts while the moon watches.', 'Ay izlerken +3 şans ve +%10 ödeme.'],
      announce: ['THE MOON IS FULL. IT IS WATCHING YOU PLAY.', 'AY DOLUNAY. SENİ OYNARKEN İZLİYOR.'] }),
  ev('audit', 'icon.pin', 2, 90,
    [{ hook: 'payout.mult', op: 'mult', value: 0.85 }, { hook: 'dread.add', op: 'add', value: 5 }], 'mood', { lightColor: 0xd8d0a0 },
    { name: ['Audit', 'Denetim'], desc: ['Inspectors count every coin: payouts −15 %, dread +5.', 'Müfettişler her parayı sayar: ödemeler −%15, korku +5.'],
      announce: ['AUDIT IN PROGRESS. SMILE FOR THE CLERK.', 'DENETİM BAŞLADI. KATİBE GÜLÜMSE.'] }),
  ev('power_surge', 'icon.bolt', 1, 60,
    [{ hook: 'payout.mult', op: 'mult', value: 2 }, { hook: 'heat.gain', op: 'mult', value: 2 }, { hook: 'x.surge.fire', op: 'add', value: 0.04 }],
    'power', { lightColor: 0x60e0ff, lightLevel: 1.3 },
    { name: ['Power Surge', 'Güç Dalgalanması'], desc: ['Payouts ×2 and heat ×2, but every round risks a fire (overheat).', 'Ödemeler ×2, ısınma ×2; ama her turda yangın riski (aşırı ısınma).'],
      announce: ['POWER SURGE. EVERYTHING IS LOUDER. SO IS THE SMELL.', 'GÜÇ DALGALANMASI. HER ŞEY DAHA YÜKSEK. KOKU DA.'] }),
];
