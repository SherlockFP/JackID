/**
 * Small PSX food props (banana, coffee mug, sandwich, energy drink can, tulip çay glass, bowl of soup). One neutral part list per food, in metres,
 * origin = the middle of the base, +Y up. Pure data, no scene: the world builds it with the kit (`buildFoodProp`, for the fridge
 * top, the kitchen counter and the bar), and the first-person hands build the same list in their own scene (src/player/viewmodel/items.ts),
 * so a thing you pick up looks like the thing on the shelf. The ids are the food ids of src/game/food.ts.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';

export type FoodPropId = 'banana' | 'coffee' | 'sandwich' | 'energy' | 'tea' | 'soup';

/** One solid piece: a box (`size` = w,h,d), a cylinder (`size` = rTop,rBottom,h) or a ring (`size` = r,tube,arc), centred on `pos`, turned by `rot` (radians). */
export interface FoodPart {
  shape: 'box' | 'cyl' | 'torus';
  size: readonly [number, number, number];
  pos: readonly [number, number, number];
  rot?: readonly [number, number, number];
  color: number;
  /** Sides of a cylinder (default 10): 5 for a banana's ridges, 3 for a triangle of bread. */
  seg?: number;
  /** The part that gets bitten away: the hands shrink it along `FOOD_BITE` while it is eaten (the rest stays). */
  eat?: boolean;
  /** A small painted texture (`FOOD_TEX`): a pattern the part colour tints, or a full-colour label on a white part. */
  tex?: FoodTex;
  /** On the saucer: the shelf prop has it, the hand holds the glass bare (the first-person hands skip it). */
  plate?: boolean;
  /** See-through glass: the part's opacity (default solid). */
  alpha?: number;
}

// ── textures (wave 88 art pass): tiny painted maps that read at hand distance, no rng (an integer hash places the dots) ─────
export type FoodTex = 'speckle' | 'glaze' | 'crema' | 'label' | 'crumb' | 'bowl' | 'broth';
const hash = (i: number): number => {
  let x = Math.imul(i ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
};
type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;
const dots = (g: CanvasRenderingContext2D, n: number, seed: number, w: number, h: number, c: string, big = 0): void => {
  g.fillStyle = c;
  for (let i = 0; i < n; i++) {
    const s = i < big ? 2 : 1;
    g.fillRect(Math.floor(hash(seed + i * 2) * (w - s + 1)), Math.floor(hash(seed + i * 2 + 1) * (h - s + 1)), s, s);
  }
};
/** Texture painters by id: `px` square. Luminance maps (tinted by the part colour) except `label` and `bowl` (full colour, white part). */
export const FOOD_TEX: Readonly<Record<FoodTex, { px: number; paint: Paint }>> = {
  // banana peel: ripe yellow with sugar spots and a darker ridge line
  speckle: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2e2e2'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    dots(g, 10, 11, w, h, '#6a4a22', 3);
  } },
  // a glazed mug: a bright column where the light catches it, a darker unglazed foot
  glaze: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(3, 0, 2, h);
    g.fillStyle = '#f4f4f4'; g.fillRect(5, 0, 1, h);
    g.fillStyle = '#b8b0a8'; g.fillRect(0, 0, w, 2);
  } },
  // coffee from above: a lighter crema ring at the rim, darker in the middle, a few bubbles
  crema: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c0c0c0'; g.fillRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#7a7a7a'; g.fillRect(4, 4, w - 8, h - 8);
    dots(g, 6, 41, w, h, '#ffffff');
  } },
  // the energy can: teal with a yellow band, a red bolt across it and two thin dark rules
  label: { px: 32, paint: (g, w, h) => {
    g.fillStyle = '#1ec8c0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0e6a7a'; g.fillRect(0, 7, w, 2); g.fillRect(0, 23, w, 2);
    g.fillStyle = '#ffce5a'; g.fillRect(0, 11, w, 10);
    g.fillStyle = '#d0242c';
    for (const [x, y, ww] of [[15, 11, 6], [13, 13, 6], [10, 15, 11], [15, 17, 6], [13, 19, 5]] as const) g.fillRect(x, y, ww, 2);
    g.fillStyle = '#e8fbfa'; for (let x = 2; x < w; x += 6) g.fillRect(x, 27, 3, 1);
  } },
  // bread: open crumb, light and dark flecks
  crumb: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    dots(g, 14, 71, w, h, '#b89a78', 4);
    dots(g, 6, 97, w, h, '#ffffff');
  } },
  // the soup bowl: cream stoneware with a blue band under the rim
  bowl: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#e6dec5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a4a8a'; g.fillRect(0, h - 5, w, 2);
    g.fillStyle = '#c8c0a8'; g.fillRect(0, 0, w, 2);
    g.fillStyle = '#f4eedc'; g.fillRect(4, 3, 1, h - 9);
  } },
  // soup: a swirl of cream and a few herbs
  broth: { px: 16, paint: (g, w, h) => {
    g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (const [x, y] of [[5, 4], [6, 4], [7, 5], [8, 6], [8, 7], [7, 8], [6, 8], [5, 7], [9, 9], [10, 10], [11, 10]] as const) g.fillRect(x, y, 1, 1);
    dots(g, 5, 131, w, h, '#3a6a2a');
  } },
};

const p = (shape: FoodPart['shape'], size: FoodPart['size'], pos: FoodPart['pos'], color: number, rot?: FoodPart['rot'], more?: Pick<FoodPart, 'seg' | 'eat' | 'tex' | 'plate' | 'alpha'>): FoodPart =>
  ({ shape, size, pos, color, rot, ...more });

const YELLOW = 0xe8c840;
const YELLOW_DEEP = 0xd2ae2c;
const FLESH = 0xf3e7b4;
const STEM = 0x7a6a2c;

// ── the banana ─────────────────────────────────────────────────────────────────────────────────────
// lying along X as a smile (tips lifted): five-sided slices along the curve (a banana has ridges), a stem, and the top peeled
// back: cream flesh above the peel line and three strips of peel hanging off it
const BANANA = { half: 0.088, rise: 0.028, mid: 0.0165, rMid: 0.0158, peel: 0.047, tip: 0.092 };
const bananaY = (x: number): number => BANANA.mid + BANANA.rise * (x / BANANA.half) ** 2;
const bananaAngle = (x: number): number => Math.atan((2 * BANANA.rise * x) / (BANANA.half * BANANA.half));
const bananaR = (x: number): number => BANANA.rMid - 0.0052 * Math.pow(Math.abs(x) / 0.092, 1.6);

/** Slices of the curve between the x edges `xs`: a tapered cylinder per slice, turned to the local tangent. */
function bananaSlices(xs: readonly number[], color: number, k: number, eat: boolean): FoodPart[] {
  const out: FoodPart[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], xc = (a + b) / 2;
    const len = Math.hypot(b - a, bananaY(b) - bananaY(a)) * 1.1;
    out.push(p('cyl', [bananaR(b) * k, bananaR(a) * k, len], [xc, bananaY(xc), 0], color, [0, 0, bananaAngle(xc) - Math.PI / 2], { seg: 5, eat, tex: eat ? undefined : 'speckle' }));
  }
  return out;
}

/** Euler angles that turn a box's +Y onto `y` with its +Z as close to `hint` as the turn allows. */
function orient(y: THREE.Vector3, hint: THREE.Vector3): [number, number, number] {
  const yy = y.clone().normalize();
  const z = hint.clone().addScaledVector(yy, -hint.dot(yy)).normalize();
  const x = new THREE.Vector3().crossVectors(yy, z);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, yy, z));
  return [e.x, e.y, e.z];
}

function bananaParts(): FoodPart[] {
  const parts = bananaSlices([-0.086, -0.052, -0.017, 0.017, BANANA.peel], YELLOW, 1, false);
  parts.push(...bananaSlices([BANANA.peel - 0.004, 0.07, BANANA.tip], FLESH, 0.84, true));
  // the stem at the low end, pointing along the curve
  const a0 = bananaAngle(-0.086), out = new THREE.Vector3(-Math.cos(a0), -Math.sin(a0), 0);
  parts.push(p('cyl', [0.0075, 0.0062, 0.026], [-0.086 + out.x * 0.011, bananaY(-0.086) + out.y * 0.011, 0], STEM, [0, 0, a0 - Math.PI / 2], { seg: 5 }));
  parts.push(p('cyl', [0.0068, 0.0076, 0.005], [-0.086 + out.x * 0.025, bananaY(-0.086) + out.y * 0.025, 0], 0x3a2a14, [0, 0, a0 - Math.PI / 2], { seg: 5 }));   // the stem's dark cut end
  // three strips of peel, peeled down from the line and bowing outwards
  const px = BANANA.peel, py = bananaY(px);
  for (const phi of [1.3, 3.5, 5.6]) {
    const radial = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
    const d = new THREE.Vector3(-0.84, 0, 0).addScaledVector(radial, 0.54);                      // back along the banana, 33 degrees out
    const root = new THREE.Vector3(px, py, 0).addScaledVector(radial, 0.0128);
    const c = root.addScaledVector(d, 0.021);
    parts.push(p('box', [0.017, 0.042, 0.003], [c.x, c.y, c.z], YELLOW_DEEP, orient(d, radial)));
  }
  return parts;
}

// ── the çay glass ──────────────────────────────────────────────────────────────────────────────────
// the ince belli tulip glass of identity.ts `cayGlass` (same profile: round foot, narrow waist, flared lip) as five tapered rings on a
// small saucer, dark amber-red tea, a thin gold rim and a sugar cube. The glass stands on the saucer (TEA_Y0 = its top).
const TEA_Y0 = 0.009, TEA = 0x5a1408, TEA_TOP = 0x661a0a, GLASS = 0x90a0a0, TEA_GOLD = 0xc8a048;
/** [rTop, rBottom, from y, to y] up the glass (above the saucer): foot, belly, waist, flare, lip. */
const TEA_RINGS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.020, 0.019, 0, 0.006], [0.014, 0.020, 0.006, 0.032], [0.013, 0.014, 0.032, 0.048], [0.018, 0.013, 0.048, 0.074], [0.0215, 0.018, 0.074, 0.094],
];
const TEA_FILL = 0.08, TEA_WALL = 0.0016;   // the tea stands to here (a clear band above it) and sits this far inside the glass
const teaParts = (): FoodPart[] => [
  p('cyl', [0.048, 0.04, 0.008], [0, 0.004, 0], 0xece6d6, undefined, { seg: 10, plate: true }),
  p('cyl', [0.049, 0.049, 0.002], [0, 0.0085, 0], TEA_GOLD, undefined, { seg: 10, plate: true }),
  p('box', [0.012, 0.012, 0.012], [0.034, 0.014, 0.012], 0xf2efe6, [0, 0.5, 0], { plate: true }),   // the sugar cube
  // the tea first (opaque, a hair inside the glass), then the clear glass shell over it (see-through; the foot is solid)
  ...TEA_RINGS.slice(1).map(([rt, rb, y0, y1]) => {
    const t = Math.min(y1, TEA_FILL), k = (t - y0) / (y1 - y0), rTop = rb + (rt - rb) * k;   // the last ring is cut at the fill line
    return y0 < TEA_FILL ? p('cyl', [rTop - TEA_WALL, rb - TEA_WALL, t - y0], [0, TEA_Y0 + (y0 + t) / 2, 0], TEA, undefined, { seg: 8 }) : null;
  }).filter((x): x is FoodPart => x !== null),
  p('cyl', [0.0188, 0.0188, 0.001], [0, TEA_Y0 + TEA_FILL, 0], TEA_TOP, undefined, { seg: 8 }),   // the tea's surface, a pinch lighter
  ...TEA_RINGS.map(([rt, rb, y0, y1], i) => p('cyl', [rt, rb, y1 - y0], [0, TEA_Y0 + (y0 + y1) / 2, 0], GLASS, undefined, { seg: 8, alpha: i === 0 ? undefined : 0.13 })),
  p('torus', [0.0216, 0.0013, Math.PI * 2], [0, TEA_Y0 + 0.094, 0], TEA_GOLD, [Math.PI / 2, 0, 0]),   // the thin gold rim line
];

// ── the sandwich ───────────────────────────────────────────────────────────────────────────────────
// half a sandwich cut corner to corner: triangular slabs (3-sided cylinders, the point towards +Z); the point is the bitten end
const SAND_R = 0.05;
const sand = (r: number, h: number, y: number, color: number, turn = 0, tex?: FoodTex): FoodPart => p('cyl', [r, r, h], [0, y, 0], color, [0, turn, 0], { seg: 3, eat: true, tex });

export const FOOD_PARTS: Readonly<Record<FoodPropId, readonly FoodPart[]>> = {
  banana: bananaParts(),
  // a red glazed mug with a cream band, coffee with a crema ring, and a round handle
  coffee: [
    p('cyl', [0.0315, 0.0285, 0.074], [0, 0.037, 0], 0xb5402e, undefined, { seg: 12, tex: 'glaze' }),
    p('cyl', [0.0322, 0.0305, 0.014], [0, 0.045, 0], 0xe6dec5, undefined, { seg: 12 }),
    p('cyl', [0.0322, 0.0322, 0.004], [0, 0.0745, 0], 0xe6dec5, undefined, { seg: 12 }),     // the rim, then the coffee a hair above it (no coplanar faces)
    p('cyl', [0.0275, 0.0275, 0.002], [0, 0.0765, 0], 0x7a4a26, undefined, { seg: 12, tex: 'crema' }),
    p('torus', [0.0175, 0.0055, Math.PI], [0.031, 0.041, 0], 0xb5402e, [0, 0, -Math.PI / 2]),
  ],
  // two slices of bread around lettuce, ham and cheese
  sandwich: [
    sand(SAND_R, 0.012, 0.006, 0xc9944a, 0, 'crumb'),
    sand(SAND_R * 1.06, 0.006, 0.015, 0x6aa040, 0.22),
    sand(SAND_R * 0.96, 0.007, 0.0215, 0xd9707a, 0.08),
    sand(SAND_R * 1.02, 0.004, 0.0275, 0xf0c848, -0.14),
    sand(SAND_R, 0.012, 0.0375, 0xd8a458, 0, 'crumb'),
  ],
  // a tall can: the painted label (teal, a yellow band, a red bolt), a silver shoulder, a lid lip and a pull tab
  energy: [
    p('cyl', [0.0168, 0.0168, 0.115], [0, 0.0625, 0], 0xffffff, undefined, { seg: 12, tex: 'label' }),
    p('cyl', [0.0148, 0.0168, 0.007], [0, 0.1235, 0], 0xc8d0d8, undefined, { seg: 12 }),
    p('cyl', [0.0152, 0.0152, 0.003], [0, 0.1285, 0], 0xa8b0b8, undefined, { seg: 12 }),
    p('cyl', [0.0168, 0.0148, 0.006], [0, 0.003, 0], 0xc8d0d8, undefined, { seg: 12 }),
    p('box', [0.011, 0.0025, 0.007], [0, 0.1312, 0.002], 0xe8eef2),
  ],
  tea: teaParts(),
  // a stoneware bowl with a blue band, orange soup with a cream swirl and two croutons, a spoon resting in it
  soup: [
    p('cyl', [0.062, 0.04, 0.05], [0, 0.025, 0], 0xffffff, undefined, { seg: 12, tex: 'bowl' }),
    p('cyl', [0.065, 0.064, 0.004], [0, 0.0505, 0], 0xcfc6ac, undefined, { seg: 12 }),
    p('cyl', [0.055, 0.055, 0.003], [0, 0.0535, 0], 0xc86a28, undefined, { seg: 12, tex: 'broth' }),
    p('box', [0.009, 0.007, 0.009], [0.02, 0.0565, -0.016], 0xd8a050, [0, 0.5, 0]),
    p('box', [0.008, 0.007, 0.008], [-0.014, 0.0565, -0.028], 0xc89040, [0, 1.1, 0]),
    p('box', [0.1, 0.004, 0.008], [0.01, 0.059, 0.02], 0xc8d0d8, [0, 0.4, 0]),
    p('cyl', [0.012, 0.012, 0.004], [-0.038, 0.0565, 0.04], 0xc8d0d8, undefined, { seg: 8 }),
  ],
};

/** Foods that get bitten: the part flagged `eat` shrinks along `axis` (0 x, 1 y, 2 z) about the coordinate `from` (the bite line stays put). */
export const FOOD_BITE: Readonly<Partial<Record<FoodPropId, { axis: 0 | 1 | 2; from: number }>>> = {
  banana: { axis: 0, from: BANANA.peel },
  sandwich: { axis: 2, from: -SAND_R / 2 },
};

/** Builds `id` as a group of kit meshes (colours and the small painted maps from the kit's caches). Scale 1 = real size. */
export function buildFoodProp(kit: KitX, id: FoodPropId, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = `food:${id}`;
  for (const part of FOOD_PARTS[id]) {
    const t = part.tex ? FOOD_TEX[part.tex] : null;
    const m = kit.mat({ color: part.color, map: t && part.tex ? kit.tex.canvas(t.px, t.px, t.paint, { key: `food:${part.tex}` }) : undefined,
      ...(part.alpha ? { transparent: true, opacity: part.alpha, depthWrite: false } : {}) });
    const mesh = part.shape === 'box'
      ? kit.box(part.size[0], part.size[1], part.size[2], m, { parent: g })
      : part.shape === 'torus'
        ? kit.torus(part.size[0], part.size[1], m, { parent: g, arc: part.size[2], seg: 10, tubeSeg: 5 })
        : kit.cyl(part.size[0], part.size[1], part.size[2], m, { parent: g, seg: part.seg ?? 10 });
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
    if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
  }
  g.scale.setScalar(scale);
  return g;
}
