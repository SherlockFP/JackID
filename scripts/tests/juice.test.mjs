// Unit tests for the jackpot-tier tag contract (src/machines/_base/tiers.ts):
// a machine tags its round 'jackpot' (or namespaced '<machine>:jackpot') and the
// presentation tier must be 'jackpot', so the jingle, pit wave and bells all fire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let tiers, winSfx;
before(async () => {
  tiers = await load('src/machines/_base/tiers.ts');
  ({ winSfx } = await load('src/core/audio/sfx.ts'));
});

test('a plain jackpot tag forces the jackpot tier', () => {
  assert.equal(tiers.juiceTier(100, 10, ['jackpot']), 'jackpot');
});

test('a namespaced jackpot tag forces the jackpot tier (cyclone:jackpot)', () => {
  assert.equal(tiers.juiceTier(100, 10, ['cyclone:jackpot']), 'jackpot');
  assert.equal(tiers.juiceTier(5, 10, ['cyclone:jackpot']), 'jackpot', 'the tag wins even below x1');
});

test('other tags never force the jackpot tier', () => {
  assert.equal(tiers.juiceTier(600, 10, ['bonus']), 'mega');
  assert.equal(tiers.juiceTier(600, 10, ['jackpots']), 'mega', 'a near-miss string is not a tag');
  assert.equal(tiers.juiceTier(0, 10, ['jackpot']), 'none', 'no gross means no tier');
});

test('every presentation tier has a win sound, including push', () => {
  for (const tier of ['push', 'small', 'medium', 'big', 'huge', 'mega', 'jackpot']) {
    assert.ok(winSfx(tier), `${tier} maps to a recipe`);
  }
});
