// Unit tests for the Hollow Door (src/game/hollow/rules.ts) and the Lords' Table pure rules (src/machines/lordstable/rules.ts).
// Covers the odds (Ash exactly 50/50 without re-spins, Ledgers 60/40, spins cost a Ticket), the Mirrors cheat (clues, the
// safe click, the calls and the owed pull), a detective bot that is always right, determinism, the Door's triggers and
// once-per-run gating, the run effects, and EN/TR string parity for both modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let R, H, HS, MS, PT, createRng, def, validateDef;
before(async () => {
  R = await load('src/machines/lordstable/rules.ts');
  H = await load('src/game/hollow/rules.ts');
  HS = (await load('src/game/hollow/run.strings.ts')).default;
  MS = (await load('src/machines/lordstable/strings.ts')).STRINGS;
  PT = await load('src/core/ui/manga/portrait.ts');
  createRng = (await load('src/core/rng.ts')).createRng;
  ({ validateDef } = await load('src/machines/_base/registry.ts'));
  ({ def } = await load('src/machines/lordstable/index.ts'));
});

const N = 20000;
const rate = (n, fn) => { let k = 0; for (let i = 0; i < n; i++) if (fn(i)) k++; return k / n; };
/** A scripted rng for exact sequences: `chance` and `int` are all the rules draw from in these tests. */
const scripted = (chance, int) => ({ chance: () => chance, int: (a) => int ?? a, next: () => 0.5, shuffle: (a) => a });

// ── odds ──────────────────────────────────────────────────────────────────────────────────────

test('Lord of Ash is exactly 50/50 with no re-spins', () => {
  const rng = createRng('ash-odds');
  const p = rate(N, () => R.simulate('ash', rng, R.NEVER).outcome === 'taken');
  assert.ok(Math.abs(p - 0.5) < 0.012, `player taken ${p}`);
});

test('Lord of Ledgers (two bullets) takes the player 60% of the time: the first bullet lands on an even offset 9 times in 15', () => {
  const rng = createRng('ledgers-odds');
  const p = rate(N, () => R.simulate('ledgers', rng, R.NEVER).outcome === 'taken');
  assert.ok(Math.abs(p - 0.6) < 0.015, `player taken ${p}`);
});

test('spin-again leaves Ash near 50/50 and costs one Ticket per spin', () => {
  const rng = createRng('ash-spin');
  const p = rate(N, () => R.simulate('ash', rng, R.SPINNER, 50).outcome === 'taken');
  assert.ok(Math.abs(p - 0.5) < 0.02, `spinner taken ${p}`);
  const g = R.newGame('ash', scripted(false, 3), 2);
  const before = g.hammer;
  const ev = R.respin(g, scripted(false, 3));
  assert.equal(g.tickets, 1);
  assert.equal(g.hammer, (before + 3) % 6);
  assert.equal(ev[0].k, 'spin');
  assert.equal(ev[0].clicks, 3);
  R.respin(g, scripted(false, 3));
  assert.equal(R.respin(g, scripted(false, 3)), null, 'no Tickets left, no spin');
});

test('the cylinder holds the right number of bullets for each Lord', () => {
  const rng = createRng('bullets');
  assert.equal(R.newGame('ash', rng, 0).loaded.filter(Boolean).length, 1);
  assert.equal(R.newGame('ledgers', rng, 0).loaded.filter(Boolean).length, 2);
  assert.equal(R.newGame('mirrors', rng, 0).loaded.filter(Boolean).length, 1);
  assert.equal(R.newGame('mirrors', rng, 0).loaded.length, 6);
});

// ── the Mirrors cheat ─────────────────────────────────────────────────────────────────────────

test('Lord of Mirrors fakes about half of his announced spins, and the clues always say which', () => {
  const rng = createRng('mirror-clues');
  let fake = 0;
  for (let i = 0; i < N; i++) {
    const g = R.newGame('mirrors', rng, 0);
    g.turn = R.LORD;
    const ev = R.lordTurn(g, rng);
    assert.equal(ev.length, 1);
    const clue = g.pending;
    if (g.cheat) {
      fake++;
      assert.deepEqual(clue, { clicks: 0, reflect: false });
    } else {
      assert.ok(clue.clicks >= 1 && clue.clicks <= 6, 'an honest spin clicks 1..6');
      assert.equal(clue.reflect, true);
    }
  }
  assert.ok(Math.abs(fake / N - R.MIRROR_CHEAT_P) < 0.012, `fake rate ${fake / N}`);
});

test('a faked spin keeps the hammer on the chamber just clicked, so the Lord can only click', () => {
  const rng = createRng('mirror-safe');
  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    const g = R.newGame('mirrors', rng, 0);
    g.turn = R.LORD;
    g.loaded.fill(false);
    g.loaded[5] = true;                              // the one bullet: the Lord can only ever be shot at 5
    g.hammer = 2;
    R.lordTurn(g, rng);
    if (!g.cheat) continue;
    checked++;
    assert.equal(g.hammer, 1, 'the hammer rewinds to the chamber just clicked');
    const ev = R.lordPull(g);
    assert.equal(ev.find((e) => e.k === 'pull').fired, false);
  }
  assert.ok(checked > 1500);
});

test('a correct CHEAT call wins at once and restores a Soul Mark; a wrong call owes a second pull', () => {
  const stubCheat = scripted(true);
  const g = R.newGame('mirrors', stubCheat, 0);
  g.turn = R.LORD;
  R.lordTurn(g, stubCheat);
  assert.equal(g.cheat, true);
  const ev = R.call(g);
  assert.equal(ev.find((e) => e.k === 'over').calledCorrect, true);
  assert.equal(g.over.outcome, 'won');
  assert.equal(R.lordPull(g), null, 'the duel is over, the Lord never pulls');

  // a wrong call: the Lord's spin was honest (clicks 1), the player owes one extra pull
  const w = R.newGame('mirrors', scripted(false, 1), 0);
  w.loaded.fill(false); w.loaded[5] = true; w.hammer = 0; w.turn = R.PLAYER;
  const rng = scripted(false, 1);
  assert.equal(R.playerPull(w)[0].fired, false);                  // chamber 0 clicks, Lord's turn
  assert.equal(w.turn, R.LORD);
  R.lordTurn(w, rng);
  assert.equal(w.cheat, false);
  const wrong = R.call(w);
  assert.equal(wrong[0].correct, false);
  assert.equal(w.owed, 1);
  R.lordPull(w);
  assert.equal(w.turn, R.PLAYER);
  assert.equal(R.playerPull(w)[0].fired, false);
  assert.equal(w.turn, R.PLAYER, 'the owed pull keeps the turn with the player');
  assert.equal(R.playerPull(w)[0].fired, false);
  assert.equal(w.turn, R.LORD, 'two pulls in a row, then the Lord');
});

test('a detective bot that calls only on the clues is always right, and wins more than one that never calls', () => {
  const rng = createRng('detective');
  const calls = [];
  let detTaken = 0, neverTaken = 0;
  for (let i = 0; i < 6000; i++) {
    const d = R.simulate('mirrors', rng, R.DETECTIVE);
    calls.push(...d.calls);
    if (d.outcome === 'taken') detTaken++;
    if (R.simulate('mirrors', rng, R.NEVER).outcome === 'taken') neverTaken++;
  }
  assert.ok(calls.length > 1000, 'the detective made calls');
  assert.ok(calls.every((right) => right === true), 'every detective call is right');
  assert.ok(detTaken / 6000 < neverTaken / 6000 - 0.1, `detective taken ${detTaken / 6000} vs never ${neverTaken / 6000}`);
});

test('a bot that calls at random is right about half of the time', () => {
  const rng = createRng('naive');
  const coin = createRng('coin');
  const naive = { spin: () => false, call: () => coin.chance(0.5) };
  const calls = [];
  for (let i = 0; i < 6000; i++) calls.push(...R.simulate('mirrors', rng, naive).calls);
  const right = calls.filter(Boolean).length / calls.length;
  assert.ok(Math.abs(right - 0.5) < 0.03, `naive right ${right}`);
});

// ── determinism ───────────────────────────────────────────────────────────────────────────────

test('the same seed plays the same duels, for every Lord and policy', () => {
  for (const lord of ['ash', 'ledgers', 'mirrors']) {
    for (const policy of [R.NEVER, R.DETECTIVE, R.SPINNER]) {
      const a = [], b = [];
      const ra = createRng(`det-${lord}`), rb = createRng(`det-${lord}`);
      for (let i = 0; i < 200; i++) {
        a.push(R.simulate(lord, ra, policy, 2));
        b.push(R.simulate(lord, rb, policy, 2));
      }
      assert.equal(JSON.stringify(a), JSON.stringify(b));
    }
  }
});

// ── the Hollow Door ───────────────────────────────────────────────────────────────────────────

const plate = { onPlate: true, lastCall: true, night: 2 };

test('three knocks within 4 s on the plate reveal the door, in Last Call from Night 2 only', () => {
  let s = H.initDoor();
  let r = H.knock(s, 10, plate); assert.equal(r.revealed, false); s = r.state;
  r = H.knock(s, 11, plate); assert.equal(r.revealed, false); s = r.state;
  r = H.knock(s, 12.5, plate);
  assert.equal(r.revealed, true);
  assert.equal(r.state.status, 'open');
  assert.equal(r.state.trigger, 'knock');

  // three knocks spread over more than 4 s do not count
  s = H.initDoor();
  s = H.knock(s, 0, plate).state; s = H.knock(s, 2, plate).state;
  r = H.knock(s, 5, plate);
  assert.equal(r.revealed, false);
  assert.equal(r.state.status, 'hidden');

  // wrong place, wrong time, too early: ignored
  for (const bad of [{ ...plate, onPlate: false }, { ...plate, lastCall: false }, { ...plate, night: 1 }]) {
    let t = H.initDoor();
    for (const x of [1, 1.5, 2]) t = H.knock(t, x, bad).state;
    assert.equal(t.status, 'hidden');
    assert.deepEqual(t.knocks, []);
  }
});

test('the phone rings only at 3:33 with no caller; go down opens it; hanging up spends the phone', () => {
  const clock = { hour: 3, minute: 33 };
  let s = H.ring(H.initDoor(), clock, false);
  assert.equal(s.status, 'ringing');
  assert.equal(H.ring(H.initDoor(), clock, true).status, 'hidden', 'a real caller does not ring the door');
  assert.equal(H.ring(H.initDoor(), { hour: 3, minute: 32 }, false).status, 'hidden');
  const down = H.answer(s, 'godown');
  assert.equal(down.status, 'open');
  assert.equal(down.trigger, 'phone');
  const hung = H.answer(s, 'hangup');
  assert.equal(hung.status, 'hidden');
  assert.equal(hung.phoneSpent, true);
  assert.equal(H.ring(hung, clock, false).status, 'hidden', 'a spent phone never rings again');
  assert.equal(H.knock(hung, 1, plate).state.knocks.length, 1, 'the knock trigger stays possible after a hang-up');
});

test('a refused loan with an empty pocket opens the seam; otherwise nothing happens', () => {
  assert.equal(H.loanRefused(H.initDoor(), 5, true).status, 'hidden');
  assert.equal(H.loanRefused(H.initDoor(), 0, false).status, 'hidden');
  const s = H.loanRefused(H.initDoor(), 0, true);
  assert.equal(s.status, 'open');
  assert.equal(s.trigger, 'loan');
});

test('the door opens once per run: every trigger after a reveal is a no-op, and the door seals after the duel', () => {
  let s = H.reveal(H.initDoor(), 'knock');
  assert.equal(H.reveal(s, 'phone'), s, 'a second reveal changes nothing');
  s = H.enter(s);
  assert.equal(s.status, 'underneath');
  assert.equal(H.pickLord(s, 'nobody').status, 'underneath', 'an unknown Lord is refused');
  s = H.pickLord(s, 'mirrors');
  assert.equal(s.status, 'duel');
  assert.equal(s.lord, 'mirrors');
  s = H.finish(s, 'taken');
  assert.equal(s.status, 'used');
  assert.equal(s.ended, 'taken');
  assert.equal(H.reveal(s, 'loan'), s);
  assert.equal(H.isAlive(s), false);
});

test('walking out of the Underneath without playing closes the door; dawn closes an unentered door', () => {
  const left = H.leave(H.enter(H.reveal(H.initDoor(), 'loan')));
  assert.equal(left.status, 'closed');
  assert.equal(left.ended, 'left');
  const dawned = H.dawn(H.reveal(H.initDoor(), 'knock'));
  assert.equal(dawned.status, 'closed');
  assert.equal(H.isAlive(dawned), false);
  assert.equal(H.isAlive(H.initDoor()), true);
});

test('run effects: a win forgives the Night (Ledgers: and the next), a correct call restores a mark, being taken ends the run and banks Obols x1.5', () => {
  assert.deepEqual(H.effectsOf('won', 'ash'), [{ k: 'forgiveQuota', nights: 1 }]);
  assert.deepEqual(H.effectsOf('won', 'ledgers'), [{ k: 'forgiveQuota', nights: 2 }]);
  assert.deepEqual(H.effectsOf('won', 'mirrors', true), [{ k: 'forgiveQuota', nights: 1 }, { k: 'restoreSoulMark' }]);
  assert.deepEqual(H.effectsOf('won', 'mirrors', false), [{ k: 'forgiveQuota', nights: 1 }]);
  assert.deepEqual(H.effectsOf('taken', 'ash'), [{ k: 'bankObols', mult: 1.5 }, { k: 'takeRun' }]);
  assert.deepEqual(H.effectsOf('left', null), []);

  const calls = [];
  H.applyEffects(H.effectsOf('taken', 'ash'), {
    forgiveQuota: (n) => calls.push(['forgive', n]),
    takeRun: () => calls.push(['take']),
    restoreSoulMark: () => calls.push(['restore']),
    bankObols: (m) => calls.push(['bank', m]),
  });
  assert.deepEqual(calls, [['bank', 1.5], ['take']]);
});

// ── strings and wiring ────────────────────────────────────────────────────────────────────────

test('the lordstable and hollow strings have the same keys in EN and TR, and no empty value', () => {
  assert.deepEqual(Object.keys(MS.en).sort(), Object.keys(MS.tr).sort());
  assert.deepEqual(Object.keys(HS.en).sort(), Object.keys(HS.tr).sort());
  for (const set of [MS.en, MS.tr, HS.en, HS.tr]) for (const [k, v] of Object.entries(set)) assert.ok(String(v).trim().length > 0, k);
});

test('the three Lords have their own portraits', () => {
  for (const id of ['lord_ash', 'lord_ledgers', 'lord_mirrors']) {
    assert.ok(PT.hasPortrait(id), id);
    assert.ok(PT.PORTRAIT_IDS.includes(id), id);
    assert.notEqual(PT.portraitSpec(id), PT.portraitSpec('you'));
  }
});

test('the lordstable machine definition is valid for the registry', () => {
  assert.deepEqual(validateDef(def, 'lordstable'), []);
  assert.equal(def.seats, 2);
  assert.equal(def.shared, true);
});
