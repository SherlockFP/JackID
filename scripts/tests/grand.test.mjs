// Wave 75: the grand casino. The atrium stage keeps FLR-05 empty, the new props exist in the level build, and the strings have EN and TR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let L, G;
before(async () => {
  L = await load('src/world/layout.ts');
  G = await load('src/world/props/grand.ts');
});
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('FLR-05 stays a slot but holds no machine: the stage stands there', () => {
  assert.ok(L.SLOTS.some((s) => s.id === 'FLR-05'));
  assert.deepEqual([...L.STAGE_SLOTS], ['FLR-05']);
  assert.equal(L.FREE_ASSIGN['FLR-05'], undefined);
  assert.equal(L.assignment('debt')['FLR-05'], undefined);
});

test('stage, jackpot wall and prize case sit inside their rooms', () => {
  const { STAGE, JACKPOT_WALL, PRIZE_CASE } = G;
  assert.ok(STAGE.x - STAGE.w / 2 > -6.5 && STAGE.x + STAGE.w / 2 < -1.0, 'clear of the column at x -7 and the trapdoor');
  assert.ok(STAGE.z + STAGE.d / 2 < 11, 'clear of the trapdoor plate');
  assert.ok(JACKPOT_WALL.z < 2 && JACKPOT_WALL.y - JACKPOT_WALL.h / 2 > 3.3, 'hangs above head height in the Well');
  assert.ok(PRIZE_CASE.z + PRIZE_CASE.d / 2 <= 19.85 && PRIZE_CASE.x + PRIZE_CASE.w / 2 < 11);
});

test('level wires the grand props, anchors and light show', () => {
  const lvl = src('src/world/level.ts');
  for (const id of ['stage:', 'jackpotWall:', 'prizeCase:', 'lightShow,']) assert.ok(lvl.includes(id), id);
  const grand = src('src/world/props/grand.ts');
  for (const a of ["'stage.center'", "'stage.compere'"]) assert.ok(grand.includes(a), a);
  assert.ok(/setLines\(/.test(grand) && /flash\(\)/.test(grand) && /setPrizes/.test(grand) && /lightShow\(/.test(grand));
});

test('new prop strings exist in EN and TR', () => {
  const s = src('src/world/props/props.strings.ts');
  for (const k of ['jackpot.idle', 'jackpot.sub', 'prizes.title']) assert.equal(s.split(`'${k}'`).length - 1, 2, k);
});
