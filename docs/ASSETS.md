# JackID — Third-party assets (CC0 1.0 unless a row says otherwise, verified on the source pages)

All files live under `public/assets/vendor/` and are served at `/assets/vendor/...`.
Original archives are in `vendor-archives/` (git-ignored, not shipped). CC0 packs need no
attribution, but the Credits screen should still thank: Screaming Brain Studios, PhobicPaul,
Kenney (kenney.nl), Quaternius. The Thintel (CC BY 4.0) and Chetyre (OFL) credit lines are
required and are on the Credits screen (EN and TR, `src/menu/menu.strings.ts`).

| Folder | Source | Contents |
|---|---|---|
| `sbs-horror/128x128/{Brick,Floor,Metal,Misc,Stains,Stone,Wall}/Horror_<Cat>_NN-128x128.png` | Screaming Brain Studios — Horror Texture Pack | 100 seamless horror textures (Stains = transparent overlays) |
| `sbs-tiny2/128x128/{Brick,Dirt,Elements,Metal,Plaster,Stone,Tile,Wood}/<Cat>_NN-128x128.png` | SBS — Tiny Texture Pack 2 | 160 seamless textures |
| `sbs-tiny3/128x128/{Animal,Box,Cloth,Elements,Gem,Grating,Metal,Stone,Terrain,Weave}/<Cat>_NN-128x128.png` | SBS — Tiny Texture Pack 3 | 240 seamless textures (Cloth/Weave → carpet, felt, velvet, curtains) |
| `phobicpaul-lowpoly64/low-poly/*.png` | PhobicPaul — Low-poly 64x64 | 15 true-PSX 64px textures (fabric, metal, wood, gem…) |
| `kenney-casino-audio/Audio/*.ogg` (check exact subfolder) | Kenney — Casino Audio | 54 real SFX: card-fan/place/shove/shuffle/slide, cards-pack-open/take-out, chip-lay, chips-collide/handle/stack, dice-grab/shake/throw, die-throw |
| `quaternius-ual/UAL1_Standard.glb` (7.6 MB) | Quaternius — Universal Animation Library (Standard) | ONE skinned humanoid mesh named `Mannequin` (~13.7k tris, materials `M_Main`, `M_Joints`) + 43 animation clips |
| `sbs-synthetic/128x128/{Fabric,Ground,Leather,Metal,Misc,Stone,Tree,Wood}/Synth-<Cat>_NN-128x128.png` (+ `License.txt`) | Screaming Brain Studios — Synthetic Texture Pack, 128x128 files only. https://screamingbrainstudios.itch.io/synthetic-texture-pack — CC0 1.0 | 123 seamless 128px textures (Fabric 15, Ground 15, Leather 15, Metal 15, Misc 18, Stone 15, Tree 15, Wood 15). Use under the usage rules below. |
| `ggbot-public-pixel/PublicPixel.ttf` (+ `License.txt`) | GGBotNet — Public Pixel Font. https://ggbot.itch.io/public-pixel-font — CC0 1.0 | TrueType pixel font, family "Public Pixel". Turkish İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü: all 12 present (cmap check). Not copied: OTF, WOFF, WOFF2 (same font or web-only), Glyphs.pdf, GGBotNet.URL. |
| `hanshuyuri-chetyre/Chetyre-Regular.ttf` (+ `LICENSE.txt` SIL OFL 1.1, `README.md`) | HanshuYuri — Chetyre v1.0. https://hanshuyuri.itch.io/chetyre — SIL Open Font License 1.1 (credit line on Credits screen) | TrueType pixel font, family "Chetyre". Turkish İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü: all 12 present (cmap check). Not copied: OTF, WOFF, WOFF2 (same font or web-only). |
| `skeddles-thintel/Thintel.ttf` (+ `Licence.txt`) | skeddles — Thintel Pixel Font. https://skeddles.itch.io/thintel-pixel-font — CC BY 4.0 (credit line on Credits screen; the licence file asks for a link to http://samkeddy.com/) | TrueType pixel font, family "Thintel Regular". ASCII only: Turkish İ ı Ş ş Ğ ğ Ç ç Ö ö Ü ü are ALL MISSING, so do not use it for Turkish text without a fallback font. Not copied: `thintel.png` (500x500 specimen sheet, not a texture). |
| `duhgless-psx-couch-2/couch.glb`, `Couch.png` (+ `LICENSE-NOTE.txt`) | Duhgless — PSX Style Low-Poly Couch II. https://duhgless.itch.io/psx-style-low-poly-couch-ii — CC0 1.0 (stated on the page; the download has no licence file) | One PSX-style couch: GLB (70 KB) and its 256x256 PNG texture. Not copied: FBX, OBJ, MTL (outside the approved GLB + PNG scope). |
| `gualtierisgg-rpg-furniture-2/FBX/*.fbx` (36 files) + `Texture/Color2.png` (+ `LICENSE-NOTE.txt`) | GualtierisGG — Mini-RPG-Bundle Part 2 (Low Poly Furniture). https://gualtierisgg.itch.io/low-poly-rpg-bundle-low-poly-furniture-part-2 — CC0 1.0 (stated on the page; no licence file in the download) | 36 low-poly furniture and prop FBX models (benches, chairs, stools, table, crates, ingots, Multicolor variants) and the pack's one texture (Color2.png, 128x128). FBX ONLY, not converted: GLTFLoader cannot read FBX, so convert or re-export before use. Not copied: 36 .blend sources, 4 PREVIEW renders. |
| `battleroach-medieval-tavern/<Model>/TI_<Model>.obj` + `.mtl` + `Textures/DefaultMaterial_BaseColor.png` (+ `LICENSE-NOTE.txt`) | BattleRoach — Low_Poly Medieval Tavern Interior. https://battleroach.itch.io/low-poly-m — CC0 1.0 (stated on the page; no licence file in the download) | 8 tavern props (Bar, Barrel, BarrelStand, Bench, Chair, Shelf, Stool, Table) as OBJ + MTL, with 7 base-colour PNGs at 1024x1024. OBJ, not converted. BarrelStand has NO texture: its MTL points at the author's local C: drive path, so it renders untextured. OBJ files total ~11 MB uncompressed. Not copied: the 8 FBX files. |

## Batch 2026-10-19: notes
- Only the seven approved packs were fetched, through itch.io's free name-your-own-price flow at $0 (no payment, no login, no personal data). Archives were kept in the scratch folder, path-checked, and extracted there. Only the files listed above were copied into the project.
- Turkish glyph check: `cmap` tables were read with Node built-ins. Public Pixel and Chetyre pass; Thintel does not.
- No asset is loaded by game code yet. The only game change is the two credit lines in `src/menu/menu.strings.ts`.
- Thintel's licence asks for a link to http://samkeddy.com/; the credit line names the author and licence but has no URL. Add the link if the Credits screen can show one.

## Visual previews
Labelled contact sheets of every texture are in `docs/asset-sheets/<pack>__<Category>.png`
(magenta = transparent). Art/model agents should LOOK at them (Read tool shows images) before
choosing textures — pick by file name.

## Mannequin animation clips (exact names)
A_TPose, Crouch_Fwd_Loop, Crouch_Idle_Loop, Dance_Loop, Death01, Driving_Loop, Fixing_Kneeling,
Hit_Chest, Hit_Head, Idle_Loop, Idle_Talking_Loop, Idle_Torch_Loop, Interact, Jog_Fwd_Loop,
Jump_Land, Jump_Loop, Jump_Start, PickUp_Table, Pistol_Aim_Down, Pistol_Aim_Neutral, Pistol_Aim_Up,
Pistol_Idle_Loop, Pistol_Reload, Pistol_Shoot, Punch_Cross, Punch_Jab, Push_Loop, Roll,
Sitting_Enter, Sitting_Exit, Sitting_Idle_Loop, Sitting_Talking_Loop, Spell_Simple_Enter,
Spell_Simple_Exit, Spell_Simple_Idle_Loop, Spell_Simple_Shoot, Sprint_Loop, Swim_Fwd_Loop,
Swim_Idle_Loop, Sword_Attack, Sword_Idle, Walk_Formal_Loop, Walk_Loop

Use it for: multiplayer player avatars (tinted + procedural masks/hats attached to the head bone),
mannequin dealers/croupiers (Idle_Talking_Loop, Interact, PickUp_Table), seated ghost gamblers /
hired automaton staff (Sitting_*), the Collector (Walk_Formal_Loop, tall-scaled, dark material),
cutscene actors, trapdoor fall (Death01/Hit_*), dance emotes. Load ONCE via GLTFLoader, clone per
instance with `SkeletonUtils.clone` (three/examples/jsm/utils/SkeletonUtils.js), share clips,
convert materials to PSX materials, 1 AnimationMixer per instance, freeze/LOD distant instances.

## Usage rules
- Every vendor texture goes through the PSX texture pipeline at load time: downscale to 64×64 (or
  32×32 for small props) with nearest filtering, optional palette quantize, `NearestFilter`,
  no mipmaps, `SRGBColorSpace`. Procedural canvas textures remain the default for anything
  game-specific (cards, chips, slot symbols, signage, screens, carpets with casino patterns).
- Kenney audio: layer with synthesized SFX (e.g. chip-lay + synth click) and randomize pitch ±8%.
- Never hotlink anything; never add new vendor assets without updating this file.

## Sound packs, 2026-10-19 (sfx-*): licences and credits
Ten approved OpenGameArt packs, vendored into `public/assets/vendor/sfx-<pack-id>/`. Each folder has a
`CREDIT.txt` (plus the author's readme where the pack shipped one). The file-by-file index with
suggested game uses is `public/assets/vendor/SFX_INDEX.md`. Total audio: 98 files, 22.0 MB. Original
archives were kept in the scratch folder, not in the repo, so `vendor-archives/` is not used for these.
Nothing is wired into game code yet.

| Folder | Pack and author | Source | Licence | Vendored |
|---|---|---|---|---|
| `sfx-owlish-more-sfx/` | 202 More Sound Effects, OwlishMedia | https://opengameart.org/content/202-more-sound-effects (MoreSounds.zip) | CC0 1.0 | 19 WAV (phone, money, key/lock/door), 2.0 MB |
| `sfx-laleksic-various/` | Various Sound Effects, laleksic | https://opengameart.org/content/various-sound-effects (sounds_8.zip) | CC0 1.0 | 15 WAV (doors, creaks, locks, bell, coins), 1.8 MB |
| `sfx-rubberduck-metal-wood/` | 100 CC0 wood and metal SFX, rubberduck | https://opengameart.org/node/85875 | CC0 1.0 | 24 OGG (keys, locks, wood, metal), 0.6 MB |
| `sfx-qubodup-doors/` | Door Open / Door Close set, qubodup | https://opengameart.org/content/door-open-door-close-set | CC0 1.0 | 18 OGG (FLAC copies not used), 0.3 MB |
| `sfx-pagdev-elevator-door/` | elevatordoor, PagDev | https://opengameart.org/content/elevatordoor | CC0 1.0 | 1 WAV, 1.2 MB |
| `sfx-starninjas-crowd/` | Crowd shouting/speaking ambience, StarNinjas | https://opengameart.org/content/crowd-shoutingspeaking-ambience | CC0 1.0 | 1 OGG (27 s), 0.3 MB |
| `sfx-chirptone-ringtone/` | Modern Ringtone [Chirptone], Zane Little Music | https://opengameart.org/content/modern-ringtone-chirptone | CC0 1.0 | 1 WAV (2.5 s), 0.8 MB |
| `sfx-quendel-crowd-cheering/` | Free Crowd Cheering Sounds, Gregor Quendel | https://opengameart.org/content/free-crowd-cheering-sounds | **CC BY 4.0** | 8 MP3 (tracks 03 to 10), 7.8 MB |
| `sfx-psychhead-horror-hits/` | Horror Hit Soundpack 1, psychhead_ | https://opengameart.org/content/horror-hit-soundpack-1 | CC0 1.0 | 8 WAV (Bassy, Very Bassy, Mid, High), 7.3 MB |
| `sfx-qubodup-rat/` | Squeaky Rat, qubodup | https://opengameart.org/content/squeaky-rat | CC0 1.0 | 3 OGG (attack, death, pain), 0.02 MB |

**Credit line (CC BY 4.0, required):** "Crowd cheering sounds by Gregor Quendel, CC BY 4.0"
(https://creativecommons.org/licenses/by/4.0/). Shown on the Credits screen in EN and TR
(`src/menu/menu.strings.ts`). Audio is unedited; only the filenames were shortened.

**Not vendored:**
- Dryoma "Footsteps Sounds" (CC BY 4.0): no OpenGameArt page found under that title or author, so no
  credit line exists for it. No footstep files are vendored. The laleksic `floor_creak1-3` files are the
  nearest stand-in (creaks, not steps, and quiet, so they need gain).
- Quendel tracks 01, 02 (near-duplicates of 03) and 11 (full 224 s recording, 9 MB).
- FLAC copies in the doors and rat packs; the rest of the owlish, laleksic and horror-hit sets that fall
  outside the brief (cloth, plastic, kitchen, drink, stationery, camera, velcro, taps, toilet, microwave).
- No page is marked AI-generated. The horror-hit comment thread asks about AI tools and the author says none were used.
