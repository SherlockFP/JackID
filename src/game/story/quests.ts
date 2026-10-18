/**
 * The Wash ledger (THE SECOND NAME, quest 1). Find the three ledger pages (n17, n18, n19) in the casino and the Wash opens
 * a locker: one free charm, picked from three, and the last line of the ledger ties the book to the second name.
 *
 * Pure: no app core, no DOM, no clock. The progress lives in `RoomsState.ledger` (run-private, saved with the rooms, so
 * `restoreRooms` brings it back). The host calls `ledgerFind` when a ledger note is read and `ledgerChoices` / `ledgerClaim`
 * at the locker. The strings are in `quests.strings.ts` (keys `quest.ledger.*`).
 */
import { createRng, hashSeed } from '@/core/rng';

/** The three ledger pages, in reading order. */
export const LEDGER_NOTES: readonly string[] = ['n17', 'n18', 'n19'];

export const LEDGER = {
  total: LEDGER_NOTES.length,
  /** Charms on offer at the locker. */
  charmChoices: 3,
  /** Seed tag for the offer's rng stream (`hashSeed(tag, seed)`). */
  seedTag: 'quest.ledger',
} as const;

export interface LedgerProgress {
  /** Ledger note ids found so far, in reading order. */
  found: string[];
  /** The locker's charm has been taken. */
  claimed: boolean;
}

export function ledgerStart(): LedgerProgress { return { found: [], claimed: false }; }

export function isLedgerNote(id: string): boolean { return LEDGER_NOTES.includes(id); }

export function ledgerDone(p: LedgerProgress): boolean { return LEDGER_NOTES.every((id) => p.found.includes(id)); }

/** The journal's objective counts while the quest runs: started (a page found) and not claimed. Null otherwise. */
export function ledgerLine(p: LedgerProgress): { n: number; total: number } | null {
  return p.found.length > 0 && !p.claimed ? { n: p.found.length, total: LEDGER.total } : null;
}

export interface LedgerFind {
  progress: LedgerProgress;
  /** True only for a ledger page not seen before (the toast and the count fire on this). */
  fresh: boolean;
  /** Pages found after this read, and the total. */
  n: number;
  total: number;
  /** True on the read that completes the ledger. */
  completed: boolean;
}

/** A ledger page was read. Non-ledger notes and repeat reads change nothing. */
export function ledgerFind(p: LedgerProgress, id: string): LedgerFind {
  if (!isLedgerNote(id) || p.found.includes(id)) {
    return { progress: p, fresh: false, n: p.found.length, total: LEDGER.total, completed: false };
  }
  const found = LEDGER_NOTES.filter((x) => x === id || p.found.includes(x));
  return {
    progress: { ...p, found },
    fresh: true,
    n: found.length,
    total: LEDGER.total,
    completed: found.length === LEDGER.total,
  };
}

/** Restores a saved ledger, dropping anything malformed. The found list is kept in reading order; the claim needs the full set. */
export function restoreLedger(raw: unknown): LedgerProgress {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { found?: unknown; claimed?: unknown };
  const seen = Array.isArray(o.found) ? o.found.filter((x): x is string => typeof x === 'string') : [];
  const found = LEDGER_NOTES.filter((id) => seen.includes(id));
  return { found, claimed: found.length === LEDGER.total && o.claimed === true };
}

/**
 * The charms the locker offers: `charmChoices` distinct ids drawn from `charms` by a shuffle seeded from (seed). The pool is
 * de-duplicated and sorted first, so the same pool and seed always give the same three. Empty until the ledger is done
 * and unclaimed, or when the pool is empty.
 */
export function ledgerChoices(p: LedgerProgress, seed: number, charms: readonly string[]): string[] {
  if (!ledgerDone(p) || p.claimed) return [];
  const pool = [...new Set(charms)].sort();
  const rng = createRng(hashSeed(LEDGER.seedTag, seed));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, LEDGER.charmChoices);
}

export interface LedgerClaim { ok: boolean; progress: LedgerProgress; charm?: string }

/** Takes one charm from the offer. Refused unless `pick` is one of the three `ledgerChoices` gives. */
export function ledgerClaim(p: LedgerProgress, pick: string, seed: number, charms: readonly string[]): LedgerClaim {
  if (!ledgerChoices(p, seed, charms).includes(pick)) return { ok: false, progress: p };
  return { ok: true, progress: { ...p, claimed: true }, charm: pick };
}
