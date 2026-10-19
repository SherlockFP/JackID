// A modal closing hands the mouse back: ui:blocking off re-requests the pointer lock, and a refused lock (auto-pick, no gesture)
// is retaken by the next click or key (not Esc). Headless: window / document / canvas are tiny fakes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

const GLOBALS = ['HTMLElement', 'window', 'document', 'location'];
const saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
after(() => {   // the other suites must not see the fakes
  for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  return closeVite();
});

let createInput, bus;
before(async () => {
  ({ createInput } = await load('src/core/input.ts'));
  ({ bus } = await load('src/core/events.ts'));
});

function rig({ allow }) {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  doc.activeElement = null;
  doc.hidden = false;
  doc.documentElement = {};   // i18n.setLang writes .lang
  doc.getElementById = () => null;
  doc.createElement = () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
  doc.body = { appendChild() {} };
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  const canvas = new EventTarget();
  canvas.dataset = {};
  canvas.focus = () => {};
  const tries = { n: 0 };
  canvas.requestPointerLock = () => {
    tries.n++;
    if (allow.v) { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange')); }
    else doc.dispatchEvent(new Event('pointerlockerror'));
    return undefined;
  };
  Object.assign(globalThis, { HTMLElement: class {}, window: win, document: doc, location: { search: '' } });
  const input = createInput(canvas, {});
  return { win, input, tries };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const press = (win, type, code = 'KeyW') => { const e = new Event(type); e.code = code; e.repeat = false; win.dispatchEvent(e); };

test('modal close re-requests the lock; a refused lock is retaken by the next key or click, never by Esc', async () => {
  const allow = { v: false };
  const { win, input, tries } = rig({ allow });
  input.setMode('walk');
  bus.emit('ui:blocking', { blocking: true });
  assert.equal(input.mode, 'ui');
  await flush();
  const before = tries.n;
  bus.emit('ui:blocking', { blocking: false });   // the modal closed: walk again, lock asked for (refused here: no gesture)
  await flush();
  assert.ok(tries.n > before, 'closing the modal asks for the lock');
  assert.equal(input.locked, false);
  const n = tries.n;
  press(win, 'keydown', 'Escape');
  await flush();
  assert.equal(tries.n, n, 'Esc does not ask');
  allow.v = true;
  press(win, 'keydown', 'KeyW');
  await flush();
  assert.equal(input.locked, true, 'the next key takes the mouse back');
  assert.equal(input.mode, 'walk');
});

test('a click anywhere (pointerdown) retakes a refused lock', async () => {
  const allow = { v: false };
  const { win, input } = rig({ allow });
  input.setMode('walk');
  await flush();
  assert.equal(input.locked, false);
  allow.v = true;
  win.dispatchEvent(new Event('pointerdown'));
  await flush();
  assert.equal(input.locked, true);
});

test('a cutscene that starts under a panel and ends after it closes leaves input in walk mode', async () => {
  const { endCutsceneMode } = await load('src/core/input.ts');
  const { input } = rig({ allow: { v: true } });
  input.setMode('walk');
  bus.emit('ui:blocking', { blocking: true });          // the Dawn panel is up
  assert.equal(input.mode, 'ui');
  assert.equal(input.baseMode, 'walk', 'the saved mode is the base, not the effective ui');
  input.setMode('cutscene');                             // the chapter card starts under it
  bus.emit('ui:blocking', { blocking: false });          // the panel closes mid-scene
  assert.equal(input.mode, 'cutscene');
  endCutsceneMode(input, 'walk');                        // the scene ends
  assert.equal(input.mode, 'walk');
  // ending while a panel is still up must not strand the base in 'cutscene'
  input.setMode('cutscene');
  bus.emit('ui:blocking', { blocking: true });
  endCutsceneMode(input, 'walk');
  bus.emit('ui:blocking', { blocking: false });
  assert.equal(input.mode, 'walk');
  // a state change that already set its own mode is left alone
  input.setMode('machine');
  endCutsceneMode(input, 'walk');
  assert.equal(input.mode, 'machine');
});

test('look filter: first move after a lock and any single spike over 25% of the screen width (500 px floor) are dropped', async () => {
  const { win, input } = rig({ allow: { v: true } });
  win.innerWidth = 4000;
  const move = (dx, dy) => { const e = new Event('mousemove'); e.movementX = dx; e.movementY = dy; win.dispatchEvent(e); };
  input.setMode('walk');
  await input.requestLock();
  assert.equal(input.locked, true);
  move(40, 10);                                   // the stray first event: ignored
  assert.equal(input.pendDx, 0);
  move(30, -5);                                   // normal move
  assert.deepEqual([input.pendDx, input.pendDy], [30, -5]);
  move(249, 0);                                   // a fast flick under 25% of 4000px still counts
  assert.equal(input.pendDx, 279);
  move(1000, 0);                                  // a spike: dropped
  move(0, -1900);
  assert.deepEqual([input.pendDx, input.pendDy], [279, -5]);
});
