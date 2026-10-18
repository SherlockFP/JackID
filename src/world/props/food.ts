/**
 * Small PSX food props (banana, coffee cup, sandwich, energy drink can, bowl of soup). One neutral part list per food, in metres,
 * origin = the middle of the base, +Y up. Pure data, no THREE: the world builds it with the kit (`buildFoodProp`, for the fridge
 * top, the kitchen counter and the bar), and the first-person hands build the same list in their own scene (src/player/viewmodel.ts),
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
}

const p = (shape: FoodPart['shape'], size: FoodPart['size'], pos: FoodPart['pos'], color: number, rot?: FoodPart['rot']): FoodPart =>
  ({ shape, size, pos, color, rot });

const YELLOW = 0xe8c840;
const YELLOW_DEEP = 0xc9a428;
const STEM = 0x6a5a28;

export const FOOD_PARTS: Readonly<Record<FoodPropId, readonly FoodPart[]>> = {
  // a banana lying along X: three bent slices, a stem and a dark tip
  banana: [
    p('box', [0.05, 0.026, 0.03], [-0.046, 0.02, 0], YELLOW, [0, 0, 0.42]),
    p('box', [0.066, 0.03, 0.034], [0, 0.014, 0], YELLOW),
    p('box', [0.05, 0.026, 0.03], [0.046, 0.02, 0], YELLOW, [0, 0, -0.42]),
    p('box', [0.016, 0.014, 0.014], [-0.072, 0.038, 0], STEM, [0, 0, 0.42]),
    p('box', [0.012, 0.012, 0.014], [0.07, 0.038, 0], 0x3a2e12, [0, 0, -0.42]),
    p('box', [0.066, 0.006, 0.026], [0, 0.005, 0], YELLOW_DEEP),
  ],
  // a paper-and-clay cup of coffee with a handle
  coffee: [
    p('cyl', [0.031, 0.024, 0.07], [0, 0.035, 0], 0xe6dec5),
    p('cyl', [0.027, 0.027, 0.004], [0, 0.068, 0], 0x2a1608),
    p('box', [0.016, 0.034, 0.008], [0.04, 0.038, 0], 0xe6dec5),
    p('cyl', [0.0325, 0.0325, 0.01], [0, 0.04, 0], 0x8c1921),
  ],
  // two slices of bread around lettuce, ham and cheese
  sandwich: [
    p('box', [0.09, 0.014, 0.07], [0, 0.007, 0], 0xc9944a),
    p('box', [0.086, 0.006, 0.066], [0, 0.017, 0], 0x6aa040),
    p('box', [0.082, 0.008, 0.062], [0, 0.024, 0], 0xd9707a),
    p('box', [0.088, 0.005, 0.068], [0, 0.031, 0], 0xf0c848, [0, 0.12, 0]),
    p('box', [0.09, 0.014, 0.07], [0, 0.041, 0], 0xd8a458),
  ],
  // a tall can with a yellow band and a silver lid
  energy: [
    p('cyl', [0.0165, 0.0165, 0.12], [0, 0.06, 0], 0x1ec8c0),
    p('cyl', [0.0169, 0.0169, 0.03], [0, 0.058, 0], 0xffce5a),
    p('cyl', [0.0148, 0.0165, 0.006], [0, 0.123, 0], 0xc8d0d8),
    p('cyl', [0.0165, 0.0148, 0.006], [0, 0.003, 0], 0xc8d0d8),
  ],
  // a round bowl of orange soup with a spoon across the rim
  soup: [
    p('cyl', [0.062, 0.04, 0.05], [0, 0.025, 0], 0xe6dec5),
    p('cyl', [0.055, 0.055, 0.004], [0, 0.048, 0], 0xc86a28),
    p('box', [0.1, 0.004, 0.008], [0.01, 0.054, 0.02], 0xc8d0d8, [0, 0.4, 0]),
  ],
};

/** Builds `id` as a group of kit meshes (unlit-safe flat colours from the kit's material cache). Scale 1 = real size. */
export function buildFoodProp(kit: KitX, id: FoodPropId, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = `food:${id}`;
  for (const part of FOOD_PARTS[id]) {
    const m = kit.mat({ color: part.color });
    const mesh = part.shape === 'box'
      ? kit.box(part.size[0], part.size[1], part.size[2], m, { parent: g })
      : kit.cyl(part.size[0], part.size[1], part.size[2], m, { parent: g, seg: 10 });
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
    if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
  }
  g.scale.setScalar(scale);
  return g;
}
