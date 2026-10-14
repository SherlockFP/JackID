/**
 * Procedural anime portraits (256 x 384, canvas). Each portrait is built from a spec: jaw, head scale and tilt, shoulder
 * width, line weight, hair preset, eye / brow / mouth / nose styles, an outfit, accessories, a background motif and a
 * palette (ink, paper, one accent, coat). Five expressions (calm, smirk, shock, rage, hollow) move the lids, brows and
 * mouth. Shading is hatch lines on the shadow side and a halftone fade on the coat and halo. Results are cached per
 * rival and expression.
 *
 * The canvas returned by `portrait()` is shared: draw it, never append it. `portraitSrc()` gives a data URL for <img>.
 */

export type Expr = 'calm' | 'smirk' | 'shock' | 'rage' | 'hollow';
export const EXPRESSIONS: readonly Expr[] = ['calm', 'smirk', 'shock', 'rage', 'hollow'];

export type HairStyle = 'bob' | 'buzz' | 'swept' | 'messy' | 'slick' | 'hood' | 'bun' | 'combed';
export type EyeStyle = 'closed' | 'wide' | 'predator' | 'round' | 'hollow' | 'tired' | 'plain' | 'masked' | 'blank';
export type MouthStyle = 'soft' | 'grin' | 'thin' | 'flat' | 'fang' | 'laugh' | 'smile' | 'small';
export type JawStyle = 'oval' | 'soft' | 'sharp' | 'square' | 'long' | 'round';
export type NoseStyle = 'small' | 'big' | 'sharp';
export type BgStyle = 'burst' | 'circus' | 'tiles' | 'steam' | 'dots' | 'ledger' | 'rain' | 'seal' | 'cards';
export type OutfitStyle = 'suit' | 'ringmaster' | 'jacket' | 'preacher' | 'patchcoat' | 'tailcoat' | 'raincoat' | 'robe' | 'clerk';
export type BrowKind = 'arch' | 'sharp' | 'flat' | 'droop' | 'none';
export type Accessory =
  | 'gloves' | 'gauge' | 'watch' | 'key' | 'reels' | 'seal' | 'ledger' | 'mask' | 'spectacles'
  | 'goggles' | 'hairclip' | 'ribbon' | 'sideburns' | 'stubble' | 'bags' | 'hollowcheeks' | 'freckles' | 'blush'
  | 'tag' | 'epaulettes' | 'rainfx' | 'blankcard';

export interface PortraitSpec {
  hair: HairStyle;
  hairColor: string;
  skin: string;
  eyes: EyeStyle;
  mouth: MouthStyle;
  accessories: Accessory[];
  soot?: boolean;
  jaw: JawStyle;
  nose: NoseStyle;
  /** Head scale about (128, 150): [x, y]. */
  head: [number, number];
  /** Head tilt in radians about the neck base. */
  tilt: number;
  /** Shoulder half-width multiplier. */
  shoulders: number;
  /** Neck width multiplier. */
  neck: number;
  /** Outline weight multiplier. */
  line: number;
  /** Eyelash flick 0..1. */
  lash: number;
  brow: { kind: BrowKind; w: number };
  bg: BgStyle;
  outfit: OutfitStyle;
  palette: { ink: string; paper: string; accent: string; coat: string };
}

const SPECS: Record<string, PortraitSpec> = {
  // Silver bob with blunt fringe, white gloves clasped in front, jade accent. Eyes stay closed (a ^ ^ smile) until she is surprised.
  tamsin: {
    hair: 'bob', hairColor: '#d3d7e2', skin: '#f6e9de', eyes: 'closed', mouth: 'smile',
    accessories: ['gloves', 'hairclip', 'blush'],
    jaw: 'soft', nose: 'small', head: [0.93, 0.98], tilt: 0.045, shoulders: 0.86, neck: 0.8, line: 0.78, lash: 1,
    brow: { kind: 'arch', w: 2.4 }, bg: 'tiles', outfit: 'jacket',
    palette: { ink: '#1b1a28', paper: '#eef3ee', accent: '#2aa57c', coat: '#2f4a45' },
  },
  // Huge: wide square head, thick neck, shoulders off the frame, goggles on a buzz cut, soot, rolled sleeves, chest gauge.
  kuro: {
    hair: 'buzz', hairColor: '#2a2420', skin: '#c28d6a', eyes: 'wide', mouth: 'laugh',
    accessories: ['gauge', 'goggles', 'stubble'], soot: true,
    jaw: 'square', nose: 'big', head: [1.2, 1.04], tilt: 0, shoulders: 1.5, neck: 1.6, line: 1.4, lash: 0,
    brow: { kind: 'sharp', w: 7.5 }, bg: 'steam', outfit: 'preacher',
    palette: { ink: '#140f0c', paper: '#f1e3cb', accent: '#e0842a', coat: '#46342a' },
  },
  // Male ringmaster: tall stand collar, red facings, gold epaulettes, back-swept black hair, sharp jaw and grin, the right
  // pupil far too wide, a cracked pocket watch on a chain.
  lucan: {
    hair: 'swept', hairColor: '#17141c', skin: '#ead6c4', eyes: 'predator', mouth: 'fang',
    accessories: ['watch', 'sideburns', 'epaulettes'],
    jaw: 'sharp', nose: 'sharp', head: [0.95, 1.08], tilt: -0.035, shoulders: 1.02, neck: 0.95, line: 1.12, lash: 0.2,
    brow: { kind: 'sharp', w: 5 }, bg: 'circus', outfit: 'ringmaster',
    palette: { ink: '#0d0b11', paper: '#f6ecdc', accent: '#d12a3c', coat: '#1b1620' },
  },
  // Lighter and younger: oversized patched coat, wide innocent sparkly eyes, freckles, tag on the lapel.
  mimosa: {
    hair: 'messy', hairColor: '#7a5632', skin: '#f2d2b2', eyes: 'round', mouth: 'small',
    accessories: ['freckles', 'ribbon', 'tag'],
    jaw: 'round', nose: 'small', head: [1.04, 0.98], tilt: -0.075, shoulders: 1.3, neck: 0.8, line: 0.92, lash: 1,
    brow: { kind: 'arch', w: 2.8 }, bg: 'dots', outfit: 'patchcoat',
    palette: { ink: '#1a140d', paper: '#fbf3d2', accent: '#f0c92a', coat: '#d9c590' },
  },
  // Gaunt, grey, hollow sockets, tired: tailcoat, wing collar, the Manager's Key hanging on a chain.
  orrin: {
    hair: 'combed', hairColor: '#9b9ca4', skin: '#d6c0ae', eyes: 'hollow', mouth: 'thin',
    accessories: ['key', 'bags', 'hollowcheeks', 'sideburns'],
    jaw: 'long', nose: 'sharp', head: [0.93, 1.04], tilt: 0.055, shoulders: 0.92, neck: 0.9, line: 1, lash: 0,
    brow: { kind: 'droop', w: 3.2 }, bg: 'ledger', outfit: 'tailcoat',
    palette: { ink: '#0e0f13', paper: '#e8e5dc', accent: '#d1a64a', coat: '#4b4e58' },
  },
  // Rain hood and coat, tape reels on straps, half-lidded eyes, pure greyscale with rain and film perforations.
  vell: {
    hair: 'hood', hairColor: '#3a3c40', skin: '#cfcfcc', eyes: 'tired', mouth: 'flat',
    accessories: ['reels', 'bags', 'rainfx'],
    jaw: 'oval', nose: 'small', head: [1, 1], tilt: 0.06, shoulders: 1.12, neck: 1, line: 1.15, lash: 0.3,
    brow: { kind: 'flat', w: 3 }, bg: 'rain', outfit: 'raincoat',
    palette: { ink: '#09090a', paper: '#d9d9d6', accent: '#9a9a9a', coat: '#6c6f72' },
  },
  // Full porcelain mask, only slits show; a wax seal on the brow and a big one on the chest.
  notary: {
    hair: 'slick', hairColor: '#14121a', skin: '#e6d1bc', eyes: 'masked', mouth: 'thin',
    accessories: ['mask', 'seal'],
    jaw: 'oval', nose: 'small', head: [0.98, 1.02], tilt: 0, shoulders: 1.05, neck: 1, line: 1.1, lash: 0,
    brow: { kind: 'none', w: 0 }, bg: 'seal', outfit: 'robe',
    palette: { ink: '#080a16', paper: '#ece5d6', accent: '#a3202f', coat: '#1a1e36' },
  },
  // A blank face card where the face should be; hair in a bun, waistcoat, ledger held open.
  clerk: {
    hair: 'bun', hairColor: '#5a3f2e', skin: '#f2dcc8', eyes: 'blank', mouth: 'soft',
    accessories: ['ledger', 'blankcard'],
    jaw: 'oval', nose: 'small', head: [1, 1], tilt: 0.03, shoulders: 0.98, neck: 1, line: 1, lash: 0,
    brow: { kind: 'none', w: 0 }, bg: 'cards', outfit: 'clerk',
    palette: { ink: '#111418', paper: '#f3f0e8', accent: '#3a6ea5', coat: '#34445a' },
  },
  // The player: a debtor in a cheap suit.
  you: {
    hair: 'slick', hairColor: '#4a3626', skin: '#eccaa9', eyes: 'plain', mouth: 'flat', accessories: [],
    jaw: 'oval', nose: 'small', head: [1, 1], tilt: 0, shoulders: 1, neck: 1, line: 1, lash: 0.4,
    brow: { kind: 'arch', w: 4.2 }, bg: 'burst', outfit: 'suit',
    palette: { ink: '#15120e', paper: '#f1ead9', accent: '#7b5a3a', coat: '#4d4740' },
  },
};

const PLAIN: PortraitSpec = SPECS.you;

/** Spec ids the bench and the dialogue use. Unknown ids fall back to the plain Mark. */
export const PORTRAIT_IDS: readonly string[] = ['tamsin', 'kuro', 'lucan', 'mimosa', 'orrin', 'vell', 'notary', 'clerk', 'you'];
export function portraitSpec(id: string): PortraitSpec { return SPECS[id] ?? PLAIN; }

export const PW = 256;
export const PH = 384;
type Ctx = CanvasRenderingContext2D;

const GOLD = '#d9b24a';

// ── small helpers ──────────────────────────────────────────────────────────────────────────────
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const has = (p: PortraitSpec, a: Accessory): boolean => p.accessories.includes(a);

/** Diagonal hatch lines across the whole canvas; the caller clips to the shape. */
function hatch(x: Ctx, gap: number, color: string, alpha: number, width: number): void {
  x.save();
  x.strokeStyle = color; x.globalAlpha = alpha; x.lineWidth = width; x.lineCap = 'butt';
  x.beginPath();
  for (let k = -PH; k < PW + PH; k += gap) { x.moveTo(k, 0); x.lineTo(k + PH, PH); }
  x.stroke();
  x.restore();
}

/** Halftone dots on a staggered grid; `r(x, y)` gives each dot's radius (<= 0 skips it). */
function dots(x: Ctx, step: number, color: string, alpha: number, r: (px: number, py: number) => number): void {
  x.save();
  x.fillStyle = color; x.globalAlpha = alpha;
  let row = 0;
  for (let py = step / 2; py < PH; py += step / 2 * 1.732, row++) {
    for (let px = (row % 2) * step / 2 + step / 2; px < PW; px += step) {
      const rad = r(px, py);
      if (rad <= 0.15) continue;
      x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
    }
  }
  x.restore();
}

function rrect(x: Ctx, l: number, t: number, w: number, h: number, rad: number): void {
  x.beginPath();
  x.moveTo(l + rad, t);
  x.arcTo(l + w, t, l + w, t + h, rad);
  x.arcTo(l + w, t + h, l, t + h, rad);
  x.arcTo(l, t + h, l, t, rad);
  x.arcTo(l, t, l + w, t, rad);
  x.closePath();
}

function poly(x: Ctx, pts: ReadonlyArray<readonly [number, number]>): void {
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.closePath();
}

/** Fill then ink-stroke the current path. */
function fillStroke(x: Ctx, fill: string, ink: string, lw: number): void {
  x.fillStyle = fill; x.fill(); x.lineWidth = lw; x.strokeStyle = ink; x.stroke();
}

function mirrored(fn: (s: number) => void): void { fn(-1); fn(1); }

function star(x: Ctx, cx: number, cy: number, r: number): void {
  x.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.closePath();
}

/** Body shapes are drawn about the centre line so the shoulder width scales them. */
function bodySpace(x: Ctx, s: number, fn: () => void): void {
  x.save(); x.translate(128, 0); x.scale(s, 1); x.translate(-128, 0); fn(); x.restore();
}

/** Head shapes are drawn with the head scale and tilt applied. */
function headSpace(x: Ctx, p: PortraitSpec, fn: () => void): void {
  x.save();
  x.translate(0, 10);
  x.translate(128, 232); x.rotate(p.tilt); x.translate(-128, -232);
  x.translate(128, 150); x.scale(p.head[0], p.head[1]); x.translate(-128, -150);
  fn();
  x.restore();
}

// ── face shapes ────────────────────────────────────────────────────────────────────────────────
function faceOutline(x: Ctx, jaw: JawStyle): void {
  x.beginPath();
  switch (jaw) {
    case 'sharp':
      x.moveTo(128, 84);
      x.bezierCurveTo(176, 84, 181, 126, 177, 158);
      x.quadraticCurveTo(174, 186, 160, 206);
      x.lineTo(128, 232); x.lineTo(96, 206);
      x.quadraticCurveTo(82, 186, 79, 158);
      x.bezierCurveTo(75, 126, 80, 84, 128, 84);
      break;
    case 'square':
      x.moveTo(128, 84);
      x.bezierCurveTo(178, 84, 184, 126, 182, 160);
      x.lineTo(180, 198);
      x.quadraticCurveTo(176, 226, 148, 228); x.lineTo(108, 228);
      x.quadraticCurveTo(80, 226, 76, 198);
      x.lineTo(74, 160);
      x.bezierCurveTo(72, 126, 78, 84, 128, 84);
      break;
    case 'long':
      x.moveTo(128, 82);
      x.bezierCurveTo(174, 82, 178, 128, 174, 162);
      x.bezierCurveTo(172, 202, 150, 238, 128, 248);
      x.bezierCurveTo(106, 238, 84, 202, 82, 162);
      x.bezierCurveTo(78, 128, 82, 82, 128, 82);
      break;
    case 'round':
      x.moveTo(128, 86);
      x.bezierCurveTo(182, 86, 188, 134, 181, 166);
      x.bezierCurveTo(174, 204, 154, 222, 128, 224);
      x.bezierCurveTo(102, 222, 82, 204, 75, 166);
      x.bezierCurveTo(68, 134, 74, 86, 128, 86);
      break;
    case 'soft':
      x.moveTo(128, 84);
      x.bezierCurveTo(172, 84, 177, 128, 173, 158);
      x.bezierCurveTo(169, 192, 150, 217, 128, 221);
      x.bezierCurveTo(106, 217, 87, 192, 83, 158);
      x.bezierCurveTo(79, 128, 84, 84, 128, 84);
      break;
    default:
      x.moveTo(128, 84);
      x.bezierCurveTo(176, 84, 181, 128, 177, 160);
      x.bezierCurveTo(173, 196, 152, 220, 128, 224);
      x.bezierCurveTo(104, 220, 83, 196, 79, 160);
      x.bezierCurveTo(75, 128, 80, 84, 128, 84);
  }
  x.closePath();
}

const EAR_X: Record<JawStyle, number> = { oval: 50, soft: 46, sharp: 49, square: 55, long: 47, round: 53 };

function bodyOutline(x: Ctx): void {
  x.beginPath();
  x.moveTo(26, PH);
  x.bezierCurveTo(30, 318, 58, 286, 96, 272);
  x.lineTo(112, 266);
  x.lineTo(144, 266);
  x.lineTo(160, 272);
  x.bezierCurveTo(198, 286, 226, 318, 230, PH);
  x.closePath();
}

// ── backgrounds ────────────────────────────────────────────────────────────────────────────────
function rays(x: Ctx, color: string, alpha: number, n: number, rnd: () => number, r0 = 118, lw = 1.4): void {
  x.save(); x.strokeStyle = color; x.globalAlpha = alpha; x.lineWidth = lw;
  x.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.05;
    const q = r0 + rnd() * 10;
    x.moveTo(128 + Math.cos(a) * q, 150 + Math.sin(a) * q);
    x.lineTo(128 + Math.cos(a) * 420, 150 + Math.sin(a) * 420);
  }
  x.stroke(); x.restore();
}

function halo(x: Ctx, fill: string, ring: string, alpha = 1, r = 102): void {
  x.beginPath(); x.arc(128, 150, r, 0, Math.PI * 2);
  x.globalAlpha = alpha; x.fillStyle = fill; x.fill(); x.globalAlpha = 1;
  x.beginPath(); x.arc(128, 150, r, 0, Math.PI * 2);
  x.strokeStyle = ring; x.lineWidth = 3; x.stroke();
}

function haloDots(x: Ctx, ink: string, r = 102): void {
  dots(x, 6, ink, 0.32, (px, py) => {
    const d = Math.hypot(px - 128, py - 150);
    return d > r && d < r + 26 ? 2.6 * (1 - (d - r) / 26) : 0;
  });
}

function tile(x: Ctx, cx: number, cy: number, rot: number, ink: string, jade: string, pips: number): void {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  rrect(x, -15, -21, 30, 42, 5); fillStroke(x, '#f7f5ee', ink, 2.4);
  x.fillStyle = jade; x.fillRect(-15, 6, 30, 15);
  rrect(x, -15, -21, 30, 42, 5); x.stroke();
  x.fillStyle = jade;
  for (let i = 0; i < pips; i++) { x.beginPath(); x.arc(-6 + (i % 2) * 12, -12 + Math.floor(i / 2) * 9, 3, 0, Math.PI * 2); x.fill(); x.lineWidth = 1; x.stroke(); }
  x.restore();
}

function background(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper, accent } = p.palette;
  x.fillStyle = paper; x.fillRect(0, 0, PW, PH);
  switch (p.bg) {
    case 'circus': {
      // Big-top sunburst in two reds, bunting along the top, a cream spotlight behind the head.
      const n = 22;
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        x.beginPath(); x.moveTo(128, 150); x.lineTo(128 + Math.cos(a0) * 520, 150 + Math.sin(a0) * 520);
        x.lineTo(128 + Math.cos(a1) * 520, 150 + Math.sin(a1) * 520); x.closePath();
        x.fillStyle = accent; x.globalAlpha = 0.92; x.fill(); x.globalAlpha = 1;
      }
      x.save(); x.globalAlpha = 0.28; x.fillStyle = ink;
      for (let i = 1; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        x.beginPath(); x.moveTo(128, 150); x.lineTo(128 + Math.cos(a0) * 520, 150 + Math.sin(a0) * 520);
        x.lineTo(128 + Math.cos(a1) * 520, 150 + Math.sin(a1) * 520); x.closePath(); x.fill();
      }
      x.restore();
      for (let k = 0; k < 8; k++) {
        x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32 + 32, 0); x.lineTo(k * 32 + 16, 26); x.closePath();
        fillStroke(x, k % 2 ? paper : GOLD, ink, 2.2);
      }
      halo(x, paper, ink, 1, 104);
      x.beginPath(); x.arc(128, 150, 94, 0, Math.PI * 2); x.setLineDash([2, 6]); x.lineWidth = 2; x.strokeStyle = accent; x.stroke(); x.setLineDash([]);
      haloDots(x, ink, 104);
      break;
    }
    case 'tiles': {
      for (let r = 120; r < 330; r += 26) {
        x.beginPath(); x.arc(128, 150, r, 0, Math.PI * 2); x.strokeStyle = accent; x.globalAlpha = 0.28; x.lineWidth = 2; x.stroke(); x.globalAlpha = 1;
      }
      tile(x, 34, 58, -0.35, ink, accent, 4); tile(x, 224, 70, 0.3, ink, accent, 3);
      tile(x, 30, 240, 0.28, ink, accent, 2); tile(x, 226, 258, -0.22, ink, accent, 6);
      tile(x, 206, 24, 0.12, ink, accent, 1);
      halo(x, accent, ink, 0.9); x.beginPath(); x.arc(128, 150, 94, 0, Math.PI * 2); x.strokeStyle = paper; x.lineWidth = 2; x.stroke();
      haloDots(x, ink);
      break;
    }
    case 'steam': {
      x.fillStyle = accent; x.fillRect(0, 0, PW, PH);
      rays(x, ink, 0.18, 36, rnd, 90, 2.4);
      // Pipes down the left, rivets, puffs of steam.
      for (const py of [214, 258, 300]) {
        x.fillStyle = '#7d4a1c'; x.fillRect(0, py, 70, 20); x.lineWidth = 3; x.strokeStyle = ink; x.strokeRect(0, py, 70, 20);
        x.fillStyle = paper; for (let rx = 10; rx < 70; rx += 20) { x.beginPath(); x.arc(rx, py + 10, 2.6, 0, Math.PI * 2); x.fill(); }
      }
      for (const [cx, cy, r] of [[218, 70, 30], [196, 46, 22], [236, 108, 24], [40, 70, 26], [66, 44, 18], [24, 122, 20]] as const) {
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); fillStroke(x, paper, ink, 3);
      }
      halo(x, '#2b1c12', accent, 0.9); x.beginPath(); x.arc(128, 150, 96, 0, Math.PI * 2); x.strokeStyle = paper; x.lineWidth = 2.4; x.stroke();
      haloDots(x, ink);
      break;
    }
    case 'dots': {
      x.fillStyle = paper; x.fillRect(0, 0, PW, PH);
      x.fillStyle = accent; x.globalAlpha = 0.7;
      for (let r = 0, py = 8; py < PH + 30; py += 34, r++) {
        for (let px = (r % 2) * 22 - 6; px < PW + 30; px += 44) { x.beginPath(); x.arc(px, py, 13, 0, Math.PI * 2); x.fill(); }
      }
      x.globalAlpha = 1;
      for (const [cx, cy, rot, label] of [[36, 74, -0.4, '?'], [222, 96, 0.35, '?'], [34, 232, 0.3, '?'], [224, 250, -0.3, '?']] as const) {
        x.save(); x.translate(cx, cy); x.rotate(rot);
        rrect(x, -14, -19, 28, 38, 4); fillStroke(x, '#fffdf2', ink, 2.4);
        x.beginPath(); x.arc(0, -12, 2.4, 0, Math.PI * 2); x.stroke();
        x.fillStyle = ink; x.font = 'bold 20px Arial, sans-serif'; x.textAlign = 'center'; x.fillText(label, 0, 10);
        x.restore();
      }
      halo(x, '#fffdf2', ink, 1); x.beginPath(); x.arc(128, 150, 94, 0, Math.PI * 2); x.strokeStyle = accent; x.lineWidth = 4; x.stroke();
      haloDots(x, ink);
      break;
    }
    case 'ledger': {
      x.fillStyle = '#16171c'; x.fillRect(0, 0, PW, PH);
      x.strokeStyle = accent; x.globalAlpha = 0.2; x.lineWidth = 1.2;
      x.beginPath(); for (let py = 10; py < PH; py += 14) { x.moveTo(0, py); x.lineTo(PW, py); } x.stroke();
      x.globalAlpha = 0.5; x.lineWidth = 2;
      x.beginPath(); x.moveTo(30, 0); x.lineTo(30, PH); x.moveTo(36, 0); x.lineTo(36, PH); x.moveTo(222, 0); x.lineTo(222, PH); x.stroke();
      x.globalAlpha = 1;
      x.strokeStyle = accent; x.lineWidth = 2;
      x.beginPath(); for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? 112 : 106; x.moveTo(128 + Math.cos(a) * r0, 150 + Math.sin(a) * r0); x.lineTo(128 + Math.cos(a) * 118, 150 + Math.sin(a) * 118); } x.stroke();
      halo(x, '#2b2d36', accent, 1, 100);
      x.beginPath(); x.arc(128, 150, 92, 0, Math.PI * 2); x.strokeStyle = accent; x.globalAlpha = 0.5; x.lineWidth = 1.4; x.stroke(); x.globalAlpha = 1;
      break;
    }
    case 'rain': {
      const g = x.createLinearGradient(0, 0, 0, PH);
      g.addColorStop(0, '#a4a6a8'); g.addColorStop(1, '#4a4c4f');
      x.fillStyle = g; x.fillRect(0, 0, PW, PH);
      halo(x, '#e4e4e1', ink, 0.95, 98);
      // Film-strip edges with perforations.
      x.fillStyle = ink; x.fillRect(0, 0, 20, PH); x.fillRect(PW - 20, 0, 20, PH);
      x.fillStyle = paper;
      for (let py = 8; py < PH; py += 26) { rrect(x, 6, py, 9, 13, 2); x.fill(); rrect(x, PW - 15, py, 9, 13, 2); x.fill(); }
      x.save(); x.strokeStyle = paper; x.lineWidth = 1.4; x.globalAlpha = 0.5; x.beginPath();
      for (let i = 0; i < 70; i++) { const rx = 22 + rnd() * 212, ry = rnd() * PH, len = 16 + rnd() * 26; x.moveTo(rx, ry); x.lineTo(rx - len * 0.3, ry + len); }
      x.stroke(); x.restore();
      break;
    }
    case 'seal': {
      x.fillStyle = paper; x.fillRect(0, 0, PW, PH);
      x.save(); x.strokeStyle = ink; x.globalAlpha = 0.07; x.lineWidth = 1.2;
      x.beginPath(); for (let k = -PH; k < PW + PH; k += 12) { x.moveTo(k, 0); x.lineTo(k + PH, PH); x.moveTo(k + PH, 0); x.lineTo(k, PH); } x.stroke(); x.restore();
      // Scalloped wax disc as the halo, with a ring of tick marks.
      x.beginPath();
      for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; x.arc(128 + Math.cos(a) * 100, 150 + Math.sin(a) * 100, 15, 0, Math.PI * 2); }
      x.fillStyle = accent; x.fill();
      x.beginPath(); x.arc(128, 150, 100, 0, Math.PI * 2); fillStroke(x, accent, ink, 3);
      x.beginPath(); x.arc(128, 150, 88, 0, Math.PI * 2); x.setLineDash([3, 5]); x.lineWidth = 2; x.strokeStyle = paper; x.stroke(); x.setLineDash([]);
      x.beginPath(); x.arc(128, 150, 76, 0, Math.PI * 2); x.lineWidth = 1.4; x.stroke();
      break;
    }
    case 'cards': {
      x.strokeStyle = accent; x.globalAlpha = 0.2; x.lineWidth = 1;
      x.beginPath(); for (let k = 0; k <= PW; k += 16) { x.moveTo(k, 0); x.lineTo(k, PH); } for (let k = 0; k <= PH; k += 16) { x.moveTo(0, k); x.lineTo(PW, k); } x.stroke(); x.globalAlpha = 1;
      for (const [rot, dx] of [[-0.09, -10], [0.07, 12], [-0.02, 0]] as const) {
        x.save(); x.translate(128 + dx, 150); x.rotate(rot);
        rrect(x, -98, -122, 196, 244, 6); fillStroke(x, '#fdfcf8', ink, 2.6);
        x.restore();
      }
      x.save(); x.translate(128, 150);
      x.fillStyle = '#c0392b'; x.fillRect(-98, -96, 196, 2.6);
      x.strokeStyle = accent; x.globalAlpha = 0.3; x.lineWidth = 1; x.beginPath();
      for (let ly = -76; ly < 110; ly += 18) { x.moveTo(-98, ly); x.lineTo(98, ly); } x.stroke();
      x.restore(); x.globalAlpha = 1;
      break;
    }
    default: {
      rays(x, ink, 0.11, 44, rnd, 118, 1.4);
      halo(x, accent, ink, 0.9);
      haloDots(x, ink);
    }
  }
}

// ── body ───────────────────────────────────────────────────────────────────────────────────────
function bodyBack(x: Ctx, p: PortraitSpec): void {
  const { ink, accent, coat, paper } = p.palette;
  const s = p.shoulders;
  bodySpace(x, s, () => {
    switch (p.outfit) {
      case 'ringmaster':
        // Tall stiff stand collar flaring past the jaw, red piping on the edge.
        mirrored((m) => {
          poly(x, [[128 + m * 18, 268], [128 + m * 44, 204], [128 + m * 66, 168], [128 + m * 76, 190], [128 + m * 86, 284]]);
          fillStroke(x, coat, ink, 3.2);
          x.beginPath(); x.moveTo(128 + m * 66, 168); x.lineTo(128 + m * 44, 204); x.lineTo(128 + m * 18, 268);
          x.strokeStyle = accent; x.lineWidth = 4; x.stroke();
          x.beginPath(); x.moveTo(128 + m * 66, 168); x.lineTo(128 + m * 76, 190); x.lineTo(128 + m * 86, 284);
          x.strokeStyle = GOLD; x.lineWidth = 2; x.stroke();
        });
        break;
      case 'patchcoat':
        // A collar far too big for her, standing up to the ears.
        mirrored((m) => {
          x.beginPath();
          x.moveTo(128 + m * 14, 272); x.quadraticCurveTo(128 + m * 50, 212, 128 + m * 66, 200);
          x.quadraticCurveTo(128 + m * 98, 224, 128 + m * 98, 300); x.lineTo(128 + m * 34, 312); x.closePath();
          fillStroke(x, coat, ink, 3.2);
          x.save(); x.clip(); hatch(x, 5, ink, 0.2, 1); x.restore();
          x.beginPath(); x.moveTo(128 + m * 30, 262); x.quadraticCurveTo(128 + m * 62, 240, 128 + m * 78, 222);
          x.strokeStyle = accent; x.lineWidth = 3; x.setLineDash([5, 4]); x.stroke(); x.setLineDash([]);
        });
        break;
      case 'raincoat':
        mirrored((m) => {
          poly(x, [[128 + m * 16, 270], [128 + m * 36, 214], [128 + m * 54, 218], [128 + m * 66, 284]]);
          fillStroke(x, coat, ink, 3.2);
          x.beginPath(); x.moveTo(128 + m * 36, 214); x.lineTo(128 + m * 20, 268); x.strokeStyle = paper; x.globalAlpha = 0.45; x.lineWidth = 1.6; x.stroke(); x.globalAlpha = 1;
        });
        break;
      case 'robe':
        mirrored((m) => {
          poly(x, [[128 + m * 16, 270], [128 + m * 42, 206], [128 + m * 62, 214], [128 + m * 80, 290]]);
          fillStroke(x, coat, ink, 3.2);
          x.beginPath(); x.moveTo(128 + m * 42, 206); x.lineTo(128 + m * 62, 214); x.strokeStyle = accent; x.lineWidth = 3; x.stroke();
        });
        break;
      case 'tailcoat':
        mirrored((m) => {
          poly(x, [[128 + m * 18, 270], [128 + m * 40, 226], [128 + m * 58, 232], [128 + m * 70, 290]]);
          fillStroke(x, '#34363e', ink, 3);
        });
        break;
      default: break;
    }
  });
}

function body(x: Ctx, p: PortraitSpec): void {
  const { ink, paper, accent, coat } = p.palette;
  const s = p.shoulders;
  bodySpace(x, s, () => {
    bodyOutline(x);
    x.fillStyle = coat; x.fill();
    x.save(); bodyOutline(x); x.clip();
    hatch(x, 5, ink, 0.22, 1.1);
    x.restore();
    x.lineCap = 'round'; x.lineJoin = 'round';
    switch (p.outfit) {
      case 'ringmaster': {
        // Vest, shirt, ascot, wide red lapels with gold edge and double rows of buttons, epaulettes.
        poly(x, [[110, 266], [146, 266], [128, 346]]); fillStroke(x, '#7a1220', ink, 2.4);
        poly(x, [[116, 266], [140, 266], [128, 296]]); fillStroke(x, '#fdfaf2', ink, 2);
        mirrored((m) => {
          poly(x, [[128 + m * 14, 268], [128 + m * 86, 292], [128 + m * 60, 372], [128 + m * 10, 338]]);
          fillStroke(x, accent, ink, 3);
          x.beginPath(); x.moveTo(128 + m * 14, 268); x.lineTo(128 + m * 10, 338); x.lineTo(128 + m * 60, 372);
          x.strokeStyle = GOLD; x.lineWidth = 2.4; x.stroke();
          x.save(); poly(x, [[128 + m * 14, 268], [128 + m * 86, 292], [128 + m * 60, 372], [128 + m * 10, 338]]); x.clip(); hatch(x, 5, ink, 0.2, 1); x.restore();
          for (const [bx, by] of [[34, 318], [40, 342]] as const) {
            x.beginPath(); x.arc(128 + m * bx, by, 4.6, 0, Math.PI * 2); fillStroke(x, GOLD, ink, 1.6);
            x.beginPath(); x.arc(128 + m * bx - 1, by - 1, 1.3, 0, Math.PI * 2); x.fillStyle = '#fff3c4'; x.fill();
          }
        });
        // Ascot.
        x.beginPath(); x.moveTo(114, 268); x.lineTo(142, 268); x.lineTo(136, 292); x.lineTo(128, 286); x.lineTo(120, 292); x.closePath(); fillStroke(x, '#fdfaf2', ink, 2);
        x.beginPath(); x.arc(128, 284, 4, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.6);
        break;
      }
      case 'jacket': {
        poly(x, [[110, 266], [146, 266], [128, 330]]); fillStroke(x, '#f7f7f2', ink, 2.2);
        x.beginPath(); x.moveTo(104, 268); x.lineTo(124, 336); x.moveTo(152, 268); x.lineTo(132, 336); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
        for (const by of [338, 356]) { x.beginPath(); x.arc(128, by, 3.4, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.6); }
        break;
      }
      case 'preacher': {
        // Open dark coat over a black shirt, a clerical tab at the throat, brass buttons.
        poly(x, [[108, 266], [148, 266], [128, 360]]); fillStroke(x, '#17120f', ink, 2.4);
        x.beginPath(); x.moveTo(100, 268); x.lineTo(120, 372); x.moveTo(156, 268); x.lineTo(136, 372); x.lineWidth = 3; x.strokeStyle = ink; x.stroke();
        rrect(x, 119, 262, 18, 14, 2); fillStroke(x, '#efe6d2', ink, 2);
        x.save(); rrect(x, 119, 262, 18, 14, 2); x.clip(); hatch(x, 4, ink, 0.3, 1); x.restore();
        for (const by of [300, 322]) { x.beginPath(); x.arc(128, by, 3.8, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.6); }
        break;
      }
      case 'patchcoat': {
        // Knit top, then patches on the coat, mismatched buttons.
        poly(x, [[112, 266], [144, 266], [128, 322]]); fillStroke(x, paper, ink, 2);
        x.save(); poly(x, [[112, 266], [144, 266], [128, 322]]); x.clip();
        x.strokeStyle = accent; x.lineWidth = 3; x.beginPath(); for (let py = 272; py < 322; py += 9) { x.moveTo(100, py); x.lineTo(156, py); } x.stroke(); x.restore();
        x.beginPath(); x.moveTo(104, 268); x.lineTo(126, 330); x.moveTo(152, 268); x.lineTo(130, 330); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
        const pc = ['#9fc9d9', '#e9a3b5', '#a9cf98', accent];
        const patches: Array<[number, number, number, number, number]> = [[58, 308, 30, 26, -0.2], [186, 318, 28, 30, 0.15], [74, 350, 26, 22, 0.1], [172, 356, 30, 22, -0.1]];
        patches.forEach(([px, py, w, h, rot], i) => {
          x.save(); x.translate(px, py); x.rotate(rot);
          x.fillStyle = pc[i % pc.length]; x.fillRect(-w / 2, -h / 2, w, h);
          x.setLineDash([3, 3]); x.lineWidth = 1.6; x.strokeStyle = ink; x.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4); x.setLineDash([]);
          x.lineWidth = 2; x.strokeRect(-w / 2, -h / 2, w, h);
          x.restore();
        });
        x.beginPath(); x.arc(130, 340, 9, 0, Math.PI * 2); fillStroke(x, accent, ink, 2.2);
        x.beginPath(); x.moveTo(126, 338); x.lineTo(134, 342); x.moveTo(134, 338); x.lineTo(126, 342); x.lineWidth = 1.2; x.stroke();
        x.beginPath(); x.arc(124, 366, 6.4, 0, Math.PI * 2); fillStroke(x, '#8a5a3a', ink, 2);
        break;
      }
      case 'tailcoat': {
        // White shirt front over a dark waistcoat, peaked lapels in darker cloth.
        poly(x, [[108, 266], [148, 266], [128, 318]]); fillStroke(x, '#efece4', ink, 2);
        poly(x, [[110, 292], [146, 292], [128, 384], [114, 384]]); fillStroke(x, '#23252c', ink, 2.4);
        mirrored((m) => {
          poly(x, [[128 + m * 14, 268], [128 + m * 46, 276], [128 + m * 34, 314], [128 + m * 22, 300], [128 + m * 14, 352]]);
          fillStroke(x, '#2e3038', ink, 2.4);
        });
        for (const by of [338, 360]) { x.beginPath(); x.arc(128, by, 3.2, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.4); }
        break;
      }
      case 'raincoat': {
        // Zip, toggles, rain-sheen streaks.
        x.beginPath(); x.moveTo(128, 268); x.lineTo(128, 384); x.lineWidth = 3; x.strokeStyle = ink; x.stroke();
        x.setLineDash([2, 3]); x.lineWidth = 7; x.globalAlpha = 0.5; x.stroke(); x.setLineDash([]); x.globalAlpha = 1;
        for (const ty of [300, 332, 364]) mirrored((m) => {
          rrect(x, 128 + m * 12 - 5, ty - 11, 10, 22, 4); fillStroke(x, '#8a8c8e', ink, 2);
          x.beginPath(); x.moveTo(128 + m * 6, ty); x.lineTo(128 + m * 12, ty); x.lineWidth = 2; x.stroke();
        });
        x.save(); bodyOutline(x); x.clip();
        x.strokeStyle = paper; x.globalAlpha = 0.4; x.lineWidth = 3; x.beginPath();
        x.moveTo(60, 310); x.lineTo(86, 284); x.moveTo(52, 336); x.lineTo(92, 296); x.moveTo(196, 290); x.lineTo(214, 316); x.stroke();
        x.restore();
        break;
      }
      case 'robe': {
        // Pleated white bib, cassock buttons.
        poly(x, [[112, 266], [144, 266], [152, 346], [104, 346]]); fillStroke(x, '#f1ede2', ink, 2.2);
        x.beginPath(); for (let k = 0; k < 7; k++) { x.moveTo(110 + k * 6, 272); x.lineTo(107 + k * 7, 344); } x.lineWidth = 1.2; x.stroke();
        x.beginPath(); x.moveTo(104, 346); x.lineTo(152, 346); x.lineWidth = 3; x.stroke();
        mirrored((m) => { x.beginPath(); x.moveTo(128 + m * 22, 268); x.lineTo(128 + m * 26, 384); x.lineWidth = 2.4; x.strokeStyle = accent; x.stroke(); });
        break;
      }
      case 'clerk': {
        // Waistcoat over a white shirt, garters, bow tie.
        poly(x, [[108, 266], [148, 266], [128, 330]]); fillStroke(x, '#fbfaf5', ink, 2.2);
        x.beginPath(); x.moveTo(102, 268); x.lineTo(124, 384); x.moveTo(154, 268); x.lineTo(132, 384); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
        for (const by of [330, 350, 370]) { x.beginPath(); x.arc(128, by, 2.6, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.2); }
        mirrored((m) => { x.beginPath(); x.moveTo(128 + m * 92, 318); x.lineTo(128 + m * 76, 334); x.lineWidth = 6; x.strokeStyle = accent; x.stroke(); });
        break;
      }
      default: {
        poly(x, [[110, 266], [128, 330], [146, 266]]); x.fillStyle = paper; x.fill();
        x.beginPath(); x.moveTo(104, 268); x.lineTo(126, 330); x.moveTo(152, 268); x.lineTo(130, 330); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.moveTo(124, 322); x.lineTo(132, 322); x.lineTo(134, 352); x.lineTo(128, 364); x.lineTo(122, 352); x.closePath(); fillStroke(x, accent, ink, 1.8);
      }
    }
    if (has(p, 'epaulettes')) {
      mirrored((m) => {
        poly(x, [[128 + m * 62, 288], [128 + m * 96, 296], [128 + m * 100, 316], [128 + m * 66, 308]]);
        fillStroke(x, GOLD, ink, 2.4);
        x.beginPath(); x.moveTo(128 + m * 72, 294); x.lineTo(128 + m * 74, 312); x.moveTo(128 + m * 82, 296); x.lineTo(128 + m * 84, 314); x.lineWidth = 1.2; x.stroke();
        x.beginPath(); for (let k = 0; k < 5; k++) { x.moveTo(128 + m * (92 + k * 1.6), 316 + 0); x.lineTo(128 + m * (92 + k * 1.6), 326 + (k % 2) * 3); } x.lineWidth = 1.8; x.strokeStyle = GOLD; x.stroke();
      });
    }
    bodyOutline(x); x.strokeStyle = ink; x.lineWidth = 3.2; x.stroke();
  });
}

function neck(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  const w = 17 * p.neck;
  const path = (): void => { x.beginPath(); x.moveTo(128 - w, 206); x.lineTo(128 - w - 1, 276); x.lineTo(128 + w + 1, 276); x.lineTo(128 + w, 206); x.closePath(); };
  path(); x.fillStyle = p.skin; x.fill();
  x.save(); path(); x.clip();
  x.beginPath(); x.ellipse(128, 220, 26 * p.neck, 18, 0, 0, Math.PI * 2); x.fillStyle = ink; x.globalAlpha = 0.3; x.fill(); x.globalAlpha = 1;
  hatch(x, 3.5, ink, 0.3, 1);
  x.restore();
  if (p.neck > 1.3) { // tendons on a bull neck
    x.beginPath(); x.moveTo(128 - w * 0.5, 232); x.lineTo(128 - w * 0.3, 272); x.moveTo(128 + w * 0.5, 232); x.lineTo(128 + w * 0.3, 272);
    x.strokeStyle = ink; x.lineWidth = 2.2; x.lineCap = 'round'; x.stroke();
  }
}

/** Collars, ties and scarves that sit in front of the neck. */
function neckwear(x: Ctx, p: PortraitSpec): void {
  const { ink, paper, accent } = p.palette;
  bodySpace(x, p.shoulders, () => {
    switch (p.outfit) {
      case 'jacket': {
        mirrored((m) => { poly(x, [[128 + m * 4, 268], [128 + m * 24, 262], [128 + m * 28, 284], [128 + m * 6, 296]]); fillStroke(x, '#fbfbf7', ink, 1.8); });
        poly(x, [[128, 290], [114, 280], [114, 300]]); fillStroke(x, accent, ink, 1.8);
        poly(x, [[128, 290], [142, 280], [142, 300]]); fillStroke(x, accent, ink, 1.8);
        x.beginPath(); x.arc(128, 290, 4.4, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.8);
        break;
      }
      case 'tailcoat': {
        mirrored((m) => { poly(x, [[128 + m * 8, 270], [128 + m * 16, 240], [128 + m * 30, 276], [128 + m * 12, 284]]); fillStroke(x, '#f4f1e9', ink, 2); });
        poly(x, [[128, 282], [108, 272], [108, 294]]); fillStroke(x, '#16171b', ink, 1.8);
        poly(x, [[128, 282], [148, 272], [148, 294]]); fillStroke(x, '#16171b', ink, 1.8);
        x.beginPath(); x.arc(128, 282, 4, 0, Math.PI * 2); fillStroke(x, '#16171b', ink, 1.6);
        break;
      }
      case 'raincoat': {
        // High zipped storm collar hiding the neck.
        poly(x, [[128 - 40, 280], [128 - 34, 240], [128 - 8, 250], [128, 262], [128 + 8, 250], [128 + 34, 240], [128 + 40, 280]]);
        fillStroke(x, p.palette.coat, ink, 3.2);
        x.save(); poly(x, [[128 - 40, 280], [128 - 34, 240], [128 - 8, 250], [128, 262], [128 + 8, 250], [128 + 34, 240], [128 + 40, 280]]); x.clip(); hatch(x, 4, ink, 0.28, 1); x.restore();
        x.beginPath(); x.moveTo(128, 262); x.lineTo(128, 282); x.lineWidth = 3; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.moveTo(128 - 34, 244); x.lineTo(128 - 12, 254); x.lineWidth = 2; x.strokeStyle = paper; x.globalAlpha = 0.5; x.stroke(); x.globalAlpha = 1;
        break;
      }
      case 'clerk': {
        poly(x, [[128, 280], [112, 270], [112, 292]]); fillStroke(x, accent, ink, 1.8);
        poly(x, [[128, 280], [144, 270], [144, 292]]); fillStroke(x, accent, ink, 1.8);
        x.beginPath(); x.arc(128, 280, 3.6, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.6);
        break;
      }
      case 'patchcoat': {
        // Mustard knit scarf, one tail hanging.
        rrect(x, 100, 258, 56, 26, 11); fillStroke(x, accent, ink, 2.6);
        x.save(); rrect(x, 100, 258, 56, 26, 11); x.clip();
        x.strokeStyle = ink; x.globalAlpha = 0.5; x.lineWidth = 2; x.beginPath(); for (let k = 108; k < 156; k += 8) { x.moveTo(k, 258); x.lineTo(k - 4, 284); } x.stroke(); x.restore();
        poly(x, [[108, 278], [124, 282], [120, 340], [100, 336]]); fillStroke(x, accent, ink, 2.4);
        x.save(); poly(x, [[108, 278], [124, 282], [120, 340], [100, 336]]); x.clip();
        x.strokeStyle = ink; x.globalAlpha = 0.5; x.lineWidth = 2; x.beginPath(); for (let k = 288; k < 340; k += 8) { x.moveTo(96, k); x.lineTo(126, k + 2); } x.stroke(); x.restore();
        break;
      }
      default: break;
    }
  });
  void paper;
}

// ── head parts ─────────────────────────────────────────────────────────────────────────────────
function ears(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  const ex = EAR_X[p.jaw];
  const big = p.head[0] > 1.1 ? 1.15 : 1;
  for (const s of [-1, 1]) {
    x.beginPath(); x.ellipse(128 + s * ex, 160, 8 * big, 14 * big, 0, 0, Math.PI * 2);
    x.fillStyle = p.skin; x.fill(); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
  }
}

function face(x: Ctx, p: PortraitSpec): void {
  const { ink, paper } = p.palette;
  const blank = has(p, 'blankcard');
  faceOutline(x, p.jaw);
  x.fillStyle = blank ? '#fdfcf8' : p.skin; x.fill();
  x.save(); faceOutline(x, p.jaw); x.clip();
  x.beginPath(); x.moveTo(146, 60); x.quadraticCurveTo(160, 150, 150, 240); x.lineTo(230, 240); x.lineTo(230, 60); x.closePath();
  x.fillStyle = ink; x.globalAlpha = blank ? 0.05 : 0.08; x.fill(); x.globalAlpha = 1;
  hatch(x, blank ? 6 : 4.2, ink, blank ? 0.16 : 0.34, 1.2);
  if (blank) {
    // Ruled lines and a punch hole: a face card, blank.
    x.strokeStyle = p.palette.accent; x.globalAlpha = 0.28; x.lineWidth = 1; x.beginPath();
    for (let ly = 108; ly < 230; ly += 15) { x.moveTo(60, ly); x.lineTo(200, ly); } x.stroke(); x.globalAlpha = 1;
    x.beginPath(); x.arc(128, 98, 3.6, 0, Math.PI * 2); x.fillStyle = paper; x.fill(); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
    x.beginPath(); x.moveTo(166, 224); x.lineTo(180, 210); x.lineTo(180, 224); x.closePath(); x.fillStyle = '#e4e0d4'; x.fill(); x.stroke();
  }
  x.restore();
  faceOutline(x, p.jaw); x.strokeStyle = ink; x.lineWidth = 3.4; x.stroke();
}

function soot(x: Ctx, p: PortraitSpec): void {
  if (!p.soot) return;
  const { ink } = p.palette;
  x.save(); x.strokeStyle = ink; x.lineCap = 'round';
  const streaks: [number, number, number, number, number][] = [
    [88, 106, 102, 138, 6], [98, 118, 112, 152, 3.4], [158, 100, 174, 134, 6], [166, 126, 182, 164, 3.4],
    [120, 92, 116, 112, 4.4], [138, 90, 146, 106, 3.4], [84, 182, 98, 202, 3.4], [172, 178, 164, 198, 4.4],
    [112, 186, 118, 200, 3], [148, 160, 156, 176, 3],
  ];
  for (const [x0, y0, x1, y1, w] of streaks) {
    x.globalAlpha = 0.5; x.lineWidth = w;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  }
  // Smudge across the nose and one cheek.
  x.globalAlpha = 0.3; x.lineWidth = 9; x.beginPath(); x.moveTo(110, 168); x.lineTo(144, 164); x.stroke();
  x.restore();
}

function skinDetails(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, accent } = p.palette;
  x.save(); faceOutline(x, p.jaw); x.clip();
  if (has(p, 'stubble')) {
    x.fillStyle = ink; x.globalAlpha = 0.5;
    for (let i = 0; i < 240; i++) {
      const px = 74 + rnd() * 110, py = 176 + rnd() * 56;
      if (Math.hypot((px - 128) / 56, (py - 214) / 30) > 1) continue;
      x.fillRect(px, py, 1.6, 1.6);
    }
    x.globalAlpha = 0.34; x.fillRect(100, 188, 56, 3);
  }
  if (has(p, 'hollowcheeks')) {
    x.fillStyle = ink; x.globalAlpha = 0.16;
    mirrored((m) => { x.beginPath(); x.ellipse(128 + m * 36, 190, 18, 26, m * -0.3, 0, Math.PI * 2); x.fill(); });
    x.globalAlpha = 1;
    mirrored((m) => { x.save(); x.beginPath(); x.ellipse(128 + m * 36, 190, 17, 25, m * -0.3, 0, Math.PI * 2); x.clip(); hatch(x, 3, ink, 0.3, 1); x.restore(); });
  }
  if (has(p, 'bags')) {
    x.strokeStyle = ink; x.lineCap = 'round'; x.globalAlpha = 0.7; x.lineWidth = 1.8;
    mirrored((m) => {
      x.beginPath(); x.moveTo(128 + m * 12, 168); x.quadraticCurveTo(128 + m * 28, 178, 128 + m * 42, 167); x.stroke();
      x.beginPath(); x.moveTo(128 + m * 16, 173); x.quadraticCurveTo(128 + m * 28, 181, 128 + m * 38, 173); x.lineWidth = 1; x.stroke(); x.lineWidth = 1.8;
    });
  }
  if (has(p, 'freckles')) {
    x.fillStyle = '#9a5a2e'; x.globalAlpha = 0.7;
    mirrored((m) => { for (const [fx, fy] of [[22, 176], [32, 172], [42, 178], [28, 183], [38, 186]] as const) { x.beginPath(); x.arc(128 + m * fx, fy, 1.7, 0, Math.PI * 2); x.fill(); } });
  }
  if (has(p, 'blush')) {
    x.fillStyle = '#f08a8a'; x.globalAlpha = 0.4;
    mirrored((m) => { x.beginPath(); x.ellipse(128 + m * 36, 182, 13, 7, 0, 0, Math.PI * 2); x.fill(); });
    x.globalAlpha = 0.5; x.strokeStyle = '#d96a6a'; x.lineWidth = 1.2; x.lineCap = 'round';
    mirrored((m) => { for (let k = 0; k < 3; k++) { x.beginPath(); x.moveTo(128 + m * (30 + k * 6), 180); x.lineTo(128 + m * (27 + k * 6), 186); x.stroke(); } });
  }
  x.restore();
  void accent;
}

function hairBack(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper } = p.palette;
  const hc = p.hairColor;
  x.lineWidth = 3.2; x.strokeStyle = ink; x.lineJoin = 'round';
  switch (p.hair) {
    case 'bob': {
      // A heavy bell of silver hair, ends curling in under the jaw.
      x.beginPath();
      x.moveTo(128, 46);
      x.bezierCurveTo(206, 42, 214, 120, 204, 176);
      x.bezierCurveTo(204, 204, 198, 224, 176, 236);
      x.quadraticCurveTo(160, 224, 154, 214);
      x.lineTo(102, 214); x.quadraticCurveTo(96, 224, 80, 236);
      x.bezierCurveTo(58, 224, 52, 204, 52, 176);
      x.bezierCurveTo(42, 120, 50, 42, 128, 46);
      x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip();
      hatch(x, 6, ink, 0.2, 1);
      x.strokeStyle = '#ffffff'; x.globalAlpha = 0.55; x.lineWidth = 3; x.beginPath(); x.moveTo(66, 150); x.quadraticCurveTo(62, 110, 74, 80); x.moveTo(190, 84); x.quadraticCurveTo(200, 112, 194, 150); x.stroke();
      x.restore();
      break;
    }
    case 'hood': {
      x.beginPath();
      x.moveTo(24, PH); x.bezierCurveTo(22, 170, 38, 30, 128, 22); x.bezierCurveTo(218, 30, 234, 170, 232, PH); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip();
      hatch(x, 5, ink, 0.22, 1);
      x.strokeStyle = ink; x.globalAlpha = 0.55; x.lineWidth = 2; x.beginPath();
      x.moveTo(60, 120); x.quadraticCurveTo(48, 220, 40, 330); x.moveTo(196, 120); x.quadraticCurveTo(208, 220, 216, 330); x.stroke();
      x.restore();
      break;
    }
    case 'bun': {
      x.beginPath(); x.arc(128, 48, 22, 0, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      x.beginPath(); x.arc(128, 48, 12, 0.3, Math.PI * 1.4); x.lineWidth = 1.6; x.stroke(); x.lineWidth = 3.2;
      x.beginPath(); x.ellipse(128, 118, 74, 66, 0, Math.PI, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    case 'messy': {
      // Big cloud of curls, wider than the head.
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * 0.92 + (i / 14) * Math.PI * 1.16;
        const cx = 128 + Math.cos(a) * (72 + rnd() * 8);
        const cy = 128 + Math.sin(a) * (66 + rnd() * 8);
        x.beginPath(); x.arc(cx, cy, 17 + rnd() * 8, 0, Math.PI * 2);
        x.fillStyle = hc; x.fill(); x.stroke();
      }
      x.beginPath(); x.ellipse(128, 120, 74, 64, 0, 0, Math.PI * 2); x.fillStyle = hc; x.fill();
      break;
    }
    case 'buzz': {
      x.beginPath(); x.ellipse(128, 108, 66, 52, 0, Math.PI, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    case 'swept': {
      // Swept back and up, with a tall crest.
      x.beginPath();
      x.moveTo(70, 160);
      x.bezierCurveTo(52, 70, 96, 30, 150, 24);
      x.quadraticCurveTo(190, 20, 214, 44);
      x.quadraticCurveTo(196, 56, 204, 74);
      x.quadraticCurveTo(194, 84, 190, 110);
      x.bezierCurveTo(190, 130, 186, 146, 186, 160);
      x.lineTo(70, 160); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip();
      x.strokeStyle = '#ffffff'; x.globalAlpha = 0.28; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 6; i++) { x.moveTo(84 + i * 14, 116); x.quadraticCurveTo(110 + i * 14, 56 - i * 3, 190, 34 + i * 4); } x.stroke(); x.restore();
      break;
    }
    case 'combed': {
      x.beginPath();
      x.moveTo(74, 168); x.bezierCurveTo(60, 92, 96, 62, 128, 62); x.bezierCurveTo(160, 62, 196, 92, 182, 168);
      x.lineTo(172, 150); x.lineTo(84, 150); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    default: { // slick
      x.beginPath();
      x.moveTo(72, 150); x.bezierCurveTo(64, 56, 192, 56, 184, 150); x.lineTo(178, 148); x.lineTo(78, 148); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
    }
  }
  void paper;
}

function hairFront(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper, accent } = p.palette;
  const hc = p.hairColor;
  x.lineWidth = 3; x.strokeStyle = ink; x.lineJoin = 'round';
  switch (p.hair) {
    case 'bob': {
      // Blunt chopped fringe and two long locks in front of the cheeks.
      x.beginPath();
      x.moveTo(70, 150); x.quadraticCurveTo(62, 66, 128, 56); x.quadraticCurveTo(194, 66, 186, 150);
      x.lineTo(182, 120); x.lineTo(170, 114); x.lineTo(156, 120); x.lineTo(142, 110); x.lineTo(128, 118);
      x.lineTo(114, 110); x.lineTo(100, 120); x.lineTo(86, 114); x.lineTo(74, 120); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip(); hatch(x, 7, ink, 0.14, 1); x.restore();
      x.lineWidth = 1.3; x.globalAlpha = 0.45;
      for (let i = 0; i < 6; i++) { const sx = 92 + i * 14; x.beginPath(); x.moveTo(sx, 70 + rnd() * 5); x.quadraticCurveTo(sx + 6, 90, sx - 2 + i * 0.6, 112); x.stroke(); }
      x.globalAlpha = 1; x.lineWidth = 3;
      mirrored((m) => {
        x.beginPath();
        x.moveTo(128 + m * 58, 112); x.bezierCurveTo(128 + m * 66, 150, 128 + m * 64, 196, 128 + m * 50, 222);
        x.lineTo(128 + m * 36, 214); x.bezierCurveTo(128 + m * 40, 190, 128 + m * 40, 160, 128 + m * 44, 122); x.closePath();
        x.fillStyle = hc; x.fill(); x.stroke();
        x.save(); x.clip(); hatch(x, 6, ink, 0.2, 1); x.restore();
      });
      break;
    }
    case 'buzz': {
      // Hairline fuzz plus a rough crop line.
      x.beginPath(); x.moveTo(72, 140); x.quadraticCurveTo(128, 90, 184, 140);
      x.lineTo(180, 150); x.quadraticCurveTo(128, 104, 76, 150); x.closePath();
      x.fillStyle = hc; x.fill();
      x.fillStyle = '#6a5a4a'; x.globalAlpha = 0.5;
      for (let i = 0; i < 90; i++) { const a = Math.PI + rnd() * Math.PI, r = 40 + rnd() * 18; x.fillRect(128 + Math.cos(a) * r * 1.1, 112 + Math.sin(a) * r * 0.72, 1.6, 2.4); }
      x.globalAlpha = 1;
      break;
    }
    case 'swept': {
      // Widow's peak and spiked locks falling across the brow.
      x.beginPath();
      x.moveTo(76, 138); x.quadraticCurveTo(80, 92, 128, 76); x.quadraticCurveTo(168, 70, 190, 100);
      x.lineTo(178, 100); x.lineTo(184, 128); x.lineTo(164, 106); x.lineTo(154, 134); x.lineTo(138, 104);
      x.lineTo(128, 126); x.lineTo(116, 100); x.lineTo(104, 128); x.lineTo(96, 100); x.lineTo(84, 142); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip(); hatch(x, 4, ink, 0.28, 1); x.restore();
      x.strokeStyle = '#ffffff'; x.globalAlpha = 0.4; x.lineWidth = 1.6; x.beginPath(); x.moveTo(110, 88); x.quadraticCurveTo(140, 78, 168, 88); x.stroke(); x.globalAlpha = 1;
      break;
    }
    case 'messy': {
      // Curly fringe, ruffled.
      for (let i = 0; i < 5; i++) {
        const cx = 88 + i * 20, cy = 92 + (i % 2) * 9;
        x.beginPath(); x.arc(cx, cy, 12 + rnd() * 4, 0, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
        x.beginPath(); x.arc(cx - 2, cy - 2, 5, 3.4, 5.2); x.lineWidth = 1.4; x.stroke(); x.lineWidth = 3;
      }
      break;
    }
    case 'combed': {
      // Receding M hairline, a side part, thin strands swept across.
      x.beginPath();
      x.moveTo(78, 150); x.quadraticCurveTo(74, 94, 128, 84); x.quadraticCurveTo(182, 94, 178, 150);
      x.lineTo(172, 122); x.lineTo(162, 112); x.lineTo(150, 100); x.lineTo(138, 112); x.lineTo(112, 100);
      x.lineTo(98, 114); x.lineTo(88, 124); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.strokeStyle = ink; x.globalAlpha = 0.5; x.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(118, 90); x.quadraticCurveTo(150 + i * 5, 90 + i * 2, 176, 118 + i * 4); x.stroke(); }
      x.globalAlpha = 1;
      break;
    }
    case 'slick': {
      x.beginPath(); x.moveTo(78, 148); x.quadraticCurveTo(128, 96, 178, 148); x.lineTo(172, 150);
      x.quadraticCurveTo(128, 110, 84, 150); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.lineWidth = 1.2; x.globalAlpha = 0.5; x.strokeStyle = paper;
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(112 + i * 12, 70 + i * 3); x.quadraticCurveTo(122 + i * 12, 86, 118 + i * 12, 102); x.stroke(); }
      x.globalAlpha = 1;
      break;
    }
    case 'hood': {
      // The hood rim: a thick band of cloth around the face with a shadow over the eyes and rain on the brim.
      x.beginPath();
      x.moveTo(34, 250); x.bezierCurveTo(26, 120, 60, 30, 128, 28); x.bezierCurveTo(196, 30, 230, 120, 222, 250);
      x.lineTo(188, 250); x.bezierCurveTo(192, 140, 176, 66, 128, 62); x.bezierCurveTo(80, 66, 64, 140, 68, 250); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip(); hatch(x, 5, ink, 0.25, 1); x.restore();
      x.save(); faceOutline(x, p.jaw); x.clip();
      x.fillStyle = ink; x.globalAlpha = 0.28; x.fillRect(60, 80, 140, 66);
      hatch(x, 3.4, ink, 0.3, 1); x.restore();
      x.beginPath(); x.moveTo(60, 130); x.quadraticCurveTo(70, 80, 128, 54); x.lineWidth = 2; x.strokeStyle = paper; x.globalAlpha = 0.45; x.stroke(); x.globalAlpha = 1;
      break;
    }
    case 'bun': {
      x.beginPath(); x.moveTo(76, 146); x.quadraticCurveTo(84, 76, 128, 70); x.quadraticCurveTo(176, 76, 180, 146);
      x.lineTo(176, 130); x.quadraticCurveTo(150, 100, 128, 114); x.quadraticCurveTo(104, 100, 80, 130); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
  }
  void accent;
}

function brow(x: Ctx, p: PortraitSpec, side: number, y0: number, tilt: number): void {
  const { kind, w } = p.brow;
  if (kind === 'none') return;
  let inner = y0 + tilt * 12, mid = y0 - 8 - tilt * 2, outer = y0 - 3 - tilt * 2;
  if (kind === 'sharp') { inner += 5; mid -= 1; outer -= 5; }
  if (kind === 'flat') { mid = y0 - 1 + tilt * 2; outer = y0 + 1 - tilt * 2; }
  if (kind === 'droop') { inner -= 3; outer += 7; mid += 1; }
  x.beginPath();
  x.moveTo(128 + side * 11, inner);
  x.quadraticCurveTo(128 + side * 27, mid, 128 + side * 44, outer);
  x.lineCap = w > 6 ? 'butt' : 'round'; x.lineJoin = 'miter'; x.lineWidth = w; x.strokeStyle = p.palette.ink; x.stroke();
  if (w > 6) { // heavy brow: a chunk of ink under the arch
    x.beginPath(); x.moveTo(128 + side * 12, inner + 3); x.quadraticCurveTo(128 + side * 27, mid + 6, 128 + side * 43, outer + 3);
    x.lineWidth = w * 0.55; x.stroke();
  }
}

interface Mood { lid: [number, number]; brow: number; tilt: number; mouth: 'open' | 'smirk' | 'gritted' | 'down' | null }
const MOOD: Record<Expr, Mood> = {
  calm: { lid: [0.8, 0.8], brow: 0, tilt: 0, mouth: null },
  smirk: { lid: [0.52, 0.76], brow: -4, tilt: -0.1, mouth: 'smirk' },
  shock: { lid: [1.22, 1.22], brow: -11, tilt: 0, mouth: 'open' },
  rage: { lid: [0.62, 0.62], brow: 4, tilt: 0.55, mouth: 'gritted' },
  hollow: { lid: [0.42, 0.42], brow: 3, tilt: -0.05, mouth: 'down' },
};

function almond(x: Ctx, ex: number, ey: number, side: number, lid: number, slant: number, hw: number): { ix: number; iy: number; ox: number; oy: number } {
  const ix = ex - side * (hw - 1), iy = ey + 1 + slant * 0.35, ox = ex + side * hw, oy = ey - 3 - slant;
  x.moveTo(ix, iy);
  x.quadraticCurveTo(ex + side * 2, ey - 14 * lid - slant * 0.3, ox, oy);
  x.quadraticCurveTo(ex + side * 2, ey + 9, ix, iy);
  return { ix, iy, ox, oy };
}

/** One eye. `side` -1 = viewer's left, +1 = right. `lid` opens the upper lid (0..1.3). */
function eye(x: Ctx, p: PortraitSpec, side: number, style: EyeStyle, lid: number): void {
  const { ink, paper, accent } = p.palette;
  const ex = 128 + side * 26, ey = 150;
  x.save();
  if (style === 'round' || style === 'wide') {
    const doe = style === 'round';
    const rw = doe ? 15 : 14, rh = (doe ? 16 : 10.5) * Math.min(lid, 1.1);
    x.beginPath(); x.ellipse(ex, ey, rw, rh, 0, 0, Math.PI * 2);
    x.fillStyle = '#ffffff'; x.fill();
    x.save(); x.clip();
    const ir = doe ? 11.5 : 5.6;
    const ix = ex + side * (doe ? 0.5 : 0), iy = ey + (doe ? 1.5 : 0.5);
    x.beginPath(); x.arc(ix, iy, ir, 0, Math.PI * 2); x.fillStyle = doe ? '#4a2c14' : ink; x.fill();
    if (doe) {
      x.beginPath(); x.arc(ix, iy + 2, ir * 0.82, 0, Math.PI); x.fillStyle = accent; x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
      x.beginPath(); x.arc(ix, iy, 5, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    }
    x.beginPath(); x.arc(ix - 3.4, iy - 4, doe ? 4.2 : 2.2, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
    x.beginPath(); x.arc(ix + 4, iy + 4.4, doe ? 2 : 1.1, 0, Math.PI * 2); x.fill();
    if (doe) { x.beginPath(); x.arc(ix + 5, iy - 5, 1.3, 0, Math.PI * 2); x.fill(); }
    x.restore();
    x.beginPath(); x.ellipse(ex, ey, rw, rh, 0, 0, Math.PI * 2); x.lineWidth = doe ? 2.6 : 3.4; x.strokeStyle = ink; x.stroke();
    if (doe || p.lash > 0.5) {
      x.beginPath(); x.moveTo(ex + side * rw * 0.7, ey - rh * 0.75); x.lineTo(ex + side * (rw + 5), ey - rh * 0.9 - 3);
      x.lineWidth = 2.6; x.lineCap = 'round'; x.stroke();
    }
    x.restore();
    return;
  }
  const slant = style === 'predator' ? 6 : style === 'tired' ? -1 : style === 'hollow' ? 1 : 0;
  const hw = style === 'predator' ? 14.5 : 13;
  const lidE = style === 'predator' ? lid * 0.88 : lid;
  x.beginPath();
  const c = almond(x, ex, ey, side, lidE, slant, hw);
  x.fillStyle = '#ffffff'; x.fill();
  x.save(); x.clip();
  const ix = ex - side * 1.2, iy = ey + (lid < 0.6 ? 2 : 0);
  if (style === 'predator') {
    // Red-brown iris; the viewer's right pupil is dilated almost to the rim, the left is a pin.
    x.beginPath(); x.arc(ix, iy, 10.5, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
    x.beginPath(); x.arc(ix, iy, 10.5, 0, Math.PI * 2); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
    x.beginPath(); x.arc(ix, iy, side > 0 ? 9 : 3.2, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.beginPath(); x.arc(ix - 3.4, iy - 3.4, side > 0 ? 2 : 2.6, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
  } else if (style === 'hollow') {
    x.beginPath(); x.arc(ix, iy + 1, 7.5, 0, Math.PI * 2); x.fillStyle = '#b9bac2'; x.fill();
    x.beginPath(); x.arc(ix, iy + 1, 2.6, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.beginPath(); x.arc(ix, iy + 1, 7.5, 0, Math.PI * 2); x.lineWidth = 1.4; x.strokeStyle = ink; x.stroke();
  } else if (style === 'tired') {
    x.beginPath(); x.arc(ix, iy + 2, 8.5, 0, Math.PI * 2); x.fillStyle = '#7e8083'; x.fill();
    x.beginPath(); x.arc(ix, iy + 2, 3.4, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.beginPath(); x.arc(ix + 2, iy, 1.6, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
  } else {
    x.beginPath(); x.arc(ix, iy, 9.5, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.beginPath(); x.arc(ix, iy, 9.5, 0, Math.PI); x.fillStyle = accent; x.globalAlpha = 0.85; x.fill(); x.globalAlpha = 1;
    x.beginPath(); x.arc(ix - 3, iy - 3, 2.8, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
    x.beginPath(); x.arc(ix + 3.4, iy + 3.6, 1.2, 0, Math.PI * 2); x.fill();
  }
  // Lid shadow over the top of the iris.
  x.beginPath(); x.moveTo(c.ix - 2, ey - 18); x.lineTo(c.ox + side * 4, ey - 18); x.lineTo(c.ox, c.oy);
  x.quadraticCurveTo(ex + side * 2, ey - 14 * lidE - slant * 0.3, c.ix, c.iy); x.closePath();
  x.fillStyle = ink; x.globalAlpha = style === 'tired' ? 0.5 : 0.25; x.fill(); x.globalAlpha = 1;
  x.restore();
  // Strokes: heavy upper lid, thin lower lid, outer flick.
  x.lineCap = 'round'; x.strokeStyle = ink;
  x.beginPath(); x.moveTo(c.ix, c.iy); x.quadraticCurveTo(ex + side * 2, ey - 14 * lidE - slant * 0.3, c.ox, c.oy);
  x.lineWidth = style === 'predator' ? 5 : style === 'tired' ? 4.4 : 3.8; x.stroke();
  x.beginPath(); x.moveTo(c.ox, c.oy); x.quadraticCurveTo(ex + side * 2, ey + 9, c.ix, c.iy);
  x.lineWidth = 1.4; x.stroke();
  x.beginPath(); x.moveTo(c.ox, c.oy); x.lineTo(c.ox + side * (3 + 7 * p.lash + (style === 'predator' ? 4 : 0)), c.oy - (3 + 4 * p.lash + (style === 'predator' ? 3 : 0)));
  x.lineWidth = 2.6; x.stroke();
  if (style === 'tired') { // flat heavy lid
    x.beginPath(); x.moveTo(c.ix - 1, ey - 3); x.lineTo(c.ox + 1, ey - 3); x.lineWidth = 2.4; x.stroke();
  }
  void paper;
  x.restore();
}

/** Sunken sockets (hollow / tired eyes): a dark ellipse and hatching under the lid. */
function sockets(x: Ctx, p: PortraitSpec, strong: boolean): void {
  const { ink } = p.palette;
  mirrored((m) => {
    x.save();
    x.beginPath(); x.ellipse(128 + m * 26, 152, 19, 14, 0, 0, Math.PI * 2);
    x.fillStyle = ink; x.globalAlpha = strong ? 0.5 : 0.28; x.fill(); x.clip(); x.globalAlpha = 1;
    hatch(x, 2.6, ink, 0.5, 1.1);
    x.restore();
  });
}

function closedEye(x: Ctx, p: PortraitSpec, side: number, expr: Expr): void {
  const ex = 128 + side * 26, ey = 150 + (expr === 'smirk' && side > 0 ? -2 : 0);
  // The classic ^ ^ smile: an upward arc with lashes.
  x.beginPath();
  x.moveTo(ex - 13, ey + 3);
  x.quadraticCurveTo(ex, ey - 12, ex + 13, ey + 3);
  x.lineCap = 'round'; x.lineWidth = 3.8; x.strokeStyle = p.palette.ink; x.stroke();
  x.beginPath(); x.moveTo(ex + 12 * side, ey + 2); x.lineTo(ex + 17 * side, ey - 3); x.lineWidth = 2.4; x.stroke();
  x.beginPath(); x.moveTo(ex + 8 * side, ey - 3); x.lineTo(ex + 12 * side, ey - 8); x.lineWidth = 1.8; x.stroke();
  if (expr === 'hollow') { x.beginPath(); x.moveTo(ex - 10, ey + 6); x.lineTo(ex + 10, ey + 6); x.lineWidth = 1.2; x.stroke(); }
}

function eyes(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const m = MOOD[expr];
  let style = p.eyes;
  if (style === 'blank' || style === 'masked') return;
  if (style === 'closed' && (expr === 'shock' || expr === 'rage')) style = 'plain';
  if (style === 'closed') {
    closedEye(x, p, -1, expr); closedEye(x, p, 1, expr);
    return;
  }
  if (style === 'hollow' || style === 'tired') sockets(x, p, style === 'hollow');
  const lidL = style === 'round' ? Math.max(0.78, m.lid[0]) : m.lid[0];
  eye(x, p, -1, style, lidL);
  eye(x, p, 1, style, m.lid[1]);
}

function browsAll(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const m = MOOD[expr];
  const tiltL = expr === 'smirk' ? -m.tilt : m.tilt;
  const tiltR = expr === 'smirk' ? 0.3 : m.tilt;
  const baseY = p.eyes === 'round' ? 122 : 128;
  const leftY = baseY + (expr === 'smirk' ? -6 : m.brow);
  const rightY = baseY + (expr === 'smirk' ? 2 : m.brow);
  if (p.eyes === 'closed' && expr === 'calm') {
    brow(x, p, -1, 124, 0); brow(x, p, 1, 124, 0);
    return;
  }
  brow(x, p, -1, leftY, tiltL);
  brow(x, p, 1, rightY, tiltR);
}

function nose(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink;
  if (p.nose === 'big') {
    x.beginPath(); x.moveTo(132, 156); x.quadraticCurveTo(124, 176, 116, 184); x.quadraticCurveTo(128, 192, 142, 184); x.lineWidth = 3; x.stroke();
    x.beginPath(); x.arc(121, 186, 2, 0, Math.PI * 2); x.arc(137, 186, 2, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
  } else if (p.nose === 'sharp') {
    x.beginPath(); x.moveTo(133, 150); x.lineTo(126, 180); x.lineTo(134, 183); x.lineWidth = 2.6; x.stroke();
    x.beginPath(); x.moveTo(138, 156); x.lineTo(136, 172); x.lineWidth = 1.2; x.globalAlpha = 0.5; x.stroke(); x.globalAlpha = 1;
  } else {
    x.beginPath(); x.moveTo(131, 160); x.quadraticCurveTo(126, 172, 124, 178); x.quadraticCurveTo(128, 182, 133, 180); x.lineWidth = 2; x.stroke();
  }
}

function teethRow(x: Ctx, x0: number, x1: number, y: number, h: number, n: number, pointed: boolean, down: boolean): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step;
    x.beginPath();
    if (pointed) { x.moveTo(a, y); x.lineTo(a + step, y); x.lineTo(a + step / 2, y + (down ? h : -h)); }
    else { x.rect(a + 0.6, down ? y : y - h, step - 1.2, h); }
    x.closePath(); x.fill(); x.lineWidth = 1; x.stroke();
  }
}

function mouth(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const { ink, paper, accent } = p.palette;
  const kind = MOOD[expr].mouth;
  x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink; x.fillStyle = ink;
  if (p.eyes === 'masked') return;
  const custom = expr === 'calm' || expr === 'smirk';
  const sm = expr === 'smirk' ? 1 : 0;
  if (custom && p.mouth === 'fang') {
    // Wide predator grin, every tooth sharp; the smirk tilts it up on the right.
    const lc: [number, number] = [100, 198 + sm * 8], rc: [number, number] = [156, 196 - sm * 10];
    x.beginPath(); x.moveTo(lc[0], lc[1]); x.quadraticCurveTo(128, 202 - sm * 2, rc[0], rc[1]);
    x.quadraticCurveTo(142, 228 - sm * 4, 128, 228 - sm * 2); x.quadraticCurveTo(112, 228, lc[0], lc[1]); x.closePath();
    x.fillStyle = '#240a10'; x.fill(); x.lineWidth = 2.6; x.stroke();
    x.save(); x.beginPath(); x.moveTo(lc[0], lc[1]); x.quadraticCurveTo(128, 202 - sm * 2, rc[0], rc[1]); x.quadraticCurveTo(142, 228, 128, 228); x.quadraticCurveTo(112, 228, lc[0], lc[1]); x.clip();
    x.fillStyle = '#fdfaf2';
    teethRow(x, lc[0] + 3, rc[0] - 3, 200 - sm * 1, 9, 9, true, true);
    teethRow(x, 112, 146, 224, 6, 5, true, false);
    x.fillStyle = accent; x.globalAlpha = 0.7; x.beginPath(); x.ellipse(128, 222, 10, 4, 0, 0, Math.PI * 2); x.fill();
    x.restore();
    x.beginPath(); x.moveTo(lc[0], lc[1]); x.lineTo(lc[0] - 5, lc[1] - 6); x.moveTo(rc[0], rc[1]); x.lineTo(rc[0] + 5, rc[1] - 6); x.lineWidth = 2.4; x.stroke();
    return;
  }
  if (custom && p.mouth === 'laugh') {
    // Big open laugh with a tongue and a row of square teeth.
    const y0 = 196 - sm * 2;
    x.beginPath(); x.moveTo(96, y0 + (sm ? 2 : 0)); x.quadraticCurveTo(128, y0 + 8, 160, y0 - sm * 6);
    x.quadraticCurveTo(152, 240, 128, 240); x.quadraticCurveTo(104, 240, 96, y0 + (sm ? 2 : 0)); x.closePath();
    x.fillStyle = '#2a0c0c'; x.fill(); x.lineWidth = 3.4; x.stroke();
    x.save(); x.clip();
    x.fillStyle = '#fbf6e6'; teethRow(x, 100, 156, y0 + 3, 11, 6, false, true);
    x.beginPath(); x.ellipse(128, 238, 18, 12, 0, 0, Math.PI * 2); x.fillStyle = '#c4574e'; x.fill();
    x.restore();
    return;
  }
  if (custom && p.mouth === 'smile') {
    x.beginPath(); x.moveTo(110, 204 - sm * 2); x.quadraticCurveTo(128, 218, 146, 204 - sm * 6);
    x.lineWidth = 2.4; x.stroke();
    x.beginPath(); x.moveTo(110, 204 - sm * 2); x.lineTo(106, 200 - sm * 2); x.moveTo(146, 204 - sm * 6); x.lineTo(150, 200 - sm * 6); x.lineWidth = 1.6; x.stroke();
    return;
  }
  if (custom && p.mouth === 'small') {
    // Tiny cat mouth, a little open.
    x.beginPath(); x.moveTo(116, 203); x.quadraticCurveTo(122, 212, 128, 204); x.quadraticCurveTo(134, 212, 140, 203); x.lineWidth = 2.4; x.stroke();
    x.beginPath(); x.ellipse(128, 209, 4, 3, 0, 0, Math.PI); x.fillStyle = '#c9544d'; x.fill();
    return;
  }
  if (kind === 'smirk') {
    x.beginPath(); x.moveTo(114, 206); x.quadraticCurveTo(130, 212, 146, 194); x.lineWidth = 3; x.stroke();
    x.beginPath(); x.moveTo(146, 194); x.lineTo(150, 190); x.lineWidth = 2; x.stroke();
    return;
  }
  if (kind === 'open') {
    x.beginPath(); x.ellipse(128, 206, 7, 9, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(128, 209, 4, 3, 0, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
    return;
  }
  if (kind === 'gritted') {
    rrect(x, 110, 198, 36, 14, 3);
    x.fillStyle = ink; x.fill();
    x.fillStyle = paper;
    for (let i = 0; i < 4; i++) { x.fillRect(114 + i * 8, 199, 5, 5); }
    return;
  }
  if (kind === 'down') {
    x.beginPath(); x.moveTo(116, 208); x.quadraticCurveTo(128, 200, 140, 209); x.lineWidth = 2.6; x.stroke();
    return;
  }
  switch (p.mouth) {
    case 'grin': {
      x.beginPath(); x.moveTo(110, 198); x.quadraticCurveTo(128, 200, 146, 198);
      x.quadraticCurveTo(138, 224, 128, 224); x.quadraticCurveTo(118, 224, 110, 198); x.closePath();
      x.fillStyle = ink; x.fill();
      x.beginPath(); x.moveTo(114, 200); x.lineTo(142, 200); x.lineTo(138, 206); x.lineTo(118, 206); x.closePath();
      x.fillStyle = paper; x.fill();
      break;
    }
    case 'thin': { x.beginPath(); x.moveTo(118, 205); x.lineTo(138, 205); x.lineWidth = 2.6; x.stroke(); break; }
    case 'flat': { x.beginPath(); x.moveTo(116, 206); x.lineTo(140, 206); x.lineWidth = 3; x.stroke(); break; }
    default: { x.beginPath(); x.moveTo(116, 200); x.quadraticCurveTo(128, 212, 140, 200); x.lineWidth = 2.8; x.stroke(); }
  }
}

function expressionMarks(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const ink = p.palette.ink;
  if (expr === 'shock') {
    x.beginPath(); x.moveTo(186, 100); x.quadraticCurveTo(196, 118, 186, 124); x.quadraticCurveTo(176, 118, 186, 100);
    x.fillStyle = p.palette.paper; x.fill(); x.lineWidth = 2; x.strokeStyle = ink; x.stroke();
  }
  if (expr === 'rage') {
    x.lineCap = 'round'; x.strokeStyle = ink; x.lineWidth = 2.4;
    for (const [dx, dy] of [[-6, -6], [6, -6], [0, 0]] as const) {
      x.beginPath(); x.moveTo(176 + dx - 4, 110 + dy); x.lineTo(176 + dx + 4, 110 + dy); x.stroke();
      x.beginPath(); x.moveTo(176 + dx, 106 + dy); x.lineTo(176 + dx, 114 + dy); x.stroke();
    }
  }
  if (expr === 'hollow') {
    x.save(); x.beginPath(); x.ellipse(128, 176, 58, 10, 0, 0, Math.PI * 2); x.clip(); hatch(x, 3, ink, 0.22, 1); x.restore();
  }
}

/** The clerk's blank card gets a small tell per expression: it tilts, and a corner darkens. */
function cardMarks(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const { ink, accent } = p.palette;
  x.save(); faceOutline(x, p.jaw); x.clip();
  x.strokeStyle = ink; x.lineCap = 'round';
  if (expr === 'shock') { x.lineWidth = 2; x.beginPath(); x.moveTo(104, 130); x.lineTo(104, 146); x.moveTo(152, 130); x.lineTo(152, 146); x.stroke(); }
  if (expr === 'rage') { x.lineWidth = 3; x.strokeStyle = '#c0392b'; x.beginPath(); x.moveTo(98, 126); x.lineTo(158, 118); x.stroke(); }
  if (expr === 'smirk') { x.lineWidth = 2; x.strokeStyle = accent; x.beginPath(); x.moveTo(110, 200); x.quadraticCurveTo(130, 208, 150, 192); x.stroke(); }
  if (expr === 'hollow') { x.globalAlpha = 0.5; hatch(x, 3, ink, 0.4, 1); }
  x.restore();
}

function faceCover(x: Ctx, p: PortraitSpec, expr: Expr): void {
  if (!has(p, 'mask')) return;
  const { ink, accent } = p.palette;
  // A full porcelain mask: smooth, expressionless, two narrow slits that tighten or widen with the mood.
  faceOutline(x, p.jaw);
  x.fillStyle = '#f5f2ea'; x.fill();
  x.save(); faceOutline(x, p.jaw); x.clip();
  x.beginPath(); x.moveTo(146, 60); x.quadraticCurveTo(160, 150, 150, 240); x.lineTo(230, 240); x.lineTo(230, 60); x.closePath();
  x.fillStyle = ink; x.globalAlpha = 0.08; x.fill(); x.globalAlpha = 1;
  hatch(x, 5, ink, 0.2, 1);
  x.restore();
  faceOutline(x, p.jaw); x.lineWidth = 3.4; x.strokeStyle = ink; x.stroke();
  // Brow ridge, nose line, cheek cracks.
  x.lineCap = 'round'; x.strokeStyle = ink; x.lineWidth = 1.6; x.globalAlpha = 0.6;
  x.beginPath(); x.moveTo(128, 130); x.lineTo(128, 176); x.quadraticCurveTo(122, 186, 118, 184); x.moveTo(128, 176); x.quadraticCurveTo(134, 186, 138, 184); x.stroke();
  x.beginPath(); x.moveTo(94, 190); x.lineTo(100, 200); x.moveTo(162, 190); x.lineTo(156, 200); x.stroke();
  x.globalAlpha = 1;
  mirrored((m) => {
    const ex = 128 + m * 26;
    const open = expr === 'shock' ? 5.4 : expr === 'hollow' ? 1.6 : expr === 'smirk' ? (m > 0 ? 2 : 3.4) : 2.8;
    const rot = expr === 'rage' ? m * -0.28 : m * 0.08;
    x.save(); x.translate(ex, 150); x.rotate(rot);
    x.beginPath(); x.ellipse(0, 0, 13, open, 0, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.restore();
    x.beginPath(); x.moveTo(ex - 14, 142); x.quadraticCurveTo(ex, 134, ex + 14, 142); x.lineWidth = 2; x.strokeStyle = ink; x.stroke();
  });
  // Mouth line painted on, small.
  x.beginPath(); x.moveTo(118, 206); x.lineTo(138, 206); x.lineWidth = 2; x.stroke();
  // Wax seal on the brow.
  x.beginPath(); x.moveTo(114, 112); x.arc(128, 112, 13, 0, Math.PI * 2); fillStroke(x, accent, ink, 2.2);
  star(x, 128, 112, 7); x.fillStyle = ink; x.fill();
  // Ties.
  x.strokeStyle = ink; x.lineWidth = 2.4; x.beginPath(); x.moveTo(79, 150); x.lineTo(60, 160); x.moveTo(177, 150); x.lineTo(196, 160); x.stroke();
}

function spectacles(x: Ctx, p: PortraitSpec): void {
  if (!has(p, 'spectacles')) return;
  const ink = p.palette.ink;
  x.lineWidth = 2.6; x.strokeStyle = ink;
  for (const s of [-1, 1]) {
    x.beginPath(); x.arc(128 + s * 26, 150, 15, 0, Math.PI * 2); x.stroke();
  }
  x.beginPath(); x.moveTo(114, 148); x.quadraticCurveTo(128, 142, 142, 148); x.stroke();
  x.beginPath(); x.moveTo(87, 146); x.lineTo(74, 142); x.moveTo(169, 146); x.lineTo(182, 142); x.stroke();
}

function sideburns(x: Ctx, p: PortraitSpec): void {
  if (!has(p, 'sideburns')) return;
  const { ink } = p.palette;
  const sharp = p.jaw === 'sharp';
  mirrored((m) => {
    const ex = EAR_X[p.jaw];
    x.beginPath();
    x.moveTo(128 + m * (ex + 1), 112); x.lineTo(128 + m * (ex - 4), 150);
    x.lineTo(128 + m * (ex - 3), sharp ? 198 : 176);
    x.lineTo(128 + m * (ex + 3), sharp ? 184 : 168); x.lineTo(128 + m * (ex + 6), 120); x.closePath();
    x.fillStyle = p.hairColor; x.fill(); x.lineWidth = 2.4; x.strokeStyle = ink; x.stroke();
  });
}

function headgear(x: Ctx, p: PortraitSpec): void {
  const { ink, paper, accent } = p.palette;
  if (has(p, 'goggles')) {
    // Brass goggles pushed up on the forehead, glass catching the light.
    x.beginPath(); x.moveTo(60, 120); x.quadraticCurveTo(128, 92, 196, 120); x.lineWidth = 11; x.lineCap = 'butt'; x.strokeStyle = '#2a1c12'; x.stroke();
    x.lineWidth = 2.6; x.strokeStyle = ink; x.beginPath(); x.moveTo(60, 114); x.quadraticCurveTo(128, 86, 196, 114); x.stroke(); x.beginPath(); x.moveTo(60, 126); x.quadraticCurveTo(128, 98, 196, 126); x.stroke();
    mirrored((m) => {
      x.beginPath(); x.arc(128 + m * 26, 104, 17, 0, Math.PI * 2); x.fillStyle = accent; x.fill(); x.lineWidth = 3.4; x.strokeStyle = ink; x.stroke();
      x.beginPath(); x.arc(128 + m * 26, 104, 11.5, 0, Math.PI * 2); x.fillStyle = '#8fb8c4'; x.fill(); x.lineWidth = 2; x.stroke();
      x.beginPath(); x.arc(128 + m * 26 - 3, 100, 4, 3.4, 5); x.lineWidth = 2.4; x.strokeStyle = '#ffffff'; x.stroke();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; x.beginPath(); x.arc(128 + m * 26 + Math.cos(a) * 14.4, 104 + Math.sin(a) * 14.4, 1.5, 0, Math.PI * 2); x.fillStyle = paper; x.fill(); }
    });
    x.beginPath(); x.moveTo(113, 104); x.lineTo(143, 104); x.lineWidth = 6; x.strokeStyle = accent; x.stroke(); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
  }
  if (has(p, 'hairclip')) {
    x.save(); x.translate(160, 86); x.rotate(0.5);
    rrect(x, -11, -4, 22, 8, 3); fillStroke(x, accent, ink, 2);
    x.beginPath(); x.arc(0, 0, 3, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill(); x.lineWidth = 1.2; x.stroke();
    x.restore();
  }
  if (has(p, 'ribbon')) {
    // A big yellow bow in the curls.
    x.save(); x.translate(172, 76); x.rotate(0.3);
    poly(x, [[0, 0], [-22, -14], [-22, 14]]); fillStroke(x, accent, ink, 2.4);
    poly(x, [[0, 0], [22, -14], [22, 14]]); fillStroke(x, accent, ink, 2.4);
    x.beginPath(); x.arc(0, 0, 5.4, 0, Math.PI * 2); fillStroke(x, accent, ink, 2.4);
    x.restore();
  }
}

// ── things held or worn in front of the body ──────────────────────────────────────────────────
function glove(x: Ctx, p: PortraitSpec, cx: number, cy: number, rot: number, flip: number, w: number, h: number): void {
  const { ink } = p.palette;
  x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(flip, 1);
  rrect(x, -w / 2, -h / 2, w, h, 17); fillStroke(x, '#fdfdfd', ink, 2.6);
  x.save(); rrect(x, -w / 2, -h / 2, w, h, 17); x.clip();
  x.fillStyle = '#9fb0c4'; x.globalAlpha = 0.28; x.fillRect(-w / 2, h * 0.05, w, h);
  x.globalAlpha = 1;
  x.strokeStyle = ink; x.lineWidth = 1.6; x.lineCap = 'round'; x.beginPath();
  for (let i = 1; i < 4; i++) { x.moveTo(-w / 2 + i * (w / 4), -h / 2 + 2); x.lineTo(-w / 2 + i * (w / 4) + 1, -h / 2 + h * 0.46); }
  x.stroke();
  x.restore();
  x.beginPath(); x.ellipse(-w / 2 + 3, h * 0.12, 8, 13, 0.4, 0, Math.PI * 2); fillStroke(x, '#fdfdfd', ink, 2.2);
  x.restore();
}

function frontAccessories(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper, accent, coat } = p.palette;
  const s = p.shoulders;
  for (const a of p.accessories) {
    switch (a) {
      case 'gloves': {
        // Sleeves meet in front, white gloved hands clasped over each other, jade cuffs.
        mirrored((m) => {
          bodySpace(x, 1, () => {
            poly(x, [[128 + m * 88, 296], [128 + m * 62, 286], [128 + m * 14, 334], [128 + m * 34, 372], [128 + m * 76, 340]]);
            fillStroke(x, coat, ink, 3);
            x.save(); poly(x, [[128 + m * 88, 296], [128 + m * 62, 286], [128 + m * 14, 334], [128 + m * 34, 372], [128 + m * 76, 340]]); x.clip(); hatch(x, 5, ink, 0.2, 1); x.restore();
            x.beginPath(); x.moveTo(128 + m * 14, 334); x.lineTo(128 + m * 34, 372); x.lineWidth = 8; x.strokeStyle = accent; x.stroke();
            x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
          });
        });
        glove(x, p, 118, 346, -0.25, 1, 56, 44);
        glove(x, p, 142, 340, 0.2, -1, 58, 46);
        break;
      }
      case 'gauge': {
        // Brass chest gauge on a plate with pipe stubs; the needle sits in the red.
        const cy = 306, r = 32;
        bodySpace(x, 1, () => { rrect(x, 128 - 64, cy - 10, 128, 20, 6); fillStroke(x, '#5a3a1e', ink, 3); });
        for (const m of [-1, 1]) { x.beginPath(); x.arc(128 + m * 56, cy, 5, 0, Math.PI * 2); fillStroke(x, accent, ink, 2); }
        x.beginPath(); x.arc(128, cy, r, 0, Math.PI * 2); fillStroke(x, accent, ink, 4);
        x.beginPath(); x.arc(128, cy, r - 6, 0, Math.PI * 2); fillStroke(x, '#f6efdd', ink, 2);
        x.beginPath(); x.arc(128, cy, r - 9, Math.PI * 0.8, Math.PI * 2.2); x.lineWidth = 5; x.strokeStyle = '#3b8a54'; x.stroke();
        x.beginPath(); x.arc(128, cy, r - 9, Math.PI * 1.85, Math.PI * 2.2); x.lineWidth = 5; x.strokeStyle = '#c0392b'; x.stroke();
        x.lineWidth = 1.6; x.strokeStyle = ink; x.lineCap = 'round';
        for (let i = 0; i <= 8; i++) { const an = Math.PI * (0.8 + i * 0.175); x.beginPath(); x.moveTo(128 + Math.cos(an) * (r - 8), cy + Math.sin(an) * (r - 8)); x.lineTo(128 + Math.cos(an) * (r - 13), cy + Math.sin(an) * (r - 13)); x.stroke(); }
        x.lineWidth = 3; x.beginPath(); x.moveTo(128, cy); x.lineTo(128 + Math.cos(Math.PI * 1.95) * (r - 11), cy + Math.sin(Math.PI * 1.95) * (r - 11)); x.stroke();
        x.beginPath(); x.arc(128, cy, 3.6, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
        x.beginPath(); x.arc(114, cy - 14, 4, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.globalAlpha = 0.7; x.fill(); x.globalAlpha = 1;
        // Crossed forearms with rolled sleeves: big, soot-smudged.
        const arm = (m: number): void => {
          x.save(); x.translate(128, 358); x.rotate(m * -0.07); x.scale(m, 1);
          rrect(x, -118, -22, 190, 44, 20); fillStroke(x, p.skin, ink, 3.6);
          x.save(); rrect(x, -118, -22, 190, 44, 20); x.clip(); hatch(x, 4, ink, 0.28, 1.1);
          x.strokeStyle = ink; x.globalAlpha = 0.5; x.lineWidth = 2.6; x.lineCap = 'round'; x.beginPath(); x.moveTo(-60, -6); x.lineTo(-36, 4); x.moveTo(-30, 8); x.lineTo(-8, 14); x.moveTo(10, -12); x.lineTo(30, -4); x.stroke(); x.restore();
          // rolled sleeve: a fat cuff with fold lines
          rrect(x, -124, -28, 50, 56, 12); fillStroke(x, coat, ink, 3.6);
          x.beginPath(); x.moveTo(-108, -26); x.lineTo(-108, 26); x.moveTo(-92, -26); x.lineTo(-92, 26); x.lineWidth = 2; x.stroke();
          x.beginPath(); x.moveTo(-72, -24); x.lineTo(-72, 24); x.lineWidth = 5; x.strokeStyle = accent; x.stroke();
          x.restore();
        };
        arm(1); arm(-1);
        for (const m of [-1, 1]) { x.beginPath(); x.arc(128 + m * 20, 352, 20, 0, Math.PI * 2); fillStroke(x, p.skin, ink, 3.6); x.beginPath(); x.moveTo(128 + m * 12, 342); x.lineTo(128 + m * 12, 362); x.moveTo(128 + m * 24, 340); x.lineTo(128 + m * 24, 360); x.lineWidth = 1.6; x.stroke(); }
        break;
      }
      case 'watch': {
        // Chain from a lapel buttonhole in a long swag to a cracked pocket watch.
        const wx = 180, wy = 334;
        x.lineCap = 'round';
        x.beginPath(); x.moveTo(94, 292); x.quadraticCurveTo(112, 352, 166, 340);
        x.lineWidth = 5; x.strokeStyle = ink; x.stroke();
        x.setLineDash([4, 2.5]); x.lineWidth = 3; x.strokeStyle = GOLD; x.stroke(); x.setLineDash([]);
        x.beginPath(); x.arc(94, 292, 4, 0, Math.PI * 2); fillStroke(x, GOLD, ink, 1.8);
        x.save(); x.translate(wx, wy); x.rotate(0.3);
        x.beginPath(); x.arc(0, -29, 5.4, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = ink; x.stroke(); x.lineWidth = 1.4; x.strokeStyle = GOLD; x.stroke();
        rrect(x, -4, -28, 8, 8, 2); fillStroke(x, GOLD, ink, 1.8);
        x.beginPath(); x.arc(0, 0, 24, 0, Math.PI * 2); fillStroke(x, GOLD, ink, 3.4);
        x.beginPath(); x.arc(0, 0, 20, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.8);
        x.beginPath(); x.arc(0, 0, 17, 0, Math.PI * 2); fillStroke(x, '#f8f2e2', ink, 1.8);
        x.lineWidth = 1.6; x.lineCap = 'round';
        for (let i = 0; i < 12; i++) { const an = (i / 12) * Math.PI * 2; x.beginPath(); x.moveTo(Math.cos(an) * 13.5, Math.sin(an) * 13.5); x.lineTo(Math.cos(an) * 16, Math.sin(an) * 16); x.stroke(); }
        x.lineWidth = 2.4; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -10); x.moveTo(0, 0); x.lineTo(7, 4); x.stroke();
        // The crack: a jagged split with a branch, and one chipped wedge of glass.
        x.beginPath(); x.moveTo(15, -21); x.lineTo(8, -10); x.lineTo(11, -4); x.lineTo(2, 4); x.lineTo(5, 10); x.lineTo(-4, 20);
        x.lineWidth = 2; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.moveTo(2, 4); x.lineTo(-9, 2); x.moveTo(8, -10); x.lineTo(18, -8); x.lineWidth = 1.2; x.stroke();
        x.beginPath(); x.moveTo(11, -4); x.lineTo(18, 6); x.lineTo(5, 10); x.lineTo(2, 4); x.closePath(); x.fillStyle = '#ffffff'; x.globalAlpha = 0.55; x.fill(); x.globalAlpha = 1;
        x.restore();
        break;
      }
      case 'key': {
        // The Manager's Key on a V of chain: a big gold bow with a trefoil, long shaft, toothed bit.
        x.lineCap = 'round';
        x.beginPath(); x.moveTo(108, 262); x.quadraticCurveTo(116, 318, 128, 326); x.quadraticCurveTo(140, 318, 148, 262);
        x.lineWidth = 4.4; x.strokeStyle = ink; x.stroke();
        x.setLineDash([3.4, 2.4]); x.lineWidth = 2.6; x.strokeStyle = accent; x.stroke(); x.setLineDash([]);
        x.beginPath(); x.arc(128, 330, 4, 0, Math.PI * 2); fillStroke(x, accent, ink, 1.6);
        x.beginPath(); x.moveTo(128, 340); x.lineTo(128, 384); x.lineWidth = 8; x.strokeStyle = ink; x.stroke();
        x.lineWidth = 4.6; x.strokeStyle = accent; x.stroke();
        for (const [ox, oy] of [[0, -10], [-9, 4], [9, 4]] as const) { x.beginPath(); x.arc(128 + ox, 346 + oy, 6.4, 0, Math.PI * 2); fillStroke(x, accent, ink, 2.4); }
        x.beginPath(); x.arc(128, 346, 8, 0, Math.PI * 2); fillStroke(x, accent, ink, 2.8);
        x.beginPath(); x.arc(128, 346, 3.4, 0, Math.PI * 2); fillStroke(x, '#2b2d36', ink, 1.4);
        x.beginPath(); x.rect(128, 366, 14, 6); x.rect(128, 376, 10, 6); fillStroke(x, accent, ink, 1.8);
        x.beginPath(); x.arc(125, 344, 2, 0, Math.PI * 2); x.fillStyle = '#fff3c4'; x.fill();
        break;
      }
      case 'reels': {
        // Two tape reels on straps, a loop of tape between them and a loose end curling down.
        const reel = (cx: number, cy: number): void => {
          x.beginPath(); x.arc(cx, cy, 27, 0, Math.PI * 2); fillStroke(x, '#1c1d1e', ink, 3);
          x.beginPath(); x.arc(cx, cy, 21, 0, Math.PI * 2); x.fillStyle = '#4a3a2c'; x.fill();
          x.beginPath(); x.arc(cx, cy, 12, 0, Math.PI * 2); fillStroke(x, '#d6d6d3', ink, 2);
          for (let i = 0; i < 3; i++) { const an = i * 2.094 + 0.5; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, 12, an, an + 0.8); x.closePath(); x.fillStyle = '#1c1d1e'; x.fill(); }
          x.beginPath(); x.arc(cx, cy, 3.4, 0, Math.PI * 2); x.fillStyle = accent; x.fill(); x.lineWidth = 1.2; x.strokeStyle = ink; x.stroke();
          x.beginPath(); x.arc(cx, cy, 24, 3.6, 4.7); x.lineWidth = 2; x.strokeStyle = paper; x.globalAlpha = 0.6; x.stroke(); x.globalAlpha = 1;
        };
        x.lineCap = 'round';
        for (const m of [-1, 1]) { x.beginPath(); x.moveTo(128 + m * 40, 264); x.quadraticCurveTo(128 + m * 74, 280, 128 + m * 62, 308); x.lineWidth = 6; x.strokeStyle = ink; x.stroke(); x.lineWidth = 2.4; x.strokeStyle = paper; x.stroke(); }
        x.beginPath(); x.moveTo(128 - 58, 352); x.quadraticCurveTo(128, 398, 128 + 58, 352); x.lineWidth = 7; x.strokeStyle = ink; x.stroke(); x.lineWidth = 4.4; x.strokeStyle = "#6a5a4a"; x.stroke();
        reel(128 - 58, 334); reel(128 + 58, 334);
        x.beginPath(); x.moveTo(128 + 80, 346); x.quadraticCurveTo(128 + 98, 360, 128 + 88, 376); x.quadraticCurveTo(128 + 80, 384, 128 + 90, 384);
        x.lineWidth = 6; x.strokeStyle = ink; x.stroke(); x.lineWidth = 3.4; x.strokeStyle = '#6a5a4a'; x.stroke();
        break;
      }
      case 'seal': {
        // Big scalloped wax seal on the chest, two red ribbons below.
        x.beginPath(); x.moveTo(116, 350); x.lineTo(104, 384); x.lineTo(116, 376); x.lineTo(124, 384); x.lineTo(130, 352); x.closePath(); fillStroke(x, accent, ink, 2);
        x.beginPath(); x.moveTo(140, 350); x.lineTo(152, 384); x.lineTo(140, 376); x.lineTo(132, 384); x.lineTo(126, 352); x.closePath(); fillStroke(x, '#7a1620', ink, 2);
        const cx = 128, cy = 338;
        x.beginPath(); for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; x.arc(cx + Math.cos(an) * 21, cy + Math.sin(an) * 21, 7, 0, Math.PI * 2); }
        x.fillStyle = accent; x.fill(); x.lineWidth = 2.4; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.arc(cx, cy, 21, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
        x.beginPath(); x.arc(cx, cy, 15, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = '#5e1019'; x.stroke();
        star(x, cx, cy, 10); x.fillStyle = '#5e1019'; x.fill(); x.lineWidth = 1.2; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.arc(cx - 9, cy - 11, 3.4, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.globalAlpha = 0.45; x.fill(); x.globalAlpha = 1;
        break;
      }
      case 'ledger': {
        // An open ledger held at the chest with a red ribbon marker.
        x.save(); x.translate(128, 350);
        poly(x, [[-80, -22], [-2, -14], [-2, 40], [-86, 34]]); fillStroke(x, '#fbf8ee', ink, 2.6);
        poly(x, [[80, -22], [2, -14], [2, 40], [86, 34]]); fillStroke(x, '#fbf8ee', ink, 2.6);
        x.beginPath(); x.moveTo(-90, 36); x.lineTo(-4, 44); x.lineTo(4, 44); x.lineTo(90, 36); x.lineWidth = 3.4; x.strokeStyle = coat; x.stroke(); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
        x.lineWidth = 1; x.strokeStyle = accent; x.globalAlpha = 0.6; x.beginPath();
        for (let k = 0; k < 5; k++) { x.moveTo(-74, -14 + k * 9 + k * 0.4); x.lineTo(-8, -8 + k * 10); x.moveTo(74, -14 + k * 9 + k * 0.4); x.lineTo(8, -8 + k * 10); } x.stroke(); x.globalAlpha = 1;
        x.beginPath(); x.moveTo(0, -14); x.lineTo(0, 44); x.lineWidth = 2.4; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.moveTo(5, -12); x.lineTo(6, 42); x.lineWidth = 3; x.strokeStyle = '#c0392b'; x.stroke();
        x.restore();
        break;
      }
      case 'tag': {
        // A lost-and-found tag on a string from the collar.
        x.beginPath(); x.moveTo(150, 284); x.quadraticCurveTo(168, 300, 168, 318); x.lineWidth = 2; x.strokeStyle = '#c0392b'; x.stroke();
        x.save(); x.translate(170, 338); x.rotate(0.18);
        poly(x, [[-13, -20], [13, -20], [13, 18], [0, 26], [-13, 18]]); fillStroke(x, '#fffdf2', ink, 2.4);
        x.beginPath(); x.arc(0, -13, 3, 0, Math.PI * 2); x.stroke();
        x.fillStyle = ink; x.font = 'bold 22px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('?', 0, 12);
        x.restore();
        // Sleeves that swallow the hands, fingertips peeking.
        mirrored((m) => {
          x.save(); x.translate(128 + m * 82 * s, 330); x.rotate(m * -0.1);
          rrect(x, -22, -34, 44, 78, 16); fillStroke(x, coat, ink, 3);
          x.save(); rrect(x, -22, -34, 44, 78, 16); x.clip(); hatch(x, 5, ink, 0.18, 1); x.restore();
          rrect(x, -24, 24, 48, 18, 6); fillStroke(x, accent, ink, 2.6);
          for (let k = -1; k <= 1; k++) { x.beginPath(); x.arc(k * 10, 46, 5.4, 0, Math.PI * 2); fillStroke(x, p.skin, ink, 2); }
          x.restore();
        });
        break;
      }
      default: break;
    }
  }
  void rnd;
}

function bottomFade(x: Ctx, p: PortraitSpec): void {
  const ink = p.palette.ink;
  x.save(); x.beginPath(); x.rect(0, 350, PW, PH - 350); x.clip();
  dots(x, 6, ink, 0.3, (px, py) => (py - 350) / 34 * 1.9);
  x.restore();
}

function rainOverlay(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  if (!has(p, 'rainfx')) return;
  const { ink, paper } = p.palette;
  x.save(); x.strokeStyle = paper; x.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const rx = 24 + rnd() * 208, ry = rnd() * PH, len = 14 + rnd() * 24;
    x.globalAlpha = 0.5 + rnd() * 0.4; x.lineWidth = 1.2 + rnd() * 1.4;
    x.beginPath(); x.moveTo(rx, ry); x.lineTo(rx - len * 0.28, ry + len); x.stroke();
  }
  x.restore();
  // Drips running off the hood rim.
  for (const [dx, dy] of [[62, 238], [196, 226], [88, 252], [168, 246]] as const) {
    x.beginPath(); x.moveTo(dx, dy - 8); x.quadraticCurveTo(dx + 5, dy + 2, dx, dy + 6); x.quadraticCurveTo(dx - 5, dy + 2, dx, dy - 8);
    x.fillStyle = '#e8e8e6'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
  }
}

function draw(id: string, expr: Expr): HTMLCanvasElement {
  const p = portraitSpec(id);
  const cv = document.createElement('canvas');
  cv.width = PW; cv.height = PH;
  const x = cv.getContext('2d');
  if (!x) return cv;
  // Line weight: every lineWidth the pieces set is scaled by the spec's multiplier.
  const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'lineWidth');
  if (desc && desc.get && desc.set && p.line !== 1) {
    const get = desc.get, set = desc.set;
    Object.defineProperty(x, 'lineWidth', {
      configurable: true,
      get() { return (get.call(x) as number) / p.line; },
      set(v: number) { set.call(x, v * p.line); },
    });
  }
  const rnd = seeded(hash(id));
  background(x, p, rnd);
  bodyBack(x, p);
  body(x, p);
  headSpace(x, p, () => hairBack(x, p, rnd));
  neck(x, p);
  neckwear(x, p);
  headSpace(x, p, () => {
    const blank = has(p, 'blankcard');
    ears(x, p);
    face(x, p);
    soot(x, p);
    skinDetails(x, p, rnd);
    if (blank) {
      cardMarks(x, p, expr);
    } else {
      eyes(x, p, expr);
      browsAll(x, p, expr);
      nose(x, p);
      mouth(x, p, expr);
      expressionMarks(x, p, expr);
    }
    spectacles(x, p);
    sideburns(x, p);
    hairFront(x, p, rnd);
    faceCover(x, p, expr);
    headgear(x, p);
  });
  bottomFade(x, p);
  frontAccessories(x, p, rnd);
  rainOverlay(x, p, rnd);
  return cv;
}

const cache = new Map<string, HTMLCanvasElement>();
const srcCache = new Map<string, string>();

/** Cached portrait canvas for a rival (or 'notary', 'clerk', 'you') in an expression. Shared: do not append it. */
export function portrait(rivalId: string, expr: Expr = 'calm'): HTMLCanvasElement {
  const key = `${rivalId}|${expr}`;
  let c = cache.get(key);
  if (!c) { c = draw(rivalId, expr); cache.set(key, c); }
  return c;
}

/** Cached PNG data URL for <img> use. */
export function portraitSrc(rivalId: string, expr: Expr = 'calm'): string {
  const key = `${rivalId}|${expr}`;
  let s = srcCache.get(key);
  if (s === undefined) { s = portrait(rivalId, expr).toDataURL('image/png'); srcCache.set(key, s); }
  return s;
}

/** Whether an id has a dedicated spec (the rest render as the plain Mark). */
export function hasPortrait(id: string): boolean { return id in SPECS; }
