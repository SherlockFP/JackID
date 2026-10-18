// Tests for the Evening's visitor (src/game/home/knock.ts, strings in knock.strings.ts, Heat inputs in phone.ts): the roll by
// Heat, the telegraph timing, each counter's pass and fail, the tolls and their caps, Calm timing, the save / restore round trip
// (a visitor caught mid-act is a fail), the charm the Picker takes, the Heat inputs and the strings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let K, PH, EV, STR;
before(async () => {
  K = await load('src/game/home/knock.ts');
  PH = await load('src/game/home/phone.ts');
  EV = await load('src/core/events.ts');
  STR = (await load('src/game/home/knock.strings.ts')).default;
});

/** A recording KnockIO. */
function mockIO() {
  const log = [];
  const io = {
    footstep: (i, n, leaving) => log.push(['footstep', i, n, leaving]),
    shadow: (on) => log.push(['shadow', on]),
    knock: () => log.push(['knock']),
    shove: (i) => log.push(['shove', i]),
    chainRattle: () => log.push(['chain']),
    scrape: () => log.push(['scrape']),
    crack: (open) => log.push(['crack', open]),
    caption: (key) => log.push(['caption', key]),
    resolve: (r) => log.push(['resolve', r]),
  };
  return { io, log, count: (k) => log.filter((e) => e[0] === k).length, results: () => log.filter((e) => e[0] === 'resolve').map((e) => e[1]) };
}

const DARK_STILL = { lights: false, chain: false, moved: false, looking: false };
/** Runs the visit for `sec` sim seconds in 0.1 s steps; `inp` may be a function of the visit clock. */
function run(v, sec, inp = DARK_STILL) {
  for (let t = 0; t < Math.round(sec * 10); t++) v.tick(0.1, typeof inp === 'function' ? inp(v.state) : inp);
}
/** A visit started and walked to the beginning of its act. */
function atAct(kind, calm = false) {
  const m = mockIO();
  const st = K.newVisit(2, { kind, at: 12 }, calm);
  const v = K.createVisit(st, m.io);
  for (let i = 0; i < 1000 && st.phase !== 'act'; i++) v.tick(0.1, DARK_STILL);
  assert.equal(st.phase, 'act');
  return { m, st, v };
}

// ── the roll ──────────────────────────────────────────────────────────────────────────────────────────
test('kindForHeat bands: 0-1 none, 2-3 listener, 4 leaner, 5-6 picker', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((h) => K.kindForHeat(h)), [null, null, 'listener', 'listener', 'leaner', 'picker', 'picker']);
});

test('rollVisit: no visitor on Night 1 or at Heat 0-1; kind by band; chance per band; arrival 12-25 s', () => {
  for (let s = 1; s <= 200; s++) {
    assert.equal(K.rollVisit(s, 1, 6), null, 'Night 1 has no visitor');
    assert.equal(K.rollVisit(s, 3, 0), null);
    assert.equal(K.rollVisit(s, 3, 1), null);
  }
  const rate = (heat, kind) => {
    let hit = 0;
    const N = 3000;
    for (let s = 1; s <= N; s++) {
      const r = K.rollVisit(s, 4, heat);
      if (r) {
        hit++;
        assert.equal(r.kind, kind);
        assert.ok(r.at >= 12 && r.at <= 25, `arrival ${r.at}`);
      }
    }
    return hit / N;
  };
  assert.ok(Math.abs(rate(2, 'listener') - 0.6) < 0.05);
  assert.ok(Math.abs(rate(3, 'listener') - 0.6) < 0.05);
  assert.ok(Math.abs(rate(4, 'leaner') - 0.75) < 0.05);
  assert.ok(Math.abs(rate(5, 'picker') - 0.9) < 0.05);
  assert.ok(Math.abs(rate(6, 'picker') - 0.9) < 0.05);
});

test('rollVisit is seeded: the same (seed, Night, Heat) gives the same visit; Nights differ', () => {
  assert.deepEqual(K.rollVisit(7, 3, 6), K.rollVisit(7, 3, 6));
  const nights = new Set();
  for (let n = 2; n < 40; n++) nights.add(JSON.stringify(K.rollVisit(7, n, 6)));
  assert.ok(nights.size > 5);
});

// ── tolls ─────────────────────────────────────────────────────────────────────────────────────────────
test('tollOf: a share of the pocket, at least 1, at most a quarter of the quota, never more than the pocket', () => {
  assert.equal(K.tollOf(0.08, 100, 200), 8);
  assert.equal(K.tollOf(0.15, 100, 200), 15);
  assert.equal(K.tollOf(0.2, 100, 200), 20);
  assert.equal(K.tollOf(0.08, 5, 200), 1, 'min 1');
  assert.equal(K.tollOf(0.2, 1000, 100), 25, 'capped at quota * 0.25');
  assert.equal(K.tollOf(0.2, 1000, 2), 1, 'a tiny quota still allows 1');
  assert.equal(K.tollOf(0.2, 0, 100), 0, 'an empty pocket pays nothing');
  assert.equal(K.tollOf(0, 100, 100), 0);
  assert.equal(K.tollOf(0.5, 3, 1000), 2);
});

test('resultOf: each counter and its failure', () => {
  assert.deepEqual(K.resultOf('listener', true), { kind: 'listener', pass: true, heat: -1, harmony: 0, tollPct: 0, steal: false });
  assert.deepEqual(K.resultOf('listener', false), { kind: 'listener', pass: false, heat: 1, harmony: 0, tollPct: 0.08, steal: false });
  assert.deepEqual(K.resultOf('leaner', true), { kind: 'leaner', pass: true, heat: 0, harmony: -1, tollPct: 0, steal: false });
  assert.deepEqual(K.resultOf('leaner', false), { kind: 'leaner', pass: false, heat: 1, harmony: -1, tollPct: 0.15, steal: false });
  assert.deepEqual(K.resultOf('picker', true), { kind: 'picker', pass: true, heat: -1, harmony: 0, tollPct: 0, steal: false });
  assert.deepEqual(K.resultOf('picker', false), { kind: 'picker', pass: false, heat: 1, harmony: 0, tollPct: 0.2, steal: true });
});

test('pickCharm: seeded, never legendary or cursed, null with nothing to take', () => {
  const owned = [{ id: 'a', rarity: 'common' }, { id: 'b', rarity: 'legendary' }, { id: 'c', rarity: 'cursed' }, { id: 'd', rarity: 'rare' }];
  const seen = new Set();
  for (let s = 1; s < 60; s++) {
    const id = K.pickCharm(s, 3, owned);
    assert.ok(id === 'a' || id === 'd', id);
    seen.add(id);
    assert.equal(K.pickCharm(s, 3, owned), id);
  }
  assert.equal(seen.size, 2, 'both candidates come up across seeds');
  assert.equal(K.pickCharm(1, 3, [{ id: 'b', rarity: 'legendary' }]), null);
  assert.equal(K.pickCharm(1, 3, []), null);
});

// ── the telegraph ─────────────────────────────────────────────────────────────────────────────────────
test('telegraph: nothing before the arrival, then footsteps, then the shadow, then the act', () => {
  const m = mockIO();
  const st = K.newVisit(2, { kind: 'listener', at: 15 }, false);
  const v = K.createVisit(st, m.io);
  run(v, 14.9);
  assert.equal(st.phase, 'wait');
  assert.equal(m.log.length, 0);
  assert.equal(v.atDoor(), false);
  run(v, 0.3);
  assert.equal(st.phase, 'steps');
  assert.ok(v.atDoor());
  assert.ok(m.log.some((e) => e[0] === 'caption' && e[1] === 'steps'), 'a subtitle twin for the footsteps');
  assert.equal(m.count('shadow'), 0, 'sound first, light second');
  run(v, K.STEP_N * K.STEP_GAP);
  assert.equal(m.count('footstep'), K.STEP_N);
  assert.deepEqual(m.log.find((e) => e[0] === 'shadow'), ['shadow', true]);
  assert.ok(m.log.some((e) => e[0] === 'caption' && e[1] === 'arrive.listener'));
  assert.equal(st.phase, 'act');
  assert.ok(v.acting());
});

// ── the Listener ──────────────────────────────────────────────────────────────────────────────────────
test('listener: dark and still for 8 s passes (Heat -1, no toll)', () => {
  const { m, st, v } = atAct('listener');
  run(v, 7.8);
  assert.equal(m.results().length, 0);
  run(v, 0.4);
  const [r] = m.results();
  assert.equal(r.pass, true);
  assert.equal(r.heat, -1);
  assert.equal(r.tollPct, 0);
  assert.equal(st.phase, 'leave');
});

test('listener: lights on or any movement restarts the stretch; 12 s without 8 clean seconds is a fail', () => {
  const a = atAct('listener');
  run(a.v, 6);
  a.v.tick(0.1, { ...DARK_STILL, moved: true });   // a step on the boards
  assert.equal(a.st.hold, 0);
  run(a.v, 5);   // 11.1 s in: only 5 s clean since the slip
  assert.equal(a.m.results().length, 0);
  run(a.v, 1);
  const [r] = a.m.results();
  assert.equal(r.pass, false);
  assert.equal(r.heat, 1);
  assert.equal(r.tollPct, 0.08);
  assert.ok(a.m.log.some((e) => e[0] === 'caption' && e[1] === 'listener.slip'), 'the slip under the door has a subtitle');

  const b = atAct('listener');
  run(b.v, 20, { ...DARK_STILL, lights: true });
  assert.equal(b.m.results()[0].pass, false, 'the light on all along fails');
});

test('listener: the look through the peephole costs time but does not break the stillness', () => {
  const { m, v } = atAct('listener');
  run(v, 3);
  run(v, 2.5, { ...DARK_STILL, looking: true });   // the look: the hold does not advance, and does not reset
  run(v, 5.1);
  assert.equal(m.results()[0].pass, true, '3 + 5.1 clean seconds >= 8 inside 12 s');
});

// ── the Leaner ────────────────────────────────────────────────────────────────────────────────────────
test('leaner: knock, then shoves at 2, 4, 6 s', () => {
  const { m, v } = atAct('leaner');
  run(v, 0.2);
  assert.equal(m.count('knock'), 1);
  run(v, 1.9);
  assert.equal(m.count('shove'), 1);
  run(v, 2);
  assert.equal(m.count('shove'), 2);
});

test('leaner: the chain on before the second shove sends him away (Heat unchanged, Harmony -1, no toll)', () => {
  const { m, st, v } = atAct('leaner');
  run(v, 3, { ...DARK_STILL, chain: false });
  run(v, 1.2, { ...DARK_STILL, chain: true });   // chained between the first and second shove
  const [r] = m.results();
  assert.equal(r.pass, true);
  assert.equal(r.heat, 0);
  assert.equal(r.harmony, -1);
  assert.equal(r.tollPct, 0);
  assert.equal(m.count('shove'), 2, 'he gives up after the second shove');
  assert.equal(st.latched, true);
  assert.equal(m.count('crack'), 0);
});

test('leaner: chain off at the second shove, the third cracks the door 10 cm (toll 15 %, Heat +1, Harmony -1)', () => {
  const { m, st, v } = atAct('leaner');
  run(v, 4.2);
  assert.equal(st.latched, false);
  assert.equal(m.results().length, 0, 'the verdict waits for the third shove');
  run(v, 2);
  const [r] = m.results();
  assert.deepEqual([r.pass, r.heat, r.harmony, r.tollPct], [false, 1, -1, 0.15]);
  assert.deepEqual(m.log.find((e) => e[0] === 'crack'), ['crack', true]);
  assert.ok(K.CRACK_AMOUNT > 0.05 && K.CRACK_AMOUNT < 0.12);
  // he lingers, then the door is pushed shut and the shadow goes
  run(v, K.LEAVE_HOLD + 0.2);
  assert.ok(m.log.some((e) => e[0] === 'crack' && e[1] === false));
  assert.ok(m.log.some((e) => e[0] === 'shadow' && e[1] === false));
  assert.equal(st.out, true);
});

test('leaner: the chain put on after the second shove is too late', () => {
  const { m, v } = atAct('leaner');
  run(v, 4.2, { ...DARK_STILL, chain: false });
  run(v, 2, { ...DARK_STILL, chain: true });
  assert.equal(m.results()[0].pass, false);
});

// ── the Picker ────────────────────────────────────────────────────────────────────────────────────────
test('picker: scrapes for 10 s and is judged at the end: chain on and lights off passes', () => {
  const { m, v } = atAct('picker');
  run(v, 9.8);
  assert.equal(m.results().length, 0);
  assert.ok(m.count('scrape') >= 7, `lock sounds ${m.count('scrape')}`);
  run(v, 0.4, { ...DARK_STILL, chain: true });
  const [r] = m.results();
  assert.deepEqual([r.pass, r.heat, r.tollPct, r.steal], [true, -1, 0, false]);
});

test('picker: the chain alone, or the dark alone, fails (toll 20 %, a charm, Heat +1)', () => {
  const a = atAct('picker');
  run(a.v, 10.2, { ...DARK_STILL, chain: true, lights: true });
  assert.deepEqual([a.m.results()[0].pass, a.m.results()[0].steal, a.m.results()[0].tollPct, a.m.results()[0].heat], [false, true, 0.2, 1]);
  const b = atAct('picker');
  run(b.v, 10.2, { ...DARK_STILL, chain: false, lights: false });
  assert.equal(b.m.results()[0].pass, false);
});

test('picker: only the state at the end counts (fixing it mid-scrape is enough)', () => {
  const { m, v } = atAct('picker');
  run(v, 6, { ...DARK_STILL, chain: false, lights: true });
  run(v, 4.2, { ...DARK_STILL, chain: true, lights: false });
  assert.equal(m.results()[0].pass, true);
});

// ── Calm ──────────────────────────────────────────────────────────────────────────────────────────────
test('calm mode stretches every timer by 1.5', () => {
  assert.equal(K.CALM_SCALE, 1.5);
  const m = mockIO();
  const st = K.newVisit(2, { kind: 'picker', at: 12 }, true);
  assert.equal(st.k, 1.5);
  const v = K.createVisit(st, m.io);
  run(v, 12 + K.STEP_N * K.STEP_GAP * 1.5 - 0.3);
  assert.equal(st.phase, 'steps', 'the approach takes 1.5 times as long');
  run(v, 0.5);
  assert.equal(st.phase, 'act');
  run(v, 14.8, { ...DARK_STILL, chain: true });
  assert.equal(m.results().length, 0, 'the scrape is 15 s');
  run(v, 0.4, { ...DARK_STILL, chain: true });
  assert.equal(m.results()[0].pass, true);

  const l = atAct('listener', true);
  run(l.v, 11.8);
  assert.equal(l.m.results().length, 0, 'the Listener needs 12 s of calm stillness');
  run(l.v, 0.4);
  assert.equal(l.m.results()[0].pass, true);

  const n = atAct('leaner', true);
  run(n.v, 2.5);
  assert.equal(n.m.count('shove'), 0, 'the first shove comes at 3 s');
  run(n.v, 0.7);
  assert.equal(n.m.count('shove'), 1);
});

// ── bed block, abandon, save / restore ────────────────────────────────────────────────────────────────
test('atDoor: the bed is blocked from the footsteps to the end of the leaving', () => {
  const { v, st } = atAct('listener');
  assert.ok(v.atDoor());
  run(v, 8.2);
  assert.equal(st.phase, 'leave');
  assert.ok(v.atDoor());
  run(v, 4);
  assert.equal(st.phase, 'done');
  assert.equal(v.atDoor(), false);
  assert.ok(v.finished());
});

test('abandon: an act still running is a fail, and a waiting visit resolves as a fail too (wave 72)', () => {
  const a = atAct('listener');
  a.v.abandon();
  assert.equal(a.m.results()[0].pass, false);
  assert.equal(a.st.phase, 'done');
  const m = mockIO();
  const st = K.newVisit(2, { kind: 'picker', at: 20 }, false);
  const v = K.createVisit(st, m.io);
  run(v, 3);
  v.abandon();
  assert.equal(m.results().length, 1, 'the waiting visit resolves once');
  assert.equal(m.results()[0].pass, false, 'and it is a fail');
  assert.equal(st.phase, 'done');
});

test('save / restore: the state round-trips as JSON; a visit caught mid-act resolves as a fail', () => {
  const { st } = atAct('leaner');
  const copy = K.readVisit(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(copy, st);
  const m = mockIO();
  const v = K.createVisit(copy, m.io);
  v.resume();
  assert.equal(m.results().length, 1);
  assert.equal(m.results()[0].pass, false);
  assert.equal(copy.phase, 'done');

  // a walk in the hall starts over; a waiting visit keeps its clock; a leaving one is gone
  const m2 = mockIO();
  const w = K.newVisit(2, { kind: 'listener', at: 18 }, false);
  w.el = 9;
  const v2 = K.createVisit(K.readVisit(JSON.parse(JSON.stringify(w))), m2.io);
  v2.resume();
  assert.equal(v2.state.phase, 'wait');
  assert.equal(v2.state.el, 9);
  const s3 = K.newVisit(2, { kind: 'listener', at: 12 }, false);
  s3.phase = 'steps'; s3.t = 2; s3.n = 3; s3.el = 14;
  const v3 = K.createVisit(K.readVisit(JSON.parse(JSON.stringify(s3))), mockIO().io);
  v3.resume();
  assert.equal(v3.state.phase, 'wait');
  assert.ok(v3.state.el >= v3.state.at, 'the footsteps start again on the next step');
  const s4 = K.newVisit(2, { kind: 'picker', at: 12 }, false);
  s4.phase = 'leave'; s4.pass = true;
  const m4 = mockIO();
  const v4 = K.createVisit(s4, m4.io);
  v4.resume();
  assert.equal(m4.results().length, 0, 'the verdict was already applied before the save');
  assert.equal(s4.phase, 'done');
});

test('readVisit rejects damage and clamps numbers', () => {
  assert.equal(K.readVisit(null), null);
  assert.equal(K.readVisit('x'), null);
  assert.equal(K.readVisit({ kind: 'ghost', phase: 'act' }), null);
  assert.equal(K.readVisit({ kind: 'picker', phase: 'dancing' }), null);
  const ok = K.readVisit({ kind: 'picker', phase: 'act', t: -5, el: 1e9, k: 7, night: 'x' });
  assert.equal(ok.t, 0);
  assert.equal(ok.el, 600);
  assert.equal(ok.k, 1);
  assert.equal(ok.night, 1);
});

// ── Heat inputs in the phone ─────────────────────────────────────────────────────────────────────────
function mockRun(s = {}) {
  const st = { seed: 1, night: 3, watch: 0, count: 3, due: 100, paid: 0, coins: 500, carried: 0, phase: 'intermission', ...s };
  return {
    seed: st.seed, st,
    night: () => st.night,
    shift: { get phase() { return st.phase; }, state: () => ({ segment: { index: st.watch, count: st.count } }) },
    debt: () => ({ index: st.night - 1, due: st.due, paid: st.paid, deadlineAt: 0, floor: st.night, total: 8 }),
    nightLedger: () => ({ night: st.night, float: 0, interest: 0, tickets: 0, cut: 0, carried: st.carried }),
    wallet: () => st.coins,
    spend: (cur, n) => { if (cur !== 'coin' || n > st.coins) return false; st.coins -= n; return true; },
    buffs: { add: () => undefined },
    dread: () => 0.5,
  };
}
const tithe = (state = 'missed') => EV.bus.emit('run:tithe', { pid: 1, state, watch: 1, target: 10, earned: 0, shortfall: 5, tickets: 0 });

test('Heat inputs: a missed tithe is free the first time in a Night, then +1 each; a new Night starts over', () => {
  const run = mockRun();
  const phone = PH.createPhone(run);
  const seen = [];
  const off = EV.bus.on('home:heat', (e) => seen.push(e));
  try {
    tithe(); assert.equal(phone.heat(), 0);
    tithe(); assert.equal(phone.heat(), 1);
    tithe(); assert.equal(phone.heat(), 2);
    tithe('met');   // a met tithe does nothing
    assert.equal(phone.heat(), 2);
    run.st.night = 4;
    tithe(); assert.equal(phone.heat(), 2, 'the first miss of a new Night is free');
    tithe(); assert.equal(phone.heat(), 3);
    assert.deepEqual(seen.map((e) => [e.delta, e.why]), [[1, 'tithe'], [1, 'tithe'], [1, 'tithe']]);
  } finally { off(); phone.dispose(); }
});

test('Heat inputs: a rescue loan taken +1 (ring and lapse do nothing), breaking the seal +1 (the run calls the hook)', () => {
  const phone = PH.createPhone(mockRun());
  try {
    EV.bus.emit('run:rescue', { pid: 1, state: 'ring', coins: 0, quota: 0, due: 0 });
    EV.bus.emit('run:rescue', { pid: 1, state: 'lapsed', coins: 0, quota: 0, due: 0 });
    assert.equal(phone.heat(), 0);
    EV.bus.emit('run:rescue', { pid: 1, state: 'taken', coins: 20, quota: 10, due: 110 });
    assert.equal(phone.heat(), 1);
    PH.hooksOf(phone).heat(1, 'seal');
    assert.equal(phone.heat(), 2);
  } finally { phone.dispose(); }
});

test('Heat inputs: a thin margin +1, a quiet Night -1, and a counter relief does not spoil the quiet', () => {
  const run = mockRun({ carried: 3 });   // 3 % margin: thin
  const phone = PH.createPhone(run);
  try {
    phone.onEvening();
    assert.equal(phone.heat(), 1, 'thin margin');
    run.st.carried = 50;
    phone.onEvening();
    assert.equal(phone.heat(), 0, 'a quiet Night cools by one');
  } finally { phone.dispose(); }
  const p2 = PH.createPhone(mockRun({ carried: 50 }));
  try {
    PH.hooksOf(p2).heat(3, 'time');
    p2.onEvening();   // Heat rose since the last Evening: no cooling
    assert.equal(p2.heat(), 3);
    PH.hooksOf(p2).heat(-1, 'picker');   // relief only
    p2.onEvening();
    assert.equal(p2.heat(), 1, 'relief does not count as Heat moving: this quiet Night cools one more');
    PH.hooksOf(p2).heat(1, 'listener');   // a failed counter: a gain
    p2.onEvening();
    assert.equal(p2.heat(), 2, 'a gain spoils the quiet');
  } finally { p2.dispose(); }
});

test('the visit slice and the tithe count ride in the phone snapshot', () => {
  const run = mockRun();
  const phone = PH.createPhone(run);
  try {
    const st = K.newVisit(3, { kind: 'picker', at: 14.5 }, false);
    PH.hooksOf(phone).setVisit(st);
    st.phase = 'steps';   // live: the snapshot reads the object when it is taken
    tithe();
    const snap = JSON.parse(JSON.stringify(phone.snapshot()));
    assert.equal(snap.visit.phase, 'steps');
    assert.equal(snap.titheMisses, 1);
    const p2 = PH.createPhone(mockRun());
    p2.restore(snap);
    assert.deepEqual(K.readVisit(PH.hooksOf(p2).visit()), K.readVisit(st));
    tithe();
    p2.dispose();
  } finally { phone.dispose(); }
  // an old save has no visit
  const p3 = PH.createPhone(mockRun());
  p3.restore({ v: 2, harmony: 2, heat: 1 });
  assert.equal(PH.hooksOf(p3).visit(), null);
  p3.dispose();
});

test('hooks: Harmony nudges are clamped 0..5', () => {
  const phone = PH.createPhone(mockRun());
  try {
    PH.hooksOf(phone).harmony(-9);
    assert.equal(phone.harmony(), 0);
    PH.hooksOf(phone).harmony(9);
    assert.equal(phone.harmony(), 5);
  } finally { phone.dispose(); }
});

// ── strings ───────────────────────────────────────────────────────────────────────────────────────────
test('strings: EN and TR carry the same keys, every cue has a line, the toll has .one and .other, no empty text', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  for (const lang of ['en', 'tr']) {
    for (const [k, v] of Object.entries(STR[lang])) assert.ok(typeof v === 'string' && v.length > 3, `${lang} ${k}`);
    for (const key of ['toll.one', 'toll.other']) assert.ok(STR[lang][key], `${lang} ${key}`);
    for (const kind of K.VISITORS) {
      for (const key of [`arrive.${kind}`, `name.${kind}`, `peep.${kind}`]) assert.ok(STR[lang][key], `${lang} ${key}`);
    }
    for (const key of ['steps', 'leave', 'listener.gone', 'listener.slip', 'leaner.knock', 'leaner.shove', 'leaner.gone', 'leaner.crack', 'picker.scrape', 'picker.gone', 'picker.in', 'blocked', 'stolen', 'harmony']) {
      assert.ok(STR[lang][key], `${lang} ${key}`);
    }
  }
});

test('phone strings: the Heat chip toast keys exist in EN and TR', async () => {
  const P = (await load('src/game/home/phone.strings.ts')).default;
  for (const lang of ['en', 'tr']) for (const k of ['ui.heat.up', 'ui.heat.down']) assert.ok(P[lang][k] && P[lang][k].includes('{n}'), `${lang} ${k}`);
});
