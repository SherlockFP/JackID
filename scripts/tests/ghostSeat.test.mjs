// THE GHOST SEAT (src/game/ghostSeat.ts): no copy before Night 2, the copy sits where the player lost most last Night, a player win
// matches a copy loss and a player loss matches a copy win (+1 star each), the per-side pools and the Night cap, and the save round trip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const G = await load('src/game/ghostSeat.ts');

/** Plays rounds at a machine kind during a Night: `w` wins of 5 coins back on a 5-coin bet, `l` losses of 5 coins. */
function play(g, night, machineId, mid, { w = 0, l = 0 }) {
  const out = [];
  for (let i = 0; i < w; i++) out.push(g.round(night, machineId, mid, 5, 12));
  for (let i = 0; i < l; i++) out.push(g.round(night, machineId, mid, 5, 0));
  return out;
}

test('no copy in Night 1, and none when Night 1 had no losses', () => {
  const g = G.createGhostSeat();
  assert.equal(g.beginNight(1), null);
  play(g, 1, 'slot', 'seat-a', { l: 4 });
  assert.equal(g.beginNight(1), null, 'Night 1 never has a copy');
  const h = G.createGhostSeat();
  play(h, 1, 'slot', 'seat-a', { w: 3 });
  assert.equal(h.beginNight(2), null, 'a Night with only wins leaves no copy');
});

test('the copy sits at the machine with the most coins lost last Night', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'roulette', 'seat-r', { l: 2 });   // lost 10
  play(g, 1, 'slot', 'seat-s', { l: 3 });       // lost 15, the most
  const seat = g.beginNight(2);
  assert.equal(seat.night, 2);
  assert.equal(seat.machineId, 'slot');
  assert.equal(seat.mid, 'seat-s');
  assert.equal(seat.stars, 0);
});

test('the copy pools are the player wins and losses there, capped at GHOST_POOL per side', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 5, l: 2 });
  const seat = g.beginNight(2);
  assert.equal(seat.lost, G.GHOST_POOL, 'five player wins, pool capped at 3');
  assert.equal(seat.won, 2, 'two player losses');
});

test('a player win on the copy machine matches a round the copy lost (+1 star)', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 1, l: 1 });
  g.beginNight(2);
  const m = g.round(2, 'slot', 'seat-s', 5, 12);
  assert.deepEqual(m, { star: 1, side: 'lost', machineId: 'slot', mid: 'seat-s' });
  assert.equal(g.seat().lost, 0);
  assert.equal(g.seat().stars, 1);
  assert.equal(g.round(2, 'slot', 'seat-s', 5, 12), null, 'the copy owes nothing more on that side');
});

test('a player loss on the copy machine matches a round the copy won (+1 star)', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 1, l: 2 });
  g.beginNight(2);
  const m = g.round(2, 'slot', 'seat-s', 5, 0);
  assert.deepEqual(m, { star: 1, side: 'won', machineId: 'slot', mid: 'seat-s' });
  assert.equal(g.seat().won, 1);
});

test('rounds at another machine match nothing, and the tally still feeds the next Night', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 1, l: 1 });
  g.beginNight(2);
  assert.equal(g.round(2, 'roulette', 'seat-r', 5, 12), null);
  assert.equal(g.seat().lost, 1, 'nothing was used up');
  play(g, 2, 'roulette', 'seat-r', { l: 4 });
  const seat3 = g.beginNight(3);
  assert.equal(seat3.machineId, 'roulette', 'Night 2 losses pick the copy for Night 3');
});

test('the copy gives at most GHOST_NIGHT_MAX stars a Night', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 3, l: 3 });
  g.beginNight(2);
  let stars = 0;
  for (let i = 0; i < 12; i++) {
    const m = g.round(2, 'slot', 'seat-s', 5, i % 2 === 0 ? 12 : 0);
    if (m) stars += m.star;
  }
  assert.equal(stars, G.GHOST_NIGHT_MAX);
  assert.equal(g.seat().stars, G.GHOST_NIGHT_MAX);
});

test('a new Night resets the copy stars and drops last Night seat', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 1, l: 1 });
  g.beginNight(2);
  g.round(2, 'slot', 'seat-s', 5, 12);
  g.beginNight(3);
  assert.equal(g.seat(), null, 'Night 2 had no losses, so Night 3 has no copy');
});

test('the save round trip keeps the tally and the copy seat', () => {
  const g = G.createGhostSeat();
  g.beginNight(1);
  play(g, 1, 'slot', 'seat-s', { w: 2, l: 2 });
  g.beginNight(2);
  g.round(2, 'slot', 'seat-s', 5, 12);
  play(g, 2, 'roulette', 'seat-r', { l: 1 });
  const s = JSON.parse(JSON.stringify(g.snapshot()));
  const back = G.createGhostSeat();
  back.restore(s);
  assert.deepEqual(back.seat(), g.seat());
  const a = back.round(2, 'slot', 'seat-s', 5, 0);
  const b = g.round(2, 'slot', 'seat-s', 5, 0);
  assert.deepEqual(a, b);
  assert.deepEqual(back.beginNight(3), g.beginNight(3));
});

test('a damaged or missing slice reads as no copy', () => {
  for (const junk of [undefined, null, 7, 'x', { tally: 'no', seat: { machineId: 1 } }]) {
    const g = G.createGhostSeat();
    g.restore(junk);
    assert.equal(g.seat(), null, JSON.stringify(junk));
  }
});
