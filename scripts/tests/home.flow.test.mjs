// THE EVENING (wave 69, flow lane): a paid Dawn takes the lift home, the Evening is a sub-state of the intermission (no new phase), the
// bed opens the next Night; a missed quota in a solo run is the doomed ride and ends with the Collector's visit (`fell` + `shot`);
// an online-style run (no Home layer) keeps the old lever and the trapdoor; and the stage survives a save. Headless: the run owns the
// stage clock, so the whole Evening walks on sim time with no world, no UI and no wall clock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, SAVE, EVE, STR, PHONE;
before(async () => {
  PHONE = await load('src/game/home/phone.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  EVE = await load('src/game/home/evening.ts');
  STR = await load('src/game/home/evening.strings.ts');
  REG.load();
});

const T = () => RUN.HOME_TIMING;
const home = (seed, extra = {}) => RUN.createRun({ seed, mode: 'debt', home: true, ...extra });

/** Advances the run by `sec` sim seconds in `step` slices. */
function walk(run, sec, step = 0.25) {
  for (let t = 0; t < sec && !run.over; t += step) run.tick(step);
}
/** Dawn with the quota paid: the Night is done and the lever is waiting. */
function paidDawn(run) {
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}
/** Dawn with nothing in the bank. */
function missedDawn(run) {
  run.debtPaid = 0;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}
/** One whole Night passed the way the bot does: paid Dawn, the lift, the Evening, the bed. */
function passNight(run) {
  paidDawn(run);
  assert.equal(run.openFloor(), true, 'the lever takes the lift');
  walk(run, T().ride + 0.1);
  assert.equal(run.homeStage(), 'evening');
  assert.equal(run.homeSleep(), true);
  walk(run, T().sleep + 0.1);
  assert.equal(run.homeStage(), null);
}
/** A save store in memory, with a resume slice taken from the run. */
function storeOf(run) {
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  return { snap, store: { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} } };
}
/** Collects the bus events of a kind for the length of a test. */
/** Night 1 end to end: the paid Dawn (no Night Card offer on it), the lift, the Evening and the bed, which opens Night 2. */
function eveningOfNight1(run) {
  paidDawn(run);
  assert.equal(run.nightCardOffer(), null, 'the Night 1 Dawn opens no offer (the first is the Night 2 Dawn)');
  assert.equal(run.openFloor(), true);
  walk(run, T().ride + 0.1);
  assert.equal(run.homeSleep(), true, 'the bed');
  walk(run, T().sleep + 0.1);
  assert.equal(run.night(), 2, 'Night 2 is open');
}

function listen(kind) {
  const seen = [];
  const off = EV.bus.on(kind, (e) => seen.push(e));
  return { seen, off };
}

test('the Evening: a paid Dawn, the lever takes the lift, the Evening runs on the intermission, the bed opens the next Night', () => {
  const stages = listen('home:stage');
  const run = home(701);
  assert.equal(run.homeOn, true);
  assert.equal(run.homeStage(), null);
  paidDawn(run);
  assert.equal(run.nightPaid, true);
  assert.equal(run.homeLiftReady(), true, 'the lever is the lift');
  assert.equal(run.openFloor(), true);
  assert.equal(run.homeStage(), 'ride', 'stage ride');
  assert.equal(run.shift.phase, 'intermission', 'no new phase: the Evening sits on the intermission');
  assert.equal(run.night(), 1, 'the Night has not opened');
  assert.equal(run.openFloor(), false, 'the lever waits mid-ride');
  assert.equal(run.startWatch(), false, 'no Watch from the lift');
  walk(run, T().ride + 0.1);
  assert.equal(run.homeStage(), 'evening', 'the ride ends in the Evening');
  assert.equal(run.homeState().lights, true);
  assert.equal(run.homeState().chain, false);
  assert.equal(run.shift.phase, 'intermission');
  assert.equal(run.night(), 1);
  assert.equal(run.homeSleep(), true, 'the bed');
  assert.equal(run.homeStage(), 'sleep');
  assert.equal(run.night(), 1, 'the Night opens at the end of the sleep');
  walk(run, T().sleep + 0.1);
  assert.equal(run.homeStage(), null, 'back on the floor');
  assert.equal(run.night(), 2, 'the next Night is open');
  assert.equal(run.nightPaid, false);
  assert.equal(run.shift.phase, 'intermission');
  assert.equal(run.startWatch(), true, 'the Mola lever rings the first Watch of Night 2');
  assert.deepEqual(stages.seen.map((e) => e.stage), ['ride', 'evening', 'sleep', null], 'home:stage names every step');
  stages.off();
  run.dispose();
});

test('the Evening has no soft lock: it falls asleep on its own after 120 sim seconds, and the lever at home is the bed', () => {
  const run = home(702);
  paidDawn(run);
  run.openFloor();
  walk(run, T().ride + 0.1);
  assert.equal(run.homeStage(), 'evening');
  assert.equal(T().evening, 120);
  walk(run, 60);
  assert.equal(run.homeStage(), 'evening', 'still in the Evening after 60 s');
  assert.ok(run.homeState().left > 55 && run.homeState().left < 61, 'the clock counts down');
  walk(run, 61);
  assert.notEqual(run.homeStage(), 'evening', 'the 120 s are up');
  walk(run, T().sleep + 0.1);
  assert.equal(run.homeStage(), null);
  assert.equal(run.night(), 2);
  // the lever at home sleeps too (the QA bot's `lever` step): a second Night
  paidDawn(run);
  run.openFloor();
  walk(run, T().ride + 0.1);
  assert.equal(run.openFloor(), true, 'openFloor at home is the bed');
  assert.equal(run.homeStage(), 'sleep');
  walk(run, T().sleep + 0.1);
  assert.equal(run.night(), 3);
  run.dispose();
});

test('the lift is a Night Card gate like OPEN THE FLOOR: the lever waits for the pick, and the kept card starts the Night after the bed', () => {
  const run = home(703);
  run.setNightCardGate(true);
  eveningOfNight1(run);
  paidDawn(run);
  assert.ok(run.nightCardOffer(), 'the Night 2 Dawn opened the offer');
  assert.equal(run.openFloor(), false, 'the open offer holds the lever');
  assert.equal(run.lastRefusal(), 'nightCard');
  assert.equal(run.homeStage(), null);
  const pick = run.nightCardOffer().candidates[0].id;
  assert.equal(run.pickNightCard(pick), true);
  assert.equal(run.openFloor(), true, 'the lever goes once a card is kept');
  assert.equal(run.homeStage(), 'ride');
  walk(run, T().ride + 0.1);
  run.homeSleep();
  walk(run, T().sleep + 0.1);
  assert.equal(run.nightCard()?.id, pick, 'the kept card starts Night 3');
  run.dispose();
  // without the panel (headless) an open offer is settled by its first card at the lever, as before
  const bare = home(704);
  eveningOfNight1(bare);
  paidDawn(bare);
  assert.equal(bare.openFloor(), true);
  assert.equal(bare.nightCardOffer(), null, 'the lift settled the offer');
  bare.dispose();
});

test('the phone is created with the run, ticked every frame, told once per Evening, and saved in RunExt.home.phone', () => {
  const run = home(705);
  const phone = run.homePhone();
  assert.ok(phone, 'a solo run has a phone');
  let ticks = 0, evenings = 0;
  const tick = phone.tick.bind(phone), onEvening = phone.onEvening.bind(phone);
  phone.tick = (dt) => { ticks++; tick(dt); };
  phone.onEvening = () => { evenings++; onEvening(); };
  phone.snapshot = () => ({ marker: 7 });
  run.tick(0.1); run.tick(0.1);
  assert.equal(ticks, 2, 'every run.tick ticks the phone');
  paidDawn(run);
  run.openFloor();
  walk(run, T().ride + 0.1);
  assert.equal(evenings, 1, 'the Evening began once');
  walk(run, 5);
  assert.equal(evenings, 1, 'and only once');
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.deepEqual(snap.ext.home.phone, { marker: 7 }, "the phone's slice rides in the save");
  assert.equal(snap.ext.home.stage, 'evening');
  run.dispose();
});

test('without the Home layer nothing changes: the old lever opens the next Night at once, a miss is the trapdoor, no phone', () => {
  const stages = listen('home:stage');
  const run = RUN.createRun({ seed: 706, mode: 'debt' });
  assert.equal(run.homeOn, false);
  assert.equal(run.homePhone(), null, 'an online-style run has no phone');
  paidDawn(run);
  assert.equal(run.homeLiftReady(), false);
  assert.equal(run.openFloor(), true);
  assert.equal(run.homeStage(), null, 'no ride');
  assert.equal(run.night(), 2, 'the next Night opened at once');
  assert.equal(stages.seen.length, 0, 'no home:stage events');
  assert.equal(run.homeSleep(), false);
  stages.off();
  run.dispose();
  // the Free Casino has no Evening even when it is asked for
  const free = RUN.createRun({ seed: 707, mode: 'free', home: true });
  assert.equal(free.homeOn, false);
  assert.equal(free.homePhone(), null);
  free.dispose();
});

test('a missed quota in a solo run: the doomed ride, then run:end fell with ending shot', () => {
  const stages = listen('home:stage');
  const failed = listen('quota:failed');
  const ends = listen('run:end');
  const falls = listen('player:fall');
  const run = home(710);
  missedDawn(run);
  assert.equal(run.homeStage(), 'doomed', 'stage doomed');
  assert.equal(run.over, false, 'the run is still alive on the ride home');
  assert.equal(run.shift.phase, 'collection', 'the Dawn holds while the doom walks');
  assert.equal(run.openFloor(), false, 'no lever from the doom');
  assert.equal(run.startWatch(), false);
  assert.equal(run.homeSleep(), false, 'no bed from the doom');
  assert.equal(run.deposit(1, true), false, 'the books are shut');
  // the lights and the knocks fall inside the doom's clock, in this order, before the end
  const D = T().doomed;
  assert.ok(D.flickerAt >= T().ride, 'the lights flicker once the ride is over');
  assert.ok(D.flickerEnd > D.flickerAt && D.knocks[0] > D.flickerEnd, 'then the knocks');
  assert.equal(D.knocks.length, 3, 'three knocks');
  assert.ok(D.knocks.every((k, i) => i === 0 || k > D.knocks[i - 1]) && D.end > D.knocks[2], 'in order, then the end');
  walk(run, D.end - 0.5);
  assert.equal(run.over, false, 'not over before the clock runs out');
  assert.equal(run.homeStage(), 'doomed');
  walk(run, 1);
  assert.equal(run.over, true, 'the doom ends the run');
  assert.equal(ends.seen.length, 1);
  const s = ends.seen[0].summary;
  assert.equal(s.result, 'fell');
  assert.equal(s.ending, 'shot');
  assert.equal(run.alive(), false);
  assert.equal(failed.seen.length, 1, 'quota:failed (the HUD feed) still fires once');
  assert.equal(falls.seen.length, 0, 'but nobody falls through a trapdoor at home');
  assert.deepEqual(stages.seen.map((e) => e.stage), ['doomed']);
  for (const l of [stages, failed, ends, falls]) l.off();
  run.dispose();
});

test('the outs come first: false_bottom pays a near miss and rope_ladder buys an overtime Watch; only then the doom', () => {
  const near = home(711);
  near.charmBox.add(near.selfId, 'false_bottom', 4);
  near.debtPaid = Math.floor(near.quota.due * 0.95);
  near.syncQuota();
  near.phase = 'collection';
  near.dawn();
  assert.equal(near.nightPaid, true, 'false_bottom made the quota');
  assert.equal(near.homeStage(), null);
  assert.equal(near.homeLiftReady(), true);
  near.dispose();

  const rope = home(712);
  rope.charmBox.add(rope.selfId, 'rope_ladder', 4);
  missedDawn(rope);
  assert.equal(rope.homeStage(), null, 'rope_ladder: an overtime Watch, not the doom');
  assert.equal(rope.shift.phase, 'intermission');
  assert.equal(rope.over, false);
  rope.debtPaid = 0;
  rope.syncQuota();
  rope.phase = 'collection';
  rope.dawn();
  assert.equal(rope.homeStage(), 'doomed', 'the second miss is the doom');
  rope.dispose();
});

test('Night 8 keeps the old lever (the Topside choice), and the Evening is back for Overdrawn', () => {
  const run = home(713);
  for (let i = 0; i < 7; i++) passNight(run);
  assert.equal(run.night(), 8);
  paidDawn(run);
  assert.equal(run.topsideOpen, true, 'Night 8 paid: the Topside choice');
  assert.equal(run.openFloor(), false, 'refused while the choice is open');
  assert.equal(run.homeLiftReady(), false);
  assert.equal(run.goBackDown(), true);
  assert.equal(run.homeLiftReady(), false, 'GO BACK DOWN keeps the old lever for Night 8');
  assert.equal(run.openFloor(), true);
  assert.equal(run.homeStage(), null, 'no lift');
  assert.equal(run.night(), 9, 'Night 9 opened at once');
  passNight(run);                   // Night 9 is Overdrawn: the Evening works there
  assert.equal(run.night(), 10);
  run.dispose();
});

test('save and restore: the Evening comes back in the Evening, with its clock, lights and chain; a ride and a sleep come back as the Evening', () => {
  const run = home(720);
  paidDawn(run);
  run.openFloor();
  // a save taken in the ride restores as the Evening, from the top of its clock
  const ride = storeOf(run);
  assert.equal(ride.snap.ext.home.stage, 'ride');
  const fromRide = RUN.resumeRun(ride.store, { home: true });
  assert.equal(fromRide.homeStage(), 'evening', 'a ride restores as the Evening');
  assert.equal(fromRide.homeState().left, T().evening);
  assert.equal(fromRide.night(), 1);
  fromRide.dispose();
  walk(run, T().ride + 0.1);
  walk(run, 30);
  run.homeFlags({ lights: false, chain: true });
  const mid = storeOf(run);
  assert.equal(mid.snap.ext.home.stage, 'evening');
  assert.equal(mid.snap.ext.home.lights, false);
  assert.equal(mid.snap.ext.home.chain, true);
  const back = RUN.resumeRun(mid.store, { home: true });
  assert.equal(back.homeStage(), 'evening', 'restored in the Evening');
  assert.ok(Math.abs(back.homeState().left - run.homeState().left) < 1e-9, 'with its clock');
  assert.equal(back.homeState().lights, false);
  assert.equal(back.homeState().chain, true);
  assert.equal(back.shift.phase, 'intermission');
  assert.equal(back.nightPaid, true);
  assert.equal(back.night(), 1);
  let evenings = 0;
  const on = back.homePhone().onEvening.bind(back.homePhone());
  back.homePhone().onEvening = () => { evenings++; on(); };
  walk(back, 1);
  assert.equal(evenings, 0, 'a restore is not a new Evening');
  assert.equal(back.homeSleep(), true);
  walk(back, T().sleep + 0.1);
  assert.equal(back.night(), 2, 'the restored Evening sleeps into the next Night');
  back.dispose();
  // a sleep that was cut off finishes soon
  run.homeSleep();
  const sleep = storeOf(run);
  assert.equal(sleep.snap.ext.home.stage, 'sleep');
  const fromSleep = RUN.resumeRun(sleep.store, { home: true });
  assert.equal(fromSleep.homeStage(), 'evening');
  assert.ok(fromSleep.homeState().left <= 5, 'a short Evening is left');
  walk(fromSleep, 9);
  assert.equal(fromSleep.night(), 2);
  fromSleep.dispose();
  run.dispose();
});

test('save and restore: the doom comes back whole and ends the run; an online resume ignores the Home slice', () => {
  const run = home(721);
  missedDawn(run);
  const snap = storeOf(run);
  assert.equal(snap.snap.ext.home.stage, 'doomed');
  const ends = listen('run:end');
  const back = RUN.resumeRun(snap.store, { home: true });
  assert.equal(back.homeStage(), 'doomed', 'the doom is restored');
  assert.equal(back.homeState().left, T().doomed.end, 'from the top: the ride, the lights, the knocks');
  assert.equal(back.over, false);
  walk(back, T().doomed.end + 0.5);
  assert.equal(back.over, true);
  assert.equal(ends.seen.at(-1).summary.ending, 'shot');
  ends.off();
  back.dispose();
  // the same save resumed without the Home layer (an online run) is just a Dawn that waits for its timer, and fells by the trapdoor
  const online = RUN.resumeRun({ data: { ...SAVE.defaultSave(), resume: JSON.parse(JSON.stringify(snap.snap)) }, update(fn) { fn(this.data); }, flush() {} });
  assert.equal(online.homeOn, false);
  assert.equal(online.homeStage(), null);
  assert.equal(online.homePhone(), null);
  const trap = listen('run:end');
  walk(online, 1);
  assert.equal(online.over, true, 'the waiting Dawn is read at once');
  assert.equal(trap.seen.at(-1).summary.result, 'fell');
  assert.equal(trap.seen.at(-1).summary.ending, undefined, 'the trapdoor has no ending tag');
  trap.off();
  online.dispose();
  run.dispose();
  // an older save (no `home` slice) resumes without a stage
  const old = home(722);
  paidDawn(old);
  const o = storeOf(old);
  delete o.snap.ext.home;
  const back2 = RUN.resumeRun(o.store, { home: true });
  assert.equal(back2.homeStage(), null);
  assert.equal(back2.homeLiftReady(), true, 'the lever is the lift for an old save too');
  back2.dispose();
  old.dispose();
});

test('the same seed walks the same Evening: two runs agree stage for stage and on every saved number', () => {
  const trace = (seed) => {
    const out = [];
    const l = listen('home:stage');
    const run = home(seed);
    for (let n = 0; n < 3; n++) {
      paidDawn(run);
      run.openFloor();
      walk(run, T().ride + 0.1);
      out.push([run.homeStage(), run.homeState().left.toFixed(3), run.night()]);
      walk(run, 20);
      run.homeSleep();
      walk(run, T().sleep + 0.1);
      out.push([run.homeStage(), run.night(), Math.floor(run.wallet())]);
    }
    const stages = l.seen.map((e) => e.stage);
    l.off();
    const snap = JSON.parse(JSON.stringify(run.snapshot()));
    run.dispose();
    return JSON.stringify({ out, stages, home: snap.ext.home, elapsed: snap.ext.elapsed });
  };
  assert.equal(trace(730), trace(730));
});

test('the controller helpers: anchors give a yaw along their -Z, and the lines hold a readable time', async () => {
  const THREE = await import('three');
  const o = new THREE.Object3D();
  o.position.set(-120, 1.4, 121);
  o.rotation.y = Math.PI / 2;               // -Z turned a quarter: facing -X
  const p = EVE.anchorPose(o);
  assert.ok(Math.abs(p.pos.x + 120) < 1e-9 && Math.abs(p.pos.z - 121) < 1e-9);
  assert.ok(Math.abs(-Math.sin(p.yaw) - p.dir.x) < 1e-9 && Math.abs(-Math.cos(p.yaw) - p.dir.z) < 1e-9, 'forward is (-sin yaw, -cos yaw)');
  assert.ok(Math.abs(p.dir.x + 1) < 1e-9, 'a quarter turn faces -X');
  assert.equal(EVE.lineSeconds('Hi.'), 2.2, 'a short line stays up for a floor of time');
  assert.equal(EVE.lineSeconds('x'.repeat(400)), 6, 'a long one is capped');
  assert.ok(EVE.lineSeconds('x'.repeat(60)) > 2.2 && EVE.lineSeconds('x'.repeat(60)) < 6);
});

test('the Evening strings: EN and TR hold the same keys, the window has four lines, and the lever reads TAKE THE LIFT / ASANSÖRE BİN', () => {
  assert.deepEqual(Object.keys(STR.default.en).sort(), Object.keys(STR.default.tr).sort());
  for (const lang of ['en', 'tr']) {
    for (const [k, v] of Object.entries(STR.default[lang])) assert.ok(String(v).length > 0, `${lang} ${k} is not empty`);
    for (let n = 1; n <= 4; n++) assert.ok(STR.default[lang][`window.${n}`], `${lang} window.${n}`);
  }
  assert.equal(STR.default.en.lever, 'TAKE THE LIFT');
  assert.equal(STR.default.tr.lever, 'ASANSÖRE BİN');
  assert.equal(STR.default.en.peephole, 'The hall is empty.');
  assert.equal(STR.default.tr.peephole, 'Koridor boş.');
});

test('the bed closes the Night with a dream: rolled once by the phone, and a quiet Night costs one Harmony', () => {
  const run = home(808);
  const phone = run.homePhone();
  assert.equal(PHONE.dreamOf(phone), null, 'no dream before the first bed');
  const h0 = phone.harmony();
  passNight(run);                       // a paid Dawn, the lift, the Evening, the bed (no Watch: no spouse reply, no talk)
  const d = PHONE.dreamOf(phone);
  assert.ok(d, 'the bed rolled a dream');
  assert.equal(d.night, 1, 'the dream belongs to the Night that closed');
  assert.ok(['good', 'plain', 'cold'].includes(d.tier), d.tier);
  assert.ok(d.key.startsWith(`phone.dream.${d.tier}.`), d.key);
  // a Dawn paid to exactly the quota has no margin: the Evening's thin-margin rule takes one, the quiet Night (no reply, no talk) one more
  assert.equal(phone.harmony(), Math.max(0, h0 - 2), 'a thin Evening and a quiet Night each drop one Harmony');
  run.dispose();
});

