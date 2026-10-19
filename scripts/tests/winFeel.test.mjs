// Win feel, the visual half: the pop text motion (src/core/fx/popAnim.ts) and the seat HUD's streak heat (tiers.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let anim, tiers;
before(async () => {
  anim = await load('src/core/fx/popAnim.ts');
  tiers = await load('src/machines/_base/tiers.ts');
});

test('a pop lands wide, then tall, then rests, in whole pixels', () => {
  const o = [0, 0];
  anim.popScale(0.01, 0.01, 2, false, o); assert.deepEqual(o, [3, 2]);
  anim.popScale(0.1, 0.1, 2, false, o); assert.deepEqual(o, [2, 3]);
  anim.popScale(0.5, 0.5, 2, false, o); assert.deepEqual(o, [2, 2]);
  anim.popScale(0.5, -1, 2, false, o); assert.deepEqual(o, [2, 2], 'no squash while a count still rolls');
});

test('a slam falls from five steps above rest, then squashes on impact', () => {
  const o = [0, 0];
  anim.popScale(0, -anim.SLAM_S, 4, true, o); assert.deepEqual(o, [9, 9]);
  anim.popScale(anim.SLAM_S + 0.01, 0.01, 4, true, o); assert.deepEqual(o, [5, 4]);
});

test('the odometer rolls up, never past the target, and lands exactly', () => {
  assert.equal(anim.countValue(1250, 0, 0.45), 0);
  const mid = anim.countValue(1250, 0.2, 0.45);
  assert.ok(mid > 0 && mid < 1250);
  assert.equal(anim.countValue(1250, 0.45, 0.45), 1250);
  assert.equal(anim.countValue(1250, 0.3, 0), 1250, 'no roll time: the number shows at once');
});

test('digit slots read the number out of a formatted pop', () => {
  assert.deepEqual(anim.digitSlots('+1,250'), { slots: [1, 3, 4, 5], value: 1250 });
  assert.deepEqual(anim.digitSlots('+1.2K'), { slots: [1, 3], value: 12 });
  assert.deepEqual(anim.digitSlots('JACKPOT'), { slots: [], value: 0 });
});

test('the streak flame lights on the 3rd win in a row and caps at 5', () => {
  assert.equal(tiers.streakHeat(2), 0);
  assert.equal(tiers.streakHeat(3), 1);
  assert.equal(tiers.streakHeat(7), 5);
  assert.equal(tiers.streakHeat(40), 5);
});
