/**
 * Main menu (menu-3d). A fully 3D PSX scene, no DOM menu screens: a giant glowing die inside a dark jackpot
 * cabinet. Each die face is a menu entry (PLAY · MULTIPLAYER · FREE CASINO · SETTINGS · CREDITS · QUIT).
 * Roll the die with the arrow keys / WASD or by dragging it; click or Enter selects the face toward the camera.
 * SETTINGS rolls in a second, smaller die whose faces are AUDIO · MUSIC · GRAPHICS · CONTROLS · LANGUAGE · BACK;
 * left/right change the value painted on the front face. PLAY runs the burst-out and enters the Debt Run.
 *
 * Keep the factory name `createMenuState` (main.ts). Owner: MENU-3D.
 */
import * as THREE from 'three';
import { openServerBrowser } from './serverBrowser';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { hashSeed, randomSeed } from '@/core/rng';
import { openSettingsScreen } from '@/core/ui/settingsScreen';
import { openKitPicker } from './kitPicker';
import { buildCabinet, DIE_CENTER, type Cabinet } from './menuCabinet';
import { MenuDie, easeOutBack, type DieHit } from './menuDie';
import { MenuBurst } from './menuBurst';
import { paintDieFace, paintPanel, paintValueFace } from './menuArt';

const MAIN_FACES = ['multi', 'settings', 'credits', 'quit', 'play', 'free'] as const;
// Six faces per cube: BACK gave way to CALM (Esc / Backspace still close the settings die).
const SET_FACES = ['language', 'calm', 'music', 'controls', 'audio', 'graphics'] as const;
type MainItem = typeof MAIN_FACES[number];
type SetItem = typeof SET_FACES[number];
/** Per-value steps for the controls face (mouse sensitivity). */
const SENS = [0.001, 0.0022, 0.0035, 0.005];
const SETTINGS_DIE_SCALE = 0.75;
const CAM_FOV = 50;
const CAB_HALF_WIDTH = 3.1;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const LEFT = new THREE.Vector3(-1, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const TOWARD = new THREE.Vector3(0, 0, 1);

type Phase = 'main' | 'busy' | 'settings' | 'info' | 'burst';
/** `fn` receives the raw 0..1 progress and applies its own easing. */
interface Tween { t: number; dur: number; fn: (k: number) => void; done?: () => void }
interface Press { x: number; y: number; lastX: number; lastY: number; die: MenuDie; hit: DieHit | null; moved: boolean }

const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number): string[] {
  ctx.font = `${px}px "VT323", monospace`;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxW || !line) line = trial;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

export function createMenuState(): AppStateHandler<'menu'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050208);
  scene.fog = new THREE.Fog(0x050208, 11, 26);
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x2a0a18, 0.9));

  const cab: Cabinet = buildCabinet();
  scene.add(cab.root);

  const mainDie = new MenuDie(1.9);
  mainDie.base.copy(DIE_CENTER);
  scene.add(mainDie.root);
  const setDie = new MenuDie(1.9);
  setDie.base.copy(DIE_CENTER);
  setDie.root.scale.setScalar(SETTINGS_DIE_SCALE);
  setDie.root.visible = false;
  scene.add(setDie.root);
  const burst = new MenuBurst(scene, mainDie, cab);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tweens: Tween[] = [];
  let phase: Phase = 'main';
  let time = 0;
  let leaving = false;
  let press: Press | null = null;
  let hoverFace = -1;
  let hoverDie: MenuDie | null = null;
  let lastHoverSound = -1;
  let lastFocusKey = '';
  let infoKind: 'credits' | 'quit' = 'credits';
  let unsubSettings: (() => void) | null = null;
  let attached = false;

  const tween = (dur: number, fn: (k: number) => void, done?: () => void): void => {
    tweens.push({ t: 0, dur, fn, done });
  };

  const settings = () => app.save.data.settings;
  const activeDie = (): MenuDie => (setDie.root.visible ? setDie : mainDie);

  // ── painting ────────────────────────────────────────────────────────────────────────────────────

  const paintMain = (i: number): void => {
    const item: MainItem = MAIN_FACES[i];
    mainDie.paint(i, (c, w, h) => paintDieFace(c, w, h, { label: t(`menu.face.${item}`), icon: item, lit: false }));
  };

  const valueOf = (item: Exclude<SetItem, 'language'>): { value: string; sub: string } => {
    const s = settings();
    const bar = (v: number): string => `[${'#'.repeat(Math.round(v * 10))}${'.'.repeat(10 - Math.round(v * 10))}]`;
    switch (item) {
      case 'audio': return { value: `${Math.round(s.vol.master * 100)}%`, sub: bar(s.vol.master) };
      case 'music': return { value: `${Math.round(s.vol.music * 100)}%`, sub: bar(s.vol.music) };
      case 'calm': return { value: t(s.calm ? 'menu.val.on' : 'menu.val.off'), sub: '' };
      case 'graphics': return { value: t(s.psx.enabled ? 'menu.val.on' : 'menu.val.off'), sub: `${s.psx.targetHeight}p` };
      case 'controls': {
        const n = nearestSens(s.mouseSens) + 1;
        return { value: t('menu.val.sens', { n }), sub: '' };
      }
    }
  };

  const paintSet = (i: number): void => {
    const item: SetItem = SET_FACES[i];
    if (item === 'language') {
      const v = settings().lang === 'tr' ? t('menu.val.tr') : t('menu.val.en');
      setDie.paint(i, (c, w, h) => paintValueFace(c, w, h, { label: t('menu.face.language'), value: v, sub: '', lit: false }));
      return;
    }
    const v = valueOf(item);
    setDie.paint(i, (c, w, h) => paintValueFace(c, w, h, { label: t(`menu.face.${item}`), value: v.value, sub: v.sub, lit: false }));
  };

  const paintContext = (item: string, hintKey: string): void => {
    const ctx = cab.context.ctx;
    const lines = wrapLines(ctx, t(`menu.desc.${item}`), 640 * 0.86, 28).slice(0, 2);
    cab.context.paint((c, w, h) => paintPanel(c, w, h, {
      title: t(`menu.face.${item}`), lines, hint: t(hintKey), bodyPx: 28, titlePx: 40, hintPx: 22,
    }));
  };

  const paintInfo = (): void => {
    const ctx = cab.info.ctx;
    const body = infoKind === 'credits' ? t('menu.credits.body').split('|') : [t('menu.quit.body')];
    const lines = body.flatMap((l) => wrapLines(ctx, l, 640 * 0.86, 30));
    const title = t(infoKind === 'credits' ? 'menu.credits.title' : 'menu.quit.title');
    cab.info.paint((c, w, h) => paintPanel(c, w, h, {
      title, lines: lines.slice(0, 6), hint: t('menu.hint.info'), bodyPx: 30, titlePx: 48, hintPx: 24,
    }));
  };

  const repaintAll = (): void => {
    for (let i = 0; i < 6; i++) { paintMain(i); paintSet(i); }
    lastFocusKey = '';
    if (phase === 'info') paintInfo();
  };

  // ── audio/juice helpers ─────────────────────────────────────────────────────────────────────────

  const sfx = (name: string, vol = 1): void => { app.audio.play(name, { bus: 'ui', vol }); };

  const nearestSens = (v: number): number => {
    let best = 0;
    for (let i = 1; i < SENS.length; i++) if (Math.abs(SENS[i] - v) < Math.abs(SENS[best] - v)) best = i;
    return best;
  };

  const popAt = (die: MenuDie, text: string): void => {
    const at = die.base.clone().add(new THREE.Vector3(0, 1.0, 0.2));
    app.fx.popText(at, text, 0xffd98a, 0.8);
    app.fx.squash(die.mesh, 0.14, 0.22);
  };

  // ── die rolling ────────────────────────────────────────────────────────────────────────────────

  const rollDie = (die: MenuDie, face: number): void => {
    if (die.rolling || face === die.frontFace()) return;
    sfx('dice');
    cab.spinReels(0.55);
    die.rollTo(face, () => {
      sfx('diceLand', 0.8);
      app.fx.dust(die.base.clone().add(new THREE.Vector3(0, -0.85, 0)), 10);
      app.fx.shake(0.03, 0.14);
    });
  };

  // ── actions ────────────────────────────────────────────────────────────────────────────────────

  const startPlay = (): void => {
    if (leaving || phase !== 'main') return;
    phase = 'burst';
    cab.pullLever();
    cab.spinReels(1.4);
    app.audio.music.stinger('ascend');
    app.ui.toast(t('menu.burst.toast'), 'sys', 2.5);
    burst.start();
  };

  const goFree = (): void => {
    if (leaving) return;
    leaving = true;
    sfx('whoosh');
    app.fx.flash(0xffffff, 0.8, 0.35);
    void app.go('ingame', { mode: 'free', seed: hashSeed('free', randomSeed()), online: false });
  };

  const goMulti = (): void => {
    if (leaving) return;
    sfx('click');
    openServerBrowser();
  };

  const openSettings = (): void => {
    if (phase !== 'main') return;
    phase = 'busy';
    sfx('whoosh');
    setDie.root.visible = true;
    setDie.root.scale.setScalar(SETTINGS_DIE_SCALE);
    setDie.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0.4, 1, 0.2).normalize(), 2.6);
    setDie.base.set(-2.4, DIE_CENTER.y, DIE_CENTER.z);
    tween(0.32, (k) => mainDie.root.scale.setScalar(Math.max(0.001, 1 - easeOut(k))), () => { mainDie.root.visible = false; mainDie.root.scale.setScalar(1); });
    tween(0.85, (k) => { setDie.base.x = -2.4 * (1 - easeOutBack(k, 0.6)); });
    setDie.rollTo(SET_FACES.indexOf('audio'), () => {
      sfx('diceLand', 0.8);
      phase = 'settings';
      lastFocusKey = '';
    }, 0.9);
    sfx('dice');
    cab.spinReels(0.9);
  };

  const closeSettings = (): void => {
    if (phase !== 'settings') return;
    phase = 'busy';
    sfx('whoosh');
    mainDie.root.visible = true;
    mainDie.root.scale.setScalar(0.001);
    tween(0.25, (k) => { setDie.base.x = -2.4 * easeOut(k); setDie.root.scale.setScalar(SETTINGS_DIE_SCALE * (1 - easeOut(k))); }, () => { setDie.root.visible = false; });
    tween(0.42, (k) => mainDie.root.scale.setScalar(Math.max(0.001, easeOutBack(k, 0.8))), () => {
      mainDie.root.scale.setScalar(1);
      phase = 'main';
      lastFocusKey = '';
    });
    setDie.base.copy(DIE_CENTER);
  };

  const openInfo = (kind: 'credits' | 'quit'): void => {
    if (phase !== 'main') return;
    phase = 'info';
    infoKind = kind;
    paintInfo();
    cab.infoMesh.visible = true;
    cab.infoMesh.scale.setScalar(0.001);
    sfx('chime');
    tween(0.45, (k) => cab.infoMesh.scale.setScalar(Math.max(0.001, easeOutBack(k, 1.1))));
    // (k is the raw progress; easeOutBack supplies the overshoot)
  };

  const closeInfo = (): void => {
    if (phase !== 'info') return;
    phase = 'busy';
    sfx('whoosh');
    tween(0.2, (k) => cab.infoMesh.scale.setScalar(Math.max(0.001, 1 - easeOut(k))), () => {
      cab.infoMesh.visible = false;
      phase = 'main';
      lastFocusKey = '';
    });
  };

  /** Change the value on a settings face. `dir` is -1 / +1 (language toggles either way). */
  const adjust = (item: SetItem, dir: number): void => {
    const s = settings();
    switch (item) {
      case 'audio': {
        const v = Math.round(clamp01(s.vol.master + dir * 0.1) * 10) / 10;
        app.save.setSetting('vol', { ...s.vol, master: v });
        break;
      }
      case 'music': {
        const v = Math.round(clamp01(s.vol.music + dir * 0.1) * 10) / 10;
        app.save.setSetting('vol', { ...s.vol, music: v });
        break;
      }
      case 'graphics':
        app.save.setSetting('psx', { ...s.psx, enabled: !s.psx.enabled });
        break;
      case 'calm':
        app.save.setSetting('calm', !s.calm);
        break;
      case 'controls': {
        const idx = Math.max(0, Math.min(SENS.length - 1, nearestSens(s.mouseSens) + dir));
        app.save.setSetting('mouseSens', SENS[idx]);
        break;
      }
      case 'language':
        app.save.setSetting('lang', s.lang === 'en' ? 'tr' : 'en');
        break;
    }
    sfx('click');
    const face = setDie.frontFace();
    paintSet(face);
    const v = item === 'language' ? (settings().lang === 'tr' ? t('menu.val.tr') : t('menu.val.en')) : valueOf(item as Exclude<SetItem, 'language'>).value;
    popAt(setDie, v);
  };

  const activateMain = (face: number): void => {
    if (phase !== 'main') return;
    switch (MAIN_FACES[face]) {
      case 'play': startPlay(); break;
      case 'multi': goMulti(); break;
      case 'free': goFree(); break;
      case 'settings': sfx('click'); openSettingsScreen(); break;   // the full Settings screen (the settings die below is no longer reached)
      case 'credits': openInfo('credits'); break;
      case 'quit': openInfo('quit'); break;
    }
  };

  const activateSet = (face: number, hit: DieHit | null): void => {
    const item = SET_FACES[face];
    if (item === 'language' || item === 'calm') { adjust(item, 1); return; }
    // a click on the left half of the value lowers it, the right half raises it
    const dir = hit && hit.point.x < setDie.base.x ? -1 : 1;
    adjust(item, dir);
  };

  // ── keyboard ───────────────────────────────────────────────────────────────────────────────────

  const onKey = (e: KeyboardEvent): void => {
    if (leaving || app.input.mode !== 'menu') return;
    const k = e.code;
    const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k);
    if (phase === 'info') {
      if (['Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace'].includes(k)) { e.preventDefault(); closeInfo(); }
      return;
    }
    if (phase !== 'main' && phase !== 'settings') return;
    if (nav) e.preventDefault();
    const enter = k === 'Enter' || k === 'NumpadEnter' || k === 'Space';
    if (phase === 'main') {
      if (k === 'ArrowUp' || k === 'KeyW') rollDie(mainDie, mainDie.faceAt(UP));
      else if (k === 'ArrowDown' || k === 'KeyS') rollDie(mainDie, mainDie.faceAt(DOWN));
      else if (k === 'ArrowLeft' || k === 'KeyA') rollDie(mainDie, mainDie.faceAt(LEFT));
      else if (k === 'ArrowRight' || k === 'KeyD') rollDie(mainDie, mainDie.faceAt(RIGHT));
      else if (enter && !e.repeat && !mainDie.rolling) activateMain(mainDie.frontFace());
      return;
    }
    // settings
    if (k === 'ArrowUp' || k === 'KeyW') rollDie(setDie, setDie.faceAt(UP));
    else if (k === 'ArrowDown' || k === 'KeyS') rollDie(setDie, setDie.faceAt(DOWN));
    else if (k === 'KeyQ') rollDie(setDie, setDie.faceAt(LEFT));
    else if (k === 'KeyE') rollDie(setDie, setDie.faceAt(RIGHT));
    else if (k === 'ArrowLeft' || k === 'KeyA') { if (!setDie.rolling) adjust(SET_FACES[setDie.frontFace()], -1); }
    else if (k === 'ArrowRight' || k === 'KeyD') { if (!setDie.rolling) adjust(SET_FACES[setDie.frontFace()], 1); }
    else if (k === 'Escape' || k === 'Backspace') closeSettings();
    else if (enter && !e.repeat && !setDie.rolling) activateSet(setDie.frontFace(), null);
  };

  // ── pointer ────────────────────────────────────────────────────────────────────────────────────

  const setNdc = (e: MouseEvent): void => {
    const r = app.canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1));
  };

  const pickActive = (die: MenuDie): DieHit | null => {
    ray.setFromCamera(ndc, app.camera);
    return die.pick(ray.intersectObject(die.mesh, false));
  };

  const onDown = (e: PointerEvent): void => {
    if (leaving) return;
    if (phase === 'info') { closeInfo(); return; }
    if (phase !== 'main' && phase !== 'settings') return;
    void app.audio.resume();
    setNdc(e);
    const die = activeDie();
    press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, die, hit: pickActive(die), moved: false };
  };

  const onMove = (e: PointerEvent): void => {
    setNdc(e);
    if (press) {
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (!press.moved && Math.hypot(dx, dy) > 6 && (phase === 'main' || phase === 'settings')) press.moved = true;
      if (press.moved && press.die.root.visible && (phase === 'main' || phase === 'settings')) {
        press.die.drag(e.clientX - press.lastX, e.clientY - press.lastY);
      }
      press.lastX = e.clientX;
      press.lastY = e.clientY;
      return;
    }
    if (phase !== 'main' && phase !== 'settings') return;
    const die = activeDie();
    const hit = pickActive(die);
    const face = hit ? hit.face : -1;
    if (hoverDie !== die || face !== hoverFace) {
      hoverDie?.setHover(-1);
      hoverDie = die;
      hoverFace = face;
      die.setHover(face);
      if (face >= 0 && face !== lastHoverSound) sfx('hover', 0.5);
      lastHoverSound = face;
    }
    app.canvas.style.cursor = hit ? 'pointer' : '';
  };

  const onUp = (e: PointerEvent): void => {
    if (!press) return;
    const p = press;
    press = null;
    if (p.moved) {
      if (!p.die.rolling && (phase === 'main' || phase === 'settings')) p.die.rollTo(p.die.frontFace(), undefined, 0.45);
      return;
    }
    setNdc(e);
    const hit = p.hit ?? pickActive(p.die);
    if (!hit || (phase !== 'main' && phase !== 'settings')) return;
    if (p.die.rolling) return;
    if (hit.face === p.die.frontFace()) {
      if (p.die === mainDie) activateMain(hit.face);
      else activateSet(hit.face, hit);
    } else {
      rollDie(p.die, hit.face);
    }
  };

  const attach = (): void => {
    if (attached) return;
    attached = true;
    window.addEventListener('keydown', onKey);
    app.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    window.removeEventListener('keydown', onKey);
    app.canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    app.canvas.style.cursor = '';
  };

  // ── camera ─────────────────────────────────────────────────────────────────────────────────────

  const cameraDistance = (): number => {
    const tanV = Math.tan((CAM_FOV * Math.PI) / 360);
    const fit = CAB_HALF_WIDTH / (tanV * Math.max(0.2, app.camera.aspect || 1));
    return Math.max(7.2, fit + 0.6);
  };

  return {
    enter(params) {
      leaving = false;
      phase = 'main';
      press = null;
      hoverFace = -1;
      hoverDie = null;
      lastHoverSound = -1;
      lastFocusKey = '';
      cab.infoMesh.visible = false;
      burst.reset();
      mainDie.root.visible = true;
      mainDie.root.scale.setScalar(1);
      setDie.root.visible = false;
      tweens.length = 0;
      app.input.setMode('menu');
      app.camera.fov = CAM_FOV;
      app.camera.updateProjectionMatrix();
      repaintAll();
      app.audio.music.setState('menu', { fade: 1.2 });
      app.audio.ambience('menu', 1.5);
      unsubSettings?.();
      unsubSettings = bus.on('settings:changed', ({ key }) => {
        if (key === 'lang' || key === 'vol' || key === 'psx' || key === 'mouseSens') repaintAll();
      });
      attach();
      if (params?.toast) app.ui.toast(params.toast, 'warn');
    },
    exit() {
      detach();
      unsubSettings?.();
      unsubSettings = null;
      press = null;
      tweens.length = 0;
      burst.reset();
      cab.infoMesh.visible = false;
      setDie.root.visible = false;
      app.camera.fov = app.save.data.settings.fov;
      app.camera.updateProjectionMatrix();
    },
    fixedUpdate() {},
    frame(dt) {
      time += dt;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i];
        tw.t += dt;
        const k = clamp01(tw.t / tw.dur);
        tw.fn(k);
        if (k >= 1) {
          tweens.splice(i, 1);
          tw.done?.();
        }
      }
      mainDie.update(dt);
      setDie.update(dt);
      cab.update(dt, time);
      // focus caption under the glass follows the die once it stops rolling
      const onSet = setDie.root.visible && phase !== 'main';
      const die = onSet ? setDie : mainDie;
      if (!die.rolling && phase !== 'burst' && phase !== 'info') {
        const item = onSet ? SET_FACES[die.frontFace()] : MAIN_FACES[die.frontFace()];
        const key = `${onSet ? 's' : 'm'}:${item}`;
        if (key !== lastFocusKey) {
          lastFocusKey = key;
          paintContext(item, onSet ? 'menu.hint.settings' : 'menu.hint.roll');
        }
      }
      if (phase === 'burst') {
        burst.update(dt);
        if (burst.done && !leaving) {
          leaving = true;
          // Starting-kit picker (WAVE8 item 6) sits between the burst and the run. Its pick travels as `RunConfig.kit`.
          const seed = hashSeed('run', randomSeed());
          openKitPicker((kit) => {
            // Only the kit id travels here; session.ts hands it to createRun, which fills the rest of the defaults.
            void app.go('ingame', { mode: 'debt', seed, online: false, config: { kit } });
          });
        }
      }
      const dist = cameraDistance() - burst.dolly * 1.6;
      app.camera.position.set(0, 0.12, dist);
      app.camera.lookAt(0, DIE_CENTER.y - 0.05, 0);
      app.renderer.render(scene, app.camera);
    },
  };
}
