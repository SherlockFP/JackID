/**
 * `kit.dealer({ style })` — table automata built on the animated mannequin (the old hinge rig only survives as the
 * mannequin's loading placeholder). A dealer is a mannequin in a style (suit, mask, hat, proportions) plus a procedural
 * layer on top of its idle clip:
 *
 *  - two-bone arm IK in the actor's local space (hands reach table points, elbows follow a pole vector), blended over
 *    the clip with a weight so a gesture grows out of the idle pose and falls back into it;
 *  - spine bow, head nod / shake offsets, idle micro-motion (look-aways, one joint twitching for 0.3 s every few
 *    seconds: the automaton tell);
 *  - stable `head / armL / armR / handL / handR` proxy nodes that follow the real bones, so modelers can parent cards
 *    and chips to a hand before the GLB has even loaded.
 *
 * Styles: croupier · porcelain · puppet (strings to a crossbar, 9 fps) · devil (tall, long arms) — and, beyond the
 * frozen union, oracle · caller · cashier (pass them with a cast; Contracts v1.1 adds them to the type).
 * Gestures are promises that always resolve. All timing runs on the kit clock. Root space: +Z forward (towards the
 * table), +X = the dealer's left, y up; reach targets are authored for a 1.78 m dealer and scale with `height`.
 */
import * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import { PAL } from './palette';
import type { KitCtx } from './ctx';
import type { MannequinInternal } from './mannequin';
import type { DealerPart, DealerPose, Kit, MannequinOpts } from './types';

export type DealerStyle = 'croupier' | 'porcelain' | 'puppet' | 'devil' | 'oracle' | 'caller' | 'cashier';

interface StyleCfg {
  opts: MannequinOpts;
  mask: string;
  height: number;
  props: Array<{ id: string; bone: string }>;
  armScale?: number;
  speed?: number;
}

const STYLES: Record<DealerStyle, (suit: Hex | undefined, skin: Hex | undefined) => StyleCfg> = {
  croupier: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? 0x16161e, jointColor: skin ?? PAL.BRASS, stepFps: 15 },
    mask: 'mask_porcelain', height: 1.78, props: [{ id: 'bowtie', bone: 'neck_01' }],
  }),
  porcelain: (suit, skin) => ({
    opts: { style: 'porcelain', color: suit, jointColor: skin, stepFps: 12 },
    mask: 'mask_porcelain', height: 1.78, props: [], speed: 0.75,
  }),
  puppet: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? 0x8c1921, jointColor: skin ?? 0x6b3a21, stepFps: 9 },
    mask: 'mask_porcelain', height: 1.55, props: [{ id: 'hat_bowler', bone: 'Head' }],
  }),
  devil: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? PAL.OXBLOOD, jointColor: skin ?? PAL.GOLD, stepFps: 15 },
    mask: 'mask_devil', height: 2.05, props: [], armScale: 1.18,
  }),
  oracle: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? PAL.BRUISE, jointColor: skin ?? PAL.CURSE_VIOLET, stepFps: 12, clip: 'Idle_Talking_Loop' },
    mask: 'mask_oracle', height: 1.7, props: [], speed: 0.8,
  }),
  caller: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? 0x3a3a42, jointColor: skin ?? PAL.CHROME_MID, stepFps: 15, clip: 'Idle_Talking_Loop' },
    mask: 'hat_flatcap', height: 1.78, props: [{ id: 'mic', bone: 'hand_r' }],
  }),
  cashier: (suit, skin) => ({
    opts: { style: 'plain', color: suit ?? 0x244a38, jointColor: skin ?? PAL.BONE, stepFps: 15 },
    mask: 'mask_cashier', height: 1.76, props: [],
  }),
};

const POSES: Record<DealerPose, { R: V3 | null; L: V3 | null; bow: number }> = {
  idle: { R: null, L: null, bow: 0 },
  deal: { R: [-0.14, 1.0, 0.52], L: [0.22, 0.98, 0.3], bow: 0 },
  reach: { R: [-0.16, 1.02, 0.6], L: [0.16, 1.02, 0.6], bow: 0 },
  spin: { R: [-0.12, 1.32, 0.4], L: null, bow: 0 },
  collect: { R: [-0.3, 0.96, 0.5], L: [0.28, 0.96, 0.45], bow: 0 },
  point: { R: [-0.12, 1.32, 0.62], L: null, bow: 0 },
  bow: { R: null, L: null, bow: 1 },
  arms: { R: [-0.6, 1.38, 0.1], L: [0.6, 1.38, 0.1], bow: 0 },
};

const PROC_BONES = ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'] as const;
const POLE_R: V3 = [-0.55, -0.7, -0.55], POLE_L: V3 = [0.55, -0.7, -0.55];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface ArmState { pos: THREE.Vector3; w: number; has: boolean }
type Ease = 'inOutCubic' | 'outCubic' | 'linear';

export function makeDealers(ctx: KitCtx, mq: { mannequin(o?: MannequinOpts): MannequinInternal }, makeProp: (id: string) => THREE.Group): Pick<Kit, 'dealer'> {
  // scratch objects (everything here runs inside one synchronous frame callback)
  const ID = new THREE.Quaternion();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), rootQ = new THREE.Quaternion();
  const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const S = new THREE.Vector3(), E0 = new THREE.Vector3(), H0 = new THREE.Vector3(), E1 = new THREE.Vector3(), H1 = new THREE.Vector3();
  const toT = new THREE.Vector3(), perp = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3(), c1 = new THREE.Vector3(), d1 = new THREE.Vector3();
  const axis = new THREE.Vector3(), pole = new THREE.Vector3(), tw = new THREE.Vector3(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  /** Turn `bone` by the shortest arc `cur → des` (world directions), scaled by `w`. */
  const aim = (bone: THREE.Object3D, cur: THREE.Vector3, des: THREE.Vector3, w: number): void => {
    qc.setFromUnitVectors(cur, des).slerp(ID, 1 - w);
    const parentQ = bone.parent!.getWorldQuaternion(qb);
    bone.quaternion.premultiply(qa.copy(parentQ).invert().multiply(qc).multiply(parentQ));
    bone.updateMatrixWorld(true);
  };
  /** Rotate `bone` about a world axis by `angle` (pivot = the bone itself). */
  const rotate = (bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void => {
    qc.setFromAxisAngle(axisWorld, angle);
    const parentQ = bone.parent!.getWorldQuaternion(qb);
    bone.quaternion.premultiply(qa.copy(parentQ).invert().multiply(qc).multiply(parentQ));
    bone.updateMatrixWorld(true);
  };

  /** Two-bone IK: put `hand` on `target` (world) with the elbow towards `poleWorld`, blended by `w`. */
  const solveArm = (up: THREE.Object3D, low: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, poleWorld: THREE.Vector3, w: number): void => {
    up.updateWorldMatrix(true, true);
    up.getWorldPosition(S); low.getWorldPosition(E0); hand.getWorldPosition(H0);
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
    toT.copy(target).sub(S);
    const d = Math.min(Math.max(toT.length(), Math.abs(L1 - L2) + 0.02), L1 + L2 - 0.005);
    toT.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    perp.copy(poleWorld).addScaledVector(toT, -poleWorld.dot(toT));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    E.copy(S).addScaledVector(toT, a).addScaledVector(perp, h);
    Tc.copy(S).addScaledVector(toT, d);
    c1.subVectors(E0, S).normalize();
    d1.subVectors(E, S).normalize();
    aim(up, c1, d1, w);
    low.getWorldPosition(E1); hand.getWorldPosition(H1);
    c1.subVectors(H1, E1).normalize();
    d1.subVectors(Tc, E1).normalize();
    aim(low, c1, d1, w);
  };

  const dealer: Kit['dealer'] = (o): DealerPart => {
    const styleId = (o.style in STYLES ? o.style : 'croupier') as DealerStyle;
    const cfg = STYLES[styleId](o.suit, o.skin);
    const height = o.height ?? cfg.height;
    const actor = mq.mannequin({ ...cfg.opts, height, mask: cfg.mask, clip: cfg.opts.clip ?? 'Idle_Loop' });
    if (cfg.speed) actor.setSpeed(cfg.speed);
    actor.addProc(PROC_BONES);
    for (const p of cfg.props) { const pr = makeProp(p.id); actor.own(pr); actor.attach(pr, p.bone); }
    const root = actor.root;
    root.name = `dealer:${styleId}`;
    const k = height / 1.78;

    // proxies that follow the real bones
    const mkProxy = (name: string): THREE.Object3D => { const n = new THREE.Object3D(); n.name = name; root.add(n); return n; };
    const head = mkProxy('head'), armL = mkProxy('armL'), armR = mkProxy('armR'), handL = mkProxy('handL'), handR = mkProxy('handR');
    const proxies: Array<[THREE.Object3D, string]> = [[head, 'Head'], [armL, 'upperarm_l'], [armR, 'upperarm_r'], [handL, 'hand_l'], [handR, 'hand_r']];
    const strings = styleId === 'puppet' ? makeStrings(ctx, root, [head, armL, armR, handL, handR], height) : null;

    const L: ArmState = { pos: new THREE.Vector3(), w: 0, has: false }, R: ArmState = { pos: new THREE.Vector3(), w: 0, has: false };
    let bow = 0;
    const headOff = { pitch: 0, yaw: 0 };
    let twitch: { bone: string; axis: THREE.Vector3; ang: number; until: number } | null = null;
    const tokBow = {}, tokHead = {};
    // rest poses so parented cards/chips sit at the table before the GLB loads; onPose overwrites them
    head.position.set(0, 1.6 * k, 0);
    armL.position.set(0.2 * k, 1.4 * k, 0); armR.position.set(-0.2 * k, 1.4 * k, 0);
    handL.position.set(0.28 * k, 0.95 * k, 0.1 * k); handR.position.set(-0.28 * k, 0.95 * k, 0.1 * k);
    let gid = 0, busy = 0, headGesture = false;   // gesture generation (latest wins) · running count · last one moved the head

    // ── procedural layers ──
    actor.onPose(() => {
      root.updateWorldMatrix(true, false);
      root.getWorldQuaternion(rootQ);
      if (cfg.armScale) for (const n of ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r']) actor.bone(n)?.scale.setY(cfg.armScale);
      if (bow > 0.002) {                                      // bow about the actor's left axis
        axis.set(1, 0, 0).applyQuaternion(rootQ);
        for (const n of ['spine_01', 'spine_02', 'spine_03']) { const sb = actor.bone(n); if (sb) rotate(sb, axis, 0.2 * bow * k); }
      }
      if (twitch) {                                           // one joint snaps and holds
        const tb = actor.bone(twitch.bone);
        if (tb && ctx.anim.time < twitch.until) rotate(tb, axis.copy(twitch.axis).applyQuaternion(rootQ), twitch.ang);
        else twitch = null;
      }
      for (const [arm, ids, pl] of [[R, ['upperarm_r', 'lowerarm_r', 'hand_r'], POLE_R], [L, ['upperarm_l', 'lowerarm_l', 'hand_l'], POLE_L]] as const) {
        if (arm.w < 0.003) continue;
        const u = actor.bone(ids[0]), l = actor.bone(ids[1]), h = actor.bone(ids[2]);
        if (!u || !l || !h) continue;
        tw.set(arm.pos.x * k, arm.pos.y * k, arm.pos.z * k).applyMatrix4(root.matrixWorld);
        pole.set(pl[0], pl[1], pl[2]).transformDirection(root.matrixWorld);
        solveArm(u, l, h, tw, pole, arm.w);
      }
    }, 'pre');

    actor.onPose(() => {
      const hb = actor.bone('Head');
      if (hb && (Math.abs(headOff.pitch) > 1e-3 || Math.abs(headOff.yaw) > 1e-3)) {   // nod / shake on top of tracking
        rotate(hb, axis.set(1, 0, 0).applyQuaternion(rootQ), headOff.pitch);
        rotate(hb, axis.set(0, 1, 0).applyQuaternion(rootQ), headOff.yaw);
      }
      root.updateMatrixWorld(true);
      m1.copy(root.matrixWorld).invert();
      for (const [proxy, bone] of proxies) {
        const bn = actor.bone(bone);
        if (!bn) continue;
        m2.multiplyMatrices(m1, bn.matrixWorld).decompose(pp, quat, ps);
        proxy.position.copy(pp);
        proxy.quaternion.copy(quat);
      }
      strings?.update();
    }, 'post');

    // ── tweens ──
    const armTo = (arm: ArmState, to: V3 | null, dur: number, ease: Ease = 'inOutCubic'): Promise<void> => {
      if (to === null) {
        const w0 = arm.w;
        return ctx.anim.run(dur, (t) => { arm.w = lerp(w0, 0, t); }, { owner: arm, ease }).then(() => { arm.w = 0; arm.has = false; });
      }
      const target = new THREE.Vector3(to[0], to[1], to[2]);
      if (arm.w < 0.01 || !arm.has) arm.pos.copy(target);
      const p0 = arm.pos.clone(), w0 = arm.w;
      arm.has = true;
      return ctx.anim.run(dur, (t) => { arm.pos.lerpVectors(p0, target, t); arm.w = lerp(w0, 1, Math.min(1, t * 1.6)); }, { owner: arm, ease }).then(() => { arm.pos.copy(target); arm.w = 1; });
    };
    const bowTo = (goal: number, dur: number): Promise<void> => {
      const b0 = bow;
      return ctx.anim.run(dur, (t) => { bow = lerp(b0, goal, t); }, { owner: tokBow, ease: 'inOutCubic' }).then(() => { bow = goal; });
    };
    const headTo = (pitch: number, yaw: number, dur: number): Promise<void> => {
      const p0 = headOff.pitch, y0 = headOff.yaw;
      return ctx.anim.run(dur, (t) => { headOff.pitch = lerp(p0, pitch, t); headOff.yaw = lerp(y0, yaw, t); }, { owner: tokHead, ease: 'inOutCubic' });
    };
    const wait = (s: number): Promise<void> => ctx.anim.run(s, () => {}, { owner: {} });

    // ── idle micro-motion ──
    let idleOn = true, nextLook = 2 + (root.id % 5), nextTwitch = 5 + (root.id % 7), lookHold = 0;
    ctx.anim.tick(root, (_dt, t) => {
      if (!idleOn) return;
      if (busy > 0) return;
      if (t >= nextLook) {
        void headTo(headOff.pitch, (((root.id * 7 + Math.floor(t)) % 5) - 2) * 0.16, 0.35);
        lookHold = t + 1.2 + (Math.floor(t) % 3);
        nextLook = t + 3 + ((root.id + Math.floor(t * 3)) % 5);
      } else if (lookHold > 0 && t >= lookHold) { lookHold = 0; void headTo(0, 0, 0.45); }
      if (t >= nextTwitch && !twitch) {
        const names = ['upperarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'Head'];
        twitch = { bone: names[(root.id + Math.floor(t * 5)) % names.length], axis: new THREE.Vector3(Math.sin(t), 0.3, Math.cos(t * 1.7)).normalize(), ang: 0.17, until: t + 0.3 };
        nextTwitch = t + 5 + ((root.id * 3 + Math.floor(t * 7)) % 10);
      }
    });

    // ── API ──
    const api: DealerPart = {
      root, head, armL, armR, handL, handR,
      pose(p, dur = 0.35) {
        const def = POSES[p];
        gid++;                                   // cancels any running gesture
        return Promise.all([armTo(R, def.R, dur), armTo(L, def.L, dur), bowTo(def.bow, dur)]).then((): void => undefined);
      },
      lookAt(target, dur = 0.3) { actor.lookAt(target ?? null, dur); },
      async gesture(g, target) {
        const my = ++gid;
        const live = (): boolean => my === gid;
        const run = async (...steps: Array<() => Promise<void>>): Promise<void> => {
          for (const s of steps) { if (!live()) return; await s(); }
        };
        const isHead = g === 'nod' || g === 'shake';
        if (headGesture && !isHead) void headTo(0, 0, 0.12);
        headGesture = isHead;
        busy++;
        try {
        switch (g) {
          case 'deal':
            await run(() => armTo(R, [-0.14, 1.0, 0.5], 0.14, 'outCubic'), () => armTo(R, [-0.1, 0.95, 0.72], 0.09, 'outCubic'), () => armTo(R, [-0.14, 1.0, 0.5], 0.14), () => armTo(R, null, 0.2));
            break;
          case 'collect':
            await run(() => armTo(R, [-0.34, 0.98, 0.64], 0.2), () => armTo(R, [-0.04, 0.98, 0.26], 0.45), () => armTo(R, null, 0.2));
            break;
          case 'spin':
            await run(() => armTo(R, [-0.14, 1.42, 0.2], 0.25), () => armTo(R, [-0.05, 1.02, 0.62], 0.12, 'outCubic'), () => wait(0.12), () => armTo(R, null, 0.3));
            break;
          case 'point': {
            let dest: V3 = [-0.12, 1.32, 0.62];
            if (target) {
              const lp = root.worldToLocal(new THREE.Vector3().copy(target));
              const sh = new THREE.Vector3(-0.2 * k, 1.38 * k, 0.0);
              const dir = lp.sub(sh);
              dir.setLength(Math.min(dir.length(), 0.6 * k));
              sh.add(dir);
              dest = [sh.x / k, sh.y / k, sh.z / k];
            }
            await run(() => armTo(R, dest, 0.3), () => wait(0.5), () => armTo(R, null, 0.3));
            break;
          }
          case 'nod': await run(() => headTo(0.4, headOff.yaw, 0.16), () => headTo(0, headOff.yaw, 0.22)); break;
          case 'shake':
            await run(...Array.from({ length: 3 }, () => [() => headTo(0, 0.5, 0.1), () => headTo(0, -0.5, 0.1)]).flat(), () => headTo(0, 0, 0.1));
            break;
          case 'wave':
            await run(() => armTo(R, [-0.3, 1.62, 0.12], 0.25),
              ...Array.from({ length: 3 }, () => [() => armTo(R, [-0.42, 1.62, 0.12], 0.1, 'linear'), () => armTo(R, [-0.2, 1.62, 0.12], 0.1, 'linear')]).flat(),
              () => armTo(R, null, 0.25));
            break;
        }
        } finally { busy--; }
      },
      idle(on) { idleOn = on; if (!on) void headTo(0, 0, 0.2); },
    };
    root.userData.dealer = api;
    return api;
  };

  return { dealer };
}

/** Marionette strings: one line per proxy up to a wooden crossbar above the head (rebuilt every frame from the proxies). */
function makeStrings(ctx: KitCtx, root: THREE.Object3D, proxies: THREE.Object3D[], height: number): { update(): void } {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(proxies.length * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: PAL.BONE, fog: true }));
  lines.frustumCulled = false;
  lines.name = 'strings';
  root.add(lines);
  const topY = height + 1.0;
  const bar = ctx.P.group('crossbar');
  ctx.P.box(0.5, 0.025, 0.04, ctx.M.woodStain(0x6b4a2a), { pos: [0, topY, 0], parent: bar });
  ctx.P.box(0.04, 0.025, 0.4, ctx.M.woodStain(0x6b4a2a), { pos: [0, topY, 0], parent: bar });
  root.add(bar);
  const anchors: Array<[number, number]> = [[0, 0], [0.22, 0], [-0.22, 0], [0.12, 0.18], [-0.12, 0.18]];
  return {
    update(): void {
      for (let i = 0; i < proxies.length; i++) {
        const a = anchors[i % anchors.length], p = proxies[i].position;
        pos.set([a[0], topY, a[1], p.x, p.y, p.z], i * 6);
      }
      geo.getAttribute('position').needsUpdate = true;
    },
  };
}
