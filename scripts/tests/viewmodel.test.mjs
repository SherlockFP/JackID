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

let VM, ARMS, ANIMS, ITEMS, FOOD, SRC;
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

test('the arms are the rigged GLB: one skinned mesh of 1176 triangles, both hands in frame at rest', async () => {
  const vm = await make();
  let skinned = 0;
  vm.scene.traverse((o) => { if (o.isSkinnedMesh) { skinned++; assert.equal(o.skeleton.bones.length, 52); } });
  assert.equal(skinned, 1);
  vm.scene.traverse((o) => { if (o.isSkinnedMesh) assert.equal(tris(o), 1176); });
  vm.scene.updateMatrixWorld(true);
  vm.camera.updateMatrixWorld(true);
  for (const name of ['handR', 'handL']) {
    const v = bone(vm, name).getWorldPosition(new THREE.Vector3()).project(vm.camera);
    assert.ok(Math.abs(v.x) < 0.95 && v.y > -1.1 && v.y < 0.2, `${name} at screen ${v.x.toFixed(2)}, ${v.y.toFixed(2)}`);
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
