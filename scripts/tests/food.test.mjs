// FOOD (src/game/food.ts): five small foods with one-Watch bonuses on the existing hooks, one food bonus at a time, a meal eaten
// during a Watch waits and starts with the next one, the fridge (Ada's stock, the market's deliveries, the cap, the save), soup with
// Ada (Harmony +1 once a Night), and the bar's food page mirrors the same prices and buff ids.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const F = await load('src/game/food.ts');
const B = await load('src/game/data/buffs.ts');
const R = await load('src/machines/tonic_vendor/rules.ts');
const STR = (await load('src/game/food.strings.ts')).default;

const buffDef = (id) => B.BUFF_DATA.find((b) => b.id === id);

test('every food has a name and a line in EN and TR, and the TR is not a copy of the EN', () => {
  for (const id of F.FOOD_IDS) {
    for (const k of ['name', 'desc']) {
      assert.ok(STR.en[`${id}.${k}`], `en ${id}.${k}`);
      assert.ok(STR.tr[`${id}.${k}`], `tr ${id}.${k}`);
    }
    assert.notEqual(STR.en[`${id}.name`], STR.tr[`${id}.name`], `${id} name is translated`);
  }
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
});

test('the four buff foods use existing hooks with the brief numbers, one Watch each', () => {
  const fx = (id) => buffDef(`food.${id}`).effects;
  assert.deepEqual(fx('banana'), [{ hook: 'x.run.pullsAdd', op: 'add', value: 1 }]);
  assert.deepEqual(fx('coffee'), [{ hook: 'x.tilt.grace', op: 'add', value: 1 }]);
  assert.deepEqual(fx('sandwich'), [{ hook: 'payout.mult', op: 'mult', value: 1.01 }]);   // one ŞANS star = 1 % (src/game/luck.ts)
  assert.deepEqual(fx('energy'), [{ hook: 'x.run.clockAdd', op: 'add', value: 15 }]);
  for (const id of ['banana', 'coffee', 'sandwich', 'energy']) {
    const d = buffDef(`food.${id}`);
    assert.deepEqual(d.duration, { kind: 'shifts', n: 1 }, `${id} lasts one Watch`);
    assert.equal(d.maxStacks, 1);
    assert.equal(d.kind, 'buff');
    assert.equal(d.exclusive, 'food');
    assert.ok(d.strings.en.name && d.strings.tr.name && d.strings.en.desc && d.strings.tr.desc);
  }
  // the numbers in food.ts are the ones the defs use
  assert.equal(F.FOOD_FX.pulls, 1);
  assert.equal(F.FOOD_FX.clockSec, 15);
  assert.equal(F.FOOD_FX.starPayout, 1.01);
});

test('soup has no timed bonus; the others are sold at low prices in ascending strength order', () => {
  assert.equal(F.FOODS.soup.buff, null);
  const prices = F.BAR_MENU.map((id) => F.FOODS[id].price);
  assert.deepEqual(F.BAR_MENU, ['banana', 'coffee', 'sandwich', 'energy']);
  assert.deepEqual(prices, [8, 14, 20, 28]);
  assert.ok(Math.max(...prices) <= 30, 'a snack stays cheaper than the cheapest tonic but one');
});

test('the bar food page mirrors the game prices and buff ids, and is clear of the tonic catalogue', () => {
  assert.equal(R.FOOD_SHELF.length, R.SLOTS);
  R.FOOD_SHELF.forEach((e, i) => {
    const id = F.BAR_MENU[i];
    assert.equal(e.id, F.FOODS[id].buff);
    assert.equal(e.price, F.FOODS[id].price);
    assert.equal(e.kind, 'food');
    assert.ok(buffDef(e.id), `${e.id} is a registered buff`);
  });
  assert.deepEqual([...R.FOOD_BUFF_IDS].sort(), [...F.FOOD_BUFFS, F.PENDING_BUFF].sort());
  assert.deepEqual(R.foodStock().map((o) => o.id), R.FOOD_SHELF.map((o) => o.id));
  // the tonic shelf is untouched by the food page
  for (const e of R.TONIC_CATALOGUE) assert.notEqual(e.kind, 'food');
  assert.equal(R.tonicStock(7, 3).length, R.SLOTS);
});

test('isWatchLive: the bell to the settle is a running Watch, the rest is not', () => {
  for (const p of ['bell', 'play', 'lastCall', 'closing', 'settle']) assert.equal(F.isWatchLive(p), true, p);
  for (const p of ['idle', 'collection', 'intermission', 'over']) assert.equal(F.isWatchLive(p), false, p);
});

// ── the buff callbacks on a fake run ──────────────────────────────────────────────────────────────────────────────────
function fakeRun(phase) {
  const list = [];
  const run = {
    selfId: 1,
    shift: { phase },
    list,
    buffs: {
      has: (id) => list.some((b) => b.id === id),
      add: (id, o = {}) => { list.push({ id, data: { ...(o.data ?? {}) } }); },
      remove: (id) => { const i = list.findIndex((b) => b.id === id); if (i >= 0) list.splice(i, 1); },
    },
  };
  return run;
}
const ctxFor = (run, id, data = {}) => {
  const st = { id, data: { ...data } };
  run.list.push(st);
  return { owner: 1, data: st.data, remove: () => { const i = run.list.indexOf(st); if (i >= 0) run.list.splice(i, 1); }, st };
};
const ids = (run) => run.list.map((b) => b.id);
const withRun = (_run, fn) => fn();

test('eaten between Watches the bonus is live at once, and it replaces the old food', () => {
  const run = fakeRun('intermission');
  run.list.push({ id: 'food.coffee', data: {} });
  withRun(run, () => { const c = ctxFor(run, 'food.banana'); F.onFoodAdded('food.banana', c, run); });
  assert.deepEqual(ids(run), ['food.banana']);
});

test('eaten at Dawn is live at once too', () => {
  const run = fakeRun('collection');
  withRun(run, () => { const c = ctxFor(run, 'food.energy'); F.onFoodAdded('food.energy', c, run); });
  assert.deepEqual(ids(run), ['food.energy']);
});

test('eaten during a Watch the meal waits as the hidden pending slot, then starts when the Watch is over', () => {
  const run = fakeRun('play');
  withRun(run, () => {
    const c = ctxFor(run, 'food.banana');
    F.onFoodAdded('food.banana', c, run);
    assert.deepEqual(ids(run), [F.PENDING_BUFF], 'the live buff is gone, the meal waits');
    assert.equal(run.list[0].data.food, 'banana');
    // still the Watch: the tick keeps it
    const wait = { owner: 1, data: run.list[0].data, remove: () => run.list.splice(0, 1) };
    F.onPendingTick(wait, run);
    assert.deepEqual(ids(run), [F.PENDING_BUFF]);
    run.shift.phase = 'settle';
    F.onPendingTick(wait, run);
    assert.deepEqual(ids(run), [F.PENDING_BUFF], 'the settle still belongs to the Watch');
    run.shift.phase = 'collection';
    F.onPendingTick(wait, run);
    assert.deepEqual(ids(run), ['food.banana'], 'the Watch is over: the real bonus starts');
    assert.equal(run.list[0].data.held, 1);
  });
});

test('a meal that comes out of the pending slot is not announced or replaced again', () => {
  const run = fakeRun('intermission');
  withRun(run, () => {
    const c = ctxFor(run, 'food.banana', { held: 1 });
    F.onFoodAdded('food.banana', c, run);
    assert.deepEqual(ids(run), ['food.banana']);
  });
});

test('one food bonus at a time: a second meal in a Watch replaces the waiting one', () => {
  const run = fakeRun('play');
  withRun(run, () => {
    F.onFoodAdded('food.banana', ctxFor(run, 'food.banana'), run);
    F.onFoodAdded('food.sandwich', ctxFor(run, 'food.sandwich'), run);
    assert.deepEqual(ids(run), [F.PENDING_BUFF]);
    assert.equal(run.list[0].data.food, 'sandwich');
  });
});

test('a meal in a Watch replaces a live bonus too (the old one goes, the new one waits)', () => {
  const run = fakeRun('lastCall');
  run.list.push({ id: 'food.coffee', data: {} });
  withRun(run, () => { F.onFoodAdded('food.energy', ctxFor(run, 'food.energy'), run); });
  assert.deepEqual(ids(run), [F.PENDING_BUFF]);
});

test('clearFoodBuffs removes every food buff and the waiting meal, and only those', () => {
  const run = fakeRun('intermission');
  for (const id of ['food.banana', F.PENDING_BUFF, 'blessed', 'tonic.lucky_mint']) run.list.push({ id, data: {} });
  F.clearFoodBuffs(run.buffs, 1);
  assert.deepEqual(ids(run), ['blessed', 'tonic.lucky_mint']);
});

// ── Ada's stock, the fridge ───────────────────────────────────────────────────────────────────────────────────────────
test('Ada leaves one snack every Night, and soup only while there is Harmony to keep', () => {
  let soups = 0;
  const N = 400;
  for (let n = 1; n <= N; n++) {
    const s = F.adaStock(99, n, 3);
    assert.ok(s.length >= 1 && s.length <= 2);
    assert.ok(['banana', 'sandwich', 'coffee'].includes(s[0]));
    if (s.includes('soup')) soups++;
    assert.deepEqual(F.adaStock(99, n, 3), s, 'seeded: same Night, same stock');
    assert.ok(!F.adaStock(99, n, 0).includes('soup'), 'Harmony 0: Ada is not home to cook');
    assert.ok(!F.adaStock(99, n, 5).includes('soup'), 'Harmony 5: nothing left to add');
    assert.deepEqual(F.adaStock(99, n, 1).includes('soup'), F.adaStock(99, n, 4).includes('soup'), 'the soup roll does not depend on the Harmony value');
  }
  const rate = soups / N;
  assert.ok(rate > 0.4 && rate < 0.6, `soup on about every other Night, got ${rate}`);
});

test('the fridge holds FRIDGE_MAX meals, refuses unknown ids and full shelves, and takes one at a time', () => {
  const f = F.createFridge();
  assert.equal(f.add('pizza'), false);
  for (let i = 0; i < F.FRIDGE_MAX; i++) assert.equal(f.add('banana'), true);
  assert.equal(f.add('soup'), false, 'full');
  assert.equal(f.count('banana'), F.FRIDGE_MAX);
  assert.equal(f.take('banana'), true);
  assert.equal(f.take('coffee'), false);
  assert.equal(f.items().length, F.FRIDGE_MAX - 1);
});

test('Ada restocks once a Night, and a reload keeps the fridge and the soup flag', () => {
  const f = F.createFridge();
  const first = f.restock(5, 1, 3);
  assert.ok(first.length >= 1);
  assert.deepEqual(f.restock(5, 1, 3), [], 'same Night: nothing more');
  const second = f.restock(5, 2, 3);
  assert.equal(f.items().length, first.length + second.length);
  f.markSoup(2);
  const g = F.createFridge();
  g.restore(JSON.parse(JSON.stringify(f.snapshot())));
  assert.deepEqual(g.items(), f.items());
  assert.equal(g.soupDone(2), true);
  assert.equal(g.soupDone(3), false);
  assert.deepEqual(g.restock(5, 2, 3), [], 'the Night stays stocked after a reload');
});

test('a damaged fridge save reads as an empty fridge', () => {
  const g = F.createFridge();
  for (const bad of [undefined, null, 7, 'x', { items: 'banana' }, { items: [1, 'pizza', null] }, { items: ['banana'], stocked: NaN }]) {
    g.restore(bad);
    assert.ok(g.items().every((i) => F.isFoodId(i)));
    assert.ok(g.items().length <= 1);
  }
});

test('the market delivers into the fridge with addToFridge', () => {
  const run = {};
  const off = F.mountFood({ seed: 1, selfId: 1, night: () => 1, buffs: fakeRun('intermission').buffs });
  try {
    assert.equal(F.addToFridge('soup'), true);
    assert.equal(F.addToFridge('nonsense'), false);
    assert.deepEqual(F.fridgeOf().items(), ['soup']);
    for (let i = 0; i < 20; i++) F.addToFridge('banana');
    assert.equal(F.fridgeOf().items().length, F.FRIDGE_MAX);
    void run;
  } finally { off(); }
});

// ── soup with Ada ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('soup: Ada not home waits, once a Night it is Harmony +1, again it is only a warm meal, at Harmony 5 nothing to add', () => {
  assert.equal(F.soupOutcome(0, false), 'alone');
  assert.equal(F.soupOutcome(0, true), 'alone');
  assert.equal(F.soupOutcome(3, false), 'warm');
  assert.equal(F.soupOutcome(1, false), 'warm');
  assert.equal(F.soupOutcome(4, false), 'warm');
  assert.equal(F.soupOutcome(3, true), 'plain');
  assert.equal(F.soupOutcome(5, false), 'plain');
});

test('Selim\'s bar: a tip is a small share of the quota (at least 1), PAY BACK shows only while he holds a loan he can take', () => {
  assert.equal(F.tipPrice(0), 1);
  assert.equal(F.tipPrice(1000), 30);
  assert.deepEqual(F.barRows({ owes: 0, forgot: false, still: false }), ['tip']);
  assert.deepEqual(F.barRows({ owes: 1, forgot: false, still: false }), ['tip', 'repay']);
  assert.deepEqual(F.barRows({ owes: 1, forgot: true, still: false }), ['tip'], 'he forgot you: nothing to pay back');
  assert.deepEqual(F.barRows({ owes: 2, forgot: false, still: true }), [], 'still: he takes nothing');
});
