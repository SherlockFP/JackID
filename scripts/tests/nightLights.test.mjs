// NIGHT CYCLE (presentation only): the run phase to light levels, the section-by-section plan, the screens' CRT pose, and the
// runtime against a recording stand-in for the light pool. Lights Die coordination: `restoreNightLights` puts the cycle back.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let N;
before(async () => { N = await load('src/world/nightLights.ts'); });

const SPOTS = [
  { id: 'mouth', kind: 'floor', x: 0, z: -24 }, { id: 'well', kind: 'floor', x: 0, z: -8 }, { id: 'lobby', kind: 'floor', x: 0, z: 11 },
  { id: 'parlour', kind: 'floor', x: 21, z: 16 },
  { id: 'keep:bar', kind: 'keep', x: -6, z: 14 }, { id: 'core:lift', kind: 'core', x: -4, z: -30 },
];

test('the run phase maps to a cycle phase; no quota phase means no cycle', () => {
  assert.equal(N.nightPhaseOf('bell', false), 'opening');
  assert.equal(N.nightPhaseOf('play', false), 'watch');
  assert.equal(N.nightPhaseOf('lastCall', false), 'lastCall');
  assert.equal(N.nightPhaseOf('closing', false), 'mola');
  assert.equal(N.nightPhaseOf('settle', false), 'mola');
  assert.equal(N.nightPhaseOf('intermission', false), 'mola');
  assert.equal(N.nightPhaseOf('intermission', true), 'dawn', 'a paid Night stays dark until the floor opens');
  assert.equal(N.nightPhaseOf('collection', false), 'dawn');
  assert.equal(N.nightPhaseOf('idle', false), null);
  assert.equal(N.nightPhaseOf(undefined, false), null);
});

test('Dawn clicks the zones off from the far end to the lift, then the bar dies and the core dims', () => {
  const p = N.planNight('mola', 'dawn', SPOTS, false);
  const floor = p.steps.filter((s) => s.kind === 'floor');
  assert.deepEqual(floor.map((s) => s.id), ['parlour', 'lobby', 'well', 'mouth'], 'far zone first, nearest the lift last');
  assert.ok(floor.every((s) => s.level === 0));
  const last = Math.max(...floor.map((s) => s.at + s.dur));
  const rest = p.steps.filter((s) => s.kind !== 'floor');
  assert.ok(rest.every((s) => s.at >= last - 1e-9), 'bar, pawn and core never start under a running zone step');
  assert.equal(rest.find((s) => s.id === 'keep:bar').level, 0);
  assert.equal(rest.find((s) => s.id === 'core:lift').level, 0.6, 'the lift keeps a warm light');
  assert.ok(last <= N.SPAN_S + 1e-9);
});

test('the Night opens from the lift outward; Mola keeps the bar lit; Calm gets slow fades', () => {
  const o = N.planNight('dawn', 'opening', SPOTS, false);
  assert.deepEqual(o.steps.filter((s) => s.kind === 'floor').map((s) => s.id), ['mouth', 'well', 'lobby', 'parlour']);
  const m = N.planNight('lastCall', 'mola', SPOTS, false);
  assert.ok(m.steps.every((s) => s.kind === 'floor' && s.level === 0.5 && s.at === 0), 'bar and core stay lit: no step for them');
  const calm = N.planNight('mola', 'dawn', SPOTS, true);
  assert.ok(calm.steps.filter((s) => s.kind === 'floor').every((s) => s.dur >= 1), 'no hard click under reduceFlashing');
  const snap = N.planNight(null, 'dawn', SPOTS, false);
  assert.ok(snap.steps.every((s) => s.at === 0 && s.dur === 0) && snap.ambient.dur === 0, 'a load into Dawn lands dark at once');
  assert.equal(N.planNight('watch', 'lastCall', SPOTS, false).steps.length, 0, 'Last Call changes no level (it pulses)');
});

test('a screen collapses to a line then goes off at Dawn, reads CLOSED at the Mola, and boots only out of the dark', () => {
  assert.equal(N.screenPose('watch', 5, 0, false, false).shutter, 0);
  assert.equal(N.screenPose('mola', 1, 0, false, false).closed, true);
  assert.equal(N.screenPose('dawn', 0.05, 0, false, false).shutter > 0, true);
  const line = N.screenPose('dawn', 0.2, 0, false, false);
  assert.equal(line.shutter, 1);
  assert.ok(line.line > 0, 'the bright line');
  const off = N.screenPose('dawn', 2, 0, false, false);
  assert.equal(off.shutter, 1);
  assert.equal(off.line, 0);
  assert.equal(N.screenPose('dawn', 1, 2, false, false).shutter, 0, 'its section has not been reached yet');
  assert.equal(N.screenPose('opening', 0, 1, true, false).shutter, 1, 'dark until its section is reached');
  assert.equal(N.screenPose('opening', 5, 1, true, false).shutter, 0);
  assert.equal(N.screenPose('opening', 0.1, 0, false, false).shutter, 0, 'out of the Mola the screens just wake');
  assert.equal(N.screenPose('dawn', 0.5, 0, false, true).line, 0, 'reduced: no flashing line');
});

function rig(phaseRef, over = {}) {
  const calls = [];
  const lights = {
    setLevel: (t, l, d) => calls.push(['level', t, l, d]), pulse: (t, o) => calls.push(['pulse', t, o]),
    setAmbient: (l, d) => calls.push(['amb', l, d]), flicker() {}, strobe() {}, setDread() {}, reset() {},
  };
  let music = 'menu';
  const cycle = N.createNightCycle({
    lights, spots: SPOTS, target: (id) => id, phase: () => phaseRef.p, reduced: () => false, busy: () => phaseRef.busy ?? false,
    fixtures: (z, on) => calls.push(['fx', z, on]), ringBell: () => calls.push(['bell']),
    audio: {
      sfx: (n) => calls.push(['sfx', n]), duck: (b) => calls.push(['duck', b]),
      musicState: () => music, setMusicState: (s) => { music = s; calls.push(['music', s]); },
    },
    ...over,
  });
  return { cycle, calls };
}

test('the cycle plays Last Call (bell, amber pulse, low music), Dawn (dark, music stops) and the opening (jingle, music back)', () => {
  const ph = { p: 'watch' };
  const { cycle, calls } = rig(ph);
  cycle.update(0.1);
  ph.p = 'lastCall';
  cycle.update(0.1);
  assert.ok(calls.some((c) => c[0] === 'bell'));
  assert.ok(calls.some((c) => c[0] === 'pulse' && c[2].color === 0xffa648));
  assert.ok(calls.some((c) => c[0] === 'duck' && c[1] === 'music'));
  ph.p = 'mola';
  cycle.update(0.1);
  assert.ok(calls.some((c) => c[0] === 'duck' && c[1] === 'amb'), 'the crowd bed drops at the Mola');
  calls.length = 0;
  ph.p = 'dawn';
  for (let i = 0; i < 41; i++) cycle.update(0.1);
  assert.ok(calls.some((c) => c[0] === 'sfx' && c[1] === 'powerDown'));
  assert.deepEqual(calls.filter((c) => c[0] === 'music'), [['music', 'silent']]);
  const off = calls.filter((c) => c[0] === 'fx' && c[2] === false).map((c) => c[1]);
  assert.deepEqual(off, ['parlour', 'lobby', 'well', 'mouth'], 'lamps go off section by section, far end first');
  assert.equal(N.nightClock().phase, 'dawn');
  calls.length = 0;
  ph.p = 'opening';
  cycle.update(0.1);
  assert.ok(calls.some((c) => c[0] === 'sfx' && c[1] === 'powerUp'));
  assert.ok(calls.some((c) => c[0] === 'music' && c[1] === 'menu'), 'the music comes back where it was');
  cycle.dispose();
  assert.equal(N.nightClock().phase, null);
});

test('Calm Mode: Last Call is a bell and a slow, gentle wash', () => {
  const ph = { p: 'watch' };
  const { cycle, calls } = rig(ph, { reduced: () => true });
  cycle.update(0.1);
  ph.p = 'lastCall';
  cycle.update(0.1);
  const pulse = calls.find((c) => c[0] === 'pulse');
  assert.ok(pulse && pulse[2].mul <= 1.12 && pulse[2].dur >= 2);
  cycle.dispose();
});

test('after the Lights Die the cycle puts its own levels back; with no cycle it is the old blanket 1', () => {
  const ph = { p: 'mola' };
  const { cycle, calls } = rig(ph);
  cycle.update(0.1);
  calls.length = 0;
  const lights = { setLevel: (...a) => calls.push(['direct', ...a]) };
  N.restoreNightLights(lights);
  assert.ok(calls.some((c) => c[0] === 'level' && c[1] === 'well' && c[2] === 0.5), 'half-light at the Mola, not 1');
  assert.ok(calls.some((c) => c[0] === 'level' && c[1] === 'keep:bar' && c[2] === 1));
  assert.ok(!calls.some((c) => c[0] === 'direct'));
  cycle.dispose();
  calls.length = 0;
  N.restoreNightLights(lights);
  assert.deepEqual(calls, [['direct', 'all', 1, 1.2]]);
});

test('the bell is shorter than the opening: the Watch does not cut the section-by-section boot short', () => {
  const ph = { p: 'dawn' };
  const { cycle, calls } = rig(ph);
  cycle.update(0.1);
  ph.p = 'opening';
  cycle.update(0.1);
  ph.p = 'watch';
  for (let i = 0; i < 12; i++) cycle.update(0.1);
  assert.equal(N.nightClock().phase, 'opening', 'screens still booting at 1.3 s');
  for (let i = 0; i < 30; i++) cycle.update(0.1);
  assert.equal(N.nightClock().phase, 'watch');
  const on = calls.filter((c) => c[0] === 'fx' && c[2] === true).map((c) => c[1]);
  assert.deepEqual(on, ['mouth', 'well', 'lobby', 'parlour'], 'every zone still came on, lift outward');
  cycle.dispose();
});
