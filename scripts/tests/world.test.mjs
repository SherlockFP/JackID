// Unit tests for the player-world package: collision world (moveAndSlide, step-up, trapdoor floors, raycast), the FPS body
// controller, the interaction ray, zone blending, slot → machine resolution and the pooled light system.
// Every module is loaded through Vite's SSR loader, so the real code is exercised.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let createCollisionWorld, FpsController, WALK_SPEED, SPRINT_SPEED, HALF_STAND, createInteraction, ZoneMap, resolvePlacements, LightPool, POOL_SIZE, createRng;
before(async () => {
  ({ createCollisionWorld } = await load('src/world/collision.ts'));
  ({ FpsController, WALK_SPEED, SPRINT_SPEED, HALF_STAND } = await load('src/player/controller.ts'));
  ({ createInteraction } = await load('src/world/interact.ts'));
  ({ ZoneMap } = await load('src/world/sys/zones.ts'));
  ({ resolvePlacements } = await load('src/world/sys/placement.ts'));
  ({ LightPool, POOL_SIZE } = await load('src/world/sys/lightPool.ts'));
  ({ createRng } = await load('src/core/rng.ts'));
});

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1));
const HALF = V(0.3, 0.9, 0.3);

function floorWorld() {
  const c = createCollisionWorld();
  c.addStatic(box(-30, -1, -30, 30, 0, 30), 'walkable');
  return c;
}
/** Walk the body centre `pos` by `total` in `steps` equal slices (the controller moves in small fixed steps). */
function walk(c, pos, dx, dz, steps = 60) {
  let hitX = false, hitZ = false, grounded = false;
  for (let i = 0; i < steps; i++) {
    const r = c.moveAndSlide(pos, HALF, V(dx / steps, -0.01, dz / steps));
    hitX ||= r.hitX; hitZ ||= r.hitZ; grounded = r.grounded;
  }
  return { hitX, hitZ, grounded };
}

// ── collision ────────────────────────────────────────────────────────────────────────────────────
test('a body falls onto a walkable floor and reports grounded', () => {
  const c = floorWorld();
  const pos = V(0, 1.5, 0);
  const r = c.moveAndSlide(pos, HALF, V(0, -1, 0));
  assert.equal(r.grounded, true);
  assert.ok(Math.abs(pos.y - 0.9) < 1e-6, `y ${pos.y}`);
});

test('solid walls stop movement, flag the hit and never let the body through', () => {
  const c = floorWorld();
  c.addStatic(box(2, 0, -5, 2.3, 3, 5), 'solid');
  const pos = V(0, 0.9, 0);
  const r = walk(c, pos, 5, 0);
  assert.equal(r.hitX, true);
  assert.ok(pos.x <= 2 - 0.3 + 1e-6 && pos.x > 1.6, `x ${pos.x}`);
});

test('diagonal movement into a wall slides along it', () => {
  const c = floorWorld();
  c.addStatic(box(2, 0, -50, 2.3, 3, 50), 'solid');
  const pos = V(1, 0.9, 0);
  walk(c, pos, 2, 2);
  assert.ok(pos.x < 1.75 && pos.z > 1.9, `slid to ${pos.x}, ${pos.z}`);
});

test('ledges up to 0.35 m are climbed, taller ones block', () => {
  const c = floorWorld();
  c.addStatic(box(1, 0, -5, 3, 0.2, 5), 'solid');
  c.addStatic(box(5, 0, -5, 6, 0.6, 5), 'solid');
  const pos = V(0, 0.9, 0);
  walk(c, pos, 2.5, 0);
  assert.ok(Math.abs(pos.y - 1.1) < 1e-3, `on the curb: y ${pos.y}`);
  const r = walk(c, pos, 5, 0);
  assert.equal(r.hitX, true);
  assert.ok(pos.x < 5 - 0.3 + 1e-6, `stopped at ${pos.x}`);
});

test('a ceiling stops a rising body', () => {
  const c = floorWorld();
  c.addStatic(box(-5, 2.2, -5, 5, 2.5, 5), 'solid');
  const pos = V(0, 0.9, 0);
  c.moveAndSlide(pos, HALF, V(0, 3, 0));
  assert.ok(pos.y + 0.9 <= 2.2 + 1e-6, `head at ${pos.y + 0.9}`);
});

test('toggling a floor plate opens a hole (floorAt = null) and closes it again', () => {
  const c = createCollisionWorld();
  c.addStatic(box(-10, -1, -10, -1, 0, 10), 'walkable');
  const plate = c.addStatic(box(-1, -0.1, -1, 1, 0, 1), 'walkable');
  assert.equal(c.floorAt(0, 0, 0), 0);
  c.setEnabled(plate, false);
  assert.equal(c.floorAt(0, 0, 0), null);
  const pos = V(0, 0.9, 0);
  const r = c.moveAndSlide(pos, HALF, V(0, -0.2, 0));
  assert.equal(r.grounded, false);
  assert.ok(pos.y < 0.9);
  c.setEnabled(plate, true);
  assert.equal(c.floorAt(0, 0, 0), 0);
});

test('raycast hits solid boxes only, ignores low/disabled ones and never self-occludes', () => {
  const c = floorWorld();
  const wall = c.addStatic(box(-2, 0, -3.5, 2, 3, -3), 'solid');
  c.addStatic(box(-1, 0, -1.5, 1, 0.6, -1), 'low');
  const o = V(0, 1.6, 0), d = V(0, 0, -1);
  const hit = c.raycast(o, d, 10);
  assert.ok(hit && hit.id === wall && Math.abs(hit.dist - 3) < 1e-6, JSON.stringify(hit));
  assert.equal(c.raycast(o, d, 2.5), null, 'range limited');
  c.setEnabled(wall, false);
  assert.equal(c.raycast(o, d, 10), null);
  c.setEnabled(wall, true);
  assert.equal(c.raycast(V(0, 1.6, -3.2), d, 10), null, 'origin inside the box');
});

test('machine colliders are transformed to exact world AABBs (quarter turns)', () => {
  const c = createCollisionWorld();
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 4);
  const ids = c.addLocal([{ min: [-1, 0, -0.5], max: [1, 2, 0.5] }], m);
  assert.equal(ids.length, 1);
  const out = new THREE.Box3();
  assert.equal(c.boxOf(ids[0], out), true);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near(out.min.x, 9.5) && near(out.max.x, 10.5) && near(out.min.z, 3) && near(out.max.z, 5), `${out.min.toArray()} ${out.max.toArray()}`);
  c.remove(ids[0]);
  assert.equal(c.boxOf(ids[0], out), false);
});

// ── FPS controller ───────────────────────────────────────────────────────────────────────────────
function controller() {
  const ev = { steps: 0, lands: 0, fallBegin: 0, fallOut: 0 };
  const ctrl = new FpsController({
    footstep() { ev.steps++; }, land() { ev.lands++; }, fallBegin() { ev.fallBegin++; }, fallOut() { ev.fallOut++; },
  });
  return { ctrl, ev };
}
const input = (o = {}) => ({ moveX: 0, moveZ: 0, sprint: false, crouchToggle: false, jump: false, frozen: false, pitch: 0, ...o });
const run = (ctrl, c, seconds, o) => { for (let i = 0; i < seconds * 60; i++) ctrl.step(1 / 60, input(o), c); };

test('controller: walk and sprint speeds, forward is −Z, footsteps fire', () => {
  const c = floorWorld();
  const { ctrl, ev } = controller();
  ctrl.reset(0, 0, 0);
  run(ctrl, c, 2, { moveZ: -1 });
  assert.ok(ctrl.pos.z < -4.5 && Math.abs(ctrl.pos.x) < 1e-6, `z ${ctrl.pos.z}`);
  assert.ok(Math.abs(ctrl.speed - WALK_SPEED) < 0.05, `speed ${ctrl.speed}`);
  assert.ok(ev.steps >= 3, `steps ${ev.steps}`);
  run(ctrl, c, 1, { moveZ: -1, sprint: true });
  assert.equal(ctrl.sprinting, true);
  assert.ok(Math.abs(ctrl.speed - SPRINT_SPEED) < 0.1, `speed ${ctrl.speed}`);
});

test('controller: stops quickly when input ends and never tunnels through a wall', () => {
  const c = floorWorld();
  c.addStatic(box(-5, 0, -4, 5, 3, -3.7), 'solid');
  const { ctrl } = controller();
  ctrl.reset(0, 0, 0);
  run(ctrl, c, 2, { moveZ: -1, sprint: true });
  assert.ok(ctrl.pos.z > -3.7 + 0.3 - 0.01, `z ${ctrl.pos.z}`);
  run(ctrl, c, 0.5, {});
  assert.ok(ctrl.speed < 0.01);
});

test('controller: crouch toggles, shrinks the body and slows down', () => {
  const c = floorWorld();
  const { ctrl } = controller();
  ctrl.reset(0, 0, 0);
  ctrl.step(1 / 60, input({ crouchToggle: true }), c);
  assert.equal(ctrl.crouching, true);
  assert.ok(ctrl.half.y < HALF_STAND.y);
  run(ctrl, c, 1.5, { moveZ: -1 });
  assert.ok(Math.abs(ctrl.speed - 1.5) < 0.05, `crouch speed ${ctrl.speed}`);
  ctrl.step(1 / 60, input({ crouchToggle: true }), c);
  assert.equal(ctrl.crouching, false);
});

test('controller: walking off the floor into a hole starts the fall, then the fade-out', () => {
  const c = createCollisionWorld();
  c.addStatic(box(-10, -1, -10, 10, 0, -3), 'walkable');
  c.addStatic(box(-10, -1, 3, 10, 0, 10), 'walkable');
  const { ctrl, ev } = controller();
  ctrl.reset(0, 0, -4);
  run(ctrl, c, 1, { moveZ: 1 });          // back = +Z: toward the gap
  assert.ok(ev.fallBegin >= 1, 'fallBegin');
  run(ctrl, c, 2.5, {});
  assert.ok(ev.fallOut >= 1, 'fallOut');
  assert.equal(ctrl.lost, true);
});

// ── interaction ray ──────────────────────────────────────────────────────────────────────────────
function rig() {
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.05, 50);
  cam.position.set(0, 1.62, 0);
  cam.updateMatrixWorld(true);
  const c = floorWorld();
  const log = { prompt: null, press: false, prompts: 0 };
  const io = { prompt: (p) => { log.prompt = p; log.prompts++; }, pressed: () => log.press };
  const sys = createInteraction(cam, c, io);
  const mk = (id, z, o = {}) => ({ id, box: box(-0.4, 0, z - 0.3, 0.4, 2, z + 0.3), enabled: () => true, label: () => id, onInteract() { o.hits = (o.hits ?? 0) + 1; }, ...o });
  return { cam, c, log, sys, mk };
}

test('interaction: focuses what the crosshair hits within reach and shows its prompt', () => {
  const { sys, log, mk } = rig();
  sys.add(mk('near', -1.5));
  sys.add(mk('far', -6));
  sys.update(1 / 60);
  assert.equal(sys.focused?.id, 'near');
  assert.equal(log.prompt.label, 'near');
  assert.equal(log.prompt.action, 'interact');
});

test('interaction: out of reach, occluded, disabled → nothing; priority beats distance; E fires onInteract with a cooldown', () => {
  const { sys, c, log, mk } = rig();
  const far = mk('far', -3.5);
  const off = sys.add(far);
  sys.update(1 / 60);
  assert.equal(sys.focused, null, 'beyond 2.2 m');
  off();
  const hit = { hits: 0 };
  const a = mk('a', -1.8, hit);
  sys.add(a);
  const wall = c.addStatic(box(-2, 0, -1.2, 2, 3, -1.1), 'solid');
  sys.update(1 / 60);
  assert.equal(sys.focused, null, 'a wall is in the way');
  c.setEnabled(wall, false);
  sys.update(1 / 60);
  assert.equal(sys.focused?.id, 'a');
  sys.add(mk('b', -1.2, { priority: 5 }));
  sys.update(1 / 60);
  assert.equal(sys.focused?.id, 'b', 'priority');
  const dis = { ...a, enabled: () => false, id: 'dis' };
  sys.add(dis);
  log.press = true;
  const targetHit = { hits: 0 };
  sys.add(mk('c', -0.9, { priority: 9, ...targetHit, onInteract() { targetHit.hits++; } }));
  sys.update(1 / 60);
  sys.update(1 / 60);
  assert.equal(targetHit.hits, 1, 'cooldown prevents a double fire');
  sys.update(0.5);
  assert.equal(targetHit.hits, 2);
});

test('interaction: setActive(false) clears focus and hides the prompt', () => {
  const { sys, log, mk } = rig();
  sys.add(mk('near', -1.5));
  sys.update(1 / 60);
  assert.ok(sys.focused);
  sys.setActive(false);
  sys.update(1 / 60);
  assert.equal(sys.focused, null);
  assert.equal(log.prompt, null);
});

// ── zones ────────────────────────────────────────────────────────────────────────────────────────
const RED = 0xff0000, BLUE = 0x0000ff;
const zoneMap = () => new ZoneMap([
  { id: 'a', rect: [0, 0, 10, 10], fog: { color: RED, near: 4, far: 20 }, ambient: 0x200000 },
  { id: 'b', rect: [10, 0, 20, 10], fog: { color: BLUE, near: 8, far: 40 }, ambient: 0x000020 },
  { id: 'door', rect: [9, 4, 11, 6] },
]);

test('zones: smallest rectangle wins, outside is null, distance is 0 inside', () => {
  const z = zoneMap();
  assert.equal(z.zoneAt(5, 5), 'a');
  assert.equal(z.zoneAt(15, 5), 'b');
  assert.equal(z.zoneAt(10, 5), 'door');
  assert.equal(z.zoneAt(-5, 5), null);
  assert.equal(z.distanceTo('a', 5, 5), 0);
  assert.equal(z.distanceTo('b', 5, 5), 5);
});

test('zones: fog and ambient cross-fade over the 3 m band at a shared boundary', () => {
  const z = new ZoneMap(zoneMap().defs.filter((d) => d.id !== 'door'));
  const look = { fog: new THREE.Color(), near: 0, far: 0, ambient: new THREE.Color() };
  z.lookAt(5, 5, look);
  assert.ok(Math.abs(look.fog.r - 1) < 1e-6 && look.far === 20, 'deep inside a');
  z.lookAt(10, 5, look);
  assert.ok(Math.abs(look.far - 30) < 1e-6 && Math.abs(look.near - 6) < 1e-6, `edge is a 50/50 blend: far ${look.far}`);
  z.lookAt(11.4, 5, look);
  assert.ok(look.far > 30 && look.far < 40);
  z.lookAt(15, 5, look);
  assert.ok(Math.abs(look.fog.b - 1) < 1e-6 && look.far === 40);
});

// ── placement ────────────────────────────────────────────────────────────────────────────────────
const defs = {
  coin: { id: 'coin', slotSize: 'S' }, slot: { id: 'slot', slotSize: 'M' }, table: { id: 'table', slotSize: 'L' },
  solo: { id: 'solo', slotSize: 'M', modes: ['debt'] },
};
const lookup = {
  resolve: (id) => (id === 'coin_flip' ? 'coin' : defs[id] ? id : undefined),
  def: (id) => defs[id], all: () => Object.values(defs),
};
const slot = (id, size) => ({ id, size, pos: [0, 0, 0], rotY: 0, zone: 'z' });

test('placement: unknown ids, oversize machines and mode exclusions become out-of-order; null/absent slots are pads', () => {
  const slots = [slot('A', 'M'), slot('B', 'S'), slot('C', 'M'), slot('D', 'M'), slot('E', 'M'), slot('F', 'M')];
  const out = resolvePlacements({
    slots, mode: 'free', lookup,
    assign: { A: 'slot', B: 'slot', C: 'ghost', D: 'solo', E: null, F: 'coin_flip' },
  });
  assert.equal(out.get('A').kind, 'machine');
  assert.equal(out.get('B').kind, 'broken');
  assert.equal(out.get('B').reason, 'toBig');
  assert.equal(out.get('C').reason, 'unregistered');
  assert.equal(out.get('D').reason, 'mode');
  assert.equal(out.get('E').kind, 'pad');
  assert.equal(out.get('F').machineId, 'coin', 'legacy id resolved; a smaller machine fits a bigger slot');
});

test('placement: demo fill cycles machines into empty slots they fit', () => {
  const slots = [slot('A', 'S'), slot('B', 'M'), slot('C', 'L'), slot('D', 'M')];
  const out = resolvePlacements({ slots, mode: 'debt', lookup, assign: {}, fill: true });
  for (const s of slots) assert.equal(out.get(s.id).kind, 'machine', s.id);
  assert.equal(out.get('A').machineId, 'coin', 'only the S machine fits an S slot');
  const noFill = resolvePlacements({ slots, mode: 'debt', lookup, assign: {} });
  assert.ok([...noFill.values()].every((p) => p.kind === 'pad'));
});

// ── light pool ───────────────────────────────────────────────────────────────────────────────────
function pool() {
  const parent = new THREE.Group();
  const p = new LightPool({ parent, rng: createRng(7), reduced: () => false, ringing: () => false, hasZone: (id) => id === 'z1' });
  return { parent, p };
}
const tick = (p, cam, sec) => { for (let i = 0; i < sec * 60; i++) p.update(1 / 60, cam); };

test('light pool: the light count is constant and the nearest sources win the six slots', () => {
  const { parent, p } = pool();
  for (let i = 0; i < 40; i++) p.add({ id: `h${i}`, pos: { x: i * 3, y: 3, z: 0 }, color: 0xffffff, intensity: 1, range: 8 });
  assert.equal(parent.children.filter((c) => c.isPointLight).length, POOL_SIZE);
  tick(p, V(0, 1.6, 0), 2);
  assert.equal(parent.children.filter((c) => c.isPointLight).length, POOL_SIZE);
  const lit = p.lights.filter((l) => l.intensity > 0.01);
  assert.ok(lit.length > 0 && lit.length <= POOL_SIZE);
  assert.ok(lit.every((l) => l.position.x <= 12), `far sources lit: ${lit.map((l) => l.position.x)}`);
  // walk far down the hall: the pool follows, nothing pops (intensities fade rather than jump)
  tick(p, V(90, 1.6, 0), 2);
  const lit2 = p.lights.filter((l) => l.intensity > 0.01);
  assert.ok(lit2.length > 0 && lit2.every((l) => l.position.x > 78), `${lit2.map((l) => l.position.x)}`);
  p.dispose();
});

test('light pool: setLevel dims by zone, strobe/pulse are transient, reset restores', () => {
  const { p } = pool();
  p.add({ id: 'a', pos: { x: 0, y: 3, z: 0 }, color: 0xffffff, intensity: 1, range: 8, zone: 'z1' });
  p.add({ id: 'b', pos: { x: 1, y: 3, z: 0 }, color: 0xffffff, intensity: 1, range: 8, zone: 'z2' });
  const cam = V(0, 1.6, 0);
  tick(p, cam, 1.5);
  const base = Math.max(...p.lights.map((l) => l.intensity));
  assert.ok(base > 0.5);
  p.api.setLevel('z1', 0, 0);
  tick(p, cam, 0.5);
  const dimmed = p.lights.filter((l) => l.intensity > 0.01);
  assert.equal(dimmed.length, 1, 'only the z2 source is still lit');
  p.api.reset();
  tick(p, cam, 0.5);
  assert.equal(p.lights.filter((l) => l.intensity > 0.01).length, 2);
  p.api.setLevel('all', 0, 0);
  tick(p, cam, 0.3);
  assert.ok(p.lights.every((l) => l.intensity < 1e-6));
  p.api.reset();
  p.api.pulse('all', { mul: 3, dur: 0.4 });
  tick(p, cam, 0.15);
  assert.ok(Math.max(...p.lights.map((l) => l.intensity)) > base * 1.5, 'pulse peak');
  tick(p, cam, 1);
  assert.ok(Math.abs(Math.max(...p.lights.map((l) => l.intensity)) - base) < 0.05 * base + 1e-6, 'pulse over');
  p.dispose();
});

// ── Pit Deck (WAVE8 item 8): the seeded random line-up for the flexible pads ─────────────────────────
const PIT_SUITS = ['REELS', 'CARDS', 'DICE', 'WHEELS', 'DROPS', 'CURIOS'];
const PIT_VOL = ['STEADY', 'SWINGY', 'WILD'];
const PIT_SIZES = ['S', 'M', 'L', 'XL'];
/**
 * A synthetic catalogue on FLOOR_READY ids (the line-up draws only those): solo tier-1 entries spanning every size, suit
 * and volatility class. The metadata is synthetic; the ids are real so the whitelist lets them through.
 */
const PIT_IDS = ['videopoker', 'mines', 'plinko', 'hilo', 'cascade', 'keno', 'derby', 'sonkart'];   // Wave 81: the core games only
function pitCatalog() {
  return PIT_IDS.map((id, i) => ({ id, slotSize: PIT_SIZES[i % 4], tier: 1, seats: 1, suit: PIT_SUITS[i % 6], volatility: PIT_VOL[i % 3] }));
}
const sizeRank = (s) => ['S', 'M', 'L', 'XL'].indexOf(s);

test('pit deck: only FLOOR_READY machines are drawn, even from a wider catalogue', async () => {
  const { rosterFor, FLOOR_READY } = await load('src/world/layout.ts');
  const wide = [
    ...pitCatalog(),
    ...['claw', 'scratch', 'cyclone', 'lootbox', 'stacker', 'elevator'].map((id, i) => ({ id, slotSize: 'S', tier: 1, seats: 1, suit: 'REELS', volatility: i % 2 ? 'WILD' : 'STEADY' })),
  ];
  for (let seed = 1; seed <= 30; seed++) {
    for (const id of Object.values(rosterFor(seed, wide))) {
      assert.ok(FLOOR_READY.has(id), `seed ${seed}: ${id} is not floor-ready`);
    }
  }
});

test('pit deck: the same seed gives the same line-up, and other seeds change it', async () => {
  const { rosterFor } = await load('src/world/layout.ts');
  const cat = pitCatalog();
  assert.deepEqual(rosterFor(12345, cat), rosterFor(12345, cat));
  const seen = new Set();
  for (let s = 1; s <= 20; s++) seen.add(JSON.stringify(rosterFor(s, cat)));
  assert.ok(seen.size > 10, `only ${seen.size} distinct line-ups in 20 seeds`);
});

test('pit deck: only the eight flexible pads are returned; each gets a machine that fits it and is solo tier 1', async () => {
  const { rosterFor, ROSTER_PADS, SLOTS } = await load('src/world/layout.ts');
  const cat = pitCatalog();
  const byId = new Map(cat.map((c) => [c.id, c]));
  const size = new Map(SLOTS.map((s) => [s.id, s.size]));
  for (let seed = 1; seed <= 30; seed++) {
    const r = rosterFor(seed, cat);
    assert.deepEqual(Object.keys(r).sort(), [...ROSTER_PADS].sort(), `seed ${seed} keys`);
    for (const pad of ROSTER_PADS) {
      const id = r[pad];
      const c = byId.get(id);
      if (c) {
        assert.ok(sizeRank(c.slotSize) <= sizeRank(size.get(pad)), `seed ${seed}: ${id} is ${c.slotSize} on ${pad} (${size.get(pad)})`);
      }
    }
  }
});

test('pit deck: fixed machines, tier-3 and shared machines never enter the line-up', async () => {
  const { rosterFor, ROSTER_FIXED } = await load('src/world/layout.ts');
  const cat = [
    ...pitCatalog(),
    ...[...ROSTER_FIXED].map((id) => ({ id, slotSize: 'S', tier: 1, seats: 1, suit: 'REELS', volatility: 'WILD' })),
    { id: 'tier3only', slotSize: 'S', tier: 3, seats: 1, suit: 'DICE', volatility: 'STEADY' },
    { id: 'partyhost', slotSize: 'S', tier: 1, seats: 4, shared: true, suit: 'DROPS', volatility: 'STEADY' },
  ];
  for (let seed = 1; seed <= 30; seed++) {
    for (const id of Object.values(rosterFor(seed, cat))) {
      assert.ok(!ROSTER_FIXED.has(id), `seed ${seed}: fixed ${id} moved`);
      assert.ok(id !== 'tier3only' && id !== 'partyhost', `seed ${seed}: ${id} is not eligible`);
    }
  }
});

test('pit deck: a passing line-up shows at least four suits and holds a STEADY and a WILD machine', async () => {
  const { rosterFor, ROSTER_MIN_SUITS } = await load('src/world/layout.ts');
  const cat = pitCatalog();
  const bySuit = new Map(cat.map((c) => [c.id, c]));
  for (let seed = 1; seed <= 40; seed++) {
    const r = rosterFor(seed, cat);
    const picks = Object.values(r).map((id) => bySuit.get(id)).filter(Boolean);
    assert.ok(new Set(picks.map((c) => c.suit)).size >= ROSTER_MIN_SUITS, `seed ${seed}: suits`);
    assert.ok(picks.some((c) => c.volatility === 'STEADY'), `seed ${seed}: no STEADY`);
    assert.ok(picks.some((c) => c.volatility === 'WILD'), `seed ${seed}: no WILD`);
  }
});

test('pit deck: the guard keeps the GDD §8.6 devices when the catalogue cannot pass', async () => {
  const { rosterFor, ROSTER_PADS, DEFAULT_ASSIGN } = await load('src/world/layout.ts');
  const defaults = Object.fromEntries(ROSTER_PADS.filter((p) => DEFAULT_ASSIGN[p]).map((p) => [p, DEFAULT_ASSIGN[p]]));   // (pads with no Wave 72 default are simply absent)
  assert.deepEqual(rosterFor(7, []), defaults, 'empty catalogue');
  const noSuits = pitCatalog().map((c) => ({ ...c, suit: undefined }));
  assert.deepEqual(rosterFor(7, noSuits), defaults, 'no suit data');
  const noVol = pitCatalog().map((c) => ({ ...c, volatility: 'SWINGY' }));
  assert.deepEqual(rosterFor(7, noVol), defaults, 'no STEADY or WILD');
  const modeOut = pitCatalog().map((c) => ({ ...c, modes: ['coop'] }));
  assert.deepEqual(rosterFor(7, modeOut, 'debt'), defaults, 'no machine in this mode');
});

test('pit deck: with the real FLOOR_READY machines the line-up passes the guard on most seeds (≥ 3 suits, wave 81)', async () => {
  const { rosterFor, FLOOR_READY, ROSTER_PADS, DEFAULT_ASSIGN } = await load('src/world/layout.ts');
  // real ids with their real size, tier, suit and volatility class (game/suits.ts, data/machineProfiles.ts, def.slotSize): the solo core games
  const real = [
    ['videopoker', 'M', 1, 'CARDS', 'SWINGY'], ['hilo', 'M', 2, 'CARDS', 'WILD'], ['mines', 'M', 2, 'CURIOS', 'STEADY'], ['plinko', 'M', 2, 'DROPS', 'STEADY'],
  ].map(([id, slotSize, tier, suit, volatility]) => ({ id, slotSize, tier, seats: 1, suit, volatility }));
  assert.ok(real.every((c) => FLOOR_READY.has(c.id)), 'catalogue ids are floor-ready');
  const defaults = Object.fromEntries(ROSTER_PADS.map((p) => [p, DEFAULT_ASSIGN[p]]));
  let rolled = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = rosterFor(seed, real);
    if (JSON.stringify(r) !== JSON.stringify(defaults)) rolled++;
    assert.ok(Object.values(r).every((id) => FLOOR_READY.has(id)), `seed ${seed}: not floor-ready`);
  }
  assert.ok(rolled >= 90, `only ${rolled}/100 seeds rolled a line-up`);
});

// Texture rules: a sign texture that opts into mips keeps them through material build; every other texture is forced nearest.
test('psxTexture keeps the filters of a mips opt-in texture and resets the rest', async () => {
  const { psxTexture } = await load('src/core/renderer/psxMaterial.ts');
  const plain = new THREE.Texture();
  plain.minFilter = THREE.LinearMipmapLinearFilter; plain.generateMipmaps = true;
  psxTexture(plain);
  assert.equal(plain.minFilter, THREE.NearestFilter);
  assert.equal(plain.generateMipmaps, false);
  const sign = new THREE.Texture();
  sign.minFilter = THREE.LinearMipmapLinearFilter; sign.generateMipmaps = true; sign.userData.mips = true;
  psxTexture(sign);
  assert.equal(sign.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(sign.generateMipmaps, true);
});
