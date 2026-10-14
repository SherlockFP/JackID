/**
 * Son Kart table overlay (owner: sonkart). The 3D felt is seen from above, so the cards are small: this DOM layer says
 * the same things big. Left edge: one plate per opponent (name, habit tag, a card fan with the count, a gold pulse on
 * their turn, a red LAST CARD flag). Right edge: the top card as a large card, the colour in force, the order and any
 * draws owed. Above the hand: the wild-card COLOUR PICKER (four big squares, keys 1-4 or a click).
 * Plain DOM inside the machine's `ctx.ui.root`, no listeners except the picker's own buttons. Every string arrives
 * already translated (the machine owns i18n), so this file holds no prose.
 */
import './kartHud.css';

export interface PlateView {
  name: string; tag: string; cnt: number; inRound: boolean; turn: boolean; last: boolean; me: boolean; turnLabel: string; lastLabel: string;
}
export interface TopView {
  /** Card id of the discard top ('' before the deal). */
  id: string; label: string; small: boolean; colour: string; colourName: string; topLabel: string;
  owed: string; dir: string;
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
  private plates: HTMLElement[] = [];
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

  /** Repaints the opponent plates. Cheap: nothing is touched unless the content changed. */
  plateList(list: PlateView[]): void {
    const key = list.map((p) => `${p.name}|${p.tag}|${p.cnt}|${+p.inRound}|${+p.turn}|${+p.last}|${+p.me}|${p.turnLabel}|${p.lastLabel}`).join('~');
    if (key === this.seatKey) return;
    this.seatKey = key;
    while (this.plates.length < list.length) this.plates.push(make('div', 'kh-plate', this.seatsEl));
    this.plates.forEach((el, i) => {
      const p = list[i];
      el.style.display = p ? '' : 'none';
      if (!p) return;
      el.className = `kh-plate${p.turn ? ' turn' : ''}${p.inRound ? '' : ' out'}${p.me ? ' me' : ''}`;
      el.textContent = '';
      const r1 = make('div', 'kh-row1', el);
      make('span', 'kh-name', r1).textContent = p.name;
      if (p.tag) make('span', 'kh-tag', r1).textContent = p.tag;
      const r2 = make('div', 'kh-row2', el);
      const fan = make('span', 'kh-fan', r2);
      for (let k = 0; k < Math.min(p.cnt, 9); k++) make('i', '', fan);
      make('span', 'kh-cnt', r2).textContent = p.inRound ? String(p.cnt) : '-';
      if (p.last) make('span', 'kh-last', r2).textContent = p.lastLabel;
      else if (p.turn) make('span', 'kh-turn', r2).textContent = p.turnLabel;
    });
  }

  /** Repaints the top-card chip. */
  top(v: TopView): void {
    const key = `${v.id}|${v.colour}|${v.label}|${v.owed}|${v.dir}|${v.colourName}`;
    if (key === this.topKey) return;
    this.topKey = key;
    const el = this.topEl;
    el.textContent = '';
    el.style.display = v.id ? '' : 'none';
    if (!v.id) return;
    make('div', 'kh-topl', el).textContent = v.topLabel;
    const wildTop = !/^[RYGB]/.test(v.id);
    const card = make('div', `kh-card ${wildTop ? 'W' : v.id[0]}`, el);
    make('span', 'kh-corner', card).textContent = v.small ? '' : v.label;
    make('span', `kh-face${v.small ? ' sm' : ''}`, card).textContent = v.label;
    make('span', 'kh-corner br', card).textContent = v.small ? '' : v.label;
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
