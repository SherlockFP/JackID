// LOKI'S HAND in the run (docs/JOKER.md §2.2, §4, wave J3): giving him the hand costs Ink and makes the next round at that seat his
// (10 x the stake, capped by the quota, tagged 'joker'); one a Watch; at high Ink he takes it unasked on a big bet, Ada's hair tie slips
// the first one a Night and coffee blocks the next Watch; the symptom tiers; Ink 10 ends the run at HE CAME HOME; the save keeps it all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, KM, J, TK, S, SAVE;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  KM = await load('src/core/keymap.ts');
  J = await load('src/game/joker/joker.ts');
  TK = await load('src/game/joker/takeover.ts');
  S = (await load('src/core/ui/manga/joker.strings.ts')).default;
  SAVE = await load('src/core/save.ts');
  REG.load();
});

const KINDS = ['coinflip', 'bigone', 'debt_terminal'];
function floorRun(seed = 51) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.index = 1;   // Night 2: Loki is silent on Night 1
  run.attachWorld({ machines: () => KINDS.map((k) => ({ instance: `m-${k}`, machineId: k })), instancePos: () => undefined });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  return run;
}
function heard(names) {
  const got = [];
  const offs = names.map((n) => EV.bus.on(n, (d) => got.push([n, d])));
  return { got, off: () => offs.forEach((o) => o()) };
}
const seat = (run, k, on = true) => EV.bus.emit('player:seat', { pid: run.selfId, mid: `m-${k}`, seat: 0, on });
const src = (k) => ({ mid: `m-${k}`, machineId: k });
/** One paid round at `k` that the machine itself lost (gross 0); a big stake takes the confirm press. */
function round(run, k, bet) {
  if (!run.bet(bet, src(k))) assert.ok(run.bet(bet, src(k)), `bet ${bet} at ${k}: ${run.lastRefusal()}`);
  return run.win(0, src(k), { bet, tier: 'none' });
}

test('asked: Ink +2, the next round at that seat is a big win of 10 x the stake, tagged joker; one a Watch', () => {
  const run = floorRun();
  assert.equal(run.jokerTakeover(), 'seat', 'not seated');
  seat(run, 'debt_terminal');
  assert.equal(run.jokerTakeover(), 'seat', 'the Debt Terminal is not his');
  seat(run, 'coinflip');
  const h = heard(['joker:takeover', 'machine:result', 'luck:change']);
  const ink = run.jokerInk();
  assert.equal(run.jokerTakeover(), null);
  assert.equal(run.jokerInk(), ink + 2);
  const tk = h.got.find(([n]) => n === 'joker:takeover')[1];
  assert.equal(tk.asked, true); assert.equal(tk.tag, 'joker');
  const credited = round(run, 'coinflip', 5);
  assert.equal(credited, TK.takeoverPayout(5, run.quota.due));
  assert.ok(credited > 5, 'a lost pull became his win');
  const res = h.got.find(([n]) => n === 'machine:result')[1];
  assert.ok(res.tags.includes('joker'));
  assert.equal(res.tier, 'big');
  assert.equal(h.got.filter(([n]) => n === 'luck:change').length, 0, 'his round earns no star');
  assert.equal(round(run, 'coinflip', 5), 0, 'only one round is his');
  seat(run, 'bigone');
  assert.equal(run.jokerTakeover(), 'cooldown', 'one hand a Watch');
  h.off(); run.dispose();
});

test('unasked at Ink 8: a big bet rolls his hand (seeded), the hair tie slips the first one a Night, coffee blocks the next Watch', () => {
  const strike = (run, n = 60) => {
    const h = heard(['joker:takeover', 'floor:say']);
    for (let i = 0; i < n && !h.got.length; i++) { run.coins = 40; round(run, 'coinflip', 20); }
    h.off();
    return h.got[0];
  };
  const run = floorRun(52);
  seat(run, 'coinflip');
  run.jokerSys.ink = 8;
  const first = strike(run);
  assert.equal(first[0], 'joker:takeover');
  assert.equal(first[1].asked, false);
  assert.equal(run.jokerInk(), 8 + J.UNASKED_INK);
  run.dispose();

  // the same seed with the hair tie on: the first strike slips off with his line and costs nothing
  const tied = floorRun(52);
  seat(tied, 'coinflip');
  assert.ok(tied.keepsakes.carry('ring'));   // chosen at home in the Evening
  tied.jokerSys.ink = 8;
  const slip = strike(tied);
  assert.equal(slip[0], 'floor:say');
  assert.equal(slip[1].source, 'joker');
  assert.equal(tied.jokerInk(), 8);
  tied.dispose();

  // coffee: drunk now, it blocks his hand for the next Watch
  const cup = floorRun(52);
  cup.buffs.add('food.coffee', { pid: cup.selfId, source: { kind: 'system', id: 'food' } });
  assert.equal(cup.jokerSys.snapshot().coffee, 1);
  cup.jokerSys.beginWatch(2);
  assert.equal(cup.jokerSys.coffeeOn, true);
  cup.dispose();
});

test('the symptom tiers by Ink', () => {
  const bands = [0, 2, 4, 6, 8, 10].map((i) => J.symptoms(i));
  assert.deepEqual(bands.map((s) => s.band), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(bands.map((s) => s.bleed), [false, false, true, true, true, true]);
  assert.deepEqual(bands.map((s) => s.hudLies), [false, false, false, true, true, true]);
  assert.deepEqual(bands.map((s) => s.talksAtHome), [false, false, false, false, true, true]);
  assert.deepEqual(bands.map((s) => s.unasked), [0, 0, 0, 0.1, 0.25, 0]);
});

test('Ink 10 ends the run: HE CAME HOME', () => {
  const run = floorRun(53);
  seat(run, 'coinflip');
  run.jokerSys.ink = 8;
  assert.equal(run.jokerTakeover(), null);
  assert.equal(run.jokerInk(), 10);
  assert.equal(run.endingRecord()?.id, 'he_came_home');
  run.dispose();
});

test('the save keeps the Ink and the Watch cooldown after a takeover', () => {
  const run = floorRun(54);
  seat(run, 'coinflip');
  assert.equal(run.jokerTakeover(), null);
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  const back = RUN.resumeRun({ data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} });
  assert.deepEqual(back.jokerSys.snapshot(), run.jokerSys.snapshot());
  assert.equal(back.jokerInk(), 2);
  run.dispose(); back.dispose();
});

test('key: I is free of every other binding and live while seated; strings EN and TR, no dashes', () => {
  assert.deepEqual(KM.EXTRA_BINDINGS.jokerHand, ['KeyI']);
  const used = Object.entries(KM.ALL_DEFAULTS).filter(([k]) => k !== 'jokerHand').flatMap(([, v]) => v);
  assert.ok(!used.includes('KeyI'));
  assert.ok(KM.SEATED_WALK_ACTIONS.has('jokerHand'));
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.tr).sort());
  for (const l of ['en', 'tr']) for (const v of Object.values(S[l])) assert.ok(!/[–—]/.test(v), v);
});
