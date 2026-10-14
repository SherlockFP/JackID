/**
 * Procedural anime portraits (256 x 384, canvas). Each portrait is built from a small spec (hair preset, eyes, mouth,
 * accessories, palette ink / paper / accent) and one of five expressions. Shading is hatch lines on the shadow side and
 * a halftone fade on the coat and halo. Results are cached per rival and expression.
 *
 * The canvas returned by `portrait()` is shared: draw it, never append it. `portraitSrc()` gives a data URL for <img>.
 */

export type Expr = 'calm' | 'smirk' | 'shock' | 'rage' | 'hollow';
export const EXPRESSIONS: readonly Expr[] = ['calm', 'smirk', 'shock', 'rage', 'hollow'];

export type HairStyle = 'bob' | 'buzz' | 'swept' | 'messy' | 'slick' | 'hood' | 'bun';
export type EyeStyle = 'closed' | 'wide' | 'predator' | 'round' | 'hollow' | 'tired' | 'plain' | 'masked';
export type MouthStyle = 'soft' | 'grin' | 'thin' | 'flat';
export type Accessory =
  | 'gloves' | 'gauge' | 'ringcoat' | 'watch' | 'collarwide' | 'key' | 'reels'
  | 'seal' | 'spectacles' | 'ledger' | 'mask';

export interface PortraitSpec {
  hair: HairStyle;
  hairColor: string;
  skin: string;
  eyes: EyeStyle;
  mouth: MouthStyle;
  accessories: Accessory[];
  soot?: boolean;
  palette: { ink: string; paper: string; accent: string; coat: string };
}

const SPECS: Record<string, PortraitSpec> = {
  // Silver bob, white gloves, jade accent. Eyes stay closed until she is surprised.
  tamsin: {
    hair: 'bob', hairColor: '#c9ccd6', skin: '#f3e6d8', eyes: 'closed', mouth: 'soft', accessories: ['gloves'],
    palette: { ink: '#15131c', paper: '#f1ece2', accent: '#2aa57c', coat: '#dfe6e2' },
  },
  // Cropped soot-streaked hair, cup-brass accent, chest gauge. Wide eyes, laughing mouth.
  kuro: {
    hair: 'buzz', hairColor: '#2a2420', skin: '#c99a7a', eyes: 'wide', mouth: 'grin', accessories: ['gauge'], soot: true,
    palette: { ink: '#161210', paper: '#efe6d8', accent: '#d9822b', coat: '#3b2f26' },
  },
  // Swept hair, black ringmaster coat, red accent, pocket watch. Predator eyes, one pupil dilated.
  lucan: {
    hair: 'swept', hairColor: '#1d1a22', skin: '#e8d2bf', eyes: 'predator', mouth: 'thin', accessories: ['ringcoat', 'watch'],
    palette: { ink: '#0e0c12', paper: '#f4ecdf', accent: '#c8283a', coat: '#1f1a24' },
  },
  // Wild curls, oversized collar, yellow accent. Round, cheerful eyes.
  mimosa: {
    hair: 'messy', hairColor: '#3a2a1a', skin: '#e9c7a6', eyes: 'round', mouth: 'grin', accessories: ['collarwide'],
    palette: { ink: '#14110d', paper: '#f6efd9', accent: '#e6c229', coat: '#b8a57a' },
  },
  // Grey combed hair, tailcoat, Manager's Key on a chain, gold accent. Hollow eyes.
  orrin: {
    hair: 'slick', hairColor: '#8e8f96', skin: '#dcc3ae', eyes: 'hollow', mouth: 'thin', accessories: ['key'],
    palette: { ink: '#101114', paper: '#e7e5df', accent: '#c9a04a', coat: '#4a4d55' },
  },
  // Rain hood, reels, greyscale. Tired, half-lidded eyes.
  vell: {
    hair: 'hood', hairColor: '#2b2b2b', skin: '#d6d2cc', eyes: 'tired', mouth: 'flat', accessories: ['reels'],
    palette: { ink: '#0b0b0b', paper: '#d8d8d4', accent: '#8a8a8a', coat: '#5c5c5c' },
  },
  // Slicked hair, half mask, sealed wax at the lapel. Only the slits show.
  notary: {
    hair: 'slick', hairColor: '#15131c', skin: '#e6d1bc', eyes: 'masked', mouth: 'thin', accessories: ['mask', 'seal'],
    palette: { ink: '#0b0d18', paper: '#efe9dc', accent: '#8c1d2a', coat: '#1b1f33' },
  },
  // Hair in a bun, round spectacles, ledger pin. The only unmasked witness.
  clerk: {
    hair: 'bun', hairColor: '#5a3f2e', skin: '#f0d6bf', eyes: 'plain', mouth: 'soft', accessories: ['spectacles', 'ledger'],
    palette: { ink: '#111418', paper: '#f2efe7', accent: '#3a6ea5', coat: '#2f3b4c' },
  },
  // The player: a debtor in a cheap suit.
  you: {
    hair: 'slick', hairColor: '#4a3626', skin: '#eccaa9', eyes: 'plain', mouth: 'flat', accessories: [],
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

function faceOutline(x: Ctx): void {
  x.beginPath();
  x.moveTo(128, 84);
  x.bezierCurveTo(176, 84, 181, 128, 177, 160);
  x.bezierCurveTo(173, 196, 152, 220, 128, 224);
  x.bezierCurveTo(104, 220, 83, 196, 79, 160);
  x.bezierCurveTo(75, 128, 80, 84, 128, 84);
  x.closePath();
}

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

// ── pieces ─────────────────────────────────────────────────────────────────────────────────────
function background(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper, accent } = p.palette;
  x.fillStyle = paper; x.fillRect(0, 0, PW, PH);
  // Focus lines radiating from the head.
  x.save(); x.strokeStyle = ink; x.globalAlpha = 0.11; x.lineWidth = 1.4;
  x.beginPath();
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + rnd() * 0.05;
    const r0 = 118 + rnd() * 10;
    x.moveTo(128 + Math.cos(a) * r0, 150 + Math.sin(a) * r0);
    x.lineTo(128 + Math.cos(a) * 420, 150 + Math.sin(a) * 420);
  }
  x.stroke(); x.restore();
  // Accent halo with an ink ring and a halftone rim.
  x.beginPath(); x.arc(128, 150, 102, 0, Math.PI * 2);
  x.fillStyle = accent; x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
  dots(x, 6, ink, 0.32, (px, py) => {
    const d = Math.hypot(px - 128, py - 150);
    return d > 102 && d < 128 ? 2.6 * (1 - (d - 102) / 26) : 0;
  });
  x.beginPath(); x.arc(128, 150, 102, 0, Math.PI * 2);
  x.strokeStyle = ink; x.lineWidth = 3; x.stroke();
}

function body(x: Ctx, p: PortraitSpec): void {
  const { ink, paper, accent, coat } = p.palette;
  bodyOutline(x);
  x.fillStyle = coat; x.fill();
  // Shirt V and lapels.
  x.beginPath();
  x.moveTo(110, 266); x.lineTo(128, 330); x.lineTo(146, 266); x.closePath();
  x.fillStyle = paper; x.fill();
  x.lineCap = 'round'; x.strokeStyle = ink; x.lineWidth = 2.6;
  x.beginPath();
  x.moveTo(104, 268); x.lineTo(126, 330); x.moveTo(152, 268); x.lineTo(130, 330);
  x.stroke();
  // Tie.
  x.beginPath();
  x.moveTo(124, 322); x.lineTo(132, 322); x.lineTo(134, 352); x.lineTo(128, 364); x.lineTo(122, 352); x.closePath();
  x.fillStyle = accent; x.fill(); x.lineWidth = 1.8; x.stroke();
  // Shoulder shading.
  x.save(); bodyOutline(x); x.clip();
  hatch(x, 5, ink, 0.22, 1.1);
  x.restore();
  bodyOutline(x); x.strokeStyle = ink; x.lineWidth = 3.2; x.stroke();
}

function bodyBack(x: Ctx, p: PortraitSpec): void {
  const { ink, accent, coat } = p.palette;
  for (const a of p.accessories) {
    if (a === 'collarwide') {
      for (const s of [-1, 1]) {
        x.beginPath();
        x.moveTo(128 + s * 16, 270); x.lineTo(128 + s * 74, 292); x.lineTo(128 + s * 68, 326); x.lineTo(128 + s * 24, 302);
        x.closePath();
        x.fillStyle = coat; x.fill(); x.lineWidth = 3; x.strokeStyle = ink; x.stroke();
        x.beginPath();
        x.moveTo(128 + s * 26, 292); x.lineTo(128 + s * 62, 302);
        x.strokeStyle = accent; x.lineWidth = 4; x.stroke();
      }
    }
    if (a === 'ringcoat') {
      for (const s of [-1, 1]) {
        x.beginPath();
        x.moveTo(128 + s * 16, 268); x.lineTo(128 + s * 34, 226); x.lineTo(128 + s * 6, 244); x.closePath();
        x.fillStyle = ink; x.fill();
      }
    }
    if (a === 'reels') {
      x.strokeStyle = ink; x.lineWidth = 2;
      for (const s of [-1, 1]) {
        x.beginPath(); x.moveTo(128 + s * 70, 300); x.quadraticCurveTo(128 + s * 40, 330, 128, 352); x.stroke();
      }
    }
  }
}

function neck(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  const sk = p.skin;
  x.beginPath();
  x.moveTo(111, 206); x.lineTo(112, 276); x.lineTo(144, 276); x.lineTo(145, 206); x.closePath();
  x.fillStyle = sk; x.fill();
  x.save();
  x.beginPath(); x.moveTo(111, 206); x.lineTo(112, 276); x.lineTo(144, 276); x.lineTo(145, 206); x.closePath(); x.clip();
  x.beginPath(); x.ellipse(128, 220, 26, 18, 0, 0, Math.PI * 2); x.fillStyle = ink; x.globalAlpha = 0.42; x.fill(); x.globalAlpha = 1;
  hatch(x, 3.5, ink, 0.3, 1);
  x.restore();
}

function ears(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  for (const s of [-1, 1]) {
    x.beginPath(); x.ellipse(128 + s * 50, 160, 8, 14, 0, 0, Math.PI * 2);
    x.fillStyle = p.skin; x.fill(); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
  }
}

function face(x: Ctx, p: PortraitSpec): void {
  const { ink } = p.palette;
  faceOutline(x);
  x.fillStyle = p.skin; x.fill();
  // Shadow side: hatch on the right cheek and jaw.
  x.save(); faceOutline(x); x.clip();
  x.beginPath(); x.moveTo(146, 60); x.quadraticCurveTo(160, 150, 150, 240); x.lineTo(230, 240); x.lineTo(230, 60); x.closePath();
  x.fillStyle = ink; x.globalAlpha = 0.08; x.fill(); x.globalAlpha = 1;
  hatch(x, 4.2, ink, 0.34, 1.2);
  x.restore();
  faceOutline(x); x.strokeStyle = ink; x.lineWidth = 3.4; x.stroke();
}

function soot(x: Ctx, p: PortraitSpec): void {
  if (!p.soot) return;
  const { ink } = p.palette;
  x.save(); x.strokeStyle = ink; x.lineCap = 'round';
  const streaks: [number, number, number, number, number][] = [
    [92, 104, 104, 134, 5], [100, 116, 112, 148, 3], [154, 100, 168, 132, 5], [162, 126, 176, 160, 3],
    [120, 92, 116, 110, 4], [138, 90, 146, 104, 3], [86, 178, 98, 196, 3], [166, 176, 160, 194, 4],
  ];
  for (const [x0, y0, x1, y1, w] of streaks) {
    x.globalAlpha = 0.5; x.lineWidth = w;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  }
  x.restore();
}

function hairBack(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper } = p.palette;
  const hc = p.hairColor;
  x.lineWidth = 3.2; x.strokeStyle = ink; x.lineJoin = 'round';
  switch (p.hair) {
    case 'bob': {
      x.beginPath();
      x.moveTo(128, 50);
      x.bezierCurveTo(198, 46, 208, 120, 198, 176);
      x.lineTo(202, 216); x.quadraticCurveTo(128, 240, 54, 216);
      x.lineTo(58, 176);
      x.bezierCurveTo(48, 120, 58, 46, 128, 50);
      x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip();
      hatch(x, 6, ink, 0.18, 1);
      x.restore();
      break;
    }
    case 'hood': {
      x.beginPath();
      x.moveTo(34, PH); x.bezierCurveTo(30, 170, 44, 36, 128, 30); x.bezierCurveTo(212, 36, 226, 170, 222, PH); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.beginPath(); x.moveTo(40, PH); x.bezierCurveTo(38, 170, 50, 46, 128, 40); x.bezierCurveTo(206, 46, 218, 170, 216, PH); x.closePath();
      x.lineWidth = 2; x.strokeStyle = paper; x.globalAlpha = 0.5; x.stroke(); x.restore();
      x.save(); x.beginPath(); x.moveTo(34, PH); x.bezierCurveTo(30, 170, 44, 36, 128, 30); x.bezierCurveTo(212, 36, 226, 170, 222, PH); x.closePath(); x.clip();
      hatch(x, 5, ink, 0.2, 1);
      x.restore();
      break;
    }
    case 'bun': {
      x.beginPath(); x.arc(128, 48, 22, 0, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      x.beginPath(); x.ellipse(128, 118, 74, 66, 0, Math.PI, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    case 'messy': {
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI + (i / 12) * Math.PI;
        const cx = 128 + Math.cos(a) * (66 + rnd() * 6);
        const cy = 118 + Math.sin(a) * (62 + rnd() * 6);
        x.beginPath(); x.arc(cx, cy, 15 + rnd() * 6, 0, Math.PI * 2);
        x.fillStyle = hc; x.fill(); x.stroke();
      }
      x.beginPath(); x.ellipse(128, 118, 70, 62, 0, 0, Math.PI * 2); x.fillStyle = hc; x.fill();
      break;
    }
    case 'buzz': {
      x.beginPath(); x.ellipse(128, 104, 60, 46, 0, Math.PI, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    case 'swept': {
      x.beginPath();
      x.moveTo(74, 146);
      x.bezierCurveTo(56, 66, 200, 60, 182, 146);
      x.lineTo(186, 150); x.lineTo(70, 150); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
    case 'slick': {
      x.beginPath();
      x.moveTo(72, 150); x.bezierCurveTo(64, 56, 192, 56, 184, 150); x.lineTo(178, 148); x.lineTo(78, 148); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
  }
}

function hairFront(x: Ctx, p: PortraitSpec, rnd: () => number): void {
  const { ink, paper } = p.palette;
  const hc = p.hairColor;
  x.lineWidth = 3; x.strokeStyle = ink; x.lineJoin = 'round';
  switch (p.hair) {
    case 'bob': {
      x.beginPath();
      x.moveTo(70, 152); x.quadraticCurveTo(64, 70, 128, 58); x.quadraticCurveTo(192, 70, 186, 152);
      x.lineTo(176, 112); x.quadraticCurveTo(140, 96, 96, 118); x.quadraticCurveTo(84, 130, 78, 152);
      x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.lineWidth = 1.3; x.globalAlpha = 0.45;
      for (let i = 0; i < 5; i++) {
        const sx = 100 + i * 14;
        x.beginPath(); x.moveTo(sx, 74 + rnd() * 6); x.quadraticCurveTo(sx + 8, 96, sx - 2 + i, 112 - i); x.stroke();
      }
      x.globalAlpha = 1;
      break;
    }
    case 'buzz': {
      x.beginPath(); x.moveTo(76, 146); x.quadraticCurveTo(128, 96, 180, 146);
      x.lineTo(176, 152); x.quadraticCurveTo(128, 104, 80, 152); x.closePath();
      x.fillStyle = hc; x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
      break;
    }
    case 'swept': {
      x.beginPath();
      x.moveTo(84, 112); x.quadraticCurveTo(142, 78, 190, 102); x.lineTo(180, 124); x.quadraticCurveTo(136, 102, 92, 132); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      x.save(); x.clip(); hatch(x, 4, ink, 0.25, 1); x.restore();
      break;
    }
    case 'messy': {
      for (let i = 0; i < 4; i++) {
        const cx = 96 + i * 21, cy = 92 + (i % 2) * 8;
        x.beginPath(); x.arc(cx, cy, 11 + rnd() * 3, 0, Math.PI * 2); x.fillStyle = hc; x.fill(); x.stroke();
      }
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
      // The hood frames the face; a rain-shine stroke on the brim.
      x.beginPath(); x.moveTo(52, 170); x.quadraticCurveTo(70, 82, 128, 60); x.quadraticCurveTo(186, 82, 204, 170);
      x.lineWidth = 2; x.strokeStyle = paper; x.globalAlpha = 0.35; x.stroke(); x.globalAlpha = 1;
      break;
    }
    case 'bun': {
      x.beginPath(); x.moveTo(76, 146); x.quadraticCurveTo(84, 76, 128, 70); x.quadraticCurveTo(176, 76, 180, 146);
      x.lineTo(176, 130); x.quadraticCurveTo(128, 88, 80, 130); x.closePath();
      x.fillStyle = hc; x.fill(); x.stroke();
      break;
    }
  }
}

function brow(x: Ctx, p: PortraitSpec, side: number, y0: number, tilt: number): void {
  x.beginPath();
  x.moveTo(128 + side * 14, y0 + tilt * 12);
  x.quadraticCurveTo(128 + side * 28, y0 - 9 - tilt * 2, 128 + side * 42, y0 - 3 + tilt * -2);
  x.lineCap = 'round'; x.lineWidth = 4.2; x.strokeStyle = p.palette.ink; x.stroke();
}

interface Mood { lid: [number, number]; brow: number; tilt: number; mouth: 'open' | 'smirk' | 'gritted' | 'down' | null }
const MOOD: Record<Expr, Mood> = {
  calm: { lid: [0.8, 0.8], brow: 0, tilt: 0, mouth: null },
  smirk: { lid: [0.52, 0.76], brow: -4, tilt: -0.1, mouth: 'smirk' },
  shock: { lid: [1.22, 1.22], brow: -11, tilt: 0, mouth: 'open' },
  rage: { lid: [0.62, 0.62], brow: 4, tilt: 0.55, mouth: 'gritted' },
  hollow: { lid: [0.42, 0.42], brow: 3, tilt: -0.05, mouth: 'down' },
};

/** One eye. `side` -1 = viewer's left, +1 = right. `lid` opens the upper lid (0..1.3). */
function eye(x: Ctx, p: PortraitSpec, side: number, style: EyeStyle, lid: number): void {
  const { ink, paper, accent } = p.palette;
  const ex = 128 + side * 26, ey = 150;
  const inner = [ex - side * 12, ey + 1] as const;
  const outer = [ex + side * 13, ey - 3] as const;
  const upper = (): void => {
    x.moveTo(inner[0], inner[1]);
    x.quadraticCurveTo(ex + side * 2, ey - 14 * lid, outer[0], outer[1]);
  };
  x.save();
  if (style === 'round' || style === 'wide') {
    const rw = style === 'round' ? 13 : 12, rh = (style === 'round' ? 12 : 10) * Math.min(lid, 1.1);
    x.beginPath(); x.ellipse(ex, ey, rw, rh, 0, 0, Math.PI * 2);
    x.fillStyle = '#ffffff'; x.fill();
    x.save(); x.clip();
    const ir = style === 'round' ? 8 : 6.5;
    x.beginPath(); x.arc(ex + side * 1, ey + 1, ir, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
    x.beginPath(); x.arc(ex + side * 1, ey + 3, ir * 0.55, 0, Math.PI); x.fillStyle = accent; x.fill();
    x.restore();
    x.beginPath(); x.arc(ex - 3 + side * 1, ey - 3, 2.6, 0, Math.PI * 2); x.fillStyle = paper; x.fill();
    x.beginPath(); x.ellipse(ex, ey, rw, rh, 0, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = ink; x.stroke();
  } else {
    // Sharp almond: upper lid is the main stroke, outer corner flicks up.
    x.beginPath(); upper();
    x.quadraticCurveTo(ex + side * 2, ey + 9, inner[0], inner[1]);
    x.closePath();
    x.fillStyle = '#ffffff'; x.fill();
    x.save(); x.clip();
    const big = style === 'predator' && side > 0;
    const ir = big ? 12 : style === 'tired' ? 8.5 : style === 'hollow' ? 8 : 9.5;
    const ix = ex - side * 1.5, iy = ey + (lid < 0.6 ? 2 : 0);
    x.beginPath(); x.arc(ix, iy, ir, 0, Math.PI * 2);
    x.fillStyle = ink; x.fill();
    if (style !== 'predator' && style !== 'tired' && style !== 'hollow') {
      x.beginPath(); x.arc(ix, iy, ir, 0, Math.PI); x.fillStyle = accent; x.globalAlpha = 0.85; x.fill(); x.globalAlpha = 1;
    }
    if (style === 'tired') {
      x.beginPath(); x.arc(ix, iy, ir, 0, Math.PI * 2); x.fillStyle = paper; x.globalAlpha = 0.35; x.fill(); x.globalAlpha = 1;
    }
    if (style !== 'hollow' && style !== 'tired') {
      x.beginPath(); x.arc(ix - 3, iy - 3, 2.8, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
      x.beginPath(); x.arc(ix + 3.4, iy + 3.6, 1.2, 0, Math.PI * 2); x.fill();
    }
    // Lid shadow over the top of the iris.
    x.beginPath(); x.moveTo(inner[0] - 2, ey - 18); x.lineTo(outer[0] + side * 4, ey - 18); x.lineTo(outer[0], outer[1]);
    x.quadraticCurveTo(ex + side * 2, ey - 14 * lid, inner[0], inner[1]); x.closePath();
    x.fillStyle = ink; x.globalAlpha = 0.25; x.fill(); x.globalAlpha = 1;
    x.restore();
    // Strokes.
    x.lineCap = 'round'; x.strokeStyle = ink;
    x.beginPath(); upper(); x.lineWidth = 3.8; x.stroke();
    x.beginPath(); x.moveTo(outer[0], outer[1]); x.quadraticCurveTo(ex + side * 2, ey + 9, inner[0], inner[1]);
    x.lineWidth = 1.4; x.stroke();
    x.beginPath(); x.moveTo(outer[0], outer[1]); x.lineTo(outer[0] + side * 6, outer[1] - 5);
    x.lineWidth = 2.6; x.stroke();
  }
  x.restore();
}

function closedEye(x: Ctx, p: PortraitSpec, side: number): void {
  const ex = 128 + side * 26, ey = 150;
  x.beginPath();
  x.moveTo(ex - 12, ey - 1);
  x.quadraticCurveTo(ex, ey + 9, ex + 12, ey - 1);
  x.lineCap = 'round'; x.lineWidth = 3.6; x.strokeStyle = p.palette.ink; x.stroke();
  x.beginPath(); x.moveTo(ex + 12 * side, ey - 1); x.lineTo(ex + 15 * side, ey - 5); x.lineWidth = 2.2; x.stroke();
}

function eyes(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const m = MOOD[expr];
  let style = p.eyes;
  if (style === 'closed' && (expr === 'shock' || expr === 'rage')) style = 'plain';
  if (style === 'masked') return;
  if (style === 'closed') {
    closedEye(x, p, -1); closedEye(x, p, 1);
    return;
  }
  const lidL = style === 'round' ? 0.62 : m.lid[0];
  const lidR = m.lid[1];
  eye(x, p, -1, style, lidL);
  eye(x, p, 1, style, lidR);
  if (style === 'hollow' || style === 'tired') {
    for (const s of [-1, 1]) {
      x.save();
      x.beginPath(); x.ellipse(128 + s * 26, 166, 14, 5, 0, 0, Math.PI); x.clip();
      hatch(x, 2.6, p.palette.ink, 0.5, 1.1);
      x.restore();
    }
  }
}

function browsAll(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const m = MOOD[expr];
  const tiltL = expr === 'smirk' ? -m.tilt : m.tilt;
  const tiltR = expr === 'smirk' ? 0.3 : m.tilt;
  const leftY = 128 + (expr === 'smirk' ? -6 : m.brow);
  const rightY = 128 + (expr === 'smirk' ? 2 : m.brow);
  if (p.eyes === 'closed' && (expr === 'calm')) {
    brow(x, p, -1, 124, 0); brow(x, p, 1, 124, 0);
    return;
  }
  brow(x, p, -1, leftY, tiltL);
  brow(x, p, 1, rightY, tiltR);
}

function nose(x: Ctx, p: PortraitSpec): void {
  x.beginPath(); x.moveTo(131, 160); x.quadraticCurveTo(126, 172, 124, 178); x.quadraticCurveTo(128, 182, 133, 180);
  x.lineCap = 'round'; x.lineWidth = 2; x.strokeStyle = p.palette.ink; x.stroke();
}

function mouth(x: Ctx, p: PortraitSpec, expr: Expr): void {
  const ink = p.palette.ink;
  const kind = MOOD[expr].mouth;
  x.lineCap = 'round'; x.strokeStyle = ink; x.fillStyle = ink;
  if (kind === 'smirk') {
    x.beginPath(); x.moveTo(114, 206); x.quadraticCurveTo(130, 212, 146, 194); x.lineWidth = 3; x.stroke();
    x.beginPath(); x.moveTo(146, 194); x.lineTo(150, 190); x.lineWidth = 2; x.stroke();
    return;
  }
  if (kind === 'open') {
    x.beginPath(); x.ellipse(128, 206, 7, 9, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(128, 209, 4, 3, 0, 0, Math.PI * 2); x.fillStyle = p.palette.accent; x.fill();
    return;
  }
  if (kind === 'gritted') {
    rrect(x, 110, 198, 36, 14, 3);
    x.fillStyle = ink; x.fill();
    x.fillStyle = p.palette.paper;
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
      x.fillStyle = p.palette.paper; x.fill();
      break;
    }
    case 'thin': {
      x.beginPath(); x.moveTo(118, 205); x.lineTo(138, 205); x.lineWidth = 2.6; x.stroke();
      break;
    }
    case 'flat': {
      x.beginPath(); x.moveTo(116, 206); x.lineTo(140, 206); x.lineWidth = 3; x.stroke();
      break;
    }
    default: {
      x.beginPath(); x.moveTo(116, 200); x.quadraticCurveTo(128, 212, 140, 200); x.lineWidth = 2.8; x.stroke();
    }
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

function faceCover(x: Ctx, p: PortraitSpec): void {
  if (!p.accessories.includes('mask')) return;
  const { ink, accent } = p.palette;
  x.beginPath();
  x.moveTo(76, 138); x.quadraticCurveTo(128, 112, 180, 138);
  x.quadraticCurveTo(184, 160, 170, 170); x.quadraticCurveTo(128, 150, 86, 170);
  x.quadraticCurveTo(72, 160, 76, 138); x.closePath();
  x.fillStyle = ink; x.fill();
  x.lineWidth = 2.6; x.strokeStyle = accent; x.stroke();
  for (const s of [-1, 1]) {
    x.beginPath(); x.ellipse(128 + s * 26, 150, 9, 2.6, s * 0.12, 0, Math.PI * 2);
    x.fillStyle = p.palette.paper; x.fill();
  }
}

function spectacles(x: Ctx, p: PortraitSpec): void {
  if (!p.accessories.includes('spectacles')) return;
  const ink = p.palette.ink;
  x.lineWidth = 2.6; x.strokeStyle = ink;
  for (const s of [-1, 1]) {
    x.beginPath(); x.arc(128 + s * 26, 150, 15, 0, Math.PI * 2); x.stroke();
  }
  x.beginPath(); x.moveTo(114, 148); x.quadraticCurveTo(128, 142, 142, 148); x.stroke();
  x.beginPath(); x.moveTo(87, 146); x.lineTo(74, 142); x.moveTo(169, 146); x.lineTo(182, 142); x.stroke();
}

function frontAccessories(x: Ctx, p: PortraitSpec): void {
  const { ink, paper, accent } = p.palette;
  for (const a of p.accessories) {
    switch (a) {
      case 'gloves': {
        for (const s of [-1, 1]) {
          const gx = s < 0 ? 58 : 158;
          rrect(x, gx, 304, 40, 60, 14);
          x.fillStyle = '#fbfbfb'; x.fill(); x.lineWidth = 2.6; x.strokeStyle = ink; x.stroke();
          x.lineWidth = 1.6;
          for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(gx + i * 10, 320); x.lineTo(gx + i * 10 + s * 1, 350); x.stroke(); }
          x.beginPath(); x.rect(gx - 1, 304, 42, 10); x.fillStyle = accent; x.fill(); x.stroke();
        }
        break;
      }
      case 'gauge': {
        x.beginPath(); rrect(x, 58, 320, 52, 11, 5); x.fillStyle = ink; x.fill();
        x.beginPath(); x.arc(128, 326, 24, 0, Math.PI * 2);
        x.fillStyle = accent; x.fill(); x.lineWidth = 3.4; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.arc(128, 326, 16, 0, Math.PI * 2); x.fillStyle = paper; x.fill(); x.lineWidth = 1.6; x.stroke();
        x.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * (0.9 + i * 0.2);
          x.beginPath(); x.moveTo(128 + Math.cos(a) * 14, 326 + Math.sin(a) * 14); x.lineTo(128 + Math.cos(a) * 11, 326 + Math.sin(a) * 11); x.stroke();
        }
        x.lineWidth = 2.6; x.lineCap = 'round';
        x.beginPath(); x.moveTo(128, 326); x.lineTo(138, 314); x.stroke();
        x.beginPath(); x.arc(118, 300, 4, 0, Math.PI * 2); x.fillStyle = paper; x.globalAlpha = 0.7; x.fill(); x.globalAlpha = 1;
        break;
      }
      case 'watch': {
        x.beginPath(); x.setLineDash([3, 3]); x.moveTo(152, 282); x.quadraticCurveTo(174, 300, 178, 332);
        x.lineWidth = 2; x.strokeStyle = paper; x.stroke(); x.setLineDash([]);
        x.beginPath(); x.arc(182, 344, 11, 0, Math.PI * 2); x.fillStyle = accent; x.fill(); x.lineWidth = 2.4; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.moveTo(178, 340); x.lineTo(183, 344); x.lineTo(180, 350); x.lineWidth = 1.2; x.strokeStyle = paper; x.stroke();
        break;
      }
      case 'key': {
        x.lineCap = 'round'; x.lineWidth = 2; x.strokeStyle = accent;
        x.beginPath(); x.moveTo(114, 268); x.lineTo(128, 332); x.lineTo(142, 268); x.stroke();
        x.beginPath(); x.arc(128, 340, 6, 0, Math.PI * 2); x.lineWidth = 3.2; x.strokeStyle = accent; x.stroke();
        x.lineWidth = 3.4; x.beginPath(); x.moveTo(128, 346); x.lineTo(128, 370); x.stroke();
        x.beginPath(); x.moveTo(128, 360); x.lineTo(134, 360); x.moveTo(128, 366); x.lineTo(133, 366); x.stroke();
        x.strokeStyle = ink; x.lineWidth = 0.8; x.beginPath(); x.arc(128, 340, 6, 0, Math.PI * 2); x.stroke();
        break;
      }
      case 'reels': {
        for (const s of [-1, 1]) {
          const rx = 128 + s * 70;
          x.beginPath(); x.arc(rx, 300, 18, 0, Math.PI * 2); x.fillStyle = ink; x.fill(); x.lineWidth = 2; x.strokeStyle = paper; x.stroke();
          x.beginPath(); x.arc(rx, 300, 6, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
        }
        x.lineWidth = 1.4; x.strokeStyle = paper;
        x.beginPath(); x.moveTo(60, 300); x.quadraticCurveTo(96, 352, 128, 360); x.moveTo(196, 300); x.quadraticCurveTo(160, 352, 128, 360); x.stroke();
        break;
      }
      case 'seal': {
        x.beginPath(); x.moveTo(158, 318); x.lineTo(150, 296); x.lineTo(164, 300); x.closePath();
        x.fillStyle = accent; x.fill(); x.lineWidth = 1.6; x.strokeStyle = ink; x.stroke();
        x.beginPath(); x.arc(170, 334, 13, 0, Math.PI * 2); x.fillStyle = accent; x.fill(); x.lineWidth = 2.2; x.strokeStyle = ink; x.stroke();
        x.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
          const px = 170 + Math.cos(a) * 7, py = 334 + Math.sin(a) * 7;
          if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.closePath(); x.fillStyle = ink; x.fill();
        break;
      }
      case 'ledger': {
        x.save(); x.translate(152, 316); x.rotate(-0.12);
        x.fillStyle = accent; x.fillRect(-9, -12, 18, 24);
        x.fillStyle = paper; x.fillRect(-7, -10, 14, 20);
        x.strokeStyle = ink; x.lineWidth = 1; x.strokeRect(-9, -12, 18, 24);
        x.restore();
        break;
      }
      default: break;
    }
  }
}

function hoodFront(x: Ctx, p: PortraitSpec): void {
  if (p.hair !== 'hood') return;
  // Hood brim shadow over the top of the shoulders.
  x.save(); x.beginPath(); x.moveTo(30, 230); x.quadraticCurveTo(128, 196, 226, 230); x.lineTo(226, 260); x.lineTo(30, 260); x.closePath();
  x.clip(); hatch(x, 4, p.palette.ink, 0.3, 1.2); x.restore();
}

function bottomFade(x: Ctx, p: PortraitSpec): void {
  const ink = p.palette.ink;
  x.save(); x.beginPath(); x.rect(0, 336, PW, PH - 336); x.clip();
  dots(x, 6, ink, 0.3, (px, py) => (py - 336) / 48 * 1.9);
  x.restore();
}

function draw(id: string, expr: Expr): HTMLCanvasElement {
  const p = portraitSpec(id);
  const cv = document.createElement('canvas');
  cv.width = PW; cv.height = PH;
  const x = cv.getContext('2d');
  if (!x) return cv;
  const rnd = seeded(hash(id));
  background(x, p, rnd);
  bodyBack(x, p);
  body(x, p);
  hairBack(x, p, rnd);
  hoodFront(x, p);
  neck(x, p);
  ears(x, p);
  face(x, p);
  soot(x, p);
  eyes(x, p, expr);
  browsAll(x, p, expr);
  nose(x, p);
  mouth(x, p, expr);
  expressionMarks(x, p, expr);
  spectacles(x, p);
  hairFront(x, p, rnd);
  faceCover(x, p);
  frontAccessories(x, p);
  bottomFade(x, p);
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
