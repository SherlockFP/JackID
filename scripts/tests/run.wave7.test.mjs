// Wave 7 (director): the Clutch set's Last Call bonus reaches the run. The run reads `x.run.lastCallAdd` where it sets the
// Last Call length (src/game/run.ts startWatch), on top of the schedule's 20 s (30 s in the last Watch).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  REG.load();
});

/** A provider that adds one effect on every query (the way a charm or a set does). */
const provide = (effects) => ({
  collect(_q, out) { out.push({ kind: 'charm', id: 'test_source', effects }); },
});

test('Last Call: 20 s in an ordinary Watch with no bonus', () => {
  const run = RUN.createRun({ seed: 5, mode: 'debt' });
  assert.equal(run.startWatch(), true);
  assert.equal(run.shift.state().lastCallSec, 20);
});

test('Last Call: the Clutch set adds 6 s (x.run.lastCallAdd), so 26 s in an ordinary Watch', () => {
  const run = RUN.createRun({ seed: 5, mode: 'debt' });
  run.mods.register(provide([{ hook: 'x.run.lastCallAdd', op: 'add', value: 6 }]));
  assert.equal(run.startWatch(), true);
  const st = run.shift.state();
  assert.equal(st.lastCallSec, 26);
  assert.ok(st.lastCallSec < st.duration, 'the Last Call ends before the Watch clock runs out');
});
