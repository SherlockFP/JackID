// Unit tests for the suit table (src/game/suits.ts, GDD §3.4.1) against the machine folders and the generated odds
// profiles (src/game/data/machineProfiles.ts). Every gambling cabinet has exactly one suit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let S, M;
before(async () => {
  S = await load('src/game/suits.ts');
  M = await load('src/game/data/machineProfiles.ts');
});

const folders = () => readdirSync(join(ROOT, 'src', 'machines'))
  .filter((f) => !f.startsWith('_') && statSync(join(ROOT, 'src', 'machines', f)).isDirectory()).sort();

test('the table has the 38 cabinets of GDD §3.4.1 (holdem has no folder yet)', () => {
  assert.equal(Object.keys(S.SUIT_OF).length, 38);
});

test('every suit-table id is a machine folder', () => {
  for (const id of Object.keys(S.SUIT_OF)) {
    assert.ok(existsSync(join(ROOT, 'src', 'machines', id, 'index.ts')), `${id} has no machine folder`);
  }
});

test('every suit-table entry is one of the six suits', () => {
  for (const [id, suit] of Object.entries(S.SUIT_OF)) assert.ok(S.SUITS.includes(suit), `${id} -> ${suit}`);
});

test('suitMachines() partitions the table: each cabinet in exactly one suit', () => {
  const seen = new Map();
  for (const suit of S.SUITS) {
    for (const id of S.suitMachines(suit)) {
      assert.equal(seen.has(id), false, `${id} is in two suits`);
      seen.set(id, suit);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(S.SUIT_OF).sort());
});

test('suitOf() returns the table suit, null for unknown and prototype-named ids', () => {
  assert.equal(S.suitOf('roulette'), 'WHEELS');
  assert.equal(S.suitOf('bigone'), 'REELS');
  assert.equal(S.suitOf('nope_machine'), null);
  assert.equal(S.suitOf('constructor'), null);
  assert.equal(S.suitOf('toString'), null);
});

test('every gambling machine (has an odds profile) has exactly one suit or is a deliberate NO_SUIT', () => {
  const missing = Object.keys(M.MACHINE_PROFILES).filter((id) => S.suitOf(id) === null && !S.NO_SUIT.has(id));
  assert.deepEqual(missing, []);
});

test('NO_SUIT ids are real machines and never also in the table', () => {
  for (const id of S.NO_SUIT) {
    assert.ok(folders().includes(id), `${id} is not a machine folder`);
    assert.equal(S.suitOf(id), null, `${id} is in both NO_SUIT and the table`);
  }
});

test('every suit has a glyph colour', () => {
  for (const suit of S.SUITS) assert.equal(typeof S.SUIT_COLOR[suit], 'number');
});
