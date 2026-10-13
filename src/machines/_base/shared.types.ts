/**
 * Shared machine primitives — TD-FROZEN by Contracts v1.1 (DECISIONS C31). Covers: fair (commit–reveal),
 * wheel, dice, draw, steered (luck/nudge), led (LED/bulb chains) and bots. Implementations live beside it in
 * `_base/` (fair.ts, wheel.ts, …) and are owned by the core base-class package. Pure types only.
 */
import type { Hex, Json, PlayerId, V3 } from '@/core/types';

// ── fair: commit–reveal (mandatory on elevator, dicetower, mines and every TableBase device) ─────────
export interface FairCommit {
  /** Hex digest of `reveal` + salt, published before the player acts. */
  commit: string;
  /** Round seed (hashSeed(runSeed, instanceId, round)); revealed at `fairReveal`. */
  seed: number;
  round: number;
}
export interface FairReveal { seed: number; salt: string; commit: string; verify: boolean }

// ── wheel: a segment index drawn from weights, with a spin plan ─────────────────────────────────────
export interface WheelSpec { segments: number; weights?: number[] }
export interface WheelResult { seg: number; turns: number; durMs: number; wobble: number }

// ── dice: face draw from weighted faces (base 100 + machine weight) ─────────────────────────────────
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;
export interface DiceRoll { faces: DieFace[]; weights?: number[] }

// ── draw: ordered draw without replacement (keno, bingo, lotto blower, tombola) ───────────────────────
export interface DrawResult<T = number> { items: T[]; seed: number; stepMs?: number }

// ── steered: outcome luck (solo reroll with p = L/100; shared refund) ──────────────────────────────
export interface SteeredRoll<T> {
  /** The outcome as first drawn. */
  first: T;
  /** The outcome after the single luck reroll (equal to `first` when no reroll happened). */
  final: T;
  rerolled: boolean;
}

// ── led: a chain of bulbs / lamps driven by a pattern (ART flicker ids, §11.7) ──────────────────────
export type LedPattern = 'off' | 'steady' | 'chase' | 'rainbow' | 'pulse' | 'strobe';
export interface LedState { pattern: LedPattern; hz: number; color: Hex; on: boolean }

// ── bots: table fillers (DECISIONS / PartyDef.botLevels 1..3) ──────────────────────────────────────
export type BotLevel = 1 | 2 | 3;
export interface BotSeat { pid: PlayerId; name: string; level: BotLevel; seat: number }
export interface BotDecision { k: string; d?: Json; at?: V3 }
