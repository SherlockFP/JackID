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

test('spamming the trick key (every 0.05 s for 3 s) never pops: no bone and no coin jumps in one frame', async () => {
  const vm = await make();
  let prev = skeleton(vm), prevCoin = null, maxBone = 0, maxCoin = 0;
  for (let f = 0; f < 180; f++) {
    if (f % 3 === 0) { vm.trick(true); vm.trick(false); }          // 0.05 s at 60 fps
    vm.update(1 / 60);
    const cur = skeleton(vm);
    cur.forEach((p, i) => { maxBone = Math.max(maxBone, p.distanceTo(prev[i])); });
    prev = cur;
    const c = coinPos(vm);
    if (c && prevCoin) maxCoin = Math.max(maxCoin, c.distanceTo(prevCoin));
    prevCoin = c;
  }
  assert.ok(maxBone < 0.035, `a bone moved ${maxBone.toFixed(4)} m in one frame`);
  assert.ok(maxCoin < 0.06, `the coin moved ${maxCoin.toFixed(4)} m in one frame`);
  vm.dispose();
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
