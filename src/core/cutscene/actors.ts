/**
 * Cutscene actors (CUTSCENE WP). Spawns the mannequins a scene declares (`def.actors`), applies their cues and runs
 * the continuous parts (moves, turns, head tracking) on real time. Seeking applies cues instantly. Every actor is
 * owned here and disposed at the end of the run.
 */
import * as THREE from 'three';
import type { Kit, MannequinActor } from '@/kit/types';
import type { ActorCue, ActorSpec, CutTarget } from './types';
import { ease, type Ease } from '../tween';
import { clamp, lerpAngle } from '../math';
import { log } from '../log';

const DEG = Math.PI / 180;
const LOOK_BLEND = 0.2;        // s, head-tracking blend (re-applied every frame, so moving targets follow)
const FACE_TURN = 0.25;        // s, turn into the direction of a move
const DEFAULT_TURN = 0.3;      // s

interface Live {
  key: string;
  actor: MannequinActor;
  look: CutTarget | null;
}
interface Move { live: Live; from: THREE.Vector3; to: THREE.Vector3; dur: number; t: number; ease: Ease }
interface Turn { live: Live; from: number; to: number; dur: number; t: number }

export type PointResolver = (tg: CutTarget, role: 'pos' | 'look', out: THREE.Vector3) => THREE.Vector3;

export class CutActors {
  private readonly live = new Map<string, Live>();
  private moves: Move[] = [];
  private turns: Turn[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  private scene: THREE.Scene | null = null;

  constructor(private readonly kit: Kit, private readonly resolve: PointResolver) {}

  /** Put the stage in `scene` (the latest main scene, so the level lights reach the actors). Safe to call every frame. */
  rehome(scene: THREE.Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    for (const L of this.live.values()) scene.add(L.actor.root);
  }

  /** The live mannequin of a declared actor (targets, lookups). */
  get(key: string): MannequinActor | undefined { return this.live.get(key)?.actor; }

  get size(): number { return this.live.size; }

  /** True once every spawned mannequin has its real mesh (no placeholder pop-in on the first frame). */
  get ready(): boolean {
    for (const L of this.live.values()) if (!L.actor.isReady) return false;
    return true;
  }

  spawn(key: string, spec: ActorSpec): void {
    const actor = this.kit.mannequin({
      color: spec.color, height: spec.height, mask: spec.mask ?? null, clip: spec.clip,
    });
    actor.root.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    actor.root.rotation.y = spec.rotY * DEG;
    actor.setVisible(spec.visible ?? true);
    if (spec.tint !== undefined) actor.setTint(spec.tint);
    for (const p of spec.props ?? []) {
      try { actor.attach(this.kit.prop(p.prop), p.bone, { pos: p.pos, rot: p.rot, scale: p.scale }); }
      catch (e) { log.warn('cutscene', `actor "${key}": prop "${p.prop}" failed`, e); }
    }
    this.scene?.add(actor.root);
    this.live.set(key, { key, actor, look: null });
  }

  /**
   * Apply one cue. `seek` = late join / skip replay: no blends; `since` is how long ago the cue was due, so clips
   * resume at the right frame and a move or turn that is still under way continues from where it would be now.
   */
  cue(key: string, c: ActorCue, seek: boolean, since = 0): void {
    const L = this.live.get(key);
    if (!L) return;
    const a = L.actor;
    if (c.stepFps !== undefined) a.setStepFps(c.stepFps);
    if (c.speed !== undefined) a.setSpeed(c.speed);
    if (c.visible !== undefined) a.setVisible(c.visible);
    if (c.tint !== undefined) a.setTint(c.tint);
    if (c.scale !== undefined) a.root.scale.setScalar(c.scale);
    if (c.clip !== undefined) void a.play(c.clip, { fade: seek ? 0 : (c.fade ?? 0.2), loop: c.loop, speed: c.speed, at: seek && since > 0 ? since : undefined });

    if (c.look !== undefined) {
      L.look = c.look;
      if (c.look === null) a.lookAt(null);
      else if (seek) a.lookAt(this.resolve(c.look, 'look', this.tmp));
    }

    if (c.moveTo) {
      const to = this.tmp2.set(c.moveTo.pos[0], c.moveTo.pos[1], c.moveTo.pos[2]);
      const dur = Math.max(0.001, c.moveTo.dur);
      const done = seek && since >= dur;
      const from = a.root.position.clone();
      this.moves = this.moves.filter((m) => m.live !== L);
      if (done) a.root.position.copy(to);
      else {
        const t0 = seek ? since : 0;
        this.moves.push({ live: L, from, to: to.clone(), dur, t: t0, ease: c.moveTo.ease ?? 'inOutCubic' });
        if (t0 > 0) a.root.position.lerpVectors(from, to, ease[c.moveTo.ease ?? 'inOutCubic'](t0 / dur));
      }
      if (c.moveTo.faceMove) this.face(L, to, seek ? 0 : FACE_TURN, from);
    }

    if (c.turnTo) {
      let target: number;
      if ('rotY' in c.turnTo) target = c.turnTo.rotY * DEG;
      else {
        const p = this.resolve(c.turnTo.target, 'pos', this.tmp);
        target = Math.atan2(p.x - a.root.position.x, p.z - a.root.position.z);
      }
      const dur = Math.max(0.001, c.turnTo.dur ?? DEFAULT_TURN);
      this.turns = this.turns.filter((tn) => tn.live !== L);
      if (seek && since >= dur) a.root.rotation.y = target;
      else {
        const t0 = seek ? since : 0;
        const from = a.root.rotation.y;
        this.turns.push({ live: L, from, to: target, dur, t: t0 });
        if (t0 > 0) a.root.rotation.y = lerpAngle(from, target, ease.inOutQuad(t0 / dur));
      }
    }
  }

  /** Turn `L` to face `to` (world point) over `dur`, or instantly when dur is 0. */
  private face(L: Live, to: THREE.Vector3, dur: number, from?: THREE.Vector3): void {
    const p = from ?? L.actor.root.position;
    const yaw = Math.atan2(to.x - p.x, to.z - p.z);
    if (dur <= 0) { L.actor.root.rotation.y = yaw; return; }
    this.turns = this.turns.filter((tn) => tn.live !== L);
    this.turns.push({ live: L, from: L.actor.root.rotation.y, to: yaw, dur, t: 0 });
  }

  /** Per-frame: moves, turns, head tracking. Real time (the actors ignore hit-stop like the rest of the scene). */
  update(dt: number): void {
    for (const L of this.live.values()) {
      if (L.look) L.actor.lookAt(this.resolve(L.look, 'look', this.tmp), LOOK_BLEND);
    }
    if (this.moves.length) {
      for (const m of this.moves) {
        m.t += dt;
        const k = clamp(m.t / m.dur, 0, 1);
        m.live.actor.root.position.lerpVectors(m.from, m.to, ease[m.ease](k));
      }
      this.moves = this.moves.filter((m) => m.t < m.dur);
    }
    if (this.turns.length) {
      for (const tn of this.turns) {
        tn.t += dt;
        const k = clamp(tn.t / tn.dur, 0, 1);
        tn.live.actor.root.rotation.y = lerpAngle(tn.from, tn.to, ease.inOutQuad(k));
      }
      this.turns = this.turns.filter((tn) => tn.t < tn.dur);
    }
  }

  /** Remove and free every actor (end of run). */
  dispose(): void {
    for (const L of this.live.values()) {
      try { L.actor.dispose(); } catch { /* best effort: the mesh is already gone */ }
      L.actor.root.removeFromParent();
    }
    this.live.clear();
    this.moves = [];
    this.turns = [];
  }
}
