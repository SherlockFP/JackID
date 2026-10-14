// Unit + integration tests for the Hotline phone bargains (src/game/hotline.ts, strings in hotline.strings.ts).
// Deals are applied to a REAL run (createRun) so the buffs fold through the real mod() pipeline; the scheduling and
// save/restore tests use a small mock RunApi so seeds, Nights and Watches can be set freely.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let HL, STR, RUN, EV, R;
before(async () => {
  HL = await load('src/game/hotline.ts');
  STR = (await load('src/game/hotline.strings.ts')).default;
  RUN = await load('src/game/run.ts');
  EV = await load('src/core/events.ts');
  R = await load('src/core/rng.ts');
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
const noop = () => {};
/** A minimal RunApi: only what the Hotline reads. `o.mods` maps hook -> (base) => value. */
function mockRun(o = {}) {
  const buffs = new Map();
  const defs = new Map();
  const log = { earned: [], spent: [], dread: [], charms: [], jackpot: [] };
  const run = {
    seed: o.seed ?? 1, selfId: 1, log,
    night: () => o.night ?? 1,
    shift: { state: () => ({ segment: { index: o.watch ?? 0, count: o.count ?? 3 }, duration: o.duration ?? 150, stake: 1 }), quota: () => ({ due: 300 }), extend: noop },
    mod: (hook, _m, base) => (o.mods && o.mods[hook] ? o.mods[hook](base) : base),
    buffs: {
      def: (id) => defs.get(id), register: (d) => { defs.set(d.id, d); return noop; },
      add: (id) => { buffs.set(id, true); }, cleanse: noop,
    },
    charms: () => [], grantCharm: (id) => { log.charms.push(id); return true; },
    wallet: () => o.wallet ?? 100, balance: (c) => (c === 'ticket' ? (o.tickets ?? 6) : 100),
    spend: (c, n) => { log.spent.push([c, n]); return true; }, earn: (c, n) => { log.earned.push([c, n]); },
    addDread: (d) => { log.dread.push(d); }, dread: () => o.dread ?? 0.3,
    jackpot: () => 100, jackpotAdd: (p, n) => { log.jackpot.push([p, n]); }, stat: () => 0,
  };
  return run;
}
const phases = (phase) => EV.bus.emit('shift:phase', { phase, index: 0 });
const capture = (name) => { const got = []; const off = EV.bus.on(name, (e) => got.push(e)); return { got, off }; };

/** Starts a Watch on `hl` and returns the scheduled ring time (or -1). */
function startWatch(hl) { phases('play'); return hl.scheduledAt(); }
function ringOf(hl) { const s = startWatch(hl); if (s < 0) return null; for (let t = 0; t < 400 && !hl.phone(); t += 1) hl.tick(1); return hl.phone(); }

// ── scheduling ───────────────────────────────────────────────────────────────────────────────────────
test('ring chance is ~45 % per Watch on Night 1 and deterministic per (seed, Night, Watch)', () => {
  let rang = 0;
  const N = 600;
  for (let seed = 1; seed <= N; seed++) {
    const hl = HL.createHotline(mockRun({ seed }));
    if (startWatch(hl) >= 0) rang++;
    phases('settle'); hl.dispose();
  }
  assert.ok(rang / N > 0.38 && rang / N < 0.52, `rate ${rang / N}`);
  const a = HL.createHotline(mockRun({ seed: 9 })), b = HL.createHotline(mockRun({ seed: 9 }));
  assert.equal(startWatch(a), startWatch(b));
  phases('settle'); a.dispose(); b.dispose();
});

test('the call lands between 20 % and 65 % of the Watch clock', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const hl = HL.createHotline(mockRun({ seed, mods: { 'x.phone.callChance': () => 1 } }));
    const at = startWatch(hl);
    assert.ok(at >= 150 * 0.2 - 1e-9 && at <= 150 * 0.65 + 1e-9, `seed ${seed}: ${at}`);
    phases('settle'); hl.dispose();
  }
});

test('from Night 2 the last Watch rings if nothing rang earlier; Night 1 has no guarantee; mute silences everything', () => {
  const zero = { 'x.phone.callChance': () => 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const n2 = HL.createHotline(mockRun({ seed, night: 2, watch: 2, count: 3, mods: zero }));
    assert.ok(startWatch(n2) >= 0, 'N2 last watch rings');
    phases('settle'); n2.dispose();
    const early = HL.createHotline(mockRun({ seed, night: 2, watch: 0, count: 3, mods: zero }));
    assert.equal(startWatch(early), -1, 'N2 first watch has no guarantee');
    phases('settle'); early.dispose();
    const n1 = HL.createHotline(mockRun({ seed, night: 1, watch: 2, count: 3, mods: zero }));
    assert.equal(startWatch(n1), -1, 'N1 has no guarantee');
    phases('settle'); n1.dispose();
    const mute = HL.createHotline(mockRun({ seed, night: 2, watch: 2, count: 3, mods: { ...zero, 'x.phone.mute': () => 1 } }));
    assert.equal(startWatch(mute), -1, 'muted');
    phases('settle'); mute.dispose();
  }
  // a Night that already rang does not force a second call
  const run = mockRun({ seed: 3, night: 2, watch: 0, count: 3, mods: { 'x.phone.callChance': () => 1 } });
  const hl = HL.createHotline(run);
  assert.ok(ringOf(hl)); phases('settle');
  run.shift.state = () => ({ segment: { index: 2, count: 3 }, duration: 150, stake: 1 });
  run.mod = (h, _m, b) => (h === 'x.phone.callChance' ? 0 : b);
  assert.equal(startWatch(hl), -1, 'already rang this Night');
  phases('settle'); hl.dispose();
});

// ── the call ─────────────────────────────────────────────────────────────────────────────────────────
test('a call has 3 distinct deals, rings 10 s (+ringTime) and then goes dead', () => {
  const ev = capture('phone:ring'), end = capture('phone:end'), res = capture('hotline:result');
  const hl = HL.createHotline(mockRun({ seed: 5, night: 3, mods: { 'x.phone.callChance': () => 1 } }), { now: () => 1234 });
  const call = ringOf(hl);
  assert.ok(call);
  assert.equal(call.target, 0);
  assert.equal(call.answeredBy, null);
  assert.equal(call.ringingSince, 1234);
  assert.equal(call.options.length, 3);
  assert.equal(new Set(call.options.map((o) => HL.decodeOption(o).id)).size, 3);
  assert.equal(ev.got.length, 1);
  hl.tick(9.5); assert.ok(hl.phone(), 'still ringing at 9.5 s');
  hl.tick(1); assert.equal(hl.phone(), null);
  assert.equal(end.got.length, 1);
  assert.equal(res.got[0].kind, 'missed');
  phases('settle'); hl.dispose(); ev.off(); end.off(); res.off();

  const tin = HL.createHotline(mockRun({ seed: 5, mods: { 'x.phone.callChance': () => 1, 'x.phone.ringTime': (b) => b + 6 } }));
  assert.ok(ringOf(tin));
  tin.tick(12); assert.ok(tin.phone(), 'Tin Whistle: still ringing at 12 s');
  tin.tick(5); assert.equal(tin.phone(), null);
  phases('settle'); tin.dispose();
});

test('pick up, then choose: result event, call ends, bad choices are ignored', () => {
  const res = capture('hotline:result'), end = capture('phone:end');
  const run = mockRun({ seed: 11, night: 1, mods: { 'x.phone.callChance': () => 1 } });
  const hl = HL.createHotline(run);
  const call = ringOf(hl);
  hl.answer(0); assert.ok(hl.phone(), 'choosing before pick-up does nothing');
  hl.answer(-1);
  assert.equal(hl.phone().answeredBy, 1);
  hl.answer(7); hl.answer(-2); hl.answer(1.5);
  assert.ok(hl.phone(), 'out-of-range choices do nothing');
  const id = HL.decodeOption(call.options[2]).id;
  hl.answer(2);
  assert.equal(hl.phone(), null);
  assert.equal(res.got.length, 1);
  assert.equal(res.got[0].kind, 'deal');
  assert.equal(res.got[0].deal, id);
  assert.equal(end.got.length, 1);
  hl.answer(0); assert.equal(res.got.length, 1, 'no call, no second deal');
  phases('settle'); hl.dispose(); res.off(); end.off();
});

test('15 s after pick-up the call is declined; closing/settle cuts the line', () => {
  const res = capture('hotline:result');
  const hl = HL.createHotline(mockRun({ seed: 12, mods: { 'x.phone.callChance': () => 1 } }));
  ringOf(hl); hl.answer(-1);
  hl.tick(14.5); assert.ok(hl.phone());
  hl.tick(1); assert.equal(hl.phone(), null);
  assert.equal(res.got.at(-1).kind, 'declined');
  phases('settle');
  const hl2 = HL.createHotline(mockRun({ seed: 13, mods: { 'x.phone.callChance': () => 1 } }));
  ringOf(hl2); phases('closing');
  assert.equal(hl2.phone(), null);
  assert.equal(res.got.at(-1).kind, 'missed');
  phases('settle'); hl.dispose(); hl2.dispose(); res.off();
});

test('offers are deterministic for a seed and vary across seeds', () => {
  const offersOf = (seed) => {
    const hl = HL.createHotline(mockRun({ seed, night: 4, mods: { 'x.phone.callChance': () => 1 } }));
    const c = ringOf(hl); phases('settle'); hl.dispose();
    return c.options.join('#');
  };
  assert.equal(offersOf(21), offersOf(21));
  const seen = new Set(); for (let s = 1; s <= 30; s++) seen.add(offersOf(s));
  assert.ok(seen.size > 15, `only ${seen.size} different calls in 30 seeds`);
});

test('every deal shows up eventually and the pool has 12+ deals', () => {
  assert.ok(HL.DEALS.length >= 12);
  const seen = new Set();
  for (let s = 1; s <= 300 && seen.size < HL.DEALS.length; s++) {
    const hl = HL.createHotline(mockRun({ seed: s, night: 5, mods: { 'x.phone.callChance': () => 1 }, dread: 0.5 }), { host: { previewNextHot: () => null, creditQuota: noop, addPulls: noop } });
    const c = ringOf(hl); phases('settle'); hl.dispose();
    for (const o of c.options) seen.add(HL.decodeOption(o).id);
  }
  assert.deepEqual([...seen].sort(), HL.DEALS.map((d) => d.id).sort());
});

test('Coiled Cord: deals cost less (dealCost x0.75 on pocket %, Dread and Tickets)', () => {
  const find = (mods) => {
    const c = { run: mockRun({ mods }), host: { addPulls: noop }, night: 3, rng: R.createRng(1) };
    const k = Math.max(0.25, mods?.['x.phone.dealCost']?.(1) ?? 1);
    c.cost = (x) => Math.max(1, Math.round(x * k));
    return c;
  };
  const base = find({}), cord = find({ 'x.phone.dealCost': (b) => b * 0.75 });
  const dealt = (id, c) => HL.DEALS.find((d) => d.id === id).offer(c);
  assert.equal(dealt('overtime', base).d, 15);
  assert.equal(dealt('overtime', cord).d, 11);
  assert.equal(dealt('double', cord).p, 8);
  assert.equal(dealt('time', cord).t, 2);
  // and through the module itself
  const hl = HL.createHotline(mockRun({ seed: 2, mods: { 'x.phone.callChance': () => 1, 'x.phone.dealCost': (b) => b * 0.75 } }), { host: { addPulls: noop } });
  const call = ringOf(hl); phases('settle'); hl.dispose();
  for (const o of call.options) {
    const d = HL.decodeOption(o);
    if (d.id === 'overtime') assert.equal(d.v.d, 11);
    if (d.id === 'double') assert.equal(d.v.p, 8);
  }
});

// ── save and restore ─────────────────────────────────────────────────────────────────────────────────
test('snapshot is JSON-safe; restore resumes the same call and the same deal', () => {
  const run = mockRun({ seed: 31, night: 3, mods: { 'x.phone.callChance': () => 1 } });
  const a = HL.createHotline(run);
  const call = ringOf(a); a.tick(3); a.answer(-1); a.tick(2);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  assert.deepEqual(snap, a.snapshot());
  const run2 = mockRun({ seed: 31, night: 3, mods: { 'x.phone.callChance': () => 1 } });
  const b = HL.createHotline(run2);
  b.restore(snap);
  assert.deepEqual(b.phone(), a.phone());
  assert.equal(b.phone().id, call.id);
  const resA = capture('hotline:result');
  a.answer(1); b.answer(1);
  assert.deepEqual(run2.log, run.log, 'the same deal applied the same way');
  assert.equal(resA.got.length, 2);
  assert.deepEqual(resA.got[0].vars, resA.got[1].vars);
  // a restored, unanswered call keeps its ring clock
  const c = HL.createHotline(mockRun({ seed: 41, mods: { 'x.phone.callChance': () => 1 } }));
  ringOf(c); c.tick(6);
  const d = HL.createHotline(mockRun({ seed: 41, mods: { 'x.phone.callChance': () => 1 } }));
  d.restore(c.snapshot());
  d.tick(3.9); assert.ok(d.phone());
  d.tick(0.2); assert.equal(d.phone(), null);
  d.restore(null); assert.equal(d.phone(), null);
  phases('settle'); a.dispose(); b.dispose(); c.dispose(); d.dispose(); resA.off();
});

// ── strings ──────────────────────────────────────────────────────────────────────────────────────────
test('EN and TR tables cover every deal, call line and note, with the same {vars}', () => {
  const keysEn = Object.keys(STR.en).sort(), keysTr = Object.keys(STR.tr).sort();
  assert.deepEqual(keysEn, keysTr);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of keysEn) assert.equal(vars(STR.en[k]), vars(STR.tr[k]), `placeholders of ${k}`);
  for (const d of HL.DEALS) for (const part of ['name', 'boon', 'cost']) assert.ok(STR.en[`deal.${d.id}.${part}`], `deal.${d.id}.${part}`);
  for (let i = 1; i <= HL.CALL_LINES; i++) assert.ok(STR.en[`call.${i}`]);
  for (const n of ['struck', 'charm', 'lamp', 'noPeg', 'noLamp', 'noTickets', 'missed', 'declined']) assert.ok(STR.en[`note.${n}`], n);
  assert.equal(STR.prefix, 'hotline.');
});

test('every {var} of a deal text is supplied by its offer; option strings round-trip', () => {
  const run = mockRun({ night: 5, dread: 0.5 });
  const c = { run, host: { addPulls: noop, creditQuota: noop, previewNextHot: () => null }, night: 5, rng: R.createRng(3), cost: (x) => x };
  for (const d of HL.DEALS) {
    const v = d.offer(c);
    for (const part of ['name', 'boon', 'cost']) {
      for (const lang of ['en', 'tr']) {
        for (const m of STR[lang][`deal.${d.id}.${part}`].matchAll(/\{(\w+)\}/g)) assert.ok(m[1] in v, `${d.id}.${part} (${lang}) needs {${m[1]}}`);
      }
    }
    const back = HL.decodeOption(HL.encodeOption({ id: d.id, v }));
    assert.equal(back.id, d.id);
    assert.deepEqual(back.v, v);
  }
});

// ── each deal applied to a REAL run ──────────────────────────────────────────────────────────────────
function realCtx(host = {}, seed = 7) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  const hl = HL.createHotline(run, { host });          // registers the buffs
  return { run, hl, host, ctx: { run, host, night: 3, rng: R.createRng(5), cost: (x) => x } };
}
const deal = (id) => HL.DEALS.find((d) => d.id === id);
const take = (id, ctx) => deal(id).apply(ctx, deal(id).offer({ ...ctx, rng: R.createRng(5) }));
const win = (run, gross = 5) => EV.bus.emit('machine:result', { mid: 'B01', machineId: 'bigone', pid: run.selfId, bet: 1, gross, credited: gross, tier: 'small', tags: [] });
const mult = (run) => run.mod('payout.mult', 'bigone', 1);
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('deal overtime: +2 pulls through the host (or 6 Tickets without one), +15 Dread', () => {
  const pulls = [];
  const r = realCtx({ addPulls: (n) => pulls.push(n) });
  const d0 = r.run.dread();
  take('overtime', r.ctx);
  assert.deepEqual(pulls, [2]);
  assert.ok(r.run.dread() > d0);
  r.run.dispose();
  const f = realCtx({}); const t0 = f.run.balance('ticket');
  take('overtime', f.ctx);
  assert.equal(f.run.balance('ticket'), t0 + 6);
  f.run.dispose();
});

test('deal double: lose 10 % of the pocket, the next win pays x2 and only that one', () => {
  const { run, ctx } = realCtx();
  run.earn('coin', 100 - run.wallet(), 't');                            // 100 in the pocket
  take('double', ctx);
  assert.equal(run.wallet(), 90);
  approx(mult(run), 2);
  win(run);
  approx(mult(run), 1);
  run.dispose();
});

test('deal rare: a free Rare charm, interest -1 % until Dawn', () => {
  const { run, ctx } = realCtx();
  const before = run.charms().length;
  const res = take('rare', ctx);
  assert.equal(res.ok, true);
  assert.equal(run.charms().length, before + 1);
  assert.equal(run.mod('x.econ.interestAdd', 'run', 0), -0.01);
  EV.bus.emit('run:window', { window: 'dawn', night: 3 });
  assert.equal(run.mod('x.econ.interestAdd', 'run', 0), 0, 'ended at Dawn');
  run.dispose();
});

test('deal lamp: names the next Hot Lamp and costs Dread; with no Lamp the deal is off and free', () => {
  const hot = realCtx({ previewNextHot: () => ({ mid: 'B07', machineId: 'bandit' }) });
  const d0 = hot.run.dread();
  const res = take('lamp', hot.ctx);
  assert.equal(res.ok, true);
  assert.equal(res.vars.machine, '@m.bandit.name');
  assert.ok(hot.run.dread() > d0);
  hot.run.dispose();
  const none = realCtx({ previewNextHot: () => null });
  const e0 = none.run.dread();
  const off = take('lamp', none.ctx);
  assert.equal(off.ok, false);
  assert.equal(none.run.dread(), e0);
  none.run.dispose();
});

test('deal launder: spends 3 Tickets and credits 5 % of the quota through the host', () => {
  const paid = [];
  const { run, ctx } = realCtx({ creditQuota: (n) => paid.push(n) });
  run.earn('ticket', 5, 't');
  const t0 = run.balance('ticket');
  take('launder', ctx);
  assert.equal(run.balance('ticket'), t0 - 3);
  assert.deepEqual(paid, [Math.max(1, Math.round(run.shift.quota().due * 0.05))]);
  run.dispose();
});

test('deal cursed: a cursed charm and double its sign-on fee', () => {
  const { run, ctx } = realCtx();
  const c0 = run.wallet();
  const v = deal('cursed').offer({ ...ctx, rng: R.createRng(5) });
  assert.ok(v.fee > 0);
  const res = deal('cursed').apply(ctx, v);
  assert.equal(res.ok, true);
  assert.ok(run.charms().some((c) => c.id === v.c));
  assert.equal(run.wallet(), c0 + v.fee);
  run.dispose();
});

test('deal luck: +3 luck and payouts x0.9 for this Watch only', () => {
  const { run, ctx } = realCtx();
  take('luck', ctx);
  assert.equal(run.mod('luck', 'bigone', 0), 3);
  approx(mult(run), 0.9);
  EV.bus.emit('shift:phase', { phase: 'settle', index: 0 });
  assert.equal(run.mod('luck', 'bigone', 0), 0);
  approx(mult(run), 1);
  run.dispose();
});

test('deal cheap: bets cost 20 % less and you walk 15 % slower this Watch', () => {
  const { run, ctx } = realCtx();
  take('cheap', ctx);
  approx(run.mod('bet.costMult', 'bigone', 1), 0.8);
  approx(run.mod('player.moveSpeed', 'bigone', 1), 0.85);
  EV.bus.emit('shift:phase', { phase: 'settle', index: 0 });
  approx(run.mod('bet.costMult', 'bigone', 1), 1);
  run.dispose();
});

test('deal time: 3 Tickets for +30 s on the Watch clock', () => {
  const { run, ctx } = realCtx();
  run.earn('ticket', 5, 't');
  const t0 = run.balance('ticket');
  const res = take('time', ctx);
  assert.notEqual(res?.ok, false);
  assert.equal(run.balance('ticket'), t0 - 3);
  assert.ok(run.buffs.has('hotline.time'));
  run.dispose();
});

test('deal refund: losses refund 25 % this Watch for 5 % of the pocket', () => {
  const { run, ctx } = realCtx();
  run.earn('coin', 100 - run.wallet(), 't');
  take('refund', ctx);
  assert.equal(run.wallet(), 95);
  approx(run.mod('loss.refund', 'bigone', 0), 0.25);
  run.dispose();
});

test('deal calm: Dread -25 for 12 % of the pocket', () => {
  const { run, ctx } = realCtx();
  run.earn('coin', 100 - run.wallet(), 't');
  run.addDread(60, 't');
  const d0 = run.dread();
  take('calm', ctx);
  assert.equal(run.wallet(), 88);
  approx(run.dread(), d0 - 0.25);
  run.dispose();
});

test('deal advance: 6 % of the quota in coins now, payouts x0.92 until Dawn', () => {
  const { run, ctx } = realCtx();
  const c0 = run.wallet();
  const v = deal('advance').offer({ ...ctx, rng: R.createRng(5) });
  assert.equal(v.c, Math.max(5, Math.round(run.shift.quota().due * 0.06)));
  deal('advance').apply(ctx, v);
  assert.equal(run.wallet(), c0 + v.c);
  approx(mult(run), 0.92);
  EV.bus.emit('shift:phase', { phase: 'settle', index: 0 });
  approx(mult(run), 0.92);                              // the Watch ending does not lift it
  EV.bus.emit('run:window', { window: 'dawn', night: 1 });
  approx(mult(run), 1);
  run.dispose();
});

test('deal jackpot: the network pool gains 30 %, +10 Dread', () => {
  const { run, ctx } = realCtx();
  run.jackpotAdd('net', 100, 't');
  const p0 = run.jackpot('net');
  const v = deal('jackpot').offer({ ...ctx, rng: R.createRng(5) });
  assert.equal(v.a, Math.round(p0 * 0.3));
  deal('jackpot').apply(ctx, v);
  assert.equal(run.jackpot('net'), p0 + v.a);
  run.dispose();
});

test('deal hothands: the next 3 wins pay x1.5 (not a 4th); bets cost 15 % more this Watch', () => {
  const { run, ctx } = realCtx();
  take('hothands', ctx);
  approx(mult(run), 1.5);
  approx(run.mod('bet.costMult', 'bigone', 1), 1.15);
  win(run); win(run); approx(mult(run), 1.5);
  win(run); approx(mult(run), 1);
  run.dispose();
});

test('deal devil: the next win pays x3 for +25 Dread and 20 % of the pocket', () => {
  const { run, ctx } = realCtx();
  run.earn('coin', 100 - run.wallet(), 't');
  const d0 = run.dread();
  take('devil', ctx);
  assert.equal(run.wallet(), 80);
  approx(run.dread(), d0 + 0.25);
  approx(mult(run), 3);
  win(run); approx(mult(run), 1);
  run.dispose();
});

// ── the real run, end to end ─────────────────────────────────────────────────────────────────────────
test('real Watch: with the Coiled Cord the phone rings, the deal is struck, the line dies at Settle', () => {
  const run = RUN.createRun({ seed: 99, mode: 'debt' });
  assert.equal(run.grantCharm('coiled_cord'), true);
  const hl = HL.createHotline(run, { host: { addPulls: noop } });
  const ring = capture('phone:ring'), res = capture('hotline:result'), end = capture('phone:end');
  assert.equal(run.startWatch(), true);
  let call = null;
  for (let i = 0; i < 600 && !call; i++) { run.tick(0.5); hl.tick(0.5); call = hl.phone(); }
  assert.ok(call, 'the phone rang inside the first Watch');
  assert.equal(run.shift.phase === 'play' || run.shift.phase === 'lastCall', true);
  assert.equal(ring.got.length, 1);
  hl.answer(-1);
  hl.answer(0);
  assert.equal(hl.phone(), null);
  assert.equal(res.got.length, 1);
  assert.equal(res.got[0].kind, 'deal');
  assert.equal(end.got.length, 1);
  for (let i = 0; i < 1200 && run.shift.phase !== 'settle'; i++) { run.tick(1); hl.tick(1); }
  assert.equal(hl.phone(), null);
  ring.off(); res.off(); end.off(); hl.dispose(); run.dispose();
});
