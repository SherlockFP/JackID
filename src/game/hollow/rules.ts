/**
 * The Hollow Door (TR: Oyuk Kapı) — a secret portal, at most once per run, pure rules. No three, kit or DOM.
 *
 * Reveal triggers (any one opens the door, from `hidden`):
 *   knock  — 3 knocks within 4 s on the cracked wall plate in the Boiler/Sump corridor, during Last Call of a Watch from Night 2.
 *   phone  — the phone rings at 3:33 on the Night clock with no caller; answering and choosing "go down" opens it.
 *            Hanging up spends the phone for the run (the knock and the loan triggers stay possible).
 *   loan   — the pocket is at 0 and the House refuses the loan: a red seam opens near the player.
 *
 * Path: hidden → open → underneath (the void room) → duel (a Lord picked, `lordstable` machine) → used.
 * Declining or leaving the room closes it (closed). Dawn closes an unentered door (closed). Both are final for the run.
 * The Lords' outcome is turned into run effects by `effectsOf`; the integrator applies them with `applyEffects`.
 */

export type LordId = 'ash' | 'ledgers' | 'mirrors';
export const LORDS: readonly LordId[] = ['ash', 'ledgers', 'mirrors'];

/** Nights of quota a win forgives, counted from the current Night (Ledgers reaches into the next one). */
export const LORD_FORGIVE_NIGHTS: Readonly<Record<LordId, number>> = { ash: 1, ledgers: 2, mirrors: 1 };
/** Obols banked when the Lord takes you (the run still banks them, ×1.5). */
export const TAKEN_OBOL_MULT = 1.5;

export const KNOCKS = 3;
export const KNOCK_WINDOW_S = 4;
export const DOOR_FIRST_NIGHT = 2;
export const PHONE_HOUR = 3;
export const PHONE_MINUTE = 33;

export type DoorStatus = 'hidden' | 'ringing' | 'open' | 'underneath' | 'duel' | 'used' | 'closed';
export type DoorTrigger = 'knock' | 'phone' | 'loan';
export type DuelEnd = 'won' | 'taken' | 'left';

export interface DoorState {
  status: DoorStatus;
  trigger: DoorTrigger | null;
  /** Times (s, Watch clock) of the knocks still inside the window. */
  knocks: number[];
  /** The phone was hung up on this run: it never rings again. */
  phoneSpent: boolean;
  lord: LordId | null;
  ended: DuelEnd | null;
}

export const initDoor = (): DoorState => ({ status: 'hidden', trigger: null, knocks: [], phoneSpent: false, lord: null, ended: null });

/** Opens the door from `hidden` (only once per run; any other status is returned unchanged). */
export function reveal(s: DoorState, trigger: DoorTrigger): DoorState {
  if (s.status !== 'hidden') return s;
  return { ...s, status: 'open', trigger, knocks: [] };
}

/**
 * A knock on the cracked plate at Watch time `t` (s). Counts only inside Last Call of a Watch from Night 2 and on the plate;
 * anything else is ignored. Three knocks inside the window reveal the door.
 */
export function knock(s: DoorState, t: number, where: { onPlate: boolean; lastCall: boolean; night: number }): { state: DoorState; revealed: boolean } {
  if (s.status !== 'hidden' || !where.onPlate || !where.lastCall || where.night < DOOR_FIRST_NIGHT) return { state: s, revealed: false };
  const knocks = [...s.knocks.filter((k) => t - k <= KNOCK_WINDOW_S && k <= t), t];
  if (knocks.length < KNOCKS) return { state: { ...s, knocks }, revealed: false };
  return { state: reveal({ ...s, knocks: [] }, 'knock'), revealed: true };
}

/** The phone at the Night clock. `hasCaller` true means a real call (the door does not ring for it). */
export function ring(s: DoorState, clock: { hour: number; minute: number }, hasCaller: boolean): DoorState {
  if (s.status !== 'hidden' || s.phoneSpent || hasCaller) return s;
  if (clock.hour % 12 !== PHONE_HOUR % 12 || clock.minute !== PHONE_MINUTE) return s;
  return { ...s, status: 'ringing' };
}

/** Answering the ringing phone: "go down" opens the door, anything else hangs up and spends the phone. */
export function answer(s: DoorState, choice: 'godown' | 'hangup'): DoorState {
  if (s.status !== 'ringing') return s;
  if (choice === 'godown') return { ...s, status: 'open', trigger: 'phone' };
  return { ...s, status: 'hidden', phoneSpent: true };
}

/** The House refuses a loan while the pocket is empty: a red seam opens. */
export function loanRefused(s: DoorState, pocket: number, refused: boolean): DoorState {
  if (s.status !== 'hidden' || !refused || pocket > 0) return s;
  return reveal(s, 'loan');
}

/** Walk through the open door into the Underneath. */
export function enter(s: DoorState): DoorState {
  return s.status === 'open' ? { ...s, status: 'underneath' } : s;
}

/** Leave the Underneath without playing: the door closes for the run. */
export function leave(s: DoorState): DoorState {
  return s.status === 'underneath' ? { ...s, status: 'closed', ended: 'left' } : s;
}

/** Choose one Lord (one per run). */
export function pickLord(s: DoorState, lord: LordId): DoorState {
  return s.status === 'underneath' && LORDS.includes(lord) ? { ...s, status: 'duel', lord } : s;
}

/** The duel ended (won, taken, or left): the door seals for good. */
export function finish(s: DoorState, ended: DuelEnd): DoorState {
  return s.status === 'duel' ? { ...s, status: 'used', ended } : s;
}

/** Dawn: an unentered door closes (only `open`; a ringing phone at dawn is dropped too). */
export function dawn(s: DoorState): DoorState {
  return s.status === 'open' || s.status === 'ringing' ? { ...s, status: 'closed', trigger: s.trigger } : s;
}

/** True while the door can still open or be entered for this run. */
export const isAlive = (s: DoorState): boolean => s.status === 'hidden' || s.status === 'ringing' || s.status === 'open' || s.status === 'underneath' || s.status === 'duel';

// ── run effects ───────────────────────────────────────────────────────────────────────────────

export type HollowEffect =
  | { k: 'forgiveQuota'; nights: number }
  | { k: 'takeRun' }
  | { k: 'restoreSoulMark' }
  | { k: 'bankObols'; mult: number };

/**
 * The run effects of a duel's end. A win forgives the Night's quota (Ledgers: this Night and the next) and a correct
 * Mirror call also restores one Soul Mark. Being taken ends the run and banks Obols ×1.5. Leaving changes nothing.
 */
export function effectsOf(ended: DuelEnd, lord: LordId | null, calledCorrect = false): HollowEffect[] {
  const out: HollowEffect[] = [];
  if (ended === 'won' && lord) {
    out.push({ k: 'forgiveQuota', nights: LORD_FORGIVE_NIGHTS[lord] });
    if (calledCorrect) out.push({ k: 'restoreSoulMark' });
  } else if (ended === 'taken') {
    // Obols first: the run ends (and banks them) on `takeRun`, so the multiplier must already be in place.
    out.push({ k: 'bankObols', mult: TAKEN_OBOL_MULT }, { k: 'takeRun' });
  }
  return out;
}

/** The integrator's run functions, one per effect. */
export interface HollowRunApi {
  forgiveQuota(nights: number): void;
  takeRun(): void;
  restoreSoulMark(): void;
  bankObols(mult: number): void;
}

export function applyEffects(effects: readonly HollowEffect[], api: HollowRunApi): void {
  for (const e of effects) {
    if (e.k === 'forgiveQuota') api.forgiveQuota(e.nights);
    else if (e.k === 'takeRun') api.takeRun();
    else if (e.k === 'restoreSoulMark') api.restoreSoulMark();
    else api.bankObols(e.mult);
  }
}
