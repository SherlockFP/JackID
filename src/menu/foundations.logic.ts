/**
 * Foundations without the DOM (WAVE 7 foundations). `createMetaPrestige` is the standalone `PrestigeApi` for the screens
 * that run outside a run (the die menu's kit picker and the results receipt): it buys against `save.data.meta` with the
 * same rules the tycoon uses (`metaBuyBlock` / `applyMetaBuy` in game/data/upgrades.ts). Descend ends a run, so only the
 * run's tycoon can perform it; here it is a no-op. Imports only data, types and the save type, so the node tests load it.
 */
import type { SaveStore } from '@/core/save';
import type { MetaState, PrestigeApi } from '@/game/tycoon.types';
import { META_NODES, applyMetaBuy, metaBuyBlock } from '@/game/data/upgrades';

const copyMeta = (m: MetaState): MetaState => ({ ...m, nodes: { ...m.nodes }, unlocked: [...m.unlocked] });

/** The meta tree on the save, for use with no run alive. Writes go through `save.update` and are flushed at once. */
export function createMetaPrestige(save: SaveStore): PrestigeApi {
  return {
    state: () => copyMeta(save.data.meta),
    preview: () => ({ obols: 0, multiplier: 1 }),
    descend: async (): Promise<void> => { /* Descend ends a run: only the run's tycoon performs it. */ },
    buyNode(id: string): boolean {
      const n = META_NODES.find((x) => x.id === id);
      if (!n || metaBuyBlock(save.data.meta, n) !== null) return false;
      save.update((d) => { applyMetaBuy(d.meta, n); });
      save.flush();
      return true;
    },
    nodes: () => META_NODES,
    registerNode: () => () => {},
  };
}
