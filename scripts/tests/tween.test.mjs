// Unit tests for src/core/tween.ts (TECH_SPEC §2.9): easing endpoints and monotonicity, and the TweenSystem contract.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let ease, createTweenSystem;
before(async () => { ({ ease, createTweenSystem } = await load('src/core/tween.ts')); });

const EASES = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic',
  'outBack', 'outElastic', 'outBounce', 'inExpo', 'outExpo'];
// outBounce is deliberately not here: a bounce curve rises, dips and rises again.
const MONOTONE = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'inExpo', 'outExpo'];
const samples = (n = 200) => Array.from({ length: n + 1 }, (_, i) => i / n);

test('ease table has exactly the TECH_SPEC §2.9 names', () => {
  assert.deepEqual(Object.keys(ease).sort(), [...EASES].sort());
});

test('every ease maps 0 to 0 and 1 to 1', () => {
  for (const name of EASES) {
    assert.ok(Math.abs(ease[name](0)) < 1e-9, `${name}(0) = ${ease[name](0)}`);
    assert.ok(Math.abs(ease[name](1) - 1) < 1e-9, `${name}(1) = ${ease[name](1)}`);
  }
});

test('every ease is finite on [0, 1]', () => {
  for (const name of EASES) {
    for (const k of samples()) assert.ok(Number.isFinite(ease[name](k)), `${name}(${k}) is not finite`);
  }
});

test('outBounce stays inside [0, 1]', () => {
  for (const k of samples()) {
    const v = ease.outBounce(k);
    assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `outBounce(${k}) = ${v}`);
  }
});

test('monotone eases never decrease', () => {
  for (const name of MONOTONE) {
    let prev = -Infinity;
    for (const k of samples()) {
      const v = ease[name](k);
      assert.ok(v >= prev - 1e-12, `${name} decreases at k=${k}`);
      prev = v;
    }
  }
});

test('run() reports eased progress, ends at exactly 1 and fires onDone once', () => {
  const sys = createTweenSystem();
  const ks = [];
  let done = 0;
  const h = sys.run(1, (k) => ks.push(k), { ease: 'inQuad', onDone: () => done++ });
  for (let i = 0; i < 30; i++) sys.update(0.1);
  assert.equal(h.done, true);
  assert.equal(done, 1);
  assert.equal(ks.at(-1), 1);
  assert.ok(ks[0] < 0.1, 'inQuad should start slower than linear');
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i] >= ks[i - 1], 'progress went backwards');
});

test('delay holds the tween back until it has elapsed', () => {
  const sys = createTweenSystem();
  let calls = 0;
  sys.run(1, () => calls++, { delay: 0.5 });
  sys.update(0.25);
  assert.equal(calls, 0);
  sys.update(0.5);
  assert.ok(calls > 0);
});

test('to() interpolates named properties and lands on the target', () => {
  const sys = createTweenSystem();
  const o = { x: 0 };
  sys.to(o, { x: 10 }, 1);
  sys.update(0.5);
  assert.ok(o.x > 0 && o.x < 10, `mid value ${o.x}`);
  sys.update(1);
  assert.equal(o.x, 10);
});

test('cancel() stops the tween, skips onDone and still settles the promise', async () => {
  const sys = createTweenSystem();
  let calls = 0, done = 0;
  const h = sys.run(1, () => calls++, { onDone: () => done++ });
  sys.update(0.1);
  const callsAtCancel = calls;
  h.cancel();
  sys.update(2);
  assert.equal(calls, callsAtCancel);
  assert.equal(done, 0);
  assert.equal(h.done, true);
  await h.promise;
});
