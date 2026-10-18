## Map rebuild feasibility (read-only study, branch wave7-controls-circuit, HEAD 4a1fee5)

**Recommendation: (a) REFIT.** Keep the engine, the slot ids, the zone rectangles and the cutscene anchor coordinates. Re-assign about 12 machines into 4 themed areas, and add landmarks and light. A rebuild would touch about 10 files and four test suites for little gain. The screenshots show the main problem is darkness and dead pads, which a refit fixes.

### Current base map
- **Size:** the pit is x −31..31 and z −32..20, about 62 × 52 m (`src/world/layout.ts:280-292`). The lift niche sits at x −5.1..−2.9, z −32.2..−30 (`layout.ts:279`).
- **Zones:** the nave is three zones: mouth (z −30..−18), well (−18..2), lobby (2..20). Eight gated wings hang off it: midway, cards, laundry, boiler, gallery, wheels, parlour, counting (`layout.ts:266-277`). Wings open behind grilles (`level.ts:284-286`). Parlour and counting are both at z 12..20, on opposite sides.
- **Slots:** 98 `S(...)` entries (`layout.ts:57-130` approx.). Of these, 16 core machines are placed on the floor. Everything else is a pad, shown as "OPENS NIGHT n" (`layout.ts:150-160`, `progression.ts:107`).
- **Build pipeline:** `layout.ts` is pure data (SLOTS, ZONES, NAV graph, DEFAULT_ASSIGN, SIGNPOSTS). `level.ts` builds geometry: ceilings per zone (`level.ts:38-40`), 19 hand-placed fixture lights (`level.ts` `lights.push`), a fixture gain of 1.8 added after a "too dark" playtest (`level.ts:34-35`), the hero trapdoor at (0,12) over the Sump (`level.ts:31-32`), and named anchors (`level.ts:467-483`). `zones.ts` blends fog between zones.
- **Tycoon unlocks:** unlock nights are listed in the `layout.ts` header (N1 to N7). `progression.ts` `unlockNightOf` and `isLockedFor` decide what is open.

### Cutscene and anchor dependencies
Anchors are named points on the geometry, not slot ids. Cutscenes use `world.anchor(name)`. Counts from `src/`: quotaBoard 8, hotline 4, furnace 4, trapdoor 3, terminal 3, parlour.curtain 3, mgmt.door 3, collector 3, clock 3, sump 2, jack 2, elevator.door 2, duel.bench 2, elevator 1, note.n15..n28 (`src/game/story/notes.data.ts`). Home and Hollow anchors are far offset and are unaffected. Anchors live in `level.ts:467-483` and `rooms`/`hollow`/`home` configs. A refit must keep these positions or move the cutscene targets with them.

### Tests and tools that assume the layout
- `scripts/tests/world.test.mjs:409-412`: roster sizes from SLOTS.
- `scripts/tests/progression.test.mjs:145,218,233,245,266`: pit slot filters by zone and positions.
- `scripts/tests/duelrun.test.mjs:134,194`: CNT-03 zone and duel slot positions.
- `scripts/tests/home.world.test.mjs:36`: the home ZONES entry.
- `layout.ts` `FLOOR_READY` and `ROSTER_PADS`: the Pit Deck roster only draws seat-checked machines.
- Bench docs (`scripts/qa/README.md:222`): `goto:` seed-1 placements (coinflip, hilo, scratch, bigone, hotline, cashier, charm_vendor). These change if machines move.
- Navigation graph (`layout.ts:290-309`) drives actor patrols.

### Screenshots (run with `--run ... --seed 1`)
Folder: `C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-Documents-JackID\48c49d04-016b-4c0d-ac70-780ba1fcc555\scratchpad\map3\`
- `00-spawn.png`: a seat view of THE BIG ONE, the first thing the player sees. The layout is not visible.
- `01-mouth-lift.png`: a dark lift door, with a hint that reads "Walk to THE BIG ONE." No signage in frame.
- `04-cards.png`: dim red, few light sources, nothing readable.
- `05-laundry.png`: blue tile, a KENO sign, the most readable zone so far.
- `06-boiler.png`: near black, pillars only.
- `07-parlour.png`: almost black, two faint lamps.
- `10-sump.png`: black. Unreadable.

Not captured: lobby, gallery, wheels, counting. They have no anchors, so a `--js` teleport is needed. The first capture run was blocked by the Starter Draft modal (screens in `map/`). A `stand` step is needed before teleports, because a seated player does not move.

### Judgement
- **Readable?** No. Most wings are under 10 % visible in the shots. Lights are few, and the parlour and sump are almost black.
- **Tells a story?** Weakly. Story points (notes, Collector chair, quota board, clock, lift) are scattered and not signposted as places.
- **Where the player gets lost or bored:** the spawn faces a machine, not a route. Walks between the lobby and the parlour or the boiler are about 20–25 m. The gallery is a row of identical M slots (GAL-01..13). Early on, most pads are empty "OPENS NIGHT" plates, so the floor feels dead.

### Option A: Refit (recommended)
- **Scope:** keep all 98 slot ids, zone rectangles, anchors and nav. Re-point `DEFAULT_ASSIGN` so about 12 machines sit in 4 areas:
  1. Mouth and lift: arrival, terminal, phone, clock. Story spot: `elevator.door`.
  2. Well dais: the Big One hub with roulette, blackjack, plinko and coinflip.
  3. Lobby and vendors: charm vendor, cashier, jukebox, tonic, hero trapdoor. Sump under it.
  4. Back of house: laundry and boiler (staff corridor), parlour (`parlour.curtain`, shrine nook at PAR-SHRINE), and a locked `mgmt.door` office.
- **Light:** raise fixture gain in the four areas, and add a light path between them (`level.ts` lights, `ZONES` look values).
- **Landmarks:** 2–3 props (the existing signposts, plus a neon sign per area).
- **Effort:** medium (about 1–2 days of Haiku lane work). **Risk:** low to medium. Files: `layout.ts` (DEFAULT_ASSIGN, FLOOR_READY, ROSTER_PADS, SIGNPOSTS), `level.ts` (lights, gains, props), `props/signposts.ts`, `props/cover.ts`. Breaks: the four test files above if their pit filters change; the bench seed placements in README; FLOOR_READY seat checks for any moved machine.

### Option B: Rebuild
- **Scope:** new SLOTS, ZONES, NAV graph, anchors (rewrite `level.ts:467-483`), lights, props and signposts. Re-run every seat view and the bench placements.
- **Effort:** large (about 4–6 days). **Risk:** high.
- **Breaks:** every cutscene anchor (about 60 uses), the four test files, `goto:` seed placements, FLOOR_READY seat views, the unlock order in `layout.ts` header and `progression.ts`, the Pit Deck roster, the nav graph and actor patrols, the sim assumptions, and the visible story anchors.
- **Only worth it** if the director wants a different spatial story (for example a single linear route). The client's note "progress well with what we have" points against it.

No files were edited and no git writes were made. I did not run `npm test` or the typecheck.