/**
 * Smart stakes (`_base`). Every seated machine starts on the SAFE preset, and the number keys pick a stake from the
 * pocket: 7 = SAFE (~5 %), 8 = BOLD (~15 %), 9 = BIG (~30 %, a second press confirms it, as a high stake does).
 *
 * Each preset is a target share of the pocket, snapped DOWN to the machine's bet ladder. The ladder already carries the
 * run's stake limit (the Night 1 cap, SI), so a preset never offers a stake the run would refuse. A preset is never below
 * the machine minimum and is always affordable: under HIGH STAKES the x5 round also debits the extra x4 at the start.
 *
 * This file is pure (no DOM, no Three.js): MachineBase applies the presets and emits `stake:presets` for the seat HUD.
 */
import type { InstanceId } from '@/core/types';
import type { MachineAction } from '@/core/input/types';
import { STAKE_CONFIRM_SEC } from '@/game/economy';

export type StakePresetKey = 'safe' | 'bold' | 'big';
/** Left to right on the HUD and in the key order 7, 8, 9. */
export const STAKE_PRESET_KEYS: readonly StakePresetKey[] = ['safe', 'bold', 'big'];
/** Target share of the pocket for each preset (before the ladder snap). */
export const STAKE_PRESET_SHARE: Readonly<Record<StakePresetKey, number>> = { safe: 0.05, bold: 0.15, big: 0.3 };
/** The machine action each preset key sends (the seated keymap binds these to Digit7 / Digit8 / Digit9). */
export const STAKE_PRESET_ACTION: Readonly<Record<StakePresetKey, MachineAction>> = { safe: 'n7', bold: 'n8', big: 'n9' };
/** BIG waits this long for its second press before it lapses (the same window as the high-stake confirm). */
export const BIG_CONFIRM_SEC = STAKE_CONFIRM_SEC;

/**
 * Digit actions a machine binds to its OWN handler. On these keys the machine keeps its meaning and the preset is not
 * bound (the HUD still shows the amount, without a key cap). Keep in sync with each machine's `case 'n7'…` list.
 * Machines that never stake (minBet 0: cashier, vendor, terminal, hotline, bounty board) get no presets at all.
 */
const STAKE_KEY_OWNERS: Readonly<Record<string, readonly MachineAction[]>> = {
  bigsix: ['n9'],
  blackjack: ['n7', 'n8'],
  derby: ['n7', 'n8', 'n9'],
  devilstable: ['n7', 'n8'],
  elevator: ['n7', 'n8', 'n9'],
  fantan: ['n7', 'n8'],
  jukebox: ['n7', 'n8', 'n9'],
  mines: ['n7'],
  sonkart: ['n7', 'n8', 'n9'],
  tallytable: ['n7', 'n8'],
  tavla: ['n7'],
  threecard: ['n8'],
};

/** The preset a machine action stands for (`n7` → safe, `n8` → bold, `n9` → big), or null. */
export function presetOf(action: string): StakePresetKey | null {
  for (const k of STAKE_PRESET_KEYS) if (STAKE_PRESET_ACTION[k] === action) return k;
  return null;
}

/** True when machine `machineId` keeps digit `action` for its own use (the preset must not take it). */
export function stakeKeyOwned(machineId: string, action: MachineAction): boolean {
  return STAKE_KEY_OWNERS[machineId]?.includes(action) ?? false;
}

export interface StakePresetInput {
  /** The run's pocket (`run.wallet()`). */
  pocket: number;
  /** The machine's minimum stake (`def.minBet`). */
  min: number;
  /** The machine's bet ladder, already capped by the run's stake limit. */
  ladder: readonly number[];
  /** Coins the run charges for a stake (`bet.costMult`). */
  costOf: (amount: number) => number;
  /** 1 normally; HS_MULT under HIGH STAKES (the extra stake is debited at the round start). */
  hsMult: number;
}

/**
 * The three preset stakes for a pocket. Each is the largest affordable ladder step at or below its target share of the
 * pocket; when no affordable step reaches the target, the smallest affordable step (or the machine minimum) is used.
 */
export function stakePresetAmounts(i: StakePresetInput): Record<StakePresetKey, number> {
  const w = Math.max(0, i.pocket);
  const extraMult = Math.max(0, i.hsMult - 1);
  const need = (v: number): number => i.costOf(v) + extraMult * v;
  const ok = i.ladder.filter((v) => v >= i.min && need(v) <= w).sort((a, b) => a - b);
  const pick = (target: number): number => {
    let best = ok.length ? ok[0] : i.min;
    for (const v of ok) if (v <= target) best = v;
    return best;
  };
  return {
    safe: pick(w * STAKE_PRESET_SHARE.safe),
    bold: pick(w * STAKE_PRESET_SHARE.bold),
    big: pick(w * STAKE_PRESET_SHARE.big),
  };
}

export interface StakePresetRow {
  key: StakePresetKey;
  amount: number;
  /** The bound key label (`7`), or '' when the machine keeps the digit for itself. */
  keyLabel: string;
}

/** Published on every change of the seated machine's presets, and once with `on: false` when the seat is released. */
export interface StakePresetsEvent {
  mid: InstanceId;
  on: boolean;
  /** The current stake (`bet`) and pocket. */
  bet: number;
  pocket: number;
  /** HIGH STAKES is on (the presets already fit the x5 debit). */
  hs: boolean;
  /** The preset the current stake equals, or null (a Z / X stake). */
  active: StakePresetKey | null;
  /** BIG is waiting for its second press. */
  armed: StakePresetKey | null;
  rows: StakePresetRow[];
}

declare module '@/core/events' {
  interface GameEvents {
    /** The seated machine's smart-stake presets (`stakePresets.ts`); the seat HUD draws the row. */
    'stake:presets': StakePresetsEvent;
  }
}
