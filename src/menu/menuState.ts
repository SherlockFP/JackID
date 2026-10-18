/**
 * Main menu (menu-3d). Driven ONLY by the 3D dice: no DOM overlay. Everything the player reads is painted in the scene:
 * the JACKID marquee on top of the cabinet, each die face's label (the menu entry), and a panel under the glass with
 * the focused entry's description (and the credits / quit card when opened).
 * Roll the die with the arrow keys / WASD, the mouse wheel, or by dragging it; a click on the face toward the camera
 * (or Enter / Space) selects it. A face that is not toward the camera is rolled to on click.
 * When a run is saved, the QUIT face becomes CONTINUE RUN. The credits have no face: key I, or the CREDITS button under
 * the SETTINGS face's text, opens them (a press closes them and returns to the die).
 * SETTINGS opens the full settings screen. PLAY runs the burst-out and enters the Debt Run (via the kit picker).
 *
 * Keep the factory name `createMenuState` (main.ts). Owner: MENU-3D.
 */
import * as THREE from 'three';
import { openServerBrowser } from './serverBrowser';
import type { AppStateHandler } from '@/core/states';
import type { RunSnapshot } from '@/net/protocol';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { hashSeed, randomSeed } from '@/core/rng';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { crispRaycaster, crispTexture, markCrisp, releaseCrisp } from '@/core/ui/textOverlay';
import { openSettingsScreen } from '@/core/ui/settingsScreen';
import { openKitPicker } from './kitPicker';
import { openFoundations } from './foundations';
import { createMetaPrestige } from './foundations.logic';
import { buildBackdrop, type Backdrop } from './menuBackdrop';
import { buildDrums, type Drums } from './menuDrums';
import { buildCabinet, DIE_CENTER, type Cabinet } from './menuCabinet';
import { MenuDie, easeOutBack, type DieHit } from './menuDie';
import { MenuBurst } from './menuBurst';
import { bodyText, makeCanvasTex, paintDieFace, paintPanel, paintValueFace, panelText, PANEL_BUTTON, type CanvasTex, type PanelOpts } from './menuArt';

// Face order = BoxGeometry groups (+X, -X, +Y, -Y, +Z, -Z): PLAY faces you, MULTIPLAYER is one roll right, SETTINGS left,
// FREE CASINO up, QUIT down (CONTINUE RUN takes that face while a run is saved), FOUNDATIONS round the back.
const MAIN_FACES = ['multi', 'settings', 'free', 'quit', 'play', 'foundations'] as const;
// Six faces per cube: BACK gave way to CALM (Esc / Backspace still close the settings die).
const SET_FACES = ['language', 'calm', 'music', 'controls', 'audio', 'graphics'] as const;
type MainItem = typeof MAIN_FACES[number];
/** What a main-die face shows: its entry, or CONTINUE RUN on the QUIT face while a run is saved. */
type FaceItem = MainItem | 'continue';
type SetItem = typeof SET_FACES[number];
/** The 3D text panel under the glass: a 960 x 480 texture on a 3.2 x 1.6 m plane. It sits between the die's bottom
 *  edge (about y -1.2) and the casino floor, which hides anything below about y -2.9 at this depth. The panel is drawn
 *  in the crisp (native-resolution) pass, so the text is not smeared by the PSX low-res target. */
const PANEL_PX = { w: 1120, h: 480 };
const PANEL_M = { w: 4.48, h: 1.92 };
const PANEL_AT = new THREE.Vector3(0, -2.32, 1.31);   // in front of the cabinet's bottom bezel and the glass (GLASS_Z 1.16)
/** The JACKID marquee (the cabinet paints it; its own plane stays hidden): 512 x 96 texture on the same aspect. */
const TITLE_AT = new THREE.Vector3(0, 2.75, 0.78);
const TITLE_M = { w: 4.2, h: 4.2 * 96 / 512 };
/** Per-value steps for the controls face (mouse sensitivity). */
const SENS = [0.001, 0.0022, 0.0035, 0.005];
const SETTINGS_DIE_SCALE = 0.75;
const MAIN_DIE_SIZE = 2.5;
const LOOK_Y = 0.0;   // was 0.5: the view sits a little lower, so the info panel under the glass has room at the bottom
const CAM_FOV = 50;
const CAB_HALF_WIDTH = 2.9;
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

export function createMenuState(): AppStateHandler<'menu'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050208);
  scene.fog = new THREE.Fog(0x050208, 16, 46);
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x2a0a18, 0.9));

  const cab: Cabinet = buildCabinet();
  scene.add(cab.root);

  const backdrop: Backdrop = buildBackdrop();
  scene.add(backdrop.root);

  // Giant reel drums close to the camera (left / right / top): the menu is read from inside the machine.
  const drums: Drums = buildDrums();
  scene.add(drums.root);

  const mainDie = new MenuDie(MAIN_DIE_SIZE);
  mainDie.base.copy(DIE_CENTER);
  scene.add(mainDie.root);
  const setDie = new MenuDie(1.9);
  setDie.base.copy(DIE_CENTER);
  setDie.root.scale.setScalar(SETTINGS_DIE_SCALE);
  setDie.root.visible = false;
  scene.add(setDie.root);
  const burst = new MenuBurst(scene, mainDie, cab);

  // Ultra-wide (21:9) framing: the two side reels sit at the frame edges, which leaves a dark gap between them and the cabinet.
  // Two slimmer reels (clones of the side drums: shared geometry and materials) fill it, so the cabinet reads as the middle of a
  // row of reels instead of a narrow column. They only show past 2:1, and their spin follows the real drums.
  const sideReels: Array<{ g: THREE.Object3D; from: THREE.Object3D; k: number }> = [];
  for (const [i, from] of [drums.root.children[0], drums.root.children[1]].entries()) {
    if (!from) continue;
    const g = from.clone(true);
    g.scale.setScalar(0.64);
    g.position.set(i === 0 ? -3.95 : 3.95, 0.4, 1.7);
    g.visible = false;
    scene.add(g);
    sideReels.push({ g, from, k: -1.3 });
  }
  const frameWide = (): void => {
    const a = app.camera.aspect || 1;
    const on = a > 2.0;
    for (const r of sideReels) {
      if (r.g.visible !== on) r.g.visible = on;
      if (on) { const sp = r.g.children[0], src = r.from.children[0]; if (sp && src) sp.rotation.y = src.rotation.y * r.k; }
    }
  };

  // Text in the scene (the menu has no DOM overlay): the marquee's JACKID texture as the title, and one canvas panel
  // under the glass for the focused entry, the credits and the quit card.
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(TITLE_M.w, TITLE_M.h), psxMaterial({ map: cab.marquee.tex, color: 0xffffff, lit: false }));
  titleMesh.position.copy(TITLE_AT);
  scene.add(titleMesh);
  const panel: CanvasTex = makeCanvasTex(PANEL_PX.w, PANEL_PX.h);
  crispTexture(panel.tex);   // linear + mipmapped: the text is drawn smaller than its texture and must not shimmer
  const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_M.w, PANEL_M.h), psxMaterial({ map: panel.tex, color: 0xffffff, lit: false }));
  panelMesh.position.copy(PANEL_AT);
  // the panel lives in its own scene, drawn by the crisp pass (menuState's frame hands it to the renderer as the overlay)
  const panelScene = new THREE.Scene();
  panelScene.add(panelMesh);

  const ray = crispRaycaster(new THREE.Raycaster());   // also hits the crisp panel (its CREDITS button)
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
  let panelButton = false;                 // the panel now shows the CREDITS button (the SETTINGS face is in front)
  let infoFrom: 'main' | 'settings' = 'main';   // the phase the credits / quit card came from
  let unsubSettings: (() => void) | null = null;
  let attached = false;
  let sub = false;                         // the Foundations screen is open over the menu
  let camX = 0, camY = 0;                  // parallax, smoothed

  const tween = (dur: number, fn: (k: number) => void, done?: () => void): void => {
    tweens.push({ t: 0, dur, fn, done });
  };

  /** The saved run the CONTINUE face offers. Besides the format tag it needs the Watch clock the restore reads
   *  (`WatchClock.restore(e.clock)`): a hand-made or older save without it would throw on resume, so it is not offered. */
  const savedRun = (): RunSnapshot | null => {
    const r = app.save.data.resume as (RunSnapshot & { ext?: { v?: unknown; clock?: { left?: unknown; total?: unknown } } }) | null;
    const ext = r?.ext;
    return r && ext?.v === 1 && typeof ext.clock?.left === 'number' && typeof ext.clock?.total === 'number' ? r : null;
  };

  const settings = () => app.save.data.settings;
  const activeDie = (): MenuDie => (setDie.root.visible ? setDie : mainDie);

  // ── painting ────────────────────────────────────────────────────────────────────────────────────

  /** The entry on main face `i`: the QUIT face becomes CONTINUE RUN while a run is saved. */
  const faceItem = (i: number): FaceItem => {
    const item = MAIN_FACES[i];
    return item === 'quit' && savedRun() ? 'continue' : item;
  };

  const resumeLine = (): string => {
    const r = savedRun();
    return r ? t('menu.cont.sub', { floor: r.shift?.floor ?? 1, shift: (r.shift?.index ?? 0) + 1 }) : '';
  };

  const paintMain = (i: number): void => {
    const item = faceItem(i);
    const cont = item === 'continue';
    mainDie.paint(i, (c, w, h) => paintDieFace(c, w, h, {
      label: t(`menu.face.${item}`), icon: item, lit: cont, sub: cont ? resumeLine() : undefined,
    }));
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

  /** The text panel under the glass (see paintPanel). Any panel without the button clears the CREDITS hit area. */
  const paintInfo = (o: PanelOpts): void => {
    panelButton = Boolean(o.button);
    panel.paint((c, w, h) => {
      // The controls line is set here, not by paintPanel: it is fitted to 84% of the panel width at no more than 0.10 of its
      // height, and sits well above the inner frame line, so the longest Turkish hint never runs into the frame (21:9 report).
      paintPanel(c, w, h, { ...o, hint: undefined });
      if (!o.hint) return;
      let px = Math.round(h * 0.1);
      for (; px > 12; px -= 2) {
        c.font = `${px}px "VT323", monospace`;
        if (c.measureText(o.hint).width <= w * 0.84) break;
      }
      bodyText(c, o.hint, w / 2, h * 0.83, px, '#8fd9ff', 'center');
    });
  };

  /** The focused entry: its name, its description (two lines at most), the control hint and, on the SETTINGS face,
   *  the CREDITS button (click it or press I). */
  const paintFocus = (item: string, descKey: string, hintKey: string): void => {
    paintInfo({
      title: t(`menu.face.${item}`), body: t(descKey), maxLines: 2, hint: t(hintKey),
      button: item === 'settings' ? `${t('menu.face.credits')}  (${t('menu.key.credits')})` : undefined,
    });
  };

  /** Description key of a main entry (PLAY says it replaces a saved run). */
  const mainDescKey = (item: string): string => (item === 'play' && savedRun() ? 'menu.desc.playReplace' : `menu.desc.${item}`);

  const repaintAll = (): void => {
    for (let i = 0; i < 6; i++) { paintMain(i); paintSet(i); }
    lastFocusKey = '';
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

  const rollDie = (die: MenuDie, face: number, then?: () => void): void => {
    if (die.rolling) return;
    if (face === die.frontFace()) { then?.(); return; }
    sfx('dice');
    cab.spinReels(0.55);
    die.rollTo(face, () => {
      sfx('diceLand', 0.8);
      app.fx.dust(die.base.clone().add(new THREE.Vector3(0, -0.85, 0)), 10);
      app.fx.shake(0.03, 0.14);
      then?.();
    });
  };

  // ── actions ────────────────────────────────────────────────────────────────────────────────────

  const startPlay = (): void => {
    if (leaving || phase !== 'main') return;
    phase = 'burst';
    cab.pullLever();
    cab.spinReels(1.4);
    app.audio.music.stinger('ascend');
    paintInfo({ title: t('menu.face.play'), body: t('menu.burst.toast') });
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

  const goFoundations = (): void => {
    if (leaving || sub) return;
    sub = true;
    sfx('click');
    openFoundations({ prestige: createMetaPrestige(app.save), onClose: () => { sub = false; lastFocusKey = ''; } });
  };

  /** Resume the saved run: the same session start as PLAY, with the snapshot attached. */
  const goContinue = (): void => {
    const run = savedRun();
    if (leaving || phase !== 'main' || sub || !run) return;
    leaving = true;
    sfx('whoosh');
    app.audio.play('unlock', { bus: 'ui', vol: 0.8 });
    app.fx.flash(0xffe08a, 0.8, 0.35);
    void app.go('ingame', { mode: run.mode, seed: run.seed, online: false, resume: run });
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

  /** The credits or the quit card, on the 3D panel. Any press closes it (see onKey / onDown); the card returns to the
   *  die it came from (the credits open from the SETTINGS face, or with I from the main die). */
  const openInfo = (kind: 'credits' | 'quit'): void => {
    if (phase !== 'main' && phase !== 'settings') return;
    infoFrom = phase;
    phase = 'info';
    paintInfo(kind === 'credits'
      ? { title: t('menu.credits.title'), body: t('menu.credits.body').split('|'), bodyTop: 0.28, bodyH: 0.5, hint: t('menu.hint.info') }
      : { title: t('menu.quit.title'), body: t('menu.quit.body'), hint: t('menu.hint.info') });
    sfx('chime');
  };

  const closeInfo = (): void => {
    if (phase !== 'info') return;
    sfx('whoosh');
    phase = infoFrom;
    lastFocusKey = '';
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
    switch (faceItem(face)) {
      case 'play': startPlay(); break;
      case 'multi': goMulti(); break;
      case 'free': goFree(); break;
      case 'settings': sfx('click'); openSettingsScreen(); break;   // the full Settings screen (the settings die below is no longer reached)
      case 'foundations': goFoundations(); break;
      case 'quit': openInfo('quit'); break;
      case 'continue': goContinue(); break;
    }
  };

  const openCredits = (): void => { if (!sub && !leaving) openInfo('credits'); };

  const activateSet = (face: number, hit: DieHit | null): void => {
    const item = SET_FACES[face];
    if (item === 'language' || item === 'calm') { adjust(item, 1); return; }
    // a click on the left half of the value lowers it, the right half raises it
    const dir = hit && hit.point.x < setDie.base.x ? -1 : 1;
    adjust(item, dir);
  };

  // ── keyboard ───────────────────────────────────────────────────────────────────────────────────

  const onKey = (e: KeyboardEvent): void => {
    if (leaving || sub || app.input.mode !== 'menu') return;
    // A key that was pressed on the boot veil (its handler removes the veil) is not menu input: the veil's own
    // Enter / Space would otherwise land here as a select on the front face.
    if (!document.contains(e.target as Node)) return;
    const k = e.code;
    const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k);
    if (phase === 'info') {
      if (['Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace'].includes(k)) { e.preventDefault(); closeInfo(); }
      return;
    }
    if (phase !== 'main' && phase !== 'settings') return;
    if (k === 'KeyI' && !e.repeat && ((phase === 'main' && !mainDie.rolling) || (phase === 'settings' && !setDie.rolling))) {
      e.preventDefault();
      openCredits();
      return;
    }
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

  /** True when the pointer is on the CREDITS button of the panel (the SETTINGS face is in front). Panel uv: y runs up. */
  const creditsHit = (): boolean => {
    if (!panelButton || (phase !== 'main' && phase !== 'settings')) return false;
    ray.setFromCamera(ndc, app.camera);
    const uv = ray.intersectObject(panelMesh, false)[0]?.uv;
    if (!uv) return false;
    const b = PANEL_BUTTON;
    return Math.abs(uv.x - b.cx) <= b.w / 2 && Math.abs(1 - uv.y - b.cy) <= b.h / 2;
  };

  const onDown = (e: PointerEvent): void => {
    if (leaving || sub) return;
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
    app.canvas.style.cursor = hit || creditsHit() ? 'pointer' : '';
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
    if (creditsHit()) { openCredits(); return; }
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

  /** The wheel rolls the main die one face: up brings the top face forward, down the bottom face (as the arrows do). */
  const onWheel = (e: WheelEvent): void => {
    if (leaving || sub || phase !== 'main' || app.input.mode !== 'menu') return;
    e.preventDefault();
    if (e.deltaY === 0 || mainDie.rolling) return;
    rollDie(mainDie, mainDie.faceAt(e.deltaY < 0 ? UP : DOWN));
  };

  const attach = (): void => {
    if (attached) return;
    attached = true;
    window.addEventListener('keydown', onKey);
    app.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    window.removeEventListener('keydown', onKey);
    app.canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('wheel', onWheel);
    app.canvas.style.cursor = '';
  };

  // ── camera ─────────────────────────────────────────────────────────────────────────────────────

  /** Far enough that the whole cabinet (5.1 m tall, 5.4 m wide) and its marquee fit the frame. */
  const cameraDistance = (): number => {
    const tanV = Math.tan((CAM_FOV * Math.PI) / 360);
    const byHeight = 1.15 + 3.45 / tanV;
    const byWidth = 1.15 + CAB_HALF_WIDTH / (tanV * Math.max(0.2, app.camera.aspect || 1));
    // wide screens (16:9, 21:9): the height fit leaves empty side room, so lean in a little; the marquee and the
    // panel keep a safe margin (never below 90% of the fit)
    const a = app.camera.aspect || 1;
    const lean = a > 1.6 ? Math.min(0.1, (a - 1.6) * 0.1) : 0;
    return Math.max(byHeight * (1 - lean), byWidth);
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
      burst.reset();
      mainDie.root.visible = true;
      mainDie.root.scale.setScalar(1);
      setDie.root.visible = false;
      tweens.length = 0;
      app.input.setMode('menu');
      app.camera.fov = CAM_FOV;
      app.camera.updateProjectionMatrix();
      sub = false;
      repaintAll();
      app.audio.music.setState('menu', { fade: 1.2 });
      app.audio.ambience('menu', 1.5);
      unsubSettings?.();
      unsubSettings = bus.on('settings:changed', ({ key }) => {
        if (key === 'lang' || key === 'vol' || key === 'psx' || key === 'mouseSens') repaintAll();
      });
      attach();
      markCrisp(panelMesh);
      if (params?.toast) app.ui.toast(params.toast, 'warn');
    },
    exit() {
      detach();
      releaseCrisp(panelMesh);
      unsubSettings?.();
      unsubSettings = null;
      press = null;
      tweens.length = 0;
      burst.reset();
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
      backdrop.update(dt, time);
      drums.update(dt, time);
      frameWide();
      // the panel under the glass follows the die once it stops rolling: the focused entry and its controls
      const onSet = setDie.root.visible && phase !== 'main';
      const die = onSet ? setDie : mainDie;
      if (!die.rolling && phase !== 'burst' && phase !== 'info') {
        const item: string = onSet ? SET_FACES[die.frontFace()] : faceItem(die.frontFace());
        const key = `${onSet ? 's' : 'm'}:${item}:${savedRun() ? 1 : 0}`;
        if (key !== lastFocusKey) {
          lastFocusKey = key;
          paintFocus(item, onSet ? `menu.desc.${item}` : mainDescKey(item), onSet ? 'menu.hint.settings' : 'menu.hint.roll');
        }
      }
      if (phase === 'burst') {
        burst.update(dt);
        if (burst.done && !leaving) {
          leaving = true;
          // Starting-kit picker (WAVE8 item 6) sits between the burst and the run. Its pick travels as `RunConfig.kit`.
          const seed = hashSeed('run', randomSeed());
          openKitPicker((kit, pick) => {
            // Kit, stake and the daily flag travel here; session.ts hands them to createRun, which fills the rest of the defaults.
            void app.go('ingame', { mode: 'debt', seed, online: false, config: { kit, stake: pick?.stake, daily: pick?.daily } });
          });
        }
      }
      const dist = cameraDistance() - burst.dolly * 1.6;
      // a little mouse parallax: the casino behind slides against the cabinet
      const k = 1 - Math.exp(-dt * 4);
      camX += (ndc.x * 0.45 - camX) * k;
      camY += (ndc.y * 0.22 - camY) * k;
      // slow idle drift on top of the mouse parallax
      const driftX = Math.sin(time * 0.21) * 0.28;
      const driftY = Math.sin(time * 0.17 + 1.3) * 0.08;
      app.camera.position.set(camX + driftX, 0.12 + camY + driftY, dist + Math.sin(time * 0.12) * 0.15);
      app.camera.lookAt((camX + driftX) * 0.4, LOOK_Y, 0);
      app.renderer.render(scene, app.camera, { scene: panelScene, camera: app.camera });
    },
  };
}
