/**
 * Mode registry. Co-op and Versus (GDD §7.2–7.3) are milestone M3: they are not playable yet, so the main menu and
 * `createRun` must never select them. `playableMode()` is the single guard every entry point goes through.
 */
import type { GameMode } from '@/core/types';
import type { ModeRules } from './types';
import { DEBT_RULES } from './debt';
import { FREE_RULES } from './free';

export type { ModeRules } from './types';

/** Modes a player can start today. The menu lists exactly these. */
export const PLAYABLE_MODES: readonly GameMode[] = ['debt', 'free'];

/** True when the mode can be started now (M3 modes return false). */
export function isPlayableMode(mode: GameMode): boolean {
  return PLAYABLE_MODES.includes(mode);
}

/** Returns `mode` when playable, otherwise the default Debt Run. Saves and menus never throw on an unshipped mode. */
export function playableMode(mode: GameMode | undefined): GameMode {
  return mode !== undefined && isPlayableMode(mode) ? mode : 'debt';
}

export function rulesFor(mode: GameMode): ModeRules {
  switch (mode) {
    case 'debt': return DEBT_RULES;
    case 'free': return FREE_RULES;
    case 'coop':
    case 'versus':
      throw new Error(`game mode "${mode}" is not implemented yet (milestone M3)`);
  }
}
