/**
 * Special rooms and the Keyring (WAVE 24 plan §2). Pure logic plus the shared contract the other lanes use.
 *
 *   • Keyring: +1 Wing Key at each Dawn after Nights 1–6, +1 for beating the boss on Nights 3, 6 or 8, and the Manager's Key
 *     (Counting Room only) from the Night 6 boss. A closed grille offers "Spend KEY" or "BUY 1.5× quota" (`grilleOptions`).
 *   • Room rules are zone-scoped ModEffects. `roomsProvider` is a ModProvider that adds the rules of every OPEN room, plus the
 *     boiler's pressure payout while the Boiler is open. Register it once with the run's mods.
 *   • Boiler, lockers, Back Office and Collector are state transitions on a plain `RoomsState` (no hidden clock or rng stream):
 *     every locker result comes from `hashSeed('room.locker', seed, night, n)`.
 *
 * Events (`bus`): `room:opened` {zone}, `room:pressure` {p}, `room:locker` {n, result}. The pure functions emit nothing; the host
 * calls `announcePressure` / `announceLocker`. The tycoon emits `room:opened` itself when a zone opens.
 */
import { bus } from '@/core/events';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import type { ModEffect, ModProvider, ModSource } from '@/game/modifiers.types';
import {
  BACK_OFFICE, BOILER, COLLECTOR, KEYRING, KEYRING_WINGS, LOCKER, LOCKER_TABLE, LOCKSMITH_ORDER,
  ROOM_RULES, WING_IDS, type LockerKind, type WingId,
} from '@/game/data/rooms';

export type { WingId, LockerKind } from '@/game/data/rooms';
export { KEYRING, BOILER, LOCKER, BACK_OFFICE, COLLECTOR, KEYRING_WINGS, LOCKSMITH_ORDER, WING_IDS, ROOM_RULES } from '@/game/data/rooms';

declare module '@/core/events' {
  interface GameEvents {
    'room:opened': { zone: string };
    'room:pressure': { p: number };
    'room:locker': { n: number; result: LockerResult };
  }
}

export type WingState = 'sealed' | 'keyReady' | 'open';

// ── the shared contract: wing state ────────────────────────────────────────────────────────────────────
/** What the wing state reads from the run. The integrator binds it once (`bindWingSource`). */
export interface WingSource {
  /** Zones already open this run (`tycoon.state().zones`). */
  opened(): readonly string[];
  /** `run.wingKeys`. */
  keys(): number;
  /** The Counting Room key: the Manager's Key, or Foundations F6 (which also opens the room for free). */
  managerKey?(): boolean;
}

let bound: WingSource | null = null;
/** Binds the run's wing source for `wingState` / `grilleOptions` / `locksmithZone` (null unbinds). */
export function bindWingSource(src: WingSource | null): void { bound = src; }

export function isWing(zone: string): zone is WingId { return (WING_IDS as readonly string[]).includes(zone); }
export function isKeyringWing(zone: string): boolean { return (KEYRING_WINGS as readonly string[]).includes(zone); }

/** Whether the key the grille would spend is in hand (a Wing Key, or the Manager's Key for the Counting Room). */
function keyInHand(zone: string, src: WingSource): boolean {
  if (zone === 'counting') return !!src.managerKey?.();
  return isKeyringWing(zone) && src.keys() >= KEYRING.keyCost;
}

/** `sealed` (closed, no key), `keyReady` (closed, a key in hand) or `open`. Zones that are not rooms read as sealed until opened. */
export function wingState(zone: WingId | string, src: WingSource | null = bound): WingState {
  if (!src) return 'sealed';
  if (src.opened().includes(zone)) return 'open';
  return keyInHand(zone, src) ? 'keyReady' : 'sealed';
}

// ── the shared contract: grille options and prices ──────────────────────────────────────────────────────
/** BUY price of a Keyring wing: `buyQuotaMult × quota due`, rounded as the tycoon rounds it. */
export function buyPrice(quotaDue: number): number { return Math.round(KEYRING.buyQuotaMult * Math.max(0, quotaDue)); }

export interface GrilleOption { id: 'key' | 'buy'; cost: number }

/**
 * What pressing E on a closed grille offers. `key` needs a key in hand (cost 1 key); `buy` is for Keyring wings only, at the
 * quota price. An open room offers nothing. The counting room is key-only.
 */
export function grilleOptions(zone: string, quotaDue: number, src: WingSource | null = bound): GrilleOption[] {
  if (!src) return [];
  const st = wingState(zone, src);
  if (st === 'open') return [];
  const out: GrilleOption[] = [];
  if (st === 'keyReady') out.push({ id: 'key', cost: KEYRING.keyCost });
  if (isKeyringWing(zone)) out.push({ id: 'buy', cost: buyPrice(quotaDue) });
  return out;
}

// ── Keyring grants (pure; the run calls them and adds the result to `run.wingKeys`) ──────────────────
/** Dawn after `night`: +1 Wing Key on Nights 1–6. */
export function dawnKeys(night: number): number { return night >= 1 && night <= KEYRING.dawnNights ? 1 : 0; }
/** The boss of `night` beaten: +1 Wing Key on Nights 3, 6 and 8. */
export function bossKeys(night: number, beaten: boolean): number { return beaten && (KEYRING.bossNights as readonly number[]).includes(night) ? 1 : 0; }
/** The boss of `night` beaten: the Manager's Key (Counting Room) drops on Night 6. */
export function managerKeyDrop(night: number, beaten: boolean): boolean { return beaten && night === KEYRING.managerNight; }

/** The Parlour opens by itself once Night `parlourNight` is paid. True when it should open now. */
export function parlourAutoOpens(night: number, opened: readonly string[]): boolean {
  return night >= KEYRING.parlourNight && !opened.includes('parlour');
}

/** First wing the Locksmith can open: the first in `LOCKSMITH_ORDER` that is not open. Null when none is closed. */
export function locksmithZone(isOpen: (zone: string) => boolean = (z) => wingState(z) === 'open'): WingId | null {
  return LOCKSMITH_ORDER.find((z) => !isOpen(z)) ?? null;
}

// ── room rules (zone-scoped ModEffects of the open rooms) ───────────────────────────────────────────────
/** The static rules of the rooms in `opened`. */
export function roomRules(opened: readonly string[]): ModEffect[] {
  return ROOM_RULES.filter((e) => (e.scope?.zones ?? []).some((z) => opened.includes(z)));
}

/** Boiler payout: ×(1 + P/100), never above `maxPayoutMult`. Empty at P 0. */
export function boilerEffects(p: number): ModEffect[] {
  const pp = Math.max(0, Math.min(BOILER.max, p));
  if (pp <= 0) return [];
  return [{ hook: 'payout.mult', op: 'mult', value: Math.min(BOILER.maxPayoutMult, 1 + pp / 100), scope: { zones: ['boiler'] } }];
}

// ── run-private room state ──────────────────────────────────────────────────────────────────────────────
export interface RoomsState {
  /** Boiler pressure 0…100. */
  p: number;
  /** The boiler blew at 100 and is locked until the next Watch. */
  blown: boolean;
  /** The Night the locker tally belongs to, and the lockers opened on it (1…12). */
  lockerNight: number;
  lockers: number[];
}

export function roomsStart(): RoomsState {
  return { p: 0, blown: false, lockerNight: 0, lockers: [] };
}

/** Restores a saved state, dropping anything malformed. */
export function restoreRooms(raw: unknown): RoomsState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RoomsState, unknown>>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
  const lockers = Array.isArray(o.lockers)
    ? [...new Set(o.lockers.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= LOCKER.count))].sort((a, b) => a - b)
    : [];
  return {
    p: Math.max(0, Math.min(BOILER.max, num(o.p, 0))),
    blown: o.blown === true,
    lockerNight: Math.max(0, Math.floor(num(o.lockerNight, 0))),
    lockers,
  };
}

// ── boiler ─────────────────────────────────────────────────────────────────────────────────────────────
export interface PullResult { state: RoomsState; ok: boolean; blew: boolean }

/** One pull in the Boiler: P rises by `gainPerPull`; reaching 100 blows the room. A blown room takes no pulls. */
export function boilerPull(s: RoomsState): PullResult {
  if (s.blown) return { state: s, ok: false, blew: false };
  const p = Math.min(BOILER.max, s.p + BOILER.gainPerPull);
  if (p >= BOILER.max) return { state: { ...s, p: BOILER.max, blown: true }, ok: true, blew: true };
  return { state: { ...s, p }, ok: true, blew: false };
}

export interface VentResult { state: RoomsState; ok: boolean; pulls: number }

/** The Vent lever: resets P to 0 and costs `ventPulls` pulls (the host takes them). Refused while blown or at P 0. */
export function boilerVent(s: RoomsState): VentResult {
  if (s.blown || s.p <= 0) return { state: s, ok: false, pulls: 0 };
  return { state: { ...s, p: 0 }, ok: true, pulls: BOILER.ventPulls };
}

/** A new Watch starts: the boiler cools and unlocks. */
export function boilerNextWatch(s: RoomsState): RoomsState { return { ...s, p: 0, blown: false }; }

// ── lockers ────────────────────────────────────────────────────────────────────────────────────────────
export type LockerResult =
  | { k: 'note' }
  | { k: 'charm'; id: string }
  | { k: 'coins'; n: number }
  | { k: 'blank'; obols: number };

export interface LockerOptions {
  seed: number;
  night: number;
  /** Tickets the player holds (the opening costs `LOCKER.ticketCost`). */
  tickets: number;
  /** Charm ids a locker may hold. Empty = charms are off the table (the roll falls to a note). */
  charms: readonly string[];
}

export type LockerReason = 'range' | 'used' | 'tickets';
export interface LockerOpen {
  ok: boolean;
  reason?: LockerReason;
  state: RoomsState;
  result?: LockerResult;
  /** Tickets left after the opening (the caller spends `LOCKER.ticketCost` on success). */
  tickets: number;
  /** Dread beat: the 4th and later lockers of one Night. */
  dread: number;
}

/** Opens locker `n` (1…12) on `night`. The result is seeded by (seed, Night, n); a locker opens once per Night. */
export function openLocker(s: RoomsState, n: number, o: LockerOptions): LockerOpen {
  if (!Number.isInteger(n) || n < 1 || n > LOCKER.count) return { ok: false, reason: 'range', state: s, tickets: o.tickets, dread: 0 };
  const base = s.lockerNight === o.night ? s : { ...s, lockerNight: o.night, lockers: [] };
  if (base.lockers.includes(n)) return { ok: false, reason: 'used', state: base, tickets: o.tickets, dread: 0 };
  if (o.tickets < LOCKER.ticketCost) return { ok: false, reason: 'tickets', state: base, tickets: o.tickets, dread: 0 };
  const rng = createRng(hashSeed('room.locker', o.seed, o.night, n));
  const kind: LockerKind = rng.weighted(LOCKER_TABLE.map((e) => e.k), LOCKER_TABLE.map((e) => e.w));
  const result = lockerResult(kind, o, rng);
  const lockers = [...base.lockers, n].sort((a, b) => a - b);
  const dread = lockers.length > LOCKER.dreadAfter ? LOCKER.dread : 0;
  return { ok: true, state: { ...base, lockers }, result, tickets: o.tickets - LOCKER.ticketCost, dread };
}

function lockerResult(kind: LockerKind, o: LockerOptions, rng: Rng): LockerResult {
  switch (kind) {
    case 'coins': return { k: 'coins', n: LOCKER.coinBase + LOCKER.coinPerNight * o.night };
    case 'blank': return { k: 'blank', obols: LOCKER.blankObols };
    case 'charm': return o.charms.length ? { k: 'charm', id: rng.pick(o.charms) } : { k: 'note' };
    default: return { k: 'note' };
  }
}

/** Lockers still shut on the tally of `night` (12 at the start of a Night). */
export function lockersLeft(s: RoomsState, night: number): number {
  return LOCKER.count - (s.lockerNight === night ? s.lockers.length : 0);
}

// ── back office and collector ─────────────────────────────────────────────────────────────────────────────
/** Back Office: `3 Tickets → 1 Obol`. Returns the Obols paid and the Tickets left over. */
export function backOffice(tickets: number): { obols: number; tickets: number } {
  const t = Math.max(0, Math.floor(tickets));
  return { obols: Math.floor(t / BACK_OFFICE.tickets) * BACK_OFFICE.obols, tickets: t % BACK_OFFICE.tickets };
}

/** Parlour Collector: the Obol price of a charm, `2 ×` its sell value (at least 1). */
export function collectorPrice(sellValue: number): number {
  return Math.max(1, Math.ceil(COLLECTOR.sellMult * Math.max(0, sellValue)));
}

// ── mod provider and events ─────────────────────────────────────────────────────────────────────────────
export interface RoomsSource {
  opened(): readonly string[];
  rooms(): RoomsState;
}

/** The rooms' effects as one ModProvider (kind `rule`). Register it once with the run's mods. */
export function roomsProvider(src: RoomsSource): ModProvider {
  return {
    kind: 'rule',
    collect(_q, out): void {
      const opened = src.opened();
      const effects: ModEffect[] = roomRules(opened);
      if (opened.includes('boiler')) effects.push(...boilerEffects(src.rooms().p));
      if (!effects.length) return;
      const source: ModSource = { kind: 'rule', id: 'rooms', owner: 0, effects };
      out.push(source);
    },
  };
}

export function announcePressure(p: number): void { bus.emit('room:pressure', { p }); }
export function announceLocker(n: number, result: LockerResult): void { bus.emit('room:locker', { n, result }); }
