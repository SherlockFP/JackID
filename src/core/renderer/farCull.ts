/**
 * Far-distance culling for static dressing (PERF, ART_BIBLE §1.10: "whole frame, visible" budget).
 *
 * An owner registers a static subtree with `farCull.add(root)`. Its bounding sphere is cached once (world space, so
 * register after the root is placed). Every 0.1 s the subtree is moved off the camera's render layer while its sphere
 * lies beyond the fog reach (`scene.fog.far + 2 m`), and back on when it returns. Layers are used, not `visible`, so the
 * owner's own visibility flags (`visible = false` for states, machine rec.group.visible) are never overridden.
 *
 * Only renderables carry the layer (Mesh, InstancedMesh, SkinnedMesh, Line, Points, Sprite): three.js tests layers per
 * object, so a group's layer would not hide its children.
 */
import * as THREE from 'three';

/** Layer the camera does not render (the camera stays on layer 0). */
export const FAR_LAYER = 1;
const PERIOD_S = 0.1;
const MARGIN_M = 2;

interface Entry {
  root: THREE.Object3D;
  center: THREE.Vector3;
  radius: number;
  nodes: THREE.Object3D[];
  far: boolean;
}

export interface FarCull {
  /** Register a static subtree. Empty subtrees and re-registrations are ignored. */
  add(root: THREE.Object3D): void;
  /** Forget a subtree and put its renderables back on layer 0. */
  remove(root: THREE.Object3D): void;
  /** Number of registered subtrees currently moved off-camera. */
  readonly hiddenCount: number;
  readonly size: number;
  /** Per rendered frame: `dt` in real seconds. Re-checks every 0.1 s against `scene.fog` and the camera position. */
  tick(dt: number, scene: THREE.Scene, camera: THREE.Camera): void;
}

function renderables(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    const r = o as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if (r.isMesh || r.isLine || r.isPoints || r.isSprite) out.push(o);
  });
  return out;
}

export function createFarCull(): FarCull {
  const entries = new Map<THREE.Object3D, Entry>();
  const box = new THREE.Box3();
  const cp = new THREE.Vector3();
  let acc = 0;

  const setLayer = (e: Entry, far: boolean): void => {
    e.far = far;
    for (const n of e.nodes) n.layers.set(far ? FAR_LAYER : 0);
  };

  return {
    add(root) {
      if (entries.has(root)) return;
      root.updateWorldMatrix(true, true);
      box.setFromObject(root);
      if (box.isEmpty()) return;
      const nodes = renderables(root);
      if (nodes.length === 0) return;
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      entries.set(root, { root, center, radius, nodes, far: false });
    },
    remove(root) {
      const e = entries.get(root);
      if (!e) return;
      setLayer(e, false);
      entries.delete(root);
    },
    get hiddenCount() {
      let n = 0;
      for (const e of entries.values()) if (e.far) n++;
      return n;
    },
    get size() { return entries.size; },
    tick(dt, scene, camera) {
      acc += dt;
      if (acc < PERIOD_S) return;
      acc %= PERIOD_S;
      const fog = scene.fog as THREE.Fog | null;
      if (!fog || !fog.isFog) {
        for (const e of entries.values()) if (e.far) setLayer(e, false);
        return;
      }
      const reach = fog.far + MARGIN_M;
      camera.getWorldPosition(cp);
      for (const e of entries.values()) {
        const far = e.center.distanceTo(cp) - e.radius > reach;
        if (far !== e.far) setLayer(e, far);
      }
    },
  };
}

/** The renderer's registry: `psxRenderer.render` ticks it; owners register static dressing with `farCull.add(group)`. */
export const farCull = createFarCull();
