// Tests for the pocket phone (src/game/home/phone.ts, strings in phone.strings.ts, buffs in data/buffs.ts): the seeded
// schedule, one message per spouse Night, the Collector's gate, replies applied once, the pocket check, the bounds, the Evening
// rules, the blessing, the escalation, the snapshot round trip and the content tables. The run is a small mock with only what
// the phone reads, so Nights, Watches and the quota can be set freely.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let PH, EV, STR, BUFFS, CHARMS;
before(async () => {
  PH = await load('src/game/home/phone.ts');
  EV = await load('src/core/events.ts');
  STR = (await load('src/game/home/phone.strings.ts')).default;
  BUFFS = await load('src/game/data/buffs.ts');
  CHARMS = await load('src/game/data/charms.ts');
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
/** The run as the phone sees it. `st` is live: the tests move the Night, the Watch, the quota and the pocket through it. */
function mockRun(s = {}) {
  const st = { seed: 1, night: 1, watch: 0, count: 3, due: 100, paid: 0, coins: 500, carried: 0, phase: 'intermission', clock: 0, ...s };
  const log = { spent: [], buffs: [] };
  return {
    seed: st.seed, st, log,
    night: () => st.night,
    shift: { get phase() { return st.phase; }, state: () => ({ segment: { index: st.watch, count: st.count } }) },
    debt: () => ({ index: st.night - 1, due: st.due, paid: st.paid, deadlineAt: 0, floor: st.night, total: 8 }),
    nightLedger: () => ({ night: st.night, float: 0, interest: 0, tickets: 0, cut: 0, carried: st.carried }),
    wallet: () => st.coins,
    spend: (cur, n) => {
      if (cur !== 'coin' || n > st.coins) return false;
      st.coins -= n;
      log.spent.push(n);
      return true;
    },
    buffs: { add: (id, o) => { log.buffs.push({ id, o }); } },
  };
}

/** Plays every Watch of the run's Night through the phone and returns the messages that arrived, with their clock. */
function playNight(phone, run, { paidAt = () => run.st.paid } = {}) {
  const arrivals = [];
  const off = EV.bus.on('msg:in', ({ msg }) => arrivals.push({ ...msg, vars: msg.vars ? { ...msg.vars } : undefined, clock: run.st.clock }));
  try {
    for (let w = 0; w < run.st.count; w++) {
      run.st.watch = w;
      run.st.paid = paidAt(w);
      run.st.phase = 'play';
      EV.bus.emit('shift:phase', { phase: 'play', index: run.st.night - 1 });
      for (let t = 0; t < 170; t++) { phone.tick(1); run.st.clock += 1; }
      run.st.phase = 'settle';
      EV.bus.emit('shift:phase', { phase: 'settle', index: run.st.night - 1 });
    }
    run.st.phase = 'intermission';
    EV.bus.emit('shift:phase', { phase: 'intermission', index: run.st.night - 1 });
  } finally {
    off();
  }
  return arrivals;
}

const withPhone = (run, fn) => {
  const phone = PH.createPhone(run);
  try { return fn(phone); } finally { phone.dispose(); }
};

// ── the schedule ─────────────────────────────────────────────────────────────────────────────────
test('the schedule is seeded: the same seed, Night and Watches give the same messages at the same times', () => {
  // each replay builds a fresh run and phone, so both start from the same clock and the same Night
  const replay = () => {
    const run = mockRun({ seed: 7, count: 3 });
    return withPhone(run, (p) => playNight(p, run).map((m) => [m.id, m.textKey, m.clock]));
  };
  const first = replay();
  assert.ok(first.length >= 1, 'a Night with a Collector writes');
  assert.deepEqual(replay(), first);
});

test('different seeds give different schedules across many seeds', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const run = mockRun({ seed, count: 3, paid: 0 });
    const got = withPhone(run, (p) => playNight(p, run));
    seen.add(got.map((m) => `${m.thread}${m.watch}${m.textKey}`).join(','));
  }
  assert.ok(seen.size > 20, `only ${seen.size} distinct schedules`);
});

test('at most one spouse message per Night, and only from Watch 1 or 2', () => {
  let nights = 0, withSpouse = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const run = mockRun({ seed, count: 4, night: 2, paid: 0 });
    const got = withPhone(run, (p) => playNight(p, run, { paidAt: () => 0 }));
    const sp = got.filter((m) => m.thread === 'spouse');
    assert.ok(sp.length <= 1, `seed ${seed}: ${sp.length} spouse messages in one Night`);
    for (const m of sp) assert.ok(m.watch === 1 || m.watch === 2, `seed ${seed}: spouse on printed Watch ${m.watch}`);
    nights++;
    if (sp.length) withSpouse++;
  }
  const rate = withSpouse / nights;
  assert.ok(rate > 0.65 && rate < 0.85, `spouse rate ${rate}`);
});

test('the Collector writes from Watch 2 only, and only while the Night is behind', () => {
  // 40 of 100 paid: 60 % still owed at Watch 2 (over the 50 % line), so the Collector writes there and on the last Watch
  const behind = mockRun({ seed: 3, count: 3, paid: 0 });
  const got = withPhone(behind, (p) => playNight(p, behind, { paidAt: () => 40 }));
  const co = got.filter((m) => m.thread === 'collector');
  assert.ok(co.length >= 1, 'a behind Night gets a Collector message');
  assert.ok(co.every((m) => m.watch >= 2), 'never on Watch 1');
  assert.ok(co.some((m) => m.watch === 2), 'Watch 2 writes when more than half is owed');
  // paid in full: the Collector never writes
  const paid = mockRun({ seed: 3, count: 3 });
  const none = withPhone(paid, (p) => playNight(p, paid, { paidAt: () => 100 }));
  assert.equal(none.filter((m) => m.thread === 'collector').length, 0);
});

test('the Collector at Watch 2 needs more than half still owed; the last Watch needs more than a quarter', () => {
  // 60 of 100 paid: 40 % owed. Watch 2 is under the 50 % line, but the last Watch (Watch 3) is over the 25 % line.
  const run = mockRun({ seed: 11, count: 3 });
  const got = withPhone(run, (p) => playNight(p, run, { paidAt: () => 60 }));
  const co = got.filter((m) => m.thread === 'collector');
  assert.ok(co.every((m) => m.watch === 3), `only the last Watch writes here, got ${co.map((m) => m.watch)}`);
});

test('the Collector escalates across the run: courtesy, reminder, final notice, on our way', () => {
  const run = mockRun({ seed: 21, count: 3, paid: 0 });
  const stages = [];
  withPhone(run, (p) => {
    for (let night = 1; night <= 5; night++) {
      run.st.night = night;
      for (const m of playNight(p, run, { paidAt: () => 0 })) if (m.thread === 'collector') stages.push(Number(m.textKey.split('.')[2].slice(1)));
    }
  });
  assert.ok(stages.length >= 4, `only ${stages.length} Collector messages`);
  assert.equal(stages[0], 0, 'the first is the courtesy');
  assert.ok(stages.every((s, i) => i === 0 || s >= stages[i - 1]), `stages step up: ${stages}`);
  assert.ok(stages.includes(3), 'the run reaches on our way');
});

test('a phone created mid-Watch catches up on its first tick', () => {
  const run = mockRun({ seed: 4, count: 3, watch: 1, phase: 'play', paid: 0 });
  withPhone(run, (p) => {
    for (let t = 0; t < 170; t++) p.tick(1);
    assert.ok(p.messages().some((m) => m.thread === 'collector'), 'the Watch 2 plan ran');
  });
});

// ── replies ──────────────────────────────────────────────────────────────────────────────────────
/** A spouse message with a `send` reply (rent, trip or fridge), found by seed. */
function spouseWithSend(seeds = 2000) {
  for (let seed = 1; seed <= seeds; seed++) {
    const run = mockRun({ seed, count: 3, paid: 0, coins: 500, due: 100 });
    const got = withPhone(run, (p) => playNight(p, run, { paidAt: () => 0 }));
    const m = got.find((g) => g.thread === 'spouse' && /^phone\.sp\.(rent|trip|fridge)\.t$/.test(g.textKey));
    if (m) return { seed, msg: m };
  }
  throw new Error('no send-spouse message found');
}

test('a reply applies once: coins spent once, Harmony moved once, the second answer is refused', () => {
  const { seed, msg } = spouseWithSend();
  const run = mockRun({ seed, count: 3, paid: 0, coins: 500, due: 100 });
  withPhone(run, (p) => {
    playNight(p, run, { paidAt: () => 0 });   // the same seed replays the same message
    const live = p.messages().find((m) => m.id === msg.id);
    assert.ok(live, 'the message is there after the replay');
    const h0 = p.harmony(), c0 = run.st.coins, cost = PH.replyCoinCost(live, 0);
    assert.ok(cost >= 1, 'the send reply has a price');
    assert.equal(p.reply(msg.id, 0), true);
    assert.equal(run.st.coins, c0 - cost, 'the pocket paid the price once');
    assert.equal(run.log.spent.length, 1, 'spent once');
    assert.equal(p.harmony(), Math.min(5, h0 + 1), 'the send reply gives +1 Harmony');
    assert.equal(p.reply(msg.id, 1), false, 'a second answer is refused');
    assert.equal(p.reply(msg.id, 0), false);
    assert.equal(run.log.spent.length, 1, 'still spent once');
    assert.equal(p.harmony(), Math.min(5, h0 + 1), 'Harmony not moved again');
    assert.equal(live.answered, 0);
    assert.equal(p.unread(), p.messages().filter((m) => !m.read).length);
  });
});

test('a send reply the pocket cannot cover applies nothing and leaves the message open', () => {
  const { seed, msg } = spouseWithSend();
  const run = mockRun({ seed, count: 3, paid: 0, coins: 0, due: 100 });
  withPhone(run, (p) => {
    playNight(p, run, { paidAt: () => 0 });
    const h0 = p.harmony();
    assert.equal(p.reply(msg.id, 0), false, 'refused for lack of coins');
    assert.equal(p.harmony(), h0, 'no Harmony moved');
    assert.equal(p.messages().find((m) => m.id === msg.id).answered, null, 'still open');
    assert.equal(run.log.spent.length, 0);
  });
});

test('replies to unknown ids and out-of-range choices are refused', () => {
  const run = mockRun({ seed: 5, count: 3, paid: 0 });
  withPhone(run, (p) => {
    playNight(p, run, { paidAt: () => 0 });
    assert.equal(p.reply('nope', 0), false);
    const m = p.messages()[0];
    if (m) {
      assert.equal(p.reply(m.id, 99), false);
      assert.equal(p.reply(m.id, -1), false);
    }
  });
});

test('the Collector: "I need time" adds one Heat, "I\'ll pay" adds none, and Heat stays within 0..6', () => {
  const run = mockRun({ seed: 6, count: 3, paid: 0 });
  withPhone(run, (p) => {
    for (let night = 1; night <= 8; night++) {
      run.st.night = night;
      const got = playNight(p, run, { paidAt: () => 0 });
      for (const m of got) if (m.thread === 'collector') {
        const before = p.heat();
        p.reply(m.id, 0);
        assert.equal(p.heat(), before, 'I\'ll pay is free');
      }
    }
    assert.equal(p.heat(), 0);
    for (let night = 9; night <= 20; night++) {
      run.st.night = night;
      const got = playNight(p, run, { paidAt: () => 0 });
      for (const m of got) if (m.thread === 'collector') {
        const before = p.heat();
        assert.equal(p.reply(m.id, 1), true);
        assert.equal(p.heat(), Math.min(6, before + 1));
        assert.ok(p.heat() >= 0 && p.heat() <= 6);
      }
    }
    assert.equal(p.heat(), 6, 'Heat caps at 6');
  });
});

// ── the Evening ──────────────────────────────────────────────────────────────────────────────────
test('onEvening: a warm margin gives +1 Harmony; a thin one gives -1 Harmony and +1 Heat; a quiet Night gives -1 Heat', () => {
  const run = mockRun({ seed: 8, due: 100, carried: 30 });
  withPhone(run, (p) => {
    assert.equal(p.harmony(), 3);
    p.onEvening();                       // 30 % over: warm
    assert.equal(p.harmony(), 4);
    assert.equal(p.heat(), 0, 'a quiet Night at Heat 0 stays at 0');
    run.st.carried = 0;                  // paid exactly: thin
    p.onEvening();
    assert.equal(p.harmony(), 3);
    assert.equal(p.heat(), 1);
    run.st.carried = 10;                 // 10 % over: neither warm nor thin. The Night after the thin one had no Heat change.
    p.onEvening();
    assert.equal(p.harmony(), 3);
    assert.equal(p.heat(), 0, 'a quiet Night cools the Heat by one');
  });
});

test('a Heat change during a Night stops that Night from cooling at its Evening', () => {
  const run = mockRun({ seed: 17, count: 3, paid: 0, carried: 10, due: 100 });
  const p = PH.createPhone(run);
  try {
    const got = playNight(p, run, { paidAt: () => 0 });
    const co = got.find((m) => m.thread === 'collector');
    assert.ok(co, 'a behind Night has a Collector message');
    assert.equal(p.reply(co.id, 1), true);     // "I need time": +1 Heat during the Night
    assert.equal(p.heat(), 1);
    p.onEvening();                              // 10 % over: neither warm nor thin, but Heat moved, so it stays
    assert.equal(p.heat(), 1);
    p.onEvening();                              // the next Night quiet: it cools
    assert.equal(p.heat(), 0);
  } finally {
    p.dispose();
  }
});

test('bounds: Harmony stays within 0..5 and Heat within 0..6 under any run of Evenings', () => {
  const run = mockRun({ seed: 9, due: 100, carried: 0 });
  withPhone(run, (p) => {
    for (let i = 0; i < 12; i++) {
      p.onEvening();
      assert.ok(p.harmony() >= 0 && p.harmony() <= 5, `harmony ${p.harmony()}`);
      assert.ok(p.heat() >= 0 && p.heat() <= 6, `heat ${p.heat()}`);
    }
    assert.equal(p.harmony(), 0);
    assert.equal(p.heat(), 6);
    run.st.carried = 100;
    for (let i = 0; i < 12; i++) {
      p.onEvening();
      assert.ok(p.harmony() >= 0 && p.harmony() <= 5);
    }
    assert.equal(p.harmony(), 5);
  });
});

test('talk: lines by Harmony; the first talk of an Evening grants blessed at Harmony 4 or more, once', () => {
  const run = mockRun({ seed: 10, due: 100, carried: 30 });
  withPhone(run, (p) => {
    const low = p.talk();                // Harmony 3: no blessing
    assert.equal(run.log.buffs.length, 0);
    assert.deepEqual(low.map((l) => l.key), ['phone.talk.h3.1', 'phone.talk.h3.2']);
    p.onEvening();                       // warm: Harmony 4, a new Evening
    const first = p.talk();
    assert.equal(run.log.buffs.length, 1, 'the first talk grants the blessing');
    assert.equal(run.log.buffs[0].id, 'blessed');
    assert.deepEqual(run.log.buffs[0].o.source, { kind: 'phone', id: 'spouse' });
    assert.ok(first.some((l) => l.key === 'phone.talk.bless'));
    p.talk();
    p.talk();
    assert.equal(run.log.buffs.length, 1, 'no second blessing in the same Evening');
    p.onEvening();                       // another Evening: the next first talk grants it again
    p.talk();
    assert.equal(run.log.buffs.length, 2);
  });
});

// ── save and restore ─────────────────────────────────────────────────────────────────────────────
test('snapshot/restore round trip: a Watch cut in half arrives exactly as one that was never cut', () => {
  const seedRun = () => mockRun({ seed: 12, count: 3, watch: 1, phase: 'play', paid: 0 });
  // the uninterrupted phone
  const r0 = seedRun();
  const whole = withPhone(r0, (p) => { for (let t = 0; t < 170; t++) p.tick(1); return JSON.stringify(p.messages()); });
  // the cut phone: 40 s, snapshot, a new phone from the snapshot, the rest of the Watch
  const r1 = seedRun();
  const pa = PH.createPhone(r1);
  for (let t = 0; t < 40; t++) pa.tick(1);
  const snap = JSON.parse(JSON.stringify(pa.snapshot()));
  pa.dispose();
  const pb = PH.createPhone(seedRun());
  pb.restore(snap);
  for (let t = 40; t < 170; t++) pb.tick(1);
  const cut = JSON.stringify(pb.messages());
  pb.dispose();
  assert.equal(cut, whole);
});

test('snapshot/restore keeps Harmony, Heat, replies and the one-per-Night rule', () => {
  const run = mockRun({ seed: 13, count: 3, paid: 0, coins: 500, due: 100 });
  const p = PH.createPhone(run);
  playNight(p, run, { paidAt: () => 0 });
  p.onEvening();
  const snap = p.snapshot();
  const q = PH.createPhone(run);
  q.restore(snap);
  assert.equal(q.harmony(), p.harmony());
  assert.equal(q.heat(), p.heat());
  assert.deepEqual(q.messages(), p.messages());
  q.restore(undefined);
  assert.equal(q.harmony(), 3, 'an older save with no phone gives a fresh phone');
  assert.equal(q.messages().length, 0);
  p.dispose();
  q.dispose();
});

test('restore drops damaged entries and clamps the numbers', () => {
  const run = mockRun({ seed: 14 });
  const p = PH.createPhone(run);
  p.restore({ harmony: 99, heat: -4, msgs: [{ id: 'x' }, 'junk', null], spouseNight: 'no', plans: 'nope' });
  assert.equal(p.harmony(), 5);
  assert.equal(p.heat(), 0);
  assert.equal(p.messages().length, 0);
  p.dispose();
});

test('dispose stops the phone: no Watch plans after it', () => {
  const run = mockRun({ seed: 15, count: 3, watch: 1, paid: 0 });
  const p = PH.createPhone(run);
  p.dispose();
  p.dispose();   // safe to call twice
  run.st.phase = 'play';
  EV.bus.emit('shift:phase', { phase: 'play', index: 0 });
  for (let t = 0; t < 170; t++) p.tick(1);
  assert.equal(p.messages().length, 0);
});

// ── content and data ─────────────────────────────────────────────────────────────────────────────
test('the spouse has ten messages with two or three replies each, and every key is written in EN and TR', () => {
  const sp = PH.SPOUSE_MESSAGES;
  assert.ok(sp.length >= 10, `${sp.length} spouse messages`);
  for (const d of sp) {
    assert.ok(d.replies.length >= 2 && d.replies.length <= 3, `${d.id} has ${d.replies.length} replies`);
    for (const r of d.replies) assert.ok(r.harmony >= -1 && r.harmony <= 1, `${d.id} moves Harmony by ${r.harmony}`);
    for (const key of [`sp.${d.id}.t`, ...d.replies.map((_, i) => `sp.${d.id}.r${i}`)]) {
      assert.ok(key in STR.en, `en ${key}`);
      assert.ok(key in STR.tr, `tr ${key}`);
    }
  }
});

test('the Collector has at least eight lines, escalating in four stages, and both replies', () => {
  const lines = [];
  for (let stage = 0; stage < PH.COLLECTOR_STAGES; stage++) {
    for (let v = 0; v < PH.COLLECTOR_VARIANTS; v++) lines.push(`co.s${stage}.${v}`);
  }
  assert.ok(lines.length >= 8, `${lines.length} lines`);
  for (const key of [...lines, 'co.reply.pay', 'co.reply.time']) {
    assert.ok(key in STR.en, `en ${key}`);
    assert.ok(key in STR.tr, `tr ${key}`);
  }
});

test('talk lines exist for every Harmony, and the blessing line exists', () => {
  for (let h = 0; h <= 5; h++) {
    for (const n of [1, 2]) {
      assert.ok(`talk.h${h}.${n}` in STR.en, `en talk.h${h}.${n}`);
      assert.ok(`talk.h${h}.${n}` in STR.tr, `tr talk.h${h}.${n}`);
    }
  }
  assert.ok('talk.bless' in STR.en && 'talk.bless' in STR.tr);
});

test('the English and Turkish tables have the same keys, with a value for each', () => {
  const en = Object.keys(STR.en), tr = Object.keys(STR.tr);
  assert.deepEqual([...en].sort(), [...tr].sort());
  for (const k of en) {
    assert.ok(STR.en[k].length > 0 && STR.tr[k].length > 0, `empty ${k}`);
  }
  // a var in one language is in the other
  for (const k of en) {
    const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    assert.equal(vars(STR.en[k]), vars(STR.tr[k]), `placeholders differ for ${k}`);
  }
});

test('buffs: blessed is shifts n=1 with luck clamped per machine (never above a charm\'s budget); favoured is one Pawn reroll', () => {
  const byId = Object.fromEntries(BUFFS.BUFF_DATA.map((d) => [d.id, d]));
  const bl = byId.blessed, fv = byId.favoured;
  assert.ok(bl && fv, 'both buffs exist');
  assert.deepEqual(bl.duration, { kind: 'shifts', n: 1 });
  assert.deepEqual(fv.duration, { kind: 'shifts', n: 1 });
  assert.ok(bl.effects.length > 0, 'blessed has luck');
  for (const e of bl.effects) {
    assert.equal(e.hook, 'luck');
    assert.equal(e.op, 'add');
    const [machine] = e.scope.machines;
    assert.ok(e.value > 0 && e.value <= 2, `value ${e.value}`);
    assert.ok(e.value <= Math.floor((CHARMS.CHARM_LUCK_CAP[machine] ?? 0) / 2), `${machine} over its budget`);
  }
  // a machine with no luck budget gets no blessing luck
  assert.equal(bl.effects.some((e) => e.scope.machines.includes('roulette')), false);
  assert.deepEqual(fv.effects, [{ hook: 'x.pawn.freeRerolls', op: 'add', value: 1 }]);
  for (const d of [bl, fv]) {
    assert.ok(d.strings.en.name && d.strings.en.desc && d.strings.tr.name && d.strings.tr.desc, `${d.id} needs EN and TR`);
  }
});

test('replyCoinCost is zero for words and the stored cost for a send reply', () => {
  const run = mockRun({ seed: 16, count: 3, paid: 0, coins: 500, due: 100 });
  const { msg } = spouseWithSend();
  assert.ok(msg.vars.cost >= 1);
  const send = { ...msg, thread: 'spouse' };
  assert.equal(PH.replyCoinCost(send, 0), msg.vars.cost, 'send costs the stored price');
  assert.equal(PH.replyCoinCost(send, 1), 0, 'a word costs nothing');
  assert.equal(PH.replyCoinCost({ ...msg, thread: 'collector' }, 0), 0);
  assert.equal(run.st.coins, 500);
});
