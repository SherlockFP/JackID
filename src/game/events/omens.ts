/**
 * THE OMENS (docs/BLESSINGS.md §3): the supernatural is the horror director with a reason. Each omen is an existing beat that
 * fires only from the player's state and reads as one instruction. Pure rules here (no three, no DOM, no clock); watchEvents.ts
 * and the horror director call them. The bus event `omen:fire` is the single hook the director turns into light and sound.
 */
import type { PlayerId } from '@/core/types';
import type { GodId } from '@/game/pantheon';
import { TIER_RANK, type DreadTier } from '@/game/horror/dread';

/** The Lights Die is the director's own beat (it needs no event), so it is not a kind here. */
export type OmenKind = 'weeping' | 'sigil' | 'till' | 'reflection';

declare module '@/core/events' {
  interface GameEvents {
    /** An omen fired. The director plays it (Calm Mode: light only, no sound). */
    'omen:fire': { kind: OmenKind };
    /** A candle was lit at a statue: the run adds 1 Favour to `god` (the shrine cannot reach the pantheon itself). */
    'shrine:favour': { pid: PlayerId; god: GodId };
  }
}

/** A god's omen can fire from this Favour on. */
export const OMEN_FAVOUR = 2;
/** First Night each omen can fire (docs/BLESSINGS.md §4). */
export const SIGIL_NIGHT = 3;
export const LIGHTS_DIE_NIGHT = 3;
export const REFLECTION_NIGHT = 4;
/** Sigil: the lit machine pays x2 until this many pulls on it, or the Bell. */
export const SIGIL_MULT = 2;
export const SIGIL_PULLS = 3;
/** The Sigil takes a Watch's roll this many times heavier while it is ready. */
export const SIGIL_WEIGHT = 3;
/** The Till Rings: the cashier event rolls this many times heavier at Ledgers Favour 2+. */
export const TILL_WEIGHT = 2;
/** The Lights Die: with Ash at Favour 2+ a deposit made in the dark is credited this much more. */
export const DARK_DEPOSIT_BONUS = 0.1;
/** The Lights Die only judges the pace once this much of the Night is gone. */
export const PACE_FROM = 0.3;

/** The Sigil can take the next single_light roll: Well Favour 2+, Night 3+, fewer than once (twice with Moon in the Well) this Night. */
export function sigilReady(well: number, night: number, firedThisNight: number, twice: boolean): boolean {
  return night >= SIGIL_NIGHT && well >= OMEN_FAVOUR && firedThisNight < (twice ? 2 : 1);
}

/** Weight multiplier of the cashier event: the Till Rings. */
export function tillWeight(ledgers: number): number { return ledgers >= OMEN_FAVOUR ? TILL_WEIGHT : 1; }

/** The Late Reflection: Mirrors Favour 2+ and a Crooked Table starts, Night 4+. */
export function reflectionReady(mirrors: number, night: number): boolean {
  return night >= REFLECTION_NIGHT && mirrors >= OMEN_FAVOUR;
}

export interface PaceInput { night: number; tier: DreadTier; nightElapsed: number; deposit: number; quota: number }

/** On this pace the bank ends the Night short of the quota. */
export function behindPace(i: Pick<PaceInput, 'nightElapsed' | 'deposit' | 'quota'>): boolean {
  return i.quota > 0 && i.nightElapsed >= PACE_FROM && i.deposit < i.quota * i.nightElapsed;
}

/** The Lights Die: Night 3+, Dread "watched" or worse, and the bank is behind pace. Always means "deposit now". */
export function lightsDie(i: PaceInput): boolean {
  return i.night >= LIGHTS_DIE_NIGHT && TIER_RANK[i.tier] >= TIER_RANK.watched && behindPace(i);
}
