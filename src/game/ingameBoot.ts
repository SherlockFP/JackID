/**
 * The lazy half of boot: everything that registers itself for a run (machines and their strings, story cutscenes) plus the
 * in-game state, in one chunk the menu never pays for. main.ts loads it behind `lazyState`; it must finish before the first `enter`.
 */
import type { AppStateHandler } from '@/core/states';
import type { CutsceneDef, CutscenePlayer } from '@/core/cutscene/types';
import * as registry from '@/machines/_base/registry';
import { createInGameState } from './inGameState';

const cutsceneModules = import.meta.glob<{ default: CutsceneDef }>('./**/*.cutscene.ts', { eager: true });

export function loadInGame(cutscene: CutscenePlayer, ready: () => Promise<unknown>): Promise<AppStateHandler<'ingame'>> {
  registry.load();
  for (const m of Object.values(cutsceneModules)) cutscene.register(m.default);
  return ready().then(() => createInGameState());
}
