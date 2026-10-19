// Wave 75 wiring: the floor events inside the run (SINGLE LIGHT gate, the LAST CALL DARE settled by the next round, the STAGE
// AUCTION bid charged from the pocket), the event weights for a normal run, the keepsake and ghost moves of the luck meter, the
// keymap entries, the grand casino lines and the strings the new HUD lines read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, R, WE, EV, LUCK, KM, I18N, GC, SCH, STRS;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  R = await load('src/core/rng.ts');
  WE = await load('src/game/watchEvents.ts');
  EV = await load('src/core/events.ts');
  LUCK = await load('src/game/luck.ts');
  KM = await load('src/core/keymap.ts');
  I18N = await load('src/core/i18n.ts');
  GC = await load('src/game/ingame/grandCasino.ts');
  SCH = await load('src/game/data/schedule.ts');
  REG.load();
  // Register the wave 75 strings the assertions below read (the app loads every *.strings.ts through its glob).
  STRS = {};
  for (const rel of [
    'src/game/keepsake.strings.ts', 'src/game/luck.strings.ts', 'src/game/ghostSeat.strings.ts', 'src/game/game.strings.ts',
    'src/game/ingame/intermission.strings.ts', 'src/game/ingame/grandCasino.strings.ts', 'src/game/watchEvents.strings.ts',
    'src/core/keymap.strings.ts',
  ]) {
    const m = (await load(rel)).default;
    STRS[m.prefix] = m;
    I18N.registerStrings(m.prefix, { en: m.en, tr: m.tr });
  }
});

const NEW = ['single_light', 'stage_auction', 'crate_drop', 'wheel_spin', 'last_call_dare'];
const SRC = { mid: 'm-floor', machineId: 'bigone' };
const OTHER = { mid: 'm-other', machineId: 'coinflip' };

/** A run in the play phase of Night 1 Watch 1, with two machine kinds on the floor (so the floor facts are real). */
function playingWithFloor(seed = 5) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.attachWorld({
    machines: () => [{ instance: SRC.mid, machineId: SRC.machineId }, { instance: OTHER.mid, machineId: OTHER.machineId }],
    instancePos: () => undefined,
  });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  return run;
}

/** A stake; a stake above half the pocket asks for a second press (the run's confirm), which this repeats once. */
function place(run, amount, src) {
  return run.bet(amount, src) || run.bet(amount, src);
}

/** Ends the Watch's event and begins Watches until `id` rolls. Deterministic: the seeds are fixed. */
function forceEvent(run, id, night = 2) {
  run.watchEv.end();
  for (let w = 0; w < 8000; w++) {
    const def = run.watchEv.begin(R.createRng(31).fork(`force.${id}.${w}`), night, 0, false);
    if (def && def.id === id) return def;
    run.watchEv.end();
    run.watchEv.takeOutcomes();
  }
  throw new Error(`never forced ${id}`);
}

// ── the event weights in a normal run ─────────────────────────────────────────────────────────────────────
test('a normal run gives every wave 75 event a fair chance: each fires in at least a quarter of seeded runs', () => {
  // Nights 2, 4, 5 and 7 are open to floor events (3, 3, 4 and 4 Watches); Nights 3, 6 and 8 are boss Nights and roll none.
  const nights = [[2, 3], [4, 3], [5, 4], [7, 4]];
  const runs = 300;
  const hit = Object.fromEntries(NEW.map((id) => [id, 0]));
  for (let k = 0; k < runs; k++) {
    const seen = new Set();
    for (const [night, watches] of nights) {
      for (let w = 0; w < watches; w++) {
        const r = WE.rollWatchEvent(R.createRng(20261018).fork(`normal.${k}.${night}.${w}`), night, false, null);
        if (r) seen.add(r.def.id);
      }
    }
    for (const id of NEW) if (seen.has(id)) hit[id] += 1;
  }
  for (const id of NEW) assert.ok(hit[id] / runs >= 0.25, `${id} fired in ${hit[id]} of ${runs} runs`);
  assert.equal(nights.length, SCH.BASE_NIGHTS.filter((n) => n.no >= 2 && n.no !== 3 && n.no !== 6 && n.no !== 8).length);
});

// ── the STAGE AUCTION bid ─────────────────────────────────────────────────────────────────────────────────
test('auctionNext: one above the House price, and above the player\'s own top bid', () => {
  const we = new WE.WatchEvents({ isHot: () => false, touch: () => {}, floor: () => ({ machines: ['bigone', 'coinflip'] }) });
  let guard = 0;
  while (guard++ < 6000) {
    const def = we.begin(R.createRng(7).fork(`auc.${guard}`), 3, 0, false);
    if (def && def.id === 'stage_auction') break;
    we.end();
    we.takeOutcomes();
  }
  const n = we.view().info.vars.n;
  assert.equal(we.auctionNext(), n + 1, 'the first bid beats the House price');
  assert.equal(we.bidAuction(n + 1, 100).ok, true);
  assert.equal(we.auctionNext(), n + 2, 'the next bid beats the player\'s own top bid');
  we.end();
  assert.equal(we.auctionNext(), null, 'no auction once it closes');
});

test('the run takes the STAGE AUCTION charge from the pocket, at the next legal price', () => {
  const run = playingWithFloor(11);
  forceEvent(run, 'stage_auction');
  const n = run.watchEv.view().info.vars.n;
  const before = run.wallet();
  assert.equal(run.floorAct(), true, 'the floor key bids');
  assert.equal(run.wallet(), before - (n + 1), 'charged the bid, which is one above the House price');
  run.watchEv.end();
  run.dispose();
});

// ── SINGLE LIGHT gate ─────────────────────────────────────────────────────────────────────────────────────
test('SINGLE LIGHT: only the lit machine plays, and the refusal says why', () => {
  const run = playingWithFloor(12);
  forceEvent(run, 'single_light');
  const lit = run.watchEv.snapshot().aux.lit;
  assert.ok(lit === SRC.machineId || lit === OTHER.machineId, `lit is on the floor: ${lit}`);
  const dark = lit === SRC.machineId ? OTHER : SRC;
  assert.equal(run.bet(2, dark), false);
  assert.equal(String(run.lastRefusal()), 'floorEvent');
  assert.equal(run.wallet(), SCH.START.pocket, 'nothing was charged');
  const litSrc = lit === SRC.machineId ? SRC : OTHER;
  assert.equal(run.bet(2, litSrc), true, 'the lit machine plays');
  run.win(0, litSrc, { bet: 2, tier: 'none' });
  run.watchEv.end();
  run.dispose();
});

// ── LAST CALL DARE: the next round settles it ─────────────────────────────────────────────────────────────
test('LAST CALL DARE: floorAct takes it once armed, and the next round settles it', () => {
  const run = playingWithFloor(13);
  forceEvent(run, 'last_call_dare');
  assert.equal(run.floorAct(), false, 'not armed yet: the floor key does nothing');
  run.watchEv.watchLeft(20);
  assert.equal(run.watchEv.view().canAccept, true);
  assert.equal(run.floorAct(), true, 'the floor key takes the dare');
  assert.equal(run.watchEv.view().canAccept, false);
  assert.equal(run.bet(2, SRC), true);
  run.win(0, SRC, { bet: 2, tier: 'none' });
  assert.equal(run.watchEv.view(), null, 'the dare ends with its result');
  run.dispose();
});

// ── the grand casino: the four biggest wins ────────────────────────────────────────────────────────────────
test('the run keeps the four biggest wins, largest first', () => {
  const run = playingWithFloor(14);
  const credited = [];
  for (const gross of [30, 80, 20, 60, 50]) {
    if (run.wallet() < 2) break;
    assert.equal(place(run, 2, SRC), true);
    credited.push(run.win(gross, SRC, { bet: 2, tier: 'big' }));
  }
  const top = credited.map((c) => Math.floor(c)).sort((a, b) => b - a).slice(0, 4);
  const wins = run.grandWins();
  assert.equal(wins.length, Math.min(4, credited.length));
  assert.deepEqual(wins.map((w) => w.amount), top);
  assert.ok(wins.every((w) => w.machineId === SRC.machineId));
  run.dispose();
});

test('the jackpot wall lines name the machine and the coins; the prize case has three labelled placeholders', () => {
  const lines = GC.wallLines([{ machineId: 'bigone', amount: 1250 }]);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('1'), 'the amount is in the line');
  const prizes = GC.prizeLabels();
  assert.equal(prizes.length, 3);
  for (const p of prizes) assert.ok(p.length > 0, 'a label');
  assert.equal(GC.GRAND_FLASH_TIER, 'big');
});

// ── the luck meter: keepsakes and ghost matches ───────────────────────────────────────────────────────────
test('the luck meter: a keepsake that comes back is +1 ŞANS, a keepsake the House keeps is not', () => {
  const meter = LUCK.createLuckMeter({}, () => {});
  EV.bus.emit('keepsake:stake', { state: 'lost', id: 'ring', mid: 'm', star: 1 });
  assert.equal(meter.stars(), 0, 'a loss moves nothing');
  EV.bus.emit('keepsake:stake', { state: 'won', id: 'ring', mid: 'm', star: 1 });
  assert.equal(meter.stars(), 1);
  assert.equal(meter.last().why, 'keepsake');
  meter.dispose();
});

test('the luck meter: a ghost match (either side) is +1 ŞANS with the ghost reason', () => {
  const meter = LUCK.createLuckMeter({}, () => {});
  EV.bus.emit('ghost:match', { side: 'lost', machineId: 'coinflip', mid: 'm', star: 1 });
  assert.equal(meter.stars(), 1);
  assert.equal(meter.last().why, 'ghost');
  EV.bus.emit('ghost:match', { side: 'won', machineId: 'coinflip', mid: 'm', star: 1 });
  assert.equal(meter.stars(), 2);
  meter.dispose();
});

test('no keepsake carried: the seat hint is off, and no stake can be made', () => {
  const run = playingWithFloor(15);
  assert.equal(run.keepsakeFreeTonight(), false);
  assert.equal(run.keepsakeStake(SRC.mid), false);
  run.dispose();
});

// ── keymap, strings ─────────────────────────────────────────────────────────────────────────────────────────
test('keymap: K stakes a keepsake (seated too), N takes the floor action; neither clashes with another binding', () => {
  assert.deepEqual(KM.ALL_DEFAULTS.keepsake, ['KeyK']);
  assert.deepEqual(KM.ALL_DEFAULTS.floorAct, ['KeyN']);
  assert.ok(KM.SEATED_WALK_ACTIONS.has('keepsake'));
  assert.ok(KM.SEATED_WALK_ACTIONS.has('floorAct'));
  for (const [k, codes] of Object.entries(KM.ALL_DEFAULTS)) {
    if (k === 'keepsake' || k === 'floorAct') continue;
    assert.ok(!codes.includes('KeyK') && !codes.includes('KeyN'), `${k} does not use K or N`);
  }
});

test('strings: the new HUD lines carry their placeholders in both languages, and the Mola bar fits one line', () => {
  const hint = STRS['keepsake.'];
  assert.ok(hint.en['seat.hint'].includes('{key}') && hint.en['seat.hint'].includes('{name}'));
  assert.ok(hint.tr['seat.hint'].includes('{key}') && hint.tr['seat.hint'].includes('{name}'));
  assert.equal(hint.en['seat.hint'].replace('{key}', 'K').replace('{name}', 'the ring'), '[K] Bet the ring instead of coins');
  assert.equal(hint.tr['seat.hint'].replace('{key}', 'K').replace('{name}', 'yüzüğü'), '[K] Para yerine yüzüğü koy');
  for (const lang of ['en', 'tr']) {
    assert.ok(STRS['event.watch.'][lang]['stage_auction.hud'].includes('{key}'));
    assert.ok(STRS['event.watch.'][lang]['last_call_dare.hud.ready'].includes('{key}'));
  }
  // The Mola bar's phase text is about 10 px a character at 1280x720 inside a 480 px centre column: keep it well under 40.
  assert.ok(STRS['interm.'].en.topBar.length <= 36, `EN topBar is ${STRS['interm.'].en.topBar.length} characters`);
  assert.ok(STRS['interm.'].tr.topBar.length <= 36, `TR topBar is ${STRS['interm.'].tr.topBar.length} characters`);
  assert.ok(STRS['ghost.'].en.seat.includes('tonight'));
  assert.ok(STRS['luck.'].en['why.keepsake'] && STRS['luck.'].en['why.ghost']);
  assert.ok(STRS['luck.'].tr['why.keepsake'] && STRS['luck.'].tr['why.ghost']);
  assert.ok(STRS['game.'].en['refuse.floorEvent'] && STRS['game.'].tr['refuse.floorEvent']);
});
