// Tests for the first-person arms (src/player/viewmodel.ts and viewmodel/*): the rigged arms load from the real GLB (read from disk,
// textures stubbed), every clip an animation names exists, every one-shot animation moves the hands smoothly (no frame-to-frame pop
// at its start, its end or when another cuts in), the promises resolve on sim time, food can be bitten, held items hang from the
// hand bone, a GLB that cannot load leaves the game running without hands, and the motion does not depend on the frame rate.
// Real THREE objects, no WebGL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let VM, ARMS, ANIMS, ITEMS, FOOD, MEAL, SRC;
before(async () => {
  VM = await load('src/player/viewmodel.ts');
  ARMS = await load('src/player/viewmodel/arms.ts');
  const b = readFileSync(`${ROOT}/public/assets/vendor/drillimpact-psx-arms/arms_rig.glb`);
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'noTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));    // no image decoding in node
  SRC = ARMS.armsFromGltf(await loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''));
  ANIMS = (await load('src/player/viewmodel/anims.ts')).ANIMS;
  ITEMS = await load('src/player/viewmodel/items.ts');
  FOOD = await load('src/world/props/food.ts');
  MEAL = await load('src/game/food.ts');
});

const DRIVE = { bobX: 0, bobY: 0, sprint: false, crouch: 0, grounded: true, lookDx: 0, lookDy: 0, aspect: 16 / 9, speed: 0 };
const make = async (item, source = Promise.resolve(SRC)) => {
  const vm = VM.createViewmodel(undefined, undefined, source);
  await vm.ready;
  vm.drive(DRIVE);
  if (item) vm.hold(item);
  for (let i = 0; i < 90; i++) vm.update(1 / 60);       // the raise-in of the item settles
  return vm;
};
const bone = (vm, name) => { let found = null; vm.scene.traverse((o) => { if (o.name === name) found = o; }); return found; };
const tris = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3; }); return n; };
/** Where the hands are (position and finger direction of both hand bones, which carry the wrist spring): the pose as the player sees it. */
const sample = (vm) => {
  const p = [];
  vm.scene.updateMatrixWorld(true);
  for (const name of ['handR', 'handL']) {
    const hand = bone(vm, name);
    p.push(...hand.getWorldPosition(new THREE.Vector3()).toArray());
    p.push(...new THREE.Vector3(0, 1, 0).transformDirection(hand.matrixWorld).toArray());     // where the fingers point (no Euler wrap)
  }
  return p;
};
/** The held food's bite pivot, if it has one. */
const pivotOf = (vm) => { let found = null; vm.scene.traverse((o) => { if (o.userData.bite) found = o.userData.bite; }); return found; };
/** The trick coin (the second thing in the scene, after the rig), or null when it is the held coin that shows. */
const trickCoinOf = (vm) => { const c = vm.scene.children[1]; return c && c.visible ? c : null; };

test('the arms are the rigged GLB: one skinned mesh of 1176 triangles, both hands low in frame at rest (the wrist at the bottom edge)', async () => {
  const vm = await make();
  let skinned = 0;
  vm.scene.traverse((o) => { if (o.isSkinnedMesh) { skinned++; assert.equal(o.skeleton.bones.length, 52); } });
  assert.equal(skinned, 1);
  vm.scene.traverse((o) => { if (o.isSkinnedMesh) assert.equal(tris(o), 1176); });
  vm.scene.updateMatrixWorld(true);
  vm.camera.updateMatrixWorld(true);
  for (const name of ['handR', 'handL']) {
    const v = bone(vm, name).getWorldPosition(new THREE.Vector3()).project(vm.camera);
    assert.ok(Math.abs(v.x) < 0.95 && v.y > -1.3 && v.y < -0.4, `${name} at screen ${v.x.toFixed(2)}, ${v.y.toFixed(2)}`);
  }
  vm.dispose();
});

test('every clip an animation or a held item asks for is in the GLB', () => {
  for (const [name, def] of Object.entries(ANIMS)) {
    for (const clip of [def.clip?.r, def.clip?.l]) if (clip) assert.ok(SRC.clips.has(clip), `${name} wants ${clip}`);
  }
  for (const clip of ['relax', 'grab.R', 'grab.L', 'push.R', 'guard_idle', 'finger_gun_idle', 'finger_gun_fire']) assert.ok(SRC.clips.has(clip), clip);
  assert.equal(ANIMS.eat.clip.r, 'grab.R');
  assert.equal(ANIMS.punchCard.clip.r, 'push.R');
});

test('a GLB that cannot load leaves no hands and the game running: animations still resolve', async () => {
  const vm = await make('banana', Promise.resolve(null));
  let skinned = 0;
  vm.scene.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
  assert.equal(skinned, 0);
  let done = 0;
  for (const a of ['eat', 'flip', 'rpsRock']) void vm.play(a).then(() => { done++; });
  for (let i = 0; i < 200; i++) vm.update(1 / 60);
  await Promise.resolve();
  assert.equal(done, 3);
  vm.hold('phone'); vm.setHandLook({ porcelain: true, fingers: 2 }); vm.setGloveColor(0xe6dec5); vm.update(1 / 60);
  vm.dispose();
});

test('a held item hangs from the hand bone, so it moves with the clips (the phone in the left hand)', async () => {
  const vm = await make('banana');
  let held = null;
  vm.scene.traverse((o) => { if (o.userData.bite) held = o; });
  const ancestors = (o) => { const n = []; for (let p = o.parent; p; p = p.parent) n.push(p.name); return n; };
  assert.ok(ancestors(held).includes('handR'));
  const at = (o) => { vm.scene.updateMatrixWorld(true); return o.getWorldPosition(new THREE.Vector3()); };
  const before = at(held);
  void vm.play('eat');
  for (let i = 0; i < 25; i++) vm.update(1 / 60);
  assert.ok(at(held).distanceTo(before) > 0.05, 'the banana goes up with the hand');
  vm.hold('phone');
  let phone = 0;
  bone(vm, 'handL').traverse((o) => { if (o.isMesh) phone++; });
  assert.ok(phone >= 3, 'the handset is in the left hand');
  vm.dispose();
});

test('every animation moves the hands smoothly: no pop at its start or its end', async () => {
  const MAX_POS = 0.04, MAX_ROT = 0.16;               // per 1/60 s frame (2.4 m/s, 9.6 rad/s: a thrust is quick, a pop is a jump of centimetres in one frame)
  for (const name of Object.keys(ANIMS)) {
    const vm = await make(name === 'drink' ? 'coffee' : name === 'eat' ? 'banana' : null);
    let prev = sample(vm), done = false;
    void vm.play(name).then(() => { done = true; });
    const frames = Math.ceil((ANIMS[name].dur + 0.6) * 60);
    for (let f = 0; f < frames; f++) {
      vm.update(1 / 60);
      const cur = sample(vm);
      for (let i = 0; i < cur.length; i++) {
        const d = Math.abs(cur[i] - prev[i]);
        assert.ok(d < (i % 6 < 3 ? MAX_POS : MAX_ROT), `${name} frame ${f} channel ${i}: moved ${d.toFixed(4)} in one frame`);
      }
      prev = cur;
    }
    await Promise.resolve();
    assert.ok(done, `${name} resolved after its length`);
    vm.dispose();
  }
});

test('an animation cut off by another fades out instead of snapping', async () => {
  const vm = await make();
  void vm.play('throw');
  for (let i = 0; i < 24; i++) vm.update(1 / 60);       // mid wind-up
  let prev = sample(vm);
  void vm.play('point');
  for (let f = 0; f < 40; f++) {
    vm.update(1 / 60);
    const cur = sample(vm);
    for (let i = 0; i < cur.length; i++) assert.ok(Math.abs(cur[i] - prev[i]) < (i % 6 < 3 ? 0.04 : 0.16), `frame ${f} channel ${i}`);
    prev = cur;
  }
  vm.dispose();
});

test('eat and drink resolve before their tail ends, so the game can swap the item while the hand settles', async () => {
  for (const [name, item] of [['eat', 'sandwich'], ['drink', 'energy']]) {
    const vm = await make(item);
    let at = -1, clock = 0;
    void vm.play(name).then(() => { at = clock; });
    for (let f = 0; f < Math.ceil(ANIMS[name].dur * 60) + 5; f++) { vm.update(1 / 60); clock += 1 / 60; await Promise.resolve(); }
    assert.ok(at > 0 && at < ANIMS[name].dur - 0.05, `${name} resolved at ${at.toFixed(2)} s of ${ANIMS[name].dur}`);
    vm.dispose();
  }
  assert.ok(ANIMS.drink.dur >= 1.3 && ANIMS.drink.dur <= 1.6 && ANIMS.eat.dur <= 1.6, 'a bite or a sip takes about a second and a half');
});

test('meals always end in the clean rest pose: drink, eat, a Q pass, drink (through showMeal), no item left in either hand, the coin back in the right', async () => {
  const BONES = ['shoulderR', 'forearmR', 'handR', 'f_index01R', 'f_index03R', 'thumb03R', 'f_pinky03R', 'shoulderL', 'forearmL', 'handL', 'f_index03L', 'thumb03L'];
  const read = (vm) => { vm.scene.updateMatrixWorld(true); return BONES.map((n) => { const o = bone(vm, n); return [o.getWorldPosition(new THREE.Vector3()), o.getWorldQuaternion(new THREE.Quaternion())]; }); };
  const meshes = (vm) => ['handR', 'handL'].map((n) => { let k = 0; bone(vm, n).traverse((o) => { if (o.isMesh) k++; }); return k; });
  let frames = 0;
  const run = async (vm, n) => { for (let f = 0; f < n; f++) { vm.update(1 / 60); frames++; await Promise.resolve(); } };    // a microtask per frame: an animation's promise resolves between frames, as in the game
  const vm = await make();
  frames = 0;
  const steps = [['coffee', 100], ['banana', 100], [null, 54], ['soup', 100]];
  for (const [food, n] of steps) {
    if (food) MEAL.showMeal(vm, food);
    else { vm.trick(true); vm.trick(false); }                                       // the Q pass: the coin goes to the left hand
    await run(vm, n);
  }
  assert.equal(vm.item, 'coin', 'the hand holds its coin again');
  await run(vm, 120);
  // the reference never ate: it put something away at the same moment instead, so both stand the same time since their last change
  const ref = await make();
  await run(ref, frames - 120 - 90);
  ref.hold('tonic'); ref.hold('coin');
  await run(ref, 120 + 90);
  const a = read(vm), b = read(ref);
  a.forEach(([p, q], i) => {
    assert.ok(p.distanceTo(b[i][0]) < 0.004, `${BONES[i]} is ${(p.distanceTo(b[i][0]) * 100).toFixed(1)} cm off its rest place`);
    assert.ok(q.angleTo(b[i][1]) < 0.06, `${BONES[i]} is turned ${q.angleTo(b[i][1]).toFixed(2)} rad off its rest`);
  });
  assert.deepEqual(meshes(vm), meshes(ref), 'nothing is left attached to either hand');
  assert.equal(pivotOf(vm), null, 'no food in the hand');
  assert.equal(trickCoinOf(vm), null, 'the coin is in the right hand, not left in the left');
  vm.dispose(); ref.dispose();
});

test('a meal ends without a snap: the hand swaps back to its coin without a jump, and the cup never grows back once it is being put away', async () => {
  for (const food of ['coffee', 'banana']) {
    const vm = await make();
    MEAL.showMeal(vm, food);
    let prev = sample(vm), cup = null, size = 1, grew = 0;
    for (let f = 0; f < 150; f++) {
      vm.update(1 / 60); await Promise.resolve();
      const cur = sample(vm);
      if (f > 3) for (let i = 0; i < cur.length; i++) assert.ok(Math.abs(cur[i] - prev[i]) < (i % 6 < 3 ? 0.04 : 0.16), `${food} frame ${f} channel ${i}: moved ${Math.abs(cur[i] - prev[i]).toFixed(3)}`);
      prev = cur;
      if (f === 40) bone(vm, 'handR').traverse((o) => { if (!cup && o.isMesh && o.geometry.type !== 'CircleGeometry' && o.geometry.type !== 'CylinderGeometry' || (!cup && o.userData.bite)) cup = o.userData.bite ? o : o.parent; });
      if (f > 60 && cup) { if (cup.scale.x > size + 1e-6) grew++; size = cup.scale.x; }
    }
    assert.ok(cup, `found the ${food} in the hand`);
    assert.equal(vm.item, 'coin');
    assert.equal(grew, 0, `the ${food} only ever shrinks once it is on its way out`);
    vm.dispose();
  }
});

test('a banana and a sandwich shorten bite by bite; drinks have no bite', async () => {
  for (const [item, bites] of [['banana', true], ['sandwich', true], ['coffee', false], ['energy', false], ['soup', false]]) {
    const vm = await make(item);
    const bite = pivotOf(vm);
    assert.equal(!!bite, bites, `${item} bite pivot`);
    if (bite) {
      void vm.play('eat');
      const scales = [];
      for (let f = 0; f < 80; f++) { vm.update(1 / 60); scales.push(bite.pivot.scale.getComponent(bite.axis)); }
      assert.ok(scales.every((s, i) => i === 0 || s <= scales[i - 1] + 1e-6), `${item} only ever gets shorter`);
      assert.ok(scales[scales.length - 1] < 0.4, `${item} is mostly gone: ${scales[scales.length - 1]}`);
      for (let f = 0; f < 20; f++) vm.update(1 / 60);
      assert.ok(bite.pivot.parent.scale.x < 0.01, `${item} is swallowed and stays gone once the animation is over`);
    }
    vm.dispose();
  }
});

test('holding what is already held changes nothing; a new item replaces the old one and the old one is dropped', async () => {
  const vm = await make('tonic');
  const count = () => { let n = 0; vm.scene.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const tonic = count();
  vm.hold('tonic');
  assert.equal(count(), tonic, 'same item: nothing rebuilt');
  vm.hold('coin');
  assert.equal(vm.item, 'coin');
  for (let i = 0; i < 20; i++) vm.update(1 / 60);       // the old bottle shrinks away and is dropped
  assert.ok(count() < tonic, 'the bottle is gone');
  vm.dispose();
});

test('the motion does not depend on the frame rate (the same sim seconds give the same hands)', async () => {
  const run = async (fps) => {
    const vm = await make('coffee');
    void vm.play('drink');
    for (let i = 0; i < Math.round(0.7 * fps); i++) vm.update(1 / fps);
    const s = sample(vm);
    vm.dispose();
    return s;
  };
  const a = await run(30), b = await run(120);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < (i % 6 < 3 ? 0.012 : 0.06), `channel ${i}: ${a[i]} vs ${b[i]}`);
});

test('hands that are hidden still finish an animation, so a game waiting on it is not left hanging', async () => {
  const vm = await make();
  vm.setVisible(false);
  let done = false;
  void vm.play('give').then(() => { done = true; });
  for (let i = 0; i < 60; i++) vm.update(1 / 60);
  await Promise.resolve();
  assert.ok(done);
  vm.dispose();
});

test('food parts: a bitten food names its bite part, and the banana is curved, stemmed and peeled', () => {
  for (const id of Object.keys(FOOD.FOOD_PARTS)) assert.ok(FOOD.FOOD_PARTS[id].length >= 4, id);
  for (const id of Object.keys(FOOD.FOOD_BITE)) assert.ok(FOOD.FOOD_PARTS[id].some((p) => p.eat), `${id} has a part to bite`);
  const ban = FOOD.FOOD_PARTS.banana;
  assert.ok(ban.filter((p) => p.shape === 'cyl' && p.seg === 5).length >= 7, 'five-sided slices, a stem and the flesh');
  assert.equal(ban.filter((p) => p.shape === 'box').length, 3, 'three strips of peel');
  const ys = ban.filter((p) => p.seg === 5).map((p) => p.pos[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.02, 'the slices follow a curve');
  assert.ok(ITEMS.buildItem('banana', () => new THREE.MeshBasicMaterial()), 'the hand can build it');
});

// ── coin tricks (fidget.ts, coinTricks.ts) ───────────────────────────────────────────────────────
const TRACKED = ['handR', 'forearmR', 'f_index03R', 'f_middle03R', 'f_pinky03R', 'thumb03R', 'handL'];
/** World positions of the right arm's bones: a pop in any of them is a pop on screen. */
const skeleton = (vm) => { vm.scene.updateMatrixWorld(true); return TRACKED.map((n) => bone(vm, n).getWorldPosition(new THREE.Vector3())); };
/** The trick coin (the second thing in the scene, after the rig), or null when it is the held coin that shows. */
const trickCoin = (vm) => { const c = vm.scene.children[1]; return c && c.visible ? c : null; };
const coinPos = (vm) => trickCoin(vm)?.getWorldPosition(new THREE.Vector3()) ?? null;

/** The right and left hand bones: the coin must be in one of them or on its way. */
const handsOf = (vm) => [bone(vm, 'handR').getWorldPosition(new THREE.Vector3()), bone(vm, 'handL').getWorldPosition(new THREE.Vector3())];
/** Which hand the coin is at (0 right, 1 left), or -1 when it is in flight (further than SOCKET from both hand bones). */
const SOCKET = 0.1;
const whichHand = (vm) => { const c = coinPos(vm); if (!c) return 0; const [r, l] = handsOf(vm); const dr = c.distanceTo(r), dl = c.distanceTo(l); return Math.min(dr, dl) > SOCKET ? -1 : dr < dl ? 0 : 1; };

/** Plays `frames` frames at `fps` with `act(f)` called before each; returns the biggest bone and coin step and how often the coin was far from both hands. */
const drive = (vm, frames, fps, act) => {
  let prev = skeleton(vm), prevCoin = null, maxBone = 0, maxCoin = 0, lost = 0;
  for (let f = 0; f < frames; f++) {
    act(f);
    vm.update(1 / fps);
    const cur = skeleton(vm);
    cur.forEach((p, i) => { maxBone = Math.max(maxBone, p.distanceTo(prev[i])); });
    prev = cur;
    const c = coinPos(vm);
    if (c && prevCoin) maxCoin = Math.max(maxCoin, c.distanceTo(prevCoin));
    if (c) { const [r, l] = handsOf(vm); if (Math.min(c.distanceTo(r), c.distanceTo(l)) > 0.4) lost++; }
    prevCoin = c;
  }
  return { maxBone, maxCoin, lost };
};

test('spamming R (every 0.05 s for 3 s) never pops: no bone and no coin jumps in one frame, and the coin is never lost', async () => {
  const vm = await make();
  const r = drive(vm, 180, 60, (f) => { if (f % 3 === 0) vm.toss('up'); });          // 0.05 s at 60 fps
  assert.ok(r.maxBone < 0.035, `a bone moved ${r.maxBone.toFixed(4)} m in one frame`);
  assert.ok(r.maxCoin < 0.06, `the coin moved ${r.maxCoin.toFixed(4)} m in one frame`);
  assert.equal(r.lost, 0);
  vm.dispose();
});

test('spamming Q (a tap every 0.05 s for 3 s) juggles without a pop either', async () => {
  const vm = await make();
  const r = drive(vm, 180, 60, (f) => { if (f % 3 === 0) { vm.trick(true); vm.trick(false); } });
  assert.ok(r.maxBone < 0.035, `a bone moved ${r.maxBone.toFixed(4)} m in one frame`);
  assert.ok(r.maxCoin < 0.06, `the coin moved ${r.maxCoin.toFixed(4)} m in one frame`);
  assert.equal(r.lost, 0);
  vm.dispose();
});

test('R is one quick toss: the coin goes up from the palm, lands in the same hand in about 0.45 s, and the held coin shows again', async () => {
  const vm = await make();
  vm.toss('up');
  const ys = [], hands = [];
  for (let f = 0; f < 60; f++) { vm.update(1 / 60); const c = coinPos(vm); ys.push(c ? c.y - handsOf(vm)[0].y : null); hands.push(whichHand(vm)); }
  const air = ys.filter((y) => y !== null), rise = Math.max(...air) - ys[0];
  assert.ok(rise > 0.04 && rise < 0.12, `the coin rises ${rise.toFixed(3)} m`);
  const gone = ys.findIndex((y) => y === null) / 60;
  assert.ok(gone > 0.4 && gone < 0.5, `the toss lasts ${gone.toFixed(2)} s`);
  assert.ok(hands.every((h) => h <= 0), 'never at the left hand');
  vm.dispose();
});

test('Q passes the coin hand to hand: right to left on the first press, left to right on the next, each about 0.5 s', async () => {
  const vm = await make();
  const seen = [];
  for (let n = 0; n < 4; n++) {
    vm.trick(true); vm.trick(false);
    let flew = false, f = 0;
    for (; f < 60; f++) { vm.update(1 / 60); const w = whichHand(vm); if (w === -1) flew = true; if (flew && w !== -1) break; }
    assert.ok(flew, 'the coin crossed in the air');
    assert.ok(f / 60 > 0.3 && f / 60 < 0.6, `pass ${n} took ${(f / 60).toFixed(2)} s`);
    for (let k = 0; k < 40; k++) vm.update(1 / 60);                    // settle
    seen.push(whichHand(vm));
  }
  assert.deepEqual(seen, [1, 0, 1, 0], 'left, right, left, right');
  vm.dispose();
});

test('the left palm is a real coin socket: a coin passed there sits in the left hand, not beside it', async () => {
  const vm = await make();
  vm.trick(true); vm.trick(false);
  for (let f = 0; f < 80; f++) vm.update(1 / 60);
  const [r, l] = handsOf(vm), c = coinPos(vm);
  assert.ok(c, 'the trick coin stays in the left hand (the held coin is in the right)');
  assert.ok(c.distanceTo(l) < SOCKET && c.distanceTo(l) < c.distanceTo(r), `coin ${c.distanceTo(l).toFixed(3)} m from the left hand`);
  vm.dispose();
});

test('the catching hand dips on the catch and the throwing hand moves through the throw', async () => {
  const vm = await make();
  const y0 = handsOf(vm), ys = { r: [], l: [] };
  vm.trick(true); vm.trick(false);
  for (let f = 0; f < 36; f++) { vm.update(1 / 60); const [r, l] = handsOf(vm); ys.r.push(r.y - y0[0].y); ys.l.push(l.y - y0[1].y); }
  assert.ok(Math.min(...ys.l.slice(22)) < Math.max(...ys.l.slice(10, 24)) - 0.006, 'the left hand dips on the catch');
  assert.ok(Math.max(...ys.r) - Math.min(...ys.r) > 0.01, 'the right hand moves through the throw');
  vm.dispose();
});

test('a tap passes the coin, holding Q for 0.4 s plays the fancy tricks and the coin ends in the right hand', async () => {
  const vm = await make();
  vm.trick(true);
  for (let f = 0; f < 45; f++) vm.update(1 / 60);                     // 0.75 s held: the cycle has begun
  assert.ok(trickCoin(vm), 'a trick coin is playing');
  assert.notEqual(whichHand(vm), 1, 'not passed to the left hand');
  vm.trick(false);
  for (let f = 0; f < 60 * 5; f++) vm.update(1 / 60);
  assert.equal(trickCoin(vm), null, 'released and done: the held coin shows again in the right hand');
  vm.dispose();
});

test('a fancy trick asked with the coin in the left hand waits for it to come back, with no jump on the way', async () => {
  const vm = await make();
  vm.trick(true); vm.trick(false);
  for (let f = 0; f < 40; f++) vm.update(1 / 60);
  assert.equal(whichHand(vm), 1);
  vm.trick(true, 0); vm.trick(false);
  const r = drive(vm, 200, 60, () => {});
  assert.ok(r.maxCoin < 0.06 && r.maxBone < 0.035 && r.lost === 0, `coin ${r.maxCoin.toFixed(3)} bone ${r.maxBone.toFixed(3)}`);
  assert.equal(trickCoin(vm), null, 'the trick ran and the coin is back in the right hand');
  vm.dispose();
});

test('the throws do not depend on the frame rate (R and Q chained, 30 against 120 fps)', async () => {
  const run = async (fps) => {
    const vm = await make();
    const out = [];
    let frame = 0;
    const to = (sec) => { while (frame / fps < sec - 1e-9) { vm.update(1 / fps); frame++; } };
    for (const [sec, act] of [[0, () => vm.toss('up')], [0.2, () => vm.toss('up')], [0.4, () => { vm.trick(true); vm.trick(false); }], [0.9, () => { vm.trick(true); vm.trick(false); }]]) { to(sec); act(); }
    for (const sec of [1.0, 1.15, 1.3, 1.6]) { to(sec); out.push(...skeleton(vm).flatMap((p) => p.toArray()), ...(coinPos(vm)?.toArray() ?? [0, 0, 0])); }
    vm.dispose();
    return out;
  };
  const a = await run(30), b = await run(120);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.03, `channel ${i}: ${a[i]} vs ${b[i]}`);
});

test('R and Q have one walk action each; seated, R and Q belong to the machine', async () => {
  const K = await load('src/core/keymap.ts');
  assert.deepEqual(K.ALL_DEFAULTS.toss, ['KeyR']);
  assert.deepEqual(K.ALL_DEFAULTS.fidget, ['KeyQ']);
  const walk = Object.keys(K.ALL_DEFAULTS).filter((k) => K.layerOf(k) === 'walk');
  for (const code of ['KeyR', 'KeyQ']) assert.equal(walk.filter((k) => K.ALL_DEFAULTS[k].includes(code)).length, 1, `${code} has one walk action`);
  assert.ok(!K.SEATED_WALK_ACTIONS.has('toss') && !K.SEATED_WALK_ACTIONS.has('fidget'), 'not live while seated');
  assert.deepEqual([K.ALL_DEFAULTS['m.double'], K.ALL_DEFAULTS['m.collect']], [['KeyR'], ['KeyQ']]);
});

test('every trick, cut into by the next from any frame, blends within 0.12 s and the coin is always in the hand or in flight from it', async () => {
  for (let which = 0; which < 4; which++) {
    for (let cutAt = 5; cutAt < 100; cutAt += 7) {
      const vm = await make();
      vm.trick(true, which); vm.trick(false);
      for (let f = 0; f < cutAt; f++) vm.update(1 / 60);
      vm.trick(true, (which + 1) % 4); vm.trick(false);
      let prev = skeleton(vm), prevCoin = coinPos(vm);
      for (let f = 0; f < 150; f++) {
        vm.update(1 / 60);
        const cur = skeleton(vm), hand = cur[0];
        cur.forEach((p, i) => assert.ok(p.distanceTo(prev[i]) < 0.035, `trick ${which} cut at ${cutAt}: ${TRACKED[i]} jumped at frame ${f}`));
        prev = cur;
        const c = coinPos(vm);
        if (c) {
          assert.ok(c.distanceTo(hand) < 0.4, `the coin is ${c.distanceTo(hand).toFixed(2)} m from the hand`);
          if (prevCoin) assert.ok(c.distanceTo(prevCoin) < 0.06, `trick ${which} cut at ${cutAt}: the coin jumped ${c.distanceTo(prevCoin).toFixed(3)} m at frame ${f}`);
        }
        prevCoin = c;
      }
      vm.dispose();
    }
  }
});

test('the thumb flip is a real arc: up and back to the hand under gravity, caught, and the held coin shows again', async () => {
  const vm = await make();
  vm.trick(true, 0); vm.trick(false);
  const ys = [], start = [];
  for (let f = 0; f < 150; f++) {
    vm.update(1 / 60);
    const c = coinPos(vm), hand = bone(vm, 'handR').getWorldPosition(new THREE.Vector3());
    ys.push(c ? c.y - hand.y : null);
    if (f === 5) start.push(c.y - hand.y);
  }
  const air = ys.filter((y) => y !== null);
  const apex = Math.max(...air) - start[0];
  assert.ok(apex > 0.05 && apex < 0.13, `the coin rises ${apex.toFixed(3)} m`);
  const top = ys.indexOf(Math.max(...air));
  const rise = ys.slice(top - 12, top), fall = ys.slice(top, top + 12);
  assert.ok(rise.every((y, i) => i === 0 || y >= rise[i - 1] - 0.003), 'it climbs to the top');
  assert.ok(fall.every((y, i) => i === 0 || y <= fall[i - 1] + 0.003), 'and falls from it');
  assert.equal(ys[ys.length - 1], null, 'the trick coin is gone: the held coin shows again');
  vm.dispose();
});

test('holding the key loops the knuckle roll; letting go finishes it and the held coin comes back', async () => {
  const vm = await make();
  vm.trick(true, 1);
  for (let f = 0; f < 60 * 6; f++) vm.update(1 / 60);               // 6 s: three times the length of the trick
  assert.ok(trickCoin(vm), 'still rolling after the trick is long over');
  vm.trick(false);
  for (let f = 0; f < 60 * 4; f++) vm.update(1 / 60);
  assert.equal(trickCoin(vm), null, 'released: back to the held coin');
  vm.dispose();
});

test('a cut-in keeps the coin momentum: a coin in the air flies on and lands, it is not put back in the palm', async () => {
  const vm = await make();
  vm.trick(true, 0); vm.trick(false);
  for (let f = 0; f < 30; f++) vm.update(1 / 60);                    // 0.5 s: the coin is near its top
  const before = coinPos(vm), handY = bone(vm, 'handR').getWorldPosition(new THREE.Vector3()).y;
  assert.ok(before.y - handY > 0.04, 'in the air');
  vm.trick(true, 3); vm.trick(false);
  vm.update(1 / 60);
  assert.ok(coinPos(vm).y - bone(vm, 'handR').getWorldPosition(new THREE.Vector3()).y > 0.02, 'one frame later it is still up there');
  vm.dispose();
});

test('the tricks do not depend on the frame rate (the same sim seconds give the same hand and the same coin)', async () => {
  const run = async (fps) => {
    const vm = await make();
    vm.trick(true, 0); vm.trick(false);
    const out = [];
    for (const sec of [0.3, 0.5, 0.8]) {
      const target = Math.round(sec * fps);
      while (out.frames === undefined || out.frames < target) { vm.update(1 / fps); out.frames = (out.frames ?? 0) + 1; }
      out.push(...skeleton(vm).flatMap((p) => p.toArray()), ...(coinPos(vm)?.toArray() ?? [0, 0, 0]));
    }
    vm.dispose();
    return out.slice();
  };
  const a = await run(30), b = await run(120);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.02, `channel ${i}: ${a[i]} vs ${b[i]}`);
});

test('the trick curves: smooth, flat at holds, every trick starts and ends on the held coin', async () => {
  const T = await load('src/player/viewmodel/coinTricks.ts');
  const c = T.curve([[0, 0], [1, 1], [2, 1], [3, 3]]);
  assert.equal(c(-1), 0); assert.equal(c(5), 3); assert.equal(c(1.5), 1, 'a hold is flat');
  for (const trick of T.TRICKS) {
    const curves = T.curvesOf(trick);
    for (const ch of T.CHANNELS) {
      if (ch === 'cspin' || ch === 'crx') continue;                   // whole turns: checked below
      assert.ok(Math.abs(curves[ch](0) - T.REST[ch]) < 1e-9 && Math.abs(curves[ch](trick.dur) - T.REST[ch]) < 1e-9, `${trick.name}.${ch} starts and ends at rest`);
    }
    const turn = (v) => Math.abs(v - 2 * Math.PI * Math.round(v / (2 * Math.PI)));
    assert.ok(turn(curves.cspin(trick.dur)) < 1e-6 && turn(curves.crx(trick.dur)) < 1e-6, `${trick.name} ends flat`);
    if (trick.loop) for (const ch of T.CHANNELS) assert.ok(Math.abs(curves[ch](trick.loop[0]) - curves[ch](trick.loop[1])) < 1e-9, `${trick.name}.${ch} matches across the loop`);
  }
});

test('the throws: every hand curve starts and ends at rest, and the coin lands before the throw ends', async () => {
  const T = await load('src/player/viewmodel/coinTricks.ts');
  for (const toss of Object.values(T.TOSSES)) {
    assert.ok(toss.launch + toss.flight < toss.dur, `${toss.name} lands before it ends`);
    for (const role of [toss.thrower, toss.catcher].filter(Boolean)) {
      const c = T.curvesOf(role);
      for (const ch of T.CHANNELS) assert.ok(Math.abs(c[ch](0) - T.REST[ch]) < 1e-9 && Math.abs(c[ch](toss.dur) - T.REST[ch]) < 1e-9, `${role.name}.${ch} starts and ends at rest`);
    }
  }
});

// ── framing: small hands, no cut end, a real coin, own pass ──────────────────────────────────────
const skinned = (vm) => { let m; vm.scene.traverse((o) => { if (o.isSkinnedMesh) m = o; }); return m; };
/** Skinned vertices on screen: [vertex index → NDC] for the ones in front of the camera. */
const ndcOf = (vm, mesh, i, v) => {
  mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld);
  if (v.clone().applyMatrix4(vm.camera.matrixWorldInverse).z > -0.01) return null;
  return v.project(vm.camera);
};
const settle = (vm) => { vm.scene.updateMatrixWorld(true); vm.camera.updateMatrixWorld(true); const m = skinned(vm); m.skeleton.update(); return m; };

test('at rest the hands cover at most 22% of the screen height at 16:9 and 21:9', async () => {
  for (const aspect of [16 / 9, 21 / 9]) {
    const vm = await make();
    vm.drive({ ...DRIVE, aspect });
    vm.update(1 / 60);
    const m = settle(vm), v = new THREE.Vector3();
    let top = -9;
    for (let i = 0; i < m.geometry.getAttribute('position').count; i++) { const p = ndcOf(vm, m, i, v); if (p && Math.abs(p.x) < 1) top = Math.max(top, p.y); }
    assert.ok((top + 1) / 2 <= 0.22, `aspect ${aspect.toFixed(2)}: hands reach ${((top + 1) / 2 * 100).toFixed(1)}% of the height`);
    vm.dispose();
  }
});

test("no animation lifts the arm far enough to show its open cut end", async () => {
  const v = new THREE.Vector3();
  for (const name of Object.keys(ANIMS)) {
    const vm = await make(name === 'drink' ? 'coffee' : name === 'eat' ? 'banana' : null);
    const m = settle(vm), n = m.geometry.getAttribute('position').count;
    const hands = ['handR', 'handL'].map((h) => bone(vm, h).getWorldPosition(new THREE.Vector3()));
    const far = [];
    for (let i = 0; i < n; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); far.push([v.distanceTo(hands[v.x > 0 ? 0 : 1]), i]); }
    const cut = far.sort((a, b) => b[0] - a[0]).slice(0, Math.round(n * 0.04)).map((x) => x[1]);     // the farthest 4%: the elbow end
    void vm.play(name);
    for (let f = 0; f < Math.ceil((ANIMS[name].dur + 0.3) * 60); f++) {
      vm.update(1 / 60);
      settle(vm);
      for (const i of cut) { const p = ndcOf(vm, m, i, v); assert.ok(!p || Math.abs(p.x) >= 1 || p.y <= -1 || p.y >= 1, `${name} frame ${f}: the cut end is on screen`); }
    }
    vm.dispose();
  }
});

test('the coin is a real coin: a rim cylinder and an embossed face on each side', async () => {
  const c = ITEMS.buildItem('coin', () => new THREE.MeshBasicMaterial());
  const kinds = []; c.traverse((o) => { if (o.isMesh) kinds.push(o.geometry.type); });
  assert.deepEqual(kinds.sort(), ['CircleGeometry', 'CircleGeometry', 'CylinderGeometry']);
});

test('the viewmodel is its own pass: drawn after the world and the fx, depth cleared first, camera and scene of its own', () => {
  const src = readFileSync(`${ROOT}/src/core/renderer/psxRenderer.ts`, 'utf8');
  const at = (s) => src.indexOf(s);
  assert.ok(at('three.render(scene, camera)') < at('three.render(fxLayer.scene, camera)'));
  assert.ok(at('three.render(fxLayer.scene, camera)') < at('three.clearDepth()'));
  assert.ok(at('three.clearDepth()') < at('three.render(overlay.scene, overlay.camera)'));
  assert.ok(at('three.render(overlay.scene, overlay.camera)') < at('three.render(pass.scene, pass.camera)'));
});
