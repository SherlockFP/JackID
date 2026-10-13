# JackID — Technical Specification v1.1 (integration contract; Producer amendments in §11 are binding)

Owner: Technical Director (TD). Audience: every coding/modeling agent. This document is binding for
**code interfaces, file layout, networking and process**. Design docs in `docs/` (GDD, machine
catalogue, art bible, level doc, audio doc — whichever exist) are binding for **content** (rules,
odds, payouts, colours, coordinates, ids). On a conflict: design docs win on numbers/rules/ids,
this spec wins on code shape. `docs/BRIEF.md` decisions are fixed and override both.

Installed versions (verified in `node_modules`, do not change):

| package | version | use |
|---|---|---|
| three | 0.186.1 | renderer, WebGL2 only (`WebGLRenderer`, not WebGPU) |
| @types/three | 0.186.0 | types |
| vite | 8.3.4 | dev server / bundler (Rolldown) |
| typescript | 5.9.3 | `tsc --noEmit` typecheck only |
| ws | 8.22.0 | `server/index.js` lobby + signaling + relay |
| trystero | 0.26.0 (`trystero/nostr`) | optional serverless global P2P |
| @fontsource/vt323, @fontsource/press-start-2p | 5.3.0 | UI fonts (latin + latin-ext subsets → Turkish glyphs) |
| @types/node | 26.6.5 | server typing only; Node runtime v26 present |

`@tweenjs/tween.js` and `@dimforge/rapier3d-compat` exist in `node_modules` only as transitive deps of
`@types/three`. **Never import them.** We have our own tween and no physics engine.

---

## 1. Architecture

### 1.1 Layers and dependency rule

```
            main.ts  (wiring only)
               │
   ┌───────────┼──────────────────────────────┐
 menu/      (UI states, 3D menu, HUD)          │
   │                                           │
 game/  world/  player/  machines/<id>/        │  ← feature layer
   │      │       │        │                   │
   │      └───────┴── kit/ ┘ (procedural parts)│
   │                                           │
 net/  (session, transports, protocol)         │
   │                                           │
 core/ (engine services, no game knowledge) ───┘
```

Rules (enforced in review):
1. `core/` imports only `three` and other `core/` files.
2. `kit/` imports `core/` only.
3. `machines/<id>/` imports **only** `three`, `@/core/*`, `@/kit/*`, `@/machines/_base/*`, `@/game/types`,
   `@/core/i18n`, and files inside its own folder. Never another machine folder, never `@/world/*`,
   `@/menu/*`, `@/net/*` (networking reaches a machine only through `MachineBase`).
4. `net/` imports `core/` and `@/game/types` (types only).
5. Type-only imports (`import type`) across layers are always allowed.
6. No module-level mutable state in machines (several instances of one machine exist at once).

### 1.2 Folder / file structure (refines BRIEF layout; owners in §10)

```
jackpit/
  index.html                      # <canvas id="game">, <div id="ui">, <div id="boot">
  vite.config.ts                  # alias @ → src, proxy /lobby + /api → :8787, __APP_VERSION__
  tsconfig.json
  package.json                    # scripts: dev, build, typecheck, preview, server, check
  scripts/check.mjs               # i18n completeness + forbidden-import + budget lint (Node)
  server/
    index.js                      # http + ws: lobby registry, signaling, relay, static dist/
    rooms.js                      # room registry + expiry
    util.js                       # ids, rate limiter, sanitizers
  src/
    main.ts                       # boot sequence (§1.3)
    vite-env.d.ts                 # /// <reference types="vite/client" />, declare const __APP_VERSION__: string
    core/
      types.ts                    # Json, PlayerId, Lang, GameMode, Hex, V3 …
      app.ts                      # App service container + state machine + singleton `app`
      loop.ts                     # fixed-step loop, background worker ticker
      states.ts                   # AppStateId, AppStateHandler, StateParams
      events.ts                   # EventBus + GameEvents map
      rng.ts                      # sfc32 Rng, hash helpers
      tween.ts                    # TweenSystem, Ease
      timers.ts                   # Timers (after/every/wait)
      math.ts                     # clamp, lerp, damp, smoothstep, angle helpers, temp vectors
      log.ts                      # log.debug/info/warn/error with tags, dev-only debug
      dispose.ts                  # disposeObject3D, Disposer
      settings.ts                 # Settings type + DEFAULT_SETTINGS
      save.ts                     # SaveStore (localStorage)
      i18n.ts                     # t(), registerStrings(), fmtCoins(), upper()
      input.ts                    # Input service
      keymap.ts                   # default bindings, key labels
      fx.ts                       # particles / pop text / camera shake (FxApi)
      debug.ts                    # F3 overlay, window.jackid dev console
      renderer/
        types.ts                  # PsxRenderer, PsxSettings, PsxMatOpts interfaces
        psxRenderer.ts            # low-res RT + post blit
        psxMaterial.ts            # material factory + shader injection + cache
        postShader.ts             # 15-bit + Bayer dither + CRT GLSL
      texgen/
        types.ts                  # TexGen, SymbolId, TexOpts
        texgen.ts                 # canvas → CanvasTexture, cache
        patterns.ts               # felt, wood, metal, carpet, noise, grime …
        font.ts                   # 5×7 bitmap font "px5" incl. Ç Ğ İ Ö Ş Ü ç ğ ı ö ş ü
        symbols.ts                # slot symbol painters (registerSymbol)
        cards.ts                  # card faces/backs atlas, dice faces, chips
      audio/
        types.ts                  # AudioEngine, SfxName, PlayOpts, SynthKit
        audio.ts                  # context, buses, voices, listener
        synth.ts                  # oscillators/noise/envelopes (SynthKit impl)
        sfx.ts                    # preset recipes for every SfxName
        music.ts                  # ambience beds + jukebox sequencer
      ui/
        types.ts                  # UIOverlay + specs
        ui.ts                     # DOM overlay implementation
        ui.css                    # pixel UI styles (--px integer scale)
        widgets.ts                # buttons/sliders/lists used by menu panels
    kit/
      types.ts                    # Kit interface + part types (TD-frozen)
      index.ts                    # createKit(): Kit
      palette.ts                  # Palette (values from art bible)
      prims.ts  cabinet.ts  screen.ts  marquee.ts  controls.ts  lights.ts
      tables.ts  cards.ts  chips.ts  dice.ts  wheel.ts  reel.ts  dealer.ts
      mannequin.ts  finalize.ts  misc.ts
    i18n/
      en.ts  tr.ts                # common.* and ui.* keys only
    world/
      types.ts                    # SlotDef, ZoneId, World, CollisionWorld, Interactable (TD-frozen)
      layout.ts                   # SLOTS, ZONES, ASSIGN tables (data)
      world.ts                    # build/dispose, machine placement, visibility, light pool
      level.ts                    # pit architecture (walls, floor, ceiling, pillars, decor)
      lights.ts                   # hemisphere + pooled point lights + fog
      collision.ts                # AABB world, spatial hash, moveAndSlide, raycast
      interact.ts                 # InteractionSystem (crosshair ray → prompt → E)
      bench.ts                    # ?bench=<id> single-machine test room
      props/ clock.ts trapdoor.ts elevator.ts decor.ts
      world.strings.ts
    player/
      controller.ts               # FPS movement, collision, head-bob, footsteps
      camera.ts                   # glide to play pose, shake, cinematic paths
      viewmodel.ts                # low-poly hand + coin, own scene
      avatars.ts                  # remote players (mannequin + name tag), interpolation
      local.ts                    # LocalPlayer facade
    game/
      types.ts                    # RunApi, ModHook, WinTier, DebtState, RunSnapshot … (TD-frozen)
      inGameState.ts              # InGame AppState: composes world/player/run/hud
      run.ts                      # Run (phases, deadlines, mode rules) implements RunApi
      economy.ts                  # wallets, bet/win, pending ops, host validation
      clock.ts                    # deadline clock, host-time based
      modes/ debt.ts coop.ts versus.ts free.ts
      charms/ charms.ts defs/<charmId>.ts   # auto-registered via glob
      hotline.ts calls/<callId>.ts         # phone scripts, auto-registered via glob
      benchRun.ts                 # RunApi for ?bench (infinite deadline, debug wallet)
      game.strings.ts
    machines/
      _base/
        types.ts                  # MachineDef, MachineModel, PlayPose … (TD-frozen)
        MachineBase.ts  TableBase.ts
        registry.ts               # import.meta.glob('../*/index.ts', { eager: true })
        cards.ts                  # deck, poker/blackjack/baccarat evaluators
        reels.ts                  # strips, stops, line & pattern evaluation
        peg2d.ts                  # tiny 2D circle-vs-peg physics (pachinko/plinko)
        tiers.ts                  # tierFor(gross, bet)
      <machine_id>/
        model.ts                  # export function buildModel(kit) + Parts type   (modeler)
        index.ts                  # export const def; export default class        (coder)
        *.ts                      # any extra logic files (coder)
    net/
      types.ts                    # Transport interface, TransportKind
      protocol.ts                 # Msg union, PROTO, RoomInfo, PlayerInfo (TD-frozen)
      codec.ts                    # JSON encode/decode, fragmentation
      session.ts                  # Session (offline/host/client), routing, players
      clocksync.ts                # ping/pong, hostTime()
      replication.ts              # transform send/receive buffers, snapshot assembly
      lobbyClient.ts              # lobby server ws client (list/create/join/signal/relay)
      transports/ webrtc.ts relay.ts broadcast.ts trystero.ts
    menu/
      menuState.ts  menuScene.ts  menuReels.ts  transitions.ts     # 3D jackpot menu
      serverBrowser.ts  lobbyState.ts  hostPanel.ts  settingsPanel.ts  pause.ts  credits.ts
      hud.ts  scoreboard.ts  chat.ts  resultsState.ts
      menu.strings.ts  hud.strings.ts
```

`*.strings.ts` and `machines/*/index.ts` are discovered with `import.meta.glob`; there is **no shared
registry file to edit**.

### 1.3 Boot sequence (`src/main.ts`)

| # | step | budget |
|---|---|---|
| 1 | `index.html` shows `#boot` div (black, VT323 green text "JackID BIOS v{ver}") | 0 ms |
| 2 | import fonts: `@fontsource/vt323/latin.css`, `…/latin-ext.css`, same for `press-start-2p` | — |
| 3 | `save.load()` → settings; `i18n.setLang(settings.lang)`; URL `?lang=` overrides | 5 ms |
| 4 | glob-import `src/**/*.strings.ts` → `registerStrings` | 5 ms |
| 5 | create `PsxRenderer` on `#game` (WebGL2; on failure show i18n error page) | 50 ms |
| 6 | create `Input`, `EventBus`, `UIOverlay`, `AudioEngine` (context **suspended**), `Session` (offline), `TexGen`, `Kit`, `Fx` | 30 ms |
| 7 | `await document.fonts.load('16px VT323', 'ÇĞİÖŞÜçğıöşü')` and Press Start 2P, timeout 3 s | ≤ 3 s |
| 8 | `registry.load()` → eager glob of all machines, validate defs, merge machine strings | 20 ms |
| 9 | `texgen.warm()` (card atlas, symbol atlas, common patterns) | 60 ms |
| 10 | parse URL: `?bench=<id>`, `?join=<code>` (BRIEF Addendum 1 invite links), `?seed=<n>`, `?net=tab\|relay` (force transport), `?debug=1`, `?skipmenu=1`, `?lang=tr` | — |
| 11 | `app.go('menu')` (or bench / auto-join) → menu builds scene, `renderer.compile()` precompiles | 300 ms |
| 12 | `#boot` replaced by "CLICK TO ENTER THE PIT" veil; first click → `audio.resume()` + pointer lock rules active | user |

Total boot → interactive menu ≤ 3 s on a mid-range laptop.

### 1.4 Main loop (`src/core/loop.ts`)

Fixed-step simulation at **60 Hz**, variable-rate rendering with interpolation.

```ts
export const FIXED_DT = 1 / 60;          // s
export const MAX_FRAME_DT = 0.1;         // s, clamp after tab switches
export const MAX_STEPS = 6;              // per frame, spiral-of-death guard

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - last) / 1000, MAX_FRAME_DT); last = nowMs;
  app.time.real += dt; app.time.frame++;
  input.beginFrame();                               // samples mouse deltas, gamepad none
  acc += dt; let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS) {
    input.beginStep();                              // dispatch queued key/pointer events (machine sink), edge flags
    net.poll();                                     // deliver received messages in order
    if (!app.simPaused) {
      app.time.sim += FIXED_DT; app.time.step++;
      app.timers.sim.update(FIXED_DT); app.tweens.sim.update(FIXED_DT);
    }
    app.current.fixedUpdate(FIXED_DT);              // player, machines.tick, run, world
    net.flush(FIXED_DT);                            // batched sends; transforms at 20 Hz
    input.endStep();
    acc -= FIXED_DT; steps++;
  }
  if (steps === MAX_STEPS) acc = 0;
  app.timers.ui.update(dt); app.tweens.ui.update(dt);
  app.current.frame(dt, acc / FIXED_DT);            // visuals (+ renderer.render inside)
  ui.update(dt);
}
```

* Two clocks: **sim** (pausable, advanced only in fixed steps; all gameplay tweens/timers/waits) and
  **ui** (real time, never paused; menus, HUD).
* Single-player pause (`Esc` in walk mode) sets `app.simPaused = true`. In any online session pause
  never stops the sim (pause menu is just an overlay).
* **Background host keep-alive:** when `document.hidden && session.mode !== 'offline'`, `loop.ts`
  switches to an inline Web Worker ticker posting every 50 ms; each tick runs the fixed-step block
  (catch-up ≤ 6 steps) without rendering. Required so a host in a background tab (multi-tab testing,
  alt-tab) keeps the room alive. Switch back on `visibilitychange`.
* Never use `setTimeout/setInterval` for gameplay. Use `app.timers.sim` / `MachineBase.wait()`.
  Allowed in `net/`, `core/ui`, `menu/` panels and the worker ticker.

### 1.5 App state machine (`src/core/states.ts`, `src/core/app.ts`)

```
          ┌──────────── quit / error ────────────┐
Boot ──▶ Menu ──(Play SP / Free SP)──▶ InGame ──(run end)──▶ Results ──▶ Menu
          │ ▲                            ▲  │                    │
  host/join│ │leave                 start│  │quit               │ back to lobby (MP)
          ▼ │                            │  ▼                    ▼
          Lobby ────────────(host Start)─┘ Menu                Lobby
```

| state | owner file | enter params | notes |
|---|---|---|---|
| `boot` | `main.ts` | — | services up, then `menu` |
| `menu` | `menu/menuState.ts` | `{ toast?: string }` | 3D jackpot scene; server browser/settings/credits panels |
| `lobby` | `menu/lobbyState.ts` | `{ role: 'host' \| 'client' }` | room roster, ready, mode/config, chat; menu scene keeps rendering behind |
| `ingame` | `game/inGameState.ts` | `InGameParams` | world + player + run + HUD; Paused is an overlay flag, **not** a state |
| `results` | `menu/resultsState.ts` | `{ summary: RunSummary }` | stats; SP → Menu, MP → Lobby (host decides) |

Transition rules: `app.go(to, params)` awaits `current.exit(to)` then `next.enter(params, from)`;
emits `'app:state'`. Any fatal net error from `lobby`/`ingame` → `app.go('menu', { toast })`.
Transitions are serialized (a `go()` during a `go()` is queued).

```ts
export type AppStateId = 'boot' | 'menu' | 'lobby' | 'ingame' | 'results';
export interface InGameParams {
  mode: GameMode; seed: number; online: boolean;
  bench?: MachineId;                     // ?bench mode: single slot test room
  resume?: RunSnapshot;                  // SP continue
  config?: RunConfig;                    // from lobby (MP)
}
export interface StateParams {
  boot: undefined; menu: { toast?: string } | undefined; lobby: { role: 'host' | 'client' };
  ingame: InGameParams; results: { summary: RunSummary };
}
export interface AppStateHandler<K extends AppStateId = AppStateId> {
  enter(params: StateParams[K], from: AppStateId): Promise<void> | void;
  exit(to: AppStateId): Promise<void> | void;
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;      // must call app.renderer.render(...)
}
```

### 1.6 Scene graph

Three scenes, one camera each:

```
menuScene (owned by menu/menuScene.ts, kept alive between runs)
gameScene (built on enter('ingame'), fully disposed on exit)
  ├─ "world"     level geometry (merged static), props/, lights (hemi + 6-light pool), fog
  ├─ "machines"  "slot:A01" Group (slot pos/rotY) → machine.root (machine-local coords)
  ├─ "players"   remote avatars
  ├─ "fx"        particles, popped text, transient meshes (FxApi)
  └─ "debug"     collider wireframes (F3 → F4)
viewmodelScene (player/viewmodel.ts): hands/coin, own PerspectiveCamera fov 55, near 0.01,
               rendered after gameScene with depth cleared, same low-res target
```

* `app.camera`: `PerspectiveCamera(fov=settings.fov, aspect, near 0.05, far 60)`, not parented.
* World units: **metres**, Y up, floor y = 0. Default camera looks −Z ("north").
* No `THREE.Light` inside machines (see §8). No shadows (`renderer.shadowMap.enabled = false`).
* `ColorManagement.enabled = false`, `renderer.outputColorSpace = LinearSRGBColorSpace`,
  `toneMapping = NoToneMapping`: **hex colours appear on screen exactly as written** (PSX had no
  gamma pipeline). Canvas textures use `NoColorSpace`.

---

## 2. Core service interfaces

All interfaces below live in the `types.ts` file named in the heading; they are **frozen** after
Phase 0 (change only via TD). Implementations may add private members, never change signatures.

### 2.1 Shared primitives — `src/core/types.ts`

```ts
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type PlayerId = number;            // 1..8 (host = 1); 0 = "team"/nobody
export type Lang = 'en' | 'tr';
export type GameMode = 'debt' | 'coop' | 'versus' | 'free';
export type Hex = number;                 // 0xRRGGBB
export type V3 = [number, number, number];
export type MachineId = string;           // folder name = catalogue id, lowercase, e.g. 'coinflip', 'bigone', 'debt_terminal' (§11.1)
export type InstanceId = string;          // slot id from GDD §8.6, e.g. 'WELL-01' (unique machine instance)
export interface TimeInfo { real: number; sim: number; frame: number; step: number }
```

### 2.2 App — `src/core/app.ts`

```ts
export interface App {
  readonly version: string;                 // __APP_VERSION__
  readonly canvas: HTMLCanvasElement;
  readonly renderer: PsxRenderer;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly events: EventBus<GameEvents>;
  readonly ui: UIOverlay;
  readonly save: SaveStore;
  readonly tex: TexGen;
  readonly kit: Kit;
  readonly fx: FxApi;
  readonly net: Session;
  readonly rng: { root: Rng; cosmetic: Rng };
  readonly tweens: { sim: TweenSystem; ui: TweenSystem };
  readonly timers: { sim: Timers; ui: Timers };
  readonly time: TimeInfo;
  readonly camera: THREE.PerspectiveCamera;
  readonly state: AppStateId;
  readonly current: AppStateHandler;
  simPaused: boolean;
  world: World | null;                      // set by InGame state
  run: RunApi | null;                       // set by InGame state
  player: LocalPlayer | null;               // set by InGame state
  register<K extends AppStateId>(id: K, h: AppStateHandler<K>): void;
  go<K extends AppStateId>(to: K, params: StateParams[K]): Promise<void>;
}
export let app: App;                        // assigned once in main.ts; read-only elsewhere
```

Machines must use `this.ctx` instead of the `app` singleton (keeps bench/tests isolated).

### 2.3 PSX renderer & materials — `src/core/renderer/types.ts`

```ts
export interface PsxSettings {
  enabled: boolean;          // master switch for the whole PSX pipeline (false = native res, no post)
  targetHeight: number;      // 180 | 225 | 270 | 360 (ART §1.2 presets CRUNCHY/STANDARD/CLEAN/HI); default 225 → 400×225
  jitter: number;            // 0..1 vertex snap strength; grid = (1 + 2*jitter) internal px; default 0.5
  affine: boolean;           // affine UV warping; default true
  dither: boolean;           // 4×4 Bayer before quantize; default true
  colorBits: 5 | 6 | 8;      // per channel; 5 = 15-bit PSX; default 5
  crt: boolean;              // scanlines + vignette (no curvature, no bloom); default true
  scanlines: number;         // 0..1, default 0.22
  vignette: number;          // 0..1, default 0.35
  drawDistance: 'near' | 'normal' | 'far';   // fog far = 18 | 26 | 40 m; default 'normal'
}
export interface PsxUniforms {               // ONE shared object referenced by every psx material
  uPsxSnapRes: { value: THREE.Vector2 };     // = lowRes / (2 * (1 + 2*jitter))
  uPsxSnap: { value: number };               // 0/1
  uPsxAffine: { value: number };             // 0/1
  uTime: { value: number };                  // sim seconds (uv scroll)
}
export interface PsxRenderer {
  readonly three: THREE.WebGLRenderer;       // antialias:false, powerPreference:'high-performance'
  readonly canvas: HTMLCanvasElement;
  readonly lowRes: THREE.Vector2;            // internal resolution in px
  readonly scale: number;                    // integer upscale factor
  readonly uniforms: PsxUniforms;
  readonly settings: PsxSettings;
  apply(patch: Partial<PsxSettings>): void;  // live; never triggers shader recompiles
  resize(): void;                            // on window resize
  render(scene: THREE.Scene, camera: THREE.Camera,
         overlay?: { scene: THREE.Scene; camera: THREE.Camera }): void;
  grab(): THREE.Texture;                     // copy of last low-res frame (menu glass-shatter)
  compile(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  info(): { calls: number; tris: number; geometries: number; textures: number; programs: number; cpuMs: number };
}
export interface PsxMatOpts {
  color?: Hex;               // default 0xffffff
  map?: THREE.Texture | null;
  emissive?: Hex;            // default 0x000000
  emissiveIntensity?: number;// default 1
  emissiveMap?: THREE.Texture | null;
  lit?: boolean;             // true → MeshLambertMaterial, false → MeshBasicMaterial (unlit); default true
  vertexColors?: boolean;    // default false; kit.shade() sets true
  transparent?: boolean; opacity?: number;   // default false / 1
  alphaTest?: number;        // default 0 (0.5 recommended for cut-out sprites)
  additive?: boolean;        // AdditiveBlending, depthWrite false
  side?: 'front' | 'back' | 'double';        // default 'front'
  fog?: boolean;             // default true
  snap?: boolean;            // vertex snapping, default true (false for UI-ish screens close to camera)
  affine?: boolean;          // default true (false for large screens / text)
  scroll?: [number, number]; // uv scroll speed (uv/s), e.g. marquee belts
  depthWrite?: boolean;      // default !transparent
  unique?: boolean;          // bypass cache (material will be mutated at runtime)
}
export function psxMaterial(o: PsxMatOpts): THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
```

Implementation contract (renderer WP):
* Render path: `setRenderTarget(rtLow)` → render scene → `clearDepth()` → render overlay →
  `setRenderTarget(null)` → full-screen triangle with post shader → canvas.
* Integer scaling: `scale = max(1, round(canvasH / targetHeight))`, `lowRes = floor(canvas / scale)`.
  1080p → 384×216 ×5; 1440p → 426×240 ×6; 720p → 427×240 ×3. RT: `NearestFilter`, `depthBuffer:true`,
  `UnsignedByteType`. `renderer.setPixelRatio(1)`; canvas drawing buffer = CSS size × `min(dpr,2)`.
* Post shader: sample `tScene` at `(floor(uv*lowRes)+0.5)/lowRes`; add `dither * (bayer4(px)-0.5) / levels`;
  quantize `floor(c*levels+0.5)/levels` with `levels = 2^colorBits - 1`; CRT: scanline
  `1 - scan*0.5*(1+cos(uv.y*lowRes.y*2π))`, vignette `1 - vig*dot(d,d)` with `d = uv-0.5`.
  `bayer2(a)=fract(dot(floor(a), vec2(0.5, floor(a).y*0.75)))`, `bayer4(a)=bayer2(0.5*a)*0.25+bayer2(a)`.
* Material injection via `onBeforeCompile` + `customProgramCacheKey` (`'psx'+flags`):
  vertex, after `#include <project_vertex>`:
  ```glsl
  if (uPsxSnap > 0.5 && gl_Position.w > 0.0) {
    vec4 p = gl_Position; p.xyz /= p.w;
    p.xy = floor(p.xy * uPsxSnapRes + 0.5) / uPsxSnapRes;
    gl_Position = vec4(p.xyz * gl_Position.w, gl_Position.w);
  }
  #ifdef USE_MAP
    vPsxAffine = vec3(vMapUv * gl_Position.w, gl_Position.w);   // declare `varying vec3 vPsxAffine;`
  #endif
  ```
  fragment: replace `texture2D( map, vMapUv )` in `map_fragment` with
  `texture2D( map, mix(vMapUv, vPsxAffine.xy / vPsxAffine.z, uPsxAffine) )`.
* Material cache key = all opts + `map.uuid`; cached materials get `userData.shared = true` and are
  **never disposed by machines**. `unique:true` returns an uncached material owned by the caller.
* All `Texture`s used by psx materials: `magFilter = minFilter = NearestFilter`, `generateMipmaps=false`.
* Affine warping is ugly on huge triangles: any surface larger than 2 m must be subdivided to ≤ 1 m
  quads (kit primitives do this automatically when `segW/segH` omitted) or use `affine:false`.

### 2.4 Texture generator — `src/core/texgen/types.ts`

```ts
export type SymbolId = string;   // registered painters; default set below (art bible may add)
export type FontId = 'px5' | 'vt' | 'ps2p';   // built-in 5×7 bitmap | VT323 | Press Start 2P
export interface TexOpts {
  wrap?: 'repeat' | 'clamp';      // default 'repeat'
  repeat?: [number, number];      // default [1,1]
  key?: string;                   // cache key: same key ⇒ same shared texture (userData.shared=true)
}
export interface TextOpts {
  font?: FontId; size?: number;   // px (px5 ignores size; scale via integer `scale`)
  scale?: number;                 // integer pixel scale for px5, default 1
  color?: string; bg?: string | null; align?: 'left' | 'center' | 'right';
  outline?: string | null;        // 1-px outline colour
}
export interface TexGen {
  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
         o?: TexOpts): THREE.CanvasTexture;
  // patterns (16–64 px, seeded, cached by args)
  solid(c: Hex): THREE.Texture;
  noise(c: Hex, o?: { size?: number; amount?: number; seed?: number }): THREE.Texture;
  felt(c: Hex): THREE.Texture;          wood(c: Hex, o?: { grain?: number }): THREE.Texture;
  metal(c: Hex, o?: { brushed?: boolean }): THREE.Texture;   chrome(): THREE.Texture;
  carpet(pattern: 'diamond' | 'swirl' | 'stars' | 'teeth', colors: Hex[]): THREE.Texture;
  tiles(c1: Hex, c2: Hex, n?: number): THREE.Texture;  brick(c: Hex): THREE.Texture;
  concrete(c: Hex): THREE.Texture;  rust(c: Hex): THREE.Texture;  grime(amount: number): THREE.Texture;
  stripes(colors: Hex[], dir?: 'h' | 'v' | 'd'): THREE.Texture;  checker(c1: Hex, c2: Hex, n?: number): THREE.Texture;
  gradient(stops: Array<[number, Hex]>, dir?: 'h' | 'v' | 'radial'): THREE.Texture;
  // text & glyphs
  drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o?: TextOpts): number; // returns width
  measure(text: string, o?: TextOpts): number;
  text(text: string, o: TextOpts & { w: number; h: number }): THREE.CanvasTexture;  // alpha thresholded at 0.5
  // gambling atlases (shared, cached)
  symbol(id: SymbolId, size?: 16 | 24 | 32 | 48): THREE.Texture;
  symbolStrip(ids: SymbolId[], cell?: number): { tex: THREE.Texture; cellV: number };   // vertical reel strip
  registerSymbol(id: SymbolId, paint: (g: CanvasRenderingContext2D, s: number) => void): void;
  cardAtlas(): { tex: THREE.Texture; uv(card: CardId | 'back'): [u0: number, v0: number, u1: number, v1: number] };
  dieFace(n: 1 | 2 | 3 | 4 | 5 | 6, o?: { body?: Hex; pip?: Hex }): THREE.Texture;
  chipTop(value: number): THREE.Texture;             // 32×32
  wheelFace(segments: Array<{ label: string; color: Hex }>, size?: 128 | 256): THREE.Texture;
  warm(): Promise<void>;
}
export type CardId = `${'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'}${'S'|'H'|'D'|'C'}` | 'JK';
```

Default `SymbolId`s (original painters; final set from art bible): `cherry plum grape melon bell bar
bar2 bar3 seven diamond star horseshoe crown coin key eye skull tooth moon bolt candle rat bone
heart spade club dia wild jackpot blank`. **Forbidden:** four-leaf clover, treasure chest, any
CloverPit glyph.

Canvas rules: `imageSmoothingEnabled = false`; integer coordinates; fonts drawn at native size then
alpha-thresholded (no anti-aliased grey edges). The `px5` font is a built-in 5×7 bitmap with full
Turkish coverage. Use `i18n.upper()` for upper-casing (Turkish `i → İ`).

### 2.5 Audio — `src/core/audio/types.ts`

```ts
export type Bus = 'sfx' | 'ui' | 'music' | 'amb';
export type SfxName =
  | 'click' | 'hover' | 'button' | 'lever' | 'ratchet' | 'coin' | 'coinDrop' | 'coinFlick' | 'coinLand'
  | 'coinShower' | 'reelStart' | 'reelLoop' | 'reelTick' | 'reelStop' | 'chip' | 'chipStack'
  | 'card' | 'cardFlip' | 'shuffle' | 'dice' | 'diceLand' | 'wheelTick' | 'ballRoll' | 'ballBounce'
  | 'ballDrop' | 'bell' | 'buzzer' | 'beep' | 'error' | 'win1' | 'win2' | 'win3' | 'jackpot' | 'lose'
  | 'whoosh' | 'thud' | 'glass' | 'glassBreak' | 'phoneRing' | 'phonePickup' | 'clockTick' | 'clockAlarm'
  | 'trapdoor' | 'elevator' | 'footstep' | 'gunClick' | 'gunShot' | 'crank' | 'motor' | 'chime' | 'typewriter';
export interface PlayOpts {
  pos?: THREE.Vector3 | THREE.Object3D;  // positional (PannerNode) if set
  vol?: number;        // 0..2, default 1
  pitch?: number;      // semitones, default 0
  bus?: Bus;           // default 'sfx'
  loop?: boolean;      // returns a Voice you must stop()
  priority?: number;   // 0..10 voice stealing, default 5
  param?: number;      // recipe-specific 0..1 (e.g. reelStop index, ballBounce velocity)
}
export interface Voice { stop(fade?: number): void; setPitch(semi: number): void; setVol(v: number): void; readonly playing: boolean }
export interface SynthKit {
  readonly ctx: AudioContext; readonly t: number;          // start time
  osc(type: OscillatorType, freq: number, dur: number, o?: { at?: number; vol?: number; to?: number; env?: Adsr; out?: AudioNode }): void;
  noise(dur: number, o?: { at?: number; vol?: number; filter?: BiquadFilterType; freq?: number; q?: number; env?: Adsr; out?: AudioNode }): void;
  chord(freqs: number[], dur: number, type?: OscillatorType, o?: { at?: number; vol?: number; arp?: number }): void;
  out: AudioNode;
}
export interface Adsr { a: number; d: number; s: number; r: number }
export type SfxRecipe = (k: SynthKit, o: PlayOpts) => number;   // returns duration (s)
export interface AudioEngine {
  readonly ctx: AudioContext;
  resume(): Promise<void>;
  setVolume(bus: Bus | 'master', v: number): void;
  play(name: SfxName | string, o?: PlayOpts): Voice | null;
  register(name: string, recipe: SfxRecipe): void;   // machine-private sounds: name 'm.<id>.<snd>'
  winJingle(tier: WinTier, o?: PlayOpts): void;
  coins(n: number, o?: PlayOpts): void;               // rapid coin clinks, n ≤ 40
  ambience(id: 'menu' | 'pit' | 'void' | 'elevator' | null, fade?: number): void;
  music: { play(trackId: string): void; stop(fade?: number): void; readonly current: string | null; tracks(): string[] };
  setListener(cam: THREE.Camera): void;               // called each frame by InGame/menu
  readonly voices: number;
}
```

Mixing: buses → master gain → `DynamicsCompressor(threshold −12 dB, ratio 4)` → `lowpass 11 kHz` (SPU
feel) → destination. Reverb send (generated 1.8 s noise impulse ConvolverNode) on `sfx`/`amb` at 0.15.
Positional: `PannerNode` `panningModel:'equalpower'`, `distanceModel:'inverse'`, `refDistance 1.5`,
`rolloffFactor 1.4`, `maxDistance 30`. Max **32** voices; steal lowest priority, then oldest.
Default volumes: master 0.8, sfx 0.9, ui 0.8, music 0.6, amb 0.7.

### 2.6 Input — `src/core/input.ts`, `src/core/keymap.ts`

```ts
export type Action =
  | 'fwd' | 'back' | 'left' | 'right' | 'sprint' | 'crouch' | 'interact' | 'pause'
  | 'scoreboard' | 'chat' | 'give' | 'help' | 'debug' | 'debugColliders';
export type MachineAction =
  | 'primary' | 'secondary' | 'up' | 'down' | 'left' | 'right' | 'betUp' | 'betDown' | 'betMax'
  | 'confirm' | 'alt' | 'help' | 'exit' | 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'n6' | 'n7' | 'n8' | 'n9';
export type InputMode = 'menu' | 'walk' | 'machine' | 'ui';
export interface MachineInputEvent { action: MachineAction; down: boolean; repeat: boolean; t: number }
export interface MachinePointerEvent {
  type: 'down' | 'up' | 'move'; button: 0 | 1 | 2; ndc: THREE.Vector2; t: number;
}
export interface MachineSink { onInput(e: MachineInputEvent): void; onPointer(e: MachinePointerEvent): void }
export interface Input {
  readonly mode: InputMode;
  setMode(m: InputMode): void;
  readonly locked: boolean;                          // pointer lock state
  requestLock(): Promise<boolean>;                   // must be called inside a user-gesture handler
  exitLock(): void;
  // polled (walk mode), valid inside fixedUpdate
  down(a: Action): boolean;
  pressed(a: Action): boolean;                       // went down this step
  released(a: Action): boolean;
  move(): { x: number; z: number };                  // normalized WASD vector
  look(): { dx: number; dy: number };                // px since last step (consumed)
  // event style
  on(a: Action, fn: (down: boolean) => void): () => void;
  setMachineSink(s: MachineSink | null): void;       // events queued & delivered at beginStep()
  readonly pointerNdc: THREE.Vector2;
  bindings(): Record<Action | `m.${MachineAction}`, string[]>;
  rebind(a: Action | `m.${MachineAction}`, codes: string[]): void;
  keyLabel(a: Action | `m.${MachineAction}`): string; // localized, e.g. "E", "BOŞLUK", "LMB"
  textFocus(el: HTMLInputElement | null): void;      // chat/name fields; switches to 'ui'
  beginFrame(): void; beginStep(): void; endStep(): void;
}
```

Default bindings (codes are `KeyboardEvent.code`; mouse: `Mouse0/1/2`, `WheelUp/WheelDown`). **Superseded by the final
keymap in §11.6** (GDD §10.6 + catalogue §1.3 reconciled): `betMax` = **B** (not Q), `secondary` = RMB tap only, `give` =
tap 10 % / hold 25 % of pocket. The table below is kept for history:

| action | keys | | machine action | keys |
|---|---|---|---|---|
| fwd/back/left/right | W S A D, arrows | | primary | Space, Mouse0* |
| sprint | ShiftLeft | | secondary | F, Mouse2* |
| crouch | C | | up/down/left/right | W S A D, arrows |
| interact | E | | betUp / betDown | X / Z, WheelUp / WheelDown, = / − |
| pause | Escape (pointer-lock exit) | | betMax | Q |
| scoreboard (hold) | Tab | | confirm | Enter, NumpadEnter |
| chat | T, Enter | | alt (rebet / repeat) | R |
| give (co-op, 50 coins to looked-at player) | G | | help (paytable overlay) | H |
| help | F1 | | n1..n9 | Digit1..9, Numpad1..9 |
| debug / colliders | F3 / F4 | | exit (stand up) | E, Escape |

\* When the play pose has `mouse:'pick'`, mouse buttons go to `onPointer` instead.

**Pointer/machine-mode capture rules**
* Walk mode: pointer locked. Browser-level `Esc` unlocks → `pointerlockchange` → open pause menu.
* Entering a machine (`E`): `input.exitLock()`, mode `'machine'`, OS cursor visible with a CSS
  pixel cursor (data-URL PNG generated at boot). Camera gets **cursor parallax**: yaw offset
  `= ndc.x × 4°`, pitch `= ndc.y × 3°`, damped `k = 10/s`. Keyboard `Esc` / `E` are now normal
  keydowns → `exit` → stand up; the same keydown handler calls `requestLock()` (keydown is a user
  gesture). If the lock is refused, show the "CLICK TO CONTINUE" veil; clicking re-locks.
* `ui` mode (chat, modal, panels): all game actions suppressed; `Esc` closes the topmost panel.
* `Tab` and `F1` `preventDefault()` while the canvas has focus. Never bind Ctrl combos (Ctrl+W).

### 2.7 Event bus — `src/core/events.ts`

```ts
export class EventBus<M extends object> {
  on<K extends keyof M>(type: K, fn: (p: M[K]) => void): () => void;     // returns unsubscribe
  once<K extends keyof M>(type: K, fn: (p: M[K]) => void): () => void;
  off<K extends keyof M>(type: K, fn: (p: M[K]) => void): void;
  emit<K extends keyof M>(type: K, payload: M[K]): void;                 // synchronous; handler errors caught+logged
  clear(): void;
}
export interface GameEvents {
  'app:state': { from: AppStateId; to: AppStateId };
  'app:pause': { paused: boolean };
  'settings:changed': { key: keyof Settings };
  'lang:changed': { lang: Lang };
  'input:lock': { locked: boolean };
  'player:seat': { pid: PlayerId; mid: InstanceId; seat: number; on: boolean };
  'player:fall': { pid: PlayerId };                 // trapdoor
  'player:ghost': { pid: PlayerId };
  'machine:round': { mid: InstanceId; machineId: MachineId; pid: PlayerId; bet: number };
  'machine:result': { mid: InstanceId; machineId: MachineId; pid: PlayerId; bet: number; gross: number; credited: number; tier: WinTier; tags: string[] };
  'machine:jackpot': { mid: InstanceId; machineId: MachineId; pid: PlayerId; amount: number; pool: string };
  'eco:wallet': { pid: PlayerId; wallet: number; delta: number; reason: string };
  'run:phase': { phase: RunPhase };
  'run:deadline': { index: number; due: number; seconds: number };
  'run:deposit': { pid: PlayerId; amount: number; paid: number; due: number };
  'run:clock': { remaining: number };               // 1 Hz
  'run:end': { summary: RunSummary };
  'charm:add': { pid: PlayerId; charmId: string };
  'charm:remove': { pid: PlayerId; charmId: string };
  'charm:proc': { pid: PlayerId; charmId: string };  // a charm triggered (HUD flash)
  'phone:ring': { callId: number };
  'phone:end': { callId: number };
  'net:status': { status: 'offline' | 'connecting' | 'host' | 'client' | 'lost' };
  'net:peer': { pid: PlayerId; joined: boolean; name: string };
  'chat:msg': { from: PlayerId; text: string; sys: boolean };
}
export const bus: EventBus<GameEvents>;   // same instance as app.events
```
Feature folders may add events by **declaration merging in their own files** (no shared edit):
`declare module '../../core/events' { interface GameEvents { 'hotline:choice': { callId: number; choice: number } } }`.
Event names: `domain:verb`; machine-private events `m.<id>:<verb>`.

### 2.8 RNG — `src/core/rng.ts`

```ts
export interface Rng {
  readonly seed: number;
  next(): number;                                   // [0,1)
  int(min: number, max: number): number;            // inclusive both ends
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  weightedIndex(weights: readonly number[]): number;
  shuffle<T>(arr: T[]): T[];                        // in place, Fisher–Yates
  gauss(mean?: number, sd?: number): number;
  fork(label: string | number): Rng;                // deterministic child stream
  getState(): [number, number, number, number];
  setState(s: [number, number, number, number]): void;
}
export function createRng(seed: number | string): Rng;      // sfc32, seeded through cyrb128
export function hashSeed(...parts: Array<string | number>): number;   // uint32
```
Seed derivation (identical on every peer): `runSeed` (uint32, host picks, `?seed=` overrides) →
* machine occupancy stream: `hashSeed(runSeed, mid, occCounter)` — sent in `moccOk.seed`;
* table (host) stream: `hashSeed(runSeed, mid, 'table')`;
* world/init stream: `hashSeed(runSeed, mid, 'init')` (identical layout on all peers);
* `app.rng.cosmetic`: `Math.random`-seeded, visuals only, never outcomes.
`Math.random()` is **forbidden** for any outcome; allowed only through `cosmetic`.

### 2.9 Tween / timers — `src/core/tween.ts`, `src/core/timers.ts`

```ts
export type Ease = 'linear' | 'inQuad' | 'outQuad' | 'inOutQuad' | 'inCubic' | 'outCubic' | 'inOutCubic'
  | 'outBack' | 'outElastic' | 'outBounce' | 'inExpo' | 'outExpo';
export interface TweenOpts { ease?: Ease; delay?: number; stepFps?: number /* PSX stepped anim, e.g. 15 */; onDone?: () => void }
export interface TweenHandle { readonly promise: Promise<void>; readonly done: boolean; cancel(): void }
export interface TweenSystem {
  run(dur: number, fn: (k: number) => void, o?: TweenOpts): TweenHandle;   // k: eased 0..1
  to<T extends object>(target: T, props: { [P in keyof T]?: number }, dur: number, o?: TweenOpts): TweenHandle;
  vec3(v: THREE.Vector3, to: THREE.Vector3, dur: number, o?: TweenOpts): TweenHandle;
  shake(obj: THREE.Object3D, amp: number, dur: number): TweenHandle;       // position jitter, restores
  punch(obj: THREE.Object3D, amount: number, dur: number): TweenHandle;    // scale punch, restores
  spin(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', radians: number, dur: number, o?: TweenOpts): TweenHandle;
  killOf(target: object): void;
  update(dt: number): void;
}
export interface Timers {
  after(sec: number, fn: () => void): () => void;   // returns cancel
  every(sec: number, fn: () => void): () => void;
  wait(sec: number): Promise<void>;
  update(dt: number): void;
}
export const ease: Record<Ease, (k: number) => number>;
```

### 2.10 UI overlay — `src/core/ui/types.ts`

DOM overlay `#ui` above the canvas (`pointer-events:none` except panels). Pixel scale CSS var
`--px = max(1, floor(innerHeight / 270))`; all sizes are multiples of `--px`. Fonts: headings
`Press Start 2P` at 8×--px, body `VT323` at 16×--px. Every text argument is an **already translated**
string (call `t()` first).

```ts
export type ToastKind = 'info' | 'good' | 'bad' | 'warn' | 'sys';
export interface HudHint { action: Action | `m.${MachineAction}` | MachineAction; label: string }
export interface MachineHudSpec {
  title?: string;                 // defaults to machine name
  bet?: number | null;            // shows ◄ BET n ► ; null hides
  showWallet?: boolean;           // default true
  hints: HudHint[];               // key glyph from input.keyLabel + label
  stats?: Array<{ label: string; value: string }>;   // e.g. "STREAK 3"
}
export interface ModalSpec { title: string; body?: string; buttons: Array<{ id: string; label: string; kind?: 'primary' | 'danger' }>; input?: { placeholder: string; maxLength: number; password?: boolean } }
export interface PanelHandle { readonly el: HTMLElement; close(): void }
export interface UIOverlay {
  readonly root: HTMLElement;
  readonly blocking: boolean;     // true when a modal/panel/chat has focus → Input mode 'ui'
  update(dt: number): void;
  prompt(p: { action: Action; label: string; sub?: string; disabled?: boolean } | null): void; // "[E] Play Coin Flip"
  toast(text: string, kind?: ToastKind, dur?: number): void;            // top centre, max 4 stacked, default 2.5 s
  bigWin(amount: number, tier: WinTier, title: string): Promise<void>;  // big 2.5 s, huge 4 s, jackpot 6 s; skippable after 0.8 s
  machineHud(spec: MachineHudSpec | null): void;                        // bottom bar while seated
  subtitle(text: string | null, speaker?: string, dur?: number): void;  // phone dialogue
  choice(title: string, options: string[], o?: { timeout?: number }): Promise<number>;  // −1 on timeout
  modal(spec: ModalSpec): Promise<{ id: string; value?: string } | null>;
  panel(id: string, build: (el: HTMLElement) => (() => void) | void): PanelHandle;
  closePanel(id: string): void;
  crosshair(style: 'dot' | 'hand' | 'none'): void;
  fade(alpha: number, dur: number, color?: string): Promise<void>;
  flash(color: string, dur: number): void;                              // respects settings.reduceFlashing
  setHudVisible(on: boolean): void;
}
```

### 2.11 i18n — `src/core/i18n.ts`

```ts
export type I18nVars = Record<string, string | number>;
export type StringTable = Record<string, string>;
export function t(key: string, vars?: I18nVars): string;  // "{name} won {n}"; missing → en → key (+warn once in dev)
export function has(key: string): boolean;
export function registerStrings(prefix: string, tables: { en: StringTable; tr: StringTable }): void; // key = prefix + k
export function setLang(l: Lang): void;                    // emits 'lang:changed'
export function lang(): Lang;
export function fmtCoins(n: number): string;               // en "1,250" · tr "1.250" (suffix from 'common.coinSuffix')
export function fmtTime(sec: number): string;             // "4:05"
export function upper(s: string): string;                  // toLocaleUpperCase('tr-TR' | 'en-US')
```
Plurals: if `vars.n` is given and `key + '.one'` / `key + '.other'` exist, `t` picks `.one` when
`n === 1` (en) — Turkish always uses `.other`.

### 2.12 Save — `src/core/save.ts`, `src/core/settings.ts`

```ts
export interface Settings {
  lang: Lang; mouseSens: number /* rad/px 0.0005..0.006, def 0.0022 */; invertY: boolean;
  fov: number /* 60..95, def 72 */; headBob: number /* 0..1, def 1 */; viewmodel: boolean;
  vol: { master: number; sfx: number; ui: number; music: number; amb: number };
  psx: PsxSettings; showFps: boolean; crosshair: 'dot' | 'cross' | 'none';
  subtitles: boolean; reduceFlashing: boolean;
  keybinds: Partial<Record<string, string[]>>;
  net: { lobbyUrl: string /* '' = default */; useServer: boolean; useTab: boolean; useP2P: boolean /* def false */;
         turn: { urls: string; username: string; credential: string } | null };
}
export interface SaveData {
  v: 1;
  profile: { id: string /* random 16 hex, stable client id */; name: string /* 1–16 chars */; color: Hex };
  settings: Settings;
  stats: Record<string, number>;     // lifetime counters (spins, wins, deepestFloor…)
  unlocks: string[];
  seen: Record<MachineId, number>;   // rounds played per machine (bestiary)
  history: RunSummary[];             // last 20
  resume: RunSnapshot | null;        // SP "Continue": written at each deadline start
}
export interface SaveStore {
  readonly data: SaveData;
  load(): void;
  update(fn: (d: SaveData) => void): void;        // mutate, debounced write 500 ms
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;   // emits settings:changed
  flush(): void; reset(): void;
}
```
Storage key `jackid:v1` (run resume: `jackid:run:v1`, recent players: `jackid:recent:v1`). All `localStorage` access wrapped in try/catch (private mode → in-memory).
Unknown/older data is migrated or reset per field, never throws.

### 2.13 Economy / Run — `src/game/types.ts`

```ts
export type WinTier = 'none' | 'push' | 'small' | 'medium' | 'big' | 'huge' | 'jackpot';
// tierFor(gross, bet) — AMENDED §11.5: 0 → none; ≤1× → push; <3× small; <10× medium; <25× big (tag bigwin);
// <50× huge (tag hugewin); ≥50× mega (tag megawin); 'jackpot' only when the machine tags the round `jackpot`.
export type RunPhase = 'intro' | 'play' | 'deadline' | 'falling' | 'ascending' | 'endless' | 'over';
export type ModHook =
  | 'bet.costMult'    // ×coin cost of a bet (nominal bet for payouts unchanged), default 1, clamp 0..10
  | 'payout.mult'     // ×gross winnings when gross>0, default 1, clamp 0..100
  | 'payout.flat'     // +coins on any win, default 0
  | 'loss.refund'     // fraction of bet refunded when gross==0, default 0, clamp 0..1
  | 'luck'            // integer luck points, default 0, clamp −10..20 (each machine defines effect)
  | 'jackpot.mult'    // ×jackpot pool claims, default 1
  | 'reroll'          // free re-spins/redraws per round where supported, default 0
  | 'deposit.bonus'   // fraction added to debt deposits, default 0
  | 'shop.discount'   // fraction off charm prices, default 0, clamp 0..0.9
  | 'time.bonus'      // seconds added per deadline, default 0
  | `m.${string}`;    // machine-specific, e.g. 'm.roulette.zeroRefund' (documented in machine catalogue)
export interface EcoSource { mid: InstanceId; machineId: MachineId }
export interface WinMeta { bet: number; tier: WinTier; tags?: string[]; silent?: boolean }
export interface DebtState { index: number; due: number; paid: number; deadlineAt: number /* host ms */; floor: number; total: number }
export interface CharmState { id: string; stacks: number; data?: Json }
export interface RunApi {
  readonly mode: GameMode; readonly phase: RunPhase; readonly seed: number; readonly selfId: PlayerId;
  wallet(pid?: PlayerId): number;
  canAfford(cost: number, pid?: PlayerId): boolean;
  /** Local player stakes `amount` (nominal). Charges ceil(amount × bet.costMult). Sync. MP: optimistic + host confirm. */
  bet(amount: number, src: EcoSource): boolean;
  /** Local player wins `gross` (pre-modifier). Applies payout.mult/flat or loss.refund. Shows personal toast/banner by tier. Returns coins credited. */
  win(gross: number, src: EcoSource, meta: WinMeta): number;
  deposit(amount: number): boolean;                         // Debt Terminal only
  give(to: PlayerId, amount: number): boolean;              // co-op transfer
  buyCharm(charmId: string, price: number): boolean;        // Charm vendor only
  // HOST ONLY — shared tables (throws in dev if !isHost)
  hostBet(pid: PlayerId, amount: number, src: EcoSource): boolean;
  hostWin(pid: PlayerId, gross: number, src: EcoSource, meta: WinMeta): number;
  // modifiers
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number;
  luck(machineId: MachineId, pid?: PlayerId): number;
  charms(pid?: PlayerId): readonly CharmState[];
  // shared pools
  jackpot(pool: string): number;
  jackpotAdd(pool: string, amount: number): void;
  jackpotClaim(pool: string, src: EcoSource): number;       // host pays pool value at receipt
  // run info
  debt(pid?: PlayerId): DebtState;                          // co-op: team debt (pid 0)
  timeLeft(): number;                                       // s to current deadline
  isLocked(machineId: MachineId): boolean;                  // tier gating
  alive(pid?: PlayerId): boolean;
  stat(key: string, add?: number): number;
  // hotline (system machine 'hotline' only)
  phone(): PhoneCallState | null;
  answerPhone(choice: number): void;                        // −1 = pick up; host resolves
}
```
Charm modifier fold: `value = base; for charm of owned (acquisition order): value = charm.modify?(hook, machineId, value, ctx) ?? value; clamp(hook)`.
Charm defs (`src/game/charms/defs/<id>.ts`, glob-registered) export `charm: CharmDef`:
```ts
export interface CharmDef {
  id: string; rarity: 'common' | 'uncommon' | 'rare' | 'cursed' | 'legendary'; price: number; maxStacks?: number;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };   // → 'charm.<id>.*'
  icon: SymbolId;
  modify?(hook: ModHook, machineId: MachineId, value: number, c: CharmCtx): number;
  on?: { [K in keyof GameEvents]?: (p: GameEvents[K], c: CharmCtx) => void };      // host-side triggers
}
export interface CharmCtx { pid: PlayerId; stacks: number; run: RunApi; rng: Rng; proc(): void; data: Record<string, Json> }
```

### 2.14 Interaction, collision, player — `src/world/types.ts`, `src/player/local.ts`

```ts
export interface LocalAABB { min: V3; max: V3; tag?: 'solid' | 'low' | 'walkable' }  // machine-local
export interface Interactable {
  id: string; box: THREE.Box3;               // world space
  maxDist?: number;                          // default 2.2 m (tables 2.8)
  priority?: number;                         // higher wins when overlapping
  enabled(): boolean;
  label(): string;                           // translated, e.g. "Play Coin Flip"
  sub?(): string;                            // "Bet 5–100" / "Occupied: Ayşe" / "Locked until floor 3"
  onInteract(): void;
}
export interface InteractionSystem {
  add(i: Interactable): () => void;
  readonly focused: Interactable | null;     // updated each step: ray from camera centre, occluded by 'solid'
}
export interface CollisionWorld {
  addStatic(box: THREE.Box3, tag?: LocalAABB['tag']): number;
  addLocal(boxes: LocalAABB[], matrix: THREE.Matrix4, tag?: string): number[];  // machine colliders → world AABBs
  remove(id: number): void;
  setEnabled(id: number, on: boolean): void;   // trapdoor floor panels
  moveAndSlide(pos: THREE.Vector3, half: THREE.Vector3, delta: THREE.Vector3): { grounded: boolean; hitX: boolean; hitZ: boolean };
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { dist: number; id: number } | null;
  floorAt(x: number, z: number, fromY: number): number | null;   // null = hole
}
export interface LocalPlayer {
  readonly id: PlayerId; readonly camera: THREE.PerspectiveCamera;
  readonly pos: THREE.Vector3; yaw: number; pitch: number;
  readonly mode: 'walk' | 'gliding' | 'seated' | 'falling' | 'ghost' | 'cinematic';
  readonly seat: { mid: InstanceId; seat: number } | null;
  enterMachine(mid: InstanceId, seat: number, pose: PlayPose, poseMatrix: THREE.Matrix4): Promise<void>;
  exitMachine(): Promise<void>;
  teleport(pos: THREE.Vector3, yaw: number): void;
  cinematic(keys: Array<{ pos: V3; look: V3; dur: number; ease?: Ease }>): Promise<void>;
  shake(amp: number, dur: number): void;
  setGhost(on: boolean): void;
}
```
FPS constants (player WP): eye 1.62 m (crouch 1.05), body AABB half-extents 0.25×0.9×0.25
(crouch 0.25×0.6×0.25), walk 3.0 m/s, sprint 5.0 m/s, crouch 1.6 m/s, accel 30 m/s², friction 12/s,
gravity 9.8 m/s², step-up ≤ 0.35 m, pitch clamp ±85°, head-bob 0.035 m vertical / 0.02 m lateral at
1.9 Hz walk / 2.6 Hz sprint (× settings.headBob), footstep sfx at each bob trough, fall below y = −12
→ fade. **Glide:** 0.6 s `inOutCubic` (position lerp, quaternion slerp, FOV lerp) to the play pose;
stand-up glide 0.45 s to a point 0.9 m in front of the interact box at eye height.

### 2.15 FX — `src/core/fx.ts`

```ts
export interface FxApi {
  coins(at: THREE.Vector3, n: number, o?: { spread?: number; up?: number }): void;   // ≤ 60 per call
  sparks(at: THREE.Vector3, n: number, color: Hex): void;
  confetti(at: THREE.Vector3, n: number): void;
  smoke(at: THREE.Vector3, n: number): void;
  popText(at: THREE.Vector3, text: string, color: Hex, dur?: number): void;            // floating "+250"
  shake(amp: number, dur: number): void;                                                // local camera
  clear(): void;
}
```
One `Points` mesh per effect type (pooled, ≤ 512 particles each, ≤ 2 000 total).

---

## 3. THE MACHINE CONTRACT

### 3.1 Types — `src/machines/_base/types.ts`

```ts
import type * as THREE from 'three';
export type SlotSize = 'S' | 'M' | 'L' | 'XL';
export type ZoneId = 'mouth' | 'well' | 'lobby' | 'midway' | 'cards' | 'laundry' | 'boiler' | 'gallery' | 'wheels'
  | 'parlour' | 'counting' | 'lift' | 'sump';      // GDD §8.3 (supersedes the v1.0 reference zones, §11.2)
export type MachineCategory = 'slot' | 'video' | 'table' | 'card' | 'dice' | 'wheel' | 'physics'
  | 'lottery' | 'skill' | 'oddity' | 'system';
export interface MachineStrings { en: Record<string, string>; tr: Record<string, string> }  // must contain name, desc

export interface MachineDef {
  id: MachineId;                  // === folder name
  category: MachineCategory;
  slotSize: SlotSize;             // must fit SLOT_DIMS[slotSize]
  zone: ZoneId;                   // preferred zone for auto-placement
  seats: number;                  // 1 for solo machines; >1 ⇒ class must extend TableBase
  shared: boolean;                // true ⇒ TableBase, host-resolved
  minBet: number; maxBet: number; // coins; system machines 0/0
  betSteps?: number[];            // default: doubling from minBet to maxBet
  maxPayoutMult: number;          // host sanity cap: gross ≤ bet × this (jackpot claims exempt)
  rtp?: number;                   // informational target RTP (catalogue)
  tier?: number;                  // unlock: available from deadline index ≥ tier (0 = always)
  modes?: GameMode[];             // default: all
  attractRadius?: number;         // m, default 14
  strings: MachineStrings;        // keys auto-prefixed 'm.<id>.'
}

export interface PlayPose {
  pos: THREE.Vector3;             // camera position, machine-local
  look: THREE.Vector3;            // look-at point, machine-local
  fov?: number;                   // default 55
  mouse?: 'primary' | 'pick';     // default 'primary'
}
export interface SeatDef {
  pose: PlayPose;
  stand: THREE.Vector3;           // where the avatar body stands/sits (machine-local, y = 0)
  avatar: 'stand' | 'sit';
}
export interface MachineModel<P extends object = Record<string, THREE.Object3D>> {
  root: THREE.Group;              // origin = floor centre of footprint, +Z = front, Y up, metres
  parts: P;                       // named animated parts (contract with the coder)
  playPose: PlayPose;             // seat 0 pose (solo machines)
  seats?: SeatDef[];              // tables: one per seat (seats.length === def.seats)
  colliders: LocalAABB[];         // player-blocking boxes, machine-local
  interact: LocalAABB;            // crosshair target volume
  anchors: Record<string, THREE.Object3D>;  // 'speaker' (required), 'prompt', 'light', 'insideGlass', 'coinOut', …
  dispose?: () => void;
}
export interface MachineEvent { k: string; [key: string]: Json }   // declare your events as `type` aliases
export interface MachineEnvelope { mid: InstanceId; seq: number; pid: PlayerId; ev: Json }
export interface PresentCtx {
  local: boolean;                 // this peer emitted the event
  pid: PlayerId;                  // player who caused it (tables: acting player or 0 for dealer)
  seq: number;
  fast: boolean;                  // queue is lagging (>4 pending) → shorten animations to ≤ 0.1 s
}
export interface MachineContext {
  readonly instanceId: InstanceId;
  readonly def: MachineDef;
  readonly slot: SlotDef;
  readonly kit: Kit;
  readonly audio: AudioEngine;
  readonly ui: UIOverlay;
  readonly input: Input;
  readonly events: EventBus<GameEvents>;
  readonly run: RunApi;
  readonly net: MachineNet;
  readonly tweens: TweenSystem;   // sim clock
  readonly timers: Timers;        // sim clock
  readonly time: TimeInfo;
  readonly camera: THREE.PerspectiveCamera;
  readonly fx: FxApi;
  readonly runSeed: number;
}
export interface MachineNet {
  readonly selfId: PlayerId; readonly isHost: boolean; readonly online: boolean;
  sendEvent(env: MachineEnvelope): void;                     // routed by Session
  sendAction(mid: InstanceId, seat: number, rid: number, a: Json): void;
  sendNak(to: PlayerId, mid: InstanceId, rid: number, reason: string): void;
  requestRelease(mid: InstanceId, seat: number): void;
  playerName(pid: PlayerId): string; playerColor(pid: PlayerId): Hex;
}
export interface MachineModule { def: MachineDef; default: new (ctx: MachineContext) => AnyMachine }
export type AnyMachine = MachineBase<object, MachineEvent, Json>;
export const SLOT_DIMS: Record<SlotSize, { w: number; d: number; h: number; stand: number }> = {
  // GDD §8.5 (binding, §11.2). w = footprint max along local X, d = along local Z, h = max height.
  S:  { w: 0.8, d: 0.8, h: 2.0, stand: 1.0 },
  M:  { w: 1.2, d: 1.0, h: 3.2, stand: 1.0 },
  L:  { w: 2.6, d: 1.8, h: 2.4, stand: 1.0 },   // tables: stools/seats are inside the footprint
  XL: { w: 4.8, d: 2.6, h: 3.8, stand: 1.2 },
};
```
Model bounds rule: everything inside `x∈[−w/2,w/2], z∈[−d/2,d/2], y∈[0,h]`; the strip
`z∈[d/2, d/2+stand]` in front must stay free of colliders (players stand there).

### 3.2 Lifecycle

```
registry.load()          eager glob → validate def (id === folder, strings.name/desc, seats↔shared)
World.build()            for each slot: ctor = registry.get(machineId)
  new Ctor(ctx)          constructor: stores ctx ONLY (never build, never touch subclass fields)
  m._build()             model = createModel(kit) in try/catch → on throw: kit.outOfOrder(size) placeholder
  slotGroup.add(root)    slot transform applied (pos, rotY)
  colliders/interact     transformed to world AABBs, registered
  m.init()               subclass setup (screens, initial state from this.worldRng)
  m.setLocked(run.isLocked(def.id))
per fixed step          m.tick(dt) on all peers; m.hostTick(dt) on host only
per frame               if visible: m.frame(dt,t); if visible && no occupant && !busy: m.attract(dt,t)
occupy                  E → request → host grants (moccOk) → all peers: seats[s]=pid, onOccupy(pid,s,local)
                        local: camera glide, Input mode 'machine', sink = machine, rng = createRng(seed)
play                    onInput/onPointer → logic → emit(ev) → present(ev) everywhere
release                 E/Esc → standUp() → deferred while busy (≤ 10 s, then forced) → mrel → onRelease
dispose                 World.dispose → m.dispose() → disposer frees non-shared GPU resources
```

### 3.3 `MachineBase` — `src/machines/_base/MachineBase.ts`

```ts
export abstract class MachineBase<P extends object = Record<string, THREE.Object3D>,
                                  E extends MachineEvent = MachineEvent,
                                  S extends Json = Json> {
  readonly ctx: MachineContext;
  readonly def: MachineDef;
  readonly id: InstanceId;
  model: MachineModel<P>;
  readonly seats: (PlayerId | null)[];     // length def.seats
  busy: boolean;                          // a solo round is in progress (blocks release)
  locked: boolean;
  bet: number;                            // selected bet (local UI), starts at def.minBet
  rng: Rng;                               // occupancy stream; valid while the local player occupies
  readonly hostRng: Rng;                  // table stream; meaningful on host only
  readonly worldRng: Rng;                 // identical on all peers
  readonly cosmetic: Rng;                 // unsynced visuals
  visible: boolean;                       // maintained by World

  constructor(ctx: MachineContext);

  // ── override points ───────────────────────────────────────────────
  protected abstract createModel(kit: Kit): MachineModel<P>;   // usually `return buildModel(kit)`
  init(): void;
  tick(dt: number): void;                 // fixed 60 Hz, every peer — keep ≤ 0.05 ms when idle
  hostTick(dt: number): void;             // fixed 60 Hz, host only (tables, shared timers)
  frame(dt: number, t: number): void;     // render rate, only when visible — visual-only
  attract(dt: number, t: number): void;   // render rate, visible && unoccupied && !busy
  onOccupy(pid: PlayerId, seat: number, local: boolean): void;
  onRelease(pid: PlayerId, seat: number, local: boolean): void;
  onInput(e: MachineInputEvent): void;    // local occupant only, delivered at step start
  onPointer(e: MachinePointerEvent): void;// local occupant only, pose.mouse === 'pick'
  abstract present(ev: E, pc: PresentCtx): void | Promise<void>;   // ALL peers incl. emitter
  getSnapshot(): S | null;                // default null (stateless machine)
  applySnapshot(s: S): void;
  setLocked(on: boolean): void;           // default: adds/removes kit.lockOverlay(def.slotSize)
  debugForce?(arg: string): void;         // bench "force outcome" field
  dispose(): void;                        // call super.dispose() if overridden

  // ── helpers (final) ───────────────────────────────────────────────
  get parts(): P;
  get root(): THREE.Group;
  get isHost(): boolean;
  get selfId(): PlayerId;
  get occupant(): PlayerId | null;        // seats[0]
  get isLocalOccupant(): boolean;
  get localSeat(): number;                // −1 if not seated here
  get src(): EcoSource;
  protected emit(ev: E): Promise<void>;   // stamp → present locally (queued) → network; resolves when local present finished
  protected beginRound(bet?: number): boolean;   // solo: !busy, run.bet(); toast+buzzer on failure; busy=true
  protected settle(r: { gross: number; tier?: WinTier; tags?: string[] }): number;   // run.win(); busy=false; returns credited
  protected stepBet(dir: 1 | -1): void;   // walk def.betSteps, clamp to wallet
  protected maxBet(): void;
  protected mod(hook: ModHook, base: number): number;   // run.getModifier(hook, def.id, base)
  protected luck(): number;
  protected anim(dur: number, fn: (k: number) => void, ease?: Ease): Promise<void>;  // sim clock
  protected wait(sec: number): Promise<void>;           // sim clock
  protected sfx(name: SfxName | string, o?: PlayOpts): void;   // positional at anchors.speaker
  protected t(key: string, vars?: I18nVars): string;    // t('m.<id>.' + key)
  protected hud(spec: MachineHudSpec | null): void;     // only acts for the local occupant
  protected toast(text: string, kind?: ToastKind): void;// only for the local occupant
  protected pick(targets: THREE.Object3D[]): THREE.Intersection | null;   // ray from current cursor
  protected standUp(): void;                            // request release (deferred while busy)
  protected track<T extends { dispose(): void }>(d: T): T;   // disposed in dispose()
}
```

Reference semantics of the internals (TD implements exactly this):

```ts
protected emit(ev: E): Promise<void> {
  const ok = this.def.shared ? this.isHost : this.isLocalOccupant;
  if (!ok) { log.warn('machine', `${this.id} illegal emit ${ev.k}`); return Promise.resolve(); }
  const env: MachineEnvelope = { mid: this.id, seq: ++this._seqOut, pid: this.selfId, ev };
  this.ctx.net.sendEvent(env);            // client → host (host validates & forwards) | host → all clients
  return this._enqueue(env, true);
}
_receive(env: MachineEnvelope): void {     // called by World for remote envelopes
  if (env.seq <= (this._lastSeq.get(env.pid) ?? 0)) return;   // duplicate
  this._lastSeq.set(env.pid, env.seq);
  void this._enqueue(env, false);
}
private _enqueue(env: MachineEnvelope, local: boolean): Promise<void> {
  const pc: PresentCtx = { local, pid: env.pid, seq: env.seq, fast: this._pending > 4 };
  this._pending++;
  this._chain = this._chain.then(async () => {
    try { await this.present(env.ev as E, pc); } catch (e) { log.error('machine', this.id, e); }
    finally { this._pending--; }
  });
  return this._chain;
}
protected settle(r: { gross: number; tier?: WinTier; tags?: string[] }): number {
  const bet = this._roundBet;
  const tier = r.tier ?? tierFor(r.gross, bet);
  const credited = this.ctx.run.win(r.gross, this.src, { bet, tier, tags: r.tags ?? [] });
  this.busy = false;
  if (this._releaseRequested) this.standUp();
  return credited;
}
```

**Golden rules for machine code**
1. **Logic decides, present applies.** Outcome logic (RNG, rule evaluation) runs only on the
   authority (local occupant for solo machines, host for tables). It packs the full outcome into an
   event and calls `emit`. **All persistent machine state is mutated only inside `present()`**, so
   every peer (and the host, for late-join snapshots) converges. Logic reads state, never writes it.
2. Events are small JSON (`type` aliases, ≤ 1 KB, numbers/strings/arrays). Event kinds starting with
   `_` are reserved for the base classes.
3. `present()` = world feedback for everyone (animation, sound, lights, machine screen).
   `settle()`/`run.win()` = wallet + personal UI (toast/banner) for the winner only. Machines never call
   `ui.bigWin` directly (exception: scripted set pieces with `silent:true` meta).
4. Use `this.rng` for outcomes, `this.cosmetic` for visual noise, never `Math.random()`.
5. Never `setTimeout`; use `this.wait` / `this.anim` (they freeze with SP pause).
6. `present()` must tolerate `pc.fast` (skip to final pose) and must not assume the local player is
   the occupant.
7. Release while `busy` is deferred; your round must always reach `settle()` (wrap in try/finally).
8. No module-level mutable state; no imports from other machine folders.

### 3.4 `TableBase` — `src/machines/_base/TableBase.ts` (host-resolved shared tables)

```ts
export abstract class TableBase<P extends object, E extends MachineEvent, S extends Json, A extends Json>
  extends MachineBase<P, E, S> {
  /** Any peer: the local seated player sends an action to the host (SP: delivered synchronously next step). */
  protected act(a: A): void;
  /** HOST ONLY: validate + resolve; call this.emit(...) with results; reject with nak(). */
  protected abstract onAction(pid: PlayerId, seat: number, a: A, rid: number): void;
  protected nak(pid: PlayerId, rid: number, reasonKey: string): void;   // client gets toast(t(reasonKey))
  protected seatOf(pid: PlayerId): number;                               // −1 if not seated
  protected seated(): Array<{ seat: number; pid: PlayerId }>;
  protected chargeSeat(seat: number, amount: number): boolean;           // host: run.hostBet
  protected paySeat(seat: number, gross: number, meta?: Partial<WinMeta>): number;  // host: run.hostWin
  protected countdown(sec: number, label: string): Promise<void>;        // host: emits '_timer'; base shows ring/screen timer on all peers
  readonly bots: Array<{ seat: number; name: string; rng: Rng }>;        // host-side AI seats (hold'em)
  addBot(seat: number, name: string): void;
}
```
Table flow: seated client → `act(a)` → `tact` message → host `onAction` → host `chargeSeat` /
`emit({k:'chip',…})` → all peers `present`. Round phases (e.g. `betting 15 s → dealing → decisions
(20 s per seat, auto-stand/fold on timeout) → payout 3 s`) live in `hostTick` and are announced via
events. Leaving a table mid-round forfeits that seat's stakes; the hand is auto-played/folded by host.
`busy` is not used by tables (release never blocks).

### 3.5 Registration — `src/machines/_base/registry.ts`

```ts
const mods = import.meta.glob<MachineModule>('../*/index.ts', { eager: true });
const table = new Map<MachineId, MachineModule>();
export function load(): void {
  for (const [path, mod] of Object.entries(mods)) {
    const folder = path.split('/')[1];
    if (folder.startsWith('_')) continue;
    if (!mod.def || mod.def.id !== folder) { log.error('registry', `bad def in ${path}`); continue; }
    registerStrings(`m.${folder}.`, mod.def.strings);
    table.set(folder, mod);
  }
}
export const get = (id: MachineId): MachineModule | undefined => table.get(id);
export const all = (): MachineModule[] => [...table.values()];
```
Never create `_base/index.ts`. A machine folder without a valid `index.ts` is simply absent (its
slots show `kit.outOfOrder`).

### 3.6 COMPLETE reference machine — Coin Flip Booth

Copy this pattern. (Rules/odds here are illustrative; the machine catalogue is authoritative: the shipped `coinflip` uses
CROWN / SKULL / EDGE, 49/49/2, rides and a 0.78 × 0.78 × 2.00 m bell-jar booth — MACHINES_tables §15, PLAN.md. The core
author ships this simplified version in M0 as the bench reference; the coinflip coder package replaces it in M2.
`buildModel` gains a second argument `o: ModelOpts` (§11.5); this M0 example may ignore it.)

`src/machines/coinflip/model.ts`
```ts
import * as THREE from 'three';
import type { Kit, ButtonPart, LampPart, ScreenSurface, MarqueePart } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';

/** Contract between modeler and coder. Metres; origin = floor centre; +Z = front (player side). */
export type CoinFlipParts = {
  coinPivot: THREE.Object3D;   // translates in Y during the toss
  coin: THREE.Mesh;            // rotates about local X; heads face points +Y at rotation.x = 0
  btnHeads: ButtonPart;
  btnTails: ButtonPart;
  lampHeads: LampPart;
  lampTails: LampPart;
  screen: ScreenSurface;       // 96×48 px streak display
  marquee: MarqueePart;
};
export const COIN_REST_Y = 1.035;

export function buildModel(kit: Kit): MachineModel<CoinFlipParts> {
  const { pal } = kit;
  const root = kit.group('coinflip');

  // Counter 1.00 × 1.00 × 0.70, brass trim
  const cab = kit.cabinet({ style: 'counter', w: 1.0, h: 1.0, d: 0.7, body: pal.woodDark, trim: pal.brass, grime: 0.3 });
  root.add(cab.root);
  // Back panel 1.00 × 0.70 × 0.08 rising behind the counter
  kit.box(1.0, 0.7, 0.08, { color: pal.redDark, map: kit.tex.wood(pal.redDark) }, { pos: [0, 1.35, -0.31], parent: root });
  // Felt landing dish Ø0.42 + brass ring
  kit.cyl(0.21, 0.21, 0.02, { color: pal.felt, map: kit.tex.felt(pal.felt) }, { pos: [0, 1.01, 0.05], seg: 12, parent: root });
  kit.torus(0.21, 0.015, pal.brass, { pos: [0, 1.02, 0.05], rot: [90, 0, 0], seg: 12, parent: root });

  // Coin Ø0.09 × 0.012
  const coinPivot = new THREE.Object3D();
  coinPivot.position.set(0, COIN_REST_Y, 0.05);
  root.add(coinPivot);
  const coin = kit.coin({ r: 0.045, thick: 0.012, heads: 'crown', tails: 'eye', color: pal.gold });
  coinPivot.add(coin);

  // Call buttons on the front lip
  const btnHeads = kit.button({ shape: 'mushroom', r: 0.04, color: pal.gold, label: { key: 'm.coinflip.heads' } });
  btnHeads.root.position.set(-0.28, 1.0, 0.28);
  const btnTails = kit.button({ shape: 'mushroom', r: 0.04, color: pal.chrome, label: { key: 'm.coinflip.tails' } });
  btnTails.root.position.set(0.28, 1.0, 0.28);
  root.add(btnHeads.root, btnTails.root);

  // Lamps + screen on the back panel
  const lampHeads = kit.lamp({ r: 0.05, color: pal.gold, shape: 'dome' });
  lampHeads.root.position.set(-0.32, 1.45, -0.26);
  const lampTails = kit.lamp({ r: 0.05, color: pal.neonCyan, shape: 'dome' });
  lampTails.root.position.set(0.32, 1.45, -0.26);
  const screen = kit.screen({ w: 0.36, h: 0.18, px: [96, 48], bezel: pal.black });
  screen.mesh.position.set(0, 1.45, -0.265);
  root.add(lampHeads.root, lampTails.root, screen.mesh);

  // Marquee with 18 chaser bulbs
  const marquee = kit.marquee({ w: 1.0, h: 0.22, text: { key: 'm.coinflip.name' }, color: pal.neonYellow, bg: pal.black, bulbs: 18 });
  marquee.root.position.set(0, 1.81, -0.31);
  root.add(marquee.root);
  root.add(kit.blobShadow(1.2, 0.9));

  const parts: CoinFlipParts = { coinPivot, coin, btnHeads, btnTails, lampHeads, lampTails, screen, marquee };
  kit.finalize(root, { keep: [coinPivot, btnHeads, btnTails, lampHeads, lampTails, screen.mesh, marquee] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.48, 0.78), look: new THREE.Vector3(0, 1.08, 0), fov: 55, mouse: 'primary' },
    colliders: [{ min: [-0.5, 0, -0.35], max: [0.5, 1.92, 0.35] }],
    interact: { min: [-0.5, 0.5, -0.35], max: [0.5, 1.92, 0.45] },
    anchors: { speaker: cab.anchors.speaker, prompt: marquee.root },
  };
}
```

`src/machines/coinflip/index.ts`
```ts
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { MachineInputEvent } from '@/core/input';
import type { Kit } from '@/kit/types';
import { t } from '@/core/i18n';
import { buildModel, COIN_REST_Y, type CoinFlipParts } from './model';

type Side = 'H' | 'T';
type Ev =
  | { k: 'call'; side: Side }
  | { k: 'flip'; call: Side; res: Side; bet: number; turns: number };
type State = { call: Side; streak: number; history: Side[] };
const HISTORY = 8;

export const def: MachineDef = {
  id: 'coinflip',
  category: 'oddity',
  slotSize: 'S',
  zone: 'slots',
  seats: 1,
  shared: false,
  minBet: 5, maxBet: 100, betSteps: [5, 10, 25, 50, 100],
  maxPayoutMult: 2,
  rtp: 0.98,
  strings: {
    en: { name: 'Coin Flip Booth', desc: 'Call heads or tails. Pays 2×.', heads: 'Heads', tails: 'Tails', flip: 'Flip', streak: 'STREAK {n}' },
    tr: { name: 'Yazı-Tura Kabini', desc: 'Tura mı yazı mı? 2 katı öder.', heads: 'Tura', tails: 'Yazı', flip: 'At', streak: 'SERİ {n}' },
  },
};

export default class CoinFlip extends MachineBase<CoinFlipParts, Ev, State> {
  private state: State = { call: 'H', streak: 0, history: [] };

  protected createModel(kit: Kit): MachineModel<CoinFlipParts> {
    return buildModel(kit);
  }

  init(): void {
    this.refresh();
  }

  attract(dt: number, time: number): void {
    this.parts.coin.rotation.x += dt * 1.2;            // lazy idle spin
    const on = Math.floor(time * 2) % 2 === 0;         // lamps alternate at 2 Hz
    this.parts.lampHeads.setOn(on);
    this.parts.lampTails.setOn(!on);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.parts.marquee.chase('chase', 6);
    this.refresh();
    if (local) this.showHud();
  }

  onRelease(): void {
    this.parts.marquee.chase('blink', 1);
  }

  onInput(e: MachineInputEvent): void {
    if (!e.down || this.busy) return;
    switch (e.action) {
      case 'left': if (this.state.call !== 'H') void this.emit({ k: 'call', side: 'H' }); break;
      case 'right': if (this.state.call !== 'T') void this.emit({ k: 'call', side: 'T' }); break;
      case 'primary': case 'confirm': void this.flip(); break;
      case 'betUp': this.stepBet(1); this.showHud(); break;
      case 'betDown': this.stepBet(-1); this.showHud(); break;
      case 'betMax': this.maxBet(); this.showHud(); break;
    }
  }

  /** Authority-side logic: runs only on the local occupant. */
  private async flip(): Promise<void> {
    const bet = this.bet;
    if (!this.beginRound(bet)) return;                        // charges wallet, busy = true
    let gross = 0;
    try {
      const pWin = Math.min(0.6, 0.49 + 0.01 * this.luck());  // +1% per luck point
      const win = this.rng.chance(pWin);
      const call = this.state.call;
      const res: Side = win ? call : call === 'H' ? 'T' : 'H';
      await this.emit({ k: 'flip', call, res, bet, turns: this.rng.int(4, 7) });
      gross = win ? bet * 2 : 0;
    } finally {
      this.settle({ gross });                                 // credits + personal UI, busy = false
      this.showHud();
    }
  }

  /** Runs on EVERY peer, including the emitter. The only place state changes. */
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'call') {
      this.state.call = ev.side;
      void (ev.side === 'H' ? this.parts.btnHeads : this.parts.btnTails).press();
      this.sfx('button');
      this.refresh();
      return;
    }
    return this.presentFlip(ev, pc);
  }

  private async presentFlip(ev: Extract<Ev, { k: 'flip' }>, pc: PresentCtx): Promise<void> {
    const { coin, coinPivot, marquee } = this.parts;
    const end = ev.turns * Math.PI * 2 + (ev.res === 'T' ? Math.PI : 0);
    coin.rotation.x = 0;
    this.sfx('coinFlick');
    await this.anim(pc.fast ? 0.1 : 1.1, (k) => {
      coinPivot.position.y = COIN_REST_Y + Math.sin(k * Math.PI) * 0.38;   // 0.38 m toss arc
      coin.rotation.x = end * k;
    });
    coinPivot.position.y = COIN_REST_Y;
    this.sfx('coinLand');
    const won = ev.call === ev.res;
    this.state.history = [ev.res, ...this.state.history].slice(0, HISTORY);
    this.state.streak = won ? this.state.streak + 1 : 0;
    this.refresh();
    if (won) { marquee.chase('win', 12); this.sfx('win1'); } else { this.sfx('lose'); }
    if (!pc.fast) await this.wait(won ? 0.8 : 0.4);
    marquee.chase(this.occupant !== null ? 'chase' : 'blink', 6);
  }

  getSnapshot(): State {
    return { call: this.state.call, streak: this.state.streak, history: [...this.state.history] };
  }

  applySnapshot(s: State): void {
    this.state = { call: s.call, streak: s.streak, history: [...s.history] };
    this.refresh();
  }

  private refresh(): void {
    const { lampHeads, lampTails, screen, coin } = this.parts;
    lampHeads.setOn(this.state.call === 'H');
    lampTails.setOn(this.state.call === 'T');
    coin.rotation.x = this.state.history[0] === 'T' ? Math.PI : 0;
    screen.draw((g, s) => {
      g.fillStyle = '#081008'; g.fillRect(0, 0, s.w, s.h);
      s.text(this.t('streak', { n: this.state.streak }), s.w / 2, 6, { font: 'px5', color: '#7dff7a', align: 'center' });
      this.state.history.forEach((side, i) => {
        g.fillStyle = side === 'H' ? '#e0b84a' : '#39e6ff';
        g.fillRect(6 + i * 11, 30, 8, 8);
      });
    });
  }

  private showHud(): void {
    this.hud({
      bet: this.bet,
      hints: [
        { action: 'left', label: this.t('heads') },
        { action: 'right', label: this.t('tails') },
        { action: 'primary', label: this.t('flip') },
        { action: 'betUp', label: t('common.bet') },
        { action: 'exit', label: t('common.leave') },
      ],
      stats: [{ label: t('common.streak'), value: String(this.state.streak) }],
    });
  }
}
```

### 3.7 Shared logic helpers (`_base/`, TD Phase 0 unless noted)

```ts
// cards.ts
export function newShoe(decks: number, rng: Rng, jokers?: number): CardId[];
export function rankOf(c: CardId): number;                 // 2..14 (A = 14)
export function suitOf(c: CardId): 'S' | 'H' | 'D' | 'C';
export function evalPoker5(cards: CardId[]): { cat: PokerCat; score: number };   // score comparable
export function bestPoker(cards: CardId[]): { cat: PokerCat; score: number; best: CardId[] };  // 5–7 cards
export function bjTotal(cards: CardId[]): { total: number; soft: boolean; bust: boolean; blackjack: boolean };
export function baccaratValue(cards: CardId[]): number;
export type PokerCat = 'high' | 'pair' | 'jacks' | 'twoPair' | 'trips' | 'straight' | 'flush' | 'fullHouse' | 'quads' | 'straightFlush' | 'royal';
// reels.ts
export interface Strip { symbols: SymbolId[]; weights?: number[] }
export function spin(rng: Rng, strips: Strip[], bias?: (reel: number, symbol: SymbolId) => number): number[];   // stop indices
export function windowOf(strip: Strip, stop: number, rows: number): SymbolId[];
export function evalLines(grid: SymbolId[][], lines: number[][], pays: Record<string, number[]>, wild?: SymbolId): Array<{ line: number; symbol: SymbolId; count: number; mult: number }>;
export function evalPatterns(grid: SymbolId[][], patterns: Array<{ id: string; cells: Array<[c: number, r: number]>; mult: number }>, wild?: SymbolId): Array<{ id: string; symbol: SymbolId; mult: number }>;
// peg2d.ts (owner MC-08; read-only for others)
export class Peg2D { constructor(o: { gravity: number; restitution: number; ballR: number }); addPeg(x: number, y: number, r: number): void; addSeg(ax: number, ay: number, bx: number, by: number): void; spawn(x: number, y: number, vx: number, vy: number): number; step(dt: number): void; balls(): ReadonlyArray<{ id: number; x: number; y: number; vx: number; vy: number; alive: boolean }>; onHit: ((ball: number, tag: string) => void) | null; }
// tiers.ts
export function tierFor(gross: number, bet: number): WinTier;
```

---

## 4. Kit API (procedural parts for modelers) — `src/kit/types.ts`

Everything returns objects **not yet added** to any scene, built from `psxMaterial`s, origin at the
part's natural pivot (buttons: base centre; levers: hinge; reels: axle centre). Dimensions in metres.
Default segment counts are PSX-low (cylinders 8–12, spheres 8×6). `MatLike` = `Hex` (lit material of
that colour) | `PsxMatOpts` | `THREE.Material`. `TextSource` = plain string **only for non-language
text** (numbers, symbols) or `{ key, vars }` (translated, auto-redrawn on `lang:changed`).

```ts
export type MatLike = Hex | PsxMatOpts | THREE.Material;
export type TextSource = string | { key: string; vars?: I18nVars };
export interface PrimOpts { pos?: V3; rot?: V3 /* degrees XYZ */; scale?: V3 | number; name?: string; parent?: THREE.Object3D; shade?: boolean /* bake vertex gradient, default true */ }
export type Palette = Record<'black' | 'white' | 'cream' | 'bone' | 'brass' | 'gold' | 'chrome' | 'steel' | 'rust'
  | 'red' | 'redDark' | 'blood' | 'green' | 'felt' | 'feltDark' | 'blue' | 'woodDark' | 'wood' | 'leather'
  | 'carpet' | 'neonPink' | 'neonCyan' | 'neonYellow' | 'glass' | 'void', Hex>;

export interface Kit {
  readonly pal: Palette;
  readonly tex: TexGen;
  mat(o: MatLike): THREE.Material;
  // ── primitives ──
  group(name: string, ...children: THREE.Object3D[]): THREE.Group;
  box(w: number, h: number, d: number, m: MatLike, o?: PrimOpts & { bevel?: number }): THREE.Mesh;
  cyl(rTop: number, rBot: number, h: number, m: MatLike, o?: PrimOpts & { seg?: number; open?: boolean; thetaLen?: number }): THREE.Mesh;
  sphere(r: number, m: MatLike, o?: PrimOpts & { wSeg?: number; hSeg?: number; hemi?: boolean }): THREE.Mesh;
  torus(r: number, tube: number, m: MatLike, o?: PrimOpts & { seg?: number; tubeSeg?: number; arc?: number }): THREE.Mesh;
  plane(w: number, h: number, m: MatLike, o?: PrimOpts & { segW?: number; segH?: number }): THREE.Mesh;
  lathe(profile: Array<[r: number, y: number]>, seg: number, m: MatLike, o?: PrimOpts): THREE.Mesh;
  extrude(shape: Array<[x: number, y: number]>, depth: number, m: MatLike, o?: PrimOpts & { bevel?: number }): THREE.Mesh;
  tube(points: V3[], r: number, m: MatLike, o?: PrimOpts & { seg?: number; radialSeg?: number }): THREE.Mesh;
  // ── finishing ──
  finalize(root: THREE.Object3D, o?: { keep?: Array<THREE.Object3D | { root: THREE.Object3D }> }): { meshesBefore: number; drawCalls: number; tris: number };
  aabb(obj: THREE.Object3D, relativeTo: THREE.Object3D, pad?: number): LocalAABB;
  shade(mesh: THREE.Mesh, o?: { top?: number; bottom?: number }): void;   // bake vertex colours (vertex-lit look)
  // ── cabinets & displays ──
  cabinet(o: CabinetOpts): CabinetPart;
  screen(o: { w: number; h: number; px: [number, number]; bezel?: Hex; glow?: number; scanlines?: boolean }): ScreenSurface;
  marquee(o: { w: number; h: number; text: TextSource; color?: Hex; bg?: Hex; bulbs?: number; font?: FontId }): MarqueePart;
  label(o: { text: TextSource; w: number; h: number; px?: [number, number]; color?: Hex; bg?: Hex | null; font?: FontId }): LabelPart;
  neon(o: { text: TextSource; h: number; color: Hex; flicker?: number }): NeonPart;
  // ── controls ──
  button(o: { shape?: 'round' | 'rect' | 'mushroom'; r?: number; w?: number; h?: number; color: Hex; label?: TextSource; lit?: boolean }): ButtonPart;
  lever(o?: { length?: number; knob?: Hex; side?: 'left' | 'right' }): LeverPart;   // default length 0.45, red knob, right side
  coinSlot(o?: { color?: Hex }): THREE.Group;
  coinTray(o?: { w?: number; color?: Hex }): { root: THREE.Group; anchor: THREE.Object3D };
  crank(o?: { r?: number }): { root: THREE.Group; handle: THREE.Object3D; turn(rev: number, dur: number): Promise<void> };
  // ── lights (emissive only, no THREE.Light) ──
  lamp(o: { r: number; color: Hex; shape?: 'dome' | 'bulb' | 'flat' }): LampPart;
  bulbChain(o: { path: V3[] | { rect: [w: number, h: number] }; count: number; colors: Hex[]; r?: number }): BulbChain;
  glow(o: { color: Hex; size: number; intensity?: number }): THREE.Sprite;   // additive fake light
  blobShadow(w: number, d: number, opacity?: number): THREE.Mesh;
  // ── gambling hardware ──
  reel(o: { radius: number; width: number; symbols: SymbolId[]; cell?: number }): ReelPart;
  wheel(o: { radius: number; segments: Array<{ label: TextSource; color: Hex }>; axis: 'vertical' | 'horizontal'; pegs?: boolean; pocketed?: boolean; hub?: Hex }): WheelPart;
  feltTable(o: FeltTableOpts): FeltTablePart;
  stool(o?: { h?: number; seat?: Hex; leg?: Hex }): THREE.Group;
  chips(o: { max: number }): ChipPool;
  cards(o: { max: number; back?: 'red' | 'blue' | 'black'; scale?: number }): CardPool;
  dice(o: { count: number; size?: number; body?: Hex; pip?: Hex }): DicePool;
  coin(o?: { r?: number; thick?: number; heads?: SymbolId; tails?: SymbolId; color?: Hex }): THREE.Mesh;
  balls(o: { max: number; r: number; color?: Hex; metal?: boolean }): BallPool;
  glass(o: { w: number; h: number; d?: number; tint?: Hex; opacity?: number }): THREE.Mesh;
  dome(o: { r: number; tint?: Hex; opacity?: number }): THREE.Mesh;
  cage(o: { r: number; h: number; bars: number; color?: Hex }): THREE.Group;
  // ── characters ──
  dealer(o: { style: 'croupier' | 'porcelain' | 'puppet' | 'devil'; height?: number; suit?: Hex; skin?: Hex }): DealerPart;
  mannequin(o: { color: Hex; height?: number }): MannequinPart;
  // ── states ──
  lockOverlay(size: SlotSize): THREE.Group;     // chains + padlock + CLOSED sign (i18n)
  outOfOrder(size: SlotSize): THREE.Group;      // placeholder cabinet "OUT OF ORDER"
}

export interface CabinetOpts {
  style: 'upright' | 'slant' | 'lowboy' | 'counter' | 'tower' | 'booth' | 'wall';
  w: number; h: number; d: number;
  body: Hex; trim?: Hex; accent?: Hex;
  bevel?: number;                                        // default 0.03
  screen?: { w: number; h: number; y: number; tilt?: number /* deg */ };
  topper?: { h: number };
  panel?: { y: number; depth: number; tilt?: number };   // control deck shelf
  tray?: boolean; kick?: number /* plinth h, default 0.08 */; grime?: number /* 0..1 */;
}
export interface CabinetPart {
  root: THREE.Group; body: THREE.Mesh;
  anchors: { speaker: THREE.Object3D; screen?: THREE.Object3D; panel?: THREE.Object3D; topper?: THREE.Object3D; tray?: THREE.Object3D; coinSlot?: THREE.Object3D };
  colliders: LocalAABB[]; suggestedPose: PlayPose;
}
export interface ScreenSurface {
  mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; readonly w: number; readonly h: number;
  draw(fn: (g: CanvasRenderingContext2D, s: ScreenSurface) => void): void;   // marks dirty; upload ≤ 1×/frame
  text(str: string, x: number, y: number, o?: TextOpts): number;
  clear(color?: string): void;
  dispose(): void;
}
export interface MarqueePart { root: THREE.Group; setText(t: TextSource): void; chase(p: 'chase' | 'blink' | 'all' | 'off' | 'win', hz?: number): void }
export interface LabelPart { mesh: THREE.Mesh; setText(t: TextSource): void }
export interface NeonPart { root: THREE.Group; setOn(on: boolean): void; flicker(amount: number): void }
export interface ButtonPart { root: THREE.Group; cap: THREE.Mesh; press(dur?: number): Promise<void>; setLit(on: boolean): void; setEnabled(on: boolean): void }
export interface LeverPart { root: THREE.Group; arm: THREE.Object3D; pull(dur?: number /* 0.55 */): Promise<void> }
export interface LampPart { root: THREE.Group; setOn(on: boolean): void; setColor(c: Hex): void; blink(hz: number, dur?: number): void }
export interface BulbChain { root: THREE.InstancedMesh; pattern(p: 'chase' | 'alt' | 'blink' | 'rainbow' | 'all' | 'off', hz?: number): void; setBulb(i: number, c: Hex | null): void }
export interface ReelPart { root: THREE.Group; drum: THREE.Mesh; readonly count: number; angleOf(index: number): number; setIndex(index: number): void; startSpin(speed: number /* rev/s */): void; stopAt(index: number, dur: number, bounce?: number): Promise<void> }
export interface WheelPart { root: THREE.Group; disc: THREE.Object3D; angleOf(i: number): number; spinTo(i: number, turns: number, dur: number): Promise<void>; pegs: THREE.Object3D[] }
export interface FeltTableOpts { shape: 'rect' | 'kidney' | 'oval' | 'round' | 'craps'; w: number; d: number; h?: number /* 0.76 */; felt: Hex; rail: Hex; print?: THREE.Texture; seats: number; stools?: boolean; dealer?: boolean }
export interface FeltTablePart { root: THREE.Group; top: THREE.Mesh; seats: SeatDef[]; seatAnchors: THREE.Object3D[]; dealerAnchor: THREE.Object3D; chipTray: THREE.Object3D; colliders: LocalAABB[] }
export type ChipValue = 1 | 5 | 10 | 25 | 100 | 500 | 1000 | 5000;
export interface ChipPool { root: THREE.InstancedMesh; add(v: ChipValue, at: THREE.Vector3): number; stack(vs: ChipValue[], at: THREE.Vector3): number[]; move(id: number, to: THREE.Vector3, dur?: number, arc?: number): Promise<void>; remove(id: number): void; clear(): void; readonly count: number }
export interface CardPool { root: THREE.Group; add(card: CardId | null, at: THREE.Vector3, rotY?: number): number; setCard(id: number, c: CardId): void; flip(id: number, dur?: number): Promise<void>; move(id: number, to: THREE.Vector3, dur?: number, o?: { arc?: number; rotY?: number }): Promise<void>; remove(id: number): void; clear(): void }
export interface DicePool { dice: THREE.Mesh[]; setFace(i: number, face: number): void; roll(i: number, from: THREE.Vector3, to: THREE.Vector3, face: number, dur: number): Promise<void> }
export interface BallPool { root: THREE.InstancedMesh; set(i: number, x: number, y: number, z: number): void; hide(i: number): void; readonly max: number }
export type DealerPose = 'idle' | 'deal' | 'reach' | 'spin' | 'collect' | 'point' | 'bow' | 'arms';
export interface DealerPart { root: THREE.Group; head: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; handL: THREE.Object3D; handR: THREE.Object3D; pose(p: DealerPose, dur?: number): Promise<void>; lookAt(target: THREE.Vector3, dur?: number): void; gesture(g: 'deal' | 'collect' | 'spin' | 'point' | 'nod' | 'shake' | 'wave', target?: THREE.Vector3): Promise<void>; idle(on: boolean): void }
export interface MannequinPart { root: THREE.Group; head: THREE.Object3D; setPose(p: 'stand' | 'sit' | 'walk' | 'fall', phase?: number): void; setColor(c: Hex): void }
```
Scale conventions (readability at 384×216): cards 1.4× real (0.088 × 0.123 m), chips 1.3× (Ø 0.05,
0.004 m thick), dice 1.6× (0.03 m), table height 0.76 m, rail 0.1 m, stool seat 0.75 m.
`finalize()` merges every non-kept static mesh by material (`mergeGeometries`; it normalizes indexed/
non-indexed and missing `uv`/`color` attributes first) and sets `matrixAutoUpdate=false` on static
nodes. Anything in `model.parts` must be passed in `keep`.

---

## 5. World integration

### 5.1 Coordinates and zones

> **SUPERSEDED (§11.2).** The level, zones, slot ids, slot classes, coordinates and default assignment are GDD §8
> (62 × 52 m pit: Mouth / Well / Lobby nave + 8 wings; `src/world/layout.ts` encodes GDD §8.6 verbatim). The v1.0
> reference layout below (`A01`…`S04`, zones `atrium`…`services`) is retired; only the *resolution rules* of §5.3
> (mode override → default → null; unregistered → `kit.outOfOrder`; oversize → warn + out-of-order) still apply.

Pit footprint `x ∈ [−24, 24]`, `z ∈ [−18, 18]` (48 × 36 m), floor y = 0, hall ceiling 4.2 m, atrium
ceiling 9 m. Origin = atrium centre. North = −Z. Elevator in the south wall at (0, 0, 17.6); spawn
(0, 0, 14.5) facing −Z. `rotY` ∈ {0, 90, 180, 270}: the machine front (+Z local) then faces
0 → +Z (south), 90 → +X (east), 180 → −Z (north), 270 → −X (west).

| zone | x range | z range | content |
|---|---|---|---|
| atrium | −8..8 | −8..8 | The Big One, Debt Terminal, Charm vendor, Hotline, trapdoor (centre 0,0,1.0; 3.2×3.2 m), clock (hanging 0, 7.2, −6.0) |
| slots (West Hall) | −24..−8 | −18..18 | cabinets on west wall + centre island |
| tables (East Hall) | 8..24 | −12..8 | felt tables, wall-side wheels |
| parlour (Devil's Parlour) | 8..24 | −18..−12 | curtain wall at z = −12, doorway x 14–16 |
| arcade (North Gallery) | −8..8 | −18..−8 | physics/arcade machines, derby |
| lottery (South-East) | 8..24 | 8..18 | draw games |
| services (South Lobby) | −8..8 | 8..18 | elevator, cashier, jukebox |

### 5.2 Slot table (reference layout v0 — `src/world/layout.ts`)

The level agent may move coordinates; **ids, sizes and zones are the contract.** `World` validates
in dev: footprints + stand strips must not overlap each other or walls (warning list in console).

```ts
// SlotDef is declared in src/world/types.ts (TD-frozen):
// export interface SlotDef { id: InstanceId; size: SlotSize; pos: V3; rotY: 0 | 90 | 180 | 270; zone: ZoneId }
const s = (id: string, size: SlotSize, x: number, z: number, rotY: 0 | 90 | 180 | 270, zone: ZoneId): SlotDef => ({ id, size, pos: [x, 0, z], rotY, zone });
export const SLOTS: SlotDef[] = [
  s('A01','XL',   0,  -5.2,   0,'atrium'), s('A02','M', -4.6, 1.0, 90,'atrium'), s('A03','M', 4.6, 1.0,270,'atrium'),
  s('A04','S', -6.6, -5.0,  90,'atrium'), s('A05','S',  6.6,-5.0,270,'atrium'),
  // West Hall wall row (face east)
  s('B01','M',-23.1,-15, 90,'slots'), s('B02','M',-23.1,-12, 90,'slots'), s('B03','M',-23.1, -9, 90,'slots'),
  s('B04','M',-23.1, -6, 90,'slots'), s('B05','M',-23.1, -3, 90,'slots'), s('B06','M',-23.1,  3, 90,'slots'),
  s('B07','M',-23.1,  6, 90,'slots'), s('B08','M',-23.1,  9, 90,'slots'), s('B09','M',-23.1, 12, 90,'slots'),
  s('B10','M',-23.1, 15, 90,'slots'),
  // West Hall island (back-to-back)
  s('B11','M',-16.7,-10,270,'slots'), s('B12','M',-16.7, -6,270,'slots'), s('B13','M',-16.7,  6,270,'slots'), s('B14','M',-16.7, 10,270,'slots'),
  s('B15','M',-15.3,-10, 90,'slots'), s('B16','M',-15.3, -6, 90,'slots'), s('B17','M',-15.3,  6, 90,'slots'), s('B18','M',-15.3, 10, 90,'slots'),
  // West Hall east row (face west)
  s('B19','S', -9.7,-14.5,270,'slots'), s('B20','S', -9.7,-11.5,270,'slots'), s('B21','S', -9.7, 11.5,270,'slots'), s('B22','S', -9.7, 14.5,270,'slots'),
  // East Hall tables (dealer side north)
  s('C01','L', 11.5,-9.5,0,'tables'), s('C02','L', 18,-9.5,0,'tables'), s('C03','L', 11.5,-4.5,0,'tables'),
  s('C04','L', 18,-4.5,0,'tables'),   s('C05','L', 11.5, 0.5,0,'tables'), s('C06','L', 18, 0.5,0,'tables'),
  s('C07','XL',14.75,5.6,0,'tables'),
  s('C08','M', 23.1,-9.5,270,'tables'), s('C09','M', 23.1,-4.5,270,'tables'), s('C10','M', 23.1,0.5,270,'tables'), s('C11','M', 23.1,5.5,270,'tables'),
  // Parlour
  s('P01','L', 11.5,-15.3,0,'parlour'), s('P02','M', 16,-17.3,0,'parlour'), s('P03','M', 19.5,-17.3,0,'parlour'), s('P04','M', 23.1,-15,270,'parlour'),
  // Arcade
  s('N01','M',-6.6,-17.3,0,'arcade'), s('N02','M',-4.0,-17.3,0,'arcade'), s('N03','L', 0,-16.5,0,'arcade'),
  s('N04','M', 4.0,-17.3,0,'arcade'), s('N05','M', 6.6,-17.3,0,'arcade'),
  s('N06','M',-7.3,-11.5,90,'arcade'), s('N07','M', 7.3,-11.5,270,'arcade'), s('N08','XL', 0,-11.0,0,'arcade'),
  // Lottery
  s('L01','L', 11.5,12,0,'lottery'), s('L02','L', 18,12,0,'lottery'), s('L03','M', 10,17.3,180,'lottery'),
  s('L04','M', 13.5,17.3,180,'lottery'), s('L05','M', 17,17.3,180,'lottery'), s('L06','M', 23.1,15,270,'lottery'),
  // Services
  s('S01','M',-6,17.3,180,'services'), s('S02','M', 6,17.3,180,'services'), s('S03','S',-7.5,12,90,'services'), s('S04','S', 7.5,12,270,'services'),
];
```

### 5.3 Machine → slot assignment

```ts
export const ASSIGN: Record<'default' | GameMode, Partial<Record<InstanceId, MachineId | null>>> = {
  default: {
    A01:'big_one', A02:'debt_terminal', A03:'charm_vendor', A04:'hotline', A05:'coin_flip',
    B01:'bandit', B02:'pachislot', B03:'video_poker', B04:'bandit', B05:'pachislot', B06:'video_poker',
    B07:'bandit', B08:'pachislot', B09:'video_poker', B10:'bandit',
    B11:'mines', B12:'hilo', B13:'scratch_vend', B14:'dice_tower', B15:'bandit', B16:'pachislot', B17:'video_poker', B18:'keno',
    B19:'coin_flip', B20:'hilo', B21:'mines', B22:'coin_flip',
    C01:'roulette', C02:'blackjack', C03:'holdem', C04:'baccarat', C05:'sic_bo', C06:'dragon_tiger', C07:'craps',
    C08:'big_six', C09:'keno', C10:'hilo', C11:'mines',
    P01:'revolver', P02:'fortune_teller', P03:'shell_game', P04:null,
    N01:'pachinko', N02:'plinko', N03:'coin_pusher', N04:'cyclone', N05:'stacker', N06:'claw', N07:'crash_cable', N08:'derby',
    L01:'bingo', L02:'tombola', L03:'lotto_blower', L04:'scratch_vend', L05:'pachinko', L06:'plinko',
    S01:'cashier', S02:'jukebox', S03:'coin_flip', S04:null,
  },
  debt: {}, coop: {}, versus: {}, free: { A02: null },   // per-mode overrides merged over default
};
```
Resolution order per slot: mode override → default → `null` (decor prop from `props/decor.ts`).
Then: (1) if the machine id is not registered → `kit.outOfOrder(size)`; (2) if `def.slotSize` is
larger than the slot → warn + out-of-order; (3) registered machines that got no slot are auto-placed
into the first `null` slot of sufficient size, preferring `def.zone`; (4) `def.modes` excludes →
out-of-order. Instance id = slot id (`'B07'`), so duplicates are independent instances.

### 5.4 Collision & interaction

* Static colliders: level walls/pillars/counters as `Box3` (tag `solid`), floor panels as `walkable`
  boxes (top surface = floor; trapdoor panels toggled via `setEnabled`).
* Machine colliders: `model.colliders` transformed by the slot matrix → world AABBs (rotY multiples of
  90° keep them exact). Spatial hash with 2 m cells; `moveAndSlide` resolves X then Z then Y.
* Interaction ray: from camera position along view direction, max 2.2 m (tables 2.8 m), tested against
  every `Interactable.box` (Ray–Box3); the hit is discarded if a `solid` collider is nearer.
  Focus updates every fixed step; prompt via `ui.prompt`. Tables: E picks the free seat whose
  `seatAnchor` is nearest to the player.
* Prompt text: `t('common.play', { name: t('m.<id>.name') })` + sub `Bet {min}–{max}` /
  `Occupied: {name}` / `Locked until deadline {n}` / ghost: no prompt.

### 5.5 Lighting & visibility (World)

* `HemisphereLight` (sky/ground from art bible) + a **pool of 6 `PointLight`s** whose count never
  changes after build (light count is part of the shader key → no recompiles). Every 0.5 s the pool is
  reassigned to the 6 `anchors.light` / level light hints nearest to the camera (colour from
  `anchor.userData.color`, intensity `userData.intensity ?? 1.2`, distance 8 m, decay 1.5).
* Fog: `THREE.Fog(color, 4, far)`, far from `psx.drawDistance` (18/26/40 m).
* `machine.visible = dist(camera, slot) < def.attractRadius && frustum.intersectsSphere(bounds)`;
  computed each frame by World.

---

## 6. Networking

### 6.1 Model

* **Star topology, listen server.** The host's browser is authoritative for: player list, run state,
  economy (all wallets), charms, deadlines/clock, phone calls, votes, shared tables, occupancy.
* **Solo machines are occupant-authoritative** (zero-latency play, casual trust): the occupant runs the
  logic with the host-issued seed and emits events; the host validates the sender is the occupant,
  presents, and forwards.
* **Single-player = offline host.** `Session.mode = 'offline'`, `isHost = true`, no transport. All game
  code is written once as `if (net.isHost) apply(); else request();` and works identically in SP.
* Clients send **only to the host**. The host never loops its own broadcasts back to itself; host-side
  code applies locally then sends `'others'`.

### 6.2 Transport interface — `src/net/types.ts`

```ts
export type TransportKind = 'webrtc' | 'relay' | 'tab' | 'p2p';
export type Channel = 'rel' | 'unrel';
export interface Transport {
  readonly kind: TransportKind;
  readonly role: 'host' | 'client';
  start(): Promise<void>;                              // host: accept peers; client: connect to host (rejects on timeout)
  send(peer: string, data: string, ch: Channel): void; // client: peer = 'host'
  disconnect(peer: string, reason?: string): void;
  close(): void;
  rtt(peer: string): number | undefined;               // ms, if the transport measures it
  onPeerOpen: (peer: string) => void;
  onPeerClose: (peer: string, reason: string) => void;
  onMessage: (peer: string, data: string, ch: Channel) => void;
}
```

| backend | file | how | channels |
|---|---|---|---|
| WebRTC | `transports/webrtc.ts` | Client creates `RTCPeerConnection` + two DataChannels: `rel` `{ordered:true}`, `unrel` `{ordered:false, maxRetransmits:0}`; offer/answer/ICE via lobby `signal`. ICE: `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478`, + optional TURN from settings. Both channels open within **8 s** or fallback. | rel+unrel |
| WS relay | `transports/relay.ts` | Same lobby socket; `relay` ops forwarded by the server between client and host of the same room. Auto-fallback after WebRTC failure. Host accepts relay peers always. | rel only (unrel mapped to rel, transforms at 10 Hz) |
| BroadcastChannel | `transports/broadcast.ts` | Same-browser tabs. Discovery `jackid:lobby` (announce `RoomInfo` every 2 s, TTL 6 s); room traffic `jackid:room:<id>` as `{from,to,ch,d}`; `bye` on `pagehide`; peer timeout 5 s. | rel+unrel (both reliable in practice) |
| Trystero (optional, off by default) | `transports/trystero.ts` | `import { joinRoom } from 'trystero/nostr'`; `appId:'jackid-v1'`; global lobby room `'lobby'` with action `'ann'` (RoomInfo every 5 s); game room = room id with `password`; actions `'r'` (rel) and `'u'`. Join timeout 15 s. | rel (+unrel best-effort) |

Host hub: when hosting, `Session` starts **all enabled host transports at once** (server-backed
WebRTC+relay if the lobby is reachable and the room is public; BroadcastChannel always; Trystero if
`settings.net.useP2P`). Peers are keyed `'<kind>:<peerId>'` internally and mapped to `PlayerId`.

### 6.3 Session — `src/net/session.ts`

```ts
export interface HostOptions { name: string; mode: GameMode; max: number /* 2..8 */; password?: string; public: boolean; lateJoin: boolean }
export type JoinTarget = { via: 'server' | 'tab' | 'p2p'; roomId: string };
export interface Session {
  readonly mode: 'offline' | 'host' | 'client';
  readonly isHost: boolean; readonly online: boolean;
  readonly selfId: PlayerId; readonly hostId: PlayerId;
  readonly room: RoomInfo | null;
  readonly players: ReadonlyMap<PlayerId, PlayerInfo>;
  hostTime(): number;                                    // ms, host clock (offline: performance.now())
  rtt(pid?: PlayerId): number;
  startOffline(): void;
  host(o: HostOptions): Promise<RoomInfo>;
  join(target: JoinTarget, o: { password?: string }): Promise<void>;   // resolves after 'welcome'
  leave(reason?: string): void;
  send(msg: Msg, to?: PlayerId | 'host' | 'all' | 'others', ch?: Channel): void;   // client: always host
  on<T extends Msg['t']>(t: T, fn: (msg: Extract<Msg, { t: T }>, from: PlayerId) => void): () => void;
  kick(pid: PlayerId, reason?: string): void;
  poll(): void;                                          // loop: deliver queued inbound
  flush(dt: number): void;                               // loop: transforms 20 Hz, pings 1 Hz
}
```

### 6.4 Room lifecycle

1. **Host:** Menu → Host panel (name ≤ 24, mode, max players 2–8 (default 4), password, public,
   late-join) → `session.host()` → lobby server `create` + BroadcastChannel announce (+ Trystero) →
   state `lobby`. Host is PlayerId 1.
2. **Client:** server browser → select room → password modal if locked → `session.join()` → transport
   → `hello` → `welcome` (or `deny`) → state `lobby` (or `ingame` on late join).
3. **Start:** host presses START (≥ 1 player; non-ready clients are allowed but warned) → `start`
   `{mode, seed, cfg, at: hostTime()+3000}` → 3-2-1 countdown → all enter `ingame` with the same seed.
   Lobby server room `state:'ingame'`.
4. **End:** host sends `end {summary}` → Results → host `toLobby` → Lobby. Clients may leave anytime.
5. **Host leaves / closes tab / crashes: NO HOST MIGRATION in v1.0 (this overrides GDD §7.6 "Free Casino migrates"; host
   migration is a T3 item in PLAN.md). The room closes.** Co-op/Versus hosts keep their intermission snapshot and can
   re-host it ("RESUME ROOM", same seed/roster, new code). Clients detect `close`
   or 5 s without `pong` → modal `net.hostLeft` → Menu after confirm; their stats are kept as an
   unfinished run in history. (Rationale: the host holds all authoritative state; migration would
   double the protocol surface for a casual game.)
6. **Client drop / rejoin:** host keeps a disconnected player's record (wallet, charms, debt share)
   keyed by `profile.id` (`cid`) for **300 s** (GDD §7.2 pocket hold); rejoining with the same `cid` restores it; after
   300 s the host applies the room's disconnect policy (Deposit 50 % / Vanish).
7. **Late join:** allowed if `room.lateJoin` (default true for `free`/`coop`, false for `versus` where
   late joiners spawn as ghost spectators). Order: `welcome` → `rsnap` → `msnap` for every machine
   whose `getSnapshot() !== null` (+ occupancy) → live traffic. Session buffers live machine events
   until all snapshots are applied.

### 6.5 Message protocol — `src/net/protocol.ts`

JSON text, one message per send, discriminated by `t`. `PROTO = 1`; mismatched versions are denied
(`deny version`) and greyed out in the browser. Unreliable channel: only `pt`, `pts`. Messages over
15 000 chars on `rel` are split by `codec.ts` into `frag` parts (8 000 chars each) and reassembled.

```ts
export const PROTO = 1;
export interface PlayerInfo { id: PlayerId; cid: string; name: string; color: Hex; host: boolean; ready: boolean; state: 'lobby' | 'alive' | 'ghost' | 'away'; ping: number }
export interface RoomInfo { id: string; name: string; host: string; mode: GameMode; players: number; max: number; locked: boolean; started: boolean; lateJoin: boolean; version: number; via: 'server' | 'tab' | 'p2p'; ping?: number; salt?: string }
export interface RunConfig { startWallet: number; deadlines: number; difficulty: 'easy' | 'normal' | 'hard'; friendlyGive: boolean }
export interface PhoneCallState { id: number; script: string; target: PlayerId /* 0 = anyone */; ringingSince: number; answeredBy: PlayerId | null; step: number; options: string[] /* i18n keys */ }
export interface RunSnapshot { mode: GameMode; seed: number; phase: RunPhase; debts: Record<number, DebtState>; wallets: Record<number, number>; charms: Record<number, CharmState[]>; alive: Record<number, boolean>; jackpots: Record<string, number>; tier: number; phone: PhoneCallState | null; stats: Record<string, number> }
export interface RunSummary { mode: GameMode; seed: number; result: 'escaped' | 'fell' | 'quit' | 'abandoned' | 'won' | 'lost'; floor: number; deadlines: number; maxWallet: number; rounds: number; biggestWin: number; durationSec: number; players: Array<{ id: PlayerId; name: string; placement: number; wallet: number }> }

export type Msg =
  // ── session ──────────────────────────────────────────── (dir)
  | { t: 'hello'; v: number; cid: string; name: string; color: Hex; lang: Lang; pass?: string }          // C→H
  | { t: 'welcome'; you: PlayerId; room: RoomInfo; players: PlayerInfo[]; phase: 'lobby' | 'ingame'; hostTime: number;
      occ: Array<[mid: InstanceId, seat: number, pid: PlayerId]> }                                         // H→C
  | { t: 'deny'; reason: 'full' | 'password' | 'version' | 'started' | 'kicked' }                         // H→C
  | { t: 'pjoin'; p: PlayerInfo }                                                                          // H→*
  | { t: 'pupd'; id: PlayerId; patch: Partial<PlayerInfo> }                                                // H→*
  | { t: 'pleave'; id: PlayerId; reason: 'left' | 'timeout' | 'kicked' }                                   // H→*
  | { t: 'kick'; reason?: string }                                                                         // H→C (then disconnect)
  | { t: 'ping'; a: number }                                                                               // both, 1 Hz
  | { t: 'pong'; a: number; b: number }                                                                    // reply; b = responder clock
  | { t: 'close'; reason: 'hostLeft' | 'hostQuit' | 'error' }                                              // H→*
  // ── lobby ──
  | { t: 'ready'; r: boolean }                                                                             // C→H
  | { t: 'prof'; name?: string; color?: Hex }                                                              // C→H (name/colour change)
  | { t: 'lcfg'; mode: GameMode; max: number; lateJoin: boolean; cfg: RunConfig }                          // H→*
  | { t: 'start'; mode: GameMode; seed: number; cfg: RunConfig; at: number }                               // H→*
  | { t: 'end'; summary: RunSummary }                                                                      // H→*
  | { t: 'toLobby' }                                                                                       // H→*
  // ── movement (unreliable) ──
  | { t: 'pt'; s: number; p: V3; r: [yaw: number, pitch: number]; f: number }                              // C→H 20 Hz
  | { t: 'pts'; s: number; a: Array<[PlayerId, number, number, number, number, number, number]> }          // H→* 20 Hz [id,x,y,z,yaw,pitch,f]
  // ── chat ──
  | { t: 'chat'; from?: PlayerId; text: string }                                                           // C→H, H→* (from set by host)
  | { t: 'sys'; key: string; vars?: Record<string, string | number> }                                      // H→* system line (i18n)
  // ── machines ──
  | { t: 'mocc'; mid: InstanceId; seat: number }                                                           // C→H request
  | { t: 'moccOk'; mid: InstanceId; seat: number; pid: PlayerId; seed: number; occ: number }               // H→* grant
  | { t: 'moccNo'; mid: InstanceId; reason: 'busy' | 'locked' | 'ghost' | 'seated' | 'noseat' }            // H→C
  | { t: 'mrel'; mid: InstanceId; seat: number }                                                           // C→H
  | { t: 'mrelOk'; mid: InstanceId; seat: number; pid: PlayerId }                                          // H→*
  | { t: 'mev'; e: MachineEnvelope }                                                                       // C→H (solo occupant) / H→* (forward or table)
  | { t: 'tact'; mid: InstanceId; seat: number; rid: number; a: Json }                                     // C→H table action
  | { t: 'tnak'; mid: InstanceId; rid: number; reason: string }                                            // H→C (i18n key)
  | { t: 'msnap'; mid: InstanceId; snap: Json; seq: number }                                               // H→C late join
  // ── run / economy ──
  | { t: 'rsnap'; run: RunSnapshot }                                                                       // H→* on join, phase change, every 5 s
  | { t: 'rdelta'; d: Partial<RunSnapshot> }                                                               // H→* small changes
  | { t: 'eco'; op: 'bet' | 'win' | 'deposit' | 'give' | 'buy' | 'jpAdd' | 'jpClaim'; amt: number; rid: number;
      mid?: InstanceId; machineId?: MachineId; to?: PlayerId; item?: string; meta?: Json }                 // C→H request
  | { t: 'ecoD'; pid: PlayerId; w: number; d: number; why: string; rid?: number; tier?: WinTier; mid?: InstanceId } // H→* authoritative
  | { t: 'ecoNo'; rid: number; reason: 'funds' | 'invalid' | 'phase'; w: number }                          // H→C rejection
  | { t: 'charmD'; pid: PlayerId; charms: CharmState[] }                                                   // H→*
  | { t: 'jp'; pool: string; v: number }                                                                   // H→* jackpot pool value
  // ── phone ──
  | { t: 'phone'; call: PhoneCallState | null }                                                            // H→* (null = hang up)
  | { t: 'phoneAns'; id: number; choice: number }                                                          // C→H (choice −1 = pick up)
  // ── votes ──
  | { t: 'vote'; id: number; kind: 'kick' | 'restart' | 'skip' | 'endless'; target?: PlayerId; ends: number; yes: number; no: number; need: number } // H→*
  | { t: 'voteCast'; id: number; yes: boolean }                                                            // C→H
  | { t: 'voteEnd'; id: number; passed: boolean }                                                          // H→*
  // ── fate ──
  | { t: 'fall'; pid: PlayerId }                                                                           // H→* (pid 0 = whole team)
  | { t: 'ascend'; pid: PlayerId }                                                                         // H→*
  // ── transport utility ──
  | { t: 'frag'; id: number; i: number; n: number; d: string };
```

Field conventions: positions rounded to 0.01 m, angles to 0.001 rad. `pt.f`/`pts` flag bits:
`1 crouch · 2 sprint · 4 seated · 8 ghost · 16 typing · 32 falling`.

Economy round trip (client): `run.bet()` checks the local mirror, debits it optimistically, records a
pending op `{rid, amt}`, sends `eco`. Host validates (funds, phase, `amt ∈ [def.minBet, def.maxBet]`,
`win.amt ≤ lastBet(mid) × def.maxPayoutMult × payout.mult cap` unless `jpClaim`), applies, broadcasts
`ecoD`. Client sets `wallet = ecoD.w − Σ pending(after rid)`; on `ecoNo` it drops the op and resyncs.
Personal banners: the local Economy fires toast/banner when its own `win` resolves (solo) or when an
`ecoD` with `why:'win'` and `tier ≥ medium` arrives for `self` (tables).

Replication: remote avatars render at `hostTime − 100 ms`, linear interpolation between `pts`
samples, extrapolation ≤ 200 ms, snap if error > 2 m. Clock sync: `offset` from `ping/pong`
(`offset = b − (a + now)/2`, EMA α = 0.1). `rsnap` every 5 s (reliable) as drift guard.

Rate limits enforced by host (drop excess, warn; 3 violations/10 s → kick): `pt` 30/s, `chat`
1/s (burst 3, ≤ 140 chars, trimmed, control chars stripped), `eco` 20/s, `mev` 30/s, `tact` 10/s,
`mocc/mrel` 4/s, `voteCast` 2/s.

Votes: kick/restart/skip intro/enter endless; duration 20 s; pass when `yes > players/2`; host may
also act directly (host commands in chat: `/kick <name>`, `/restart`).

### 6.6 Anti-cheat stance (casual)

Trusted: the host (fully), occupant-side solo machine outcomes (the occupant knows its seed).
Validated by host: occupancy (one seat per player, only free seats), sender = occupant for `mev`,
bet bounds and funds, payout caps from `def.maxPayoutMult`, deposit ≤ wallet, phase gates, rate
limits, movement speed (> 8 m/s → position ignored). No encryption beyond DTLS/WSS; password is a
salted SHA-256 verifier, not real security. Goal: stop accidental desync and casual console tinkering,
not determined cheaters.

---

## 7. Lobby / signaling server — `server/index.js`

Plain Node ESM (`"type":"module"`), deps: `ws` only + `node:http`, `node:crypto`, `node:fs`.
`PORT` env (default **8787**), bind `0.0.0.0`. Single process, in-memory state.

### 7.1 HTTP

| route | response |
|---|---|
| `GET /api/health` | `{ ok: true, rooms, peers, uptime, version }` |
| `GET /api/rooms` | `RoomPublic[]` (same as ws `rooms`) |
| `OPTIONS *` | 204 |
| `GET /*` | if `dist/` exists: static files (html, js, css, woff/woff2, png, svg, ico; SPA fallback `index.html`) |

All `/api` responses: `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.
WebSocket upgrade path: **`/lobby`**. Origin check: allow all unless `ALLOWED_ORIGINS` env (comma list).

### 7.2 WebSocket ops (JSON `{op, ...}`)

```ts
interface RoomPublic { id: string; name: string; host: string; mode: GameMode; players: number; max: number; locked: boolean; salt: string; started: boolean; lateJoin: boolean; version: number; hostRtt: number; createdAt: number }
// client → server
{ op: 'hi'; v: number; name: string }                                  // first message
{ op: 'list' }
{ op: 'ping'; a: number }                                              // RTT to server
{ op: 'create'; room: { name; mode; max; lateJoin; version; salt?; verifier? } }   // verifier = sha256hex(salt + ':' + password)
{ op: 'update'; id: string; token: string; patch: Partial<Pick<RoomPublic, 'players' | 'started' | 'name' | 'mode' | 'max' | 'lateJoin'>> }
{ op: 'hb'; id: string; token: string; hostRtt: number }               // host heartbeat every 5 s
{ op: 'close'; id: string; token: string }
{ op: 'join'; id: string; proof?: string }                             // proof = sha256hex(salt + ':' + password)
{ op: 'signal'; to: string; data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } }
{ op: 'relay'; to: string; d: string }                                 // game message fallback
{ op: 'leave' }
// server → client
{ op: 'welcome'; peer: string; v: number; ice: RTCIceServer[] }        // ice from env ICE_SERVERS JSON or defaults
{ op: 'rooms'; rooms: RoomPublic[] }
{ op: 'pong'; a: number }
{ op: 'created'; id: string; token: string }                           // token: 32 hex, host secret
{ op: 'joinOk'; id: string; host: string /* host peer id */ }
{ op: 'joinNo'; id: string; reason: 'nope' | 'full' | 'password' | 'version' | 'started' }
{ op: 'peerJoin'; peer: string; name: string }                         // to host
{ op: 'peerLeave'; peer: string }                                      // to host / to client when host leaves
{ op: 'signal'; from: string; data: {...} }
{ op: 'relay'; from: string; d: string }
{ op: 'roomClosed'; id: string; reason: 'host' | 'expired' }
{ op: 'error'; code: string; msg: string }
```

Rules: room ids are 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; room expires 15 s after the last
`hb` or immediately when the host socket closes (members get `peerLeave` of the host + `roomClosed`).
`signal`/`relay` only between a room's host and its joined members. Limits: 500 rooms, 2 000 sockets,
64 KB/message, 120 messages/s/socket (excess dropped; 5 s sustained → close 1008), names sanitized
(1–24 printable chars, trimmed). Server pings sockets every 20 s (ws ping/pong), terminates dead ones.
`server/rooms.js` exports `createRoom, listRooms, getRoom, touchRoom, closeRoom, expireRooms`.

### 7.3 Client side (`src/net/lobbyClient.ts`) and Vite

Lobby URL resolution: `settings.net.lobbyUrl` → `import.meta.env.VITE_LOBBY_URL` →
`(location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/lobby'`.
HTTP base = same host with `/api`.

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: true, port: 5173,
    proxy: {
      '/lobby': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
```
Dev: terminal 1 `npm run server`, terminal 2 `npm run dev` (both preconfigured in
`.claude/launch.json` as `jackpit-lobby` :8787 and `jackpit-dev` :5173). LAN friends open
`http://<your-ip>:5173`.

Deploy:
* **One box:** `npm ci && npm run build && PORT=8787 npm run server` → serves `dist/` + `/lobby` +
  `/api` on one port; put Caddy/nginx in front for TLS (`wss://`).
* **Split:** static `dist/` on any static host built with `VITE_LOBBY_URL=wss://lobby.example.com/lobby`;
  lobby server on any Node 20+ host (Fly/Render/VPS). Optional env `ICE_SERVERS` (JSON array incl.
  TURN) is forwarded to clients in `welcome`.

### 7.4 Server browser

Columns (GDD §9.6 wins on content, ART §10.6 on look): lock icon · **ROOM** (24 chars) · HOST · MODE (`COOP` / `VERS` /
`FREE`) · PLAYERS `n/max` · PING (green < 60 ms, amber < 150, red ≥ 150) · STATE (`IN LIFT` / `B5 · W2`) · NET tag
(`[LOBBY]` / `[TAB]` / `[NOSTR]`). Ping = client→lobby RTT +
`hostRtt` (server rooms), measured per-peer after connect otherwise; `TAB` rooms show `0`.
Refresh: on open, then every **5 s** while visible; manual refresh button / `R`; filters: hide full,
hide locked, hide in-game, mode; sort by any column (default **ping ascending**, GDD §9.6). Join by code field
(6 chars, case-insensitive) and `?join=CODE` deep link (`?room=` is accepted as an alias). Version mismatch rows are greyed with a tooltip. If the lobby
server is unreachable: banner `net.lobbyOffline` and only TAB/P2P rooms are shown; single-player is
never blocked.

---

## 8. Performance budgets & resource rules

Target: **60 fps** at 1080p on a GTX 1060 / Iris Xe class laptop in Chrome/Edge/Firefox current.
Low-res rendering makes fill-rate trivial; CPU (draw calls, JS) is the budget.

| item | budget |
|---|---|
| draw calls, game view (after frustum culling) | ≤ 400 typical, ≤ 600 worst |
| draw calls per machine (after `kit.finalize`) | S/M ≤ 20, L ≤ 35, XL ≤ 50 |
| triangles per machine | S ≤ 2 500, M ≤ 5 000, L ≤ 8 000, XL ≤ 14 000 |
| triangles whole scene | ≤ 300 000 |
| level static geometry | ≤ 80 draw calls (merged per material), ≤ 60 000 tris |
| unique materials per machine | ≤ 12 (share via psxMaterial cache) |
| textures per machine | ≤ 8 unique, ≤ 64×64 typical; screens ≤ 256×192; marquees ≤ 256×64 |
| total texture memory | ≤ 32 MB |
| canvas texture uploads | ≤ 4 per frame globally; screens redraw ≤ 20 Hz |
| lights | 1 hemisphere + 6 pooled point lights, constant count; **no lights in machines**; no shadows |
| particles | ≤ 512 per emitter, ≤ 2 000 total |
| physics objects | pachinko ≤ 60 balls, plinko ≤ 20, coin pusher ≤ 150 coins (InstancedMesh, sleeping) |
| JS per fixed step | all machines' `tick` ≤ 1 ms total; idle machine ≤ 0.02 ms |
| JS per frame | `frame/attract` ≤ 2 ms total (only visible machines called) |
| shader programs | ≤ 40 (material flags are few; `renderer.compile` at state enter) |
| JS heap | ≤ 300 MB; no per-frame allocations in hot paths (reuse temp vectors from `core/math.ts`) |
| `buildModel` time | ≤ 30 ms per machine; whole world build ≤ 1.5 s |
| network | client up ≤ 4 KB/s, host up ≤ 60 KB/s at 8 players |
| audio | ≤ 32 voices |

Disposal rules:
1. Shared resources (cached `psxMaterial`, `texgen` with `key`, atlases) carry `userData.shared = true`
   and are freed only when the app exits. Nobody else disposes them.
2. Everything else a machine creates (unique materials, its own CanvasTextures, geometries, screens,
   `InstancedMesh`) is freed in `dispose()`: `MachineBase.dispose()` runs `disposeObject3D(root,
   { skipShared: true })` and every `track()`ed object. Override only to add, always call `super`.
3. `World.dispose()` on leaving `ingame` disposes all machines, level, fx and removes all event and
   input subscriptions created by the in-game state. After returning to the menu,
   `renderer.info.memory.geometries/textures` must return to within +5 % of the pre-run baseline
   (bench "Rebuild ×10" button checks this).
4. Every `events.on`, `input.on`, `timers.every` returns an unsubscribe; keep and call it in
   `dispose()` / `exit()`.

---

## 9. Coding conventions

### 9.1 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"],
    "strict": false, "noImplicitAny": true, "noImplicitThis": true, "strictBindCallApply": true,
    "noFallthroughCasesInSwitch": true, "useDefineForClassFields": true, "isolatedModules": true,
    "resolveJsonModule": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "noEmit": true, "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```
`strictNullChecks` is off (speed), but **`noImplicitAny` is on**: annotate every exported function,
parameter and class member. Public APIs never expose `any`; use `unknown` or `Json` and narrow.
With `useDefineForClassFields`, subclass field initializers run *after* the base constructor —
therefore `MachineBase`'s constructor never calls overridable methods; setup goes in `init()`.

### 9.2 Naming & style

* Files: `camelCase.ts`; a file whose main export is a class: `PascalCase.ts` (`MachineBase.ts`).
  Machine folders and ids: `snake_case` (`video_poker`). Slot ids: `A01`.
* Types/classes `PascalCase`, functions/vars `camelCase`, constants `UPPER_SNAKE`, events `domain:verb`.
* Named exports everywhere **except** machine `index.ts` (`export default class`, required by registry).
* Imports via `@/…` alias across folders, relative `./` inside a folder. `import type` for types.
* Three addons allowed from `three/addons/...` (e.g. `three/addons/utils/BufferGeometryUtils.js`).
* No DOM access outside `core/ui`, `core/input`, `menu/`, `net/` (and `texgen` canvases).
* No `window` listeners outside `core/input`, `core/loop`, `core/renderer` (resize), `net/`.
* `console.*` only via `core/log.ts` (`log.debug` stripped from production by `import.meta.env.DEV`).
* **No new npm dependencies** without written TD approval. `package.json`, `tsconfig.json`,
  `vite.config.ts`, `index.html` are TD-owned.
* **Original IP only.** No CloverPit names, strings, symbols (e.g. clover, chest), characters or art.

### 9.3 i18n rules

* Every player-visible string goes through `t()` — HUD, menus, machine screens, marquees, toasts,
  phone dialogue, keys names. Numbers via `fmtCoins`/`fmtTime`. Upper-case via `upper()`.
* Key namespaces: `common.*`, `ui.*` (in `src/i18n/en.ts|tr.ts`, owned by I18N WP); `menu.*`, `hud.*`
  (menu folder `*.strings.ts`); `world.*`; `game.*`, `charm.<id>.*`, `phone.<id>.*`; `net.*`
  (`net/net.strings.ts`); `m.<machineId>.*` (machine `def.strings`, auto-prefixed).
* Adding keys **never edits a shared file**: each folder owns `<name>.strings.ts`:
  ```ts
  // src/menu/menu.strings.ts
  export default { prefix: 'menu.', en: { play: 'Play', host: 'Host Game' }, tr: { play: 'Oyna', host: 'Oyun Kur' } };
  ```
  `main.ts` loads them with `import.meta.glob<{ default: { prefix: string; en: StringTable; tr: StringTable } }>('./**/*.strings.ts', { eager: true })`.
  Charms and phone calls embed strings in their defs (registered with `charm.<id>.` / `phone.<id>.`).
* Both `en` and `tr` must have identical key sets; `npm run check` fails otherwise. Turkish must be
  real Turkish with correct diacritics (ç ğ ı İ ö ş ü), never ASCII-folded.
* Common keys TD seeds in Phase 0 (I18N WP extends): `common.bet`, `common.leave`, `common.play`
  ("Play {name}"), `common.streak`, `common.win`, `common.lose`, `common.noFunds`, `common.occupied`,
  `common.locked`, `common.coinSuffix`, `common.yes/no/ok/cancel/back`.

---

## 10. Work packages, ownership, verification

### 10.1 Phases

* **Phase 0 (serial, TD only, must land before anyone starts):** scaffolding, every `types.ts` listed
  as TD-frozen, complete small utilities (loop, app, states, events, rng, tween, timers, math, log,
  dispose, settings, save, i18n runtime), `MachineBase`/`TableBase`/registry/`_base` helpers,
  **working stubs** of every service (renderer without post, Lambert `psxMaterial`, silent audio,
  minimal DOM UI, kit with `group/box/cyl/sphere/plane/lathe/torus` + placeholder assemblies,
  offline Session, bench world + `benchRun`), the `coinflip` reference machine, `scripts/check.mjs`,
  `npm run check` script. Exit criterion: `npm run typecheck && npm run build` green and
  `/?bench=coinflip` playable.
* **Phase 1 (parallel):** all WPs below, each replacing stub bodies behind frozen interfaces.
* **Phase 2 (integration, TD + QA):** wire InGame state, layout tuning, budgets, MP soak test
  (4 tabs via BroadcastChannel + 2 machines via WebRTC), bug triage.

### 10.2 File ownership — core & systems (SUPERSEDED by `docs/PLAN.md` §5; kept for history)

An agent edits **only** files it owns. Need an API change elsewhere? Do not edit; work around locally
and list the request in your final report. Files marked (TD) are frozen interfaces.

| WP | model | owns |
|---|---|---|
| TD-0 Tech Director | Opus | `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `src/main.ts`, `src/vite-env.d.ts`, all `**/types.ts` (TD), `src/core/{app,loop,states,events,rng,tween,timers,math,log,dispose,settings,save,i18n}.ts`, `src/machines/_base/{MachineBase,TableBase,registry,cards,reels,tiers}.ts`, `src/net/protocol.ts`, `src/game/inGameState.ts`, `src/game/benchRun.ts`, `src/world/bench.ts`, `src/machines/coin_flip/**` (Phase 0) |
| CORE-RENDER | Sonnet | `src/core/renderer/{psxRenderer,psxMaterial,postShader}.ts`, `src/core/fx.ts`, `src/core/debug.ts` |
| CORE-TEXGEN | Sonnet | `src/core/texgen/{texgen,patterns,font,symbols,cards}.ts` |
| CORE-AUDIO | Sonnet | `src/core/audio/{audio,synth,sfx,music}.ts` |
| CORE-INPUT | Sonnet | `src/core/input.ts`, `src/core/keymap.ts` |
| CORE-UI | Sonnet | `src/core/ui/{ui,widgets}.ts`, `src/core/ui/ui.css` |
| KIT | Opus | `src/kit/*` except `types.ts` |
| WORLD-ARCH | Opus | `src/world/{level,lights,layout}.ts`, `src/world/props/**` |
| WORLD-SYS | Sonnet | `src/world/{world,collision,interact}.ts`, `src/world/world.strings.ts` |
| PLAYER | Sonnet | `src/player/**` |
| GAME-RUN | Sonnet | `src/game/{run,economy,clock}.ts`, `src/game/modes/**`, `src/game/game.strings.ts` |
| GAME-CHARMS | Sonnet | `src/game/charms/**` |
| GAME-HOTLINE | Sonnet | `src/game/hotline.ts`, `src/game/calls/**` |
| NET-TRANSPORT | Sonnet | `src/net/transports/**` |
| NET-SESSION | Sonnet | `src/net/{session,codec,clocksync,replication}.ts`, `src/net/net.strings.ts` |
| NET-LOBBY | Sonnet | `server/**`, `src/net/lobbyClient.ts` |
| MENU-3D | Opus | `src/menu/{menuState,menuScene,menuReels,transitions,credits}.ts` |
| MENU-UI | Sonnet | `src/menu/{serverBrowser,lobbyState,hostPanel,settingsPanel,pause}.ts`, `src/menu/menu.strings.ts` |
| HUD | Sonnet | `src/menu/{hud,scoreboard,chat,resultsState}.ts`, `src/menu/hud.strings.ts` |
| I18N | Haiku | `src/i18n/en.ts`, `src/i18n/tr.ts`; reviews (read-only) all Turkish tables and reports fixes |
| QA | Haiku | `scripts/check.mjs` (after Phase 0), test checklists; read-only elsewhere |

### 10.3 File ownership — machines (SUPERSEDED by `docs/PLAN.md` §4–§5; ids/slots below are v1.0 provisional)

Modeler owns `src/machines/<id>/model.ts` (incl. the exported `Parts` type). Coder owns
`src/machines/<id>/index.ts` and any other file in that folder. **Modeler and coder agree via the
`Parts` type**: the modeler writes it first (or the catalogue lists the parts); if the model lags,
the coder may write a temporary local stub `buildModel` inside `index.ts` (never in `model.ts`).

| id | size | kind | default slot(s) | modeler | coder |
|---|---|---|---|---|---|
| big_one (hero 5×3 pattern slot; must expose `anchors.insideGlass` for the menu burst) | XL | solo | A01 | MOD-1 | MC-01 |
| bandit (3-reel, physical lever) | M | solo | B01 B04 B07 B10 B15 | MOD-1 | MC-02 |
| pachislot (skill stop) | M | solo | B02 B05 B08 B16 | MOD-1 | MC-02 |
| video_poker (Jacks or Better) | M | solo | B03 B06 B09 B17 | MOD-1 | MC-03 |
| hilo | S | solo | B12 B20 C10 | MOD-7 | MC-03 |
| roulette (European) | L | table | C01 | MOD-2 | MC-04 |
| big_six (money wheel) | M | table | C08 | MOD-2 | MC-04 |
| blackjack | L | table | C02 | MOD-3 | MC-05 |
| baccarat | L | table | C04 | MOD-3 | MC-05 |
| dragon_tiger (casino war variant) | L | table | C06 | MOD-3 | MC-05 |
| holdem (players + bots) | L | table | C03 | MOD-3 | MC-06 |
| craps | XL | table | C07 | MOD-2 | MC-07 |
| sic_bo (chuck-a-luck cage) | L | table | C05 | MOD-2 | MC-07 |
| pachinko | M | solo | N01 L05 | MOD-4 | MC-08 (+ `_base/peg2d.ts`) |
| plinko | M | solo | N02 L06 | MOD-4 | MC-08 |
| coin_pusher (persistent state) | L | solo | N03 | MOD-4 | MC-09 |
| claw | M | solo | N06 | MOD-4 | MC-09 |
| cyclone (light ring) | M | solo | N04 | MOD-5 | MC-10 |
| stacker | M | solo | N05 | MOD-5 | MC-10 |
| crash_cable ("The Elevator" crash game) | M | solo | N07 | MOD-5 | MC-10 |
| derby (mechanical race) | XL | table | N08 | MOD-5 | MC-11 |
| tombola (raffle drum) | L | table | L02 | MOD-6 | MC-11 |
| keno | M | solo | B18 C09 | MOD-6 | MC-12 |
| bingo | L | table | L01 | MOD-6 | MC-12 |
| lotto_blower | M | solo | L03 | MOD-6 | MC-12 |
| scratch_vend | M | solo | B13 L04 | MOD-6 | MC-13 |
| mines | S | solo | B11 B21 C11 | MOD-7 | MC-13 |
| shell_game (automaton) | M | solo | P03 | MOD-7 | MC-13 |
| coin_flip (reference) | S | solo | A05 B19 B22 S03 | TD → MOD-7 polish | TD → MC-13 polish |
| dice_tower | M | solo | B14 | MOD-7 | MC-14 |
| revolver (the Devil's table) | L | table | P01 | MOD-8 | MC-14 |
| fortune_teller (automaton) | M | solo | P02 | MOD-8 | MC-14 |
| debt_terminal (system) | M | system | A02 | MOD-8 | MC-15 |
| charm_vendor (system) | M | system | A03 | MOD-8 | MC-15 |
| cashier (system) | M | system | S01 | MOD-8 | MC-15 |
| hotline (system phone) | S | system | A04 | MOD-8 | MC-16 |
| jukebox (system) | M | system | S02 | MOD-8 | MC-16 |

System machines use the same contract with `category:'system'`, `minBet = maxBet = 0`,
`maxPayoutMult = 0`; they talk to the game only through `RunApi` (`deposit`, `buyCharm`, `phone`,
`answerPhone`, `debt`, `timeLeft`) and `ctx.events`; the jukebox uses `ctx.audio.music`. If a system
machine needs a RunApi method not listed, request it from TD (added to `game/types.ts`, implemented
by GAME-RUN). Clock, trapdoor and elevator are world props (WORLD-ARCH), not machines.

Agent count: TD 1 + core 5 + KIT 1 + world 2 + player 1 + game 3 + net 3 + menu 3 + Haiku 2 +
modelers 8 + coders 16 = **45**.

### 10.4 Commands

| command | purpose | must |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | 0 errors before you report done |
| `npm run build` | typecheck + `vite build` | succeeds, no new warnings from your files |
| `npm run check` | `node scripts/check.mjs`: en/tr key parity, `t()`-less literal scan in UI files, forbidden imports (machines → other machines/world/net/menu), `Math.random` in machines, budget report from bench dump | 0 errors |
| `npm run dev` | Vite on :5173 | — |
| `npm run server` | lobby on :8787 | — |
| `/?bench=<id>` | single machine in a 12×12 m test room, wallet 10 000, F3 stats (calls/tris/textures/programs/ms), debug panel: Rebuild ×10, force outcome (`debugForce`), seed, luck/charm modifier sliders, PSX toggle | — |
| `/?bench=<id>&net=tab` (2 tabs) | first tab hosts room `BENCH` over BroadcastChannel, second auto-joins: verify spectator view + late join snapshot | — |
| `/?seed=123&skipmenu=1` | straight into a Debt Run | — |

### 10.5 Definition of done

**Every WP:** only owned files touched · `typecheck`, `build`, `check` green · no console errors or
warnings during 60 s of use · every visible string via i18n with en+tr · no new deps · final report
lists files, public API notes, open requests to other WPs.

**Core service WP:** implements its frozen interface completely (no `TODO` throws on documented
methods) · works in bench and menu · settings toggles apply live · documented in a header comment.

**Machine model (Opus):** `buildModel(kit)` returns full `MachineModel` with the agreed `Parts`
type · fits `SLOT_DIMS` bounds and keeps the stand strip clear · budgets met (bench F3) · `speaker`
anchor present, `light` anchor if it glows · `kit.finalize` used · all diegetic text via
`TextSource {key}` · reads well at 384×216 from the play pose and from 6 m · looks like it belongs
to the art bible palette · original design.

**Machine logic (Sonnet):** `def` complete and matches the catalogue (bets, odds, payouts, RTP within
±1 % over a 100 000-round headless sim in bench "Sim" button) · logic/present split respected (state
only mutated in `present`) · `getSnapshot/applySnapshot` round-trip · 2-tab test: spectator sees the
same outcome/animation, late joiner sees correct state · attract mode · sounds on every interaction
and win tier · charms: honours `luck` + its documented `m.<id>.*` hooks · stand-up works at any time
(deferred while busy) · Rebuild ×10 leaves no leaked geometries/textures · tables: timeouts,
leaving mid-round, bots (if any) handled on host.

**Net WPs:** SP fully works with zero network · 2 tabs (BroadcastChannel) and 2 machines on LAN
(WebRTC) and forced relay (`?net=relay`) all pass: join, chat, move, play a solo machine, play a
table, late join, kick, host leave → clients return to menu cleanly · server survives 1 000 random
garbage messages without crashing.

**Menu/HUD WPs:** fully keyboard + mouse operable, PSX look, both languages fit without overflow
(Turkish strings are ~25 % longer), server browser handles 0/1/200 rooms and lobby-offline.

---

## 11. Integration amendments v1.1 (Producer / Lead Integrator — BINDING)

Written after reading BRIEF (Addenda 1–8), GDD v1.0, ART_BIBLE v1.0, both machine catalogues and the Phase-0 type files
already in `src/`. Where §1–§10 above conflict with this section, **this section wins**. Content numbers stay owned by the
design docs (GDD > catalogues > ART for visuals); this section only fixes the *code shape* every package must share.
Build order and file ownership live in `docs/PLAN.md`.

### 11.1 Names and ids
- Game name **JackID** everywhere (boot text, window title, storage keys `jackid:*`, BroadcastChannel `jackid:lobby` /
  `jackid:room:<id>`, Trystero `appId 'jackid-v1'`, dev console `window.jackid`). The folder `jackpit/` is only a path.
- **Machine ids = catalogue ids** (folder name = `def.id`): `bigone bandit videopoker elevator scratch pachislot pachinko
  plinko coinpusher cyclone mines dicetower lootbox claw stacker fruitmachine bingopin roulette blackjack holdem devilstable
  baccarat craps sicbo bigsix cardwar hilo keno derby fortuneteller coinflip threecard reddog bingo lottoblower tombola
  shellgame fantan teetotum` (39).
- **System device ids** (same machine contract, `category:'system'`): `debt_terminal hotline charm_vendor` (the Pawn
  Window) `concession_desk cashier jukebox tape_deck tonic_vendor` (The Apothecary) `bounty_board shrine` (Moth Shrine).
- Legacy ids (TECH v1.0 §5/§10, ART §5) map 1:1: `big_one→bigone`, `video_poker→videopoker`, `coin_flip→coinflip`,
  `crash_cable / crash_elevator→elevator`, `scratch_vend→scratch`, `peg_drop→plinko`, `coin_pusher→coinpusher`,
  `light_ring→cyclone`, `tower_stack→stacker`, `claw_crane→claw`, `dice_tower→dicetower`, `lotto_blower→lottoblower`,
  `sic_bo→sicbo`, `big_six / money_wheel→bigsix`, `dragon_tiger→cardwar` (variant `dragontiger`), `hi_lo→hilo`,
  `rat_derby→derby`, `revolver / devils_table→devilstable`, `fortune_teller→fortuneteller`, `shell_game→shellgame`.
- **Instance id = GDD slot id** (`WELL-01`, `GAL-07` …). Catalogue `bigone#0` style ids are retired.

### 11.2 World contract
- Level, zones, slot ids, slot classes and coordinates: **GDD §8** (v1.1 slot fixes: WELL-08 → M (hilo), WELL-11 → M
  (mines), BOI-03 → L (dicetower), WH-01 → L (bigsix), WH-02 → L (tombola), LAU-08 → L (bingopin)). `SLOT_DIMS` = GDD §8.5
  (§3.1, amended). `ZoneId` = GDD zone ids (§3.1, amended).
- Every machine model fits the final footprint listed in `docs/PLAN.md` §4.2 (always ≤ its slot class).
- Wing gating is **per instance**: World locks every instance whose zone grille is down (`m.setLocked(true)`); opening a
  wing (Wing Key, purchase, favour, charm, meta) calls `setLocked(false)` and plays C06. `run.isLocked(machineId)` remains
  only for type gating (order-only types, Free Casino options) and is `false` for all 39 types in a normal run.

### 11.3 Modifier hook names (design-doc names → `ModHook` in `src/game/modifiers.types.ts`)

| Design-doc hook (catalogues / GDD §4.1) | `ModHook` + op | Notes |
|---|---|---|
| `payoutMult` marked (A) / additive | `payout.mult` op `inc` | dampener: GAME-RUN halves `inc` when G ≤ 2B (GDD §3.3) |
| `payoutMult` marked (M) / multiplicative | `payout.mult` op `mult` | machines never apply it themselves |
| `luckBonus` | `luck` op `add` | clamp −30…30 |
| `betRefundOnLoss` | `loss.refund` op `add` | |
| `nearMissRefund` | `x.nearMissRefund` | applied by GAME-RUN on tag `nearmiss` |
| `actionCostDelta` / `freePlayChance` | `x.actionCostDelta` / `x.freePlayChance` | applied by GAME-RUN inside `run.bet()` |
| `jackpotChance` | `x.jackpotChance` (base 1, op `mult`) | machines query `this.mod('x.jackpotChance', 1)` |
| device hook `<id>.<hook>` / `<id>.<hook>[KEY]` | `m.<id>.<hook>` / `m.<id>.<hook>.<KEY>` | e.g. `m.bigone.symbolWeight.GHOST` |
| `table.limitMult` | `bet.maxMult` (instance scope) | the Cap track uses the same hook |
| `table.freeChip / rakeDelta / peekCharges / timerMult / pushToWin / shoeInfo` | `x.table.<name>` | honoured by TableBase helpers |
| `wheel.nudge` (GDD golden_ratchet) | `x.wheel.nudge` | roulette, bigsix, cyclone (MACHINES_tables §1.6a) |
| `run.pullsAdd` / `run.clockAdd` | `x.pulls.add` / `time.bonus` | |
| `econ.interestAdd` / `econ.depositBonus` / `econ.quotaAdd` | `interest.add` / `deposit.bonus` / `quota.add` or `quota.mult` | |
| `tilt.grace`, `tilt.*`, `lamp.*`, `card.*`, `shop.*`, `phone.*`, `bet.maxStep` | `x.tilt.grace`, `x.lamp.hotMult` … (prefix `x.`) | `shop.discount` stays a core hook |
| `heat.gainMult` | `heat.gain` | |
| `tycoon.costMult` / `tycoon.staffMult` | `upgrade.costMult` / `income.mult` | `tycoon.orderMult / assessRate / shillStake` → `x.tycoon.*` |
| `dread.add` | `dread.add` | GDD Dread is 0–100; `run.dread()` returns 0..1 |
| events `onCommit`, `onOutcome`, `onTag:<tag>` | `GameEvents['machine:round']`, `['machine:result']` (`tags`) | charms subscribe via `CharmDef.on` |
| `bell.on`, `econ.onDeposit/onSettle/onCollect/onAscend`, `world.onWingOpen`, `onDreadEvent` | GAME-RUN declares `run:bell`, `run:deposit`, `run:settle`, `run:collect`, `run:ascend`, `world:wing`, `horror:event` (declaration merging) | |

### 11.4 Machine networking (catalogue `mc.*` vocabulary → protocol §6.5)
- "Host" in the catalogues means **the authority**: the local occupant for solo devices (`shared:false`), the host for
  `TableBase` devices. "Pre-roll at commit" = the authority rolls inside its logic before `emit()`.
- Mapping: `mc.occupy` → `mocc`/`moccOk`/`moccNo` · `mc.sit`/`mc.unsit` → `mocc`/`mrel` with a seat index · `mc.release`
  → `mrel`/`mrelOk` · `mc.req` → solo: a direct method call on the occupant; tables: `TableBase.act()` → `tact` ·
  `mc.reject` → `tnak` (tables) / local toast (solo) · `mc.bet`, `mc.phase`, `mc.lock`, `mc.ready`, `mc.fair`,
  `mc.fairReveal` → `MachineEvent`s emitted through `emit()` (`k:'bet'|'phase'|'lock'|'ready'|'fair'|'fairReveal'`,
  `bet` throttled ≤ 8 Hz) · `<id>.<event>` → `MachineEvent { k: '<event>' }` (no id prefix; the envelope carries `mid`) ·
  `mc.outcome` → `settle()` → `GameEvents['machine:result']` + `ecoD` · `mc.snap` → `msnap` (`getSnapshot()`).
- **Private (unicast) events** — hole cards, peeks, Loupe / Burner-Phone results: add `MachineNet.sendPrivate(to: PlayerId,
  env: MachineEnvelope)` and protocol message `{ t:'mevp'; e: MachineEnvelope }` (H→C, one recipient). `present()` of a
  private event runs only on the recipient and the host.
- Watchers > 12 m: World stops `frame()`/`attract()`; events are still delivered and presented with `pc.fast = true`.
- Commit–reveal (`fair`) is mandatory on elevator, dicetower, mines and every `TableBase` device (`_base/fair.ts`).
- **Round RNG**: `this.rng` is re-created at every `beginRound()` from `hashSeed(runSeed, instanceId, round)`; `round` is a
  per-instance counter persisted in the snapshot, so reloads, re-sits and quit-outs never reroll (GDD §3.11 #9). Tables
  advance `hostRng` per round the same way. `moccOk.seed` stays for compatibility (= the next round seed). Accepted risk
  (§6.6): a modded occupant client can read its own solo-device outcomes in advance.

### 11.5 Base-class, MachineDef and RunApi additions (core implements in M0)
- `MachineDef` adds `actionCost: number` (pulls per play, catalogue value), `suit: 'REELS'|'CARDS'|'DICE'|'WHEELS'|'DROPS'|
  'CURIOS'|null` (GDD §3.4.1), `staffable: boolean`, `tags?: string[]`, and redefines `tier` as the **catalogue scope tier
  1|2|3** (informational; unlocking is per zone, §11.2). `slotSize` equals the PLAN.md §4.2 class.
- `buildModel(kit: Kit, o: ModelOpts): MachineModel<P>` with `ModelOpts = { seed: number; variant: 0|1|2|3; lod?: 0|1 }`;
  `MachineBase` exposes `protected get modelOpts()` = `{ seed: hashSeed(instanceId), variant: hashSeed(instanceId) % 4 }`.
- `MachineModel.anchors`: `speaker` (required); standard on every machine (PLAN.md §5.5): `prompt`, `label` (MP "IN USE"
  tag), `marqueeTop` (WORLD-SYS mounts the Circuit badge: suit glyph, 4 Tilt bulbs + TILT tube, Hot/Cold beacon, Heat chase),
  `servicePlate` (brass Level plate, owner nameplate, staff badge, Shill P&L), `upgradeMounts` (tycoon visual parts); optional
  `light`, `light2`
  (`userData = { color, intensity, range, flicker }`, ART flicker ids), `coinOut`, `stand` (stand-up point), `insideGlass`
  (bigone only, menu burst), `fxTwist` (horror-twist hook point), `seatLantern0..3` (devilstable).
- `MachineBase.addStake(amount): boolean` — extra stakes inside one round (double, split, insurance, raise, war, defy,
  extra balls); summed into the outcome's `bet` (catalogue §1.4 "one outcome per round").
- `MachineBase.settle({ gross, tier?, tags?, meta?, items? })` — builds the catalogue `MachineOutcome` and emits
  `machine:result` (payload gains `tags`, `meta`, `actionCost`, `round`).
- Pull budget: `run.bet(amount, src, o?: { pulls?: number })`. `beginRound()` passes `def.actionCost`; `addStake()` passes
  0; block-cost devices pass their own counts (pachislot 1 per 3 games, pachinko 1 per 50 normal balls, coinpusher 1 per
  10 coins, keno / lottoblower 1 per draw, scratch 1 per card, bingopin 2 per game, tables 1 per round with chips down).
  GAME-RUN applies `x.actionCostDelta` / `x.freePlayChance` and the Closing-phase gate, and on failure returns `false`
  with `run.lastRefusal(): 'funds'|'pulls'|'phase'|'limit'`.
- `run.betLimits(machineId, instanceId): { min: number; max: number; ladder: number[] }` (catalogue range × SI × Cap,
  `x.bet.maxStep`, GDD §3.2). `stepBet()` / `maxBet()` use it.
- `run.payoutFactor(machineId, instanceId): number` (GDD §3.3 `econ.payoutFactor`, read-only; used by elevator).
- `WinMeta` adds `raw?: boolean` (no modifiers, no juice: buy-ins, cash-outs, refunds) and `factorApplied?: boolean`.
- `WinTier` adds `'mega'`; `tierFor` per the amended comment in §2.13; tags `bigwin/hugewin/megawin/jackpot` ↔ tiers.
- Each machine `index.ts` also exports `playHeadless: HeadlessPlay` (named export; Shills, GDD §3.7.5; `tools/sim`).
- Tycoon milestone features are read with `ctx.run.tycoon.hasFeature(instanceId, '<id>.<feature>')`.

### 11.6 Final keymap (GDD §10.6 + catalogue §1.3 + Phase-0 additions, reconciled)

| Walk mode | Key | | Seated (machine) mode | Key |
|---|---|---|---|---|
| move | W A S D / arrows | | primary (spin, deal, drop, ready) | Space, LMB* |
| sprint / crouch (toggle) | Shift / C | | press diegetic control / place chip | LMB (hand cursor) |
| jump-step · hold to skip cinematics | Space | | secondary (remove top chip) | RMB tap < 0.2 s |
| interact / sit / stand / phone / deposit | E | | free-look | RMB hold |
| Upgrade Ledger | U | | bet / chip denomination ± | X / Z, wheel, = / − |
| punch card (hold) | Q | | bet max / spot max | **B** |
| JackID card (hold) | J | | confirm | Enter |
| use held item (tonic, Totem) | F | | repeat last bet (+ Ready on tables) | R |
| place / pick up Totem (T2) | B | | collect / cash out | **Q** (`collect`) |
| give coins (co-op): tap 10 %, hold 25 % | G | | autoplay menu | G (`auto`) |
| ping marker | middle mouse / Z | | fast mode (solo devices only) | F (`fast`) |
| emote: tap wave · hold radial | V | | camera cycle (tables) / denomination (solo) | V |
| cheer / shrug / dance | 7 / 8 / 9 | | double pending bets (tables) | D |
| phone choices / votes / ghost bless-curse | 1 / 2 / 3 | | clear pending bets | Backspace |
| push-to-talk (T2 proximity voice) | Y (hold) | | machine buttons | 1–9 (+ device letters) |
| scoreboard / run summary (hold) | Tab | | help / paytable card | H |
| chat | T / Enter | | run summary incl. full punch card (hold) | Tab |
| pause (The Ledger) | Esc | | stand up (double-tap = leave now) · pause | E · Esc |
| controls card · debug · colliders | F1 · F3 · F4 | | | |

\* `mouse:'pick'` poses send mouse buttons to `onPointer`. `MachineInputEvent` gains `code: string` (raw
`KeyboardEvent.code`) and `mods: { shift: boolean; ctrl: boolean; alt: boolean }`; `MachineAction` gains `fast`, `auto`,
`camera`, `collect`, `clear`, `double`. Device letters documented in the catalogues (J/K/L stops, K thump, P random tile,
`[` `]` mine count, Shift+wheel fine target …) arrive through `code`. Per-device conflicts are fixed in the catalogues
v1.1 (videopoker game switch = G; fruitmachine HI/LO = W/S; stacker TAKE = Q/Space; devilstable YIELD = hold 2).

### 11.7 Rendering and visual code shape (ART owns the look)
- Internal resolution default **400×225** (`targetHeight` 225; presets 180/225/270/360, ART §1.2); scale mode FILL
  (default, may be fractional) or INTEGER, so `PsxRenderer.scale` may be non-integer.
- `psxMaterial(o)` API unchanged; the implementation must deliver ART §1.3–§1.9 (clip-space snap, affine UVs, vertex-lit
  look with 5-bit light steps and ×1.75 overbright clamp, 16-band vertex fog, PS1 blend modes OPAQUE/CUTOUT/SCREENDOOR/
  HALF/ADD/SUB, matcap env for chrome/brass/glass). MeshLambert/MeshBasic + `onBeforeCompile` injection is acceptable.
- Lights: 1 hemisphere + **6 pooled PointLights** (constant count, §5.5); ART's "16 active / 4 per mesh" is replaced by
  this pool. ART flicker profiles (STEADY, BUZZ, DYING, CANDLE, SICK, STROBE, CHASE, RING) drive pooled and emissive
  intensities at 30 Hz. Machines contain no `THREE.Light`; they declare ≤ 2 light anchors (§11.5).
- Camera near/far **0.05 / 48 m**; viewmodel camera FOV **50**, near 0.01. Fog per zone = GDD §8.7 colours and near/far,
  blended over 3 m between zones (ART §1.6), × the Settings fog slider 0.6–1.4.
- Budgets: per-machine tris/draw calls = `docs/PLAN.md` §4.2 (from ART §1.11/§5.0); frame ≤ 70 k tris, ≤ 300 draw calls,
  ≤ 24 MB textures; JS budgets of §8 unchanged.
- ART §1.15 code map is superseded by the paths in §1.2 (`src/core/renderer/*`, `src/core/texgen/*`, `src/kit/*`).
- HUD, prompts, toasts, banners and subtitles are drawn by `core/ui` into a 2D canvas at internal res × uiScale and
  composited without dither (ART §10.2); DOM is used only for text inputs (chat, names, seed, password) and the complex
  out-of-game panels. `UIOverlay` signatures are unchanged.

### 11.8 Model parts naming (modeler ↔ coder contract)
`model.ts` exports `type <Id>Parts` (e.g. `BigoneParts`). Keys are camelCase forms of ART §4.4: `reels: ReelPart[]`,
`lever: LeverPart`, `buttons: Record<string, ButtonPart>` (`spin betUp betDn betMax cashout deal draw hold0..4 stop0..2
higher lower take drop collect …`), `screen` / `screens.<id>`: `ScreenSurface`, `leds: { credit, bet, win, … }`
(7-segment `ScreenSurface`s), `bulbs: BulbChain`, `lamps: Record<string, LampPart>`, `marquee: MarqueePart`, `wheel` /
`rotor`, `ball` / `balls: BallPool`, `cards: CardPool`, `chips: ChipPool`, `dice: DicePool`, `dealer: DealerPart |
MannequinActor`, `tray`, plus the machine-specific names listed in the machine's brief in `docs/PLAN.md` (that list is
the contract). Every part's origin is its pivot; `object.name` = key. Static geometry is merged with `kit.finalize`.

### 11.9 i18n keys
Machine strings live in `def.strings` → `m.<id>.*` (catalogue `machine.<id>.*` keys map 1:1, e.g. `m.roulette.spot.split`,
`m.fortuneteller.omen.7.name`, `m.holdem.bot.wick`, `m.derby.rat.3`). Shared machine words are `common.*` (`credit bet win
insertCoin closed tilt bigWin hugeWin megaWin jackpot fair notFair collect stand pulls`). Currency suffix
`common.coinSuffix` = **`¢`** (EN) / **`j`** (TR); Tickets `▣`; Obols `◉`. Design-content families follow GDD Appendix B.

### 11.10 Player constants (GDD §8.1 wins over §2.14)
Walk 3.0 · sprint 5.2 · crouch 1.5 m/s; AABB half-extents 0.30 × 0.90 × 0.30 (crouch 0.30 × 0.60 × 0.30); eye 1.62 /
1.05 m; step-up 0.35 m; interaction ray 2.2 m (tables 2.8 m); glide in 0.60 s `inOutCubic`, out 0.45 s `outCubic`;
head-bob default 70 % (ART §1.14).

### 11.11 Save
`SaveStore` (localStorage, try/catch, in-memory fallback): `jackid:v1` (profile, settings, stats, meta, Obols, unlocks,
collectibles), `jackid:run:v1` (SP resume snapshot ≈ 40 KB, written after every resolved play / deposit / purchase /
intermission), `jackid:recent:v1` (last 20 rooms). GDD mentions of IndexedDB are satisfied by this store.

### 11.12 Settings defaults
Video: ART §1.14 (STANDARD 225p, FILL, jitter MEDIUM, affine ON, 15-bit, dither ON, fog NORMAL, CRT SUBTLE, brightness
1.0, **vertical FOV 62° (50–80)**, UI CLEAN 2×, shake 100 %, head-bob 70 %, flashes FULL with a first-launch prompt,
light flicker FULL, frame cap OFF). Audio / Controls / Gameplay / Network: GDD §9.8, except the Network lobby URL default
`''` (= same host `/lobby`, proxied by Vite in dev, §7.3).
