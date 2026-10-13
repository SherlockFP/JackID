/**
 * In-world 3D placards (`_base`): paper notes, the cassette player, the journal notebook, the omen almanac and the
 * seat rules card. Each one is a small kit-style object (a board or frame mesh + a canvas-texture page) that lives
 * in the first-person OVERLAY scene (`player.overlay`), so it draws on top of the world, in front of the eye, with
 * the depth buffer cleared. Nothing here is DOM.
 *
 *   paint      draws the current page into a low-res canvas (px5 bitmap font, nearest filter, PSX materials)
 *   regions    the paint callback registers clickable rectangles in texel space; a click is a raycast onto the face
 *   keys       KeyboardEvent.code → action (only while the placard is the top one)
 *   motion     slides up from below and settles with an overshoot; a page turn squashes the face; hide slides away
 *   sound      UI sfx only (cardFlip on open/turn, hover, click)
 *
 * Placards do not own game logic: the caller decides what an action means (`spec.act`). One placard at a time takes
 * input (the newest open one); the rest wait underneath.
 */
import * as THREE from 'three';
import { log } from '@/core/log';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { ease } from '@/core/tween';
import { addTicker, uiSfx } from '@/core/ui/widgets';
import { finishTexture, makeCanvas } from '@/core/texgen/pixel';
import { drawText, measureText, PX5_LINE_H } from '@/core/texgen/font';
import type { Hex } from '@/core/types';

// ── palette (canvas CSS colours; the bitmap font draws in these) ────────────────────────────────────
export const PAPER = '#f1e8cc';
export const PAPER_DARK = '#d6c9a2';
export const INK = '#1a130a';
export const INK_SOFT = '#4f3f27';
export const BRASS = '#d6ad4f';
export const CREAM = '#fbf3dc';
export const RED = '#c0392b';

/**
 * Texel supersampling of every placard face: the canvas is RES× the logical size (`spec.px`), shapes are drawn through
 * a RES scale, and text is drawn straight at device resolution (see `put`). Layout code keeps working in logical px.
 * Kept at 1: the game renders at ~224p with NearestFilter and no mipmaps, so a 2x face is minified ~2.5x on a seat card and
 * the 5x7 glyph strokes drop out (checked in the browser). Raise it only together with mipmapped/linear sampling.
 */
export const RES = 1;

// ── host: the first-person overlay and the game canvas ─────────────────────────────────────────────
export interface OverlayRig { readonly scene: THREE.Scene; readonly camera: THREE.Camera }
/**
 * What the placards need from the app. Machines may not import the app core, so the story layer registers this once
 * (`setPlacardHost`, see game/story/notes.ts). `overlay()` is null outside a run (menus): placards then do not show.
 */
export interface PlacardHost {
  overlay(): OverlayRig | null;
  canvas(): HTMLCanvasElement | null;
}
let host: PlacardHost | null = null;
export function setPlacardHost(h: PlacardHost): void { host = h; }

const overlayRig = (): OverlayRig | null => host?.overlay() ?? null;

// ── text helpers (px5 is the PSX bitmap face; it carries Turkish glyphs) ─────────────────────────────
const W5s = (s: string, scale: number): number => measureText(s, { font: 'px5', scale: Math.max(1, Math.floor(scale)) });

/** Word-wrap `text` (paragraphs split on '\n') into rows no wider than `maxW` canvas px at text `scale` (1 or 2). */
export function wrapPx5(text: string, maxW: number, scale = 1): string[] {
  const out: string[] = [];
  const Ws = (s: string): number => W5s(s, scale);
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (Ws(cand) <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      let chunk = word;
      while (Ws(chunk) > maxW && chunk.length > 1) {          // a word wider than the column: hard-break it
        let k = chunk.length - 1;
        while (k > 1 && Ws(chunk.slice(0, k)) > maxW) k--;
        out.push(chunk.slice(0, k));
        chunk = chunk.slice(k);
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/** `s` cut down with a trailing '..' so it fits `maxW` canvas px (one line) at text `scale`. */
export function fitPx5(s: string, maxW: number, scale = 1): string {
  if (W5s(s, scale) <= maxW) return s;
  let x = s;
  while (x.length > 1 && W5s(`${x}..`, scale) > maxW) x = x.slice(0, -1);
  return `${x}..`;
}

/** Split `rows` into pages of `per` rows (at least one page). */
export function paginate<T>(rows: readonly T[], per: number): T[][] {
  const n = Math.max(1, per);
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += n) pages.push(rows.slice(i, i + n));
  return pages.length ? pages : [[]];
}

/**
 * Draw px5 text with its cap-top-left at logical (x, y). `align: 'center'` centres on x. `scale` 2 doubles the glyphs
 * (body text on a face). Glyphs are drawn at device resolution (RES× logical) through the identity transform, so they
 * stay crisp; at scale 1 the stems get one extra device px so they read bolder than the bare 5×7 face.
 */
export function put(g: CanvasRenderingContext2D, s: string, x: number, y: number, color = INK, align: 'left' | 'center' | 'right' = 'left', scale = 1): void {
  if (!s) return;
  const sc = Math.max(1, Math.floor(scale));
  const dx = Math.round(x * RES), dy = Math.round(y * RES);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawText(g, s, dx, dy, { font: 'px5', color, align, scale: sc * RES });
  if (sc === 1) drawText(g, s, dx + 1, dy, { font: 'px5', color, align, scale: RES });
  g.restore();
}

/** Rows of px5 at text `scale` that fit between two y values. */
export const rowsIn = (h: number, scale = 1): number => Math.max(1, Math.floor(h / (PX5_LINE_H * Math.max(1, Math.floor(scale)))));

/** A rule line (1 px). */
export function rule(g: CanvasRenderingContext2D, x: number, y: number, w: number, color = INK_SOFT): void {
  g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
}

// ── placard ──────────────────────────────────────────────────────────────────────────────────────────
export interface PaintCtx {
  readonly g: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly page: number;
  readonly pages: number;
  /** Action id under the pointer (for hover highlight), or null. */
  readonly hover: string | null;
  /** Clickable rectangle in canvas px. The first registered region that contains the point wins. */
  region(x: number, y: number, w: number, h: number, act: string): void;
}

export interface PlacardSpec {
  name: string;
  /** Face size in metres (the canvas is stretched over it). */
  w: number;
  h: number;
  /** Canvas size in texels (keep the aspect of w × h; ~1 texel = 1 mm reads as PSX pixels). */
  px: readonly [number, number];
  /** Page count (may change while open, e.g. a paginated note). */
  pages: () => number;
  paint(c: PaintCtx): void;
  /** What a click or key means: 'prev' | 'next' | 'close' or any action the caller registered. */
  act(a: string): void;
  /** KeyboardEvent.code → action. */
  keys?: Record<string, string>;
  /** Background colour of the canvas before `paint`. */
  bg?: string;
  /** A board or frame behind the face (the paper edge, the notebook cover, the player body). */
  frame?: { color: Hex; pad: number; depth: number };
  /** Extra meshes (parented to the placard root; the face is local z = 0, facing the eye). */
  build?(root: THREE.Group): void;
  /** Per frame, while open. Return true to repaint the face. */
  tick?(dt: number): boolean | void;
  /** Rest position in overlay space (default: dead ahead, a little below the eye line). */
  rest?: readonly [number, number, number];
  /** Called once the hide animation has finished and the placard is disposed. */
  onGone?(): void;
}

const IN_S = 0.42, OUT_S = 0.2, FLIP_S = 0.26;
const live = new Set<Placard3D>();
const stack: Placard3D[] = [];
let hooked = false;
const raycaster = new THREE.Raycaster();
const ndcVec = new THREE.Vector2();

export class Placard3D {
  readonly root = new THREE.Group();
  readonly face: THREE.Mesh;
  private readonly cv: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  /** Logical face size (`spec.px`); the canvas itself is RES× that. */
  private readonly lw: number;
  private readonly lh: number;
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly rest: THREE.Vector3;
  private readonly from: THREE.Vector3;
  private cam: THREE.Camera | null = null;
  private phase: 'idle' | 'in' | 'open' | 'out' = 'idle';
  private t = 0;
  private time = 0;
  private flip = -1;               // < 0: no page turn running
  private flipSwapped = false;
  private flipTo = 0;
  private pageNo = 0;
  private hovered: string | null = null;
  private regions: Array<{ x: number; y: number; w: number; h: number; act: string }> = [];
  private dead = false;

  constructor(readonly spec: PlacardSpec) {
    const [cw, ch] = spec.px;
    this.lw = cw; this.lh = ch;
    [this.cv, this.g] = makeCanvas(cw * RES, ch * RES);
    this.tex = finishTexture(this.cv, { wrap: 'clamp' }, false);
    this.geos.push(new THREE.PlaneGeometry(spec.w, spec.h));
    const mat = psxMaterial({ map: this.tex, lit: false, side: 'double', unique: true });
    this.mats.push(mat);
    this.face = new THREE.Mesh(this.geos[0], mat);
    this.face.name = `placard.${spec.name}`;
    this.root.add(this.face);
    if (spec.frame) {
      const f = spec.frame;
      const g = new THREE.BoxGeometry(spec.w + f.pad * 2, spec.h + f.pad * 2, f.depth);
      const m = psxMaterial({ color: f.color, lit: false, unique: true });
      this.geos.push(g); this.mats.push(m);
      const board = new THREE.Mesh(g, m);
      board.position.z = -f.depth / 2 - 0.0015;
      board.name = `placard.${spec.name}.frame`;
      this.root.add(board);
    }
    spec.build?.(this.root);
    const r = spec.rest ?? [0, -0.02, -0.5];
    this.rest = new THREE.Vector3(r[0], r[1], r[2]);
    this.from = this.rest.clone().add(new THREE.Vector3(0, -0.34, 0.06));
    this.root.position.copy(this.from);
    this.root.rotation.x = 0.55;
    this.repaint();
  }

  /** Current page (clamped to the page count on repaint). */
  get page(): number { return this.pageNo; }
  get open(): boolean { return (this.phase === 'in' || this.phase === 'open') && !this.dead; }

  /** Slide in on the overlay. False when there is no first-person overlay (menus, bench): the caller falls back. */
  show(): boolean {
    if (this.dead) return false;
    const rig = overlayRig();
    if (!rig) { log.warn('placard', `${this.spec.name}: no overlay scene`); return false; }
    this.cam = rig.camera;
    rig.scene.add(this.root);
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    stack.push(this);
    live.add(this);
    hook();
    this.phase = 'in'; this.t = 0;
    this.root.position.copy(this.from);
    this.repaint();
    uiSfx('cardFlip', 0.8);
    return true;
  }

  /** Slide away; `onGone` runs when it has gone and the placard is disposed. Idempotent. */
  hide(): void {
    if (this.dead || this.phase === 'out' || this.phase === 'idle') return;
    this.phase = 'out'; this.t = 0;
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    uiSfx('click', 0.5);
  }

  /** Immediate teardown (no animation, no `onGone`). */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.phase = 'idle';
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    live.delete(this);
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }

  /** Go to page `p` with a flip (the face squashes; the page swaps at the midpoint). */
  goto(p: number): void {
    const n = Math.max(1, this.spec.pages());
    const to = Math.max(0, Math.min(n - 1, p));
    if (to === this.pageNo || this.flip >= 0) return;
    this.flipTo = to; this.flip = 0; this.flipSwapped = false;
    uiSfx('cardFlip', 0.45);
  }
  turn(d: number): void { this.goto(this.pageNo + d); }
  /** Jump to page `p` without the flip (a new selection). */
  jump(p: number): void { this.pageNo = Math.max(0, p); this.flip = -1; this.face.scale.x = 1; this.repaint(); }

  /** Redraw the face now (after the caller changed what `paint` reads). */
  repaint(): void {
    const n = Math.max(1, this.spec.pages());
    this.pageNo = Math.max(0, Math.min(n - 1, this.pageNo));
    const g = this.g, w = this.lw, h = this.lh;
    g.setTransform(RES, 0, 0, RES, 0, 0);            // shapes in logical px, drawn at RES× texels
    g.fillStyle = this.spec.bg ?? PAPER;
    g.fillRect(0, 0, w, h);
    this.regions = [];
    this.spec.paint({
      g, w, h, page: this.pageNo, pages: n, hover: this.hovered,
      region: (x, y, rw, rh, act) => { this.regions.push({ x, y, w: rw, h: rh, act }); },
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.tex.needsUpdate = true;
  }

  /** Raycast the face: the action under the pointer, '' on the face without a region, or null off the face. */
  private hitAt(nx: number, ny: number): string | null {
    if (!this.cam) return null;
    this.cam.updateMatrixWorld();
    this.root.updateWorldMatrix(true, true);
    ndcVec.set(nx, ny);
    raycaster.setFromCamera(ndcVec, this.cam);
    const hit = raycaster.intersectObject(this.face, false)[0];
    if (!hit || !hit.uv) return null;
    const x = hit.uv.x * this.lw, y = (1 - hit.uv.y) * this.lh;
    for (const r of this.regions) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.act;
    return '';
  }

  /** Pointer in NDC (overlay frustum). Move = hover highlight; down = click. */
  /** Returns true when a press landed on the board (the caller then keeps it away from the machine underneath). */
  pointer(nx: number, ny: number, type: 'move' | 'down'): boolean {
    if (!this.open) return false;
    const at = this.hitAt(nx, ny);
    if (type === 'move') {
      const h = at ? at : null;
      if (h !== this.hovered) {
        this.hovered = h;
        if (h) uiSfx('hover', 0.35);
        this.repaint();
      }
      return false;
    }
    if (at === null) return false;
    if (at !== '') { uiSfx('click', 0.7); this.spec.act(at); }
    return true;
  }

  /** Keyboard (only the top placard gets it). Returns true when a bound key was used. */
  key(code: string): boolean {
    const a = this.spec.keys?.[code];
    if (!a) return false;
    this.spec.act(a);
    return true;
  }

  update(dt: number): void {
    if (this.dead) return;
    this.t += dt; this.time += dt;
    let repaint = false;
    if (this.phase === 'in') {
      const f = Math.min(1, this.t / IN_S);
      this.root.position.lerpVectors(this.from, this.rest, ease.outBack(f));
      this.root.rotation.x = (1 - ease.outCubic(f)) * 0.55;
      if (f >= 1) { this.phase = 'open'; this.t = 0; }
    } else if (this.phase === 'open') {
      this.root.position.copy(this.rest);
      this.root.position.y += Math.sin(this.time * 1.7) * 0.0018;
      this.root.rotation.z = Math.sin(this.time * 0.9) * 0.008;
    } else if (this.phase === 'out') {
      const f = Math.min(1, this.t / OUT_S);
      const e = ease.inCubic(f);
      this.root.position.lerpVectors(this.rest, this.from, e);
      this.root.rotation.x = e * 0.55;
      if (f >= 1) { this.finish(); return; }
    }
    if (this.flip >= 0) {
      this.flip += dt / FLIP_S;
      const f = Math.min(1, this.flip);
      this.face.scale.x = Math.max(0.04, Math.abs(Math.cos(Math.PI * f)));
      if (f >= 0.5 && !this.flipSwapped) { this.flipSwapped = true; this.pageNo = this.flipTo; repaint = true; }
      if (f >= 1) { this.flip = -1; this.face.scale.x = 1; }
    }
    if (this.spec.tick?.(dt)) repaint = true;
    if (repaint) this.repaint();
  }

  private finish(): void {
    const cb = this.spec.onGone;
    this.dispose();
    cb?.();
  }
}

// ── global input + frame loop (shared by every placard) ─────────────────────────────────────────────
const topOf = (): Placard3D | null => stack[stack.length - 1] ?? null;

function hook(): void {
  if (hooked) return;
  hooked = true;
  addTicker((dt) => {
    const step = Math.min(dt, 0.1);
    for (const p of [...live]) p.update(step);
    return true;
  });
  // Pointer: map client px to the overlay NDC through the game canvas (the overlay covers it 1:1).
  window.addEventListener('pointermove', (e) => {
    const p = topOf(); if (!p) return;
    const ndc = ndcOf(e);
    if (ndc) p.pointer(ndc[0], ndc[1], 'move');
  });
  // Capture phase: a press on the board is consumed here, so the seated machine underneath never sees it (its pick
  // logic would otherwise fire through the almanac or the rules card). Presses off the board pass through.
  window.addEventListener('pointerdown', (e) => {
    const p = topOf(); if (!p || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('button,input,textarea,select,a')) return;   // real DOM controls keep their clicks
    const ndc = ndcOf(e);
    if (ndc && p.pointer(ndc[0], ndc[1], 'down')) e.stopPropagation();
  }, { capture: true });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const p = topOf(); if (!p) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (p.key(e.code)) e.preventDefault();
  });
  // Fonts settle after first paint: repaint the live faces so the bitmap text is the real face.
  document.fonts?.addEventListener?.('loadingdone', () => { for (const p of live) p.repaint(); });
}

function ndcOf(e: PointerEvent | MouseEvent): [number, number] | null {
  const c = host?.canvas();
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
  const ny = -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
  return [nx, ny];
}

// ── small paint kit ──────────────────────────────────────────────────────────────────────────────────
/** A labelled button: ink plate, paper label; brass when hovered. Registers its own region. */
export function button(c: PaintCtx, x: number, y: number, w: number, h: number, label: string, act: string): void {
  const hot = c.hover === act;
  c.g.fillStyle = hot ? BRASS : INK;
  c.g.fillRect(x, y, w, h);
  put(c.g, label, x + w / 2, y + Math.floor((h - 7) / 2), hot ? INK : CREAM, 'center');
  c.region(x, y, w, h, act);
}

/** Speckle of paper fibres (deterministic, cheap). */
export function speckle(g: CanvasRenderingContext2D, w: number, h: number, seed: number, color = PAPER_DARK, n = 60): void {
  g.fillStyle = color;
  let s = seed | 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    const x = ((s >>> 8) % w + w) % w;
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    const y = ((s >>> 8) % h + h) % h;
    g.fillRect(x, y, 1, 1);
  }
}
