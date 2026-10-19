/**
 * Small PSX food props (banana, coffee mug, sandwich, energy drink can, bowl of soup). One neutral part list per food, in metres,
 * origin = the middle of the base, +Y up. Pure data, no scene: the world builds it with the kit (`buildFoodProp`, for the fridge
 * top, the kitchen counter and the bar), and the first-person hands build the same list in their own scene (src/player/viewmodel/items.ts),
 * so a thing you pick up looks like the thing on the shelf. The ids are the food ids of src/game/food.ts.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';

export type FoodPropId = 'banana' | 'coffee' | 'sandwich' | 'energy' | 'soup';

/** One solid piece: a box (`size` = w,h,d) or a cylinder (`size` = rTop,rBottom,h), centred on `pos`, turned by `rot` (radians). */
export interface FoodPart {
  shape: 'box' | 'cyl';
  size: readonly [number, number, number];
  pos: readonly [number, number, number];
  rot?: readonly [number, number, number];
  color: number;
  /** Sides of a cylinder (default 10): 5 for a banana's ridges, 3 for a triangle of bread. */
  seg?: number;
  /** The part that gets bitten away: the hands shrink it along `FOOD_BITE` while it is eaten (the rest stays). */
  eat?: boolean;
}

const p = (shape: FoodPart['shape'], size: FoodPart['size'], pos: FoodPart['pos'], color: number, rot?: FoodPart['rot'], more?: Pick<FoodPart, 'seg' | 'eat'>): FoodPart =>
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
    out.push(p('cyl', [bananaR(b) * k, bananaR(a) * k, len], [xc, bananaY(xc), 0], color, [0, 0, bananaAngle(xc) - Math.PI / 2], { seg: 5, eat }));
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

// ── the sandwich ───────────────────────────────────────────────────────────────────────────────────
// half a sandwich cut corner to corner: triangular slabs (3-sided cylinders, the point towards +Z); the point is the bitten end
const SAND_R = 0.05;
const sand = (r: number, h: number, y: number, color: number, turn = 0): FoodPart => p('cyl', [r, r, h], [0, y, 0], color, [0, turn, 0], { seg: 3, eat: true });

export const FOOD_PARTS: Readonly<Record<FoodPropId, readonly FoodPart[]>> = {
  banana: bananaParts(),
  // a red ceramic mug with a cream band, a dark coffee surface and a handle
  coffee: [
    p('cyl', [0.0315, 0.0285, 0.074], [0, 0.037, 0], 0xb5402e),
    p('cyl', [0.0322, 0.0305, 0.014], [0, 0.045, 0], 0xe6dec5),
    p('cyl', [0.0322, 0.0322, 0.004], [0, 0.0745, 0], 0xe6dec5),              // the rim, then the coffee a hair above it (no coplanar faces)
    p('cyl', [0.0275, 0.0275, 0.002], [0, 0.0765, 0], 0x2a1608),
    p('box', [0.014, 0.007, 0.008], [0.04, 0.059, 0], 0xb5402e),
    p('box', [0.007, 0.034, 0.008], [0.0455, 0.041, 0], 0xb5402e),
    p('box', [0.014, 0.007, 0.008], [0.04, 0.024, 0], 0xb5402e),
  ],
  // two slices of bread around lettuce, ham and cheese
  sandwich: [
    sand(SAND_R, 0.012, 0.006, 0xc9944a),
    sand(SAND_R * 1.06, 0.006, 0.015, 0x6aa040, 0.22),
    sand(SAND_R * 0.96, 0.007, 0.0215, 0xd9707a, 0.08),
    sand(SAND_R * 1.02, 0.004, 0.0275, 0xf0c848, -0.14),
    sand(SAND_R, 0.012, 0.0375, 0xd8a458),
  ],
  // a tall can with a yellow band, a silver rim and a pull tab
  energy: [
    p('cyl', [0.0168, 0.0168, 0.115], [0, 0.0625, 0], 0x1ec8c0),
    p('cyl', [0.0172, 0.0172, 0.03], [0, 0.062, 0], 0xffce5a),
    p('cyl', [0.0171, 0.0171, 0.005], [0, 0.0415, 0], 0x0e6a7a),
    p('cyl', [0.0171, 0.0171, 0.005], [0, 0.0825, 0], 0x0e6a7a),
    p('cyl', [0.0148, 0.0168, 0.007], [0, 0.1235, 0], 0xc8d0d8),
    p('cyl', [0.0168, 0.0148, 0.006], [0, 0.003, 0], 0xc8d0d8),
    p('box', [0.011, 0.0025, 0.007], [0, 0.1275, 0.002], 0xe8eef2),
  ],
  // a round bowl of orange soup with a spoon across the rim
  soup: [
    p('cyl', [0.062, 0.04, 0.05], [0, 0.025, 0], 0xe6dec5),
    p('cyl', [0.065, 0.064, 0.004], [0, 0.0505, 0], 0xcfc6ac),
    p('cyl', [0.055, 0.055, 0.003], [0, 0.0535, 0], 0xc86a28),
    p('box', [0.1, 0.004, 0.008], [0.01, 0.059, 0.02], 0xc8d0d8, [0, 0.4, 0]),
  ],
};

/** Foods that get bitten: the part flagged `eat` shrinks along `axis` (0 x, 1 y, 2 z) about the coordinate `from` (the bite line stays put). */
export const FOOD_BITE: Readonly<Partial<Record<FoodPropId, { axis: 0 | 1 | 2; from: number }>>> = {
  banana: { axis: 0, from: BANANA.peel },
  sandwich: { axis: 2, from: -SAND_R / 2 },
};

/** Builds `id` as a group of kit meshes (unlit-safe flat colours from the kit's material cache). Scale 1 = real size. */
export function buildFoodProp(kit: KitX, id: FoodPropId, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = `food:${id}`;
  for (const part of FOOD_PARTS[id]) {
    const m = kit.mat({ color: part.color });
    const mesh = part.shape === 'box'
      ? kit.box(part.size[0], part.size[1], part.size[2], m, { parent: g })
      : kit.cyl(part.size[0], part.size[1], part.size[2], m, { parent: g, seg: part.seg ?? 10 });
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
    if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
  }
  g.scale.setScalar(scale);
  return g;
}
