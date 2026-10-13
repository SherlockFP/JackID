/**
 * In-game app state (TECH_SPEC §1.5, §8). Two modes until the full run lands:
 *  - `params.bench` set (`/?bench=<id>`): the single-machine test room. `createBench` builds the world, the player and
 *    the debug run; `app.world` / `app.player` / `app.run` point at them while this state is active.
 *  - otherwise the TD stub: an empty world, a passive player and a back button.
 * Both share one scene; the frame loop renders whatever `app.world` is.
 */
import * as THREE from 'three';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import * as registry from '@/machines/_base/registry';
import type { Bench } from '@/world/bench';
import { createWorld } from '@/world/world';
import { createLocalPlayer } from '@/player/local';

export function createInGameState(): AppStateHandler<'ingame'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101019);
  scene.fog = new THREE.Fog(0x101019, 4, 26);
  let bench: Bench | null = null;

  let left = false;

  /** Dev tooling is split out of the production bundle: `?bench=` is honoured only in a DEV build (DECISIONS G). */
  const enterBench = async (requested: string, seed: number): Promise<void> => {
    const [{ createBench }, demoTable] = await Promise.all([import('@/world/bench'), import('@/machines/_base/demoTable')]);
    if (left) return;
    if (requested.replace(/_/g, '') === demoTable.def.id) registry.registerExtra(demoTable);   // the reference table is bench-only
    const machineId = registry.resolve(requested);
    if (!machineId) throw new Error(`bench: unknown machine "${requested}"`);   // app.go returns to the menu
    bench = createBench({ machineId, seed, scene });
    app.world = bench.world;
    app.run = bench.run;
    app.player = bench.player;
  };

  const enterStub = (): void => {
    const world = createWorld({ mode: 'free', seed: 0 }, app.camera);
    scene.add(world.root);
    app.world = world;
    app.player = createLocalPlayer(app.camera);
    app.camera.position.copy(app.player.pos);
    app.camera.rotation.set(0, 0, 0);
    app.input.setMode('walk');
    app.ui.toast(t('ui.stub.ingame'), 'sys', 4);
    app.ui.panel('ingame-back', (el) => {
      el.style.cssText = 'position:absolute;right:3%;top:3%;';
      const b = document.createElement('button');
      b.textContent = t('common.back');
      b.style.cssText = 'font:inherit;color:inherit;background:#292131;border:calc(var(--px)*1px) solid #8c6b29;padding:calc(var(--px)*2px) calc(var(--px)*8px);cursor:pointer';
      b.onclick = () => { void app.go('menu', undefined); };
      el.appendChild(b);
    });
  };

  return {
    enter(params) {
      left = false;
      if (params.bench && import.meta.env.DEV) return enterBench(params.bench, params.seed);
      enterStub();
    },
    exit() {
      left = true;
      if (bench) {
        bench.dispose();
        bench = null;
      } else {
        app.ui.closePanel('ingame-back');
        app.world?.dispose();
      }
      app.world = null; app.player = null; app.run = null;
    },
    fixedUpdate(dt) { app.world?.fixedUpdate(dt); },
    frame(dt) {
      app.world?.frame(dt, app.time.sim);
      app.renderer.render(scene, app.camera);
    },
  };
}
