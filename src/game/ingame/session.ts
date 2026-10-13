/**
 * Debt Run session (single player, TECH §8): builds the pit (`createWorld` places the registered machines into the GDD
 * slots), the FPS player at the lobby spawn, the run (`createRun` / `resumeRun`) and the HUD, and drives them each step.
 * Owned by the in-game state (`inGameState.ts`), which handles pause, the Intermission panel and the run-end hand-off.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { log } from '@/core/log';
import { t } from '@/core/i18n';
import type { InGameParams } from '@/core/states';
import { makeFog } from '@/core/renderer/fog';
import { createWorld, type WorldHost } from '@/world/world';
import { createLocalPlayer, type LocalPlayerHost } from '@/player/local';
import { createHud, type Hud, type HudPrompt } from '@/menu/hud';
import { createRun, resumeRun, type DebtRun } from '@/game/run';
import { playableMode } from '@/game/modes';

export interface DebtSession {
  readonly world: WorldHost;
  readonly player: LocalPlayerHost;
  readonly run: DebtRun;
  readonly hud: Hud;
  /** True once the initial machine build has finished (the Intermission waits for it). */
  readonly ready: () => boolean;
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;
  dispose(): void;
}

const LOBBY_FOG = 0x0d0a06;
const LOBBY_NEAR = 6;

export function startDebtSession(params: InGameParams, scene: THREE.Scene): DebtSession {
  // The run exists before the world: machines read `app.run` (wallet, tycoon) while they are built.
  const run = (params.resume ? resumeRun(app.save) : null)
    ?? createRun({ seed: params.seed, mode: playableMode(params.mode), save: app.save });
  app.run = run;

  scene.background = new THREE.Color(LOBBY_FOG);
  scene.fog = makeFog(LOBBY_FOG, LOBBY_NEAR, app.save.data.settings.psx.drawDistance);

  const world = createWorld({ mode: run.mode, seed: run.seed }, app.camera);
  scene.add(world.root);
  app.world = world;

  const player = createLocalPlayer(app.camera);
  app.player = player;
  const spawn = world.spawn('solo');
  player.teleport(new THREE.Vector3(spawn.pos[0], spawn.pos[1], spawn.pos[2]), spawn.yaw);
  app.input.setMode('walk');

  const hud = createHud();
  let ready = false;
  world.ready.then(() => { ready = true; }, (e: unknown) => log.error('ingame', 'world build failed', e));
  void world.prebuild().catch((e: unknown) => log.error('ingame', 'prebuild failed', e));
  app.ui.toast(t('ingame.loading'), 'sys', 2);

  let promptKey = '';
  const updatePrompt = (): void => {
    const f = app.input.mode === 'walk' ? world.interact.focused : null;
    const key = f ? `${f.id}|${f.label()}` : '';
    if (key === promptKey) return;
    promptKey = key;
    const p: HudPrompt | null = f ? { action: 'interact', label: f.label(), sub: f.sub?.() } : null;
    hud.setPrompt(p);
  };

  const flush = (): void => run.flush();
  window.addEventListener('pagehide', flush);

  return {
    world, player, run, hud,
    ready: () => ready,
    fixedUpdate(dt) {
      player.fixedUpdate(dt);
      world.fixedUpdate(dt);
      run.tick(dt);
    },
    frame(dt, alpha) {
      player.frame(dt, alpha);
      world.frame(dt, app.time.sim);
      hud.update(dt);
      updatePrompt();
    },
    dispose() {
      window.removeEventListener('pagehide', flush);
      hud.setPrompt(null);
      hud.dispose();
      player.dispose();
      scene.remove(world.root);
      world.dispose();
      run.flush();
      app.world = null; app.player = null; app.run = null;
    },
  };
}
