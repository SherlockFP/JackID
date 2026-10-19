// The next-Night quota preview (HUD "SONRAKİ GECE") against the quota the Night really opens with: a Night 1 Dawn with an overpay.
// The one thing that may move it after the Dawn is a boon pick that carries quota.mult (well_lamps x1.05, ledg_double x1.12, ash_short x0.8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, PAN;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  PAN = await load('src/game/pantheon.ts');
  REG.load();
});

const QUOTA_BOONS = ['well_lamps', 'ledg_double', 'ash_short'];

/** Night 1 at the collection phase with 1 coin in the pocket and 49 banked against a quota of 24 (the tour's Dawn). */
function dawnRun(seed) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.coins = 1;
  run.debtPaid = 49;
  run.syncQuota();
  run.phase = 'collection';
  return run;
}

test('the Dawn preview, the preview after the Dawn and the opened Night agree; a quota boon moves the preview the moment it is picked', () => {
  let tested = 0;
  for (let seed = 1; seed <= 80 && tested < 3; seed++) {
    const run = dawnRun(seed);
    const atDawn = run.nextQuotaPreview();
    assert.ok(atDawn && atDawn.projected, 'the Dawn collection previews the next Night');
    run.dawn();
    const offer = run.boonOffer();
    if (!offer) { run.dispose(); continue; }
    const after = run.nextQuotaPreview();
    assert.equal(after.due, atDawn.due, 'seed ' + seed + ': the Dawn payment does not change what the Dawn promised');
    // pick each kind once: a quota boon (if offered), else the first card
    const cand = offer.candidates.find((c) => QUOTA_BOONS.includes(c.id)) ?? offer.candidates[0];
    const mult = (PAN.boonDef(cand.id)?.effects ?? []).filter((e) => e.hook === 'quota.mult').reduce((m, e) => m * e.value, 1);
    assert.equal(run.pickBoon(cand.id), true);
    const picked = run.nextQuotaPreview();
    if (mult !== 1) assert.notEqual(picked.due, atDawn.due, 'seed ' + seed + ': ' + cand.id + ' (x' + mult + ') is a quota change the preview shows once it is picked');
    assert.equal(run.openFloor(), true);
    assert.equal(run.quota.due, picked.due, 'seed ' + seed + ' (' + cand.id + '): Night 2 opens on the quota the preview showed after the pick');
    if (mult === 1) assert.equal(run.quota.due, atDawn.due, 'seed ' + seed + ': no quota boon, no change from the Dawn preview');
    if (QUOTA_BOONS.includes(cand.id)) tested++;
    run.dispose();
  }
  assert.ok(tested > 0, 'the probe met a quota boon in an offer');
});
