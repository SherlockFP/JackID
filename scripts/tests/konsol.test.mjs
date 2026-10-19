// KONSOL, the cheat console (src/game/cheats.ts): code folding (Turkish letters), the one-time warning, the effects through the run's own
// modifier pipeline, one Night of life, the CHEATED mark and its save round trip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let C, RUN, REG, EV, SAVE, STR;
before(async () => {
  C = await load('src/game/cheats.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  STR = (await load('src/game/cheats.strings.ts')).default;
  REG.load();
});

const store = () => ({ data: SAVE.defaultSave(), update(fn) { fn(this.data); }, flush() {} });

// ── folding ─────────────────────────────────────────────────────────────────────────────────────────
test('codes ignore case, Turkish letter variants, spaces and punctuation', () => {
  const same = (want, ...typed) => { for (const s of typed) assert.equal(C.foldCode(s), want, s); };
  same('SAKINGECE', 'sakingece', 'SAKİNGECE', 'Sakın Gece', 'sakıngece', ' sakin-gece! ');
  same('SANSLIYIM', 'şanslıyım', 'ŞANSLIYIM', 'Şansliyim', 'sanslıyım');
  same('ACIKKAT', 'açıkkat', 'AÇIKKAT', 'Açık Kat', 'acikkat');
  same('TAHSILDARYOK', 'tahsildar yok', 'TAHSİLDARYOK', 'Tahsildaryok');
  same('BABAPARASI', 'babaparası', 'BABA PARASI', 'Babaparasi');
  same('', '', '   ', '!?');
  assert.equal(C.foldCode('ĞÜŞİÖÇ ğüşiöç ı'), 'GUSIOCGUSIOCI');
});

test('every code is folded already, unique, and has its two reply strings', () => {
  const seen = new Set();
  for (const c of C.CHEATS) {
    assert.equal(C.foldCode(c.code), c.code);
    assert.ok(!seen.has(c.code), c.code);
    seen.add(c.code);
    assert.ok(c.fx || c.now, `${c.code} does something`);
    for (const lang of ['en', 'tr']) {
      assert.ok(STR[lang][`ok.${c.code.toLowerCase()}`], `${lang} ok.${c.code}`);
      assert.ok(STR[lang][`fx.${c.code.toLowerCase()}`], `${lang} fx.${c.code}`);
    }
  }
  assert.equal(C.CHEATS.length, 8);
});

// ── a run ───────────────────────────────────────────────────────────────────────────────────────────
const walk = (run, sec, step = 0.25) => { for (let t = 0; t < sec && !run.over; t += step) run.tick(step); };
function paidDawn(run) {
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}
function toEvening(run) {
  paidDawn(run);
  assert.equal(run.openFloor(), true);
  walk(run, RUN.HOME_TIMING.ride + 0.1);
  assert.equal(run.homeStage(), 'evening');
}
const mod = (run, hook, base = 0) => run.mod(hook, 'run', base);
/** The first code of a run: the warning, then E. */
function agree(k, code) {
  assert.equal(k.submit(code).key, 'konsol.warn');
  return k.submit('e');
}

test('the first code asks once; no cancels it and leaves the run clean', () => {
  const run = RUN.createRun({ seed: 8901, mode: 'debt', home: true });
  const save = store();
  const k = C.createCheats(run, save);
  const marked = [];
  const off = EV.bus.on('cheat:marked', (e) => marked.push(e.seed));
  assert.equal(k.submit('   '), null, 'a blank line says nothing');
  assert.deepEqual(k.submit('xyzzy'), { key: 'konsol.unknown', tone: 'err' });
  assert.equal(k.cheated(), false, 'a wrong code is not a cheat');
  assert.equal(k.submit('YARDIM').key, 'konsol.help');
  assert.deepEqual(k.submit('babaparasi'), { key: 'konsol.warn', tone: 'ask' });
  assert.equal(k.submit('h').key, 'konsol.warn.no');
  assert.equal(k.cheated(), false);
  assert.equal(save.data.cheated, undefined);
  assert.deepEqual(marked, []);
  // once agreed, the next codes do not ask again
  const before = run.wallet();
  assert.equal(agree(k, 'Baba Parası').key, 'konsol.ok.babaparasi');
  assert.equal(run.wallet(), before + 200);
  assert.equal(k.cheated(), true);
  assert.equal(save.data.cheated, 8901);
  assert.deepEqual(marked, [8901]);
  assert.equal(k.submit('BABAPARASI').key, 'konsol.ok.babaparasi', 'coins can be asked for again');
  assert.equal(run.wallet(), before + 400);
  off(); k.dispose(); run.dispose();
});

test('each code does its one simple thing through the run', () => {
  const run = RUN.createRun({ seed: 8902, mode: 'debt', home: true });
  const k = C.createCheats(run, store());
  assert.equal(mod(run, 'quota.mult', 1), 1);
  assert.equal(mod(run, 'dread.add'), 0);
  assert.equal(agree(k, 'TAHSİLDAR YOK').key, 'konsol.ok.tahsildaryok');
  assert.ok(Math.abs(mod(run, 'quota.mult', 1) - 0.75) < 1e-9, 'quota -25%');
  assert.equal(k.submit('tahsildaryok').key, 'konsol.already', 'once a Night');
  k.submit('sakıngece');
  assert.equal(mod(run, 'dread.add'), -100, 'Dread stays at the floor: no Lights Die');
  assert.equal(mod(run, 'x.cheat.quiet'), 1, 'and the omens read the quiet hook');
  k.submit('birdaha');
  assert.equal(mod(run, 'x.run.pullsAdd', 2), 4, '+2 pulls a Watch');
  k.submit('açıkkat');
  assert.equal(mod(run, 'x.cheat.openAll'), 1);
  k.submit('lokisus');
  assert.equal(mod(run, 'x.cheat.lokiQuiet'), 1);
  assert.deepEqual(k.active().sort(), ['ACIKKAT', 'BIRDAHA', 'LOKISUS', 'SAKINGECE', 'TAHSILDARYOK']);
  // the luck star and the seal act at once
  const stars = run.luckStars();
  assert.equal(k.submit('ŞANSLIYIM').key, 'konsol.ok.sansliyim');
  assert.equal(run.luckStars(), Math.min(5, stars + 3));
  assert.equal(k.submit('altinel').key, 'konsol.none', 'the card is full');
  run.soulMarkCount = 2;
  assert.equal(k.submit('altinel').key, 'konsol.ok.altinel');
  assert.equal(run.duel.soulMarks(), 3);
  k.dispose();
  assert.equal(mod(run, 'quota.mult', 1), 1, 'gone with the console');
  run.dispose();
});

test('a no-op code does not mark the run, and the effects end when the next Night is paid', () => {
  const run = RUN.createRun({ seed: 8903, mode: 'debt', home: true });
  const save = store();
  const k = C.createCheats(run, save);
  assert.equal(k.submit('altinel').key, 'konsol.none', 'full seals: no warning, no mark');
  assert.equal(save.data.cheated, undefined);
  toEvening(run);
  agree(k, 'tahsildaryok');
  assert.ok(mod(run, 'quota.mult', 1) < 1);
  assert.equal(run.homeSleep(), true);
  walk(run, RUN.HOME_TIMING.sleep + 0.1);
  assert.ok(mod(run, 'quota.mult', 1) < 1, 'it rides through the Night it was bought for');
  toEvening(run);   // that Night is paid: the ride home
  assert.equal(mod(run, 'quota.mult', 1), 1, 'one Night, then it is gone');
  assert.deepEqual(k.active(), []);
  assert.equal(k.cheated(), true, 'the mark stays');
  k.dispose(); run.dispose();
});

test('the CHEATED mark is the run seed in the profile save, and it survives a save round trip', () => {
  const save = store();
  assert.equal(C.isCheated(save, 77), false);
  save.data.cheated = 77;
  assert.equal(C.isCheated(save, 77), true);
  assert.equal(C.isCheated(save, 78), false, 'another run is clean');
  assert.equal(C.isCheated(save, undefined), false);
  const back = SAVE.migrateSave(JSON.parse(JSON.stringify(save.data)));
  assert.equal(back.cheated, 77);
  assert.equal(SAVE.migrateSave({ cheated: 'x' }).cheated, undefined, 'a damaged mark reads as clean');
  assert.equal(SAVE.migrateSave({}).cheated, undefined);
  C.clearCheated(save);
  assert.equal(save.data.cheated, undefined);
  assert.equal(JSON.stringify(save.data).includes('cheated'), false);
});
