/**
 * Buffs / debuffs — TD-FROZEN types. Implementation: GAME-BUFFS (under GAME-RUN until split).
 * Contract: BRIEF ADDENDUM 3, GDD §3.8. Data-driven like upgrades and charms: a `BuffDef` is pure data
 * (+ optional code hooks) registered from `src/game/buffs/defs/<id>.ts` (glob), strings under `buff.<id>.*`.
 * Buffs fold into the SAME modifier pipeline as everything else (`ModifierApi`), so they stack and
 * synergise with charms, upgrades and totems for free.
 */
import type { InstanceId, Hex, Json, PlayerId, Unsub } from '@/core/types';
import type { SymbolId } from '@/core/texgen/types';
import type { GameEvents } from '@/core/events';
import type { ModEffect } from './modifiers.types';

/** player = one person · instance = one machine · team = all players (co-op) · pit = the whole floor (events). */
export type BuffScope = 'player' | 'instance' | 'team' | 'pit';

/** Where a buff came from (HUD tooltip, achievements, anti-abuse). */
export interface BuffSource {
  kind: 'tonic' | 'charm' | 'event' | 'shrine' | 'phone' | 'streak' | 'aura' | 'totem' | 'machine' | 'upgrade'
    | 'contract' | 'ghost' | 'system' | 'debug';
  id?: string;
  /** Player who caused it (ghost gifts, sabotage), 0 = the House. */
  by?: PlayerId;
}

/** Condition on a named metric, e.g. `{ metric: 'heat', cmp: '>=', value: 60 }` for "hot machine". */
export interface BuffCondition {
  metric: string;                       // 'heat' | 'dread' | 'streak.win' | 'streak.loss' | 'allies.near' | 'quota.ratio' | …
  cmp: '>=' | '>' | '<=' | '<' | '==';
  value: number;
}

export type BuffDuration =
  | { kind: 'seconds'; s: number }      // real shift seconds (host clock)
  | { kind: 'plays'; n: number }        // machine rounds by the owner
  | { kind: 'wins'; n: number }         // winning rounds
  | { kind: 'shift' }                   // until the current shift ends
  | { kind: 'shifts'; n: number }       // N shifts
  | { kind: 'while'; cond: BuffCondition }
  | { kind: 'permanent' };

export interface BuffDef {
  id: string;                           // 'tonic.lucky_mint', 'hot', 'curse_tithe' …
  kind: 'buff' | 'debuff';
  scope: BuffScope;
  icon: SymbolId;                       // registered texgen symbol, e.g. 'icon.mint'
  color?: Hex;                          // frame/radial colour; default green/red by kind
  maxStacks: number;                    // ≥ 1
  duration: BuffDuration;
  /** What re-applying does: 'refresh' resets duration (+1 stack up to max), 'extend' adds duration, 'replace' resets stacks to 1, 'ignore' keeps the old one. */
  reapply?: 'refresh' | 'extend' | 'replace' | 'ignore';
  /** Declarative modifier contributions (scaled by stacks). */
  effects?: ModEffect[];
  /** Periodic tick (seconds) delivered to `on.tick` — dread whispers, regen. */
  tickEvery?: number;
  /** Buffs sharing a group replace each other (only one jukebox song at a time). */
  exclusive?: string;
  /** Free-form tags for cleansing ("curse", "tonic", "event") and filters. */
  tags?: string[];
  /** Proximity aura: re-evaluated each second; grants this buff while a teammate is within `radius` m. */
  aura?: { radius: number; needs: 'ally' | 'enemy' | 'totem' | 'machine'; perUnit?: boolean };
  hidden?: boolean;                     // no HUD icon (internal bookkeeping)
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };   // → 'buff.<id>.name|desc'
  /** Code hooks for the odd ones (host side). */
  on?: {
    add?(c: BuffCtx): void;
    remove?(c: BuffCtx): void;
    tick?(c: BuffCtx, dt: number): void;
    event?: { [K in keyof GameEvents]?: (p: GameEvents[K], c: BuffCtx) => void };
  };
}
export interface BuffCtx { owner: PlayerId | InstanceId; stacks: number; data: Record<string, Json>; remove(): void }

/** Live instance of a buff (replicated: `rsnap.buffs`, `buffD`). */
export interface BuffState {
  id: string;
  stacks: number;
  source: BuffSource;
  startedAt: number;                    // host ms
  /** Host ms when it expires (seconds-based), 0 = not time based. */
  expiresAt: number;
  playsLeft?: number;
  winsLeft?: number;
  shiftsLeft?: number;
  data?: Json;
}
/** Key used in snapshots and `buffD`: 'p:<pid>' | 'i:<instance>' | 'team' | 'pit'. */
export type BuffOwnerKey = string;

export interface BuffAddOpts {
  pid?: PlayerId;                       // scope 'player' (default: local player)
  mid?: InstanceId;                     // scope 'instance'
  stacks?: number;                      // default 1
  durationScale?: number;               // × the def's duration
  source?: BuffSource;
  data?: Json;
}
export interface BuffsApi {
  // ── definitions (registered at boot from glob) ──
  register(def: BuffDef): Unsub;
  def(id: string): BuffDef | undefined;
  defs(): BuffDef[];
  // ── state ──
  /** Host: apply. Client: sends a request (only the host/occupant-authoritative sources may add). */
  add(id: string, o?: BuffAddOpts): void;
  remove(id: string, o?: { pid?: PlayerId; mid?: InstanceId; all?: boolean }): void;
  /** Remove every buff carrying `tag` (cleanse, "all curses vanish"). */
  cleanse(tag: string, o?: { pid?: PlayerId }): number;
  has(id: string, o?: { pid?: PlayerId; mid?: InstanceId }): boolean;
  stacks(id: string, o?: { pid?: PlayerId; mid?: InstanceId }): number;
  /** Everything affecting a player: own + team + pit (+ instance when `mid` given). Sorted for the HUD bar. */
  list(o?: { pid?: PlayerId; mid?: InstanceId }): readonly BuffState[];
  /** Metrics usable in `BuffCondition` (heat, dread …). Providers register theirs at boot. */
  registerMetric(name: string, fn: (pid: PlayerId, mid?: InstanceId) => number): Unsub;
  /** Remaining fraction 0..1 of a time/plays based buff (radial HUD timer); 1 for permanent. */
  remaining(s: BuffState): number;
}

/** Id of a per-instance buff such as 'hot:B07' (def id 'hot', instance suffix). */
export const instanceBuffId = (base: string, mid: InstanceId): string => `${base}:${mid}`;
