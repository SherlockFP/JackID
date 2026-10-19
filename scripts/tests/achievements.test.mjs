// ACHIEVEMENTS (src/game/achievements.ts): the table (30, gamerscore 1000, both languages), each unlock on synthetic bus events, a
// cheated run (the KONSOL mark) earning nothing, and the save round trip.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let A, EV, SAVE, STR, BONDS, END, PROG, C;
before(async () => {
  A = await load('src/game/achievements.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  STR = (await load('src/game/achievements.strings.ts')).default;
  BONDS = await load('src/game/bonds.ts');
  END = await load('src/game/story/endings.ts');
  PROG = await load('src/game/progression.ts');
  C = await load('src/game/cheats.ts');
});

// ── the table ───────────────────────────────────────────────────────────────────────────────────────
test('thirty achievements, 5 to 100 gamerscore each, 1000 in all, unique ids', () => {
  assert.equal(A.ACHIEVEMENTS.length, 30);
  assert.equal(new Set(A.ACHIEVEMENTS.map((a) => a.id)).size, 30);
  for (const a of A.ACHIEVEMENTS) assert.ok(a.g >= 5 && a.g <= 100 && Number.isInteger(a.g), `${a.id} ${a.g}`);
  assert.equal(A.GAMERSCORE_TOTAL, 1000);
  assert.equal(A.gamerscore(A.ACHIEVEMENTS.map((a) => a.id)), 1000);
  assert.equal(A.gamerscore(['first_win', 'first_win', 'nope']), 5, 'a repeat or an unknown id adds nothing');
  assert.equal(A.ACHIEVEMENTS.filter((a) => a.secret).length, 3);
});

test('every ending and every friend has its own, and every one reads in English and Turkish', () => {
  for (const id of END.ENDING_IDS) assert.ok(A.achievementDef(`end_${id}`), `ending ${id}`);
  assert.equal(A.ACHIEVEMENTS.filter((a) => a.id.startsWith('end_')).length, END.ENDING_IDS.length);
  for (const id of BONDS.BOND_IDS) assert.ok(A.achievementDef(`bond_${id}`), `bond ${id}`);
  assert.equal(A.ACHIEVEMENTS.filter((a) => a.id.startsWith('bond_')).length, BONDS.BOND_IDS.length);
  for (const a of A.ACHIEVEMENTS) {
    for (const lang of ['en', 'tr']) {
      for (const part of ['name', 'desc']) {
        const s = STR[lang][`${a.id}.${part}`];
        assert.ok(typeof s === 'string' && s.length > 0, `${lang} ${a.id}.${part}`);
        assert.ok(!/[—–]/.test(s), `${lang} ${a.id}.${part} has a dash`);
      }
    }
    assert.notEqual(STR.tr[`${a.id}.name`], STR.en[`${a.id}.name`], `${a.id} has a Turkish name of its own`);
  }
});

// ── unlocks ─────────────────────────────────────────────────────────────────────────────────────────
/** A profile save and a run to hang the rules on; `st` is the run's changing facts. */
const st = { seed: 4242, mode: 'debt', wallet: 50, boons: [], favour: 0, ink: 0 };
let save, off, got;
const host = () => ({
  save,
  run: () => ({
    seed: st.seed, mode: st.mode, selfId: 1, wallet: () => st.wallet, boons: () => st.boons,
    boonFavour: () => st.favour, jokerInk: () => st.ink,
  }),
});
beforeEach(() => {
  Object.assign(st, { seed: 4242, mode: 'debt', wallet: 50, boons: [], favour: 0, ink: 0 });
  save = { data: SAVE.defaultSave(), update(fn) { fn(this.data); }, flush() {} };
  got = [];
  const unlock = EV.bus.on('achievement:unlock', (e) => got.push(e.id));
  const rules = A.mountAchievements(host());
  off = () => { rules(); unlock(); };
});
afterEach(() => off());

const emit = (name, p) => EV.bus.emit(name, p);
const result = (o) => emit('machine:result', { mid: 'm1', machineId: 'coinflip', pid: 1, bet: 5, gross: 0, credited: 0, tier: 'none', tags: [], ...o });
const round = (machineId, pid = 1) => emit('machine:round', { mid: 'm1', machineId, pid, bet: 5 });

test('first win and first jackpot', () => {
  result({ tier: 'none' });
  result({ tier: 'push', gross: 5, credited: 5 });
  result({ tier: 'small', gross: 20, credited: 20, pid: 2 });
  assert.deepEqual(got, [], 'a loss, a push and someone else\'s win are not a win');
  result({ tier: 'small', gross: 20, credited: 20 });
  assert.deepEqual(got, ['first_win']);
  emit('jackpot:win', { pool: 'net', pid: 1, amount: 500, mid: 'm1', machineId: 'coinflip' });
  assert.deepEqual(got, ['first_win', 'first_jackpot']);
  result({ tier: 'jackpot', gross: 900, credited: 900 });
  assert.equal(got.length, 2, 'each unlocks once');
  assert.deepEqual(save.data.achievements, ['first_win', 'first_jackpot']);
});

test('nights: pay Night 1, reach Night 5 and Night 8', () => {
  st.ink = 1;   // Loki spoke up: the no-Loki one stays out of this test
  emit('quota:met', { index: 1, ratio: 1 });
  assert.deepEqual(got, []);
  emit('quota:met', { index: 0, ratio: 1 });
  emit('night:begin', { night: 4 });
  assert.deepEqual(got, ['night1']);
  emit('night:begin', { night: 5 });
  assert.deepEqual(got, ['night1', 'night5']);
  emit('night:begin', { night: 8 });
  assert.deepEqual(got, ['night1', 'night5', 'night8']);
});

test('each ending, and nothing for a run that ended without one', () => {
  const summary = (o) => ({ mode: 'debt', seed: 1, result: 'fell', floor: 1, deadlines: 1, maxWallet: 0, rounds: 0, biggestWin: 0, durationSec: 0, players: [], stats: {}, ...o });
  emit('run:end', { summary: summary({}) });
  emit('run:end', { summary: summary({ endingId: 'not_an_ending' }) });
  assert.deepEqual(got, []);
  for (const id of END.ENDING_IDS) emit('run:end', { summary: summary({ endingId: id }) });
  assert.deepEqual(got.sort(), END.ENDING_IDS.map((id) => `end_${id}`).sort());
  assert.equal(A.gamerscore(got), 355, 'the nine endings are worth 355');
});

test('Loki: catch a lie, a false accusation, and a run that never asks him', () => {
  emit('joker:call', { right: false });
  assert.deepEqual(got, ['wrong_call']);
  emit('joker:call', { right: true });
  assert.deepEqual(got, ['wrong_call', 'loki_lie']);
  // no-Loki: Night 6 with Loki untouched, Ink 0
  emit('night:begin', { night: 6 });
  assert.ok(!got.includes('no_loki'), 'calling him is touching him');
});

test('no-Loki run: Night 6 untouched and at Ink 0; asking him, a takeover or Ink spoils it', () => {
  emit('night:begin', { night: 1 });
  emit('night:begin', { night: 5 });
  assert.ok(!got.includes('no_loki'), 'not yet');
  emit('night:begin', { night: 6 });
  assert.ok(got.includes('no_loki'));
  for (const spoil of [() => emit('joker:ink', { ink: 1, delta: 1, why: 'ask' }), () => emit('joker:takeover', {})]) {
    save.data.achievements = []; got.length = 0;
    emit('night:begin', { night: 1 });   // a new run clears the memory
    spoil();
    emit('night:begin', { night: 6 });
    assert.ok(!got.includes('no_loki'));
  }
  save.data.achievements = []; got.length = 0;
  emit('night:begin', { night: 1 });
  emit('joker:ink', { ink: 0, delta: -1, why: 'kept word' });   // Ink going down is not asking
  st.ink = 2;
  emit('night:begin', { night: 6 });
  assert.ok(!got.includes('no_loki'), 'Ink above 0 spoils it too');
});

test('each friend at bond 3, and not before', () => {
  emit('bond:change', { who: 'selim', from: 1, to: 2, why: 'help', night: 2 });
  assert.deepEqual(got, []);
  for (const who of BONDS.BOND_IDS) emit('bond:change', { who, from: 2, to: 3, why: 'help', night: 3 });
  assert.deepEqual(got.sort(), BONDS.BOND_IDS.map((b) => `bond_${b}`).sort());
});

test('every core machine played once', () => {
  const core = PROG.CORE_MACHINES;
  for (const m of core.slice(1)) round(m);
  round(core[0], 2);   // another player's round
  assert.ok(!got.includes('all_machines'));
  assert.equal(save.data.codex[`machine:${core[0]}`], undefined);
  round(core[0]);
  assert.deepEqual(got, ['all_machines']);
  assert.equal(save.data.codex[`machine:${core[0]}`], 1, 'the bestiary count is kept');
});

test('a seal lost and won back, but not a seal staked and returned', () => {
  emit('duel:marks', { left: 2, lost: false, blank: false });   // staked
  emit('duel:marks', { left: 3, lost: false, blank: false });   // returned
  assert.deepEqual(got, []);
  emit('duel:marks', { left: 2, lost: false, blank: false });   // a short Dawn takes one (takeSeal), then...
  emit('quota:sealed', { index: 1, left: 2, memory: 'm' });
  emit('duel:marks', { left: 1, lost: false, blank: false });   // staked another
  emit('duel:marks', { left: 2, lost: false, blank: false });   // returned: still short
  assert.deepEqual(got, []);
  emit('duel:marks', { left: 3, lost: false, blank: false });   // restored
  assert.deepEqual(got, ['seal_back']);
  // a duel mark lost for good works the same
  save.data.achievements = []; got.length = 0;
  emit('duel:marks', { left: 2, lost: true, blank: false });
  emit('duel:marks', { left: 3, lost: false, blank: false });
  assert.deepEqual(got, ['seal_back']);
});

test('five boons in a run, and all four gods at Favour 3', () => {
  st.boons = ['a', 'b', 'c', 'd'];
  emit('run:boon', { pid: 1, state: 'picked', ids: ['d'] });
  assert.deepEqual(got, []);
  st.boons = ['a', 'b', 'c', 'd', 'e'];
  emit('run:boon', { pid: 1, state: 'offer', ids: [] });
  assert.deepEqual(got, [], 'an open offer is not a boon kept');
  emit('run:boon', { pid: 1, state: 'auto', ids: ['e'] });
  assert.deepEqual(got, ['five_boons']);
  st.favour = 2;
  emit('shrine:favour', { pid: 1, god: 'well' });
  assert.ok(!got.includes('four_gods'));
  st.favour = 3;
  emit('omen:fire', { kind: 'weeping' });
  assert.ok(got.includes('four_gods'));
});

test('the secret ones: an empty pocket, the Hollow Door', () => {
  st.wallet = 7;
  result({ credited: 0 });
  assert.deepEqual(got, []);
  st.wallet = 0;
  result({ credited: 0 });
  emit('hollow:enter', { reason: 'crack' });
  assert.deepEqual(got.sort(), ['broke', 'hollow']);
  assert.ok(A.ACHIEVEMENTS.filter((a) => a.secret).every((a) => got.includes(a.id) || a.id === 'wrong_call'));
});

test('only a Debt Run earns', () => {
  st.mode = 'free';
  result({ tier: 'small', gross: 20, credited: 20 });
  emit('night:begin', { night: 8 });
  emit('hollow:enter', { reason: 'crack' });
  assert.deepEqual(got, []);
  assert.deepEqual(save.data.achievements, []);
});

// ── cheats ──────────────────────────────────────────────────────────────────────────────────────────
test('a cheated run earns nothing, the next run starts clean', () => {
  const run = { seed: st.seed, mods: { register: () => () => {}, touch() {} }, earn() {} };
  const k = C.createCheats(run, save);
  result({ tier: 'small', gross: 20, credited: 20 });
  assert.deepEqual(got, ['first_win'], 'before any cheat the run earns');
  assert.equal(k.submit('babaparasi').key, 'konsol.warn');
  k.submit('evet');
  assert.equal(save.data.cheated, st.seed);
  emit('quota:met', { index: 0, ratio: 1 });
  emit('night:begin', { night: 8 });
  emit('jackpot:win', { pool: 'net', pid: 1, amount: 500, mid: 'm1', machineId: 'coinflip' });
  emit('bond:change', { who: 'selim', from: 2, to: 3, why: 'help', night: 3 });
  emit('run:end', { summary: { mode: 'debt', seed: st.seed, result: 'escaped', endingId: 'kept_pair', stats: {}, players: [] } });
  assert.deepEqual(got, ['first_win'], 'nothing after the first code, not even the ending');
  assert.equal(save.data.cheated, undefined, 'the mark ends with the run');
  // a new run with the same seed (the daily) is clean
  st.seed = 4242;
  result({ tier: 'jackpot', gross: 900, credited: 900 });
  assert.ok(got.includes('first_jackpot'));
  k.dispose();
});

test('a cheat in another run does not touch this one', () => {
  save.data.cheated = 9999;
  result({ tier: 'small', gross: 20, credited: 20 });
  assert.deepEqual(got, ['first_win']);
  assert.equal(save.data.cheated, 9999);
});

// ── the save ────────────────────────────────────────────────────────────────────────────────────────
test('unlocked ids survive the save round trip, in order, and a damaged list reads as empty', () => {
  result({ tier: 'small', gross: 20, credited: 20 });
  emit('quota:met', { index: 0, ratio: 1 });
  emit('hollow:enter', { reason: 'seam' });
  const back = SAVE.migrateSave(JSON.parse(JSON.stringify(save.data)));
  assert.deepEqual(back.achievements, ['first_win', 'night1', 'hollow']);
  assert.equal(A.gamerscore(back.achievements), 5 + 10 + 40);
  assert.deepEqual(SAVE.migrateSave({ achievements: 'junk' }).achievements, []);
  assert.deepEqual(SAVE.migrateSave({ achievements: ['night1', 5, null, 'x'] }).achievements, ['night1', 'x']);
});
