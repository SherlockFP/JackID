/**
 * One placement position in the world (WORLD-SYS): its transform group and everything that currently stands on it —
 * a working machine, an out-of-order cabinet or an empty pad — plus the bookkeeping the world needs to tear it down
 * again (collider ids, interaction unsubscribe, light sources) and to cull it cheaply (bounding sphere, LOD nodes).
 * The group is the mounting point for per-slot add-ons (Circuit badge, Service Plate, upgrade visuals: C26 — never
 * inside `machine.root`).
 */
import * as THREE from 'three';
import type { V3, Vec3Like } from '@/core/types';
import { SLOT_DIMS } from '@/core/types';
import type { AnyMachine } from '@/machines/_base/types';
import type { SlotDef } from '../types';
import type { BrokenParts, PadParts } from './pads';

export class SlotRec {
  readonly group = new THREE.Group();
  machine: AnyMachine | null = null;
  pad: PadParts | null = null;
  broken: BrokenParts | null = null;
  colliders: number[] = [];
  /** Interaction registration of whatever stands here. */
  offInteract: (() => void) | null = null;
  /** Light-source registrations (machine anchors). */
  offLights: Array<() => void> = [];
  /** True while a delivery / removal animation runs (no interaction, no culling). */
  busy = false;
  /** Wing grille down / type gating: the machine shows its lock overlay and refuses seats. */
  locked = false;
  /** Bounding sphere (world) used for frustum / distance culling. */
  readonly sphere = new THREE.Sphere();
  /** Nodes flagged `userData.lodDetail` (hidden beyond 8 m, ART_BIBLE §1.10). */
  detail: THREE.Object3D[] = [];
  lod: 0 | 1 = 0;
  /** Resolved while the machine is being built (time-sliced); false until `init()` ran. */
  ready = false;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly def: SlotDef) {
    this.group.name = `slot:${def.id}`;
    this.group.position.set(def.pos[0], def.pos[1], def.pos[2]);
    this.group.rotation.y = THREE.MathUtils.degToRad(def.rotY);
    this.group.updateMatrixWorld(true);
    const d = SLOT_DIMS[def.size];
    this.sphere.center.set(0, d.h / 2, 0).applyMatrix4(this.group.matrixWorld);
    this.sphere.radius = Math.hypot(d.w, d.d, d.h) / 2 + 0.3;
  }

  get id(): string { return this.def.id; }
  get size() { return this.def.size; }

  /** Slot-local point → world. */
  toWorld(p: V3 | Vec3Like, out = new THREE.Vector3()): THREE.Vector3 {
    if (Array.isArray(p)) out.set(p[0], p[1], p[2]); else out.set(p.x, p.y, p.z);
    return out.applyMatrix4(this.group.matrixWorld);
  }

  /** World point → slot-local. */
  toLocal(p: Vec3Like, out = new THREE.Vector3()): THREE.Vector3 {
    this.tmp.set(p.x, p.y, p.z);
    return out.copy(this.group.worldToLocal(this.tmp));
  }

  /** Planar distance from a world point to the slot centre. */
  distanceTo(p: Vec3Like): number {
    return Math.hypot(this.def.pos[0] - p.x, this.def.pos[2] - p.z);
  }
}
