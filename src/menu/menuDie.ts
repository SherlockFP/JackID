/**
 * The menu die (menu-3d). A cube whose six faces are canvas-painted menu entries.
 *
 * Every face `i` has one canonical resting orientation `rest[i]`: face `i` points at the camera (+Z) and reads
 * upright. Rolling to a face is a tumble from the current orientation to `rest[i]`, so the result never depends
 * on the path taken and the text is never sideways. The tumble overshoots (easeOutBack) and hops.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { makeCanvasTex, type CanvasTex } from './menuArt';

/** BoxGeometry material-group order: +X, -X, +Y, -Y, +Z, -Z. */
const NORMALS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const CAMERA_DIR = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export const FACE_PX = 288;

/** Overshoot easing: 0 → 1 with a small lap past 1 that settles back. */
export function easeOutBack(k: number, s = 1.15): number {
  const c3 = s + 1;
  const x = k - 1;
  return 1 + c3 * x * x * x + s * x * x;
}

export interface DieHit { face: number; point: THREE.Vector3 }

export class MenuDie {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly faces: CanvasTex[] = [];
  readonly base = new THREE.Vector3();
  private readonly mats: THREE.MeshLambertMaterial[] = [];
  private readonly rest: THREE.Quaternion[] = [];
  private anim: { from: THREE.Quaternion; to: THREE.Quaternion; t: number; dur: number; hop: number; done: (() => void) | null } | null = null;
  private hovered = -1;
  private time = 0;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpAxis = new THREE.Quaternion();

  constructor(readonly size: number) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const index = geo.index;
    if (!index) throw new Error('menuDie: indexed box expected');
    for (let g = 0; g < 6; g++) {
      const grp = geo.groups[g];
      let top = -Infinity, bot = Infinity, iTop = 0, iBot = 0;
      for (let k = grp.start; k < grp.start + grp.count; k++) {
        const vi = index.getX(k);
        const v = uv.getY(vi);
        if (v > top) { top = v; iTop = vi; }
        if (v < bot) { bot = v; iBot = vi; }
      }
      const n = NORMALS[g];
      const up = new THREE.Vector3().fromBufferAttribute(pos, iTop).sub(new THREE.Vector3().fromBufferAttribute(pos, iBot)).normalize();
      const local = new THREE.Matrix4().makeBasis(n, up, new THREE.Vector3().crossVectors(n, up));
      // right-handed frame (Z, Y, Z×Y): a proper rotation, never a mirror
      const world = new THREE.Matrix4().makeBasis(CAMERA_DIR, WORLD_UP, new THREE.Vector3().crossVectors(CAMERA_DIR, WORLD_UP));
      const r = new THREE.Matrix4().multiplyMatrices(world, local.transpose());
      this.rest.push(new THREE.Quaternion().setFromRotationMatrix(r));
      const canvas = makeCanvasTex(FACE_PX, FACE_PX);
      this.faces.push(canvas);
      const mat = psxMaterial({ map: canvas.tex, color: 0xffffff, unique: true }) as THREE.MeshLambertMaterial;
      this.mats.push(mat);
    }
    this.mesh = new THREE.Mesh(geo, this.mats);
    this.root.add(this.mesh);
  }

  /** Rest orientation of face `i` (exposed for tests and the settings die placement). */
  restOf(i: number): THREE.Quaternion { return this.rest[i]; }

  /** Index of the face whose world normal is most aligned with `dir`. */
  faceAt(dir: THREE.Vector3): number {
    let best = 0, bestDot = -Infinity;
    for (let i = 0; i < 6; i++) {
      const d = NORMALS[i].clone().applyQuaternion(this.mesh.quaternion).dot(dir);
      if (d > bestDot) { bestDot = d; best = i; }
    }
    return best;
  }

  frontFace(): number { return this.faceAt(CAMERA_DIR); }

  get rolling(): boolean { return this.anim !== null; }

  /** Tumble so that face `i` ends up pointing at the camera, upright. */
  rollTo(i: number, done?: () => void, dur = 0.62): void {
    this.anim = {
      from: this.mesh.quaternion.clone(), to: this.rest[i].clone(),
      t: 0, dur, hop: 0.32, done: done ?? null,
    };
  }

  /** Free rotation while dragging (world-space axes). Cancels any tumble. */
  drag(dx: number, dy: number): void {
    this.anim = null;
    this.tmpAxis.setFromAxisAngle(AXIS_Y, dx * 0.012);
    this.mesh.quaternion.premultiply(this.tmpAxis);
    this.tmpAxis.setFromAxisAngle(AXIS_X, dy * 0.012);
    this.mesh.quaternion.premultiply(this.tmpAxis);
  }

  /** Ray hit on the die: material group (face) and the world point. */
  pick(hit: THREE.Intersection[]): DieHit | null {
    for (const h of hit) {
      if (h.object !== this.mesh) continue;
      return { face: h.face?.materialIndex ?? 0, point: h.point.clone() };
    }
    return null;
  }

  setHover(i: number): void { this.hovered = i; }

  /** Canvas paint for one face. */
  paint(i: number, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.faces[i].paint(fn);
  }

  /** Emissive glow: the face on top is faint gold, the hovered face is bright. */
  private glow(): void {
    const front = this.frontFace();
    for (let i = 0; i < 6; i++) {
      const hex = i === this.hovered ? 0x9a6416 : i === front ? 0x3a1c08 : 0x000000;
      this.mats[i].emissive.setHex(hex);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const a = this.anim;
    if (a) {
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      this.mesh.quaternion.copy(a.from).slerp(a.to, easeOutBack(p));
      this.root.position.set(this.base.x, this.base.y + Math.sin(Math.PI * p) * a.hop, this.base.z);
      if (p >= 1) {
        this.mesh.quaternion.copy(a.to);
        this.anim = null;
        this.root.position.copy(this.base);
        a.done?.();
      }
    } else {
      this.root.position.set(this.base.x, this.base.y + Math.sin(this.time * 1.3) * 0.035, this.base.z);
    }
    this.glow();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const m of this.mats) m.dispose();
    for (const f of this.faces) f.tex.dispose();
  }
}
