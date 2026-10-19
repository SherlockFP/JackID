// Unit tests for src/core/lazyState.ts: a state whose handler arrives from a lazy chunk.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let lazyState;
before(async () => { ({ lazyState } = await load('src/core/lazyState.ts')); });

const recorder = () => {
  const calls = [];
  return { calls, handler: { enter: (p, f) => { calls.push(['enter', p, f]); }, exit: (to) => { calls.push(['exit', to]); }, fixedUpdate: (dt) => { calls.push(['fixed', dt]); }, frame: (dt, a) => { calls.push(['frame', dt, a]); } } };
};

test('loop calls before enter are no-ops; after enter they reach the real handler', async () => {
  const { calls, handler } = recorder();
  const s = lazyState(async () => handler);
  s.fixedUpdate(1); s.frame(1, 0); await s.exit('menu');
  assert.deepEqual(calls, []);
  await s.enter({ a: 1 }, 'menu');
  s.fixedUpdate(2); s.frame(3, 0.5); await s.exit('results');
  assert.deepEqual(calls, [['enter', { a: 1 }, 'menu'], ['fixed', 2], ['frame', 3, 0.5], ['exit', 'results']]);
});

test('the chunk loads once, whether preload or enter asks first', async () => {
  const { handler } = recorder();
  let loads = 0;
  const s = lazyState(async () => { loads++; return handler; });
  await s.preload();
  await s.enter(undefined, 'menu');
  await s.enter(undefined, 'menu');
  assert.equal(loads, 1);
});

test('a failed load rejects enter, and the next enter retries', async () => {
  const { handler } = recorder();
  let n = 0;
  const s = lazyState(async () => { if (n++ < 2) throw new Error('offline'); return handler; });
  await s.preload();                                        // preload never throws
  await assert.rejects(s.enter(undefined, 'menu'), /offline/);   // the failed load is not cached
  await s.enter(undefined, 'menu');
  assert.equal(n, 3);
});
