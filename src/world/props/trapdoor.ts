/**
 * Trapdoor plate (GDD §8.9, ART_BIBLE §6.5 v1.1): a 2 × 2 m riveted steel plate made of two hinged leaves over a 30 m
 * shaft. `open()` rattles, drops both leaves to 100° and turns the plate's walkable collider off, so the floor test in
 * `CollisionWorld.floorAt` returns null and the player falls. `close()` slams the leaves back and re-arms the collider.
 *
 * The level places one hero plate (the demo trapdoor). The rest of the grid stays static floor; each plate's collider id
 * is passed in so the prop can toggle exactly its own box.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { CollisionWorld, TrapdoorProp } from '../types';
import type { PlayerId } from '@/core/types';
import { Sched, easeInOutCubic, easeInQuad, easeOutQuad } from './sched';

export const TRAPDOOR_OPEN_DEG = 100;
export const SHAFT_DEPTH = 30;

export interface TrapdoorParts {
  root: THREE.Group;
  /** Hinge pivots: the leaves rotate about these. */
  hingeA: THREE.Group;
  hingeB: THREE.Group;
  /** Four shaft walls (inner faces) and the brass rim. */
  shaft: THREE.Group;
  rim: THREE.Group;
  dispose(): void;
}

export function buildTrapdoor(kit: KitX, tex: TexGen, o: { shaftDepth?: number } = {}): TrapdoorParts {
  const depth = o.shaftDepth ?? SHAFT_DEPTH;
  const root = kit.group('trapdoor');
  const leafMat = kit.mat({ color: 0x8a8070, map: tex.vendor('sbs-horror/128x128/Metal/Horror_Metal_03-128x128.png', { size: 64 }) });

  const hingeA = kit.group('hingeA');
  hingeA.position.set(-1, 0.004, 0);
  kit.box(1, 0.06, 2, leafMat, { pos: [0.5, -0.03, 0], parent: hingeA, bevel: 0.005 });
  root.add(hingeA);

  const hingeB = kit.group('hingeB');
  hingeB.position.set(1, 0.004, 0);
  kit.box(1, 0.06, 2, leafMat, { pos: [-0.5, -0.03, 0], parent: hingeB, bevel: 0.005 });
  root.add(hingeB);

  // rivet rows on each leaf (cheap, merged into the leaf look)
  for (const hinge of [hingeA, hingeB]) {
    for (let i = -0.8; i <= 0.81; i += 0.4) {
      kit.sphere(0.02, kit.pal.steel, { pos: [i * 0.5 + (hinge === hingeA ? 0.5 : -0.5), 0.02, 0.9], parent: hinge, wSeg: 4, hSeg: 3 });
    }
  }

  // brass rim (outer edge 2 × 2, width 0.15)
  const rim = kit.group('rim');
  const brass = kit.pal.brass;
  kit.box(2.3, 0.02, 0.15, brass, { pos: [0, 0.01, 1.075], parent: rim });
  kit.box(2.3, 0.02, 0.15, brass, { pos: [0, 0.01, -1.075], parent: rim });
  kit.box(0.15, 0.02, 2.0, brass, { pos: [1.075, 0.01, 0], parent: rim });
  kit.box(0.15, 0.02, 2.0, brass, { pos: [-1.075, 0.01, 0], parent: rim });
  root.add(rim);

  // shaft: four concrete walls with the inner face toward the axis
  const shaft = kit.group('shaft');
  const wall = kit.mat({ color: 0x5a524a, map: tex.concrete(0x4a4440) });
  const h = depth;
  kit.box(0.06, h, 2.0, wall, { pos: [-1.03, -h / 2, 0], parent: shaft });
  kit.box(0.06, h, 2.0, wall, { pos: [1.03, -h / 2, 0], parent: shaft });
  kit.box(2.0, h, 0.06, wall, { pos: [0, -h / 2, -1.03], parent: shaft });
  kit.box(2.0, h, 0.06, wall, { pos: [0, -h / 2, 1.03], parent: shaft });
  // ring lights every 10 m (emissive plates, no light objects)
  for (let y = 10; y < h; y += 10) {
    const lamp = kit.lamp({ r: 0.12, color: 0xffb45a, shape: 'flat' });
    lamp.root.position.set(0, -y, -0.98);
    shaft.add(lamp.root);
  }
  root.add(shaft);

  return {
    root, hingeA, hingeB, shaft, rim,
    dispose() {
      root.traverse((obj) => { const m = obj as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}

/** Trapdoor prop. `colliderIds` are the walkable boxes of this plate (level registers them). */
export class Trapdoor implements TrapdoorProp {
  readonly id = 'trapdoor';
  readonly root: THREE.Group;
  private opened = false;
  private readonly sched = new Sched();
  private rattleT = 0;

  constructor(private readonly parts: TrapdoorParts, private readonly collision: CollisionWorld | null, private readonly colliderIds: number[]) {
    this.root = parts.root;
  }

  get isOpen(): boolean { return this.opened; }

  private setColliders(on: boolean): void {
    if (!this.collision) return;
    for (const id of this.colliderIds) this.collision.setEnabled(id, on);
  }

  private setAngle(deg: number): void {
    const r = THREE.MathUtils.degToRad(deg);
    this.parts.hingeA.rotation.z = -r;
    this.parts.hingeB.rotation.z = r;
  }

  /** Unlatch (0.4 s), fall open (0.35 s, ease-in), 5° bounce at the end. Resolves when fully open. */
  async open(_who?: PlayerId | 'all', dur = 0.35): Promise<void> {
    if (this.opened) return;
    await this.rattle(0.4, 0.003, 20);
    this.setColliders(false);
    await this.sched.run(dur, (k) => this.setAngle(TRAPDOOR_OPEN_DEG * k), easeInQuad);
    await this.sched.run(0.12, (k) => this.setAngle(TRAPDOOR_OPEN_DEG + 5 * Math.sin(k * Math.PI)), easeOutQuad);
    this.setAngle(TRAPDOOR_OPEN_DEG);
    this.opened = true;
  }

  /** Slam shut (0.9 s, ease-in-out) with a shake, then re-arm the collider. */
  async close(dur = 0.9): Promise<void> {
    if (!this.opened) return;
    await this.sched.run(dur, (k) => this.setAngle(TRAPDOOR_OPEN_DEG * (1 - k)), easeInOutCubic);
    this.setAngle(0);
    this.setColliders(true);
    this.opened = false;
    this.rattleT = 0.12; // slam shake
  }

  /** Visible rattle: the root jitters, amplitude `amp` metres, `hz` cycles per second, for `dur` seconds. */
  private rattle(dur: number, amp: number, hz: number): Promise<void> {
    return this.sched.run(dur, (k) => {
      this.root.position.y = Math.sin(k * dur * hz * Math.PI * 2) * amp * (1 - k * 0.5);
    }).then(() => { this.root.position.y = 0; });
  }

  update(dt: number): void {
    this.sched.update(dt);
    if (this.rattleT > 0) {
      this.rattleT -= dt;
      this.root.position.y = Math.sin(this.rattleT * 90) * 0.02 * Math.max(0, this.rattleT / 0.12);
      if (this.rattleT <= 0) this.root.position.y = 0;
    }
  }

  dispose(): void {
    this.sched.clear();
    this.parts.dispose();
  }
}

/** Factory used by level.ts: builds the plate at `pos` and wires its collider ids. */
export function createTrapdoor(kit: KitX, tex: TexGen, o: { pos: [number, number, number]; collision: CollisionWorld | null; colliderIds: number[]; shaftDepth?: number }): Trapdoor {
  const parts = buildTrapdoor(kit, tex, { shaftDepth: o.shaftDepth });
  parts.root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  return new Trapdoor(parts, o.collision, o.colliderIds);
}
