/**
 * THE KEEPSAKE STAKE (Home layer, pillars 2 and 3: the family's things are the luck the House wants).
 *
 * At home, in the Evening, the player may carry ONE keepsake to the casino: the spouse's ring, the pocket watch or the photo.
 * At a machine the player may stake it instead of coins, once per Night. The stake is the round's whole bet (the coins are not
 * charged). A win returns the keepsake and adds one ŞANS star (the run emits `keepsake:stake`, the luck meter takes the star). A
 * loss gives the keepsake to the House: the spouse notices (Harmony −1) and the keepsake waits at the Debt Terminal, where the
 * player can buy it back for its price.
 *
 * Pure state only: no i18n, no bus, no run. The run (src/game/run.ts) asks `pending` before a bet, calls `open` once the bet is
 * taken, and calls `settle` from `win()`. Everything is plain data, saved under `resume.ext.keepsake`.
 */

declare module '@/core/events' {
  interface GameEvents {
    /** A keepsake round settled. A win brings the keepsake back (the luck meter adds `star`); a loss gives it to the House. */
    'keepsake:stake': { state: 'won' | 'lost'; id: KeepsakeId; mid: string; star: number };
    /** The Evening's carry choice changed (null: nothing carried). */
    'keepsake:carry': { id: KeepsakeId | null };
  }
}

export const KEEPSAKE_IDS = ['ring', 'watch', 'photo'] as const;
export type KeepsakeId = (typeof KEEPSAKE_IDS)[number];

/** ŞANS stars a win with a keepsake adds (the luck meter's move). */
export const KEEPSAKE_STAR = 1;
/** Harmony change when the House keeps the keepsake. */
export const KEEPSAKE_HARMONY_LOSS = -1;
/** Coins to buy a lost keepsake back at the Debt Terminal. Fixed per keepsake, so the price reads the same every Night. */
export const KEEPSAKE_PRICE: Readonly<Record<KeepsakeId, number>> = { ring: 150, watch: 90, photo: 40 };

/** A keepsake staked at a machine (`mid`, the seat) in a Night. */
export interface KeepsakeRound { id: KeepsakeId; mid: string; night: number }

/** The result of a settled keepsake round. `star` and `harmony` are what the run applies. */
export interface KeepsakeOutcome {
  state: 'won' | 'lost';
  id: KeepsakeId;
  mid: string;
  night: number;
  star: number;
  harmony: number;
}

/** JSON-safe save slice (`resume.ext.keepsake`). */
export interface KeepsakeSave {
  v: 1;
  owned: KeepsakeId[];
  lost: KeepsakeId[];
  carried: KeepsakeId | null;
  /** The last Night a keepsake was staked (the once-per-Night rule). 0 when none. */
  stakedNight: number;
  /** The stake waiting for the next bet at its seat, or null. */
  armed: KeepsakeRound | null;
  /** Rounds in play (a keepsake is on the table until its round settles). */
  rounds: KeepsakeRound[];
}

export interface Keepsakes {
  owned(): KeepsakeId[];
  lost(): KeepsakeId[];
  carried(): KeepsakeId | null;
  /** Carries one owned keepsake (or none). False for a keepsake the player does not own. Changing it drops a waiting stake. */
  carry(id: KeepsakeId | null): boolean;
  /** Arms the carried keepsake for the next bet at `mid`. False when none is carried, one was already staked this Night, or a round is open there. */
  arm(mid: string, night: number): boolean;
  /** Drops a waiting stake (no coins, no keepsake lost). */
  disarm(): void;
  /** The keepsake the next bet at `mid` would stake, or null. A pure read: nothing changes. */
  pending(mid: string, night: number): KeepsakeId | null;
  /** The bet was taken: the armed keepsake goes on the table at `mid`. Returns its id, or null when nothing was armed there. */
  open(mid: string, night: number): KeepsakeId | null;
  /** True while a keepsake round is open at `mid`. */
  inRound(mid: string): boolean;
  /** The round at `mid` ends: a win returns the keepsake, a loss gives it to the House. Null when no round is open there. */
  settle(mid: string, win: boolean): KeepsakeOutcome | null;
  /** A Night starts: a stake waiting from the last one is dropped. */
  newNight(): void;
  /** The price to buy `id` back, or null when it is not lost. */
  buyBackPrice(id: KeepsakeId): number | null;
  /** Moves a lost keepsake back to the owned list. The caller takes the coins first. Returns false when it is not lost. */
  buyBack(id: KeepsakeId): boolean;
  snapshot(): KeepsakeSave;
  restore(s: unknown): void;
}

const isId = (v: unknown): v is KeepsakeId => typeof v === 'string' && (KEEPSAKE_IDS as readonly string[]).includes(v);
const uniqIds = (v: unknown): KeepsakeId[] => {
  const out: KeepsakeId[] = [];
  if (Array.isArray(v)) for (const x of v) if (isId(x) && !out.includes(x)) out.push(x);
  return out;
};
const readRound = (v: unknown): KeepsakeRound | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<KeepsakeRound>;
  if (!isId(r.id) || typeof r.mid !== 'string' || typeof r.night !== 'number' || !Number.isFinite(r.night)) return null;
  return { id: r.id, mid: r.mid, night: Math.floor(r.night) };
};

/** A fresh keepsake box: all three are at home, none carried, none lost. */
export function createKeepsakes(): Keepsakes {
  let owned: KeepsakeId[] = [...KEEPSAKE_IDS];
  let lost: KeepsakeId[] = [];
  let carried: KeepsakeId | null = null;
  let stakedNight = 0;
  let armed: KeepsakeRound | null = null;
  let rounds: KeepsakeRound[] = [];

  const has = (id: KeepsakeId): boolean => owned.includes(id);
  const pendingOf = (mid: string, night: number): KeepsakeId | null => {
    if (!armed || armed.mid !== mid || armed.night !== night || stakedNight === night) return null;
    return has(armed.id) ? armed.id : null;
  };

  return {
    owned: (): KeepsakeId[] => [...owned],
    lost: (): KeepsakeId[] => [...lost],
    carried: (): KeepsakeId | null => carried,
    carry(id): boolean {
      if (id !== null && !has(id)) return false;
      if (id !== carried) armed = null;   // a stake is for the keepsake that was armed; another one drops it
      carried = id;
      return true;
    },
    arm(mid, night): boolean {
      if (carried === null || stakedNight === night) return false;
      if (rounds.some((r) => r.mid === mid)) return false;
      armed = { id: carried, mid, night };
      return true;
    },
    disarm(): void { armed = null; },
    pending: pendingOf,
    open(mid, night): KeepsakeId | null {
      const id = pendingOf(mid, night);
      if (id === null) return null;
      rounds = [...rounds.filter((r) => r.mid !== mid), { id, mid, night }];
      stakedNight = night;
      armed = null;
      return id;
    },
    inRound: (mid): boolean => rounds.some((r) => r.mid === mid),
    settle(mid, win): KeepsakeOutcome | null {
      const r = rounds.find((x) => x.mid === mid);
      if (!r) return null;
      rounds = rounds.filter((x) => x.mid !== mid);
      if (win) return { state: 'won', id: r.id, mid, night: r.night, star: KEEPSAKE_STAR, harmony: 0 };
      owned = owned.filter((x) => x !== r.id);
      if (!lost.includes(r.id)) lost = [...lost, r.id];
      if (carried === r.id) carried = null;
      return { state: 'lost', id: r.id, mid, night: r.night, star: 0, harmony: KEEPSAKE_HARMONY_LOSS };
    },
    newNight(): void { armed = null; },
    buyBackPrice(id): number | null { return lost.includes(id) ? KEEPSAKE_PRICE[id] : null; },
    buyBack(id): boolean {
      if (!lost.includes(id)) return false;
      lost = lost.filter((x) => x !== id);
      owned = [...owned, id];
      return true;
    },
    snapshot(): KeepsakeSave {
      return {
        v: 1, owned: [...owned], lost: [...lost], carried, stakedNight,
        armed: armed ? { ...armed } : null, rounds: rounds.map((r) => ({ ...r })),
      };
    },
    restore(s: unknown): void {
      const e = s && typeof s === 'object' ? (s as Partial<KeepsakeSave>) : {};
      owned = uniqIds(e.owned);
      lost = uniqIds(e.lost).filter((id) => !owned.includes(id));
      if (!Array.isArray(e.owned)) owned = [...KEEPSAKE_IDS];   // an unreadable slice reads as a fresh box
      carried = isId(e.carried) && owned.includes(e.carried) ? e.carried : null;
      stakedNight = typeof e.stakedNight === 'number' && Number.isFinite(e.stakedNight) ? Math.max(0, Math.floor(e.stakedNight)) : 0;
      armed = readRound(e.armed);
      rounds = Array.isArray(e.rounds) ? e.rounds.map(readRound).filter((r): r is KeepsakeRound => r !== null) : [];
    },
  };
}
