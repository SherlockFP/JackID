## NPC dark other-dimension shader: study and design (read-only, no files changed)

**Bottom line:** Almost every NPC already goes through one material path, `kit.mannequin()`. The shader belongs in `patchLook`, which is already chained onto every lit mannequin body. Per-character looks can then be per-material uniforms, so the program count stays flat. Most of the "dark" look already exists in the `shadow` style (Picker, the spouse's neighbours). The new work is the rim, eyes, shimmer, jitter, a feet fringe, and routing the props that are still uncovered.

### 1. NPC inventory

All of these are skinned mannequins built from one GLB, so they share one material path.

| Renderer | Where | Style or colour | Notes |
|---|---|---|---|
| Dealers (`kit.dealer`, 7 styles, plus Lords via `devil`) | `src/kit/dealer.ts:41-65`, `:138-141`; `src/machines/lordstable/model.ts:93` | plain, porcelain, devil | Lords are the lordstable dealers, `src/world/hollow/underneath.ts:3-5` |
| Pit boss, sitting patrons, rivals, notary | `src/machines/blackjack/model.ts:228`, `pisti`, `sonkart`, `teetotum`, `tavla`, `tallytable/model.ts:78-89` | plain / porcelain | Rivals add accessories on bones (`tallytable/rivals.ts:2`) |
| Patron crowd | `src/world/actors/actorDirector.ts:72`, `src/game/horror/director.ts:163` | plain | Walked over the nav graph |
| The Collector | `actorDirector.ts:16,68` | `collector` (coat via `makeProp('coat_long')`) | Joints gold; main colour 0x12121a (`mannequin.ts:138-141`) |
| Spouse | `src/world/home/index.ts:90` | plain, warm colour 0x5a4a52 | |
| Hall visitors (Listener, Leaner, Picker) | `src/world/home/visitors.ts:38-40,55` | plain / `shadow` | Picker is already `shadow` |
| Cutscene actors | `src/core/cutscene/actors.ts:58` | any | |
| Lobby and remote player avatars | `src/menu/lobbyState.ts:216`, `src/player/avatars.ts:108` | plain | Avatars are other humans, see risk 6 |

I found no separate goon renderer in these files. The mob threads run through the Collector and phone, so confirm whether goons exist as a distinct model.

### 2. Integration point (single)

- `src/kit/mannequin.ts:314-320`, inside `build()`. Each skinned mesh gets `psx({... unique: true})`, then `patchLook(m, …)` if `look.lit`. Every NPC body above passes here.
- `src/kit/mannequinLook.ts:89-115`, `patchLook()`. This already chains `onBeforeCompile` and `customProgramCacheKey`, adds per-material uniforms, a per-vertex fresnel (`vMqRim`, cold 0x8c9cd0 at 0.34 scale, `mannequin.ts:33`), and object-space varyings (`vMqObj`) taken before skinning. Put the new NPC chunk here, or in a sibling `patchNpc()` called from the same line.
- Ghost style (`mannequin.ts:139`) is unlit with opacity 0.5 and skips `patchLook`. It needs an explicit decision (see §5).
- Shader base: `src/core/renderer/psxMaterial.ts`. The VERT is at `:81-195` (snap at `:173-179`, PSX_LIT lighting at `:101-171`, fog at `:193`). FRAG is at `:197-263`. `onBeforeCompile` is at `:339-349`, the program key at `:350`, `clone()` at `:354-373` (it rebuilds without `patchLook`, so never clone these materials).
- Reusable pieces: `GLSL_BAYER` / `psxBayer4` (`psxMaterial.ts:43-46`) for dither discard, `patchShader` (`src/kit/materials.ts:29-50`), `GLSL_FACE` and `headBoxOf` (`mannequinLook.ts:31`, `:55-60`) for eye placement.

### 3. Shader design (GLSL chunk plan)

**Per-material uniforms (unique per character, no recompile):**
- `uNpcRim` (vec3, class colour), `uNpcEye` (vec3), `uNpcFeet` (float, fringe band height in GLB units; `src.height` is at `mannequin.ts:123`).
- `uHeadC` / `uHeadR` already exist from `patchLook`.

**Global uniforms (set once per frame):**
- `uNpcShimmer` (0..1), `uNpcJitter` (0..1), `uNpcT` (`floor(uTime*8)` for shimmer, or `*2` when reduced). Set in `src/core/renderer/psxRenderer.ts` next to `uniforms.uTime.value` (`:215`), reading `settings.calm` and `settings.reduceFlashing` (`src/core/settings.ts:21-22`).

**Vertex:**
```glsl
// after #include <begin_vertex>, pre-skin (rest-pose space, so skinning carries it)
transformed += (npcHash3(floor(position * 48.0) + uNpcT) - 0.5) * 0.004 * uNpcJitter;
vNpcObj = position;
// after #include <project_vertex>
vNpcN = normalize(transformedNormal);   // view space, already skinned (as patchLook does)
vNpcV = -mvPosition.xyz;
```

**Fragment:**
```glsl
// 1. near-black body, faint suit hue kept so silhouettes still differ
diffuseColor.rgb = vec3(0.025, 0.022, 0.03) + diffuseColor.rgb * 0.10;
// 2. shimmer: value noise in object space (sticks to the body), stepped in time
float n = npcNoise(vNpcObj * 14.0 + vec3(0.0, uNpcT * 0.37, 0.0));
diffuseColor.rgb += uNpcRim * step(0.86, n) * 0.18 * uNpcShimmer;
// 3. eyes: two emissive dots at head-box-local (±0.42, 0.14) of the face axis, radius ~0.08
// 4. feet fringe: discard by Bayer where vNpcObj.y < uNpcFeet and noise < band ramp (SCREENDOOR, no sorting)
// 5. rim (before #include <opaque_fragment>, replaces the old uRim term): fresnel, banded to 3 levels
float f = pow(1.0 - abs(dot(normalize(vNpcN), normalize(vNpcV))), 2.2);
f = floor(f * 3.0 + 0.5) / 3.0;
outgoingLight += uNpcRim * f * 1.2;   // not multiplied by lighting, so it reads in dark scenes
```
Fog is applied after this (`psxMaterial.ts:260`), so distant rims fade with the room.

Program key: add an `|npc` suffix in `customProgramCacheKey`. Every character then shares one program per cracks/flags variant.

### 4. Colour classes (all from uniforms)

- House folk (dealers, patrons, pit boss, Lords, rivals): cold cyan `0x6fd8e0` or violet `0x9a6bd6`. Use the existing `RIM_LIGHT` 0x8c9cd0 as a base.
- The Collector and goons: red, `0xc0202a`.
- Spouse: warm amber, `0xd9913a`.
- Visitors: director call. Listener and Leaner could be cold, Picker stays violet.
- Eyes: 1.0 emissive in the class colour, ART_BIBLE §4.9 already asks for pinpoint eyes (`docs/ART_BIBLE.md:1163`).

### 5. Calm and reduced flashing

- Calm (`settings.calm`, `settings.ts:22`): shimmer 0, jitter 0. Keep rim, eyes and darkness, since these are silhouette, not scare.
- Reduced flashing (`settings.ts:21`): shimmer steps at 2 Hz (`uNpcT = floor(uTime*2)`), amplitude ×0.35 to match `fx.ts:52`. Eyes never pulse or blink.
- Ghost (unlit, opacity 0.5): either skip the fringe and keep the rim, or keep it as the one NPC that stays translucent. Decision for the director.

### 6. Cost and compatibility

- Skinning: all new work is pre-skin (`transformed`, `vNpcObj`) or uses post-skin `transformedNormal`, exactly as `patchLook` does. LOD tiers (`mannequin.ts:404-410`) swap geometry only, so the material is unchanged.
- Cost: about 15 ALU per fragment for noise, rim and eyes, plus one Bayer discard in the feet band. No extra draw calls, no extra programs, and no sorting, because SCREENDOOR is opaque-pass. Should be negligible for about 20 skinned figures, but unmeasured (see risks).

### 7. Risks and gaps

1. **Props are not covered.** The Collector's `coat_long`, masks (`mannequin.ts:350`, `mask_porcelain`), hats and `attach()` props come from `makeProp` with their own materials. They stay coloured unless routed through the same patch.
2. **Placeholder** (`mannequin.ts:288-296`) is coloured primitives shown until `ready`. It is cheap to darken by colour, but it is visible on first spawn if the mannequin is not preloaded.
3. **Clone path**: `psxMaterial.ts:354-373` rebuilds without `patchLook`. Nothing I saw clones NPC bodies, but any future clone silently loses the look.
4. **Readability**: a near-black body on a dark pit can vanish. The unlit rim plus eyes must carry the silhouette. Test at low light before tuning.
5. **Doc drift**: `docs/ART_BIBLE.md:78` says no MeshLambert anywhere, and §1.8 (`:268-300`) describes `src/core/psx/PsxMaterial.ts` as a ShaderMaterial. The code is `src/core/renderer/psxMaterial.ts` (MeshLambert + `onBeforeCompile`). Update the art bible before the next art lane.
6. **Remote player avatars** (`src/player/avatars.ts:108`) are other humans. Darkening them may break identity in multiplayer. Recommend exempting them, or darkening only with a player-colour rim.
7. **Per-vertex lighting**: the base is Gouraud (`psxMaterial.ts:8`). The per-pixel fresnel and noise are a deliberate deviation. Banding to 3 levels keeps the PSX read.
8. **Performance** is unmeasured (HANDOFF section 9 and 10.4). Measure F3 before and after.

### 8. Verification plan (not run here)

- `npm run qa -- --world --shots <scratch>` for the pit, and `--walk-view` for the hall. Compare Calm on and off, and reduced flashing on and off.
- Check the Collector and spouse specifically, since they carry the colour classes.

No existing NPC screenshots were found in the repo, so there are no reference paths to cite.