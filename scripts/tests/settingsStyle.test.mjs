// Picture style presets (core/settings.ts), their one-time save migration (core/save.ts) and the language in use vs the saved one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SET, SAVE, I18N, BOOT;
before(async () => {
  [SET, SAVE, I18N, BOOT] = await Promise.all([load('src/core/settings.ts'), load('src/core/save.ts'), load('src/core/i18n.ts'), load('src/core/bootParams.ts')]);
});

const clone = (o) => JSON.parse(JSON.stringify(o));

test('the default look is Hafif PSX; each preset reads back as itself', () => {
  const p = clone(SET.DEFAULT_PSX);
  assert.equal(SET.psxStyleOf(p), 'light');
  assert.equal(SET.psxStyleOf(SET.applyPsxStyle(p, 'classic')), 'classic');
  assert.equal(SET.psxStyleOf(SET.applyPsxStyle(p, 'clean')), 'clean');
  assert.equal(SET.psxStyleOf(SET.applyPsxStyle(SET.applyPsxStyle(p, 'clean'), 'light')), 'light');
});

test('the presets set the agreed values and keep resolution and draw distance', () => {
  const p = { ...clone(SET.DEFAULT_PSX), targetHeight: 224, drawDistance: 'far' };
  const c = SET.applyPsxStyle(p, 'classic');
  assert.deepEqual([c.affine, c.jitter, c.dither, c.colorBits, c.crt], [true, 0.5, true, 5, true]);
  const l = SET.applyPsxStyle(p, 'light');
  assert.deepEqual([l.affine, l.jitter, l.dither, l.colorBits, l.crt], [true, 0.2, true, 6, false]);
  assert.equal(SET.applyPsxStyle(p, 'clean').enabled, false);
  assert.equal(c.targetHeight, 224);
  assert.equal(c.drawDistance, 'far');
});

test('a manual change shows as custom', () => {
  const p = clone(SET.DEFAULT_PSX);
  assert.equal(SET.psxStyleOf({ ...p, jitter: 0.3 }), 'custom');
  assert.equal(SET.psxStyleOf({ ...p, dither: false }), 'custom');
  assert.equal(SET.psxStyleOf({ ...p, scanlines: 0.5 }), 'light');   // not a style field
});

test('old Klasik saves move to Hafif once; manual PSX choices and later Klasik picks stick', () => {
  const old = SAVE.defaultSave();
  old.settings.psx = SET.applyPsxStyle(old.settings.psx, 'classic');
  delete old.seen['settings.psxLight'];
  const once = SAVE.migrateSave(clone(old));
  assert.equal(SET.psxStyleOf(once.settings.psx), 'light');
  once.settings.psx = SET.applyPsxStyle(once.settings.psx, 'classic');   // the player picks Klasik afterwards
  assert.equal(SET.psxStyleOf(SAVE.migrateSave(clone(once)).settings.psx), 'classic');

  const manual = SAVE.defaultSave();
  manual.settings.psx = { ...SET.applyPsxStyle(manual.settings.psx, 'classic'), jitter: 0.7 };
  delete manual.seen['settings.psxLight'];
  assert.equal(SAVE.migrateSave(clone(manual)).settings.psx.jitter, 0.7);
});

test('the language in use comes from the link, not the saved setting', () => {
  assert.equal(BOOT.parseBootParams('?lang=tr').lang, 'tr');
  assert.equal(BOOT.parseBootParams('?lang=xx').lang, undefined);
  const saved = SAVE.defaultSave().settings.lang;   // 'en'
  I18N.setLang(BOOT.parseBootParams('?lang=tr').lang ?? saved);
  assert.equal(I18N.lang(), 'tr');
  assert.notEqual(I18N.lang(), saved);
  I18N.setLang('en');
});
