/**
 * Smooth 1-D value noise in [−1, 1] — deterministic and allocation-free. Used for camera shake and hand sway
 * (cosmetic only, so no RNG state is needed and nothing depends on frame rate).
 */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** `seed` decorrelates channels (x / y / roll …). */
export function noise1(x: number, seed = 0): number {
  const o = seed * 57.3;
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + o) * (1 - u) + hash(i + 1 + o) * u;
}
