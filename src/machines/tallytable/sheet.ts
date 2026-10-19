/**
 * The Tally Sheet of the Tally Table: a small collapsible notebook on the right edge of `#ui`, under the HUD's top stack
 * (`--seat-top-b`, published by SeatHud). It is CLOSED by default: a one-line tab ("[T] TALLY SHEET", with a badge for the lines
 * written since you last looked). T opens it; open, it shows only the last few lines in large type, the new ones lit, clues tinted
 * by channel. Closing it marks everything as read. All text arrives already translated.
 */
import './tallytable.css'

export interface SheetLine {
  /** Round number shown at the left (0 = none). */
  r: number
  /** Short speaker tag (YOU / THEM / TELL ...), already translated. */
  tag: string
  text: string
  /** Colour class: 'p' player, 'r' rival, 's' bench, 'tell' | 'table' | 'math' for clue rows. */
  cls: string
}

/** Lines an open Sheet shows. */
export const SHOWN_ROWS = 5

const isClue = (l: SheetLine): boolean => l.cls === 'tell' || l.cls === 'table' || l.cls === 'math'

/**
 * What an open Sheet shows: the last `rows` lines, each flagged `fresh` when it was written after the first `seen` lines.
 * shortcut: `seen` counts lines, so it drifts if the engine's 80-row cap (SHEET_CAP) drops old rows; a duel writes about 40.
 */
export function sheetWindow(lines: readonly SheetLine[], seen: number, rows = SHOWN_ROWS): { rows: Array<SheetLine & { fresh: boolean }>; fresh: number; clues: number } {
  const from = Math.max(0, lines.length - rows)
  return {
    rows: lines.slice(from).map((l, i) => ({ ...l, fresh: from + i >= seen })),
    fresh: Math.max(0, lines.length - Math.min(seen, lines.length)),
    clues: lines.filter(isClue).length,
  }
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  parent?.appendChild(e)
  return e
}

export class TallySheet {
  private readonly root: HTMLElement
  private open = false
  private lines: SheetLine[] = []
  private seen = 0
  private pinged = 0
  private title = ''
  private key = ''
  private empty = ''
  private hiddenByUi = false
  private shown = false

  constructor(mount: HTMLElement) {
    this.root = make('div', 'tt-sheet', mount)
    this.root.style.display = 'none'
  }

  get isOpen(): boolean { return this.open }

  show(): void { this.shown = true; this.sync() }
  hide(): void { this.shown = false; this.sync() }
  setBlocked(on: boolean): void { this.hiddenByUi = on; this.sync() }
  dispose(): void { this.root.remove() }
  private sync(): void { this.root.style.display = this.shown && !this.hiddenByUi ? '' : 'none' }

  /** Header texts (translated), repainted on a language change. */
  labels(title: string, key: string, empty: string): void {
    this.title = title; this.key = key; this.empty = empty
    this.paint(false)
  }

  /** A new duel: an empty, closed Sheet. */
  reset(): void { this.lines = []; this.seen = 0; this.pinged = 0; this.open = false; this.paint(false) }

  setOpen(on: boolean): void {
    if (on === this.open) return
    this.open = on
    if (!on) this.seen = this.lines.length          // closing = everything read
    this.paint(false)
  }
  toggle(): boolean { this.setOpen(!this.open); return this.open }

  setLines(lines: SheetLine[]): void {
    const clues = lines.filter(isClue).length
    const ping = !this.open && clues > this.pinged          // a clue landed while the Sheet was shut: the tab flashes
    this.pinged = Math.max(this.pinged, clues)
    this.lines = lines
    this.seen = Math.min(this.seen, lines.length)
    this.paint(ping)
  }

  private paint(ping: boolean): void {
    const w = sheetWindow(this.lines, this.seen)
    const r = this.root
    r.className = `tt-sheet${this.open ? ' open' : ''}${!this.open && w.fresh > 0 ? ' has-new' : ''}${ping ? ' ping' : ''}`
    r.replaceChildren()
    const tab = make('div', 'tt-tab', r)
    make('span', 'tt-key', tab, this.key)
    make('span', 'tt-title', tab, this.title)
    if (!this.open && w.fresh > 0) make('span', 'tt-badge', tab, String(w.fresh))
    if (!this.open) return
    const body = make('div', 'tt-body', r)
    if (w.rows.length === 0) { make('div', 'tt-empty', body, this.empty); return }
    for (const l of w.rows) {
      const row = make('div', `tt-row c-${l.cls}${l.fresh ? ' fresh' : ''}`, body)
      make('span', 'tt-tag', row, l.r > 0 ? `${l.tag} ${l.r}` : l.tag)
      make('span', 'tt-txt', row, l.text)
    }
  }
}
