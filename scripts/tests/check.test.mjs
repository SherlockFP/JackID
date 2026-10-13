// Self-test for scripts/check.mjs: runs the linter on two fixture trees and two bench dumps and asserts that every
// rule fires where it should and stays silent where it should not. Fixtures live in scripts/tests/fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, '..', 'check.mjs');
const FIXTURES = join(HERE, 'fixtures');

function runCheck(root, dump) {
  const env = { ...process.env, JACKID_CHECK_ROOT: root };
  delete env.JACKID_BENCH_DUMP;
  if (dump) env.JACKID_BENCH_DUMP = dump;
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env, timeout: 170000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('a clean tree passes with no errors and no warnings', () => {
  const r = runCheck(join(FIXTURES, 'lint-clean'));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /check: 0 error\(s\), 0 warning\(s\)/);
});

const EXPECTED_ERRORS = [
  'placeholders differ for "common.greet"',
  '"common.only" missing in tr',
  '"common.extra" missing in en',
  'plural "common.coins.one" has no "common.coins.other"',
  'key "charm.x.name" outside common.* / ui.*',
  'default export must be { prefix: "ns.", en, tr }',
  '"host" missing in tr',
  'def.id "wrongid" !== folder "badmachine"',
  'strings.en.desc is required',
  '"desc" missing in en',
  't("menu.missingKey") is not registered',
  'hard-coded text "Play now" outside t()',
  '`Math.random` is forbidden',
  '`console.*` is forbidden',
  'forbidden original-IP term in string "Treasure Chest"',
  'forbidden original-IP term in string "clover"',
  'setTimeout/setInterval in gameplay code',
  'core must not import "@/game/types" as a value',
  'core may import only three, found package "trystero"',
  'machines/badmachine must not import "../../menu/menuState" as a value',
  'machines/badmachine must not import "../../world/world" as a value',
  'machine imports another machine folder "../coinflip/index"',
];
const EXPECTED_WARNINGS = [
  'hard-coded text "Win streak" outside t()',
  'wall-clock read in gameplay code',
  'id is not in the TECH_SPEC §11.1 catalogue',
  'missing `playHeadless` named export',
];

test('the bad tree reports every planted rule violation', () => {
  const r = runCheck(join(FIXTURES, 'lint-bad'));
  assert.equal(r.code, 1, r.out);
  for (const needle of [...EXPECTED_ERRORS, ...EXPECTED_WARNINGS]) {
    assert.ok(r.out.includes(needle), `missing report: ${needle}\n${r.out}`);
  }
});

test('the bad tree stays silent on exempt and opted-out text', () => {
  const r = runCheck(join(FIXTURES, 'lint-bad'));
  assert.ok(!r.out.includes('Hit_Chest'), 'vendor clip name must be exempt');
  assert.ok(!r.out.includes('Ignored text'), 'i18n-ok line must be skipped');
  assert.ok(!r.out.includes('Also ignored'), 'i18n-ok line must be skipped');
  assert.ok(!r.out.includes('Bet'), 'a t()-free key table must not be flagged');
});

test('a bench dump within budget passes and reports per-machine numbers', () => {
  const r = runCheck(join(FIXTURES, 'lint-clean'), join(FIXTURES, 'dump-ok.json'));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /budget coinflip \(S\): tris 900\/2500/);
});

test('a bench dump over budget fails on frame and machine limits', () => {
  const r = runCheck(join(FIXTURES, 'lint-clean'), join(FIXTURES, 'dump-over.json'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /frame tris 90000 over budget 70000/);
  assert.match(r.out, /machine "coinflip" \(S\) over budget: tris 2600\/2500/);
});
