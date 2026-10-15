/**
 * Local player (PLAYER): the `LocalPlayer` facade over the FPS controller, camera rig and viewmodel.
 * Keep the type re-export below — the spec's import path is `@/player/local`.
 *
 * Who calls what (TD's in-game state):
 *   fixedUpdate(dt)   after `input.beginStep` — movement, footsteps, camera sync for the interaction ray
 *   frame(dt, alpha)  every rendered frame BEFORE `world.frame` — mouselook, glide, bob, shake, viewmodel
 *   render            `renderer.render(scene, app.camera, player.overlay)` draws the hands on top
 *
 * `pos` is the FEET position; the eye is `pos + (0, eyeHeight, 0)` plus bob. Machine seating glides the camera into
 * the play pose (0.60 s inOutCubic) while the body walks to the seat's stand point; standing up glides back out
 * (0.45 s outCubic). Camera shake arrives through `shake(amp, dur)` (FxApi already applied settings.shake).
 */
import * as THREE from 'three';
import type { InstanceId, PlayerId, PlayPose } from '@/core/types';
import type { Action } from '@/core/input/types';
import type { InputExt } from '@/core/input';
import type { PlayerFx } from '@/game/types';
import type { CollisionWorld } from '@/world/types';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { ease } from '@/core/tween';
import { clamp, damp, dampAngle, DEG2RAD, lerp } from '@/core/math';
import { CameraRig, type ShakeOpts } from './camera';
import { FpsController } from './controller';
import { PF } from './flags';
import { SURFACE_SOUND, surfaceForZone, type Surface } from './surface';
import { createViewmodel, GLOVE_IVORY, GLOVE_LEATHER, type ViewmodelHost } from './viewmodel';
import type { CinematicKey, LocalPlayer } from './types';

export type * from './types';
export { PF, playerFlags } from './flags';
export type { ShakeOpts } from './camera';

const PITCH_LIMIT = 85 * DEG2RAD;
const GLIDE_IN_S = 0.6;
const GLIDE_OUT_S = 0.45;
const WALK_SPEED = 2.4, WALK_MIN_S = 0.25, WALK_MAX_S = 2.5;   // walk-up to a seat: m/s, clamped duration
const LOOK_YAW_MAX = 12 * DEG2RAD;
const LOOK_PITCH_MAX = 8 * DEG2RAD;
const LOOK_RETURN_DELAY_S = 0.3;
const GHOST_EYE = 1.2;
const CARRIED_EYE = 1.9;
const SPRINT_FOV_KICK = 4;
const BOB_Y = 0.014;
const BOB_X = 0.006;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** Glove leather for Settings → GLOVES (WAVE69 §8): dark leather by default, the old ivory when off. */
const gloveColour = (leather: boolean) => (leather ? GLOVE_LEATHER : GLOVE_IVORY);

/** Extras for `enterMachine` beyond the frozen signature (all optional). */
export interface SeatOptions {
  /** World position (feet) the body takes: the seat's stand point. */
  stand?: THREE.Vector3;
  /** Body yaw while seated (facing the machine); default: the direction of the play pose. */
  yaw?: number;
  /** The seat is a stool / chair: remote avatars play the Sitting clips. */
  sit?: boolean;
  /** Where the stand-up glide ends (world, feet); default: where the player stood before sitting. */
  exit?: THREE.Vector3;
}

export interface LocalPlayerDeps {
  /** Collision world used for movement; default `app.world?.collision`. */
  collision?(): CollisionWorld | null;
  /** Position + yaw (rad) of the avatar carrying us, in world space; null = unknown. */
  carrier?(pid: PlayerId): { pos: THREE.Vector3; yaw: number } | null;
  /** Floor theme under the feet for footstep sounds; default: zone of `app.world`. */
  surfaceAt?(x: number, z: number): Surface;
  /** 0..1 brightness at a world point (dims the hands); default `world.lightLevelAt` when it exists. */
  lightAt?(p: THREE.Vector3): number;
}

export interface LocalPlayerHost extends LocalPlayer {
  readonly viewmodel: ViewmodelHost;
  /** Pass to `renderer.render(scene, camera, player.overlay)` so the hands draw on top of the world. */
  readonly overlay: { scene: THREE.Scene; camera: THREE.Camera };
  /** `PF.*` bits for the transform message. */
  readonly flags: number;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly grounded: boolean;
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** Eye height above the feet right now (m). */
  readonly eyeHeight: number;
  enterMachine(mid: InstanceId, seat: number, pose: PlayPose, poseMatrix: THREE.Matrix4, o?: SeatOptions): Promise<void>;
  /**
   * Walk-up before a sit: the feet move in a straight line to `to` (no collision on the way; the stand point is in front
   * of the machine), facing `lookAt`. Resolves true on arrival, false when interrupted (cutscene, fall, carried, glide).
   */
  walkTo(to: THREE.Vector3, lookAt: THREE.Vector3): Promise<boolean>;
  /** A walk-up is in progress. */
  readonly walking: boolean;
  shake(amp: number, dur: number, o?: ShakeOpts): void;
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;
  dispose(): void;
}

type Phase = 'free' | 'glideIn' | 'seated' | 'glideOut';

export function createLocalPlayer(camera: THREE.PerspectiveCamera, id: PlayerId = 1, deps: LocalPlayerDeps = {}): LocalPlayerHost {
  const settings = () => app.save.data.settings;
  const collision = (): CollisionWorld | null => deps.collision ? deps.collision() : (app.world?.collision ?? null);
  const surfaceAt = (x: number, z: number): Surface =>
    deps.surfaceAt ? deps.surfaceAt(x, z) : surfaceForZone(app.world?.zoneAt({ x, y: 0, z }) ?? null);

  // ── state ──
  let phase: Phase = 'free';
  let token = 0;                                   // invalidates in-flight glides when a newer transition starts
  let pitch = 0;
  let ghost = false;
  let carriedBy: PlayerId | null = null;
  let cutscene = false;
  let cinematicActive = false;
  let seat: { mid: InstanceId; seat: number } | null = null;
  let seatSit = false;
  let fx: PlayerFx = { vignette: 0, muffle: 0, garble: 0, actionSpeed: 1, moveSpeed: 1, crawl: false };
  let fadedOut = false;
  let fallT = -1;                                   // seconds since the fall sequence began, −1 = not falling
  let inputBefore: 'walk' | 'machine' | 'menu' | 'ui' | 'cutscene' | null = null;
  let sprintK = 0;
  let lightLevel = 1, lightTimer = 0;
  let lookDxFrame = 0, lookDyFrame = 0;

  // seat pose (world)
  const seatPos = new THREE.Vector3(), seatQuat = new THREE.Quaternion();
  let seatFov = 55, seatPick = false;
  let lookYaw = 0, lookPitch = 0, lookIdle = 0;
  const preSeat = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, valid: false };
  const exitPos = new THREE.Vector3();
  let hasExit = false;
  let bodyGlide: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  let bodyYawTarget: number | null = null;
  interface Walk { from: THREE.Vector3; to: THREE.Vector3; yaw: number; t: number; dur: number; resolve: (ok: boolean) => void }
  let walk: Walk | null = null;

  // cinematic
  interface Cin { keys: CinematicKey[]; i: number; t: number; fromPos: THREE.Vector3; fromLook: THREE.Vector3; resolve: () => void }
  let cin: Cin | null = null;
  let afterCinematic: (() => void) | null = null;

  const eyeScratch = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmpQ = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const tmpLook = new THREE.Vector3();

  const rig = new CameraRig(camera);
  const sleeve = new THREE.Color(app.save.data.profile.color).multiplyScalar(0.65).getHex();
  const viewmodel = createViewmodel(sleeve, gloveColour(settings().gloves));
  viewmodel.hold('coin');
  viewmodel.setVisible(settings().viewmodel);

  const ctrl = new FpsController({
    footstep(speed, crouching) {
      const s = SURFACE_SOUND[surfaceAt(ctrl.pos.x, ctrl.pos.z)];
      const loud = crouching ? 0.25 : speed > 4 ? 0.7 : 0.5;
      app.audio.play(s.name, { vol: loud * s.vol, pitch: s.pitch + app.rng.cosmetic.float(-1, 1), param: s.hardness, priority: 3 });
    },
    land(impact) {
      app.audio.play('thud', { vol: clamp(impact / 9, 0.2, 0.9), priority: 4 });
      rig.shake(Math.min(0.012, 0.003 + impact * 0.0006), 0.2);
    },
    fallBegin() {
      fallT = 0;
      rig.shake(0.08, 0.6, { roll: 2.5 });
      app.audio.play('creak', { vol: 0.8 });
    },
    fallOut() {
      void app.ui.fade(1, 0.6, '#101019');
      fadedOut = true;
    },
  });

  const forwardYaw = (from: THREE.Vector3, to: THREE.Vector3): number => Math.atan2(-(to.x - from.x), -(to.z - from.z));

  /** Free-walk eye + orientation into `targetPos` / `targetQuat`. */
  function freeTarget(alpha: number): void {
    if (carriedBy !== null) {
      const c = deps.carrier?.(carriedBy);
      if (c) {
        targetPos.copy(c.pos); targetPos.y += CARRIED_EYE;
        targetPos.x += Math.sin(c.yaw) * 0.25; targetPos.z += Math.cos(c.yaw) * 0.25;   // behind the carrier's head
      } else targetPos.set(ctrl.pos.x, ctrl.pos.y + CARRIED_EYE, ctrl.pos.z);
    } else {
      targetPos.lerpVectors(ctrl.prevPos, ctrl.pos, alpha);
      targetPos.y += (ghost ? GHOST_EYE + Math.sin(rig.time * 2.2) * 0.05 : ctrl.eyeHeight) + ctrl.stepOffset;
    }
    let p = pitch;
    if (fallT >= 0) p = fallPitch(fallT, pitch);
    euler.set(p, ctrl.yaw, 0, 'YXZ');
    targetQuat.setFromEuler(euler);
  }

  /** Victim POV (ART_BIBLE §9.9): look down into the dark, then up at the shrinking square of light. */
  function fallPitch(t: number, base: number): number {
    if (t < 0.15) return base;
    if (t < 0.45) return lerp(base, -60 * DEG2RAD, ease.inOutCubic((t - 0.15) / 0.3));
    if (t < 1.05) return lerp(-60 * DEG2RAD, 70 * DEG2RAD, ease.inOutCubic((t - 0.45) / 0.6));
    return 70 * DEG2RAD;
  }

  function computeSeatPose(pose: PlayPose, poseMatrix: THREE.Matrix4): void {
    seatPos.copy(pose.pos).applyMatrix4(poseMatrix);
    tmpLook.copy(pose.look).applyMatrix4(poseMatrix);
    tmpM.lookAt(seatPos, tmpLook, UP);
    seatQuat.setFromRotationMatrix(tmpM);
    seatFov = pose.fov ?? 55;
    seatPick = pose.mouse === 'pick';
  }

  const inputMode = (): string => app.input.mode;
  /** Tell the input service the camera starts / stops gliding into a seat (it buffers machine presses meanwhile). */
  const seatInput = (on: boolean): void => { (app.input as Partial<InputExt> | null)?.seatTransition?.(on); };

  function walkBlocked(): boolean {
    return phase !== 'free' || cutscene || cinematicActive || carriedBy !== null || fallT >= 0 || ctrl.lost || walk !== null;
  }

  /** Ends the walk-up (resolves its promise). Safe to call when no walk is running. */
  function finishWalk(ok: boolean): void {
    const w = walk;
    if (!w) return;
    walk = null;
    w.resolve(ok);
  }

  /** One fixed step of the walk-up: the body slides to the stand point, the view turns towards the machine. */
  function stepWalk(dt: number): void {
    const w = walk!;
    w.t += dt;
    const k = ease.inOutCubic(clamp(w.t / w.dur, 0, 1));
    ctrl.prevPos.copy(ctrl.pos);
    ctrl.pos.lerpVectors(w.from, w.to, k);
    ctrl.yaw = dampAngle(ctrl.yaw, w.yaw, 12, dt);
    ctrl.speed = 0;
    if (w.t >= w.dur) { ctrl.pos.copy(w.to); finishWalk(true); }
  }

  const player: LocalPlayerHost = {
    id, camera, viewmodel,
    pos: ctrl.pos,
    get yaw() { return ctrl.yaw; },
    set yaw(v: number) { ctrl.yaw = v; },
    get pitch() { return pitch; },
    set pitch(v: number) { pitch = clamp(v, -PITCH_LIMIT, PITCH_LIMIT); },
    get seat() { return seat; },
    get overlay() { return { scene: viewmodel.scene, camera: viewmodel.camera }; },
    get mode() {
      if (cutscene || cinematicActive) return 'cinematic';
      if (phase === 'glideIn' || phase === 'glideOut') return 'gliding';
      if (phase === 'seated') return 'seated';
      if (ghost) return 'ghost';
      if (carriedBy !== null) return 'carried';
      if (fallT >= 0 || ctrl.lost) return 'falling';
      if (ctrl.crawl) return 'crawling';
      return 'walk';
    },
    get flags() {
      let f = 0;
      if (ctrl.crouching) f |= PF.CROUCH;
      if (ctrl.sprinting) f |= PF.SPRINT;
      if (phase !== 'free') { f |= PF.SEATED; if (seatSit) f |= PF.SIT; }
      if (ghost) f |= PF.GHOST;
      if (ctrl.crawl) f |= PF.CRAWL;
      if (carriedBy !== null) f |= PF.CARRIED;
      if (fallT >= 0 || ctrl.lost) f |= PF.FALLING;
      if (cutscene || cinematicActive) f |= PF.HIDDEN;
      return f;
    },
    get crouching() { return ctrl.crouching; },
    get sprinting() { return ctrl.sprinting; },
    get grounded() { return ctrl.grounded; },
    get speed() { return ctrl.speed; },
    get eyeHeight() { return ctrl.eyeHeight; },

    // ── machine seating ───────────────────────────────────────────────────────────────────────────
    async enterMachine(mid, seatIndex, pose, poseMatrix, o) {
      finishWalk(false);
      const my = ++token;
      if (phase === 'free') {
        preSeat.pos.copy(ctrl.pos); preSeat.yaw = ctrl.yaw; preSeat.pitch = pitch; preSeat.valid = true;
      }
      hasExit = !!o?.exit;
      if (o?.exit) exitPos.copy(o.exit);
      seat = { mid, seat: seatIndex };
      seatSit = !!o?.sit;
      computeSeatPose(pose, poseMatrix);
      lookYaw = lookPitch = lookIdle = 0;
      phase = 'glideIn';
      seatInput(true);       // presses made during the ~0.6 s glide are buffered and replayed when the sink attaches
      ctrl.vel.set(0, 0, 0);
      ctrl.crouching = false;
      ctrl.sprinting = false;
      bodyYawTarget = o?.yaw ?? forwardYaw(seatPos, tmpLook);
      bodyGlide = o?.stand ? { from: ctrl.pos.clone(), to: o.stand.clone(), t: 0, dur: GLIDE_IN_S } : null;
      viewmodel.setVisible(false);
      app.ui.prompt(null);
      rig.setTarget(seatPos, seatQuat, seatFov);
      await rig.glide(GLIDE_IN_S, 'inOutCubic');
      if (my !== token) return;
      phase = 'seated';
      seatInput(false);
    },

    async exitMachine() {
      if (phase === 'free' || phase === 'glideOut') return;
      const my = ++token;
      seatInput(false);
      let ex = hasExit ? exitPos : preSeat.pos;
      const col = collision();
      if (col && col.floorAt(ex.x, ex.z, ex.y + 0.5) === null) ex = preSeat.pos;      // never stand up over a hole
      const exY = col ? (col.floorAt(ex.x, ex.z, ex.y + 0.5) ?? ex.y) : ex.y;
      ctrl.reset(ex.x, exY, ex.z);
      if (bodyYawTarget !== null) ctrl.yaw = bodyYawTarget;
      pitch = clamp(preSeat.pitch, -0.35, 0.2);
      bodyGlide = null; bodyYawTarget = null;
      phase = 'glideOut';
      seat = null; seatSit = false; hasExit = false;
      viewmodel.setVisible(settings().viewmodel && !cutscene && !ghost);
      freeTarget(1);
      rig.setTarget(targetPos, targetQuat, settings().fov);
      await rig.glide(GLIDE_OUT_S, 'outCubic');
      if (my !== token) return;
      phase = 'free';
    },

    walkTo(to, lookAt) {
      finishWalk(false);
      if (phase !== 'free' || cutscene || cinematicActive || carriedBy !== null || fallT >= 0 || ctrl.lost || ghost) return Promise.resolve(false);
      const from = ctrl.pos.clone();
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      const dur = clamp(dist / WALK_SPEED, WALK_MIN_S, WALK_MAX_S);
      const yaw = forwardYaw(to, lookAt);
      return new Promise<boolean>((resolve) => { walk = { from, to: to.clone(), yaw, t: 0, dur, resolve }; });
    },

    get walking() { return walk !== null; },

    teleport(p, yawRad) {
      finishWalk(false);
      token++;
      seatInput(false);
      phase = 'free'; seat = null; seatSit = false; bodyGlide = null; bodyYawTarget = null;
      ctrl.reset(p.x, p.y, p.z);
      ctrl.yaw = yawRad; pitch = 0;
      fallT = -1; carriedBy = null;
      rig.fovKick = 0; rig.roll = 0;
      if (fadedOut) { fadedOut = false; void app.ui.fade(0, 0.4, '#101019'); }
      freeTarget(1);
      rig.setTarget(targetPos, targetQuat, settings().fov);
      rig.snap();
      viewmodel.setVisible(settings().viewmodel && !cutscene && !ghost);
    },

    cinematic(keys) {
      if (keys.length === 0) return Promise.resolve();
      cin?.resolve();
      return new Promise<void>((resolve) => {
        camera.getWorldDirection(tmpLook).multiplyScalar(6).add(camera.position);
        cin = { keys, i: 0, t: 0, fromPos: camera.position.clone(), fromLook: tmpLook.clone(), resolve };
        cinematicActive = true;
        viewmodel.setVisible(false);
        afterCinematic = (): void => {
          cinematicActive = false;
          viewmodel.setVisible(settings().viewmodel && phase === 'free' && !cutscene && !ghost);
          void rig.glide(0.35, 'inOutCubic');
          resolve();
        };
      });
    },

    shake(amp, dur, o) { rig.shake(amp, dur, o); },

    setGhost(on) {
      if (ghost === on) return;
      ghost = on;
      ctrl.ghost = on;
      if (on) {
        ctrl.lost = false; ctrl.falling = false; fallT = -1;
        ctrl.pos.y = Math.max(ctrl.pos.y, 1);
        ctrl.prevPos.copy(ctrl.pos);
        ctrl.crouching = false;
        if (fadedOut) { fadedOut = false; void app.ui.fade(0, 0.5, '#101019'); }
      }
      viewmodel.setVisible(!on && settings().viewmodel && phase === 'free' && !cutscene);
    },

    applyFx(next) {
      fx = { ...next };
      ctrl.moveMult = next.moveSpeed;
      ctrl.crawl = next.crawl && !ghost;
      if (ctrl.crawl) ctrl.crouching = false;
      app.renderer.post.vignetteBoost = clamp(next.vignette, 0, 1) * 0.6;
      app.audio.setMuffle(clamp(next.muffle, 0, 1), 0.4);
      viewmodel.setHandLook({ porcelain: next.actionSpeed < 0.999 });
    },

    setCarriedBy(pid) {
      if (pid === carriedBy) return;
      if (pid === null && carriedBy !== null) {
        const c = deps.carrier?.(carriedBy);
        const at = c ? c.pos : ctrl.pos;
        const col = collision();
        const y = col ? (col.floorAt(at.x, at.z, at.y + 0.5) ?? at.y) : at.y;
        ctrl.reset(at.x, y, at.z);
      }
      carriedBy = pid;
      ctrl.vel.set(0, 0, 0);
    },

    setCutscene(on) {
      if (cutscene === on) return;
      cutscene = on;
      rig.suspended = on;
      const input = app.input;
      if (on) {
        if (input.mode !== 'cutscene') inputBefore = input.mode;
        input.setMode('cutscene');
        viewmodel.setVisible(false);
      } else {
        if (input.mode === 'cutscene') input.setMode(inputBefore && inputBefore !== 'cutscene' ? inputBefore : phase === 'free' ? 'walk' : 'machine');
        inputBefore = null;
        viewmodel.setVisible(settings().viewmodel && phase === 'free' && !ghost);
        void rig.glide(0.5, 'inOutCubic');
      }
    },

    // ── update ────────────────────────────────────────────────────────────────────────────────────
    fixedUpdate(dt) {
      if (app.simPaused) return;
      const input = app.input;
      // scripted body glide towards the seat's stand point
      if (bodyGlide) {
        bodyGlide.t += dt;
        const k = ease.inOutCubic(clamp(bodyGlide.t / bodyGlide.dur, 0, 1));
        ctrl.prevPos.copy(ctrl.pos);
        ctrl.pos.lerpVectors(bodyGlide.from, bodyGlide.to, k);
        if (bodyGlide.t >= bodyGlide.dur) bodyGlide = null;
      }
      if (walk && (phase !== 'free' || cutscene || cinematicActive || carriedBy !== null || fallT >= 0 || ctrl.lost || ghost)) finishWalk(false);
      if (phase !== 'free') { ctrl.prevPos.copy(ctrl.pos); ctrl.speed = 0; }
      else if (carriedBy !== null) {
        const c = deps.carrier?.(carriedBy);
        ctrl.prevPos.copy(ctrl.pos);
        if (c) ctrl.pos.copy(c.pos);
        ctrl.speed = 0;
      } else if (cutscene || cinematicActive) {
        ctrl.step(dt, { moveX: 0, moveZ: 0, sprint: false, crouchToggle: false, jump: false, frozen: true, pitch }, collision());
      } else if (walk) {
        stepWalk(dt);
      } else {
        const walking = input.mode === 'walk' && !ctrl.lost && fallT < 0;
        const m = walking ? input.move() : { x: 0, z: 0 };
        ctrl.step(dt, {
          moveX: m.x, moveZ: m.z,
          sprint: walking && input.down('sprint'),
          crouchToggle: walking && input.pressed('crouch'),
          jump: walking && input.pressed('jump' as Action),      // dormant until CORE-INPUT adds the 'jump' action (Space)
          frozen: !walking || phase !== 'free', pitch,
        }, collision());
      }
      sprintK = damp(sprintK, ctrl.sprinting ? 1 : 0, 8, dt);
      // the interaction ray reads the camera, so keep it current between frames
      freeTarget(1);
      if (phase === 'free' && !cutscene && !cinematicActive) {
        camera.position.copy(targetPos);
        camera.quaternion.copy(targetQuat);
      }
    },

    frame(dt, alpha) {
      const input = app.input;
      const s = settings();
      // ── mouse look ──
      const look = input.look();
      lookDxFrame = look.dx; lookDyFrame = look.dy;
      const sens = s.mouseSens, inv = s.invertY ? -1 : 1;
      if (!walkBlocked() && input.mode === 'walk') {
        ctrl.yaw -= look.dx * sens;
        pitch = clamp(pitch - look.dy * sens * inv, -PITCH_LIMIT, PITCH_LIMIT);
      } else if (phase === 'seated' && !seatPick && input.mode === 'machine' && (look.dx !== 0 || look.dy !== 0)) {
        lookYaw = clamp(lookYaw - look.dx * sens * 0.6, -LOOK_YAW_MAX, LOOK_YAW_MAX);
        lookPitch = clamp(lookPitch - look.dy * sens * 0.6 * inv, -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
        lookIdle = 0;
      }
      if (phase === 'seated') {
        lookIdle += dt;
        if (lookIdle > LOOK_RETURN_DELAY_S) { lookYaw = damp(lookYaw, 0, 10, dt); lookPitch = damp(lookPitch, 0, 10, dt); }
      }
      if (bodyYawTarget !== null && phase !== 'free') ctrl.yaw = dampAngle(ctrl.yaw, bodyYawTarget, 10, dt);
      if (ghost && phase === 'free') pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);

      // ── fall sequence / sprint kick ──
      let roll = 0;
      if (fallT >= 0) {
        fallT += dt;
        rig.fovKick = lerp(0, 13, ease.outCubic(clamp(fallT / 0.8, 0, 1)));
        roll = Math.sin(fallT * 6) * 0.04 * clamp(fallT, 0, 1);
      } else if (!ctrl.lost) rig.fovKick = damp(rig.fovKick, SPRINT_FOV_KICK * sprintK, 8, dt);

      // ── head-bob ──
      if (phase === 'free' && !cutscene && fallT < 0 && !ghost && ctrl.bobAmp > 0) {
        const a = ctrl.bobAmp * s.headBob;
        const ph = ctrl.bobPhase * Math.PI * 2;
        rig.bob.set(Math.sin(ph) * BOB_X * a, Math.cos(ph * 2) * BOB_Y * a - BOB_Y * a * 0.5, 0);
        roll += Math.sin(ph) * 0.004 * a;
      } else rig.bob.set(0, 0, 0);
      rig.roll = roll;

      // ── camera target ──
      if (cinematicActive && cin) updateCinematic(dt);
      else if (phase === 'seated' || phase === 'glideIn') {
        targetPos.copy(seatPos);
        targetQuat.copy(seatQuat);
        if (lookYaw !== 0 || lookPitch !== 0) {
          targetQuat.premultiply(tmpQ.setFromAxisAngle(UP, lookYaw)).multiply(tmpQ.setFromAxisAngle(X_AXIS, lookPitch));
        }
        rig.setTarget(targetPos, targetQuat, seatFov);
      } else {
        freeTarget(alpha);
        rig.setTarget(targetPos, targetQuat, s.fov);
      }
      rig.update(dt);

      // ── hands ──
      const eye = camera.position;
      lightTimer -= dt;
      if (lightTimer <= 0) {
        lightTimer = 0.25;
        const w = app.world as (typeof app.world & { lightLevelAt?(p: THREE.Vector3): number }) | null;
        lightLevel = deps.lightAt ? deps.lightAt(eye) : (w?.lightLevelAt?.(eye) ?? 1);
        viewmodel.setLightLevel(0.35 + 0.65 * lightLevel);
      }
      viewmodel.drive({
        bobX: rig.bob.x, bobY: rig.bob.y, sprint: ctrl.sprinting, crouch: ctrl.crouchK, grounded: ctrl.grounded,
        lookDx: lookDxFrame, lookDy: lookDyFrame, aspect: camera.aspect,
      });
      watchTickets();
      viewmodel.update(dt);
    },

    dispose() {
      disposed = true;
      for (const off of unsubs) off();
      finishWalk(false);
      token++;
      seatInput(false);
      cin?.resolve(); cin = null;
      rig.clearShake();
      viewmodel.dispose();
      if (fadedOut) void app.ui.fade(0, 0.2, '#101019');
      app.renderer.post.vignetteBoost = 0;
      app.audio.setMuffle(0, 0.2);
    },
  };

  /** Cinematic keys: ease from the previous key's (pos, look) to this one. Drives the rig directly. */
  function updateCinematic(dt: number): void {
    const c = cin!;
    c.t += dt;
    let key = c.keys[c.i];
    while (c.t >= key.dur) {
      c.t -= key.dur;
      c.fromPos.set(...key.pos);
      c.fromLook.set(...key.look);
      c.i++;
      if (c.i >= c.keys.length) {
        cin = null;
        const done = afterCinematic;
        afterCinematic = null;
        done?.();
        return;
      }
      key = c.keys[c.i];
    }
    const k = ease[key.ease ?? 'inOutCubic'](key.dur > 0 ? c.t / key.dur : 1);
    targetPos.set(...key.pos);
    eyeScratch.copy(c.fromPos).lerp(targetPos, k);
    tmpLook.set(...key.look);
    tmpLook.lerpVectors(c.fromLook, tmpLook, k);
    tmpM.lookAt(eyeScratch, tmpLook, UP);
    targetQuat.setFromRotationMatrix(tmpM);
    rig.setTarget(eyeScratch, targetQuat, settings().fov);
    rig.snap();
  }

  // ── hand reactions and live settings ──────────────────────────────────────────────────────────────
  // Walk mode only: the hands are hidden when seated. `drinking` counts the tonic drinks in flight. The hand holds the
  // bottle while any runs and goes back to the coin after the last one, so the Q coin tricks come back.
  let drinking = 0;
  let ticketsSeen = -1;                             // the run's ticket balance at the last frame; -1 = no run
  let disposed = false;
  const handsAllowed = (): boolean => phase !== 'seated' && phase !== 'glideIn' && !cutscene && !cinematicActive && !ghost;
  const walkHands = (): boolean => settings().viewmodel && player.mode === 'walk';
  /** The run's own id for this player (buff owners are keyed by it; online it may differ from the default `id`). */
  const self = (): PlayerId => app.run?.selfId ?? id;

  /** A tonic was drunk: the bottle comes up to the mouth (`drink`), then the hand is a coin again. */
  function drinkTonic(): void {
    if (!walkHands() || (viewmodel.item !== 'coin' && viewmodel.item !== 'tonic')) return;
    drinking++;
    viewmodel.hold('tonic');
    void viewmodel.play('drink').then(() => {
      drinking--;
      if (!disposed && drinking === 0 && viewmodel.item === 'tonic') viewmodel.hold('coin');
    });
  }

  /** A ticket was received: the card is punched. Gun-holding hands are left alone (the two-handed grip). */
  function punchTicket(): void {
    if (!walkHands() || viewmodel.item === 'gun') return;
    void viewmodel.play('punchCard');
  }

  /** Run.earn('ticket') emits no event, so the balance is read once a frame and a rise is a ticket received. */
  function watchTickets(): void {
    const run = app.run;
    if (!run) { ticketsSeen = -1; return; }
    const now = run.balance('ticket', self());
    if (ticketsSeen >= 0 && now > ticketsSeen) punchTicket();
    ticketsSeen = now;
  }

  const unsubs: Array<() => void> = [
    bus.on('buff:add', ({ owner, buff }) => { if (owner === `p:${self()}` && buff.id.startsWith('tonic.')) drinkTonic(); }),
    bus.on('settings:changed', ({ key }) => {
      if (key === 'gloves') viewmodel.setGloveColor(gloveColour(settings().gloves));
      else if (key === 'viewmodel') viewmodel.setVisible(settings().viewmodel && handsAllowed());
    }),
  ];

  // Body spawns at the origin; the world places it with `teleport`.
  ctrl.reset(0, 0, 0);
  return player;
}
