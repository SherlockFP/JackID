// LOKI, SEEN (src/game/joker/apparition.ts): the placement picker never stands him in the line of play or in front of a machine
// screen and keeps him in the Trust band; Ink brings him closer, more solid, more often, and into your seat at 8; staring at him
// for 2 s sends him off, a glance away drains it twice as fast; the glitch fade is 0.3 s in three steps, Calm Mode a smooth ramp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let A, R;
before(async () => {
  A = await load('src/game/joker/apparition.ts');
  R = await load('src/core/rng.ts');
});

/** You at the origin looking +Z at a cabinet 2 m ahead whose screen faces you. */
const VIEW = { x: 0, z: 0, fx: 0, fz: 1, screens: [{ x: 0, z: 2, nx: 0, nz: -1, w: 1.2 }] };
const spot = (kind, x, z) => ({ kind, x, y: 0, z });
const deg = (v, s) => Math.abs(Math.atan2(v.fx * (s.z - v.z) - v.fz * (s.x - v.x), v.fx * (s.x - v.x) + v.fz * (s.z - v.z))) * 180 / Math.PI;

test('Trust sets the band, the facing and the stool; Ink pulls him in and makes him solid, frequent and seat-swapping', () => {
  const bands = [-3, -2, -1, 0, 1, 2, 3].map((t) => A.presenceOf(t, 0));
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i].near <= bands[i - 1].near && bands[i].far <= bands[i - 1].far, 'more Trust, nearer');
    assert.ok(bands[i].near < bands[i].far);
  }
  assert.equal(A.presenceOf(-1, 0).turnAway, true);
  assert.equal(A.presenceOf(0, 0).turnAway, false);
  assert.equal(A.presenceOf(2, 0).sit, true);
  assert.equal(A.presenceOf(1, 0).sit, false);
  const lo = A.presenceOf(0, 0), hi = A.presenceOf(0, 9);
  assert.ok(hi.far < lo.far && hi.near < lo.near, 'Ink: closer');
  assert.ok(hi.solid > lo.solid && hi.chance > lo.chance && hi.gap < lo.gap, 'Ink: more solid, more often');
  assert.equal(A.presenceOf(0, 7).swap, false);
  assert.equal(A.presenceOf(0, 8).swap, true);
});

test('the picker skips the line of play, the screen box and spots out of view, and keeps the band', () => {
  const ahead = spot('lean', 0, 2.6), onScreen = spot('lean', 0.5, 1), side = spot('lean', 1.6, 2.4), behind = spot('lean', -3, 1);
  const p0 = A.presenceOf(0, 0);
  assert.equal(A.spotOk(ahead, VIEW, p0), false, 'in the line of play');
  assert.equal(A.spotOk(onScreen, VIEW, p0), false, 'in front of the screen');
  assert.equal(A.spotOk(behind, VIEW, p0), false, 'out of view');
  assert.equal(A.spotOk(side, VIEW, p0), true);
  assert.equal(A.pickSpot([ahead, onScreen, behind, side], VIEW, p0, 0.3), 3);
  // Trust 3: the side spot is too far; a stool close by wins. Trust −3: only a far spot will do.
  const stool = spot('stool', 0.9, 1.2), far = spot('stand', 3, 5);
  assert.equal(A.pickSpot([side, stool, far], VIEW, A.presenceOf(3, 0), 0.9), 1);
  assert.equal(A.pickSpot([side, stool, far], VIEW, A.presenceOf(-3, 0), 0.1), 2);
  assert.equal(A.pickSpot([side, stool], VIEW, A.presenceOf(-3, 0), 0.5), -1);
  // a mirror ignores the band but never the view
  assert.equal(A.spotOk({ ...spot('mirror', 2, 6) }, VIEW, A.presenceOf(3, 0)), true);
  assert.equal(A.spotOk({ ...spot('mirror', 0, -6) }, VIEW, A.presenceOf(3, 0)), false);
});

test('whatever the room, a picked spot is in view, off the line of play, off every screen and in the band', () => {
  const rng = R.createRng(77);
  for (let k = 0; k < 400; k++) {
    const a = rng.float(-Math.PI, Math.PI);
    const v = { x: rng.float(-5, 5), z: rng.float(-5, 5), fx: Math.sin(a), fz: Math.cos(a), screens: [] };
    for (let i = 0; i < 3; i++) { const b = rng.float(-Math.PI, Math.PI); v.screens.push({ x: v.x + rng.float(-3, 3), z: v.z + rng.float(-3, 3), nx: Math.sin(b), nz: Math.cos(b), w: rng.pick([0.8, 1.2, 2.6]) }); }
    const spots = Array.from({ length: 10 }, () => spot(rng.pick(['lean', 'stand', 'stool']), v.x + rng.float(-6, 6), v.z + rng.float(-6, 6)));
    const p = A.presenceOf(rng.int(-3, 3), rng.int(0, 10));
    const i = A.pickSpot(spots, v, p, rng.next());
    if (i < 0) continue;
    const s = spots[i], d = Math.hypot(s.x - v.x, s.z - v.z), ang = deg(v, s);
    assert.ok(d >= p.near && d <= p.far, 'in the Trust band');
    assert.ok(ang >= A.PLAY_HALF && ang <= A.VIEW_HALF, `in view, off the line of play (${ang.toFixed(1)} deg)`);
    for (const sc of v.screens) {
      const fwd = (s.x - sc.x) * sc.nx + (s.z - sc.z) * sc.nz, lat = Math.abs((s.x - sc.x) * sc.nz - (s.z - sc.z) * sc.nx);
      assert.ok(!(fwd > -0.1 && fwd < A.SCREEN_DEEP && lat < sc.w / 2 + A.SCREEN_SIDE), 'never in front of a screen');
    }
  }
});

test('staring at him for 2 s sends him off; a look away drains it twice as fast', () => {
  const look = (s, on, secs) => { let g = { stare: s, leave: false }; for (let t = 0; t < secs - 1e-9; t += 0.1) g = A.gazeStep(g.stare, on, 0.1); return g; };
  assert.equal(look(0, true, 1.9).leave, false);
  assert.equal(look(0, true, 2.0).leave, true);
  const g = look(look(0, true, 1.5).stare, false, 0.5);
  assert.ok(Math.abs(g.stare - 0.5) < 1e-6);
  assert.equal(look(g.stare, true, 1.4).leave, false);
  assert.equal(look(g.stare, true, 1.5).leave, true);
});

test('fades and moments: a 0.3 s glitch in three steps, a smooth Calm ramp; takeovers always, the seat only from Ink 8', () => {
  assert.equal(A.GLITCH_S, 0.3);
  assert.deepEqual([0.05, 0.4, 0.7, 1].map((k) => A.fadeAt(k, false)), [1 / 3, 2 / 3, 1, 1]);
  assert.ok(A.fadeAt(0.5, true) === 0.5 && A.fadeAt(0.1, true) < 0.1);
  const p0 = A.presenceOf(0, 0), p8 = A.presenceOf(0, 8);
  assert.equal(A.showsFor('takeover', p0, 0, 0.99), true);
  assert.equal(A.showsFor('swap', p0, 1e9, 0), false);
  assert.equal(A.showsFor('swap', p8, 0, 0.1), true);
  assert.equal(A.showsFor('speak', p0, p0.gap - 1, 0), false, 'he waits his gap');
  assert.equal(A.showsFor('speak', p0, p0.gap, 0.1), true);
});
