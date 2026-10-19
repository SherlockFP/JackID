// The Steam demo (src/core/demo.ts): the run ends on Night 3 only in the demo build, and the demo's main die has no Multiplayer or Free Casino.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let D, S;
before(async () => { D = await load('src/core/demo.ts'); S = await load('src/core/save.ts'); });

test('the demo run ends after Lucan on Night 3, or at the paid Night 3 Dawn', () => {
  assert.equal(D.demoRunEnds(true, 3, 'lucan'), true);
  assert.equal(D.demoRunEnds(true, 3), true);
  assert.equal(D.demoRunEnds(true, 3, 'tamsin'), false);
  assert.equal(D.demoRunEnds(true, 2, 'lucan'), false);
  assert.equal(D.demoRunEnds(true, 2), false);
  assert.equal(D.demoRunEnds(true, 4), false);
});

test('the full game never ends at Night 3', () => {
  assert.equal(D.demoRunEnds(false, 3, 'lucan'), false);
  assert.equal(D.demoRunEnds(false, 3), false);
  assert.equal(D.DEMO, false);
});

test('the demo die drops Multiplayer and Free Casino', () => {
  const full = D.mainFaces(false), demo = D.mainFaces(true);
  assert.ok(full.includes('multi') && full.includes('free'));
  assert.ok(!demo.includes('multi') && !demo.includes('free'));
  assert.equal(demo.length, 6);
  assert.ok(demo.includes('play') && demo.includes('settings') && demo.includes('foundations'));
});

test('a demo save keeps its mark through a reload', () => {
  assert.equal(S.migrateSave({ demo: true }).demo, true);
  assert.equal(S.migrateSave({}).demo, undefined);
});
