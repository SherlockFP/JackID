// Charm readers: every hook a launch charm sets has a reader in src/ (the `inert-charm` rule of scripts/check.mjs, as a
// unit test). A reader is any mention of the hook in src/ outside src/game/data/, because data names hooks but does not
// read them. Also covers the two readers wired for charms that promised effects nothing read: Heat Lamp's overheat
// scale (`x.overheat.mult`) and Glutton's Bib's Hungry machine (`x.buff.hungry`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT, load, hasModule, closeVite } from './_vite.mjs';

after(closeVite);

const SRC = join(ROOT, 'src');
/** Circuit-lane hooks and circuit charms are pending (see check.mjs rule 2b); they are not inert. */
const CIRCUIT_PENDING_CHARMS = new Set(['hot_coal', 'cold_hands', 'worn_glove', 'red_thread', 'circuit_breaker', 'blackout_lamp']);
const CIRCUIT_PENDING_HOOK = /^x\.(lamp|tilt)\./;

function sourcesOf(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourcesOf(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const corpus = sourcesOf(SRC)
  .filter((p) => !relative(ROOT, p).split(sep).join('/').startsWith('src/game/data/'))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

function hasReader(hook) {
  const base = hook.replace(/\[[^\]]*\]$/, '');
  if (corpus.includes(base)) return true;
  const dot = base.lastIndexOf('.');
  return dot > 0 && corpus.includes(`${base.slice(0, dot + 1)}\${`);   // template reader, e.g. `m.bandit.symbolPayAdd.${s}`
}

test('every hook a launch charm sets has a reader in src (the inert-charm rule)', async () => {
  const { CHARM_DATA, LAUNCH_CHARM_IDS } = await load('src/game/data/charms.ts');
  const behaviours = hasModule('src/game/charms/behaviours.ts')
    ? ((await load('src/game/charms/behaviours.ts')).BEHAVIOURS ?? {})
    : {};
  const inert = [];
  for (const def of CHARM_DATA) {
    if (!LAUNCH_CHARM_IDS.has(def.id) || CIRCUIT_PENDING_CHARMS.has(def.id) || behaviours[def.id]) continue;
    if (!def.effects?.length) { inert.push(`${def.id}: no hooks and no behaviour`); continue; }
    for (const e of def.effects) {
      if (CIRCUIT_PENDING_HOOK.test(e.hook) || hasReader(e.hook)) continue;
      inert.push(`${def.id}: ${e.hook}`);
    }
  }
  assert.deepEqual(inert, []);
});

/** Run stub: `mod` returns the override for a hook, else the base value. */
const runWith = (overrides) => ({ mod: (hook, _machineId, base) => (hook in overrides ? overrides[hook] : base) });
const buffHost = () => ({ selfId: 1, isHost: true, run: () => null, now: () => 0, touch: () => {}, players: () => [1] });

test('Heat Lamp: x.overheat.mult scales the effects of the overheat buff it starts', async () => {
  const { Buffs } = await load('src/game/buffs/engine.ts');
  const { Streaks } = await load('src/game/buffs/streaks.ts');
  const { BUFF_DATA } = await load('src/game/data/buffs.ts');
  for (const k of [1, 2]) {
    const buffs = new Buffs(buffHost());
    for (const d of BUFF_DATA) buffs.register(d);
    const streaks = new Streaks({ run: () => runWith({ 'x.overheat.mult': k }), rng: { chance: () => false }, isHost: true }, buffs);
    // gross 20 on a bet of 10: heat +10 per win, so the meter reaches 100 on the tenth win
    for (let i = 0; i < 12 && !buffs.has('overheat', { mid: 'm1' }); i++) streaks.onResult(1, 'm1', 'slots', 20, 10);
    assert.ok(buffs.has('overheat', { mid: 'm1' }), 'overheat starts at full heat');
    const out = [];
    buffs.collect({ pid: 1, instance: 'm1' }, out);
    const speed = out.filter((s) => s.id === 'overheat').flatMap((s) => s.effects).find((e) => e.hook === 'speed.mult');
    assert.equal(speed.value, 1 + 0.5 * k, `overheat slowdown at x${k}`);
  }
});

test('Glutton\'s Bib: a played machine turns Hungry at a Bell and its next result ends it', async () => {
  const { Buffs } = await load('src/game/buffs/engine.ts');
  const { Hungry, HUNGRY_BUFF } = await load('src/game/buffs/hungry.ts');
  for (const held of [0, 1]) {
    const buffs = new Buffs(buffHost());
    buffs.register(HUNGRY_BUFF);
    const hungry = new Hungry({
      selfId: 1, isHost: true, run: () => runWith({ 'x.buff.hungry': held }), rng: { pick: (arr) => arr[0] },
    }, buffs);
    hungry.onBell();   // nothing played yet: no target
    assert.equal(buffs.has('hungry', { mid: 'm1' }), false);
    hungry.onResult('m1', 'slots');
    hungry.onBell();
    assert.equal(buffs.has('hungry', { mid: 'm1' }), held === 1, `hungry with the Bib ${held ? 'held' : 'absent'}`);
    if (!held) continue;
    const out = [];
    buffs.collect({ pid: 1, instance: 'm1' }, out);
    const pays = out.filter((s) => s.id === 'hungry').flatMap((s) => s.effects).find((e) => e.hook === 'payout.mult');
    assert.equal(pays.value, 0, 'the Hungry machine pays no winnings');
    hungry.onResult('m1', 'slots');
    assert.equal(buffs.has('hungry', { mid: 'm1' }), false, 'its next result ends the state');
  }
});

test('Tin Jockey: its +15% survives the derby odds fold (the derby reads the hook with base 0)', async () => {
  const { CHARM_DATA } = await load('src/game/data/charms.ts');
  const { foldEffects } = await load('src/game/modifiers.types.ts');
  const e = CHARM_DATA.find((d) => d.id === 'tin_jockey')?.effects.find((x) => x.hook === 'm.derby.oddsBonus');
  assert.ok(e, 'Tin Jockey sets the derby odds hook');
  // derby/index.ts reads `this.mod(HOOK_ODDS, 0)` and pays `g * (1 + oddsBonus)`: an `inc` folds to 0 on a base of 0
  assert.equal(foldEffects(e.hook, 0, [e]), 0.15);
});
