/**
 * Results / death screen state (GDD §9.9 "The Sump"). Owner: HUD lane. Keep the factory name `createResultsState`.
 *
 * Enter: draws the receipt over a dark pit, prints it line by line and stamps it. Keys: Enter = CLIMB AGAIN (a new run on
 * the same mode, seed + 1), Esc = BACK TO THE JACKPOT (menu). Space or Enter while printing skips the print. The physical
 * choices in the Sump (rope ladder, MENU coin, JackID, corkboard, ferryman's bowl) call the same two actions from the
 * world once that scene exists.
 */
import * as THREE from 'three';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import type { UIOverlayX } from '@/core/ui/ui';
import type { RunSummary } from '@/net/protocol';
import { buildReceipt, type Receipt } from './hud/results';

export function createResultsState(): AppStateHandler<'results'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080808);
  let overlay: HTMLElement | null = null;
  let receipt: Receipt | null = null;
  let summary: RunSummary | null = null;
  let leaving = false;
  let printing = false;

  const again = (): void => {
    if (leaving || !summary) return;
    leaving = true;
    void app.go('ingame', { mode: summary.mode, seed: (summary.seed + 1) >>> 0, online: false });
  };
  const menu = (): void => {
    if (leaving) return;
    leaving = true;
    void app.go('menu', undefined);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (leaving) return;
    if (e.code === 'Escape') { e.preventDefault(); menu(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (printing) receipt?.finish(); else again();
      return;
    }
    if (e.code === 'Space' && printing) { e.preventDefault(); receipt?.finish(); }
  };

  return {
    enter(params) {
      leaving = false;
      summary = params.summary;
      const host = (app.ui as UIOverlayX).root;
      overlay = document.createElement('div');
      overlay.className = 'hud-results';
      overlay.style.cssText = 'position:absolute;inset:0;z-index:50;pointer-events:auto;';
      host.appendChild(overlay);
      receipt = buildReceipt(params.summary, { onAgain: again, onMenu: menu });
      overlay.appendChild(receipt.el);
      app.input.setMode('ui');
      overlay.tabIndex = -1;
      overlay.addEventListener('keydown', onKey);
      overlay.focus({ preventScroll: true });
      printing = true;
      void receipt.print().finally(() => { printing = false; });
    },
    exit() {
      overlay?.removeEventListener('keydown', onKey);
      receipt?.dispose();
      receipt = null;
      overlay?.remove();
      overlay = null;
      summary = null;
    },
    fixedUpdate() {},
    frame() {
      app.renderer.render(scene, app.camera);
    },
  };
}
