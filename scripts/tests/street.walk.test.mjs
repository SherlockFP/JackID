// THE WALK HOME (world/street): the walk's cues by where the player stands (the key at your door, clear of the leaf, the hall on the
// way out, the casino's alcove), the street zone around the corridor and the casino door, and the run's hold on the Evening clock
// while the player is still on the street.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let CFG, HOME, RUN, REG, ZM, L;
before(async () => {
  CFG = await load('src/world/street/config.ts');
  HOME = await load('src/world/home/config.ts');
  ({ ZoneMap: ZM } = await load('src/world/sys/zones.ts'));
  L = await load('src/world/layout.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  REG.load();
});

test('walk home: nothing on the street, the key turns at your door, and the door shuts once you are clear of the leaf', () => {
  const cue = (x, z) => CFG.walkCue('home', x, z);
  const a = CFG.ANCHOR_PLAN;
  assert.equal(cue(a.arrive.p[0], a.arrive.p[2]), null, 'the casino door');
  assert.equal(cue(a.building.p[0], a.building.p[2]), null, 'the block door');
  assert.equal(cue(4, 4), null, 'the corridor');
  assert.equal(cue(a.flatDoor.p[0], a.flatDoor.p[2]), 'door', 'in the hall at your door');
  const [, , sz] = HOME.ANCHOR_PLAN.spawn.p;
  assert.equal(cue(-0.6, sz), 'door', 'just inside: the leaf still sweeps here');
  assert.equal(cue(-0.6, 1.0), 'in', 'well inside');
  assert.equal(cue(5, 4.5), null);
});

test('walk out: the hall shuts the door behind you, the alcove takes the lift', () => {
  const cue = (x, z) => CFG.walkCue('out', x, z);
  assert.equal(cue(-0.6, 1.0), null, 'still in the flat');
  assert.equal(cue(-0.6, 3.5), 'hall');
  assert.equal(cue(6, 4), 'hall', 'the corridor');
  assert.equal(cue(12, -10), null, 'the street');
  const c = CFG.ANCHOR_PLAN.casino.p;
  assert.equal(cue(c[0], c[2]), 'lift', 'the casino alcove');
  assert.equal(cue(CFG.ANCHOR_PLAN.arrive.p[0], CFG.ANCHOR_PLAN.arrive.p[2]), null, 'the arrival spot is outside the alcove (no instant ride back)');
});

test('the street is its own zone: the corridor, the street and the casino door, the room still wins inside the flat', () => {
  const z = L.ZONES.find((q) => q.id === CFG.STREET_ZONE);
  assert.ok(z, 'layout.ts has the street zone');
  const zm = new ZM(L.ZONES);
  const w = (p) => { const v = HOME.at(p[0], p[1], p[2]); return [v[0], v[2]]; };
  for (const k of ['arrive', 'casino', 'building', 'flatDoor', 'adaDoor', 'mid']) assert.equal(zm.zoneAt(...w(CFG.ANCHOR_PLAN[k].p)), 'street', k);
  assert.equal(zm.zoneAt(...w(HOME.ANCHOR_PLAN.spawn.p)), 'home');
  const [x0, z0, x1, z1] = z.rect;
  for (const q of L.ZONES) if (!['home', 'street'].includes(q.id)) assert.ok(q.rect[2] < x0 || q.rect[0] > x1 || q.rect[3] < z0 || q.rect[1] > z1, `no overlap with ${q.id}`);
});

test('the run holds the Evening clock while the player walks home, and lets it go at the door', () => {
  const run = RUN.createRun({ seed: 811, mode: 'debt', home: true });
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  assert.equal(run.openFloor(), true);
  run.homeHold(true);   // during the ride: not the Evening yet, so no hold
  for (let t = 0; t < RUN.HOME_TIMING.ride + 0.2; t += 0.1) run.tick(0.1);
  assert.equal(run.homeStage(), 'evening');
  run.homeHold(true);
  const left = run.homeState().left;
  for (let t = 0; t < 200; t += 0.5) run.tick(0.5);
  assert.equal(run.homeStage(), 'evening', 'no auto-sleep on the street');
  assert.equal(run.homeState().left, left, 'the clock waited');
  run.homeHold(false);
  run.tick(1);
  assert.ok(run.homeState().left < left, 'the clock runs from the door');
});
