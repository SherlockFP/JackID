// Tests for THE APARTMENT (wave 69, src/world/home): the plan sits far from the pit and above the fall limit, the room zone holds
// the room and not the hallway, every contract anchor is planned, the door's collider sits in the wall, the station copy is
// in EN and TR and every literal key the flat uses resolves, and the switch reaches only the room's lights.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  for (const k of ['spawn', 'bed', 'door', 'peephole', 'switch', 'phone', 'table', 'spouse', 'window']) {
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

test('every contract anchor is planned, and only those', () => {
  const want = Object.values(contract.HOME_ANCHORS).sort();
  const have = Object.keys(cfg.ANCHOR_PLAN).map((k) => contract.HOME_ANCHORS[k]).sort();
  assert.deepEqual(have, want);
  assert.equal(Object.keys(cfg.ANCHOR_PLAN).length, Object.keys(contract.HOME_ANCHORS).length);
});

test('the front door is a 1 m opening in the south wall, and its shut collider fills it inside the wall band', () => {
  assert.equal(cfg.DOOR_X1 - cfg.DOOR_X0, 1);
  const [z0, z1] = cfg.DOOR_COLLIDE_Z;
  assert.ok(z0 >= 2.5 && z1 <= 2.8, 'the collider sits within the south wall (z 2.5 .. 2.8)');
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
