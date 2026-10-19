// Wave C (docs/BLESSINGS.md §3, §6): the omens (Sigil, Till Rings, Late Reflection, Weeping Statue, the Lights Die) and the
// shrine's candle -> statue -> Favour rules. Pure rules plus WatchEvents with a fake host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let R, WE, OM, CT, SR, EV, I18N, BUFFS, CHARMS, PH, PAN;
before(async () => {
  R = await load('src/core/rng.ts');
  WE = await load('src/game/watchEvents.ts');
  OM = await load('src/game/events/omens.ts');
  CT = await load('src/game/events/crookedTable.ts');
  SR = await load('src/machines/shrine/rules.ts');
  EV = await load('src/core/events.ts');
  I18N = await load('src/core/i18n.ts');
  BUFFS = await load('src/game/data/buffs.ts');
  CHARMS = await load('src/game/data/charms.ts');
  PH = await load('src/game/home/phone.ts');
  PAN = await load('src/game/pantheon.ts');
  for (const m of ['src/game/events/omens.strings.ts', 'src/game/watchEvents.strings.ts', 'src/game/home/phone.strings.ts']) {
    const s = (await load(m)).default;
    I18N.registerStrings(s.prefix, { en: s.en, tr: s.tr });
  }
});

const FLOOR = { machines: ['coinflip', 'bigone', 'scratch', 'craps'], spotlight: 'scratch', lobby: { x: 0, z: 0 } };
const make = (fav = {}, extra = {}) => new WE.WatchEvents({
  isHot: () => false, touch: () => {}, floor: () => FLOOR, favour: (g) => fav[g] ?? 0, ...extra,
});
function beginUntil(we, id, night) {
  for (let w = 0; w < 6000; w++) {
    const def = we.begin(R.createRng(4242).fork(`omen.${id}.${night}.${w}`), night, w, false);
    if (def && def.id === id) return def;
    we.end();
  }
  throw new Error(`${id} never rolled`);
}
const collect = (we) => { const out = []; we.collect({}, out); return out.flatMap((s) => s.effects); };

test('pure rules: gates by Favour and Night', () => {
  assert.equal(OM.sigilReady(2, 3, 0, false), true);
  assert.equal(OM.sigilReady(1, 3, 0, false), false, 'Well Favour 2+');
  assert.equal(OM.sigilReady(2, 2, 0, false), false, 'Night 3+');
  assert.equal(OM.sigilReady(2, 3, 1, false), false, 'once a Night');
  assert.equal(OM.sigilReady(2, 3, 1, true), true, 'Moon in the Well: twice');
  assert.equal(OM.tillWeight(2), 2);
  assert.equal(OM.tillWeight(1), 1);
  assert.equal(OM.reflectionReady(2, 4), true);
  assert.equal(OM.reflectionReady(2, 3), false);
  assert.equal(OM.reflectionReady(1, 5), false);
});

test('the Lights Die: Night 3+, watched, and behind pace; never early in the Night, never when ahead', () => {
  const base = { night: 4, tier: 'watched', nightElapsed: 0.6, deposit: 100, quota: 1000 };
  assert.equal(OM.lightsDie(base), true);
  assert.equal(OM.lightsDie({ ...base, night: 2 }), false);
  assert.equal(OM.lightsDie({ ...base, tier: 'haunted' }), false);
  assert.equal(OM.lightsDie({ ...base, nightElapsed: 0.2 }), false, 'too early to judge the pace');
  assert.equal(OM.lightsDie({ ...base, deposit: 700 }), false, 'ahead of pace: the lights stay');
  assert.equal(OM.behindPace({ nightElapsed: 0.5, deposit: 500, quota: 1000 }), false, 'exactly on pace is not behind');
});

test('Till Rings: the cashier event rolls heavier at Ledgers Favour 2, and says so', () => {
  let plain = 0, heavy = 0;
  for (let k = 0; k < 4000; k++) {
    const a = WE.rollWatchEvent(R.createRng(31).fork(`t.${k}`), 3, false, null);
    const b = WE.rollWatchEvent(R.createRng(31).fork(`t.${k}`), 3, false, null, { cashier_bonus: OM.tillWeight(2) });
    if (a?.def.id === 'cashier_bonus') plain++;
    if (b?.def.id === 'cashier_bonus') heavy++;
  }
  assert.ok(heavy > plain * 1.3, `weighted ${heavy} vs plain ${plain}`);
  const said = [];
  const off = EV.bus.on('omen:fire', (e) => said.push(e.kind));
  try { beginUntil(make({ ledgers: 2 }), 'cashier_bonus', 3); } finally { off(); }
  assert.deepEqual(said, ['till']);
});

test('the Sigil: Well Favour 2 turns a single_light into x2 for 3 pulls with no play gate, once a Night', () => {
  const we = make({ well: 2 });
  const said = [];
  const off = EV.bus.on('omen:fire', (e) => said.push(e.kind));
  try {
    beginUntil(we, 'single_light', 3);
    assert.deepEqual(said, ['sigil']);
    const lit = we.litMachine();
    assert.ok(lit);
    assert.equal(we.allowsPlay('craps') && we.allowsPlay('coinflip'), true, 'the sigil gates nothing');
    const mult = collect(we).find((e) => e.hook === 'payout.mult');
    assert.equal(mult.value, OM.SIGIL_MULT);
    assert.deepEqual(mult.scope.machines, [lit]);
    assert.equal(we.view().pulls, 3);
    const other = FLOOR.machines.find((m) => m !== lit);
    we.onPull(other, false, 0, other);
    assert.equal(we.view().pulls, 3, 'pulls elsewhere do not count');
    we.onPull(lit, true, 5, lit); we.onPull(lit, false, -1, lit);
    assert.equal(we.view().pulls, 1);
    we.onPull(lit, true, 5, lit);
    assert.equal(we.view(), null, 'the third pull ends it');
    // the same Night: a second single_light is the plain, gated one
    beginUntil(we, 'single_light', 3);
    assert.equal(said.length, 1, 'no second sigil on Night 3');
    assert.equal(we.allowsPlay(FLOOR.machines.find((m) => m !== we.litMachine())), false);
    // the save keeps the count
    const save = JSON.parse(JSON.stringify(we.snapshot()));
    const we2 = make({ well: 2 });
    we2.restore(save);
    we2.end();
    beginUntil(we2, 'single_light', 3);
    assert.equal(said.length, 1, 'a reload does not give the Night a second sigil');
  } finally { off(); }
  // Moon in the Well: twice
  const moon = make({ well: 2 }, { fx: (k) => (k === 'omenTwice' ? 1 : 0) });
  const said2 = [];
  const off2 = EV.bus.on('omen:fire', (e) => said2.push(e.kind));
  try {
    beginUntil(moon, 'single_light', 3); moon.end();
    beginUntil(moon, 'single_light', 3);
  } finally { off2(); }
  assert.deepEqual(said2, ['sigil', 'sigil']);
});

test('no Favour, no omen: the same Watches roll plain events and say nothing', () => {
  const said = [];
  const off = EV.bus.on('omen:fire', (e) => said.push(e.kind));
  try { const we = make(); beginUntil(we, 'single_light', 3); beginUntil(we, 'cashier_bonus', 3); beginUntil(we, 'crooked_table', 4); } finally { off(); }
  assert.deepEqual(said, []);
});

test('the Late Reflection: Mirrors Favour 2 on Night 4+ shows the dealer habit at once; Clear Glass and Two Sets of Books read the hooks', () => {
  const said = [];
  const off = EV.bus.on('omen:fire', (e) => said.push(e.kind));
  try {
    const we = make({ mirrors: 2 }, { mod: (h, base) => (h === 'x.crooked.starAdd' ? 1 : h === 'x.crooked.payMult' ? 1.5 : base) });
    beginUntil(we, 'crooked_table', 4);
    assert.deepEqual(said, ['reflection']);
    const view = we.crookedView();
    for (const tb of view.tables) assert.ok(tb.tells.some((t) => t.channel === 'habit'), 'habit tell with no plays');
    const rig = collect(we).find((e) => e.hook === 'payout.mult');
    assert.ok(Math.abs(rig.value - CT.RIG_MULT * 1.5) < 1e-9, 'Two Sets of Books pays the rig x1.5 more');
    const cr = JSON.parse(JSON.stringify(we.snapshot())).aux.crooked;
    const r = we.callCheat(cr.tables[cr.rigged], 1000);
    assert.equal(r.right, true);
    assert.equal(r.luck, 2, 'Clear Glass: a right call pays one star more');
    // Night 3: no Mirrors omen, plain tells
    said.length = 0;
    const we3 = make({ mirrors: 2 });
    beginUntil(we3, 'crooked_table', 3);
    assert.deepEqual(said, []);
    assert.ok(we3.crookedView().tables.every((tb) => !tb.tells.some((t) => t.channel === 'habit')));
  } finally { off(); }
});

test('the Weeping Statue: a god reaching Favour 3 fires once, from any source, and survives a reload', () => {
  const fav = { ash: 2 };
  const we = make(fav);
  const said = [];
  const off = EV.bus.on('omen:fire', (e) => said.push(e.kind));
  try {
    we.tick(1);
    assert.deepEqual(said, []);
    fav.ash = 3;
    we.tick(1); we.tick(1);
    assert.deepEqual(said, ['weeping']);
    const we2 = make(fav);
    we2.restore(JSON.parse(JSON.stringify(we.snapshot())));
    we2.tick(1);
    assert.deepEqual(said, ['weeping'], 'not announced again after a reload');
  } finally { off(); }
});

test('the dark deposit bonus: only while the lights are dead and Ash is at Favour 2', () => {
  const dep = (we) => collect(we).filter((e) => e.hook === 'deposit.bonus');
  const we = make({ ash: 2 });
  assert.equal(dep(we).length, 0, 'lights on');
  WE.setLightsDark(true);
  try {
    assert.equal(dep(we)[0]?.value, OM.DARK_DEPOSIT_BONUS);
    assert.equal(dep(make({ ash: 1 })).length, 0, 'Ash at Favour 1 gives nothing');
  } finally { WE.setLightsDark(false); }
  assert.equal(dep(we).length, 0, 'lights back');
});

test('the omen strings exist in EN and TR with the right diacritics', () => {
  for (const k of ['weeping', 'sigil', 'dark', 'till', 'reflection']) {
    assert.ok(!I18N.t(`omen.${k}`).startsWith('omen.'), k);
  }
  I18N.setLang('tr');
  try {
    assert.equal(I18N.t('omen.weeping'), 'Heykel ağlıyor.');
    assert.equal(I18N.t('omen.dark'), 'Kül sayıyor. Bir şey yatır.');
  } finally { I18N.setLang('en'); }
});

// ── the shrine ──────────────────────────────────────────────────────────────────────────────────
function shrineRun(favs = {}, coins = 500) {
  const st = { night: 3, watch: 0, coins, spent: [] };
  return {
    st,
    night: () => st.night,
    shift: { state: () => ({ segment: { index: st.watch }, stake: 1 }) },
    balance: () => st.coins,
    spend: (cur, n) => { if (n > st.coins) return false; st.coins -= n; st.spent.push(n); return true; },
    boonFavour: (g) => favs[g] ?? 0,
  };
}

test('shrine: a candle costs max(5 x SI, 5 % of the pocket), once a Watch, and a statue pick raises Favour through the bus', () => {
  assert.equal(SR.candleCost(1, 100), 5);
  assert.equal(SR.candleCost(2, 1000), 50);
  const run = shrineRun();
  const st = { lit: 0, watch: {} };
  assert.equal(SR.canLight(st, run, 1), 'ok');
  st.watch['1'] = SR.watchKey(3, 0);
  assert.equal(SR.canLight(st, run, 1), 'once');
  st.watch['1'] = SR.watchKey(3, 9);
  assert.equal(SR.canLight(st, shrineRun({}, 2), 1), 'funds');
  const got = [];
  const off = EV.bus.on('shrine:favour', (e) => got.push(e));
  try {
    assert.equal(SR.applyLight(run, 1, 'ash', 25), true);
    assert.deepEqual(got, [{ pid: 1, god: 'ash' }]);
    assert.deepEqual(run.st.spent, [25]);
    assert.equal(SR.applyLight(shrineRun({}, 1), 1, 'well', 25), false);
    assert.equal(got.length, 1, 'a refused spend gives no Favour');
  } finally { off(); }
});

test('shrine: four statues, no Loki; the shrine is full when all four weep', () => {
  assert.deepEqual([...SR.STATUES], [...PAN.OWNERS], 'the shrine copy of the owners matches the pantheon');
  assert.equal(SR.FAVOUR_MAX, PAN.FAVOUR_MAX);
  const all = { well: 3, ledgers: 3, ash: 3, mirrors: 3 };
  assert.equal(SR.canLight({ lit: 0, watch: {} }, shrineRun(all), 1), 'full');
  assert.equal(SR.canLight({ lit: 0, watch: {} }, shrineRun({ ...all, mirrors: 2 }), 1), 'ok');
  assert.equal(SR.favourOf({}, 'well'), 0, 'a run without a pantheon reads 0');
});

// ── what went away ──────────────────────────────────────────────────────────────────────────────
test('gone: the random Blackout night event and the Votive Candle charm; no shrine buffs were ever defined', () => {
  assert.equal(BUFFS.NIGHT_EVENT_DATA.some((e) => e.id === 'blackout'), false);
  assert.equal(CHARMS.CHARM_DATA.some((c) => c.id === 'votive_candle'), false);
  assert.equal(BUFFS.BUFF_DATA.some((b) => /^(blessing_|curse_)/.test(b.id)), false);
});

// ── Borrowed Face ───────────────────────────────────────────────────────────────────────────────
test('Borrowed Face: the first Heat gain of a Night is ignored, the second lands; a new Night works again', () => {
  const st = { night: 2, boons: ['mir_face'] };
  const run = {
    seed: 3, night: () => st.night, boons: () => st.boons,
    shift: { phase: 'intermission', state: () => ({ segment: { index: 0, count: 3 } }) },
    debt: () => ({ index: st.night - 1, due: 100, paid: 0, deadlineAt: 0, floor: st.night, total: 8 }),
    nightLedger: () => ({ night: st.night, float: 0, interest: 0, tickets: 0, cut: 0, carried: 0 }),
    wallet: () => 500, spend: () => true, buffs: { add: () => {} }, dread: () => 0.5,
  };
  const phone = PH.createPhone(run);
  try {
    const hooks = PH.hooksOf(phone);
    hooks.heat(1, 'test');
    assert.equal(phone.heat(), 0, 'ignored');
    hooks.heat(1, 'test');
    assert.equal(phone.heat(), 1, 'the second one counts');
    hooks.heat(-1, 'test');
    assert.equal(phone.heat(), 0, 'relief is never ignored');
    st.night = 3;
    hooks.heat(1, 'test');
    assert.equal(phone.heat(), 0, 'a new Night, a new free pass');
    const back = PH.createPhone(run);
    back.restore(JSON.parse(JSON.stringify(phone.snapshot())));
    PH.hooksOf(back).heat(1, 'test');
    assert.equal(back.heat(), 1, 'the pass was spent on Night 3 and survives a reload');
    back.dispose();
    st.boons = [];
    st.night = 4;
    hooks.heat(1, 'test');
    assert.equal(phone.heat(), 1, 'without the boon Heat lands');
  } finally { phone.dispose(); }
});
