// THE CROOKED TABLE wired into the run (Wave 79 fix): the net amount reaches the table, a call pays the refund / takes the fee, the luck star
// and the Heat move, the Tally Sheet lines go out on the bus, Tamsin speaks once, and the key and strings exist.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, R, EV, KM, I18N, CT, WE, STR;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  R = await load('src/core/rng.ts');
  EV = await load('src/core/events.ts');
  KM = await load('src/core/keymap.ts');
  I18N = await load('src/core/i18n.ts');
  CT = await load('src/game/events/crookedTable.ts');
  WE = await load('src/game/watchEvents.ts');
  REG.load();
  STR = {};
  for (const rel of ['src/game/events/crookedTable.strings.ts', 'src/core/keymap.strings.ts', 'src/game/luck.strings.ts']) {
    const m = (await load(rel)).default;
    STR[m.prefix] = m;
    I18N.registerStrings(m.prefix, { en: m.en, tr: m.tr });
  }
});

const KINDS = ['coinflip', 'bigone', 'hilo', 'blackjack'];
const src = (machineId) => ({ mid: `m-${machineId}`, machineId });

function playingWithFloor(seed = 5) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.attachWorld({ machines: () => KINDS.map((k) => ({ instance: `m-${k}`, machineId: k })), instancePos: () => undefined });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  return run;
}

function forceCrooked(run, night = 2) {
  run.watchEv.end();
  for (let w = 0; w < 8000; w++) {
    const def = run.watchEv.begin(R.createRng(31).fork(`force.crooked.${w}`), night, 0, false);
    if (def && def.id === 'crooked_table') return;
    run.watchEv.end();
    run.watchEv.takeOutcomes();
    run.watchEv.takeCrooked();
  }
  throw new Error('never forced crooked_table');
}

/** One lost round of `bet` at `machineId` (the stake leaves the pocket, nothing comes back). */
function lose(run, machineId, bet = 10) {
  const s = src(machineId);
  assert.equal(run.bet(bet, s) || run.bet(bet, s), true);
  run.win(0, s, { bet, tier: 'none' });
}

test('the event can roll in a normal run: Night 2 with four open kinds, the weight is in the pool', () => {
  // Nights 2, 4, 5 and 7 are open to floor events (3, 3, 4 and 4 Watches): it fires in a fair share of seeded runs
  let hits = 0;
  const nights = [[2, 3], [4, 3], [5, 4], [7, 4]];
  for (let k = 0; k < 200; k++) {
    let seen = false;
    for (const [night, watches] of nights) {
      for (let w = 0; w < watches; w++) if (WE.rollWatchEvent(R.createRng(20261019).fork(`crooked.${k}.${night}.${w}`), night, false, null)?.def.id === 'crooked_table') seen = true;
    }
    if (seen) hits += 1;
  }
  assert.ok(hits / 200 >= 0.25, `crooked_table fired in ${hits} of 200 runs`);
  assert.equal(CT.rollCrooked(R.createRng(1).fork('x'), { machines: KINDS }, false) !== null, true);
  // vendors and terminals are never tables
  assert.equal(CT.rollCrooked(R.createRng(1).fork('x'), { machines: ['coinflip', 'bigone', 'charm_vendor', 'cashier'] }, false), null);
});

test('the run hands the table the NET of a round: a lost round of 10 counts 10 lost at its table', () => {
  const run = playingWithFloor(21);
  forceCrooked(run);
  const cr = run.watchEv.snapshot().aux.crooked;
  const mid = cr.tables[0];
  lose(run, mid, 10);
  assert.equal(run.watchEv.snapshot().aux.crooked.lost[0], 10);
  assert.equal(run.crookedView().tables.length, 3);
  assert.equal(run.isCrookedTable(mid), true);
  const other = KINDS.find((k) => !cr.tables.includes(k));
  assert.equal(other === undefined || run.isCrookedTable(other) === false, true);
  run.watchEv.end();
  run.dispose();
});

test('a right call refunds, gives the luck star, ends the event and feeds the Tally Sheet; Tamsin spoke once', () => {
  const said = [], sheet = [], notes = [];
  const offs = [
    EV.bus.on('floor:say', (l) => said.push(l)),
    EV.bus.on('crooked:sheet', (l) => sheet.push(l.key)),
    EV.bus.on('floor:note', (l) => notes.push(l)),
  ];
  const run = playingWithFloor(22);
  forceCrooked(run);
  assert.equal(said.filter((l) => l.voice === 'tamsin').length, 3, 'Tamsin\'s three lines on the first start');
  const cr = run.watchEv.snapshot().aux.crooked;
  const rig = cr.tables[cr.rigged];
  lose(run, rig, 10);
  lose(run, rig, 10);
  const pocket = run.wallet();
  const stars = run.luckStars();
  const expected = Math.min(2 * 20, Math.floor(run.quota.due * 0.25));
  assert.equal(run.floorCall(rig), true);
  assert.equal(run.wallet(), pocket + expected, 'the refund is paid into the pocket');
  assert.equal(run.luckStars(), stars + 1, 'a right call is +1 luck star');
  assert.equal(run.crookedView(), null, 'the tables close');
  assert.ok(sheet.includes('sheet.l.right'), 'the lesson reaches the Tally Sheet');
  assert.ok(said.some((l) => l.voice === 'clerk'), 'the Clerk rules');
  assert.ok(notes.some((n) => n.tone === 'good'), 'a good toast');
  assert.equal(run.floorCall(rig), false, 'a second call does nothing');
  for (const off of offs) off();
  run.dispose();
});

test('a wrong call costs the fee; Tamsin does not repeat the intro on the next start', () => {
  const said = [];
  const off = EV.bus.on('floor:say', (l) => said.push(l));
  const run = playingWithFloor(23);
  forceCrooked(run);
  const cr = run.watchEv.snapshot().aux.crooked;
  const fair = cr.tables[(cr.rigged + 1) % 3];
  const pocket = run.wallet();
  const fine = Math.max(1, Math.floor(run.quota.due * 0.05));
  assert.equal(run.floorCall(fair), true);
  assert.equal(run.wallet(), pocket - Math.min(fine, pocket));
  said.length = 0;
  forceCrooked(run);
  assert.equal(said.filter((l) => l.voice === 'tamsin').length, 0, 'the intro plays once');
  off();
  run.watchEv.end();
  run.dispose();
});

test('the call key and its strings exist in both languages', () => {
  assert.deepEqual(KM.ALL_DEFAULTS.callCheat, ['KeyC']);
  assert.ok(KM.SEATED_WALK_ACTIONS.has('callCheat'));
  assert.deepEqual(KM.conflictsFor(KM.ALL_DEFAULTS, 'callCheat', 'KeyC'), []);
  const P = STR['event.watch.crooked_table.'];
  for (const k of ['hud', 'mark', 'prompt', 'clerk.speaker', 'clerk.right', 'clerk.wrong']) {
    assert.ok(P.en[k], `en ${k}`);
    assert.ok(P.tr[k], `tr ${k}`);
  }
  assert.ok(P.en.prompt.includes('{key}') && P.tr.prompt.includes('{key}'));
  assert.ok(STR['luck.'] ? STR['luck.'].en['why.crooked'] && STR['luck.'].tr['why.crooked'] : true);
});
