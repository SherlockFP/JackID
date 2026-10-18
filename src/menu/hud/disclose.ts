/**
 * Progressive disclosure by printed Night (wave 72, onboarding). A new player meets a few numbers at a time: Night 1 shows the
 * coins, the pulls, the quota and shortfall, the Bell and the clock; each later Night adds the next group (the scout's study, w72-onboarding.md).
 * Pure: the Night is passed in (1-based, as printed). Nothing here hides a rule. The game runs the same either way; only the
 * readout waits. Used by hud.ts, seatHud.ts and tutorial.ts (the objective line).
 */

/** The readouts that wait for a Night. The value is the first printed Night that shows it. */
export type Reveal = 'payout' | 'projection' | 'hot' | 'tilt' | 'floorEvents' | 'cards' | 'tithe' | 'spotlight' | 'overshoot';

const FIRST_NIGHT: Readonly<Record<Reveal, number>> = {
  payout: 2,        // ÖDEME chip (House Favour, Mood, air): Night 2
  projection: 2,    // the Dawn projection (ŞAFAK): Night 2; Night 1 reads the bank against the quota
  hot: 2,           // the Hot Lamp line
  tilt: 2,          // the Tilt bulbs at the seat
  floorEvents: 2,   // the Watch floor-event timer
  cards: 2,         // Night Cards: the first offer opens at the Night 2 Dawn (nightCards.ts gates the offer itself)
  tithe: 3,         // the Watch tithe
  spotlight: 4,     // the Spotlight chip
  overshoot: 4,     // the OVERSHOOT line
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

export type Objective = 'win' | 'deposit' | 'bell' | 'lift' | 'dawn';
/** The world machine the objective points at (its waypoint), or null for no waypoint. */
export type ObjectiveTarget = 'bigone' | 'debt_terminal' | null;

export interface ObjectiveFacts {
  /** The shift phase (`run.shift.state().phase`). */
  phase: string;
  /** The Night's quota is paid (`run.nightPaid`). */
  paid: boolean;
  /** Rounds the player has played this Night. */
  rounds: number;
  /** Deposits the player has made this Night. */
  deposits: number;
  /** Coins in the pocket. */
  pocket: number;
}

/**
 * The one objective for Nights 1 and 2, from the player's state. Paid → take the lift home. In a Watch: win coins at a machine,
 * then deposit at the terminal, then ring the Bell. Between Watches with the quota open: the quota is due at Dawn.
 */
export function objectiveFor(f: ObjectiveFacts): { key: Objective; target: ObjectiveTarget } {
  if (f.paid) return { key: 'lift', target: null };
  const inWatch = f.phase === 'play' || f.phase === 'lastCall';
  if (!inWatch) return { key: f.phase === 'bell' || f.phase === 'settle' ? 'bell' : 'dawn', target: null };
  if (f.rounds === 0) return { key: 'win', target: 'bigone' };
  if (f.deposits === 0 && f.pocket > 0) return { key: 'deposit', target: 'debt_terminal' };
  return { key: 'bell', target: null };
}
