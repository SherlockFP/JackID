// The Results hand-off waits on the story queue, but a scene that never ends must not hold it forever (story/hold.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let holdWithin, holdCap, createTimers;
before(async () => {
  ({ holdWithin, holdCap } = await load('src/game/story/hold.ts'));
  ({ createTimers } = await load('src/core/timers.ts'));
});

test('holdCap is the scenes\' length plus half again and the slack', () => {
  assert.ok(holdCap(22) > 22 * 1.5);
  assert.ok(holdCap(0) > 0);
});

test('a scene that finishes releases the hold before the cap', async () => {
  const t = createTimers();
  let done = false;
  let finish;
  const tail = new Promise((r) => { finish = r; });
  const p = holdWithin(tail, 10, (s) => t.wait(s)).then(() => { done = true; });
  t.update(1);
  await Promise.resolve();
  assert.equal(done, false);
  finish('done');
  await p;
  assert.equal(done, true);
});

test('a scene that never ends releases the hold when the cap runs out', async () => {
  const t = createTimers();
  let done = false;
  const p = holdWithin(new Promise(() => {}), 10, (s) => t.wait(s)).then(() => { done = true; });
  t.update(9);
  await Promise.resolve();
  assert.equal(done, false);
  t.update(2);
  await p;
  assert.equal(done, true);
});

test('a rejected scene still releases the hold', async () => {
  const t = createTimers();
  await holdWithin(Promise.reject(new Error('x')), 10, (s) => t.wait(s));
});
