// Unit tests for the room dressing rules (src/world/rooms/logic.ts): plate views, the key-ready cue edge, the locker bank,
// the boiler gauge sweep, nearest key-ready grille, note anchor ids and the Collector's chair window. Pure data, no engine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let L;
before(async () => {
  L = await load('src/world/rooms/logic.ts');
});

test('plateView: open wings lose the plate; sealed and key-ready read as such', () => {
  assert.equal(L.plateView('sealed', false), 'sealed');
  assert.equal(L.plateView('keyReady', false), 'keyReady');
  assert.equal(L.plateView('keyReady', true), 'gone');
  assert.equal(L.plateView('open', false), 'gone');
});

test('shouldCue fires only on the sealed to key-ready edge', () => {
  assert.equal(L.shouldCue('sealed', 'keyReady'), true);
  assert.equal(L.shouldCue(undefined, 'keyReady'), false);
  assert.equal(L.shouldCue('keyReady', 'keyReady'), false);
  assert.equal(L.shouldCue('sealed', 'open'), false);
});

test('needleDeg sweeps -135 to +135 and clamps', () => {
  assert.equal(L.needleDeg(0), -135);
  assert.ok(Math.abs(L.needleDeg(100) - 135) < 1e-9);
  assert.equal(L.needleDeg(-5), -135);
  assert.ok(Math.abs(L.needleDeg(500) - 135) < 1e-9);
});

test('lockers: 12 numbered, evenly spaced, clear of the doorway at z 3-7', () => {
  const zs = Array.from({ length: L.LOCKER_COUNT }, (_, i) => L.lockerZ(i + 1));
  assert.equal(zs.length, 12);
  assert.equal(L.lockerLabel(1), '01');
  assert.equal(L.lockerLabel(12), '12');
  assert.ok(Math.max(...zs) + 0.2 < 3, 'last locker stays north of the laundry doorway');
  assert.ok(Math.min(...zs) < Math.max(...zs));
});

test('every grille has a plate face on the nave side and a marquee inside the room', () => {
  for (const g of L.GRILLES) {
    const px = L.plateX(g);
    const sx = L.signX(g);
    if (g.side === -1) {
      assert.ok(px > g.x && sx < g.x, `${g.wing}: plate east of wall, sign west`);
      assert.equal(L.faceDeg(g), 90);
    } else {
      assert.ok(px < g.x && sx > g.x, `${g.wing}: plate west of wall, sign east`);
      assert.equal(L.faceDeg(g), -90);
    }
  }
});

test('nearestKeyReady picks the closest key-ready grille, or null', () => {
  assert.equal(L.nearestKeyReady({ x: 0, z: 0 }, {}), null);
  const r = L.nearestKeyReady({ x: 9, z: -9 }, { gallery: 'keyReady', midway: 'keyReady', boiler: 'sealed' });
  assert.equal(r.wing, 'gallery');
  assert.ok(r.dist < 3);
});

test('note anchors n15 to n28 have stable ids', () => {
  assert.equal(L.NOTE_NUMBERS.length, 14);
  assert.equal(L.noteAnchorId(15), 'note.n15');
  assert.equal(L.noteAnchorId(28), 'note.n28');
});

test('the Collector chair shows on Nights 3 to 7 only', () => {
  assert.equal(L.chairVisible(2), false);
  assert.equal(L.chairVisible(3), true);
  assert.equal(L.chairVisible(7), true);
  assert.equal(L.chairVisible(8), false);
});
