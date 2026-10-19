// Unit tests for src/core/version.ts: the pure decision of the stale-tab version check (headless, no fetch, no DOM).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let versionAct;
before(async () => { ({ versionAct } = await load('src/core/version.ts')); });

// versionAct(baked, live, canReload, reloadedFor, toasted)
test('same version, or nothing fetched yet: nothing happens', () => {
  assert.equal(versionAct('a1', 'a1', true, null, false), 'none');
  assert.equal(versionAct('a1', 'a1', false, null, false), 'none');
  assert.equal(versionAct('a1', null, true, null, false), 'none');
  assert.equal(versionAct('a1', '', true, null, false), 'none');
});

test('newer version on the menu: reload right away', () => {
  assert.equal(versionAct('a1', 'b2', true, null, false), 'reload');
});

test('newer version mid-run: toast once, then reload when the menu is reached', () => {
  assert.equal(versionAct('a1', 'b2', false, null, false), 'toast');
  assert.equal(versionAct('a1', 'b2', false, null, true), 'none');   // later polls and state changes stay quiet
  assert.equal(versionAct('a1', 'b2', true, null, true), 'reload');  // back on the menu
});

test('loop guard: never reload twice for the same live version', () => {
  assert.equal(versionAct('a1', 'b2', true, 'b2', false), 'none');
  assert.equal(versionAct('a1', 'b2', false, 'b2', false), 'none');
  assert.equal(versionAct('a1', 'c3', true, 'b2', false), 'reload'); // a newer deploy still counts
});
