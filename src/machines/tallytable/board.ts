/**
 * The table readout and the choice bar of the Tally Table. Two DOM blocks in the PSX style of the seat HUD, parked between the HUD's
 * top stack and its bottom stack (`--seat-top-b` / `--seat-bot-t`, published by SeatHud):
 *
 *   BOARD   the pieces of the game, big, on a felt plate: who is playing and how many points, the tiles / cards / dice / hands / lockers
 *           (face up, face down, marked), a gauge when the game has one, the last move, one note line.
 *   CHOICE  what you can do right now as large buttons with their keys (the cursor lit), or the call targets, or the stake tiers.
 *           With more than four options only the cursor's option is shown, between arrows; the matching piece on the board is lit instead.
 *
 * All text arrives already translated; this file knows nothing about duels. The 3D table is drawn at 400 x 225, too coarse for card faces,
 * so the faces live here, in crisp DOM, over the felt.
 */
import './tallytable.css'

export interface PieceView {
  top: string
  sub?: string
  down?: boolean
  mark?: string
  tone?: number
  /** The cursor is on this piece (a tile you are about to discard). */
  sel?: boolean
}
export interface ZoneView { label: string; pieces: PieceView[] }
export interface BoardView {
  names: { you: string; him: string }
  /** Whose move: drives the badge colour. */
  turn: 'you' | 'him' | 'none'
  turnText: string
  /** "ROUND 3 · STAKE 8". */
  meta: string
  score: { you: number; him: number; of?: number } | null
  meter: { label: string; value: number; max: number; danger?: number } | null
  zones: ZoneView[]
  /** Lines of the latest move, oldest first. */
  last: string[]
  notes: string[]
}
export interface ChoiceItem { key: string; label: string; /** A second, smaller line under the label. */ sub?: string; off?: boolean }
export interface ChoiceView {
  title: string
  /** Empty = a status plate with only the title ("VELL IS PLAYING"). */
  items: ChoiceItem[]
  cursor: number
  tone: 'move' | 'call' | 'tier' | 'wait'
  hint: string
}

/** More options than this are shown one at a time, between arrows. */
export const MAX_BUTTONS = 4
/** A row of more pieces than this (a hand of nine tiles) uses smaller faces so it stays on one line. */
const DENSE_PIECES = 8

/**
 * Variables for a TextRef's data: numbers and strings as they are, and an `xKey` entry (a key) translated into `x` with the same
 * variables, so a sentence can name a tile or a hand in the player's language ("{name}" from `nameKey` + `rank`).
 */
export function textVars(
  d: Record<string, unknown> | undefined,
  translate: (key: string, vars: Record<string, string | number>) => string,
  known: (key: string) => boolean,
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (!d) return out
  for (const [k, x] of Object.entries(d)) if (typeof x === 'string' || typeof x === 'number') out[k] = x
  for (const [k, x] of Object.entries(d)) if (k.endsWith('Key') && k.length > 3 && typeof x === 'string' && known(x)) out[k.slice(0, -3)] = translate(x, out)
  return out
}

const sigOf = (p: PieceView): string => `${p.top}|${p.sub ?? ''}|${p.down ? 1 : 0}|${p.mark ?? ''}`

/** Pieces that are new or changed since `prev` (keys are `zone:piece`), so the board can pop them. `next` becomes the new baseline. */
export function changedPieces(prev: ReadonlyMap<string, string>, zones: readonly ZoneView[]): { next: Map<string, string>; changed: Set<string> } {
  const next = new Map<string, string>()
  const changed = new Set<string>()
  zones.forEach((z, zi) => z.pieces.forEach((p, pi) => {
    const k = `${zi}:${pi}`, s = sigOf(p)
    next.set(k, s)
    if (prev.size > 0 && prev.get(k) !== s) changed.add(k)       // the first board after a reset is shown, not popped
  }))
  return { next, changed }
}

/** The options that fit on the bar: all of them, or just the cursor's. */
export function visibleChoices(items: readonly ChoiceItem[], cursor: number): { items: ChoiceItem[]; first: number; compact: boolean } {
  if (items.length <= MAX_BUTTONS) return { items: items.slice(), first: 0, compact: false }
  const i = Math.max(0, Math.min(items.length - 1, cursor))
  return { items: [items[i]], first: i, compact: true }
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  parent?.appendChild(e)
  return e
}

export class TallyBoard {
  private readonly stage: HTMLElement
  private readonly board: HTMLElement
  private readonly choiceEl: HTMLElement
  private sigs: Map<string, string> = new Map()
  private shown = false
  private hidden = false

  constructor(mount: HTMLElement) {
    this.stage = make('div', 'tb-stage', mount)
    this.board = make('div', 'tb-board', this.stage)
    this.choiceEl = make('div', 'tb-choice', this.stage)
    this.board.style.display = 'none'
    this.choiceEl.style.display = 'none'
    this.stage.style.display = 'none'
  }

  show(): void { this.shown = true; this.sync() }
  hide(): void { this.shown = false; this.sync() }
  /** A modal (pause card, ledger) is up: step aside without losing state. */
  setBlocked(on: boolean): void { this.hidden = on; this.sync() }
  dispose(): void { this.stage.remove() }
  private sync(): void { this.stage.style.display = this.shown && !this.hidden ? '' : 'none' }

  /** Forget the previous pieces (a new duel): the next board appears without popping. */
  reset(): void { this.sigs = new Map(); this.clearBoard(); this.choice(null) }

  clearBoard(): void { this.board.style.display = 'none'; this.board.replaceChildren() }

  paint(v: BoardView): void {
    const { next, changed } = changedPieces(this.sigs, v.zones)
    this.sigs = next
    const b = this.board
    b.style.display = ''
    b.className = `tb-board turn-${v.turn}`
    b.replaceChildren()

    const head = make('div', 'tb-head', b)
    const side = (cls: string, name: string, pts: number | null): void => {
      const s = make('div', `tb-side ${cls}`, head)
      make('span', 'tb-who', s, name)
      if (pts !== null) make('span', 'tb-pts', s, v.score?.of ? `${pts}/${v.score.of}` : String(pts))
    }
    side('you', v.names.you, v.score ? v.score.you : null)
    make('div', `tb-turn ${v.turn}`, head, v.turnText)
    side('him', v.names.him, v.score ? v.score.him : null)

    if (v.meter) {
      const m = make('div', 'tb-meter', b)
      make('span', 'tb-meter-l', m, v.meter.label)
      const bar = make('span', 'tb-bar', m)
      const fill = make('i', v.meter.danger !== undefined && v.meter.value > v.meter.danger ? 'hot' : '', bar)
      fill.style.width = `${Math.max(0, Math.min(100, (v.meter.value / Math.max(1, v.meter.max)) * 100))}%`
      if (v.meter.danger !== undefined) make('b', 'tb-bar-mark', bar).style.left = `${(v.meter.danger / Math.max(1, v.meter.max)) * 100}%`
    }

    v.zones.forEach((z, zi) => {
      const zone = make('div', 'tb-zone', b)
      make('div', 'tb-zl', zone, z.label)
      const row = make('div', z.pieces.length > DENSE_PIECES ? 'tb-row dense' : 'tb-row', zone)
      z.pieces.forEach((p, pi) => {
        const cls = ['tb-piece', `t${p.tone ?? 4}`, p.down ? 'down' : '', p.mark ? `m-${p.mark}` : '', p.sel ? 'sel' : '', changed.has(`${zi}:${pi}`) ? 'new' : '']
        const el = make('div', cls.filter(Boolean).join(' '), row)
        make('span', 'tb-top', el, p.top)
        if (p.sub && !p.down) make('span', 'tb-sub', el, p.sub)
      })
    })

    if (v.last.length) {
      const l = make('div', 'tb-last', b)
      v.last.forEach((t, i) => make('div', `tb-last-row${i === v.last.length - 1 ? ' new' : ''}`, l, t))
    }
    if (v.meta || v.notes.length) {                          // one footer line: round and stake, then the game's note
      const f = make('div', 'tb-foot', b)
      if (v.meta) make('span', 'tb-meta', f, v.meta)
      for (const t of v.notes) make('span', 'tb-note', f, t)
    }
  }

  /** The choice bar; `null` hides it. */
  choice(v: ChoiceView | null): void {
    const el = this.choiceEl
    if (!v) { el.style.display = 'none'; el.replaceChildren(); return }
    el.style.display = ''
    el.className = `tb-choice tone-${v.tone}`
    el.replaceChildren()
    if (v.title) make('div', 'tb-ch-title', el, v.title)
    if (v.items.length) {
      const { items, first, compact } = visibleChoices(v.items, v.cursor)
      const row = make('div', 'tb-ch-row', el)
      if (compact) make('span', 'tb-arrow', row, '<')
      items.forEach((it, i) => {
        const sel = compact || first + i === v.cursor
        const b = make('div', `tb-btn${sel ? ' sel' : ''}${it.off ? ' off' : ''}`, row)
        if (it.key) make('span', 'tb-key', b, it.key)
        const txt = make('span', 'tb-btext', b)
        make('span', 'tb-bl', txt, it.label)
        if (it.sub) make('span', 'tb-bs', txt, it.sub)
      })
      if (compact) make('span', 'tb-arrow', row, '>')
      if (compact) make('span', 'tb-count', row, `${v.cursor + 1}/${v.items.length}`)
    }
    if (v.hint) make('div', 'tb-hint', el, v.hint)
  }
}
