/**
 * Son Kart table overlay (owner: sonkart). The cards, the colour ring and the top card are 3D on the felt; this DOM layer adds
 * what text does better: one name chip per opponent hung over their seat (name, habit tag, card count, a gold pulse on their
 * turn, a red LAST CARD flag), a small strip with the colour in force, the order and any draws owed, and the wild-card COLOUR
 * PICKER (four big squares, keys 1-4 or a click).
 * Plain DOM inside the machine's `ctx.ui.root`, no listeners except the picker's own buttons. Every string arrives
 * already translated (the machine owns i18n), so this file holds no prose. The chips are placed from the machine's `frame()`
 * by projecting each seat's anchor with the seat camera (`place`).
 */
import './kartHud.css';

export interface PlateView {
  seat: number; name: string; tag: string; cnt: number; inRound: boolean; turn: boolean; last: boolean; me: boolean; turnLabel: string; lastLabel: string;
}
export interface TopView {
  /** A card is on the table (false before the deal). */
  has: boolean; colour: string; colourName: string; owed: string; dir: string;
}
export interface PickView { title: string; sub: string; best: string; names: Record<string, string>; keys: Record<string, string> }

const COLS = ['R', 'Y', 'G', 'B'];
const hex = (c: string): string => ({ R: '#cf2c3a', Y: '#e6b820', G: '#2b9b4a', B: '#2b69cf' } as Record<string, string>)[c] ?? '#888';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Node): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  parent?.appendChild(n);
  return n;
}

export class KartHud {
  private readonly root: HTMLElement;
  private readonly seatsEl: HTMLElement;
  private readonly topEl: HTMLElement;
  private readonly pickEl: HTMLElement;
  private plates: Array<{ el: HTMLElement; seat: number; x: number; y: number }> = [];
  private topKey = '';
  private seatKey = '';
  private pickOn = false;
  private pickCb: ((col: string) => void) | null = null;

  constructor(mount: HTMLElement) {
    this.root = make('div', 'kart-hud', mount);
    this.seatsEl = make('div', 'kh-seats', this.root);
    this.topEl = make('div', 'kh-top', this.root);
    this.pickEl = make('div', 'kh-pick', this.root);
  }

  get picking(): boolean { return this.pickOn; }
  show(): void { this.root.classList.add('on'); }
  hide(): void { this.root.classList.remove('on'); this.closePicker(); }
  dispose(): void { this.root.remove(); }

  /** Repaints the opponent chips. Cheap: nothing is touched unless the content changed. */
  plateList(list: PlateView[]): void {
    const key = list.map((p) => `${p.seat}|${p.name}|${p.tag}|${p.cnt}|${+p.inRound}|${+p.turn}|${+p.last}|${+p.me}|${p.turnLabel}|${p.lastLabel}`).join('~');
    if (key === this.seatKey) return;
    this.seatKey = key;
    while (this.plates.length < list.length) this.plates.push({ el: make('div', 'kh-plate', this.seatsEl), seat: -1, x: -1, y: -1 });
    this.plates.forEach((pl, i) => {
      const p = list[i], el = pl.el;
      el.style.display = p ? '' : 'none';
      if (!p) return;
      pl.seat = p.seat; pl.x = -1;                                       // placed again by the next `place`
      el.className = `kh-plate${p.turn ? ' turn' : ''}${p.inRound ? '' : ' out'}${p.me ? ' me' : ''}`;
      el.textContent = '';
      const r1 = make('div', 'kh-row1', el);
      make('span', 'kh-name', r1).textContent = p.name;
      if (p.tag) make('span', 'kh-tag', r1).textContent = p.tag;
      const r2 = make('div', 'kh-row2', el);
      make('span', 'kh-cnt', r2).textContent = p.inRound ? String(p.cnt) : '-';
      if (p.last) make('span', 'kh-last', r2).textContent = p.lastLabel;
      else if (p.turn) make('span', 'kh-turn', r2).textContent = p.turnLabel;
    });
  }

  /** Hangs each chip over its seat: `x` / `y` are CSS px from the top-left of the overlay (the projected seat anchor). */
  place(at: Array<{ seat: number; x: number; y: number }>): void {
    for (const pl of this.plates) {
      const a = at.find((q) => q.seat === pl.seat);
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      if (Math.abs(a.x - pl.x) < 0.5 && Math.abs(a.y - pl.y) < 0.5) continue;
      pl.x = a.x; pl.y = a.y;
      pl.el.style.left = `${Math.round(a.x)}px`;
      pl.el.style.top = `${Math.round(a.y)}px`;
      pl.el.style.visibility = 'visible';
    }
  }

  /** Repaints the small info strip (colour in force, order, draws owed). */
  top(v: TopView): void {
    const key = `${v.has}|${v.colour}|${v.owed}|${v.dir}|${v.colourName}`;
    if (key === this.topKey) return;
    this.topKey = key;
    const el = this.topEl;
    el.textContent = '';
    el.style.display = v.has ? '' : 'none';
    if (!v.has) return;
    if (v.colour) {
      const col = make('div', 'kh-col', el);
      make('b', '', col).style.background = hex(v.colour);
      make('span', '', col).textContent = v.colourName;
    }
    if (v.owed) make('div', 'kh-owed', el).textContent = v.owed;
    if (v.dir) make('div', 'kh-dir', el).textContent = v.dir;
  }

  /** Opens the colour picker; `cb` gets the chosen colour (R Y G B). Close with `closePicker()`. */
  picker(v: PickView, cb: (col: string) => void): void {
    this.pickCb = cb;
    this.pickOn = true;
    const el = this.pickEl;
    el.textContent = '';
    el.classList.add('on');
    make('div', 'kh-pick-t', el).textContent = v.title;
    const row = make('div', 'kh-pick-row', el);
    for (const c of COLS) {
      const b = make('button', `kh-sw ${c}${c === v.best ? ' best' : ''}`, row);
      b.type = 'button';
      make('span', 'kh-sw-k', b).textContent = v.keys[c] ?? '';
      make('span', 'kh-sw-n', b).textContent = v.names[c] ?? c;
      b.addEventListener('click', () => this.choose(c));
    }
    make('div', 'kh-pick-s', el).textContent = v.sub;
  }

  choose(col: string): void {
    const cb = this.pickCb;
    this.closePicker();
    cb?.(col);
  }

  closePicker(): void {
    this.pickOn = false;
    this.pickCb = null;
    this.pickEl.classList.remove('on');
    this.pickEl.textContent = '';
  }
}
