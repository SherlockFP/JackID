/**
 * GPU resource disposal helpers (TD-owned). Contract: TECH_SPEC §8 "Disposal rules".
 *
 * Shared resources (cached `psxMaterial`s, `texgen` textures with a key, atlases) carry
 * `userData.shared = true` and are freed only when the app exits — `disposeObject3D(..., {skipShared:true})`
 * (the default) never touches them. Everything else a machine creates is freed through here.
 */
import * as THREE from 'three';

export interface DisposeOpts {
  /** Leave resources flagged `userData.shared` alone (default true). */
  skipShared?: boolean;
  /** Detach `root` from its parent first (default true). */
  detach?: boolean;
}

const isShared = (o: { userData?: Record<string, unknown> } | null | undefined): boolean => !!o?.userData?.shared;

function disposeMaterial(m: THREE.Material, skipShared: boolean): void {
  if (skipShared && isShared(m)) return;
  for (const v of Object.values(m)) {
    if (v instanceof THREE.Texture && !(skipShared && isShared(v))) v.dispose();
  }
  m.dispose();
}

/** Dispose geometries, non-shared materials and their textures under `root` (recursively). */
export function disposeObject3D(root: THREE.Object3D, o: DisposeOpts = {}): void {
  const skipShared = o.skipShared ?? true;
  if (o.detach ?? true) root.removeFromParent();
  root.traverse((n) => {
    const obj = n as THREE.Mesh & THREE.InstancedMesh & THREE.SkinnedMesh;
    if (obj.geometry && !(skipShared && isShared(obj.geometry))) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => disposeMaterial(m, skipShared));
      else disposeMaterial(obj.material, skipShared);
    }
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) (obj as THREE.SkinnedMesh).skeleton?.dispose();
  });
}

type Disposable = { dispose(): void } | (() => void);

/**
 * Collects things to clean up later: GPU objects, unsubscribe functions, cancel handles.
 * `add()` returns its argument so it can wrap creation: `const tex = d.add(new THREE.CanvasTexture(c))`.
 */
export class Disposer {
  private items: Disposable[] = [];
  add<T extends Disposable>(d: T): T { this.items.push(d); return d; }
  /** Dispose in reverse order of registration and empty the list. */
  disposeAll(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      try { if (typeof d === 'function') d(); else d.dispose(); } catch { /* disposal must never throw */ }
    }
    this.items.length = 0;
  }
  get size(): number { return this.items.length; }
}
