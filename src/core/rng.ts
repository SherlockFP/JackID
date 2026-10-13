/**
 * Seeded RNG (TD-owned). sfc32 seeded through cyrb128. Contract: TECH_SPEC §2.8.
 *
 * Seed derivation (identical on every peer): `runSeed` (uint32, host picks, `?seed=` overrides) →
 *  - machine occupancy stream: `hashSeed(runSeed, mid, occCounter)` — sent in `moccOk.seed`;
 *  - table (host) stream:      `hashSeed(runSeed, mid, 'table')`;
 *  - world/init stream:        `hashSeed(runSeed, mid, 'init')`;
 *  - `app.rng.cosmetic`:       `Math.random`-seeded, visuals only, never outcomes.
 * `Math.random()` is FORBIDDEN for any outcome; this file is the only legitimate user (cosmetic seed).
 */
export interface Rng {
  readonly seed: number;
  next(): number;                                   // [0,1)
  int(min: number, max: number): number;            // inclusive both ends
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  weightedIndex(weights: readonly number[]): number;
  shuffle<T>(arr: T[]): T[];                        // in place, Fisher–Yates
  gauss(mean?: number, sd?: number): number;
  fork(label: string | number): Rng;                // deterministic child stream
  getState(): [number, number, number, number];
  setState(s: [number, number, number, number]): void;
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Stable uint32 hash of any mix of strings/numbers. */
export function hashSeed(...parts: Array<string | number>): number {
  return cyrb128(parts.join('␟'))[0];
}

class Sfc32 implements Rng {
  readonly seed: number;
  private a = 0; private b = 0; private c = 0; private d = 0;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    const s = cyrb128(`rng:${this.seed}`);
    this.a = s[0]; this.b = s[1]; this.c = s[2]; this.d = s[3];
    for (let i = 0; i < 12; i++) this.next();      // warm-up
  }

  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  float(min: number, max: number): number { return min + this.next() * (max - min); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
    if (total <= 0) return Math.floor(this.next() * weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }
  weighted<T>(items: readonly T[], weights: readonly number[]): T { return items[this.weightedIndex(weights)]; }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /** Box–Muller; always consumes exactly two draws so `getState` replays exactly. */
  gauss(mean = 0, sd = 1): number {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  fork(label: string | number): Rng { return new Sfc32(hashSeed(this.seed, label)); }
  getState(): [number, number, number, number] { return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0]; }
  setState(s: [number, number, number, number]): void { this.a = s[0]; this.b = s[1]; this.c = s[2]; this.d = s[3]; }
}

export function createRng(seed: number | string): Rng {
  return new Sfc32(seed);
}
/** Seed for the cosmetic stream only. */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
