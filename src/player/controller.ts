/**
 * FPS body controller (PLAYER). Fixed-step (60 Hz) movement for the local player: smooth acceleration, sprint,
 * crouch (toggle, needs headroom), jump-step, step-up via `CollisionWorld.moveAndSlide`, head-bob phase, footstep
 * events, hole detection ("falling") and the fall-out-of-the-world cut-off. Constants: GDD §8.1 / TECH_SPEC §11.10
 * (the GDD wins over the older §2.14 numbers).
 *
 * `pos` is the FEET position (y = 0 on the floor) — the same convention as remote avatars and net transforms.
 * The collision body centre is `pos + (0, half.y, 0)`. View angles (`yaw`, `pitch`) are render-rate state owned
 * by the player facade; the controller only reads `yaw` to turn WASD into a world direction.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '@/world/types';
import { STEP_UP } from '@/world/collision';
import { approach, clamp, damp, lerp } from '@/core/math';

// ── constants ─────────────────────────────────────────────────────────────────────────────────────
export const WALK_SPEED = 3.0;
export const SPRINT_SPEED = 5.2;
export const CROUCH_SPEED = 1.5;
export const CRAWL_SPEED = 0.8;
export const GHOST_SPEED = 4.5;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const EYE_CRAWL = 0.55;
export const HALF_STAND = new THREE.Vector3(0.3, 0.9, 0.3);
export const HALF_CROUCH = new THREE.Vector3(0.3, 0.6, 0.3);
const ACCEL_GROUND = 30;
const ACCEL_AIR = 9;
const FRICTION = 12;
const GRAVITY = 9.8;
const TERMINAL_FALL = 40;
/** Jump-step: a 0.35 m hop (v = √(2·g·h)). */
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * 0.35);
/** Falling below this y ends the player's world (fade out, stop simulating until `teleport`). */
export const FALL_LIMIT_Y = -12;
/** Airborne over a hole for this long ⇒ `falling`. */
const HOLE_GRACE_S = 0.12;
const LAND_IMPACT = 2.4;
const GHOST_BOUNDS = { x: 33, zMin: -34, zMax: 22, yMin: 0.4, yMax: 7 };

export interface StepInput {
  /** Normalised WASD: x = right − left, z = back − forward. */
  moveX: number; moveZ: number;
  sprint: boolean;
  crouchToggle: boolean;
  jump: boolean;
  /** No locomotion this step (menus, cutscenes, gliding): friction only. */
  frozen: boolean;
  /** Fly (ghost) direction pitch, radians. */
  pitch: number;
}

export interface ControllerEvents {
  /** A foot hit the floor (every bob trough). */
  footstep(speed: number, crouching: boolean): void;
  land(impact: number): void;
  /** Left the floor over a hole (trapdoor): camera fall sequence starts. */
  fallBegin(): void;
  /** y < FALL_LIMIT_Y — fade out. */
  fallOut(): void;
}

type Collision = CollisionWorld & { overlaps?(pos: THREE.Vector3, half: THREE.Vector3): boolean };

export class FpsController {
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;

  crouching = false;
  /** 0 standing … 1 crouched (smoothed eye height driver). */
  crouchK = 0;
  sprinting = false;
  grounded = true;
  falling = false;
  /** Past FALL_LIMIT_Y: simulation stops until `reset`. */
  lost = false;
  ghost = false;
  crawl = false;
  /** × on every speed (PlayerFx.moveSpeed). */
  moveMult = 1;
  /** Smoothed vertical camera offset that hides step-ups / landings (m, negative = camera lower than the body). */
  stepOffset = 0;
  /** Head-bob: stride phase in cycles, amplitude 0..1 (before the settings multiplier). */
  bobPhase = 0;
  bobAmp = 0;
  /** Horizontal speed, m/s. */
  speed = 0;

  private airborne = 0;
  private holeTime = 0;
  private lastStep = 0;
  private readonly body = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly events: ControllerEvents) {}

  get half(): THREE.Vector3 { return this.crouching || this.crawl ? HALF_CROUCH : HALF_STAND; }
  get eyeHeight(): number {
    if (this.crawl) return EYE_CRAWL;
    return lerp(EYE_STAND, EYE_CROUCH, this.crouchK);
  }

  /** Hard-place the body (spawn, teleport, exit glide): no interpolation, no momentum, no fall state. */
  reset(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.grounded = true; this.falling = false; this.lost = false;
    this.airborne = 0; this.holeTime = 0; this.stepOffset = 0; this.speed = 0; this.sprinting = false;
  }

  private headroom(c: Collision): boolean {
    if (!c.overlaps) return true;
    this.probe.set(this.pos.x, this.pos.y + HALF_STAND.y + 0.02, this.pos.z);
    return !c.overlaps(this.probe, HALF_STAND);
  }

  step(dt: number, inp: StepInput, c: Collision | null): void {
    this.prevPos.copy(this.pos);
    this.stepOffset *= Math.exp(-14 * dt);
    if (Math.abs(this.stepOffset) < 1e-4) this.stepOffset = 0;
    if (this.lost) return;

    if (this.ghost) { this.stepGhost(dt, inp); return; }

    // crouch (toggle). Standing back up needs headroom.
    if (inp.crouchToggle && !this.crawl) {
      if (!this.crouching) this.crouching = true;
      else if (!c || this.headroom(c)) this.crouching = false;
    }
    this.crouchK = damp(this.crouchK, this.crouching ? 1 : 0, 12, dt);

    // wish velocity
    const yaw = this.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const len = inp.frozen ? 0 : Math.hypot(inp.moveX, inp.moveZ);
    let wx = 0, wz = 0;
    if (len > 0) {
      const mx = inp.moveX / len, mz = inp.moveZ / len;
      wx = cy * mx + sy * mz;
      wz = cy * mz - sy * mx;
    }
    this.sprinting = len > 0 && inp.sprint && !this.crouching && !this.crawl && inp.moveZ < -0.3 && this.grounded;
    const top = (this.crawl ? CRAWL_SPEED : this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED) * this.moveMult;
    const accel = this.grounded ? ACCEL_GROUND : ACCEL_AIR;
    const v = this.vel;
    if (len > 0 && !this.falling) {
      const tx = wx * top, tz = wz * top;
      const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
      const max = accel * dt;
      if (dl <= max) { v.x = tx; v.z = tz; } else { v.x += (dx / dl) * max; v.z += (dz / dl) * max; }
    } else if (this.grounded) {
      const f = Math.max(0, 1 - FRICTION * dt);
      v.x *= f; v.z *= f;
      if (v.x * v.x + v.z * v.z < 4e-4) { v.x = 0; v.z = 0; }
    } else {
      const f = Math.max(0, 1 - 1.5 * dt);          // gentle air drag; faster in a shaft
      v.x *= f; v.z *= f;
    }
    // very low top speed (carried / crippled) must also cap leftover momentum
    const hs = Math.hypot(v.x, v.z), cap = Math.max(top, 0.01) * 1.25;
    if (hs > cap && this.grounded) { v.x *= cap / hs; v.z *= cap / hs; }

    // vertical
    if (this.grounded && inp.jump && !this.crouching && !this.crawl && !inp.frozen) { v.y = JUMP_SPEED; this.grounded = false; }
    if (!this.grounded) v.y = Math.max(v.y - GRAVITY * dt, -TERMINAL_FALL);
    else v.y = 0;

    if (!c) { this.pos.x += v.x * dt; this.pos.z += v.z * dt; this.speed = Math.hypot(v.x, v.z); this.updateBob(dt); return; }

    // move
    const half = this.half;
    const oldY = this.pos.y, wasGrounded = this.grounded, vyBefore = v.y;
    let dy = v.y * dt;
    if (wasGrounded && v.y <= 0) {
      const floor = c.floorAt(this.pos.x, this.pos.z, this.pos.y);
      if (floor !== null) dy = Math.min(0, floor - this.pos.y);          // stick to the ground over curbs / the dais
    }
    this.body.set(this.pos.x, this.pos.y + half.y, this.pos.z);
    this.delta.set(v.x * dt, dy, v.z * dt);
    const r = c.moveAndSlide(this.body, half, this.delta);
    const newY = this.body.y - half.y;
    this.pos.set(this.body.x, newY, this.body.z);
    if (r.hitX) v.x = 0;
    if (r.hitZ) v.z = 0;
    this.grounded = r.grounded;
    if (v.y > 0 && newY - oldY < dy - 1e-3) v.y = 0;                       // bumped the ceiling

    // step smoothing / landing
    if (this.grounded) {
      const rise = newY - oldY;
      if (wasGrounded && Math.abs(rise) > 1e-3 && Math.abs(rise) <= STEP_UP + 0.05) this.stepOffset -= rise;
      if (!wasGrounded) {
        const impact = -vyBefore;
        if (impact > LAND_IMPACT) { this.stepOffset -= Math.min(0.14, impact * 0.012); this.events.land(impact); }
        this.airborne = 0;
      }
      v.y = 0;
      this.holeTime = 0;
      if (this.falling) this.falling = false;
    } else {
      this.airborne += dt;
      if (!this.falling && newY < oldY - 1e-4 || this.falling) {
        const floor = c.floorAt(this.pos.x, this.pos.z, this.pos.y);
        if (floor === null) {
          this.holeTime += dt;
          if (!this.falling && this.holeTime >= HOLE_GRACE_S && vyBefore < -0.5) { this.falling = true; this.events.fallBegin(); }
        } else this.holeTime = 0;
      }
    }
    if (this.pos.y < FALL_LIMIT_Y && !this.lost) { this.lost = true; this.vel.set(0, 0, 0); this.events.fallOut(); }

    this.speed = Math.hypot(v.x, v.z);
    this.updateBob(dt);
  }

  private updateBob(dt: number): void {
    const moving = this.grounded && this.speed > 0.35 && !this.falling;
    const nominal = this.crawl ? CRAWL_SPEED : this.crouching ? CROUCH_SPEED : WALK_SPEED;
    const target = moving ? clamp(this.speed / nominal, 0, 1.4) * (this.crouching || this.crawl ? 0.55 : 1) : 0;
    this.bobAmp = damp(this.bobAmp, target, moving ? 10 : 7, dt);
    if (this.bobAmp < 0.001) this.bobAmp = 0;
    if (!moving) return;
    const hz = 1.9 * Math.pow(Math.max(this.speed, 0.5) / WALK_SPEED, 0.55);   // stride frequency: 1.9 Hz @ 3 m/s, ≈ 2.6 @ 5.2
    this.bobPhase += hz * dt;
    const s = Math.floor(this.bobPhase * 2 + 0.5);                              // troughs at phase .25 / .75 (one per foot)
    if (s !== this.lastStep) {
      this.lastStep = s;
      if (this.bobAmp > 0.12) this.events.footstep(this.speed, this.crouching);
    }
  }

  /** Ghost spectators fly through everything. */
  private stepGhost(dt: number, inp: StepInput): void {
    const len = inp.frozen ? 0 : Math.hypot(inp.moveX, inp.moveZ);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), cp = Math.cos(inp.pitch), sp = Math.sin(inp.pitch);
    const v = this.vel;
    if (len > 0) {
      const mx = inp.moveX / len, mz = inp.moveZ / len;
      // forward follows the view pitch, strafing stays horizontal
      const fwd = -mz;
      const tx = (cy * mx - sy * cp * fwd) * GHOST_SPEED * (inp.sprint ? 1.8 : 1);
      const tz = (-sy * mx - cy * cp * fwd) * GHOST_SPEED * (inp.sprint ? 1.8 : 1);
      const ty = sp * fwd * GHOST_SPEED * (inp.sprint ? 1.8 : 1);
      v.x = approach(v.x, tx, 14 * dt); v.y = approach(v.y, ty, 14 * dt); v.z = approach(v.z, tz, 14 * dt);
    } else {
      const f = Math.max(0, 1 - 5 * dt);
      v.multiplyScalar(f);
    }
    this.pos.addScaledVector(v, dt);
    this.pos.x = clamp(this.pos.x, -GHOST_BOUNDS.x, GHOST_BOUNDS.x);
    this.pos.z = clamp(this.pos.z, GHOST_BOUNDS.zMin, GHOST_BOUNDS.zMax);
    this.pos.y = clamp(this.pos.y, GHOST_BOUNDS.yMin - 1.5, GHOST_BOUNDS.yMax);
    this.speed = Math.hypot(v.x, v.z);
    this.grounded = false;
    this.bobAmp = 0;
  }
}
