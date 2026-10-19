/**
 * Wave 25 "TALLY" duel contract. Shared by the engine (lane A) and the duel
 * games (lane B). Pure data, no DOM, no three.js. Original IP.
 */

export interface Clue {
  channel: 'tell' | 'table' | 'math'
  round: number
  /** i18n key */
  key: string
  data?: Record<string, unknown>
}

/** i18n keys for the three reveal panels. */
export interface RevealScript {
  saw: string
  happened: string
  why: string
}

/** Host-only. Never serialised into snapshots or public events before reveal. */
export interface CheatPlan {
  kind: string
  round: number
  detail: Record<string, unknown>
}

export interface DuelState {
  round: number
  done: boolean
  winner?: 'player' | 'rival'
  log: unknown[]
}

export interface DuelRules<A = unknown> {
  id: string
  rival: string
  makePlan(seed: number): CheatPlan
  init(seed: number, plan: CheatPlan, stake: number): DuelState
  legal(s: DuelState): A[]
  step(
    s: DuelState,
    actor: 'player' | 'rival',
    action: A,
    plan: CheatPlan,
  ): { state: DuelState; clues: Clue[]; publicEvents: unknown[] }
  rivalAct(s: DuelState, plan: CheatPlan, seed: number): A
  call(s: DuelState, plan: CheatPlan, target: unknown): { correct: boolean }
  settle(s: DuelState, calledCorrect: boolean | null, stake: number): { playerNet: number }
  reveal: RevealScript
  playHeadless(
    seed: number,
    policy: 'naive' | 'detective',
  ): { playerNet: number; calls: number; correctCalls: number }

  // ── OPTIONAL view hooks (engine falls back to generic text when a game omits them) ──
  /** Whose turn it is. Default: the state's own "turn" field when it has one, else strict alternation starting with the player. */
  turnOf?(s: DuelState): 'player' | 'rival'
  /** What the call picker offers (a tile in the river, 'GHOST', 'LOADED DICE'). Default: one generic CHEAT target. */
  callTargets?(s: DuelState): CallTarget[]
  /** How a legal action reads on the HUD (`s` = the state it is offered in, for odds). Default: its label, k or kind field. */
  describeAction?(a: A, s?: DuelState): TextRef
  /** The pieces on the table as the seated player sees them (public information and their own hand only), drawn big by the machine. */
  board?(s: DuelState): Board
  /** i18n key: one plain line that says what you do and how you win. */
  goal?: string
  /** Extra lines for the player's own view of the table (own hand, own charges). Never rival secrets. */
  describe?(s: DuelState): TextRef[]
  /** How one public event reads on the Tally Sheet. Default: its key (i18n) or a compact dump. */
  describeEvent?(e: unknown): TextRef
  /** The truth of the duel (did the cheat happen?). Default: CHEAT only when the player called correctly. Shown on the reveal stamp. */
  verdict?(s: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR'
  /** Reveal script for a duel that turned out fair. Default: the same script as a cheat. */
  revealFair?: RevealScript
}

/** An i18n key plus variables, or a literal for numbers. A data entry named `xKey` is a key the machine translates into `x`. */
export interface TextRef { key?: string; data?: Record<string, unknown>; text?: string }

/** One thing on the table: a card, tile, die, locker, hand or counter. `top` is the big face, `sub` a small caption. */
export interface Piece {
  top: TextRef
  sub?: TextRef
  /** Face down: only a back is drawn, never the face. */
  down?: boolean
  /** now = the one in play, next = the one to be answered, mine / his = whose it is, win / lose = how the last round went. */
  mark?: 'now' | 'next' | 'mine' | 'his' | 'win' | 'lose'
  /** Colour group 0..3 (a suit, a locker). */
  tone?: number
  /** Index into the legal actions this piece picks (a tile you may discard); the machine lights it with the cursor. */
  act?: number
}
export interface Zone { label: TextRef; pieces: Piece[] }
export interface Board {
  zones: Zone[]
  score?: { you: number; him: number; of?: number }
  /** A bar: a gauge that fills up to `max` (`danger` = where it turns red). */
  meter?: { label: TextRef; value: number; max: number; danger?: number }
  notes?: TextRef[]
}
/** One entry of the call picker. The target is passed to DuelRules.call unchanged. */
export interface CallTarget { target: unknown; label: TextRef }

/** Stake tiers (spec: Coins / Pledge / Soul Mark). */
export type StakeTier = 'coins' | 'pledge' | 'soul'
