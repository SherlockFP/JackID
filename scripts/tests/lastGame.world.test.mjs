// SON OYUN, the cabinet's place (src/world/layout.ts LAST_GAME_POS, src/world/props/lastGame.ts): it stands in the Lobby's north end and keeps
// clear of every machine's floor, the central aisle and the wing doorway lanes (so it never blocks a path), and its text keys exist in both languages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let L, P, S;
before(async () => {
  L = await load('src/world/layout.ts');
  P = await load('src/world/props/loungePlan.ts');
  S = (await load('src/game/lastGame.strings.ts')).default;
});

// the footprint the prop registers as solid: depth along x (rotY 270), width and the lever along z
const feet = () => { const { x, z } = L.LAST_GAME_POS; return [x - 0.47, z - 0.62, x + 0.47, z + 0.7]; };
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('SON OYUN stands in the Lobby, off the central aisle and the doorway lanes', () => {
  const f = feet();
  assert.ok(f[0] >= 1.7, `west edge ${f[0]} must clear the central aisle (|x| < 1.7)`);
  assert.ok(f[2] <= P.WALL - 3.2, `east edge ${f[2]} must stay out of the doorway lanes (x from ${P.WALL - 3.2})`);
  assert.ok(f[1] >= 2 && f[3] <= 20, 'inside the Lobby zone (z 2..20)');
  assert.equal(L.LAST_GAME_POS.rotY, 270, 'its front faces the aisle (west)');
});

test('SON OYUN does not sit on any machine slot or its standing zone', () => {
  const f = feet();
  for (const s of L.SLOTS) assert.ok(!hit(f, P.slotRect(s)), `overlaps ${s.id}`);
});

test('SON OYUN texts: every key in both languages', () => {
  const en = Object.keys(S.en).sort(), tr = Object.keys(S.tr).sort();
  assert.deepEqual(en, tr);
  for (const k of ['title', 'sign', 'closed', 'hud', 'opened', 'pull', 'leave', 'won', 'lost', 'cost', 'costLast']) assert.ok(k in S.en, k);
});
