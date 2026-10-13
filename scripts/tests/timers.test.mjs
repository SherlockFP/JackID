// Unit tests for src/core/timers.ts (TECH_SPEC §2.9): after/every/wait on a stepped game clock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let createTimers;
before(async () => { ({ createTimers } = await load('src/core/timers.ts')); });

test('after() fires once when its time has passed and never again', () => {
  const t = createTimers();
  let fired = 0;
  t.after(1, () => fired++);
  t.update(0.5);
  assert.equal(fired, 0);
  t.update(0.5);
  assert.equal(fired, 1);
  t.update(5);
  assert.equal(fired, 1);
});

test('every() repeats at its interval until the returned cancel is called', () => {
  const t = createTimers();
  let fired = 0;
  const cancel = t.every(0.25, () => fired++);
  for (let i = 0; i < 4; i++) t.update(0.25);
  assert.equal(fired, 4);
  cancel();
  for (let i = 0; i < 4; i++) t.update(0.25);
  assert.equal(fired, 4);
});

test('wait() resolves once the clock has advanced past its delay', async () => {
  const t = createTimers();
  let resolved = false;
  const p = t.wait(0.5).then(() => { resolved = true; });
  t.update(0.25);
  await Promise.resolve();
  assert.equal(resolved, false);
  t.update(0.25);
  await p;
  assert.equal(resolved, true);
});

test('clear() drops callbacks and releases pending waiters', async () => {
  const t = createTimers();
  let fired = 0;
  t.after(1, () => fired++);
  const waiting = t.wait(10);
  t.clear();
  await waiting;
  t.update(20);
  assert.equal(fired, 0);
});
