/**
 * Physical items — Totems (radius items) and Collateral (porcelain body parts) — TD-FROZEN types.
 * Implementation: GAME-ITEMS WP. Contract: BRIEF ADDENDUM 8 (inspired by "Gamble With Your Friends",
 * ORIGINAL names/art). Both feed the modifier pipeline through declarative `ModEffect`s, so machines
 * never special-case them; they only call `mod()` and read `PlayerFx`.
 */
import type { Hex, Json, PlayerId, Unsub, V3 } from '@/core/types';
import type { SymbolId } from '@/core/texgen/types';
import type { CurrencyId } from './economy.types';
import type { ModEffect } from './modifiers.types';
import type { CharmRarity } from './types';

// ── Totems ──────────────────────────────────────────────────────────────────────────────────────
/** Reactive behaviours that are not plain modifiers (interpreted by GAME-ITEMS; ids are open). */
export interface TotemProc {
  /** 'shield-loss' | 'rewind' | 'free-allin' | 'revert-loss' | 'mystery-box' | 'jinx' | … */
  id: string;
  chance?: number;                     // 0..1, default 1
  cooldownS?: number;
  data?: Json;
}
export interface TotemDef {
  id: string;                          // strings → 'totem.<id>.name|desc'
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
  icon: SymbolId;
  rarity: CharmRarity;
  color: Hex;                          // ring + model accent
  /** Kit model id for `kit.totem({ shape })`. */
  shape: string;
  /** Effect radius in metres — drawn as a glowing floor ring while placed. */
  radius: number;
  /** Which things inside the radius it affects. */
  affects: 'machines' | 'players' | 'both';
  /** Versus: whose stuff counts. Default 'allies' (owner + teammates) in co-op, 'owner' in versus. */
  targets?: 'owner' | 'allies' | 'rivals' | 'everyone';
  /** Declarative contributions while placed; the system injects `scope.radius` from the placement. */
  effects?: ModEffect[];
  procs?: TotemProc[];
  uses?: number;                       // charges before it breaks (undefined = unlimited)
  durationS?: number;                  // lifetime after placement
  price: { currency: CurrencyId; amount: number };
  /** 'hand' = carried in the viewmodel hand (one at a time), 'backpack' = inventory. */
  carry: 'hand' | 'backpack';
  placeable: boolean;
  tags?: string[];
}
export interface TotemState {
  uid: string;
  def: string;
  owner: PlayerId;
  /** World position when placed; null while carried. */
  pos: V3 | null;
  rotY: number;
  carriedBy: PlayerId | null;
  placedAt: number;                    // host ms, 0 if never placed
  usesLeft?: number;
  expiresAt?: number;                  // host ms
  data?: Json;
}
export interface TotemsApi {
  register(def: TotemDef): Unsub;
  def(id: string): TotemDef | undefined;
  defs(): TotemDef[];
  list(): readonly TotemState[];
  /** Totems a player owns (carried or placed). */
  mine(pid?: PlayerId): readonly TotemState[];
  /** Host: create an owned totem (shop purchase, reward). Returns its uid. */
  grant(pid: PlayerId, defId: string): string | null;
  /** Place a carried totem on the floor at `pos` (client requests, host validates & replicates). */
  place(uid: string, pos: V3, rotY?: number): boolean;
  pickup(uid: string): boolean;
  discard(uid: string): boolean;
  /** Placed totems whose ring contains `pos`. */
  inRadius(pos: V3): readonly TotemState[];
  onProc(fn: (uid: string, proc: TotemProc) => void): Unsub;
}

// ── Collateral ("pawn a body part to the Collector") ───────────────────────────────────────────
export type BodyPart = 'eye' | 'ear' | 'mouth' | 'hand' | 'legs';
export const BODY_PARTS: readonly BodyPart[] = ['eye', 'ear', 'mouth', 'hand', 'legs'];
/** Pawned parts are replaced by a cracked porcelain part. */
export type PartStatus = 'whole' | 'porcelain';

/**
 * Aggregated presentation/penalty values for ONE player, recomputed on change. Consumers just apply:
 * renderer ← `vignette`; audio ← `muffle`; chat/voice ← `garble`; player ← `moveSpeed`/`actionSpeed`/`crawl`.
 * (The same numbers are also exposed as `player.*` modifier hooks.)
 */
export interface PlayerFx {
  vignette: number;                    // 0..1 porcelain half-screen vignette (eye)
  muffle: number;                      // 0..1 audio lowpass (ear)
  garble: number;                      // 0..1 garbled chat / voice (mouth)
  actionSpeed: number;                 // ×, hand lost → slower (≥ 0.25)
  moveSpeed: number;                   // ×, 1 normally
  crawl: boolean;                      // legs lost: cannot walk, must be carried
}
export const NEUTRAL_PLAYER_FX: Readonly<PlayerFx> = Object.freeze({
  vignette: 0, muffle: 0, garble: 0, actionSpeed: 1, moveSpeed: 1, crawl: false,
});

export interface CollateralDef {
  part: BodyPart;
  /** Coins the Collector pays: absolute, or a fraction of the current quota. */
  value: number | { quotaFrac: number };
  /** Buy-back price as a multiple of what you were paid. */
  buyback: number;
  /** Modifier contributions while the part is porcelain (e.g. `player.vision` ×0.5). */
  effects: ModEffect[];
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}
export interface CollateralState {
  pid: PlayerId;
  parts: Record<BodyPart, PartStatus>;
  /** Host ms each part was pawned (receipts, Hall of Losers). */
  pawnedAt: Partial<Record<BodyPart, number>>;
  /** Teammate currently carrying this (crippled) player. */
  carriedBy: PlayerId | null;
  /** Every part pawned → this player has become a mannequin (run over for them). */
  mannequin: boolean;
}
export interface CollateralApi {
  def(part: BodyPart): CollateralDef;
  state(pid?: PlayerId): CollateralState;
  /** Coins the Collector would pay right now for `part`. */
  offer(part: BodyPart, pid?: PlayerId): number;
  pawn(part: BodyPart): boolean;       // local player; host validates & pays
  buyBack(part: BodyPart): boolean;
  count(pid?: PlayerId): number;       // parts currently pawned
  isMannequin(pid?: PlayerId): boolean;
  fx(pid?: PlayerId): Readonly<PlayerFx>;
  // carrying a friend who lost their legs
  canCarry(target: PlayerId): boolean;
  carry(target: PlayerId): boolean;
  drop(): void;
  carrying(): PlayerId | null;
}
