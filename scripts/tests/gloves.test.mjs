// Unit tests for the gloves wave (WAVE69 §8): the GLOVES and HANDS settings defaults and old-save merge, the glove palette
// constants, and that the viewmodel accepts both glove looks live (setGloveColor) without throwing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let settings, viewmodel;
before(async () => {
  settings = await load('src/core/settings.ts');
  viewmodel = await load('src/player/viewmodel.ts');
});

test('gloves and hands both default on', () => {
  const s = settings.sanitizeSettings({});
  assert.equal(s.gloves, true);
  assert.equal(s.viewmodel, true);
});

test('an old save with no gloves key gets the dark leather default and keeps its hands setting', () => {
  const s = settings.sanitizeSettings({ viewmodel: false });
  assert.equal(s.gloves, true);
  assert.equal(s.viewmodel, false);
});

test('gloves keep an explicit boolean and fall back to the default on junk', () => {
  assert.equal(settings.sanitizeSettings({ gloves: false }).gloves, false);
  assert.equal(settings.sanitizeSettings({ gloves: 'off' }).gloves, true);
});

test('leather is P16 RUST_DEEP and the old glove is P09 IVORY', () => {
  assert.equal(viewmodel.GLOVE_LEATHER, 0x4a2110);
  assert.equal(viewmodel.GLOVE_IVORY, 0xe6dec5);
});

test('the viewmodel swaps glove looks live without throwing, then disposes', () => {
  const host = viewmodel.createViewmodel(0x7a1a20, viewmodel.GLOVE_LEATHER);
  host.setGloveColor(viewmodel.GLOVE_IVORY);
  host.setGloveColor(viewmodel.GLOVE_LEATHER);
  host.setHandLook({ porcelain: true });
  host.setGloveColor(viewmodel.GLOVE_LEATHER);
  host.update(1 / 60);
  host.dispose();
});
