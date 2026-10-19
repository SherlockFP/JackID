// Table readout tests: the pieces each duel puts on the Tally Table (board hooks), that they carry public information only, the
// odds on Vell's buttons, the strings they name, the tile names in two languages, the Sheet window, the plate's pop detection, the
// choice bar, and the seat layout (the rival's hips on the cushion, the camera framing).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const GAMES = [
  { id: 'sealedwall', exp: 'sealedWall', rival: 'tamsin' },
  { id: 'ghostshell', exp: 'ghostShell', rival: 'lucan' },
  { id: 'steamcount', exp: 'steamCount', rival: 'kuro' },
  { id: 'lockershuffle', exp: 'lockerShuffle', rival: 'mimosa' },
  { id: 'thequestion', exp: 'theQuestion', rival: 'orrin' },
  { id: 'lastcount', exp: 'lastCount', rival: 'vell' },
];

let rng, engine, DS, PS, LS, BOARD, SHEET, SEAT;
const R = {};
before(async () => {
  rng = await load('src/core/rng.ts');
  engine = await load('src/game/duels/engine.ts');
  DS = (await load('src/game/duels/duels.strings.ts')).default;
  PS = (await load('src/game/duels/promise/promise.strings.ts')).default;
  LS = (await load('src/game/duels/promise/lucan.strings.ts')).default;
  for (const g of GAMES) R[g.id] = (await load(`src/game/duels/${g.id}/index.ts`))[g.exp];
  R.promise = (await load('src/game/duels/promise/index.ts')).lucanDuel;
  BOARD = await load('src/machines/tallytable/board.ts');
  SHEET = await load('src/machines/tallytable/sheet.ts');
  SEAT = await load('src/machines/tallytable/seat.ts');
});

const IDS = () => [...GAMES.map((g) => g.id), 'promise'];
const STAKE = 100;

/** Plays a duel with the engine's own protocol and hands every state (after each step) to `fn`. */
function walk(id, seed, fn) {
  const rules = R[id];
  const plan = rules.makePlan(seed);
  let s = rules.init(rng.hashSeed(seed, 'init'), plan, STAKE);
  fn(s);
  for (let i = 0; !s.done && i < 400; i++) {
    const legal = s.turn === 'player' ? rules.legal(s) : [];
    const out = legal.length
      ? rules.step(s, 'player', legal[Math.floor(rng.createRng(seed + i).next() * legal.length)], plan)
      : rules.step(s, 'rival', rules.rivalAct(s, plan, rng.hashSeed(seed, 'rival', i)), plan);
    s = out.state;
    fn(s);
  }
}

/** The same state with every field the player cannot know changed to something else. */
function perturb(id, st) {
  const s = structuredClone(st);
  const flip = (n, k) => (n + k) % 10 + 1;
  switch (id) {
    case 'lastcount': for (let i = s.shown; i < s.tape.length; i++) s.tape[i] = flip(s.tape[i], 3); s.cheated = !s.cheated; break;
    case 'sealedwall':
      s.hands.rival = s.hands.rival.map((t) => (t + 7) % 27);
      s.wall = s.wall.slice(0, s.pos).concat(s.wall.slice(s.pos).reverse());
      s.cheated = !s.cheated; s.sleeve = (s.sleeve + 4) % 27; s.extra = s.extra + 1;
      break;
    case 'steamcount': s.cheated = !s.cheated; s.streak += 2; s.rolls += 5; s.mathDone = !s.mathDone; break;
    case 'lockershuffle': s.pos = (s.pos + 1) % 3; if (s.counted > 0) s.counted += 3; s.cheated = !s.cheated; break;
    case 'thequestion':
      s.hand.rival = [flip(s.hand.rival[0], 2), flip(s.hand.rival[1], 5)]; s.stand.rival = flip(s.stand.rival, 4);
      s.deck = s.deck.slice(0, s.dpos).concat(s.deck.slice(s.dpos).reverse()); s.cheated = !s.cheated;
      break;
    case 'ghostshell': s.mag = s.mag.slice().reverse(); s.extraAt = s.extraAt + 1; s.cheated = !s.cheated; break;
    case 'promise': s.his = s.his === 'rock' ? 'paper' : 'rock'; s.looks = !s.looks; s.cheated = !s.cheated; s.mirror = !s.mirror; break;
  }
  return s;
}

test('every duel puts pieces on the table, and the board reads only what the player can know', () => {
  for (const id of IDS()) {
    let n = 0;
    for (const seed of [3, 11, 29, 47]) {
      walk(id, seed, (s) => {
        const b = R[id].board(s);
        assert.ok(Array.isArray(b.zones), `${id}: zones`);
        assert.ok(b.zones.length > 0 || b.meter || b.score, `${id}: something to show`);
        for (const z of b.zones) {
          assert.ok(z.label.key, `${id}: a zone label`);
          for (const p of z.pieces) assert.ok(p.top.text !== undefined || p.top.key, `${id}: a piece face`);
        }
        assert.equal(JSON.stringify(R[id].board(perturb(id, s))), JSON.stringify(b), `${id} seed ${seed}: the board changed when only hidden state changed`);
        n++;
      });
    }
    assert.ok(n > 8, `${id}: states walked`);
  }
});

test('Last Count: seen cards face up, the next card and the rest face down and unnamed', () => {
  walk('lastcount', 5, (s) => {
    const [z] = R.lastcount.board(s).zones;
    assert.equal(z.pieces.length, 8);
    z.pieces.forEach((p, i) => {
      if (i < s.shown) assert.equal(p.top.text, String(s.tape[i]));
      else { assert.equal(p.down, true); assert.equal(p.top.text, '?'); }
    });
    if (!s.done) assert.equal(z.pieces[s.shown].mark, 'next');
  });
});

test('Last Count buttons carry the odds of the cards shown', () => {
  const s = R.lastcount.init(1, R.lastcount.makePlan(1), STAKE);
  const hi = R.lastcount.describeAction({ k: 'higher' }, s), lo = R.lastcount.describeAction({ k: 'lower' }, s);
  assert.equal(hi.key, 'duel.lc.act.higherOdds');
  assert.equal(lo.key, 'duel.lc.act.lowerOdds');
  const cur = s.tape[0];                                    // 4 of each rank in 40 cards, one shown: 39 left, 4 per higher / lower rank
  assert.equal(hi.data.odds, Math.round((((10 - cur) * 4) / 39) * 100));
  assert.equal(lo.data.odds, Math.round((((cur - 1) * 4) / 39) * 100));
  assert.ok(hi.data.odds + lo.data.odds <= 100);
  assert.deepEqual(R.lastcount.describeAction({ k: 'higher' }), { key: 'duel.lc.act.higher' }, 'without a state the plain label');
  const p = new engine.DuelSession({ rules: R.lastcount, runSeed: 9, rivalId: 'vell', night: 8, tier: 'coins', S: STAKE }).prompt();
  assert.equal(p.actions[0].key, 'duel.lc.act.higherOdds');
  assert.ok(p.board && p.board.zones.length === 1, 'the prompt carries the board');
});

test('Sealed Wall: the hand is face up, the pieces you may discard point at their action, her hand and the cheat are not shown', () => {
  let checked = 0;
  walk('sealedwall', 8, (s) => {
    const b = R.sealedwall.board(s);
    const hand = b.zones[0].pieces;
    assert.equal(hand.length, s.hands.player.length);
    assert.equal(b.zones.length, 2, 'your hand and the discards only');
    const acts = hand.map((p) => p.act).filter((a) => a !== undefined).sort();
    if (s.turn === 'player' && s.phase === 'disc') {
      assert.deepEqual(acts, R.sealedwall.legal(s).map((_, i) => i), 'each discard is reachable from the board');
      checked++;
    } else assert.deepEqual(acts, []);
    for (const p of b.zones[1].pieces) assert.ok(p.mark === 'his' || p.mark === 'mine' || p.mark === 'next');
  });
  assert.ok(checked > 0);
});

test('The Question: his two cards are face down; Steam Count draws a gauge; Ghost Shell shows the announced tray', () => {
  walk('thequestion', 4, (s) => {
    const b = R.thequestion.board(s);
    assert.ok(b.zones[1].pieces.every((p) => p.down && p.top.text === '?'));
    assert.equal(b.zones[0].pieces.filter((p) => p.mark === 'now').length, 1);
    assert.equal(b.score.of, 5);
  });
  walk('steamcount', 4, (s) => {
    const m = R.steamcount.board(s).meter;
    assert.equal(m.value, s.gauge);
    assert.equal(m.max, 99);
  });
  walk('ghostshell', 4, (s) => {
    const b = R.ghostshell.board(s);
    assert.equal(b.zones[0].pieces[0].top.text, String(s.ann.live));
  });
});

test('Promise: the word, your staged throw or the last round; his committed throw never shows', () => {
  let words = 0, lasts = 0;
  for (const seed of [2, 5, 9]) walk('promise', seed, (s) => {
    const b = R.promise.board(s);
    const labels = b.zones.map((z) => z.label.key);
    if (s.promise) { words++; assert.ok(labels.some((k) => k.startsWith('duel.pr.zone.word'))); assert.ok(!labels.includes('duel.pr.zone.last')); }
    if (!s.promise && s.m.log.length) { lasts++; assert.ok(labels.includes('duel.pr.zone.last')); }
    assert.equal(b.score.of, 4);
  });
  assert.ok(words > 0 && lasts > 0);
});

test('every key a board, a goal or a tile name uses exists in both languages', () => {
  const has = (l, k) => (k.startsWith('duel.') ? DS[l][k.slice(5)] ?? LS[l][k.slice(5)] : k.startsWith('promise.') ? PS[l][k.slice(8)] : undefined) !== undefined;
  const check = (ref, where) => {
    if (!ref) return;
    if (ref.key) for (const l of ['en', 'tr']) assert.ok(has(l, ref.key), `${where}: ${l} ${ref.key}`);
    if (ref.data?.nameKey) for (const l of ['en', 'tr']) assert.ok(has(l, ref.data.nameKey), `${where}: ${l} ${ref.data.nameKey}`);
  };
  for (const id of IDS()) {
    assert.ok(R[id].goal, `${id} has a goal`);
    for (const l of ['en', 'tr']) assert.ok(has(l, R[id].goal), `${id}: ${l} ${R[id].goal}`);
    for (const seed of [1, 7, 13, 21]) walk(id, seed, (s) => {
      const b = R[id].board(s);
      for (const z of b.zones) { check(z.label, id); for (const p of z.pieces) { check(p.top, id); check(p.sub, id); } }
      if (b.meter) check(b.meter.label, id);
      for (const n of b.notes ?? []) check(n, id);
      if (s.turn === 'player') for (const a of R[id].legal(s)) check(R[id].describeAction(a, s), id);
    });
  }
  // all 30 tiles name themselves
  const M = { suit: (t) => (t >= 27 ? 3 : Math.floor(t / 9)), rank: (t) => (t >= 27 ? t - 26 : (t % 9) + 1) };
  for (let t = 0; t < 30; t++) {
    const key = `duel.sw.t.${t >= 27 ? `d${M.rank(t)}` : M.suit(t)}`;
    for (const l of ['en', 'tr']) assert.ok(has(l, key), `tile ${t} ${l}`);
  }
});

test('textVars: plain values pass, an xKey entry is translated into x with the same variables', () => {
  const tr = (key, vars) => `${key}:${vars.rank}`;
  const v = BOARD.textVars({ tile: 5, rank: 8, nameKey: 'duel.sw.t.0', name: 'COINS 8', skip: { a: 1 } }, tr, (k) => k.startsWith('duel.'));
  assert.equal(v.name, 'duel.sw.t.0:8', 'the translated name wins over the literal one');
  assert.equal(v.tile, 5);
  assert.equal(v.skip, undefined);
  assert.deepEqual(BOARD.textVars({ nameKey: 'nope' }, tr, () => false), { nameKey: 'nope' }, 'an unknown key is left alone');
  assert.deepEqual(BOARD.textVars(undefined, tr, () => true), {});
});

test('the plate pops only the pieces that changed; the first board after a reset does not pop', () => {
  const zones = (tops) => [{ label: 'x', pieces: tops.map((top) => ({ top })) }];
  const first = BOARD.changedPieces(new Map(), zones(['1', '2']));
  assert.equal(first.changed.size, 0);
  const next = BOARD.changedPieces(first.next, zones(['1', '5', '9']));
  assert.deepEqual([...next.changed].sort(), ['0:1', '0:2']);
  assert.equal(BOARD.changedPieces(next.next, zones(['1', '5', '9'])).changed.size, 0);
  assert.equal(BOARD.changedPieces(next.next, [{ label: 'x', pieces: [{ top: '1' }, { top: '5', down: true }, { top: '9' }] }]).changed.size, 1);
});

test('the choice bar shows up to four buttons, then only the cursor between arrows', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ key: String(i + 1), label: `o${i}` }));
  assert.equal(BOARD.visibleChoices(items(2), 1).compact, false);
  assert.equal(BOARD.visibleChoices(items(4), 3).items.length, 4);
  const c = BOARD.visibleChoices(items(7), 5);
  assert.deepEqual([c.compact, c.items.length, c.first, c.items[0].label], [true, 1, 5, 'o5']);
  assert.equal(BOARD.visibleChoices(items(7), 99).first, 6, 'the cursor is clamped');
});

test('the Tally Sheet shows the last few lines and knows which are new', () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ r: i + 1, tag: 'T', text: `l${i}`, cls: i === 2 ? 'math' : 'r' }));
  const w = SHEET.sheetWindow(lines, 5);
  assert.equal(w.rows.length, SHEET.SHOWN_ROWS);
  assert.deepEqual(w.rows.map((r) => r.text), ['l3', 'l4', 'l5', 'l6', 'l7']);
  assert.deepEqual(w.rows.map((r) => r.fresh), [false, false, true, true, true]);
  assert.equal(w.fresh, 3);
  assert.equal(w.clues, 1);
  assert.equal(SHEET.sheetWindow(lines, 8).fresh, 0, 'all read');
  assert.equal(SHEET.sheetWindow(lines, 99).fresh, 0, 'a stale count never goes negative');
  assert.equal(SHEET.sheetWindow([], 0).rows.length, 0);
});

test('seat: the rival\'s hips land on the cushion and over the chair, for every rival height', () => {
  for (const h of [1.6, 1.72, 1.76, 1.8, 1.84, 1.86]) {
    const r = SEAT.seatedRoot(h, SEAT.RIVAL_CHAIR_Z, 1);
    const hipY = r.y + 0.2961 * h, contactY = hipY - 0.0397 * h, hipZ = r.z - 0.1812 * h;
    assert.ok(Math.abs(contactY - SEAT.CHAIR_TOP) < 0.012, `height ${h}: seat contact ${contactY}`);
    assert.ok(Math.abs(hipZ - SEAT.RIVAL_CHAIR_Z) < 0.05, `height ${h}: hips ${hipZ} over the chair`);
  }
  const tall = SEAT.seatedRoot(2.0, SEAT.RIVAL_CHAIR_Z, 1);
  assert.equal(tall.y, 0, 'a very tall sitter stays on the floor');
  const me = SEAT.seatedRoot(1.75, SEAT.PLAYER_CHAIR_Z, -1);
  assert.ok(me.z < SEAT.PLAYER_CHAIR_Z && me.z > SEAT.PLAYER_CHAIR_Z - 0.4, 'the player\'s root stands in front of the chair, towards the table');
  // the torso clears the rim: hip + 0.14 m of belly stays behind the felt edge
  const r = SEAT.seatedRoot(1.76, SEAT.RIVAL_CHAIR_Z, 1);
  assert.ok(r.z - 0.1812 * 1.76 + 0.14 <= -SEAT.TABLE_R + 0.02, 'the rival sits back from the table edge');
});

test('seat camera: the rival\'s head sits under the HUD banner, the felt fills the middle, nothing is cut off, at 16:9 and 21:9', () => {
  for (const aspect of [16 / 9, 21 / 9]) {
    const cam = new THREE.PerspectiveCamera(SEAT.SEAT_FOV, aspect, 0.05, 60);
    cam.position.set(...SEAT.SEAT_EYE);
    cam.lookAt(...SEAT.SEAT_LOOK);
    cam.updateMatrixWorld();
    const line = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(cam); return { x: p.x, y: 112.5 - p.y * 112.5 }; };   // the 225-line screen
    const head = line(0, 1.3, -0.66), far = line(0, 0.74, -SEAT.TABLE_R), near = line(0, 0.74, SEAT.TABLE_R);
    assert.ok(head.y > 34 && head.y < 62 && Math.abs(head.x) < 0.2, `rival head at line ${head.y.toFixed(0)}`);
    assert.ok(far.y > 85 && far.y < 120, `far rim at line ${far.y.toFixed(0)}`);
    assert.ok(near.y > 150 && near.y < 224, `near rim at line ${near.y.toFixed(0)}`);
  }
});
