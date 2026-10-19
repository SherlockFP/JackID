// The wristwatch dial: hand angles from the Watch clock (clockwise from 12), and that the watch builds with its hands and takes a time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let items, three;
before(async () => {
  items = await load('src/player/viewmodel/items.ts');
  three = await import('three');
});

const turn = Math.PI * 2;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('2:30 left: long hand on the 6, short hand halfway between 2 and 3', () => {
  const a = items.watchHandAngles(150);
  near(a.minute, turn / 2);
  near(a.hour, (2.5 / 12) * turn);
});

test('the long hand wraps every minute and the short hand every 12', () => {
  near(items.watchHandAngles(60).minute, 0);
  near(items.watchHandAngles(12 * 60).hour, 0);
});

test('no Watch (or a bad number) reads ten past ten; negative clamps to 12:00', () => {
  const t = items.watchHandAngles(null);
  near(t.minute, turn / 6);
  assert.deepEqual(items.watchHandAngles(Number.NaN), t);
  near(items.watchHandAngles(-5).minute, 0);
});

test('the watch builds with two hands and setWatchTime turns them', () => {
  const w = items.buildWatch(() => new three.MeshBasicMaterial());
  items.setWatchTime(w, 150);
  assert.ok(Math.abs(w.userData.hands.minute.rotation.z + turn / 2) < 1e-9);
  items.liftWatch(w, 1);
  assert.ok(w.scale.x < 0.01);
});
