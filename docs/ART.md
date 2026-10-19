# ART.md

Short, enforceable art rules. The long reference is `docs/ART_BIBLE.md`; where the two disagree for machines, this file wins.

## Machine art bible (wave 87)

The machines are the face of the game. Each one must look deliberately designed: one family of materials, one palette and
one texel density, at the PSX target (low poly, NearestFilter, `psxMaterial`, 360-line internal frame).

### Palette

Use the 25 `PALETTE` keys (`src/kit/palette.ts`). Off-palette hexes are for one-off accents only, never for a whole body.

| role | keys | notes |
| --- | --- | --- |
| cabinet wood | `woodDark` (posts, sides, canopies), `wood` (counters, panels) | never orange: no `mahogany` on large faces |
| metal trim | `brass` (rails, frames, bars), `gold` (bosses, rivets, crowns), `chrome` (lever shafts, key collars, window frames) | brass is trim, not a surface: no full-face brass slabs |
| lacquer | `red`, `redDark`, `blood` | the Big One and the house cabinets |
| cloth | `felt`, `feltDark` (tables), `carpet` (velvet), green leather `0x1c3a26` (bank counters) | |
| light | `neonYellow`, `neonPink`, `neonCyan`, CRT green `#8dff9a`, LED red `#ff2a2a`, LED amber `#ffd040` | emissive only |
| dark | `black` (screens, slots, recesses), gunmetal `0x1c1c24` | the only flat colours allowed on big faces |

### Materials

Every bare palette hex for a real material resolves to its textured preset (`Presets.hex`, wired in `resolveMat`):
brass / gold / chrome are brushed metal, `wood` / `woodDark` are walnut grain, `red` / `redDark` / `blood` are worn
enamel, `carpet` is velvet, `felt` / `feltDark` are felt, `leather` is grained. So `kit.box(..., pal.brass)` is never a flat
slab. For anything else call the presets directly (`presets(kit.tex)`: `enamel(c, grime)`, `metal(c)`, `wood(kind)`,
`leather(c)`, `velvet(c)`, `felt(c)`).

- Walnut: posts, sides, plinths, canopies. Brass: a 1-3 cm rail on an edge, a frame round a screen or a plate.
- Red lacquer: big cabinet faces. Grime 0.15 for the floor, 0.6 for worn props (Mines' olive paint).
- Glass: smoked or tinted, transparent, `depthWrite: false`, `renderOrder` 2. Streaks are separate faint additive strips;
  never stretch the 16 px `kit.glass` glint tile over a pane bigger than about 0.5 m.
- Texel density: tiled maps carry `userData.tile` (metres per repeat); the kit maps UVs in metres. Machines sit at
  32-64 texels per metre (floors are 32). A small part that needs a finer pattern clones the texture and sets its own tile.

### Bezels and marquees

- A screen always has a bezel (kit.screen) and, on a hero cabinet, a brass or chrome frame 1-2 cm proud of it.
- Text on a face sits at least 3 mm in front of every trim that can overlap it (the Big One's JACKPOT band sat behind its
  gold lid trim and lost its top rows).
- A marquee or wall headline must clear the cabinet's crown from the spawn and from 3 m out: check the line of sight,
  not the plan view (the jackpot wall now hangs at 6.3 m, tipped 15 degrees).
- Signs use the bitmap fonts (`px5`, `public`, `chetyre`); no web fonts on 3D faces.

### Screens and glow

- One phosphor per screen: amber (slots, LEDs), green (the House Bank CRT), cyan (attract halos). Red is the only
  warning colour on any screen.
- No scanlines on readouts with 1-2 px strokes; `crispTexture` on every live screen.
- Glow is additive and capped: halos at most 1.25, lamps through `buildLampBank`.

### Locked machines

A machine that is not open yet stands in a brass-framed smoked-glass vitrine (`world/props/cover.ts`) with a small brass
plate ("OPENS NIGHT n", the BUY price under it), powered down behind a dark shade (`kit.lockOverlay`). It must read
dimmer than every open machine. When it opens, the glass rises into the ceiling with a dust fall and a light spill, and
the machine boots (`powerUp`, then the `unlock` jingle).

## Environment art bible (wave 87)

The rules the rooms are built to. Code: `src/world/props/surfaces.ts` (the painters and the world-UV helper), `src/world/level.ts`
(walls, floors, ceilings, pools), `src/world/props/*` (bar, ambience, ceiling, grand, elevator, lounge), `src/world/home/*`.

### The look in one line

A 1970s hotel casino that has been open all night for fifty years: walnut and brass, oxblood velvet, gold-on-red damask, warm
pools of tungsten light in a dark room, a few hard neon accents. Rich, worn and lived-in. Never clean, never empty, never flat.

### Palette per zone (60 dominant / 30 secondary / 10 accent)

| Zone | Dominant | Secondary | Accent | Light |
|---|---|---|---|---|
| Mouth (arrival) | oxblood damask, walnut wainscot | burgundy diamond carpet | brass, amber neon | sodium pendants, amber |
| Well (the Big One) | oxblood damask | burgundy carpet, gold coffers | gold, magenta JACK·ID | chandelier gold |
| Lobby | oxblood damask | burgundy carpet, red velvet | brass, cream shades | warm pools, a cyan stage spot |
| Bar | walnut, smoked mirror | green-veined marble | bottle colours, brass rail | low amber under-shelf glow |
| Stage | crimson velvet | dark walnut boards and fascia | gold fringe, cream globes | cold cyan key on the Compere |
| Lift | walnut and mahogany panels | smoked mirror, oxblood carpet, cream marble surround | brass rail and dial | one bare cream bulb, a lit ceiling panel |
| Wings (Midway, Cards, Laundry, Boiler, Gallery, Wheel House) | the dark damask colourway | the wing's own carpet or floor | the wing's neon colour | the wing's key colour (violet, green, teal, red, magenta, gold) |
| Parlour, Counting | dark walnut | boards | candle amber | candles, one swinging bulb |
| Home | faded sage paper over cream beadboard | worn boards, a worn rug | rust red, brass | one pendant, a lamp, the window's city |
| Underneath | black concrete | dark red velvet | red eyes | one cone of light |

A wing reads by its carpet, ceiling tint, light colour and props, never by a flat wall colour.

### Materials

Every material is a texture through `psxMaterial`, NearestFilter, tinted by the material colour. No flat untextured slab within
reach of the player; flat colour only for tiny parts (under 10 cm), glows, and deliberate black voids (the box-seat windows).

- **Walnut panels**: the wainscot painter (raised panel, stiles, cap moulding, dark skirting) or `presets(kit.tex).wood()`.
- **Brass trims**: `kit.pal.brass` or `presets().brass()` / `gold()`. Rails, nosings, frames, bands; 2 to 8 cm.
- **Velvet**: `presets().velvet(c)` in crimson or oxblood. Curtains, valances, proscenium, swags.
- **Marble**: the marble painter (green-black for the bar, cream for the lift).
- **Carpet**: `tex.carpet()` at `FLOOR_TILE_M`; one burgundy nave carpet, one per wing.
- **Wallpaper**: the damask painter (gold motif stripes on oxblood; a dark colourway for the wings).
- **Mirror**: smoked blue-grey with pale streaks, unlit.

### Texel density

Architecture (floors, walls, wainscot, ceilings): 32 texels per metre (64 px per 2 m; the wainscot 40 px per 1.2 m; the
apartment paper 84 px per 2.6 m). Walls are mapped in world coordinates (`worldUV`), so pieces split by doorways stay in phase and
the skirting sits on the floor. Furniture and props: the kit's metric 64 per metre. One-off framed images (posters, art, dials, bay
panels) are stretched once, never below 16 per metre.

### Lighting mood

- Warm pools, dark corners: a soft additive floor pool under every lamp (`FIXTURE_POOLS` and the lounge lamps); dark between pools.
- Light hints only (`LightHint`, boosted once by `FIXTURE_GAIN`). Dressing never adds a real-time light: it glows with unlit or
  emissive materials, additive pools and cones.
- Haze: faint additive cones under the Mouth pendants and the stage spot (`HAZE`). No fog changes.
- Neon is the accent: one sign per area in the zone's accent colour.

### Prop density

- No walking NPCs. The room is lived-in through what people left: an ashtray with a lit cigarette and glasses on every supper
  table, chip stacks on bars and some tables, ropes at queues, posters by the wing doors, framed art and sconces along the nave.
- Nave: a dressed group (seat, table, lamp, plant) every 6 m of wall; nothing in the aisle, a doorway lane or a standing zone
  (`planLounge` enforces it).
- Every doorway has a casing (pilasters on plinths, a brass-banded entablature, lined jambs) on its nave face, an architrave on
  its wing face.
- Static props live under the level's `statical` group, so `kit.finalize` merges them by look.

### Do not

- Use `Math.random`, `Date.now` or timers in builders: dressing comes from fixed tables, the seed or an integer hash.
- Put two faces in one plane: offset at least 5 mm (1 cm for anything larger than 1 m); a decal or poster stays 5 mm off its wall.
- Add a texture above 128 px or a real-time light for decoration.

## Identity: Cyprus casino × late-Soviet (wave 90)

The House is a Northern Cyprus casino of the 90s set in the bones of an older Soviet-era building. Turkish players should know the
place; the Soviet past shows only as faded leftovers, never as politics. Code: `src/world/props/identity.ts` (signs, the mosaic, the
rate board, the Boiler panels and the small Turkish props), the painters in `src/world/props/surfaces.ts`, the flat in `src/world/home/*`.

- **Signs speak Turkish first.** A sign is `crispBilingual`: the Turkish word big, the English one small under it (KASİNO / CASINO,
  HOŞ GELDİNİZ / WELCOME, YİNE BEKLERİZ / COME AGAIN, ÇIKIŞ / EXIT, DÖVİZ / EXCHANGE). Both string tables hold the same sign text; text
  a player reads as prose (the poster slogans) is translated. Gold on oxblood in a brass frame, like the BÜYÜK VURGUN wall; exits are
  green boxes beside each doorway on its wing face.
- **The everyday Turkish layer.** Tulip çay glasses on gold-lined saucers on the bar and the lounge tables (`cayGlass`), a semaver on the
  bar's service cabinet, a tavla game left open on the tables without a lamp, a nazar boncuğu by the cashier, kilim runners at every
  wing door (`kilimTex`), the exchange board with TL / STG / EUR / USD (codes and digits only, no brands), mirrored bands on the nave
  columns, palms, red velvet and gold. One or two of each, where people would leave them. No flags, no tourist kitsch.
- **The Soviet leftovers.** Constructivist posters (red, black and cream geometry, a slogan about luck and work, never a hammer and
  sickle or a real slogan) on the far side of each wing door; a red star on the old clock's dial; the smalt mosaic over the Lobby desk
  (a worker raising a die); precast concrete panels in the Boiler, the back of house. They read as older than the casino: faded,
  dusty, a tile missing.
- **The flat** is a khrushchyovka room lived in by a Turkish family: a lacquered wall unit (sektsiya) with good glasses, a crystal bowl
  and the small TV under a doily, a carpet on the wall over the bed, a çaydanlık on a two-ring hob, a calendar with a harbour on it, a
  stairwell painted green to 1.5 m under whitewash. Stations, anchors and Ada's chair do not move for dressing.
- **Rules.** Painted maps follow the density rules above (a poster or panel stretched once, the kilim 32 per metre); a decal or plate
  sits 5 mm or more off its surface; dressing is static kit geometry under `statical`, the sign plates keep their own material.

## Characters and props (wave 88)

Every figure is the one mannequin rig (`src/kit/mannequin.ts`) and its clip set. A character is told apart by an outfit, one colour
accent and a silhouette, never by a new skeleton. Code: `src/kit/mannequinOutfits.ts` (the builder and the Collector, Selim and
Compere looks), `src/kit/mannequinLook.ts` (faces, Ada's hair and dress, the dark NPC shader), `src/machines/tallytable/rivals.ts`
(the rivals), `src/world/props/food.ts` and `src/player/viewmodel/items.ts` (hand props).

### Two kinds of people

| | Ada (the one lit person) | everyone in the House |
|---|---|---|
| shader | lit PSX skin, warm rim, painted anime face | dark NPC: near-black body, banded rim, glowing eyes |
| colour | warm skin, brown hair, plum dress, red hair tie | the cloth's own colour through `lift` (0.2 to 0.6) |
| reads by | face, hair, dress details | silhouette, rim, one accent |

### Outfits

- Cloth is built in bone space: `tube` (a sleeve, a coat panel, a collar: a cone from a bone toward its child), `box`, `ball`, and
  kit props (hats, the ledger, the mic, the bow tie). Pieces on one bone in one colour merge into one mesh.
- Sizes are in the GLB's bone units (a 1.83 m rig): torso radius 0.13 to 0.19 (wider than deep, `sq` 0.82 to 0.95), upper arm 0.076,
  forearm 0.06, thigh 0.09, neck 0.067, face at z +0.11 of `Head`. Cloth sits 1 to 2 cm proud; check the front, the shoulders and the
  hips at 1 m for skin poking through.
- On a dark NPC only `lift` makes cloth read. Cloth 0.2 to 0.4, the accent 0.4 to 0.6. Above 0.6 a colour glows like neon in the dark
  and the figure stops looking like it came from somewhere else.
- One accent per character: Tamsin jade, Lucan red and gold, Mimosa yellow, Vell none (greyscale), the Collector a gold hat band and
  his red rim, Selim a warm amber rim and a red stripe on his towel, the Compere a red bow tie under his cold cyan rim.

| who | silhouette | pieces |
|---|---|---|
| the Collector | tall, long coat, wide brim | overcoat with the collar up, lapels, gloves, coat skirt, hat, ledger |
| Selim | shirtsleeves, towel on the left shoulder | waistcoat, rolled sleeves, towel, half apron |
| the Compere | top hat, tails | tuxedo, satin lapels, white cuffs and shirt front, bow tie, hand mic |
| Tamsin | silver bob, long scarf | dealer's waistcoat, jade scarf, white gloves |
| Lucan | epaulettes, high collar, tails | red tailcoat, gold cuffs and buttons, pocket watch |
| Mimosa | oversized coat, one shoe | yellow coat to the shins, sleeves over the hands, red shoe |
| Vell | long coat, flat cap | grey raincoat with a belt, tape reels on the shoulders |

### Faces

- Ada: painted in head space in the skin shader (`GLSL_FACE_ANIME`): large eyes (white, iris dark at the top and warm at the bottom,
  pupil, one catchlight on the same side), a thick upper lash line with a flick, thin brows, a hint of a nose, a small smile, cheeks.
  Every mark has a hard edge so it stays crisp at 360 lines. Her fringe stops at the brows; the eyes are never covered.
- House folk keep the blank face and the eye pinpoints (with a faint halo). Their form reads by a crisp edge line, a faint top light
  and thin bands that drift up through the rim (off in Calm Mode).

### Hand props

- Same grips: a prop keeps its origin and extents when it is reworked, so `GRIPS` and the eat and drink poses still fit.
- Small painted maps (`FOOD_TEX`, 16 px, 32 for the can label): a luminance pattern tinted by the part colour, or a full-colour label
  on a white part. Painters use an integer hash, never `Math.random`.
- Round things are round: 12 sides for cans, mugs and bowls at hand distance, a ring for a mug handle, not three boxes.
