/**
 * Placed totems in the world (BRIEF ADDENDUM 8): a carved kit model on a stepped base with a glowing floor ring that
 * shows the effect radius. Carried totems are not drawn here (the viewmodel hand owns those). `sync` is cheap: call it
 * each frame or on `totem:*` events. A proc pulses the matching ring.
 */
import type * as THREE from 'three';
import type { Unsub } from '@/core/types';
import type { TotemDef, TotemState } from '@/game/types';
import type { Kit, TotemPart } from '@/kit/types';
import { bus } from '@/core/events';

export class TotemView {
  private readonly parts = new Map<string, TotemPart>();
  private readonly offProc: Unsub;

  constructor(
    private readonly kit: Pick<Kit, 'totem'>,
    private readonly scene: THREE.Object3D,
    private readonly defOf: (id: string) => TotemDef | undefined,
  ) {
    this.offProc = bus.on('totem:proc', ({ uid }) => { this.parts.get(uid)?.pulse(); });
  }

  /** Make the world match the placed totems in `states` (carried ones are skipped). */
  sync(states: readonly TotemState[]): void {
    const live = new Set<string>();
    for (const s of states) {
      const def = this.defOf(s.def);
      if (!s.pos || !def) continue;
      live.add(s.uid);
      let part = this.parts.get(s.uid);
      if (!part) {
        part = this.kit.totem({ shape: def.shape, color: def.color, radius: def.radius });
        this.scene.add(part.root);
        this.parts.set(s.uid, part);
      }
      part.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
      part.root.rotation.y = s.rotY;
      part.setRadius(def.radius);
      part.setActive(true);
    }
    for (const [uid, part] of [...this.parts]) {
      if (live.has(uid)) continue;
      this.scene.remove(part.root);
      part.dispose();
      this.parts.delete(uid);
    }
  }

  dispose(): void {
    this.offProc();
    for (const p of this.parts.values()) { this.scene.remove(p.root); p.dispose(); }
    this.parts.clear();
  }
}
