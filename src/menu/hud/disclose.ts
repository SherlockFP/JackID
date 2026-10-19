/**
 * Progressive disclosure by printed Night (wave 72, onboarding). A new player meets a few numbers at a time: Night 1 shows the
 * coins, the pulls, the quota and shortfall, the Bell and the clock; each later Night adds the next group (the scout's study, w72-onboarding.md).
 * Pure: the Night is passed in (1-based, as printed). Nothing here hides a rule. The game runs the same either way; only the
 * readout waits. Used by hud.ts, seatHud.ts and tutorial.ts (the objective line).
 */

/** The readouts that wait for a Night. The value is the first printed Night that shows it. */
export type Reveal = 'payout' | 'projection' | 'hot' | 'tilt' | 'floorEvents' | 'cards' | 'tithe' | 'spotlight' | 'overshoot' | 'luck';

const FIRST_NIGHT: Readonly<Record<Reveal, number>> = {
  payout: 2,        // ÖDEME chip (House Favour, Mood, air): Night 2
  projection: 2,    // the Dawn projection (ŞAFAK): Night 2; Night 1 reads the bank against the quota
  hot: 2,           // the Hot Lamp line
  tilt: 2,          // the Tilt bulbs at the seat
  floorEvents: 2,   // the Watch floor-event timer
  cards: 2,         // boon offers (pantheon.ts gates the offer itself; the first comes at the Night 1 Dawn)
  tithe: 3,         // the Watch tithe
  spotlight: 4,     // the Spotlight chip
  overshoot: 4,     // the OVERSHOOT line
  luck: 2,          // the ŞANS meter (game/luck.ts): from Night 2, when the first quota is paid
};

/** True when the readout `what` is shown on printed Night `night`. */
export function revealed(night: number, what: Reveal): boolean {
  return Math.floor(night) >= FIRST_NIGHT[what];
}

/** The stake presets (keys 7 / 8 / 9) and the first printed Night each one is shown on. */
export const PRESET_FIRST_NIGHT = { safe: 1, bold: 2, big: 3 } as const;
export type PresetKey = keyof typeof PRESET_FIRST_NIGHT;

/** True when the stake preset `key` is shown on printed Night `night` (SAFE from Night 1, BOLD from 2, BIG from 3). */
export function presetRevealed(night: number, key: PresetKey): boolean {
  return Math.floor(night) >= PRESET_FIRST_NIGHT[key];
}

/** The one objective line is always on screen up to and including this Night. */
export const OBJECTIVE_LAST_NIGHT = 2;

/** True while the objective line is on screen (Nights 1 and 2). */
export function objectiveShown(night: number): boolean {
  return Math.floor(night) <= OBJECTIVE_LAST_NIGHT;
}

/** The tickets readout (BİLET) shows once the player has held a ticket; `seen` latches that for the run. */
export function ticketsShown(seen: boolean, held: number): boolean {
  return seen || held > 0;
}

export type Objective = 'win' | 'deposit' | 'bell' | 'lift' | 'dawn' | 'broke.bank' | 'broke.cashier' | 'broke.phone' | 'broke.loan';
/** The world spot the objective points at (its waypoint): a machine, the Bell prop (`bell` anchor), the lift door (`elevator.door` anchor), or null for no waypoint. */
export type ObjectiveTarget = 'bigone' | 'debt_terminal' | 'cashier' | 'bell' | 'lift' | null;

export interface ObjectiveFacts {
  /** The shift phase (`run.shift.state().phase`). */
  phase: string;
  /** The Night's quota is paid (`run.nightPaid`). */
  paid: boolean;
  /** Rounds the player has played this Night. */
  rounds: number;
  /** Deposits the player has made this Night (used only when `owed` is left out). */
  deposits: number;
  /** Coins in the pocket. */
  pocket: number;
  /** Quota coins still owed tonight (`run.bank().left`, 0 = met). Left out: the older deposit-count rule applies. */
  owed?: number;
  /** The pocket can't cover the cheapest bet: the first way out (`run.brokeHelp().steps[0].id`), null or left out when not broke. */
  broke?: 'bell' | 'bank' | 'phone' | 'cashier' | 'loan' | null;
}

const BROKE_TARGET: Record<'bank' | 'phone' | 'cashier' | 'loan', ObjectiveTarget> = { bank: 'debt_terminal', cashier: 'cashier', phone: null, loan: null };

/**
 * The one objective for Nights 1 and 2, from the player's state, re-read every frame. Paid: take the lift home. Last Call: ring the
 * Bell (its waypoint). Between Watches with the quota open: the quota is due at Dawn. In a Watch: no round played yet → win coins
 * at The Big One; quota met → ring the Bell; the pocket covers what is still owed → deposit at the terminal; otherwise win more.
 */
export function objectiveFor(f: ObjectiveFacts): { key: Objective; target: ObjectiveTarget } {
  if (f.paid) return { key: 'lift', target: 'lift' };
  if (f.phase === 'lastCall') return { key: 'bell', target: 'bell' };
  const inWatch = f.phase === 'play' || f.phase === 'closing';
  if (!inWatch) return { key: f.phase === 'bell' || f.phase === 'settle' ? 'bell' : 'dawn', target: null };
  // broke: point at the first way out (the run orders them), so an empty pocket is never a dead end
  if (f.broke === 'bell') return { key: 'bell', target: 'bell' };
  if (f.broke) return { key: `broke.${f.broke}`, target: BROKE_TARGET[f.broke] };
  if (f.rounds === 0) return { key: 'win', target: 'bigone' };
  if (f.owed === undefined) {
    // the older rule (no owed figure given): a deposit is still to come while coins sit in the pocket
    if (f.deposits === 0 && f.pocket > 0) return { key: 'deposit', target: 'debt_terminal' };
    return { key: 'bell', target: null };
  }
  const owed = Math.max(0, f.owed);
  if (owed <= 0) return { key: 'bell', target: 'bell' };
  if (f.pocket >= owed) return { key: 'deposit', target: 'debt_terminal' };
  return { key: 'win', target: 'bigone' };
}
