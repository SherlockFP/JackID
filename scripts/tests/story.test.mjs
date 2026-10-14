// Unit tests for the story data (WAVE24 §3): note gating, the room/Night split, Mira's call table and the EN/TR key sets.
// Not registered in scripts/tests/index.js (the integrator adds it); see the WIRING list in the lane report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let data, calls, notesStr, cutStr, callStr;
before(async () => {
  data = await load('src/game/story/notes.data.ts');
  calls = await load('src/game/story/calls.ts');
  notesStr = (await load('src/game/story/story.strings.ts')).default;
  cutStr = (await load('src/game/story/cutscenes/story.cut.strings.ts')).default;
  callStr = (await load('src/game/story/calls.strings.ts')).default;
});

const gate = (open, night) => ({ zoneOpen: (z) => open.includes(z), night: () => night });

test('an ungated note is placed with no gate at all; a room note needs its wing and its Night', () => {
  const n01 = data.NOTES.find((d) => d.id === 'n01');
  const n15 = data.NOTES.find((d) => d.id === 'n15');
  assert.equal(data.noteOpen(n01, null), true);
  assert.equal(data.noteOpen(n15, null), false, 'no gate: room notes stay hidden');
  assert.equal(data.noteOpen(n15, gate(['cards'], 1)), false, 'Night 1 is before its Night 2');
  assert.equal(data.noteOpen(n15, gate(['cards'], 2)), true);
  assert.equal(data.noteOpen(n15, gate([], 9)), false, 'a closed wing hides it whatever the Night');
});

test('the Mouth and the Sump notes are never room-gated, and n27 starts on Night 1', () => {
  const n27 = data.NOTES.find((d) => d.id === 'n27');
  const n28 = data.NOTES.find((d) => d.id === 'n28');
  assert.equal(n27.zone, undefined);
  assert.equal(n28.zone, undefined);
  assert.equal(data.noteOpen(n27, gate([], 1)), true);
  assert.equal(data.noteOpen(n28, gate([], 1)), true);
});

test('note ids are unique and the wing split matches the plan (n15 to n28)', () => {
  const ids = data.NOTES.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(data.NOTES.length, 28);
  const zoneOf = Object.fromEntries(data.NOTES.map((d) => [d.id, d.zone ?? d.anchor.split('.')[0]]));
  assert.equal(zoneOf.n15, 'cards');
  assert.equal(zoneOf.n17, 'laundry');
  assert.equal(zoneOf.n20, 'boiler');
  assert.equal(zoneOf.n22, 'parlour');
  assert.equal(zoneOf.n24, 'counting');
  assert.deepEqual(data.notesInZone('laundry').map((d) => d.id), ['n17', 'n18', 'n19']);
});

test('every note from n15 to n28 has a title and a body in English and Turkish', () => {
  for (let i = 15; i <= 28; i++) {
    const id = `n${String(i).padStart(2, '0')}`;
    for (const lang of ['en', 'tr']) {
      const table = notesStr[lang];
      assert.ok(table[`note.${id}.t`], `${lang} ${id}.t`);
      assert.ok(table[`note.${id}.b`], `${lang} ${id}.b`);
    }
  }
});

test('Mira calls: N2 and N5 exist, the rest have none, and every line is in both languages', () => {
  assert.equal(calls.storyCallFor(2)?.id, 'mira_n2');
  assert.equal(calls.storyCallFor(5)?.id, 'mira_n5');
  assert.equal(calls.storyCallFor(3), null);
  for (const c of calls.STORY_CALLS) {
    assert.equal(c.kind, 'wrong_number');
    for (const key of c.lines) {
      const k = key.replace(/^story\./, '');
      assert.ok(callStr.en[k], `en ${k}`);
      assert.ok(callStr.tr[k], `tr ${k}`);
    }
  }
});

test('the three new cutscenes have matching EN and TR subtitle keys', () => {
  for (const scene of ['wing_key', 'locker', 'audit']) {
    for (const n of [1, 2, 3]) {
      const k = `${scene}.${n}`;
      assert.ok(cutStr.en[k], `en ${k}`);
      assert.ok(cutStr.tr[k], `tr ${k}`);
    }
  }
  assert.ok(notesStr.en['speaker.clerk'] && notesStr.tr['speaker.clerk']);
});
