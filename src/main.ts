/**
 * Boot sequence — wiring only (TD-owned). Contract: TECH_SPEC §1.3.
 *
 *  1  index.html shows #boot ("JackID BIOS")           7  wait for fonts (≤ 3 s, Turkish glyph check)
 *  2  fonts imported below                              8  machine registry load + strings
 *  3  save.load → settings → language                   9  texgen.warm + mannequin preload
 *  4  *.strings.ts / *.cutscene.ts globs                10 URL params (bootParams)
 *  5  renderer (WebGL2; failure → localized error)      11 app.go('menu') (or bench / skipmenu after the veil)
 *  6  services: input, ui, audio, net, tex, kit, fx     12 "CLICK TO ENTER THE PIT" veil → audio.resume
 *
 * Replaced stubs are swapped by changing only the `create*` imports here (their factory names are frozen).
 */
import '@fontsource/vt323/latin.css';
import '@fontsource/vt323/latin-ext.css';
import '@fontsource/press-start-2p/latin.css';
import '@fontsource/press-start-2p/latin-ext.css';
import * as THREE from 'three';
import type { BindingKey } from '@/core/input/types';
import type { Settings } from '@/core/settings';
import type { CutsceneDef } from '@/core/cutscene/types';
import { createApp, app, type App } from '@/core/app';
import { bus } from '@/core/events';
import { startLoop } from '@/core/loop';
import { createRng, hashSeed, randomSeed } from '@/core/rng';
import { createSaveStore } from '@/core/save';
import { registerStrings, setLang, t, type StringTable } from '@/core/i18n';
import { bootParams } from '@/core/bootParams';
import { log } from '@/core/log';
import { installDebug } from '@/core/debug';
import { createPsxRenderer } from '@/core/renderer/psxRenderer';
import { createTexGen } from '@/core/texgen/texgen';
import { createAudio } from '@/core/audio/audio';
import { createInput } from '@/core/input';
import { createUI } from '@/core/ui/ui';
import { createFx } from '@/core/fx';
import { createCutscenePlayer } from '@/core/cutscene/player';
import { createKit } from '@/kit';
import { createSession } from '@/net/session';
import * as registry from '@/machines/_base/registry';
import { createMenuState } from '@/menu/menuState';
import { createLobbyState } from '@/menu/lobbyState';
import { createResultsState } from '@/menu/resultsState';
import { createInGameState } from '@/game/inGameState';
import en from '@/i18n/en';
import tr from '@/i18n/tr';

type StringsModule = { default: { prefix: string; en: StringTable; tr: StringTable } };
const stringModules = import.meta.glob<StringsModule>('./**/*.strings.ts', { eager: true });
const cutsceneModules = import.meta.glob<{ default: CutsceneDef }>('./**/*.cutscene.ts', { eager: true });

const bootEl = document.getElementById('boot') as HTMLElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Replace the BIOS screen with a localized error page (no game services needed). */
function fatal(message: string): void {
  bootEl.className = '';
  bootEl.replaceChildren();
  const title = document.createElement('div');
  title.textContent = t('ui.error.title');
  const body = document.createElement('div');
  body.textContent = message;
  body.style.cssText = 'white-space:normal;max-width:60ch;margin:12px 0';
  const btn = document.createElement('button');
  btn.textContent = t('ui.error.reload');
  btn.style.cssText = 'font:inherit;color:inherit;background:#000;border:1px solid #5aff7b;padding:4px 12px;cursor:pointer';
  btn.onclick = () => location.reload();
  bootEl.append(title, body, btn);
  log.error('boot', message);
}

function defaultPlayerName(id: string): string {
  return `${t('common.guest')} ${1 + (parseInt(id.slice(0, 4), 16) % 999)}`;
}

/** Push settings into live services. `key` omitted = everything (initial apply). */
function applySettings(a: App, key?: keyof Settings): void {
  const s = a.save.data.settings;
  if (!key || key === 'psx') a.renderer.apply(s.psx);
  if (!key || key === 'fov') { a.camera.fov = s.fov; a.camera.updateProjectionMatrix(); }
  if (!key || key === 'vol') {
    a.audio.setVolume('master', s.vol.master);
    for (const b of ['sfx', 'ui', 'music', 'amb', 'voice'] as const) a.audio.setVolume(b, s.vol[b]);
  }
  if (key === 'lang') setLang(s.lang);
}

async function boot(): Promise<void> {
  // 3 — save → settings → language
  const save = createSaveStore();
  save.load();
  const settings = save.data.settings;
  // 4 — strings (common/ui tables first, then every `*.strings.ts` next to its code)
  registerStrings('', { en, tr });
  for (const m of Object.values(stringModules)) registerStrings(m.default.prefix, m.default);
  setLang(bootParams.lang ?? settings.lang);
  if (!save.data.profile.name) save.update((d) => { d.profile.name = defaultPlayerName(d.profile.id); });

  // 5 — renderer (WebGL2 only)
  let renderer: ReturnType<typeof createPsxRenderer>;
  try {
    renderer = createPsxRenderer(canvas, settings.psx);
  } catch (e) {
    log.error('boot', e);
    fatal(t('ui.error.webgl'));
    return;
  }
  const videoEl = document.getElementById('boot-video');
  if (videoEl) videoEl.textContent = 'OK';

  // 6 — services
  const input = createInput(canvas, settings.keybinds);
  const ui = createUI(uiRoot, { keyLabel: (a: BindingKey) => input.keyLabel(a) });
  const audio = createAudio(settings.vol);
  const profile = (): { id: string; name: string; color: number } => save.data.profile;
  const net = createSession(profile);
  const tex = createTexGen();
  const kit = createKit(tex);
  const fx = createFx();
  const cutscene = createCutscenePlayer();
  for (const m of Object.values(cutsceneModules)) cutscene.register(m.default);
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 60);
  const rootSeed = bootParams.seed ?? hashSeed('root', randomSeed());

  const a = createApp({
    canvas, renderer, audio, input, ui, save, tex, kit, fx, net, cutscene, camera,
    rng: { root: createRng(rootSeed), cosmetic: createRng(randomSeed()) },
    version: __APP_VERSION__,
  });
  applySettings(a);
  bus.on('settings:changed', ({ key }) => applySettings(a, key));
  a.register('boot', { enter() {}, exit() {}, fixedUpdate() {}, frame() {} });
  a.register('menu', createMenuState());
  a.register('lobby', createLobbyState());
  a.register('ingame', createInGameState());
  a.register('results', createResultsState());
  installDebug(a);

  // 7 — fonts (Turkish glyph coverage), never blocking longer than 3 s
  const glyphs = 'ÇĞİÖŞÜçğıöşü';
  await Promise.race([
    Promise.all([document.fonts.load('16px VT323', glyphs), document.fonts.load("16px 'Press Start 2P'", glyphs)]),
    sleep(3000),
  ]).catch((): void => { /* a slow font must never block boot */ });

  // 8 — machines
  registry.load();
  // 9 — procedural + vendor assets
  await Promise.all([tex.warm(), kit.loadMannequin()]).catch((e) => log.warn('boot', 'warm-up failed', e));

  // 10/11 — parameters, first state (the menu keeps rendering behind the veil)
  net.startOffline();
  await a.go('menu', undefined);
  startLoop();

  // 12 — veil: the first gesture unlocks audio and (optionally) skips the menu
  bootEl.className = 'veil';
  bootEl.replaceChildren();
  const label = document.createElement('div');
  label.textContent = t('ui.enter');
  label.className = 'blink';
  bootEl.appendChild(label);
  const enter = (): void => {
    bootEl.remove();
    void app.audio.resume();
    if (bootParams.bench || bootParams.skipMenu) {
      void app.go('ingame', {
        mode: bootParams.bench ? 'free' : 'debt',
        seed: bootParams.seed ?? hashSeed('run', randomSeed()),
        online: false,
        bench: bootParams.bench,
      });
    }
  };
  bootEl.addEventListener('click', enter, { once: true });
  bootEl.tabIndex = 0;
  bootEl.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') enter(); });
  bootEl.focus();
}

boot().catch((e) => fatal(t('ui.error.generic', { msg: String((e as Error)?.message ?? e) })));
