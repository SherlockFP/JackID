/**
 * Items assembly (BRIEF ADDENDUM 8): Totems. The run builds it once next to the buff system, sets `run.totems` to
 * `sys.totems`, calls `sys.tick(dt)` each frame, and mounts `TotemView` (items/view.ts) under the pit for the ring
 * visuals. Placement input (B: place / pick up) is routed by the input layer to `totems.place` / `totems.pickup`.
 */
import type { Unsub } from '@/core/types';
import type { ModProvider } from '@/game/types';
import { bus } from '@/core/events';
import { registerStrings } from '@/core/i18n';
import { TOTEM_DATA } from './data';
import { Totems, type TotemHost } from './totems';

export { Totems, MAX_PLACED_PER_PLAYER } from './totems';
export { TotemView } from './view';

export interface ItemSystem {
  readonly totems: Totems;
  /** Once per frame, real seconds (expires timed totems). */
  tick(dt: number): void;
  dispose(): void;
}

export function createItemSystem(host: TotemHost, mods: { register(p: ModProvider): () => void }): ItemSystem {
  const totems = new Totems(host);
  const unsubs: Unsub[] = [];
  for (const def of TOTEM_DATA) {
    unsubs.push(totems.register(def));
    registerStrings(`totem.${def.id}.`, { en: def.strings.en, tr: def.strings.tr });
  }
  unsubs.push(mods.register(totems));
  unsubs.push(bus.on('machine:round', ({ pid, mid }) => totems.onRound(pid, mid)));
  return {
    totems,
    tick(): void { totems.tick(); },
    dispose(): void { for (const u of unsubs.splice(0)) u(); },
  };
}
