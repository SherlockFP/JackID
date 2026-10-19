// The seat coach (src/machines/_base/coach.ts): step progression, the result note, per-profile progress, and the practice
// economy. A practice round on a solo machine (MachineBase) never touches the run (coins, pulls, quota, luck, heat,
// contracts, stats, bus events) and never moves the seeded round streams of paid play.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let C, MB, RUN, REG, R, EV, I18N;
before(async () => {
  C = await load('src/machines/_base/coach.ts');
  MB = await load('src/machines/_base/MachineBase.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  R = await load('src/core/rng.ts');
  EV = await load('src/core/events.ts');
  I18N = await load('src/core/i18n.ts');
  const s = (await load('src/machines/_base/coach.strings.ts')).default;
  I18N.registerStrings(s.prefix, { en: s.en, tr: s.tr });
  REG.load();
});

/** A fresh in-memory profile for each test (the module store is shared by the whole test process). */
function freshStore() {
  const m = new Map();
  C.setCoachStore({ get: (k) => m.get(k) ?? 0, set: (k, v) => { m.set(k, v); } });
  return m;
}
const S = (key, say, done) => ({ key, say, done });

test('coach: steps advance only on their own event, the gamble step shows only while the offer is live', () => {
  const store = freshStore();
  const c = new C.Coach('bigone', [S('primary', 'spin', 'round'), S('betUp', 'bet', 'bet'), S('auto', 'gamble', 'gamble')], true);
  assert.deepEqual(c.view().keys, ['primary']);
  c.bet();                                             // not this step's event
  c.press('betUp');
  assert.deepEqual(c.view().keys, ['primary']);
  c.press('confirm');                                  // a 'round' step ignores presses
  assert.deepEqual(c.view().keys, ['primary']);
  c.round(false);
  assert.deepEqual(c.view().keys, ['betUp']);
  assert.equal(store.get('coach.bigone'), 1, 'progress is saved per step');
  c.bet();
  assert.deepEqual(c.view().keys, [], 'the gamble step waits for an offer');
  assert.equal(c.view().line, '');
  c.offer(true);
  assert.deepEqual(c.view().keys, ['auto']);
  assert.ok(!c.done);
  c.offer(false);                                      // taken or let go
  assert.ok(c.done);
  assert.equal(new C.Coach('bigone', c.steps, true).done, true, 'a new sit on the same profile starts done');
});

test('coach: press steps match any of their keys, and Space / Enter count as one', () => {
  freshStore();
  const c = new C.Coach('hilo', [S('primary', 'deal', 'press'), S('up down n1 n2', 'hiLo', 'press'), S('', 'chips', 'round')], false);
  c.press('confirm');
  assert.deepEqual(c.view().keys, ['up', 'down', 'n1', 'n2']);
  c.press('left');
  assert.deepEqual(c.view().keys, ['up', 'down', 'n1', 'n2']);
  c.press('n2');
  assert.deepEqual(c.view().keys, [], 'a keyless step');
  assert.ok(c.view().line.length > 0, 'a keyless step still has its line');
});

test('coach: the result note waits for the show, names ×mult → gross or the loss, then gives way to the next step', () => {
  freshStore();
  const c = new C.Coach('bigone', [S('primary', 'spin', 'result'), S('betUp', 'bet', 'bet')], true);
  c.round(true);
  c.result(10, 2);
  c.tick(0.1, false);                                  // the show is still queued
  assert.deepEqual(c.view().keys, ['primary']);
  c.tick(0.1, true);
  const v = c.view();
  assert.deepEqual(v.keys, []);
  assert.match(v.line, /×5/);
  assert.match(v.line, /10/);
  assert.equal(v.tone, 'good');
  assert.ok(v.why.length > 0, 'the machine rule rides along');
  assert.match(v.tag, /1\/2/, 'the note of a practice round keeps its tag');
  c.tick(5, true);
  assert.deepEqual(c.view().keys, ['betUp'], 'after the note the next step shows');
  c.round(true);
  c.result(0, 2);
  c.tick(0.1, true);
  assert.equal(c.view().tone, 'bad');
  assert.equal(c.practice, false, 'two free plays used');
});

test('coach: practice count is per machine type and per profile', () => {
  const store = freshStore();
  const a = new C.Coach('plinko', [S('primary', 'drop', 'round')], true);
  assert.ok(a.practice);
  a.round(true); a.result(1, 1);
  assert.equal(store.get('practice.plinko'), 1);
  assert.equal(new C.Coach('plinko', a.steps, true).practiceUsed, 1, 'the next sit remembers it');
  assert.equal(new C.Coach('mines', a.steps, true).practiceUsed, 0, 'another machine type starts fresh');
  assert.equal(new C.Coach('roulette', a.steps, false).practice, false, 'tables never practise');
  freshStore();
  assert.equal(new C.Coach('plinko', a.steps, true).practiceUsed, 0, 'a new profile starts fresh');
});

// ── the practice economy, through the real MachineBase and a real run ─────────────────────────────────────────────────
function playingRun(seed) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.attachWorld({ machines: () => [{ instance: 'm-coinflip', machineId: 'coinflip' }], instancePos: () => undefined });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  return run;
}

function seatedProbe(run, runSeed) {
  class Probe extends MB.MachineBase {
    createModel() { throw new Error('not built in tests'); }
    present() {}
    /** One round: stake, one draw from the round stream, an extra stake, settle `gross`. Returns the draw. */
    async play(gross, extra = 0) {
      if (!this.beginRound(this.bet)) return null;
      const draw = this.rng.next();
      if (extra) assert.ok(this.addStake(extra));
      await this.emit({ k: 'r' }, () => this.settle({ gross }));
      return draw;
    }
  }
  const def = { ...REG.get('coinflip').def, coach: [S('primary', 'flip', 'round'), S('betUp', 'bet', 'bet')] };
  const ctx = {
    instanceId: 'm-coinflip', def, runSeed, run, events: EV.bus,
    net: {
      selfId: run.selfId, isHost: true, online: false, sendEvent() {}, sendPrivate() {}, requestRelease() {},
      hostTime: () => 0, players: () => [run.selfId],
    },
    ui: { machineHud() {}, toast() {}, root: null },
    input: { keyLabel: () => 'K' },
    audio: { play() {}, music: { setIntensity() {} } },
    timers: { wait: () => Promise.resolve() },
  };
  const m = new Probe(ctx);
  m.model = { root: new THREE.Group(), parts: {}, playPose: { pos: new THREE.Vector3(), look: new THREE.Vector3() }, colliders: [], interact: { min: [0, 0, 0], max: [1, 1, 1] }, anchors: {} };
  m._occupy(run.selfId, 0, 99, true);
  return m;
}

/** Everything the economy could move: coins, pulls, stats, quota, luck stars, heat, contracts, rounds. */
const ledger = (run) => JSON.stringify({
  coins: run.coins, pulls: run.pulls(), stats: run.stats, quota: run.quota, luck: run.luckStars(),
  heat: run.hPhone?.heat?.() ?? 0, contracts: run.contractList, rounds: run.rounds, plays: [...run.plays],
});

test('practice: two free plays change no coins, quota, luck, heat, contracts or stats, and emit no economy event', async () => {
  freshStore();
  const runSeed = 7;
  const run = playingRun(41);
  const m = seatedProbe(run, runSeed);
  const before = ledger(run);
  const seen = [];
  const emit = EV.bus.emit;
  EV.bus.emit = function (type, payload) { seen.push(String(type)); return emit.call(this, type, payload); };
  let d1, d2;
  try {
    d1 = await m.play(m.bet * 20, m.bet);              // a big practice win, with an extra stake
    m._step(0.1);
    d2 = await m.play(0);
    m._step(0.1);
  } finally { EV.bus.emit = emit; }
  assert.equal(ledger(run), before, 'the run is untouched');
  const economy = seen.filter((n) => /^(machine:|eco:|run:|luck:|home:|quota:|pulls:|contract|jackpot:|gamble:)/.test(n));
  assert.deepEqual(economy, [], `no economy events (saw ${[...new Set(seen)].join(', ')})`);
  assert.equal(m.roundNo, 0, 'the round counter (the paid streams) did not move');
  assert.equal(d1, R.createRng(R.hashSeed(runSeed, 'm-coinflip', 'practice', 0)).next(), 'practice draws from its own seeded stream');
  assert.equal(d2, R.createRng(R.hashSeed(runSeed, 'm-coinflip', 'practice', 1)).next());
  assert.equal(m.roundOpen, false);

  // the third play is paid: it costs coins and draws exactly what round 1 draws without any practice
  const coins = run.coins;
  const d3 = await m.play(0);
  assert.equal(d3, R.createRng(R.hashSeed(runSeed, 'm-coinflip', 1)).next(), 'the first paid round is the same as without practice');
  assert.equal(m.roundNo, 1);
  assert.ok(run.coins < coins, 'a paid play takes the stake');
  run.dispose();
});

test('seated focus: the state title over the big button steps aside when it only repeats the button', async () => {
  const H = await load('src/machines/_base/seatHud.ts');
  assert.equal(H.captionRepeats('ÇEVİR [BOŞLUK]', ['ÇEVİR']), true);
  assert.equal(H.captionRepeats('BİR YÜZ SEÇ, SONRA AT', ['AT']), false);
  assert.equal(H.captionRepeats('MAKARALAR DÖNÜYOR', []), false);
  assert.equal(H.captionRepeats('', ['ÇEVİR']), true);
});
