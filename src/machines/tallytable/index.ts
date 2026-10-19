/**
 * The Tally Table (`tallytable`, Wave 25 TALLY, lane A): a 2-seat host-resolved table where the player (seat 0) duels a
 * House champion (seat 1, a bot mannequin dressed per rival) under the eye of a masked Notary. The rules of each duel
 * live in `src/game/duels/<game>/` (`DuelRules`); this machine runs them through `DuelSession` (engine.ts) and shows them.
 *
 * Flow: SEAL (the Notary reads the terms, the player picks a stake tier: Coins / Pledge / Soul Mark) -> ROUNDS (the player
 * and the rival act in turn; each step may ring clues: TELL on the portrait, TABLE in 3D, MATH on the Tally Sheet) -> CALL
 * (the window is always open: key C, pick what you saw, once per duel) -> RULING (the Notary) -> REVEAL (manga reveal).
 *
 *  - HOST ONLY: the `DuelSession` (cheat plan, game state, rival AI). Every public event comes from the engine and is
 *    plan-free; the plan travels once, inside the final `reveal` event. `getSnapshot` is the public view (late joiners)
 *    plus, for the host's own save only, the player's recorded input, from which the whole duel replays.
 *  - The player's prompt (legal moves, call targets, own-hand lines) is sent PRIVATELY (`emitPrivate`).
 *  - One duel per Night: the seed is hashSeed(runSeed, 'duel', rival, night), so a second duel would repeat the first.
 *  - Leaving mid-duel forfeits the stake ("sealed is sealed"): E asks, E again within 3 s leaves.
 *
 * Run hooks (optional, `run.duel`, see game/duels/stakes.ts `DuelRunHooks`): Soul Marks, the rival's Pledge charm,
 * Calm / Free coins-only, the Night's encounter, and the end-of-duel report for boss rewards.
 *
 * Controls (seated): 1 / 2 / 3 or left / right + Space = stake tier · left / right (A D, W S) or 1-8 = pick a move · Space / Enter / LMB
 * = play it · C = call the cheat (pick what you saw, Space to confirm, C again cancels) · T (or Q) = Tally Sheet (closed by default) · H rules.
 *
 * What the player sees (board.ts, sheet.ts): the game's pieces large on a felt plate over the table (each duel's `board` hook), one goal line,
 * the options as big buttons with their keys, the rival's move played out on the plate, and a short collapsible Tally Sheet.
 */
import * as THREE from 'three'
import type { Json, PlayerId } from '@/core/types'
import { isBot } from '@/core/types'
import type { MachineAction, MachineInputEvent } from '@/core/input/types'
import { fmtCoins, has, t as tr } from '@/core/i18n'
import { clamp } from '@/core/math'
import { TableBase } from '@/machines/_base/TableBase'
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud'
import type { MachineDef, MachineEvent, MachineModel, PresentCtx } from '@/machines/_base/types'
import type { Kit } from '@/kit/types'
import * as manga from '@/core/ui/manga'
import { gamblersEye } from '@/core/ui/manga/eye'
import '@/game/duels/autoload'
import { duelForRival, getDuel } from '@/game/duels/registry'
import { setPhotoSource } from '@/game/duels/promise/lucan'
import { applyPromiseRewards } from '@/game/duels/promise/rewards'
import {
  DuelSession, freshView, pickEncounter, reduce, type DuelEvent, type Encounter, type Prompt, type PublicView, type ReplayEntry,
} from '@/game/duels/engine'
import {
  MARK_DREAD, RIVAL_PLEDGE_OBOLS, pledgeCost, settleStake, stakeUnit, type DuelRunHooks, type StakeSettlement,
} from '@/game/duels/stakes'
import type { Board, DuelRules, Piece, StakeTier, TextRef } from '@/game/duels/types'
import { CHANNEL_COLOR, buildModel, type TallyParts } from './model'
import { lookOf } from './rivals'
import { RIVAL_CHAIR_Z, seatedRoot } from './seat'
import { TallySheet, type SheetLine } from './sheet'
import { TallyBoard, textVars, type ChoiceItem, type ChoiceView, type PieceView } from './board'
import { STRINGS } from './strings'

// ── wire types ───────────────────────────────────────────────────────────────────────────────
/** Everything is a plain-JSON `MachineEvent`: the engine's `DuelEvent`s plus the machine's own (`tiers`, `mine`, `paid` ...). */
type Ev = MachineEvent
type Act = { k: 'tier'; tier: string } | { k: 'do'; i: number; v: number } | { k: 'call'; i: number; v: number }

/** What the seated player may put up (private, from the host). */
interface Tiers { S: number; coins: boolean; pledge: 'ticket' | 'obol' | ''; soul: number; calm: boolean }
/** Settlement report (public: it holds no secret). */
interface Paid {
  tier: StakeTier; S: number; net: number; coins: number; owed: number
  pledge: '' | 'won' | 'back' | 'lost'; mark: '' | 'won' | 'lost'; marksLeft: number
}
type Snap = Json

const TIER_ORDER: readonly StakeTier[] = ['coins', 'pledge', 'soul']
const THINK: [number, number] = [1.3, 2.5]
const CLUE_PAUSE = 1.4
const FORFEIT_WINDOW = 3
const GUARD_S = 25
const GOLD = 0xffd040, RED = 0xff5a4a
/** Lines of the latest move the plate shows, and the time the rival's rows take to play out. */
const LAST_ROWS = 2
const ROWS_S = 2.4

export const def: MachineDef = {
  id: 'tallytable',
  category: 'duel',
  slotSize: 'L',
  zone: 'parlour',
  seats: 2,
  shared: true,
  minBet: 5, maxBet: 100000,
  maxPayoutMult: 8,
  tier: 0,
  actionCost: 0,
  tags: ['duel', 'table', 'tally', 'story'],
  strings: STRINGS,
}

/** Host-only authority state. Never sent, never snapshotted (except the replay log, which holds no secret). */
interface Host {
  phase: 'idle' | 'seal' | 'rounds'
  session: DuelSession | null
  enc: Encounter | null
  rules: DuelRules | null
  pid: PlayerId | null
  think: number
  S: number
  escrow: { cur: 'ticket' | 'obol' | ''; amount: number }
  doneNight: number
  introNight: number
}
const freshHost = (): Host => ({
  phase: 'idle', session: null, enc: null, rules: null, pid: null, think: 0, S: 0,
  escrow: { cur: '', amount: 0 }, doneNight: -1, introNight: -1,
})

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const vars = (d?: Record<string, unknown>): Record<string, string | number> => textVars(d, tr, has)

export default class TallyTable extends TableBase<TallyParts, Ev, Snap, Act> {
  private view: PublicView = freshView()
  private host: Host = freshHost()
  private seatHud?: SeatHud
  private panel?: TallySheet
  private board?: TallyBoard
  /** The table as the seated player sees it (from the host's private prompt), and the latest move as text, for the plate. */
  private tb: Board | null = null
  private lastRefs: TextRef[] = []
  private offBlock: (() => void) | null = null
  // local (seated player) UI state
  private tiers: Tiers | null = null
  private mine: Prompt | null = null
  private cur = 0
  private tierCur = 0
  private callMode = false
  private sent = 0
  private noDuel = false
  private adjourned = false
  private paid: Paid | null = null
  private forfeitArm = 0
  private dress: Array<() => void> = []
  private dressed = ''
  private offKey: (() => void) | null = null
  private offPhoto: (() => void) | null = null

  protected createModel(kit: Kit): MachineModel<TallyParts> { return buildModel(kit, this.modelOpts) }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root)
    this.panel = new TallySheet(this.ctx.ui.root)
    this.board = new TallyBoard(this.ctx.ui.root)
    this.offBlock = this.ctx.events.on('ui:blocking', ({ blocking }) => { this.board?.setBlocked(blocking); this.panel?.setBlocked(blocking) })
    this.hud(null)                                        // the seat HUD replaces the generic bottom bar
    // Promise mode: the photo keepsake the player carries can be set in front of Lucan's watch (docs/STORY_BIBLE.md 5a)
    this.offPhoto = setPhotoSource(() => {
      try { return (this.ctx.run as unknown as { keepsakeCarried?: () => string | null }).keepsakeCarried?.() === 'photo' } catch { return false }
    })
    this.paintAll()
  }

  dispose(): void {
    this.offKey?.(); this.offKey = null
    this.offPhoto?.(); this.offPhoto = null
    this.offBlock?.(); this.offBlock = null
    this.seatHud?.dispose()
    this.panel?.dispose()
    this.board?.dispose()
    super.dispose()
  }

  // ── seat events ──────────────────────────────────────────────────────────────────────────
  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && seat === 0 && !isBot(pid)) this.hostSit(pid)
    if (local && seat === 0) {
      this.sfx('chime')
      this.seatHud?.show()
      this.panel?.show()
      this.board?.show()
      this.parts.notary.setVisible(false)               // a standing figure would fill the steep seat view (seat.ts)
      this.bindSheetKey()
      this.showHud()
    }
    this.paintAll()
  }

  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && seat === 0 && !isBot(pid)) this.hostStand(pid)
    if (local) {
      this.offKey?.(); this.offKey = null
      this.tiers = null; this.mine = null; this.callMode = false; this.sent = 0; this.paid = null
      this.noDuel = false; this.adjourned = false
      this.hud(null); this.seatHud?.hide(); this.panel?.hide(); this.board?.hide()
      this.clearTable()
      this.parts.notary.setVisible(true)
    }
    this.paintAll()
  }

  /** T opens the Tally Sheet (T is also the chat key; while seated here the sheet wins). Q does the same through the sink. */
  private bindSheetKey(): void {
    this.offKey?.()
    const fn = (e: KeyboardEvent): void => {
      if (e.code !== 'KeyT' || e.repeat || !this.isLocalOccupant) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault(); e.stopImmediatePropagation()
      this.toggleSheet()
    }
    window.addEventListener('keydown', fn, true)
    this.offKey = () => window.removeEventListener('keydown', fn, true)
  }

  /** E asks first: a duel in progress is sealed. A second E within 3 s forfeits the stake and leaves. */
  protected override standUp(): void {
    if (this.view.phase === 'rounds' && this.isLocalOccupant && this.forfeitArm <= 0) {
      this.forfeitArm = FORFEIT_WINDOW
      this.toast(this.t('sealed'), 'warn')
      return
    }
    super.standUp()
  }

  // ── local input ──────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return
    const a = e.action
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return }
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return }
    const moves = a === 'left' || a === 'right' || a === 'up' || a === 'down'
    if (e.repeat && !moves) return
    switch (a) {
      case 'left': case 'up': this.move(-1); break
      case 'right': case 'down': this.move(1); break
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': case 'n7': case 'n8': this.jump(Number(a.slice(1)) - 1); break
      case 'primary': case 'confirm': this.confirm(); break
      case 'alt': this.toggleCall(); break
      case 'collect': this.toggleSheet(); break
    }
  }

  private listLen(): number {
    const v = this.view
    if (v.phase === 'seal') return TIER_ORDER.length
    if (this.callMode) return this.mine?.targets.length ?? 0
    return this.mine?.myTurn ? this.mine.actions.length : 0
  }

  private move(d: number): void {
    const n = this.listLen()
    if (n === 0) return
    if (this.view.phase === 'seal') this.tierCur = (this.tierCur + d + n) % n
    else this.cur = clamp(this.cur + d, 0, n - 1)
    this.sfx('click', { vol: 0.4 })
    this.showHud()
  }

  private jump(i: number): void {
    if (i >= this.listLen()) return
    if (this.view.phase === 'seal') this.tierCur = i
    else this.cur = i
    this.sfx('click', { vol: 0.4 })
    this.showHud()
    if (this.view.phase === 'seal') this.confirm()
  }

  private confirm(): void {
    const v = this.view
    if (v.phase === 'seal') {
      if (!this.tiers) return
      const tier = TIER_ORDER[this.tierCur]
      if (!this.tierOk(tier)) { this.toast(this.t('badTier'), 'warn'); this.sfx('buzzer', { vol: 0.5 }); return }
      this.act({ k: 'tier', tier })
      return
    }
    const m = this.mine
    if (v.phase !== 'rounds' || !m || this.sent > 0) return
    if (this.callMode) {
      if (!m.canCall) return
      this.act({ k: 'call', i: this.cur, v: m.v })
      this.callMode = false
    } else if (m.myTurn && m.actions.length) {
      this.act({ k: 'do', i: this.cur, v: m.v })
    } else return
    this.sent = 1.5
    this.sfx('click')
    this.showHud()
  }

  private toggleCall(): void {
    const m = this.mine
    if (this.view.phase !== 'rounds' || !m) return
    if (!m.canCall) { this.toast(this.t('onePerDuel'), 'info'); return }
    this.callMode = !this.callMode
    this.cur = 0
    this.sfx(this.callMode ? 'stamp' : 'click', { vol: 0.5 })
    this.showHud()
  }

  private toggleSheet(): void {
    this.panel?.toggle()
    this.sfx('click', { vol: 0.4 })
    this.showHud()
  }

  private tierOk(tier: StakeTier): boolean {
    const t = this.tiers
    if (!t) return false
    return tier === 'coins' ? t.coins : tier === 'pledge' ? t.pledge !== '' : t.soul > 0
  }

  // ── HOST: sitting, encounters, tiers ───────────────────────────────────────────────────────
  private hooks(): DuelRunHooks | null {
    return (this.ctx.run as unknown as { duel?: DuelRunHooks }).duel ?? null
  }
  private night(): number {
    try { return this.ctx.run.night() } catch { return 1 }
  }
  private quota(night: number): number {
    try {
      const due = this.ctx.run.shift.quota().due
      return due > 0 ? due : this.ctx.run.shift.quotaFor(night)
    } catch { return 100 }
  }
  private coinsOnly(): boolean {
    return this.ctx.run.mode === 'free' || this.hooks()?.coinsOnly?.() === true
  }

  private tiersFor(pid: PlayerId, night: number): Tiers {
    const run = this.ctx.run, S = stakeUnit(this.quota(night))
    const calm = this.coinsOnly()
    const pc = calm ? null : pledgeCost(run.balance('ticket', pid), run.balance('obol', pid))
    const hooks = this.hooks()
    return {
      S, calm,
      coins: run.canAfford(S, pid),
      pledge: pc ? pc.cur : '',
      soul: calm || !hooks || hooks.soulMarks(pid) < 2 ? 0 : hooks.soulMarks(pid),   // the Clerk never takes the last seal (docs/BLESSINGS.md §1)
    }
  }

  private hostSit(pid: PlayerId): void {
    const h = this.host
    h.pid = pid
    const night = this.night()
    if (h.session) { this.sendPrompt(); return }                                  // resumed after a reload
    if (h.doneNight === night) { void this.emit({ k: 'adj' }); return }
    const enc = pickEncounter(night, (r) => !!duelForRival(r), this.hooks()?.encounter?.(this.id) ?? null)
    if (!enc) { void this.emit({ k: 'nodue' }); return }
    h.enc = enc
    h.rules = duelForRival(enc.rivalId) ?? null
    if (!h.rules) { void this.emit({ k: 'nodue' }); return }
    if (this.seats[1] === null) this.addBot(1, this.t(`rivalName_${enc.rivalId}`))
    const quiet = h.introNight === enc.night
    h.introNight = enc.night
    h.phase = 'seal'
    const rules = h.rules
    const open = (): void => {
      if (h.phase !== 'seal' || h.session || h.pid !== pid) return                 // stood up while the intro scene played
      void this.emit({ k: 'seal', rival: enc.rivalId, game: rules.id, night: enc.night, boss: enc.boss, quiet })
      void this.emitPrivate(pid, { k: 'tiers', ...this.tiersFor(pid, enc.night) })
    }
    // the rival's intro scene (Rival's Terms on a boss Night) plays first, once per Night; the terms are read after it
    const intro = quiet ? undefined : this.hooks()?.onDuelStart?.({ rivalId: enc.rivalId, night: enc.night, boss: enc.boss })
    if (intro && typeof (intro as Promise<void>).then === 'function') void (intro as Promise<void>).then(open, open)
    else open()
  }

  /** The player left. A duel in progress is forfeited; the table resets. */
  private hostStand(pid: PlayerId): void {
    const h = this.host
    if (h.session && !h.session.done) {
      h.session.forfeit()
      this.payOut(h.session, pid, false)
    }
    const was = h.phase
    h.session = null; h.phase = 'idle'; h.enc = null; h.rules = null; h.pid = null
    if (this.seats[1] !== null) this.removeBot(1)
    if (was !== 'idle') void this.emit({ k: 'reset' })
  }

  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const h = this.host
    if (seat !== 0) { this.nak(pid, rid, 'm.tallytable.illegal'); return }
    if (a.k === 'tier') {
      if (h.phase !== 'seal' || !h.enc || !h.rules) { this.nak(pid, rid, 'm.tallytable.illegal'); return }
      const tier = a.tier as StakeTier
      if (!TIER_ORDER.includes(tier)) { this.nak(pid, rid, 'm.tallytable.badTier'); return }
      const info = this.tiersFor(pid, h.enc.night)
      const run = this.ctx.run
      let esc: Host['escrow'] = { cur: '', amount: 0 }
      if (tier === 'coins') {
        if (!info.coins || !this.chargeSeat(0, info.S, pid)) { this.nak(pid, rid, 'm.tallytable.noFunds'); return }
      } else if (tier === 'pledge') {
        const pc = info.pledge ? pledgeCost(run.balance('ticket', pid), run.balance('obol', pid)) : null
        if (!pc || !run.spend(pc.cur, pc.amount, 'duel.pledge', pid)) { this.nak(pid, rid, 'm.tallytable.badTier'); return }
        esc = { cur: pc.cur, amount: pc.amount }
      } else {
        if (info.soul < 1 || !this.hooks()?.stakeSoulMark(pid)) { this.nak(pid, rid, 'm.tallytable.badTier'); return }
      }
      h.S = info.S
      h.escrow = esc
      h.session = new DuelSession({
        rules: h.rules, runSeed: this.ctx.runSeed, rivalId: h.enc.rivalId, night: h.enc.night, boss: h.enc.boss, tier, S: info.S,
      })
      h.phase = 'rounds'
      this.flush(h.session.begin())
      return
    }
    const s = h.session
    if (h.phase !== 'rounds' || !s) { this.nak(pid, rid, 'm.tallytable.illegal'); return }
    const r = a.k === 'do' ? s.actIndex(a.i, a.v) : s.call(a.i, a.v)
    if (!r.ok) { this.nak(pid, rid, 'm.tallytable.stale'); this.sendPrompt(); return }
    this.flush(r.events)
  }

  /** Emit engine events, then either finish the duel, ask the player, or arm the rival's think timer. */
  private flush(evs: DuelEvent[]): void {
    const h = this.host, s = h.session
    if (!s) return
    let clue = false
    for (const e of evs) { if (e.k === 'clue') clue = true; void this.emit(e as unknown as Ev) }
    if (s.done) { this.finish(s); return }
    this.sendPrompt()
    if (s.toMove() === 'rival') h.think = THINK[0] + this.hostRng.next() * (THINK[1] - THINK[0]) + (clue ? CLUE_PAUSE : 0)
  }

  private sendPrompt(): void {
    const h = this.host, s = h.session
    if (!s || h.pid === null) return
    const p = s.prompt()
    if (p) void this.emitPrivate(h.pid, { k: 'mine', p: json(p) as unknown as Json })
  }

  hostTick(dt: number): void {
    const h = this.host, s = h.session
    if (h.phase !== 'rounds' || !s || s.done || s.toMove() !== 'rival') return
    if ((h.think -= dt) > 0) return
    this.flush(s.rivalMove())
  }

  /** The duel ended: pay the stake out, tell everyone, then reveal. */
  private finish(s: DuelSession): void {
    const h = this.host
    const pid = h.pid
    const night = s.night
    const table = s.board()                                       // the last move changed the table; the prompt stops with the duel
    if (pid !== null && table) void this.emitPrivate(pid, { k: 'board', b: table as unknown as Json })
    const paid = this.payOut(s, pid, true)
    void this.emit({ k: 'paid', ...paid } as unknown as Ev)
    this.promiseBonus(s)
    for (const e of s.revealEvents()) void this.emit(e as unknown as Ev)
    const r = s.result!
    this.hooks()?.onDuelEnd?.({
      rivalId: s.rivalId, gameId: s.rules.id, night, boss: s.boss, tier: s.tier, S: s.S,
      won: r.won, drew: r.drew, net: r.net, calledCorrect: r.calledCorrect,
    })
    h.doneNight = night
    h.session = null; h.phase = 'idle'
  }

  /**
   * Promise mode: a duel may offer `rewards(state)` (Lucan's table): each kept-word win is a ŞANS star (the luck meter hears `floor:luck`),
   * each crack of the player's is one Heat (broken words travel). Other duels have none.
   */
  private promiseBonus(s: DuelSession): void {
    const rw = (s.rules as unknown as { rewards?: (st: unknown) => { stars: number; cracks: number } }).rewards?.(s.state)
    if (!rw) return
    const { stars, heat } = applyPromiseRewards(this.ctx.run, rw)
    if (stars > 0 || heat > 0) void this.emit({ k: 'bonus', stars, heat } as unknown as Ev)
  }

  /** Applies the result to the wallet, the Pledge counters and the Soul Marks. Returns the public report. */
  private payOut(s: DuelSession, pid: PlayerId | null, present: boolean): Paid {
    const h = this.host, run = this.ctx.run, hooks = this.hooks()
    const res = s.result ?? { net: -s.S, calledCorrect: null, won: false, drew: false, verdict: 'FAIR' as const, tier: s.tier, S: s.S }
    const st: StakeSettlement = settleStake(s.tier, s.S, res.net)
    const out: Paid = { tier: s.tier, S: s.S, net: res.net, coins: 0, owed: 0, pledge: '', mark: '', marksLeft: 0 }
    if (pid === null) return out
    if (s.tier === 'coins') {
      out.coins = st.coinsGross
      this.paySeat(0, st.coinsGross, { bet: s.S, tags: ['duel'] }, pid)
      if (st.coinsOwed > 0) {
        const pay = Math.min(st.coinsOwed, Math.max(0, Math.floor(run.wallet(pid))))
        if (pay >= 1 && this.chargeSeat(0, pay, pid)) out.owed = pay
        this.forfeit(0)
      }
    } else if (s.tier === 'pledge') {
      if (st.refundPledge && h.escrow.cur) { run.earn(h.escrow.cur, h.escrow.amount, 'duel.pledge', pid); out.pledge = res.net > 0 ? 'won' : 'back' }
      else out.pledge = 'lost'
    }
    if (st.takePledge) {
      run.earn('obol', RIVAL_PLEDGE_OBOLS, 'duel.rivalPledge', pid)
      hooks?.grantPledge?.(s.rivalId, pid)
      out.pledge = 'won'
    }
    if (st.returnMark) { hooks?.returnSoulMark(pid); out.mark = res.net > 0 ? 'won' : '' }
    // Dread is 0..100 points in the run, so the spec's +0.1 is 10 points
    if (st.loseMark) { hooks?.loseSoulMark(pid); run.addDread(MARK_DREAD * 100, 'soulmark'); out.mark = 'lost' }
    if (hooks) out.marksLeft = hooks.soulMarks(pid)
    h.escrow = { cur: '', amount: 0 }
    if (!present) h.doneNight = s.night
    return out
  }

  // ── presentation (every peer, in order) ──────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const e = ev as unknown as { k: string } & Record<string, unknown>
    const local = this.isLocalOccupant
    const P = this.parts, fx = this.ctx.fx
    switch (e.k) {
      case 'seal': {
        const d = e as unknown as Extract<DuelEvent, { k: 'seal' }>
        reduce(this.view, d)
        this.noDuel = false; this.adjourned = false; this.paid = null; this.mine = null; this.callMode = false; this.sent = 0
        this.clearTable()
        this.applyRival(d.rival)
        this.paintAll()
        if (local && !pc.fast && !d.quiet) {
          await this.guard(manga.glyph('menace'))
          await this.guard(manga.dialogue('notary', 'm.tallytable.notarySeal', 'left'))
          await this.guard(manga.dialogue('you', 'm.tallytable.youMark', 'right'))
          const line = `m.tallytable.line_${d.rival}`
          if (has(line)) void manga.cutin(d.rival, 'smirk', line)
        }
        return
      }
      case 'tiers':
        this.tiers = e as unknown as Tiers
        this.tierCur = this.tierOk('coins') ? 0 : this.tierOk('pledge') ? 1 : this.tierOk('soul') ? 2 : 0
        this.showHud()
        return
      case 'adj': this.adjourned = true; this.noDuel = false; this.showHud(); return
      case 'nodue': this.noDuel = true; this.adjourned = false; this.showHud(); return
      case 'reset':
        this.view = freshView(); this.mine = null; this.callMode = false; this.sent = 0; this.paid = null
        this.clearTable()
        this.paintAll()
        return
      case 'stake': {
        reduce(this.view, e as unknown as DuelEvent)
        this.sfx('chip')
        fx.sparks(P.seal, 8, GOLD)
        if (local) { if (this.view.tier === 'coins') this.seatHud?.stake(this.view.S) }
        this.paintAll()
        return
      }
      case 'round':
        reduce(this.view, e as unknown as DuelEvent)
        this.sfx('creak', { vol: 0.4 })
        this.paintAll()
        return
      case 'turn': {
        const d = e as unknown as Extract<DuelEvent, { k: 'turn' }>
        reduce(this.view, d)
        if (d.who === 'player') this.sfx('chime', { vol: 0.5 }); else P.rival.lookAt(P.tray.getWorldPosition(new THREE.Vector3()), 0.5)
        this.paintAll()
        return
      }
      case 'act': {
        const d = e as unknown as Extract<DuelEvent, { k: 'act' }>
        reduce(this.view, d)
        this.sfx(d.who === 'rival' ? 'click' : 'tileClack', { vol: 0.45 })
        if (d.who === 'rival') this.rivalGesture()
        if (local && !pc.fast && d.who === 'rival' && d.rows.length > 1) await this.playRows(d.rows)       // his move happens in front of you, row by row
        else this.lastRefs = d.rows
        this.paintAll()
        // Promise mode: a key throw (Lucan's winning call) cuts to his eye for 0.6 s with the thought and the sting
        if (local && !pc.fast && d.rows.some((r) => r.data && r.data.eye)) await this.guard(gamblersEye({ rival: this.view.rival, kind: 'wide', line: 'duel.pr.eye.wide' }))
        return
      }
      case 'clue': {
        const d = e as unknown as Extract<DuelEvent, { k: 'clue' }>
        reduce(this.view, d)
        this.syncLamps()
        this.paintAll()
        await this.ringClue(d.c.channel, d.c.key, (d.c.data ?? {}) as Record<string, unknown>, local && !pc.fast)
        return
      }
      case 'called': {
        const d = e as unknown as Extract<DuelEvent, { k: 'called' }>
        reduce(this.view, d)
        this.callMode = false
        this.sfx('stamp', { vol: 0.8 })
        void this.anim(0.25, (k) => { P.stamp.position.y = 0.74 + 0.045 - Math.sin(k * Math.PI) * 0.03 })
        fx.shake(0.02, 0.2)
        this.paintAll()
        if (local && !pc.fast) await this.guard(manga.glyph('menace'))
        return
      }
      case 'ruling': {
        const d = e as unknown as Extract<DuelEvent, { k: 'ruling' }>
        reduce(this.view, d)
        this.mine = null; this.callMode = false
        this.sfx(d.correct === true ? 'stinger' : 'buzzer', { vol: 0.7 })
        this.paintAll()
        if (local && !pc.fast) {
          const key = d.correct === true ? 'notaryCheat' : d.correct === false ? 'notaryWrong' : 'notaryEnd'
          await this.guard(manga.dialogue('notary', `m.tallytable.${key}`, 'left', d.correct === false ? 'smirk' : 'calm'))
        }
        return
      }
      case 'paid': {
        this.paid = e as unknown as Paid
        this.showResult()
        this.paintAll()
        return
      }
      case 'bonus': {
        const b = e as unknown as { stars: number; heat: number }
        if (local) {
          if (b.stars > 0) this.toast(this.t('prStars', { n: b.stars }), 'info')
          if (b.heat > 0) this.toast(this.t('prHeat', { n: b.heat }), 'warn')
        }
        return
      }
      case 'reveal': {
        const d = e as unknown as Extract<DuelEvent, { k: 'reveal' }>
        reduce(this.view, d)
        this.syncLamps(true)
        fx.sparks(P.cuff, 18, CHANNEL_COLOR.table)
        this.paintAll()
        if (local && !pc.fast) await this.guard(manga.reveal(d.script, d.clues, d.verdict), 150)
        return
      }
      case 'end':
        reduce(this.view, e as unknown as DuelEvent)
        this.mine = null; this.callMode = false
        this.paintAll()
        return
      case 'board':
        if (local) { this.tb = (e as unknown as { b: Board }).b; this.showHud() }
        return
      case 'mine': {
        if (!local) return
        const p = (e as unknown as { p: Prompt }).p
        const turnChanged = !this.mine || this.mine.v !== p.v
        this.mine = p
        if (p.board) this.tb = p.board
        this.sent = 0
        if (turnChanged) this.cur = clamp(this.cur, 0, Math.max(0, (this.callMode ? p.targets.length : p.actions.length) - 1))
        if (!p.canCall) this.callMode = false
        this.showHud()
        return
      }
    }
  }

  /** TELL: the portrait; TABLE: something odd in 3D; MATH: a chime and a highlighted Sheet row. */
  private async ringClue(channel: 'tell' | 'table' | 'math', key: string, data: Record<string, unknown>, show: boolean): Promise<void> {
    const P = this.parts, fx = this.ctx.fx
    const color = CHANNEL_COLOR[channel]
    if (typeof data.eye === 'string') {
      // the Gambler's Eye: a tell or oddity the player can read (slow motion, vignette, eye panel, one thought)
      this.sfx(channel === 'table' ? 'sparkle' : 'chime', { vol: 0.5 })
      if (show) {
        await this.guard(gamblersEye({ rival: this.view.rival, kind: data.eye === 'glass' ? 'glass' : 'watch', line: typeof data.line === 'string' ? data.line : undefined, hand: typeof data.hand === 'string' ? data.hand : undefined }))
      }
      return
    }
    if (channel === 'tell') {
      this.sfx('sparkle', { vol: 0.5 })
      this.rivalGesture(1.6)
      if (show) void manga.cutin(this.view.rival, 'smirk', has(key) ? key : undefined)
    } else if (channel === 'table') {
      this.tableHook(typeof data.hook === 'string' ? data.hook : 'glint')
    } else {
      this.sfx('chime', { vol: 0.6 })
      fx.glow(P.board.mesh, color, 0.5, 0.6)
      if (show && has(key)) this.toast(tr(key, vars(data)), 'info')
    }
    if (show) await this.wait(0.5)
  }

  /** The 3D oddities the TABLE clues point at (`clue.data.hook`): glint, shudder, steam, spare. */
  private tableHook(hook: string): void {
    const P = this.parts, fx = this.ctx.fx
    switch (hook) {
      case 'shudder':
        this.sfx('lever', { vol: 0.5 })
        void this.anim(0.7, (k) => { P.needle.rotation.z = Math.sin(k * 40) * 0.5 * (1 - k) })
        break
      case 'steam':
        this.sfx('whoosh', { vol: 0.5 })
        fx.smoke(P.cup, 10)
        break
      case 'spare':
        this.sfx('sparkle', { vol: 0.6 })
        fx.sparks(P.tray, 10, CHANNEL_COLOR.table)
        fx.glow(P.tray, 0xffffff, 0.25, 0.5)
        break
      default:
        this.sfx('sparkle', { vol: 0.6 })
        fx.sparks(P.cuff, 12, 0xffffff)
        fx.glow(P.cuff, 0xffffff, 0.22, 0.5)
        fx.lightPulse(P.cuff, { color: 0xffffff, dur: 0.4 })
    }
  }

  /** Awaits a manga presentation, but never longer than `sec`: a missing or stuck overlay must not stall the table. */
  private async guard(p: Promise<unknown> | undefined, sec = GUARD_S): Promise<void> {
    if (!p) return
    try { await Promise.race([p, this.ctx.timers.wait(sec)]) } catch { /* presentation failed: carry on */ }
  }

  /** The rival talks with his hands for a moment, then sits still again. */
  private rivalGesture(sec = 1.4): void {
    const P = this.parts
    void P.rival.play('Sitting_Talking_Loop')
    void this.wait(sec).then(() => P.rival.play('Sitting_Idle_Loop'))
  }

  /** Writes a move's rows on the plate one at a time (a locker shuffle is eight swaps), a tick for each, in about ROWS_S seconds. */
  private async playRows(rows: TextRef[]): Promise<void> {
    const step = clamp(ROWS_S / rows.length, 0.15, 0.5)
    this.lastRefs = []
    for (const r of rows) {
      this.lastRefs = [...this.lastRefs, r]
      this.sfx('click', { vol: 0.25 })
      this.showHud()
      await this.wait(step)
    }
  }

  /** A new duel, or the seat is empty: the plate, the Sheet and the last move start blank. */
  private clearTable(): void {
    this.tb = null
    this.lastRefs = []
    this.board?.reset()
    this.panel?.reset()
  }

  private showResult(): void {
    const p = this.paid, sh = this.seatHud
    if (!p || !sh || !this.isLocalOccupant) return
    const kind = p.net > 0 ? 'win' : p.net < 0 ? 'lose' : 'push'
    const label = this.t(p.net > 0 ? 'winBanner' : p.net < 0 ? 'loseBanner' : 'drawBanner')
    sh.result(kind, p.tier === 'coins' ? p.net : 0, 3, label)
    this.sfx(p.net > 0 ? 'win2' : 'lose', { vol: 0.6 })
    for (const line of this.paidLines(p)) this.toast(line, p.net < 0 ? 'bad' : 'info')
  }

  private paidLines(p: Paid): string[] {
    const out: string[] = []
    const rival = this.t(`rivalName_${this.view.rival}`)
    if (p.net === 0) out.push(this.t('drawn'))
    if (p.tier === 'coins') {
      if (p.coins > 0 && p.net >= 0) out.push(this.t('paidCoins', { n: fmtCoins(p.coins) }))
      if (p.net < 0) out.push(this.t('lostCoins', { n: fmtCoins(p.S) }))
      if (p.owed > 0) out.push(this.t('finedCoins', { n: fmtCoins(p.owed) }))
    }
    if (p.pledge === 'won') out.push(this.t('pledgeWon', { rival }))
    else if (p.pledge === 'back') out.push(this.t('pledgeBack'))
    else if (p.pledge === 'lost') out.push(this.t('pledgeLost'))
    if (p.mark === 'won') out.push(this.t('markWon'))
    if (p.mark === 'lost') { out.push(this.t('markLost', { n: p.marksLeft })); if (p.marksLeft <= 0) out.push(this.t('markBlank')) }
    return out.slice(0, 3)
  }

  // ── the rival's look ─────────────────────────────────────────────────────────────────────────
  private applyRival(id: string): void {
    if (this.dressed === id) return
    this.dressed = id
    const P = this.parts, look = lookOf(id)
    for (const off of this.dress.splice(0)) { try { off() } catch { /* already detached */ } }
    P.rival.setTint(look.body, 1)
    P.rival.root.scale.setScalar(look.height / 1.76)
    const seat = seatedRoot(look.height, RIVAL_CHAIR_Z, 1)       // a taller or shorter rival still sits ON the cushion
    P.rival.root.position.set(0, seat.y, seat.z)
    this.dress = look.dress(this.ctx.kit, P.rival)
  }

  private syncLamps(all = false): void {
    const seen = new Set(this.view.clues.map((c) => c.channel))
    const L = this.parts.lamps
    L.tell.setOn(all || seen.has('tell'))
    L.table.setOn(all || seen.has('table'))
    L.math.setOn(all || seen.has('math'))
  }

  // ── painting ──────────────────────────────────────────────────────────────────────────────────
  private paintAll(): void {
    this.syncLamps()
    this.drawBoard()
    this.paintSheet()
    this.showHud()
  }

  private say(r: TextRef): string {
    if (r.key && has(r.key)) return tr(r.key, vars(r.data))
    return r.text ?? r.key ?? ''
  }

  private paintSheet(): void {
    const panel = this.panel
    if (!panel) return
    panel.labels(this.t('sheetTitle'), 'T', this.t('sheetEmpty'))
    const tags = { player: this.t('whoPlayer'), rival: this.t('whoRival'), sys: this.t('whoSys'), tell: this.t('chTell'), table: this.t('chTable'), math: this.t('chMath') }
    const lines: SheetLine[] = this.view.sheet.map((r) => ({
      r: r.r,
      tag: r.who === 'clue' ? tags[r.ch ?? 'tell'] : tags[r.who],
      text: this.say(r.t),
      cls: r.who === 'clue' ? (r.ch ?? 'tell') : r.who === 'player' ? 'p' : r.who === 'rival' ? 'r' : 's',
    }))
    panel.setLines(lines)
  }

  private drawBoard(): void {
    const v = this.view
    this.parts.board.draw((g, sc) => {
      g.fillStyle = '#0b0a12'; g.fillRect(0, 0, sc.w, sc.h)
      const head = v.rival ? this.t(`rivalName_${v.rival}`) : this.t('plate')
      sc.text(head, sc.w / 2, 4, { font: 'px5', color: '#ffd040', align: 'center' })
      if (v.phase !== 'seal' || v.S > 0) {
        sc.text(`${this.t('nRound')} ${v.round || '-'}`, sc.w / 2, 22, { font: 'px5', color: '#f4f0dc', align: 'center' })
        sc.text(`${this.t('nStake')} ${v.S || '-'}`, sc.w / 2, 38, { font: 'px5', color: '#7dff7a', align: 'center' })
      }
    })
  }

  onLang(): void {
    this.drawBoard()
    this.paintSheet()
    if (this.isLocalOccupant) this.showHud()
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`) }

  private rulesLines(): Txt[] {
    const v = { call: this.k('alt'), go: this.k('primary'), sheet: 'T' }
    if (this.view.game === 'promise') {
      return [{ k: 'm.tallytable.prRule1' }, { k: 'm.tallytable.prRule2' }, { k: 'm.tallytable.prRule3' }, { k: 'm.tallytable.prRule4', v }, { k: 'm.tallytable.prRule5' }]
    }
    return [
      { k: 'm.tallytable.rule1' }, { k: 'm.tallytable.rule2', v }, { k: 'm.tallytable.rule3', v },
      { k: 'm.tallytable.rule4' }, { k: 'm.tallytable.rule5' },
    ]
  }

  /** The key label of option `i` (1-8 are bound; a longer list has no digit and is walked with the arrows). */
  private nk(i: number): string { return i < 8 ? this.k(`n${i + 1}` as MachineAction) : '' }

  /** The three stake tiers as buttons: name big, what it costs under it; an unavailable tier is dimmed. */
  private tierItems(): ChoiceItem[] {
    const t = this.tiers
    if (!t) return []
    const no = this.t('tierNo')
    const rows: Array<[string, string, boolean]> = [
      [this.t('tierCoins'), t.coins ? this.t('tierCoinsD', { n: fmtCoins(t.S) }) : no, t.coins],
      [this.t('tierPledge'), t.pledge === 'ticket' ? this.t('tierPledgeTickets') : t.pledge === 'obol' ? this.t('tierPledgeObol') : t.calm ? this.t('tierCalm') : no, t.pledge !== ''],
      [this.t('tierSoul'), t.soul > 0 ? this.t('tierSoulD', { n: t.soul }) : t.calm ? this.t('tierCalm') : no, t.soul > 0],
    ]
    return rows.map(([label, sub, ok], i) => ({ key: this.nk(i), label, sub, off: !ok }))
  }

  /** The seat HUD: the one goal line, the banner, the hint row of keys that work now; the choice bar and the plate are board.ts. */
  private showHud(): void {
    const sh = this.seatHud
    if (!sh || !this.isLocalOccupant) return
    const v = this.view, m = this.mine
    const rival = v.rival ? this.t(`rivalName_${v.rival}`) : ''
    const keys = { go: this.k('primary'), call: this.k('alt'), left: this.k('left'), right: this.k('right') }
    const ctrl: HudControl[] = []
    const rules = v.game ? getDuel(v.game) : undefined
    sh.goal({ k: rules?.goal ?? (v.game === 'promise' ? 'm.tallytable.goalPromise' : 'm.tallytable.goal') })

    let choice: ChoiceView | null = null
    if (this.noDuel) sh.state({ k: 'm.tallytable.stNoDuel' }, 'neutral', { k: 'm.tallytable.stNoDuelSub' })
    else if (this.adjourned) sh.state({ k: 'm.tallytable.stAdjourned' }, 'neutral', { k: 'm.tallytable.stAdjournedSub' })
    else if (v.phase === 'seal') {
      sh.state({ k: 'm.tallytable.stSeal' }, 'gold')
      const items = this.tierItems()
      if (items.length) choice = { title: '', items, cursor: this.tierCur, tone: 'tier', hint: this.t('hintTier', { n1: this.k('n1'), n3: this.k('n3') }) }
    } else if (v.phase === 'rounds') {
      if (this.callMode && m) {
        sh.state({ k: 'm.tallytable.stCall' }, 'bad')
        choice = { title: this.t('pickCall'), items: m.targets.map((r, i) => ({ key: this.nk(i), label: this.say(r) })), cursor: this.cur, tone: 'call', hint: this.t('hintCall', keys) }
        ctrl.push({ key: keys.call, label: { k: 'm.tallytable.cCancel' }, action: 'alt' })
      } else if (m?.myTurn) {
        sh.state({ k: 'm.tallytable.stYou' }, 'good')
        choice = { title: '', items: m.actions.map((r, i) => ({ key: this.nk(i), label: this.say(r) })), cursor: this.cur, tone: 'move', hint: this.t('hintMove', keys) }
      } else {
        sh.state({ k: 'm.tallytable.stRival', v: { rival } }, 'cyan')
        if (v.turn === 'rival') choice = { title: this.t('stRival', { rival }), items: [], cursor: 0, tone: 'wait', hint: '' }
      }
      if (m?.canCall && !this.callMode) ctrl.push({ key: keys.call, label: { k: 'm.tallytable.cCall' }, action: 'alt' })
    } else if (v.phase === 'ruling') sh.state({ k: 'm.tallytable.stRuling' }, 'gold')
    else if (v.phase === 'reveal') sh.state({ k: 'm.tallytable.stReveal' }, 'gold')
    else if (v.phase === 'done') sh.state({ k: 'm.tallytable.stDone' }, 'neutral')
    else sh.state({ k: 'm.tallytable.stSeal' }, 'neutral')

    sh.numbers([])                                          // round and stake live on the plate
    ctrl.push({ key: 'T', label: { k: 'm.tallytable.cSheet' }, action: 'collect' })
    ctrl.push({ key: this.k('help'), label: { k: 'm.tallytable.cRules' }, action: 'help' })
    ctrl.push({ key: this.k('exit'), label: { k: 'm.tallytable.cLeave' }, action: 'exit' })
    sh.controls(ctrl)
    this.board?.choice(choice)
    this.paintPlate()
  }

  /** The plate: names and points, whose turn, the pieces of the game, the latest move, one note. Hidden until the first prompt. */
  private paintPlate(): void {
    const b = this.board
    if (!b || !this.isLocalOccupant) return
    const v = this.view, tb = this.tb
    if (!tb) { b.clearBoard(); return }
    const rival = this.t(`rivalName_${v.rival}`)
    const picking = !this.callMode && !!this.mine?.myTurn
    const piece = (p: Piece): PieceView => ({ top: this.say(p.top), sub: p.sub ? this.say(p.sub) : undefined, down: p.down, mark: p.mark, tone: p.tone, sel: picking && p.act === this.cur })
    const turn = v.phase === 'rounds' ? (v.turn === 'player' ? 'you' : v.turn === 'rival' ? 'him' : 'none') : 'none'
    const stake = v.tier === 'coins' ? fmtCoins(v.S) : this.t(v.tier === 'pledge' ? 'tierPledge' : 'tierSoul')
    b.paint({
      names: { you: this.t('whoPlayer'), him: rival },
      turn,
      turnText: turn === 'you' ? this.t('turnYou') : turn === 'him' ? this.t('turnHim') : v.phase === 'ruling' ? this.t('turnRuling') : '',
      meta: `${this.t('nRound')} ${v.round || '-'}  ·  ${this.t('nStake')} ${stake}`,
      score: tb.score ?? null,
      meter: tb.meter ? { label: this.say(tb.meter.label), value: tb.meter.value, max: tb.meter.max, danger: tb.meter.danger } : null,
      zones: tb.zones.map((z) => ({ label: this.say(z.label), pieces: z.pieces.map(piece) })),
      last: this.lastRefs.slice(-LAST_ROWS).map((r) => this.say(r)),
      notes: (tb.notes ?? []).map((n) => this.say(n)),
    })
  }

  // ── clocks ────────────────────────────────────────────────────────────────────────────────────
  tick(dt: number): void {
    if (this.forfeitArm > 0) this.forfeitArm = Math.max(0, this.forfeitArm - dt)
    if (this.sent > 0 && (this.sent -= dt) <= 0) { this.sent = 0; if (this.isLocalOccupant) this.showHud() }
  }

  frame(_dt: number, t: number): void {
    const P = this.parts
    if (P.needle.rotation.z === 0 || Math.abs(P.needle.rotation.z) < 0.02) P.needle.rotation.z = Math.sin(t * 1.3) * 0.02
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────
  /** Public view only. `forPid === undefined` is the host's own save: it adds the player's recorded input (no plan, no secrets). */
  getSnapshot(forPid?: PlayerId): Snap {
    const h = this.host
    const snap: Record<string, unknown> = { view: json(this.view), esc: { ...h.escrow }, doneNight: h.doneNight, intro: h.introNight }
    if (forPid === undefined && h.session) { snap.replay = h.session.replayLog(); snap.steps = h.session.version }
    return snap as unknown as Json
  }

  applySnapshot(s: Snap): void {
    const o = s as unknown as { view: PublicView; esc?: Host['escrow']; doneNight?: number; intro?: number; replay?: ReplayEntry[]; steps?: number }
    this.view = json(o.view)
    if (this.view.rival) this.applyRival(this.view.rival)
    if (this.isHost) {
      const h = this.host
      h.doneNight = o.doneNight ?? -1
      h.introNight = o.intro ?? -1
      h.escrow = o.esc ?? { cur: '', amount: 0 }
      const rules = this.view.rival ? duelForRival(this.view.rival) : undefined
      if (rules && o.replay && this.view.phase === 'rounds') {
        h.rules = rules
        h.enc = { rivalId: this.view.rival, night: this.view.night, boss: this.view.boss }
        h.S = this.view.S
        h.session = DuelSession.restore({
          rules, runSeed: this.ctx.runSeed, rivalId: this.view.rival, night: this.view.night, boss: this.view.boss, tier: this.view.tier, S: this.view.S,
        }, o.replay, o.steps ?? 0)
        h.phase = 'rounds'
        h.think = THINK[0]
      }
    }
    this.paintAll()
  }
}
