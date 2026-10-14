/**
 * The Tally Sheet panel and move picker for the Tally Table (Wave 25 TALLY, lane A). One DOM overlay inside `#ui`, in the
 * PSX style of the seat HUD, parked on the left edge between the HUD's top stack and its bottom stack (`--seat-top-b` /
 * `--seat-bot-t`, published by SeatHud) so it never covers the table or the controls. All text arrives already translated;
 * the panel knows nothing about duels. The Sheet toggles with T; the picker (moves, or call targets) is always visible while
 * the player has a choice to make.
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

export interface PickerView {
  title: string
  items: string[]
  cursor: number
  /** Tone: 'move' (gold) or 'call' (red). */
  tone: 'move' | 'call'
}

const SHOWN_ROWS = 14

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  parent?.appendChild(e)
  return e
}

export class TallyPanel {
  private readonly root: HTMLElement
  private readonly head: HTMLElement
  private readonly list: HTMLElement
  private readonly pick: HTMLElement
  private readonly pickHead: HTMLElement
  private readonly pickList: HTMLElement
  private open = true
  private lines: SheetLine[] = []
  private title = ''
  private hint = ''
  private empty = ''

  constructor(mount: HTMLElement) {
    this.root = make('div', 'tt-panel', mount)
    const sheet = make('div', 'tt-sheet', this.root)
    this.head = make('div', 'tt-head', sheet)
    this.list = make('div', 'tt-rows', sheet)
    this.pick = make('div', 'tt-pick', this.root)
    this.pickHead = make('div', 'tt-pick-head', this.pick)
    this.pickList = make('div', 'tt-pick-list', this.pick)
    this.pick.style.display = 'none'
    this.root.style.display = 'none'
  }

  get isOpen(): boolean { return this.open }

  show(): void { this.root.style.display = '' }
  hide(): void { this.root.style.display = 'none' }
  dispose(): void { this.root.remove() }

  /** Header texts (translated), repainted on a language change. */
  labels(title: string, hint: string, empty: string): void {
    this.title = title; this.hint = hint; this.empty = empty
    this.paint()
  }

  setOpen(on: boolean): void { this.open = on; this.paint() }
  toggle(): boolean { this.open = !this.open; this.paint(); return this.open }

  setLines(lines: SheetLine[]): void { this.lines = lines; this.paint() }

  picker(v: PickerView | null): void {
    if (!v || v.items.length === 0) { this.pick.style.display = 'none'; return }
    this.pick.style.display = ''
    this.pick.className = `tt-pick tone-${v.tone}`
    this.pickHead.textContent = v.title
    this.pickList.replaceChildren()
    // a window of at most 8 entries around the cursor, so long lists (a tile river) stay on screen
    const n = v.items.length
    const from = Math.max(0, Math.min(v.cursor - 3, n - 8))
    for (let i = from; i < Math.min(n, from + 8); i++) {
      const row = make('div', `tt-item${i === v.cursor ? ' sel' : ''}`, this.pickList)
      make('span', 'tt-n', row).textContent = String(i + 1)
      make('span', 'tt-t', row).textContent = v.items[i]
    }
    if (n > 8) make('div', 'tt-more', this.pickList).textContent = `${v.cursor + 1} / ${n}`
  }

  private paint(): void {
    this.head.textContent = `${this.title}  ${this.hint}`
    this.list.style.display = this.open ? '' : 'none'
    if (!this.open) return
    this.list.replaceChildren()
    if (this.lines.length === 0) { make('div', 'tt-empty', this.list).textContent = this.empty; return }
    for (const l of this.lines.slice(-SHOWN_ROWS)) {
      const row = make('div', `tt-row c-${l.cls}`, this.list)
      make('span', 'tt-r', row).textContent = l.r > 0 ? `R${l.r}` : ''
      make('span', 'tt-tag', row).textContent = l.tag
      make('span', 'tt-txt', row).textContent = l.text
    }
  }
}
