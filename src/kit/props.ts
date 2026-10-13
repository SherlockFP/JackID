/**
 * `kit.prop(id)` — small hand-held / wearable props, all static, merged into 1–4 draw calls and flagged `noAO`.
 * Origins are chosen so that `actor.attach(prop, bone)` works with no offsets: every prop carries
 * `userData.attachHint = { bone, pos, rot, scale }` in the mannequin's Blender-style bone space (head: +Y up, +Z face
 * direction; hands: +Y runs along the fingers). Pass your own `pos/rot` to override.
 *
 * Ids (an unknown id logs once and returns a small placeholder cube, never throws):
 *  masks   mask_porcelain mask_hare mask_fox mask_moth mask_toad mask_owl mask_crow mask_pig mask_goat mask_devil
 *          mask_oracle mask_cashier mask_collector (brass coin-slot plate + wide-brim hat)
 *  hats    hat_collector hat_top hat_fedora hat_bowler hat_cloche hat_flatcap
 *  held    briefcase ledger clipboard shotgun revolver pistol mint_tin phone cane lantern torch key tonic gavel envelope
 *          cigar glass watch
 *  worn    coat_long (Collector's coat skirt, bone `pelvis`)
 *  held    … mic (hand_r, caller)
 * `o.color` recolours the main material of masks/hats and the accent of the rest.
 */
import * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import { log } from '@/core/log';
import { psx } from './materials';
import { finalizeModel } from './finalize';
import { buildMesh } from './prims';
import { PAL, css } from './palette';
import type { KitCtx } from './ctx';
import type { Kit, MatLike } from './types';

const TAU = Math.PI * 2;
interface Hint { bone: string; pos?: V3; rot?: V3; scale?: number }

export const PLAYER_MASKS = ['hare', 'fox', 'moth', 'toad', 'owl', 'crow', 'pig', 'goat'] as const;
/** Mask colour per animal (ART_BIBLE §8.2 player colours). */
const MASK_BASE: Record<string, Hex> = {
  hare: PAL.IVORY, fox: PAL.AMBER, moth: PAL.BONE, toad: PAL.BILE, owl: PAL.BONE, crow: PAL.PIT_BLACK, pig: PAL.CORAL, goat: PAL.IVORY,
};
const MASK_PIN: Record<string, Hex> = {
  hare: PAL.SIGNAL_RED, fox: PAL.AMBER, moth: PAL.BULB_YELLOW, toad: PAL.BILE, owl: PAL.CRT_CYAN, crow: PAL.COBALT, pig: PAL.NEON_MAGENTA, goat: PAL.IVORY,
};

export function makeProps(ctx: KitCtx): Pick<Kit, 'prop'> {
  const { P, M, tex } = ctx;
  const warned = new Set<string>();

  const finish = (g: THREE.Group, hint?: Hint): THREE.Group => {
    g.userData.noAO = true;
    finalizeModel(g);
    if (hint) g.userData.attachHint = hint;
    return g;
  };
  const metal = (c?: Hex): MatLike => (c === undefined ? M.chrome() : { color: c, vertexColors: true });
  const flat = (c: Hex): { color: Hex; vertexColors: true } => ({ color: c, vertexColors: true });
  const eye = (c: Hex): THREE.Material => M.unlit(c);

  // ── face masks ──
  // Head of the GLB in Head-bone space (A-pose, scale 1): width 0.173, depth 0.239 (z −0.12 … +0.118), crown at y +0.26.
  const HEAD = { cy: 0.127, top: 0.262, front: 0.122, rx: 0.095, ry: 0.138, rz: 0.131 };
  /** Front half-ellipsoid, +Z facing, planar UV (texture painted face-on). */
  const shell = (parent: THREE.Object3D, w: number, h: number, d: number, m: MatLike, seg = 10): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(1, seg, 8, 0, Math.PI, 0, Math.PI);
    geo.scale(w / 2, h / 2, d);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    return buildMesh(geo, m, { pos: [0, HEAD.cy, 0], parent, name: 'mask_shell' }, false, () => {});
  };
  /** Depth of the mask surface at (x, y) (Head-bone space) — for features that must sit ON the face. */
  const faceZ = (x: number, y: number, w = HEAD.rx * 2, h = HEAD.ry * 2, d = HEAD.rz): number => {
    const k = 1 - Math.pow(x / (w / 2), 2) - Math.pow((y - HEAD.cy) / (h / 2), 2);
    return d * Math.sqrt(Math.max(0.02, k));
  };

  const paintMask = (kind: string, base: Hex): THREE.Texture => tex.canvas(32, 32, (g) => {
    const px = (x: number, y: number, w = 1, h = 1, c = '#000'): void => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    px(0, 0, 32, 32, css(base));
    const dark = css(PAL.PIT_BLACK);
    const eyeHoles = (rx = 3, ry = 2, cy = 13): void => {
      g.fillStyle = dark;
      for (const cx of [10, 22]) { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill(); }
    };
    switch (kind) {
      case 'porcelain': {
        const ink = css(PAL.SOOT);
        for (let x = 6; x < 15; x += 1) px(x, 10 + (x === 6 || x === 14 ? 1 : 0), 1, 1, ink);
        for (let x = 18; x < 27; x += 1) px(x, 10 + (x === 18 || x === 26 ? 1 : 0), 1, 1, ink);
        eyeHoles(3, 1.6, 13);
        for (const cx of [8, 24]) for (let y = 17; y < 22; y++) for (let x = cx - 3; x <= cx + 3; x++) if ((x + y) & 1) px(x, y, 1, 1, css(PAL.CORAL));
        for (let x = 7; x <= 25; x++) px(x, 23 + Math.round(0.03 * (x - 16) * (x - 16)), 1, 1, dark);   // a smile that is too wide
        px(12, 2, 1, 4, css(PAL.GROUT)); px(11, 6, 1, 3, css(PAL.GROUT)); px(10, 8, 1, 3, css(PAL.GROUT));
        break;
      }
      case 'devil': {
        px(0, 0, 32, 32, css(PAL.OXBLOOD));
        for (let y = 0; y < 32; y += 4) px(0, y, 32, 1, css(PAL.CASINO_RED));
        g.fillStyle = dark;
        for (const s of [-1, 1]) { const cx = 16 + s * 6; g.beginPath(); g.moveTo(cx - s * 4, 12); g.lineTo(cx + s * 4, 15); g.lineTo(cx - s * 4, 16.5); g.closePath(); g.fill(); }
        for (let x = 6; x <= 26; x++) px(x, 23 + Math.round(0.02 * (x - 16) * (x - 16)), 1, 1, css(PAL.GOLD));
        for (let x = 8; x <= 24; x += 2) px(x, 24 + Math.round(0.02 * (x - 16) * (x - 16)), 1, 2, css(PAL.GOLD_SHINE));
        break;
      }
      case 'collector': {
        px(0, 0, 32, 32, css(PAL.GOLD));
        for (let y = 0; y < 32; y += 4) px(0, y, 32, 1, css(PAL.BRASS));
        px(14, 6, 4, 20, css(PAL.PIT_BLACK));                       // the coin slot
        px(15, 4, 2, 2, css(PAL.BRASS_SHADOW)); px(15, 26, 2, 2, css(PAL.BRASS_SHADOW));
        break;
      }
      case 'hare': eyeHoles(2.4, 2.4); px(15, 18, 2, 2, css(PAL.CORAL)); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) px(16 + s * (3 + i), 19 + (i - 1), 1, 1, dark); break;
      case 'fox': px(8, 17, 16, 10, css(PAL.IVORY)); px(14, 18, 4, 3, dark); eyeHoles(3, 1.4, 12); break;
      case 'moth': g.fillStyle = dark; for (const cx of [10, 22]) { g.beginPath(); g.arc(cx, 13, 4.5, 0, TAU); g.fill(); } g.fillStyle = css(PAL.BULB_YELLOW); for (const cx of [10, 22]) { g.beginPath(); g.arc(cx, 13, 1.6, 0, TAU); g.fill(); } break;
      case 'toad': eyeHoles(2.5, 2); for (let x = 6; x <= 26; x++) px(x, 22, 1, 1, dark); break;
      case 'owl': g.strokeStyle = css(PAL.CRT_CYAN); g.lineWidth = 1; for (const cx of [10, 22]) { g.beginPath(); g.arc(cx, 13, 6, 0, TAU); g.stroke(); } eyeHoles(3, 3); break;
      case 'crow': eyeHoles(2.5, 1.8, 12); for (let i = 0; i < 8; i++) px(5 + i * 3, 4 + (i & 1), 2, 1, css(PAL.COBALT)); break;
      case 'pig': eyeHoles(2.5, 2); g.fillStyle = css(PAL.NEON_MAGENTA); for (const cx of [6, 26]) { g.beginPath(); g.arc(cx, 19, 3, 0, TAU); g.fill(); } break;
      case 'goat': g.fillStyle = dark; for (const cx of [10, 22]) g.fillRect(cx - 3, 12, 6, 2); for (let x = 12; x <= 20; x++) px(x, 24, 1, 1, css(PAL.SLATE)); break;
      default: eyeHoles(); break;
    }
  }, { key: `kit:mask:${kind}:${base}`, wrap: 'clamp' });

  /** Shell + the two player-colour eye pinpoints sitting in the eye holes. */
  const baseMask = (g: THREE.Group, kind: string, color: Hex, pin: Hex, sx = 1, sy = 1): THREE.Mesh => {
    const w = HEAD.rx * 2 * sx, h = HEAD.ry * 2 * sy;
    const m = psx({ map: paintMask(kind, color), color: 0xffffff, vertexColors: true });
    const s = shell(g, w, h, HEAD.rz, m);
    const ey = HEAD.cy + (1 - 13 / 32 - 0.5) * h;
    for (const dir of [-1, 1]) {
      const ex = dir * (6 / 32) * w;
      P.box(0.012, 0.008, 0.006, eye(pin), { pos: [ex, ey, faceZ(ex, ey, w, h) + 0.002], parent: g, shade: false });
    }
    return s;
  };
  const cone = (g: THREE.Group, r: number, h: number, mat: MatLike, pos: V3, rot: V3, seg = 4): THREE.Mesh =>
    P.cyl(0.001, r, h, mat, { pos, rot, seg, parent: g });
  const ear = (g: THREE.Group, w: number, h: number, th: number, mat: MatLike, x: number, tilt: number): THREE.Mesh =>
    P.box(w, h, th, mat, { pos: [x, HEAD.top - 0.03 + h / 2, -0.01], rot: [0, 0, tilt], parent: g });
  const snoutY = HEAD.cy - 0.03;

  const MASKS: Record<string, (g: THREE.Group, c: Hex | undefined) => Hint> = {
    porcelain: (g, c) => { baseMask(g, 'porcelain', c ?? PAL.IVORY, PAL.ABYSS_BLUE); return { bone: 'Head' }; },
    hare: (g, c) => {
      baseMask(g, 'hare', c ?? MASK_BASE.hare, MASK_PIN.hare);
      ear(g, 0.045, 0.22, 0.016, M.porcelain(), -0.045, 10); ear(g, 0.045, 0.2, 0.016, M.porcelain(), 0.045, -22);
      P.box(0.02, 0.15, 0.006, flat(PAL.SIGNAL_RED), { pos: [-0.047, HEAD.top + 0.09, 0.0], rot: [0, 0, 10], parent: g });
      P.box(0.02, 0.14, 0.006, flat(PAL.SIGNAL_RED), { pos: [0.054, HEAD.top + 0.085, 0.0], rot: [0, 0, -22], parent: g });
      return { bone: 'Head' };
    },
    fox: (g, c) => {
      baseMask(g, 'fox', c ?? MASK_BASE.fox, MASK_PIN.fox);
      P.cyl(0.001, 0.05, 0.1, flat(PAL.IVORY), { pos: [0, snoutY, HEAD.front + 0.05], rot: [90, 45, 0], seg: 4, parent: g });
      P.sphere(0.012, flat(PAL.PIT_BLACK), { pos: [0, snoutY, HEAD.front + 0.1], wSeg: 5, hSeg: 4, parent: g });
      for (const s of [-1, 1]) { cone(g, 0.045, 0.1, flat(c ?? PAL.AMBER), [s * 0.06, HEAD.top + 0.0, -0.005], [0, 0, -s * 14]); cone(g, 0.02, 0.035, flat(PAL.PIT_BLACK), [s * 0.066, HEAD.top + 0.05, -0.005], [0, 0, -s * 14]); }
      return { bone: 'Head' };
    },
    moth: (g, c) => {
      baseMask(g, 'moth', c ?? MASK_BASE.moth, MASK_PIN.moth, 1.02, 1.0);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) P.box(0.004, 0.13 - i * 0.02, 0.003, flat(PAL.IVORY), { pos: [s * (0.03 + i * 0.012), HEAD.top + 0.05 + (i === 1 ? 0.01 : 0), 0.04], rot: [0, 0, -s * (22 + i * 12)], parent: g });
        P.sphere(0.012, flat(PAL.BULB_YELLOW), { pos: [s * 0.075, HEAD.top + 0.11, 0.045], wSeg: 5, hSeg: 4, parent: g });
      }
      return { bone: 'Head' };
    },
    toad: (g, c) => {
      baseMask(g, 'toad', c ?? MASK_BASE.toad, MASK_PIN.toad, 1.15, 1.0);
      for (const sx of [-1, 1]) { P.sphere(0.03, flat(PAL.BILE), { pos: [sx * 0.055, HEAD.top - 0.03, 0.065], hemi: true, wSeg: 6, hSeg: 3, parent: g }); P.sphere(0.017, flat(PAL.AMBER), { pos: [sx * 0.055, HEAD.top - 0.012, 0.075], wSeg: 5, hSeg: 4, parent: g }); }
      return { bone: 'Head' };
    },
    owl: (g, c) => {
      baseMask(g, 'owl', c ?? MASK_BASE.owl, MASK_PIN.owl);
      P.cyl(0.001, 0.03, 0.05, flat(PAL.AMBER), { pos: [0, snoutY + 0.01, HEAD.front + 0.02], rot: [90, 45, 0], seg: 4, parent: g });
      for (const s of [-1, 1]) cone(g, 0.03, 0.07, flat(c ?? PAL.BONE), [s * 0.065, HEAD.top - 0.01, 0.0], [0, 0, -s * 20], 3);
      return { bone: 'Head' };
    },
    crow: (g, c) => {
      baseMask(g, 'crow', c ?? MASK_BASE.crow, MASK_PIN.crow);
      P.cyl(0.001, 0.035, 0.15, flat(PAL.SOOT), { pos: [0, snoutY, HEAD.front + 0.07], rot: [90, 45, 0], seg: 4, parent: g });
      return { bone: 'Head' };
    },
    pig: (g, c) => {
      baseMask(g, 'pig', c ?? MASK_BASE.pig, MASK_PIN.pig);
      P.cyl(0.035, 0.04, 0.035, flat(PAL.PLUM), { pos: [0, snoutY, HEAD.front + 0.015], rot: [90, 0, 0], seg: 6, parent: g });
      for (const s of [-1, 1]) {
        P.box(0.008, 0.012, 0.004, flat(PAL.PIT_BLACK), { pos: [s * 0.014, snoutY, HEAD.front + 0.036], parent: g });
        P.box(0.05, 0.05, 0.008, flat(c ?? PAL.CORAL), { pos: [s * 0.08, HEAD.top - 0.02, 0.02], rot: [20, 0, -s * 35], parent: g });
      }
      return { bone: 'Head' };
    },
    goat: (g, c) => {
      baseMask(g, 'goat', c ?? MASK_BASE.goat, MASK_PIN.goat);
      for (const s of [-1, 1]) {
        const pts: V3[] = [[s * 0.05, HEAD.top - 0.04, 0.0], [s * 0.09, HEAD.top + 0.03, -0.02], [s * 0.125, HEAD.top + 0.06, 0.02], [s * 0.115, HEAD.top + 0.02, 0.07]];
        P.tube(pts, 0.012, flat(PAL.BONE), { seg: 8, radialSeg: 4, parent: g });
      }
      P.cyl(0.001, 0.03, 0.08, flat(PAL.GROUT), { pos: [0, 0.0, HEAD.front - 0.03], rot: [175, 0, 0], seg: 3, parent: g });
      return { bone: 'Head' };
    },
    devil: (g, c) => {
      baseMask(g, 'devil', c ?? PAL.OXBLOOD, PAL.BULB_YELLOW);
      for (const s of [-1, 1]) {
        P.cyl(0.004, 0.022, 0.12, flat(PAL.GOLD), { pos: [s * 0.055, HEAD.top + 0.01, 0.0], rot: [0, 0, -s * 22], seg: 5, parent: g });
        P.cyl(0.001, 0.008, 0.05, flat(PAL.GOLD_SHINE), { pos: [s * 0.095, HEAD.top + 0.07, 0.0], rot: [0, 0, -s * 45], seg: 5, parent: g });
      }
      return { bone: 'Head' };
    },
    oracle: (g, c) => {
      baseMask(g, 'moth', c ?? PAL.BRUISE, PAL.CURSE_VIOLET);
      const wing = psx({ map: tex.canvas(16, 16, (c2) => { c2.fillStyle = css(PAL.PLUM); c2.fillRect(0, 0, 16, 16); c2.fillStyle = css(PAL.CURSE_VIOLET); for (let i = 0; i < 16; i += 3) c2.fillRect(i, 0, 1, 16); c2.fillStyle = css(PAL.PIT_BLACK); c2.fillRect(6, 5, 4, 5); }, { key: 'kit:oracle:wing', wrap: 'clamp' }), lit: false, side: 'double', alphaTest: 0.5 });
      for (const s of [-1, 1]) P.plane(0.26, 0.18, wing, { pos: [s * 0.15, HEAD.cy + 0.06, -0.04], rot: [0, s * 35, s * 22], parent: g, shade: false });
      P.plane(0.16, 0.085, { color: PAL.BRUISE, alphaTest: 0.5, map: tex.checker(0x291031, 0x000000, 2), lit: false, side: 'double' }, { pos: [0, 0.03, HEAD.front - 0.012], rot: [-12, 0, 0], parent: g, shade: false });
      return { bone: 'Head' };
    },
    cashier: (g, c) => {
      baseMask(g, 'porcelain', PAL.IVORY, PAL.FELT_LIGHT);
      const visor = psx({ color: c ?? PAL.FELT_LIGHT, lit: false, transparent: true, opacity: 0.8, side: 'double', depthWrite: false });
      P.extrude([[-0.105, 0], [0.105, 0], [0.09, 0.05], [-0.09, 0.05]], 0.12, visor, { pos: [0, HEAD.cy + 0.075, 0.03], rot: [-90, 0, 0], shade: false, parent: g });
      return { bone: 'Head' };
    },
    collector: (g, c) => {
      const plate = psx({ map: paintMask('collector', c ?? PAL.GOLD), color: 0xffffff, vertexColors: true });
      shell(g, HEAD.rx * 2, HEAD.ry * 2, HEAD.rz, plate);
      hat(g, 'collector');
      return { bone: 'Head' };
    },
  };

  // ── hats ──
  function hat(g: THREE.Group, kind: string, c?: Hex): void {
    const body = c ?? (kind === 'fedora' ? 0x4a3a2a : kind === 'flatcap' ? 0x3a3a42 : kind === 'cloche' ? PAL.PLUM : PAL.PIT_BLACK);
    const mat = M.enamel(body, 0.3);
    const band = flat(kind === 'collector' ? PAL.GOLD : kind === 'cloche' ? PAL.BULB_YELLOW : PAL.CASINO_RED);
    const y0 = HEAD.top - 0.065;
    switch (kind) {
      case 'collector':
        P.cyl(0.26, 0.26, 0.012, mat, { pos: [0, y0, 0.0], seg: 10, parent: g });                // wide brim
        P.cyl(0.095, 0.115, 0.17, mat, { pos: [0, y0 + 0.09, 0], seg: 10, parent: g });
        P.cyl(0.117, 0.117, 0.03, band, { pos: [0, y0 + 0.03, 0], seg: 10, parent: g });
        break;
      case 'top':
        P.cyl(0.17, 0.17, 0.012, mat, { pos: [0, y0, 0], seg: 10, parent: g });
        P.cyl(0.1, 0.105, 0.26, mat, { pos: [0, y0 + 0.135, 0], seg: 10, parent: g });
        P.cyl(0.107, 0.107, 0.035, band, { pos: [0, y0 + 0.04, 0], seg: 10, parent: g });
        break;
      case 'fedora':
        P.cyl(0.19, 0.19, 0.01, mat, { pos: [0, y0, 0], rot: [4, 0, 0], seg: 10, parent: g });
        P.cyl(0.075, 0.105, 0.12, mat, { pos: [0, y0 + 0.07, 0], seg: 8, parent: g });
        P.box(0.06, 0.02, 0.14, mat, { pos: [0, y0 + 0.135, 0], parent: g });                     // pinch
        P.cyl(0.108, 0.108, 0.025, band, { pos: [0, y0 + 0.03, 0], seg: 8, parent: g });
        break;
      case 'bowler':
        P.cyl(0.14, 0.14, 0.01, mat, { pos: [0, y0, 0], seg: 10, parent: g });
        P.sphere(0.105, mat, { pos: [0, y0, 0], hemi: true, wSeg: 10, hSeg: 4, parent: g });
        P.cyl(0.106, 0.106, 0.02, band, { pos: [0, y0 + 0.02, 0], seg: 10, parent: g });
        break;
      case 'cloche':
        P.lathe([[0.1, y0 - 0.06], [0.12, y0 - 0.02], [0.115, y0 + 0.06], [0.07, y0 + 0.11], [0.0, y0 + 0.12]], 8, mat, { parent: g });
        P.cyl(0.14, 0.15, 0.008, mat, { pos: [0, y0 - 0.04, 0.012], rot: [-6, 0, 0], seg: 8, parent: g });
        P.torus(0.118, 0.01, band, { pos: [0, y0 - 0.005, 0], rot: [90, 0, 0], seg: 8, tubeSeg: 3, parent: g });
        break;
      default:   // flatcap
        P.sphere(0.115, mat, { pos: [0, y0 - 0.005, 0], hemi: true, wSeg: 8, hSeg: 3, scale: [1, 0.55, 1.05], parent: g });
        P.box(0.16, 0.012, 0.08, mat, { pos: [0, y0 + 0.012, 0.115], rot: [-12, 0, 0], parent: g });
        break;
    }
  }
  const HATS: Record<string, (g: THREE.Group, c: Hex | undefined) => Hint> = {
    collector: (g, c) => { hat(g, 'collector', c); return { bone: 'Head' }; },
    top: (g, c) => { hat(g, 'top', c); return { bone: 'Head' }; },
    fedora: (g, c) => { hat(g, 'fedora', c); return { bone: 'Head' }; },
    bowler: (g, c) => { hat(g, 'bowler', c); return { bone: 'Head' }; },
    cloche: (g, c) => { hat(g, 'cloche', c); return { bone: 'Head' }; },
    flatcap: (g, c) => { hat(g, 'flatcap', c); return { bone: 'Head' }; },
  };

  // ── held / worn items (origin = grip) ──
  const HELD: Record<string, (g: THREE.Group, c: Hex | undefined) => Hint> = {
    briefcase: (g, c) => {
      P.box(0.42, 0.3, 0.1, M.leather(c ?? PAL.WALNUT, false), { bevel: 0.012, pos: [0, -0.2, 0], parent: g });
      P.box(0.12, 0.03, 0.025, M.brass(), { pos: [0, -0.04, 0], parent: g });
      for (const s of [-1, 1]) { P.box(0.03, 0.025, 0.105, M.brass(), { pos: [s * 0.12, -0.17, 0], parent: g }); P.box(0.02, 0.07, 0.02, M.brass(), { pos: [s * 0.055, -0.065, 0], parent: g }); }
      return { bone: 'hand_r', pos: [0, 0.04, 0.0], rot: [0, 90, 0] };
    },
    ledger: (g, c) => {
      P.box(0.22, 0.03, 0.3, M.leather(c ?? PAL.OXBLOOD, false), { bevel: 0.006, parent: g });
      P.box(0.2, 0.022, 0.285, M.paper(), { pos: [0.004, 0, 0.0], parent: g });
      P.box(0.226, 0.034, 0.02, M.brass(), { pos: [-0.0, 0, -0.145], parent: g });
      return { bone: 'hand_l', pos: [0.0, 0.1, 0.05], rot: [90, 0, 0] };
    },
    clipboard: (g, c) => {
      P.box(0.22, 0.012, 0.3, M.woodStain(c ?? 0x6b4a2a), { parent: g });
      P.box(0.19, 0.004, 0.26, M.paper(), { pos: [0, 0.008, 0.01], parent: g });
      P.box(0.09, 0.02, 0.03, M.chrome(), { pos: [0, 0.012, -0.135], parent: g });
      return { bone: 'hand_l', pos: [0.0, 0.09, 0.04], rot: [90, 0, 0] };
    },
    shotgun: (g, c) => {
      const wood = c === undefined ? M.wood('mahogany') : flat(c);
      for (const s of [-1, 1]) P.cyl(0.011, 0.011, 0.5, M.gunmetal(), { pos: [s * 0.012, 0, 0.3], rot: [90, 0, 0], seg: 6, parent: g });
      P.box(0.04, 0.05, 0.12, M.brass(), { pos: [0, 0, 0.0], bevel: 0.004, parent: g });
      P.box(0.04, 0.05, 0.3, wood, { pos: [0, -0.02, -0.18], rot: [-6, 0, 0], bevel: 0.005, parent: g });
      P.box(0.034, 0.045, 0.2, wood, { pos: [0, -0.02, 0.18], parent: g });
      P.torus(0.025, 0.004, M.brass(), { pos: [0, -0.04, -0.04], rot: [0, 90, 0], seg: 8, tubeSeg: 3, arc: Math.PI, parent: g });
      return { bone: 'hand_r', pos: [0, 0.13, 0.02], rot: [-90, 0, -180] };      // barrel along the hand's +Y (forearm direction)
    },
    revolver: (g, c) => {
      P.box(0.028, 0.035, 0.2, M.gunmetal(), { pos: [0, 0.03, 0.06], bevel: 0.003, parent: g });
      P.cyl(0.032, 0.032, 0.055, M.gunmetal(), { pos: [0, 0.03, 0.01], rot: [90, 0, 0], seg: 6, parent: g });
      P.box(0.03, 0.09, 0.04, c === undefined ? M.wood('mahogany') : flat(c), { pos: [0, -0.03, -0.045], rot: [-18, 0, 0], bevel: 0.004, parent: g });
      P.box(0.006, 0.03, 0.006, M.chrome(), { pos: [0, 0.0, 0.0], parent: g });
      return { bone: 'hand_r', pos: [0, 0.105, 0.03], rot: [-90, 0, -180] };
    },
    pistol: (g, c) => {
      P.box(0.028, 0.04, 0.17, M.gunmetal(), { pos: [0, 0.035, 0.05], bevel: 0.003, parent: g });
      P.box(0.03, 0.095, 0.045, c === undefined ? M.gunmetal() : flat(c), { pos: [0, -0.02, -0.03], rot: [-14, 0, 0], bevel: 0.004, parent: g });
      return { bone: 'hand_r', pos: [0, 0.105, 0.03], rot: [-90, 0, -180] };
    },
    mint_tin: (g, c) => {
      P.box(0.09, 0.016, 0.06, flat(c ?? PAL.SIGNAL_RED), { bevel: 0.003, parent: g });
      P.box(0.092, 0.006, 0.062, M.chrome(), { pos: [0, 0.008, 0], bevel: 0.002, parent: g });
      P.box(0.05, 0.002, 0.025, flat(PAL.IVORY), { pos: [0, 0.0115, 0], parent: g });
      return { bone: 'hand_l', pos: [0, 0.07, 0.02], rot: [0, 0, 0] };
    },
    phone: (g, c) => {
      const body = flat(c ?? PAL.PIT_BLACK);
      P.box(0.045, 0.04, 0.2, body, { bevel: 0.008, parent: g });
      for (const z of [-0.09, 0.09]) P.cyl(0.035, 0.035, 0.05, body, { pos: [0, 0.01, z], rot: [0, 0, 0], seg: 8, parent: g });
      P.cyl(0.004, 0.004, 0.4, M.gunmetal(), { pos: [0.04, -0.2, 0.0], seg: 4, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.0], rot: [0, 0, 90] };
    },
    cane: (g, c) => {
      P.cyl(0.011, 0.014, 0.9, c === undefined ? M.wood('dark') : flat(c), { pos: [0, -0.3, 0], seg: 6, parent: g });
      P.sphere(0.03, M.gold(), { pos: [0, 0.16, 0], wSeg: 6, hSeg: 5, parent: g });
      P.cyl(0.015, 0.015, 0.03, M.gold(), { pos: [0, 0.12, 0], seg: 6, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.0], rot: [0, 0, 0] };
    },
    lantern: (g, c) => {
      P.cyl(0.05, 0.06, 0.012, M.brass(), { pos: [0, -0.2, 0], seg: 8, parent: g });
      P.cyl(0.052, 0.04, 0.012, M.brass(), { pos: [0, -0.04, 0], seg: 8, parent: g });
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; P.cyl(0.004, 0.004, 0.16, M.brass(), { pos: [Math.cos(a) * 0.05, -0.12, Math.sin(a) * 0.05], seg: 4, parent: g }); }
      P.cyl(0.046, 0.046, 0.15, psx({ color: c ?? PAL.BULB_YELLOW, lit: false, transparent: true, opacity: 0.55, depthWrite: false }), { pos: [0, -0.12, 0], seg: 8, shade: false, parent: g });
      P.torus(0.045, 0.004, M.brass(), { pos: [0, 0.0, 0], rot: [0, 0, 0], seg: 8, tubeSeg: 3, arc: Math.PI, parent: g });
      return { bone: 'hand_r', pos: [0, 0.06, 0], rot: [0, 0, 0] };
    },
    torch: (g, c) => {
      P.cyl(0.026, 0.02, 0.16, M.gunmetal(), { pos: [0, 0.0, 0], seg: 8, parent: g });
      P.cyl(0.045, 0.028, 0.07, M.chrome(), { pos: [0, 0.115, 0], seg: 8, parent: g });
      P.cyl(0.04, 0.04, 0.006, psx({ color: c ?? PAL.BULB_YELLOW, lit: false }), { pos: [0, 0.152, 0], seg: 8, shade: false, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.03], rot: [90, 0, 0] };
    },
    key: (g, c) => {
      P.torus(0.025, 0.006, c === undefined ? M.brass() : flat(c), { pos: [0, 0.05, 0], seg: 8, tubeSeg: 3, parent: g });
      P.cyl(0.006, 0.006, 0.14, M.brass(), { pos: [0, -0.04, 0], seg: 5, parent: g });
      for (const y of [-0.09, -0.065]) P.box(0.03, 0.014, 0.008, M.brass(), { pos: [0.015, y, 0], parent: g });
      return { bone: 'hand_r', pos: [0, 0.06, 0], rot: [0, 0, 0] };
    },
    tonic: (g, c) => {
      const glassM = psx({ color: c ?? PAL.FELT_LIGHT, lit: false, transparent: true, opacity: 0.7, depthWrite: false });
      P.lathe([[0.0, 0.0], [0.03, 0.0], [0.034, 0.02], [0.034, 0.1], [0.016, 0.13], [0.012, 0.17], [0.0, 0.17]], 8, glassM, { shade: false, parent: g });
      P.cyl(0.014, 0.014, 0.02, M.brass(), { pos: [0, 0.18, 0], seg: 6, parent: g });
      P.box(0.05, 0.05, 0.002, M.paper(), { pos: [0, 0.07, 0.034], parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.02], rot: [0, 0, 0] };
    },
    gavel: (g, c) => {
      P.cyl(0.01, 0.012, 0.22, c === undefined ? M.wood('mahogany') : flat(c), { pos: [0, -0.05, 0], seg: 6, parent: g });
      P.cyl(0.03, 0.03, 0.1, M.wood('mahogany'), { pos: [0, 0.07, 0], rot: [0, 0, 90], seg: 8, parent: g });
      return { bone: 'hand_r', pos: [0, 0.06, 0], rot: [0, 0, 0] };
    },
    envelope: (g, c) => {
      P.box(0.15, 0.004, 0.09, M.paper(), { parent: g });
      P.box(0.07, 0.006, 0.03, flat(c ?? PAL.CASINO_RED), { pos: [0, 0.002, 0.0], parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.0], rot: [0, 0, 0] };
    },
    cigar: (g, c) => {
      P.cyl(0.009, 0.009, 0.13, flat(c ?? 0x6b3a21), { pos: [0, 0.0, 0.065], rot: [90, 0, 0], seg: 5, parent: g });
      P.cyl(0.0095, 0.0095, 0.012, flat(PAL.GOLD), { pos: [0, 0.0, 0.03], rot: [90, 0, 0], seg: 5, parent: g });
      P.sphere(0.008, M.unlit(PAL.AMBER), { pos: [0, 0, 0.133], wSeg: 4, hSeg: 3, parent: g, shade: false });
      return { bone: 'hand_r', pos: [0, 0.07, 0.02], rot: [0, 0, 0] };
    },
    glass: (g, c) => {
      const glassM = psx({ color: PAL.ICE, lit: false, transparent: true, opacity: 0.45, depthWrite: false });
      P.lathe([[0.0, 0.0], [0.03, 0.0], [0.03, 0.006], [0.004, 0.012], [0.004, 0.07], [0.04, 0.12], [0.045, 0.2], [0.0, 0.2]], 8, glassM, { shade: false, parent: g });
      P.cyl(0.035, 0.04, 0.07, psx({ color: c ?? PAL.AMBER, lit: false, transparent: true, opacity: 0.75, depthWrite: false }), { pos: [0, 0.15, 0], seg: 8, shade: false, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0], rot: [0, 0, 0] };
    },
    bowtie: (g, c) => {
      const m = flat(c ?? PAL.CASINO_RED);
      for (const s2 of [-1, 1]) P.cyl(0.001, 0.034, 0.05, m, { pos: [s2 * 0.026, 0, 0], rot: [0, 0, s2 * 90], seg: 4, parent: g });
      P.box(0.016, 0.016, 0.016, m, { parent: g });
      return { bone: 'neck_01', pos: [0, 0.02, 0.075] };
    },
    mic: (g, c) => {
      P.cyl(0.009, 0.009, 0.16, M.gunmetal(), { pos: [0, 0, 0], seg: 5, parent: g });
      P.sphere(0.034, c === undefined ? M.chrome() : flat(c), { pos: [0, 0.1, 0], wSeg: 7, hSeg: 5, parent: g });
      P.torus(0.036, 0.004, M.gunmetal(), { pos: [0, 0.1, 0], rot: [90, 0, 0], seg: 8, tubeSeg: 3, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.0], rot: [0, 0, 0] };
    },
    watch: (g, c) => {
      P.cyl(0.03, 0.03, 0.012, c === undefined ? M.gold() : flat(c), { rot: [90, 0, 0], seg: 10, parent: g });
      P.cyl(0.024, 0.024, 0.002, M.paper(), { pos: [0, 0, 0.007], rot: [90, 0, 0], seg: 10, parent: g });
      P.box(0.003, 0.02, 0.002, flat(PAL.PIT_BLACK), { pos: [0, 0.008, 0.009], parent: g });
      P.cyl(0.006, 0.006, 0.014, M.gold(), { pos: [0, 0.035, 0], seg: 5, parent: g });
      P.tube([[0, 0.04, 0], [0.05, 0.02, 0], [0.09, -0.08, 0]], 0.003, M.gold(), { seg: 6, radialSeg: 3, parent: g });
      return { bone: 'hand_r', pos: [0, 0.07, 0.0] };
    },
    coat_long: (g, c) => {
      const cloth = M.enamel(c ?? 0x1a1414, 0.4);
      P.lathe([[0.17, 0.0], [0.2, -0.2], [0.26, -0.5], [0.3, -0.62]], 10, cloth, { parent: g });
      P.lathe([[0.3, -0.62], [0.28, -0.6]], 10, flat(PAL.GOLD), { parent: g });
      return { bone: 'pelvis', pos: [0, 0.0, 0.0], rot: [0, 0, 0] };
    },
  };

  /** Resolve `mask_x` / `hat_x` / bare ids. */
  const builder = (id: string): ((g: THREE.Group, c: Hex | undefined) => Hint) | null => {
    if (id.startsWith('mask_') && MASKS[id.slice(5)]) return MASKS[id.slice(5)];
    if (id.startsWith('hat_') && HATS[id.slice(4)]) return HATS[id.slice(4)];
    return HELD[id] ?? MASKS[id] ?? null;
  };

  const prop: Kit['prop'] = (id, o = {}) => {
    const g = P.group(`prop:${id}`);
    const b = builder(id);
    if (!b) {
      if (!warned.has(id)) { warned.add(id); log.warn('kit', `unknown prop "${id}" — placeholder cube`); }
      P.box(0.1, 0.1, 0.1, flat(o.color ?? PAL.GROUT), { pos: [0, 0.05, 0], parent: g });
      return finish(g, { bone: 'hand_r' });
    }
    const hint = b(g, o.color);
    finish(g, hint);
    if (o.scale !== undefined) { g.scale.setScalar(o.scale); }
    return g;
  };

  return { prop };
}
