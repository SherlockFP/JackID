# JackID — Third-party assets (all CC0 1.0, verified on the source pages)

All files live under `public/assets/vendor/` and are served at `/assets/vendor/...`.
Original archives are in `vendor-archives/` (git-ignored, not shipped). No attribution is legally
required, but the Credits screen should still thank: Screaming Brain Studios, PhobicPaul,
Kenney (kenney.nl), Quaternius.

| Folder | Source | Contents |
|---|---|---|
| `sbs-horror/128x128/{Brick,Floor,Metal,Misc,Stains,Stone,Wall}/Horror_<Cat>_NN-128x128.png` | Screaming Brain Studios — Horror Texture Pack | 100 seamless horror textures (Stains = transparent overlays) |
| `sbs-tiny2/128x128/{Brick,Dirt,Elements,Metal,Plaster,Stone,Tile,Wood}/<Cat>_NN-128x128.png` | SBS — Tiny Texture Pack 2 | 160 seamless textures |
| `sbs-tiny3/128x128/{Animal,Box,Cloth,Elements,Gem,Grating,Metal,Stone,Terrain,Weave}/<Cat>_NN-128x128.png` | SBS — Tiny Texture Pack 3 | 240 seamless textures (Cloth/Weave → carpet, felt, velvet, curtains) |
| `phobicpaul-lowpoly64/low-poly/*.png` | PhobicPaul — Low-poly 64x64 | 15 true-PSX 64px textures (fabric, metal, wood, gem…) |
| `kenney-casino-audio/Audio/*.ogg` (check exact subfolder) | Kenney — Casino Audio | 54 real SFX: card-fan/place/shove/shuffle/slide, cards-pack-open/take-out, chip-lay, chips-collide/handle/stack, dice-grab/shake/throw, die-throw |
| `quaternius-ual/UAL1_Standard.glb` (7.6 MB) | Quaternius — Universal Animation Library (Standard) | ONE skinned humanoid mesh named `Mannequin` (~13.7k tris, materials `M_Main`, `M_Joints`) + 43 animation clips |

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
