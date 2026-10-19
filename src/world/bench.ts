/**
 * Bench world (base-machines WP) — `/?bench=<machineId>` (TECH_SPEC §10.4): ONE machine in a 12 × 12 m test room with
 * a debug wallet, a walkable player, the real machine lifecycle (build → init → occupy → release → dispose) and a
 * debug panel (`benchPanel.ts`). It implements the frozen `World` so systems written against `app.world` work, and a
 * private mini collision / interaction / player so the bench has no dependency on the unfinished game layers.
 *
 * Extras that make it a proper test bed
 *  - **Mirror peer**: a second instance of the machine (a spectator, `selfId 2`, not the host) that receives every
 *    event the occupant emits through `MachineNet.sendEvent` → exactly the event-replay path of multiplayer,
 *    with late-join snapshots (`_snapshot` / `_restore`). Walk across the room and watch the same round.
 *  - **Rebuild ×10** leak check (geometries / textures), **snapshot round-trip**, **headless Sim**, luck / payout /
 *    speed / custom-hook sliders and a force-outcome field (all in the panel).
 *
 * Layout: the machine stands at z = −3 facing +Z, the mirror at z = +3 facing −Z, the player spawns between them.
 * Everything here is single-player/offline; real networking is the Session's job.
 */
import * as THREE from 'three';
import type { InstanceId, Json, MachineId, PlayerId, Unsub, Vec3Like } from '@/core/types';
import type { CollisionWorld, Interactable, InteractionSystem, SlotDef, World, WorldItemHandle, WorldLights, WorldProp } from './types';
import type { LocalPlayer, Viewmodel } from '@/player/types';
import type { AnyMachine, MachineContext, MachineDef, MachineNet } from '@/machines/_base/types';
import type { LocalAABB } from '@/core/types';
import type { Input } from '@/core/input/types';
import type { TweenHandle, TweenSystem } from '@/core/tween';
import { app } from '@/core/app';
import { hashSeed } from '@/core/rng';
import { disposeObject3D } from '@/core/dispose';
import { clamp, damp, lerp } from '@/core/math';
import { log } from '@/core/log';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import * as registry from '@/machines/_base/registry';
import { BenchRun } from '@/game/benchRun';
import { openBenchPanel } from './benchPanel';
import { debugForceFor } from '@/core/debugForce';

export const ROOM = 12;                     // m, square
const EYE = 1.62;
const HALF = new THREE.Vector3(0.3, 0.9, 0.3);
const WALK = 3.0, SPRINT = 5.2;
const NOOP_LIGHTS: WorldLights = { setLevel() {}, flicker() {}, pulse() {}, strobe() {}, setDread() {}, setAmbient() {}, reset() {} };
const STUB_VIEWMODEL: Viewmodel = { setVisible() {}, hold() {}, play: () => Promise.resolve(), setHandLook() {}, update() {} };

// ── collision ────────────────────────────────────────────────────────────────────────────────────────
interface CBox { box: THREE.Box3; tag: NonNullable<LocalAABB['tag']>; on: boolean }

/** Linear-scan AABB world (a bench has < 20 boxes). `pos` is the body centre, `half` the half-extents. */
class BenchCollision implements CollisionWorld {
  private boxes = new Map<number, CBox>();
  private next = 1;
  private tmp = new THREE.Box3();

  addStatic(box: THREE.Box3, tag: LocalAABB['tag'] = 'solid'): number {
    const id = this.next++;
    this.boxes.set(id, { box: box.clone(), tag: tag ?? 'solid', on: true });
    return id;
  }
  addLocal(boxes: LocalAABB[], matrix: THREE.Matrix4, tag?: string): number[] {
    return boxes.map((b) => {
      this.tmp.min.set(...b.min); this.tmp.max.set(...b.max);
      return this.addStatic(this.tmp.clone().applyMatrix4(matrix), b.tag ?? (tag as LocalAABB['tag']) ?? 'solid');
    });
  }
  remove(id: number): void { this.boxes.delete(id); }
  setEnabled(id: number, on: boolean): void { const b = this.boxes.get(id); if (b) b.on = on; }

  private overlaps(p: THREE.Vector3, h: THREE.Vector3, b: THREE.Box3): boolean {
    return p.x + h.x > b.min.x && p.x - h.x < b.max.x && p.y + h.y > b.min.y && p.y - h.y < b.max.y && p.z + h.z > b.min.z && p.z - h.z < b.max.z;
  }
  moveAndSlide(pos: THREE.Vector3, half: THREE.Vector3, delta: THREE.Vector3): { grounded: boolean; hitX: boolean; hitZ: boolean } {
    let hitX = false, hitZ = false, grounded = false;
    pos.x += delta.x;
    for (const e of this.boxes.values()) if (e.on && e.tag === 'solid' && this.overlaps(pos, half, e.box)) { hitX = true; pos.x = delta.x > 0 ? e.box.min.x - half.x : e.box.max.x + half.x; }
    pos.z += delta.z;
    for (const e of this.boxes.values()) if (e.on && e.tag === 'solid' && this.overlaps(pos, half, e.box)) { hitZ = true; pos.z = delta.z > 0 ? e.box.min.z - half.z : e.box.max.z + half.z; }
    pos.y += delta.y;
    for (const e of this.boxes.values()) {
      if (!e.on || (e.tag !== 'solid' && e.tag !== 'walkable') || !this.overlaps(pos, half, e.box)) continue;
      if (delta.y <= 0) { pos.y = e.box.max.y + half.y; grounded = true; } else if (e.tag === 'solid') pos.y = e.box.min.y - half.y;
    }
    return { grounded, hitX, hitZ };
  }
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { dist: number; id: number } | null {
    const ray = new THREE.Ray(origin, dir), hit = new THREE.Vector3();
    let best: { dist: number; id: number } | null = null;
    for (const [id, e] of this.boxes) {
      if (!e.on || e.tag !== 'solid' || !ray.intersectBox(e.box, hit)) continue;
      const d = hit.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { dist: d, id };
    }
    return best;
  }
  floorAt(x: number, z: number, fromY: number): number | null {
    let top: number | null = null;
    for (const e of this.boxes.values()) {
      const b = e.box;
      if (!e.on || e.tag === 'low' || x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || b.max.y > fromY + 0.35) continue;
      if (top === null || b.max.y > top) top = b.max.y;
    }
    return top;
  }
}

/** Crosshair ray → nearest enabled `Interactable`, occluded by solid colliders. */
class BenchInteraction implements InteractionSystem {
  focused: Interactable | null = null;
  private items = new Set<Interactable>();
  private ray = new THREE.Ray();
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private hit = new THREE.Vector3();

  add(i: Interactable): () => void { this.items.add(i); return () => { this.items.delete(i); }; }
  update(camera: THREE.Camera, collision: CollisionWorld): void {
    camera.getWorldPosition(this.origin);
    camera.getWorldDirection(this.dir);
    this.ray.set(this.origin, this.dir);
    let best: Interactable | null = null, bestScore = -Infinity;
    for (const i of this.items) {
      if (!i.enabled() || !this.ray.intersectBox(i.box, this.hit)) continue;
      const d = this.hit.distanceTo(this.origin);
      if (d > (i.maxDist ?? 2.2)) continue;
      const wall = collision.raycast(this.origin, this.dir, d);
      if (wall && wall.dist < d - 0.01) continue;
      const score = (i.priority ?? 0) * 1000 - d;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    this.focused = best;
  }
}

// ── player ───────────────────────────────────────────────────────────────────────────────────────────
type PlayerMode = LocalPlayer['mode'];

/**
 * Bench stand-in for the PLAYER WP: WASD + mouse look inside the room, a 0.6 s glide to a machine's play pose and
 * 0.45 s back (TECH §11.10), cursor parallax while seated, camera shake. Implements the frozen `LocalPlayer`, so
 * `fx.shake` and friends work. `pos` is the EYE position.
 */
class BenchPlayer implements LocalPlayer {
  readonly id: PlayerId = 1;
  readonly pos = new THREE.Vector3(0, EYE, 1.5);
  yaw = 0;
  pitch = 0;
  readonly viewmodel = STUB_VIEWMODEL;
  private _mode: PlayerMode = 'walk';
  private _seat: LocalPlayer['seat'] = null;
  private readonly vel = new THREE.Vector3();
  private readonly body = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly seatPos = new THREE.Vector3();
  private readonly seatQuat = new THREE.Quaternion();
  private readonly tmpCam = new THREE.PerspectiveCamera();
  private readonly from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 72 };
  private readonly walkFov: number;
  private seatFov = 55;
  private glide: TweenHandle | null = null;
  private px = 0; private py = 0;                       // smoothed cursor parallax
  private shakeAmp = 0; private shakeLeft = 0; private shakeDur = 1; private shakeT = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly collision: CollisionWorld,
              private readonly input: Input, private readonly ui: TweenSystem) {
    this.walkFov = camera.fov;
    camera.rotation.order = 'YXZ'; // i18n-ok
  }
  get mode(): PlayerMode { return this._mode; }
  get seat(): LocalPlayer['seat'] { return this._seat; }

  /** Fixed step: look + move (walk mode only). */
  fixedUpdate(dt: number): void {
    if (this._mode !== 'walk') return;
    const look = this.input.look();
    const sens = app.save.data.settings.mouseSens, inv = app.save.data.settings.invertY ? -1 : 1;
    this.yaw -= look.dx * sens;
    this.pitch = clamp(this.pitch - look.dy * sens * inv, -1.48, 1.48);
    const mv = this.input.move();
    const speed = this.input.down('sprint') ? SPRINT : WALK;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = (mv.x * c + mv.z * s) * speed, wz = (-mv.x * s + mv.z * c) * speed;
    this.vel.x = damp(this.vel.x, wx, 14, dt);
    this.vel.z = damp(this.vel.z, wz, 14, dt);
    this.body.set(this.pos.x, this.pos.y - 0.72, this.pos.z);
    this.delta.set(this.vel.x * dt, 0, this.vel.z * dt);
    this.collision.moveAndSlide(this.body, HALF, this.delta);
    this.pos.set(this.body.x, EYE, this.body.z);
  }

  /** Render step: write the camera. */
  frame(dt: number): void {
    const cam = this.camera;
    if (this._mode === 'walk') {
      cam.position.copy(this.pos);
      cam.rotation.set(this.pitch, this.yaw, 0);
    } else if (this._mode === 'seated') {
      const n = this.input.pointerNdc;                  // cursor parallax ±6° / ±4°
      this.px = damp(this.px, n.x, 8, dt); this.py = damp(this.py, n.y, 8, dt);
      cam.position.copy(this.seatPos);
      cam.quaternion.copy(this.seatQuat);
      cam.rotateY(-this.px * 0.1);
      cam.rotateX(this.py * 0.07);
    }
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      this.shakeT += dt;
      const e = Math.pow(this.shakeLeft / this.shakeDur, 2) * this.shakeAmp;
      cam.position.x += Math.sin(this.shakeT * 157) * e;
      cam.position.y += Math.sin(this.shakeT * 131 + 1) * e;
      cam.rotateZ(Math.sin(this.shakeT * 97) * e * 0.8);
    }
  }

  private aim(eye: THREE.Vector3, look: THREE.Vector3, out: THREE.Quaternion): void {
    this.tmpCam.position.copy(eye);
    this.tmpCam.up.set(0, 1, 0);
    this.tmpCam.lookAt(look);
    out.copy(this.tmpCam.quaternion);
  }
  private startGlide(dur: number, toPos: THREE.Vector3, toQuat: THREE.Quaternion, toFov: number, ease: 'inOutCubic' | 'outCubic', done: () => void): void {
    const cam = this.camera, f = this.from;
    this.glide?.cancel();
    f.pos.copy(cam.position); f.quat.copy(cam.quaternion); f.fov = cam.fov;
    this.glide = this.ui.run(dur, (k) => {
      cam.position.lerpVectors(f.pos, toPos, k);
      cam.quaternion.slerpQuaternions(f.quat, toQuat, k);
      cam.fov = lerp(f.fov, toFov, k);
      cam.updateProjectionMatrix();
    }, { ease, onDone: done });
  }

  enterMachine(mid: InstanceId, seat: number, pose: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number }, poseMatrix: THREE.Matrix4): Promise<void> {
    this._mode = 'gliding';
    this._seat = { mid, seat };
    this.seatPos.copy(pose.pos).applyMatrix4(poseMatrix);
    const look = pose.look.clone().applyMatrix4(poseMatrix);
    this.aim(this.seatPos, look, this.seatQuat);
    this.seatFov = pose.fov ?? 55;
    this.vel.set(0, 0, 0);
    return new Promise<void>((resolve) => {
      this.startGlide(0.6, this.seatPos, this.seatQuat, this.seatFov, 'inOutCubic', () => { this._mode = 'seated'; this.px = this.py = 0; resolve(); });
    });
  }
  exitMachine(): Promise<void> {
    const eye = new THREE.Vector3(this.pos.x, EYE, this.pos.z), q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')); // i18n-ok
    this._mode = 'gliding';
    return new Promise<void>((resolve) => {
      this.startGlide(0.45, eye, q, this.walkFov, 'outCubic', () => { this._mode = 'walk'; this._seat = null; resolve(); });
    });
  }
  /** Where the player stands up: in front of the machine's interact box (set by the bench before `exitMachine`). */
  standAt(p: THREE.Vector3, yaw: number): void { this.pos.set(p.x, EYE, p.z); this.yaw = yaw; this.pitch = -0.1; }

  teleport(p: THREE.Vector3, yaw: number): void { this.pos.copy(p); this.yaw = yaw; this.vel.set(0, 0, 0); }
  cinematic(): Promise<void> { return Promise.resolve(); }
  shake(amp: number, dur: number): void { this.shakeAmp = Math.max(amp, this.shakeLeft > 0 ? this.shakeAmp : 0); this.shakeLeft = this.shakeDur = Math.max(dur, 0.01); this.shakeT = 0; }
  setGhost(): void {}
  applyFx(): void {}
  setCarriedBy(): void {}
  setCutscene(): void {}
  dispose(): void {
    this.glide?.cancel();
    this.camera.fov = this.walkFov;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'XYZ'; // i18n-ok
  }
}

// ── the bench ────────────────────────────────────────────────────────────────────────────────────────
interface Peer {
  m: AnyMachine;
  group: THREE.Group;
  slot: SlotDef;
  colliders: number[];
  off: Unsub;
}
export interface BenchOpts { machineId: MachineId; seed: number; scene: THREE.Scene }
export interface RebuildReport { ok: boolean; geometries: number; textures: number }

export class Bench {
  readonly root = new THREE.Group();
  readonly run: BenchRun;
  readonly player: BenchPlayer;
  readonly collision = new BenchCollision();
  readonly interact = new BenchInteraction();
  readonly def: MachineDef;
  readonly world: World;
  seed: number;
  main: Peer | null = null;
  mirror: Peer | null = null;
  private seatState: 'free' | 'gliding' | 'seated' = 'free';
  private occ = 0;
  private readonly lights: THREE.PointLight[] = [];
  private readonly anchors = new Map<string, THREE.Object3D>();
  private readonly offs: Unsub[] = [];
  private readonly frameHooks = new Set<(dt: number) => void>();
  private closePanel: () => void = () => {};
  private readonly scene: THREE.Scene;

  constructor(private readonly opts: BenchOpts) {
    const mod = registry.get(opts.machineId);
    if (!mod) throw new Error(`bench: unknown machine "${opts.machineId}" (known: ${registry.ids().join(', ') || 'none'})`);
    this.def = mod.def;
    this.seed = opts.seed;
    this.scene = opts.scene;
    this.run = new BenchRun(opts.seed, app.ui);
    this.player = new BenchPlayer(app.camera, this.collision, app.input, app.tweens.ui);
    this.buildRoom();
    this.world = this.makeWorld();
    this.root.name = 'bench';
    this.scene.add(this.root);
    this.main = this.spawn('BENCH-01', { id: 'BENCH-01', size: this.def.slotSize, pos: [0, 0, -3], rotY: 0, zone: this.def.zone }, false);
    app.input.setMode('walk');

    // click the canvas to capture the mouse (needs a user gesture)
    const onClick = (): void => { if (this.seatState === 'free' && !app.input.locked) void app.input.requestLock(); };
    app.canvas.addEventListener('click', onClick);
    this.offs.push(() => app.canvas.removeEventListener('click', onClick));
    this.closePanel = openBenchPanel(this);
    app.ui.crosshair('dot');
    app.ui.toast(t('common.play', { name: t(`m.${this.def.id}.name`) }), 'sys', 3);
    if (import.meta.env.DEV) {                           // dev console: `jackid.bench.sit()`, `.main.m`, `.setMirror(true)` …
      const dbg = (window as unknown as { jackid?: Record<string, unknown> }).jackid;
      if (dbg) dbg.bench = this;
    }
  }

  // ── room ──
  private buildRoom(): void {
    const kit = app.kit;
    const floorMat = { color: 0x6a5f78, map: kit.tex.checker(0x292131, 0x1d1726, ROOM) };
    const floor = kit.plane(ROOM, ROOM, floorMat, { rot: [-90, 0, 0], shade: false, parent: this.root });
    floor.name = 'floor';
    const wallMat = { color: 0x8a7f98, map: kit.tex.brick(0x4a3a3a) };
    const t0 = 0.4, h = 4;
    const walls: Array<[number, number, number, number, number]> = [   // w, d, x, z
      [ROOM + t0 * 2, t0, 0, -ROOM / 2 - t0 / 2, 0], [ROOM + t0 * 2, t0, 0, ROOM / 2 + t0 / 2, 0],
      [t0, ROOM, -ROOM / 2 - t0 / 2, 0, 0], [t0, ROOM, ROOM / 2 + t0 / 2, 0, 0],
    ];
    for (const [w, d, x, z] of walls) {
      kit.box(w, h, d, wallMat, { pos: [x, h / 2, z], parent: this.root });
      this.collision.addStatic(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2)), 'solid');
    }
    kit.plane(ROOM, ROOM, { color: 0x1a1520 }, { rot: [90, 0, 0], pos: [0, h, 0], shade: false, parent: this.root });
    this.collision.addStatic(new THREE.Box3(new THREE.Vector3(-ROOM, -1, -ROOM), new THREE.Vector3(ROOM, 0, ROOM)), 'walkable');
    // brighter default (DECISIONS C38): reference screenshots must read the machine, not the dark room
    this.root.add(new THREE.HemisphereLight(0xf2f5ff, 0xa08a80, 2.9));
    for (let i = 0; i < 2; i++) {                       // constant light count: machine light anchors drive these
      const l = new THREE.PointLight(0xffe2a0, 0, 4);
      this.lights.push(l);
      this.root.add(l);
    }
  }

  // ── world facade ──
  private makeWorld(): World {
    const self = this;
    const lights = NOOP_LIGHTS;
    return {
      root: this.root,
      get slots(): readonly SlotDef[] { return [self.main, self.mirror].filter((p): p is Peer => !!p).map((p) => p.slot); },
      collision: this.collision,
      interact: this.interact,
      lights,
      items: { spawn: (): WorldItemHandle => { throw new Error('bench world: items are not supported'); }, all: () => [] },
      machine: (id: InstanceId) => [self.main, self.mirror].find((p) => p?.m.id === id)?.m,
      machines: () => [self.main, self.mirror].filter((p): p is Peer => !!p).map((p) => p.m),
      slot: (id: InstanceId) => [self.main, self.mirror].find((p) => p?.slot.id === id)?.slot,
      zoneAt: (_p: Vec3Like) => self.def.zone,
      nearestMachine: (p: Vec3Like, maxDist = 6) => {
        const m = self.main;
        if (!m) return null;
        return Math.hypot(m.group.position.x - p.x, m.group.position.z - p.z) <= maxDist ? m.m : null;
      },
      pads: () => [],
      place: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
      setZoneOpen: () => Promise.resolve(),
      isZoneOpen: () => true,
      prop: <T extends WorldProp = WorldProp>() => null as T | null,
      anchor: (name: string) => self.anchors.get(name) ?? null,
      registerAnchor: (name: string, obj: THREE.Object3D): Unsub => { self.anchors.set(name, obj); return () => { if (self.anchors.get(name) === obj) self.anchors.delete(name); }; },
      fixedUpdate: (dt: number) => self.fixedUpdate(dt),
      frame: (dt: number, t: number) => self.frame(dt, t),
      dispose: () => self.dispose(),
    };
  }

  // ── machines ──
  private makeNet(isMain: boolean): MachineNet {
    const self = this;
    if (isMain) {
      return {
        get selfId() { return app.net.selfId; }, get isHost() { return true; }, get online() { return false; },
        sendEvent: (env) => self.mirror?.m._receive(env),
        sendPrivate: (to, env) => { if (to === 2) self.mirror?.m._receive(env); },
        sendAction: (_mid, seat, rid, a) => { if (self.main?.m instanceof TableBase) self.main.m._receiveAction(app.net.selfId, seat, rid, a); },
        sendNak: () => {},
        requestRelease: (_mid, seat) => self.release(seat),
        announceBot: (_mid, seat, name, level) => { if (self.mirror?.m instanceof TableBase) self.mirror.m._setBot(seat, name, level); },
        playerName: (pid) => (pid === app.net.selfId ? app.save.data.profile.name : pid === 2 ? 'Mirror' : `Bot ${-pid}`),  // i18n-ok
        playerColor: (pid) => (pid === app.net.selfId ? app.save.data.profile.color : 0x63e6de),
        hostTime: () => app.net.hostTime(),
        players: () => (self.mirror ? [app.net.selfId, 2] : [app.net.selfId]),
      };
    }
    return {
      selfId: 2, isHost: false, online: true,
      sendEvent: () => {}, sendPrivate: () => {}, sendAction: () => {}, sendNak: () => {}, requestRelease: () => {}, announceBot: () => {},
      playerName: (pid) => (pid === app.net.selfId ? app.save.data.profile.name : `P${pid}`),
      playerColor: () => 0x63e6de,
      hostTime: () => app.net.hostTime(),
      players: () => [app.net.selfId, 2],
    };
  }

  private spawn(instanceId: InstanceId, slot: SlotDef, mirror: boolean): Peer {
    const mod = registry.get(this.def.id)!;
    const group = new THREE.Group();
    group.name = `slot:${slot.id}`;
    group.position.set(...slot.pos);
    group.rotation.y = THREE.MathUtils.degToRad(slot.rotY);
    this.root.add(group);
    group.updateMatrixWorld(true);
    const ctx: MachineContext = {
      instanceId, def: this.def, slot, kit: app.kit, audio: app.audio, ui: app.ui, input: app.input, events: app.events, run: this.run,
      net: this.makeNet(!mirror), tweens: app.tweens.sim, timers: app.timers.sim, time: app.time, camera: app.camera, fx: app.fx,
      cutscene: app.cutscene, runSeed: this.seed,
    };
    const m = new mod.default(ctx);
    m._build();
    group.add(m.root);
    group.updateMatrixWorld(true);
    const colliders = this.collision.addLocal(m.model.colliders, group.matrixWorld, 'solid');
    let off: Unsub = () => {};
    if (!mirror) {
      const ib = m.model.interact;
      const box = new THREE.Box3(new THREE.Vector3(...ib.min), new THREE.Vector3(...ib.max)).applyMatrix4(group.matrixWorld);
      off = this.interact.add({
        id: instanceId, box, maxDist: this.def.seats > 1 ? 2.8 : 2.2,
        enabled: () => this.seatState === 'free' && this.player.mode === 'walk' && !m.locked,
        label: () => t('common.play', { name: t(`m.${this.def.id}.name`) }),
        sub: () => `${t('common.bet')} ${fmtCoins(this.def.minBet)}–${fmtCoins(this.def.maxBet)}`,
        onInteract: () => { void this.sit(); },
      });
    }
    m.init();
    m.setLocked(false);
    m.visible = true;
    return { m, group, slot, colliders, off };
  }

  private destroy(p: Peer): void {
    p.off();
    for (const id of p.colliders) this.collision.remove(id);
    p.m.dispose();
    p.group.removeFromParent();
  }

  /** Dispose and rebuild the machine(s) from scratch (state resets; wallet and modifiers stay). */
  rebuild(): void {
    this.forceStandUp();
    const hadMirror = !!this.mirror;
    if (this.mirror) { this.destroy(this.mirror); this.mirror = null; }
    if (this.main) this.destroy(this.main);
    this.main = this.spawn('BENCH-01', { id: 'BENCH-01', size: this.def.slotSize, pos: [0, 0, -3], rotY: 0, zone: this.def.zone }, false);
    if (hadMirror) this.setMirror(true);
  }

  /** Rebuild twice-warmed ×`n` and compare GPU object counts (TECH §8 rule 3: within +5 %). */
  rebuildStress(n = 10): RebuildReport {
    this.rebuild();
    const a = app.renderer.info();
    for (let i = 0; i < n; i++) this.rebuild();
    const b = app.renderer.info();
    const geometries = b.geometries - a.geometries, textures = b.textures - a.textures;
    return { ok: geometries <= Math.ceil(a.geometries * 0.05) && textures <= Math.ceil(a.textures * 0.05), geometries, textures };
  }

  /** Reseed the run (`?seed=` equivalent) and rebuild so every RNG stream restarts. */
  reseed(seed: number): void { this.seed = seed >>> 0; this.occ = 0; this.rebuild(); }

  /** Spectator peer on the opposite wall that replays every event the occupant emits. */
  setMirror(on: boolean): void {
    if (!on) { if (this.mirror) { this.destroy(this.mirror); this.mirror = null; } return; }
    if (this.mirror || !this.main) return;
    const mp = this.spawn('BENCH-02', { id: 'BENCH-02', size: this.def.slotSize, pos: [0, 0, 3], rotY: 180, zone: this.def.zone }, true);
    mp.m._restore(JSON.parse(JSON.stringify(this.main.m._snapshot(2))) as ReturnType<AnyMachine['_snapshot']>, app.net.selfId);   // late join
    this.main.m.seats.forEach((pid, seat) => { if (pid !== null) mp.m._occupy(pid, seat, 0, false); });
    this.mirror = mp;
  }

  /** `_snapshot` → JSON → fresh instance → `_restore`; compares the machine state before and after. */
  snapshotRoundTrip(): { ok: boolean; bytes: number } {
    if (!this.main) return { ok: false, bytes: 0 };
    const before = this.main.m._snapshot();
    const json = JSON.stringify(before);
    this.rebuild();
    this.main!.m._restore(JSON.parse(json) as typeof before, app.net.selfId);
    const after = this.main!.m._snapshot();
    return { ok: JSON.stringify(after.s) === JSON.stringify(before.s) && after.r === before.r, bytes: json.length };
  }

  /**
   * QA hook: `window.jackid.bench.force('<machineId>:<state>')` (harness: `--force "<machineId>:<state>"`, after `--sit`).
   * Puts the seated machine into `state` through its handler: the `registerDebugForce` registry (src/core/debugForce.ts)
   * first, else the optional `debugForce(state)` method. Returns what happened; `ok:false` carries a reason.
   */
  force(spec: string): { ok: boolean; via: 'registry' | 'method' | 'none'; reason?: string } {
    const cut = String(spec).indexOf(':');
    const id = cut < 0 ? '' : spec.slice(0, cut).trim(), state = cut < 0 ? '' : spec.slice(cut + 1).trim();
    if (!id || !state) return { ok: false, via: 'none', reason: 'expected "<machineId>:<state>"' };
    if (id !== this.def.id) return { ok: false, via: 'none', reason: `bench machine is "${this.def.id}", not "${id}"` };
    const m = this.main?.m;
    if (!m || this.seatState !== 'seated') return { ok: false, via: 'none', reason: 'the player is not seated' };
    const reg = debugForceFor(id);
    if (reg) return reg(state) === true ? { ok: true, via: 'registry' } : { ok: false, via: 'registry', reason: `the handler refused "${state}"` };
    if (typeof m.debugForce === 'function') { m.debugForce(state); return { ok: true, via: 'method' }; }
    return { ok: false, via: 'none', reason: `"${id}" has no debug force handler` };
  }

  /** Add a mannequin bot to the first free seat of a table (host-side). */
  addBot(): void {
    const m = this.main?.m;
    if (!(m instanceof TableBase)) return;
    const seat = m.seats.findIndex((s) => s === null);
    if (seat >= 0) m.addBot(seat, `Bot ${seat + 1}`);  // i18n-ok
  }

  // ── seating ──
  /**
   * Seats the local player (the same path as the E key). `seat` picks a free seat; omitted = the first free one.
   * Resolves true when seated, so a debug caller (`window.jackid.bench.sit(2)`) can wait on the result.
   */
  async sit(seat?: number): Promise<boolean> {
    const p = this.main;
    if (!p || this.seatState !== 'free') return false;
    const free = p.m.seats.indexOf(null);
    if (seat === undefined) seat = free;
    if (seat < 0 || seat >= p.m.seats.length || p.m.seats[seat] !== null) {
      app.ui.toast(t('common.occupied', { name: '—' }), 'warn');
      return false;
    }
    this.seatState = 'gliding';
    const seed = hashSeed(this.seed, p.m.id, ++this.occ);
    p.m._occupy(app.net.selfId, seat, seed, true);
    this.mirror?.m._occupy(app.net.selfId, seat, seed, false);
    const pose = p.m.model.seats?.[seat]?.pose ?? p.m.model.playPose;
    // stand-up point: 0.9 m in front of the machine, facing it
    const front = new THREE.Vector3(0, 0, 0.9 + (p.m.model.interact.max[2] ?? 0.5)).applyMatrix4(p.group.matrixWorld);
    this.player.standAt(front, THREE.MathUtils.degToRad(p.slot.rotY));   // face the machine
    app.input.exitLock();
    app.ui.prompt(null);
    await this.player.enterMachine(p.m.id, seat, pose, p.group.matrixWorld);
    if (this.seatState === 'gliding') {
      app.input.setMachineSink(p.m.sink);
      app.input.setMode('machine');
      this.seatState = 'seated';
    }
    return this.seatState === 'seated';
  }

  /** `MachineNet.requestRelease` target: the host grants immediately (single player). */
  private release(seat: number): void {
    const p = this.main;
    if (!p || p.m.seats[seat] !== app.net.selfId || this.seatState === 'free') return;
    p.m._release(app.net.selfId, seat, true);
    this.mirror?.m._release(app.net.selfId, seat, false);
    app.input.setMachineSink(null);
    app.input.setMode('walk');
    this.seatState = 'free';
    void this.player.exitMachine();
  }
  private forceStandUp(): void {
    if (this.seatState === 'free' || !this.main) return;
    const seat = this.main.m.localSeat;
    this.seatState = 'seated';
    if (seat >= 0) this.release(seat);
    else { app.input.setMachineSink(null); app.input.setMode('walk'); this.seatState = 'free'; }
  }

  // ── loop ──
  fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
    this.interact.update(app.camera, this.collision);
    const f = this.interact.focused;
    if (this.seatState === 'free' && this.player.mode === 'walk') {
      app.ui.prompt(f ? { action: 'interact', label: f.label(), sub: f.sub?.() } : null);
      if (f && app.input.pressed('interact')) f.onInteract();
    }
    this.main?.m._step(dt);
    this.mirror?.m._step(dt);
  }

  /** Render-rate hook (the debug panel samples its stats here). */
  onFrame(fn: (dt: number) => void): Unsub {
    this.frameHooks.add(fn);
    return () => { this.frameHooks.delete(fn); };
  }

  frame(dt: number, _t: number): void {
    this.player.frame(dt);
    app.audio.setListener(app.camera);
    const time = app.time.sim;
    this.main?.m._frame(dt, time);
    this.mirror?.m._frame(dt, time);
    this.syncLights();
    for (const fn of this.frameHooks) fn(dt);
  }

  /** Two constant point lights follow the first machine's `light` / `light2` anchors (ART §1: no lights in machines). */
  private syncLights(): void {
    const p = this.main;
    const names = ['light', 'light2'];
    for (let i = 0; i < this.lights.length; i++) {
      const a = p?.m.model.anchors[names[i]];
      const l = this.lights[i];
      if (!a) { l.intensity = 0; continue; }
      const u = a.userData as { color?: number; intensity?: number; range?: number };
      a.getWorldPosition(l.position);
      l.color.setHex(u.color ?? 0xffe2a0);
      l.intensity = (u.intensity ?? 0.6) * 2.6;
      l.distance = u.range ?? 3;
    }
  }

  dispose(): void {
    this.closePanel();
    for (const o of this.offs.splice(0)) o();
    this.forceStandUp();
    if (this.mirror) this.destroy(this.mirror);
    if (this.main) this.destroy(this.main);
    this.mirror = this.main = null;
    app.ui.prompt(null);
    app.ui.machineHud(null);
    app.input.setMachineSink(null);
    this.player.dispose();
    const dbg = (window as unknown as { jackid?: Record<string, unknown> }).jackid;
    if (dbg?.bench === this) delete dbg.bench;
    this.root.removeFromParent();
    disposeObject3D(this.root, { skipShared: true });
    log.info('bench', `${this.def.id} disposed`);
  }

  get occupantSeat(): number { return this.main?.m.localSeat ?? -1; }
  get seated(): boolean { return this.seatState !== 'free'; }
  /** JSON-safe machine snapshot (panel "copy"). */
  snapshotJson(): Json { return this.main ? (this.main.m._snapshot() as unknown as Json) : null; }
}

export function createBench(opts: BenchOpts): Bench {
  return new Bench(opts);
}
