// Unit tests for the dark other-dimension NPC look (w72 npc lane): the NPC material patch (one shared program, the
// banded rim and eyes injected after the PSX body, the old rim term dropped), the per-frame shimmer rules (off in Calm,
// quarter-strength and 2 Hz with reduced flashing, integer steps), and the dark patrons (deterministic, clamped count,
// wander and stop, despawn on dispose). Real THREE materials, a fake shader and fake actor directors: no WebGL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let look, frame, patrons;
before(async () => {
  look = await load('src/kit/mannequinLook.ts');
  frame = await load('src/core/renderer/npcFrame.ts');
  patrons = await load('src/world/actors/darkPatrons.ts');
});

const SHADER = {
  vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
  fragmentShader: 'void main() {\n#include <color_fragment>\n#include <opaque_fragment>\n}',
};
const fakeShader = () => ({ uniforms: {}, vertexShader: SHADER.vertexShader, fragmentShader: SHADER.fragmentShader });

test('setNpcFrame: calm is still, normal steps at 8 Hz, reduced flashing is quarter-strength at 2 Hz', () => {
  frame.setNpcFrame(1.26, { calm: false, reduced: false });
  assert.equal(frame.npcFrame.uNpcShimmer.value, 1);
  assert.equal(frame.npcFrame.uNpcT.value, Math.floor(1.26 * 8));
  frame.setNpcFrame(1.26, { calm: false, reduced: true });
  assert.ok(Math.abs(frame.npcFrame.uNpcShimmer.value - 0.35) < 1e-9);
  assert.equal(frame.npcFrame.uNpcT.value, Math.floor(1.26 * 2));
  frame.setNpcFrame(9.9, { calm: true, reduced: false });
  assert.equal(frame.npcFrame.uNpcShimmer.value, 0);
  assert.equal(Number.isInteger(frame.npcFrame.uNpcT.value), true, 'shimmer step is an integer count');
});

test('patchNpc injects the body, eyes and banded rim after the PSX body, and drops the old rim term', () => {
  const m = new THREE.MeshLambertMaterial();
  look.patchNpc(m, { rim: 0x6fd8e0, eyes: 0xff3030, head: { c: new THREE.Vector3(), r: new THREE.Vector3(1, 1, 1) }, shimmer: 1 });
  const s = fakeShader();
  m.onBeforeCompile(s, null);
  const f = s.fragmentShader;
  assert.ok(f.includes('diffuseColor.rgb = npcBody(diffuseColor.rgb);'), 'body darkened');
  assert.ok(!f.includes('vMqRim * uRim'), 'old rim term removed');
  const body = f.indexOf('npcBody(diffuseColor'), light = f.indexOf('outgoingLight += uNpcRim'), opaque = f.indexOf('#include <opaque_fragment>');
  assert.ok(body > 0 && body < light && light < opaque, 'body before the light step, before opaque');
  assert.equal(s.uniforms.uNpcT, frame.npcFrame.uNpcT, 'frame uniform is the shared object');
  assert.equal(s.uniforms.uNpcShimmer, frame.npcFrame.uNpcShimmer);
  assert.ok(s.vertexShader.includes('vNpcObj = transformed;'));
  assert.ok(s.vertexShader.includes('vNpcN = normalize(transformedNormal);'));
});

test('props get no eyes and a lower shimmer; NPC materials share one program key', () => {
  const a = new THREE.MeshLambertMaterial(), b = new THREE.MeshLambertMaterial();
  look.patchNpc(a, { rim: 0xc0202a, eyes: null, head: null, shimmer: 0.6 });
  look.patchNpc(b, { rim: 0x9a6bd6, eyes: 0x9a6bd6, head: { c: new THREE.Vector3(), r: new THREE.Vector3(1, 1, 1) }, shimmer: 1 });
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey(), 'one program for every NPC material');
  assert.ok(a.customProgramCacheKey().endsWith('|npc'));
  const sa = fakeShader(); a.onBeforeCompile(sa, null);
  assert.equal(sa.uniforms.uNpcFx.value.x, 0, 'props: no eyes');
  assert.equal(sa.uniforms.uNpcFx.value.y, 0.6, 'props: shimmer 0.6');
  const sb = fakeShader(); b.onBeforeCompile(sb, null);
  assert.equal(sb.uniforms.uNpcFx.value.x, 1, 'bodies with a head box: eyes on');
});

function fakeActors() {
  const log = [];
  let n = 0;
  return {
    log,
    spawn: async (id, at, o) => { const h = { id: `h${n++}`, at }; log.push(['spawn', id, o?.dressing ?? 'plain']); return h; },
    walkPath: (h, to) => { log.push(['walk', h.id, to.map((v) => Math.round(v * 100) / 100).join(',')]); return new Promise((res) => setTimeout(() => res(true), 0)); },
    lookAt: (h) => log.push(['gaze', h.id]),
    lookForward: (h) => log.push(['fwd', h.id]),
    despawn: (h) => log.push(['despawn', h.id]),
  };
}
function seededRnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const settle = () => new Promise((res) => setTimeout(res, 2));

test('dark patrons: 4 to 6 actors, shadow dressing, clamped count', async () => {
  for (const [count, want] of [[undefined, 5], [0, 4], [99, 6], [4, 4]]) {
    const acts = fakeActors();
    const p = new patrons.DarkPatrons({ actors: acts, rnd: seededRnd(7), count });
    await p.start();
    assert.equal(p.size, want, `count ${count}`);
    assert.ok(acts.log.every((e) => e[0] !== 'spawn' || e[2] === 'shadow'));
  }
});

test('dark patrons are deterministic and wander: same seed, same walks; pauses at machines and in the halls', async () => {
  const run = async () => {
    const acts = fakeActors();
    const p = new patrons.DarkPatrons({ actors: acts, rnd: seededRnd(0x5ca1) });
    await p.start();
    for (let i = 0; i < 60; i++) { p.tick(0.5); await settle(); }
    return acts.log;
  };
  const a = await run(), b = await run();
  assert.deepEqual(a, b, 'same seed, same log');
  const walks = a.filter((e) => e[0] === 'walk').length;
  assert.ok(walks >= 5, `patrons walk (${walks})`);
  assert.ok(a.some((e) => e[0] === 'gaze'), 'a machine stop turns the patron to its machine');
});

test('a walking patron is not re-issued until the walk resolves; dispose despawns everyone and stops ticks', async () => {
  const acts = fakeActors();
  const p = new patrons.DarkPatrons({ actors: acts, rnd: seededRnd(3), count: 4 });
  await p.start();
  p.tick(10);
  p.tick(10);
  const walksNow = acts.log.filter((e) => e[0] === 'walk').length;
  assert.equal(walksNow, 4, 'one walk per patron while busy');
  await settle();
  p.dispose();
  assert.equal(acts.log.filter((e) => e[0] === 'despawn').length, 4);
  const before = acts.log.length;
  p.tick(10);
  assert.equal(acts.log.length, before, 'no ticks after dispose');
});
