/**
 * THE HOLLOW DOOR (TR: Oyuk Kapı), world side. A secret portal, once per run:
 *
 *   reveal  (a) the crack: knock (E) three times within 4 s on the cracked plate in the Sump, during Last Call of a Watch
 *               from Night 2 · (b) the 3:33 phone call (the integrator calls `revealHollow('phone333')`) ·
 *               (c) the red seam (the integrator calls `revealHollow('seam')` when the pocket is 0 and the loan is refused)
 *   open    a doorway is up for OPEN_S seconds. Walk through it (the seam), or press E (the crack, and the seam too)
 *   inside  THE UNDERNEATH: the void room (underneath.ts). E on a Lord picks him (`hollow:lord`); then the lordstable duel
 *           runs on the table and reports back with `resolve('won' | 'taken')`
 *   spent   the door is gone for the run. Climbing back out without a duel is allowed once; a won duel leaves the same way
 *
 * Events (declared below): `hollow:reveal`, `hollow:enter`, `hollow:lord`, `hollow:result`, `hollow:exit`.
 * The world builds this from `level.ts` (`buildHollow`); the integrator uses `revealHollow` and `hollowDoor()`.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import { app } from '@/core/app';
import { bindHollowDoorLink } from '@/core/hollowDoorLink';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { createRng, type Rng } from '@/core/rng';
import type { CollisionWorld, Interactable, InteractionSystem } from '../types';
import type { LightHint } from '../sys/arch';
import { buildDoorway, type Doorway } from './doorway';
import { buildUnderneath, type Underneath } from './underneath';
import type { LordReaction } from './lords';
import {
  ARRIVE, CRACK_DOOR, CRACK_RETURN, DOOR_H, DOOR_W, EXIT_DOOR, KNOCKS, KNOCK_WINDOW_S, LORD_IDS, LORD_POS, OPEN_S,
  SEAM_AHEAD_M, SPLIT_CALM_S, SPLIT_S, type HollowExit, type HollowPhase, type HollowReason, type LordId,
} from './config';

export { ARRIVE, CRACK_DOOR, EXIT_DOOR, HOLLOW_HOME, HOLLOW_TABLE_SLOT, LORD_IDS, LORD_POS, TABLE_POS } from './config';
export type { HollowExit, HollowPhase, HollowReason, LordId } from './config';
export type { LordReaction } from './lords';

declare module '@/core/events' {
  interface GameEvents {
    /** The door opened (a doorway is up). */
    'hollow:reveal': { reason: HollowReason };
    /** The player walked into THE UNDERNEATH. */
    'hollow:enter': { reason: HollowReason };
    /** The player sat with a Lord; the table is set. */
    'hollow:lord': { lord: LordId };
    /** The duel ended. `forgiveNights` is the quota relief the run applies (0 when taken). */
    'hollow:result': { lord: LordId; outcome: 'won' | 'taken'; forgiveNights: number };
    /** The player is back in the pit ('left' or 'resolved'), or the reveal timed out ('missed'). */
    'hollow:exit': { via: HollowExit };
  }
}

/** Quota relief for a won duel: Ash and Mirrors forgive this Night, Ledgers this Night and the next. */
export const FORGIVE_NIGHTS: Record<LordId, number> = { ash: 1, ledgers: 2, mirrors: 1 };

/** Fog and ambient for THE UNDERNEATH (GDD §8.7 style). The room is closed, so this is data for the atmosphere pass. */
export const HOLLOW_LOOK = { fog: { color: 0x030103, near: 2, far: 14 }, ambient: 0x140a0a } as const;

// ── tiny helpers ──────────────────────────────────────────────────────────────────────────────────
const calm = (): boolean => { try { return !!app.save.data.settings.calm; } catch { return false; } };
const sfx = (name: string, o: { vol?: number; pitch?: number; pos?: THREE.Vector3; pri?: number } = {}): void => {
  try { app.audio.play(name, { vol: o.vol, pitch: o.pitch, pos: o.pos, priority: o.pri ?? 6 }); } catch { /* audio is optional */ }
};
const toast = (key: string, kind: 'info' | 'warn' = 'warn'): void => {
  try { app.ui.toast(t(key), kind, 3.5); } catch { /* UI optional */ }
};
const approach = (v: number, to: number, step: number): number => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
/** The ambience bed of a floor point: the Sump under the pit floor, the lift, the parlour, else the casino floor. */
function ambienceAt(p: THREE.Vector3): string {
  if (p.y < -5) return 'sump';
  let zone: string | null = null;
  try { zone = app.world?.zoneAt({ x: p.x, y: p.y, z: p.z }) ?? null; } catch { /* world optional */ }
  if (zone === 'lift') return 'elevator';
  if (zone === 'parlour') return 'parlour';
  return 'pit';
}

/** World-space AABB of a door-local rectangle: lx ∈ [a, b], lz ∈ [c, d], height y0…y1, for a door at (x, y, z) facing `yaw`. */
function localBox(x: number, y: number, z: number, yaw: number, a: number, b: number, c: number, d: number, y0: number, y1: number): THREE.Box3 {
  const s = Math.sin(yaw), co = Math.cos(yaw);
  const box = new THREE.Box3();
  for (const lx of [a, b]) for (const lz of [c, d]) {
    const wx = x + lx * co + lz * s, wz = z - lx * s + lz * co;
    box.expandByPoint(new THREE.Vector3(wx, y + y0, wz));
    box.expandByPoint(new THREE.Vector3(wx, y + y1, wz));
  }
  return box;
}

interface Pose { x: number; y: number; z: number; yaw: number }
/** A doorway as the controller tracks it. `owned` doorways are built for one reveal and disposed when they go. */
interface DoorRec extends Pose { mesh: Doorway; walk: boolean; owned: boolean; split: number; to: number }

// ── the controller ────────────────────────────────────────────────────────────────────────────────
export class HollowDoor {
  phase: HollowPhase = 'sealed';
  reason: HollowReason | null = null;
  /** The Lord the player sat with (null until chosen). */
  lord: LordId | null = null;

  private door: DoorRec | null = null;
  /** The crack plate's leaves (the crack is never dismantled, only shut again). */
  private crackSplit = 0;
  private crackTo = 0;
  private timer = 0;
  private clock = 0;
  private knocks: number[] = [];
  private shake = 0;
  private ret: { pos: THREE.Vector3; yaw: number } | null = null;
  private colliderIds: number[] = [];
  private transient: Array<() => void> = [];
  private knockOff: (() => void) | null = null;
  private prevLz = NaN;
  private whisperT = 6;
  private readonly crackPos = new THREE.Vector3(CRACK_DOOR[0], CRACK_DOOR[1], CRACK_DOOR[2]);
  private readonly seamLeaves: THREE.Material;
  /** Bus subscriptions (the run opens the door: `hollow:open`). */
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly o: {
    kit: KitX; root: THREE.Group; crack: Doorway; under: Underneath;
    interact: InteractionSystem | null; collision: CollisionWorld | null; rng: Rng;
  }) {
    this.seamLeaves = o.kit.mat({ color: 0x3a0606 });
    o.crack.setSplit(0);
    if (o.interact) {
      const box = new THREE.Box3(
        new THREE.Vector3(CRACK_DOOR[0] - 0.8, CRACK_DOOR[1], CRACK_DOOR[2]),
        new THREE.Vector3(CRACK_DOOR[0] + 0.8, CRACK_DOOR[1] + 2.4, CRACK_DOOR[2] + 1.0),
      );
      this.knockOff = o.interact.add({
        id: 'hollow:knock', box, maxDist: 2.2, priority: 2,
        enabled: () => this.phase === 'sealed' && this.knockOpen(),
        label: () => t('hollow.knock'),
        sub: () => t('hollow.knock.sub', { n: this.liveKnocks() }),
        onInteract: () => this.knock(),
      });
    }
    // the run decides when the door opens (triggers, once per run); the world only builds the doorway
    this.unsubs.push(bus.on('hollow:open', ({ reason }) => { this.reveal(reason); }));
  }

  /** True while the crack can be knocked: Night 2 or later, during Last Call of a Watch. */
  knockOpen(): boolean {
    const run = app.run;
    if (!run) return false;
    try { return run.night() >= 2 && run.window() === 'watch' && run.shift.phase === 'lastCall'; } catch { return false; }
  }

  /** Opens the door. False when it was already revealed this run, or there is no player to open a seam for. */
  reveal(reason: HollowReason): boolean {
    if (this.phase !== 'sealed') return false;
    const p = app.player;
    let rec: DoorRec;
    if (reason === 'crack') {
      rec = { mesh: this.o.crack, x: CRACK_DOOR[0], y: CRACK_DOOR[1], z: CRACK_DOOR[2], yaw: 0, walk: false, owned: false, split: 0, to: 1 };
      this.crackTo = 1;
      this.ret = { pos: new THREE.Vector3(CRACK_RETURN[0], CRACK_RETURN[1], CRACK_RETURN[2]), yaw: 0 };
    } else {
      if (!p) return false;
      const yaw = p.yaw;
      const x = p.pos.x - Math.sin(yaw) * SEAM_AHEAD_M, z = p.pos.z - Math.cos(yaw) * SEAM_AHEAD_M, y = p.pos.y;
      const mesh = buildDoorway(this.o.kit, { leaves: this.seamLeaves, frame: 0x14080a, rim: 0xff1a1a });
      mesh.root.position.set(x, y, z);
      mesh.root.rotation.y = yaw;
      mesh.setSplit(0);
      this.o.root.add(mesh.root);
      rec = { mesh, x, y, z, yaw, walk: true, owned: true, split: 0, to: 1 };
      this.ret = { pos: p.pos.clone(), yaw };
      this.addColliders(rec);
    }
    this.door = rec;
    this.reason = reason;
    this.phase = 'open';
    this.timer = OPEN_S[reason];
    this.prevLz = NaN;
    this.addStep(rec);
    sfx(reason === 'crack' ? 'doorCreak' : 'whoosh', { vol: 0.9, pos: new THREE.Vector3(rec.x, rec.y + 1, rec.z), pri: 8 });
    toast(reason === 'crack' ? 'hollow.toast.crack' : reason === 'seam' ? 'hollow.toast.seam' : 'hollow.toast.phone');
    bus.emit('hollow:reveal', { reason });
    return true;
  }

  /** Walks the player down into THE UNDERNEATH. Only from an open door. */
  enter(): boolean {
    const reason = this.reason;
    if (this.phase !== 'open' || !reason) return false;
    const p = app.player;
    if (!p) return false;
    this.phase = 'inside';
    this.prevLz = NaN;
    this.clearTransient();
    this.dropColliders();
    p.teleport(new THREE.Vector3(ARRIVE[0], ARRIVE[1], ARRIVE[2]), 0);
    this.whisperT = 3;
    try { app.audio.ambience('void', 2.5); } catch { /* audio optional */ }
    for (const id of LORD_IDS) {
      const at = LORD_POS[id];
      this.addTransient({
        id: `hollow:lord:${id}`,
        box: new THREE.Box3(new THREE.Vector3(at[0] - 0.9, at[1], at[2] - 0.9), new THREE.Vector3(at[0] + 0.9, at[1] + 2.8, at[2] + 0.9)),
        maxDist: 3.0, priority: 4,
        enabled: () => this.phase === 'inside' && this.lord === null,
        label: () => t(`hollow.lord.${id}`),
        sub: () => t('hollow.lord.sub'),
        onInteract: () => this.choose(id),
      });
    }
    this.addTransient({
      id: 'hollow:climb',
      box: localBox(EXIT_DOOR[0], EXIT_DOOR[1], EXIT_DOOR[2], Math.PI, -0.8, 0.8, 0.0, 1.2, 0, DOOR_H + 0.2),
      maxDist: 2.4, priority: 5,
      enabled: () => this.phase === 'inside' && this.lord === null,
      label: () => t('hollow.climb'),
      sub: () => t('hollow.climb.sub'),
      onInteract: () => this.finish('left', true),
    });
    sfx('trapdoor', { vol: 0.8, pri: 8 });
    app.run?.hollowEnter();
    bus.emit('hollow:enter', { reason });
    return true;
  }

  /** Sits with a Lord. Once per run: the other two stations close. */
  choose(lord: LordId): boolean {
    if (this.phase !== 'inside' || this.lord) return false;
    this.lord = lord;
    this.clearTransient();
    try { app.ui.toast(t('hollow.lord.chosen', { name: t(`hollow.name.${lord}`) }), 'warn', 3.5); } catch { /* UI optional */ }
    app.run?.hollowPick(lord);
    bus.emit('hollow:lord', { lord });
    return true;
  }

  /**
   * The duel's outcome, from the lordstable machine. `won`: the Lord's pull fired; the run gets FORGIVE_NIGHTS[lord] and the
   * player walks back up. `taken`: the run ends below; the door stays sealed and the player does not move.
   */
  resolve(outcome: 'won' | 'taken'): boolean {
    const lord = this.lord;
    if (this.phase !== 'inside' || !lord) return false;
    this.lordReact(outcome === 'won' ? 'shot' : 'taken');
    bus.emit('hollow:result', { lord, outcome, forgiveNights: outcome === 'won' ? FORGIVE_NIGHTS[lord] : 0 });
    this.finish('resolved', outcome === 'won');
    return true;
  }

  /** Presentation hook for the duel: a pull (the Lord looks at the player), a shot, or a taken run. Chosen Lord only, once chosen. */
  lordReact(kind: LordReaction): void {
    const p = app.player?.pos ?? null;
    for (const l of this.o.under.lords) if (!this.lord || l.id === this.lord) l.react(kind, p);
  }

  /** Per frame. */
  update(dt: number): void {
    this.clock += dt;
    const c = calm();
    const step = dt / (c ? SPLIT_CALM_S : SPLIT_S);
    this.crackSplit = approach(this.crackSplit, this.crackTo, step);
    this.o.crack.setSplit(this.crackSplit);
    if (this.door?.owned) {
      this.door.split = approach(this.door.split, this.door.to, step);
      this.door.mesh.setSplit(this.door.split);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    this.o.crack.root.position.set(CRACK_DOOR[0], CRACK_DOOR[1], CRACK_DOOR[2] + (this.shake > 0 ? 0.03 * Math.sin(this.shake * 90) : 0));
    const p = app.player?.pos ?? null;
    if (this.phase === 'sealed') {
      this.crackWhisper(dt, p, c);
    } else if (this.phase === 'open') {
      this.timer -= dt;
      if (this.timer <= 0) { this.finish('missed', false); return; }
      if (this.door?.walk && p && this.crossed(p, this.door)) this.enter();
    } else if (this.phase === 'inside') {
      if (p && !this.lord && this.crossed(p, { x: EXIT_DOOR[0], y: EXIT_DOOR[1], z: EXIT_DOOR[2], yaw: Math.PI })) this.finish('left', true);
      this.roomWhispers(dt, c);
      this.o.under.update(dt, p, c);
    }
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.clearTransient();
    this.dropColliders();
    this.knockOff?.();
    this.knockOff = null;
    this.dismantle();
    this.seamLeaves.dispose();
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────
  private liveKnocks(): number {
    return this.knocks.filter((k) => this.clock - k <= KNOCK_WINDOW_S).length;
  }

  private knock(): void {
    if (this.phase !== 'sealed') return;
    this.knocks.push(this.clock);
    if (this.knocks.length > KNOCKS) this.knocks.shift();
    this.shake = 0.18;
    sfx('thud', { vol: 0.7, pitch: -4, pri: 6, pos: this.crackPos });
    if (this.knocks.length === KNOCKS && this.clock - this.knocks[0] <= KNOCK_WINDOW_S) {
      this.knocks = [];
      app.run?.hollowTrigger('knock');   // the run decides (once per run); it opens the crack through `hollow:open`
    }
  }

  /** A whisper near the plate while the crack is knockable (calm: rarer). */
  private crackWhisper(dt: number, p: THREE.Vector3 | null, c: boolean): void {
    if (!p || !this.knockOpen() || p.distanceTo(this.crackPos) > 5) return;
    this.whisperT -= dt;
    if (this.whisperT > 0) return;
    sfx('whisper', { vol: 0.5, pos: this.crackPos, pri: 3 });
    this.whisperT = c ? 24 : 14 + this.o.rng.float(0, 8);
  }

  /** Whispers from the Lords while the player is down there (calm: rarer). */
  private roomWhispers(dt: number, c: boolean): void {
    this.whisperT -= dt;
    if (this.whisperT > 0) return;
    const lords = this.o.under.lords;
    const l = lords[this.o.rng.int(0, lords.length - 1)];
    sfx(this.o.rng.chance(0.5) ? 'whisper' : 'whispers', { vol: 0.45, pos: l.eye, pri: 3 });
    this.whisperT = c ? 12 + this.o.rng.float(0, 6) : 6 + this.o.rng.float(0, 6);
  }

  /** Crossing test for a doorway: the player moves from its front (lz > 0) to its back (lz ≤ 0) through the opening. */
  private crossed(p: THREE.Vector3, d: Pose): boolean {
    const dx = p.x - d.x, dz = p.z - d.z;
    const s = Math.sin(d.yaw), co = Math.cos(d.yaw);
    const lz = dx * s + dz * co;
    const lx = dx * co - dz * s;
    const prev = this.prevLz;
    this.prevLz = lz;
    return !Number.isNaN(prev) && prev > 0 && lz <= 0 && Math.abs(lx) < DOOR_W / 2 && p.y > d.y - 0.5 && p.y < d.y + DOOR_H + 0.4;
  }

  private addStep(d: DoorRec): void {
    this.addTransient({
      id: 'hollow:step',
      box: localBox(d.x, d.y, d.z, d.yaw, -0.8, 0.8, 0.0, 1.0, -0.2, DOOR_H + 0.1),
      maxDist: 2.4, priority: 5,
      enabled: () => this.phase === 'open',
      label: () => t('hollow.step'),
      sub: () => t('hollow.step.sub'),
      onInteract: () => { this.enter(); },
    });
  }

  /** Two frame posts block the gap in the pit; they are removed when the door goes. */
  private addColliders(d: DoorRec): void {
    const col = this.o.collision;
    if (!col) return;
    const fh = DOOR_H + 0.25, px = DOOR_W / 2 + 0.07;
    for (const sx of [-px, px]) {
      this.colliderIds.push(col.addStatic(localBox(d.x, d.y, d.z, d.yaw, sx - 0.12, sx + 0.12, -0.14, 0.14, 0, fh), 'solid'));
    }
  }

  private dropColliders(): void {
    const col = this.o.collision;
    for (const id of this.colliderIds.splice(0)) col?.remove(id);
  }

  private addTransient(i: Interactable): void {
    const off = this.o.interact?.add(i);
    if (off) this.transient.push(off);
  }

  private clearTransient(): void {
    for (const off of this.transient.splice(0)) off();
  }

  /**
   * Ends the door. `teleport` moves a player who is below back to where they came from; the duel's `taken` passes false so
   * the run ends where the player stands.
   */
  private finish(via: HollowExit, teleport: boolean): void {
    if (this.phase === 'spent') return;
    const wasInside = this.phase === 'inside';
    this.phase = 'spent';
    this.clearTransient();
    this.dropColliders();
    this.prevLz = NaN;
    const p = app.player;
    // the void bed plays only down here: a player who climbs back gets the bed of the floor they return to. A taken run
    // stays in the void (no teleport), so its bed is left alone; a seam that times out above never changed the bed.
    const back = wasInside && teleport && p && this.ret ? this.ret : null;
    if (back && p) p.teleport(back.pos.clone(), back.yaw);
    this.dismantle();
    if (back) { try { app.audio.ambience(ambienceAt(back.pos), 2); } catch { /* audio optional */ } }
    if (via === 'missed') toast('hollow.toast.missed', 'info');
    if (via === 'left') toast('hollow.toast.left', 'info');
    if (via !== 'resolved') app.run?.hollowLeave();   // the duel's end is the run's own (`hollowFinish`, from the table)
    bus.emit('hollow:exit', { via });
  }

  /** A seam is a loose doorway and goes away. The crack is the wall plate, which shuts again. */
  private dismantle(): void {
    if (this.door?.owned) {
      this.o.root.remove(this.door.mesh.root);
      this.door.mesh.dispose();
    } else {
      this.crackTo = 0;
    }
    this.door = null;
  }
}

// ── build + public API ────────────────────────────────────────────────────────────────────────────
export interface HollowBuild {
  readonly root: THREE.Group;
  readonly statics: Underneath['statics'];
  readonly lights: LightHint[];
  readonly anchors: Record<string, THREE.Object3D>;
  readonly door: HollowDoor;
  update(dt: number, t: number): void;
  dispose(): void;
}

let active: HollowDoor | null = null;

/** Builds the crack, THE UNDERNEATH and the controller. Called from `level.ts`. */
export function buildHollow(o: { kit: KitX; tex: TexGen; seed: number; interact?: InteractionSystem; collision?: CollisionWorld }): HollowBuild {
  const root = new THREE.Group();
  root.name = 'hollow';
  const rng = createRng(o.seed ^ 0x7f1e5);
  const under = buildUnderneath(o.kit, o.tex, rng.fork('under'));
  root.add(under.root);

  const plateTex = o.tex.canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#4a4440';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#0c0808';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w * 0.18, h * 0.05); g.lineTo(w * 0.36, h * 0.4); g.lineTo(w * 0.3, h * 0.55); g.lineTo(w * 0.58, h * 0.96); g.stroke();
    g.beginPath(); g.moveTo(w * 0.36, h * 0.4); g.lineTo(w * 0.7, h * 0.32); g.stroke();
    g.beginPath(); g.moveTo(w * 0.3, h * 0.55); g.lineTo(w * 0.12, h * 0.7); g.stroke();
  });
  const crack = buildDoorway(o.kit, { leaves: o.kit.mat({ color: 0xffffff, map: plateTex }), frame: 0x2a2220 });
  crack.root.position.set(CRACK_DOOR[0], CRACK_DOOR[1], CRACK_DOOR[2]);
  root.add(crack.root);

  const anchors: Record<string, THREE.Object3D> = { ...under.anchors };
  const crackAnchor = new THREE.Object3D();
  crackAnchor.position.set(CRACK_DOOR[0], CRACK_DOOR[1], CRACK_DOOR[2]);
  root.add(crackAnchor);
  anchors['hollow.crack'] = crackAnchor;

  const door = new HollowDoor({ kit: o.kit, root, crack, under, interact: o.interact ?? null, collision: o.collision ?? null, rng: rng.fork('door') });
  active = door;

  return {
    root,
    statics: under.statics,
    lights: under.lights,
    anchors,
    door,
    update(dt: number) { door.update(dt); },
    dispose() {
      door.dispose();
      under.dispose();
      crack.dispose();
      if (active === door) active = null;
    },
  };
}

/**
 * Reveals the Hollow Door. The integrator calls this for the 3:33 phone call (`'phone333'`, after "go down") and for the red
 * seam (`'seam'`, pocket 0 and the House loan refused). The crack ('crack') is revealed by the knock itself.
 * Returns false when it cannot open: already revealed this run, no world yet, or no player for a seam.
 */
export function revealHollow(reason: HollowReason): boolean {
  if (!active) return false;
  const trigger = reason === 'crack' ? 'knock' : reason === 'phone333' ? 'phone' : 'loan';
  return app.run?.hollowTrigger(trigger) ?? false;
}

/** The live controller for this run, or null (no world, or the level has not built). */
export function hollowDoor(): HollowDoor | null {
  return active;
}

// Machines (lordstable) read the door through core, not by importing this module (TECH_SPEC §1.1).
bindHollowDoorLink(() => active);
