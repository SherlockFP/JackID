# Pit performance (draw calls, triangles, GPU objects)

Measured in the real pit (a debt run, `/?skipmenu=1&seed=1`) at 1280x720 with the QA harness, headless Chrome.
Probe: `scripts/qa/perf-probe.js`. Run it with:

```
node scripts/qa/bench.mjs --world --seed 1 --js "$(cat scripts/qa/perf-probe.js)" --script "wait:45000" --probe "window.__perf ?? null"
```

No game code was changed. The probe teleports the player (devtools only) and reads `renderer.info()`.

## Method and caveats

- **Draw calls, triangles, geometries, textures, programs**: `renderer.info()` after two rendered frames at each view. Calls and tris are the renderer's own per-frame counts (the last render call; the post-process pass is counted in).
- **Frame time**: rAF interval over 12 frames, plus `renderer.info().cpuMs` (render CPU time).
- **Per machine**: an estimate. Each mesh's bounding sphere is tested against the camera frustum. It ignores the far-cull and LOD hiding, so the per-machine sums do not add up exactly to the renderer totals. Use the renderer totals as the truth and the per-machine rows for ranking.
- **Static** figures count every visible mesh in the pit, whatever the camera sees. They give the budget ceiling.
- Headless Chrome here runs without a real GPU. Frame times are noisy (about 2x between runs) and are not a GPU benchmark. The CPU and draw-call numbers are the stable part. Compare relative numbers only.
- Gates at start: the Jade Room (`cards`) and the Boiler are **closed** (`isZoneOpen` false) in this run.

## Busiest views (renderer.info, 1280x720)

Worst views per position (all four yaws are in the probe output):

| view (yaw) | draw calls | triangles | cpu ms (render) | frame ms | geometries | textures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Spawn (yaw 90, faces west) | 1339 | 177k | 7.3 to 12.1 | 9 to 14 | 3142 | 526 |
| Well centre (0,-9), yaw 90 | 1280 | 174k | 6.7 to 13.5 | 8 to 13 | 3143 | 526 |
| Well centre, yaw 180 | 1240 | 167k | 8.0 | 9 | 3143 | 526 |
| Jade Room (-21,-9), yaw 270 | 1061 | 160k | 6.3 to 6.8 | 8 | 3244 | 538 |
| Boiler (21,-23), yaw 90 | 758 | 91k | 5.2 to 5.6 | 5 | 3244 | 538 |
| Spawn, yaw 0 (faces the dais) | 675 | 146k | 4.9 to 6.1 | 7 to 9 | 2707 | 467 |

The view with the fewest calls is the Boiler facing the wall (98 calls, 38k tris). Empty-looking views still cost about 3 ms frame time.

Static totals (every visible mesh, 57 machines): **3000 calls, 338k tris**. Machines are 2072 calls / 270k tris (80%). The rest of the pit is 746 calls / 64k tris, of which `level:pit` is 589 calls / 61k tris.

GPU objects grow as new areas are first rendered (geometries are uploaded on first draw): about 1600 geometries and 290 textures at spawn, 3270 and 550 after a full sweep. That is roughly 3.3k geometries and 550 textures resident for the pit.

## Top 10 offenders

Ranked by static triangles. Machine ids are instance ids (`WELL-02`) with the machine kind in brackets. "Closed wing" means the machine sits behind a gate that is shut at start.

| # | id [kind] | static tris | static calls | notes |
| --- | --- | ---: | ---: | --- |
| 1 | WELL-02 [roulette] | 32.9k | 82 | Chip pool InstancedMesh draws **count 600** at idle: 600 x 48 tris = 28.8k, 88% of the machine. |
| 2 | FLR-05 [craps] | 25.7k | 58 | Chip pool count 160 (7.7k). The other ~18k is not broken down yet. Same model as BOI-01. |
| 3 | BOI-01 [craps] | 25.7k | 58 | **Closed wing** (Boiler), still drawn through the gate. |
| 4 | WELL-03 [blackjack] | 25.4k | 71 | Chip pool count 120 (5.8k). Other ~20k not broken down. Same model as CARD-02, CARD-03. |
| 5 | CARD-02 [blackjack] | 25.4k | 71 | **Closed wing** (Jade Room). |
| 6 | CARD-03 [blackjack] | 25.4k | 71 | **Closed wing** (Jade Room). |
| 7 | CARD-08 [tallytable] | 16.8k | 46 | **Closed wing**. Same model as BOI-07 (16.8k, 46 calls). |
| 8 | FLR-07 [keno] | 8.4k | 116 | 116 calls: the highest call count per machine. Same model as LAU-02. |
| 9 | WELL-01 [bigone] | 8.3k | 117 | 117 calls. |
| 10 | level:pit (Sump coin mound) | ~22k | 1 | Unnamed InstancedMesh, 700 instances x 32 tris (`src/world/props/decor.ts:202`), in the non-machine `level:pit`. |

Also high: FLR-06 / PAR-03 [sonkart] 3.8k tris and 66 calls each; WELL-08 [pachinko] 3.4k tris and 63 calls.

Machines that are in the spawn and Well views by the renderer numbers: WELL-02, CARD-02, CARD-03 (about 84k tris when all three are drawn). Closed-wing machines (BOI-01, CARD-02, CARD-03, CARD-08, BOI-07) account for about 110k static tris and about 300 calls.

## Concrete fixes

1. **Roulette chip pool (WELL-02)**: the pool's instance count stays at 600 when the table is quiet, so 28.8k tris are drawn every frame. Set `mesh.count` to the live chip count (or the highest used index) each frame, and/or lower the chip cylinder from 12 to 8 segments (48 to 32 tris per chip). Saving: up to about 28k tris on this machine (the count cut removes most of it when the table is quiet; the segment cut is a further 9.6k at 600 chips). Chip pool code: `src/kit/pools.ts` (`makeChips`), cap `src/machines/roulette/index.ts:40`.
2. **Closed wings still render (BOI-01, CARD-02, CARD-03, CARD-08, BOI-07)**: about 110k static tris and about 300 calls drawn through a shut gate. Hide the machine groups (or move them to the far-cull layer) while `isZoneOpen` is false, and show them when the gate opens. Biggest single win for the spawn and Well views.
3. **Blackjack x3 (WELL-03, CARD-02, CARD-03)**: 76k tris and 213 calls in total. Cut the non-chip ~20k per table (card and rail meshes, bevels) by reducing segments or moving detail to `lodDetail` (hidden beyond 8 m). Start with a per-mesh dump of one table (name and tris) so the cut targets the real cost. Model: `src/machines/blackjack/model.ts`.
4. **Craps x2 (FLR-05, BOI-01)**: 51k tris and 116 calls. Same approach: the chip pool at 160 instances is 7.7k, dump the rest. Model: `src/machines/craps/model.ts`.
5. **Tallytable x2 (CARD-08, BOI-07)**: 33.5k tris and 92 calls. Check the ledger and board meshes for detail that the far view does not need. Model: `src/machines/tallytable/model.ts`.
6. **Keno x2 (FLR-07, LAU-02)** and **bigone (WELL-01)**: 116 to 117 calls each. Merge the per-cell or per-symbol meshes into one InstancedMesh or one atlas material. Target 10 to 20 calls per machine.
7. **Sump coin mound (level:pit)**: 700 instances x 32 tris = 22.4k tris, 30 m below the floor, always in the static budget. Reduce the count to about 250 and the cylinder to 6 segments, or move the Sump behind the far-cull layer. `src/world/props/decor.ts:199-202`.
8. **Sonkart x2 (FLR-06, PAR-03) and pachinko (WELL-08)**: merge materials to cut the 63 to 66 calls each.
9. **Duplicate models**: three blackjack, two craps, two keno, two tallytable and two sonkart each build their own geometry. A shared geometry cache per model kind would cut the 3.3k resident geometries (memory and upload time, not triangles).
10. **Budget guard**: `kit.finalize` already reads `root.userData.budget` (`src/kit/finalize.ts:161-163`) and logs a warning. Set `budget: { draws, tris }` on each machine root (suggested: 60 calls and 25k tris for a table, 20 and 8k for a slot) so a regression shows in the log. Suggested pit budget: no more than 1000 calls and 150k tris in any view.

## Reproduce and compare

- Re-run the command above after each fix. Compare the `views` table (calls, tris, cpuMs) and `staticTopByTris` (the offenders).
- Start point for this report: 3000 static calls, 338k static tris, worst view 1339 calls / 177k tris.

## After: chip pool, Sump decor, machine merges (wave 7)

Same command as above (`--world --seed 1`, 1280x720, headless). Output saved as `perf-after.json` in the QA scratchpad.

Changes measured:
- `src/kit/pools.ts` (`makeChips`, every kit chip pool): cylinder 12 to 8 segments (48 to 32 tris per chip). The draw count
  follows the highest live chip id + 1, and `clear()` frees high to low so live ids pack low.
- `src/world/props/decor.ts` (`buildSump`): default coins 700 to 350, coin cylinder 8 to 4 segments. `src/world/level.ts:246`
  still passes `coinCount: 700`, so the Sump is still 700 coins in the pit until that line changes (about 5.6k tris).
- `src/machines/keno/lamps.ts` moved to `src/kit/lamps.ts` (keno re-exports it; bigone imports the kit path). Keno lamps and
  bigone LEDs, rays, tray, glass and decals are instanced or merged. Blackjack and craps mannequins set `lodDetail`.

Views (before = recorded pre-edit run of the same probe, not re-measured here; the "after" column is this run):

| view (yaw) | before calls / tris | after calls / tris | after cpu ms / frame ms |
| --- | ---: | ---: | ---: |
| Well centre, yaw 0 | 578 / 141.1k | 539 / 56.8k | 3.7 / 3.5 |
| Well centre, yaw 90 | 1280 / 173.9k | 710 / 44.5k | 2.9 / 4.3 |
| Well centre, yaw 180 | 1240 / 166.5k | 872 / 74.1k | 4.9 / 4.8 |
| Well centre, yaw 270 | 1029 / 168.3k | 626 / 59.5k | 3.8 / 4.1 |
| Spawn, yaw 90 | 1339 / 177.4k | 705 / 44.7k | 4.2 / 4.8 |
| Spawn, yaw 0 | 675 / 146k (PERF.md) | 626 / 59.3k | 5.8 / 4.6 |
| Spawn, yaw -90 | not in baseline | 614 / 59.4k | 5.1 / 8.3 |
| Spawn, yaw -180 | not in baseline | 846 / 72.7k | 5.0 / 8.1 |
| Jade Room, yaw 270 | 1061 / 160k (PERF.md) | 786 / 55.5k | 3.8 / 4.8 |
| Boiler, yaw 90 | 758 / 91k (PERF.md) | 530 / 38.6k | 2.2 / 3.3 |

Static totals (every visible mesh, 57 machines): **1948 calls, 146k tris** (before: 3000 / 338k). Machines 970 / 87.9k;
non-machine 744 / 52.7k, of which `level:pit` is 589 / 49.8k. The per-machine rows are the fair comparison: LOD and gate
visibility also changed the totals.

Per machine (static, after; before from the table above):
- WELL-02 roulette: 82 calls / 4.1k tris (before 82 / 32.9k; chip pool now idle at 0 tris).
- FLR-07 keno: 39 calls / 8.4k (before 116 / 8.4k). Most likely the keno lamp bank (`keno/model.ts` and `kit/lamps.ts` are in the tree; not isolated by a run).
- WELL-01 bigone: 28 calls / 8.4k (before 117 / 8.3k).
- FLR-05 craps: 54 calls / 4.1k tris, with the stickman LOD hidden beyond 8 m (before 58 / 25.7k).
- WELL-03 blackjack: 71 calls / 19.6k tris, mannequin LOD hidden beyond 8 m (before 71 / 25.4k).

Caveats: frame ms is noisy in headless Chrome (one spawn view ran 11.6 to 18.7 across runs), so the CPU and call columns
are the stable part. Absolute figures are about +/-10%. The 4-segment Sump coin has not been checked visually (the Sump is
30 m below the floor, not in any bench room). Still open outside this change: the `level.ts:246` coin count.

## After: multiplayer smoke

`scripts/qa/mp.mjs` (default transport) passed all steps, both pages `ingame`, seat at WELL-01 (bigone), host saw 2 `mev`,
host seat freed. The pit snapshot read 5 machines per side because it is taken before `world.ready`. It is not a floor
comparison; see `docs/MP_SMOKE.md` for the open items.
