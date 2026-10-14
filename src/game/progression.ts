/**
 * The progressive floor (Wave 27, director decision "tycoon floor"). Pure data + pure functions: no THREE, no DOM.
 *
 * The old pit opened ~48 machines at once and nobody could tell what to play. The Debt Run now opens with four dead-simple
 * machines and the house hands the player two more at every Dawn (once the Night's quota is paid), simple to complex:
 *
 *   • CORE_MACHINES   the 16 machines a Debt Run is built from. Every other registered machine lives in the Free Casino
 *                     (sandbox mode, `FREE_LAYOUT` in layout.ts) and is not placed in a Debt / Co-op / Versus run.
 *   • UNLOCK_SCHEDULE Night 1 opens the starters (bigone, coinflip, hilo, scratch); Nights 2 to 7 open two each (4 + 12 = 16).
 *                     Night 8 is the finale: nothing new, the whole floor is open. Tiers run SIMPLE → CLASSIC → TABLE → HEAVY.
 *   • seed            the order INSIDE a tier is a seeded shuffle (`hashSeed('progression', seed, tier)`), so two runs do not
 *                     open the same pairs on the same Night, but a tier never opens before an easier one. No seed = canonical.
 *
 * Night arithmetic: the machines of Night n open the moment Night n-1's quota is paid (the Dawn), so the player sees them
 * covered on the way in and uncovered at the Dawn. `effectiveNight(night, paid)` turns the run's state into that number.
 *
 * Always-open devices (vendors, terminals, story tables) are never locked: see `ALWAYS_OPEN`.
 *
 * What the other lanes read (WIRING, see the task report):
 *   run.isLocked(id)  →  `isLockedFor(id, effectiveNight(night(), nightPaid), mode, seed)`
 *   session / HUD     →  `newOn(night, seed)` for the "NEW ON THE FLOOR" toast, `isNew(id, night, seed)` for the NEW marquee
 *   world / pads      →  `unlockNightOf(id, seed)` for the "OPENS NIGHT n" plate (props/cover.ts)
 */
import type { GameMode, MachineId } from '@/core/types';
import { createRng, hashSeed } from '@/core/rng';
import { t } from '@/core/i18n';
import { quotaFor } from './data/schedule';

/** Complexity tiers, easiest first. The tier order is the unlock order; inside a tier the run seed decides. */
export type Tier = 'SIMPLE' | 'CLASSIC' | 'TABLE' | 'HEAVY';
export const TIERS: readonly Tier[] = ['SIMPLE', 'CLASSIC', 'TABLE', 'HEAVY'];

/**
 * The core set, in canonical unlock order (Night 1 first). Notes on each pick; nothing was swapped out of the director's
 * list (all 16 are kept) but three are flagged for a UX pass because they read less well than the rest:
 *   bigone / coinflip / hilo / scratch   one decision per round, instant read. The starters.
 *   bandit / plinko / mines / videopoker pull a lever, drop a puck, pick tiles, hold cards: still one screen, one idea.
 *   cyclone / blackjack / pachinko / keno a wheel, the first real card table, a passive ball drop and a draw (pachinko and
 *                                          keno are passive: watch-and-wait; kept for the pace break, placed mid-schedule).
 *   roulette / sonkart / mahjong / craps  the deep end: many bets (roulette, craps), a 4-seat party game (sonkart) and a
 *                                          tile game (mahjong). Craps is the least readable core machine: it opens last.
 */
export const CORE_PLAN: ReadonlyArray<{ id: MachineId; tier: Tier }> = [
  { id: 'bigone', tier: 'SIMPLE' }, { id: 'coinflip', tier: 'SIMPLE' }, { id: 'hilo', tier: 'SIMPLE' }, { id: 'scratch', tier: 'SIMPLE' },
  { id: 'bandit', tier: 'CLASSIC' }, { id: 'plinko', tier: 'CLASSIC' }, { id: 'mines', tier: 'CLASSIC' }, { id: 'videopoker', tier: 'CLASSIC' },
  { id: 'cyclone', tier: 'TABLE' }, { id: 'blackjack', tier: 'TABLE' }, { id: 'pachinko', tier: 'TABLE' }, { id: 'keno', tier: 'TABLE' },
  { id: 'roulette', tier: 'HEAVY' }, { id: 'sonkart', tier: 'HEAVY' }, { id: 'mahjong', tier: 'HEAVY' }, { id: 'craps', tier: 'HEAVY' },
];

export const CORE_MACHINES: readonly MachineId[] = CORE_PLAN.map((c) => c.id);
const CORE_SET: ReadonlySet<MachineId> = new Set(CORE_MACHINES);
const TIER_OF: ReadonlyMap<MachineId, Tier> = new Map(CORE_PLAN.map((c) => [c.id, c.tier]));

/** Machines opened on Night 1. The rest of the tiers are dealt two per Night from Night 2. */
export const STARTERS: readonly MachineId[] = CORE_PLAN.filter((c) => c.tier === 'SIMPLE').map((c) => c.id);
/** Machines per Night after Night 1 (2 to 3 as asked: the 12 non-starters fill Nights 2 to 7 evenly). */
export const PER_NIGHT = 2;
/** First and last Night that opens something. Night 8 (the finale) opens nothing; every core machine is already on. */
export const FIRST_UNLOCK_NIGHT = 2;
export const FINAL_NIGHT = 8;

/**
 * Devices that are never locked and never covered: vendors, terminals, the phone, jukebox, shrine (all `category: system`)
 * and the story tables (Tally Bench duels, the Devil's Table in the Parlour).
 */
export const ALWAYS_OPEN: ReadonlySet<MachineId> = new Set<MachineId>([
  'debt_terminal', 'hotline', 'bounty_board', 'charm_vendor', 'cashier', 'jukebox', 'tonic_vendor', 'shrine',
  'tallytable', 'devilstable', 'lordstable',
]);

/** Machines that exist only in the Free Casino: every registered machine that is neither core nor always-open. */
export function isFreeOnly(id: MachineId): boolean { return !CORE_SET.has(id) && !ALWAYS_OPEN.has(id); }
export function isCore(id: MachineId): boolean { return CORE_SET.has(id); }
export function tierOf(id: MachineId): Tier | null { return TIER_OF.get(id) ?? null; }

// ── the schedule ─────────────────────────────────────────────────────────────────────────────────────
export interface UnlockStep { night: number; ids: readonly MachineId[] }

const cache = new Map<number, readonly UnlockStep[]>();

/**
 * The full schedule for a run seed: step 0 is Night 1 (the starters); later steps hold `PER_NIGHT` machines each, tiers in
 * order, seeded shuffle inside a tier. `seed` undefined or 0 gives the canonical order of `CORE_PLAN`.
 */
export function scheduleFor(seed?: number): readonly UnlockStep[] {
  const key = seed ? seed >>> 0 : 0;
  const hit = cache.get(key);
  if (hit) return hit;
  const ordered: MachineId[] = [];
  for (const tier of TIERS) {
    if (tier === 'SIMPLE') continue;
    const ids = CORE_PLAN.filter((c) => c.tier === tier).map((c) => c.id);
    if (key) createRng(hashSeed('progression', key, tier)).shuffle(ids);
    ordered.push(...ids);
  }
  const steps: UnlockStep[] = [{ night: 1, ids: STARTERS }];
  for (let i = 0; i < ordered.length; i += PER_NIGHT) {
    steps.push({ night: FIRST_UNLOCK_NIGHT + i / PER_NIGHT, ids: ordered.slice(i, i + PER_NIGHT) });
  }
  cache.set(key, steps);
  return steps;
}
/** The canonical schedule (no seed). */
export const UNLOCK_SCHEDULE: readonly UnlockStep[] = scheduleFor();

/** The Night a core machine opens (1 to 7), `1` for always-open devices, `Infinity` for Free-Casino-only machines. */
export function unlockNightOf(id: MachineId, seed?: number): number {
  if (ALWAYS_OPEN.has(id)) return 1;
  for (const s of scheduleFor(seed)) if (s.ids.includes(id)) return s.night;
  return Infinity;
}

/** Every core machine open on `night` (cumulative), in unlock order. Night < 1 reads as Night 1. */
export function unlockedFor(night: number, seed?: number): MachineId[] {
  const n = Math.max(1, Math.floor(night));
  const out: MachineId[] = [];
  for (const s of scheduleFor(seed)) if (s.night <= n) out.push(...s.ids);
  return out;
}

/** What opens on exactly this Night (the toast list). Night 1 returns the starters; use `newOn` for "NEW" copy. */
export function opensOn(night: number, seed?: number): readonly MachineId[] {
  return scheduleFor(seed).find((s) => s.night === night)?.ids ?? [];
}

/** What is NEW on `night`: the machines that opened this Night. Empty on Night 1 (everything is new, nothing is flagged). */
export function newOn(night: number, seed?: number): readonly MachineId[] {
  return night >= FIRST_UNLOCK_NIGHT ? opensOn(night, seed) : [];
}

/** True for the one Night a machine carries the NEW marquee: the Night it opened (never Night 1). */
export function isNew(id: MachineId, night: number, seed?: number): boolean {
  return night >= FIRST_UNLOCK_NIGHT && unlockNightOf(id, seed) === night;
}

/** The next Night that opens something, with its machines, or null once everything is open. */
export function nextOpening(night: number, seed?: number): UnlockStep | null {
  return scheduleFor(seed).find((s) => s.night > night) ?? null;
}

// ── mode and lock queries ────────────────────────────────────────────────────────────────────────────
/** The Free Casino (and the bench) show everything; every other mode is the progressive floor. */
export function isProgressive(mode: GameMode | string | undefined): boolean {
  return mode !== 'free' && mode !== undefined;
}

/** Whether a machine is part of the layout for this mode at all (Free-only machines are absent from a Debt Run). */
export function inMode(id: MachineId, mode: GameMode | string | undefined): boolean {
  return !isProgressive(mode) || !isFreeOnly(id);
}

/** True when the machine is covered / locked on `night`: not yet scheduled, or not part of this mode. */
export function isLockedFor(id: MachineId, night: number, mode: GameMode | string | undefined, seed?: number): boolean {
  if (!isProgressive(mode)) return false;
  if (ALWAYS_OPEN.has(id)) return false;
  return unlockNightOf(id, seed) > Math.max(1, Math.floor(night));
}

/**
 * The Night whose machines are on the floor right now. The Dawn after Night n's quota is paid already opens Night n+1's
 * machines, so a paid Night reads as the next one (`topside`: the last Night is done, nothing opens).
 */
export function effectiveNight(night: number, nightPaid: boolean, topside = false): number {
  return nightPaid && !topside ? night + 1 : night;
}

// ── copy ─────────────────────────────────────────────────────────────────────────────────────────────
/** Machine display name through the registry's strings (`m.<id>.name`); the id itself when the registry is not loaded. */
export function machineName(id: MachineId): string {
  const key = `m.${id}.name`;
  const s = t(key);
  return s === key ? id : s;
}

/** The toast: "NEW ON THE FLOOR: Plinko Pit, Mines". Null when nothing is new tonight. */
export function newOnFloorText(night: number, seed?: number, nameOf: (id: MachineId) => string = machineName): string | null {
  const ids = newOn(night, seed);
  if (ids.length === 0) return null;
  return t('prog.toast.new', { names: ids.map(nameOf).join(', ') });
}

/** "OPENS NIGHT 4" (cover plate text and the interact sub-line). `Infinity` reads as the Free Casino plate. */
export function opensText(id: MachineId, seed?: number): string {
  const n = unlockNightOf(id, seed);
  return Number.isFinite(n) ? t('prog.opens', { n }) : t('prog.freeOnly');
}

// ── tycoon: buy a covered machine, collect the house cut (Wave 28) ──────────────────────────────────
/**
 * Any covered core machine can be BOUGHT with coins and opens for the rest of the run. The price is a share of the Night's
 * quota, harder tiers cost more; a bought machine ("owned") then pays a house cut at every Watch settle: a share of what the
 * House's ghost players wagered on it plus a small flat trickle. All pure: the run seeds the ghosts, the sim reuses the maths.
 *
 *   price      BUY_FRAC[tier] x quota(night), rounded to 5 (min 10).   Simple 30 %, Classic 50 %, Table 75 %, Heavy 100 %
 *   ghost bet  GHOST_K[tier] x quota x (0.8 .. 1.2) per Watch          (seeded per run, Night, Watch, machine)
 *   house cut  CUT_RATE[tier] x ghost bet + CUT_FLAT x quota           Simple 5 % .. Heavy 10 %, flat 1 % of the quota
 * Break-even is ~4 Nights for every tier (a late buy barely pays back: the early buy is the tycoon move).
 */
export const BUY_FRAC: Readonly<Record<Tier, number>> = { SIMPLE: 0.30, CLASSIC: 0.50, TABLE: 0.75, HEAVY: 1.0 };
export const GHOST_K: Readonly<Record<Tier, number>> = { SIMPLE: 0.40, CLASSIC: 0.50, TABLE: 0.65, HEAVY: 0.80 };
export const CUT_RATE: Readonly<Record<Tier, number>> = { SIMPLE: 0.05, CLASSIC: 0.065, TABLE: 0.08, HEAVY: 0.10 };
export const CUT_FLAT = 0.01;

/** Base quota of the Night with index `idx` (0 = Night 1), the figure every tycoon price and income scales with. */
export function nightQuota(idx: number): number { return quotaFor(Math.max(0, Math.floor(idx))); }

/** Coins to buy a covered machine at this quota. 0 when the machine is not a core machine (nothing to buy). */
export function buyPrice(id: MachineId, quota: number): number {
  const tier = tierOf(id);
  if (!tier) return 0;
  return Math.max(10, Math.round((BUY_FRAC[tier] * quota) / 5) * 5);
}

/** What the House's ghost players wagered on an owned machine this Watch (seeded, 0.8 to 1.2 of the tier's share of the quota). */
export function ghostWager(id: MachineId, quota: number, seed: number, nightIdx: number, watch: number): number {
  const tier = tierOf(id);
  if (!tier) return 0;
  const r = createRng(hashSeed('ghostcut', seed, nightIdx, watch, id));
  return Math.round(GHOST_K[tier] * quota * (0.8 + 0.4 * r.next()));
}

/** The house cut on `wager` coins wagered: tier rate plus the flat trickle (at least 1 coin). */
export function houseCut(id: MachineId, quota: number, wager: number): number {
  const tier = tierOf(id);
  if (!tier) return 0;
  return Math.max(1, Math.round(wager * CUT_RATE[tier] + CUT_FLAT * quota));
}

/** The cut an owned machine pays in an average Watch (no ghost noise): what the EMPIRE chip shows. */
export function expectedCut(id: MachineId, quota: number): number {
  const tier = tierOf(id);
  return tier ? houseCut(id, quota, GHOST_K[tier] * quota) : 0;
}
