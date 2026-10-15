// Daily run (game/daily.ts): the UTC day key, the date-keyed seed and kit, the copyable line, the best-of-day rule, and the
// run that takes the day's seed, kit and stake whatever the menu passed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let D, RUN, KITS, SAVE;
before(async () => {
  D = await load('src/game/daily.ts');
  RUN = await load('src/game/run.ts');
  KITS = await load('src/game/data/kits.ts');
  SAVE = await load('src/core/save.ts');
});

test('dayKey is the UTC calendar day', () => {
  assert.equal(D.dayKey(new Date('2026-10-15T23:59:59Z')), '2026-10-15');
  assert.equal(D.dayKey(new Date('2026-10-16T00:00:00Z')), '2026-10-16');
  assert.equal(D.dayCode('2026-10-15'), '20261015');
  assert.equal(D.isDayKey('2026-10-15'), true);
  assert.equal(D.isDayKey('2026-1-5'), false);
  assert.equal(D.isDayKey(undefined), false);
});

test('the day seed and kit are deterministic per date and differ between dates', () => {
  assert.equal(D.dailySeed('2026-10-15'), D.dailySeed('2026-10-15'));
  assert.notEqual(D.dailySeed('2026-10-15'), D.dailySeed('2026-10-16'));
  assert.equal(D.dailyKit('2026-10-15'), D.dailyKit('2026-10-15'));
  const ids = KITS.KITS.map((k) => k.id);
  for (let day = 1; day <= 28; day++) {
    const key = `2026-10-${String(day).padStart(2, '0')}`;
    assert.ok(ids.includes(D.dailyKit(key)), `${key} gets a real kit`);
  }
  assert.ok(new Set(Array.from({ length: 28 }, (_, i) => D.dailyKit(`2026-10-${String(i + 1).padStart(2, '0')}`))).size > 1,
    'the kit varies across days');
});

test('the copyable line reads JackID daily YYYY-MM-DD · Night N · +Obols', () => {
  assert.equal(D.dailyLine('2026-10-15', 7, 120), 'JackID daily 2026-10-15 · Night 7 · +120 Obols');
  assert.equal(D.dailyLine('2026-10-15', 1, 0), 'JackID daily 2026-10-15 · Night 1 · +0 Obols');
});

test('the best result of a day: more Nights first, then more Obols', () => {
  const a = { date: '2026-10-15', seed: 1, kit: 'pauper', night: 5, obols: 90, result: 'fell' };
  assert.equal(D.dailyBetter(undefined, a), true);
  assert.equal(D.dailyBetter(a, { ...a, night: 6, obols: 10 }), true);
  assert.equal(D.dailyBetter(a, { ...a, night: 4, obols: 500 }), false);
  assert.equal(D.dailyBetter(a, { ...a, obols: 91 }), true);
  assert.equal(D.dailyBetter(a, { ...a, obols: 90 }), false);
});

test('a daily run takes the day seed, the day kit and stake 3, whatever the menu passed', () => {
  const day = D.dayKey();
  const r1 = RUN.createRun({ seed: 5, mode: 'debt', cfg: { daily: true, kit: 'heir', stake: 6 } });
  const r2 = RUN.createRun({ seed: 99999, mode: 'debt', cfg: { daily: true } });
  try {
    assert.equal(r1.seed, D.dailySeed(day));
    assert.equal(r2.seed, D.dailySeed(day), 'two menus, one seed');
    assert.equal(r1.config.kit, D.dailyKit(day));
    assert.equal(r1.config.stake, D.DAILY_STAKE);
    assert.equal(r1.config.daily, true);
    assert.equal(r1.config.stake, r2.config.stake);
    assert.equal(r1.shift.quota().due, r2.shift.quota().due, 'same day, same quota');
  } finally {
    r1.dispose();
    r2.dispose();
  }
});

test('a resumed daily run keeps its own day, not today', () => {
  const r = RUN.createRun({ seed: 1, mode: 'debt', cfg: { daily: true, dailyDay: '2026-10-01' } });
  try {
    assert.equal(r.seed, D.dailySeed('2026-10-01'));
    assert.equal(r.config.kit, D.dailyKit('2026-10-01'));
  } finally {
    r.dispose();
  }
});

test('a plain run ignores the daily rules', () => {
  const r = RUN.createRun({ seed: 42, mode: 'debt', cfg: { kit: 'pauper' } });
  try {
    assert.equal(r.seed, 42);
    assert.equal(r.config.daily, false);
    assert.equal(r.config.stake, 0);
  } finally {
    r.dispose();
  }
});

test('migrateSave keeps only well-formed daily bests under a day key', () => {
  const good = { seed: 3, kit: 'pauper', night: 7, obols: 120, result: 'fell' };
  const d = SAVE.migrateSave({ dailyBest: { '2026-10-15': good, 'yesterday': good, '2026-10-14': { seed: 'x' } } });
  assert.deepEqual(Object.keys(d.dailyBest), ['2026-10-15']);
  assert.equal(d.dailyBest['2026-10-15'].night, 7);
  assert.equal(d.dailyBest['2026-10-15'].date, '2026-10-15');
  assert.deepEqual(SAVE.migrateSave({}).dailyBest, {});
});
