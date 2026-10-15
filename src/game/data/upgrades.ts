/**
 * Tycoon DATA (GAME-TYCOON, Haiku-owned): instance tracks, pit-wide House Improvements, machine-family milestone
 * features, staff, wings, order pricing and the Foundations meta tree. Pure data — no three, kit or DOM.
 * Contract: BRIEF ADDENDUM 1 + 3 + 5, GDD §3.7 / §3.8.8 / §11.2–11.3 (Appendix B device tiers and patron rates).
 *
 * Upgrades are never written one by one: the 6 instance tracks below are expanded against every registered machine
 * by `game/tycoon/catalog.ts` (templates × machines × levels ≈ thousands of purchasable levels).
 */
import type { MachineId } from '@/core/types';
import type { SlotSize } from '@/core/types';
import type { SymbolId } from '@/core/texgen/types';
import type { ModEffect, ModHook } from '@/game/modifiers.types';
import type {
  CostCurve, EffectCurve, MachineFilter, MetaNode, MetaState, MilestoneDef, OrderPricing, StaffDef, TycoonNoReason,
  UpgradeTemplate, WingDef,
} from '@/game/tycoon.types';
import { costAt, valueAt } from '@/game/tycoon.types';
import { foldEffects } from '@/game/modifiers.types';
import { KEYRING, wingStrings } from '@/game/data/rooms';

const tx = (key: string): { en: { name: string; desc: string }; tr: { name: string; desc: string } } => ({
  en: { name: `tyc.${key}.name`, desc: `tyc.${key}.desc` },
  tr: { name: `tyc.${key}.name`, desc: `tyc.${key}.desc` },
});

/** Track id that only applies to devices with `idleYield > 0` (staffable). */
export const STAFF_TRACK = 'staff';

/** Catalogue tier per device (GDD Appendix B). Drives `tier` cost multipliers (1 → 1.0, 2 → 0.9, 3 → 0.8). Unknown = 1. */
export const DEVICE_TIER: Partial<Record<MachineId, 1 | 2 | 3>> = {
  bigone: 1, bandit: 1, videopoker: 1, elevator: 1, scratch: 1, roulette: 1, blackjack: 1, holdem: 1, devilstable: 1,
  pisti: 1, sonkart: 1, tavla: 1,
  pachislot: 2, pachinko: 2, plinko: 2, coinpusher: 2, cyclone: 2, mines: 2, dicetower: 2, lootbox: 2, baccarat: 2,
  craps: 2, sicbo: 2, bigsix: 2, cardwar: 2, hilo: 2, keno: 2, derby: 2, fortuneteller: 2, coinflip: 2,
  claw: 3, stacker: 3, fruitmachine: 3, bingopin: 3, threecard: 3, reddog: 3, bingo: 3, lottoblower: 3, tombola: 3,
  shellgame: 3, fantan: 3, teetotum: 3,
};
/** Plays per minute at ×1 speed (Appendix B `patronRate`). Shills play at 0.5 × this. Missing = not auto-playable. */
export const PATRON_RATE: Partial<Record<MachineId, number>> = {
  bigone: 8, bandit: 10, videopoker: 6, elevator: 4, scratch: 6, pachislot: 9, pachinko: 2, plinko: 8, coinpusher: 5,
  cyclone: 8, mines: 6, dicetower: 4, lootbox: 3, claw: 2, stacker: 3, fruitmachine: 8, bingopin: 3, roulette: 3.5,
  blackjack: 1.4, holdem: 1.2, baccarat: 2.2, craps: 4, sicbo: 3, bigsix: 3, cardwar: 3.5, hilo: 3, keno: 2.4,
  derby: 1.3, coinflip: 6, threecard: 2.2, reddog: 3, bingo: 0.8, lottoblower: 0.5, tombola: 2.5, fantan: 3, teetotum: 1.5,
};

/** Cost tier multipliers (catalogue tier 1..3). */
const TIER_COST: number[] = [1, 0.9, 0.8];
/** Cost curves ignore the slot size (used by house-wide prices). */
const FLAT_SIZE: Record<SlotSize, number> = { S: 1, M: 1, L: 1, XL: 1 };

// ── milestone ladder shared by every family ─────────────────────────────────────────────────────
/** Payout ladder: the multiplicative (M) part is the same for every device; the device feature rides on top. */
const PAYOUT_LADDER: MilestoneDef[] = [
  { level: 10, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.05 }], visual: 'brass_trim', text: 'upg.payout.milestone.10' },
  { level: 25, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.10 }], visual: 'gold_marquee', text: 'upg.payout.milestone.25' },
  { level: 50, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.20 }], visual: 'crown_topper', text: 'upg.payout.milestone.50' },
  { level: 100, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.35 }], visual: 'gilded_cabinet', text: 'upg.payout.milestone.100' },
];

/**
 * Device features per milestone (GDD §3.7.4). Four entries = L10 / L25 / L50 / L100. `a|b` grants two features at one
 * level. `luck+5` adds `+5 luck` on the instance instead of a feature name. Other devices get `milestone.L<n>` features.
 */
export const FAMILY_FEATURES: Record<MachineId, [string, string, string, string]> = {
  bigone: ['bigone.jackpotFeed', 'bigone.extraPattern.CORNERSTONE', 'bigone.wildChance', 'bigone.extraPattern.TWIN_RAILS|bigone.holdReel'],
  bandit: ['bandit.extraLine', 'bandit.shoeWild', 'bandit.thirdCoinBonus', 'bandit.symbolPayAdd.STAR'],
  videopoker: ['videopoker.hintOptimal', 'videopoker.payTableUpgrade', 'videopoker.bonusQuads', 'videopoker.royalBonus'],
  elevator: ['elevator.floorBonus', 'elevator.lateStep', 'elevator.autoInsurance', 'luck+5'],
  scratch: ['scratch.xray', 'scratch.discount', 'scratch.secondChance', 'scratch.topPrizeMult'],
  pachislot: ['pachislot.settingPeek', 'pachislot.slipFrames', 'pachislot.settingShift', 'pachislot.bonusGames'],
  pachinko: ['pachinko.tulipBoost', 'pachinko.holdMax', 'pachinko.kakuhenRate', 'pachinko.sweetWiden'],
  plinko: ['plinko.goldenSlot', 'plinko.extraPuck', 'plinko.safetyFloor', 'plinko.edgeMult'],
  coinpusher: ['m.coinpusher.wallsUp', 'm.coinpusher.goldCoin', 'm.coinpusher.prizeChance', 'm.coinpusher.trayMagnet'],
  cyclone: ['cyclone.slowMo', 'cyclone.jpWindow', 'cyclone.secondLight', 'cyclone.jpMult'],
  mines: ['mines.scanner', 'mines.edgeBonus', 'mines.insurance', 'mines.capRaise'],
  dicetower: ['dicetower.fieldBoost', 'dicetower.sevenPay', 'dicetower.parlay', 'dicetower.shooterBonus'],
  lootbox: ['lootbox.pityAt', 'lootbox.rerollToken', 'lootbox.discount', 'lootbox.cursedOdds'],
  claw: ['m.claw.xray', 'm.claw.timer', 'm.claw.weakCarry', 'm.claw.magnet'],
  stacker: ['m.stacker.saveCell', 'x.stacker.extraBlock', 'm.stacker.minorMult', 'm.stacker.majorCharm'],
  fruitmachine: ['fruitmachine.gambleSafety', 'fruitmachine.holdOdds', 'fruitmachine.trailStart', 'luck+5'],
  bingopin: ['bingopin.freeSpace', 'bingopin.tiltGuard', 'bingopin.extraBallDiscount', 'bingopin.lineMult.5'],
} as Record<MachineId, [string, string, string, string]>;

/**
 * Machine-hook effects behind the device features above (hook names match the machine's `HOOK_*` constants). A feature
 * name alone is only a flag, so each one that a machine reads through `mod()` also carries its modifier here.
 */
const FEATURE_EFFECTS: Partial<Record<string, ModEffect[]>> = {
  'm.coinpusher.wallsUp': [{ hook: 'm.coinpusher.wallsUp' as ModHook, op: 'add', value: 5 }],
  'm.coinpusher.goldCoin': [{ hook: 'm.coinpusher.goldCoin' as ModHook, op: 'add', value: 0.02 }],
  'm.coinpusher.prizeChance': [{ hook: 'm.coinpusher.prizeChance' as ModHook, op: 'mult', value: 1.25 }],
  'm.coinpusher.trayMagnet': [{ hook: 'm.coinpusher.trayMagnet' as ModHook, op: 'add', value: 0.15 }],
  'm.claw.xray': [{ hook: 'm.claw.xray' as ModHook, op: 'add', value: 1 }],
  'm.claw.timer': [{ hook: 'm.claw.timer' as ModHook, op: 'add', value: 3 }],
  'm.claw.weakCarry': [{ hook: 'm.claw.weakCarry' as ModHook, op: 'mult', value: 1.5 }],
  'm.claw.magnet': [{ hook: 'm.claw.magnet' as ModHook, op: 'add', value: 1 }],
  'm.stacker.saveCell': [{ hook: 'm.stacker.saveCell' as ModHook, op: 'add', value: 1 }],
  'x.stacker.extraBlock': [{ hook: 'x.stacker.extraBlock' as ModHook, op: 'add', value: 1 }],
  'm.stacker.minorMult': [{ hook: 'm.stacker.minorMult' as ModHook, op: 'mult', value: 1.25 }],
  'm.stacker.majorCharm': [{ hook: 'm.stacker.majorCharm' as ModHook, op: 'add', value: 1 }],
};

/** Milestone entries for one device: payout ladder with its device features folded in (first matching family wins). */
export function familyMilestones(machineId: MachineId): MilestoneDef[] {
  const fam = FAMILY_FEATURES[machineId];
  const levels = [10, 25, 50, 100];
  const out: MilestoneDef[] = PAYOUT_LADDER.map((m) => ({ ...m, effects: [...(m.effects ?? [])] }));
  if (!fam) {
    for (const l of levels) out.push({ level: l, feature: `milestone.L${l}` });
    return out;
  }
  fam.forEach((raw, i) => {
    const level = levels[i];
    for (const part of raw.split('|')) {
      if (part === 'luck+5') out.push({ level, effects: [{ hook: 'luck', op: 'add', value: 5 }] });
      else out.push({ level, feature: part, ...(FEATURE_EFFECTS[part] ? { effects: FEATURE_EFFECTS[part] } : {}) });
    }
  });
  return out;
}

// ── instance tracks (GDD §3.7.2) ────────────────────────────────────────────────────────────────
const BLOCK_HOUSE: MachineFilter = { exclude: ['holdem', 'devilstable', 'shellgame', 'fortuneteller'] };
export const TRACK_TEMPLATES: UpgradeTemplate[] = [
  {
    id: 'payout', scope: 'instance', icon: 'coin', color: 0xe6a52e, maxLevel: 100,
    cost: { base: 20, growth: 1.2, tier: TIER_COST },
    effects: [{ hook: 'payout.mult', op: 'mult', value: { kind: 'linear', base: 1, perLevel: 0.015 } }],
    milestones: [{ at: PAYOUT_LADDER }],
    strings: tx('upg.payout'),
  },
  {
    id: 'luck', scope: 'instance', icon: 'horseshoe', color: 0x7dff7a, maxLevel: 10,
    cost: { base: 60, growth: 1.9, tier: TIER_COST },
    effects: [{ hook: 'luck', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }],
    milestones: [{
      at: [
        { level: 2, visual: 'horseshoe' }, { level: 4, visual: 'horseshoe' }, { level: 6, visual: 'horseshoe' },
        { level: 8, visual: 'horseshoe' }, { level: 10, visual: 'horseshoe', feature: 'luck.nearMissRefund25' },
        { level: 5, feature: 'luck.heatGain25' },
      ],
    }],
    strings: tx('upg.luck'),
  },
  {
    id: 'speed', scope: 'instance', icon: 'bolt', color: 0x4fc3ff, maxLevel: 30,
    cost: { base: 15, growth: 1.15, tier: TIER_COST },
    effects: [
      { hook: 'speed.mult', op: 'mult', value: { kind: 'exp', base: 1, growth: 0.97 } },
      { hook: 'speed.mult', op: 'min', value: { kind: 'const', v: 0.4 } },
    ],
    milestones: [{
      at: [
        { level: 1, visual: 'governor' },
        { level: 15, feature: 'autoplay', effects: [{ hook: 'autoplay', op: 'set', value: 1 }] },
        { level: 30, feature: 'speed.watchersX2' },
      ],
    }],
    strings: tx('upg.speed'),
  },
  {
    id: 'cap', scope: 'instance', icon: 'bar', color: 0xff9a3c, maxLevel: 100,
    cost: { base: 30, growth: 1.14, tier: TIER_COST },
    effects: [{ hook: 'bet.maxMult', op: 'mult', value: { kind: 'exp', base: 1, growth: 1.06 } }],
    milestones: [{
      at: [
        { level: 1, visual: 'limit_plate' },
        { level: 25, feature: 'cap.ladder.1' }, { level: 50, feature: 'cap.ladder.2' }, { level: 100, feature: 'cap.ladder.3' },
      ],
    }],
    strings: tx('upg.cap'),
  },
  {
    id: 'seats', scope: 'instance', icon: 'key', color: 0xc77dff, maxLevel: 2,
    cost: { base: 2500, growth: 100, fixed: [2500, 250000], round: 'sig3', tier: TIER_COST },
    appliesTo: BLOCK_HOUSE,
    effects: [{ hook: 'seats.extra', op: 'add', value: { kind: 'steps', steps: [[1, 1], [2, 2]] } }],
    milestones: [{ at: [{ level: 1, visual: 'second_stool' }] }],
    strings: tx('upg.seats'),
  },
  {
    id: 'staff', scope: 'instance', icon: 'skull', color: 0xf2f2f2, maxLevel: 50,
    cost: { base: 50, growth: 1.22, tier: TIER_COST },
    effects: [{ hook: 'income.mult', op: 'inc', value: { kind: 'linear', base: 0, perLevel: 0.05 } }],
    milestones: [{
      at: [
        { level: 1, visual: 'staff_mannequin' },
        { level: 10, visual: 'badge_brass', effects: [{ hook: 'income.mult', op: 'inc', value: 0.1 }] },
        { level: 25, visual: 'badge_silver', effects: [{ hook: 'income.mult', op: 'inc', value: 0.1 }] },
        { level: 50, visual: 'badge_gold', effects: [{ hook: 'income.mult', op: 'inc', value: 0.1 }] },
      ],
    }],
    strings: tx('upg.staff'),
  },
];

// ── pit-wide House Improvements (GDD §3.7.8). Global scope: one level set for the whole pit. ───────
const IMP = (
  id: string, icon: SymbolId, base: number, growth: number, max: number,
  effects: EffectCurve[],
): UpgradeTemplate => ({
  id, scope: 'global', icon, color: 0xe8e0c8, maxLevel: max,
  cost: { base, growth, size: FLAT_SIZE, round: 'sig3' } satisfies CostCurve,
  effects, strings: tx(`upg.${id}`),
});
export const IMPROVEMENT_TEMPLATES: UpgradeTemplate[] = [
  IMP('imp_vault_lining', 'coin', 300, 8, 5,
    [{ hook: 'x.econ.interestAdd', op: 'add', value: { kind: 'linear', base: 0, perLevel: 0.01 } }]),
  IMP('imp_friendly_auditor', 'bell', 1000, 10, 5,
    [{ hook: 'quota.mult', op: 'mult', value: { kind: 'linear', base: 1, perLevel: -0.03 } }]),
  IMP('imp_token_dispenser', 'key', 800, 40, 3,
    [{ hook: 'x.run.pullsAdd', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
  IMP('imp_slow_clock', 'moon', 400, 12, 4,
    [{ hook: 'x.run.clockAdd', op: 'add', value: { kind: 'linear', base: 0, perLevel: 15 } }]),
  IMP('imp_charm_pegs', 'eye', 600, 30, 3,
    [{ hook: 'x.pegs.add', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
  IMP('imp_pawn_bell', 'bell', 250, 15, 3,
    [{ hook: 'x.pawn.freeRerolls', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
  IMP('imp_lucky_draught', 'horseshoe', 2000, 12, 5,
    [{ hook: 'luck', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
  IMP('imp_coin_magnet', 'coin', 1500, 9, 5,
    [{ hook: 'payout.mult', op: 'inc', value: { kind: 'linear', base: 0, perLevel: 0.02 } }]),
  IMP('imp_brighter_bulbs', 'candle', 200, 20, 4,
    [{ hook: 'dread.add', op: 'add', value: { kind: 'linear', base: 0, perLevel: -2 } }]),
  IMP('imp_velvet_stools', 'spade', 3000, 50, 2,
    [{ hook: 'x.tilt.grace', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
  IMP('imp_staff_quarters', 'bell', 1000, 4, 10,
    [{ hook: 'income.mult', op: 'inc', value: { kind: 'linear', base: 0, perLevel: 0.1 } }]),
  IMP('imp_second_window', 'seven', 1500, 40, 2,
    [{ hook: 'x.pawn.slots', op: 'add', value: { kind: 'linear', base: 0, perLevel: 1 } }]),
];

/** Every tycoon template (instance tracks + house improvements). */
export const ALL_TEMPLATES: UpgradeTemplate[] = [...TRACK_TEMPLATES, ...IMPROVEMENT_TEMPLATES];

// ── staff (GDD §3.7.5). Income/levels live on the instance's `staff` track (single source of truth). ─────
export const STAFF_DEFS: StaffDef[] = [
  {
    kind: 'attendant', icon: 'bell', mode: 'house',
    hire: { base: 300, growth: 3, size: FLAT_SIZE, round: 'sig3' },
    maxCount: 12,
    levelCost: { base: 50, growth: 1.22 },
    maxLevel: 50,
    clips: { idle: 'Sitting_Idle_Loop', act: 'Idle_Talking_Loop' },
    strings: tx('staff.attendant'),
  },
  {
    kind: 'shill', icon: 'seven', mode: 'player',
    hire: { base: 200, growth: 3, size: FLAT_SIZE, round: 'sig3' },
    maxCount: 8,
    levelCost: { base: 50, growth: 1.22 },
    maxLevel: 50,
    clips: { idle: 'Sitting_Idle_Loop', act: 'Sitting_Talking_Loop' },
    autoplay: { stakeFrac: 0.01, playsPerMin: 0.5, perLevel: 0.04 },
    strings: tx('staff.shill'),
  },
];

// ── machine orders & wings ────────────────────────────────────────────────────────────────────────
export const ORDER_PRICING: OrderPricing = {
  sizeBase: { S: 60, M: 120, L: 250, XL: 500 },
  growth: 2.6,
  sellBack: 0.3,
};

/**
 * The buyable wings (the Keyring rooms, WAVE 24 §2). A grille also takes a Wing Key; `priceQuotaMult` is the BUY price.
 * The Parlour opens by itself after Night 3 (`tycoon.onNightPaid`), and the Counting Room takes the Manager's Key (or F6):
 * neither is listed here.
 */
export const WING_DEFS: WingDef[] = [
  { zone: 'midway', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('midway') },
  { zone: 'cards', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('cards') },
  { zone: 'laundry', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('laundry') },
  { zone: 'boiler', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('boiler') },
  { zone: 'gallery', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('gallery') },
  { zone: 'wheels', priceQuotaMult: KEYRING.buyQuotaMult, strings: wingStrings('wheels') },
];

// ── Machine mods (design backlog #7). Each machine instance has MOD_SOCKETS sockets (machineMods.ts). The Ledger's MODS
// tab sells these for `share` × the Night's quota; an installed mod stays on its machine for the run. The effects are
// unscoped here: machineMods.ts scopes each one to the socketed instance (and to `machines` when set). Lamp, tilt and
// feed mods are deltas (mult / add), so they compose with charms and bosses instead of overwriting their `set` values.
export interface MachineModDef {
  id: string;
  /** Price as a share of the Night's quota (20–35 %). */
  share: number;
  /** Machine ids the mod fits; absent = any machine. */
  machines?: MachineId[];
  effects: ModEffect[];
}
export const MOD_DEFS: MachineModDef[] = [
  // Hot ×1.5 → ×1.8 and Cold ×0.75 → ×0.6 at base (the lamp hooks start from HOT_MULT / COLD_MULT)
  { id: 'hotWire', share: 0.30, effects: [
    { hook: 'x.lamp.hotMult', op: 'mult', value: 1.2 },
    { hook: 'x.lamp.coldMult', op: 'mult', value: 0.8 },
  ] },
  { id: 'luckyLatch', share: 0.25, effects: [
    { hook: 'luck', op: 'add', value: 2 },
    { hook: 'bet.maxMult', op: 'mult', value: 0.8 },
  ] },
  // Tilt grace: two more plays before the bulbs start to tilt the machine
  { id: 'tiltGuard', share: 0.20, effects: [{ hook: 'x.tilt.grace', op: 'add', value: 2 }] },
  // Big One jackpot feed 1 % → 2.5 % (the feed base is 0.01, or 0.015 with the feature)
  { id: 'deepFeed', share: 0.35, machines: ['bigone'], effects: [{ hook: 'x.bigone.jackpotFeed', op: 'add', value: 0.015 }] },
  { id: 'brake', share: 0.25, effects: [{ hook: 'speed.mult', op: 'mult', value: 0.85 }] },
];

// ── Foundations (meta tree, GDD §11.3). Costs in Obols, `fixed` = explicit level prices. ─────────────
const META = (
  id: string, icon: SymbolId, fixed: number[], maxLevel: number, pos: [number, number],
  effects: EffectCurve[] | undefined,
  extra: { requires?: string[]; unlocks?: string[] } = {},
): MetaNode => ({
  id, icon, cost: { base: fixed[0] ?? 1, growth: 1, fixed, currency: 'obol' }, maxLevel, pos,
  effects, requires: extra.requires, unlocks: extra.unlocks, strings: tx(`meta.${id}`),
});
const lin = (hook: EffectCurve['hook'], op: EffectCurve['op'], perLevel: number, base = 0): EffectCurve =>
  ({ hook, op, value: { kind: 'linear', base, perLevel } });
const cst = (hook: EffectCurve['hook'], op: EffectCurve['op'], v: number): EffectCurve =>
  ({ hook, op, value: { kind: 'const', v } });
export const META_NODES: MetaNode[] = [
  // The Vault (start)
  META('V1', 'coin', [5, 10, 15, 20, 25], 5, [0, 0], [lin('x.start.pocket', 'add', 10)]),
  META('V2', 'key', [8, 16, 24], 3, [1, 0], [lin('x.start.tickets', 'add', 1)]),
  META('V3', 'bell', [30, 90], 2, [2, 0], [lin('x.econ.interestAdd', 'add', 0.01)]),
  META('V4', 'eye', [40], 1, [3, 0], [lin('x.overpay.threshold', 'add', -0.05)]),
  META('V5', 'coin', [25, 50, 75, 100, 125], 5, [4, 0], [lin('x.meta.obolGain', 'inc', 0.1)]),
  META('V6', 'candle', [60], 1, [5, 0], [cst('x.charm.sellValue', 'set', 0.6)]),
  // The Floor (start)
  META('F1', 'bolt', [10, 20, 40, 80, 160], 5, [0, 1], [{ hook: 'upgrade.costMult', op: 'mult', value: { kind: 'exp', base: 1, growth: 0.95 } }]),
  META('F2', 'bell', [10, 20, 40, 80, 160], 5, [1, 1], [lin('income.mult', 'inc', 0.1)]),
  META('F3', 'skull', [50], 1, [2, 1], [lin('x.tycoon.staffCap', 'add', 2)]),
  META('F4', 'seven', [80], 1, [3, 1], undefined, { unlocks: ['catalogue'] }),
  META('F5', 'moon', [120], 1, [4, 1], [lin('x.tycoon.assessRate', 'add', -0.01)]),
  META('F6', 'key', [200], 1, [5, 1], undefined, { unlocks: ['counting_room'] }),
  // The Hand (after the first Descend)
  META('H1', 'horseshoe', [40, 120, 360], 3, [0, 3], [lin('luck', 'add', 1)], { requires: ['bestShift:2'] }),
  META('H2', 'moon', [50], 1, [1, 3], [lin('x.run.pullsAdd', 'add', 1)], { requires: ['bestShift:2'] }),
  META('H3', 'eye', [80], 1, [2, 3], [lin('x.tilt.grace', 'add', 1)], { requires: ['bestShift:2'] }),
  META('H4', 'candle', [100], 1, [3, 3], [{ hook: 'x.lamp.hot', op: 'mult', value: { kind: 'const', v: 1.0667 } }], { requires: ['bestShift:2'] }),
  META('H5', 'spade', [120], 1, [4, 3], [cst('x.charm.lineBounty', 'set', 0.12)], { requires: ['bestShift:2'] }),
  META('H6', 'heart', [250], 1, [5, 3], [lin('x.pegs.add', 'add', 1)], { requires: ['bestShift:2'] }),
  // The Lamp (after the second Descend)
  META('L1', 'candle', [20, 40, 60], 3, [0, 5], [lin('dread.add', 'add', -5)], { requires: ['bestShift:4'] }),
  META('L2', 'eye', [60], 1, [1, 5], [{ hook: 'x.visitation.penaltyMult', op: 'mult', value: { kind: 'const', v: 0.5 } }], { requires: ['bestShift:4'] }),
  META('L3', 'bell', [30], 1, [2, 5], [lin('x.phone.ringAdd', 'add', 4)], { requires: ['bestShift:4'] }),
  META('L4', 'bolt', [150], 1, [3, 5], undefined, { requires: ['bestShift:4'], unlocks: ['second_wind'] }),
  META('L5', 'bar', [60], 1, [4, 5], undefined, { requires: ['bestShift:4'], unlocks: ['bright_start'] }),
  META('L6', 'skull', [90], 1, [5, 5], undefined, { requires: ['bestShift:4'], unlocks: ['courtesy'] }),
  // The Lift (after the third Descend)
  META('T1', 'key', [30], 1, [0, 7], [lin('x.kit.commonCharm', 'add', 1)], { requires: ['bestShift:6'] }),
  META('T2', 'crown', [120], 1, [1, 7], undefined, { requires: ['bestShift:6'], unlocks: ['wing_choice'] }),
  META('T3', 'coin', [40], 1, [2, 7], [{ hook: 'x.daily.obolMult', op: 'mult', value: { kind: 'const', v: 1.5 } }], { requires: ['bestShift:6'] }),
  META('T4', 'crown', [100], 1, [3, 7], [lin('x.kit.uncommonCharm', 'add', 1)], { requires: ['bestShift:6'] }),
  META('T5', 'bell', [70], 1, [4, 7], [lin('x.pawn.freeFirst', 'add', 1)], { requires: ['bestShift:6'] }),
  META('T6', 'heart', [50], 1, [5, 7], [{ hook: 'x.cassette.chanceMult', op: 'mult', value: { kind: 'const', v: 2 } }], { requires: ['bestShift:6'] }),
  // The Root (capstone)
  META('R1', 'crown', [1000], 1, [2, 9], [cst('payout.mult', 'inc', 0.05)], { requires: ['V1', 'F1', 'H1', 'L1', 'T1', 'won:8'] }),
];

// ── Foundations rules (one source for the tycoon, the menu screen and the tests) ────────────────────────────────
/** The meta fields the tree reads. A save's `meta` and the live tycoon's state both fit. */
export type MetaRead = Pick<MetaState, 'nodes' | 'bestShift' | 'descents' | 'unlocked'>;

/** Level of one node (0 = not bought). */
export const metaLevel = (meta: Pick<MetaState, 'nodes'>, id: string): number => meta.nodes[id] ?? 0;

/** Price of the next level of a node, in Obols. */
export const metaCost = (n: MetaNode, lv: number): number => costAt(n.cost, lv, 'M');

/**
 * First requirement token a node still misses, or null when its requirements hold. Tokens:
 *  - a node id: that node is at level ≥ 1;
 *  - `bestShift:N`: the deepest 0-based shift index reached is ≥ N (2 = Night 3, 4 = Night 5, 6 = Night 7);
 *  - `won:N`: a win on Night N was recorded (`won:N` in meta.unlocked, written by Tycoon.recordWin);
 *  - `descend:N`: legacy, at least N Descends.
 */
export function metaReqMissing(meta: MetaRead, n: MetaNode): string | null {
  for (const r of n.requires ?? []) {
    if (r.startsWith('bestShift:')) { if (meta.bestShift < Number(r.slice(10))) return r; }
    else if (r.startsWith('won:')) { if (!meta.unlocked.includes(r)) return r; }
    else if (r.startsWith('descend:')) { if (meta.descents < Number(r.slice(8))) return r; }
    else if (metaLevel(meta, r) <= 0) return r;
  }
  return null;
}

/** Why a buy is refused (maxed, requires, funds), or null when it may go ahead. */
export function metaBuyBlock(meta: MetaRead & Pick<MetaState, 'nodes' | 'obols'>, n: MetaNode): TycoonNoReason | null {
  const lv = metaLevel(meta, n.id);
  if (lv >= n.maxLevel) return 'maxed';
  if (metaReqMissing(meta, n)) return 'requires';
  if (meta.obols < metaCost(n, lv)) return 'funds';
  return null;
}

/** Buys the next level in place. The caller checks `metaBuyBlock` first. Obols never go below zero. Returns the price. */
export function applyMetaBuy(meta: MetaState, n: MetaNode): number {
  const lv = metaLevel(meta, n.id);
  const cost = metaCost(n, lv);
  meta.obols = Math.max(0, meta.obols - cost);
  meta.spent += cost;
  meta.nodes[n.id] = lv + 1;
  for (const u of n.unlocks ?? []) if (!meta.unlocked.includes(u)) meta.unlocked.push(u);
  return cost;
}

/** Folds `base` through the Foundations levels for one hook: the same numbers the tycoon provider emits for pit-wide nodes. */
export function foldMeta(meta: Pick<MetaState, 'nodes'>, hook: ModHook, base: number): number {
  return foldCurves(META_NODES.map((n) => ({ effects: n.effects, level: metaLevel(meta, n.id) })), hook, base);
}

/** Folds `base` through the pit-wide House Improvement levels (keyed `upg.global.<id>`) for one hook. */
export function foldHouse(levels: Readonly<Record<string, number>>, hook: ModHook, base: number): number {
  return foldCurves(IMPROVEMENT_TEMPLATES.map((t) => ({ effects: t.effects, level: levels[`upg.global.${t.id}`] ?? 0 })), hook, base);
}

function foldCurves(items: ReadonlyArray<{ effects?: EffectCurve[]; level: number }>, hook: ModHook, base: number): number {
  const effs: Array<{ op: EffectCurve['op']; value: number }> = [];
  for (const it of items) {
    if (it.level <= 0) continue;
    for (const e of it.effects ?? []) if (e.hook === hook) effs.push({ op: e.op, value: valueAt(e.value, it.level) });
  }
  return foldEffects(hook, base, effs);
}
