/**
 * STUB — owned by MENU-3D (panels: MENU-UI). A spinning gold cube and three DOM buttons, just enough to prove
 * the boot → menu → ingame → menu state machine, i18n and the render path. The real menu is the 3D
 * "inside the jackpot" scene (ART_BIBLE §7). Keep the factory name `createMenuState`.
 */
import * as THREE from 'three';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { lang, setLang, t } from '@/core/i18n';
import { hashSeed } from '@/core/rng';
import { psxMaterial } from '@/core/renderer/psxMaterial';

export function createMenuState(): AppStateHandler<'menu'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080808);
  scene.add(new THREE.HemisphereLight(0xfff2c8, 0x290f31, 1.4));
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), psxMaterial({ color: 0xc59c42 }));
  scene.add(cube);
  let spin = 0;

  return {
    enter(params) {
      app.input.setMode('menu');
      app.camera.position.set(0, 0.4, 4);
      app.camera.lookAt(0, 0, 0);
      app.ui.panel('menu', (el) => {
        el.style.cssText = 'position:absolute;left:8%;top:30%;text-align:left;';
        const h = document.createElement('h1');
        h.textContent = t('ui.title');
        h.style.cssText = "font-family:'Press Start 2P',monospace;font-size:calc(var(--px)*12px);margin:0 0 calc(var(--px)*8px)";
        el.appendChild(h);
        const mk = (label: string, fn: () => void): void => {
          const b = document.createElement('button');
          b.textContent = label;
          b.style.cssText = 'display:block;font:inherit;color:inherit;background:#292131;border:calc(var(--px)*1px) solid #8c6b29;margin:calc(var(--px)*2px) 0;padding:calc(var(--px)*2px) calc(var(--px)*8px);cursor:pointer';
          b.onclick = () => { void app.audio.resume(); fn(); };
          el.appendChild(b);
        };
        mk(t('ui.stub.play'), () => { void app.go('ingame', { mode: 'free', seed: hashSeed('stub', Date.now()), online: false }); });
        mk(t('ui.stub.lang'), () => {
          const next = lang() === 'en' ? 'tr' : 'en';
          app.save.setSetting('lang', next);
          setLang(next);
          void app.go('menu', undefined);
        });
        const hint = document.createElement('p');
        hint.textContent = t('ui.stub.hint');
        hint.style.opacity = '0.7';
        el.appendChild(hint);
      });
      if (params?.toast) app.ui.toast(params.toast, 'warn');
    },
    exit() { app.ui.closePanel('menu'); },
    fixedUpdate() {},
    frame(dt) {
      spin += dt;
      cube.rotation.set(spin * 0.4, spin, 0);
      app.renderer.render(scene, app.camera);
    },
  };
}
