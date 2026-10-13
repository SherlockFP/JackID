/**
 * Tycoon visual helper for machine models (GAME-TYCOON, DECISIONS C26). `MachineBase._build` hides every
 * `model.upgradeVisuals` entry; the world calls {@link setUpgradeVisuals} with the visual ids this instance has
 * reached, so a machine never has to know which milestone it is on. Pure: no three construction, no DOM.
 */
import type { MachineModel } from './types';
import type { MilestoneDef, UpgradeView } from '@/game/tycoon.types';

/** Visual ids reached by the given track views (a milestone's `visual` with `level ≤ track level`). */
export function reachedVisuals(views: readonly UpgradeView[]): Set<string> {
  const out = new Set<string>();
  for (const v of views) {
    const ms = (v.def as { readonly milestones?: readonly MilestoneDef[] }).milestones ?? [];
    for (const m of ms) if (m.level <= v.level && m.visual) out.add(m.visual);
  }
  return out;
}

/** Show exactly the `upgradeVisuals` whose key is in `shown`; hide the rest. Missing keys are ignored. */
export function setUpgradeVisuals(model: Pick<MachineModel<object>, 'upgradeVisuals'>, shown: ReadonlySet<string>): void {
  const vis = model.upgradeVisuals;
  if (!vis) return;
  for (const [key, obj] of Object.entries(vis)) obj.visible = shown.has(key);
}
