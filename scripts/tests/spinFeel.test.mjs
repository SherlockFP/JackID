// Spin feel (wave 81): the pure numbers behind the streak pitch / glow and the Big One line-up tick, and a guard that every
// sfx name the slot-style machines and the juice helpers play has a recipe (a typo would be a silent no-op in the game).
// Presentation only: nothing here touches an outcome, a payout or the rng.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let tiers, show, sfx;
before(async () => {
  tiers = await load('src/machines/_base/tiers.ts');
  show = await load('src/machines/bigone/show.ts');
  sfx = await load('src/core/audio/sfx.ts');
});

const MACHINES = ['bigone', 'cascade', 'coinflip', 'plinko', 'keno', 'mines', 'videopoker', 'hilo'];

test('streakPitch: nothing on the first win, +0.5 semitone per win after it, capped at +4', () => {
  assert.equal(tiers.streakPitch(0), 0);
  assert.equal(tiers.streakPitch(1), 0);
  assert.equal(tiers.streakPitch(2), 0.5);
  assert.equal(tiers.streakPitch(3), 1);
  assert.equal(tiers.streakPitch(9), 4);
  assert.equal(tiers.streakPitch(50), 4, 'the cap holds');
});

test('streakGlow: 1 with no streak, +5 % per win after the first, capped at +40 %', () => {
  assert.equal(tiers.streakGlow(0), 1);
  assert.equal(tiers.streakGlow(1), 1);
  assert.ok(Math.abs(tiers.streakGlow(2) - 1.05) < 1e-9);
  assert.ok(Math.abs(tiers.streakGlow(9) - 1.4) < 1e-9);
  assert.ok(Math.abs(tiers.streakGlow(99) - 1.4) < 1e-9, 'the cap holds');
});

test('lineRun reads the run of one symbol on a row that ends on the reel; the curse and blanks never line up', () => {
  // row-major 3 x 5: row 0 = 1 1 1 2 2, row 1 = 3 4 3 4 3, row 2 = 5 5 6 6 6
  const g = [1, 1, 1, 2, 2, 3, 4, 3, 4, 3, 5, 5, 6, 6, 6];
  assert.equal(show.lineRun(g, 0), 1, 'the first reel has nothing to line up with');
  assert.equal(show.lineRun(g, 1), 2, '1 1 and 5 5');
  assert.equal(show.lineRun(g, 2), 3, '1 1 1');
  assert.equal(show.lineRun(g, 3), 2, '6 6 on the bottom row');
  assert.equal(show.lineRun(g, 4), 3, '6 6 6 on the bottom row');
  assert.equal(show.lineRun([-1, -1, 0, 0, 0, -1, -1, 0, 0, 0, -1, -1, 0, 0, 0], 1), 1, 'blanks do not line up');
});

test('lineUpPitch climbs with the run: a pair is the base note, then a third, a fifth, an octave', () => {
  assert.deepEqual([2, 3, 4, 5].map(show.lineUpPitch), [0, 4, 7, 12]);
  assert.equal(show.lineUpPitch(9), 12);
  assert.equal(show.lineUpPitch(0), 0);
});

test('every sfx the slot machines and the juice helpers play has a recipe', () => {
  const files = [...MACHINES.map((m) => `src/machines/${m}/index.ts`), 'src/machines/_base/juice.ts', 'src/machines/_base/MachineBase.ts'];
  const names = new Set();
  for (const f of files) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/(?:sfx|audio\.play)\(\s*'([A-Za-z0-9]+)'/g)) names.add(m[1]);
  }
  assert.ok(names.size > 30, 'the scan found the calls');
  for (const n of names) assert.ok(sfx.SFX_DEFS.has(n), `no recipe "${n}"`);
});

test('the spin cues vary a little per play, and a loss is a short dud, not a jingle', () => {
  for (const n of ['button', 'lever', 'reelStart', 'reelStop', 'win1', 'win2', 'lose']) {
    assert.ok((sfx.SFX_DEFS.get(n).meta.jitter ?? 0) > 0, `${n} has pitch jitter`);
  }
  const lose = sfx.SFX_DEFS.get('lose');
  assert.ok(!lose.meta.long, 'the dud is not slowed by slow-motion');
  assert.ok(lose.meta.gain < 1, 'the dud sits well under the win sounds');
});

test('every recorded clip real.ts can play is on disk (a typo would fall back to the synth forever, silently)', async () => {
  const real = await load('src/core/audio/real.ts');
  assert.ok(real.CLIP_URLS.length > 40, 'the clip list is filled');
  for (const u of ['sfx-mixkit-casino/slot_wheel_1932.mp3', 'sfx-oga-wins/win_fanfare_gchoc.ogg', 'sfx-mixkit-casino/classic_winner_alarm_1997.mp3']) {
    assert.ok(real.CLIP_URLS.some((x) => x.endsWith(u)), `${u} is wired`);
  }
  for (const u of real.CLIP_URLS) assert.ok(existsSync(join(ROOT, 'public', u.replace(/^\//, ''))), `missing ${u}`);
});

test('wave 83 sound pass: every vendored file is wired, every pack has its licence, the CC BY line is credited, the new names have recipes', async () => {
  const real = await load('src/core/audio/real.ts');
  const VENDOR = join(ROOT, 'public', 'assets', 'vendor');
  for (const d of ['sfx-obsydianx-ui', 'sfx-ci-400', 'sfx-halfwits-dice', 'sfx-heyheythere-footsteps', 'sfx-liminal-horror', 'sfx-polar-magic']) {
    assert.ok(existsSync(join(VENDOR, d, 'LICENSE.txt')), `${d} has a LICENSE.txt`);
    for (const f of readdirSync(join(VENDOR, d))) {
      if (f !== 'LICENSE.txt') assert.ok(real.CLIP_URLS.some((x) => x.endsWith(`${d}/${f}`)), `${d}/${f} is vendored but nothing plays it`);
    }
  }
  const CC = 'Footsteps SFX Free by heyheythere - https://heyheythere.itch.io/footsteps-sfx-free - CC BY 4.0';
  for (const f of ['docs/ASSETS.md', 'public/assets/vendor/sfx-heyheythere-footsteps/LICENSE.txt']) assert.ok(readFileSync(join(ROOT, f), 'utf8').includes(CC), `${f} carries the heyheythere credit`);
  const credits = readFileSync(join(ROOT, 'src/menu/menu.strings.ts'), 'utf8');
  assert.equal(credits.split('Footsteps SFX Free by heyheythere -|https://heyheythere.itch.io/footsteps-sfx-free - CC BY 4.0').length - 1, 2, 'the credit is on the Credits face in EN and TR');
  for (const n of ['confirm', 'back', 'creakLong', 'growl', 'windGust', 'dreadDrone', 'knockDoor', 'knockSingle', 'knockDistant', 'boonOffer', 'boonPick', 'omen', 'spell', 'divineEcho']) assert.ok(sfx.SFX_DEFS.has(n), `no recipe "${n}"`);
  for (const n of ['hover', 'click', 'error', 'popUp', 'card', 'cardFlip', 'shuffle', 'dice', 'diceLand', 'footstep', 'footstepWet']) assert.ok(sfx.SFX_DEFS.has(n), `${n} still has its recipe`);
});

test('the win ladder maps to its recipes; the jackpot plays the full show, the count-up sounds exist', () => {
  assert.equal(sfx.winSfx('jackpot'), 'jackpotShow');
  for (const n of ['jackpotShow', 'alarmBell', 'countDing', 'kachunk', 'jackpot']) assert.ok(sfx.SFX_DEFS.has(n), n);
  assert.ok(sfx.SFX_DEFS.get('jackpotShow').meta.long, 'the jackpot show drags with slow-motion');
});

test('countTicks: the count-up roll accelerates (gaps shrink) and stays inside the count', async () => {
  const juice = await load('src/machines/_base/juice.ts');
  const t = juice.countTicks(20);
  assert.equal(t.length, 20);
  assert.ok(t[0] > 0 && t[19] < 1);
  for (let i = 2; i < t.length; i++) assert.ok(t[i] - t[i - 1] < t[i - 1] - t[i - 2], `gap ${i} shrinks`);
  assert.deepEqual(juice.countTicks(0), []);
});

// Measured by scripts/qa/sfxLoud.mjs (muted headless Chrome, OfflineAudioContext). Skips until the fixture exists.
const LOUD = join(ROOT, 'scripts', 'tests', 'fixtures', 'sfxLoudness.json');
test('win tiers are stepped in measured loudness, nothing clips, and the trims are the ones measured', { skip: !existsSync(LOUD) && 'run node scripts/qa/sfxLoud.mjs first' }, () => {
  const m = JSON.parse(readFileSync(LOUD, 'utf8'));
  const order = ['small', 'medium', 'big', 'huge', 'mega', 'jackpot'];
  for (let i = 1; i < order.length; i++) {
    const a = m.tiers[order[i - 1]].stDb, b = m.tiers[order[i]].stDb;
    assert.ok(b >= a + 1.5, `${order[i]} (${b} dB) is at least 1.5 dB over ${order[i - 1]} (${a} dB)`);
  }
  assert.ok(m.tiers.jackpot.stDb - m.tiers.small.stDb >= 6, 'small to jackpot spans 6 dB or more');
  for (const [t, v] of Object.entries(m.tiers)) assert.ok(v.peak <= 1, `${t} does not clip (peak ${v.peak})`);
  assert.ok(m.headroom.jackpotMax.peak <= 1, `the jackpot does not clip with every slider at 1 (peak ${m.headroom.jackpotMax.peak})`);
  for (const [n, v] of Object.entries(m.cues)) assert.ok(v.peak <= 1, `${n} does not clip (peak ${v.peak})`);
  for (const [n, g] of Object.entries(m.trims)) assert.equal(sfx.SFX_DEFS.get(n).meta.gain, g, `${n} trim changed since the measurement: re-run sfxLoud`);
});
