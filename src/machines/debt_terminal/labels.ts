/**
 * Debt Terminal labels in the DOM (native resolution). The world is drawn at 360 lines and upscaled, so a keypad cap is about 30 x 8
 * pixels there and a word on it (a 3D label quad, twice tuned) never read; the CRT's tab strip and amount row lost their thin
 * strokes to the same minification. These are plain DOM chips laid over the keys and over those two CRT rows, placed each frame by projecting the real
 * 3D rectangles through the seat camera: solid faces, big bold glyphs, high contrast, no scanlines. They only exist while the local
 * player is seated and no card or modal covers the view (`show`). The 3D caps stay under them as the frame and the shadow.
 */
import * as THREE from 'three';
import { CAP_TOP, KEY_H, KEY_POS, KEY_W } from './model';
import type { KeyId } from './rules';
import './labels.css';

/** A keypad chip: its word, colours, and whether the key is the cursor / the chosen action (lit). */
export interface KeyChip { text: string; bg: string; ink: string; lit: boolean; cursor: boolean }
/**
 * A chip on the CRT, by its rectangle in the CRT texture (px): a tab (`tab`, or `tabOn` for the open screen) or the amount row (`box`:
 * `text` is its heading on the left, `value` the typed figure on the right).
 */
export interface CrtChip { kind: 'tab' | 'tabOn' | 'box'; text: string; value?: string; x: number; y: number; w: number; h: number }

/** Face colours per key (bright, so the word never depends on the cap's lighting) and the ink that reads on them. */
export const KEY_FACE: Record<KeyId, { bg: string; ink: string }> = {
  dep: { bg: '#4be37a', ink: '#04140a' },
  wd: { bg: '#ff6aa8', ink: '#1a0510' },
  quota: { bg: '#ffd040', ink: '#1a1000' },
  p10: { bg: '#f4efe0', ink: '#14100a' },
  p25: { bg: '#f4efe0', ink: '#14100a' },
  p50: { bg: '#f4efe0', ink: '#14100a' },
  all: { bg: '#d9a040', ink: '#1a1000' },
  rest: { bg: '#f4efe0', ink: '#14100a' },
  enter: { bg: '#e0384a', ink: '#ffffff' },
};

/** The CRT texture's size and its plane's size in metres (model.ts), to map a texture rectangle onto the screen. */
export interface CrtFrame { texW: number; texH: number; w: number; h: number }

const FACE = 0.94;                                   // a chip covers this much of the projected cap face
const INK_FILL = 0.72;                               // the glyphs fill about this much of the chip's height

interface Chip { el: HTMLElement; sig: string }

export class TerminalLabels {
  private readonly root: HTMLElement;
  private readonly keys = new Map<string, Chip & { text: string }>();
  private tabs: Array<Chip & { rect: CrtChip; val: HTMLElement | null }> = [];
  private tabData: CrtChip[] = [];
  private shown = false;
  private readonly v = new THREE.Vector3();

  /** `mount` is the `#ui` root; created before the seat HUD so the HUD's panels draw over the chips. */
  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dt-labels';
    this.root.style.display = 'none';
    mount.appendChild(this.root);
  }

  setKey(id: KeyId, c: KeyChip): void {
    let k = this.keys.get(id);
    if (!k) {
      const el = document.createElement('div');
      el.className = 'dt-key';
      this.root.appendChild(el);
      k = { el, sig: '', text: '' };
      this.keys.set(id, k);
    }
    if (k.text !== c.text) { k.text = c.text; k.el.textContent = c.text; k.sig = ''; }
    k.el.style.background = c.bg;
    k.el.style.color = c.ink;
    k.el.classList.toggle('lit', c.lit);
    k.el.classList.toggle('cur', c.cursor);
  }

  /** The CRT's chips: the tab strip and the amount row (null = none on this screen). */
  setCrt(chips: CrtChip[] | null): void {
    const next = chips ?? [];
    const same = next.length === this.tabData.length && next.every((t, i) => {
      const o = this.tabData[i];
      return t.kind === o.kind && t.text === o.text && t.value === o.value && t.x === o.x && t.y === o.y && t.w === o.w && t.h === o.h;
    });
    if (same) return;
    this.tabData = next;
    for (const t of this.tabs) t.el.remove();
    this.tabs = next.map((rect) => {
      const el = document.createElement('div');
      el.className = `dt-tab${rect.kind === 'tabOn' ? ' on' : ''}${rect.kind === 'box' ? ' box' : ''}`;
      let val: HTMLElement | null = null;
      if (rect.kind === 'box') {
        const head = document.createElement('span');
        head.textContent = rect.text;
        val = document.createElement('span');
        val.className = 'val';
        val.textContent = rect.value ?? '';
        el.append(head, val);
      } else el.textContent = rect.text;
      this.root.appendChild(el);
      return { el, sig: '', rect, val };
    });
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.root.style.display = on ? '' : 'none';
  }

  /** Projects every chip through `cam`: the keys from `keysRoot` (panel space) and the tabs from the CRT plane `crt`. Call each frame while shown. */
  place(cam: THREE.Camera, keysRoot: THREE.Object3D, crt: THREE.Object3D, frame: CrtFrame): void {
    if (!this.shown) return;
    const W = this.root.clientWidth, H = this.root.clientHeight;
    if (W <= 0 || H <= 0) return;
    keysRoot.updateWorldMatrix(true, false);
    for (const [id, k] of this.keys) {
      const p = KEY_POS[id as KeyId];
      const r = this.rect(cam, keysRoot, [p.x - KEY_W / 2, CAP_TOP, p.z - KEY_H / 2], [p.x + KEY_W / 2, CAP_TOP, p.z + KEY_H / 2], W, H);
      this.put(k, r, k.text, 0);
    }
    crt.updateWorldMatrix(true, false);
    const sx = frame.w / frame.texW, sy = frame.h / frame.texH;
    for (const t of this.tabs) {
      const a: [number, number, number] = [(t.rect.x - frame.texW / 2) * sx, (frame.texH / 2 - t.rect.y - t.rect.h) * sy, 0];
      const b: [number, number, number] = [(t.rect.x + t.rect.w - frame.texW / 2) * sx, (frame.texH / 2 - t.rect.y) * sy, 0];
      this.put(t, this.rect(cam, crt, a, b, W, H), t.rect.kind === 'box' ? `${t.rect.text}  ${t.rect.value ?? ''}` : t.rect.text, 1);
    }
  }

  dispose(): void { this.root.remove(); this.keys.clear(); this.tabs = []; this.tabData = []; }

  /** The screen rectangle (px) of the box with local corners `a` (min) and `b` (max): null when it is behind the camera. */
  private rect(cam: THREE.Camera, obj: THREE.Object3D, a: [number, number, number], b: [number, number, number], W: number, H: number): { cx: number; cy: number; w: number; h: number } | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
      this.v.set(x, y, z).applyMatrix4(obj.matrixWorld).project(cam);
      if (this.v.z > 1) return null;
      const px = (this.v.x * 0.5 + 0.5) * W, py = (-this.v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  /** Writes a chip's box and font (only when they changed by a pixel or more). `pad` is the chip's margin share (keys: 1 - FACE). */
  private put(c: Chip, r: { cx: number; cy: number; w: number; h: number } | null, text: string, kind: 0 | 1): void {
    if (!r || r.w < 4 || r.h < 4) { if (c.sig !== 'off') { c.sig = 'off'; c.el.style.display = 'none'; } return; }
    const w = Math.round(r.w * (kind === 0 ? FACE : 1)), h = Math.round(r.h * (kind === 0 ? FACE : 1));
    const left = Math.round(r.cx - w / 2), top = Math.round(r.cy - h / 2);
    const n = Math.max(1, Array.from(text).length);
    // the pixel face is one em a letter: it takes the word when it can fill the chip; a long word (DEPOSIT, WITHDRAW) takes the narrow face
    const wide = Math.min(h * INK_FILL, (w * 0.92) / n);
    const narrow = Math.min(h * 0.95, (w * 0.92) / (n * 0.42));
    const pixel = wide >= h * 0.5;
    const fs = Math.max(8, Math.round(pixel ? wide : narrow));
    const sig = `${left}|${top}|${w}|${h}|${fs}|${pixel ? 1 : 0}`;
    if (sig === c.sig) return;
    c.sig = sig;
    const s = c.el.style;
    s.display = '';
    s.width = `${w}px`; s.height = `${h}px`;
    s.transform = `translate(${left}px, ${top}px)`;
    s.fontSize = `${fs}px`;
    s.fontFamily = pixel ? 'var(--f-head, "Press Start 2P", monospace)' : 'var(--f-body, "VT323", monospace)';
  }
}
