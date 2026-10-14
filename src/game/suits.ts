/**
 * Suits (GDD §3.4.1, TECH_SPEC §11.5). Every gambling cabinet belongs to exactly one of six families. The suit is a
 * scope tag: `run.ts` and `benchRun.ts` append `suitOf(id)` to the machine's tags, so charms scoped to a suit
 * (`scope: { tags: ['CARDS'] }` …) finally match machines that carry no suit tag of their own.
 *
 * Pure data: no imports beyond the id type, safe to load from tests and from the sim script.
 *
 * Notes:
 *  - `holdem` is in the GDD roster but has no cabinet folder yet, so it is left out here until the machine lands.
 *  - `sonkart` has a headless play but is a multi-seat party card game that GDD §3.4.1 does not list. It has no suit
 *    ({@link NO_SUIT}); `pisti` and `tavla` are party games too and have no headless play.
 */
import type { MachineId } from '@/core/types';

export const SUITS = ['REELS', 'CARDS', 'DICE', 'WHEELS', 'DROPS', 'CURIOS'] as const;
export type Suit = (typeof SUITS)[number];

/** Glyph colours from GDD §3.4.1 (the marquee badge). */
export const SUIT_COLOR: Readonly<Record<Suit, number>> = {
  REELS: 0xffb000,
  CARDS: 0xe8e0c8,
  DICE: 0xff4a3a,
  WHEELS: 0x38e8ff,
  DROPS: 0xddf4ff,
  CURIOS: 0xff2e88,
};

export const SUIT_OF: Readonly<Record<string, Suit>> = {
  // REELS
  bigone: 'REELS', bandit: 'REELS', pachislot: 'REELS', fruitmachine: 'REELS', scratch: 'REELS', lootbox: 'REELS',
  // CARDS
  videopoker: 'CARDS', blackjack: 'CARDS', baccarat: 'CARDS', cardwar: 'CARDS', hilo: 'CARDS', threecard: 'CARDS',
  reddog: 'CARDS', mahjong: 'CARDS',
  // DICE
  craps: 'DICE', sicbo: 'DICE', dicetower: 'DICE', coinflip: 'DICE', teetotum: 'DICE',
  // WHEELS
  roulette: 'WHEELS', bigsix: 'WHEELS', cyclone: 'WHEELS', devilstable: 'WHEELS', tombola: 'WHEELS',
  // DROPS
  pachinko: 'DROPS', plinko: 'DROPS', coinpusher: 'DROPS', bingopin: 'DROPS', keno: 'DROPS', bingo: 'DROPS',
  lottoblower: 'DROPS',
  // CURIOS
  elevator: 'CURIOS', mines: 'CURIOS', claw: 'CURIOS', stacker: 'CURIOS', derby: 'CURIOS', fortuneteller: 'CURIOS',
  shellgame: 'CURIOS', fantan: 'CURIOS',
};

/** Registered machines that GDD §3.4.1 deliberately leaves without a suit (see the header). */
export const NO_SUIT: ReadonlySet<string> = new Set(['sonkart', 'pisti', 'tavla', 'bounty_board', 'cashier', 'charm_vendor',
  'debt_terminal', 'hotline', 'jukebox', 'shrine', 'tonic_vendor']);

/** The suit of a machine id, or null (non-gambling fixtures, party games). */
export function suitOf(id: MachineId | string): Suit | null {
  return Object.prototype.hasOwnProperty.call(SUIT_OF, id) ? SUIT_OF[id] : null;
}

/** Every machine id in a suit, in table order. */
export function suitMachines(suit: Suit): MachineId[] {
  return Object.keys(SUIT_OF).filter((id) => SUIT_OF[id] === suit);
}

/**
 * Scope tags of a machine for the modifier pipeline: its own tags plus its suit family in lower case (the form charm
 * scopes use: `scope: { tags: ['reels'] }`). Cached per machine id; run.ts and benchRun.ts both use it.
 */
const scopeTagCache = new Map<string, readonly string[] | undefined>();
export function scopeTags(machineId: string, own: readonly string[] | undefined): readonly string[] | undefined {
  if (scopeTagCache.has(machineId)) return scopeTagCache.get(machineId);
  const s = suitOf(machineId);
  const tags = s ? [...(own ?? []), s.toLowerCase()] : own;
  if (own !== undefined) scopeTagCache.set(machineId, tags);
  return tags;
}
