// Regression tests for the animated mannequin (src/kit/mannequin.ts): the live build showed dark players with giant stretched
// limbs and a flat sheet across the table. Cause: the procedural layers (6 % limb stretch) were read back as the clip pose when
// the mixer skipped a constant track, so the stretch stacked every step. These tests run the real actor on the real GLB
// (served from public/ through a patched loader, no WebGL) and check that nothing grows, that every skinned vertex is valid,
// and that only the female option brings hair and a dress.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let mq, mk, scene, plain, stand, ada;
const frames = (n) => { for (let i = 0; i < n; i++) mk.update(1 / 60); };

before(async () => {
  // the game fetches the GLB over HTTP; here it comes from disk
  GLTFLoader.prototype.loadAsync = function (url) {
    const b = readFileSync(`${ROOT}/public${url}`);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    return new Promise((res, rej) => this.parse(ab, '', res, rej));
  };
  mq = await load('src/kit/mannequin.ts');
  const stub = new Proxy({}, { get: () => () => new THREE.Mesh() });
  mk = mq.makeMannequins({ P: stub, M: stub, pal: {}, tex: { preloadVendor: async () => {} } }, () => new THREE.Group());
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 1.5, 3);
  cam.updateMatrixWorld(true);
  mk.setLodCamera(cam);
  scene = new THREE.Scene();
  plain = mk.mannequin({ style: 'plain', height: 1.7, clip: 'Sitting_Idle_Loop' });
  stand = mk.mannequin({ style: 'collector', height: 1.8, clip: 'Idle_Loop' });
  ada = mk.mannequin({ style: 'plain', height: 1.66, clip: 'Sitting_Idle_Loop', female: true, rim: 0xd9913a, eyes: 0xffc27a });
  [plain, stand, ada].forEach((a, i) => { a.root.position.set(i * 2, 0, 0); scene.add(a.root); });
  await Promise.all([plain.ready, stand.ready, ada.ready]);
});

/** World-space bounding box of an actor's skinned vertices (current LOD tier), and whether any vertex is not finite. */
function skinBox(a) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3(), v = new THREE.Vector3();
  let finite = true;
  a.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    for (let i = 0, n = o.geometry.getAttribute('position').count; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      if (!Number.isFinite(v.x + v.y + v.z)) finite = false;
      box.expandByPoint(v);
    }
  });
  return { box, finite };
}

test('procedural limb stretch does not stack: scales and the skinned bounds stay put over ten seconds', () => {
  frames(30);
  const before = [plain, stand].map((a) => skinBox(a).box.getSize(new THREE.Vector3()));
  frames(600);
  [plain, stand].forEach((a, i) => {
    for (const n of ['thigh_l', 'thigh_r', 'upperarm_l', 'upperarm_r']) {
      const y = a.bone(n).scale.y;
      assert.ok(y >= 0.999 && y <= 1.07, `${n} scale.y ${y} stays at the 6 % stretch`);
    }
    const { box, finite } = skinBox(a);
    assert.ok(finite, 'every skinned vertex is finite');
    const size = box.getSize(new THREE.Vector3());
    assert.ok(size.distanceTo(before[i]) < 0.1, `bounds ${size.toArray()} match the first second ${before[i].toArray()}`);
    assert.ok(size.y < 2.1 && size.x < 1.2 && size.z < 1.2, `a figure, not a sheet: ${size.toArray()}`);
  });
});

test("Ada's slim build and arms do not drift either (no 0.88 per step shrink)", () => {
  frames(600);
  for (const n of ['upperarm_l', 'upperarm_r']) {
    const s = ada.bone(n).scale;
    assert.ok(Math.abs(s.x - 0.88) < 0.01 && Math.abs(s.y - 1) < 0.01, `${n} scale ${s.toArray()}`);
  }
});

test('hair and the dress belong to the female option only', () => {
  const names = (a) => { const out = []; a.root.traverse((o) => { if (o.name) out.push(o.name); }); return out; };
  assert.equal(names(plain).filter((n) => /^ada_/.test(n)).length, 0, 'a plain mannequin has no hair or dress');
  assert.equal(names(stand).filter((n) => /^ada_/.test(n)).length, 0, 'the collector has none either');
  const hers = names(ada);
  assert.ok(hers.includes('ada_hair') && hers.some((n) => /^ada_dress_/.test(n)), 'Ada has both');
});

test('outfits: the Collector wears coat, gloves and collar; wear() dresses a live actor in bone space and undresses it', async () => {
  const names = (a) => { const out = []; a.root.traverse((o) => { if (o.name) out.push(o.name); }); return out; };
  const col = names(stand);
  for (const b of ['spine_02', 'upperarm_l', 'hand_r', 'neck_01']) assert.ok(col.includes(`outfit_${b}`), `the Collector has cloth on ${b}`);
  const of = await load('src/kit/mannequinOutfits.ts');
  const off = of.wear(plain, of.OUTFITS.selim);
  const worn = [];
  plain.root.traverse((o) => { if (o.name.startsWith('outfit_')) worn.push(o); });
  assert.ok(worn.length >= 6, `Selim's cloth sits on ${worn.length} bones`);
  const v = new THREE.Vector3();
  for (const g of worn) {
    const pos = g.children[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      assert.ok(Number.isFinite(v.x + v.y + v.z) && v.length() < 0.6, `${g.name} vertex ${i} stays near its bone: ${v.toArray()}`);
    }
  }
  off();
  assert.equal(names(plain).filter((n) => n.startsWith('outfit_')).length, 0, 'undressed');
});

test('every vertex of the full, mid and low bodies has weights summing to 1 on valid bones', async () => {
  const src = await mq.loadMannequinSource();
  assert.ok(src, 'the GLB loaded');
  const skins = [];
  src.scene.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  assert.equal(skins.length, 2);
  skins.forEach((sm, k) => {
    const bones = sm.skeleton.bones.length;
    for (const [tier, g] of [['full', sm.geometry], ['mid', src.mids[k]], ['low', src.lows[k]]]) {
      assert.ok(g, `${tier} body ${k} exists`);
      const idx = g.getAttribute('skinIndex'), w = g.getAttribute('skinWeight'), pos = g.getAttribute('position');
      assert.equal(idx.count, pos.count);
      for (let i = 0; i < pos.count; i++) {
        let sum = 0;
        for (let c = 0; c < 4; c++) {
          const wc = w.getComponent(i, c);
          sum += wc;
          if (wc > 0) assert.ok(idx.getComponent(i, c) < bones, `${tier} ${k} vertex ${i}: bone ${idx.getComponent(i, c)} of ${bones}`);
        }
        assert.ok(Math.abs(sum - 1) < 0.02, `${tier} ${k} vertex ${i}: weights sum ${sum}`);
      }
      for (let t = 0; t < g.index.count; t++) assert.ok(g.index.getX(t) < pos.count, `${tier} ${k}: index in range`);
    }
  });
});
