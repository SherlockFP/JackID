/**
 * PowerRig (`_base`): what a gambling machine's CRT shows as the night cycle turns (world/nightLights.ts). Per `screen` mesh it
 * hangs two black shutters (the CRT collapse at Dawn, the boot at the Night's opening), a bright line, and a dim CLOSED plate
 * (the Mola, when the floor takes no plays). Visual only; nothing here touches the machine's state, and it builds nothing
 * until the cycle first asks for something other than a live screen.
 */
import * as THREE from 'three';
import type { Kit } from '@/kit/types';
import { SPAN_S, nightClock, screenPose, sectionDelay, type ScreenPose } from '@/core/nightClock';

interface Face { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial | null; w: number; h: number; top: THREE.Mesh; bottom: THREE.Mesh; line: THREE.Mesh; plate: THREE.Mesh }

const LIVE: ScreenPose = { shutter: 0, line: 0, tint: 1, closed: false };

export class PowerRig {
  private faces: Face[] | null = null;
  private last = '';
  private delayOpen = -1;
  private delayShut = -1;

  constructor(private readonly root: THREE.Object3D, private readonly kit: Kit) {}

  /** Where the machine stands decides when its section wakes (from the lift outward) and sleeps (far end first). */
  private locate(): void {
    this.root.updateWorldMatrix(true, false);
    const at = this.root.getWorldPosition(new THREE.Vector3());
    this.delayOpen = sectionDelay(at.x, at.z, 'out', SPAN_S - 0.6);
    this.delayShut = sectionDelay(at.x, at.z, 'in', SPAN_S - 0.4);
  }

  private build(): Face[] {
    const out: Face[] = [];
    const black = new THREE.MeshBasicMaterial({ color: 0x050507, fog: false });
    const white = new THREE.MeshBasicMaterial({ color: 0xdffcff, fog: false });
    const found: THREE.Mesh[] = [];
    this.root.traverse((n) => { if (n.name === 'screen' && (n as THREE.Mesh).isMesh) found.push(n as THREE.Mesh); });
    for (const mesh of found) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      const w = b.max.x - b.min.x, h = b.max.y - b.min.y, z = b.max.z + 0.006;
      const plane = (pw: number, ph: number, m: THREE.Material, dz = 0): THREE.Mesh => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), m);
        p.position.z = z + dz;
        p.visible = false;
        p.renderOrder = 5;
        mesh.add(p);
        return p;
      };
      const label = this.kit.label({ text: { key: 'world.night.closed' }, w, h, px: [64, 40], color: 0x9a6a2c, bg: 0x0a0705 });
      label.mesh.position.z = z + 0.002;
      label.mesh.visible = false;
      label.mesh.renderOrder = 5;
      mesh.add(label.mesh);
      const m = mesh.material as THREE.MeshBasicMaterial;
      out.push({
        mesh, mat: m && m.color ? m : null, w, h,
        top: plane(w, h / 2, black), bottom: plane(w, h / 2, black), line: plane(w, Math.max(0.006, h * 0.03), white, 0.004), plate: label.mesh,
      });
    }
    return out;
  }

  /** Per frame while the machine is visible. `held`: someone sits here, so the screen stays live. */
  update(held: boolean, reduced: boolean): void {
    const nc = nightClock();
    if (this.delayOpen < 0) this.locate();
    const delay = nc.phase === 'opening' ? this.delayOpen : nc.phase === 'dawn' ? this.delayShut : 0;
    const p = held ? LIVE : screenPose(nc.phase, nc.age, delay, nc.fromDark, reduced);
    if (!this.faces) {
      if (p.shutter === 0 && !p.closed && p.tint === 1) return;   // a live screen: build nothing
      this.faces = this.build();
    }
    const key = `${p.shutter.toFixed(2)}|${p.line.toFixed(2)}|${p.tint.toFixed(2)}|${p.closed ? 1 : 0}`;
    if (key === this.last) return;
    this.last = key;
    for (const f of this.faces) {
      const s = p.shutter;
      f.top.visible = f.bottom.visible = s > 0.001;
      f.top.scale.y = f.bottom.scale.y = Math.max(0.001, s);
      f.top.position.y = f.h / 2 - (f.h / 4) * s;
      f.bottom.position.y = -f.h / 2 + (f.h / 4) * s;
      f.line.visible = p.line > 0.01 && s >= 0.999;
      f.line.scale.x = Math.max(0.001, p.line);
      f.plate.visible = p.closed;
      f.mat?.color.setScalar(p.tint);
    }
  }

  dispose(): void {
    // the meshes are children of the machine's screens: the machine's own disposeObject3D releases them with the model
    this.faces = null;
  }
}
