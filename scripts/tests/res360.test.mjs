// Default render height is 360p; older saves get bumped once, and a later lower choice sticks (core/save.ts migrateSave).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SAVE;
before(async () => { SAVE = await load('src/core/save.ts'); });

test('a fresh save opens at 360p', () => {
  assert.equal(SAVE.migrateSave(null).settings.psx.targetHeight, 360);
});

test('an old 224p save is bumped once, then a lower choice sticks', () => {
  const old = SAVE.defaultSave();
  old.settings.psx.targetHeight = 224;
  delete old.seen['settings.res360'];
  const once = SAVE.migrateSave(JSON.parse(JSON.stringify(old)));
  assert.equal(once.settings.psx.targetHeight, 360);
  once.settings.psx.targetHeight = 240;
  assert.equal(SAVE.migrateSave(JSON.parse(JSON.stringify(once))).settings.psx.targetHeight, 240);
});
