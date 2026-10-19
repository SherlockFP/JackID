// Gamepad: the binding table covers every keymap action, no two actions share a pad code in one context, glyphs follow the
// last input device, and the dead zone / look curve behave. The input service runs on tiny fakes (window, document, pads).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

const GLOBALS = ['HTMLElement', 'window', 'document', 'location', 'KeyboardEvent'];
const saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
after(() => {
  for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  return closeVite();
});

let pad, km, createInput, bus;
before(async () => {
  pad = await load('src/core/input/pad.ts');
  km = await load('src/core/keymap.ts');
  ({ createInput } = await load('src/core/input.ts'));
  ({ bus } = await load('src/core/events.ts'));
});

test('every keymap action has a pad binding, except the keyboard-only ones', () => {
  const keyboardOnly = new Set(['chat', 'debug', 'debugColliders']);
  for (const k of Object.keys(km.ALL_DEFAULTS)) {
    assert.ok(k in km.DEFAULT_PAD_BINDINGS, `${k} has no pad entry`);
    assert.equal(km.DEFAULT_PAD_BINDINGS[k].length === 0, keyboardOnly.has(k), `${k}: unexpected pad emptiness`);
  }
  for (const [k, codes] of Object.entries(km.DEFAULT_PAD_BINDINGS)) {
    assert.ok(k in km.ALL_DEFAULTS, `pad entry for unknown action ${k}`);
    for (const c of codes) assert.match(c, /^Pad(\d+|\d\+\d+|Ls[UDLR])$/, `${k}: bad code ${c}`);
  }
});

test('no pad code is shared by two actions that are live together', () => {
  const D = km.DEFAULT_PAD_BINDINGS;
  const shared = (a, b) => /^phone(Opt|Reply)\d$/.test(a) && /^phone(Opt|Reply)\d$/.test(b) && a.at(-1) === b.at(-1)   // the phone sheets share digits (as on the keyboard)
    || (a === 'skip' && b === 'jump') || (a === 'jump' && b === 'skip')
    || (/^phoneOpt\d$/.test(a) && b === `m.n${a.at(-1)}`) || (/^phoneOpt\d$/.test(b) && a === `m.n${b.at(-1)}`);   // the modal swallows the machine digit
  const contexts = {
    walk: Object.keys(D).filter((k) => km.layerOf(k) === 'walk'),
    seated: Object.keys(D).filter((k) => km.layerOf(k) === 'machine' || km.SEATED_WALK_ACTIONS.has(k) || km.MODAL_WALK_ACTIONS.has(k)),
  };
  for (const [name, keys] of Object.entries(contexts)) {
    const seen = new Map();
    for (const k of keys) for (const c of D[k]) {
      for (const o of seen.get(c) ?? []) assert.ok(shared(k, o), `${name}: ${k} and ${o} both use ${c}`);
      seen.set(c, [...(seen.get(c) ?? []), k]);
    }
  }
});

test('dead zone and look curve', () => {
  assert.deepEqual(pad.stickVec(0.1, 0.1), { x: 0, y: 0, mag: 0 }, 'inside the dead zone is zero');
  const edge = pad.stickVec(0.21, 0);
  assert.ok(edge.x > 0 && edge.x < 0.02, 'just past the dead zone starts near zero (no jump)');
  assert.ok(Math.abs(pad.stickVec(1, 0).x - 1) < 1e-9, 'full tilt reaches 1');
  const diag = pad.stickVec(0.8, 0.8);
  assert.ok(Math.hypot(diag.x, diag.y) <= 1 + 1e-9, 'a diagonal never exceeds 1');
  assert.equal(pad.lookCurve(0), 0);
  assert.equal(pad.lookCurve(1), 1);
  assert.ok(pad.lookCurve(0.5) < 0.5, 'half tilt turns less than half speed');
  let prev = -1;
  for (let m = 0; m <= 1; m += 0.05) { const v = pad.lookCurve(m); assert.ok(v >= prev); prev = v; }
});

test('LT and RT are shifts; a stick is a digital direction only outside walking', () => {
  const st = new pad.PadState();
  const snap = (down = [], axes = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })), axes });
  assert.deepEqual(st.poll(snap([0]), false).down, ['Pad0']);
  assert.deepEqual(st.poll(snap([]), false).up, ['Pad0']);
  assert.deepEqual(st.poll(snap([6]), false), { down: [], up: [] }, 'LT alone fires nothing');
  assert.deepEqual(st.poll(snap([6, 2]), false).down, ['Pad6+2'], 'LT + X');
  assert.deepEqual(st.poll(snap([6]), false).up, ['Pad6+2']);
  st.poll(snap([]), false);
  assert.deepEqual(st.poll(snap([7, 3]), false).down, ['Pad7+3'], 'RT + Y');
  st.poll(snap([]), false);
  assert.deepEqual(st.poll(snap([], [0, -1, 0, 0]), true).down, ['PadLsU'], 'stick up, digital');
  assert.deepEqual(st.poll(snap([], [0, -0.4, 0, 0]), true).up, [], 'hysteresis keeps it held at 0.4');
  assert.deepEqual(st.poll(snap([], [0, -0.2, 0, 0]), true).up, ['PadLsU']);
  assert.deepEqual(st.poll(snap([], [0, -1, 0, 0]), false).down, [], 'walking: no digital codes');
  assert.ok(st.ly < 0, 'walking reads the stick as analog');
  assert.equal(st.poll(null, true).down.length, 0, 'an unplugged pad is quiet');
});

test('glyph names', () => {
  assert.equal(pad.padLabel('Pad0'), 'A');
  assert.equal(pad.padLabel('Pad6+2'), 'LT+X');
  assert.equal(pad.padLabel('Pad12'), '↑');
  assert.deepEqual(pad.padDomKey('Pad7+0', 'ui'), ['Digit1', '1']);
  assert.deepEqual(pad.padDomKey('Pad14', 'cutscene'), ['Digit1', '1'], 'duel overlays: d-pad left is choice 1');
  assert.deepEqual(pad.padDomKey('Pad14', 'ui'), ['ArrowLeft', 'ArrowLeft']);
});

function rig() {
  class KE extends Event { constructor(t, i) { super(t, i); this.code = i.code; this.key = i.key; this.repeat = i.repeat; } }
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.pointerLockElement = null; doc.activeElement = null; doc.hidden = false; doc.documentElement = {};
  doc.getElementById = () => null;
  doc.createElement = () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
  doc.body = { appendChild() {} };
  doc.exitPointerLock = () => {};
  const canvas = new EventTarget();
  canvas.dataset = {}; canvas.focus = () => {}; canvas.requestPointerLock = () => undefined;
  Object.assign(globalThis, { HTMLElement: class {}, window: win, document: doc, location: { search: '?nolock=1' }, KeyboardEvent: KE });
  const state = { down: new Set(), axes: [0, 0, 0, 0] };
  const pads = [{ connected: true, mapping: 'standard', get buttons() { return Array.from({ length: 17 }, (_, i) => ({ pressed: state.down.has(i) })); }, get axes() { return state.axes; } }];
  const input = createInput(canvas, {}, () => pads);
  const frame = () => { input.beginFrame(); input.beginStep(); input.endStep(); };
  return { win, input, state, frame };
}

test('seated spin on the pad; the hint glyph follows the last device', () => {
  const { win, input, state, frame } = rig();
  const got = [];
  input.setMachineSink({ onInput: (e) => got.push(`${e.action}:${e.down ? 'down' : 'up'}`), onPointer() {} });
  input.setMode('machine');
  const seen = [];
  bus.on('input:device', ({ device }) => seen.push(device));
  assert.equal(input.keyLabel('m.primary'), 'SPACE');
  state.down.add(0); frame();
  assert.deepEqual(got, ['primary:down'], 'A spins');
  assert.equal(input.device, 'pad');
  assert.equal(input.keyLabel('m.primary'), 'A');
  assert.equal(input.keyLabel('m.betUp'), 'RB');
  assert.equal(input.keyLabel('chat'), 'ENTER', 'an action with no pad button keeps its key');
  state.down.delete(0); frame();
  assert.deepEqual(got, ['primary:down', 'primary:up']);
  state.down.add(5); frame();
  assert.equal(got.at(-1), 'betUp:down', 'RB raises the bet');
  state.down.delete(5); frame();
  state.down.add(6); state.down.add(0); frame();
  assert.equal(got.at(-1), 'collect:down', 'LT + A collects');
  state.down.clear(); frame();
  const e = new Event('keydown'); e.code = 'KeyW'; e.repeat = false; win.dispatchEvent(e);
  assert.equal(input.device, 'kb', 'a key press flips back');
  assert.equal(input.keyLabel('m.primary'), 'SPACE');
  assert.deepEqual(seen, ['pad', 'kb']);
});

test('menu navigation: the d-pad and A reach the page as ArrowDown and Enter', () => {
  const { win, input, state, frame } = rig();
  input.setMode('menu');
  const keys = [];
  win.addEventListener('keydown', (e) => keys.push(e.code));
  state.down.add(13); frame();
  state.down.clear(); frame();
  state.down.add(0); frame();
  assert.deepEqual(keys, ['ArrowDown', 'Enter']);
  const real = new Event('keydown'); real.code = 'ArrowUp'; real.repeat = false; win.dispatchEvent(real);
  assert.equal(input.device, 'kb');
});

test('walking: the left stick is analog, the right stick turns the camera with the settings', async () => {
  const { input, state, frame } = rig();
  input.setMode('walk');
  state.axes = [0.6, -0.6, 0, 0]; frame();
  const m = input.move();
  assert.ok(m.x > 0 && m.z < 0 && Math.hypot(m.x, m.z) <= 1 + 1e-9);
  state.axes = [0, 0, 0, 0]; frame();
  assert.deepEqual({ x: input.move().x, z: input.move().z }, { x: 0, z: 0 });
  input.look();
  state.axes = [0, 0, 1, 0]; frame(); await new Promise((r) => setTimeout(r, 25)); frame();
  const l = input.look();
  assert.ok(l.dx > 0, 'stick right looks right');
  assert.equal(l.dy, 0);
  state.axes = [0, 0, 0, 0]; frame();
  assert.deepEqual(input.look(), { dx: 0, dy: 0 });
});
