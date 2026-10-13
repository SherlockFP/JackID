/**
 * Fortune-Teller "Mother Moth" (`fortuneteller`) — pure rules (MACHINES_tables §14). No three, kit or DOM.
 * Shared by the live machine (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS
 * the live RTP.
 *
 * Rules "Three Veils": stake S, a 22-card Omen deck is shuffled and three face-down cards are dealt. Pick one: it pays
 * S × coin multiplier and applies its omen as buff `buff.omen.<id>`. Defy Fate (once, within the window): pay S again to
 * void the first card and pick one of the remaining two (final). Coin RTP = 19 / 22 = 86.36 % (exact).
 *
 * Omen effects are data for the buff system (`buff.omen.<id>` defs live with the buffs owner); this file only knows
 * the coin multiplier, the kind (for luck, the curse test and juice) and the card id.
 *
 * Deviation noted for the director: MACHINES_tables §14.3 text says "7 blessings, 10 neutral" but its own table lists
 * 9 blessings (6, 7, 10–14, 20, 21) and 7 neutral (1, 4, 5, 9, 15, 16, 18) + Mirror. The table rows are used here.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type OmenKind = 'blessing' | 'curse' | 'neutral' | 'mirror';
export interface Omen { id: number; coin: number; kind: OmenKind }

/** The 22 omen cards in catalogue order (§14.3). Names and effect text live in the strings file under `omen.<id>.*`. */
export const OMENS: readonly Omen[] = [
  { id: 0, coin: 0, kind: 'curse' }, { id: 1, coin: 0, kind: 'neutral' }, { id: 2, coin: 0, kind: 'curse' },
  { id: 3, coin: 0, kind: 'curse' }, { id: 4, coin: 0, kind: 'neutral' }, { id: 5, coin: 0, kind: 'neutral' },
  { id: 6, coin: 0, kind: 'blessing' }, { id: 7, coin: 0, kind: 'blessing' }, { id: 8, coin: 0, kind: 'mirror' },
  { id: 9, coin: 0.5, kind: 'neutral' }, { id: 10, coin: 0.5, kind: 'blessing' }, { id: 11, coin: 0.5, kind: 'blessing' },
  { id: 12, coin: 0.5, kind: 'blessing' }, { id: 13, coin: 1, kind: 'blessing' }, { id: 14, coin: 1, kind: 'blessing' },
  { id: 15, coin: 1, kind: 'neutral' }, { id: 16, coin: 1, kind: 'neutral' }, { id: 17, coin: 1.5, kind: 'curse' },
  { id: 18, coin: 1.5, kind: 'neutral' }, { id: 19, coin: 2, kind: 'curse' }, { id: 20, coin: 3, kind: 'blessing' },
  { id: 21, coin: 5, kind: 'blessing' },
];

export const OMEN_COUNT = OMENS.length;
export const GRAND_OMEN = 21;
export const MIRROR = 8;
export const DEFY_WINDOW_S = 6;
export const MAX_OMEN_WEIGHT = 3;      // hook cap: an omen can appear at most this many times in the deck

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_WEIGHT = (id: number): ModHook => `m.fortuneteller.omenWeight.${id}` as ModHook;   // int add (duplicates)
export const HOOK_DEFY_MULT = 'm.fortuneteller.defyCostMult' as ModHook;                             // float ×
export const HOOK_OMEN_DUR = 'm.fortuneteller.omenDurationMult' as ModHook;                          // float ×
export const HOOK_GRAND_RARITY = 'm.fortuneteller.grandOmenRarity' as ModHook;                       // int 0..2
export const HOOK_VEIL = 'm.fortuneteller.seeVeil' as ModHook;                                       // charges > 0 → peek
export const HOOK_CURSE_IMMUNE = 'm.fortuneteller.curseImmunity' as ModHook;                         // charges > 0 → curse ignored

export const omenOf = (id: number): Omen => OMENS[id] ?? OMENS[0];
export const isCurse = (id: number): boolean => omenOf(id).kind === 'curse';
/** Luck targets cards that pay less than 1× or curse. */
export const isWeak = (id: number): boolean => { const o = omenOf(id); return o.coin < 1 || o.kind === 'curse'; };
export const buffId = (id: number): string => `buff.omen.${id}`;

/**
 * The deck for one reading: each card once, plus the `omenWeight` duplicates (hook, clamped 0..MAX_OMEN_WEIGHT extra).
 * `extra(id)` is the hook reader (the live machine passes its mod(); headless passes h.mod()).
 */
export function buildDeck(extra: (id: number) => number): number[] {
  const deck: number[] = [];
  for (let id = 0; id < OMEN_COUNT; id++) {
    const n = Math.min(MAX_OMEN_WEIGHT, Math.max(0, Math.round(extra(id))));
    for (let k = 0; k <= n; k++) deck.push(id);
  }
  return deck;
}

/** Shuffle a copy of the deck in place-order on the reading's rng; returns [dealt3, undealt]. */
export function deal(rng: Rng, deck: readonly number[]): { dealt: number[]; undealt: number[] } {
  const d = rng.shuffle([...deck]);
  return { dealt: d.slice(0, 3), undealt: d.slice(3) };
}

export interface PickRes { dealt: number[]; undealt: number[]; omen: number; swapped: boolean }

/**
 * Resolve a pick. Always consumes exactly two draws so the stream never depends on the result.
 * Luck (reroll mode): a weak card is swapped invisibly, with p = luck/100, for a random non-curse undealt card.
 * The swapped-out card goes back into the undealt pool, so the deck size never changes.
 */
export function resolvePick(rng: Rng, dealt: readonly number[], undealt: readonly number[], slot: number, luck: number): PickRes {
  const gate = rng.next(), alt = rng.next();
  const d = [...dealt], u = [...undealt];
  let swapped = false;
  if (isWeak(d[slot]) && luck > 0 && gate < luck / 100) {
    const cands: number[] = [];
    for (let i = 0; i < u.length; i++) if (!isCurse(u[i])) cands.push(i);
    if (cands.length) {
      const j = cands[Math.min(cands.length - 1, Math.floor(alt * cands.length))];
      const tmp = d[slot]; d[slot] = u[j]; u[j] = tmp;
      swapped = true;
    }
  }
  return { dealt: d, undealt: u, omen: d[slot], swapped };
}

/** Coins paid for an omen at stake `bet`. Mirror pays nothing itself (its effect repeats the previous omen). */
export const coinsFor = (id: number, bet: number): number => Math.floor(bet * omenOf(id).coin);

/**
 * The omen whose effect applies: Mirror repeats the previous reading's omen (none → nothing; Mirror after Mirror → nothing).
 * `prev` is the last picked omen of this machine (state), or null.
 */
export function effective(id: number, prev: number | null): number | null {
  if (omenOf(id).kind !== 'mirror') return id;
  if (prev === null || omenOf(prev).kind === 'mirror') return null;
  return prev;
}

/** Near miss: The Grand Omen sat among the unpicked cards (cosmetic tease, tag `nearmiss`). */
export const nearMiss = (unpicked: readonly number[]): boolean => unpicked.includes(GRAND_OMEN);

/**
 * Headless single reading, collected immediately (what an Attendant does): no Defy, first slot.
 * Same deck, same resolve, so the simulated RTP IS the live RTP for a player who never defies.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const deck = buildDeck((id) => h.mod(HOOK_WEIGHT(id), 0));
  const { dealt, undealt } = deal(rng, deck);
  const r = resolvePick(rng, dealt, undealt, 0, h.luck);
  const tags: string[] = [];
  if (r.swapped) tags.push('lucky');
  if (nearMiss(r.dealt.filter((_, i) => i !== 0))) tags.push('nearmiss');
  return { gross: coinsFor(r.omen, bet), tags };
};
