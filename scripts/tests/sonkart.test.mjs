// Son Kart (UNO-style party game): rules, bot personas and the headless round the sims use. Pure rules, no DOM.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const MOD = 'src/machines/sonkart/rules.ts';

test('deck: 115 cards, ids unique per kind, five-card opening hand', async () => {
  const R = await load(MOD);
  const d = R.buildDeck();
  assert.equal(d.length, 115);
  assert.equal(R.HAND0, 5);
  const { createRng } = await load('src/core/rng.ts');
  const g = R.startRound([true, true, true, true], createRng(7), R.HOUSE_DEFAULT);
  for (const h of g.hands) assert.equal(h.length, R.HAND0);
  assert.ok(R.isNumber(g.top), 'the round opens on a plain number');
  assert.equal(g.hands.flat().length + g.draw.length + g.disc.length, 115);
});

test('personas: one per seat, levels 1-3, probabilities in range', async () => {
  const R = await load(MOD);
  assert.equal(R.PERSONAS.length, 4);
  for (let s = 0; s < 4; s++) {
    const p = R.personaOf(s);
    assert.ok(p.level >= 1 && p.level <= 3);
    for (const x of [p.call, p.catchP]) assert.ok(x > 0 && x <= 1);
  }
  assert.deepEqual(R.PERSONAS.map((p) => p.id), ['rash', 'hoard', 'grudge', 'shark']);
  assert.equal(R.personaOf(5).id, R.personaOf(1).id);
});

/** One round with the personas seated 1-3 and a level-2 brain at seat 0; returns the finished game. */
async function playOne(R, rng, humanSeat = 0) {
  const g = R.startRound([true, true, true, true], rng, R.HOUSE_DEFAULT);
  R.settleTurn(g, rng);
  let steps = 0;
  for (; !g.over && steps < 900; steps++) {
    const s = g.turn;
    const per = s === 0 ? undefined : R.personaOf(s);
    const d = R.botDecide(g, s, per ? per.level : 2, rng, -1, per, humanSeat);
    let res;
    if (d.k === 'play') res = R.applyPlay(g, rng, s, d.id, { col: d.col || undefined, debtUnit: 20, wealthiest: -1, callOn: rng.chance(per ? per.call : 0.8) });
    else if (d.k === 'pass') res = R.applyPass(g, s);
    else if (d.k === 'call') res = R.applyCall(g, s);
    else if (d.k === 'catch') res = R.applyCatch(g, rng, s);
    else res = R.applyDraw(g, rng, s);
    if (res.err) res = R.autoAct(g, rng, s, 20, -1);
    R.settleTurn(g, rng);
  }
  return { g, steps };
}

test('every seeded round ends with a winner, and cards are conserved', async () => {
  const R = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  let total = 0;
  const wins = [0, 0, 0, 0];
  const N = 300;
  for (let i = 0; i < N; i++) {
    const { g, steps } = await playOne(R, createRng(1000 + i));
    assert.ok(g.over, `round ${i} did not finish in ${steps} steps`);
    assert.ok(g.winner >= 0 && g.hands[g.winner].length === 0);
    assert.equal(g.hands.flat().length + g.draw.length + g.disc.length, 115, `round ${i} lost or duplicated cards`);
    total += steps;
    wins[g.winner]++;
  }
  const avg = total / N;
  assert.ok(avg < 120, `rounds should be quick: ${avg.toFixed(1)} actions on average`);
  assert.ok(wins.every((w) => w > 0), `every seat should win sometimes: ${wins}`);
});

test('personas play differently: Tin Tom aims attacks at the human more than Rattle does', async () => {
  const R = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  // a hand full of attacks and a plain match; the next seat in turn order is the human
  const count = (persona) => {
    let atk = 0;
    for (let i = 0; i < 400; i++) {
      const rng = createRng(50 + i);
      const g = R.startRound([true, true, true, true], rng, R.HOUSE_DEFAULT);
      g.turn = 3; g.dir = 1; g.top = 'R5'; g.col = 'R'; g.pend = 0; g.pendK = '';
      g.hands[3] = ['R7', 'R+2', 'RS', 'R3'];
      g.hands[0] = ['B1', 'B2', 'B3', 'B4', 'B5'];
      const d = R.botDecide(g, 3, persona.level, rng, -1, persona, 0);
      if (d.k === 'play' && (R.faceOf(d.id) === '+2' || R.faceOf(d.id) === 'S')) atk++;
    }
    return atk;
  };
  const grudge = count(R.PERSONAS[2]);
  const rash = count(R.PERSONAS[0]);
  assert.ok(grudge > 380, `Tin Tom should nearly always attack the human: ${grudge}/400`);
  assert.ok(grudge > rash, `Tin Tom ${grudge} vs Rattle ${rash}`);
});

test('Mrs Gloom hoards wilds until she is nearly out', async () => {
  const R = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  let wild = 0;
  for (let i = 0; i < 300; i++) {
    const rng = createRng(900 + i);
    const g = R.startRound([true, true, true, true], rng, R.HOUSE_DEFAULT);
    g.turn = 1; g.dir = 1; g.top = 'R5'; g.col = 'R'; g.pend = 0; g.pendK = '';
    g.hands[1] = ['R7', 'R2', 'W', 'G9', 'B4'];
    const d = R.botDecide(g, 1, 2, rng, -1, R.PERSONAS[1], 0);
    if (d.k === 'play' && d.id === 'W') wild++;
  }
  assert.ok(wild < 15, `Mrs Gloom played the wild ${wild}/300 times with a plain card available`);
});

test('headless round: the player seat wins roughly a quarter of the time, and pays out sanely', async () => {
  const R = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  const rng = createRng(2024);
  let wins = 0, gross = 0;
  const N = 4000, bet = 20;
  for (let i = 0; i < N; i++) {
    const r = R.playHeadless(rng, bet);
    if (r.gross > 0) wins++;
    gross += r.gross;
  }
  const rtp = gross / (N * bet);
  const hit = wins / N;
  assert.ok(hit > 0.15 && hit < 0.4, `hit rate ${hit.toFixed(3)}`);
  assert.ok(rtp > 0.7 && rtp < 1.3, `rtp ${rtp.toFixed(3)}`);
  console.log(`sonkart headless: hit ${(hit * 100).toFixed(1)}% rtp ${(rtp * 100).toFixed(1)}%`);
});

// ── table layout (presentation only: src/machines/sonkart/layout.ts) ─────────────────────────────────────────────
const LAYOUT = 'src/machines/sonkart/layout.ts';

test('layout: opponent fans lie on the felt, clear of the colour ring and the draw pile', async () => {
  const L = await load(LAYOUT);
  const w = L.CARD_W * L.FELT_SCALE, h = L.CARD_H * L.FELT_SCALE;
  const deck = L.cardCorners({ x: L.DECK.x, z: L.DECK.z, yaw: 0 }, w, h);
  for (const [x, z] of deck) assert.ok(Math.hypot(x, z) > L.RING_OUT, 'the draw pile stays outside the colour ring');
  for (let seat = 0; seat < 4; seat++) {
    for (const n of [1, 2, 5, 9]) {
      for (const spot of L.fanSpots(seat, n)) {
        for (const [x, z] of L.cardCorners(spot, w, h)) {
          const r = Math.hypot(x, z);
          assert.ok(r < L.FELT_R - 0.005, `seat ${seat} n ${n}: a corner at ${r.toFixed(3)} m is off the felt`);
          assert.ok(r > L.RING_OUT + 0.05, `seat ${seat} n ${n}: a corner at ${r.toFixed(3)} m crowds the ring`);
          for (const [dx, dz] of deck) assert.ok(Math.hypot(x - dx, z - dz) > 0.04, `seat ${seat} n ${n}: a card touches the draw pile`);
        }
      }
    }
  }
});

test('layout: a fan reads upright for its owner and the top card for the seat that looks at it', async () => {
  const L = await load(LAYOUT);
  for (let seat = 0; seat < 4; seat++) {
    const [dx, dz] = L.SEAT_DIR[seat];
    const mid = L.fanSpots(seat, 1)[0];
    // the card's top edge (local -Z, turned by yaw) points from the owner at the centre of the table
    assert.ok(Math.abs(-Math.sin(mid.yaw) + dx) < 1e-9 && Math.abs(-Math.cos(mid.yaw) + dz) < 1e-9, `seat ${seat}`);
  }
  assert.equal(L.seatYaw(0), 0, 'seat 0 sees the table the way it is modelled');
});

test('layout: chairs fit the L footprint and the seat camera looks down 35-45 degrees at the middle of the table', async () => {
  const L = await load(LAYOUT);
  for (let seat = 0; seat < 4; seat++) {
    const c = L.chairAt(seat);
    assert.ok(Math.abs(c.x) + 0.23 <= 1.3 && Math.abs(c.z) + 0.23 <= 0.9 + 1e-9, `chair ${seat} sticks out of the 2.6 x 1.8 m footprint`);
    const cam = L.seatCamera(seat);
    const run = Math.hypot(cam.pos[0], cam.pos[2]);
    const pitch = (Math.atan2(cam.pos[1] - L.FELT_Y, run) * 180) / Math.PI;
    assert.ok(pitch >= 35 && pitch <= 45, `seat ${seat}: pitch ${pitch.toFixed(1)}`);
    // the camera sits on the seat's side and looks across the table, so every seat sees the same picture
    const [dx, dz] = L.SEAT_DIR[seat];
    assert.ok(cam.pos[0] * dx + cam.pos[2] * dz > 0 && cam.look[0] * dx + cam.look[2] * dz > 0);
  }
});
