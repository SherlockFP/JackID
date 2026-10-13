/**
 * Scratch-Card Vendor — canvas painters (not pure: 2D contexts only, no three). Card faces are 128 × 192 px, the glass
 * designs 32 × 48 px per slot. Zone rectangles are the scratchable windows; the foil is a separate canvas that is
 * erased by `brush()` and composited over the face. Text uses the px5 bitmap font through `Text` (kit.tex.drawText).
 */
import { CARD_PRICE, CARD_ZONES, RARITY_RARE, RARITY_UNCOMMON, type Card } from './rules';

export const FACE_W = 128, FACE_H = 192;
export const DESIGN_W = 32, DESIGN_H = 48;

export interface Rect { x: number; y: number; w: number; h: number }
export interface Text {
  draw(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string): number;
  width(s: string): number;
}

const BG = ['#e6dec5', '#16452c', '#5a1019', '#0c0206', '#0c2a3d'];
const INK = ['#1f3a8a', '#f5e6a8', '#f7efde', '#c8102e', '#63e6de'];
const ACCENT = ['#c8102e', '#ffce5a', '#ffce5a', '#ff42a5', '#ffce5a'];
const RARE_COL = ['', '#c59c42', '#63e6de', '#ff42a5'];

/** Scratchable windows per card type (face coordinates). Count === CARD_ZONES[t]. */
export function zoneRects(t: number): Rect[] {
  if (t === 0) {                                             // 3 × 3 amounts
    const out: Rect[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push({ x: 8 + c * 39, y: 30 + r * 39, w: 34, h: 34 });
    return out;
  }
  if (t === 1) {                                             // 7 rungs, bottom → top
    return Array.from({ length: 7 }, (_, i) => ({ x: 20, y: 32 + (6 - i) * 19, w: 88, h: 16 }));
  }
  if (t === 2) {                                             // HOUSE + five YOUR rows
    return [{ x: 8, y: 30, w: 112, h: 34 }, ...Array.from({ length: 5 }, (_, i) => ({ x: 8, y: 70 + i * 21, w: 112, h: 18 }))];
  }
  if (t === 3) {                                             // 4 × 3 symbols + prize box
    const out: Rect[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out.push({ x: 10 + c * 28, y: 30 + r * 28, w: 24, h: 24 });
    out.push({ x: 14, y: 120, w: 100, h: 46 });
    return out;
  }
  return [{ x: 8, y: 34, w: 112, h: 58 }, { x: 8, y: 104, w: 112, h: 58 }];   // PRIZE, DEPTH
}

/** Sanity: the rect count matches the rules (checked by the machine in dev). */
export const zonesMatchRules = (t: number): boolean => zoneRects(t).length === CARD_ZONES[t];

/** Card face: background, title, price strip, the printed contents from `cells`, a charm badge. Painted once per card. */
export function paintFace(g: CanvasRenderingContext2D, card: Card, title: string, prize: (k: string) => string, tx: Text): void {
  const t = card.t;
  g.fillStyle = BG[t]; g.fillRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = INK[t]; g.fillRect(0, 22, FACE_W, 1);
  tx.draw(g, title, 6, 8, INK[t]);
  g.fillStyle = BG[t]; g.fillRect(0, 176, FACE_W, 16);
  g.fillStyle = INK[t]; g.fillRect(0, 175, FACE_W, 1);
  tx.draw(g, `${card.price}`, 6, 182, ACCENT[t]);
  if (card.charm) {
    g.fillStyle = RARE_COL[card.charm];
    g.fillRect(FACE_W - 14, 4, 10, 10);
    tx.draw(g, card.charm === RARITY_RARE ? 'R' : card.charm === RARITY_UNCOMMON ? 'U' : 'C', FACE_W - 12, 6, BG[t]);
  }
  const c = card.cells;
  if (t === 0) {
    zoneRects(0).forEach((r, i) => {
      g.fillStyle = '#fbf7ea'; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = INK[0]; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      const s = `${c[i]}`;
      tx.draw(g, s, r.x + (r.w - tx.width(s)) / 2, r.y + 14, INK[0]);
    });
  } else if (t === 1) {
    const r = c[0];
    zoneRects(1).forEach((z, i) => {
      const rung = i + 1;                                    // 1..7
      const climbed = rung <= r;
      g.fillStyle = climbed ? ACCENT[1] : '#0f2b1b'; g.fillRect(z.x, z.y, z.w, z.h);
      const m = rung >= 2 ? [1, 2, 4, 10, 50, 250][rung - 2] : 0;   // rung 2 → ×1 … rung 7 → ×250
      tx.draw(g, `${rung}`, 8, z.y + 5, INK[1]);
      if (m) tx.draw(g, `x${m}`, z.x + z.w - 4 - tx.width(`x${m}`), z.y + 5, climbed ? BG[1] : INK[1]);
      if (rung === r + 1 && r < 7) tx.draw(g, prize('snap'), 40, z.y + 5, ACCENT[3]);
    });
  } else if (t === 2) {
    const H = c[0];
    g.fillStyle = '#2a0a10'; g.fillRect(8, 30, 112, 34);
    tx.draw(g, `${prize('house')} ${H}`, 14, 42, INK[2]);
    for (let i = 0; i < 5; i++) {
      const Y = c[1 + 2 * i], L = c[2 + 2 * i];
      const z = zoneRects(2)[i + 1];
      g.fillStyle = Y > H ? '#7a1424' : '#2a0a10'; g.fillRect(z.x, z.y, z.w, z.h);
      tx.draw(g, `${prize('yours')} ${Y}`, z.x + 4, z.y + 5, INK[2]);
      tx.draw(g, `x${L}`, z.x + z.w - 4 - tx.width(`x${L}`), z.y + 5, ACCENT[2]);
    }
  } else if (t === 3) {
    const sym = ['sym_bat', 'sym_owl', 'sym_skull'];
    for (let i = 0; i < 12; i++) {
      const z = zoneRects(3)[i];
      g.fillStyle = '#1b0508'; g.fillRect(z.x, z.y, z.w, z.h);
      const s = c[i];
      if (s === 0) { g.fillStyle = ACCENT[3]; g.beginPath(); g.arc(z.x + 12, z.y + 12, 8, 0, Math.PI * 2); g.fill(); }
      else if (s === 4) { g.fillStyle = '#c8102e'; g.beginPath(); g.arc(z.x + 12, z.y + 12, 9, 0, Math.PI * 2); g.fill(); tx.draw(g, prize('sym_blood').slice(0, 1), z.x + 9, z.y + 9, '#fbf7ea'); }
      else tx.draw(g, prize(sym[s - 1]).slice(0, 1), z.x + 9, z.y + 9, INK[3]);
    }
    const box = zoneRects(3)[12];
    g.fillStyle = '#1b0508'; g.fillRect(box.x, box.y, box.w, box.h);
    g.strokeStyle = ACCENT[3]; g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    const mult = c[12];
    const s = mult > 0 ? `x${mult}` : '--';
    tx.draw(g, s, box.x + (box.w - tx.width(s)) / 2, box.y + 18, mult > 0 ? ACCENT[3] : INK[3]);
  } else {
    const [p, d] = c;
    const [pz, dz] = zoneRects(4);
    g.fillStyle = '#06202e'; g.fillRect(pz.x, pz.y, pz.w, pz.h); g.fillRect(dz.x, dz.y, dz.w, dz.h);
    const ps = p > 0 ? `x${p}` : prize('sunk');
    tx.draw(g, prize('prize'), pz.x + 6, pz.y + 6, INK[4]);
    tx.draw(g, ps, pz.x + (pz.w - tx.width(ps)) / 2, pz.y + 30, p > 0 ? ACCENT[4] : INK[4]);
    tx.draw(g, prize('depth'), dz.x + 6, dz.y + 6, INK[4]);
    const ds = `x${d}`;
    tx.draw(g, ds, dz.x + (dz.w - tx.width(ds)) / 2, dz.y + 30, ACCENT[4]);
  }
}

/** Foil: opaque silver over every zone, with a fixed speckle (deterministic: all peers see the same foil). */
export function paintFoil(g: CanvasRenderingContext2D, t: number): void {
  g.clearRect(0, 0, FACE_W, FACE_H);
  let s = 0x9e3779b9 ^ (t * 7919);
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (const z of zoneRects(t)) {
    g.fillStyle = '#9ea4ab'; g.fillRect(z.x, z.y, z.w, z.h);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = rnd() < 0.5 ? '#c4c9cf' : '#7d838a';
      g.fillRect(z.x + Math.floor(rnd() * z.w), z.y + Math.floor(rnd() * z.h), 1, 1);
    }
  }
}

/** One scratch stamp at (x, y): a fixed jagged 6 px-radius star, erased from the foil (destination-out). */
const STAR: ReadonlyArray<[number, number]> = [[6, 0], [2, 2], [4, 5], [0, 3], [-4, 5], [-2, 1], [-6, -1], [-2, -2], [-3, -5], [1, -3], [3, -6], [3, -2]];
export function brush(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.beginPath();
  STAR.forEach(([dx, dy], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
  g.closePath(); g.fill();
  g.restore();
}

/** Fraction of cleared (alpha 0) pixels inside a zone of the foil canvas. */
export function clearedFraction(g: CanvasRenderingContext2D, z: Rect): number {
  const d = g.getImageData(z.x, z.y, z.w, z.h).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
  return clear / (z.w * z.h);
}

/** Glass-front design plaque (32 × 48): tinted panel, big price, tiny rarity pips. One slot of the designs strip. */
export function paintDesign(g: CanvasRenderingContext2D, t: number, ox: number, tx: Text): void {
  g.fillStyle = BG[t]; g.fillRect(ox, 0, DESIGN_W, DESIGN_H);
  g.strokeStyle = ACCENT[t]; g.strokeRect(ox + 0.5, 0.5, DESIGN_W - 1, DESIGN_H - 1);
  g.fillStyle = INK[t]; g.fillRect(ox + 4, 6, DESIGN_W - 8, 1);
  const s = `${CARD_PRICE[t]}`;
  tx.draw(g, s, ox + (DESIGN_W - tx.width(s)) / 2, 18, ACCENT[t]);
  for (let k = 0; k <= t; k++) { g.fillStyle = ACCENT[t]; g.fillRect(ox + 5 + k * 5, 36, 3, 3); }
}
