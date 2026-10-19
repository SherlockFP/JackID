/**
 * LOKI'S FIGURE (the apparition's art, docs/JOKER.md §1, §6): one mannequin in his look (kit/mannequinOutfits.ts `loki`) through the
 * dark NPC look with a phosphor-green rim, then the memory-ghost patch (kit/mannequinLook.ts `patchGhost`) on every material of it.
 * On top: his lit marks (a green grin that flaps while he talks, the grin pin on his lapel, a cigarette with an ember) and the arm
 * gestures, posed with a two-bone IK over the clip (arms crossed, a drag on the cigarette, a card shuffle, a slow clap, a laugh).
 * No light: the rim, the marks and the ember are emissive colour only.
 */
import * as THREE from 'three';
import type { Kit, MannequinActor } from '@/kit/types';
import { OUTFITS, wear } from '@/kit/mannequinOutfits';
import { ghostUniforms, patchGhost, type GhostUniforms } from '@/kit/mannequinLook';
import { psx } from '@/kit/materials';

/** His green, the subtitle's phosphor (joker.css --green). */
export const LOKI_GREEN = 0x5aff7b;
export const LOKI_HEIGHT = 1.82;

export type Gesture = 'none' | 'cross' | 'smoke' | 'shuffle' | 'clap' | 'laugh';

export interface LokiFigure {
  readonly actor: MannequinActor;
  readonly u: GhostUniforms;
  gesture: Gesture;
  /** 0..1: how open the grin is this frame (the lip flap). */
  talk: number;
  /** Advance the gesture clock and the marks. */
  update(dt: number): void;
  dispose(): void;
}

const PROC = ['spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'] as const;
/** Hand targets in the actor's frame from the sternum bone (+Z his front, +X his left). Elbow poles likewise. */
type Arm = readonly [number, number, number] | null;
const POLE_R = new THREE.Vector3(-0.6, -0.75, -0.2), POLE_L = new THREE.Vector3(0.6, -0.75, -0.2);
const SMOKE_EVERY = 6, SMOKE_DRAG: readonly [number, number] = [3.6, 5.2];
const CLAP_PERIOD = 1.1;

const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Arm targets of a gesture at time `t`: [right, left], the mouth share of the left hand (smoke) and the spine pitch (laugh). */
export function gesturePose(g: Gesture, t: number): { r: Arm; l: Arm; drag: number; pitch: number } {
  switch (g) {
    case 'cross': return { r: [0.15, -0.13, 0.19], l: [-0.15, -0.17, 0.15], drag: 0, pitch: 0 };
    case 'smoke': {
      const p = t % SMOKE_EVERY;
      const drag = smooth(SMOKE_DRAG[0], SMOKE_DRAG[0] + 0.5, p) * (1 - smooth(SMOKE_DRAG[1] - 0.5, SMOKE_DRAG[1], p));
      return { r: [0.13, -0.19, 0.17], l: [0.16 - 0.12 * drag, -0.22 + 0.42 * drag, 0.2 - 0.06 * drag], drag, pitch: 0 };
    }
    case 'shuffle': {
      const s = Math.sin(t * 7) * 0.025;
      return { r: [-0.07 + s, -0.3, 0.3], l: [0.07 + s, -0.29, 0.3], drag: 0, pitch: 0 };
    }
    case 'clap': {
      const x = 0.035 + 0.12 * (0.5 + 0.5 * Math.cos((t / CLAP_PERIOD) * Math.PI * 2));
      return { r: [-x, -0.12, 0.32], l: [x, -0.12, 0.32], drag: 0, pitch: 0 };
    }
    case 'laugh': return { r: [-0.11, -0.38, 0.19], l: [0.11, -0.38, 0.19], drag: 0, pitch: -0.14 + 0.05 * Math.sin(t * 16) };
    default: return { r: null, l: null, drag: 0, pitch: 0 };
  }
}

export function buildLoki(kit: Kit): LokiFigure {
  const actor = kit.mannequin({ color: 0x141418, jointColor: 0x0c0c10, height: LOKI_HEIGHT, clip: 'Idle_Loop', rim: LOKI_GREEN, eyes: LOKI_GREEN });
  actor.root.name = 'loki:ghost';
  actor.root.visible = false;
  const u = ghostUniforms(LOKI_GREEN);
  const offs: Array<() => void> = [wear(actor, OUTFITS.loki, (id, c) => kit.prop(id, { color: c }))];

  // his lit marks: unlit colour, no light
  const mark = (c: number): THREE.Material => psx({ color: c, lit: false, unique: true });
  const green = mark(LOKI_GREEN);
  const grin = new THREE.Group();
  grin.name = 'loki:grin';
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.009, 0.012), green);
  grin.add(lip);
  for (const x of [-1, 1]) {      // the corners turn up: the jester's grin
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.012), green);
    c.position.set(x * 0.037, 0.009, -0.005);
    c.rotation.z = x * 0.6;
    grin.add(c);
  }
  const pin = new THREE.Group();
  pin.name = 'loki:pin';
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), green);
  face.rotation.z = Math.PI / 4;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.01), mark(0x0a1a0e));
  slit.position.set(0, -0.003, 0.002);
  pin.add(face, slit);
  const cig = new THREE.Group();
  cig.name = 'loki:cig';
  const ember = mark(0xff7a28) as THREE.MeshBasicMaterial;
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 5), mark(0xe8e4da));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.006, 5, 3), ember);
  tip.position.y = 0.04;
  cig.add(paper, tip);
  for (const o of [grin, pin, cig]) actor.own(o);
  offs.push(actor.attach(grin, 'Head', { pos: [0, 0.06, 0.116] }));
  offs.push(actor.attach(pin, 'spine_03', { pos: [0.082, 0.14, 0.168], rot: [-14, 12, 0] }));
  offs.push(actor.attach(cig, 'hand_l', { pos: [0.01, 0.12, 0.03], rot: [80, 0, 0] }));

  // the ghost patch on every material, once the rig and the outfit are on (wear dresses on the same `ready`)
  const patched = new WeakSet<THREE.Material>();
  const patchAll = (): void => actor.root.traverse((n) => {
    const m = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!patched.has(mm)) { patched.add(mm); patchGhost(mm, u); }
  });
  void actor.ready.then(patchAll);
  patchAll();

  // the gestures, over the clip
  actor.addProc(PROC);
  const S = new THREE.Vector3(), E0 = new THREE.Vector3(), H0 = new THREE.Vector3(), E1 = new THREE.Vector3(), H1 = new THREE.Vector3();
  const toT = new THREE.Vector3(), perp = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3(), c1 = new THREE.Vector3(), d1 = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), rootQ = new THREE.Quaternion(), ID = new THREE.Quaternion();
  const sternum = new THREE.Vector3(), tgt = new THREE.Vector3(), pole = new THREE.Vector3(), ax = new THREE.Vector3();
  const turn = (bone: THREE.Object3D, q: THREE.Quaternion): void => {
    const parentQ = bone.parent!.getWorldQuaternion(qb);
    bone.quaternion.premultiply(qa.copy(parentQ).invert().multiply(q).multiply(parentQ));
    bone.updateMatrixWorld(true);
  };
  const aim = (bone: THREE.Object3D, cur: THREE.Vector3, des: THREE.Vector3, w: number): void => turn(bone, qc.setFromUnitVectors(cur, des).slerp(ID, 1 - w));
  /** Two-bone IK (the dealer rig's solver, kit/dealer.ts): hand on `target`, elbow toward `poleW`, blended by `w`. */
  const solve = (up: THREE.Object3D, low: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, poleW: THREE.Vector3, w: number): void => {
    up.updateWorldMatrix(true, true);
    up.getWorldPosition(S); low.getWorldPosition(E0); hand.getWorldPosition(H0);
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
    toT.copy(target).sub(S);
    const d = Math.min(Math.max(toT.length(), Math.abs(L1 - L2) + 0.02), L1 + L2 - 0.005);
    toT.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    perp.copy(poleW).addScaledVector(toT, -poleW.dot(toT));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    E.copy(S).addScaledVector(toT, a).addScaledVector(perp, h);
    Tc.copy(S).addScaledVector(toT, d);
    aim(up, c1.subVectors(E0, S).normalize(), d1.subVectors(E, S).normalize(), w);
    low.getWorldPosition(E1); hand.getWorldPosition(H1);
    aim(low, c1.subVectors(H1, E1).normalize(), d1.subVectors(Tc, E1).normalize(), w);
  };

  let t = 0, gw = 0, shown: Gesture = 'none';
  const fig: LokiFigure = {
    actor, u, gesture: 'none', talk: 0,
    update(dt) {
      t += dt;
      // a change of gesture eases out through the old one and in through the new (0.35 s each way)
      if (fig.gesture !== shown) { gw -= dt / 0.35; if (gw <= 0) { gw = 0; shown = fig.gesture; } }
      else gw = Math.min(1, gw + dt / 0.35);
      lip.scale.y = 1 + fig.talk * 3.2 * (0.5 + 0.5 * Math.sin(t * 23));
      lip.position.y = -0.008 * fig.talk;
      const p = gesturePose(shown, t);
      cig.visible = shown === 'smoke';
      ember.color.setRGB(0.55 + 0.45 * p.drag, 0.2 + 0.25 * p.drag, 0.08);
    },
    dispose() { for (const off of offs.splice(0)) off(); actor.dispose(); },
  };
  offs.push(actor.onPose(() => {
    const w = gw * smooth(0, 1, gw);
    if (w < 0.003 || shown === 'none') return;
    const p = gesturePose(shown, t);
    actor.root.updateWorldMatrix(true, false);
    actor.root.getWorldQuaternion(rootQ);
    const s3 = actor.bone('spine_03');
    if (p.pitch && s3) turn(s3, qc.setFromAxisAngle(ax.set(1, 0, 0).applyQuaternion(rootQ), p.pitch * w));
    if (!s3) return;
    s3.getWorldPosition(sternum);
    for (const [arm, ids, pl] of [[p.r, ['upperarm_r', 'lowerarm_r', 'hand_r'], POLE_R], [p.l, ['upperarm_l', 'lowerarm_l', 'hand_l'], POLE_L]] as const) {
      if (!arm) continue;
      const a = actor.bone(ids[0]), b = actor.bone(ids[1]), c = actor.bone(ids[2]);
      if (!a || !b || !c) continue;
      tgt.set(arm[0], arm[1], arm[2]).applyQuaternion(rootQ).add(sternum);
      solve(a, b, c, tgt, pole.copy(pl).applyQuaternion(rootQ), w);
    }
  }, 'pre'));
  return fig;
}
