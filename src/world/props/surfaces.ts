/**
 * Environment surfaces (docs/ART.md, wave 87): the painters for the architecture (damask wallpaper, walnut wainscot, coffered
 * ceiling, veined marble, smoked mirror, the apartment's papered wall, plaster, wordless posters and the soft light pool) and the
 * world-UV helper that maps them at one texel density (32 per metre) in WORLD coordinates, so the pieces of a wall split by a
 * doorway stay in phase and the skirting always sits on the floor.
 *
 * Every painter is pixel art on a small canvas (integer coordinates, no smoothing), cached by key, and deterministic: a fixed
 * integer hash stands in for noise, never Math.random. Canvas row 0 is the TOP of the image; with the default flipY it maps to
 * v = 1, so a painter draws its floor end (skirting) at the bottom rows.
 */
import * as THREE from 'three';
import type { TexGen } from '@/core/texgen/types';

type G = CanvasRenderingContext2D;

/** Integer hash -> [0, 1). */
export function hash01(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const rgb = (r: number, g: number, b: number): string => `rgb(${r | 0},${g | 0},${b | 0})`;
const px = (g: G, x: number, y: number, w: number, h: number, c: string): void => { g.fillStyle = c; g.fillRect(x, y, w, h); };
/** Scale an rgb hex by k (0..2). */
const shade = (hex: number, k: number): string => rgb(Math.min(255, ((hex >> 16) & 255) * k), Math.min(255, ((hex >> 8) & 255) * k), Math.min(255, (hex & 255) * k));

/** Fine per-pixel mottling: each pixel darkened or lightened by up to `amt` (deterministic). */
function mottle(g: G, w: number, h: number, amt: number, seed: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = hash01(seed + x * 131 + y * 7919) - 0.5;
    if (Math.abs(r) < 0.18) continue;
    g.fillStyle = r < 0 ? `rgba(0,0,0,${(-r * amt).toFixed(3)})` : `rgba(255,240,220,${(r * amt * 0.6).toFixed(3)})`;
    g.fillRect(x, y, 1, 1);
  }
}

/**
 * World-space planar UVs on an axis-aligned box (a kit.box with no rotation): each face is projected along its normal in world
 * metres / `tile` (local vertex + the mesh's position; the parent is assumed to sit at the origin). x faces: u = z, v = y;
 * z faces: u = x, v = y; y faces: u = x, v = z.
 */
export function worldUV(mesh: THREE.Mesh, tile: number): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  if (!pos || !nrm || !uv) return;
  const o = mesh.position;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i) + o.x, y = pos.getY(i) + o.y, z = pos.getZ(i) + o.z;
    let u: number, v: number;
    if (nx >= ny && nx >= nz) { u = z; v = y; } else if (nz >= ny) { u = x; v = y; } else { u = x; v = z; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

// ── wallpaper ───────────────────────────────────────────────────────────────────────────────────
export type PaperTone = 'nave' | 'wing';
const PAPER: Record<PaperTone, { ground: number; band: number; motif: number; line: number }> = {
  nave: { ground: 0x5c1a1e, band: 0x3e1014, motif: 0xa8803a, line: 0xc8a050 },
  wing: { ground: 0x2c1a20, band: 0x1c1014, motif: 0x6e5432, line: 0x8a6a3a },
};
/** Damask motif (a lozenge with a fleur top and a dropped bud), 9 x 15 px, '#' = motif, '+' = hi-light. */
const DAMASK = [
  '....+....',
  '...###...',
  '..#.#.#..',
  '....#....',
  '...###...',
  '..##.##..',
  '.##...##.',
  '##..+..##',
  '.##...##.',
  '..##.##..',
  '...###...',
  '....#....',
  '...#.#...',
  '..#...#..',
  '....#....',
];

/** Damask stripe wallpaper, 64 px = 2 m (32 texels per metre): a motif column, half-dropped, and a dark band with two gold pinlines. */
export function damaskTex(tex: TexGen, tone: PaperTone = 'nave'): THREE.Texture {
  const c = PAPER[tone];
  return tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, shade(c.ground, 1));
    mottle(g, w, h, 0.22, tone === 'nave' ? 11 : 23);
    for (const x0 of [0, 32]) {
      // the band: x0+22 .. x0+31, with pinlines at its edges
      px(g, x0 + 22, 0, 10, h, shade(c.band, 1));
      px(g, x0 + 23, 0, 1, h, shade(c.line, 0.9));
      px(g, x0 + 30, 0, 1, h, shade(c.line, 0.9));
      for (let y = 2; y < h; y += 4) px(g, x0 + 26, y, 2, 1, shade(c.line, 0.6));   // a dotted centre line
      // the motif, twice per column, half-dropped in the second column
      const drop = x0 === 0 ? 0 : 16;
      for (const my of [8 + drop, 40 + drop]) {
        DAMASK.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            if (row[rx] === '.') continue;
            const y = (my + ry - 7 + h) % h;
            px(g, x0 + 7 + rx, y, 1, 1, row[rx] === '+' ? shade(c.line, 1.15) : shade(c.motif, 0.85 + 0.2 * hash01(rx * 17 + ry + x0)));
          }
        });
      }
    }
  }, { key: `env:damask:${tone}` });
}

// ── wainscot ────────────────────────────────────────────────────────────────────────────────────
/** Metres the wainscot texture spans (one raised panel per repeat; the image spans the full 1.2 m height). */
export const WAINSCOT_TILE = 1.2;

/** Walnut wainscot, 40 px = 1.2 m (33 texels per metre): skirting, a raised panel with bevels between stiles, a cap moulding. */
export function wainscotTex(tex: TexGen): THREE.Texture {
  return tex.canvas(40, 40, (g, w, h) => {
    const base = 0x5a3420;
    px(g, 0, 0, w, h, shade(base, 1));
    // grain: vertical streaks in the stiles and the panel field
    for (let x = 0; x < w; x++) {
      const k = hash01(x * 37 + 5);
      if (k < 0.45) px(g, x, 3, 1, h - 8, `rgba(20,8,2,${(0.08 + k * 0.25).toFixed(3)})`);
      else if (k > 0.85) px(g, x, 3, 1, h - 8, 'rgba(255,200,150,0.06)');
    }
    // the raised panel: x 5..34, y 7..31, with a light bevel top/left and a shadow bevel bottom/right
    px(g, 5, 7, 30, 25, shade(0x6a4028, 1));
    for (let x = 6; x < 34; x++) { const k = hash01(x * 91 + 3); if (k < 0.4) px(g, x, 9, 1, 21, `rgba(30,12,4,${(0.1 + k * 0.3).toFixed(3)})`); }
    px(g, 5, 7, 30, 2, shade(0x8e5a36, 1));
    px(g, 5, 7, 2, 25, shade(0x80502e, 1));
    px(g, 5, 30, 30, 2, shade(0x2a160c, 1));
    px(g, 33, 7, 2, 25, shade(0x341c10, 1));
    px(g, 4, 6, 32, 1, shade(0x24120a, 1));       // the groove round the panel
    px(g, 4, 32, 32, 1, shade(0x8a5a36, 0.9));
    // the cap moulding (rows 0..3) and the skirting (rows 35..39)
    px(g, 0, 0, w, 3, shade(0x6e4428, 1));
    px(g, 0, 0, w, 1, shade(0x9c6a40, 1));
    px(g, 0, 3, w, 1, shade(0x1c0e06, 1));
    px(g, 0, 35, w, 5, shade(0x2a1610, 1));
    px(g, 0, 35, w, 1, shade(0x7a5030, 1));
    px(g, 0, 39, w, 1, shade(0x120804, 1));
  }, { key: 'env:wainscot' });
}

// ── ceilings ────────────────────────────────────────────────────────────────────────────────────
/** The zone ceiling plane, 64 px = 2 m: a cream coffer with a stepped border and a small gilt rosette. */
export function cofferTex(tex: TexGen): THREE.Texture {
  return tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, '#c9b48a');
    mottle(g, w, h, 0.12, 41);
    for (const [i, c] of (['#5e4426', '#7a5a30', '#9a7a48', '#b49a68'] as const).entries()) {
      px(g, i * 2, i * 2, w - i * 4, 2, c); px(g, i * 2, h - 2 - i * 2, w - i * 4, 2, c);
      px(g, i * 2, i * 2, 2, h - i * 4, c); px(g, w - 2 - i * 2, i * 2, 2, h - i * 4, c);
    }
    px(g, 8, 8, w - 16, 1, '#e8d8a8'); px(g, 8, 8, 1, h - 16, '#e8d8a8');
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#b08a38';
    for (let a = 0; a < 8; a++) { const dx = Math.round(Math.cos((a / 8) * Math.PI * 2) * 5), dy = Math.round(Math.sin((a / 8) * Math.PI * 2) * 5); g.fillRect(cx + dx - 1, cy + dy - 1, 2, 2); }
    px(g, cx - 2, cy - 2, 4, 4, '#e8c46a');
  }, { key: 'env:coffer' });
}

/** A ceiling bay panel (stretched once over the bay): a deep border, a dentil course, a glowing field and a centre ring. */
export function bayPanelTex(tex: TexGen): THREE.Texture {
  return tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, '#6a5034');
    px(g, 3, 3, w - 6, h - 6, '#8a6a40');
    for (let i = 5; i < w - 5; i += 3) { px(g, i, 5, 2, 2, '#c8a45a'); px(g, i, h - 7, 2, 2, '#c8a45a'); px(g, 5, i, 2, 2, '#c8a45a'); px(g, w - 7, i, 2, 2, '#c8a45a'); }
    px(g, 9, 9, w - 18, h - 18, '#b89860');
    px(g, 11, 11, w - 22, h - 22, '#d8bc7c');
    mottle(g, w, h, 0.08, 77);
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#c8a45a';
    for (let a = 0; a < 24; a++) { const t = (a / 24) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(t) * 12) - 1, Math.round(cy + Math.sin(t) * 12) - 1, 2, 2); }
    px(g, cx - 3, cy - 3, 6, 6, '#f0d898');
  }, { key: 'env:bay', wrap: 'clamp' });
}

// ── stone, glass ────────────────────────────────────────────────────────────────────────────────
/** Veined marble, 64 px = 2 m: a mottled ground with a few wandering veins (deterministic walks). */
export function marbleTex(tex: TexGen, ground = 0x2a3a30, vein = 0xc8d0b8): THREE.Texture {
  return tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, shade(ground, 1));
    mottle(g, w, h, 0.18, 301);
    for (let v = 0; v < 3; v++) {
      let x = Math.floor(hash01(v * 13 + 1) * w), y = 0;
      const lean = hash01(v * 29 + 7) < 0.5 ? -1 : 1;
      while (y < h) {
        px(g, (x + w) % w, y, 1, 1, shade(vein, 0.32 + 0.2 * hash01(v * 97 + y)));
        if (hash01(v * 1009 + y * 3) < 0.45) x += lean;
        if (hash01(v * 2003 + y * 5) < 0.12) x -= lean * 2;
        y++;
      }
    }
  }, { key: `env:marble:${ground}:${vein}` });
}

/** Smoked mirror (clamped, stretched once over a landscape pane): a dark blue-grey ground warmed at the bottom, two thin pale streaks, a darker silvering rim. */
export function mirrorTex(tex: TexGen): THREE.Texture {
  return tex.canvas(64, 32, (g, w, h) => {
    for (let y = 0; y < h; y++) px(g, 0, y, w, 1, rgb(30 + y * 0.9, 34 + y * 0.6, 40 + y * 0.3));
    for (let y = 0; y < h; y++) {
      const x1 = Math.round(y * 1.2) + 8, x2 = Math.round(y * 1.2) + 13;
      px(g, x1, y, 2, 1, 'rgba(200,220,230,0.12)');
      px(g, x2, y, 1, 1, 'rgba(200,220,230,0.08)');
    }
    mottle(g, w, h, 0.14, 515);
    px(g, 0, 0, w, 1, '#141a1e'); px(g, 0, h - 1, w, 1, '#141a1e'); px(g, 0, 0, 1, h, '#141a1e'); px(g, w - 1, 0, 1, h, '#141a1e');
  }, { key: 'env:mirror', wrap: 'clamp' });
}

/** A soft round light pool (clamped, additive): a dithered disc that fades to black at the rim. */
export function poolTex(tex: TexGen): THREE.Texture {
  return tex.canvas(32, 32, (g, w, h) => {
    px(g, 0, 0, w, h, '#000');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2);
      if (d >= 1) continue;
      const k = (1 - d) * (1 - d) + (((x + y) & 1) ? 0.04 : -0.04);   // a 2-step dither keeps the falloff PSX-banded
      const v = Math.max(0, Math.min(255, Math.round(k * 255 / 16) * 16));
      px(g, x, y, 1, 1, rgb(v, v, v));
    }
  }, { key: 'env:pool', wrap: 'clamp' });
}

// ── the apartment ───────────────────────────────────────────────────────────────────────────────
/** Metres the apartment wall texture spans: the full 2.6 m height, so its bands land on the floor and the ceiling. */
export const HOME_PAPER_TILE = 2.6;

/**
 * The apartment wall, 84 px = 2.6 m (32 texels per metre), floor to ceiling: a dark skirting, cream beadboard to the dado rail
 * (0.9 m), a faded sage wallpaper with pale sprigs and a water stain, and a cream picture rail under the ceiling.
 */
export function homePaperTex(tex: TexGen): THREE.Texture {
  return tex.canvas(84, 84, (g, w, h) => {
    const rail = h - 29;                          // y of the dado rail (0.9 m up)
    // upper paper
    px(g, 0, 0, w, rail, '#56604e');
    for (let x = 0; x < w; x += 12) px(g, x + 5, 3, 2, rail - 3, '#4c5646');                         // faint stripes
    for (let y = 8; y < rail - 4; y += 12) for (let x = ((y / 12) & 1) * 6 + 2; x < w; x += 12) {     // sprigs
      px(g, x, y, 1, 3, '#7c8468'); px(g, x - 1, y + 1, 1, 1, '#8c8a6a'); px(g, x + 1, y, 1, 1, '#8c8a6a');
    }
    mottle(g, w, rail, 0.1, 909);
    for (let y = 14; y < 40; y++) for (let x = 50; x < 74; x++) {                                    // an old water stain
      const d = Math.hypot((x - 62) / 12, (y - 26) / 13);
      if (d < 1 && d > 0.82) px(g, x, y, 1, 1, 'rgba(90,70,40,0.35)');
      else if (d < 0.82) px(g, x, y, 1, 1, 'rgba(110,96,60,0.10)');
    }
    // picture rail
    px(g, 0, 0, w, 3, '#b8ae94'); px(g, 0, 3, w, 1, '#2a2620');
    // dado rail
    px(g, 0, rail, w, 3, '#c8bc9c'); px(g, 0, rail, w, 1, '#e0d6b8'); px(g, 0, rail + 3, w, 1, '#2a2620');
    // beadboard
    px(g, 0, rail + 4, w, h - rail - 9, '#a49a80');
    for (let x = 0; x < w; x += 6) { px(g, x, rail + 4, 1, h - rail - 9, '#6e6656'); px(g, x + 1, rail + 4, 1, h - rail - 9, '#bcb298'); }
    mottle(g, w, h, 0.12, 919);
    // skirting
    px(g, 0, h - 5, w, 5, '#3a2618'); px(g, 0, h - 5, w, 1, '#6a4a30'); px(g, 0, h - 1, w, 1, '#1a100a');
  }, { key: 'env:homePaper' });
}

/** Ceiling plaster, 64 px = 2 m: a pale stipple with a faint tea-ring stain. */
export function plasterTex(tex: TexGen): THREE.Texture {
  return tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, '#a8a090');
    mottle(g, w, h, 0.3, 4242);
    for (let a = 0; a < 64; a++) { const t = (a / 64) * Math.PI * 2; px(g, Math.round(40 + Math.cos(t) * 9), Math.round(22 + Math.sin(t) * 7), 1, 1, 'rgba(110,90,60,0.35)'); }
  }, { key: 'env:plaster' });
}

// ── posters ─────────────────────────────────────────────────────────────────────────────────────
export const POSTER_COUNT = 4;
/** A wordless show poster (32 x 48, stretched once over its frame): 0 sevens, 1 the showgirl, 2 the dice, 3 the derby horse. */
export function posterTex(tex: TexGen, i: number): THREE.Texture {
  const k = ((i % POSTER_COUNT) + POSTER_COUNT) % POSTER_COUNT;
  return tex.canvas(32, 48, (g, w, h) => {
    const bg = ['#5a0c18', '#141a3a', '#0c3020', '#3a1a0a'][k];
    px(g, 0, 0, w, h, bg);
    for (let y = 0; y < h; y += 2) px(g, 0, y, w, 1, 'rgba(0,0,0,0.12)');
    px(g, 1, 1, w - 2, 1, '#c8a050'); px(g, 1, h - 2, w - 2, 1, '#c8a050'); px(g, 1, 1, 1, h - 2, '#c8a050'); px(g, w - 2, 1, 1, h - 2, '#c8a050');
    if (k === 0) {
      // three sevens over a star burst
      for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2; for (let r = 4; r < 14; r++) px(g, Math.round(16 + Math.cos(t) * r), Math.round(18 + Math.sin(t) * r), 1, 1, '#a8402a'); }
      for (const x0 of [5, 13, 21]) { px(g, x0, 14, 6, 2, '#ffd34a'); for (let y = 16; y < 25; y++) px(g, x0 + 4 - Math.floor((y - 16) / 3), y, 2, 1, '#ffd34a'); }
      for (let x = 4; x < 28; x += 3) px(g, x, 34, 2, 2, '#f0e0b0');
      px(g, 6, 39, 20, 3, '#c8a050');
    } else if (k === 1) {
      // a showgirl silhouette under a spotlight, a fan of plumes
      g.fillStyle = 'rgba(255,240,200,0.18)'; g.beginPath(); g.moveTo(16, 2); g.lineTo(4, 46); g.lineTo(28, 46); g.closePath(); g.fill();
      for (let a = -3; a <= 3; a++) for (let r = 0; r < 9; r++) px(g, Math.round(16 + a * r * 0.35), 12 - r, 1, 1, '#ff6aa8');
      px(g, 14, 12, 4, 4, '#100808'); px(g, 13, 16, 6, 9, '#100808'); px(g, 12, 25, 8, 4, '#100808');
      px(g, 13, 29, 2, 13, '#100808'); px(g, 17, 29, 2, 13, '#100808');
      for (let x = 3; x < 30; x += 4) px(g, x, 44, 2, 1, '#ffd34a');
    } else if (k === 2) {
      // two dice tumbling, chips below
      const die = (x: number, y: number, pips: Array<[number, number]>): void => { px(g, x, y, 10, 10, '#f0e8d0'); px(g, x, y + 9, 10, 1, '#b0a890'); for (const [a, b] of pips) px(g, x + a, y + b, 2, 2, '#a01020'); };
      die(5, 8, [[2, 2], [6, 6], [4, 4]]); die(16, 16, [[2, 2], [6, 2], [2, 6], [6, 6]]);
      for (const [x, c] of [[6, '#c01c28'], [13, '#2a60c0'], [20, '#e0e0e0']] as const) for (let s = 0; s < 4; s++) px(g, x, 38 - s * 2, 6, 2, s % 2 ? c : '#f0e8d0');
    } else {
      // the derby: a running horse silhouette over a floodlit track
      px(g, 0, 32, w, 16, '#5a3a1a'); for (let x = 0; x < w; x += 4) px(g, x, 32, 2, 1, '#e0d0a0');
      px(g, 8, 18, 14, 6, '#140a04'); px(g, 21, 13, 4, 7, '#140a04'); px(g, 24, 12, 4, 3, '#140a04');
      px(g, 9, 24, 2, 8, '#140a04'); px(g, 19, 24, 2, 7, '#140a04'); px(g, 5, 22, 2, 5, '#140a04'); px(g, 23, 23, 2, 6, '#140a04');
      px(g, 13, 15, 4, 3, '#c01c28');
      for (let x = 2; x < 30; x += 7) px(g, x, 4, 3, 2, '#fff2c0');
    }
  }, { key: `env:poster:${k}`, wrap: 'clamp' });
}

// ── identity: a Cyprus casino over a late-Soviet building (docs/ART.md "Identity") ──────────────────
/** A flat-woven kilim, 64 px = 2 m (tagged `tile` 2 so a rug maps it in metres): a madder field, stepped lozenges in a half-dropped lattice, hooked lines between. */
export type KilimTone = 'madder' | 'indigo';
const KILIM: Record<KilimTone, { field: string; a: string; b: string; ink: string; line: string }> = {
  madder: { field: '#8a2418', a: '#d8a850', b: '#1c3a5a', ink: '#2a1410', line: '#e8dcc0' },
  indigo: { field: '#1e2c4a', a: '#c8902e', b: '#8a2418', ink: '#0e1424', line: '#d8ccb0' },
};
export function kilimTex(tex: TexGen, tone: KilimTone = 'madder'): THREE.Texture {
  const c = KILIM[tone];
  const t = tex.canvas(64, 64, (g, w, h) => {
    px(g, 0, 0, w, h, c.field);
    const loz = (cx: number, cy: number, col: string): void => {
      for (let dy = -7; dy <= 7; dy++) {
        const half = (7 - Math.abs(dy)) & ~1;   // stepped by two: the woven look
        px(g, cx - half - 1, cy + dy, half * 2 + 2, 1, c.ink);
        if (half > 0) px(g, cx - half, cy + dy, half * 2, 1, col);
        if (half > 3) px(g, cx - half + 3, cy + dy, half * 2 - 6, 1, c.field);
      }
      px(g, cx - 1, cy - 1, 2, 2, c.line);
    };
    loz(16, 16, c.a); loz(48, 48, c.a); loz(48, 16, c.b); loz(16, 48, c.b);
    for (let y = 0; y < h; y += 4) { px(g, 31, y, 2, 2, c.line); px(g, 0, (y + 2) % h, 1, 1, c.ink); }
    for (let x = 0; x < w; x += 4) px(g, x, 31, 2, 2, c.line);
    mottle(g, w, h, 0.14, tone === 'madder' ? 611 : 617);
  }, { key: `env:kilim:${tone}` });
  if (t.userData.tile === undefined) t.userData.tile = 2;
  return t;
}

/** The wall carpet over the bed (48 x 40, stretched once): a deep red field, a cream border with a running hook, a central medallion, corner pieces. */
export function wallRugTex(tex: TexGen): THREE.Texture {
  return tex.canvas(48, 40, (g, w, h) => {
    px(g, 0, 0, w, h, '#5a1418');
    px(g, 1, 1, w - 2, h - 2, '#c8b890'); px(g, 4, 4, w - 8, h - 8, '#2a1018'); px(g, 5, 5, w - 10, h - 10, '#7a1c22');
    for (let x = 2; x < w - 2; x += 3) { px(g, x, 2, 1, 1, '#5a1418'); px(g, x + 1, h - 3, 1, 1, '#5a1418'); }
    for (let y = 2; y < h - 2; y += 3) { px(g, 2, y, 1, 1, '#5a1418'); px(g, w - 3, y + 1, 1, 1, '#5a1418'); }
    const cx = w / 2, cy = h / 2;
    for (let dy = -10; dy <= 10; dy++) {
      const half = Math.round((10 - Math.abs(dy)) * 1.4);
      px(g, cx - half, cy + dy, half * 2, 1, '#1c2a4a');
      if (half > 3) px(g, cx - half + 2, cy + dy, half * 2 - 4, 1, '#c89848');
      if (half > 7) px(g, cx - half + 5, cy + dy, half * 2 - 10, 1, '#7a1c22');
    }
    px(g, cx - 2, cy - 2, 4, 4, '#e8dcc0');
    for (const [x, y] of [[6, 6], [w - 12, 6], [6, h - 12], [w - 12, h - 12]]) { px(g, x, y, 6, 6, '#c89848'); px(g, x + 1, y + 1, 4, 4, '#1c2a4a'); }
    mottle(g, w, h, 0.16, 733);
  }, { key: 'env:wallRug', wrap: 'clamp' });
}

/** Constructivist posters left in the building (32 x 48): red, black and cream geometry; the bottom 12 rows are a cream band for the slogan plate. */
export const CONSTRUCT_COUNT = 3;
export function constructTex(tex: TexGen, i: number): THREE.Texture {
  const k = ((i % CONSTRUCT_COUNT) + CONSTRUCT_COUNT) % CONSTRUCT_COUNT;
  return tex.canvas(32, 48, (g, w, h) => {
    const RED = '#b8241c', INK = '#141010', CREAM = '#e4d6b4';
    const disc = (cx: number, cy: number, r: number, col: string): void => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) < r) px(g, x, y, 1, 1, col);
    };
    px(g, 0, 0, w, h, k === 1 ? INK : CREAM);
    if (k === 0) {
      // a red wedge driven into a black disc, a die riding the wedge
      disc(20, 14, 10, INK);
      for (let y = 4; y < 34; y++) { const x0 = Math.round(2 + (y - 4) * 0.55); px(g, x0, y, Math.max(1, 18 - Math.round((y - 4) * 0.55)), 1, RED); }
      px(g, 4, 26, 7, 7, CREAM); px(g, 5, 27, 2, 2, INK); px(g, 8, 30, 2, 2, INK);
    } else if (k === 1) {
      // red rays from a cream sun, a raised arm holding a gold coin
      for (let a = 0; a < 9; a++) { const t = -Math.PI + (a / 8) * Math.PI; for (let r = 7; r < 30; r++) px(g, Math.round(16 + Math.cos(t) * r), Math.round(30 + Math.sin(t) * r), 2, 1, a % 2 ? RED : '#5a1410'); }
      disc(16, 30, 6, CREAM);
      px(g, 14, 12, 4, 20, RED); px(g, 13, 8, 6, 5, '#d0a070');
      disc(16, 6, 3.5, '#d8a840');
    } else {
      // a black stair climbing to a red bar: the plan beaten
      for (let s = 0; s < 5; s++) px(g, 3 + s * 5, 32 - s * 5, 5, 4 + s * 5, INK);
      for (let y = 0; y < 8; y++) px(g, 2 + y, 6 + y, 26, 2, RED);
      px(g, 22, 22, 6, 6, RED);
    }
    px(g, 0, h - 12, w, 12, CREAM);
    px(g, 0, h - 12, w, 1, RED);
    mottle(g, w, h, 0.2, 811 + k);
    for (let y = 0; y < h; y++) if (hash01(y * 31 + k) < 0.06) px(g, 0, y, w, 1, 'rgba(255,240,210,0.08)');   // sun fade
  }, { key: `env:construct:${k}`, wrap: 'clamp' });
}

/** The Lobby mosaic (96 x 48, 3 px per smalt tile, stretched once over 3.2 x 1.6 m): a worker raising a die against a sunburst, a red star high left. */
export function mosaicTex(tex: TexGen): THREE.Texture {
  return tex.canvas(96, 48, (g) => {
    px(g, 0, 0, 96, 48, '#4a4238');                                        // grout
    const cell = (cx: number, cy: number): string => {
      const dx = cx - 16, dy = cy - 15;
      if (Math.abs(cx - 4) + Math.abs(cy - 3) < 3) return '#c8281c';                                // the star
      if (cx >= 13 && cx <= 18 && cy >= 2 && cy <= 6) return (cx === 14 && cy === 3) || (cx === 17 && cy === 5) ? '#141414' : '#ece4d0';   // the die
      if (cx >= 14 && cx <= 17 && cy >= 7 && cy <= 15) return cy < 9 ? '#d0a070' : '#b8441c';       // the worker: face, then the red shirt
      if ((cx === 13 || cx === 18) && cy >= 6 && cy <= 9) return '#d0a070';                         // the raised arms
      if (cy >= 13 && Math.abs(dx) < 6) return '#6a3a20';
      const a = Math.atan2(dy, dx), ray = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 18) % 2;
      return ray ? '#d8a840' : (Math.hypot(dx, dy) < 9 ? '#2a6aa8' : '#1c3e6a');
    };
    for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 32; cx++) {
      px(g, cx * 3, cy * 3, 2, 2, cell(cx, cy));
      const r = hash01(cx * 977 + cy * 131);
      if (r < 0.3) px(g, cx * 3, cy * 3, 2, 2, `rgba(0,0,0,${(0.08 + r * 0.3).toFixed(3)})`);
      else if (r > 0.85) px(g, cx * 3, cy * 3, 1, 1, 'rgba(255,250,230,0.25)');
      if (hash01(cx * 53 + cy * 4241) < 0.04) px(g, cx * 3, cy * 3, 2, 2, '#4a4238');           // a lost tile
    }
  }, { key: 'env:mosaic', wrap: 'clamp' });
}

/** A precast concrete panel (48 x 96 = 1.5 x 3 m, stretched once): board-marked grey, four tie holes, a rust run under one, a dark chamfer. */
export function concretePanelTex(tex: TexGen): THREE.Texture {
  return tex.canvas(48, 96, (g, w, h) => {
    px(g, 0, 0, w, h, '#8a8478');
    mottle(g, w, h, 0.3, 9001);
    for (let y = 6; y < h; y += 8) px(g, 1, y, w - 2, 1, 'rgba(40,36,30,0.18)');
    for (const [x, y] of [[10, 22], [38, 22], [10, 74], [38, 74]]) {
      px(g, x - 1, y - 1, 3, 3, '#3a3630');
      if (x === 38 && y === 22) for (let k = 0; k < 18; k++) px(g, x + (k > 9 ? 1 : 0), y + 2 + k, 1, 1, `rgba(120,60,24,${(0.45 - k * 0.02).toFixed(3)})`);
    }
    for (let x = 0; x < w; x++) if (hash01(x * 7 + 3) < 0.6) px(g, x, h - 6 + Math.floor(hash01(x * 13) * 3), 1, 6, 'rgba(30,26,20,0.2)');
    px(g, 0, 0, w, 1, '#4a4640'); px(g, 0, h - 1, w, 1, '#3a3630'); px(g, 0, 0, 1, h, '#4a4640'); px(g, w - 1, 0, 1, h, '#3a3630');
  }, { key: 'env:concretePanel', wrap: 'clamp' });
}

/** Smoked mirror tiles round a column shaft (64 x 32, wrapped once round the 8 faces): one 8 px panel per face, a pale streak, a dark seam. */
export function mirrorColumnTex(tex: TexGen): THREE.Texture {
  return tex.canvas(64, 32, (g, w, h) => {
    for (let y = 0; y < h; y++) px(g, 0, y, w, 1, rgb(34 + y, 38 + y * 0.8, 46 + y * 0.5));
    for (let f = 0; f < 8; f++) {
      px(g, f * 8, 0, 1, h, '#141a1e');
      for (let y = 0; y < h; y++) px(g, f * 8 + 2 + (Math.floor((y + f * 5) / 8) % 4), y, 1, 1, 'rgba(210,225,235,0.14)');
    }
    mottle(g, w, h, 0.12, 4747);
  }, { key: 'env:mirrorColumn' });
}

/** The cashier's exchange board rows: code, buy, sell. Codes and digits only, so the board needs no translation. */
export const RATES: ReadonlyArray<readonly [string, string, string]> = [['STG', '48.20', '48.90'], ['EUR', '38.10', '38.70'], ['USD', '34.30', '34.80'], ['TL', '1.00', '1.00']]; // i18n-ok: ISO-style currency codes, the same in every language
/** The exchange board's face (96 x 48, stretched once over 1 x 0.5 m): the RATES rows in amber on black, a dim rule under each. */
export function rateBoardTex(tex: TexGen): THREE.Texture {
  return tex.canvas(96, 48, (g, w) => {
    px(g, 0, 0, w, 48, '#0c0a08');
    RATES.forEach(([code, buy, sell], i) => {
      const y = 3 + i * 11;
      px(g, 1, y + 9, w - 2, 1, '#2a2218');
      tex.drawText(g, code, 3, y, { font: 'px5', color: '#ffd040' });
      tex.drawText(g, buy, 60, y, { font: 'px5', color: '#ff9a30', align: 'right' });
      tex.drawText(g, sell, 93, y, { font: 'px5', color: '#ff9a30', align: 'right' });
    });
  }, { key: 'env:rates', wrap: 'clamp' });
}

/** The kitchen calendar (32 x 48, stretched once): a harbour with a castle and two boats, a spiral, the year, a grid of days with one ringed in red. */
export function calendarTex(tex: TexGen): THREE.Texture {
  return tex.canvas(32, 48, (g, w) => {
    px(g, 0, 0, w, 48, '#ece4d0');
    px(g, 1, 3, w - 2, 18, '#7ab0d0'); px(g, 1, 14, w - 2, 7, '#2a5a8a');
    px(g, 3, 8, 9, 6, '#b89a6a'); px(g, 4, 6, 2, 2, '#b89a6a'); px(g, 9, 6, 2, 2, '#b89a6a');
    for (const x of [16, 23]) { px(g, x, 15, 5, 2, '#e8e0d0'); px(g, x + 2, 11, 1, 4, '#3a2a1a'); }
    for (let x = 2; x < w; x += 3) px(g, x, 0, 1, 2, '#3a3a3a');
    tex.drawText(g, '1989', w / 2, 23, { font: 'px5', color: '#a82418', align: 'center' });
    for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) px(g, 2 + c * 4, 32 + r * 3, 2, 1, c === 6 ? '#a82418' : '#4a4038');
    px(g, 9, 37, 5, 1, '#c8281c'); px(g, 9, 39, 5, 1, '#c8281c'); px(g, 9, 37, 1, 3, '#c8281c'); px(g, 13, 37, 1, 3, '#c8281c');
  }, { key: 'env:calendar', wrap: 'clamp' });
}

/** A crocheted doily (16 x 16, alpha-tested): rings of white thread with holes between the spokes. */
export function doilyTex(tex: TexGen): THREE.Texture {
  return tex.canvas(16, 16, (g) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d > 7.6) continue;
      const ring = Math.floor(d) % 3, spoke = Math.floor(((Math.atan2(y - 8, x - 8) + Math.PI) / (Math.PI * 2)) * 12) % 2;
      if (ring !== 1 || spoke) px(g, x, y, 1, 1, '#f2eee4');
    }
  }, { key: 'env:doily', wrap: 'clamp' });
}

/** The flat's stairwell wall (84 px = 2.6 m like the paper, floor to ceiling): green oil paint to 1.5 m under a brown line, chipped whitewash above. */
export function stairwellTex(tex: TexGen): THREE.Texture {
  return tex.canvas(84, 84, (g, w, h) => {
    const line = h - 49;                                                          // 1.5 m up
    px(g, 0, 0, w, line, '#b8b4a4');
    mottle(g, w, line, 0.22, 5151);
    px(g, 0, line, w, h - line, '#3e5a46');
    px(g, 0, line, w, 2, '#4a2e1c');
    for (let i = 0; i < 26; i++) {                                                // chips in the paint, the plaster showing
      const x = Math.floor(hash01(i * 71 + 1) * w), y = line + 3 + Math.floor(hash01(i * 37 + 9) * (h - line - 10));
      px(g, x, y, 1 + (i % 2), 1, '#8a8a78');
    }
    mottle(g, w, h, 0.1, 5153);
    px(g, 0, h - 4, w, 4, '#2a2018');
  }, { key: 'env:stairwell' });
}
