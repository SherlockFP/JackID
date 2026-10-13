# JackID — ART BIBLE v1.1 (Producer reconciliation in §0.1 is binding)

Owner: Art Director + Lead 3D Modeler. Binding for every `src/machines/<id>/model.ts`, `src/core/psx/*`,
`src/core/texgen/*`, `src/world/*`, `src/player/*` (avatars, viewmodel) and the visual side of `src/menu/*`.

Original IP only. No CloverPit names, text, symbols, characters or art. Everything is procedural: three.js
primitives / `BufferGeometry` / `ExtrudeGeometry` / `LatheGeometry` / `TubeGeometry` plus pixel textures drawn at
runtime on a `<canvas>`. No image, model or font files beyond the two installed `@fontsource` fonts.

---

## 0. HOW TO USE THIS DOCUMENT

| Rule | Value |
|---|---|
| Precedence | `BRIEF.md` > this doc for **visuals**. The GDD owns rules, odds, payouts and machine ids. The tech spec owns TS interfaces. Where this doc shows an interface, it lists the data the art side needs. The tech spec may rename fields but must keep the data. |
| Units | metres, seconds. Angles are radians in code. In prose, `°` marks degrees. |
| Axes | right-handed, **+Y up**. The machine front faces **+Z**. The player looks along −Z at a machine. The player's left is −X. |
| Colour references | `P07` or `PAL.GROUT` refer to the master palette (§2.1). All hex values are **pre-snapped to the 15-bit grid** (channel = round(k·255/31), k = 0..31), so flat colours pass quantization unchanged and show no dither noise. |
| Machine ids | The snake_case ids in §5 are the art proposal. If the GDD chooses other id strings, map them 1:1 by display name. The visual spec still applies. |
| Budgets | Triangle counts are **hard caps**. Kit stools, chairs and dealer rigs are counted in their own kit budgets (§4.8), not in the machine budget. |
| Time | Animation timings assume real seconds. Easing names follow the usual easings.net set (`easeOutBack` uses overshoot s = 1.70158 unless stated). |

---

### 0.1 Producer reconciliation v1.1 (BINDING — wins over the rest of this document where they differ)

This bible still owns **how things look** (palette, textures, PSX pipeline look, modelling conventions, VFX, UI style).
The following integration decisions were made after reading BRIEF Addenda 1–8, GDD, TECH_SPEC and both catalogues:

| Topic | Decision |
|---|---|
| Name / brand | **JackID** (logo "JACK·ID"). The `jackpit` symbol is now `jackid` (the JackID coin medallion: coin + ladder into a pit). It is a brand mark, never a Big One reel symbol. Court cards = "JACKID COURT". |
| Machine ids & names | Catalogue ids (TECH §11.1) and catalogue / GDD §3.5 display names win: `big_one`→`bigone` THE BIG ONE, `pachislot` "Oni Feast" (keep the lantern-festival art; the hungry ghost becomes the oni), `pachinko` "Deep Rain" (night-rain-over-the-city playfield art; keep the toothed attacker gate), `peg_drop`→`plinko` PLINKO BOARD, `coin_pusher`→`coinpusher` "The Shelf" (two stations), `light_ring`→`cyclone` CYCLONE LIGHT RING (48 lamps), `tower_stack`→`stacker` STACKER, `scratch_vend`→`scratch` SCRATCH-CARD VENDOR, `rat_derby`→`derby` "The Rat Run", `crash_elevator`→`elevator` "SERVICE CAR", `money_wheel`→`bigsix` "The Six-Score Wheel" (54 segments 1/3/6/12/25/EYE/HOUSE per catalogue), `hi_lo`→`hilo` (catalogue split-flap cabinet, not the table), `dragon_tiger`→`cardwar` (War / Dragon-Tiger table, 2.40 × 1.10), `shell_game`→`shellgame` "Monsieur Thimble", `coin_flip`→`coinflip` (CROWN / SKULL faces), `devils_table`→`devilstable` (SHELLS + Six Chambers), `fortune_teller`→`fortuneteller` "Mother Moth" (22 omen cards), `lotto_blower`→`lottoblower` "The Breath" (30 white + 8 red Moon balls), `tombola` (L stall), `dice_tower`→`dicetower` (round table, 4 stations). |
| Missing machines | `lootbox`, `fruitmachine`, `bingopin`, `threecard`, `reddog`, `fantan`, `teetotum` have no §5 entry: their visual brief is in `docs/PLAN.md` (machine briefs), written to this bible's conventions. |
| Footprints / budgets | Final W × D × H, slot class, tris and draw-call caps per machine: `docs/PLAN.md` §4.2 (derived from §5.0 and GDD §8.5; e.g. bigone 1.80 × 1.40 × 3.10, mines console M, hilo cabinet M, coinflip booth 0.78 × 0.78 × 2.00). |
| Level layout & zones | **GDD §8** owns the pit (62 × 52 m nave Mouth / Well / Lobby + 8 wings) and every coordinate; §6.1's block-out and placement table are retired, but §6.2–§6.4, §6.7 (architecture kit, fixtures, signage, dressing) apply to the new layout. Zone looks map: mouth + well → ATRIUM, lobby + lift → LOBBY, gallery + midway → SLOT ROW (midway adds carnival bulb strings), cards + wheels → FELT HALL (wheels with red velvet + chandelier), laundry + boiler → ARCADE SUMP (laundry: white tile; boiler: rust + steam), parlour + counting → DEVIL'S PARLOUR, sump → SHAFT. Fog colours and near/far come from GDD §8.7 (snapped to the 15-bit grid by WORLD). |
| Big One placement | WELL-01 (0, 0, −4), rotY 180 (faces the Mouth), on the world-owned **4.0 × 4.0 × 0.15 m dais** (GDD §8.6), not a 0.30 m round dais. |
| Trapdoor | Every walkable 2 × 2 m floor plate is a trapdoor (GDD §8.9) built from `kitTrapdoor` leaves; there is no fixed 3 × 3 "Mouth" trapdoor ("The Mouth" is now the north zone). |
| Systems props | Debt Terminal sits at MOUTH-TERM against the north wall (no Judgement Dais); the CURIOSITIES vending model becomes **The Apothecary** tonic vendor (LOB-TONIC, 8 tonics on 2 × 4 coils); the shop is the Pawn Window + Charm Board (GDD §4.1); the wall clock is GDD's Ø 2.4 m single-face clock at MOUTH-CLOCK, and its XIII numeral appears **only on Night 8** (cutscene C11); hotline ring cadence = GDD §5.1 (1.0 s on / 0.7 s off, 10 s); jukebox title window holds **12** song strips. |
| Lights | No per-mesh 4-light uniforms: the engine uses 1 hemisphere + a constant pool of 6 point lights (TECH §11.7). Keep every flicker profile; each machine declares ≤ 2 light anchors. |
| Render code paths | TECH §1.2 paths (`src/core/renderer/*`, `src/core/texgen/*`, `src/kit/*`) replace §1.15. `psxMaterial(opts)` (TECH §2.3) must reproduce §1.3–§1.9. Internal res 400×225 default, FILL scaling (as §1.2). |
| Model contract | TECH §3.1 + §11.5: `buildModel(kit, { seed, variant, lod })` returns `MachineModel` (`root`, `parts`, `playPose`, `seats`, `colliders`, `interact`, `anchors`). §4.3's `setAttract` / `update` live in the coder's `index.ts` (`attract()` / `frame()`); `standPos`, `label`, `coinOut`, `lights` become `anchors.stand`, `anchors.label`, `anchors.coinOut`, `anchors.light/light2`. Part names: camelCase of §4.4 (TECH §11.8). |
| Interaction | Ray 2.2 m (tables 2.8 m), TECH §11.10 — not 1.8 m. Glide 0.60 s in / 0.45 s out (unchanged). |
| Characters | Players, dealers, patrons, staff, the Collector and cutscene actors use the Quaternius mannequin GLB (BRIEF Addendum 4, `kit.mannequin()`), PSX-converted, tinted, with §8.2 masks / hats on the `Head` bone. §8.1's hinge body and §4.9's procedural rig remain only for partial automata (the Rake arm, the Undertaker's Hands, Mother Moth's half body, Monsieur Thimble, the Devil's long-armed rig) and as the loading placeholder. |
| Big One symbols | Catalogue set (MACHINES_machines §2.1): MOTH (`moth`), TOOTH (`tooth`, PORCELAIN ramp: ivory molar), KEY (`key`), CANDLE (`candle`, new §3.6 row 12), RING (`ring`, row 13), CROWN (`crown`), SUN (`sun`, row 14), MAW = `grin`, GHOST (`ghost`, row 15). The menu spin and the burst land a full screen of **SUN** (GDD §9.4), not `jackid`. |
| Menu | Geometry, stations and cards = §7.1–§7.3; menu **entries and flow** = GDD §9.3–§9.5 (centre reel: PLAY · MULTIPLAYER · FREE CASINO · THE FOUNDATIONS · LEDGER · SETTINGS · CREDITS · QUIT; left reel context; right reel lever side); burst timeline = GDD §9.4 (crack 3.10–3.70 s, shatter 4.00 s, cut 4.45 s, land 4.50 s, then C01 / C02); the MP pre-game lobby is the Lift car (GDD §9.5), not the reel LOBBY ROOM station. |
| HUD | Layout and content = GDD §10.1–§10.3 (pocket ¢, Tickets, clock, quota, buffs, pulls, charms, mini punch card); style = §10.1–§10.3, §10.5–§10.7 here. Money glyph is **¢** (not $); banners read NIGHT n · LAST CALL · JACKPOT · BIG WIN · SHORT · PAID IN FULL. |
| Settings | §1.14 is binding for the Video tab (FOV vertical 62, head-bob 70 %); GDD §9.8 for the other tabs. |
| Player colours | The 8 mask colours of §8.2 are the player colours everywhere (chips, daubs, seat lamps, nameplates, owner plates). |
| Devil's Table | Both guns sit on the turntable and only aim at the brass seat lantern 0.4 m above the target's chair (GDD §6.12); the target's chair no longer drops through a trapdoor. SHELLS adds a shell tray, defibrillator boxes and item trays (MACHINES_tables §5A). |

---

## 1. PSX RENDER PIPELINE

### 1.1 Frame graph

```
Scene (all meshes use PsxMaterial: clip-space vertex snap + affine UV + Gouraud lights + vertex fog)
  └─► RT_LOW   intW×intH, RGBA8, NearestFilter, depth 24, no MSAA, no stencil
        └─► PASS_PSX  (intW×intH)  brightness/gamma → flash/fade overlay → tint (curse/ghost)
                                   → 4×4 Bayer dither → 15-bit quantize                    → RT_POST
              └─► PASS_OUT (canvas size) nearest upscale of RT_POST + UI canvas composite
                                   + optional CRT (scanlines, vignette, curvature, chroma) → screen
```

Renderer setup (three@0.186, `WebGLRenderer`):

| Setting | Value |
|---|---|
| constructor | `{ antialias:false, alpha:false, stencil:false, powerPreference:'high-performance' }` |
| `setPixelRatio` | 1 for RT_LOW. Output canvas backing size = `innerWidth × innerHeight × min(devicePixelRatio, 2)` |
| `outputColorSpace` | `LinearSRGBColorSpace` (three applies **no conversion**: the hex you author is the value you see) |
| `toneMapping` | `NoToneMapping` |
| `shadowMap.enabled` | `false` (blob shadows only, §1.8) |
| All CanvasTextures | `colorSpace = NoColorSpace`, `magFilter = minFilter = NearestFilter`, `generateMipmaps = false`, `anisotropy = 1` |
| Materials | the custom `ShaderMaterial` ("PsxMaterial") only. No `MeshStandardMaterial`/`MeshLambertMaterial` anywhere. Lambert is per-fragment in modern three, so it does not give the Gouraud look. |
| Canvas CSS | `image-rendering: pixelated; cursor: none;` (pixelated is a fallback; PASS_OUT already samples with nearest) |

### 1.2 Internal resolution & aspect

| Preset | Internal height `intH` | 16:9 size | Exact integer scale at |
|---|---|---|---|
| CRUNCHY | 180 | 320×180 | 1080p (6×), 1440p (8×) |
| **STANDARD (default)** | **225** | **400×225** | 900p (4×), 1800p (8×) |
| CLEAN | 270 | 480×270 | 1080p (4×), 2160p (8×) |
| HI | 360 | 640×360 | 1080p (3×), 1440p (4×) |
| OFF (PSX off) | window height | native | — |

- `intW = 2·round(intH · aspect / 2)`, with aspect clamped to [4:3, 21:9]. 16:9 gives 400, 16:10 gives 360, 4:3 gives 300 and 21:9 gives 526.
- Outside the clamp, the frame is letterboxed or pillarboxed with `#080808` (P00).
- **Scale mode** setting:
  - `FILL` (default): non-integer nearest scaling to the full window. Pixels may differ by 1 screen pixel; this is accepted.
  - `INTEGER`: `scale = floor(min(winW/intW, winH/intH))`, centred, with `#080808` bars.
- PASS_OUT sampling rule: `uv = (floor((fragCoord − viewportOrigin) / scale) + 0.5) / intRes`. This gives an exact nearest-neighbour lookup, so there is no bilinear bleed even with CRT curvature off.

### 1.3 Vertex snapping (jitter)

Applied in **clip space**, in the vertex shader of every PsxMaterial:

```glsl
uniform vec2 uSnapRes;          // vec2(intW, intH) * jitterFactor ; (0,0) disables
vec4 psxSnap(vec4 clip) {
  if (uSnapRes.x <= 0.0 || clip.w <= 0.05) return clip;   // never snap verts at/behind near plane
  vec2 halfRes = uSnapRes * 0.5;
  vec2 ndc = clip.xy / clip.w;
  ndc = floor(ndc * halfRes + 0.5) / halfRes;             // grid of uSnapRes cells across NDC [-1,1]
  clip.xy = ndc * clip.w;
  return clip;
}
void main(){ vec4 mv = modelViewMatrix * vec4(transformed,1.0);
  gl_Position = psxSnap(projectionMatrix * mv); }
```

| Jitter setting | jitterFactor | Grid at STANDARD | Look |
|---|---|---|---|
| OFF | 0 | — | modern |
| LOW | 1.0 | 400×225 (1 internal px) | subtle shimmer |
| **MEDIUM (default)** | **0.5** | 200×112.5 (2 px cells) | classic PS1 wobble |
| HIGH | 0.25 | 100×56 (4 px cells) | heavy. Also quantizes view-space position: `mv.xyz = floor(mv.xyz*64.0)/64.0` (1/64 m, "GTE precision") |

Exceptions:
- Diegetic text panels (menu reels, CRT screens, signs) use `snapOverride:'low'` (factor 1.0), so text stays legible.
- The viewmodel (hands) renders with its own camera at factor 1.0.
- Depth (`z`) is never modified, so snapping causes no z-fighting.

### 1.4 Affine texture mapping

The GPU interpolates `uv·w` and `w` with perspective correction. Dividing the two in the fragment shader removes
the perspective term, which leaves screen-space-linear (affine) UVs:

```glsl
// vertex
varying vec3 vAffUv;  varying vec2 vPerspUv;
vAffUv  = vec3(uv * gl_Position.w, gl_Position.w);
vPerspUv = uv;
// fragment
uniform float uAffine;                    // 0 = perspective-correct, 1 = full PS1 affine
vec2 uvAff = vAffUv.xy / vAffUv.z;
vec2 uvF   = mix(vPerspUv, uvAff, uAffine);
```

| Surface | uAffine |
|---|---|
| World geometry, machines, props | 1.0 |
| Text-bearing planes (CRT UI, menu reel cards, signs, cards held in play pose) | 0.35 |
| Viewmodel | 1.0 |
| Setting "Affine textures: OFF" | 0 everywhere |

**Tessellation rule (stops extreme warping):** no textured triangle edge may be longer than
**1.0 m** for walls, floors and ceilings, **0.5 m** for table felts and any surface the play-pose camera sees at
< 1 m, and **0.25 m** for screens (CRT planes use 6×4 segments). Floors are built as 1×1 m tiles, merged per
4×4 m chunk.

### 1.5 Colour quantization + ordered dither (PASS_PSX)

```glsl
const float BAYER[16] = float[16]( 0., 8., 2.,10.,
                                  12., 4.,14., 6.,
                                   3.,11., 1., 9.,
                                  15., 7.,13., 5.);
uniform float uLevels;   // 31.0 = 15-bit (5/5/5, default) | 15.0 = 12-bit "GRIM" | 255.0 = off
uniform float uDither;   // 1.0 default, 0 = off
uniform float uBright;   // 0.8..1.4 (settings), default 1.0
uniform vec4  uFlash;    // rgb, a = mix amount (see §9.6)
uniform vec4  uTint;     // rgb tint colour, a = amount (curse/ghost)
void main(){
  vec3 c = texture(tLow, vUv).rgb * uBright;
  c = mix(c, uFlash.rgb, uFlash.a);
  float l = dot(c, vec3(0.299,0.587,0.114));
  c = mix(c, l * uTint.rgb * 1.6, uTint.a);
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  float t = (BAYER[p.y*4 + p.x] + 0.5) / 16.0 - 0.5;     // −0.469 .. +0.469
  c += t * uDither / uLevels;
  c = floor(clamp(c,0.,1.) * uLevels + 0.5) / uLevels;
  gl_FragColor = vec4(c, 1.0);
}
```

Bayer 4×4 matrix (row = y, column = x, values 0..15):

```
 0  8  2 10
12  4 14  6
 3 11  1  9
15  7 13  5
```

- The dither is screen-locked at internal resolution, so the pattern stays fixed when the camera moves (correct PS1 behaviour).
- The same matrix drives SCREENDOOR transparency (§1.9), dither-dissolve UI transitions (§10) and `ditherFill()` in texgen (§3).

### 1.6 Fog (per-vertex depth cue)

```glsl
// vertex
float d = -mv.z;
vFog = clamp((d - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
vFog = floor(vFog * 16.0 + 0.5) / 16.0;        // 16 bands; the dither in PASS_PSX smooths them
// fragment
col = mix(col, uFogColor, vFog * uFogAmt);     // uFogAmt = 1 lit, 0.6 emissive/unlit, ADD: col *= 1.0 - vFog
```

`scene.background` always equals the active fog colour, so the far plane is never visible.

| Zone (see §6.1) | Fog / clear colour | near (m) | far (m) |
|---|---|---|---|
| ATRIUM (Mouth, Big One, dais) | `#191921` P02 SOOT | 6 | 26 |
| LOBBY (elevator, cashier, vending, hotline, jukebox) | `#292131` P03 COAL | 6 | 24 |
| SLOT ROW | `#291031` P40 BRUISE | 4 | 22 |
| FELT HALL | `#082919` P28 FELT_SHADOW | 5 | 24 |
| ARCADE SUMP | `#101931` P34 ABYSS_BLUE | 3 | 18 |
| DEVIL'S PARLOUR | `#3A0810` P11 DRIED_BLOOD | 2 | 14 |
| SHAFT (under the trapdoor) | `#080808` P00 VOID | 0.5 | 8 |
| MENU (jackpot interior) | `#080808` P00 VOID | 3 | 12 |
| ELEVATOR ASCENT (ending) | `#F7EFDE` P10 PAPER (white-out) | 2 | 10 |

- Zones are AABB volumes with a **3 m blend band**. Each frame, fog uniforms lerp by the player's normalized zone weights.
- A teleport or cut snaps the fog to the new zone, then eases over 1.5 s.
- Settings "Fog distance": NEAR = far × 0.75, NORMAL = × 1.0, FAR = × 1.3 (the clamp in §1.10 still applies).

### 1.7 Lighting model ("vertex-lit")

Gouraud, computed per vertex in world space:

```glsl
uniform vec3 uAmbSky, uAmbGround;         // hemisphere ambient (zone, §6.9)
uniform vec4 uLPos[4];                    // xyz world pos, w = range (m)
uniform vec4 uLCol[4];                    // rgb colour, a = intensity (0 = slot unused)
vec3 N = normalize(mat3(modelMatrix) * objectNormal);
vec3 lit = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
for (int i = 0; i < 4; i++) {
  vec3 L = uLPos[i].xyz - worldPos; float dist = length(L);
  float att = clamp(1.0 - dist / uLPos[i].w, 0.0, 1.0); att *= att;
  lit += uLCol[i].rgb * uLCol[i].a * max(dot(N, L / dist), 0.0) * att;
}
lit *= vColor.rgb;                         // baked AO / hand-tint vertex colours (§4.7)
lit = min(lit, vec3(1.75));                // PS1-style overbright (texture × 2.0 max on hardware)
vLit = floor(lit * 32.0) / 32.0;           // 5-bit lighting steps
// fragment:  col = tex.rgb * uColor * vLit + uEmissive * emissiveTex  (+ env, §1.8)
```

| Item | Spec |
|---|---|
| Lights per mesh | **max 4 point lights** plus hemisphere ambient. No directional sun (we are underground). |
| Light pool | ≤ **128 registered** point lights in the level (zone lights + machine `anchors.lights` + implicit CRT lights). The **active set** is the ≤ 16 best-scoring lights within 20 m of the camera, rebuilt at 10 Hz. Each object re-picks its 4 lights from the active set at **10 Hz** by score `intensity × (1 − dist/range)` and **cross-fades 0.2 s** when its set changes, so lights never pop. |
| Machines | declare ≤ 2 lights each in `anchors.lights`. CRT screens add an implicit light 0.4 m in front: colour = mean screen colour, intensity 0.4, range 1.5 m, updated at 4 Hz. |
| Emissive | unlit surfaces (bulbs, neon, CRT, LED) bypass `vLit`, fog at 0.6× and are ≥ 90% of their palette value on screen. |
| Specular | none. Chrome, brass and glass use a **sphere-map env** (matcap) sampled per vertex: `envUv = normalize(normalView).xy * 0.5 + 0.5`, then `col += envTex(envUv).rgb * envStrength`. Env textures come from `texEnvSphere` (§3). |
| Shadows | (a) baked vertex-colour AO (§4.7). (b) **blob shadows**: an 8-sided disc (8 tris), P01 at SCREENDOOR 10/16, radius = 0.5 × footprint, 3 mm above the floor, under avatars, dealers, stools and loose props. |
| Light cones | fake volumetrics under pendant lamps: an open 8-segment cone, ADD blend, the light's colour at 8% with a vertical vertex-colour fade, ×(1 − vFog). |

**Flicker profiles.** Evaluated on the CPU at **30 Hz**. The value multiplies light intensity and the matching emissive.

| Id | Formula / behaviour | Typical use |
|---|---|---|
| `STEADY` | 1.0 | sealed fixtures |
| `BUZZ` | `1 + 0.04·sin(2π·47t) + U(−0.02, 0.02)` | neon, fluorescent, CRT |
| `DYING` | 1.0. An event fires every U(2, 9) s: 1–4 blackouts of U(40, 120) ms (value 0.08), separated by U(30, 90) ms | broken tubes, sump work lights |
| `CANDLE` | `0.85 + 0.15·vnoise(t·6)` | candles, sconces, fireplace |
| `SICK` | `0.6 + 0.4·max(0, sin(2π·0.7t))³` | curse, Devil's lamp |
| `STROBE(f)` | square wave at f Hz, 50% duty | jackpot shows, alarms |
| `CHASE` | index-based for bulb arrays (§9.4) | marquees |
| `RING(cadence)` | follows the phone ring cadence (§6.6) | hotline booth |

"Reduced flicker" accessibility setting: amplitudes × 0.25, blackouts become dips to 0.6, STROBE is capped at 3 Hz.

### 1.8 Material shader feature flags (PsxMaterial)

`psxMat(preset: MaterialPresetId, overrides?)` returns a cached `ShaderMaterial` with these flags:

| Flag | Values | Notes |
|---|---|---|
| `lit` | true / false | false = unlit emissive (neon, CRT, bulbs, LEDs) |
| `map` | Texture or null | nearest, from texgen |
| `color` | hex | multiplies map |
| `emissive` / `emissiveMap` | hex / Texture | added after lighting |
| `env` | `'chrome' \| 'gold' \| 'glass' \| null`, `envStrength` 0..1 | sphere-map |
| `alpha` | `OPAQUE \| CUTOUT \| SCREENDOOR \| HALF \| ADD \| SUB` | §1.9 |
| `vertexColors` | always on (geometry without colours gets white) | AO lives here |
| `snap` | `'world' \| 'low' \| 'off'` | §1.3 |
| `affine` | 0..1 | §1.4 |
| `uvScroll` | vec2 m/s or UV/s | conveyor, bubbles, shaft walls |
| `instanced` | auto via `USE_INSTANCING` / `instanceColor` | bulbs, chips, coins, pegs |
| `fogAmt` | 1 / 0.6 / ADD fade | §1.6 |

### 1.9 Transparency (PS1 semi-transparency modes)

| Mode | three setup | Use | renderOrder |
|---|---|---|---|
| OPAQUE | default | 95% of meshes | 0 |
| CUTOUT | `discard` if alpha < 0.5, depthWrite on | grilles, chain-link, wire mesh, card corners, text sprites, foliage | 0 |
| SCREENDOOR | `discard` if alpha < (Bayer+0.5)/16, depthWrite on | ghosts, fading props, blob shadows, LOD fades | 0 |
| HALF | NormalBlending, opacity 0.5, depthWrite off (PS1 0.5B + 0.5F) | smoke, steam, puddles, curtain sheers | 10 |
| ADD | AdditiveBlending, depthWrite off (PS1 B + F; glass uses opacity 0.25 = B + 0.25F) | neon halos, glints, sparkles, **all glass**, light cones | 20 |
| SUB | CustomBlending ReverseSubtract, src 0.5 (PS1 B − F) | curse "void" patches, the House's hand decal | 15 |

Glass is **always ADD at 0.25** with `texGlassStreak`. It never needs sorting and never darkens what is behind it.
Never stack more than 3 transparent layers in one view direction.

### 1.10 Draw distance, culling, LOD

| Item | Value |
|---|---|
| Camera near / far | 0.05 / 48 m (viewmodel camera 0.01 / 2 m) |
| Hard cull | a machine whose bounding sphere is fully beyond `fogFar + 2 m` gets `visible = false` (tested at 10 Hz) |
| L0 (< 8 m) | everything |
| L1 (8–18 m) | hide nodes with `userData.lodDetail = true` (screws, plaques, small labels, inner mechanisms, chip stacks except the top 3 chips); attract animation at 15 Hz |
| L2 (> 18 m) | L1, plus mechanical attract animations frozen. Bulb chases continue (cheap instance-colour writes). CanvasTexture updates stop beyond **12 m** (screens hold their last frame). |
| LOD switch | 0.25 s SCREENDOOR cross-fade on the detail nodes. No popping. |

### 1.11 Budgets

| Asset | Max tris | Max draw calls | Textures |
|---|---|---|---|
| THE BIG ONE (hero) | 3,500 | 24 | ≤ 6 unique |
| Hero tables (roulette, craps, hold'em), excl. kit seats and dealer | 2,500 | 20 | ≤ 6 |
| Standard cabinet / booth | 1,400 | 14 | ≤ 5 |
| Small kiosk / prop machine | 900 | 10 | ≤ 4 |
| Dressing prop | 300 | 2 | ≤ 2 |
| Avatar (incl. mask) | 450 | 4 | 2 |
| Dealer automaton rig | 650 (seated "bot" LOD: 420) | 6 | 3 |
| Stool / chair | 120 / 140 | 1 (instanced) | shared |
| Level shell (walls, floor, ceiling, columns, all zones) | 14,000 | 40 | ≤ 16 |
| All dressing props together | 10,000 | 40 | — |
| **Whole frame, visible** | **70,000** | **300** | GPU texture memory ≤ **24 MB** |
| Particles | ≤ 600 live sprites/instances total | 6 | — |

- Merge static sub-meshes per material per machine with `BufferGeometryUtils.mergeGeometries`. Animatable parts stay separate Groups.
- Repeated small parts **must** be `InstancedMesh`: bulbs, chips, coins, pegs, nails, balls, pips, rivets.

**Texture sizes:**
- Tiles: 16, 32 or 64 px square.
- Single textures: max 128×128.
- Atlases: max 512×256.
- Strips: up to 32×672 (pachislot reels).
- CRT canvases: 128×96, 160×120 or 256×192.
- Signs: up to 256×32.
- Mip-maps: none by default (PS1 had none). The optional setting "Nearest+Mips" uses `NearestMipmapNearestFilter` + `generateMipmaps = true` (WebGL2 accepts NPOT).

### 1.12 Animation stepping (PS1 "stop-motion" feel)

| Animated thing | Rate |
|---|---|
| Simulation / input | 60 Hz fixed |
| Camera, reels, wheels, balls, coins, physics | full render rate (never stepped) |
| Automatons, dealers, avatar limbs, plush, puppets | sampled at **15 fps**: `tAnim = floor(t·15)/15`. Root motion is not stepped. |
| Sprite flip-books (sparkle, smoke, flames, bubbles) | 12 fps |
| CRT canvas redraw | ≤ 15 Hz (text typewriter at 60 chars/s, cursor blink 2 Hz) |
| Optional "PSX frame cap" setting | Off (default) / 30 fps |

### 1.13 CRT pass (PASS_OUT, optional)

| Parameter | OFF | SUBTLE (default) | FULL |
|---|---|---|---|
| Scanlines `S` (per internal row: `m = 1 − S·(0.5 − 0.5·cos(2π·fract(yOut/scale)))`, darkest at row borders) | 0 | 0.12 | 0.28 |
| Vignette `V` (`c *= 1 − V·smoothstep(0.45, 0.95, length(uv−0.5)·1.414)`) | 0 | 0.18 | 0.35 |
| Barrel `k` (`uv' = uv + (uv−0.5)·k·r²`; outside → #080808) | 0 | 0 | 0.04 |
| Chromatic offset (R +x, B −x) in internal px | 0 | 0 | 0.5 |
| Luma noise ±, re-seeded at 24 Hz | 0 | 0 | 0.025 |
| Phosphor mask / bloom | never (moiré at non-integer scales; bloom is not PS1) | | |

The curse event (§9.8) forces a 1.5 px chroma offset for 1 s even when the CRT is OFF.

### 1.14 Graphics settings (persisted; i18n keys `settings.gfx.*`)

| Setting | Options | Default |
|---|---|---|
| Resolution | CRUNCHY 180p / STANDARD 225p / CLEAN 270p / HI 360p / OFF | STANDARD |
| Scale mode | FILL / INTEGER | FILL |
| Vertex jitter | OFF / LOW / MEDIUM / HIGH | MEDIUM |
| Affine textures | OFF / ON | ON |
| Colour depth | 24-BIT / 15-BIT / 12-BIT | 15-BIT |
| Dithering | OFF / ON | ON |
| Fog distance | NEAR / NORMAL / FAR | NORMAL |
| CRT | OFF / SUBTLE / FULL | SUBTLE |
| Texture filter | NEAREST / NEAREST+MIPS | NEAREST |
| Brightness | 0.8 – 1.4 (step 0.05) | 1.0 |
| FOV (vertical) | 50° – 80° | 62° (≈ 95° horizontal at 16:9) |
| UI sharpness | PSX 1× / CLEAN 2× | CLEAN 2× |
| Screen shake | 0 – 100% | 100% |
| Head bob | 0 – 100% | 70% |
| Flashes | FULL / REDUCED | FULL (first launch asks) |
| Light flicker | FULL / REDUCED | FULL |
| PSX frame cap | OFF / 30 | OFF |
| One-click presets | "AUTHENTIC" (CRUNCHY, HIGH, 15-bit, FULL CRT, PSX 1×) · "DEFAULT" · "CLEAN" (HI, LOW, 24-bit, CRT OFF) | DEFAULT |

### 1.15 Code map (art-side proposal)

```
src/core/psx/PsxRenderer.ts   RT_LOW/RT_POST, passes, resize, settings binding
src/core/psx/PsxMaterial.ts   psxMat(preset, overrides), shader chunks, light-slot uniforms
src/core/psx/LightPool.ts     zone lights, flicker profiles, per-object 4-light picking
src/core/psx/FogZones.ts      zone volumes + blended fog uniforms
src/core/psx/Post.ts          PASS_PSX (quantize/dither/flash/tint), PASS_OUT (upscale/CRT/UI)
src/core/palette.ts           PAL, ramps, material presets (§2)
src/core/texgen/*.ts          all canvas texture generators (§3), cached by key
src/machines/_base/kit/*.ts   reusable modeling kit (§4.8)
```

---

## 2. PALETTE

### 2.1 Master palette (48 colours, 15-bit snapped)

| Idx | Name | Hex | 5-bit RGB | Role |
|---|---|---|---|---|
| P00 | VOID | `#080808` | 1,1,1 | deepest black, bars, shaft |
| P01 | PIT_BLACK | `#101019` | 2,2,3 | outlines, black suits, text shadow |
| P02 | SOOT | `#191921` | 3,3,4 | atrium fog, dark panels |
| P03 | COAL | `#292131` | 5,4,6 | tuxedos, shadows |
| P04 | ASH | `#3A3A42` | 7,7,8 | disabled text, dark concrete |
| P05 | SLATE | `#5A525A` | 11,10,11 | concrete mid-dark |
| P06 | CONCRETE | `#7B736B` | 15,14,13 | concrete |
| P07 | GROUT | `#9C9484` | 19,18,16 | secondary text, grout, scratch-off |
| P08 | BONE | `#C5BDA5` | 24,23,20 | porcelain shadow, old paper |
| P09 | IVORY | `#E6DEC5` | 28,27,24 | default UI text, card faces, gloves |
| P10 | PAPER | `#F7EFDE` | 30,29,27 | highlights, flash white |
| P11 | DRIED_BLOOD | `#3A0810` | 7,1,2 | parlour fog, deepest red |
| P12 | OXBLOOD | `#5A1019` | 11,2,3 | carpet base, card backs, enamel |
| P13 | CASINO_RED | `#8C1921` | 17,3,4 | leather, cabinet red |
| P14 | SIGNAL_RED | `#C52129` | 24,4,5 | debt, red suits, danger LEDs |
| P15 | CORAL | `#EF5A4A` | 29,11,9 | rouge, sparks, candles |
| P16 | RUST_DEEP | `#4A2110` | 9,4,2 | rust shadow, amber LED off |
| P17 | RUST | `#7B3A19` | 15,7,3 | rust |
| P18 | COPPER | `#AD6329` | 21,12,5 | copper, wood highlight |
| P19 | AMBER | `#E69431` | 28,18,6 | warnings, timers, warm lamps |
| P20 | BULB_YELLOW | `#FFCE5A` | 31,25,11 | incandescent bulbs |
| P21 | BRASS_SHADOW | `#4A3A19` | 9,7,3 | brass dark |
| P22 | BRASS | `#8C6B29` | 17,13,5 | brass mid |
| P23 | GOLD | `#C59C42` | 24,19,8 | gold, trims |
| P24 | GOLD_SHINE | `#EFD67B` | 29,26,15 | money text, glints |
| P25 | WALNUT_DARK | `#311910` | 6,3,2 | wood dark |
| P26 | WALNUT | `#523119` | 10,6,3 | wood |
| P27 | MAHOGANY | `#6B3A21` | 13,7,4 | wood light |
| P28 | FELT_SHADOW | `#082919` | 1,5,3 | felt hall fog, felt dark |
| P29 | FELT | `#10523A` | 2,10,7 | felt |
| P30 | FELT_LIGHT | `#297B4A` | 5,15,9 | felt light, $5 colour |
| P31 | BILE | `#8CA53A` | 17,20,7 | decay stains, TOAD player colour |
| P32 | VERDIGRIS | `#428C7B` | 8,17,15 | aged brass/copper, carpet accents |
| P33 | NEON_GREEN | `#5AFF7B` | 11,31,15 | wins, positive money (reserved) |
| P34 | ABYSS_BLUE | `#101931` | 2,3,6 | sump fog |
| P35 | DEEP_TEAL | `#193A42` | 3,7,8 | teal felt, cyan LED off |
| P36 | STEEL_BLUE | `#4A6B84` | 9,13,16 | steel, cold metal |
| P37 | COBALT | `#3163C5` | 6,12,24 | blue accents, CROW player colour |
| P38 | CRT_CYAN | `#63E6DE` | 12,28,27 | network UI, focus, CRT phosphor |
| P39 | ICE | `#BDF7EF` | 23,30,29 | fluorescent light, ghosts |
| P40 | BRUISE | `#291031` | 5,2,6 | slot row fog, curse-cell background |
| P41 | VELVET | `#4A193A` | 9,3,7 | curtains, wallpaper |
| P42 | PLUM | `#7B295A` | 15,5,11 | velvet highlight, $10 colour |
| P43 | NEON_MAGENTA | `#FF42A5` | 31,8,20 | decorative neon, PIG player colour |
| P44 | GUNMETAL | `#31313A` | 6,6,7 | dark metal |
| P45 | CHROME_MID | `#8C949C` | 17,18,19 | chrome |
| P46 | CHROME_HI | `#D6DEE6` | 26,27,28 | chrome highlight |
| P47 | CURSE_VIOLET | `#9C4AFF` | 19,9,31 | **reserved**: curse / the House only |

### 2.2 Ramps (dark → light; texgen indexes these)

| Ramp | Indices |
|---|---|
| GREY | P00 P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 |
| BLOOD | P11 P12 P13 P14 P15 |
| FIRE / RUST | P16 P17 P18 P19 P20 |
| BRASS | P21 P22 P23 P24 (glint P10) |
| WOOD | P25 P26 P27 (highlight P18) |
| FELT | P28 P29 P30 |
| DECAY | P28 P32 P31 |
| NIGHT | P34 P35 P36 P39 |
| VELVET | P40 P41 P42 P43 |
| CHROME | P44 P45 P46 P10 |
| PORCELAIN | P07 P08 P09 P10 |
| "darker" LUT (wear/stains, 1 step down) | each index maps to the previous entry in its ramp. Ramp starts map to P01. |

### 2.3 Colour semantics (enforced)

| Colour | Means | Never use for |
|---|---|---|
| CURSE_VIOLET P47 | curse, the House, debt doom | decor, player colours, normal UI |
| NEON_GREEN P33 | win, profit, "paid" | decor neon (exceptions: the pachislot bonus lamp, green-phosphor CRT text) |
| SIGNAL_RED P14 | debt, loss, danger, red suits | "go" buttons |
| GOLD_SHINE P24 | money amounts, jackpot | warnings |
| CRT_CYAN P38 | network, multiplayer, UI focus | money |
| AMBER P19 | timers, warnings, held/selected | wins |
| NEON_MAGENTA P43 | decorative neon / attract | money states |

Shape always backs up colour for colour-blind players: suits differ in shape, win cells get frames, curse cells get
the BRUISE background plus the grin shape.

### 2.4 Per-zone sub-palettes (60% dominant / 30% secondary / 10% accent)

| Zone | Dominant 60% | Secondary 30% | Accent 10% | Mood |
|---|---|---|---|---|
| ATRIUM | P12 OXBLOOD, P02 SOOT, P08 BONE (terrazzo) | P22 BRASS, P23 GOLD, P26 WALNUT | P20 BULB_YELLOW, P14 SIGNAL_RED (terminal) | ceremonial, warm gold pool in the dark |
| LOBBY | P03 COAL, P06 CONCRETE, P09 IVORY (marble) | P22 BRASS, P29 FELT (banker lamps), P13 CASINO_RED (booth) | P39 ICE, P43 NEON_MAGENTA | shabby hotel lobby |
| SLOT ROW | P40 BRUISE, P41 VELVET, P44 GUNMETAL | P45 CHROME_MID, P42 PLUM, P23 GOLD | P43 NEON_MAGENTA, P38 CRT_CYAN, P20 BULB_YELLOW | neon cathedral, purple haze |
| FELT HALL | P28 FELT_SHADOW, P29 FELT, P25 WALNUT_DARK | P27 MAHOGANY, P22 BRASS, P09 IVORY | P20 BULB_YELLOW pools, P14 SIGNAL_RED | old-money tables, pools of light |
| ARCADE SUMP | P34 ABYSS_BLUE, P35 DEEP_TEAL, P05 SLATE | P17 RUST, P32 VERDIGRIS, P31 BILE | P39 ICE work lights, P33 NEON_GREEN, P14 beacon | flooded, cold, industrial |
| DEVIL'S PARLOUR | P11 DRIED_BLOOD, P12 OXBLOOD, P25 WALNUT_DARK | P41 VELVET, P23 GOLD, P08 BONE | P15 CORAL candles, P47 CURSE_VIOLET (the **only** zone allowed decor violet) | intimate, firelit, wrong |
| MENU (jackpot interior) | P00 VOID, P44 GUNMETAL, P45 CHROME_MID | P22 BRASS, P09 IVORY (reel strips) | P20 BULB_YELLOW, P14 SIGNAL_RED (lever) | machine guts, warm bulbs |
| SHAFT | P00 VOID, P02 SOOT, P16 RUST_DEEP | P05 SLATE | P19 AMBER ring lights | falling dark |
| GHOST VIEW (post tint) | tint P39 ICE at 0.55, desaturate | — | P36 STEEL_BLUE | cold afterlife |

### 2.5 Material presets (`src/core/palette.ts` → `MATERIALS`)

Texture recipes are in §3. "env" is the sphere-map strength (§1.7).

| Preset id | Base colour | Texture recipe | Emissive | Alpha / env / flags |
|---|---|---|---|---|
| `felt_green` | P29 `#10523A` | `texFelt({ramp:FELT})` 32×32, repeat 1 per 0.5 m | — | OPAQUE |
| `felt_red` | P12 `#5A1019` | `texFelt({ramp:[P11,P12,P13]})` | — | baccarat |
| `felt_teal` | P35 `#193A42` | `texFelt({ramp:[P34,P35,P36]})` | — | dragon-tiger |
| `felt_violet` | P41 `#4A193A` | `texFelt({ramp:[P40,P41,P42]})` | — | the Devil's table |
| `brass` | P22 `#8C6B29` | `texBrushedMetal({ramp:BRASS, dir:'h'})` 32×32 | — | env gold 0.35 |
| `gold_trim` | P23 `#C59C42` | none (flat) | — | env gold 0.55 |
| `chrome` | P45 `#8C949C` | none | — | env chrome 0.80 |
| `gunmetal` | P44 `#31313A` | `texBrushedMetal({ramp:[P01,P44,P04]})` | — | env chrome 0.25 |
| `wood_walnut` | P26 `#523119` | `texWoodGrain({ramp:WOOD})` 32×64 | — | OPAQUE |
| `wood_mahogany` | P27 `#6B3A21` | `texWoodGrain({ramp:[P26,P27,P18]})` | — | OPAQUE |
| `leather_red` | P13 `#8C1921` | `texLeather({ramp:[P12,P13,P14], tufted:true})` 32×32 | — | rails, stools |
| `leather_black` | P03 `#292131` | `texLeather({ramp:[P01,P03,P04]})` | — | rails |
| `glass` | P39 `#BDF7EF` | `texGlassStreak()` 32×32 | — | ADD 0.25, env glass 0.3 |
| `glass_dirty` | P07 `#9C9484` | `texGlassStreak({grime:0.5})` | — | ADD 0.20 |
| `crt_screen` | — | dynamic CanvasTexture (`texCrtFrame` base) | 1.0 × map | unlit, affine 0.35, snap low, bulged 6×4 mesh |
| `neon_<c>` (red/magenta/cyan/amber/green/violet) | the neon colour | none (core) + `texGlow` halo plane | 1.0 | unlit, BUZZ. Halo plane ADD 0.6 at +0.02 m behind |
| `bulb_on` / `bulb_off` | P20 / P21 | none | P20 / none | instanced; colour via instanceColor |
| `led_panel` | P01 | dynamic `texSevenSeg` / `texDotMatrix` | map | unlit |
| `concrete` | P06 `#7B736B` | `texConcrete({seed})` 64×64, 1 tile per 2 m | — | OPAQUE |
| `concrete_wet` | P05 `#5A525A` | `texConcrete({wet:true})` | — | env glass 0.15 (wet sheen) |
| `rust` | P17 `#7B3A19` | `texRust({coverage:0.8})` 32×32 | — | OPAQUE |
| `rusty_metal` | P44 | `texRust({coverage:0.35})` | — | env chrome 0.1 |
| `velvet_curtain` | P41 `#4A193A` | `texVelvet()` 32×64 vertical folds | — | geometry folds (§6.3) |
| `carpet_<zone>` | variant base | `texCarpetCasino({variant})` 64×64, 1 tile per 1.5 m | — | OPAQUE |
| `terrazzo` | P08 `#C5BDA5` | `texTiles({kind:'terrazzo'})` 64×64 per 2 m | — | env glass 0.08 |
| `tile_sump` | P07 | `texTiles({kind:'sump'})` 64×64 per 1 m | — | OPAQUE |
| `wallpaper_deco` | P41 | `texWallpaper({variant:'fan'})` 32×64 per 0.8×1.6 m | — | OPAQUE |
| `wallpaper_damask` | P11 | `texWallpaper({variant:'damask'})` | — | parlour |
| `enamel_<c>` (red/cream/black/cobalt/green) | P13 / P09 / P01 / P37 / P30 | `texGrime({amount:0.15})` overlay on flat colour | — | cabinet paint |
| `plastic_btn_<c>` | colour | `texButtonCap({label})` 16×16 | colour × 0.0 off / × 1.0 lit | lit flag toggles emissive |
| `porcelain` | P09 `#E6DEC5` | `texPorcelainMask({variant})` 32×32 | eyes only (P19 / P47) | smooth normals |
| `bone` | P08 | flat + `texGrime` 0.1 | — | dice, teeth |
| `paper` | P09 | card / ticket textures | — | CUTOUT corners |
| `rubber` | P01 | none | — | knobs, grips |
| `mirror_dark` | P02 | `texEnvSphere({kind:'chrome'})` as env | — | env chrome 0.6 (fake reflection) |
| `wire_mesh` | P22 | `texMesh()` 16×16 diamond wire | — | CUTOUT |
| `marble` | P09 | `texMarble()` 64×64 (veins P07/P05) | — | env glass 0.1 |

---

## 3. PROCEDURAL TEXTURES (canvas pixel art)

### 3.1 Infrastructure (`src/core/texgen/base.ts`)

- **Indexed-first drawing.** Every generator writes **palette indices** into a `Uint8Array(w*h)` (255 = transparent).
  `blit()` then converts the indices to RGBA ImageData. Static textures are therefore palette-pure.
  Dynamic CRT canvases may use canvas ops, because PASS_PSX quantizes them anyway.
- **Determinism.** Each generator is a pure function of `(params, seed)`. `mulberry32(seed)` is the RNG. Every peer
  generates identical pixels, so nothing texture-related goes over the network.
- **Cache key:** `${fnName}:${stableJSON(params)}`. The result is a `CanvasTexture` with the §1.1 flags.
  Tile textures use `RepeatWrapping`.
- **Tileability:** every tiling texture uses **periodic value noise**, where the lattice period divides the texture
  size: `vnoiseP(x, y, period, seed)` hashes `(x mod period, y mod period)`.
- **Fonts:** await `document.fonts.load('8px "Press Start 2P"')` and `document.fonts.load('16px VT323')` before any
  text texture is generated. Import `@fontsource/press-start-2p/index.css` and `@fontsource/vt323/index.css` (all
  subsets, so Turkish ğ ş ı İ from latin-ext are present).

**Primitives** (pixel-exact; coordinates are integer pixel indices, x right, y down):

| Primitive | Definition |
|---|---|
| `px(x,y,c)` | set one pixel |
| `rect(x,y,w,h,c)` | filled rectangle |
| `frame(x,y,w,h,c)` | 1 px outline rectangle |
| `disc(cx,cy,r,c)` | pixel (x,y) is filled if `(x+0.5−cx)² + (y+0.5−cy)² ≤ r²` |
| `ring(cx,cy,r0,r1,c)` | pixels with r0² < d² ≤ r1² |
| `ellipse(cx,cy,rx,ry,c)` | `((x+0.5−cx)/rx)² + ((y+0.5−cy)/ry)² ≤ 1` |
| `line(x0,y0,x1,y1,c)` | Bresenham, 1 px |
| `poly(pts,c)` | even-odd scanline fill sampled at pixel centres |
| `outline(c)` | colours every transparent pixel that 4-neighbours an opaque pixel |
| `shadow(dx,dy,c,level)` | drop shadow of the current shape, dithered at Bayer `level/16` |
| `ditherFill(x,y,w,h,cA,cB,level)` | pixel = cB if Bayer(x,y) < level, else cA (level 0..16) |
| `rampDither(v, ramp, x, y)` | `ramp[clamp(floor(v·(n−1) + Bayer(x,y)/16), 0, n−1)]`, an ordered-dithered gradient |
| `mirrorX()` / `rot180(region)` | symmetry helpers (card indices, masks) |
| `textMask(str, font, px)` | renders with canvas `fillText`, then **thresholds alpha ≥ 0.5** to 1-bit. No anti-aliasing ever survives. |
| `micro(str, x, y, c)` | the 3×5 micro font (§3.4) |

### 3.2 Generator function list

| Function | Params (defaults) | Output | Notes |
|---|---|---|---|
| `texWoodGrain` | `{ramp:WOOD, rings:5, knots:1, planks:0, seed}` | 32×64 | grain runs along V |
| `texFelt` | `{ramp:FELT, wear:0.25, seed}` | 32×32 | tileable |
| `texBrushedMetal` | `{ramp:BRASS, dir:'h', glint:0.03, bevel:false, seed}` | 32×32 | tileable on the brush axis |
| `texRust` | `{base:P44, coverage:0.5, drips:3, seed}` | 32×32 | tileable |
| `texConcrete` | `{cracks:2, stains:true, wet:false, seed}` | 64×64 | tileable |
| `texCarpetCasino` | `{variant:'atrium'\|'slots'\|'felt'\|'parlour', wear:0.35, seed}` | 64×64 | tileable |
| `texTiles` | `{kind:'terrazzo'\|'checker'\|'sump'\|'hex', seed}` | 64×64 | tileable |
| `texWallpaper` | `{variant:'fan'\|'damask', decay:0.4, seed}` | 32×64 | tileable |
| `texMarble` | `{ramp:PORCELAIN, veins:3, seed}` | 64×64 | tileable |
| `texLeather` | `{ramp, tufted:false}` | 32×32 | tufted = buttons every 16 px |
| `texVelvet` | `{ramp:VELVET, folds:4}` | 32×64 | vertical fold bands |
| `texWainscot` | `{ramp:WOOD}` | 32×32 | raised panel with bevel |
| `texMesh` | `{c:P22, cell:4}` | 16×16 | CUTOUT diamond wire |
| `texGlassStreak` | `{grime:0}` | 32×32 | 2 diagonal streaks |
| `texEnvSphere` | `{kind:'chrome'\|'gold'\|'glass'}` | 32×32 | matcap |
| `texGlow` | `{r:15, levels:4}` | 32×32 | radial halo, dithered |
| `texGrime` | `{amount:0.3, seed}` | 32×32 | overlay alpha decal |
| `texStain` | `{kind:'water'\|'soot'\|'bile', seed}` | 64×64 | decal |
| `texCrack` | `{seed}` | 64×64 | decal (glass cracks reuse it) |
| `texCardAtlas` | `{}` | 512×256 | 52 faces + 3 backs + blank |
| `texCardBack` | `{variant:'house'\|'teal'\|'cursed'}` | 32×48 | |
| `texChipTop` / `texChipEdge` | `{denom}` | 16×16 / 32×4 | |
| `texDieAtlas` | `{style:'bone'\|'craps'\|'sicbo'}` | 64×32 | 6 faces at 16×16 in a 4×2 grid |
| `texSlotSymbol` | `{id, bg?:boolean}` | 32×32 | §3.6 |
| `texSlotStrip` | `{ids:string[], blur:false}` | 32×(32·n) | blur = motion-smear variant |
| `texRouletteRing` | `{}` | 296×12 | 37 cells × 8 px |
| `texRouletteLayout` | `{}` | 160×64 | 1 px = 1 cm on a 1.60×0.64 m felt |
| `texBlackjackFelt` | `{}` | 128×64 | |
| `texCrapsLayout` | `{}` | 192×96 | |
| `texBaccaratLayout` / `texSicBoLayout` | `{}` | 128×64 / 128×80 | |
| `texMoneyWheelAtlas` | `{}` | 128×32 | 7 labels × 16×24 |
| `texKenoBoard` | `{lit:number[]}` | 160×96 | dynamic |
| `texBingoCard` / `texBingoBoard` | `{seed}` / `{lit}` | 40×48 / 128×48 | dynamic |
| `texScratchCard` | `{design}` + mask canvas | 32×48 | dynamic mask |
| `texLottoBall` | `{n}` | 16×8 | equirect band |
| `texTarotCard` | `{omen}` | 32×56 | |
| `texRatSilk` | `{lane}` | 8×8 | |
| `texSignNeon` | `{text, font:'PS2P'\|'VT323', px:8, c, maxW:256}` | ≤256×32 (+halo) | returns letter x-ranges |
| `texSignPainted` | `{text, font, fg, bg, decay:0.3}` | ≤128×32 | gold-leaf / enamel |
| `texPoster` | `{variant}` | 32×48 | decor |
| `texPlaque` | `{text}` | 32×8 | brass label |
| `texButtonCap` | `{label, c}` | 16×16 | |
| `texKeypad` | `{keys:string[], cols}` | 48×64 | |
| `texCrtFrame` | `{w:128, h:96, scheme:'green'\|'amber'\|'cyan'\|'red'}` | 128×96 / 160×120 / 256×192 | base CRT canvas |
| `texSevenSeg` | `{text, digits, c, scale:1}` | (6·digits+1)·s × 13·s | dynamic |
| `texDotMatrix` | `{text, cols:8, c, scrollPx}` | (16·cols)×16 | dynamic |
| `texDialFace` | `{labels, arcDeg:180}` | 64×64 | gauges, elevator dial |
| `texClockFace` | `{}` | 64×64 | XIII hour mark (§6.7) |
| `texPorcelainMask` | `{variant}` | 32×32 | dealers, mannequins |
| `texAvatarMask` | `{mask}` | 32×32 | §8 |
| `texPlush` | `{c}` | 16×16 | claw prizes |
| `texFur` | `{}` | 16×16 | taxidermy rats |
| `texCrackGlass` | `{progress}` | 64×64 | menu burst-out |

### 3.3 Surface recipes

All recipes use periodic noise (`fbm` = 3 octaves of `vnoiseP`, gain 0.5).

**Wood grain (`texWoodGrain`, 32×64).**
1. `w = x + 6·fbm(x·0.08, y·0.02)`.
2. `ring = fract(w / (32 / rings))`.
3. `v = 0.55·ring + 0.25·fbm(x·0.5, y·0.05) + 0.2·(hash(x,y) − 0.5)`.
4. Knots: centre `(U(6,26), U(8,56))`, radius 4. Inside the knot, `v = fract(dist·0.35)`, and the outer 1 px ring is ramp[0].
5. `idx = rampDither(v, ramp)`.
6. If `planks > 0`: every `64/planks` rows, draw a 1 px seam in ramp[0] and a 1 px highlight in ramp[last] directly below it.

**Felt (`texFelt`, 32×32).**
1. Base ramp[1].
2. `h = hash(x,y)`: if h < 0.12, use ramp[0]; if h > 0.93, use ramp[2].
3. Worn patches: where `fbm(x·0.06, y·0.06) < wear`, shift 1 step darker at Bayer level 4/16.
4. The result must read as "fuzzy flat colour" at 0.5 m per tile.

**Brushed metal (`texBrushedMetal`, 32×32, `dir:'h'`).**
1. Per row: `rowV = 0.5 + 0.35·(hash1(y) − 0.5)`.
2. Per pixel: `v = rowV·0.6 + fbm(x·0.03, y)·0.4`.
3. `rampDither(v, ramp)`.
4. Glints: 3% of pixels become P10. If `bevel`, rows 0–1 use ramp[last] and rows 30–31 use ramp[0].

**Rust (`texRust`, 32×32).**
1. Base = `base` colour with ±1 ramp step of noise.
2. Where `fbm(x·0.15, y·0.15) > 1 − coverage`, use rust ramp [P16, P17, P18], chosen by a second fbm.
3. Pitting: if hash < 0.04, use P16.
4. Drips: `drips` columns at random x, each starting at y = 0 with length U(6, 20), in P17 at Bayer 8/16, widening 1 px at the end.

**Concrete (`texConcrete`, 64×64).**
1. `v = 0.5 + 0.3·fbm(x·0.1, y·0.1) + 0.2·(hash − 0.5)`, ramp [P04, P05, P06, P07].
2. Aggregate: 6% of pixels become P07 or P04 (50/50).
3. Cracks: `cracks` random walks of 20–40 steps from a random edge pixel. Each step moves 1 px in the main direction plus ±1 px sideways with p = 0.3. Colour P02, with a 1 px P07 highlight on the lower-right side.
4. Stains: water streaks fall from the top edge: 3 columns, 8–30 px long, 1 step darker at Bayer 6/16.
5. `wet`: all values −1 step, plus 2% P39 specks (wet glints).

**Casino carpet (`texCarpetCasino`, 64×64, tileable)**. This is the signature of the level.

| Layer | Rule | atrium | slots | felt | parlour |
|---|---|---|---|---|---|
| Base | every pixel | P12 OXBLOOD | P40 BRUISE | P28 FELT_SHADOW | P11 DRIED_BLOOD |
| Lattice | `(x+y) % 16 == 0 \|\| (x−y+64) % 16 == 0` → 1 px diamond grid (diamonds 16×16) | P23 GOLD | P42 PLUM | P22 BRASS | P21 BRASS_SHADOW |
| Motif A | 5×5 four-point star centred on the diamond centres `(8+16i, 16j)`: rows `..#..`/`..#..`/`#####`/`..#..`/`..#..`, centre px in accent | P24 + centre P19 | P38 + centre P10 | P09 + centre P14 | P08 + centre P15 |
| Motif B | 5×5 suit pip (§3.5) centred on `(16i, 8+16j)`, suit = (i+j) % 4 → ♥ ♦ ♣ ♠ | P15, P19, P32, P42 | P43, P20, P38, P46 | P14, P19, P09, P01 | eye glyph (§3.6 `eye` downscaled: 5×3 P08 with 1 px P01 pupil) |
| Dotted halo | pixels at Manhattan distance 5 from each motif centre, every 2nd pixel | P42 / P35 alternating | P37 | P13 | P41 |
| Wear | `fbm(x·0.06, y·0.06) < wear` → 1 step darker (darker-LUT) at Bayer 6/16 | ✓ | ✓ | ✓ | ✓ |
| Burns | 3 per tile: 2×2 P02 with a 1 px P21 ring | ✓ | ✓ | — | ✓ |

**Tiles (`texTiles`, 64×64).**
- `terrazzo`: base P08. 18% of pixels get 1–2 px chips drawn from {P07, P06, P12, P32, P23}. Brass divider strips (1 px P22) at x = 0 and y = 0 (one 2×2 m panel per tile).
- `checker`: 8×8 cells alternating P09 and P01, with a 1 px P06 grout line on the cell's right/bottom edge. Wear as for felt.
- `sump`: 16×16 tiles. Each tile's base is P08 or P07 (by hash), with a 1 px P06 grout line. 30% of tiles get a P31 BILE stain on their lower half at Bayer 6/16. 8% of tiles are missing, which shows `texConcrete` P05 with a P02 edge.
- `hex`: hexagon tiles of 8 px across, P09 / P08 alternating, grout P07 (lobby bathroom-style corridor).

**Wallpaper (`texWallpaper`, 32×64).**
- `fan` (art deco):
  - Background P41.
  - Each 32×32 cell holds a semicircular fan, radius 12, centred at (16, 30) of the cell: an arc outline in P23, 7 rays (0°, 30°…180°) in P22, and a P24 dot at the centre.
  - Cell row 2 is offset 16 px in x.
  - Vertical 1 px pinstripe in P42 at x = 0.
- `damask`:
  - Background P11.
  - A random-walk ornament: 40 steps drawn on the left half of a 16×32 cell, mirrored onto the right half, in P12.
  - Highlights in P13 at 10% of the ornament pixels.
- `decay` (both variants):
  - Peel: where `fbm(x·0.08, y·0.04) < decay·0.5`, show plaster P08 with a 1 px P03 rim.
  - Water stains: a gradient from the top, 1 step darker at Bayer 4/16 → 8/16.

**Marble.** Base P09. Veins are `|sin(x·0.15 + 4·fbm(x·0.05, y·0.05))| < 0.06` in P07, with secondary veins in P05 at half that threshold.

**Leather.** Base ramp[1] with 15% ramp[0] noise.
- Tufted: diamond-quilt lines every 16 px in ramp[0], with button discs r = 1.5 in ramp[0] and a 1 px ramp[2] highlight up-left.
- Rail leather: one horizontal stitch row at y = 2 (dashes 2 on / 2 off) in ramp[2].

**Velvet.** 4 vertical fold bands across 32 px: `v = 0.5 + 0.5·sin(x·2π·folds/32)`, `rampDither` over VELVET[0..2]. 1% of pixels become P43 (sheen sparkles).

**Glass streak.** Transparent base. Streak 1 is a 3 px wide diagonal from (4, 31) to (20, 0) in P10 (alpha 1 in ADD). Streak 2 is 1 px wide, from (14, 31) to (30, 0), in P39. `grime` adds P07 specks at density `grime·0.1`.

**Env sphere (matcap, 32×32).** A disc of r = 15:
- `chrome`: the top half of the disc (y < 16 − 3·sin(x)) runs P46 → P10, the horizon band is P04, and the bottom half runs P45 → P02.
- `gold`: the same layout using P24 / P21 / P23.
- `glass`: P39 rim (r 13..15), transparent interior, one P10 highlight disc r = 3 at (11, 10).

**Glow halo (`texGlow`, 32×32).** Radial value `1 − d/r`, quantized into `levels` bands. Each band is drawn as SCREENDOOR-style dither in white: band 4 → 16/16, band 3 → 12/16, band 2 → 8/16, band 1 → 4/16. Tinted by the material colour, ADD.

### 3.4 Micro font 3×5 (cards, chips, felts, LED labels)

Glyph cell is 3×5 with 1 px letter spacing. Rows run top→bottom, `1` = ink. For Turkish, the cell grows to 3×7:
row −1 is an accent row and row 5 is a descender row (line pitch 7).

```
0 111 101 101 101 111   A 010 101 111 101 101   N 110 101 101 101 101
1 010 110 010 010 111   B 110 101 110 101 110   O 010 101 101 101 010
2 111 001 111 100 111   C 011 100 100 100 011   P 110 101 110 100 100
3 111 001 111 001 111   D 110 101 101 101 110   Q 010 101 101 110 011
4 101 101 111 001 001   E 111 100 110 100 111   R 110 101 110 101 101
5 111 100 111 001 111   F 111 100 110 100 100   S 011 100 010 001 110
6 111 100 111 101 111   G 011 100 101 101 011   T 111 010 010 010 010
7 111 001 010 010 010   H 101 101 111 101 101   U 101 101 101 101 111
8 111 101 111 101 111   I 111 010 010 010 111   V 101 101 101 101 010
9 111 101 111 001 111   J 001 001 001 101 010   W 101 101 111 111 101
$ 011 110 111 011 110   K 101 101 110 101 101   X 101 101 010 101 101
¢ 010 111 100 111 010   (v1.1: the coin glyph used by HUD, LEDs and pop text; `$` is kept only for decor posters)
+ 000 010 111 010 000   L 100 100 100 100 111   Y 101 101 010 010 010
- 000 000 111 000 000   M 101 111 111 101 101   Z 111 001 010 100 111
× 000 101 010 101 000   . 000 000 000 000 010   : 000 010 000 010 000
/ 001 001 010 100 100   ! 010 010 010 000 010   ? 110 001 010 000 010
% 101 001 010 100 101   "10" (card index only, 5 wide) 10111 10101 10101 10101 10111
TR: Ç = C + descender 010 · Ş = S + descender 010 · Ğ = G + accent 111 · Ö/Ü = O/U + accent 101 · İ = I + accent 010
```

### 3.5 Playing cards (`texCardAtlas`, 512×256; card 32×48; mesh 0.060×0.090 m)

**Atlas layout.**
- Columns 0–12 = A, 2–10, J, Q, K. Rows 0–3 = ♠, ♥, ♦, ♣. Each cell is 32×48, so the faces occupy (0,0)–(416,192).
- Row 4 (y = 192): `house` back at x = 0, `teal` back at x = 32, `cursed` back at x = 64, blank face at x = 96.
- UV with flipY: `u0 = x/512`, `u1 = (x+32)/512`, `v0 = 1 − (y+48)/256`, `v1 = 1 − y/256`.
- Card mesh: two back-to-back planes (4 tris). The back plane is offset 0.0002 m.

**Face construction** (x 0..31, y 0..47):
1. Fill P09 IVORY. Draw a 1 px P07 border.
2. Corners: pixels (0,0), (1,0), (0,1) and the matching pixels at all 4 corners are transparent (CUTOUT) → rounded corners.
3. Suit colour: ♥♦ = P14 `#C52129`. ♣♠ = P01 `#101019`.
4. Index: rank glyph (§3.4) at (2,2); for "10", the 5-wide glyph at (1,2). The 5×5 suit pip goes at (1,9).
5. Copy the index block (0,0)–(7,15), rotated 180°, to (24,32)–(31,47).

**Suit pips 5×5:**

```
HEART  .#.#.  #####  #####  .###.  ..#..        DIAMOND ..#..  .###.  #####  .###.  ..#..
CLUB   .###.  #####  #.#.#  ..#..  .###.        SPADE   ..#..  .###.  #####  #.#.#  .###.
```

**Pip positions** (top-left corner of each 5×5 pip):
- Columns: L = 8, C = 13, R = 18 (centres 10.5 / 15.5 / 20.5, symmetric about the card centre x = 15.5).
- Rows: R1 = 5, R3 = 21, R5 = 37 (centres 7 / 23 / 39). Q1 = 13 and Q2 = 29 (centres 15 / 31).
- Side rows for 9 and 10: S1 = 5, S2 = 15, S3 = 27, S4 = 37 (centres 7 / 17 / 29 / 39).
- Pips whose centre is below y = 23 are drawn rotated 180°.

| Rank | Pips |
|---|---|
| 2 | (C,R1) (C,R5) |
| 3 | (C,R1) (C,R3) (C,R5) |
| 4 | (L,R1) (R,R1) (L,R5) (R,R5) |
| 5 | 4 + (C,R3) |
| 6 | (L,R1) (R,R1) (L,R3) (R,R3) (L,R5) (R,R5) |
| 7 | 6 + (C,Q1) |
| 8 | 6 + (C,Q1) (C,Q2) |
| 9 | L and R at S1..S4 + (C,R3) |
| 10 | L and R at S1..S4 + (C,10) (C,32) |
| A | one 11×11 pip scaled ×2 from the 5×5 bitmap plus a centre fill pixel, at (10,18). **A♠ only**: a P23 ring r 8..9 around it and a 2×1 P09 "eye" at (15,24) |

**Court cards: the original "JACKID COURT".**
- A double-headed portrait sits in a frame at (8,9)–(23,38), 16×30, with a 1 px border in the suit colour.
- Draw the top half (16×15) and copy it rotated 180° into the bottom half.
- The suit pip (5×5) goes at (9,10) inside the frame.
- Clothes accent colour: red suits use P13, black suits use P03.

| Rank | Character | Top-half drawing (frame-local coords, 16×15) |
|---|---|---|
| J | **THE BELLHOP** | pillbox cap rect (5,1,6,2) P12 with a P23 band at row 3; face ellipse c(8,6) rx3 ry3 P08; eyes px (7,6),(9,6) P01; jacket rect (2,10,12,5) accent with a P23 button column at x = 8; a round tray: ellipse c(13,10) rx3 ry1 P45 |
| Q | **THE WIDOW** | veil triangle poly (8,0),(1,11),(15,11) P01; face ellipse c(8,6) rx2.5 ry3 P08 (drawn over the veil); lips 2 px (7,8),(8,8) P14; pearl necklace px every 2 px along y = 11, x 4..12, P10; shoulders accent |
| K | **THE OWNER** | top hat rect (5,0,6,4) P01 + brim rect (3,4,10,1) P01 + band row 3 P13; face ellipse c(8,7) rx3 ry3 P08; monocle ring c(9.5,7) r 1..2 P23; eye px (6,7) P01; cigar rect (10,9,3,1) P07 with tip px (13,9) P15; waistcoat rect (3,11,10,4) accent; watch chain px line (5,12)→(10,13) P23 |

**Backs (32×48):**

| Variant | Construction |
|---|---|
| `house` (default) | fill P12. 1 px P23 border inset 2 px. Diagonal lattice inside: `(x+y) % 4 == 0` → P22. Medallion at (15.5, 23.5): ring r 5..6 P23, interior P12, centre 2×2 P01, 4 P24 rivets at r 4 on the diagonals. Same rounded corners as faces. |
| `teal` (second shoe) | the same construction with P35 / P36 / P38 |
| `cursed` | P40 fill, P47 lattice, medallion replaced by the `grin` eye: ellipse rx3 ry2 P09 with a P47 2×2 pupil. Used only during curse events. |

### 3.6 Original slot symbol set (`texSlotSymbol`, 32×32)

General rules:
- Draw the primitives in the listed order. Then `outline(P01)` and `shadow(1, 1, P02, 8)`.
- Strip cell background: P09 for normal symbols, **P40 for the curse symbol**. Each cell has a 1 px P08 separator at row 31.
- The "Tier" column is an art suggestion only. The GDD owns weights and payouts.

| # | id | Name | Tier | Pixel construction (32×32; c = centre, r = radius) |
|---|---|---|---|---|
| 1 | `tooth` | GOLD TOOTH | low | Crown: disc c(11,7) r4, disc c(21,7) r4, rect (7,7,19,9), all P23. Roots: rect (10,16,5,9), rect (18,16,5,9), disc c(12.5,25) r2.5, disc c(20.5,25) r2.5, P23. Root gap: rect (15,18,3,10) transparent. Shade: pixels with x ≥ 20 inside the crown → P22; roots' right 2 columns → P22. Highlight: rect (10,8,2,4) P24 + px (12,7) P24. Sparkle: plus-shape 3×3 at (25,4) in P10. |
| 2 | `eye` | GLASS EYE | low | Sclera: disc c(16,16) r11 P09; lower-right crescent (ring r 9.5..11 where x + y > 32) P08. Veins: line (6,12)→(9,13), (7,21)→(10,19), (25,10)→(22,12), (26,20)→(23,18) in P14. Iris: disc r5.5 P37; ring r 4..5.5 P36; 3 px P38 at (13,13),(14,13),(13,14). Pupil: disc r2.5 P01. Highlight: rect (13,12,2,2) P10. |
| 3 | `key` | RUSTY KEY | low | Bow: ring c(8,16) r 3.5..7 P18. Shaft: rect (14,15,15,3) P18. Teeth: rect (22,18,3,5), rect (26,18,3,7) P18. Shade: shaft row 17 and the lower half of the bow ring → P17. Highlight: shaft row 15, x 15..26 → P19; bow arc px (5,11),(6,10),(7,10) → P19. Rust specks: 6 seeded px inside the shape → P16. |
| 4 | `horseshoe` | IRON HORSESHOE (open end **down**: "the luck runs out") | mid | Arch: ring c(16,14) r 7..12, keep y ≤ 14. Legs: rect (4,14,5,14), rect (23,14,5,14). Fill P45. Shade: right leg + lower-right arch → P44. Highlight: arch top-left arc 1 px inside the outer edge → P46. Nail holes 1×2 P01 at (6,18),(6,11),(10,6),(21,6),(25,11),(25,18). Calks: rect (4,27,5,2), rect (23,27,5,2) P44. |
| 5 | `moth` | DEATH MOTH | mid | Forewings: poly L (14,10),(2,5),(1,14),(13,19) and its mirror R in P26, with a 1 px P07 band along the outer edge. Hindwings: poly L (14,19),(4,20),(6,28),(14,24) and its mirror, P19, with 2 P01 bands at y = 22 and y = 25. Eye-spots: disc r1.5 at (7,11) and (25,11) P09 with a centre px P01. Body: ellipse c(16,17) rx2 ry8 P03. Head: disc c(16,9) r2 P03. Antennae: line (15,7)→(11,2), (17,7)→(21,2) P02, tips P08. Thorax skull: rect (15,11,3,3) P09, px (15,12),(17,12) P01. |
| 6 | `crown` | TIN CROWN (dented) | mid-high | Band: rect (5,20,23,7) P23, bottom row P22. Points (triangles, P23): [(5,20),(9,20),(6,8)], [(9,20),(14,20),(11,13)], [(13,20),(19,20),(16,5)], [(18,20),(23,20),(21,13)], [(23,20),(27,20),(26,8)]. Ball tips: disc r1.5 at each apex P24. Jewels: disc r2 at (10,23) P14, (16,23) P37, (22,23) P30. Dents: px (8,24),(25,21),(26,22) P21. |
| 7 | `bullion` | GOLD BULLION | high | Top face: poly (8,10),(24,10),(28,16),(4,16) P24. Front face: rect (4,16,25,10) P23. Bottom edge: row 25 P21. Side bevels: column 4 and column 28 of the front → P22. Engraved stamp "999" micro font at (11,18) in P22. Glint: line (6,17)→(10,17) P10 + plus-sparkle at (26,8) P10. |
| 8 | `heart` | ANATOMICAL HEART | high | Body: disc c(12,14) r6 ∪ disc c(20,13) r7 ∪ poly (6,16),(27,16),(17,29) in P13. Light: the top-left 40% of the shape (x + y < 26) → P14; rim px on the top-left edge → P15. Shadow: pixels with x + y > 40 → P12. Vessels on the surface: line (14,15)→(17,22)→(16,26) P12. Aorta arch: ring c(18,7) r 2..4, top half only, P15, plus rect (20,7,2,4) P15. Pulmonary vein: rect (11,3,3,6) P36. |
| 9 | `jackid` | **THE JACKID COIN** (brand medallion; NOT a Big One reel symbol) | jackpot | Coin: disc c(16,16) r14 P23. Rim: ring r 12..14; top-left half (x + y < 32) P24, bottom-right half P22. Inner field: disc r12 P21. Pit: disc c(16,17) r7 P01 with a lit lip ring r 7..8 P19. Ladder descending into the pit, P22: rails line (13,11)→(13,23) and (19,11)→(19,23); rungs at y 13, 16, 19, 22 from x 13..19. Rivets: 8 px P24 at r 13 every 45°. The strip cell adds an additive `texGlow` P20 plate behind this symbol. |
| 10 | `grin` | **THE GRIN** (curse) | curse | Mask: ellipse c(16,15) rx10 ry13 P09; lower-right where x + y > 34 → P08. Crack: line (19,3)→(17,8)→(20,12)→(18,17) P02. Eye holes: ellipse c(11,13) rx2.5 ry1.5 and c(21,13) rx2.5 ry1.5 P01, each with a centre px P47 (also written into an emissive layer). Grin: for x 8..24, y = 21 + round(0.04·(x−16)²) → P01. Stitches: vertical 1×3 lines through the grin at x = 9, 11, … 23 in P01. Rouge: rect (7,18,2,1), rect (23,18,2,1) P15. Violet tears: px columns (11,15..19) and (21,15..18) P47. Cell background P40. |
| 11 (optional) | `glove` | THE DEALER'S HAND (wild, if the GDD wants one) | wild | Palm: rect (10,12,12,12) P09. Fingers: rect (10,4,3,8), (13,2,3,10), (16,3,3,9), (19,6,3,6) P09. Thumb: poly (10,16),(5,12),(4,15),(10,21) P09. Cuff: rect (9,24,14,5) P38 with a P01 button px at (16,26). Knuckle lines: px row y = 12 every 3 px, P08. Cell background P37. |
| 12 | `candle` | CANDLE (Big One) | low | Holder: rect (9,28,14,3) P22, top row P23. Wax: rect (12,12,8,16) P09; right 2 columns P08; drips: rect (12,15,1,4), rect (19,17,1,3) P09 over a P08 shadow px below each. Wick: line (16,9)→(16,11) P01. Flame: ellipse c(16,6) rx2 ry3 P20 with a 1×2 P10 core at (16,6); frame B shifts the flame 1 px left. Glow halo: `texGlow` ADD plate P19 behind in the strip cell. |
| 13 | `ring` | RING (Big One) | low-mid | Band: ring c(16,20) r 6..9 in P23; top-left half of the band (x + y < 36) P24; bottom-right 2 px P22. Setting: rect (14,9,4,3) P22 with prong px (13,10),(18,10) P23. Gem: diamond poly (16,2),(21,7),(16,12),(11,7) P14; facet px (14,5),(15,4) P15; shadow lower-right half P13. Sparkle plus-shape 3×3 at (24,4) P10. |
| 14 | `sun` | SUN (Big One top symbol, menu jackpot) | high | Rays: 12 triangles every 30° from r 9 to r 15 around c(16,16), alternating P19 / P20. Face: disc c(16,16) r8 P20, lower-right crescent (ring r 6.5..8 where x + y > 34) P19. Eyes: rect (12,14,2,2), rect (18,14,2,2) P01. Smile: for x 12..20, y = 19 + round(0.12·(x−16)²) → P01. Cheeks px (11,18),(21,18) P15. Cell background P19 at Bayer 4/16 over P09 (the "#FF7A00 glow" of the catalogue). |
| 15 | `ghost` | GHOST (Big One wild, charm-only) | wild | Sheet: disc c(16,12) r9 ∪ rect (7,12,18,13) in P39; right 3 columns P36. Hem: 3 scallops cut out as transparent discs r2.5 at (10,26), (16,26), (22,26) so the hem reads wavy. Eyes: ellipses c(12,12) rx1.5 ry2.5 and c(20,12) rx1.5 ry2.5 P01. Mouth: ellipse c(16,18) rx1.5 ry2 P01. Cell background P37. |
| — | `tooth` (Big One TOOTH) | ivory molar | low | The §3.6 `tooth` painter drawn with the PORCELAIN ramp (crown/roots P09, shade P08, highlight P10) instead of gold. The gold variant stays available to other machines as `tooth_gold`. |

**Reel strip motion blur (`texSlotStrip({blur:true})`).** Each output pixel = the mode of the 6 source pixels above
it in the same column (palette-pure smear). The reel material swaps to the blur strip while ω > 60% of max
speed (§5 timings).

### 3.7 Chips & dice

**Chips.**
- Mesh: `CylinderGeometry(0.020, 0.020, 0.0034, 12)` (40 mm × 3.4 mm), instanced per denomination.
- Top texture `texChipTop` (16×16):
  1. Body disc r = 8.
  2. 6 edge inserts (2×2) at angles k·60° on r = 6.5.
  3. Inner ring r 4..4.5 in the ring colour.
  4. Value in micro font, centred.
- Edge texture `texChipEdge` (32×4): 6 stripes, 2 px wide, in the insert colour.

| Denomination | Body | Inserts / ring | Text |
|---|---|---|---|
| 1 | P09 | P05 | P01 "1" |
| 5 | P14 | P09 | P09 "5" |
| 25 | P30 | P09 | P09 "25" |
| 100 | P01 | P23 | P09 "100" |
| 500 | P42 | P09 | P09 "500" |
| 1K | P23 | P01 | P01 "1K" |
| House marker (loan plaque) | rectangular 0.060×0.040×0.004, P12 | P23 border | P23 "IOU" |

Stacks: max 20 chips drawn per stack (taller amounts add a second stack). Per-chip jitter: ±0.6 mm in x/z, ±8° yaw.

**Dice.**
- `texDieAtlas` (64×32): 6 faces in a 4×2 grid of 16×16. Each face is 15×15 drawn in the 16×16 cell, with the right column and bottom row in the bevel colour.
- Pips are 3×3 squares with corner pixels in a mid tone. Pip top-left positions use {2, 6, 10} on both axes (centres 3 / 7 / 11).
- Face pips: 1 = C. 2 = TL, BR. 3 = TL, C, BR. 4 = corners. 5 = corners + C. 6 = TL, TR, ML, MR, BL, BR.
- Face → normal mapping (opposites sum to 7): +Y = 1, −Y = 6, +X = 3, −X = 4, +Z = 2, −Z = 5. Logic reads the face whose world normal is most +Y.

| Style | Body | Pips | Bevel | Size (m) |
|---|---|---|---|---|
| `bone` | P08 | P01 (corners P03) | P07 | 0.016 – 0.022 |
| `craps` | P14 | P09 | P13 | 0.019 |
| `sicbo` | P09 | P01; faces 1 and 4 in P14; face 1 pip is 5×5 | P08 | 0.040 (cage) |

### 3.8 Roulette, wheels, boards

**European wheel order** (clockwise seen from above, starting at 0):
`0 32 15 19 4 21 2 25 17 34 6 27 13 36 11 30 8 23 10 5 24 16 33 1 20 14 31 9 22 18 29 7 28 12 35 3 26`

**Red numbers:** 1 3 5 7 9 12 14 16 18 19 21 23 25 27 30 32 34 36. The rest are black (P01). 0 is P29 FELT.

**`texRouletteRing` (296×12).**
- Cell i covers x 8i..8i+7.
- Pocket colour fills rows 0–11.
- The number is in the micro font, 2 digits (7 px), at (8i+1, 4), in P09.
- A 1 px P23 separator sits at x = 8i.
- The ring is mapped onto an annulus with u = angle, so numbers read upright from outside the wheel.

**`texRouletteLayout` (160×64; 1 px = 1 cm).**
- Background P29. All cell borders are 1 px P09.
- Zero: x 0–11, y 0–47, P29 fill, "0" in P09.
- Number grid: x 12–131 = 12 columns × 10 px. Rows: y 0–15 → 3, 6 … 36; y 16–31 → 2, 5 … 35; y 32–47 → 1, 4 … 34. Each cell is filled P29 and its number is drawn in its pocket colour (P14 or P01) with a 1 px P09 outline, so black numbers stay legible.
- Column bets: x 132–151, three cells labelled "2:1".
- Dozens: y 48–55, cells x 12–51 / 52–91 / 92–131, labelled "1ST 12" "2ND 12" "3RD 12".
- Even money: y 56–63, six cells of 20 px labelled "1-18" "EVEN", then a red ◆ (5×5 diamond pip in P14), a black ◆ (P01), "ODD" "19-36".
- Turkish layout strings come from i18n (e.g. "ÇİFT", "TEK"). Pre-render both languages and switch the texture on locale change.

**`texMoneyWheelAtlas` (128×32).** 7 labels of 16×24:
- "1" on P09, "2" on P37, "5" on P30, "10" on P42, "20" on P19. Numbers are the micro font scaled 2×.
- The 16×16 `jackid` symbol downsampled onto P01.
- The `grin` symbol on P40.

**Keno board (`texKenoBoard`, 160×96).**
- 10 × 8 cells of 16×12, numbers 1–80, rows 1–10 / 11–20 / …
- Unlit cell: P02 with the number in P04.
- Lit cell: P20 with the number in P01.
- The newest draw blinks 4 Hz for 1 s.
- A 1 px P22 rule between rows 40 and 41.

**Bingo.**
- Card `texBingoCard` (40×48): header row "B I N G O" in P09 on P14. 5×5 grid of 8×8 cells: number in P01 on P09, centre cell "FREE" (P23 star). Daub = 6×6 disc in P43 with an edge at Bayer 8/16.
- Board `texBingoBoard` (128×48): 5 rows (B, I, N, G, O) × 15 numbers. Cells 8×9, number in the micro font. Lit = P20.

**Lotto ball (`texLottoBall`, 16×8 equirect).**
- Band colour by decade: 1–9 P09, 10–19 P37, 20–29 P14, 30–39 P30, 40–49 P19.
- White label disc r = 3 at u = 0.25 and u = 0.75, with the number in P01.

**Tarot omens (`texTarotCard`, 32×56).**
- 1 px P23 border. Background P01.
- Image area 24×36 at (4,4). Title plate y 44–51 in P22 with a roman numeral in P01.

| Numeral | Omen | Image |
|---|---|---|
| I | THE PIT | `jackid` ladder hole |
| II | THE KEY | `key` |
| III | THE MOTH | `moth` |
| IV | THE HOUSE | a pediment silhouette with a P47 eye |
| V | THE WIDOW | the Q portrait |
| VI | THE LADDER | 5 rungs rising to a P20 square |
| VII | THE CLOCK | clock face with hands at XIII |
| VIII | THE HAND | the `glove` symbol |

### 3.9 Signage, CRT UI, LED displays

**Neon text (`texSignNeon`).**
1. `textMask` in white → the core mask.
2. Dilate by 1 px → the tube mask. Tube pixels take the neon colour. Core pixels whose 4 neighbours are all inside the mask become P10 (hot centre).
3. Separate halo texture: dilate by 3 px, with Bayer levels 12/16 at 1 px, 8/16 at 2 px and 4/16 at 3 px. It sits on an ADD plane 0.02 m behind the sign.
4. The generator returns `letterRanges: [x0, x1][]` (max 16). The shader masks individual letters with a `uLetterOn[16]` uniform, so single letters can run the `DYING` profile ("JACKP T").

**Painted sign (`texSignPainted`).**
1. Text in `fg`, then a 1 px P01 outline, on `bg`.
2. Decay: fbm chips reveal P06.
3. Gold-leaf variant: fg uses `rampDither` vertically from P24 (top) to P22 (bottom).

**CRT canvas (`texCrtFrame`).**

| Scheme | Background | Text | Dim text | Highlight |
|---|---|---|---|---|
| green | P28 | P33 | P30 | P10 |
| amber | P11 | P19 | P17 | P20 |
| cyan | P34 | P38 | P36 | P10 |
| red (debt) | P11 | P14 | P12 | P15 |

- Grid: Press Start 2P 8 px → 16 cols × 12 rows on 128×96. VT323 16 px → about 21 cols × 6 rows (line height 16).
- Baked scanlines: every odd row is darkened with rgba(0,0,0,0.25).
- A 1 px rounded inner corner mask (corner pixels black).
- Power-on: a horizontal line expands over 0.12 s, then the screen opens vertically over 0.18 s.
- Power-off: collapses to a centre dot over 0.20 s, then the dot fades over 0.3 s.
- Screen meshes are bulged: `z += 0.015·(1−u'²)·(1−v'²)` with u', v' in [−1, 1], 6×4 segments.

**Seven-segment LED (`texSevenSeg`).**
- Digit cell 6×13 px (5 px glyph + 1 px gap). Segment pixels in a 5×11 box:
  - a = x1–3, y0
  - b = x4, y1–4
  - c = x4, y6–9
  - d = x1–3, y10
  - e = x0, y6–9
  - f = x0, y1–4
  - g = x1–3, y5
  - dp = x5, y10
- Glyph segment masks: 0 abcdef · 1 bc · 2 abged · 3 abgcd · 4 fgbc · 5 afgcd · 6 afgedc · 7 abc · 8 abcdefg · 9 abcdfg · − g · E adefg · r eg · o cdeg · P abefg · A abcefg · L def · H bcefg · U bcdef · b cdefg · d bcdeg · n ceg · F aefg · C adef · t defg · Y bcdfg · S = 5 · space none.
- Lit / ghost-segment colours:

| Lit | Unlit "ghost" segment |
|---|---|
| red P14 | P12 |
| amber P19 | P16 |
| green P33 | P28 |
| cyan P38 | P35 |

- Background P01. `scale: 2` doubles every pixel (Debt Terminal).
- Odometer roll: when a digit changes, the old glyph slides up and out as the new one slides in from below, 0.05 s per step.

**Dot-matrix marquee (`texDotMatrix`).**
- Glyphs come from Press Start 2P at 8 px (an 8×8 cell, which is pixel-exact at this size). Each glyph pixel becomes one LED dot of 1 px on a 2 px pitch, so a character is 16×16.
- Unlit dots: P02. Lit dots: the scheme colour.
- Scroll at 24 px/s in 2 px steps.

---

## 4. MODELING CONVENTIONS

### 4.1 Space

| Rule | Value |
|---|---|
| Units | 1 unit = 1 metre |
| Up | +Y. The floor is y = 0 in machine-local space. |
| Machine origin | floor-centre of its rectangular footprint |
| Front | **+Z**. The player stands at +Z looking −Z. "Left" in this doc = −X (the player's left). |
| World placement | yaw in 90° steps (45° allowed on display islands). Never scaled. Never pitched. |
| Arrays | indexed 0..n−1 **left → right** (−X → +X) from the player's view, then **top → bottom** |

### 4.2 Reference dimensions (human scale)

| Item | Dimension |
|---|---|
| Player eye height standing / crouched | 1.62 / 1.05 |
| Seated eye on bar stool (seat 0.68) | 1.30 |
| Seated eye on casino chair (seat 0.48) | 1.15 |
| Table felt height / padded rail top | 0.78 / 0.80 (craps rail 0.92) |
| Upright slot cabinet | W 0.66 × D 0.62 × H 1.82 |
| Slant-top cabinet | W 0.70 × D 0.80 × H 1.32 |
| Button deck height | 0.95 – 1.00 (upright), 0.80 (slant) |
| Door clearance | 2.10 |
| Player collision capsule (as AABB) | 0.50 × 1.75 × 0.50 (crouch 1.20) |

### 4.3 `model.ts` contract (art requirements; the tech spec owns final typing — v1.1: see §0.1 "Model contract" and TECH §11.5)

```ts
export function buildModel(opts: { seed: number; variant?: number /*0..3 colourway*/; lod?: 0 | 1 }): MachineModel;

export interface MachineModel {
  root: THREE.Group;                       // origin = floor-centre of footprint, faces +Z
  parts: MachineParts;                     // named animatable nodes (§4.4)
  anchors: {
    playPose: { pos: Vector3; target: Vector3; fov: number };  // machine-local
    standPos: Vector3;                     // feet position when the player stands up (y = 0)
    prompt: Vector3;                       // world point the "[E] PLAY" prompt projects from
    label: Vector3;                        // top centre + 0.15 m: "IN USE: <name>" tag, MP
    seats?: { pos: Vector3; yaw: number; height: number; playPose: {...} }[];   // tables
    dealer?: Vector3;
    coinOut?: Vector3;                     // payout coin spawn point (+ direction = +Z)
    lights: { pos: Vector3; color: number; intensity: number; range: number; flicker: FlickerId }[]; // ≤ 2
  };
  colliders: THREE.Box3[];                 // ≤ 3 local AABBs for the player
  interact: THREE.Box3[];                  // ray-proxy boxes: 1 per cabinet, 1 per free seat at tables
  footprint: { w: number; d: number; h: number };
  setAttract(on: boolean): void;           // idle/attract mode (§5 per machine)
  update(dt: number, t: number): void;     // cosmetic animation only; logic lives in index.ts
  dispose(): void;                         // geometries, materials, CanvasTextures
}
```

### 4.4 Part naming (`parts.*`)

Every animatable part is a `THREE.Group` whose **origin is its pivot**. Also set `object.name` (e.g. `"reel_2"`).

| Name | Type | Convention |
|---|---|---|
| `parts.reels[i]` | Group | axis = local **X**. `rotation.x = k·2π/N` puts symbol k on the payline. **Positive rotation moves the visible strip downward.** `userData.N`, `userData.radius`, `userData.stripIds` |
| `parts.lever` | Group | pivot at the hinge. Rest 0. Pulled = **+1.05 rad about X** (the top swings toward +Z/down). `parts.leverKnob` is its child. |
| `parts.buttons.<id>` | Group | origin at the cap's face centre. Press = −0.006 m along local Z over 0.05 s, release over 0.08 s. `userData.lamp` = the material whose emissive toggles. Ids: `spin, bet_up, bet_dn, bet_max, cashout, deal, draw, hold0..4, stop0..2, higher, lower, take, drop, heads, tails, info` |
| `parts.screen` / `parts.screens.<id>` | Mesh | `userData.canvas`, `userData.ctx`, `userData.tex` (CanvasTexture) |
| `parts.leds.<id>` | Mesh | 7-seg / dot-matrix canvas, e.g. `credit`, `bet`, `win`, `timer`, `debt` |
| `parts.bulbs` | InstancedMesh | `userData.chase: number[]` = instance order clockwise from bottom-left |
| `parts.lamps.<id>` | Mesh | single lamps (`top`, `candle`, `bonus`) |
| `parts.wheel` / `parts.rotor` | Group | axis Y (roulette) or local Z (vertical wheels) |
| `parts.ball`, `parts.balls` | Mesh / InstancedMesh | |
| `parts.cards` | CardPool | pooled card meshes (kit) |
| `parts.chips` | ChipStacks | kit |
| `parts.dealer` | DealerRig | kit (§4.9) |
| `parts.tray`, `parts.door`, `parts.flap`, `parts.knob`, `parts.joystick`, `parts.claw`, `parts.gantry`, `parts.cage`, `parts.crank`, `parts.pusher`, `parts.car`, `parts.needle`, `parts.hands` | Group | machine-specific, described in §5 |
| `parts.fx` | Group | attachment points for particles: `fx.coinOut`, `fx.sparkle`, `fx.smoke` |

### 4.5 Play-pose camera (machine-local)

| Class | pos | target | FOV |
|---|---|---|---|
| Upright cabinet, seated on a stool | (0, 1.30, 0.72) | (0, 1.22, 0.18) | 52 |
| Upright cabinet, standing | (0, 1.58, 0.70) | (0, 1.25, 0.10) | 52 |
| Slant-top, seated | (0, 1.18, 0.62) | (0, 0.98, 0.08) | 50 |
| Table seat | seat.pos + (0, 1.15, 0), moved 0.12 m toward the table centre | a felt point 0.35 m in front of the seat at y 0.80 | 58 |
| Standing booth / counter | (0, 1.55, 0.70) | (0, 1.20, 0) | 52 |
| Tall wall machine (peg drop, crash shaft) | (0, 1.62, 1.30) | (0, 1.40, 0) | 66 |

- **Enter:** glide 0.60 s, `easeInOutCubic` on position, quaternion slerp and FOV together. Mouselook is locked during the glide.
- **In pose:** free-look ±12° yaw / ±8° pitch, spring-back 0.30 s after mouse stops. Machines that need depth judgement (claw, coin pusher) allow ±25° plus A/D lean ±0.25 m.
- **Exit (E / Esc):** 0.45 s `easeOutCubic` back to `standPos` at eye 1.62.

### 4.6 Colliders & interaction (v1.1: interaction ray 2.2 m, tables 2.8 m — TECH §11.10)

- `colliders`: default = one AABB of the footprint, expanded 0.02 m. Tables: table AABB + one per chair. Chairs are walk-blocking.
- `interact`: a box over the front face (w × h × 0.30 m), set 0.05 m in front of the cabinet.
- The prompt shows when the crosshair ray (max **1.8 m** from the eye) hits a proxy **and** the player's feet are within **1.6 m** of `standPos`.
- Tables: one 0.6 × 1.0 × 0.6 m proxy per free seat. An occupied seat shows the red "IN USE" brackets (§10.4).

### 4.7 Geometry & material rules

| Rule | Value |
|---|---|
| Cylinder segments | tiny (< 0.03 m radius): 6. Normal: 8. Large discs / wheels: 12–24. Pocketed wheels: = pocket count. |
| Spheres | `IcosahedronGeometry(r, 0)` (20 tris) for balls and coins in bulk; detail 1 (80 tris) for hero knobs and crystal balls |
| Bevels | `ExtrudeGeometry` with `bevelSegments: 1`, `bevelSize: 0.008–0.015` |
| Normals | boxes/cabinets keep hard per-face normals (faceted Gouraud). Organic shapes (masks, heart, plush) use `computeVertexNormals()` on indexed geometry. |
| Vertex colours | `bakeAO(geom, worldY)`: `vcol = 0.55 + 0.45·smoothstep(0.0, 0.5, y)` for floor-standing parts, then × (1 ± 0.04 seeded per face, the "hand-tinted" jitter). Recesses (screen bezels, trays, coin slots) × 0.7. |
| Decals | planes 0.002 m off the surface, `polygonOffset(−1, −1)`, CUTOUT or SUB |
| Text | **never** TextGeometry. Always canvas textures. |
| Colourways | `variant` 0..3 swaps enamel/trim presets (each machine lists its 4), so rows of identical machines look different |
| Seeded detail | scratches, decals, missing bulbs (2–5% of bulbs dead) and dents come from `seed` |
| Dispose | every machine owns its CanvasTextures. Shared texgen textures are ref-counted by the cache. |

### 4.8 Reusable kit (`src/machines/_base/kit/`)

| Kit function | Key params (defaults) | Geometry / dims | Tris | Exposes |
|---|---|---|---|---|
| `kitCabinetShell` | `{w:0.66, d:0.62, h:1.82, topper:'none'\|'arch'\|'box', colorway}` | Side profile (z, y), extruded along X by w: (−0.31,0) (0.28,0) (0.28,0.10) (0.31,0.10) (0.31,0.88) (0.36,0.98) (0.30,1.02) (0.22,1.56) (0.25,1.60) (0.25,1.82) (−0.31,1.82). Recessed kick 0.03, deck lip +0.05, screen slant 8°, 0.015 chrome trim strips on the front edges. Arch topper: half-cylinder r = w/2, 8 segments. | ~140 | `deck`, `screenRect`, `topRect` |
| `kitBevelScreen` | `{w, h, bevel:0.03, depth:0.04, bulge:0.012, seg:[6,4], scheme}` | bezel = Extrude of rect-with-hole, bulged screen mesh, glass overlay | ~90 | `screen` |
| `kitMarquee` | `{w, h:0.28, d:0.12, text, font, neon:'magenta', bulbs:{spacing:0.07, r:0.012}}` | sign box + text plane + bulb ring (octahedron bulbs, 8 tris each) | 30 + 8n | `bulbs`, `sign` |
| `kitCoinTray` | `{w:0.40, d:0.14, h:0.08}` | chrome box, 0.03 front lip | ~40 | `tray`, `coinOut` |
| `kitButtonPanel` | `{buttons:[{id,label,c,w:0.05,h:0.035}], deckW, deckD, slope:12°}` | box caps 0.02 deep on a sloped plate | 12/button | `buttons.*` |
| `kitStool` | `{seat:0.68, r:0.18}` | 8-seg seat 0.08 thick (`leather_red`), 6-seg chrome post r 0.025, 4-spoke base r 0.25, footring torus r 0.18 (8×4) at y 0.30 | ≤ 120 | — |
| `kitChair` | `{seat:0.48}` | seat 0.46×0.44, back 0.46×0.50 tilted 8°, `leather_red` + `wood_walnut` legs 0.03² | ≤ 140 | — |
| `kitTable` | `{shape:'half'\|'oval'\|'rect'\|'round'\|'tub', w, d, h:0.78, rail:0.09, felt, layoutTex}` | felt top tessellated to 0.5 m; padded rail = Extrude along the outline (0.09 wide × 0.05 tall, bevel 0.02, `leather_black`); walnut apron 0.12; pedestal or 4 legs | 200–500 | `feltTop`, `seats` |
| `kitChipStack` | `{denom, count, jitter:true}` | shared InstancedMesh per denomination (cap 512 instances per table) | 40/chip | `set(count)` |
| `kitCardShoe` | `{}` | wedge 0.18×0.12×0.10, smoked glass sides (glass_dirty), brass edges, cards visible inside | ~60 | `mouth` anchor |
| `kitCardPool` | `{n:32}` | back-to-back planes 0.060×0.090; card i UV-mapped to the atlas | 4/card | `deal(from,to,face,dur)` |
| `kitBulbRing` | `{path:Vector3[] \| rect, spacing, r, colours}` | InstancedMesh octahedra | 8/bulb | `chase(pattern)` |
| `kitCrtMonitor` | `{w:0.40, h:0.30, bezel:P01, scheme}` | front bezel + tapered rear box (depth 0.8·w) | ~80 | `screen` |
| `kitLedPanel` | `{digits, c, scale}` | plane + canvas | 2 | `leds` |
| `kitTowerLight` | `{colours:[top,bottom]}` | two 6-seg cylinders r 0.03 h 0.08 on a 0.06 chrome post | ~40 | `lamps.top` |
| `kitStanchion` + `kitVelvetRope` | `{len}` | brass post 0.95 h (6-seg), base disc r 0.15; rope = 8-seg Tube catenary, sag 0.12 | 60 + 48 | — |
| `kitGlassDome` | `{r, h}` | Lathe of a quarter/half circle, 12 seg × 6 rings, `glass` | ~150 | — |
| `kitPlaque` | `{text, w:0.12, h:0.03}` | brass plate + `texPlaque` | 12 | — |
| `kitCrank` | `{r:0.12}` | brass arm + walnut handle cylinder | ~40 | `crank` |
| `kitDealer` | `{mask:'porcelain'\|'devil'\|'oracle'\|'cashier'\|'caller', seated:false, hat?}` | §4.9 | 650 / 420 | `DealerRig` |
| `kitTrapdoor` | `{w:2, d:2}` | §6.5 | ~60 | `open()`, `close()` |
| `kitBlobShadow` | `{r}` | 8-tri disc | 8 | — |
| `kitDecal` | `{tex, w, h}` | quad | 2 | — |

### 4.9 Dealer automaton (`kitDealer`): creepy low-poly mannequin with a porcelain mask (v1.1: humanoid dealers use the mannequin GLB + this mask; the rig below is for partial automata and placeholders, see §0.1)

**Proportions and joints** (local origin at the floor between the feet; standing height 1.78):

| Joint | Position / length |
|---|---|
| pelvis | y 1.00 |
| spine | 0.28 |
| chest | y 1.28 – 1.50 |
| neck | y 1.52, a 0.06 brass cylinder r 0.035 with screw-thread texture |
| head | 0.22 tall |
| shoulders | ±0.20 |
| upper arm | 0.28 |
| forearm | 0.26 |
| hand | 0.09 |
| thigh / shin | 0.45 / 0.45 (hidden behind tables; the seated LOD drops them) |

**Geometry:**
- Torso: `CylinderGeometry(0.20, 0.15, 0.50, 6)`, P03 tuxedo. Shirt-front triangle plate in P09. Bow tie = 2 triangles each side in P14.
- Limbs: 6-seg cylinders tapering r 0.045 → 0.035.
- **Visible ball joints** at shoulder, elbow and wrist: `IcosahedronGeometry(0.045, 0)` in brass. This is the mannequin read.
- Gloved hands (P09): palm box 0.08×0.025×0.09, 4 fingers × 2 segments (0.016×0.016×0.04) + a 2-segment thumb. ~120 tris per hand.
- Head: porcelain mask, a front half-shell `LatheGeometry` of an oval profile (0.13 wide × 0.17 tall × 0.08 deep, 8×6 segments), with `texPorcelainMask`. Back of the head: a P03 hood dome (hemisphere, 8×3).
- Eyes: 2 emissive pinpoints (0.008 quads) 0.01 behind the eye holes. P19 at 60% normally. **P47 during curses.**

**`texPorcelainMask` (32×32):**
- Base P09, shading P08 at the right and bottom (x + y > 36).
- Almond eye holes: ellipses c(10,13) and c(22,13), rx 3 ry 1.5, in P01.
- Painted closed-lid arcs above the holes: 1 px P02 arcs.
- Rouge discs r 2 at (8,19) and (24,19) in P15, at Bayer 8/16.
- A thin smile that is **too wide**: y = 23 + round(0.03·(x−16)²) for x 7..25, in P01.
- Crack: line (12,2)→(10,8)→(11,11) in P02.

| Variant | Differences |
|---|---|
| `porcelain` | standard croupier |
| `devil` | mask P12 lacquer with a P23 grin line. 2 horn cones (5-seg, h 0.07, r 0.02, P23) at ±0.04 on the brow. Eyes P19, P47 when cursed. |
| `oracle` | moth-wing headdress (2 planes 0.25 × 0.18 with a scaled `moth` texture), a P01 SCREENDOOR 12/16 veil plane over the lower face |
| `cashier` | P30 eyeshade visor (a 0.12 Extrude arc), sleeve garters in P14 |
| `caller` | microphone on a stalk: 8-seg sphere r 0.03 in chrome, on a 0.35 m gooseneck Tube |
| Bots ("Regulars") | hats: fedora / bowler / cloche / flat cap / none. Mask paint variants: smile, frown, blank, sleepy, weeping (P38 tear px) |

**Animation set** (sampled at 15 fps):

| Clip | Duration | Motion |
|---|---|---|
| idle | loop | chest scale.y 1 → 1.01 at 0.25 Hz. Head tilt ±6° every U(3,7) s |
| twitch | 0.06 s | one random joint snaps ±10° and holds 0.3 s, every U(5,14) s |
| stare | 0.08 s snap, hold 1.5 s | head yaw/pitch to the player's eye. Triggered by curses, big player losses, or the player looking at it > 4 s |
| dealCard | 0.45 s | reach 0.18 s, flick 0.12 s, return 0.15 s. The card flight is kitCardPool's Bézier arc |
| flipCard | 0.30 s | wrist roll π |
| collect | 0.60 s | arm sweep across the felt |
| payout | 0.50 s | push chips forward 0.25 m |
| shuffle | 1.20 s | riffle: two half-stacks interleave, 6 steps |
| spinWheel | 0.80 s | roulette / Big Six arm throw |
| laugh | 0.60 s | head back 20°, jaw (mask lower third, separate mesh) 3 open/close cycles |
| glitch (curse) | 0.40 s | head yaw +180° in 6 steps, hold 1 s, return |
| gesture | 0.80 s | arm extends toward a seat, palm up |

---

## 5. PER-MACHINE VISUAL SPECS

### 5.0 Catalogue (v1.1: ids, names, footprints and caps are superseded by `docs/PLAN.md` §4.2; the visual specs §5.1–§5.32 still apply under the new ids)

Footprint is W × D × H in metres. Budgets exclude kit seats and dealer rigs.

| # | id | Display name (EN) | Zone | Footprint | Tris cap | Instances |
|---|---|---|---|---|---|---|
| 1 | `big_one` | THE BIG ONE | ATRIUM | 1.80 × 1.40 × 3.10 | 3,500 | 1 |
| 2 | `bandit` | ONE-ARMED BANDIT | SLOT ROW | 0.44 × 0.42 × 1.48 | 900 | 4 |
| 3 | `pachislot` | PACHISLOT "HUNGRY LANTERN" | SLOT ROW | 0.50 × 0.45 × 1.80 | 1,100 | 3 |
| 4 | `video_poker` | VIDEO POKER | SLOT ROW | 0.62 × 0.70 × 1.40 | 900 | 3 |
| 5 | `roulette` | EUROPEAN ROULETTE | FELT HALL | 2.60 × 1.30 × 0.80 | 2,500 | 1 |
| 6 | `blackjack` | BLACKJACK | FELT HALL | 2.10 × 1.10 × 0.80 | 1,800 | 1 |
| 7 | `holdem` | TEXAS HOLD'EM | FELT HALL | 2.80 × 1.40 × 0.80 | 2,200 | 1 |
| 8 | `baccarat` | BACCARAT | FELT HALL | 2.40 × 1.20 × 1.60 | 1,600 | 1 |
| 9 | `craps` | CRAPS | FELT HALL | 3.20 × 1.50 × 0.92 | 2,400 | 1 |
| 10 | `sic_bo` | SIC BO BIRDCAGE | FELT HALL | 1.80 × 1.00 × 1.45 | 1,200 | 1 |
| 11 | `money_wheel` | THE GREAT WHEEL (Big Six) | FELT HALL | 1.90 × 1.80 × 2.90 | 1,600 | 1 |
| 12 | `pachinko` | PACHINKO "HELL'S GATE" | ARCADE SUMP | 0.60 × 0.45 × 1.62 | 1,300 | 2 |
| 13 | `peg_drop` | PEG DROP | ARCADE SUMP | 1.20 × 0.35 × 2.40 | 1,200 | 1 |
| 14 | `coin_pusher` | THE TIDE (coin pusher) | ARCADE SUMP | 1.00 × 1.00 × 1.95 | 1,100 + coins | 1 |
| 15 | `keno` | KENO LOUNGE | SLOT ROW | 3.00 × 2.00 × 2.20 | 1,400 + balls | 1 |
| 16 | `bingo` | BINGO NOOK | ARCADE SUMP | 4.00 × 3.00 × 2.40 | 1,500 | 1 |
| 17 | `scratch_vend` | LUCKY PAPER (scratch vending) | SLOT ROW | 0.80 × 0.60 × 1.85 | 800 | 1 |
| 18 | `rat_derby` | RAT DERBY | ARCADE SUMP | 3.20 × 1.10 × 1.55 | 1,300 | 1 |
| 19 | `crash_elevator` | THE ELEVATOR (crash) | ARCADE SUMP | 1.80 × 0.80 × 3.40 | 1,000 | 1 |
| 20 | `mines` | MINEFIELD | ARCADE SUMP | 1.10 × 0.90 × 1.60 | 1,000 | 1 |
| 21 | `hi_lo` | HI-LO | FELT HALL | 1.20 × 0.80 × 1.30 | 900 | 1 |
| 22 | `dragon_tiger` | DRAGON & TIGER (casino war) | FELT HALL | 1.60 × 0.90 × 1.25 | 1,200 | 1 |
| 23 | `claw_crane` | THE GRABBER (claw crane) | ARCADE SUMP | 0.90 × 0.90 × 1.95 | 1,300 | 1 |
| 24 | `light_ring` | HALO (light ring) | SLOT ROW | 1.00 × 0.85 × 2.10 | 900 | 1 |
| 25 | `tower_stack` | TOWER STACK | SLOT ROW | 0.90 × 0.80 × 2.30 | 700 | 1 |
| 26 | `lotto_blower` | THE DRAW (lotto blower) | ARCADE SUMP | 1.20 × 0.90 × 1.85 | 1,500 incl. balls | 1 |
| 27 | `shell_game` | THE PEA (shell game automaton) | DEVIL'S PARLOUR | 1.20 × 0.80 × 2.00 | 1,000 incl. automaton | 1 |
| 28 | `coin_flip` | HEADS OR TAILS (coin-flip booth) | DEVIL'S PARLOUR | 0.90 × 0.80 × 2.10 | 700 | 1 |
| 29 | `devils_table` | THE DEVIL'S TABLE (revolver roulette) | DEVIL'S PARLOUR | 2.40 × 2.00 × 1.80 | 1,400 incl. rig | 1 |
| 30 | `fortune_teller` | MADAME OMEN (fortune automaton) | DEVIL'S PARLOUR | 1.00 × 0.80 × 2.25 | 1,500 | 1 |
| 31 | `tombola` | THE RAFFLE (tombola drum) | DEVIL'S PARLOUR | 1.40 × 0.90 × 1.50 | 900 | 1 |
| 32 | `dice_tower` | DICE TOWER | DEVIL'S PARLOUR | 1.00 × 0.70 × 1.70 | 900 | 1 |

Machines that should exist more than once take `variant` 0..3 so neighbours never share a colourway.

---

### 5.1 `big_one` — THE BIG ONE (hero 5×3 pattern slot)

- **Silhouette:** a monumental deco cabinet, half cinema organ, half altar. It has a stepped ziggurat top, a 13-ray gold sunburst crown, a vast 5×3 reel window, and a 2 m chrome lever on the right. It sits on the world-owned 4.0 × 4.0 × 0.15 m dais at WELL-01 (GDD §8.6), facing north toward the Mouth (v1.1).
- **Dimensions (y bands):**
  - plinth 0–0.20 (1.80 × 1.40, walnut with a 0.03 brass kick)
  - belly 0.20–0.95
  - deck 0.95–1.05 (protrudes +0.12, sloped 10°)
  - LED strip 1.08–1.18
  - reel window 1.25–1.95
  - top box 1.98–2.55
  - crown 2.55–3.10
- **Parts:**

| Part | Spec |
|---|---|
| `reels[0..4]` | radius 0.55, width 0.26, gap 0.02, **16 facets**, axis y 1.60, z = +0.04 (reel front at z 0.59). Strip `texSlotStrip` 32×512. The window frame (1.40 × 0.70) shows 3 full rows plus curved partial rows. |
| `cellFrames[15]` | emissive frame planes 0.26 × 0.21 in front of each cell, for pattern wins. Off / P24 / P33 / P47. |
| `paylineLamps[6]` | triangle lamps, 3 left + 3 right of the window, P20 |
| `lever` | pivot (0.95, 1.20, 0.10), brass drum housing r 0.12 l 0.14. Arm: chrome cylinder r 0.025 l 0.95. Knob: icosa(0.075, 1) in P14. |
| `buttons` | `bet_dn`, `bet_up` (P09, 0.06×0.04), `spin` (P19, 0.12×0.07), `cashout` (P13), `info` (P37) |
| `leds` | `credit` 8 digits, `bet` 3 digits, `win` 8 digits. Red/amber/green 7-seg, scale 2. |
| `screens.top` | 1.40 × 0.40 paytable CRT, 160×48 canvas, scheme amber |
| `bulbs` | 48 on the crown arc + 40 around the reel window = 88, kitBulbRing |
| `medallion` | the JackID coin, r 0.22, 16-seg disc with the `jackid` texture, at the crown centre (0, 2.80, 0.62) |
| `belly` | glass art 1.40 × 0.55, a 64×32 painted texture: the gold coin with a ladder sinking into black and the words "THE BIG ONE" in a painted sign |
| `tray` | 1.20 × 0.18 × 0.12 trough at y 0.30, `coinOut` (0, 0.38, 0.70) |
| side neon | 2 vertical tubes on the front edges, `neon_magenta`, 1.6 m |

- **Materials:** body `enamel_red` (P12 base); trims `gold_trim`; sides `wood_walnut` with brass chevron inlays (3 per side, `brass`); window frame `chrome`. Colourway fixed (hero).
- **Animations:**

| Event | Spec |
|---|---|
| Lever pull | 0 → +1.05 rad in 0.28 s `easeInQuad`; hold 0.05 s; return in 0.45 s `easeOutElastic` (amplitude 0.12 rad) |
| Reel spin | anticipation −0.12 rad in 0.08 s; accelerate to **14 rad/s** in 0.20 s `easeInQuad`; blur strip above 8.4 rad/s |
| Reel stops | reel i stops at t = 0.90 + 0.22·i s. Decelerate to target + 0.06 rad overshoot in 0.18 s, settle 0.12 s `easeOutBack`. Body shake 2 mm per stop. |
| Win | winning cell frames blink 4 Hz for 1.5 s; bulbs CHASE 16/s; coin spray from `coinOut` (§9.1) |
| Jackpot | crown rays light from the centre outward, 13 rays × 60 ms; the medallion spins 2 turns about Y in 1.2 s; then the full lightshow (§9.5) |

- **Lights:** crown (0, 2.9, 0.4) P20, intensity 1.2, range 6, BUZZ. Window (0, 1.6, 1.0) P09, 0.8, range 4, STEADY.
- **Horror twist:**
  - When the curse symbol lands, the window fogs from inside (condensation decal, alpha 0 → 0.6 in 1 s). A palm print (32×32 decal) presses against the glass **from inside**, then fades over 4 s.
  - Rarely (p = 1/90 per second while a player is within 4 m), muffled knocking comes from inside and the glass vibrates ±2 mm for 0.5 s.
  - On the final deadline day, the medallion's ladder slowly rotates 180° to point down.
- **Attract:** bulbs CHASE clockwise at 10/s. Crown rays pulse at 0.25 Hz (±30%). Every 20 s a silent demo spin (1.5 s) lands random symbols.
- **Play pose:** standing on the dais (machine root at dais top y 0.15), pos (0, 1.62, 1.50), target (0, 1.50, 0.45), FOV 58. standPos (0, 0, 1.40). Machine-local; the root sits on the dais top.

### 5.2 `bandit` — ONE-ARMED BANDIT

- **Silhouette:** a 1930s-style cast-metal head on a walnut pedestal (0.40 × 0.40 × 0.78). The head is 0.44 × 0.42 × 0.70 with a rounded top (half-cylinder r 0.22 across the width). Its cast "face" has two eye-shaped vents above the reel window and a **"maw" window** below it, which shows the jackpot coin pile. The long chrome lever sits on the right.
- **Parts:**
  - `reels[0..2]`: r 0.10, width 0.075, **12 facets**, strip 32×384. Window 0.30 × 0.11, one payline.
  - `maw`: window 0.20 × 0.08 with an instanced coin pile (8–30 coins depending on the jackpot size).
  - `coinSlot`: on top, brass plate with a 0.03 × 0.004 slot.
  - `cup`: payout cup bowl, Lathe r 0.05.
  - `lever`: pivot (0.24, 1.18, 0.0) machine-local; arm 0.42 chrome r 0.012; knob icosa(0.035, 1) in P01.
  - `lamp`: reel lamp behind the window.
- **Colourways (variant):**

| Variant | Casting | Face | Knob |
|---|---|---|---|
| 0 | brass | `enamel_red` | P01 |
| 1 | chrome | `enamel_cobalt` | P14 |
| 2 | gunmetal | `enamel_green` | P09 |
| 3 | gold_trim | `enamel_black` | P14 |

- **Animations:**
  - The lever **tracks a mouse drag** (or hold Space) from 0 to 1.1 rad, at a max of 6 rad/s. Release springs back in 0.50 s `easeOutElastic`.
  - Reels start at 70% of the pull and spin ≥ 0.8 s.
  - Stops land L → R at 1.00 / 1.35 / 1.70 s, each a "clack" with 0.04 rad overshoot and 2 mm body shake.
  - Payout: coins drop at 12/s into the cup (pool of 60). Overflow spills to the floor.
- **Lights:** reel lamp P20, intensity 0.5, range 1.2, CANDLE. Reel top and bottom facets get vertex colour × 0.6, so the lighting is uneven.
- **Horror twist:**
  - After 5 losses in a row, the maw's coins slide down and vanish over 1.2 s (swallowed), and the eye vents glow P15 for 2 s.
  - After "midnight" on the wall clock, the lever needs 30% more drag.
- **Attract:** the lamp breathes at 0.3 Hz ±20%. Every U(30, 60) s, one bandit in the row jiggles its lever 0.15 rad, as if touched by no one.
- **Play pose:** standing, pos (0, 1.42, 0.62), target (0, 1.15, 0.0), FOV 50.

### 5.3 `pachislot` — PACHISLOT "HUNGRY LANTERN" (skill-stop)

- **Silhouette:** a narrow, tall box (0.50 × 0.45 × 0.85) mounted on an island counter at 0.95, so the top is at 1.80. It has a gaudy illuminated top panel. The theme is an original lantern festival: red paper lanterns and a long-necked hungry ghost.
- **Parts:**
  - `reels[0..2]`: r 0.085, width 0.065, **21 facets**, strip 32×672. Window 0.24 × 0.15, 3 rows visible.
  - `screens.sub`: CRT 128×96 at the top, scheme amber.
  - `buttons.stop0..2`: round 0.035 dia caps below each reel.
  - `buttons.bet`, `buttons.bet_max`.
  - `startLever`: 0.06 stick + 0.025 ball, left of the stop buttons. Pressed = rotate −0.5 rad about X.
  - `leds.credit`, `leds.payout`: 2 digits each, red.
  - `trays.medals`: deep scoop 0.40 × 0.12.
  - `lamps.side`: 2 vertical strips × 12 LEDs (instanced).
  - `lamps.bonus`: a paper lantern, Lathe 8 seg, r 0.05, h 0.09, `enamel_red`.
- **Materials:** cabinet `enamel_black`. The panel art (64×64) has P43 and P19 lanterns on P01. Chrome edges. Stop caps are emissive P38 while their reel spins and P35 once stopped.
- **Animations:**
  - Start lever: down 0.10 s, up 0.15 s.
  - Reels spin at a constant **8.4 rad/s (80 rpm)**.
  - Stop: the reel halts within ≤ 4 symbol slips in ≤ 0.19 s (skill window).
  - Bonus primed: the lantern lamp flickers DYING for 2 s, then pops to full (P33 core glow, the one allowed green decor). Side LEDs run RAINBOW at 20 LEDs/s.
- **Lights:** lantern P19, intensity 0.6, range 1.0 (when lit). Sub-screen implicit light.
- **Horror twist:**
  - The sub-screen ghost's 2 px eyes track the player's head position.
  - Missing a skill stop by one symbol plays a 4-frame laugh.
  - During bonus, the ghost's neck stretches off-screen and only its mouth fills the CRT.
- **Attract:** CRT loop (lantern sway, 6 frames at 4 fps). Side LEDs breathe 0.5 Hz. Every 45 s the ghost peeks in from the screen edge.
- **Play pose:** seated on a stool (seat 0.68), pos (0, 1.30, 0.55), target (0, 1.28, 0.05), FOV 50.

### 5.4 `video_poker` — VIDEO POKER (Jacks or Better)

- **Silhouette:** a slant-top (kitCabinetShell `h:1.40`) with a 0.48 × 0.36 CRT tilted back 25°, a top box carrying a neon "JACKS OR BETTER" sign, and a wide button deck.
- **Parts:**
  - `screen`: canvas 160×120, scheme cyan. Paytable y 0–55 (9 rows of micro font, 6 px pitch, 5 bet columns). Cards y 60–107 (5 × 32×48 from the atlas, no gaps). Status line y 110–119 (CREDIT / BET / WIN).
  - `buttons.hold0..4`: 0.06 × 0.04 in P09, lit P19 when held.
  - `buttons.deal`: 0.08 × 0.05, P19.
  - `buttons.bet_up`, `buttons.bet_max`, `buttons.cashout` (P13).
  - Sign: `kitMarquee` with `neon_cyan`.
- **Colourways:**

| Variant | Cabinet |
|---|---|
| 0 | `enamel_cobalt` + chrome |
| 1 | `enamel_black` + gold_trim |
| 2 | `enamel_cream` + brass |
| 3 | `enamel_red` + chrome |

- **Animations:**
  - Deal: cards flip in L → R every 0.08 s. The flip is a 2-frame squash: width 32 → 16 → 0 px with the back, then 0 → 16 → 32 px with the face.
  - Draw: non-held cards are replaced 0.10 s apart.
  - "HELD" label in P19 under held cards.
  - Win: winning cards blink 3 Hz, and the matching paytable row inverts (P38 background).
- **Lights:** CRT implicit light only.
- **Horror twist:**
  - On a royal-flush near-miss (4 to a royal, then a miss), any K on screen turns its portrait head toward the player for 1 s (an alternate court sprite).
  - On 1 deal in 200, a 53rd card (`cursed` back with a grin face) flashes in one slot for one frame.
- **Attract:** "PLAY JACKS OR BETTER" scrolls. A demo hand deals every 8 s.
- **Play pose:** seated (stool 0.68), pos (0, 1.18, 0.62), target (0, 0.98, 0.08), FOV 50.

### 5.5 `roulette` — EUROPEAN ROULETTE

- **Layout:** rect table 2.60 × 1.30, felt at 0.78. The wheel bowl is at the −X end (centre x −0.85), and the betting layout covers x −0.40 … +1.20. The croupier stands at −Z behind the wheel. 4 stools sit on the +Z side.
- **Wheel (dia 0.82):**

| Element | Spec |
|---|---|
| Bowl | Lathe 24 seg, `wood_walnut` outside, ball track ring r 0.37–0.40 inclined 12° inward, P02 |
| Deflectors | 8 chrome rhombus studs (0.02 × 0.01) at 45° steps on the track |
| `rotor` | Lathe 37 seg: pocket floor annulus r 0.24–0.31 with 37 pockets. Separators are 37 chrome boxes 0.004 × 0.012 × 0.07. Number ring = annulus r 0.31–0.36 with `texRouletteRing`. |
| Turret | centre chrome cone r 0.10 h 0.08 + cross handle (4 arms 0.12, ball ends r 0.012) |
| `ball` | icosa(0.009, 1), P09 |
| `dolly` | marker: a brass skull 0.03 wide (icosa + jaw box, 30 tris) placed on the winning number |

- **Felt:** `texRouletteLayout` on a 1.60 × 0.64 plane (1 px = 1 cm).
- **Animations:**
  - Rotor: ω₀ = 2.4 rad/s, exponential decay k = 0.06/s. In attract it always turns at 0.3 rad/s.
  - Ball launch: opposite direction, ω_b = 11·e^(−0.35t) rad/s along r 0.385.
  - When ω_b < 3.2 rad/s, the ball drops: it spirals from r 0.385 to 0.335 over 0.6 s (`easeInQuad`). With 50% chance it hits a deflector and hops 0.02 m.
  - Then 2–5 pocket bounces (hop 0.008–0.015 m, 0.12–0.20 s each).
  - The last bounce is **steered** into the host-chosen pocket (the rotor angle is known).
  - Total spin 8–11 s. The croupier waves "no more bets" at t = 5 s.
  - Optional "wheel cam" for the last 3 s: pos wheel + (0, 0.9, 0.25), looking at the wheel centre.
- **Lights:** green-glass pendant lamp at (0, 2.2, 0): P20, intensity 1.4, range 4.5, BUZZ, with a light cone.
- **Horror twist:**
  - The skull dolly's jaw clacks once when placed.
  - On a 0 result, a shadow passes over the table (felt vertex tint × 0.7 for 0.5 s) and every light in the Felt Hall dips −40% for 0.5 s.
- **Attract:** every U(60, 90) s the croupier spins the wheel and flicks the ball for nobody.
- **Play pose:** per seat, from the table-seat class. Hold RMB for the wheel look: target the wheel centre, FOV 50.

### 5.6 `blackjack` — BLACKJACK

- **Layout:** half-moon table 2.10 × 1.10 (`kitTable shape:'half'`), felt `felt_green` + `texBlackjackFelt`.
  - 5 player spots on an arc of radius 0.70 around the dealer-side centre (0, 0.78, −0.45), spread over ±60°.
  - Betting circles: ring r 0.06 in P09.
  - Arc text in micro font: "BLACKJACK PAYS 3 TO 2" (P23), "DEALER MUST DRAW TO 16 AND STAND ON ALL 17S" (P09), "INSURANCE PAYS 2 TO 1" (P23).
  - The Turkish felt is pre-rendered from i18n.
- **Props:**
  - `kitCardShoe` at (+0.55, 0.80, −0.35); discard tray at (−0.55, 0.80, −0.35).
  - Chip rack 0.45 × 0.15 (6 tubes × 4 rows of `kitChipStack`).
  - `kitDealer porcelain` at (0, 0, −0.80).
- **Animations:**
  - Card flight: shoe → spot on a Bézier arc (peak +0.06 m) in 0.32 s, then flip 0.18 s. Stagger 0.45 s per card.
  - Hole-card peek: the dealer tilts the card 20° for 0.4 s.
  - Chip push 0.25 s. Collect sweep 0.6 s.
- **Lights:** pendant (0, 2.1, −0.2) P20, intensity 1.3, range 4, BUZZ.
- **Horror twist:**
  - The dealer's jaw clicks once per card it sees (counting).
  - On a player bust, its head tilts 30° and holds 1.5 s.
  - Seat 5 holds a permanent slumped "Regular" (bot LOD, flat cap). Each time the player looks away and back, there is a 1/6 chance it has turned to face them.
- **Attract:** the dealer shuffles (1.2 s riffle) every 25 s.
- **Play pose:** table seat (FOV 58). Hold RMB for the overview: rise to 1.45 and pitch −35°.

### 5.7 `holdem` — TEXAS HOLD'EM (players + bots)

- **Layout:** oval table 2.80 × 1.40, `felt_green` with a P23 1 px racetrack ellipse inset 0.15 m.
  - 5 community-card spots (0.07 × 0.10 outlines in P09).
  - 8 seats. The dealer stands at the far long-side centre (0, 0, −0.95).
  - Dealer button puck: 0.05 dia, P09 with "D" in P01.
- **Bots ("The Regulars"):** seated `kitDealer` bot LOD (420 tris each), with hat + mask-paint variants (§4.9), up to 7.
- **Bot tells** (all stepped at 15 fps):

| Clip | Spec |
|---|---|
| look at cards | lift card corners 15°, 0.6 s |
| think | head tilt + finger tap 3 Hz |
| bet | chips slide 0.25 m, 0.35 s |
| all-in | two-hand shove 0.5 s |
| fold | cards flick to the muck 0.3 s |
| strong-hand tell | eye lamps blink once (0.1 s off) |

- **Pot:** chips gather to the centre on arcs in 0.4 s. Winner payout slides 0.5 s.
- **Lights:** rectangular brass pendant with 3 bulbs at y 2.0: P20, intensity 1.5, range 5. Bot eyes are P19 pinpoints.
- **Horror twist:**
  - An eliminated bot never leaves. It slumps forward onto the rail (head pitch 70° over 0.5 s).
  - Between hands, the slumped bots' heads turn slowly (10°/s) to follow the pot.
- **Attract:** with no humans seated, the bots play silent fast hands (one every 10 s, card and chip animations only).
- **Play pose:** seat + (0, 1.12, 0), target the table centre (0, 0.80, 0), FOV 60. RMB "peek": pitch down to your own hole cards, which lift 25°.

### 5.8 `baccarat` — BACCARAT (midi)

- **Layout:** kidney table 2.40 × 1.20, `felt_red`, 7 seats.
  - Each seat has 3 boxes: PLAYER (P37 outline), BANKER (P14), TIE (P23).
  - Dealer area: two large card boxes "PLAYER" / "BANKER".
- **Scoreboard:** an LED dot board 0.50 × 0.30 on a 1.60 m chrome pole at the table's +X end. Canvas 48×24 (24 × 12 dots, 2 px pitch). Red (banker) and blue (P37, player) result dots show the history.
- **Dealer:** `porcelain`, with a walnut paddle (0.60 long, blade 0.08 × 0.05) that slides cards in 0.5 s.
- **Card squeeze:** the squeezed card is a 4×1-segment strip. Its vertices bend up to 25° along the length over 1.5 s, revealing the face edge row by row.
- **Lights:** chandelier ring (6 bulbs, r 0.35) at y 2.3: P19, intensity 1.2, range 4.5, CANDLE.
- **Horror twist:** when the player's bankroll is < 25% of their debt, the scoreboard dots briefly (1 s) form a grinning face (fixed 24×12 bitmap).
- **Attract:** the board scrolls its history. Every 30 s the dealer squeezes a card for no one.
- **Play pose:** table seat, FOV 58.

### 5.9 `craps` — CRAPS (hero table)

- **Layout:** tub table 3.20 × 1.50, rail top 0.92, felt at 0.64 (tub depth 0.28).
  - Inner tub walls: a rubber "pyramid" texture 16×16 (2 rows of P01/P03 studs) on the far wall.
  - Rail: `leather_black` with 2 chip grooves (0.04 wide, 0.015 deep).
- **Felt:** `texCrapsLayout` 192×96 on 2.88 × 1.24 (1 px = 1.5 cm), mirrored left/right with the proposition box in the centre. Sections:
  - PASS LINE band, DON'T PASS BAR, COME, FIELD (2 3 4 9 10 11 12)
  - place boxes 4 5 SIX 8 NINE 10, BIG 6 / BIG 8
  - proposition box with hardway dice pictograms (3×3 mini dice), ANY SEVEN, ANY CRAPS
- **Props:**
  - Puck 0.07 dia: OFF side P01 with "OFF" in P09; ON side P09 with "ON" in P01.
  - Stickman automaton (`porcelain`) with a 1.2 m walnut stick. **Its hook end is a bone-white mannequin finger** (2-segment, 0.08 m).
  - Dice: `craps` style, 0.019 m.
- **Throw:**
  - Hold LMB to charge power 0.2–1.0 (shown on the viewmodel hand shake). Throw speed 2.5–5.5 m/s, aim ±15° yaw.
  - The dice must hit the back wall.
  - **Outcome steering:** pre-simulate the seeded throw, find the resting top face, then remap the die's face UVs before launch so the predetermined result ends on top.
  - Physics: restitution 0.45, friction 0.3, angular damping 0.4/s.
- **Stickman:** returns the dice in 0.8 s.
- **Lights:** 2 pendant lamps at x ±0.8, y 2.1: P20, intensity 1.2, range 4, BUZZ.
- **Horror twist:** on a seven-out, the stickman's head rotates a full 360° in 0.6 s (9 steps at 15 fps) while both lamps dip to 30%.
- **Attract:** every U(90, 150) s the dice roll across the felt by themselves (a ghost roll), and the stickman retrieves them.
- **Play pose:** standing at a rail spot, pos (spot.x, 1.55, spot.z + 0.15), target (0, 0.70, −0.2), FOV 62.

### 5.10 `sic_bo` — SIC BO BIRDCAGE (chuck-a-luck)

- **Layout:** table 1.80 × 1.00 × 0.80 with `texSicBoLayout` 128×80: SMALL 4–10, BIG 11–17, totals 4–17, triples, doubles, singles 1–6 as dice pictograms.
- **Cage:** an hourglass of two wire cones, 0.55 tall, max r 0.18, waist r 0.04.
  - 12 vertical wires (boxes 0.004²) and 3 hoop rings (torus 8 × 3) in brass.
  - Axle along X at y 1.20 between two brass posts (r 0.025).
  - `kitCrank` on the right.
  - Contains 3 `sicbo` dice (0.040).
- **Animations:**
  - Flip: 180° about X in 0.6 s `easeInOutQuad`, 2–3 half-turns, with the crank turning in sync.
  - The dice tumble with random spin and settle at the bottom in 0.8 s (result-steered by UV remap, as in craps).
- **Lights:** bulb in the stand base under-lights the dice: P20, intensity 0.5, range 1.2.
- **Horror twist:** while a curse is active, a 4th die of bone (`bone` style, **all faces blank**) appears in the cage. It swaps places with one real die on the next flip.
- **Attract:** the cage rocks ±15° every 20 s.
- **Play pose:** standing, pos (0, 1.55, 0.75), target (0, 1.00, 0), FOV 58.

### 5.11 `money_wheel` — THE GREAT WHEEL (Big Six)

- **Silhouette:** a vertical wheel, dia 1.80, hub at y 1.75, on a walnut column (0.80 × 0.50 pedestal). A separate betting table (1.60 × 0.70 × 0.85) stands 0.6 m in front. Total height 2.90.
- **Wheel:**
  - 54 wedge segments (r 0.55–0.86, 2 tris each) with labels from `texMoneyWheelAtlas`.
  - Counts: 24 × "1", 15 × "2", 7 × "5", 4 × "10", 2 × "20", 1 × JACKID, 1 × HOUSE (grin). Total 54.
  - Segment colours follow the atlas.
  - Inner disc: P01 with a brass sunburst hub r 0.12 (16 rays).
  - Rim: walnut ring r 0.86–0.90.
  - 54 brass pegs (instanced 6-seg cylinders r 0.006 l 0.04) at r 0.88.
  - 27 rim bulbs (one every other segment).
- **Clapper:** a leather-red tongue-shaped flap (0.10 × 0.03, 4-vertex strip) pivoting at the top (y = hub + 0.95). It deflects −25° per peg and springs back in 0.06 s.
- **Betting table:** 7 squares matching the labels.
- **Animations:**
  - The dealer (`porcelain`, standing at the wheel's right) yanks a handle peg.
  - ω₀ = 4.5–6.0 rad/s, decay `ω' = −(0.35 + 0.02ω)` rad/s², 10–14 s total.
  - The final 2 s tick slowly. The wheel stops with a −0.03 rad rock-back.
  - ω₀ is solved analytically so the wheel lands on the host-picked segment.
- **Lights:** ceiling spot at (0, 3.4, 1.2): P20, intensity 1.5, range 5. Rim bulbs CHASE.
- **Horror twist:** on a HOUSE result, the hub sunburst splits (2 half-discs slide apart 0.06 m) to reveal an eye (32×32, P09/P47 iris). The eye's pupil tracks the player for 3 s.
- **Attract:** the wheel turns slowly backwards at −0.1 rad/s. Rim bulbs CHASE.
- **Play pose:** standing at the betting table, pos (0, 1.55, 1.20), target (0, 1.60, 0), FOV 60.

### 5.12 `pachinko` — PACHINKO "HELL'S GATE"

- **Silhouette:** a vertical machine 0.52 × 0.30 × 0.86 set into a wall unit (bottom at y 0.72, top 1.58), behind glass. A ball tray and a round shooter knob sit at the bottom right.
- **Playfield:**
  - Board tilted 10° back. Art texture 64×96: lanterns and teal water on P01.
  - ~120 brass nails (instanced 4-seg cylinders r 0.0015 l 0.02).
  - 3 `tulips` (each 2 petal planes that open 35°).
  - 2 `windmills` (4 vanes, r 0.02).
  - `startPocket` with a mini CRT 64×48 (scheme red) above it.
  - `gate` ("attacker"): a 0.08 × 0.02 hinged plate that opens to 60°. **It has a row of white triangle teeth.**
- **Balls:** chrome, r 0.0055, icosa(0) with env chrome. Instanced, ≤ 64 live.
- **Physics:**
  - 2D in the board plane. Gravity 9.81·cos(10°).
  - Circle-circle collisions (nail r 0.0015 + ball r 0.0055), restitution 0.55.
  - Launch along the left rail at 1.8–3.2 m/s, set by knob rotation 0 → −2.4 rad.
  - Fire rate 100 balls/min.
- **Fever:** frame LEDs STROBE 6 Hz (reduced: 3 Hz). The gate opens. The mini CRT shows the gate opening and a hand reaching out (8 frames).
- **Lights:** board backlight emissive. LED edge strips in `neon_magenta`.
- **Horror twist:** lost balls fall into a clear side tube and collect in a jar at the bottom of the unit. Over the session the jar fills (visible instances, max 200). Balls older than 2 in-game days turn rust-coloured (instanceColor P17).
- **Attract:** the windmills turn at 1 rad/s. CRT loop.
- **Play pose:** low stool (seat 0.62), pos (0, 1.22, 0.42), target (0, 1.20, 0.0), FOV 52.

### 5.13 `peg_drop` — PEG DROP

- **Silhouette:** an upright wall board, 1.20 × 0.35 × 2.40. Walnut frame, P01 backboard with a faint P41 deco fan print, front glass.
- **Parts:**

| Part | Spec |
|---|---|
| `pegs` | 12 rows in a triangular lattice, pitch 0.08 m (78 pegs), chrome, instanced 6-seg r 0.008 |
| `pucks` | r 0.035 × 0.012, 10-seg cylinder, P09 face + P23 rim. Max 3 live. |
| `chute` | slides on a top rail (x −0.50 … +0.50) via A/D at 0.6 m/s. E / LMB drops. |
| `slots[13]` | bottom slots with painted multiplier plates and colours from the edge inward: P24, P19, P18, P13, P12 … The centre slot is the HOUSE (P40 with the grin). |
| `slotLamps[13]` | small bulbs under the slots |
| Sign | marquee "PEG DROP" in `neon_cyan` |

- **Physics:** 2D, gravity 9.81, peg restitution 0.5, bounce jitter ±0.02 rad. The result can be steered by nudging the jitter on the last 3 rows.
- **Animations:** the landing slot's lamp blinks 4 Hz for 1.5 s.
- **Horror twist:** 6 seeded pegs are **mannequin fingers** (P09 6-seg cylinders with 2 knuckle rings in P08). They twitch ±10° when a puck passes within 0.05 m.
- **Attract:** every 40 s a puck drops silently with no one at the chute.
- **Play pose:** standing, pos (0, 1.62, 1.35), target (0, 1.25, 0), FOV 66.

### 5.14 `coin_pusher` — THE TIDE

- **Silhouette:** a glass-topped cabinet, 1.00 × 1.00 × 1.95, chrome and gold trim, with a P38 LED strip. Inside are a two-tier pusher field and a mirror back (`mirror_dark`).
- **Parts:**
  - `field`: 0.80 × 0.60, at y 0.95.
  - `pusher`: the upper shelf moves z ±0.08 m as a 0.5 Hz sinusoid.
  - `coins`: r 0.0125, h 0.002, **6-seg** cylinders (24 tris), instanced, **cap 220 on the field**.
  - `chutes[5]`: A/D picks one. A coin slides down the chosen chute in 0.4 s.
  - `bonusGate` + `leds.bonus`: 3-digit 7-seg mini lottery.
  - `gutters`: left and right.
  - `drop`: front edge into the win tray, with `coinOut`.
- **Simulation (art fallback):**
  - Coins are discs on a 2D layer grid with simple push and overlap resolution.
  - A coin overhanging the edge by > 50% radius tips: it rotates over the edge in 0.15 s, then falls with gravity.
- **Lights:** interior bulb row (4 bulbs, treated as 1 light): P20, intensity 0.6, range 1.4.
- **Horror twist:** about 12 teeth (6-tri P09 meshes) are buried among the coins and get pushed out too. When coins fall into the side gutters, a dark tongue-like conveyor (P12, uvScroll 0.2 m/s) visibly carries them away, with a gulp.
- **Attract:** the pusher always runs. Every 30 s one coin teeters on the edge and drops into the tray. It is a **free pickup** (interactable for 10 s).
- **Play pose:** standing, pos (0, 1.50, 0.85), target (0, 1.00, 0.05), FOV 55. Lean ±0.25 m.

### 5.15 `keno` — KENO LOUNGE

- **Components:**
  - **Wall board** 2.40 × 1.40 × 0.12 at y 1.0–2.4: `texKenoBoard` 160×96 plus a 7-seg "NEXT GAME" timer.
  - **Blower:** clear globe r 0.30 on a stand, 80 balls (r 0.018, icosa(0), instanced), and a goose-neck tube (0.6 m) up to a 20-slot display rack.
  - **2 kiosks:** `kitCrtMonitor` 0.40 × 0.30 on a 0.50 × 0.45 × 1.20 pedestal with a ticket printer slot.
  - 2 lounge armchairs (P41 velvet).
- **Kiosk screen:** 160×120, 10 × 8 number grid, mouse marking (marked = P19).
- **Draw:** 20 balls, one every 1.2 s. Each ball rises the tube in 0.5 s, then its board lamp flickers on over 0.15 s. Round ≈ 24 s.
- **Lights:** board glow P20 (implicit, intensity 0.5, range 3). Kiosk CRT lights.
- **Horror twist:**
  - On roughly 1 draw in 40, the last number shows "81" for exactly one frame.
  - The armchairs carry body-shaped dents: vertex-displaced seat cushions, with a SUB stain decal.
- **Attract:** the blower balls tumble constantly (random walk inside the sphere, upward jet; 30 Hz updates beyond 6 m). The board shows "NEXT GAME 00:xx".
- **Play pose:** kiosk seated, pos (0, 1.15, 0.60), target the kiosk screen, FOV 50. During the draw the camera aims at the board (auto-pan 0.6 s).

### 5.16 `bingo` — BINGO NOOK

- **Components:**
  - Flashboard 2.00 × 0.80 on the wall, `texBingoBoard`.
  - Caller's desk with a small blower (75 balls) and a `kitDealer caller`.
  - 2 long tables 1.80 × 0.60 with benches.
  - Paper cards (`texBingoCard` on 0.20 × 0.24 planes).
  - Daubers: 6-seg cylinders r 0.02 h 0.11, P43 caps.
- **Daub:** a 6×6 P43 disc stamped on the card canvas, with a 0.1 s dauber press animation.
- **Draw:** one ball every 2.5 s. The caller's head turns to the board. The ball lights on the board with a 0.15 s flicker.
- **Lights:** two caged ceiling bulbs (P20, intensity 0.9, range 4, DYING), plus the flashboard glow.
- **Horror twist:** the other seats hold "Regulars" (bot LOD) who daub **in unison** at 15 fps. When anyone wins, all their heads snap to the winner at once (0.08 s).
- **Attract:** blower tumble. Flashboard random twinkle (each lamp p = 0.05 per 0.1 s).
- **Play pose:** bench seat, pos seat + (0, 1.12, 0), target the card at (seat inward 0.30, 0.78), FOV 55. Free-look ±25° to see the board.

### 5.17 `scratch_vend` — LUCKY PAPER

- **Silhouette:** vending machine 0.80 × 0.60 × 1.85. The glass front displays 6 ticket designs as enlarged 0.12 × 0.18 plaques. There are 6 selection buttons, a coin/bill slot, and a ticket mouth that dispenses a ticket 0.10 m forward in 0.6 s. Below is a scratch shelf (0.80 × 0.20 at y 1.00) with a brass coin on a chain.
- **Ticket designs (32×48 each):**

| Design | Look |
|---|---|
| BONE YARD | P08 field, `tooth` motifs |
| GOLD RUSH HOUR | P23 / P21 |
| CASH CROWN | P41 / P23 |
| WIDOW'S PURSE | P01 / P09 |
| DEVIL'S DOZEN | P12 / P15 |
| MOTH MONEY | P26 / P19 |

  All tickets carry 6–9 scratch panels of 8×8 to 10×10 px. The GDD defines the rules.
- **Scratching:**
  - A dynamic mask canvas at 32×48 px, brush r 2.5 px, following mouse drag.
  - The silver layer is P45 with diagonal P07 hatching every 3 px.
  - Flakes: 2×2 P45 particles, 3 per 4 px of brush travel, falling with gravity, life 0.8 s.
- **Lights:** an interior fluorescent tube, P39, intensity 0.7, range 2, `DYING` profile.
- **Horror twist:** on 1 ticket in 150, one panel reveals hand-scrawled text instead of a symbol. It is either "STOP" (i18n) or the player's own name.
- **Attract:** the tube flickers. The chained coin swings ±6° at 0.4 Hz.
- **Play pose:** standing, pos (0, 1.45, 0.45), target the shelf (0, 1.00, 0.15), FOV 45.

### 5.18 `rat_derby` — RAT DERBY

- **Silhouette:** track table 3.20 × 1.10 × 0.95 with 6 lanes along X (each 0.14 wide, divided by brass rails). A painted grandstand backdrop (3.20 × 0.60) stands behind. The front betting panel has 6 big lane buttons (colour-matched) and a 2-digit 7-seg odds display per lane. A finish wire with a checker flag (8×8 texture) crosses at x +1.40.
- **Racers:** taxidermied rats on wind-up chassis, 60 tris each:
  - Tapered box body (`texFur` 16×16 in P05/P06).
  - Ears (2 tris), a 3-segment tail, red bead eyes (P14 px).
  - A brass wind-up key on the back that turns while they run.
  - Saddle cloth `texRatSilk`: lanes 1–6 in P14 / P37 / P30 / P19 / P42 / P09, each with the lane number.
- **Animations:**
  - Rats advance in hops of 0.03–0.12 m every 0.25 s (hop arc 0.02 m).
  - A race lasts 12–18 s. If the race is close in the last 0.6 m, the visuals run at 0.5× time scale.
  - Photo finish: a 1-frame white flash plus a still of the finish line shown on the backdrop's small CRT.
- **Lights:** a 3-bulb strip over the track, P20, intensity 1.0, range 4. "NEXT RACE" dot-matrix sign.
- **Horror twist:**
  - The losing rat's spring snaps at the end: the key flies off and the rat twitches for 1 s.
  - Every U(60, 120) s, 1–2 live black rats (40 tris, P01) scurry out of a drain grate under the table along a spline at 1.2 m/s and vanish.
- **Attract:** rats twitch in their gates (±0.01 m, random). The "NEXT RACE" sign blinks at 1 Hz.
- **Play pose:** standing, pos (0, 1.65, 1.10), target (0, 0.95, 0), FOV 64.

### 5.19 `crash_elevator` — THE ELEVATOR (crash game)

- **Silhouette:** a glass-fronted miniature elevator shaft (1.20 × 0.80 × 3.40), floor to ceiling. Inside it, a brass cage car (0.30 × 0.30 × 0.40) hangs from a frayed cable. Beside the shaft:
  - a semicircular floor-indicator dial (dia 0.40), `texDialFace`
  - a 5-digit amber 7-seg multiplier with a painted "×" plate
  - a brass **brake lever** (0.60 tall) on a pedestal, the cash-out control
- **Shaft:** concrete walls. Painted multiplier marks: 1.0× at y 0.3, 10× at y 2.9 (log scale). 5 small shaft bulbs every 0.6 m.
- **Animations:**
  - The car's height y = 0.3 + 2.6·log10(m), with m driven by logic.
  - Above 10×, the car exits through the top into darkness and the dial needle over-spins.
  - The cable is 8 segments. Fray strands peel off as m grows: 1 strand at m > 2, 2 at m > 4, 3 at m > 8, each with a spark burst (6 sparks).
  - **Crash:** the cable snaps (20 sparks in P15/P20). The car free-falls 0.5 s (g × 0.6) and slams down: shake 0.02 m, dust puff (12 ASH sprites). The needle drops to 0.
  - **Cash out:** the brake lever pulls in 0.25 s, brake-shoe sparks (6), and the car clamps.
  - Each shaft bulb lights as the car passes it.
- **Lights:** car interior bulb P19, intensity 0.4, range 1.0. Shaft bulbs are emissive only.
- **Horror twist:** a 12-tri mannequin passenger rides inside the car. On every crash it wears the colour of the player with the most debt.
- **Attract:** the car bobs ±0.01 m at the bottom. The cable creaks. The needle trembles ±2°.
- **Play pose:** standing, pos (0, 1.62, 1.30), target (0, 1.70, 0), FOV 66.

### 5.20 `mines` — MINEFIELD

- **Silhouette:** a tilted console table (1.10 × 0.90 × 1.00, top tilted 15° toward the player).
  - A 5×5 grid of brass tile flaps (0.15 × 0.15, gap 0.02) on a P41 velvet bed.
  - A CRT (`kitCrtMonitor`, scheme green) on a stalk shows the multiplier ladder.
  - A "COLLECT" brass lever on the right.
- **Tile flip:** pivot on the back edge, rotation.x 0 → −1.9 rad in 0.25 s `easeOutBack`. Underneath is either:
  - a gold coin (r 0.04, `jackid` texture), which sparkles, or
  - a **bear trap**: two semicircular jaws with 6 teeth each (80 tris, `rusty_metal`) that snap shut in 0.06 s, with a P10 flash for 1 frame and shake 0.01.
- **Lights:** a small hooded lamp over the grid, P20, intensity 0.9, range 2.
- **Horror twist:** sometimes, when a trap snaps, a porcelain mannequin finger (P09) is seen caught in its jaws, as if left by the previous player. No blood.
- **Attract:** one random tile rattles (±0.05 rad, 0.3 s) every 8 s.
- **Play pose:** standing, pos (0, 1.60, 0.70), target (0, 1.00, 0), FOV 55.

### 5.21 `hi_lo` — HI-LO

- **Layout:** a round-cornered rect table, 1.20 × 0.80 × 0.78, `felt_green`.
  - Seated dealer "the Teller" (`porcelain`, seated LOD).
  - A brass easel displays the current card at 3× (0.18 × 0.27 plane, atlas UVs).
  - 2 domed buttons, 0.07 dia: HIGHER (P19, ▲) and LOWER (P37, ▼).
  - A "TAKE" lever.
  - A brass thermometer next to the easel: a glass tube 0.40 tall with 10 marks, P13 liquid column.
- **Animations:**
  - The dealer flips the next card onto the easel in 0.4 s.
  - The thermometer rises 0.04 m per step over 0.3 s.
  - On a loss, the column drains over 0.8 s down a pipe into the table, with a gurgle.
- **Lights:** a green banker's lamp on the table (emissive shade P30), point light P20, intensity 0.8, range 2.
- **Horror twist:** the Teller's dealing hand has 6 fingers. It is subtle and never mentioned.
- **Attract:** the dealer flips cards for itself every 12 s.
- **Play pose:** chair, pos (0, 1.15, 0.80), target (0, 0.95, 0), FOV 55.

### 5.22 `dragon_tiger` — DRAGON & TIGER (casino war)

- **Layout:** a small duel table, 1.60 × 0.90 × 0.78, `felt_teal`. Painted boxes "DRAGON", "TIGER" and "TIE" in the micro font. A seated dealer.
- **Heads:** two carved lacquer heads on posts on the dealer side, at x ±0.45, y 1.05. Each is ~150 tris built from boxes and wedges.
  - Dragon: P13 lacquer, P23 whiskers and horns.
  - Tiger: P19 with P01 stripes (32×32 texture), P09 fangs.
  - Each head has a hinged `jaw` (0.5 rad) and emissive eyes (P19 for the tiger, P14 for the dragon).
- **Animations:**
  - The winning side's jaw opens 0.5 rad in 0.3 s, holds 0.6 s, and closes, with a roar and eye glow.
  - On a tie, both heads turn toward each other (0.4 s).
- **Lights:** pendant P20, intensity 1.2, range 4.
- **Horror twist:** on a tie (war), both heads turn to **the player** instead. Their eyes then follow the player around the hall until the next hand.
- **Attract:** smoke puffs (HALF 16×16 sprites in P04, 4 frames) from both heads' nostrils every 6 s.
- **Play pose:** chair, pos (0, 1.15, 0.75), target (0, 0.90, −0.1), FOV 58.

### 5.23 `claw_crane` — THE GRABBER

- **Silhouette:** cabinet 0.90 × 0.90 × 1.95.
  - Glass play box 0.80³ at y 0.95–1.75.
  - Marquee 0.20 tall with 16 chaser bulbs.
  - Prize chute at the front-left corner: a 0.22 × 0.22 hole with a 0.15 m acrylic guard.
- **Mechanism:**
  - `gantry`: X/Z rails.
  - `claw`: 3 chrome prongs, each 2 segments, on a cable line.
  - `joystick`: ball top r 0.02 on a 0.08 stick, tilt ±0.35 rad.
  - `buttons.drop`: dome 0.06, P14.
- **Prizes (~18):** low-poly plush (40–80 tris each, `texPlush` 16×16 felt, P01 button eyes, X-stitched mouths): pig, rabbit, bear, moth. Plus charm capsules (two-tone half-spheres). The pile rests on a precomputed bumpy heightmap.
- **Animations:**

| Phase | Speed / time |
|---|---|
| Gantry move | 0.25 m/s |
| Drop | 0.30 m/s |
| Close | 0.4 s; prongs to 0.6 rad (weak grip) or 0.9 rad (strong) per logic |
| Lift | 0.30 m/s |
| Return | 0.25 m/s |
| Open | 0.3 s |

  The carried prize sways as a pendulum at 1.1 Hz, damping ratio 0.15.
- **Lights:** two interior lamps (P20 and P43), intensity 0.7, range 1.5.
- **Horror twist:** one prize is a porcelain doll head (`texPorcelainMask`), never grabbable by normal logic. Every time the claw drops, it rotates to face the player. A GDD special event may let it be won as a cursed charm.
- **Attract:** the claw homes, then twitches open and closed every 15 s. Marquee bulbs CHASE.
- **Play pose:** standing, pos (0, 1.55, 0.75), target (0, 1.20, 0), FOV 60. A/D lean ±0.25 m to judge depth.

### 5.24 `light_ring` — HALO

- **Silhouette:** cabinet 1.00 × 0.85 × 2.10. The front face carries a vertical ring of **40 lamps** (r 0.40, centre y 1.30). Each lamp is an 8-tri disc lens of 0.05 dia, instanced.
  - Point-value plates sit outside each lamp.
  - Top lamp: the HALO jackpot lamp (0.08, P24).
  - Bottom lamp: the HOUSE lamp (P47 lens painted with an eye).
  - A 6-digit amber jackpot 7-seg sits inside the ring.
  - A big STOP dome (0.10) on the deck.
- **Animations:**
  - One lit lamp chases at 16 lamps/s (2.5 s per lap). The GDD may ramp the speed.
  - Stop: decelerates over ≤ 2 lamps in 0.3 s. The landed lamp blinks 5 Hz for 1 s.
  - Jackpot: RAINBOW chase for 2 s.
- **Lights:** the lit lamp's colour as a point light, intensity 0.5, range 1.5, moving with the chase (updated at 30 Hz).
- **Horror twist:** once per U(5, 9) minutes, the light runs one lap **backward** while the chase sound plays forward.
- **Attract:** a comet chase at 6 lamps/s with a 4-lamp tail at 75 / 50 / 25 / 12%.
- **Play pose:** standing, pos (0, 1.55, 0.95), target (0, 1.30, 0), FOV 58.

### 5.25 `tower_stack` — TOWER STACK

- **Silhouette:** a tall cabinet, 0.90 × 0.80 × 2.30.
  - LED block grid of **7 columns × 15 rows**, each cell 0.07 × 0.07 (105 instanced quads), in a P01 frame 0.55 × 1.10 at y 0.75–1.85.
  - Prize plaques at row 11 (MINOR, P22) and row 15 (MAJOR, P23).
  - STOP dome 0.12, P19.
  - Painted "sky" cap above row 15.
- **Animations:**
  - The moving row bounces left-right, starting at 6 cells/s (GDD sets the ramp).
  - Overhanging blocks fall down their column (0.25 s per 5 rows), blink twice and vanish.
  - Win: the grid flashes P24 at 3 Hz for 1.5 s.
- **Lights:** grid emissive. One point light P38, intensity 0.5, range 2, at the active row.
- **Horror twist:** a hidden 16th row behind the painted sky sometimes glows faintly through the paint. On reaching MAJOR, the lit cells briefly form an elevator-car shape.
- **Attract:** "STACK" scrolls in blocks, then twinkle rain.
- **Play pose:** standing, pos (0, 1.55, 1.05), target (0, 1.35, 0), FOV 62.

### 5.26 `lotto_blower` — THE DRAW

- **Silhouette:** a brass and walnut base (0.90 × 0.90 × 0.95) with a glass sphere r 0.32 on top (centre y 1.30).
  - 49 balls r 0.022, icosa(0), `texLottoBall`.
  - A goose-neck extraction tube rises from the sphere top and curves down to a 6-slot rack in front.
  - Ticket kiosk on the right: `kitCrtMonitor` with a 7×7 number pick grid.
- **Animations:**
  - The blower runs constantly: balls random-walk with an upward jet (speed 0.5–1.5 m/s, inside the sphere).
  - Draw: one ball every 3 s enters the tube, rises in 0.6 s, and rolls down to its rack slot in 0.5 s.
- **Lights:** under-light in the base, P38, intensity 0.6, range 1.5.
- **Horror twist:** while a curse is active, a 50th ball appears. It is P01 with the number "0" in P47.
- **Attract:** constant tumble (30 Hz beyond 6 m).
- **Play pose:** standing, pos (0, 1.55, 0.95), target (0, 1.20, 0), FOV 55.

### 5.27 `shell_game` — THE PEA

- **Silhouette:** a carnival puppet booth, 1.20 × 0.80 × 2.00.
  - Striped awning: 16×16 texture of P13/P09 stripes, scalloped edge built from triangles.
  - Counter at 0.95.
  - Behind it, the automaton **"The Hands"**: only a porcelain mask on a neck pole and two over-long arms (3 segments, 0.35 each) with 3-joint fingers.
  - 3 brass cups (frustum 8-seg, r 0.035/0.05, h 0.07) on a felt mat.
  - The pea: a sphere r 0.012, P14.
- **Animations:**
  - Shuffle: cups swap pairs along semicircles (radius = half the separation).
  - Swap duration goes from 0.36 s (level 1) to 0.18 s (level 5), with 6–14 swaps.
  - The hands stay glued above the cups they move.
  - Reveal: lift 0.08 m in 0.25 s.
- **Lights:** bare bulb string under the awning (5 bulbs, emissive) plus one point light P20, intensity 0.9, range 2.5, CANDLE.
- **Horror twist:** on a wrong guess, the automaton's mask jaw opens (0.3 s) to show the pea resting on a P15 tongue.
- **Attract:** the pea is juggled from cup to cup in a slow taunting loop. The head follows passing players.
- **Play pose:** standing, pos (0, 1.50, 0.70), target (0, 0.97, 0), FOV 52.

### 5.28 `coin_flip` — HEADS OR TAILS

- **Silhouette:** a booth (0.90 × 0.80 × 2.10).
  - A glass bell jar (`kitGlassDome`, r 0.25, h 0.45) on a P41 velvet cushion.
  - Inside: a mechanical brass thumb (3 segments) and a giant coin (r 0.06, thickness 0.008).
  - Coin heads: an engraving of THE OWNER, in the K portrait style. Coin tails: the pit ladder.
  - Buttons: HEADS (P23) and TAILS (P46), plus a bet dial (rotary, 8 detents).
- **Animations:**
  - The thumb cocks in 0.3 s and flicks.
  - The coin rises 0.22 m in 0.3 s spinning about X at 25 rev/s, then lands in 0.3 s.
  - Settle wobble (Euler's disk): precession over 0.8 s, frequency rising 4 → 18 Hz, amplitude decaying to 0. The predetermined face ends up.
- **Lights:** a jar top bulb, P09, intensity 0.6, range 1.5.
- **Horror twist:** 1 flip in 500 lands **on its edge** and stays up. All booth lights go out for 2 s. The GDD may attach a special outcome.
- **Attract:** every 20 s the thumb taps the inside of the glass twice (tap, tap) from within the jar.
- **Play pose:** standing, pos (0, 1.50, 0.62), target (0, 1.20, 0), FOV 45.

### 5.29 `devils_table` — THE DEVIL'S TABLE (revolver roulette)

- **Silhouette:** a round table (dia 1.10 × 0.74) in `felt_violet` with a P23 rim. It has 2 chairs: the player's, and the Devil's opposite.
  - The Devil: `kitDealer devil`, seated.
  - A candelabra with 3 candles (flame planes, 3 frames at 12 fps).
  - An hourglass (Lathe, 8 seg) and an IOU slip tray.
  - In the centre: a **brass turntable rig** (r 0.15) holding a single-action revolver (160 tris: 6-seg barrel, 6-seg cylinder with a chamber texture, frame box, `wood_walnut` grip, hammer).
- **Presentation rule (non-graphic):**
  - The rig spins the revolver. It stops pointing at a seat, and the rig pulls the trigger.
  - **No wounds and no blood, ever.** A "bang" is a muzzle flash (3-frame sprite) and smoke (HALF sprite rising 2 s).
  - The target sees a **white flash for 2 frames, then black for 1.2 s**, with a tinnitus tone. The target's chair then drops through a trapdoor. The GDD defines the consequence.
- **Animations:**

| Event | Spec |
|---|---|
| Load | bullet inserted, 0.3 s each |
| Cylinder spin | ratchet clicks start at 12/s and decay over 1.5 s |
| Turntable spin | 2–4 s, `easeOutCubic` |
| Hammer cock | 0.2 s |
| Empty click | the Devil laughs (clip `laugh`) |
| Bang | flash + smoke + shake 0.06 m |

- **Lights:** candelabra, 3 × CANDLE in P15/P19, total intensity 0.9, range 3. Overhead lamp P14, intensity 0.5, range 4, SICK.
- **Horror twist:**
  - Anywhere in the parlour, the Devil's eyes track the player. When the player comes within 3 m, it gestures to the empty chair.
  - While a curse is active, its eyes are P47 and its wall shadow decal (SUB) grows horns 2× longer than the model's.
- **Attract:** spins the cylinder idly every 15 s (click × 6). Shuffles IOU slips.
- **Play pose:** chair, pos (0, 1.15, 0.85), target (0, 1.20, −0.40), FOV 55.

### 5.30 `fortune_teller` — MADAME OMEN

- **Silhouette:** a carved walnut base (1.00 × 0.80 × 1.00) with a glass cabinet on top (to 2.25). Six P19 marquee bulbs run along the top, and the dispenser slot is at the front.
  - Inside: a half-body `kitDealer oracle` with a moth-wing headdress and a veil.
  - Her hands hover over a crystal ball (icosa(0.08, 1), `glass` + an inner emissive swirl texture with uvScroll 0.1/s).
  - 5 tarot cards are fanned on the table.
- **Animations (coin in):**
  1. The crystal ball lights 0 → 1 in 0.5 s.
  2. Her head rises 0.1 m. Her hands circle the ball (r 0.05 at 0.8 Hz).
  3. Her head turns to the player. The jaw syncs to synthesized speech syllables.
  4. An omen card (`texTarotCard`, 0.07 × 0.12) slides out of the slot over 0.8 s.
  - Gamble: 3 face-down cards on the counter. The chosen card flips in 0.3 s.
- **Lights:** crystal ball P38 (P47 for bad omens), intensity 0.6, range 1.5.
- **Horror twist:** if the player stares at her for more than 5 s, the glass fogs (decal 0 → 0.5 alpha over 1 s). Her finger then writes one letter from the player's name in the fog (a 5×7 glyph decal that appears stroke by stroke over 1 s).
- **Attract:** her hands hover. The ball swirls. Every 40 s she knocks on the glass 3 times.
- **Play pose:** standing, pos (0, 1.55, 0.70), target (0, 1.45, 0), FOV 52.

### 5.31 `tombola` — THE RAFFLE

- **Silhouette:**
  - Hexagonal wire drum: length 0.60, 0.45 across flats. Brass frame, `wire_mesh` panels (CUTOUT), and a hatch door on one face.
  - A-frame stand with the axle at y 1.10, and `kitCrank` on the right.
  - Next to it: a cork ticket board (0.80 × 0.60) with pinned tickets, and a red ticket-roll dispenser.
- **Tickets:** 60 folded slips, 0.04 × 0.03 (2 tris each), in P09 / P19 / P15.
- **Animations:**
  - The crank turns the drum at 1 rev/s for 3 s while the tickets tumble (tumble sim inside the prism).
  - The drum stops hatch-up over 0.5 s.
  - The viewmodel hand reaches in (0.4 s) and pulls a ticket, which unfolds in 0.3 s to show its enlarged number.
- **Lights:** a hanging bare bulb, P20, intensity 0.8, range 2.5, CANDLE.
- **Horror twist:** some tickets are old IOUs bearing names of previous debtors, dated **in the future**.
- **Attract:** the drum creaks a quarter turn by itself every 30 s.
- **Play pose:** standing, pos (0.25, 1.50, 0.70), target (0, 1.10, 0), FOV 55.

### 5.32 `dice_tower` — DICE TOWER

- **Silhouette:** a table (1.00 × 0.70 × 0.80) carrying a tower shaped like a miniature deco skyscraper.
  - The tower is 0.30 × 0.30 at the base, stepping back to 0.24 at 0.40 and to 0.18 at 0.70. Height 0.90, so the top is at 1.70. Walnut and brass.
  - A funnel on top. 3 internal baffles.
  - A glass slit window up one face shows the dice passing.
  - A rows-of-tiny-windows texture (P19 when lit).
  - Exit door into a felt tray (0.50 × 0.30) with bumper walls.
  - 3 `bone` dice, 0.022.
- **Animations:**
  - Dice fly from the viewmodel hand to the funnel in 0.3 s and clatter inside for 0.9 s (visible at 3 slit positions).
  - The tower lights floor by floor (0.15 s per floor) as they pass.
  - The dice roll out about 0.4 m, bounce off the walls, and settle in 0.6 s. The result is steered by UV remap.
- **Lights:** tower windows emissive. Desk lamp P20, intensity 0.8, range 2.
- **Horror twist:** a small silhouette decal in the top-floor window moves to a different window each time dice drop. While a curse is active, it waves.
- **Attract:** windows twinkle. Every 60 s a single die tumbles out of the door by itself.
- **Play pose:** standing, pos (0, 1.50, 0.75), target (0, 1.05, 0), FOV 55.

---

## 6. ENVIRONMENT — THE PIT (Floor B7)

> **v1.1:** the block-out, footprint, walls and placement table of §6.1 are superseded by GDD §8 (see §0.1). Use §6.1's
> style vocabulary and §6.2–§6.4 / §6.7 as the kit of parts for the GDD layout.

### 6.1 Style & block-out

**Style:** an art-deco grand casino (1929 opulence) sealed underground and left to rot.

| Deco vocabulary | Rot vocabulary |
|---|---|
| fluted columns | water stains |
| sunbursts and fans | peeling wallpaper |
| chevrons | exposed concrete |
| stepped ziggurat setbacks | rust drips |
| brass inlay | failing lights |
| terrazzo with brass dividers | sagging and missing ceiling coffers |
| gold-leaf lettering on black glass | carpet worn through to concrete |
| | BILE mould at wall bases |
| | taped cables |
| | standing water in the sump |

Every room reads first as "luxury" and second as "wrong".

**Footprint and grid:**
- World X ∈ [−20, 20], Z ∈ [−16, 16]. Main floor y = 0. North = −Z.
- Floor is built from 1×1 m tiles merged into 4×4 m chunks (needed for trapdoors and the tessellation rule).
- Perimeter walls are 0.4 m thick.

```
        X=-20               -8  -6          0           6  8                  20
 Z=-16  ┌──────────────────────┬────────────────────────┬───────────────────────┐
        │ FELT HALL (ceil 4.5) │ ATRIUM (ceil 7.0)      │ SLOT ROW (ceil 4.5)   │
        │ [roulette] [blackjk] │      [THE BIG ONE]     │ bandits ×4   scratch  │
        │                      │        (dais)          │ [island: pachislot×3 /│
        │ [hold'em]  [baccarat]│ ║     spawn ▼      ║   │  video poker×3]  halo │
   -8   │ W                    │ ║    ╭────────╮    ║   │ tower_stack           │
        │ H [craps]  [dragon/t]│ ║    │  WELL  │-0.45   │ keno lounge (E wall)  │
        │ E                    │ ║    │ MOUTH  │    ║   │                       │
        │ E [sic bo] [hi-lo]   │ ║    ╰────────╯    ║   │╲╲╲╲ ramp to -0.30 ╲╲╲╲│
    0   │ L                    │                        │ ARCADE SUMP (ceil 4.0)│
    4   ├────[velvet arch]─────┤   JUDGEMENT DAIS       │ pachinko×2   peg drop │
        │ DEVIL'S PARLOUR      │ DEBT TERMINAL + CLOCK  │ pusher  claw   derby  │
    6   │ (ceil 3.2)     │cash ├────────────────────────┤ mines  crash   lotto  │
        │ oracle [DEVIL] │cage │ jukebox  LOBBY hotline ║ bingo nook    drain   │
        │ shell   tombola│     │   vending + pawn ──────╢        beacon         │
        │ dice fire coin │     │      [ELEVATOR]        ║                       │
 Z=+16  └────────────────┴─────┴────────────────────────┴───────────────────────┘
```

| Zone | AABB (X × Z) | Floor y | Ceiling | Floor material |
|---|---|---|---|---|
| ATRIUM (incl. Well and Judgement Dais) | [−6, 6] × [−16, 6] | 0 (Well: −0.45, dais +0.30) | 7.0, coffered | `terrazzo` + P12 carpet runners |
| LOBBY | [−8, 8] × [6, 16] | 0 | 4.0 | `marble`, `texTiles('checker')` by the elevator |
| FELT HALL | [−20, −6] × [−16, 4] | 0 | 4.5 | `carpet_felt` |
| DEVIL'S PARLOUR | [−20, −8] × [4, 16] | 0 | 3.2 | `carpet_parlour` with 1 m walnut plank border |
| SLOT ROW | [6, 20] × [−16, −2] | 0 | 4.5 | `carpet_slots` |
| ARCADE SUMP | [8, 20] × [−2, 16] (ramp Z −2 → 0, slope 8.5°) | −0.30 | 4.0 (pipes at 3.7) | `tile_sump`, `concrete_wet` |

**Walls and openings:**
- FELT|PARLOUR at z = 4 (X −20 → −8), with a velvet-curtained arch 2.4 × 2.6 at x −14.
- PARLOUR|LOBBY at x = −8, solid. The cashier cage backs onto it.
- LOBBY|SUMP at x = 8, with a 2 m opening at z 6.5–8.5. ATRIUM|LOBBY at z = 6 is open (a 6 m deco proscenium arch).
- ATRIUM|FELT and ATRIUM|SLOT are colonnades only, at x = ±6.

**Columns:** at x = ±6 and z = −14, −10, −6, −2, 2 (10 columns), plus 4 in the Felt Hall at (−13, −10), (−13, −4), (13, −12), (13, −6).

**Placement table** (machine roots, world coordinates; yaw 0 = faces +Z):

| id | Position (x, y, z) | Yaw |
|---|---|---|
| big_one | (0, 0.30, −13.0) on dais r 1.6 | 0 |
| debt_terminal | (0, 0.30, 4.2) on Judgement Dais r 2.0 | π |
| wall_clock | (0, 4.40, 4.2), hanging, two faces | — |
| the Mouth (trapdoor) | (0, −0.45, −4.0) at the Well centre | — |
| elevator | (0, 0, 15.8) | π |
| cashier cage | X [−8, −4.5] × Z [9, 15], windows on x = −4.5 at z 10.5 and 13.0 | +π/2 |
| charm vending / pawn window | (7.4, 0, 9.8) / wall x = 8, z 12.5 | −π/2 |
| hotline booth | (5.6, 0, 7.4) | −π/2 |
| jukebox | (−5.6, 0, 7.4) | +π/2 |
| roulette / blackjack | (−15, 0, −12.5) / (−9.5, 0, −12.5) | 0 |
| holdem / baccarat | (−15, 0, −7.0) / (−9.5, 0, −7.5) | 0 |
| craps / dragon_tiger | (−14.5, 0, −1.5) / (−9.5, 0, −2.5) | 0 |
| hi_lo / sic_bo | (−9.0, 0, 1.6) / (−12.5, 0, 2.2) | 0 |
| money_wheel | (−19.2, 0, −4.5) | +π/2 |
| bandit ×4 | z −15.4, x 8.0 / 8.8 / 9.6 / 10.4 | 0 |
| scratch_vend | (12.6, 0, −15.4) | 0 |
| light_ring | (16.8, 0, −15.2) | 0 |
| island A | counter 2.0 × 0.6 at (9.5, 0, −10.0): pachislot ×3 on the south side (yaw 0), video_poker ×3 on the north side (yaw π) | — |
| tower_stack | (19.3, 0, −11.0) | −π/2 |
| keno | board on wall x = 20, z −6; kiosks at (16.5, 0, −6.5) and (16.5, 0, −5.3) | −π/2 |
| pachinko ×2 | (19.7, −0.30, 1.6) and (19.7, −0.30, 2.3) | −π/2 |
| peg_drop | (19.8, −0.30, 5.5) | −π/2 |
| coin_pusher / claw_crane | (15.5, −0.30, 1.8) / (12.0, −0.30, 1.8) | 0 |
| rat_derby / mines | (14.0, −0.30, 7.5) / (10.0, −0.30, 7.5) | 0 |
| crash_elevator | (19.6, −0.30, 10.5) | −π/2 |
| lotto_blower | (10.0, −0.30, 11.5) | 0 |
| bingo (nook origin) | (15.5, −0.30, 13.0) | π |
| devils_table | (−14, 0, 10.5) | 0 |
| fortune_teller / shell_game | (−19.2, 0, 7.5) / (−19.2, 0, 12.5) | +π/2 |
| tombola | (−9.2, 0, 7.5) | −π/2 |
| coin_flip / dice_tower | (−11.0, 0, 15.3) / (−17.0, 0, 15.3) | π |
| fireplace | (−14.0, 0, 15.8) | π |

The level code owns final coordinates. Keep ≥ 1.4 m of clear walkway in front of every `standPos`.

### 6.2 Architecture pieces

| Piece | Spec | Tris |
|---|---|---|
| **Column** | octagonal shaft (8-seg) dia 0.60, ceiling height. Shaft texture: `marble` with 8 vertical P05 flute lines. Brass base: 2 rings, h 0.25, dia 0.75. Capital: 3 stepped tiers of 0.08 (dia 0.70 → 0.80 → 0.90) + 4 sunburst fan reliefs (`texWallpaper fan` motif, brass) on the faces. Rust-streak decal from the capital down 1.5 m. | ~120 |
| **Wall** | 0–0.10: brass kickplate. 0.10–1.20: walnut wainscot (`texWainscot`, panels 0.8 wide). 1.20: 0.08 brass chair rail. 1.28 → ceiling − 0.30: wallpaper (`fan`; `damask` in the parlour). Top 0.30: chevron frieze (32×8 texture, P22/P23 zigzag on P01). | 2 per 1 m tile |
| **Damage decals** | per 10 m of wall: 2–4 from {peel patch 1×1.5, water stain 1×2, crack 1×1, exposed rebar patch 0.6×0.6 with 3 rust bars}. Bottom 0.3 m BILE mould strip in LOBBY and SUMP. | 2 each |
| **Ceiling** | coffered 2×2 m grid: beams 0.30 wide × 0.25 deep, P09 plaster with 1 px P23 trim lines. Coffer centres hold a recessed P41 panel with a 4-ray gold star. 10% of coffers are missing (a black void with 1–3 hanging cables, 8-seg Tube catenary). SUMP: raw slab `concrete` + pipe runs (8-seg cylinders, dia 0.12 and 0.20, `rust` / `rusty_metal`) with valve wheels (torus 8×4 + 4 spokes), every 6 m. | 6 per coffer |
| **Steps (Well, dais)** | 0.15 rise, 0.35 tread, brass nosing 0.03. The Well is a circle r 4.5 with 3 steps down to y −0.45. The dais has 2 steps. | ~200 per ring |
| **Velvet arch** | stepped deco arch 2.4 × 2.6, brass frame. Curtains: 2 panels, each a 1.3 × 2.6 plane with 8 vertical folds (vertex z offset 0.06·sin(x·2π·8/1.3)), `velvet_curtain`, swaying ±0.02 m at 0.15 Hz. | ~100 |
| **Drain & puddles** | sump drain grate r 0.5 (`wire_mesh`, CUTOUT) at (14, −0.30, 5). Puddles: HALF-blend planes with `concrete_wet` env, irregular 12-gon outlines, r 0.6–2.5. Ripple rings (ADD) on drip impact. | 12 each |

### 6.3 Light fixtures

| Fixture | Geometry | Light |
|---|---|---|
| Grand chandelier (Atrium, over the Well at y 5.5) | 3 tiers (r 1.2 / 0.9 / 0.6) of instanced octahedron "crystals" (24 per tier, 0.04, ADD glass) + 12 candle bulbs. 1.5 m chain. **Tier 2 is tilted 8°** (broken). Sways ±1° at 0.1 Hz. | P20, intensity 1.6, range 12, STEADY with a DYING dip every ~30 s |
| Deco sconce | half-disc fan r 0.30 of frosted glass (ADD) in a brass frame at y 2.4, every 4 m of wall | P19, 0.5–0.6, range 3–4, CANDLE |
| Table pendant | `LatheGeometry` cone shade (r 0.25, h 0.20), P30 glass, emissive inner face × 0.4, 1.2 m stem, plus a light cone | P20, 1.2–1.5, range 4–5, BUZZ |
| Hold'em bar lamp | brass bar 1.4 × 0.12 with 3 bulbs | P20, 1.5, range 5 |
| Caged work lamp (sump) | wire-mesh sphere r 0.12 around the bulb, on a conduit | P39, 0.9, range 6, DYING |
| Ceiling neon (slot row) | TubeGeometry r 0.015 (6 radial) following chevron paths 3 m wide, hung at 4.0 | P43 / P38, 0.6–0.8, range 5–6, BUZZ |
| Candle (parlour) | Lathe 6-seg (r 0.012, h 0.15) + 2-frame flame plane | P15, 0.5, range 2.5, CANDLE |
| Fireplace | deco marble surround 1.6 × 1.2. 3 flame planes (16×32, 3 frames at 12 fps, ADD). Ember particles (10, P19, rising 0.3 m/s). | P19, 1.2, range 5, CANDLE |
| Emergency beacon (sump) | dome r 0.08 + 2 rotating ADD beam cones (1 rev/s) at (19.8, 2.8, 15.8) | P14, intensity `0.3 + 0.7·max(0, cos(2πt))`, range 5 |
| EXIT sign | "EXIT" + an arrow **pointing down**, neon P14. The X letter runs DYING. | emissive only |

### 6.4 Signage (all i18n; textures regenerate on locale switch)

| Sign | Spec |
|---|---|
| **JACK·ID** (hero) | `texSignNeon('JACK·ID', PS2P)` 256×32 on a 6.0 × 0.75 plane at (0, 7.0, 1.85) facing north (rotY 180, on the Well→Lobby proscenium, readable from the Mouth), P43 with halo. Letter "I" runs DYING (→ "JACK· D"). |
| Zone signs | gold-leaf on black glass (`texSignPainted`, 128×32 on 1.6 × 0.4): THE TABLES, SLOTS, ARCADE, PRIVATE PARLOUR · MEMBERS ONLY, CASHIER, LIFT, HOTLINE, CURIOSITIES |
| House banner | above the terminal: "THE HOUSE ALWAYS COLLECTS", painted 4.0 × 0.5 |
| Elevator doors | "B7" painted 0.6 tall in P23 |
| Posters (`texPoster` 32×48, 0.6 × 0.9) | "LUCKY? PROVE IT." (P14), "THE OWNER IS WATCHING" (K portrait), "NO REFUNDS · NO EXITS" (P01/P09), "TONIGHT: THE BIG ONE" (P23). 2–3 per zone, some torn (CUTOUT bottom corner). |
| Out-of-service | elevator chain sign, enamel P09 on P14: "OUT OF SERVICE UNTIL PAID IN FULL" |

### 6.5 Trapdoor & shaft (v1.1: every 2 × 2 m plate is a trapdoor, GDD §8.9; "The Mouth" is now a zone name — ignore the 3 × 3 Well trapdoor below, keep the leaf animation and shaft)

- **The Mouth:** 3.0 × 3.0 at the Well centre.
  - 2 leaves of 1.5 × 3.0 × 0.08, hinged on the outer edges (x = ±1.5) and meeting at the centre seam. The top surface is terrazzo.
  - Octagonal brass ring frame (width 0.15) engraved around its edge with "ALL DEBTS ARE PAID BELOW" repeated (`texPlaque` style strip, i18n).
- **Portable trapdoor (`kitTrapdoor`, 2 × 2):** for Versus failures at the player's position.
  - Hide the 2×2 tiles under the player in the floor chunk, then spawn 2 leaves (1 × 2 each) with UV-continuous floor material, hinged at ±1 m.
  - Below goes a shaft box 2 × 2 × 30 (inward faces).
- **Leaf animation:**

| Phase | Spec |
|---|---|
| Unlatch | 0.40 s: leaves vibrate ±3 mm at 20 Hz; 20 dust sprites (P04, 2×2) puff from the seams |
| Open | 0 → 100° (1.745 rad) in 0.35 s `easeInQuad`, 5° bounce at the end |
| Close | 0.9 s `easeInOutCubic`, slam: shake 0.02 m for players within 8 m |

- **Shaft:**
  - 30 m deep, `concrete_wet` with vertical rust-streak decals.
  - Ring lights every 5 m: an emissive P19 strip, plus one point light per ring (only for the faller's client).
  - Fog SHAFT. The bottom is never shown (black after 3.0 s).

### 6.6 Systems props

| Prop | Spec |
|---|---|
| **DEBT TERMINAL** (1.20 × 0.90 × 2.40 at MOUTH-TERM against the north wall — v1.1: no Judgement Dais; adds GDD §10.2 controls: SETTLE lever, OPEN THE FLOOR lever, BELL ROPE at its right, BAIL key, card printer, Ready chain) | • Brass and black-marble alcove with a stepped deco crown. On top, the **House emblem**: a cast brass pediment with an eye (eyelid = a separate half-disc that rotates 0.6 s to open), flanked by 2 vertical `neon_red` tubes 1.2 m.<br>• Front, top to bottom: 10-digit red 7-seg DEBT counter (scale 2, 1.00 × 0.20); amber deadline counter; CRT 0.50 × 0.38 (160×120, scheme amber: DEBT / DEPOSITED / DEADLINE); chrome 12-key keypad (keys 0.035) + 4 function keys; the **deposit mouth**: a 0.30 × 0.03 brass slot with lip mouldings; receipt printer slot.<br>• **Deposit:** coins fly from the viewmodel hand to the slot along 0.25 s arcs at 20 coins/s. The lips pulse (scale.y 1 → 1.4 at 8 Hz, "chewing"). The counter odometer-rolls. A paper receipt curls out 0.15 m over 1.2 s.<br>• **Deadline ≤ 1:** neon switches to DYING; the CRT changes to scheme red.<br>• **Fail:** the CRT shows "FORECLOSED", the emblem's eye opens, and the trapdoor sequence starts (§9.9). |
| **WALL CLOCK** (v1.1: single face Ø 2.4 m, depth 0.30, wall-mounted at MOUTH-CLOCK (0, 4.3, −29.84); the XIII numeral fades in only on Night 8) | • Brass case with 12 sunburst rays (0.25 long), hung from 2 brass rods.<br>• Face: `texClockFace` 64×64 in P09, roman numerals, plus a tiny **XIII** squeezed between XII and I, and a P14 painted wedge marking the deadline sector.<br>• Hands: P01 spade shapes (Extrude 0.01): hour 0.40, minute 0.58. Second hand P14, 0.62, with a counterweight.<br>• The second hand ticks 1/s (0.06 s move + 3° bounce). The GDD maps run time to hand angles.<br>• Horror: on any jackpot, both hands spin backwards one full revolution in 1 s. |
| **ELEVATOR** | • Opening 2.0 × 2.6 in a stepped brass and marble surround (3.2 × 3.6).<br>• Fan transom (2.0 × 0.8) with a floor dial: needle sweeping 180° over 8 labels B7 … B1, G. It rests on B7.<br>• Outer **scissor gate**: 10 diamond cells of instanced brass flat bars (0.02 × 0.005). Opens by collapsing scale.x 1 → 0.15 in 1.2 s.<br>• Car interior 1.8 × 1.8 × 2.5: walnut panels, brass handrail at 0.9, P41 velvet bench, caged bulb, and a brass "car switch" (disc 0.20 with a handle rotating ±60°).<br>• **Locked:** a 12-link chain (torus 0.06) + padlock (box + torus shackle) + out-of-service sign. **Unlock:** the padlock drops (0.4 s fall + bounce) and the chain slithers down over 1.0 s.<br>• **Ascent (ending):** shaft walls `uvScroll` 1.5 m/s; floor labels pass the car window every 4 s; fog lerps to ELEVATOR ASCENT (white) over 20 s. |
| **THE APOTHECARY** (v1.1 reuse of the CURIOSITIES vending model, tonic vendor at LOB-TONIC; 2 rows × 4 coils hold the 8 tonic bottles; GDD §3.8.3) (1.00 × 0.85 × 1.95) | • Glass front, 4 rows × 4 spiral coils (TubeGeometry helix, 4 turns, r 0.04, radial 3, chrome), each holding a charm model (20–40 tris) or a two-tone capsule.<br>• Keypad A–D / 1–4, coin slot, dispense bin with a hinged flap.<br>• Vend: the coil rotates 2π in 0.8 s and the item drops in 0.4 s.<br>• Interior fluorescent P39 BUZZ. |
| **PAWN WINDOW** (in wall x = 8, 1.20 × 1.00 opening at y 1.00) | • 9 vertical brass bars (r 0.012), marble counter, sliding brass tray (0.30 × 0.20, travel 0.2 m in 0.4 s).<br>• Behind the bars: a green banker's lamp, a ledger, and only the **gloved hands** of the pawnbroker automaton (ledger-writing loop at 15 fps, finger tap). |
| **HOTLINE BOOTH** (0.95 × 0.95 × 2.30) | • `enamel_red` lacquer, deco glazing (6 panes per side, CUTOUT frames), "HOTLINE" neon (P43) on top.<br>• Wall-mounted rotary phone: P01 body, 0.21 handset, chrome finger-stop dial with a 10-hole texture, coiled cord (helix Tube, 20 seg).<br>• Directory book on a chain. Interior light P39.<br>• **Ring:** cadence 1.0 s on / 0.7 s off for 10 s (GDD §5.1; v1.1). During ring: phone body vibrates ±1.5 mm at 25 Hz, handset rattles ±0.04 rad, booth light follows RING.<br>• **Pickup:** play pose pos (0, 1.62, 0.25), target (0, 1.45, −0.40), FOV 55. The viewmodel handset rises to the ear in 0.4 s. |
| **JUKEBOX** (1.00 × 0.65 × 1.60) | • Arched top (Extrude arch r 0.50).<br>• 6 vertical bubble tubes (16×64 strip, 2×2 dots, uvScroll 0.15 m/s) in P19 / P43 / P38.<br>• Speaker grille (`wire_mesh`), title window with 12 song strips (GDD §6.9) (32×4 each), buttons A–J, coin slot.<br>• Playing: tube colours cycle every 0.5 s; arch chaser LEDs MARCH.<br>• Horror: at in-game 03:00 it plays by itself, and the title strips briefly show debtors' names. |
| **CASHIER CAGE** (3.5 × 6.0 × 2.6 region, X [−8, −4.5] × Z [9, 15], windows face +X) | • Brass bar cage (bars 0.012, every 0.10) on a marble counter at 1.05.<br>• 2 arched teller windows (0.6 × 0.5) with recessed deal trays (0.30 × 0.20).<br>• Behind: `kitDealer cashier`, a money-counter box with a spinning wheel, and a wall of safe-deposit doors (64×64 texture grid, 10 × 8 little doors, 3 ajar).<br>• Gold-leaf "CASHIER" on glass.<br>• Animations: bill count riffle 0.8 s, tray push 0.3 s. |

### 6.7 Dressing props (≤ 300 tris each)

| Prop | Count | Notes |
|---|---|---|
| Velvet rope stanchions | 16 | kit, around the Well rim and parlour entry |
| Overturned casino chairs | 6 | `kitChair` rotated, one per zone |
| Ashtray stands (chrome column 0.65, sand tray) | 10 | 3–6 butts (P09 2-tri sticks) each |
| Dead potted palms | 6 | brass pot + 6 drooping frond planes (16×32, P26/P31, CUTOUT) |
| Cigarette machine (decor, dead) | 1 | lobby, "OUT OF ORDER" card |
| Cash carts (brass, 0.8 × 0.5) | 2 | lobby, chip racks on top |
| Cleaning cart + mop bucket | 1 | sump, puddle beside it |
| Upright piano (walnut, 5 missing keys) | 1 | parlour, plays one note when walked past (p = 0.1) |
| Portrait of THE OWNER (1.0 × 1.4, `texPoster` K variant) | 2 | atrium + parlour. **Eyes follow** the player: 2 eye quads rotate the UV offset ±2 px. |
| Mannequin "regulars" slumped at random machines | 6 | bot LOD rigs, different hats. Never move while seen. |
| Rats (40 tris, P01) | ≤ 4 live | run along wall-base splines at 1.2 m/s, every U(20, 60) s |
| Moths | 3 per light | 4×4 sprite, 2 frames at 12 fps, orbiting lights (r 0.3, 2 rad/s, jitter) |
| Ceiling drips | 4 points | 1 drop every U(0.8, 2.0) s, with a ripple ring on the puddle |
| Floor cables | 6 runs | flat Tube r 0.01, with taped crossings (P07 2×4 cm quads) |
| Paper debris | 30 | IOU slips, betting slips, tickets (2-tri planes, random rotation) |

### 6.8 Lighting per zone

The hemisphere ambient (`uAmbSky`, `uAmbGround`) is given as palette colour × factor.

| Zone | Ambient sky | Ambient ground | Key lights | Mood check |
|---|---|---|---|---|
| ATRIUM | P05 × 0.45 | P12 × 0.35 | chandelier; Big One crown + window; terminal neon P14 (1.0, r 5, BUZZ); 8 column sconces P19 (0.6, r 4, CANDLE); JACK·ID sign P43 (0.8, r 8, BUZZ) | gold pool over the Well, red glow on the terminal, black edges |
| LOBBY | P06 × 0.35 | P03 × 0.30 | elevator caged bulb P20 (0.8, r 4, DYING); 2 banker lamps P20 (0.6, r 2.5); hotline P39 (0.6, r 3, BUZZ/RING); jukebox (cycling, 0.6, r 3); vending P39 (0.7, r 2.5); 2 sconces | shabby hotel at 4 am |
| SLOT ROW | P41 × 0.40 | P40 × 0.30 | 3 magenta neon chevrons P43 (0.8, r 6); 2 cyan neons P38 (0.6, r 5); machine lights | purple haze, cabinets glow |
| FELT HALL | P29 × 0.30 | P25 × 0.30 | one pendant per table (P20 1.2–1.5, r 4–5); 6 sconces P19 (0.5, r 3); wheel spot | isolated pools of light on green felt |
| ARCADE SUMP | P36 × 0.35 | P34 × 0.30 | 4 caged work lights P39 (0.9, r 6, DYING); red beacon; machine lights | cold, wet, flickering |
| DEVIL'S PARLOUR | P12 × 0.30 | P11 × 0.40 | fireplace P19 (1.2, r 5); 6 candles P15 (0.5, r 2.5); Devil's lamp P14 (0.5, r 4, SICK) | firelit, intimate, wrong |
| SHAFT | P00 | P00 | ring lights P19 (0.6, r 4) every 5 m | falling dark |
| MENU | P44 × 0.50 | P00 | window bulbs P20 (1.0, r 5); reel backlights P09 (0.8, r 3); lever lamp P14 (0.4, r 2) | machine guts |

---

## 7. MAIN MENU — INSIDE THE JACKPOT

> **v1.1:** geometry, materials, stations and facet cards below stay; menu entries/flow follow GDD §9.3, the boot shot and
> burst follow the GDD §9.4 timeline, every jackpot landing shows **SUN**, and the MP pre-game lobby is the Lift (GDD §9.5).

### 7.1 Concept & scene layout (`src/menu/JackpotScene.ts`)

- **The fiction:** the camera is coin-sized, inside **THE BIG ONE**, between its front glass and its reels.
  - The menu reels are huge in front of the camera.
  - The cabinet guts surround it: gears, cables, bulb sockets, coin hopper.
  - Through the glass behind the camera is the dim pit.
- The menu interior is literally The Big One at coin scale. That is why the burst-out can cut seamlessly into the real hero machine (§7.5).

**Scene coordinates** (menu-local; camera home at the origin area, looking −Z):

| Element | Spec |
|---|---|
| Interior box | 6.0 W × 4.5 H × 4.0 D (x ±3, y −2.25 … +2.25, z −3.2 … +1.4). Walls `gunmetal` with rivets and `rusty_metal` patches. |
| **Menu reels ×3** | axis X, centres x −1.35 / 0 / +1.35, y 0, z −2.2. Radius 0.87, width 1.20, **12 facets** (0.45 m tall). Card textures (§7.3). |
| Payline window mask | a P01 plate at z −1.25 with 3 openings (1.20 × 0.55) centred on y 0. Brass rails at y ±0.28. Arrow lamps (P20 triangles) at x ±2.05. |
| Bulb ring | 24 bulbs around the window mask (we see their backs: sockets + wires) plus 24 facing us on the mask edge. P20, CHASE in attract. |
| Inner lever crank | at (2.40, −0.90, −1.20): brass arm 0.8 m on a gear (r 0.25). Confirm = +0.6 rad in 0.25 s, return 0.4 s. |
| Decor | 4 rotating gears (r 0.3–0.8, 12–24 teeth as Extrude, 0.2 rad/s, meshing directions), cable bundles (Tube catenaries), coin hopper below (y −2.0) with 200 instanced coins, a dust-mote field (40 ADD sprites P08 at 25%, drift 0.02 m/s). |
| Glass behind the camera | z +1.40: `glass` + the paytable art seen from behind (mirrored "TIPKCAJ" lettering, 1.4 × 0.4). Beyond it, a backdrop plane shows a **one-time 200×112 render of the pit** taken at load from The Big One's front, fogged. |

### 7.2 Camera stations

| Station | Camera pos | Look-at | FOV | Shows |
|---|---|---|---|---|
| HOME (reels) | (0, 0, 0.60) | (0, 0, −2.2) | 60 | the 3 menu reels |
| LEDGER (server browser) | (−1.00, 0.10, −0.40) | (−2.95, 0.20, −0.40) | 55 | a CRT 2.0 × 1.5 on the left wall, canvas 256×192, scheme cyan |
| SERVICE (settings) | (1.00, 0.00, −0.40) | (2.95, 0.00, −0.40) | 55 | an open service panel on the right wall: CRT 1.8 × 1.35 (256×192, scheme green) plus physical toggles/knobs that move with settings |
| MARQUEE (credits) | (0, 0.60, 0.20) | (0, 2.40, −1.20) | 60 | the back of the marquee. Credits print on lit strips that scroll at 12 px/s. |
| HOPPER (profile / mask) | (0, −0.80, 0.20) | (0, −2.00, −0.90) | 55 | a coin-hopper turntable with the 8 avatar masks (§8). The selected mask rotates to the front in 0.4 s. Name plate below. |
| LOBBY ROOM (MP pre-game) | (0, 0, 0.60) | HOME | 60 | the reels become the player list: one facet per player (mask icon + name + READY lamp) |

- Camera moves between stations in **0.55 s `easeInOutCubic`** (position and quaternion). Reels keep idling.
- Idle sway at every station: position + (sin(0.4t)·0.03, sin(0.31t)·0.02, 0), roll ±0.6°.

### 7.3 Menu reels (diegetic menu items)

**Facet card texture: 128×96.**
- Background P09.
- Icon 32×32 at (8, 32), drawn with the §3.6 primitives.
- Label in Press Start 2P 8 px at (48, 36): max 10 characters per line, 2 lines, pitch 12 px. Text P01.
- **Selected** (on the payline of the focused reel): background P13, text P24, icon outline P24.
- **Disabled** (e.g. CONTINUE without a save): text P07 + diagonal P08 hatch.
- Each reel has 12 facets; items repeat to fill them.

| Reel | Items (i18n key → EN / TR) | Icons |
|---|---|---|
| 1 MAIN | `menu.play` PLAY / OYNA · `menu.servers` SERVERS / SUNUCULAR · `menu.profile` PROFILE / PROFİL · `menu.settings` SETTINGS / AYARLAR · `menu.credits` CREDITS / YAPIMCILAR · `menu.guide` GUIDE / REHBER | jackid, CRT+antenna, mask, wrench, moth, key |
| 2 MODE (active when MAIN = PLAY) | DEBT RUN / BORÇ KOŞUSU · CO-OP / ORTAK · VERSUS / KAPIŞMA · FREE CASINO / SERBEST KUMARHANE | IOU slip, 2 masks, grin-vs-grin, chip stack |
| 3 ACTION (depends on MODE) | DEBT RUN: NEW RUN · CONTINUE · SEED. CO-OP / VERSUS: HOST · JOIN · LOCAL TAB. FREE: SOLO · HOST | coin, arrow, dice / key, door, two tabs |

- When reel 2 changes, reel 3 spins one full turn (0.5 s) and its facets are re-textured while it spins ("reload").
- When MAIN ≠ PLAY, reels 2 and 3 idle-spin at 0.4 rad/s with regular slot symbols.

**Controls:**

| Input | Action |
|---|---|
| W / S / mouse wheel | rotate the focused reel one facet (0.18 s `easeOutBack`, 0.04 rad overshoot, tick sound) |
| A / D / ← / → | change reel focus. The focused reel's backlight is 1.0, the others 0.55, and 2 arrow lamps sit above it. |
| Mouse hover / click on the facet above or below the payline | focus that reel and step toward the clicked facet |
| Enter / Space / LMB on the payline | **pull** (inner lever crank animates, clunk) |
| Esc / Backspace | back. Moves the focus left, or returns to HOME from a station. |

### 7.4 Boot shot

| t (s) | Event |
|---|---|
| 0.00 | black. Dot-matrix "PRESS ANY KEY" (P19, `texDotMatrix`) blinks 1 Hz on the centre payline (this key press unlocks WebAudio) |
| key | 24 front bulbs light one by one around the window, 25 ms each (0.6 s), with a relay-click per bulb |
| +0.60 | reel backlights fade 0 → 1 over 0.4 s. The logo is spread across the reels' payline: "JACK" (left) · the `jackid` coin icon (centre) · "ID" (right) |
| +1.50 | the reels spin up (0.3 s) and stop L → R at +2.2 / +2.4 / +2.6 s on PLAY · DEBT RUN · NEW RUN (or CONTINUE if a save exists). Attract CHASE starts. Music starts. |

### 7.5 Burst-out sequence (PLAY confirmed)

| t (s) | Camera | World / FX |
|---|---|---|
| 0.00 | HOME | the inner lever crank pulls (0.25 s) |
| 0.35 | shake 0.01 m | all 3 reels spin up to 9 rad/s in 0.25 s. Bulbs switch to ALL_FLASH 4 Hz. |
| 1.20 / 1.50 / 1.80 | — | reels stop L → R with `easeOutBack` 6° overshoot, each landing the **`sun`** symbol on the payline (GDD §9.4: a full screen of SUN). Clunk + shake 0.008 per stop. |
| 2.00 | flash P10 at 0.7 for 2 frames | JACKPOT: bulbs RAINBOW, the coin hopper erupts (60 coins inside the cabinet), lights in the box pulse ×1.8 |
| 2.40 | dolly back 0.5 m + **yaw 180° in 0.50 s** (`easeInOutCubic`) to face the glass | the pit backdrop is visible through the glass |
| 2.90 | hold, shake rising 0.004 → 0.02 | crack decal (`texCrackGlass`, progress 0 → 1 in 0.30 s) spreads from the centre, with creaks |
| 3.20 | push forward 3 m in 0.25 s (`easeInQuad`), FOV 60 → 75 | the glass shatters: **96-tri radial shard mesh** (12 spokes × 4 rings), velocities +Z 3–6 m/s, spread ±2 m/s, up 0–2 m/s, spin 5–15 rad/s, gravity 9.81. Flash P10 1 frame. Shake 0.08 m decaying over 0.6 s. |
| 3.45 | **CUT on the flash frame** to the real pit: camera at The Big One's glass, world (0, 1.90, −12.30), facing +Z | the real Big One's glass is replaced by the same shard burst; 30 coins spill; glass tinkle |
| 3.45 → 4.25 | arc to (0, 1.62, −10.60) in 0.80 s: hop peak +0.25 m at 40%, `easeOutQuad`; FOV 75 → 62 | shards land on the floor (restitution 0.2) and fade after 2.5 s (SCREENDOOR 0.5 s) |
| 4.25 | landing dip −0.12 m (0.15 s), roll settle ±3° decaying over 0.5 s | — |
| 4.30 | **control handed over** | HUD dithers in (0.4 s). Day banner (§10.6). |

- **Skip:** after the first viewing, any key at t > 0.35 jumps straight to t = 3.45.
- **Multiplayer:** remote players see a joiner burst out of The Big One (shards, 30 coins, and the avatar tumbling out over 0.8 s). The glass restores 2 s later via a SCREENDOOR fade-in (0.5 s).
- **Return to menu** (leave game / after FORECLOSED): fade to black 0.6 s, then HOME with no boot shot. Reels land on PLAY · <last mode>. After a FORECLOSED, the centre facet shows a `grin` for 1 s first.

---

## 8. PLAYER AVATARS ("THE DEBTORS")

### 8.1 Body (≤ 450 tris incl. mask) — v1.1: replaced by the Quaternius mannequin GLB tinted in the player colour (BRIEF Addendum 4); keep §8.2 masks, §8.3 nameplates and the §8.4 timings as clip/emote targets

| Segment | Geometry | Material |
|---|---|---|
| Pelvis | box 0.30 × 0.14 × 0.18, y 0.92–1.06 | trousers P03 |
| Torso | 6-seg tapered prism, 0.36 → 0.28 wide, y 1.06–1.50 | jacket = player colour **one ramp step darker**, armband = full player colour, shirt-front P08 triangle, tie = full player colour |
| Neck | 5-seg cylinder r 0.05 h 0.06 | P08 |
| Head | mask (§8.2) on a P03 hood dome (8 × 3 hemisphere r 0.11) | — |
| Upper arm / forearm | 5-seg cylinders r 0.05 / 0.04, lengths 0.30 / 0.27 | jacket |
| Hands | mitten box 0.08 × 0.10 × 0.03 + thumb box | gloves P09 |
| Thigh / shin | 5-seg r 0.07 / 0.055, lengths 0.45 / 0.43 | P03 |
| Feet | box 0.10 × 0.07 × 0.26 | P01 |
| IOU name tag | 0.06 × 0.04 on the left chest | P09 with the player number 1–8 in micro font, P01 |

Total height 1.75, eye 1.62. Joints are plain hinges (no skinning), animated in code at 15 fps.

### 8.2 Masks & colour variants

- Every mask starts from a shared face shell: a Lathe half-ellipsoid 0.16 W × 0.22 H × 0.10 D (8 × 5 segments, ~70 tris), plus features (≤ 60 tris), plus `texAvatarMask` (32×32).
- The eye holes are dark, with **two 1-px emissive pinpoints in the player colour**. Players are identifiable in the dark.

| # | Mask | Player colour | Features |
|---|---|---|---|
| 1 | HARE | P14 `#C52129` | P09 mask; ears = 2 boxes 0.04 × 0.20 × 0.015 tilted ±12°, the left one bent 40° at 60% length; P14 inner ears; P15 2×2 nose; whiskers 3 px P01 |
| 2 | FOX | P19 `#E69431` | P19 mask with a P09 muzzle and cheeks; snout = 4-sided pyramid 0.08; triangle ears 0.07 with P01 tips |
| 3 | MOTH | P20 `#FFCE5A` | P08 fuzzy mask; feathery antennae (2 CUTOUT planes 8×16 texture, 0.12 long); 2 large P01 eye discs r 0.03 with P20 rims |
| 4 | TOAD | P31 `#8CA53A` | P31 mask, scale.x 1.2; 2 eye domes on top (hemispheres r 0.025, P24 iris, horizontal P01 pupil); wide P01 mouth line |
| 5 | OWL | P38 `#63E6DE` | P08 mask with P38 facial-disc rings; P19 pyramid beak 0.03; 2 triangle ear tufts |
| 6 | CROW | P37 `#3163C5` | P01 glossy mask (env chrome 0.2) with P37 sheen strokes; long 4-sided beak 0.14, P02 |
| 7 | PIG | P43 `#FF42A5` | P15 mask with P43 blush; snout = 6-seg cylinder r 0.03 l 0.03 with 2 P12 nostrils; floppy 2-tri ears |
| 8 | GOAT | P09 `#E6DEC5` | P09 mask; curled horns (Tube, 5 seg, r 0.012 → 0.004, ringed P08/P07); 3-tri P07 beard; painted horizontal pupils |

### 8.3 Nameplates

- **Texture:** Press Start 2P 8 px rendered to 128×16, in the player colour with a 1 px P01 outline, on a transparent background.
- **Sprite:** at head + 0.38 m. World width = (text px / 128) × 0.90 m.
- **On-screen size:** clamped to 8–14 internal px tall.
- **Visibility:** hidden beyond 18 m or when occluded (raycast at 5 Hz, 0.15 s SCREENDOOR fade).
- **Extras:**
  - Host: a 7×7 key icon before the name.
  - Typing: a speech-bubble icon, 8×8.
  - Versus: a 2 px debt bar under the name (P14 fill on P12 background, 40 px wide).
  - Ghosts: name in P39, alpha 50% (screen-door).

### 8.4 Animations (procedural; limbs stepped at 15 fps, root motion smooth)

| Clip | Spec |
|---|---|
| idle | chest bob 0.012 m at 0.5 Hz. Head look-around ±15° every U(3, 6) s. Weight shift ±0.02 m every 8 s. |
| walk (≤ 2.0 m/s) | step frequency f = 0.9 × speed Hz (1.8 Hz at 2 m/s). Thigh ±28°, knee 0–45°, arms ±18° counter-phase, pelvis bob 0.025 m at 2f. |
| sprint (≤ 3.6 m/s) | f = 2.6 Hz, thigh ±40°, arms ±35°, torso lean 10° |
| crouch | pelvis −0.35 m, knees 70°, walk 1.4 Hz at 1.0 m/s |
| sit (stool / chair) | pelvis at seat height + 0.08, thighs horizontal, hands on the deck or table |
| pull lever | right arm reach 0.20 s, pull 0.30 s (synced to the machine lever), release 0.20 s |
| press button | forearm extend 0.12 s, hold 0.05 s, return 0.15 s |
| throw (craps / dice tower) | wind-up 0.25 s, throw 0.15 s |
| phone | right hand to head 0.4 s, hold |
| cheer (big win) | both arms up in 0.2 s, 2 pumps at 2 Hz, 1.2 s total |
| despair (big loss) | head drops 0.4 s, hands to mask 0.3 s, hold 1.0 s |
| fall (trapdoor) | legs buckle 0.15 s. Arms flail (shoulders ±80° at 4 Hz). Body spins about its forward axis at 1.5 rad/s and drops at g = 9.81. Despawn after 1.5 s (observers) — victim POV in §9.9. |
| ghost (Versus spectator) | body SCREENDOOR 8/16, tint P39, emissive 0.4. Legs taper (scale 0.5, feet hidden). Floats 0.25 m up, bobbing 0.06 m at 0.5 Hz. 3 afterimages at 0.1 s intervals (SCREENDOOR 4/16). Mask pinpoints P39. Emote "boo": head spins 360° in 0.6 s with a whisper. |
| emotes | wave (1.0 s), point (0.8 s), shrug (0.8 s), knock (3 knocks, 0.9 s). Key binding per the tech spec. |

### 8.5 First-person viewmodel

- **Hands:** the glove at higher detail: 4 two-segment fingers + thumb, ~150 tris per hand. Sleeve in the player's jacket colour.
- **Camera:** viewmodel FOV 50, near 0.01, snap factor 1.0. Right hand at (0.22, −0.20, −0.35) camera-local.
- **Motion:**
  - Bob = head-bob × 1.5.
  - Sway lag 0.08 s on mouselook, max 0.03 m.
- **Idle coin:** while holding money, the right hand holds a 0.025 dia coin. Every 6 s idle it flips the coin up 0.12 m and catches it (0.5 s).
- **Contextual:** the deposit throw arc (Debt Terminal), the phone handset, the scratch coin, the dice handful, the tombola reach.

---

## 9. VFX & JUICE

### 9.1 Coins

- **Mesh:** `CylinderGeometry(0.0125, 0.0125, 0.002, 8)` (32 tris), `gold_trim` + env gold.
- **Pool:** a global InstancedMesh of **256**.
- **Spawn:** at `fx.coinOut`. Velocity in machine space = (U(−0.6, 0.6), U(1.6, 2.8), U(0.4, 1.2)) m/s. Angular velocity U(−20, 20) rad/s per axis.
- **Physics:** gravity 9.81. Floor restitution 0.35, friction 0.6, and the coin lies flat once |v| < 0.1.
- **Lifetime:** 4 s, then a 0.2 s shrink. Clink sound per floor hit, rate-limited to 12/s.
- **Bursts:**

| Win | Coins | Over |
|---|---|---|
| small | 8 | 0.4 s |
| big | 40 | 1.2 s |
| mega | 100 | 2.0 s |
| jackpot | 200 | 3.0 s |

  The cap is the pool; the oldest coins recycle first.

### 9.2 Sparkle & glints

- **Sparkle:** an 8×8 4-point star flip-book (3 frames at 12 fps: 3 px, 5 px, 7 px arms), P10 core with tinted arms, ADD.
  - Life 0.35 s.
  - Spawns at 3/s on gold surfaces during win states, and on bullion and jackpot symbols.
- **Glint sweep:** on a win, a diagonal P10 band 3 px wide sweeps across the winning symbol cell in 0.25 s (UV-scrolled overlay).

### 9.3 Neon behaviour

- **Ignition:** on 60 ms → off 80 ms → on 40 ms → off 150 ms → on, then BUZZ.
- **Failure:** per-letter DYING via `uLetterOn` (§3.9).
- Halo planes share the tube's flicker value.
- A neon tube that dies stays at 8% as a "ghost glow" until it re-ignites (U(2, 8) s).

### 9.4 Chaser bulbs (patterns for `kitBulbRing.chase()`)

| Pattern | Spec |
|---|---|
| CHASE | 1 lit of every 3, steps 0.1 s |
| MARCH | 2 on / 2 off, steps 0.12 s |
| FILL | fill around in 1.0 s, empty in 1.0 s |
| COMET | head + 4-bulb tail at 75 / 50 / 25 / 12% |
| TWINKLE | each bulb toggles with p = 0.15 every 0.1 s |
| ALL_FLASH | all on/off at f Hz (4 Hz default, 8 Hz jackpot; reduced mode ≤ 3 Hz) |
| RAINBOW | colours cycle [P20, P15, P43, P38, P33] shifted per bulb, step 0.08 s |

Lit bulb = colour × 1.0 emissive. Unlit = colour × 0.25 (P21 for yellow bulbs). 2–5% of bulbs per machine are dead (seeded), always unlit.

### 9.5 Jackpot lightshow (pit-wide, 6.0 s, network-synced event)

| t (s) | Event |
|---|---|
| 0.00 | **hitstop 0.12 s** (game time frozen, audio continues). Flash P10 at 0.7 for 2 frames, then P24 at 0.3 for 3 frames. Shake (jackpot row, §9.6). |
| 0.10 | machine bulbs ALL_FLASH 8 Hz for 1.0 s |
| 0.30 | every light in the zone pulses ×1.8, then colours lerp 50% toward P24 for 3.0 s |
| 0.50 | coin fountain (200). Confetti: 120 paper squares 2×2 px in P09 / P15 / P38, falling at 0.6 m/s with flutter (sin 3 Hz, ±0.1 m). |
| 0.50 – 4.50 | HUD "JACKPOT" banner (§10.6) |
| 1.10 – 5.10 | machine bulbs RAINBOW at 12 bulbs/s. Marquee neon → P24. |
| 6.00 | everything restores over 0.8 s |

Remote players within 20 m see the zone light change and the coins. Beyond 20 m, they get a toast only.

### 9.6 Screen shake & flash frames

**Shake.** Offset = A·(1 − t/D)²·noise(25 Hz) on camera x/y, plus roll R·(same envelope). Multiplied by the Screen-shake setting.

| Event | A (m) | Roll (°) | D (s) |
|---|---|---|---|
| reel stop clack | 0.004 | 0.2 | 0.15 |
| small win | 0.006 | 0.3 | 0.25 |
| big win | 0.020 | 0.8 | 0.50 |
| jackpot | 0.050 | 1.5 | 0.80 |
| curse | 0.020 | 1.0 (+ a 3° slow roll drift over 2 s, then back) | 1.00 |
| trapdoor open (victim) | 0.080 | 2.5 | 0.60 |
| trapdoor slam (nearby) | 0.020 | 0.5 | 0.30 |
| revolver bang | 0.060 | 2.0 | 0.50 |
| crash-elevator slam (machine) | 0.015 | 0.6 | 0.40 |
| deadline tick (last day) | 0.005 | 0.2 | 0.20 |
| menu glass shatter | 0.080 | 2.0 | 0.60 |

**Flash frames.** `uFlash` in PASS_PSX, so flashes dither. Frame counts are at 60 fps.

| Event | Colour | Alpha | Frames |
|---|---|---|---|
| big win | P24 | 0.35 | 2 |
| jackpot | P10, then P24 | 0.70, then 0.30 | 2 + 3 |
| curse | P47 | 0.50 | 3 |
| big loss | P14 | 0.25 | 2 |
| bang | P10 | 1.00 | 2, then black 1.2 s |
| trapdoor | P01 | fade to 1.0 over 0.6 s at fall end | — |

**Reduced flashes:** alpha × 0.35, at most 1 flash per 333 ms, and the 1.0-alpha bang becomes 0.35 + a fade.

**Hitstop:** big win 0.06 s, jackpot 0.12 s, bang 0.20 s, curse 0.08 s.

### 9.7 Number pops & counters

- **World pop text** ("+$1,250"): Press Start 2P 8 px rendered to 64×10 on a sprite. It rises 0.4 m over 1.0 s (`easeOutCubic`) and dithers out over the last 0.3 s.
  - Gains: P33. Losses: P14. Debt payments: P24.
- **HUD money roll:** each frame, step by max(1, |Δ|/30). Total ≤ 1.2 s. A tick sound every 2nd digit change.

### 9.8 The curse event (~3.5 s, whenever a curse triggers)

| t (s) | Event |
|---|---|
| 0.00 | the curse symbol lands. Hitstop 0.08 s. |
| 0.05 | flash P47 at 0.5 for 3 frames. Shake (curse row). Post `uTint` = P47 at 0.35, decaying over 2.5 s. Chroma offset 1.5 px for 1.0 s (forced even when CRT is OFF). |
| 0.10 | the zone's lights lerp 40% toward P47 over 0.3 s and switch to SICK for 3 s. The `grin` eyes go emissive 1.0. Violet drip particles (1×2 px, P47, 12 of them) fall from the symbol over 1 s. |
| 0.30 | whisper SFX + subtitle. **Every automaton within 25 m snaps its head to the player** (0.08 s) and holds 2.0 s. Dealer eyes go P47. |
| 0.50 | vignette ×2 for 2.0 s |
| 1.00 – 3.00 | "the House's hand": a 3 × 4 m dark hand-shaped decal (SUB, 64×64 texture) slides across the floor under the player at 1.5 m/s and fades |
| 3.50 | everything restores over 1.0 s |

### 9.9 Trapdoor fall (victim POV, ~3.6 s, then the consequence screen)

| t (s) | Event |
|---|---|
| 0.00 | floor shudder: shake 0.004 m for 0.4 s, creak, 20 seam-dust sprites. Input locked. |
| 0.40 | leaves drop (§6.5). The camera falls: y(t) = y₀ − ½·9.81·t². Pitch goes to −60° (look down into the dark) over 0.3 s, then to **+70° over 0.6 s (looking up at the shrinking square of light)**. Shake (trapdoor row). FOV 62 → 75. |
| 0.40 – 3.00 | fog blends to SHAFT over 1.0 s. Ring lights stream past every 5 m (each a 2-frame ADD streak). At t = 1.6 s, the leaves above close (0.9 s) and the square of light pinches shut. **One coin** falls past the camera, catching the ring light. |
| 3.00 | fade to P01 over 0.6 s (§9.6) |
| 3.60 | consequence screen (GDD), e.g. "FORECLOSED" (§10.6). In Versus: respawn as a ghost at the Well rim with a P39 flash (2 frames) and a whoosh. |

**Observers** see the shudder, the leaves open, the avatar's `fall` clip, and the slam (shake for those within 8 m).

### 9.10 Ambient VFX

| Effect | Spec |
|---|---|
| Smoke / steam | HALF-blend 16×16 sprites, 4 frames at 12 fps, P04/P07, rising 0.2 m/s, life 2 s (ashtrays, Devil's revolver, sump vents) |
| Dust in light cones | 20 ADD 1-px motes per cone, Brownian drift 0.03 m/s |
| Drips | a 1×3 px P39 sprite falling at 9.81, splash = an ADD ripple ring r 0 → 0.15 in 0.3 s |
| Sparks | 1×2 px P15/P20 streaks, gravity 9.81, life 0.4 s, bounce 0.3 |
| Win tiers | small: bulbs CHASE + 8 coins · big: + flash + shake + 40 coins + sparkle · mega: + zone light pulse + 100 coins + banner "BIG WIN" · jackpot: §9.5 |

---

## 10. UI / HUD STYLE

### 10.1 Fonts & text rendering

| Font | Use | Sizes (UI px) |
|---|---|---|
| **Press Start 2P** | headings, numbers, keycaps, labels, big banners | 8, 16, 24 (multiples of 8 only) |
| **VT323** | body text, chat, descriptions, subtitles, server rows | 16, 32 |

- All UI text goes through `uiText(str, font, px, colour, {outline?, shadow?})`.
  1. Render with canvas `fillText` on an offscreen canvas.
  2. **Threshold alpha at 0.5** to a 1-bit mask.
  3. Colour it.
  4. Outline (1 px P01 dilation) and/or shadow (+1, +1, P02).
  5. Cache the bitmap.
- Text is never anti-aliased. DOM text is not used in game.
- Turkish:
  - Fonts load all subsets (latin-ext has Ğ ğ İ ı Ş ş).
  - Upper-casing uses `toLocaleUpperCase('tr-TR')` (i → İ, ı → I).
  - Every text box allows **+35% width** for TR strings and wraps on word boundaries.

### 10.2 Pixel-perfect scaling rules

1. The UI is authored in **UI px on the 1× grid = internal resolution** (400×225 at STANDARD; layouts are anchored, so they adapt to other widths).
2. The UI canvas size is internal × uiScale (PSX 1× or CLEAN 2× → 800×450). All draw calls multiply by uiScale with integer coordinates. PASS_OUT composites it with nearest sampling.
3. Positions are integers. Animations round to whole UI px every frame.
4. Bitmaps scale by integers only (1×, 2×, 3×). Text is never rotated.
5. Icons are authored at 8×8 or 16×16.
6. The UI is drawn after PASS_PSX (no dither on UI), but the CRT pass applies on top of it.
7. Safe margins: 8 UI px.

### 10.3 Colours

| Role | Colour |
|---|---|
| default text | P09 IVORY |
| secondary text | P07 GROUT |
| disabled | P04 ASH |
| money amounts | P24 GOLD_SHINE |
| positive / win | P33 NEON_GREEN |
| debt / negative / danger | P14 SIGNAL_RED |
| warning / timer / selection | P19 AMBER |
| network / focus | P38 CRT_CYAN |
| curse | P47 CURSE_VIOLET |
| panel fill | P01, screen-door 14/16 (or solid P02 on the 1× PSX UI) |

### 10.4 HUD layout (UI px on 400×225) — v1.1: superseded by GDD §10.1 (layout/content); styles below still apply

| Element | Anchor / position | Spec |
|---|---|---|
| Money | top-left (8, 8) | "¢" icon 8×8 + amount, PS2P 8, P24, outlined. A second row (chips / tokens per GDD) at (8, 20). |
| Debt & deadline panel | top-centre, 160 × 28, y 6 | brass-frame panel: "DEBT" label P07 + amount PS2P 8 in P14. Deadline as 7-seg amber digits (`texSevenSeg` scale 1) + unit label VT323 16. Pulses (border P14 at 2 Hz) when the deadline is ≤ 1. |
| Toasts | top-right, x = W − 8 − 168, y 8 | §10.7 |
| Crosshair | centre | §10.5 |
| Interaction prompt | centre x, y = 140 | §10.5 |
| Chat | bottom-left (8, H − 8 − 96) | 200 × 96, VT323 16 (6 lines), names in player colours. Lines fade after 8 s. The input line appears on T. |
| Charms bar | bottom-right | up to 7 slots of 16×16 with 1 px P22 frames, 2 px gaps. A hover/selected slot gets a P19 frame plus a VT323 tooltip above. |
| Play-pose control hints | bottom-centre, y H − 20 | e.g. `[SPACE] SPIN  [Q]/[E] BET  [ESC] LEAVE` with keycap glyphs; dithers in 0.2 s on pose enter |
| Tab scoreboard | centre panel 280 × 160 | columns MASK · NAME · MONEY · DEBT · STATUS · PING; rows 12 px; local row P38 background tint; ghosts P39 |

### 10.5 Crosshair, cursor, prompts

- **Crosshair:** a 2×2 P09 dot with a 1 px P01 outline (4×4 total).
  - Targeting an interactable: 4 corner brackets (3×3 L shapes in P19) animate in from ±9 px to ±5 px over 0.10 s.
  - Occupied by another player: brackets in P14 + "IN USE" (PS2P 8) below.
  - Hidden in play pose.
- **Menu cursor** (pointer unlocked, `cursor: none` on the canvas): a **white glove pointer** 12×14 px (P09 fill, P01 outline, P22 cuff line), hotspot (1, 0).
  - Hover over a clickable: 2-frame finger tap at 4 Hz.
  - Busy: 2-frame hourglass, 8×12.
- **Prompt:** `[E] PLAY  BANDIT`
  - Keycap glyph: 11×11 box (1 px P09 border, P02 fill, 1 px P01 drop shadow) with the PS2P 8 letter centred.
  - Verb in P09. Machine name in P19.
  - Second line VT323 16 in P07: "MIN BET $10" / "IN USE: <name>".
  - Fade 0.12 s in and out.
  - Mouse glyphs: LMB / RMB icons 9×11.
  - Localized verbs ("[E] OYNA").

### 10.6 Panels, buttons, banners

- **Deco frame (9-slice, 24×24 source, slice 6 px):**
  - Outer 1 px P21.
  - A 1 px bevel: P23 top/left, P22 bottom/right.
  - 1 px P01 inner line.
  - **4×4 stepped art-deco corner notches.**
  - Title plaque: a centred tab with PS2P 8 text in P01 on a 2-tone brass gradient (P23 top half, P22 bottom half).
  - Variants: BRASS (default), CYAN (network / server browser: P35/P38), RED (debt warnings: P12/P14), VIOLET (curse: P40/P47).
- **Buttons:** 16 UI px tall, PS2P 8.

| State | Look |
|---|---|
| idle | P02 background, P09 text |
| hover | P22 background, P01 text, blinking "▶" (2 Hz) on the left |
| pressed | P23 background, offset (+1, +1) |
| disabled | P04 text |
| focus (keyboard) | 1 px P38 outline |

- **Big banners** (v1.1: "NIGHT 3", "LAST CALL", "JACKPOT", "BIG WIN", "SHORT", "PAID IN FULL"; formerly DAY / DEADLINE / FORECLOSED):
  - PS2P 24 (8 px × 3), centred at y 70.
  - Letters drop in one by one (0.04 s each, from −12 px with a 2 px bounce).
  - Hold 1.5 s, then **dither-dissolve** out over 0.4 s (16 Bayer threshold steps).
  - Colours: JACKPOT P24 with a P13 shadow plus a wave (sin, 3 px, 2 Hz per letter); FORECLOSED P14 with a P01 shadow; PAID IN FULL P33; DAY n P09.
- **Pause menu:** 3D post brightness 0.5. A centred 160 × 120 deco panel: RESUME, SETTINGS, INVITE (copies the room code; toast on success), LEAVE.
- **Server browser** (Ledger CRT 256×192 in the menu; the same layout in the 2D fallback):
  - Header row PS2P 8 in P38.
  - Rows VT323 16: lock icon 8×8 · ROOM (≤ 16 chars) · HOST · MODE (4-letter tag: DEBT / COOP / VERS / FREE) · PLAYERS "3/8" · PING (P33 < 80 ms, P19 < 160, P14 above) · STATE (LOBBY P33 / LIVE P19).
  - Selected row inverted (P38 background, P34 text).
  - Footer buttons: REFRESH · DIRECT JOIN · HOST · BACK.

### 10.7 Toasts

| Property | Value |
|---|---|
| Size | 168 × 14 (one line VT323 16) or 168 × 22 (two lines) |
| Stack | max 4, gap 2 px, newest on top. Overflow drops the oldest early. |
| Motion | slide in from the right 0.18 s `easeOutCubic`. Hold 3.0 s (important: 5.0 s). Slide out 0.22 s. |
| Anatomy | 3 px left colour bar + 8×8 icon + text, panel fill P01 at 14/16 |

| Type | Bar / icon colour | Example |
|---|---|---|
| INFO | P09 | "Settings saved" |
| WIN | P33 | "+$450 on ROULETTE" |
| MONEY | P24 | "Deposited $2,000" |
| LOSS / DEBT | P14 | "Interest added: $300" |
| CURSE | P47, frame flicker 2 Hz | "The House has noticed you." |
| NET | P38 | "CROW joined the pit" |
| PHONE | P19, icon shakes ±1 px at 12 Hz | "The hotline is ringing…" |

---

## APPENDIX A — Definition of Done for a machine `model.ts`

1. Built only from three.js geometry + `psxMat()` presets + texgen textures. No external assets.
2. Origin at the floor-centre, faces +Z, footprint matches §5.0 within ±5 cm.
3. Within the tris cap (§5.0) and the draw-call cap (§1.11). Static parts merged per material. Repeats instanced.
4. All `parts.*` named per §4.4, with pivots at the origin of each Group. `object.name` set.
5. `anchors.playPose`, `standPos`, `prompt`, `label`, `coinOut` (if it pays out) and ≤ 2 `lights` are present and tested in a scratch scene.
6. `colliders` (≤ 3) and `interact` proxies are present.
7. 4 colourways via `variant` when the machine appears more than once.
8. `setAttract(true)` runs the attract mode listed in §5. `update()` contains cosmetic animation only.
9. The horror twist is implemented or stubbed with a clearly named hook (`parts.fx.twist`), so `index.ts` can trigger it.
10. LOD detail nodes are flagged `userData.lodDetail = true`.
11. `dispose()` frees owned geometries, materials and CanvasTextures.
12. Visual check at STANDARD 400×225 with jitter MEDIUM: the silhouette reads at 6 m, the main controls read at 1 m in the play pose, and nothing important is thinner than 1 internal px at 2 m.

## APPENDIX B — Quick numbers

- Palette: 48 colours, 15-bit snapped. Reserved: P47 (curse), P33 (wins).
- Internal 400×225 · snap grid 200×112 · Bayer 4×4 · 5 bits/channel · 4 lights/mesh · 16 active / 128 registered lights · far 48 m.
- Frame ≤ 70k tris / 300 draw calls / 24 MB textures · hero ≤ 3,500 tris · cabinet ≤ 1,400.
- Glide 0.60 s in / 0.45 s out · burst-out 4.30 s · jackpot show 6.0 s · curse 3.5 s · fall 3.6 s.

