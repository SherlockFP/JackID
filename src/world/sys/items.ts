/**
 * World items (WORLD-SYS): totems, pickups, notes and loose props placed in the pit (`World.items`). Each item is a
 * group with the caller's model, an optional glowing floor ring (the radius of a Totem's effect, BRIEF ADDENDUM 8)
 * and an optional interaction target. Pickups and notes hover and turn; the ring breathes, and pops open when the
 * radius is set so placing a totem reads as an event. Everything is disposed with the item.
 */
import * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import type { TweenHandle, TweenSystem } from '@/core/tween';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { disposeObject3D } from '@/core/dispose';
import { clamp01, lerp } from '@/core/math';
import { ease } from '@/core/tween';
import type { InteractionSystem, WorldItemHandle, WorldItemSpec } from '../types';

const RING_COLOR = 0xe8b04a;
const POP_S = 0.45;
const BOX_MARGIN = 0.25;

export interface ItemServices {
  parent: THREE.Object3D;
  interact: InteractionSystem;
  tweens: TweenSystem;
}

class Item implements WorldItemHandle {
  readonly root = new THREE.Group();
  readonly id: string;
  private readonly model: THREE.Object3D;
  private readonly kind: WorldItemSpec['kind'];
  private readonly box = new THREE.Box3();
  private readonly ringGroup = new THREE.Group();
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private ringGeo: THREE.BufferGeometry | null = null;
  private discGeo: THREE.BufferGeometry | null = null;
  private radius = 0;
  private radiusTo = 0;
  private radiusT = 1;
  private radiusFrom = 0;
  private active = true;
  private time = 0;
  private baseY: number;
  private move: TweenHandle | null = null;
  private off: (() => void) | null = null;
  private readonly spinSeed: number;
  removed = false;

  constructor(private readonly spec: WorldItemSpec, private readonly sv: ItemServices) {
    this.id = spec.id;
    this.kind = spec.kind;
    this.model = spec.model;
    this.root.name = `item:${spec.id}`;
    this.root.position.set(...spec.pos);
    this.root.rotation.y = spec.rotY ?? 0;
    this.root.add(this.model);
    this.baseY = this.model.position.y;
    this.spinSeed = (spec.id.length * 0.37) % 1;

    const color: Hex = spec.color ?? RING_COLOR;
    this.ringMat = psxMaterial({ color, lit: false, additive: true, transparent: true, opacity: 0.6, side: 'double', unique: true }) as THREE.MeshBasicMaterial;
    this.discMat = psxMaterial({ color, lit: false, additive: true, transparent: true, opacity: 0.12, side: 'double', unique: true }) as THREE.MeshBasicMaterial;
    this.ringGroup.visible = false;
    this.root.add(this.ringGroup);
    sv.parent.add(this.root);
    this.setRadius(spec.radius ?? null);

    const ix = spec.interact;
    if (ix) {
      this.refreshBox();
      this.off = sv.interact.add({
        id: `item:${spec.id}`, box: this.box, maxDist: ix.maxDist,
        enabled: () => this.active && !this.removed && ix.enabled(),
        label: ix.label, sub: ix.sub, onInteract: ix.onInteract,
      });
    }
  }

  private refreshBox(): void {
    this.root.updateMatrixWorld(true);
    this.box.setFromObject(this.model).expandByScalar(BOX_MARGIN);
  }

  private buildRing(): void {
    if (this.ringGeo) return;
    this.ringGeo = new THREE.RingGeometry(0.94, 1, 40);
    this.discGeo = new THREE.CircleGeometry(1, 40);
    for (const g of [this.ringGeo, this.discGeo]) g.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    const disc = new THREE.Mesh(this.discGeo, this.discMat);
    ring.position.y = 0.025; disc.position.y = 0.02;
    ring.renderOrder = 2; disc.renderOrder = 1;
    this.ringGroup.add(disc, ring);
  }

  setPos(p: V3, dur = 0): void {
    this.move?.cancel();
    const to = new THREE.Vector3(...p);
    if (dur <= 0) { this.root.position.copy(to); this.refreshBox(); return; }
    const from = this.root.position.clone();
    this.move = this.sv.tweens.run(dur, (k) => {
      this.root.position.lerpVectors(from, to, k);
      this.refreshBox();
    }, { ease: 'inOutCubic' });
  }

  setRadius(r: number | null): void {
    const to = r && r > 0 ? r : 0;
    if (to > 0) this.buildRing();
    this.radiusFrom = this.radius;
    this.radiusTo = to;
    this.radiusT = 0;
    if (to > 0) this.ringGroup.visible = true;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.ringMat.opacity = on ? 0.6 : 0.18;
    this.discMat.opacity = on ? 0.12 : 0.03;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.radiusT < 1) {
      this.radiusT = Math.min(1, this.radiusT + dt / POP_S);
      this.radius = lerp(this.radiusFrom, this.radiusTo, ease.outBack(clamp01(this.radiusT)));
      if (this.radiusT >= 1) { this.radius = this.radiusTo; if (this.radius <= 0) this.ringGroup.visible = false; }
      this.ringGroup.scale.set(Math.max(0.001, this.radius), 1, Math.max(0.001, this.radius));
    }
    if (this.ringGroup.visible && this.active) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
      this.ringMat.opacity = 0.42 + 0.25 * pulse;
      this.discMat.opacity = 0.08 + 0.07 * pulse;
    }
    if (this.kind === 'pickup' || this.kind === 'note') {
      this.model.position.y = this.baseY + Math.sin(this.time * 2 + this.spinSeed * 6.28) * 0.04 + 0.04;
      this.model.rotation.y += dt * (this.kind === 'pickup' ? 1.1 : 0.5);
    }
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.move?.cancel();
    this.off?.();
    this.root.removeFromParent();
    // the model belongs to the caller's pools only if it is shared (flagged); everything else dies with the item
    disposeObject3D(this.root, { skipShared: true, detach: false });
    this.ringGeo?.dispose(); this.discGeo?.dispose();
    this.ringMat.dispose(); this.discMat.dispose();
  }
}

export class ItemManager {
  private readonly list: Item[] = [];
  readonly api: { spawn(spec: WorldItemSpec): WorldItemHandle; all(): readonly WorldItemHandle[] };

  constructor(private readonly sv: ItemServices) {
    this.api = {
      spawn: (spec) => {
        const existing = this.list.find((i) => i.id === spec.id);
        if (existing) this.handles.get(existing)?.remove();
        const item = new Item(spec, this.sv);
        const handle: WorldItemHandle = {
          get id() { return item.id; },
          get root() { return item.root; },
          setPos: (p, dur) => item.setPos(p, dur),
          setRadius: (r) => item.setRadius(r),
          setActive: (on) => item.setActive(on),
          remove: () => { item.remove(); const i = this.list.indexOf(item); if (i >= 0) this.list.splice(i, 1); this.handles.delete(item); },
        };
        this.list.push(item);
        this.handles.set(item, handle);
        return handle;
      },
      all: () => this.list.map((i) => this.handles.get(i)!),
    };
  }

  private readonly handles = new Map<Item, WorldItemHandle>();

  update(dt: number): void {
    for (const i of this.list) i.update(dt);
  }

  dispose(): void {
    for (const i of this.list.splice(0)) i.remove();
    this.handles.clear();
  }
}
