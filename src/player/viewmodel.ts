/**
 * First-person viewmodel (PLAYER): the CC0 rigged arms (`viewmodel/arms.ts`: fingerless leather gloves, 18 clips) in their OWN scene,
 * rendered after the world with the depth buffer cleared (`renderer.render(scene, camera, { scene: vm.scene, camera: vm.camera })`),
 * FOV 58 (VM_FOV), near 0.01 (TECH_SPEC §11.7, ART_BIBLE §8.5). The GLB loads once, asynchronously: until it has (or if it cannot be
 * loaded: one warning) there are simply no hands, and the game plays on. The things the hands hold are in `viewmodel/items.ts`,
 * the one-shot animations in `viewmodel/anims.ts` and the coin tricks in `viewmodel/fidget.ts`. Materials are unlit; `setLightLevel`
 * dims them in dark rooms.
 *
 * Clips: `relax` loops on both arms; the one-shots lay a clip over one arm for their length (`grab` · `eat` · `drink` use
 * `grab.R`, `punchCard` and `throw` `push.R`, `flip` and `point` the `finger_gun_*` clips, the phone `grab.L`), blended with the
 * animation's own fade in and out. On top of the clip the hands keep the additive pose: breathing, walk bob, a lift to the
 * mouth, finger curls (rock, paper and scissors are curls on the finger bones), the wristwatch on the left forearm.
 *
 * The coin throws (R toss, Q pass) and the held-Q tricks are `viewmodel/coinTricks.ts` (hand-keyed curves) run by `viewmodel/fidget.ts`.
 *
 * Holds (`hold`): coin (default), card, tonic, phone, ticket, ledger, gun (two-handed), totem, the five foods (banana, coffee,
 * sandwich, energy, soup: `eat` and `drink` raise them to the mouth), or any `Object3D` the caller supplies (card fan, totem, scratch
 * coin…). Items hang from the hand bone, so they move with the clips. Changing the held item raises the new one from below (and
 * the old one shrinks away). One-shot animations (`play`): flip · drink · eat · throw · point · punchCard · recoil · give · grab ·
 * checkWatch · unwatch · rpsRock · rpsPaper · rpsScissors. An empty hand holds a coin (the default). In walk mode with the coin in
 * hand, R tosses it and Q passes it to the other hand, holding Q plays a fancy trick (`./viewmodel/fidget.ts`); after ~8 s of standing still a short knuckle walk plays on its own.
 * `setHandLook` shows the unsettling finger-tax and porcelain collateral looks. The facade feeds head-bob and look deltas through
 * `drive()` once per frame.
 *
 * Everything moves on sim `dt`: the mixer, eased curves, springs for the wrist and the fingers (follow-through), an interrupted
 * animation fades out while the next one fades in, and nothing snaps when an animation starts or ends.
 */
import * as THREE from 'three';
import { clamp, damp, lerp } from '@/core/math';
import { log } from '@/core/log';
import type { Hex } from '@/core/types';
import type { HeldItem, Viewmodel } from './types';
import { createFidget, handAmplitude } from './viewmodel/fidget';
import type { TossKind } from './viewmodel/coinTricks';
import { Arm, Arms, copyPose, GLOVE_IVORY, GLOVE_LEATHER, HOLD_AT, loadArms, newPose, POSE_KEYS, spring, type ArmsSource, type ClipReq } from './viewmodel/arms';
import { ANIMS, newFx, outBack, smooth, type Anim, type AnimFx } from './viewmodel/anims';
import { buildGun, buildItem, buildWatch, gripOf, liftWatch, type Bite, type OwnMat } from './viewmodel/items';
import { disposeGeometries, mat } from './viewmodel/shape';

export { GLOVE_IVORY, GLOVE_LEATHER };

export interface ViewmodelDrive {
  /** Camera head-bob offsets (m); the hands move 1.5× (ART_BIBLE §8.5). */
  bobX: number; bobY: number;
  sprint: boolean; crouch: number; grounded: boolean;
  /** Mouse delta since the last frame (px). */
  lookDx: number; lookDy: number;
  /** Main camera aspect, so the overlay frustum matches. */
  aspect: number;
  /** Player ground speed (m/s): drives the hand walk bob. Optional; 0 when missing. */
  speed?: number;
}

export interface ViewmodelHost extends Viewmodel {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly item: HeldItem;
  /** Settles once the arms are in the scene (or could not be loaded: then there are no hands). */
  readonly ready: Promise<void>;
  drive(d: ViewmodelDrive): void;
  /** The Q key went down or up: a tap passes the coin to the other hand, held 0.4 s plays the fancy tricks (the knuckle roll loops while held). `which` plays that trick at once (tests, bench). */
  trick(down: boolean, which?: number): void;
  /** Throw the coin (R: `up`, Q: `pass` to the other hand); asked in the air it follows the catch with no gap. */
  toss(kind: TossKind): void;
  /** 0..1 brightness of the surroundings. */
  setLightLevel(v: number): void;
  /** The arms are bare skin under the gloves: the jacket colour is kept for the day the sleeves come back. */
  setSleeveColor(c: Hex): void;
  /** `GLOVE_IVORY` shows bare hands; any other colour the leather gloves. The porcelain look still overrides. */
  setGloveColor(c: Hex): void;
  /** Cracked-porcelain texture for the collateral look (optional; a flat bone colour is used without it). */
  setPorcelainMap(map: THREE.Texture | null): void;
  /** Show or hide the wristwatch on the left wrist. */
  setWatch(on: boolean): void;
  dispose(): void;
}

// ── viewmodel ─────────────────────────────────────────────────────────────────────────────────────
/** Both hands rest a little higher and tipped up, not flat on the bottom edge. */
/** Vertical FOV of the viewmodel camera: wider than the world's so the hands stay small (CS/HL rest pose). */
const VM_FOV = 58;
const REST_POSE = { py: 0.02, rx: 0.1, wp: 0.08 };
/** The grips were solved on the old glove: on this hand every held item sits this far lower (m), in the fist and not above it. */
const GRIP_DROP = 0.025;
const GUN_HOME = new THREE.Vector3(0.135, -0.135, -0.3);
/** A new item rises from below on a spring; the old one shrinks away over this long (s). */
const RAISE_DROP = 0.07, LEAVE_S = 0.12, FADE_OUT_S = 0.2;
/** Clips an item holds on the arms while it is in the hand (`t` = where in the clip). The phone is held in the left hand. */
const HOLD_CLIPS: Record<string, { r?: ClipReq; l?: ClipReq }> = {
  phone: { l: { clip: 'grab.L', w: 1, t: 0.5 } },
  gun: { r: { clip: 'guard_idle', w: 1, t: 0 }, l: { clip: 'guard_idle', w: 1, t: 0 } },
};

/** How far into an animation (`t` s of `def.dur`) the pose layer counts: eased in and out so it never pops. */
const envelope = (def: Anim, t: number): number => {
  const [fi, fo] = def.fade ?? [0.1, 0.2];
  return smooth(t / fi) * (1 - smooth((t - (def.dur - fo)) / fo));
};

/** Adds `r` to a request list; the same clip twice (an interrupted animation fading out under its successor) counts once, the heavier one setting the time. */
const addReq = (list: ClipReq[], r: ClipReq): void => {
  const same = list.find((x) => x.clip === r.clip);
  if (!same) list.push(r);
  else { if (r.w > same.w) same.t = r.t; same.w += r.w; }
};

export function createViewmodel(_sleeveColor: Hex = 0x7a1a20, gloveColor: Hex = GLOVE_LEATHER, armsSource: Promise<ArmsSource | null> = loadArms()): ViewmodelHost {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VM_FOV, 16 / 9, 0.01, 4);
  const own: THREE.Material[] = [];
  const ownMat: OwnMat = (c) => { const x = mat(c); own.push(x); return x; };
  const right = new Arm(1);
  const left = new Arm(-1);
  const rig = new THREE.Group();
  scene.add(rig);
  let arms: Arms | null = null;
  let disposed = false;
  const watch = buildWatch(ownMat);
  let bare = gloveColor === GLOVE_IVORY;

  const base = { r: newPose(), l: newPose() };       // grip for the held item
  const live = { r: newPose(), l: newPose() };       // smoothed toward `base`
  const fx = newFx();
  const scratchFx = newFx();
  const snap = { r: newPose(), l: newPose() };
  const trickCoin = buildItem('coin', ownMat)!;     // the held coin's own mesh, reused for the Q tricks
  trickCoin.visible = false;
  scene.add(trickCoin);
  const fidget = createFidget(right, left, trickCoin);
  let item: HeldItem = 'none';
  let held: THREE.Object3D | null = null;
  let heldOwned = false;
  let heldAge = 1;                                   // s since the item was raised (it grows in over its first moments)
  let gone = false;                                  // the food has been eaten (or the drink put away): it stays gone until the item changes
  let gun: THREE.Group | null = null;
  const leaving: Array<{ obj: THREE.Object3D; t: number }> = [];
  const raise = { x: 0, v: 0 };                      // 1 just after the item changed, settling to 0: the hands come up from below
  let anim: { name: string; t: number; def: Anim; resolve: () => void; resolved: boolean } | null = null;
  let ending: { def: Anim; t: number; w: number } | null = null;     // the animation that was interrupted, fading out
  let visible = true;
  let clock = 0;
  let porcelain = false;
  let porcelainMap: THREE.Texture | null = null;
  let lightLevel = 1;
  // motion inputs
  let bobX = 0, bobY = 0, crouchK = 0, airK = 0, airTarget = 0, sprintTarget = 0, lookX = 0, lookY = 0;
  let sprintK = 0, swayX = 0, swayY = 0;
  let speed = 0, walkK = 0, walkPhase = 0, watchOn = true;
  let holdClips = HOLD_CLIPS.phone, holdK = 0;       // the clips of the item in the hand, and how far they have come in

  const mount = (src: ArmsSource | null): void => {
    if (!src || disposed) return;
    try {
      arms = new Arms(src, right, left);
    } catch (e) {
      log.warnOnce('arms-mount', 'player', 'first-person arms could not be set up: no hands', e);
      return;
    }
    arms.setGlove(bare);
    arms.setPorcelain(porcelain, porcelainMap);
    left.forearm.add(watch);
    rig.add(arms.root);
  };
  const ready = armsSource.then(mount, (): void => undefined);

  const dropLeaving = (i: number): void => {
    const e = leaving[i];
    e.obj.removeFromParent();
    disposeGeometries(e.obj);
    leaving.splice(i, 1);
  };
  const releaseItem = (): void => {
    if (held) {
      if (heldOwned) leaving.push({ obj: held, t: 0 });     // the old item shrinks away on the hand while the new one rises
      else held.removeFromParent();
    }
    held = null; heldOwned = false;
    if (gun) { gun.removeFromParent(); disposeGeometries(gun); gun = null; }
  };
  /** The hand that holds `kind`: the phone is held in the left. */
  const handOf = (kind: string): Arm => (kind === 'phone' ? left : right);

  const setBase = (): void => {
    const r = base.r, l = base.l;
    copyPose(r, newPose()); copyPose(l, newPose());
    Object.assign(r, REST_POSE); Object.assign(l, REST_POSE);
    switch (item) {
      case 'ledger': Object.assign(r, gripOf(item).hand); l.curl = 0.5; l.py += 0.03; break;
      case 'gun': r.curl = 0.9; r.index = 0.8; r.thumb = 0.6; l.curl = 0.9; l.thumb = 0.6; break;
      default: Object.assign(handOf(item) === left ? l : r, gripOf(item).hand);
    }
  };

  /** Runs `def` at `t` into the hands' poses, blended by `w` (the pose it added is scaled; the item effects go to `out`). */
  const layer = (def: Anim, t: number, w: number, out: AnimFx): void => {
    if (w <= 0) return;
    copyPose(snap.r, right.pose); copyPose(snap.l, left.pose);
    def.run(clamp(t / def.dur, 0, 1), right.pose, left.pose, out, { item });
    if (w >= 1) return;
    for (const key of POSE_KEYS) {
      right.pose[key] = snap.r[key] + (right.pose[key] - snap.r[key]) * w;
      left.pose[key] = snap.l[key] + (left.pose[key] - snap.l[key]) * w;
    }
  };

  /** The clips an animation asks for at `t`, weighted `w`. */
  const clipsOf = (def: Anim, t: number, w: number, r: ClipReq[], l: ClipReq[]): void => {
    const c = def.clip;
    if (!c || w <= 0) return;
    const k = clamp(t / def.dur, 0, 1), at = c.at ? c.at(k) : k, cw = w * (c.w ? c.w(k) : 1);
    if (c.r) addReq(r, { clip: c.r, w: cw, t: at });
    if (c.l) addReq(l, { clip: c.l, w: cw, t: at });
  };

  /** Moves the running animation on; resolves its promise at its `done` point and drops it at its end. */
  const stepAnim = (dt: number): void => {
    if (!anim) return;
    anim.t += dt;
    if (!anim.resolved && anim.t >= anim.def.dur * (anim.def.done ?? 1)) { anim.resolved = true; anim.resolve(); }
    if (anim.t >= anim.def.dur) {
      const done = anim; anim = null;
      if (done.name === 'unwatch') { watchOn = false; watch.visible = false; }
      done.resolve();
    }
  };

  const vm: ViewmodelHost = {
    scene, camera, ready,
    get item() { return item; },
    trick(down, which) { fidget.press(down, which); },
    toss(kind) { fidget.toss(kind); },
    setVisible(on) { visible = on; rig.visible = on; if (gun) gun.visible = on; if (!on) fidget.reset(); },
    hold(next, obj) {
      if (next === 'none' && !obj) next = 'coin';           // an empty hand holds a coin: the Q tricks always have one
      if (!obj && next === item && (held || gun)) return;   // already in the hand (callers re-hold while an item is up)
      const first = item === 'none';
      fidget.reset();
      releaseItem();
      item = next;
      heldAge = 0; gone = false;
      if (HOLD_CLIPS[next]) holdClips = HOLD_CLIPS[next];
      if (obj) { right.holder.add(obj); held = obj; }
      else if (next === 'gun') {
        gun = buildGun(ownMat);
        gun.position.copy(GUN_HOME);
        gun.visible = visible;
        scene.add(gun);
      } else if (next !== 'none') {
        const built = buildItem(next, ownMat);
        if (built) {
          const g = gripOf(next), arm = handOf(next), s = arm.side, drop = next === 'coin' ? 0 : GRIP_DROP;      // the left hand mirrors the grip
          built.position.set((g.pos[0] - HOLD_AT[0]) * s, g.pos[1] - HOLD_AT[1] - drop, g.pos[2] - HOLD_AT[2]);
          built.rotation.set(g.rot[0], g.rot[1] * s, g.rot[2] * s);
          arm.holder.add(built); held = built; heldOwned = true;
        }
      }
      setBase();
      if (!first) raise.x = 1;
    },
    play(name) {
      const def = ANIMS[name];
      if (!def) return Promise.resolve();
      fidget.stop();
      if (anim) { ending = { def: anim.def, t: anim.t, w: envelope(anim.def, anim.t) }; anim.resolve(); }
      return new Promise<void>((resolve) => { anim = { name, t: 0, def, resolve, resolved: false }; });
    },
    setHandLook(o) {
      if (o.fingers !== undefined) { const n = clamp(Math.round(o.fingers), 0, 5); right.setFingers(n); left.setFingers(n); }
      if (o.porcelain !== undefined) { porcelain = o.porcelain; arms?.setPorcelain(porcelain, porcelainMap); }
    },
    setPorcelainMap(map) {
      porcelainMap = map;
      if (porcelain) arms?.setPorcelain(true, map);
    },
    setSleeveColor() { /* bare forearms: nothing to colour */ },
    setGloveColor(c) { bare = c === GLOVE_IVORY; arms?.setGlove(bare); },
    setLightLevel(v) { lightLevel = clamp(v, 0.2, 1); },
    setWatch(on) { watchOn = on; watch.visible = on; },
    drive(d) {
      speed = d.speed ?? 0;
      bobX = d.bobX * 0.4; bobY = d.bobY * 0.4;
      sprintTarget = d.sprint ? 1 : 0;
      crouchK = d.crouch; airTarget = d.grounded ? 0 : 1;
      lookX = d.lookDx; lookY = d.lookDy;
      if (Math.abs(camera.aspect - d.aspect) > 1e-3) { camera.aspect = d.aspect; camera.updateProjectionMatrix(); }
    },
    update(dt) {
      if (!visible) { stepAnim(dt); return; }                  // hidden hands still finish their animation (the game waits on it)
      clock += dt;
      arms?.setLight(lightLevel);
      sprintK = damp(sprintK, sprintTarget, 9, dt);
      airK = damp(airK, airTarget, 8, dt);
      spring(raise, 0, 15, 0.5, Math.min(dt, 0.1));
      // sway lags the mouse by ~0.08 s, capped at 3 cm (ART_BIBLE §8.5)
      const rate = 1 / Math.max(dt, 1 / 240);
      swayX = damp(swayX, clamp(-lookX * rate * 0.00004, -0.03, 0.03), 12, dt);
      swayY = damp(swayY, clamp(lookY * rate * 0.00004, -0.03, 0.03), 12, dt);

      // grip → live pose
      const k = 1 - Math.exp(-14 * dt);
      for (const key of POSE_KEYS) { live.r[key] = lerp(live.r[key], base.r[key], k); live.l[key] = lerp(live.l[key], base.l[key], k); }
      copyPose(right.pose, live.r); copyPose(left.pose, live.l);

      // locomotion layers
      const amp = handAmplitude();
      walkK = damp(walkK, clamp(speed / 4, 0, 1.25) * (1 - airK), 6, dt);
      walkPhase += dt * (2.2 + speed * 1.3);
      const calmK = 1 - 0.55 * walkK;                    // breathing fades behind the walk bob
      const up = raise.x;                                // a new item comes up from below, the fingers trailing
      for (const h of [right, left]) {
        const s = h === right ? 1 : -1, o = h === right ? 0 : 0.8;
        const p = h.pose;
        // breathing: slow, out of phase between the hands, with the fingers loosening on the in-breath
        const br = Math.sin(clock * 1.5 + o);
        p.py += (0.0028 * br + 0.0012 * Math.sin(clock * 0.7 + o * 2)) * calmK * amp;
        p.rx += 0.012 * Math.sin(clock * 1.5 + o + 0.9) * calmK * amp;
        p.rz += 0.009 * Math.sin(clock * 0.9 + o) * s * calmK * amp;
        p.px += 0.0016 * Math.cos(clock * 0.9 + o) * calmK * amp;
        p.curl += 0.025 * br * calmK; p.index += 0.02 * br * calmK;
        // walk bob: two dips per cycle, opposite swing between the hands, the fingers jiggling a beat behind
        p.py += 0.0055 * Math.sin(walkPhase * 2 + o) * walkK * amp;
        p.pz += 0.006 * Math.cos(walkPhase + o) * s * walkK * amp;
        p.px += 0.004 * Math.sin(walkPhase) * walkK * amp;
        p.rx += 0.03 * Math.sin(walkPhase * 2 + o + 0.7) * walkK * amp;
        p.rz += 0.035 * Math.sin(walkPhase + o) * s * walkK * amp;
        p.curl += 0.04 * Math.sin(walkPhase * 2 + o - 0.6) * walkK * amp;
        p.py += -0.045 * sprintK + 0.015 * crouchK - 0.01 * airK;
        p.pz += 0.05 * sprintK; p.rx -= 0.3 * sprintK; p.ry += 0.2 * sprintK;
        p.py -= RAISE_DROP * up; p.rx -= 0.35 * up; p.pz += 0.03 * up;
      }

      // one-shot animation: reset the item effects, run it blended in and out; an interrupted one fades out underneath
      fx.coinY = 0; fx.coinSpin = 0; fx.coinScale = 1; fx.watchLift = 0; fx.itemEat = 0; fx.itemFade = 0; fx.rigY = 0; fx.forearmRoll = 0;
      const clipsR: ClipReq[] = [], clipsL: ClipReq[] = [];
      if (ending) {
        ending.w -= dt / FADE_OUT_S;
        if (ending.w <= 0) ending = null; else { layer(ending.def, ending.t, ending.w, scratchFx); clipsOf(ending.def, ending.t, ending.w, clipsR, clipsL); }
      }
      if (anim) {
        const w = envelope(anim.def, anim.t);
        layer(anim.def, anim.t, w, fx);
        clipsOf(anim.def, anim.t, w, clipsR, clipsL);
        stepAnim(dt);
      }
      // the item's own clips (the phone raised in the left hand, the gun held in both) come in and go out on a damped weight
      holdK = damp(holdK, HOLD_CLIPS[item] ? 1 : 0, 8, dt);
      if (holdK > 0.001) {
        if (holdClips.r) addReq(clipsR, { ...holdClips.r, w: holdK });
        if (holdClips.l) addReq(clipsL, { ...holdClips.l, w: holdK });
      }
      liftWatch(watch, watchOn ? fx.watchLift : 0);
      left.roll = fx.forearmRoll;
      if (arms) {
        arms.drive(right, clipsR); arms.drive(left, clipsL);
        fidget.tick(dt, right, left, item === 'coin');
      }

      // the held item: grows in when raised, a coin follows its tricks, a food is bitten and put away
      heldAge += dt;
      const pop = heldOwned ? Math.max(0.001, outBack(heldAge, 0, 0.22)) : 1;
      if (held) {
        if (item === 'coin') {
          held.position.set(0, fx.coinY, 0);
          held.rotation.set(fx.coinSpin, 0, 0);
          held.scale.setScalar(Math.max(0.001, fx.coinScale * pop));
          held.visible = !fidget.busy;
        } else if (heldOwned) {
          if (fx.itemFade >= 0.999) gone = true;
          held.scale.setScalar(Math.max(0.001, gone ? 0 : pop * (1 - fx.itemFade)));
          const bite = held.userData.bite as Bite | undefined;
          if (bite) bite.pivot.scale.setComponent(bite.axis, 1 - 0.85 * fx.itemEat);
        }
      }
      for (let i = leaving.length - 1; i >= 0; i--) {
        const e = leaving[i];
        e.t += dt;
        if (e.t >= LEAVE_S) dropLeaving(i); else e.obj.scale.setScalar(Math.max(0.001, 1 - smooth(e.t / LEAVE_S)));
      }
      rig.position.set(swayX + bobX, swayY + bobY + fx.rigY, 0);
      if (gun) {
        const recoil = anim?.name === 'recoil' ? Math.exp(-anim.t * 8) * smooth(anim.t * 14) : 0;
        gun.position.set(GUN_HOME.x + swayX + bobX, GUN_HOME.y + swayY + bobY - 0.02 * sprintK - RAISE_DROP * raise.x, GUN_HOME.z + 0.1 * recoil);
        gun.rotation.set(0.12 + 0.3 * recoil, 0.04, 0);
      }
      arms?.step(dt, clock, amp);
      scene.updateMatrixWorld(true);
      if (arms) fidget.place();
    },
    dispose() {
      disposed = true;
      anim?.resolve(); anim = null; ending = null;
      fidget.dispose();
      disposeGeometries(trickCoin);
      releaseItem();
      while (leaving.length) dropLeaving(leaving.length - 1);
      disposeGeometries(watch);
      arms?.dispose(); arms = null;
      for (const m of own) m.dispose();
      scene.clear();
    },
  };
  vm.hold('coin');                                   // the hand starts with a coin (the Q tricks need one)
  copyPose(live.r, base.r); copyPose(live.l, base.l);
  return vm;
}
