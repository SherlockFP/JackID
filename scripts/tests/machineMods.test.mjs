// Unit tests for MACHINE MODS (src/game/machineMods.ts, backlog #7): the two-socket cap, the buy checks (closed, owner, machine
// family, duplicate, funds) and atomic spending, the provider's per-instance scoping, the folded effects of each mod, the
// save / restore round trip, and the EN / TR string coverage of the mod defs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let MM, UP, MT, STR;
before(async () => {
  MM = await load('src/game/machineMods.ts');
  UP = await load('src/game/data/upgrades.ts');
  MT = await load('src/game/modifiers.types.ts');
  STR = (await load('src/game/machineMods.strings.ts')).default;
});

/** A host with a wallet, a quota, a trade gate and a set of owned instances (instance -> machine family). */
function mk(o = {}) {
  const st = { quota: 1000, wallet: 1e6, open: true, owned: {}, spent: 0, touches: 0, ...o };
  const host = {
    quota: () => st.quota,
    wallet: () => st.wallet,
    open: () => st.open,
    owns: (i) => st.owned[i] ?? null,
    spend: (c) => { if (st.wallet < c) return false; st.wallet -= c; st.spent += c; return true; },
    touch: () => { st.touches++; },
  };
  return { st, host };
}

/** The folded value of one hook on one machine instance, through the same scope test the run's fold uses. */
function foldOn(mods, hook, base, machineId, instance) {
  const out = [];
  mods.collect({ instance }, out);
  const effs = [];
  for (const s of out) for (const e of s.effects) {
    if (e.hook !== hook || !MT.scopeMatches(e.scope, { machineId, instance })) continue;
    effs.push({ op: e.op, value: e.value, priority: e.priority });
  }
  return MT.foldEffects(hook, base, effs);
}

test('the socket cap is two per instance; a third mod is refused as full and the other instance is untouched', () => {
  const { host, st } = mk({ owned: { A: 'bandit', B: 'bandit' } });
  const m = new MM.MachineMods(host);
  assert.equal(m.socketCap, 2);
  assert.equal(MM.MOD_SOCKETS, 2);
  assert.deepEqual(m.buy('A', 'hotWire'), { ok: true, why: '' });
  assert.deepEqual(m.buy('A', 'brake'), { ok: true, why: '' });
  assert.deepEqual(m.buy('A', 'tiltGuard'), { ok: false, why: 'full' });
  assert.deepEqual(m.installed('A'), ['hotWire', 'brake']);
  assert.deepEqual(m.buy('B', 'tiltGuard'), { ok: true, why: '' });
  assert.deepEqual(m.installed('B'), ['tiltGuard']);
  // at a quota of 1000: HOT WIRE 300 + BRAKE 250 on A, TILT GUARD 200 on B
  assert.equal(st.spent, 750);
});

test('a mod sits on an instance at most once; an unowned instance is refused as owner', () => {
  const { host } = mk({ owned: { A: 'bandit' } });
  const m = new MM.MachineMods(host);
  assert.equal(m.buy('A', 'luckyLatch').ok, true);
  assert.deepEqual(m.buy('A', 'luckyLatch'), { ok: false, why: 'dup' });
  assert.deepEqual(m.buy('Z', 'brake'), { ok: false, why: 'owner' });
  assert.deepEqual(m.installed('Z'), []);
});

test('DEEP FEED fits only the Big One; other families are refused as machine', () => {
  const { host } = mk({ owned: { A: 'bandit', G: 'bigone' } });
  const m = new MM.MachineMods(host);
  assert.deepEqual(m.quote('A', 'deepFeed').why, 'machine');
  assert.equal(m.buy('A', 'deepFeed').ok, false);
  assert.equal(m.buy('G', 'deepFeed').ok, true);
});

test('unknown mod, closed trade and not enough coins are refused, and nothing is charged', () => {
  const { host, st } = mk({ owned: { A: 'bandit' } });
  const m = new MM.MachineMods(host);
  assert.deepEqual(m.buy('A', 'nope'), { ok: false, why: 'unknown' });
  st.open = false;
  assert.deepEqual(m.buy('A', 'brake'), { ok: false, why: 'closed' });
  st.open = true;
  st.wallet = 0;
  assert.deepEqual(m.quote('A', 'brake').why, 'funds');
  assert.deepEqual(m.buy('A', 'brake'), { ok: false, why: 'funds' });
  assert.deepEqual(m.installed('A'), []);
  assert.equal(st.spent, 0);
  assert.equal(st.touches, 0);
});

test('a spend that the host refuses leaves the sockets as they were', () => {
  const { host } = mk({ owned: { A: 'bandit' } });
  host.spend = () => false;
  const m = new MM.MachineMods(host);
  assert.deepEqual(m.buy('A', 'brake'), { ok: false, why: 'funds' });
  assert.deepEqual(m.installed('A'), []);
});

test('prices are a 20-35 % share of the Night quota, rounded, never below one coin', () => {
  for (const d of UP.MOD_DEFS) {
    assert.ok(d.share >= 0.2 && d.share <= 0.35, `${d.id} share ${d.share}`);
  }
  const hot = UP.MOD_DEFS.find((d) => d.id === 'hotWire');
  assert.equal(MM.modPrice(hot, 1000), 300);
  assert.equal(MM.modPrice(hot, 0), 1);
  const { host } = mk({ owned: { A: 'bandit' }, quota: 2000 });
  assert.equal(new MM.MachineMods(host).quote('A', 'hotWire').price, 600);
});

test('the provider scopes every effect to its instance, and emits nothing for an unsocketed one or no instance', () => {
  const { host } = mk({ owned: { A: 'bandit', B: 'bandit' } });
  const m = new MM.MachineMods(host);
  m.buy('A', 'hotWire');
  m.buy('A', 'tiltGuard');
  const out = [];
  m.collect({ instance: 'A' }, out);
  assert.equal(out.length, 1);
  assert.equal(out[0].owner, 'A');
  assert.equal(out[0].kind, 'machine');
  for (const e of out[0].effects) assert.deepEqual(e.scope.instances, ['A']);
  const none = [];
  m.collect({ instance: 'B' }, none);
  m.collect({}, none);
  assert.equal(none.length, 0);
  // the mod does nothing on another instance, and only the socketed one's lamp hook moves
  assert.equal(foldOn(m, 'x.lamp.hotMult', 1.5, 'bandit', 'A') > 1.5, true);
  assert.equal(foldOn(m, 'x.lamp.hotMult', 1.5, 'bandit', 'B'), 1.5);
  assert.equal(foldOn(m, 'x.lamp.hotMult', 1.5, 'bandit', undefined), 1.5);
});

test('a machine-family scope keeps DEEP FEED off other machines even when socketed on the instance', () => {
  const { host } = mk({ owned: { G: 'bigone' } });
  const m = new MM.MachineMods(host);
  m.buy('G', 'deepFeed');
  assert.ok(Math.abs(foldOn(m, 'x.bigone.jackpotFeed', 0.01, 'bigone', 'G') - 0.025) < 1e-12);
  assert.equal(foldOn(m, 'x.bigone.jackpotFeed', 0.01, 'bandit', 'G'), 0.01);
});

test('each mod folds to its stated value at base', () => {
  const { host } = mk({ owned: { A: 'bandit', B: 'bandit', C: 'bandit', D: 'bandit', E: 'bandit' } });
  const m = new MM.MachineMods(host);
  m.buy('A', 'hotWire');
  assert.ok(Math.abs(foldOn(m, 'x.lamp.hotMult', 1.5, 'bandit', 'A') - 1.8) < 1e-12);
  assert.ok(Math.abs(foldOn(m, 'x.lamp.coldMult', 0.75, 'bandit', 'A') - 0.6) < 1e-12);
  m.buy('B', 'luckyLatch');
  assert.equal(foldOn(m, 'luck', 0, 'bandit', 'B'), 2);
  assert.ok(Math.abs(foldOn(m, 'bet.maxMult', 1, 'bandit', 'B') - 0.8) < 1e-12);
  m.buy('C', 'tiltGuard');
  assert.equal(foldOn(m, 'x.tilt.grace', 0, 'bandit', 'C'), 2);
  m.buy('D', 'brake');
  assert.ok(Math.abs(foldOn(m, 'speed.mult', 1, 'bandit', 'D') - 0.85) < 1e-12);
  assert.equal(foldOn(m, 'speed.mult', 1, 'bandit', 'E'), 1);
});

test('the lamp mods compose with a charm that sets the base (Hot Coal ×2 becomes ×2.4)', () => {
  const { host } = mk({ owned: { A: 'bandit' } });
  const m = new MM.MachineMods(host);
  m.buy('A', 'hotWire');
  const out = [];
  m.collect({ instance: 'A' }, out);
  const charm = { op: 'set', value: 2, priority: 0 };
  const effs = [charm];
  for (const e of out[0].effects) if (e.hook === 'x.lamp.hotMult') effs.push({ op: e.op, value: e.value });
  assert.ok(Math.abs(MT.foldEffects('x.lamp.hotMult', 1.5, effs) - 2.4) < 1e-12);
});

test('a snapshot survives a JSON round trip: same sockets, same folds, and no coins are charged on restore', () => {
  const { host, st } = mk({ owned: { A: 'bandit', G: 'bigone' } });
  const m = new MM.MachineMods(host);
  m.buy('A', 'hotWire');
  m.buy('A', 'brake');
  m.buy('G', 'deepFeed');
  const wallet = st.wallet;
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  assert.equal(snap.v, 1);

  const fresh = mk({ owned: { A: 'bandit', G: 'bigone' } });
  const r = new MM.MachineMods(fresh.host, snap);
  assert.deepEqual(r.installed('A'), ['hotWire', 'brake']);
  assert.deepEqual(r.installed('G'), ['deepFeed']);
  assert.equal(foldOn(r, 'x.lamp.hotMult', 1.5, 'bandit', 'A'), foldOn(m, 'x.lamp.hotMult', 1.5, 'bandit', 'A'));
  assert.equal(foldOn(r, 'speed.mult', 1, 'bandit', 'A'), foldOn(m, 'speed.mult', 1, 'bandit', 'A'));
  assert.equal(foldOn(r, 'x.bigone.jackpotFeed', 0.01, 'bigone', 'G'), foldOn(m, 'x.bigone.jackpotFeed', 0.01, 'bigone', 'G'));
  assert.equal(fresh.st.wallet, 1e6);
  assert.equal(fresh.st.spent, 0);

  const other = mk({ owned: { A: 'bandit' } });
  const q = new MM.MachineMods(other.host);
  q.restore(snap);
  assert.deepEqual(q.installed('A'), ['hotWire', 'brake']);
  assert.equal(st.wallet, wallet);
});

test('restore drops unknown mods, duplicates and extra sockets, and rejects a wrong version', () => {
  const { host } = mk({ owned: { A: 'bandit' } });
  const m = new MM.MachineMods(host, {
    v: 1, sockets: { A: ['hotWire', 'nope', 'hotWire', 'brake', 'tiltGuard'], B: ['nope'] },
  });
  assert.deepEqual(m.installed('A'), ['hotWire', 'brake']);
  assert.deepEqual(m.installed('B'), []);
  const bad = new MM.MachineMods(host, { v: 2, sockets: { A: ['brake'] } });
  assert.deepEqual(bad.installed('A'), []);
  const none = new MM.MachineMods(host, null);
  assert.deepEqual(none.snapshot(), { v: 1, sockets: {} });
});

test('a change notifies the listeners and touches the modifier caches; an unsubscribed listener is not called', () => {
  const { host, st } = mk({ owned: { A: 'bandit' } });
  const m = new MM.MachineMods(host);
  let n = 0;
  const off = m.onChange(() => { n++; });
  m.buy('A', 'brake');
  assert.equal(n, 1);
  assert.equal(st.touches, 1);
  off();
  m.buy('A', 'tiltGuard');
  assert.equal(n, 1);
});

test('every mod def has a name and a description in EN and TR', () => {
  assert.deepEqual(Object.keys(STR.tr).sort(), Object.keys(STR.en).sort());
  for (const d of UP.MOD_DEFS) {
    for (const k of [`${d.id}.name`, `${d.id}.desc`]) {
      assert.ok(typeof STR.en[k] === 'string' && STR.en[k].length > 0, `en ${k}`);
      assert.ok(typeof STR.tr[k] === 'string' && STR.tr[k].length > 0, `tr ${k}`);
    }
  }
  assert.equal(STR.prefix, 'mod.');
});
