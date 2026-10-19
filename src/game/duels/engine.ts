/**
 * Duel engine (Wave 25 TALLY, lane A): runs one `DuelRules` match from SEAL to REVEAL. Pure and deterministic (no DOM,
 * no three.js, seeded rng only), so the `tallytable` machine drives it on the host and the tests drive it headless.
 *
 *   DuelSession  host-only. Owns the sealed cheat plan and the full game state. Every method returns `DuelEvent`s:
 *                small JSON, PUBLIC, plan-free. The one exception is the final `reveal` event, which carries the plan.
 *   PublicView   what every peer keeps (reduced from the events with `reduce`); it is also the snapshot, so a late
 *                joiner or a save can never contain the plan or the game's hidden state.
 *
 * Flow: seal -> rounds (player and rival act in turn, each `step` may emit clues) -> ruling -> reveal -> done.
 * The call window is always open during `rounds`: one call per duel. A CORRECT call ends the duel at once (the
 * Bench voids the wager against the rival: ruling CHEAT, `settle(s, true, S)`); a WRONG call is fined inside
 * `settle(s, false, S)` and the duel plays on to its natural end.
 *
 * Host restore: the session is rebuilt by replaying the player's recorded actions (`DuelSession.restore`); the plan
 * is re-derived from the seed, so nothing secret is ever stored.
 */
import { hashSeed } from '@/core/rng'
import { planSeedOf, sealPlan, type PlanVault } from './plan'
import type { Board, CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, StakeTier, TextRef } from './types'

export type Who = 'player' | 'rival'
export type DuelPhase = 'seal' | 'rounds' | 'ruling' | 'reveal' | 'done'

/** One line of the Tally Sheet. Already reduced to text references, so the sheet needs no game knowledge. */
export interface SheetRow { r: number; who: Who | 'clue' | 'sys'; t: TextRef; ch?: Clue['channel'] }

export type DuelEvent =
  | { k: 'seal'; rival: string; game: string; night: number; boss: boolean; quiet?: boolean }
  | { k: 'stake'; tier: StakeTier; S: number }
  | { k: 'round'; n: number }
  | { k: 'turn'; who: Who }
  | { k: 'act'; who: Who; r: number; rows: TextRef[] }
  | { k: 'clue'; c: Clue }
  | { k: 'called'; r: number; label: TextRef }
  | { k: 'ruling'; verdict: 'CHEAT' | 'FAIR'; correct: boolean | null; net: number; byCall: boolean }
  | { k: 'reveal'; script: RevealScript; verdict: 'CHEAT' | 'FAIR'; plan: CheatPlan; clues: Clue[] }
  | { k: 'end' }

/** The public, snapshot-safe view of a duel. */
export interface PublicView {
  phase: DuelPhase
  rival: string
  game: string
  night: number
  boss: boolean
  tier: StakeTier
  S: number
  round: number
  turn: Who | ''
  called: boolean
  sheet: SheetRow[]
  clues: Clue[]
  verdict: '' | 'CHEAT' | 'FAIR'
  net: number
}

export const SHEET_CAP = 80

export function freshView(): PublicView {
  return {
    phase: 'seal', rival: '', game: '', night: 0, boss: false, tier: 'coins', S: 0, round: 0, turn: '',
    called: false, sheet: [], clues: [], verdict: '', net: 0,
  }
}

/** Reduces one event into the view (identical on every peer). Returns the same object. */
export function reduce(v: PublicView, ev: DuelEvent): PublicView {
  const row = (r: SheetRow): void => { v.sheet.push(r); if (v.sheet.length > SHEET_CAP) v.sheet.splice(0, v.sheet.length - SHEET_CAP) }
  switch (ev.k) {
    case 'seal':
      Object.assign(v, freshView(), { rival: ev.rival, game: ev.game, night: ev.night, boss: ev.boss, phase: 'seal' })
      break
    case 'stake': v.tier = ev.tier; v.S = ev.S; v.phase = 'rounds'; break
    case 'round': v.round = ev.n; break
    case 'turn': v.turn = ev.who; break
    case 'act': for (const t of ev.rows) row({ r: ev.r, who: ev.who, t }); break
    case 'clue': v.clues.push(ev.c); row({ r: ev.c.round, who: 'clue', t: { key: ev.c.key, data: ev.c.data }, ch: ev.c.channel }); break
    case 'called': v.called = true; row({ r: ev.r, who: 'sys', t: ev.label }); break
    case 'ruling': v.phase = 'ruling'; v.verdict = ev.verdict; v.net = ev.net; v.turn = ''; break
    case 'reveal': v.phase = 'reveal'; break
    case 'end': v.phase = 'done'; break
  }
  return v
}

// ── text helpers ─────────────────────────────────────────────────────────────────────────────

const json = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

function compact(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return depth > 1 ? `[${v.length}]` : v.map((x) => compact(x, depth + 1)).join(',')
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => (typeof x === 'object' && depth > 0 ? k : `${k}:${compact(x, depth + 1)}`))
    return parts.join(' ').slice(0, 60)
  }
  return ''
}

/** Default reading of a public event: its `key` (an i18n key) with `data`, else a compact dump. */
export function defaultText(e: unknown): TextRef {
  if (typeof e === 'string') return e.includes('.') && !e.includes(' ') ? { key: e } : { text: e }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.key === 'string') return { key: o.key, data: (o.data as Record<string, unknown> | undefined) ?? undefined }
    if (typeof o.labelKey === 'string') return { key: o.labelKey, data: o.data as Record<string, unknown> | undefined }
    return { text: compact(e) }
  }
  return { text: compact(e) }
}

/** Default reading of a legal action: `label` / `labelKey`, else `k` / `kind` / `type` plus its other fields. */
export function defaultActionText(a: unknown): TextRef {
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>
    if (typeof o.labelKey === 'string') return { key: o.labelKey, data: o.data as Record<string, unknown> | undefined }
    const head = o.k ?? o.kind ?? o.type
    if (typeof head === 'string') {
      const rest = Object.entries(o).filter(([k]) => k !== 'k' && k !== 'kind' && k !== 'type').map(([k, x]) => `${k}:${compact(x, 1)}`).join(' ')
      return { key: `m.tallytable.act.${head}`, text: rest ? `${head} ${rest}` : head, data: o }
    }
  }
  return defaultText(a)
}

export const GENERIC_CALL: CallTarget = { target: 'CHEAT', label: { key: 'm.tallytable.callCheat' } }

// ── encounters ───────────────────────────────────────────────────────────────────────────────

export const BOSS_NIGHTS: readonly number[] = [3, 6, 8]
/** Rival the spec puts on each Night; later Nights fall back to the nearest registered duel. */
const RIVAL_BY_NIGHT: Readonly<Record<number, string>> = { 2: 'tamsin', 3: 'lucan', 4: 'mimosa', 5: 'kuro', 6: 'orrin', 7: 'tamsin', 8: 'vell' }
const FALLBACK_ORDER: readonly string[] = ['tamsin', 'lucan', 'kuro', 'mimosa', 'orrin', 'vell']

export interface Encounter { rivalId: string; night: number; boss: boolean }

/**
 * Picks the rival for a Night: the spec's rival if a duel is registered for them, else the first registered rival
 * in the fallback order. Null when no duel game is registered at all.
 */
export function pickEncounter(night: number, hasDuel: (rivalId: string) => boolean, hint?: { rivalId: string; night?: number; boss?: boolean } | null): Encounter | null {
  const n = Math.max(1, Math.floor(night))
  const want = hint?.rivalId ?? RIVAL_BY_NIGHT[n] ?? 'tamsin'
  const rivalId = hasDuel(want) ? want : FALLBACK_ORDER.find(hasDuel)
  if (!rivalId) return null
  return { rivalId, night: hint?.night ?? n, boss: hint?.boss ?? BOSS_NIGHTS.includes(n) }
}

// ── the session ──────────────────────────────────────────────────────────────────────────────

export interface SessionOpts {
  rules: DuelRules
  runSeed: number
  rivalId: string
  night: number
  boss?: boolean
  tier: StakeTier
  S: number
}

/** What the seated player is shown (sent PRIVATELY, only to them). `v` guards against stale input. */
export interface Prompt { v: number; myTurn: boolean; actions: TextRef[]; lines: TextRef[]; targets: TextRef[]; canCall: boolean; board: Board | null }

export interface DuelResult { net: number; calledCorrect: boolean | null; won: boolean; drew: boolean; verdict: 'CHEAT' | 'FAIR'; tier: StakeTier; S: number }

/** Recorded player input, enough to rebuild the whole duel (rival moves and the plan are deterministic). */
/** `at` = how many steps had been played when the input was made (rival moves in between are re-derived). */
export type ReplayEntry = { t: 'a'; at: number; a: unknown } | { t: 'c'; at: number; target: unknown }

const MAX_STEPS = 800

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

export class DuelSession {
  readonly rules: DuelRules
  readonly rivalId: string
  readonly night: number
  readonly boss: boolean
  readonly tier: StakeTier
  readonly S: number
  /** hashSeed(runSeed, 'duel', rivalId, night): the same run and Night always give the same duel. */
  readonly seed: number
  private readonly vault: PlanVault
  private st: DuelState
  private lastActor: Who | null = null
  private steps = 0
  private called = false
  private calledCorrect: boolean | null = null
  private ended = false
  private revealed = false
  private res: DuelResult | null = null
  private readonly seen: Clue[] = []
  private readonly log: ReplayEntry[] = []

  constructor(o: SessionOpts) {
    this.rules = o.rules
    this.rivalId = o.rivalId
    this.night = o.night
    this.boss = o.boss ?? false
    this.tier = o.tier
    this.S = o.S
    this.seed = planSeedOf(o.runSeed, o.rivalId, o.night)
    this.vault = sealPlan(o.rules.makePlan(this.seed))
    this.st = o.rules.init(hashSeed(this.seed, 'init'), this.vault.open(), o.S)
  }

  /** Rebuilds a duel from the player's recorded input (host reload). Rival moves are re-derived. */
  static restore(o: SessionOpts, log: readonly ReplayEntry[], steps = 0): DuelSession {
    const s = new DuelSession(o)
    for (const e of log) {
      s.playRivalUntil(e.at)
      if (e.t === 'a') s.act(e.a)
      else s.callTarget(e.target)
    }
    s.playRivalUntil(steps)                       // rival moves made after the last input, already on every sheet
    return s
  }

  /** Events that open the duel: the stake, the first round and the first turn. */
  begin(): DuelEvent[] {
    const ev: DuelEvent[] = [{ k: 'stake', tier: this.tier, S: this.S }, { k: 'round', n: this.st.round }]
    const who = this.toMove()
    if (who) ev.push({ k: 'turn', who })
    return ev
  }

  get done(): boolean { return this.ended }
  get state(): Readonly<DuelState> { return this.st }
  get version(): number { return this.steps }
  get hasCalled(): boolean { return this.called }
  get result(): DuelResult | null { return this.res }
  /** The player's recorded input (safe to persist: it holds no plan and no hidden state). */
  replayLog(): ReplayEntry[] { return json(this.log) }
  /** Test hook: is the plan still sealed? (the plan is only readable through `revealEvents`). */
  get planOpened(): boolean { return this.revealed }

  /** Whose move it is, or null when the duel is over. */
  toMove(): Who | null {
    if (this.ended || this.st.done) return null
    const s = this.st as DuelState & { turn?: unknown }
    const t = this.rules.turnOf?.(this.st) ?? (s.turn === 'player' || s.turn === 'rival' ? s.turn : this.lastActor === 'player' ? 'rival' : 'player')
    if (t === 'player' && this.rules.legal(this.st).length === 0) return 'rival'
    return t
  }

  /**
   * The seated player's private prompt, valid until the next step (`v`). `actions` is empty unless it is their move,
   * but the call picker (`targets`) is always there: the call window is open on the rival's turn too.
   */
  prompt(): Prompt | null {
    if (this.ended) return null
    const r = this.rules
    const myTurn = this.toMove() === 'player'
    return {
      v: this.steps,
      myTurn,
      actions: myTurn ? r.legal(this.st).map((a) => json(r.describeAction ? r.describeAction(a, this.st) : defaultActionText(a))) : [],
      lines: json(r.describe?.(this.st) ?? []),
      targets: this.callTargets().map((c) => json(c.label)),
      canCall: !this.called,
      board: this.board(),
    }
  }

  /** The table as the player sees it. Still readable after the last move (the machine sends it once more when the duel ends). */
  board(): Board | null {
    return json(this.rules.board?.(this.st) ?? null)
  }

  callTargets(): CallTarget[] {
    const t = this.rules.callTargets?.(this.st)
    return t && t.length ? t : [GENERIC_CALL]
  }

  /** The player acts. `actionIndex` indexes `prompt().actions`; `v` must match `prompt().v`. */
  actIndex(actionIndex: number, v: number): { ok: boolean; events: DuelEvent[] } {
    if (v !== this.steps || this.toMove() !== 'player') return { ok: false, events: [] }
    const a = this.rules.legal(this.st)[actionIndex]
    if (a === undefined) return { ok: false, events: [] }
    return this.act(a)
  }

  /** The player acts with a concrete action (must be one of `legal`). */
  act(action: unknown): { ok: boolean; events: DuelEvent[] } {
    if (this.toMove() !== 'player') return { ok: false, events: [] }
    if (!this.rules.legal(this.st).some((l) => same(l, action))) return { ok: false, events: [] }
    this.log.push({ t: 'a', at: this.steps, a: json(action) })
    return { ok: true, events: this.apply('player', action) }
  }

  /** The rival moves (host: after a think delay). */
  rivalMove(): DuelEvent[] {
    if (this.toMove() !== 'rival') return []
    const action = this.rules.rivalAct(this.st, this.vault.open(), hashSeed(this.seed, 'rival', this.steps))
    return this.apply('rival', action)
  }

  /** Plays rival moves until `steps` have been played (or the player is on move). Used by restore. */
  private playRivalUntil(steps: number): void {
    let guard = 0
    while (this.steps < steps && this.toMove() === 'rival' && guard++ < MAX_STEPS) this.rivalMove()
  }

  /** The player calls: `targetIndex` indexes `prompt().targets`. One call per duel. */
  call(targetIndex: number, v: number): { ok: boolean; events: DuelEvent[] } {
    if (v !== this.steps) return { ok: false, events: [] }
    const tg = this.callTargets()[targetIndex]
    if (!tg) return { ok: false, events: [] }
    return this.callTarget(tg.target)
  }

  private callTarget(target: unknown): { ok: boolean; events: DuelEvent[] } {
    if (this.called || this.ended) return { ok: false, events: [] }
    const tg = this.callTargets().find((c) => same(c.target, target)) ?? { target, label: GENERIC_CALL.label }
    this.log.push({ t: 'c', at: this.steps, target: json(target) })
    const res = this.rules.call(this.st, this.vault.open(), target)
    this.called = true
    this.calledCorrect = res.correct
    const ev: DuelEvent[] = [{ k: 'called', r: this.st.round, label: json(tg.label) }]
    if (res.correct) ev.push(...this.rule(true))
    return { ok: true, events: ev }
  }

  /** The player walks away mid-duel: the stake is lost (sealed is sealed). */
  forfeit(): DuelEvent[] {
    if (this.ended) return []
    return this.ruleWith(-this.S, false)
  }

  /** REVEAL: the only event that carries the plan. Idempotent. */
  revealEvents(): DuelEvent[] {
    if (!this.ended || this.revealed) return []
    this.revealed = true
    return [
      { k: 'reveal', script: json(this.truth() === 'FAIR' && this.rules.revealFair ? this.rules.revealFair : this.rules.reveal), verdict: this.truth(), plan: json(this.vault.open()), clues: json(this.seen) },
      { k: 'end' },
    ]
  }

  // ── internals ──
  private apply(actor: Who, action: unknown): DuelEvent[] {
    const prevRound = this.st.round
    const out = this.rules.step(this.st, actor, action, this.vault.open())
    this.st = out.state
    this.steps++
    this.lastActor = actor
    const ev: DuelEvent[] = []
    const rows = out.publicEvents.map((e) => json(this.rules.describeEvent ? this.rules.describeEvent(e) : defaultText(e)))
    ev.push({ k: 'act', who: actor, r: this.st.round, rows })
    for (const c of out.clues) { const cc = json(c); this.seen.push(cc); ev.push({ k: 'clue', c: cc }) }
    if (this.steps >= MAX_STEPS && !this.st.done) this.st = { ...this.st, done: true }   // safety net: never loop forever
    if (this.st.done) { ev.push(...this.rule(false)); return ev }
    if (this.st.round !== prevRound) ev.push({ k: 'round', n: this.st.round })
    const who = this.toMove()
    if (who) ev.push({ k: 'turn', who })
    return ev
  }

  /** What actually happened: the game's own verdict when it has one, else CHEAT only if the call was right. */
  private truth(): 'CHEAT' | 'FAIR' {
    if (this.calledCorrect === true) return 'CHEAT'
    return this.rules.verdict ? this.rules.verdict(this.st, this.vault.open()) : 'FAIR'
  }

  private rule(byCall: boolean): DuelEvent[] {
    const net = this.rules.settle(this.st, this.calledCorrect, this.S).playerNet
    return this.ruleWith(net, byCall)
  }

  private ruleWith(netIn: number, byCall: boolean): DuelEvent[] {
    const net = Math.round(netIn)
    this.ended = true
    const verdict = this.truth()
    this.res = { net, calledCorrect: this.calledCorrect, won: net > 0, drew: net === 0, verdict, tier: this.tier, S: this.S }
    return [{ k: 'ruling', verdict, correct: this.calledCorrect, net, byCall }]
  }
}

/**
 * Plays a session to its end with a chooser for the player (tests, staff, sim). `choose` gets the legal actions and
 * the session; return an index, or -1 to take the first. Returns every event, reveal included.
 */
export function playOut(s: DuelSession, choose?: (actions: TextRef[], s: DuelSession) => { act?: number; call?: number }): DuelEvent[] {
  const out: DuelEvent[] = [...s.begin()]
  let guard = 0
  while (!s.done && guard++ < MAX_STEPS * 2) {
    const who = s.toMove()
    if (who === 'rival') { out.push(...s.rivalMove()); continue }
    const p = s.prompt()
    if (!p || !p.myTurn) break
    const pick = choose ? choose(p.actions, s) : {}
    if (pick.call !== undefined && p.canCall) { out.push(...s.call(pick.call, p.v).events); if (s.done) break }
    const r = s.actIndex(Math.max(0, pick.act ?? 0), p.v)
    if (!r.ok) break
    out.push(...r.events)
  }
  out.push(...s.revealEvents())
  return out
}
