/**
 * Watch checkpoints (wave 58, director): the WATCH TITHE. From Night 3 every quota Watch has its own mini-target: 12 % of the
 * Night's quota, EARNED IN PLAY during that Watch. Earned = net winnings (credited wins less the stakes played), never deposits,
 * withdrawals or interest. Met at the Watch's Settle: +1 Ticket. Missed: the shortfall is added to tonight's quota (run.ts folds
 * `addedQuota()` into the quota formula), so a Night paid early in Watch 1 still has to be played through.
 *
 * Pure and HUD-agnostic: run.ts owns the wallet and calls `setNightQuota` (each quota recompute), `begin` (each Watch start),
 * `played` (each stake and each credited win), `settle` (each Watch settle) and `newNight` (each Night open). `view()` is the readout.
 * The overtime Watch (rope ladder) carries no tithe.
 */

/** The share of the Night's quota each Watch must earn in play. */
export const TITHE_SHARE = 0.12;   // director: 0.2 was missed ~70 % of the time and read as a trap; 0.12 keeps a Watch contested
/** The printed Night from which every quota Watch carries a tithe (Nights 1-2 are the teaching Nights). */
export const TITHE_FROM_NIGHT = 3;
/** Tickets paid for a met tithe. */
export const TITHE_TICKETS = 1;

/** The Watch's target for a Night quota (0 when there is nothing to earn against). */
export function titheTarget(nightQuota: number): number {
  return Math.max(0, Math.floor((Number.isFinite(nightQuota) ? nightQuota : 0) * TITHE_SHARE));
}

/** Net winnings of a Watch: the credited wins less the stakes, never below 0 (a losing Watch earns nothing). */
export function titheEarned(won: number, staked: number): number {
  return Math.max(0, Math.floor(won - staked));
}

/** Whether a Watch of this printed Night (and overtime or not) carries a tithe. */
export function titheApplies(nightNo: number, overtime: boolean): boolean {
  return nightNo >= TITHE_FROM_NIGHT && !overtime;
}

export interface TitheView {
  /** The current Watch carries a tithe (Night 3 on, not overtime, a quota to earn against). */
  on: boolean;
  /** The Watch's target, in coins of net winnings. */
  target: number;
  /** Net winnings so far this Watch (never negative). */
  earned: number;
  /** Earned has reached the target (live; the Settle decides the outcome). */
  met: boolean;
  /** How far short the Watch is now (0 once met). */
  shortfall: number;
}

export interface TitheResult {
  state: 'met' | 'missed';
  target: number;
  earned: number;
  /** Coins added to tonight's quota (0 when met). */
  shortfall: number;
  /** Tickets paid (TITHE_TICKETS when met, else 0). */
  tickets: number;
}

export interface TitheSave {
  base: number;
  on: boolean;
  won: number;
  staked: number;
  added: number;
}

export class WatchTithe {
  /** The Night's quota without tithes and rescue loans (set by the quota recompute). */
  private base = 0;
  private on = false;
  private won = 0;
  private staked = 0;
  /** Coins the missed tithes have added to tonight's quota. */
  private added = 0;

  /** Quota the missed tithes have added tonight. */
  addedQuota(): number {
    return this.added;
  }

  /** The Night's quota as the formula reads it, without the tithes and the rescue loans (target basis). */
  setNightQuota(base: number): void {
    this.base = Math.max(0, Math.floor(Number.isFinite(base) ? base : 0));
  }

  /** A Night opens: the tithes of the last Night no longer count. */
  newNight(): void {
    this.added = 0;
    this.won = 0;
    this.staked = 0;
    this.on = false;
  }

  /** A Watch starts: its target is read from the Night quota and its net winnings start at zero. */
  begin(nightNo: number, overtime: boolean): void {
    this.won = 0;
    this.staked = 0;
    this.on = titheApplies(nightNo, overtime) && titheTarget(this.base) > 0;
  }

  /** A paid play: `won` credited to the pocket and `staked` taken from it. Ignored outside a tithe Watch. */
  played(won: number, staked: number): void {
    if (!this.on) return;
    this.won += Math.max(0, Number.isFinite(won) ? won : 0);
    this.staked += Math.max(0, Number.isFinite(staked) ? staked : 0);
  }

  view(): TitheView {
    const target = titheTarget(this.base);
    const earned = titheEarned(this.won, this.staked);
    return {
      on: this.on,
      target: this.on ? target : 0,
      earned: this.on ? earned : 0,
      met: this.on && earned >= target,
      shortfall: this.on ? Math.max(0, target - earned) : 0,
    };
  }

  /** The Watch's Settle: returns the outcome once (null when the Watch had no tithe), then the Watch is closed. */
  settle(): TitheResult | null {
    if (!this.on) return null;
    const target = titheTarget(this.base);
    const earned = titheEarned(this.won, this.staked);
    const met = earned >= target;
    const shortfall = met ? 0 : target - earned;
    this.on = false;
    this.added += shortfall;
    return { state: met ? 'met' : 'missed', target, earned, shortfall, tickets: met ? TITHE_TICKETS : 0 };
  }

  /** The save slice, or undefined when there is nothing to keep (no Night quota yet). */
  snapshot(): TitheSave | undefined {
    if (this.base === 0 && this.added === 0 && !this.on) return undefined;
    return { base: this.base, on: this.on, won: this.won, staked: this.staked, added: this.added };
  }

  restore(s: TitheSave | undefined): void {
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
    this.base = Math.floor(num(s?.base));
    this.on = s?.on === true;
    this.won = num(s?.won);
    this.staked = num(s?.staked);
    this.added = Math.floor(num(s?.added));
  }
}
