/**
 * Light fixtures (WORLD-ARCH). Each builder makes the visible part of one fixture (brass, glass, bulbs, cords) and
 * returns the `LightHint` the level registers with the pooled point lights (world/sys/lightPool). The pool does the
 * real lighting; these builders only add the emissive geometry, so the fixture reads as the light source.
 *
 * `flickerLevel()` is the deterministic 0..1 envelope for anything the level animates by hand (tubes, mesh emissive,
 * the swinging Parlour bulb). Profiles follow ART_BIBLE §1.7 names. It is seeded by time and an offset, never Math.random.
 */
import type * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import type { KitX } from '@/kit';
import type { FlickerId, LightHint } from './sys/arch';

export interface FixtureOpts {
  /** Stable id stem; the hint id becomes `<id>`. */
  id: string;
  pos: V3;
  color: Hex;
  zone?: string;
  intensity?: number;
  range?: number;
  flicker?: FlickerId;
}
export interface Fixture {
  root: THREE.Group;
  hint: LightHint;
  /** Lamp / bulb parts the level or the flicker envelope can drive. */
  setOn(on: boolean): void;
  /** Bulb-ring pattern (chandeliers: the light show drives it). */
  pattern?(p: 'chase' | 'alt' | 'blink' | 'rainbow' | 'all' | 'off', hz?: number): void;
  update?(dt: number, t: number): void;
}

/** Every fixture built since the level began (`resetFixtures`): the night cycle (world/nightLights.ts) switches a zone's lamps off at Dawn and on at the opening. */
export interface BuiltFixture { pos: V3; zone?: string; setOn(on: boolean): void }
const built: BuiltFixture[] = [];
export const resetFixtures = (): void => { built.length = 0; };
export const builtFixtures = (): readonly BuiltFixture[] => built;
/** Registers a fixture; a fixture switched off stops running its own flicker `update`, so the flicker cannot light it again. */
function reg(f: Fixture): Fixture {
  const on = f.setOn, upd = f.update;
  let dark = false;
  f.setOn = (v) => { dark = !v; on(v); };
  if (upd) f.update = (dt, t) => { if (!dark) upd(dt, t); };
  built.push({ pos: f.hint.pos, zone: f.hint.zone, setOn: (v) => f.setOn(v) });
  return f;
}

const hashN = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Deterministic light envelope in [0, 1.2]. `t` seconds, `seed` decorrelates fixtures.
 *   STEADY  1
 *   BUZZ    fluorescent hum with occasional stutter
 *   DYING   mostly on, sudden dips roughly every 30 s
 *   CANDLE  slow wander with small jitter
 *   SICK    slow sine breathing (Devil's lamp)
 *   STROBE  hard on/off at 8 Hz (use sparingly, honour reduce-flashing at the caller)
 *   CHASE / RING   neutral 1 here (the bulb chain carries the pattern)
 */
export function flickerLevel(id: FlickerId, t: number, seed = 0): number {
  switch (id) {
    case 'BUZZ': {
      const k = Math.floor(t * 30 + seed * 7);
      const stutter = hashN(k) > 0.985 ? 0.25 : 1;
      return (0.92 + 0.08 * hashN(k + 3)) * stutter;
    }
    case 'DYING': {
      // mostly on; a 0.8 s dip to ~15 % and back, once per 30 s cycle (offset per fixture by `seed`)
      const cyc = (t + seed * 3.7) % 30;
      if (cyc >= 29.2) return 0.15 + 0.85 * ((cyc - 29.2) / 0.8);
      return 0.85 + 0.15 * hashN(Math.floor(t * 12 + seed));
    }
    case 'CANDLE':
      return 0.8 + 0.12 * Math.sin(t * 5.1 + seed) + 0.08 * hashN(Math.floor(t * 20 + seed * 11));
    case 'SICK':
      return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3 + seed));
    case 'STROBE':
      return Math.sin(t * Math.PI * 16 + seed) > 0 ? 1.2 : 0;
    default:
      return 1;
  }
}

/** Half-disc deco sconce on a brass plate, mounted flush to a wall whose outward normal is `facing` (degrees, yaw). */
export function sconce(kit: KitX, o: FixtureOpts & { facing: 0 | 90 | 180 | 270 }): Fixture {
  const root = kit.group(`sconce:${o.id}`);
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  root.rotation.y = (o.facing * Math.PI) / 180;
  const plate = kit.box(0.12, 0.5, 0.04, kit.pal.brass, { pos: [0, 0, 0.02], parent: root, bevel: 0.01 });
  void plate;
  const lamp = kit.lamp({ r: 0.3, color: o.color, shape: 'dome' });
  lamp.root.position.set(0, 0.02, 0.1);
  root.add(lamp.root);
  lamp.setOn(true);
  return reg({
    root,
    hint: { id: o.id, pos: o.pos, color: o.color, intensity: o.intensity ?? 0.55, range: o.range ?? 3.5, flicker: o.flicker ?? 'CANDLE', zone: o.zone },
    setOn: (on) => lamp.setOn(on),
  });
}

/** Table pendant: a cone shade on a stem, emissive inner face. `drop` = metres from the ceiling to the shade. */
export function pendant(kit: KitX, o: FixtureOpts & { drop: number }): Fixture {
  const root = kit.group(`pendant:${o.id}`);
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  kit.cyl(0.012, 0.012, o.drop, kit.pal.black, { pos: [0, o.drop / 2, 0], parent: root });
  const shade = kit.cyl(0.07, 0.25, 0.2, { color: o.color, emissive: o.color, emissiveIntensity: 0.25, lit: false, side: 'double' }, { pos: [0, 0, 0], parent: root, seg: 10 });
  shade.position.y = -0.1;
  const lamp = kit.lamp({ r: 0.06, color: o.color, shape: 'bulb' });
  lamp.root.position.y = -0.02;
  root.add(lamp.root);
  return reg({
    root,
    hint: { id: o.id, pos: [o.pos[0], o.pos[1] - 0.1, o.pos[2]], color: o.color, intensity: o.intensity ?? 1.2, range: o.range ?? 4.5, flicker: o.flicker ?? 'BUZZ', zone: o.zone },
    setOn: (on) => lamp.setOn(on),
  });
}

/**
 * Grand chandelier: a ring of `bulbs` bulbs on radius `r` at height `pos[1]`, a 1.5 m chain to the ceiling at `ceiling`,
 * and a faceted brass crown. The bulb ring is one emissive InstancedMesh (kit.bulbChain), so it costs one draw call.
 */
export function chandelier(kit: KitX, o: FixtureOpts & { r: number; bulbs: number; ceiling: number; tiers?: number }): Fixture {
  const root = kit.group(`chandelier:${o.id}`);
  const chainLen = Math.max(0, o.ceiling - o.pos[1]);
  kit.cyl(0.02, 0.02, chainLen, kit.pal.brass, { pos: [0, o.pos[1] + chainLen / 2, 0], parent: root, seg: 6 });
  const ring: V3[] = [];
  const n = Math.max(3, o.bulbs);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([Math.cos(a) * o.r, o.pos[1], Math.sin(a) * o.r]);
  }
  const bulbs = kit.bulbChain({ path: ring, count: n, colors: [o.color], r: 0.05 });
  bulbs.pattern('all');
  root.add(bulbs.root);
  const tiers = o.tiers ?? 2;
  for (let t = 0; t < tiers; t++) {
    const rr = o.r * (1 - (t + 1) * 0.28);
    kit.torus(rr, 0.02, kit.pal.brass, { pos: [0, o.pos[1] - 0.25 - t * 0.2, 0], rot: [90, 0, 0], parent: root, seg: 10, tubeSeg: 4 });
  }
  const hub = kit.lamp({ r: 0.2, color: o.color, shape: 'dome' });
  hub.root.position.set(0, o.pos[1] + 0.1, 0);
  root.add(hub.root);
  return reg({
    root,
    hint: { id: o.id, pos: [o.pos[0], o.pos[1] - 0.2, o.pos[2]], color: o.color, intensity: o.intensity ?? 1.6, range: o.range ?? 12, flicker: o.flicker ?? 'STEADY', zone: o.zone },
    setOn: (on) => { hub.setOn(on); bulbs.pattern(on ? 'all' : 'off'); },
    pattern: (p, hz) => bulbs.pattern(p, hz),
    update(_dt, t) { root.rotation.z = Math.sin(t * 0.63) * 0.017; },
  });
}

/** Fluorescent tube (or a row of them) as a BulbChain light strip; `flicker` only drives the hint. */
export function tube(kit: KitX, o: FixtureOpts & { length: number; axis?: 'x' | 'z' }): Fixture {
  const root = kit.group(`tube:${o.id}`);
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  const strip = kit.lightStrip({ length: o.length, color: o.color, thickness: 0.06, segments: Math.max(4, Math.round(o.length * 4)), axis: o.axis ?? 'x' });
  root.add(strip.root);
  return reg({
    root,
    hint: { id: o.id, pos: o.pos, color: o.color, intensity: o.intensity ?? 0.9, range: o.range ?? 6, flicker: o.flicker ?? 'BUZZ', zone: o.zone },
    setOn: (on) => strip.pattern(on ? 'all' : 'off'),
    update(_dt, t) {
      const lvl = flickerLevel(o.flicker ?? 'BUZZ', t, o.pos[0] * 3 + o.pos[2]);
      strip.pattern(lvl < 0.5 ? 'off' : 'all');
    },
  });
}

/** Bare bulb on a cord from the ceiling (boiler, counting room). */
export function bareBulb(kit: KitX, o: FixtureOpts & { ceiling: number }): Fixture {
  const root = kit.group(`bulb:${o.id}`);
  const len = Math.max(0, o.ceiling - o.pos[1]);
  kit.cyl(0.006, 0.006, len, kit.pal.black, { pos: [0, o.pos[1] + len / 2, 0], parent: root, seg: 4 });
  const lamp = kit.lamp({ r: 0.09, color: o.color, shape: 'bulb' });
  lamp.root.position.set(0, o.pos[1], 0);
  root.add(lamp.root);
  root.position.x = o.pos[0];
  root.position.z = o.pos[2];
  return reg({
    root,
    hint: { id: o.id, pos: o.pos, color: o.color, intensity: o.intensity ?? 1.0, range: o.range ?? 6, flicker: o.flicker ?? 'STEADY', zone: o.zone },
    setOn: (on) => lamp.setOn(on),
    update(_dt, t) { lamp.setOn(flickerLevel(o.flicker ?? 'STEADY', t, o.pos[2]) > 0.5); },
  });
}
