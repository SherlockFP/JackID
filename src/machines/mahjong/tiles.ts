/**
 * Mahjong tiles — painters and the 3D tile pool (pattern: `bigone/symbols.ts`). Pure canvas 2D, flat PSX colours.
 *
 * Atlas: 6 × 6 cells of 48 × 64 px. Cells 0..29 are the tile faces (see `rules.ts`: COINS 0-8, STICKS 9-17,
 * MARKS 18-26, dragons 27-29), 30 is the jade back, 31 is plain ivory (the tile's sides).
 * Every suit has its own colour and shape: COINS are blue/green/red discs, STICKS are green bamboo bars with red
 * accents, MARKS are a black numeral over a red chop, dragons are RED (boxed bar), GREEN (sprout) and WHITE (frame).
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { drawText } from '@/core/texgen/font';
import { rankOf, suitOf, type Tile } from './rules';

export const CELL_W = 48, CELL_H = 64;
const COLS = 6, ROWS = 6;
export const BACK = 30, SIDE = 31;
export const ATLAS_W = COLS * CELL_W, ATLAS_H = ROWS * CELL_H;

const IVORY = '#ece2c4', EDGE = '#8a7a52', INK = '#1a1a1a';
const BLUE = '#1c5a9a', GREEN = '#1d7a3a', RED = '#b02a2a', GOLD = '#c8a040';
const TAU = Math.PI * 2;

/** Accent colour of a tile (HUD chips, glow halos). */
export const TILE_CSS: readonly string[] = [BLUE, GREEN, RED, '#7a3a8a'];
export const tileCss = (t: Tile): string => TILE_CSS[suitOf(t)];

/** Pip layouts (fractions of the inner field) for 1..9, shared by discs and bars. */
const PIPS: readonly (readonly [number, number][])[] = [
  [[0.5, 0.5]],
  [[0.5, 0.27], [0.5, 0.73]],
  [[0.3, 0.2], [0.5, 0.5], [0.7, 0.8]],
  [[0.3, 0.27], [0.7, 0.27], [0.3, 0.73], [0.7, 0.73]],
  [[0.3, 0.2], [0.7, 0.2], [0.5, 0.5], [0.3, 0.8], [0.7, 0.8]],
  [[0.3, 0.17], [0.7, 0.17], [0.3, 0.5], [0.7, 0.5], [0.3, 0.83], [0.7, 0.83]],
  [[0.2, 0.15], [0.5, 0.15], [0.8, 0.15], [0.3, 0.55], [0.7, 0.55], [0.3, 0.85], [0.7, 0.85]],
  [[0.3, 0.12], [0.7, 0.12], [0.3, 0.37], [0.7, 0.37], [0.3, 0.63], [0.7, 0.63], [0.3, 0.88], [0.7, 0.88]],
  [[0.2, 0.17], [0.5, 0.17], [0.8, 0.17], [0.2, 0.5], [0.5, 0.5], [0.8, 0.5], [0.2, 0.83], [0.5, 0.83], [0.8, 0.83]],
];

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  g.fillStyle = col;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.fillStyle = IVORY;
  g.beginPath(); g.arc(x, y, r * 0.62, 0, TAU); g.fill();
  g.fillStyle = col;
  g.beginPath(); g.arc(x, y, r * 0.3, 0, TAU); g.fill();
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void {
  g.fillStyle = col;
  g.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  g.fillStyle = IVORY;
  g.fillRect(Math.round(x - w / 2), Math.round(y - 0.5), w, 1);          // the bamboo joint
  g.fillStyle = '#0c3a1a';
  g.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), 1, h);
}

/** Paint the face of `t` into the cell at (x, y). */
export function paintTileFace(g: CanvasRenderingContext2D, t: Tile, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = IVORY; g.fillRect(0, 0, CELL_W, CELL_H);
  g.strokeStyle = EDGE; g.lineWidth = 2; g.strokeRect(1, 1, CELL_W - 2, CELL_H - 2);
  const s = suitOf(t), n = rankOf(t);
  const fx = 6, fy = 6, fw = CELL_W - 12, fh = CELL_H - 12;      // inner field (dragons, marks)
  // COINS and STICKS: a big index digit across the top (readable at a glance), the pips in the field below it
  const px0 = 6, py0 = 21, pw = CELL_W - 12, ph = CELL_H - 27;
  if (s === 0) {                                                  // COINS: discs
    drawText(g, String(n), CELL_W / 2, 5, { font: 'px5', scale: 2, color: BLUE, align: 'center' });
    const r = n === 1 ? 13 : n <= 3 ? 7.5 : n <= 6 ? 6.2 : 4.8;
    PIPS[n - 1].forEach(([px, py], i) => {
      const col = n === 1 ? RED : n === 5 && i === 2 ? RED : i % 2 === 0 ? BLUE : GREEN;
      disc(g, px0 + px * pw, py0 + py * ph, r, col);
    });
  } else if (s === 1) {                                           // STICKS: bamboo bars
    drawText(g, String(n), CELL_W / 2, 5, { font: 'px5', scale: 2, color: GREEN, align: 'center' });
    const w = n === 1 ? 9 : n <= 3 ? 6 : 5, h = n === 1 ? 30 : n <= 3 ? 15 : n <= 6 ? 11 : 9;
    PIPS[n - 1].forEach(([px, py], i) => {
      const col = n === 1 ? RED : (n === 5 && i === 2) || (n === 7 && i === 1) || (n === 9 && i === 4) ? RED : GREEN;
      bar(g, px0 + px * pw, py0 + py * ph, w, h, col);
    });
  } else if (s === 2) {                                           // MARKS: numeral over a red chop
    drawText(g, String(n), CELL_W / 2, 9, { font: 'px5', scale: 6, color: INK, align: 'center' });
    g.fillStyle = RED; g.fillRect(CELL_W / 2 - 11, 44, 22, 14);
    g.fillStyle = IVORY;
    g.fillRect(CELL_W / 2 - 8, 47, 16, 2); g.fillRect(CELL_W / 2 - 1, 47, 2, 8); g.fillRect(CELL_W / 2 - 8, 52, 16, 2);
  } else if (t === 27) {                                          // RED dragon: boxed bar
    g.strokeStyle = RED; g.lineWidth = 4;
    g.strokeRect(fx + 5, fy + 14, fw - 10, fh - 28);
    g.beginPath(); g.moveTo(CELL_W / 2, fy + 4); g.lineTo(CELL_W / 2, CELL_H - fy - 4); g.stroke();
  } else if (t === 28) {                                          // GREEN dragon: sprout
    g.fillStyle = GREEN;
    g.beginPath(); g.moveTo(CELL_W / 2, fy + 6); g.lineTo(CELL_W - fx - 4, CELL_H / 2 - 4); g.lineTo(CELL_W / 2, CELL_H / 2 + 6); g.lineTo(fx + 4, CELL_H / 2 - 4); g.closePath(); g.fill();
    g.fillRect(CELL_W / 2 - 2, CELL_H / 2 + 4, 4, 20);
    g.beginPath(); g.moveTo(CELL_W / 2, CELL_H - 14); g.lineTo(CELL_W - fx - 2, CELL_H - 20); g.lineTo(CELL_W / 2, CELL_H - 24); g.closePath(); g.fill();
  } else {                                                        // WHITE dragon: an empty frame
    g.strokeStyle = BLUE; g.lineWidth = 3;
    g.strokeRect(fx + 3, fy + 3, fw - 6, fh - 6);
    g.strokeRect(fx + 8, fy + 8, fw - 16, fh - 16);
  }
  g.restore();
}

/** Paint the jade back (cell `BACK`) at (x, y). */
export function paintTileBack(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#23694c'; g.fillRect(0, 0, CELL_W, CELL_H);
  g.fillStyle = '#2f8a63';
  g.fillRect(4, 4, CELL_W - 8, CELL_H - 8);
  g.fillStyle = '#23694c';
  for (let i = 0; i < 6; i++) g.fillRect(8, 12 + i * 8, CELL_W - 16, 2);
  g.strokeStyle = GOLD; g.lineWidth = 2; g.strokeRect(6, 6, CELL_W - 12, CELL_H - 12);
  g.fillStyle = GOLD;
  g.beginPath(); g.moveTo(CELL_W / 2, 18); g.lineTo(CELL_W / 2 + 10, CELL_H / 2); g.lineTo(CELL_W / 2, CELL_H - 18); g.lineTo(CELL_W / 2 - 10, CELL_H / 2); g.closePath(); g.fill();
  g.restore();
}

/** Cell origin (px) of atlas cell `i`. */
const cellXY = (i: number): [number, number] => [(i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H];

/** Paint the whole atlas into `g`. */
export function paintAtlas(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  for (let t = 0; t < 30; t++) { const [x, y] = cellXY(t); paintTileFace(g, t, x, y); }
  { const [x, y] = cellXY(BACK); paintTileBack(g, x, y); }
  { const [x, y] = cellXY(SIDE); g.fillStyle = '#d8cca8'; g.fillRect(x, y, CELL_W, CELL_H); }
}

/** UV rectangle of cell `i`: [u0, v0 (bottom), u1, v1 (top)], inset by half a texel (nearest filtering never bleeds). */
export function cellUv(i: number): [number, number, number, number] {
  const [x, y] = cellXY(i);
  return [(x + 0.5) / ATLAS_W, 1 - (y + CELL_H - 0.5) / ATLAS_H, (x + CELL_W - 0.5) / ATLAS_W, 1 - (y + 0.5) / ATLAS_H];
}

// ── the 3D pool ─────────────────────────────────────────────────────────────────────────────────────────
export interface TileObj {
  /** Pivot at the tile's base centre; stands along +Y, the face looks at +Z. Tilt / lay it by rotating this group. */
  root: THREE.Group;
  mesh: THREE.Mesh;
  /** Face currently shown: a tile id, `BACK` for the jade back, or -1 (blank back). */
  face: number;
  setFace(face: number): void;
  /** Glow halo behind the tile (null = off). */
  setGlow(color: number | null, alpha?: number): void;
}

export interface TileSize { w: number; h: number; d: number }

/** One atlas texture and material shared by every tile; each tile is one mesh (one draw call). */
export class TilePool {
  readonly tex: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly material: THREE.Material;
  private readonly haloMats = new Map<number, THREE.Material>();
  private readonly haloGeo = new Map<string, THREE.PlaneGeometry>();
  readonly tiles: TileObj[] = [];

  constructor(readonly size: TileSize) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W; this.canvas.height = ATLAS_H;
    paintAtlas(this.canvas.getContext('2d')!);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.material = psxMaterial({ map: this.tex, lit: true, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.55, unique: true });
  }

  create(parent: THREE.Object3D, size: TileSize = this.size): TileObj {
    const { w, h, d } = size;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const setCell = (face: number, cell: number): void => {       // BoxGeometry face order: +x -x +y -y +z -z
      const [u0, v0, u1, v1] = cellUv(cell);
      const o = face * 4;
      uv.setXY(o, u0, v1); uv.setXY(o + 1, u1, v1); uv.setXY(o + 2, u0, v0); uv.setXY(o + 3, u1, v0);
    };
    for (let f = 0; f < 4; f++) setCell(f, SIDE);
    setCell(5, BACK);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.y = h / 2;
    const root = new THREE.Group();
    root.add(mesh);
    parent.add(root);
    const halo = new THREE.Mesh(this.haloGeometry(w + 0.08, h + 0.08), this.haloMaterial(0xffffff));
    halo.position.set(0, h / 2, -d / 2 - 0.0015);
    halo.rotation.y = Math.PI;
    halo.visible = false;
    root.add(halo);
    const obj: TileObj = {
      root, mesh, face: -1,
      setFace: (face) => {
        obj.face = face;
        setCell(4, face >= 0 && face <= 31 ? face : BACK);
        uv.needsUpdate = true;
      },
      setGlow: (color, alpha = 0.8) => {
        halo.visible = color !== null;
        if (color !== null) {
          halo.material = this.haloMaterial(color);
          (halo.material as THREE.MeshBasicMaterial).opacity = alpha;
        }
      },
    };
    obj.setFace(-1);
    this.tiles.push(obj);
    return obj;
  }

  private haloGeometry(w: number, h: number): THREE.PlaneGeometry {
    const k = `${w.toFixed(3)}x${h.toFixed(3)}`;
    let g = this.haloGeo.get(k);
    if (!g) { g = new THREE.PlaneGeometry(w, h); this.haloGeo.set(k, g); }
    return g;
  }

  private haloMaterial(color: number): THREE.Material {
    let m = this.haloMats.get(color);
    if (!m) {
      m = psxMaterial({ color, lit: false, additive: true, transparent: true, opacity: 0.8, fog: false, side: 'double', unique: true });
      this.haloMats.set(color, m);
    }
    return m;
  }

  dispose(): void {
    this.tex.dispose();
    this.material.dispose();
    for (const m of this.haloMats.values()) m.dispose();
    for (const g of this.haloGeo.values()) g.dispose();
    for (const t of this.tiles) t.mesh.geometry.dispose();
    this.tiles.length = 0;
  }
}
