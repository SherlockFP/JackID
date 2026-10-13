/**
 * Remote player avatars (PLAYER). Each remote player is a tinted `kit.mannequin` (Quaternius, 43 clips) with a
 * nameplate sprite, driven by 20 Hz transform samples (`pts`): buffered, rendered ~100 ms in the past and
 * interpolated (short extrapolation on packet loss). Locomotion clip, seated/crouch/ghost looks and positional
 * footsteps follow the `PF` flags + measured speed (flags.ts). Nameplates follow ART_BIBLE §8.3: 128×16 px
 * text sprite 0.38 m above the head, clamped to 8–14 internal px on screen, hidden beyond 18 m or when a wall
 * is in the way (raycast at 5 Hz, faded).
 *
 * Mannequin facing: the GLB looks down +Z while the camera looks down −Z at yaw 0, so the body is rotated
 * by `yaw + π`.
 */
import * as THREE from 'three';
import type { Hex, PlayerId, V3 } from '@/core/types';
import type { Kit, MannequinActor, MannequinClip } from '@/kit/types';
import type { TexGen } from '@/core/texgen/types';
import type { AudioEngine } from '@/core/audio/types';
import type { CollisionWorld } from '@/world/types';
import { app } from '@/core/app';
import { clamp, damp, dampAngle, lerp, lerpAngle } from '@/core/math';
import { log } from '@/core/log';
import { PF } from './flags';
import { SURFACE_SOUND, surfaceForZone, type Surface } from './surface';
import type { AvatarManager, RemoteAvatar } from './types';

const INTERP_MS = 100;
const EXTRAPOLATE_MS = 150;
const MAX_SAMPLES = 16;
const SNAP_DIST = 4;                // a sample jump larger than this is a teleport, never interpolated
const NAME_W = 0.9, NAME_H = (16 / 128) * NAME_W;
const NAME_RANGE = 18;
const OCCLUSION_PERIOD = 0.2;
const FOOTSTEP_RANGE = 16;
const MODEL_HEIGHT = 1.75;
/** At most this many remote mannequins run their mixers; the rest freeze in place (nearest-first). */
const MAX_ANIMATED = 12;

/** Emote id → clip + duration. Unknown ids are ignored. */
const EMOTES: Readonly<Record<string, { clip: MannequinClip; dur: number }>> = {
  wave: { clip: 'Idle_Talking_Loop', dur: 1.6 },
  point: { clip: 'Interact', dur: 1.2 },
  cheer: { clip: 'Dance_Loop', dur: 1.4 },
  shrug: { clip: 'Idle_Talking_Loop', dur: 1.2 },
  dance: { clip: 'Dance_Loop', dur: 4 },
  knock: { clip: 'Punch_Jab', dur: 1.0 },
  boo: { clip: 'Spell_Simple_Shoot', dur: 1.2 },
};

interface Sample { t: number; x: number; y: number; z: number; yaw: number; pitch: number; flags: number }

/** Services the avatars need; the defaults read the `app` singleton at call time. */
export interface AvatarDeps {
  kit: Kit;
  tex: TexGen;
  audio: AudioEngine;
  camera: THREE.Camera;
  /** Current collision world (nameplate occlusion, footstep surface); null = none. */
  collision(): CollisionWorld | null;
  /** Floor theme under (x, z). */
  surfaceAt(x: number, z: number): Surface;
  /** Internal render height in px (nameplate size clamp). */
  lowResHeight(): number;
}

export interface AvatarManagerHost extends AvatarManager {
  /** Add this to the game scene ("players" group). */
  readonly root: THREE.Group;
  dispose(): void;
}

const css = (c: Hex): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

class Avatar implements RemoteAvatar {
  readonly root = new THREE.Group();
  readonly actor: MannequinActor;
  readonly samples: Sample[] = [];
  private readonly plate: THREE.Sprite;
  private plateTex: THREE.Texture | null = null;
  private name = '';
  private color: Hex;
  private clip = '';
  private forced = '';
  private emoteClip = '';
  private emoteLeft = 0;
  private porcelain = 0;
  private legsLost = false;
  // smoothed render state
  private readonly pos = new THREE.Vector3();
  private yaw = 0;
  private speed = 0;
  private flags = 0;
  private placed = false;
  private stride = 0;
  private plateAlpha = 0;
  private opacity = 1;
  private speedK = 1;
  private plateTarget = 1;
  private occTimer = 0;
  private lookTimer = 0;
  private readonly lookAt = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private animated = true;

  constructor(readonly pid: PlayerId, name: string, color: Hex, private readonly d: AvatarDeps) {
    this.color = color;
    this.root.name = `avatar:${pid}`;
    this.root.visible = false;
    this.actor = d.kit.mannequin({ color, height: MODEL_HEIGHT, clip: 'Idle_Loop', stepFps: 15 });
    this.root.add(this.actor.root);
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.plate = new THREE.Sprite(mat);
    this.plate.scale.set(NAME_W, NAME_H, 1);
    this.plate.position.y = 2;
    this.plate.renderOrder = 10;
    this.root.add(this.plate);
    this.setName(name, color);
  }

  setName(name: string, color: Hex): void {
    if (name === this.name && color === this.color && this.plateTex) return;
    this.name = name; this.color = color;
    this.plateTex?.dispose();
    this.plateTex = this.d.tex.text(name.slice(0, 16), { w: 128, h: 16, font: 'ps2p', size: 8, color: css(color), outline: '#000000', align: 'center' });
    const m = this.plate.material;
    m.map = this.plateTex;
    m.needsUpdate = true;
  }

  setPose(clip: MannequinClip | string): void { this.forced = clip === 'auto' ? '' : clip; }

  emote(id: string): void {
    const e = EMOTES[id];
    if (!e) return;
    this.emoteClip = e.clip; this.emoteLeft = e.dur;
  }

  setPorcelain(parts: Array<'eye' | 'ear' | 'mouth' | 'hand' | 'legs'>): void {
    this.porcelain = parts.length;
    this.legsLost = parts.includes('legs');
    // whole-body bone tint grows with every pawned part; five parts = a full porcelain mannequin
    this.actor.setTint(parts.length ? 0xf4eedc : null, Math.min(1, parts.length * 0.2));
  }

  /** Mixer on/off for the animation budget (frozen = pose held, no clip stepping). */
  setAnimated(on: boolean): void {
    if (on === this.animated) return;
    this.animated = on;
    this.actor.setFrozen(!on);
  }

  get shown(): boolean { return this.placed && this.root.visible; }

  distSqTo(p: THREE.Vector3): number { return this.root.position.distanceToSquared(p); }

  push(s: Sample): void {
    const a = this.samples;
    if (a.length && s.t <= a[a.length - 1].t) {
      if (s.t === a[a.length - 1].t) return;
      a.length = 0;                                     // clock went backwards (host reset): start over
    }
    a.push(s);
    if (a.length > MAX_SAMPLES) a.shift();
  }

  /** Advance one render frame. `now` is host time in ms. */
  update(dt: number, now: number): void {
    const a = this.samples;
    if (a.length === 0) return;
    const rt = now - INTERP_MS;
    let x: number, y: number, z: number, yaw: number, pitch: number, flags: number;
    // find the pair around rt
    let i = a.length - 1;
    while (i > 0 && a[i - 1].t > rt) i--;               // a[i-1].t <= rt < a[i].t (when i > 0)
    if (rt >= a[a.length - 1].t) {                      // ahead of the newest sample: extrapolate briefly
      const s = a[a.length - 1];
      const p = a.length > 1 ? a[a.length - 2] : s;
      const span = Math.max(1, s.t - p.t);
      const ex = Math.min(rt - s.t, EXTRAPOLATE_MS), k = ex / span;
      const jump = Math.hypot(s.x - p.x, s.z - p.z) > SNAP_DIST;
      x = s.x + (jump ? 0 : (s.x - p.x) * k); y = s.y + (jump ? 0 : (s.y - p.y) * k); z = s.z + (jump ? 0 : (s.z - p.z) * k);
      yaw = s.yaw; pitch = s.pitch; flags = s.flags;
    } else if (i === 0) {                               // older than everything we have
      const s = a[0];
      x = s.x; y = s.y; z = s.z; yaw = s.yaw; pitch = s.pitch; flags = s.flags;
    } else {
      const s0 = a[i - 1], s1 = a[i];
      const k = clamp((rt - s0.t) / Math.max(1, s1.t - s0.t), 0, 1);
      if (Math.hypot(s1.x - s0.x, s1.z - s0.z) > SNAP_DIST) {
        const s = k < 1 ? s0 : s1;
        x = s.x; y = s.y; z = s.z;
      } else { x = lerp(s0.x, s1.x, k); y = lerp(s0.y, s1.y, k); z = lerp(s0.z, s1.z, k); }
      yaw = lerpAngle(s0.yaw, s1.yaw, k); pitch = lerp(s0.pitch, s1.pitch, k); flags = k < 0.5 ? s0.flags : s1.flags;
    }

    this.flags = flags;
    const first = !this.placed;
    if (first) { this.pos.set(x, y, z); this.yaw = yaw; this.placed = true; this.root.visible = true; }
    const dx = x - this.pos.x, dz = z - this.pos.z;
    this.pos.set(x, y, z);
    if (dt > 0) this.speed = damp(this.speed, Math.hypot(dx, dz) / dt, 14, dt);
    if (first) this.speed = 0;

    const ghost = (flags & PF.GHOST) !== 0;
    const hidden = (flags & PF.HIDDEN) !== 0;
    this.root.visible = !hidden;
    this.root.position.copy(this.pos);
    if (ghost) this.root.position.y += 0.25 + Math.sin(now * 0.003) * 0.06;
    this.yaw = first ? yaw : dampAngle(this.yaw, yaw, 18, dt);
    this.root.rotation.y = this.yaw + Math.PI;
    const opacity = ghost ? 0.5 : 1;
    if (opacity !== this.opacity) { this.opacity = opacity; this.actor.setOpacity(opacity); }

    this.chooseClip(dt);
    this.updateHead(dt, yaw, pitch, ghost);
    this.footsteps(dt);
    this.updatePlate(dt, ghost);
  }

  private chooseClip(dt: number): void {
    let clip: string;
    const f = this.flags;
    const moving = this.speed > 0.25;
    if (this.emoteLeft > 0) { this.emoteLeft -= dt; clip = this.emoteClip; }
    else if (this.forced) clip = this.forced;
    else if (f & PF.FALLING) clip = 'Jump_Loop';
    else if (f & PF.SEATED) clip = f & PF.SIT ? (f & PF.TALK ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop') : (f & PF.TALK ? 'Idle_Talking_Loop' : 'Idle_Loop');
    else if (f & PF.CRAWL || this.legsLost) clip = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
    else if (f & PF.CROUCH) clip = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
    else if (!moving) clip = f & PF.TALK ? 'Idle_Talking_Loop' : 'Idle_Loop';
    else if (this.speed < 1.7) clip = 'Walk_Loop';
    else if (this.speed < 4.2) clip = 'Jog_Fwd_Loop';
    else clip = 'Sprint_Loop';
    if (clip !== this.clip) {
      this.clip = clip;
      void this.actor.play(clip, { fade: 0.2 });
    }
    // roughly match the stride to the ground speed (clip reference speeds, m/s)
    const ref = clip === 'Walk_Loop' ? 1.5 : clip === 'Jog_Fwd_Loop' ? 3.2 : clip === 'Sprint_Loop' ? 5.4 : clip === 'Crouch_Fwd_Loop' ? 1.5 : 0;
    const k = ref > 0 ? clamp(this.speed / ref, 0.6, 1.5) : 1;
    if (Math.abs(k - this.speedK) > 0.05) { this.speedK = k; this.actor.setSpeed(k); }
  }

  private updateHead(dt: number, yaw: number, pitch: number, ghost: boolean): void {
    this.lookTimer -= dt;
    if (this.lookTimer > 0 || ghost) return;
    this.lookTimer = 0.1;
    const cp = Math.cos(pitch);
    this.lookAt.set(this.root.position.x - Math.sin(yaw) * cp * 4, this.root.position.y + 1.6 + Math.sin(pitch) * 4, this.root.position.z - Math.cos(yaw) * cp * 4);
    this.actor.lookAt(this.lookAt, 0.15);
  }

  private footsteps(dt: number): void {
    const f = this.flags;
    if (this.speed < 0.8 || (f & (PF.SEATED | PF.GHOST | PF.FALLING | PF.CARRIED | PF.CRAWL))) { this.stride = 0; return; }
    const step = f & PF.CROUCH ? 0.55 : this.speed > 4.2 ? 1.0 : 0.8;
    this.stride += this.speed * dt;
    if (this.stride < step) return;
    this.stride -= step;
    const cam = this.d.camera.position;
    if (cam.distanceToSquared(this.root.position) > FOOTSTEP_RANGE * FOOTSTEP_RANGE) return;
    const snd = SURFACE_SOUND[this.d.surfaceAt(this.root.position.x, this.root.position.z)];
    this.d.audio.play(snd.name, {
      pos: this.root, vol: 0.5 * snd.vol * (f & PF.CROUCH ? 0.4 : 1), pitch: snd.pitch, param: snd.hardness, priority: 2,
    });
  }

  private updatePlate(dt: number, ghost: boolean): void {
    const cam = this.d.camera;
    const f = this.flags;
    const nameY = (f & PF.CRAWL || this.legsLost) ? 0.95 : f & PF.CROUCH ? 1.55 : (f & PF.SEATED && f & PF.SIT) ? 1.6 : 2.0;
    this.plate.position.y = nameY + (ghost ? 0.25 : 0);
    this.tmp.copy(this.root.position); this.tmp.y += this.plate.position.y;
    const dist = cam.position.distanceTo(this.tmp);
    // occlusion: 5 Hz raycast camera → plate
    this.occTimer -= dt;
    if (this.occTimer <= 0) {
      this.occTimer = OCCLUSION_PERIOD;
      this.plateTarget = 1;
      const col = this.d.collision();
      if (col && dist > 0.5 && dist < NAME_RANGE) {
        const dir = this.dir.copy(this.tmp).sub(cam.position).divideScalar(dist);
        const hit = col.raycast(cam.position, dir, dist - 0.2);
        if (hit) this.plateTarget = 0;
      }
    }
    if (dist > NAME_RANGE || !this.root.visible) this.plateTarget = 0;
    this.plateAlpha = damp(this.plateAlpha, this.plateTarget * (ghost ? 0.5 : 1), 12, dt);
    const mat = this.plate.material;
    mat.opacity = this.plateAlpha;
    this.plate.visible = this.plateAlpha > 0.02;
    if (!this.plate.visible) return;
    // keep the on-screen height within 8–14 internal px
    const cp = cam as THREE.PerspectiveCamera;
    const fov = ((cp.fov ?? 72) * Math.PI) / 180;
    const px = (NAME_H / (2 * Math.max(dist, 0.3) * Math.tan(fov / 2))) * this.d.lowResHeight();
    const k = px < 8 ? 8 / px : px > 14 ? 14 / px : 1;
    this.plate.scale.set(NAME_W * k, NAME_H * k, 1);
  }

  dispose(): void {
    this.actor.dispose();
    this.root.removeFromParent();
    this.plateTex?.dispose();
    this.plate.material.dispose();
    this.samples.length = 0;
  }
}

function defaultDeps(): AvatarDeps {
  return {
    get kit() { return app.kit; },
    get tex() { return app.tex; },
    get audio() { return app.audio; },
    get camera() { return app.camera; },
    collision: () => app.world?.collision ?? null,
    surfaceAt: (x, z) => surfaceForZone(app.world?.zoneAt({ x, y: 0, z }) ?? null),
    lowResHeight: () => app.renderer.lowRes.y,
  };
}

export function createAvatarManager(deps: AvatarDeps = defaultDeps()): AvatarManagerHost {
  const root = new THREE.Group();
  root.name = 'players';
  const avatars = new Map<PlayerId, Avatar>();
  const ranked: Avatar[] = [];
  const camPos = new THREE.Vector3();
  const byDistance = (p: Avatar, q: Avatar): number => p.distSqTo(camPos) - q.distSqTo(camPos);

  /** Animation budget: the nearest shown avatars run (≤ MAX_ANIMATED); everyone else is frozen. */
  const rankAnimated = (): void => {
    camPos.copy(deps.camera.position);
    ranked.length = 0;
    for (const a of avatars.values()) ranked.push(a);
    ranked.sort(byDistance);
    let budget = MAX_ANIMATED;
    for (const a of ranked) {
      const on = a.shown && budget > 0;
      if (on) budget--;
      a.setAnimated(on);
    }
  };

  return {
    root,
    add(pid, name, color) {
      avatars.get(pid)?.dispose();
      const a = new Avatar(pid, name, color, deps);
      avatars.set(pid, a);
      root.add(a.root);
      return a;
    },
    remove(pid) {
      const a = avatars.get(pid);
      if (!a) return;
      a.dispose();
      avatars.delete(pid);
    },
    get: (pid) => avatars.get(pid),
    sample(pid, t, p: V3, yaw, pitch, flags) {
      const a = avatars.get(pid);
      if (!a) { log.debug('avatars', `sample for unknown player ${pid}`); return; }
      a.push({ t, x: p[0], y: p[1], z: p[2], yaw, pitch, flags });
    },
    update(dt, hostTimeMs) {
      for (const a of avatars.values()) a.update(dt, hostTimeMs);
      rankAnimated();
    },
    clear() {
      for (const a of avatars.values()) a.dispose();
      avatars.clear();
    },
    dispose() {
      for (const a of avatars.values()) a.dispose();
      avatars.clear();
      root.removeFromParent();
    },
  };
}
