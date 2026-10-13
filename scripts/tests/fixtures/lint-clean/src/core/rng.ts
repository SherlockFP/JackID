/** Fixture: the RNG module is the one place Math.random may be read. */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
