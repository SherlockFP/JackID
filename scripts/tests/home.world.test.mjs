// Tests for THE APARTMENT (wave 69, src/world/home): the plan sits far from the pit and above the fall limit, the room zone holds
// the room and not the hallway, every contract anchor is planned, the door's collider sits in the wall, the station copy is
// in EN and TR and every literal key the flat uses resolves, and the switch reaches only the room's lights.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const SRC = (rel) => readFileSync(new URL(`../../src/world/home/${rel}`, import.meta.url), 'utf8');

let cfg, contract, ZoneMap, layout, strings;
before(async () => {
  cfg = await load('src/world/home/config.ts');
  contract = await load('src/game/home/contract.ts');
  ({ ZoneMap } = await load('src/world/sys/zones.ts'));
  layout = await load('src/world/layout.ts');
  strings = (await load('src/world/home/home.strings.ts')).default;
});

/** World (x, z) of a plan point, for the zone lookups. */
const xz = (p) => { const w = cfg.at(p[0], p[1], p[2]); return [w[0], w[2]]; };

test('the apartment sits far from the pit and above the fall limit', () => {
  const [x, y, z] = contract.HOME_ORIGIN;
  assert.ok(Math.abs(x) >= 60 && Math.abs(z) >= 60, 'far from the pit footprint');
  assert.equal(y, 0);
  assert.ok(y > -12, 'above FALL_LIMIT_Y');
});

test('the room is 6 by 5 metres, and its zone is registered in the layout', () => {
  assert.equal(cfg.ROOM_X * 2, 6);
  assert.equal(cfg.ROOM_Z * 2, 5);
  const home = layout.ZONES.find((z) => z.id === 'home');
  assert.ok(home, 'layout.ts has a home zone');
  assert.deepEqual([...home.rect], [...cfg.HOME_ZONE_RECT]);
});

test('the room zone holds the room and not the hallway', () => {
  const zm = new ZoneMap([{ id: cfg.HOME_ZONE, rect: cfg.HOME_ZONE_RECT }]);
  // the peephole look is the one anchor outside the room: its camera sits in the door's plane and looks out (see config PEEP_EYE_Z)
  for (const k of ['spawn', 'bed', 'door', 'switch', 'phone', 'table', 'spouse', 'window']) {
    const [x, z] = xz(cfg.ANCHOR_PLAN[k].p);
    assert.equal(zm.zoneAt(x, z), 'home', `${k} is in the room`);
  }
  const [hx, hz] = xz(cfg.ANCHOR_PLAN.hall.p);
  assert.equal(zm.zoneAt(hx, hz), null, 'the hallway is outside the switched zone, so its bulb stays on');
});

test('the switch reaches the ceiling light and the pendant (zone home); the hall bulb stays outside it', () => {
  const zm = new ZoneMap([{ id: cfg.HOME_ZONE, rect: cfg.HOME_ZONE_RECT }]);
  const [cx, , cz] = cfg.at(0, cfg.CEIL - 0.25, 0);
  assert.equal(zm.zoneAt(cx, cz), 'home', 'ceiling light');
  const [px, , pz] = cfg.at(1.6, 1.75, 0.3);
  assert.equal(zm.zoneAt(px, pz), 'home', 'pendant');
  const [hx, , hz] = cfg.at(-0.6, 2.15, 3.9);
  assert.equal(zm.zoneAt(hx, hz), null, 'hall bulb');
  assert.ok(cfg.LIGHT.ceiling.intensity > 0 && cfg.LIGHT.pendant.intensity > 0 && cfg.LIGHT.hall.intensity > 0);
});

test('a fresh run starts facing the room: the window is dead ahead of the spawn and the wall unit is far off to the side', () => {
  const { p, yaw } = cfg.ANCHOR_PLAN.spawn;
  const fwd = [-Math.sin(yaw), -Math.cos(yaw)];                                  // the game's convention (config.ts)
  const off = (x, z) => Math.abs(Math.atan2(fwd[0] * (z - p[2]) - fwd[1] * (x - p[0]), fwd[0] * (x - p[0]) + fwd[1] * (z - p[2]))) * 180 / Math.PI;
  assert.ok(off((cfg.WIN_X0 + cfg.WIN_X1) / 2, -cfg.ROOM_Z) < 15, 'the window is straight ahead');
  const u = cfg.WALL_UNIT;
  assert.ok(off((u.x0 + u.x1) / 2, (u.z0 + u.z1) / 2) > 60, 'the wall unit is out of the opening view (it was a cabinet from a metre away in a client shot)');
  assert.ok(off(cfg.SPOUSE_SEAT.x, cfg.SPOUSE_SEAT.z) < 50, 'Ada is in the opening view');
});

test('every contract anchor is planned, and only those', () => {
  const want = Object.values(contract.HOME_ANCHORS).sort();
  const have = Object.keys(cfg.ANCHOR_PLAN).map((k) => contract.HOME_ANCHORS[k]).sort();
  assert.deepEqual(have, want);
  assert.equal(Object.keys(cfg.ANCHOR_PLAN).length, Object.keys(contract.HOME_ANCHORS).length);
});

test('the front door is a 1 m opening in the south wall, and its shut collider fills it inside the wall band', () => {
  assert.equal(cfg.DOOR_X1 - cfg.DOOR_X0, 1);
  const [x0, z0, x1, z1] = cfg.leafFootprint(0);
  assert.ok(z0 >= 2.5 && z1 <= 2.8, 'the shut collider sits within the south wall (z 2.5 .. 2.8)');
  assert.ok(x0 >= cfg.DOOR_X0 - 0.02 && x1 <= cfg.DOOR_X1 + 0.02, 'and spans the opening');
  assert.ok(x1 - x0 > 0.9, 'the leaf is 0.9 m wide, padded for the thickness');
});

test('the leaf footprint follows the swing: the tip sweeps from the frame into the room (north, -z)', () => {
  const [, zShut0, , zShut1] = cfg.leafFootprint(0);
  const [xOpen0, zOpen0, xOpen1, zOpen1] = cfg.leafFootprint(cfg.DOOR_OPEN_RAD);
  assert.ok(zOpen0 < zShut0 - 0.5, 'the open leaf reaches well into the room');
  assert.ok(zOpen1 <= zShut1 + 1e-9, 'it stays on the room side of the frame');
  assert.ok(xOpen0 < cfg.DOOR_HINGE_X + 0.01 && xOpen1 < cfg.DOOR_X1, 'and it swings toward the hinge side');
  assert.ok(cfg.DOOR_OPEN_RAD > 0 && cfg.DOOR_OPEN_RAD < Math.PI, 'a positive swing (into the room)');
});

test('the peephole anchor sits at the lens in the door plane and looks out through the opening into the hall', () => {
  const a = cfg.ANCHOR_PLAN.peephole;
  assert.equal(a.p[0], cfg.PEEP.x, 'on the lens column');
  assert.equal(a.p[1], cfg.PEEP.y, 'at eye height');
  assert.ok(Math.abs(a.p[2] - cfg.PEEP_EYE_Z) < 1e-9 && cfg.PEEP_EYE_Z > cfg.DOOR_Z - 0.05 && cfg.PEEP_EYE_Z < cfg.DOOR_Z + 0.03,
    'in the door plane, a hair behind the lens');
  // game convention: forward = (-sin yaw, -cos yaw); the hall is south (+z)
  const fwd = [-Math.sin(a.yaw), -Math.cos(a.yaw)];
  const toHall = [cfg.ANCHOR_PLAN.hall.p[0] - a.p[0], cfg.ANCHOR_PLAN.hall.p[2] - a.p[2]];
  const len = Math.hypot(...toHall);
  assert.ok((fwd[0] * toHall[0] + fwd[1] * toHall[1]) / len > 0.99, 'the peephole faces the hall');
  // the line of sight from the lens to the hall's bulb crosses the opening, not a wall: no solid lies on it between z 2.5 and the hall
  const x = a.p[0];
  const blocked = cfg.SOUTH_WALL_SOLIDS.some(([x0, y0, z0, x1, y1, z1]) =>
    x > x0 && x < x1 && cfg.PEEP.y > y0 && cfg.PEEP.y < y1 && z1 > a.p[2] && z0 < cfg.HALL_Z1);
  assert.equal(blocked, false, 'the sight line runs through the door opening');
});

test('the station copy is complete in EN and TR, and every literal key the flat uses resolves', () => {
  const enKeys = Object.keys(strings.en).sort();
  const trKeys = Object.keys(strings.tr).sort();
  assert.deepEqual(trKeys, enKeys, 'EN and TR have the same keys');
  for (const k of enKeys) {
    assert.ok(String(strings.en[k]).length > 0, `en ${k} is not empty`);
    assert.ok(String(strings.tr[k]).length > 0, `tr ${k} is not empty`);
  }
  assert.equal(strings.prefix, 'home.');
  const used = new Set();
  for (const f of ['index.ts', 'room.ts', 'door.ts']) {
    for (const m of SRC(f).matchAll(/t\('home\.([a-zA-Z0-9.]+)'\)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, 'the flat uses translated keys');
  for (const k of used) assert.ok(enKeys.includes(k), `key ${k} is registered`);
});

test('the stations are the contract stations, each with a prompt', () => {
  const src = SRC('index.ts');
  for (const s of ['bed', 'spouse', 'phone', 'switch', 'chain', 'peephole', 'door', 'window']) {
    assert.ok(src.includes(`station('${s}'`), `station ${s} is built`);
  }
  assert.ok(src.includes("bus.emit('home:interact'"), 'stations report to the game with home:interact');
});

// ── the door side: focus from inside the room, the leaf's collider, the chain, the tween ────────────────────────────────
const boxAt = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(new THREE.Vector3(...cfg.at(x0, y0, z0)), new THREE.Vector3(...cfg.at(x1, y1, z1)));

/** The room's south wall, the shut leaf and the stations, as the game builds them (the same config boxes). */
async function doorSide() {
  const { createCollisionWorld } = await load('src/world/collision.ts');
  const { createInteraction } = await load('src/world/interact.ts');
  const col = createCollisionWorld();
  for (const s of cfg.SOUTH_WALL_SOLIDS) col.addStatic(boxAt(...s), 'solid');
  const [lx0, lz0, lx1, lz1] = cfg.leafFootprint(0);
  const leafId = col.addStatic(boxAt(lx0, 0, lz0, lx1, cfg.DOOR_H, lz1), 'solid');
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.05, 50);
  let prompt = null;
  const sys = createInteraction(cam, col, { prompt: (p) => { prompt = p; }, pressed: () => false });
  for (const [id, box] of Object.entries(cfg.WALL_STATIONS)) {
    const b = boxAt(...box);
    sys.add({ id: `home:${id}`, box: b, maxDist: 2.2, priority: cfg.STATION_PRIORITY[id], enabled: () => true, label: () => id, onInteract() {} });
  }
  /** Focus from an eye point (plan) looking at a target point (plan). */
  const focusFrom = (eye, target) => {
    const e = cfg.at(...eye);
    cam.position.set(...e);
    cam.lookAt(new THREE.Vector3(...cfg.at(...target)));
    cam.updateMatrixWorld(true);
    sys.update(1 / 60);
    return sys.focused?.id ?? null;
  };
  return { col, leafId, cam, sys, focusFrom, prompt: () => prompt };
}

test('the door-side stations are focusable from inside the room, 0.6 to 1.5 m off the door, at the right heights', async () => {
  const w = await doorSide();
  const peep = [cfg.PEEP.x, cfg.PEEP.y, 2.585];
  assert.equal(w.focusFrom([cfg.PEEP.x, 1.6, 1.9], peep), 'home:peephole', 'the peephole, 0.6 m in, at eye height');
  assert.equal(w.focusFrom([cfg.PEEP.x, 1.6, 1.0], peep), 'home:peephole', 'the peephole, 1.5 m in');
  assert.equal(w.focusFrom([-0.3, 1.6, 1.5], [-0.3, 1.42, 2.55]), 'home:chain', 'the chain on its track');
  assert.equal(w.focusFrom([-0.95, 1.6, 1.5], [-0.95, 0.5, 2.58]), 'home:door', 'the lower door, off the peephole column');
  assert.equal(w.focusFrom([-0.95, 1.6, 1.0], [-0.95, 0.5, 2.58]), 'home:door', 'the lower door from 1.5 m');
  assert.equal(w.focusFrom([0.7, 1.6, 1.5], [0.7, 1.2, 2.49]), 'home:switch', 'the light switch by the door');
});

test('a centred look reaches the door at its low aim, and the peephole at eye height (the verifier case)', async () => {
  const w = await doorSide();
  // straight ahead through the door, eye at 1.62 m, 0.9 m off the door plane (z 2.5)
  const eye = [-0.6, 1.62, 1.6];
  assert.equal(w.focusFrom(eye, [-0.6, 1.62, 2.585]), 'home:peephole', 'eye height: the peephole');
  assert.equal(w.focusFrom(eye, [-0.6, 1.44, 2.585]), 'home:peephole', 'a gentle look down: still the peephole');
  assert.equal(w.focusFrom(eye, [-0.6, 0.49, 2.585]), 'home:door', 'a steep look down: the low door, not the peephole');
});

test('the peephole box lies inside the room and is the one a centred look finds first', async () => {
  for (const [id, box] of Object.entries(cfg.WALL_STATIONS)) {
    assert.ok(box[2] >= 2.0 && box[5] <= cfg.ROOM_Z + 1e-9, `${id} sits inside the room, in front of the wall face`);
  }
  assert.ok(cfg.STATION_PRIORITY.peephole > cfg.STATION_PRIORITY.door && cfg.STATION_PRIORITY.door > cfg.STATION_PRIORITY.chain);
});

test('the light switch has a lit and an unlit pilot plate, toggled with the ceiling light (room.ts)', () => {
  const room = SRC('room.ts');
  assert.ok(room.includes('pilotOn.visible = on'), 'the lit plate follows the switch');
  assert.ok(room.includes('pilotOff.visible = !on'), 'the unlit plate is the other state');
});

/** A fake kit that makes plain meshes, enough to build the door leaf and check its geometry. */
async function doorRig() {
  const { HomeDoor } = await load('src/world/home/door.ts');
  const { createCollisionWorld } = await load('src/world/collision.ts');
  const { createTweenSystem } = await load('src/core/tween.ts');
  const dyn = new THREE.Group();
  const col = createCollisionWorld();
  const mesh = (w, h, d, m, o = {}) => {
    const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    if (o.pos) mm.position.set(...o.pos);
    (o.parent ?? dyn).add(mm);
    return mm;
  };
  const kit = {
    pal: { brass: 0xb08d57, chrome: 0xbbbbbb },
    mat: () => new THREE.MeshBasicMaterial(),
    group: (name) => { const g = new THREE.Group(); g.name = name; return g; },
    box: (w, h, d, m, o) => mesh(w, h, d, m, o),
    cyl: (r0, r1, h, m, o) => mesh(0.01, h, 0.01, m, o),
    sphere: (r, m, o) => mesh(r, r, r, m, o),
  };
  const tweens = createTweenSystem();
  const door = new HomeDoor({ kit, dyn, collision: col, tweens });
  return { door, dyn, col, pivot: door.pivot, tweens };
}

test('the leaf is one mesh under the pivot in the dyn group, and its collider follows the swing', async () => {
  const { door, dyn, col, pivot } = await doorRig();
  assert.ok(dyn.children.includes(pivot), 'the pivot is in dyn, which the level renders');
  const from = cfg.at(-0.95, 1.0, 1.0);
  const ray = (dist) => col.raycast(new THREE.Vector3(...from), new THREE.Vector3(0, 0, 1), dist);
  const shut = ray(10);
  assert.ok(shut && shut.dist > 1.5, 'the shut leaf blocks at the frame line, about 1.6 m away');
  await door.doorTo(1, 0);
  assert.ok(Math.abs(pivot.rotation.y - cfg.DOOR_OPEN_RAD) < 1e-9, 'the leaf turned to the open angle');
  const open = ray(10);
  assert.ok(open && open.dist < 0.9, 'the open leaf now blocks the path into the room, about 0.7 m away');
});

test('the door leaf swings on the sim clock: the tween moves the mesh and the collider as it runs', async () => {
  const { door, pivot, col, tweens } = await doorRig();
  const from = cfg.at(-0.95, 1.0, 1.0);
  const p = door.doorTo(1, 0.5);
  for (let i = 0; i < 20; i++) tweens.update(1 / 60);
  const mid = pivot.rotation.y;
  assert.ok(mid > 0.1 && mid < cfg.DOOR_OPEN_RAD - 0.1, 'it is part way through the swing');
  for (let i = 0; i < 40; i++) tweens.update(1 / 60);
  await p;
  assert.ok(Math.abs(pivot.rotation.y - cfg.DOOR_OPEN_RAD) < 1e-6, 'it finishes open');
  const hit = col.raycast(new THREE.Vector3(...from), new THREE.Vector3(0, 0, 1), 10);
  assert.ok(hit && hit.dist < 0.9, 'and the collider has followed it');
  assert.ok(col.count >= 1, 'a single leaf collider, not one per frame');
});

test('the chain: taut from the slide to the keeper when on, hanging in a sag when off', async () => {
  const { door, dyn } = await doorRig();
  const links = () => dyn.children.flatMap((g) => g.children).filter((m) => m.geometry?.parameters?.width === 0.05 && m.geometry.parameters.height === 0.012);
  door.setChain(true);
  const taut = links();
  assert.equal(taut.length, 6, 'six links');
  for (const l of taut) assert.ok(Math.abs(l.position.y - taut[0].position.y) < 1e-9 && Math.abs(l.rotation.z) < 1e-9, 'a straight line');
  const xs = taut.map((l) => [l.position.x - (0.05 * l.scale.x) / 2, l.position.x + (0.05 * l.scale.x) / 2]);
  assert.ok(Math.abs(Math.min(...xs.map((x) => x[0])) - 0.36) < 0.02, 'it starts at the slide');
  assert.ok(Math.abs(Math.max(...xs.map((x) => x[1])) - 0.88) < 0.02, 'and reaches the keeper');
  door.setChain(false);
  const slack = links();
  const ys = slack.map((l) => l.position.y);
  assert.ok(ys.every((y, i) => i === 0 || y < ys[i - 1]), 'hanging: each link lower than the one above');
  assert.ok(Math.min(...ys) < taut[0].position.y - 0.2, 'the chain sags well below the track');
  assert.ok(slack.some((l) => Math.abs(l.rotation.z) > 0.2), 'and the links turn along the curve');
});
