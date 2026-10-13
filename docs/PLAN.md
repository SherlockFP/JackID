# JackID — Final Build Plan (PLAN.md) v1.0

Owner: Producer / Lead Integrator. Date: 2026-10-13. Status: **binding for scope, milestones, file ownership and Definition of
Done.** It sits on top of the reconciled design docs (GDD v1.1, ART_BIBLE v1.1, TECH_SPEC v1.1 §11, MACHINES_machines v1.1,
MACHINES_tables v1.1). It never changes a rule, number or look; it decides **what is built, by whom, in which order, and when
it counts as done.** The repo folder is still `jackpit/`; the game is **JackID**.

---

## 0. Read me first

### 0.1 Precedence (unchanged, now consistent)
`BRIEF.md` (fixed decisions, Addenda 1–8) > **GDD** (rules, economy, layout, flow, menus, HUD) > **machine catalogues** (per-machine
rules, odds, hooks, juice) > **ART_BIBLE** (every visual) > **TECH_SPEC** (code shape; **§11 is binding for interfaces**) >
this PLAN for scope, ownership and order. When a doc still contradicts another after v1.1, raise it with the Producer; do not
pick silently.

### 0.2 Who does what (BRIEF "model roles")
| Model | Role in this plan |
|---|---|
| **Opus 5.5** | Direction and every important call: the core foundation and its frozen types, integration (`main.ts`, `inGameState.ts`), every 3D model (`model.ts`), the level, avatars, the 3D jackpot menu, cutscene timelines and story text, the music score, design reviews (screenshots/recordings of every machine), milestone sign-off. |
| **Sonnet 5.5** | The bulk of implementation: machine logic (`index.ts` + rules), systems (run, economy, circuit, charms, tycoon, hotline, buffs, meta), world systems, player, HUD and menus, networking, lobby server, audio engine. |
| **Haiku 5.5** | Data transcription from the design tables, translations and TR review, regression sims, checks and test checklists. **Never makes design or architecture decisions** — opens a question instead. |

### 0.3 Golden rules
1. **One owner per file** (§5.1). Need a change in someone else's file → write the request in your report; never edit it.
2. TECH §11 types are frozen after M0 (change only via the core owner, logged in `docs/qa/api-changes.md`).
3. No new npm dependencies; no external art/audio beyond `docs/ASSETS.md`; original IP only (no CloverPit, UNO or
   Buckshot-Roulette names, text, symbols or art).
4. Every player-visible string through i18n with EN **and** TR; numbers via the shared formatter (`¢`, K/M/B…, TR suffixes).
5. `npm run typecheck`, `npm run build`, `npm run check` green before any report of "done".
6. Juice is not optional: every interaction has anticipation → action → impact → follow-through (BRIEF Addendum 8, §7.4).

---

## 1. Integration register (the v1.1 reconciliation, all edits already applied in the docs)

| # | Topic | Inconsistency found | Decision (now in the docs) |
|--:|---|---|---|
| 1 | Name | TECH, ART and both catalogues titled "JACKPIT"; storage keys, channels and appId used `jackpit` | **JackID** everywhere; keys `jackid:*`, BroadcastChannel `jackid:lobby`, appId `jackid-v1`; `jackpit` symbol → `jackid` coin medallion |
| 2 | Machine ids | TECH v1.0 (`big_one`, `coin_flip`, `crash_cable` …) and ART (`peg_drop`, `light_ring`, `tower_stack`, `money_wheel` …) disagreed with the catalogues | Catalogue ids are final (39); legacy map in TECH §11.1 and GDD App. A; reference machine folder `coinflip` |
| 3 | Instance ids | Catalogue `bigone#0`, TECH `B07`, GDD `WELL-01` | GDD slot ids are instance ids (TECH §11.1) |
| 4 | Level & zones | TECH (48 × 36 m, zones `atrium/slots/…`) and ART (40 × 32 m, Judgement Dais, Mouth trapdoor) vs GDD (62 × 52 m nave + 8 wings) | **GDD §8** wins; `ZoneId` = GDD zones; ART §6 becomes the kit of parts; ART zone looks mapped to GDD zones (ART §0.1) |
| 5 | Slot classes | TECH `SLOT_DIMS` (M 1.8 × 1.4, XL 5 × 3.6 × 6) vs GDD (M 1.2 × 1.0, XL 4.8 × 2.6 × 3.8) | GDD §8.5 values in TECH §3.1 |
| 6 | Machine sizes vs slots | hilo / mines / coinflip modelled larger than S; dicetower (Ø1.40 table + 4 stools), bigsix (2.40 m counter), tombola (2.00 m stall), bingopin (1.40 m deep) larger than M; cyclone 1.50 wide in an M slot; baccarat mirror at 2.6–3.4 m in an L slot; elevator walk-in car with a 9 m shaft under a 4 m ceiling | WELL-08 hilo → M, WELL-11 mines → M, BOI-03 dicetower → L, WH-01 bigsix → L (wall wheel Ø1.8), WH-02 tombola → L, LAU-08 bingopin → L (GDD §8.6 rows, roster sizes, App. B); coinflip booth 0.78 × 0.78 × 2.00 (stays S); cyclone body 1.00 W (48 lamps); baccarat mirror centre y 2.05; elevator = miniature shaft cabinet + 8 rider stations (§4.2) |
| 7 | Devil's Table | BRIEF Addendum 7 (shell duel, items, charges, 2–4 PvP) vs catalogue §5 (revolver ladder) vs GDD | New **MACHINES_tables §5A SHELLS** (main mode) + §5 SIX CHAMBERS (quick variant); GDD roster/HOUSE feat/taste rule updated (aim only at seat lanterns) |
| 8 | Charm hooks not exposed by machines | `ui.shoeInfo` (Counting Bead incl. Hi-Lo, which has no shoe), `coinflip` re-flip (Hollow Dice), `wheel.nudge` on roulette/cyclone (Golden Ratchet) | Hooks `table.shoeInfo` (blackjack, baccarat, cardwar, reddog), `coinflip.reflip`, `wheel.nudge` (roulette, bigsix, cyclone) defined in MACHINES_tables §1.6a; GDD charm rows #26, #63, #64 fixed |
| 9 | Hook vocabulary | Catalogue `payoutMult/luckBonus/<id>.<hook>/table.*`, GDD `run.*/econ.*/tilt.*…` vs Phase-0 `ModHook` (`payout.mult`, `luck`, `m.*`, `x.*`) | One mapping table, TECH §11.3 |
| 10 | Machine networking | Catalogue host-validated `mc.*` messages vs TECH occupant-authoritative solo devices + `mev/tact/msnap` | TECH §11.4 mapping; "host" = authority; private unicast `mevp`; per-round RNG streams |
| 11 | Machine contract | Catalogue `defineMachine/defineTable`, ART `buildModel(opts)` + `setAttract/update`, TECH `buildModel(kit)` | TECH §3 + §11.5 (`buildModel(kit, ModelOpts)`, anchors list, `addStake`, `settle` meta, pulls in `run.bet`, `betLimits`, `WinTier 'mega'`) |
| 12 | Part names | Three conventions (TECH flat names, ART `parts.reels[i]`, catalogue `ledCredit`/`reel0..4`) | camelCase ART §4.4 names (TECH §11.8); per-machine lists in Appendix A are the contract |
| 13 | Win tiers | TECH tiers (<3/<10/<50/<200) vs catalogue tags (×10/×25/×50) vs GDD §10.4 | `tierFor` realigned + `'mega'` tier (TECH §2.13, §11.5) |
| 14 | Key bindings | Q = bet max (TECH) vs punch card (GDD) vs collect (tables); B = bet max (catalogue) vs ping (GDD) vs Totem place (Phase-0); PTT Y vs N; device conflicts (videopoker Q, fruit Q/A, stacker T, devil Y) | Final keymap TECH §11.6 (seated Q = collect, B = max bet; walk Q = card, ping = MMB/Z, F = use item, B = Totem); catalogue device keys fixed |
| 15 | Currency | ART HUD/pop text "$", catalogue symbol `c`, GDD `¢` | **¢** (EN) / **j** (TR); `¢` glyph added to the micro font |
| 16 | Render pipeline | ART custom ShaderMaterial, 16-active/4-per-mesh lights, 225 p FILL scaling vs TECH Lambert factory, 6-light pool, 224 p integer scale | TECH API kept; ART look mandatory; 6-light pool + ART flicker profiles; 400×225 FILL default; camera far 48; viewmodel FOV 50 (TECH §11.7) |
| 17 | Settings | Three differing video tabs (TECH, GDD, ART) | ART §1.14 video (FOV vertical 62, head-bob 70 %), GDD §9.8 other tabs, lobby URL default `''` |
| 18 | Menu | GDD drums Ø3.2 m / 8 faces + on-glass panels vs ART reels r 0.87 / 12 facets + side-wall CRT stations; ART boot/burst lands `jackpit`, GDD lands SUN | ART geometry/stations, GDD entries/flow/timeline, full screen of **SUN** |
| 19 | Big One symbols | ART symbol set (gold tooth, bullion, heart …) vs catalogue (MOTH, TOOTH, KEY, CANDLE, RING, CROWN, SUN, MAW, GHOST) | Catalogue set; ART §3.6 gains `candle`, `ring`, `sun`, `ghost` painters, ivory TOOTH, MAW = `grin` |
| 20 | Trapdoor / terminal / clock / hotline | ART fixed 3 × 3 Mouth trapdoor, Judgement Dais, two-faced clock with permanent XIII, 2 s/4 s ring cadence | GDD: every 2 × 2 plate is a trapdoor, terminal at MOUTH-TERM, Ø2.4 single-face clock with XIII only on Night 8, 1.0 s/0.7 s ring |
| 21 | Characters | ART procedural hinge avatars and dealer rigs vs BRIEF Addendum 4 mannequin GLB | Mannequin GLB for players, humanoid dealers, patrons, staff, the Collector; ART masks/hats on the `Head` bone; procedural rigs only for partial automata |
| 22 | Shop | ART "CURIOSITIES" charm vending machine vs GDD Pawn Window + Charm Board | Model reused as **The Apothecary** (tonics); shop = Pawn Window |
| 23 | Seat / player colours | Tables S1–S8 seat palette vs ART player colours | Player colours (ART §8.2) everywhere; patrons grey |
| 24 | Saving | GDD IndexedDB vs TECH localStorage | TECH SaveStore keys `jackid:v1`, `jackid:run:v1`, `jackid:recent:v1` |
| 25 | Rooms | GDD Crockford codes, `?join=`, Free Casino host migration, 5 min hold vs TECH alphabet, `?room=`, no migration, 120 s | TECH alphabet; `?join=` (alias `?room=`); no migration in v1.0 (T3); 300 s hold; "RESUME ROOM" from host snapshot |
| 26 | Interaction & movement | Catalogue 1.2 m / 0.45 s glide, ART 1.8 m ray, TECH sprint 5.0 / AABB 0.25 vs GDD sprint 5.2 / radius 0.3 | Ray 2.2 m (tables 2.8), glide 0.60 / 0.45 s, GDD speeds and 0.30 half-extents (TECH §11.10) |
| 27 | Lights in machines | Catalogue "≤ 2 real PointLights per machine" vs TECH "no lights in machines" | No `THREE.Light` in machines; ≤ 2 light anchors feed the pool |
| 28 | i18n keys | Catalogue `machine.<id>.*` vs TECH `m.<id>.*` | `m.<id>.*` (TECH §11.9) |
| 29 | Tycoon track name | Tables `auto` track vs GDD `staff` | `staff` |
| 30 | Open questions in catalogues | actionCost unit, tableLimitMult, scavenge, blackout penalty, PvP caps, starting devices | Answered in catalogue §19.6 / §24.4 from GDD v1.1 |
| 31 | Addenda 5–8 pool | Not covered by the GDD (Parlor card games, boss Nights, Totems, Collateral porcelain, cheating, bar …) | Tiered T1/T2/T3 in §3 — nothing dropped |

---

## 2. Milestones

### 2.1 Overview
| Milestone | Goal | Owner of the gate | Packages active (see §5) |
|---|---|---|---|
| **M0 Core foundation** | One Opus author lands the engine and every frozen contract; machines can be built in a bench room | core | `core` only (others may start reading and drafting data) |
| **M1 Vertical slice** | Boot → jackpot menu → PLAY → burst → Night 1–3 solo in the full pit with The Big One, the coin-flip reference, Debt Terminal, Hotline, Pawn Window | core (integration) | world-arch, world-sys, player, avatars, mach-shared, game-run, game-charms (commons), game-tycoon (2 tracks), game-hotline (5 calls), game-data, story (C01–C05), cutscene-player, menu-3d, menu-ui (pause/settings), hud, audio-engine, music-score (menu + lounge), sysmdl-core, syslogic-core, sysmdl-lobby (Pawn Window), syslogic-lobby (Pawn Window), mdl-bigone, mc-bigone, i18n, qa-sim; modelers MOD-A…F start wave-1 models |
| **M2 All machines + full single player** | 39 machines registered and passing DoD; the complete 8-Night SP game + Overdrawn + meta | core | all machine packages; game-circuit, game-buffs, game-meta, horror, all game packages to full scope, story (all), music-score (all), sys lobby devices, net-transport (tab only, for 2-tab tests at the end) |
| **M3 Multiplayer + server browser** | Co-op, Versus, Free Casino over P2P listen servers with the server browser, invite links and the Lift lobby | core | net-transport, net-session, lobby-server, menu-ui (browser/host/lobby), player (remote avatars, ghosts), game-run (MP modes), every machine re-verified in 2 tabs |
| **M4 Polish & v1.0 content lock** | Juice, performance, accessibility, balance, TR, stability | core + Producer | everybody in fix mode; Opus reviews; Haiku sims and checklists |
| M5+ (after v1.0) | T2 content drops (§3) | Producer | new packages per drop |

### 2.2 M0 — Core foundation (package `core`, Opus, serial)
Scope (TECH §1–§4, §10.1 Phase 0, **plus all of TECH §11**):
1. Tooling: `index.html` (JackID boot div), `vite.config.ts`, `tsconfig.json`, `package.json` scripts, `scripts/check.mjs`
   (EN/TR parity, forbidden imports, `Math.random` in machines, budget report from the bench dump).
2. Engine: app container + state machine, fixed-step loop + background worker ticker, events (incl. declaration merging),
   rng (sfc32 + `hashSeed`), tween, timers, math, log, dispose, settings, SaveStore (`jackid:*`), i18n runtime + `fmt()`
   (EN `K M B T Qa Qi Sx Sp Oc No Dc`, TR `B Mn Mr Tn Ka Kn Sk Sp Ok No Dc`, `¢`/`j`).
3. **PSX renderer + materials** to the ART look (§11.7): 400×225 FILL, clip-space snap, affine, Gouraud-looking 5-bit lighting,
   16-band fog with zone blending API, Bayer 4×4 + 15-bit quantize, CRT SUBTLE/FULL, post juice state (flash, tint, chroma, zoom,
   vignette, desaturate, blackout, glitch), 6-light pool with ART flicker profiles, `grab()` for the menu shatter.
4. **Texgen**: all ART §3 generators, card atlas, chips, dice atlas, wheel faces, 7-seg / dot-matrix, micro font incl. `¢` and
   Turkish, and **every symbol painter** the catalogues use (Big One set incl. new `sun candle ring ghost`, ivory `tooth`, `grin`;
   bandit `star plum orange melon bar bar2 bar3 shoe blank`; pachislot `oni koi replay lantern fan bar`; fruit `pear grapes
   strawberry melon bar doublestar moneybag step`; coin `crown skull`; ART `eye bullion heart glove jackid`), vendor texture loader
   (`docs/ASSETS.md` rules).
5. **Input** with the final keymap (§11.6, `code` + `mods`, new machine actions), pointer-lock and cursor rules.
6. **UI overlay**: canvas HUD layer, prompt, toasts, big banners (ART §10.6), subtitles, choice, modal, panels, glove cursor.
7. **Kit**: every TECH §4 primitive and assembly, `finalize`, `shade`, cabinets, screens, marquee, controls, lamps, bulb chains,
   reels, wheels, felt tables, stools/chairs, chip/card/dice/ball pools, glass/dome/cage, `dealer` rigs (croupier, porcelain,
   puppet, devil, oracle, caller, cashier), **mannequin GLB actor** (load once, `SkeletonUtils.clone`, clips, 15 fps stepping,
   bone attach, look-at, tint/opacity), `prop()` (masks, hats, gun props, phone, mint tin …), `totem()` stub, lock / out-of-order
   overlays, ART kit functions (§4.8) as aliases.
8. **Machine base**: `MachineBase`, `TableBase` (seats, phases, timers, Ready, rebet/double, bots API, `act/nak`, `chargeSeat/
   paySeat`, private events), registry (glob), `cards.ts`, `reels.ts`, `tiers.ts`, per-round RNG, `addStake`, `settle` meta,
   `modelOpts`, snapshot of the base (`round`).
9. **World core**: `world/types.ts`, AABB collision (`moveAndSlide`, `raycast`, `floorAt`, `setEnabled`), interaction system,
   bench room `/?bench=<id>` (12 × 12 m, wallet 10,000, F3 stats, Rebuild ×10, force outcome, seed, luck/hook sliders, **Sim
   button** running `playHeadless` 100,000 rounds, PSX toggle, `&net=tab` hook for later).
10. Game types barrel (`src/game/types.ts` + `*.types.ts`) with §11.5 additions; `benchRun` (RunApi for the bench); offline
    `Session`; `net/types.ts`, `net/protocol.ts` (+ `mevp`).
11. Reference machine `src/machines/coinflip/**` (simplified, TECH §3.6) and a reference **table** in the bench (2-seat dummy
    `TableBase` using a bot seat) to prove the table flow.
12. Compile stubs (≤ 30 lines, header `// STUB — owner: <package>`) for files owned by later packages (§5.1 rule 4).

**M0 exit gate** (all must hold, signed by the core author, reviewed by the Producer):
- `npm run typecheck && npm run build && npm run check` → 0 errors, 0 warnings from core files.
- `/?bench=coinflip` playable at ≥ 60 fps at 1080p (GTX 1060 / Iris Xe class), PSX look matching ART §1 (side-by-side screenshot
  at 400×225 reviewed by Opus), 4 KB of console output max, no errors over 60 s.
- Bench table demo: 2 seats, bot plays 10 rounds, `act → onAction → emit → present` verified; snapshot round-trip passes.
- Kit gallery `/?bench=kit` shows every assembly; mannequin GLB loads ≤ 1.5 s (cached ≤ 50 ms) and plays `Idle_Loop`,
  `Sitting_Idle_Loop`, `Walk_Formal_Loop` at 15 fps stepping.
- EN ⇄ TR switch live in the bench (prompt, toasts, marquee texts redraw).
- Rebuild ×10 leaves geometries/textures within +5 % of baseline.
- TECH §11 additions present in the frozen types; `docs/qa/api-changes.md` created (empty log).

### 2.3 M1 — Vertical slice
Scope:
- **Menu & intro**: GDD §9.1 boot (notice 2.5 s, splash 1.5 s, PRESS ANY KEY), jackpot menu (ART §7 geometry, GDD §9.3 entries;
  stations may show placeholder panels except SETTINGS), PULL → JACKPOT (SUN ×3) → crack → shatter → cut at 4.45 s → land on
  SP-0 at 4.50 s → C01 Wake → C02 The First Quota → control; CONTINUE path.
- **The pit**: all 13 zones blocked out at final dimensions (GDD §8.3–§8.6) with collision and grilles; the nave (Mouth, Well,
  Lobby) fully dressed (ART §6.2–§6.4, §6.7), lighting per GDD §8.7; wings dark behind grilles with dust-sheet teasers; trapdoor
  plates; lift car + doors + call panel; wall clock, floor dial, Quota Board; the Sump; out-of-order props in every non-M1 slot.
- **Machines**: The Big One (full catalogue rules + juice + milestones L10/L25), coinflip reference; others out-of-order.
- **Systems**: Debt Terminal (deposit/withdraw, quota breakdown, SETTLE lever, OPEN THE FLOOR lever, BELL ROPE), Hotline (H38,
  H01, H02, H03, H08 + Deadline Call favours F01–F17), Pawn Window + Charm Board with the 22 Common charms, Concession Desk
  read-only stub (Ledger of Leases view), Service Plate + Upgrade Ledger with **Payout and Cap** tracks.
- **Run**: Debt Run mode, Nights 1–3 schedule (GDD §2.4), Watch timeline (Bell / Play / Last Call / Closing / Settle /
  Intermission / Dawn Collection), pulls, interest + activity clause, overpay, Settle Early, House Limit, Ascent (C05), trapdoor
  (C04) → Sump receipt → CLIMB AGAIN / BACK TO THE JACKPOT, Tickets, save/continue after every resolved action.
- **Player**: FPS controller, glide, viewmodel (coin idle, deposit throw, phone handset, punch-card/JackID raise), footsteps.
- **HUD** (GDD §10.1 subset: pocket, tickets, clock, Night line, quota bar, pulls, charms, prompt, event feed, phone indicator),
  pause "The Ledger" (RESUME, JACKID, CHARMS, RUN INFO, SETTINGS, ABANDON, SAVE & QUIT), Settings (Video, Audio, Controls,
  Gameplay: language, subtitles, Calm Mode toggle stub).
- **Audio**: all SFX the slice uses, House babble + subtitles, menu theme "Inside the Jackpot", "The Lounge", Collection cue,
  trapdoor; ambience beds.
- **Collector**: Dawn walk (12 fps), PAID stamp, SHORT head turn (avatars + story + horror-lite in world-sys).

**M1 exit gate**:
- A tester completes a solo run from boot through Night 3 (pay) **and** a run that falls at Night 1 (short), 3 times each, with
  no console errors; timings: Night 1 = 3 × 150 s Watches; burst timeline within ±0.1 s of GDD §9.4.
- Big One bench Sim: lines + clusters RTP 92.6 % ± 0.3 at luck 0 over 4 M spins; 153 % ± 1 at luck 10.
- 60 fps at 1080p in the Well looking at The Big One with the chandelier, and ≥ 55 fps in the worst nave view; draw calls ≤ 300.
- Save → reload mid-Watch resumes with the clock frozen; reload never rerolls a spin.
- EN and TR complete for every shipped string (`npm run check`); TR fits all diegetic canvases.
- Opus review of screenshots: menu, burst, Well, Mouth, Lobby, Big One play pose, Dawn PAID, trapdoor, Sump receipt.

### 2.4 M2 — All machines + full single player
Scope:
- **All 39 machines** in waves (§4.5): models (Opus) and logic (Sonnet) per Appendix A; system devices: Concession Desk (orders,
  improvements, wings), Cashier, Apothecary, Jukebox (12 songs), Tape deck, Bounty Board, Moth Shrine.
- **Run complete**: Nights 1–8 + Overdrawn (Night 9+ with House Rules), Topside ending (C08 street set), Descend (C07 + layers
  S1–S4), secret ending (C09), Wing Keys + Parlour (C10), punch card, Lamps, Tilt, Heat/Overheat, affinity, the 71-charm launch
  cut (#1–60, 82–86, 90–95), all 39 calls + 17 favours, buffs/tonics/events/shrine, Dread tiers + horror behaviours + Visitation,
  notes (24), tapes (8), cassettes (6), full tycoon (6 tracks, milestones, Attendants, Shills, orders, improvements, Holdings,
  Assessment), kits, House Edge 0–10, Foundations, achievements (36), stats, Daily and seeded runs, Free Casino SP.
- **Cutscenes** C01–C17 (SP), all zone themes + jukebox songs + stingers.

**M2 exit gate**:
- Every machine passes the machine DoD (§7.3) incl. its catalogue RTP regression in bench Sim (± tolerance of MACHINES_machines
  §19.5 / MACHINES_tables §1.9 #7) — results in `docs/qa/rtp.md`.
- `tools/sim/run.mjs` (100,000 runs per policy) within ±5 pp of GDD §3.12 pass rates at every Night for all four policies, and
  tycoon targets at Topside (staff income 20–40 % of the N8 quota for Median).
- A tester finishes an 8-Night run (≈ 75–95 min) and reaches Topside; another Descends at Night 4; Overdrawn to Night 10 by debug.
- Performance: worst view (Gallery or Boiler with all machines in attract) ≤ 300 draw calls, ≤ 70 k tris, frame JS ≤ 2 ms,
  60 fps target / 50 fps floor.
- 0 known blockers; TR complete.

### 2.5 M3 — Multiplayer + server browser
Scope: transports (BroadcastChannel, WebRTC, WS relay, Trystero optional), session (host/client, clock sync, replication,
private events, late-join snapshots, rate limits, kick/votes, 300 s disconnect hold), lobby server (+ `/daily`), server browser
(LOBBY / SAME BROWSER / GLOBAL tabs, columns and filters of GDD §9.6), host form (GDD §7.6 settings), JOIN BY CODE, invite links
`?join=CODE`, RECENT, the Lift lobby (ready on the B7 button, host START, optional jackpot-burst intro for all), Co-op (shared
quota ×(1 + 0.85(N−1)), voted withdrawals, transfers, Collateral Clause on the brass X, ghosts + bail), Versus (lockers, rent,
ghost Bless/Curse, Ghost Call, PvP caps), Free Casino (SI presets, House Credit), chat/emotes/pings, scoreboard, cutscene sync +
skip votes, remote avatars with masks and nameplates, RESUME ROOM.

**M3 exit gate**:
- 4-tab BroadcastChannel soak, 60 min co-op Nights 1–4: no desync (run hash compared every Bell), no error.
- Two machines on a LAN via WebRTC and via forced relay (`?net=relay`): join, chat, move, play a solo machine, play a table,
  late join mid-Watch, kick, host leaves → clients return to the menu cleanly.
- Every one of the 39 machines passes the 2-tab spectator + late-join snapshot test (`docs/qa/mp-machines.md`).
- Bandwidth at 8 players: client up ≤ 4 KB/s, host up ≤ 60 KB/s. Server survives 1,000 garbage messages.
- Server browser handles 0 / 1 / 200 rooms and the lobby-offline banner; single player never blocked by network errors.

### 2.6 M4 — Polish and v1.0 content lock
- Juice review: Opus records each machine (attract, bet, anticipation, every win tier, loss, coin pour) and files fixes; every
  machine re-signed.
- Performance pass (budgets of TECH §8 and §11.7), mannequin LOD (6 fps beyond 8 m, frozen beyond 12 m, ≤ 24 animated).
- Accessibility: Reduce Flashing (≤ 3 Hz, ≤ 40 %), Calm Mode, subtitles, HUD scale, colour-blind shapes, hold-to-confirm.
- Balance: knobs in GDD §3.12 order only; re-run sims; no RTP changes to machines.
- TR 100 % reviewed by Haiku + spot-checked by Opus; credits (CC0 thanks), boot notice, one-box deploy (`npm run build` +
  `PORT=8787 npm run server`) tested.
**M4 exit gate**: 0 crash bugs, 0 blocker/major bugs open, all DoDs green, Producer sign-off.

### 2.7 Parallel lanes (who works when)
| Lane | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| Opus core / integrator | core | integration, reviews | integration, reviews | integration | sign-off |
| Opus modelers MOD-A…F (6) | read docs | bigone (A) + wave-1/2 models | waves 3–4 models | model fixes | juice/visual polish |
| Opus world-arch, avatars, menu-3d, story, music-score, sysmdl | read, sketch | M1 scope | full scope | MP lift lobby set, masks | polish |
| Sonnet systems (20 packages) | read, drafts on paper | M1 scope | full SP scope | MP scope | fixes |
| Sonnet machine coders MC-1…8 | read catalogues | mc-bigone (MC-1), mach-shared | waves 1–4 | 2-tab fixes | juice fixes |
| Haiku game-data, i18n, qa-sim | transcribe tables (data drafts) | M1 data, TR, sims | all data, sims | MP checklists | final TR + sims |

---

## 3. Content tiers (BRIEF Addenda 5–8 pool + GDD extras; nothing is dropped)

**T1 = ships in v1.0 (M0–M4). T2 = next drop (v1.1, M5+). T3 = later.** T2/T3 items need a short design spec from Opus before
any code (data-driven, plugging into the existing systems).

| Item (source) | Tier | How it lands |
|---|---|---|
| Seven floors below the city (A5) | T1 | The pit Ascends one floor per paid Night B7 → G (GDD §2.7), wings carry the floor themes |
| F6 Card Rooms / F5 Arcade / F4 Racetrack / F2 Chapel of Chance (A5) | T1 | Card Room, Midway (claw, cyclone, stacker, derby), Parlour (Devil's Table, shrine, shell game) wings |
| F1 Penthouse final Collector (A5) | T1 | Night 8 "The Final Note" (C11, Collector stays at the terminal) |
| F3 Vault + heist event, secret floor B13, hidden rooms / vents / safe-cracking (A5) | T3 | new zone + event |
| Elevator rides with music and random events between floors (A5) | T1 (Ascent C05, lift lobby) / T2 (random lift events) | |
| Boss deadlines: The Twins (N4 baccarat duel), The Accountant (N6 audited blackjack), The Rat King (N7 derby), THE HOUSE (N8 multi-phase slot boss); per-night ante modifiers (A5) | T2 | `ShiftRuleDef kind:'boss'/'ante'` data + 1 cutscene each |
| Nightly events: Blackout, Happy Hour, Audit, Power Surge, Lucky Moon (= Full Moon) (A5) | T1 | GDD §3.8.4 (9 events) |
| Nightly events: Flood, Rat Swarm, VIP Whale, Wedding of the Mannequins, Hunt (A5) | T2 | event data + world FX |
| Cheating system (marked cards, loaded dice, roulette magnet, slot shim, security patrols, finger tax) (A5) | T3 | card counting already T1 |
| Loan shark (A5) | T1 | H03 Loan Shark |
| Pawn abstract things (shadow, reflection, name) (A5) | T2 (name via `blank_jackid` is T1) | curse items in the Pawn Window |
| Bar & vending: tonics / mints (A5) | T1 | The Apothecary (8 tonics) |
| Bartender NPC + cocktail mini-game (A5) | T3 | |
| Tycoon: place/upgrade/staff/order machines, improvements, wings (A1, A5) | T1 | GDD §3.7 |
| Tycoon: rotate/skin/name machines (A5) | T2 | Service Plate options |
| Ghost NPC guests with needs, grime/repair, R&D lab, machine fusion, marketing, gala nights, insurance (A5) | T3 | |
| Progressive network jackpot shared by all machines and friends (A5) | T2 (`net` pool) | Big One meter and Lotto/Ledger pools are T1 |
| Slot/poker tournaments (A5) | T3 | |
| Party content: spectator side-bets, charm trading, coin-flip duel "Call It" (A5) | T2 | |
| Liar's Dice, Dice Duel (A5, A6) | T2 (Parlor Pack) | |
| Loans between friends, sabotage / bribe a dealer, co-op Vault heist (A5) | T3 | H22 Silent Partner sabotage is T1 |
| Ghost haunting (A5) | T1 | co-op Whisper/Ping, Versus Bless/Curse |
| Emote wheel, pings (A5) | T1 | |
| Proximity voice (A1, A5, A8) | T2 | GDD "tier 2" |
| Characters with perk + flaw (A5) | T1 as GDD kits (11); T2 adds The Widow, The Priest, The Magician, The Twin | |
| Stakes ladder (8 stakes) (A5) | T1 | House Edge 0–10 |
| Daily seed (A5) | T1; weekly challenge T2 | |
| Achievements 120+ (A5) | T1: 36 (GDD §11.7); T2: expand to 120 | |
| Almanac / Codex (A5) | T1 | LEDGER → COLLECTION (Charm Book, Machine Plaques, notes, tapes) |
| Hall of Losers (A5) | T1 lite (Sump Wall, last 50 JackIDs); T2 posed mannequins in the pit | |
| Photo mode (A5) | T3 | |
| NPC cast: House, Collector, Fortune Teller, Mannequin staff (A5) | T1 | |
| Mira the ghost guide (A5) | T3 (Vell's tapes/notes fill the guide role in T1) | |
| Rat King, Bartender (A5) | T2 (boss) / T3 | |
| Accessibility set (A5) | T1 | GDD §6.12, §9.8 |
| Parlor wing with multi-seat card tables 2–8 players + bots (A6) | T2 "Parlor Pack": a Lift destination **P** (separate wing south of the Lobby, 6 table slots) | |
| SON KART / LAST CARD (UNO-like, never "UNO") (A6) | T2 | new catalogue `MACHINES_parlor.md` (Opus) |
| OKEY, PİŞTİ, TAVLA (with doubling cube) (A6) | T2 (Turkish classics, high appeal) | |
| BATAK, BLÖF, Crazy Eights, Durak, Hot Potato Bomb, "The Mole" (A6) | T3 | |
| Devil's Table shell duel with items, 2–4 PvP (A7) | **T1** | MACHINES_tables §5A |
| "Pay the quota or sit at the Devil's Table" boss deadline (A7) | T2 | boss rule |
| Shared bank + shared debt + "who lost what" feed (A8) | T1 | co-op rules + event feed |
| Real-time shift timer (A8) | T1 | Watches are real-time (150–210 s) |
| Randomised machine line-up per floor visit (A8) | T2 | Busy-floor style override per Night |
| Totems — physical radius items (A8) | T2 | Phase-0 `TotemsApi` types exist; key B reserved |
| Collateral porcelain body parts (eye, ear, mouth, hand, legs; carry friends) (A8) | T2 | Phase-0 `CollateralApi` types exist; porcelain, never gore |
| Stake-style originals: Tower Climb, Cross the Hall, Limbo, Dice Over/Under (A8) | T2 "Originals Pack" | catalogue section by Opus |
| Duck/Rat race variants (A8) | T1 (derby) | |
| Charms #61–81, #87–89, #96–100 | T2 | GDD §4.2 launch cut |
| Free Casino host migration | T3 | TECH §6.4 |

---

## 4. Final machine list

### 4.1 Roster (39 gambling machines)
Tier = catalogue scope tier (1 hero/first playable · 2 core v1.0 · 3 stretch, still v1.0 in this plan). Kind: `solo` =
`MachineBase` (occupant authority), `shared` = `TableBase` (host authority). Wave = build order inside M2 (§4.5).

| # | id | EN name | TR name | Suit | Tier | Kind (seats) | Default slot(s) | Zone | Wave | Rules |
|--:|---|---|---|---|:-:|---|---|---|:-:|---|
| 1 | `bigone` | The Big One | Büyük Vurgun | REELS | 1 | solo | WELL-01 | well | M1 | MM §2 |
| 2 | `bandit` | One-Armed Bandit | Tek Kollu Haydut | REELS | 1 | solo | WELL-04, WELL-06, GAL-07, GAL-08 | well | 1 | MM §3 |
| 3 | `videopoker` | Video Poker "Jacks Up / Deuces Down" | Video Poker | CARDS | 1 | solo | CARD-04, CARD-05 | cards | 2 | MM §4 |
| 4 | `elevator` | The Elevator (crash) "SERVICE CAR" | Asansör | CURIOS | 1 | shared (8) | MID-01 | midway | 2 | MM §5 |
| 5 | `scratch` | Scratch-Card Vendor | Kazı Kazan Otomatı | REELS | 1 | solo | LOB-01 | lobby | 1 | MM §6 |
| 6 | `pachislot` | Pachislot "Oni Feast" | Paçislot «Oni Ziyafeti» | REELS | 2 | solo | GAL-01..03 | gallery | 3 | MM §7 |
| 7 | `pachinko` | Pachinko "Deep Rain" | Paçinko «Derin Yağmur» | DROPS | 2 | solo | LAU-03..05 | laundry | 3 | MM §8 |
| 8 | `plinko` | Plinko Board | Plinko Çivi Tahtası | DROPS | 2 | solo | WELL-09 | well | 1 | MM §9 |
| 9 | `coinpusher` | Coin Pusher "The Shelf" | Jeton İtici «Raf» | DROPS | 2 | shared (2) | LAU-06 | laundry | 3 | MM §10 |
| 10 | `cyclone` | Cyclone Light Ring | Siklon Işık Çemberi | WHEELS | 2 | solo | MID-06 | midway | 3 | MM §11 |
| 11 | `mines` | Mines Terminal | Mayın Tarlası Terminali | CURIOS | 2 | solo | WELL-11 | well | 1 | MM §12 |
| 12 | `dicetower` | Dice Tower | Zar Kulesi | DICE | 2 | shared (4) | BOI-03 | boiler | 3 | MM §13 |
| 13 | `lootbox` | Mystery Capsule Vendor | Sürpriz Kapsül Otomatı | REELS | 2 | solo | GAL-06 | gallery | 3 | MM §14 |
| 14 | `claw` | Claw Crane | Pençe Vinç | CURIOS | 3 | solo | MID-03, MID-04 | midway | 4 | MM §15 |
| 15 | `stacker` | Stacker | İstif Kulesi | CURIOS | 3 | solo | MID-05 | midway | 4 | MM §16 |
| 16 | `fruitmachine` | Fruit Machine "Nudge & Hold" | Meyve Makinesi «Dürt & Tut» | REELS | 3 | solo | GAL-04, GAL-05 | gallery | 4 | MM §17 |
| 17 | `bingopin` | Bingo Pinball | Tombala Langırtı | DROPS | 3 | solo | LAU-08 | laundry | 4 | MM §18 |
| 18 | `roulette` | Roulette "The Bone Wheel" | Rulet (Avrupa) «Kemik Çark» | WHEELS | 1 | shared (6) | WELL-02 (+WH-04 busy floor) | well | 1 | MT §2 |
| 19 | `blackjack` | Blackjack "Twenty-One" | Blackjack (Yirmi Bir) | CARDS | 1 | shared (5) | WELL-03 | well | 1 | MT §3 |
| 20 | `holdem` | Texas Hold'em "The Long Table" | Texas Hold'em Poker «Uzun Masa» | CARDS | 1 | shared (8, bots) | CARD-01 | cards | 2 | MT §4 |
| 21 | `devilstable` | The Devil's Table (SHELLS + Six Chambers) | Şeytanın Masası | WHEELS | 1 | shared (4) | PAR-01 | parlour | 2 | MT §5A, §5 |
| 22 | `baccarat` | Baccarat "The Mirror Table" | Bakara «Aynalı Masa» | CARDS | 2 | shared (7) | CARD-02 | cards | 3 | MT §6 |
| 23 | `craps` | Craps "The Bone Pit" | Craps Zar Masası «Kemik Çukuru» | DICE | 2 | shared (8) | BOI-01 | boiler | 3 | MT §7 |
| 24 | `sicbo` | Sic Bo "The Birdcage" | Zar Kafesi (Sic Bo) | DICE | 2 | shared (8) | BOI-02 | boiler | 3 | MT §8 |
| 25 | `bigsix` | Big Six "The Six-Score Wheel" | Büyük Altı Para Çarkı | WHEELS | 2 | shared (8) | WH-01 | wheels | 3 | MT §9 |
| 26 | `cardwar` | War Table (War / Dragon-Tiger) | Savaş Masası | CARDS | 2 | shared (8) | CARD-03 | cards | 3 | MT §10 |
| 27 | `hilo` | Hi-Lo Ladder | Yüksek-Alçak Merdiveni | CARDS | 2 | solo | WELL-08 | well | 1 | MT §11 |
| 28 | `keno` | Keno Lounge | Keno Salonu | DROPS | 2 | shared (4, draw) | LAU-02 | laundry | 3 | MT §12 |
| 29 | `derby` | Rat Derby "The Rat Run" | Mekanik Fare Derbisi | CURIOS | 2 | shared (8, draw) | MID-02 | midway | 3 | MT §13 |
| 30 | `fortuneteller` | Fortune-Teller "Mother Moth" | Falcı Otomatı «Güve Ana» | CURIOS | 2 | solo | MOUTH-01 | mouth | 1 | MT §14 |
| 31 | `coinflip` | Coin-Flip Booth | Yazı-Tura Kabini | DICE | 2 | solo | WELL-13, BOI-05 | well | 1 | MT §15 |
| 32 | `threecard` | Three Card Poker | Üç Kart Poker | CARDS | 3 | shared (6) | order only (CARD-08) | cards | 4 | MT §16 |
| 33 | `reddog` | Red Dog "The Kennel" | Kırmızı Köpek «Kulübe» | CARDS | 3 | shared (6, draw) | order only (CARD-08) | cards | 4 | MT §17 |
| 34 | `bingo` | Bingo "Hall of Calls" | Tombala Salonu (Bingo) | DROPS | 3 | shared (8, draw) | LAU-01 | laundry | 4 | MT §18 |
| 35 | `lottoblower` | Lotto Ball Blower "The Breath" | Loto Küresi «Nefes» | DROPS | 3 | shared (4, draw) | LAU-07 | laundry | 4 | MT §19 |
| 36 | `tombola` | Tombola Raffle Drum | Piyango Tamburu | WHEELS | 3 | solo (shared drum) | WH-02 | wheels | 4 | MT §20 |
| 37 | `shellgame` | Shell Automaton "Monsieur Thimble" | Bardak Oyunu Otomatı «Mösyö Yüksük» | CURIOS | 3 | solo | PAR-02 | parlour | 4 | MT §21 |
| 38 | `fantan` | Fan-Tan | Fan-Tan (Düğme Sayma) | CURIOS | 3 | shared (6) | WH-03 | wheels | 4 | MT §22 |
| 39 | `teetotum` | Put-and-Take Top | Al-Ver Topacı | DICE | 3 | shared (6, PvP + bots) | BOI-04 | boiler | 4 | MT §23 |

MM = `docs/machines/MACHINES_machines.md`, MT = `docs/machines/MACHINES_tables.md`. Default placement = 48 instances of 37 types
(GDD §8.6); `threecard` and `reddog` exist only through Machine Orders.

### 4.2 Physical specification (binding for modelers; every value ≤ its GDD §8.5 slot class)
Caps: tris / draw calls after `kit.finalize`, excluding kit stools/chairs and mannequin actors (ART §1.11). Colourways: number of
`variant`s required (4 when the type has several instances).

| id | Class | Final footprint W × D × H (m) | Tris cap | Draws | Colourways | Play pose (ART §4.5 class) |
|---|:-:|---|--:|--:|:-:|---|
| bigone | XL | 1.80 × 1.40 × 3.10 on the 4.0 × 4.0 × 0.15 dais | 3,500 | 24 | 1 | standing on dais |
| bandit | M | 0.44 × 0.42 × 1.48 | 900 | 14 | 4 | standing upright |
| videopoker | M | 0.62 × 0.95 × 1.40 (incl. stool) | 900 | 14 | 4 | seated slant |
| elevator | XL | 4.60 × 2.50 × 3.70 (shaft cabinet 1.60 × 1.00 × 3.70 + 8 stations) | 2,400 | 24 | 1 | standing station |
| scratch | M | 0.90 × 0.80 × 1.85 | 900 | 14 | 1 | standing booth |
| pachislot | M | 0.60 × 0.95 × 1.80 (incl. counter + stool) | 1,100 | 14 | 4 | seated stool |
| pachinko | M | 0.60 × 0.85 × 1.62 (incl. stool) | 1,300 | 14 | 4 | seated low stool |
| plinko | M | 1.20 × 0.35 × 2.40 | 1,200 | 14 | 1 | tall wall machine |
| coinpusher | L | 1.40 × 1.20 × 1.95 | 1,400 + coins | 20 | 1 | standing, per station |
| cyclone | M | 1.00 × 0.85 × 2.10 | 1,000 | 14 | 1 | standing |
| mines | M | 1.10 × 0.90 × 1.60 | 1,000 | 14 | 1 | standing console |
| dicetower | L | 2.40 × 1.80 × 1.80 (table Ø1.30) | 1,300 | 20 | 1 | table seat |
| lootbox | M | 0.80 × 0.80 × 1.90 | 1,100 | 14 | 1 | standing |
| claw | M | 0.90 × 0.90 × 1.95 | 1,300 | 14 | 4 | standing |
| stacker | M | 0.90 × 0.80 × 2.30 | 800 | 14 | 1 | standing |
| fruitmachine | M | 0.70 × 0.60 × 1.80 | 1,100 | 14 | 4 | standing upright |
| bingopin | L | 0.75 × 1.40 × 1.90 (+ stool) | 1,300 | 14 | 1 | above playfield |
| roulette | XL | table 2.60 × 1.30, footprint ≤ 4.6 × 2.4 | 2,500 | 20 | 2 | table seat |
| blackjack | L | table 2.10 × 1.10, footprint ≤ 2.5 × 1.8 | 1,800 | 20 | 1 | table seat |
| holdem | XL | table 2.80 × 1.40, footprint ≤ 4.6 × 2.5 | 2,500 | 20 | 1 | table seat |
| devilstable | L | 2.40 × 1.80 × 2.10 (table Ø1.10) | 1,600 incl. rig | 20 | 1 | chair |
| baccarat | L | table 2.40 × 1.20, mirror ≤ 2.40 high | 1,700 | 20 | 1 | table seat |
| craps | XL | tub 3.20 × 1.50 × 0.92, footprint ≤ 4.6 × 2.5 | 2,500 | 20 | 1 | rail spot |
| sicbo | L | 2.40 × 1.40 × 1.60 | 1,300 | 20 | 1 | standing spot |
| bigsix | L | counter 2.40 × 0.60 + wall wheel Ø1.80 (top 3.05) | 1,600 | 20 | 1 | standing spot |
| cardwar | L | table 2.40 × 1.10, footprint ≤ 2.6 × 1.8 | 1,400 | 20 | 1 | table seat |
| hilo | M | 0.90 × 0.60 × 2.30 | 900 | 14 | 1 | standing upright |
| keno | L | 2.60 × 1.40 × 1.60 + wall board 3.00 × 1.80 | 1,400 | 20 | 1 | desk seat |
| derby | XL | 4.40 × 2.20 × 3.00 (track 4.00 × 1.20) | 1,600 | 20 | 1 | rail spot |
| fortuneteller | M | 1.00 × 0.80 × 2.25 | 1,500 | 14 | 1 | standing booth |
| coinflip | S | 0.78 × 0.78 × 2.00 | 700 | 10 | 4 | standing booth |
| threecard | L | table 1.80 × 0.90, footprint ≤ 2.4 × 1.6 | 1,500 | 20 | 1 | table seat |
| reddog | L | table 1.80 × 0.90, footprint ≤ 2.4 × 1.6 | 1,500 | 20 | 1 | table seat |
| bingo | XL | 4.60 × 2.50 × 2.60 | 1,800 | 24 | 1 | bench seat |
| lottoblower | M | 1.20 × 0.95 × 2.20 | 1,500 incl. balls | 14 | 1 | kiosk |
| tombola | L | 2.40 × 1.20 × 2.30 | 1,100 | 14 | 1 | standing stall |
| shellgame | M | 1.20 × 0.80 × 2.00 | 1,000 incl. automaton | 14 | 1 | standing booth (locked during shuffle) |
| fantan | L | 2.40 × 1.80 × 1.80 (table 1.40 × 1.40) | 1,200 | 20 | 1 | cushion (eye 1.05) |
| teetotum | L | 2.40 × 1.80 × 2.00 (table Ø1.20) | 1,100 | 20 | 1 | table seat |

### 4.3 System devices (same machine contract, `category:'system'`)
| id | Slot | Class / size | Model essentials (Opus) | Logic essentials (Sonnet) | M |
|---|---|---|---|---|:-:|
| `debt_terminal` | MOUTH-TERM | M, 1.20 × 0.90 × 2.40 | ART §6.6 alcove + House emblem eye (`emblemLid`), red 10-digit `leds.quota`, amber `leds.deposit`, CRT 256 × 192 amber, keypad `keys.{p10,p25,p50,all,rest,0–9,enter,bail,yes,no}`, deposit mouth with chewing `mouthLips`, card/receipt `printer`, `settleLever`, `floorLever`, `bellRope` (separate collider at its right), `readyChain`, `swipe` slot, `collectorHand` anchor | GDD §2.6, §2.7, §10.2: deposits (coin stream 0.6 s, 60 digits/s), withdraw 15 % cut (co-op vote), quota breakdown, interest, Settle Early, Bell rope / OPEN THE FLOOR, card printing, BAIL, Ready, Collector hand-off | M1 |
| `hotline` | MOUTH-PHONE, LOB-PHONE2 | M, 0.95 × 0.95 × 2.30 | ART §6.6 booth, rotary phone (`handset`, `dial`, coiled cord), RING lamp `#FFD34A`, nixie target `leds.target`, pickup pose (0,1.62,0.25)→(0,1.45,−0.40) | GDD §5 ring cadence 1.0/0.7 s × 10 s, answer E, choices 1/2/3 in 8 s, babble + subtitles, addressed calls, party line | M1 |
| `charm_vendor` (Pawn Window) | LOB-PAWN | wall, 2.0 m counter | barred window, sliding `tray`, banker's lamp, ledger, ringed `hands`, `itemSlots[4]` with price tags, roll-down `shutter` | GDD §4.1 stock, odds, reroll/lock/remove curse, buy/sell | M1 |
| `concession_desk` | LOB-DESK | wall, 3.0 × 1.0 | desk, Clerk mannequin anchor, brass `bell`, Ledger of Leases book (`pages`), catalogue binder, wing buttons | GDD §3.7: Ledger of Leases, orders, improvements, wing purchase, staff roster | M1 view / M2 full |
| `cashier` | LOB-CASH | wall | ART cashier cage as a 2.4 m wall window, 2 teller windows + trays, cashier mannequin, money counter | Free Casino House Credit, co-op second Pawn Window (N ≥ 4) | M2 |
| `tonic_vendor` (The Apothecary) | LOB-TONIC | M, 1.00 × 0.85 × 1.95 | ART CURIOSITIES body, 2 × 4 coils with 8 bottles, keypad, flap | GDD §3.8.3 tonics (4 of 8 stocked), max 3 per Watch, drink 1.2 s | M2 |
| `jukebox` | LOB-JUKE | M, 1.00 × 0.65 × 1.60 | ART jukebox, 12 song strips, bubble tubes | GDD §6.9: 1 Ticket per song, song buffs, MP latest wins | M2 |
| `tape_deck` | LOB-TAPE | S | cassette deck on a side table, 8 tape slots, VU needles | play collected tapes T-1…T-8 with subtitles | M2 |
| `bounty_board` | MOUTH-BOUNTY | wall 1.6 × 1.0 | corkboard, 3 contract cards (64 × 48 canvases), DONE stamp | GDD §11.9 bounties (from Night 3) | M2 |
| `shrine` (Moth Shrine) | PAR-SHRINE | S | small altar, 64 candle slots, moth statue, offering slot | GDD §3.8.5 blessings / curses, once per Watch | M2 |

### 4.4 World props (package `world-arch`, logic hooks in `world-sys`)
Wall clock Ø2.4 (MOUTH-CLOCK), floor dial B7…G (MOUTH-DIAL), lift call panel (Wing Key buttons, ▼ DESCEND, G), the Lift car +
doors (GDD §8.3), double-sided split-flap Quota Board 4.0 × 1.5 (WELL-BOARD), Big One dais 4.0 × 4.0 × 0.15, trapdoor plates
(every walkable 2 × 2 m plate, two hinged halves), roll-down grilles (4 m), Parlour velvet curtain + padlocked chain, MANAGEMENT
door, brass X plate (MOUTH-X), Charm Board pegboard 1.6 × 1.0 (LOB-BOARD), PAD "FOR LEASE" stands + chalk outlines, ceiling
delivery hatch + crate on chains (C06b), Collector's chair (PAR-CHAIR), the Furnace (CNT-FURNACE), the Sump (12 × 12 × 4 m, coin
mound Ø6 × 1.2 with 3,000 instanced coins, Sump Wall corkboard, rope ladder, ferryman's bowl, MENU coin), Ascent shaft scroll
behind the clerestory grilles (y 6–7 m), Topside street set (C08, built at y +200: wet asphalt, bus stop, neon `#FF2E88`), the
JACK·ID neon sign (0, 7.0, 1.85), zone signs, posters, ART §6.3 light fixtures and §6.7 dressing props, rope-line stanchions at the
Devil's Table, nav-graph nodes for the Collector and patrons (data), spawn points (GDD §8.8).

### 4.5 Waves (priority inside M2; models may start one wave earlier)
| Wave | Machines | Why |
|---|---|---|
| M1 | bigone (+ coinflip reference from core) | vertical slice |
| 1 | roulette, blackjack, bandit, scratch, hilo, plinko, mines, fortuneteller, coinflip (final) | the 11 hub instances: Nights 1–3 complete |
| 2 | videopoker, elevator, holdem, devilstable | remaining catalogue tier 1 |
| 3 | pachislot, pachinko, coinpusher, cyclone, dicetower, lootbox, baccarat, craps, sicbo, bigsix, cardwar, keno, derby | tier 2: wings complete |
| 4 | claw, stacker, fruitmachine, bingopin, threecard, reddog, bingo, lottoblower, tombola, shellgame, fantan, teetotum | tier 3 |

---

## 5. Work packages and file ownership

### 5.1 Ownership rules
1. Exactly one package owns each file. Globs below are exclusive; an unlisted new file belongs to the package whose folder glob
   contains it.
2. Machine folders: `src/machines/<id>/model.ts` belongs to **`mdl-<id>`** (Opus); every other file in `src/machines/<id>/`
   (`index.ts`, `rules.ts`, `data.ts`, `sfx.ts` …) belongs to **`mc-<id>`** (Sonnet). The coder may stub a local
   `buildModel` inside `index.ts` until the model lands (never in `model.ts`).
3. Strings: each package owns its own `*.strings.ts` (or `def.strings`). `i18n` (Haiku) owns only `src/i18n/{en,tr}.ts` and
   reviews every other TR table read-only, filing fixes in `docs/qa/i18n/` for the owner to apply within one working session.
4. **Stub transfer**: in M0 the core author may create compile stubs in files owned by other packages (header
   `// STUB — owner: <package>`). Ownership transfers to that package at M0 exit; core never edits them again. The same applies
   to `src/machines/coinflip/**`, which passes to `mdl-coinflip` / `mc-coinflip` at the start of M2.
5. Data vs code: `src/game/data/**` is Haiku-owned data (typed tables transcribed from the GDD); engines that read it are Sonnet
   packages. A data change request goes to `game-data`; a rule change request goes to the Producer.
6. `docs/**` design docs are owned by the Producer (this edit pass); `docs/qa/**` by `qa-sim` (except `docs/qa/i18n/**` by
   `i18n` and `docs/qa/api-changes.md` by `core`).

### 5.2 Non-machine packages
| id | Model | Owns (exclusive) | Depends on | Milestones |
|---|---|---|---|---|
| `core` | Opus | `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`, `scripts/check.mjs`, `src/main.ts`, `src/vite-env.d.ts`, `src/core/types.ts`, `src/core/{app,loop,states,events,rng,tween,timers,math,log,dispose,settings,save,i18n,input,keymap,fx,debug}.ts`, `src/core/renderer/**`, `src/core/texgen/**`, `src/core/input/**`, `src/core/fx/**`, `src/core/ui/**`, `src/core/audio/{types,audio,synth}.ts`, `src/core/cutscene/types.ts`, `src/kit/**`, `src/machines/_base/{types,MachineBase,TableBase,registry,cards,reels,tiers}.ts`, `src/world/{types,collision,interact,bench}.ts`, `src/game/types.ts`, `src/game/*.types.ts`, `src/game/{inGameState,benchRun}.ts`, `src/net/{types,protocol,offline}.ts`, `docs/qa/api-changes.md`, (M0 only) `src/machines/coinflip/**` | — | M0, integrator M1–M4 |
| `mach-shared` | Sonnet | `src/machines/_base/{steered,peg2d,dice,wheel,draw,fair,juice,dust,countup,led,patrons}.ts`, `src/machines/_base/bots/**` | core | M1–M2 |
| `world-arch` | Opus | `src/world/{level,layout,zones}.ts`, `src/world/props/**`, `src/world/data/**` | core | M1–M2 |
| `world-sys` | Sonnet | `src/world/{world,lights,visibility,trapdoors,wings,pads,circuitBadge,servicePlate,upgradeVisuals,boards}.ts`, `src/world/world.strings.ts` | core, world-arch | M1–M3 |
| `horror` | Sonnet | `src/world/horror/**` | world-sys, game-run, game-buffs, avatars, cutscene-player | M2 |
| `player` | Sonnet | `src/player/{controller,camera,viewmodel,local,remote,ghost,emotes}.ts`, `src/player/player.strings.ts` | core, avatars | M1–M3 |
| `avatars` | Opus | `src/player/avatars/**` | core | M1–M3 |
| `game-run` | Sonnet | `src/game/{run,economy,payout,shift,quota,pulls,persistence,intents}.ts`, `src/game/modes/**`, `src/game/game.strings.ts` | core, game-data | M1–M3 |
| `game-circuit` | Sonnet | `src/game/circuit/**` | game-run, game-data, world-sys | M2 |
| `game-charms` | Sonnet | `src/game/charms/**` | game-run, game-data | M1–M2 |
| `game-tycoon` | Sonnet | `src/game/tycoon/**` | game-run, game-data, world-sys | M1–M2 |
| `game-hotline` | Sonnet | `src/game/hotline/**` | game-run, game-data, audio-engine | M1–M2 |
| `game-buffs` | Sonnet | `src/game/buffs/**` | game-run, game-data | M2 |
| `game-meta` | Sonnet | `src/game/meta/**` | game-run, game-data | M2 |
| `game-data` | Haiku | `src/game/data/**` | core (types) | M0 drafts, M1–M2 |
| `story` | Opus | `src/game/cutscenes/**`, `src/game/story/**` | cutscene-player, avatars, world-arch | M1–M2 |
| `cutscene-player` | Sonnet | `src/core/cutscene/{player,director}.ts` | core | M1 |
| `menu-3d` | Opus | `src/menu/{menuState,menuScene,menuReels,stations,bootShot,burst,transitions}.ts` | core, audio-engine, music-score | M1 |
| `menu-ui` | Sonnet | `src/menu/{serverBrowser,hostPanel,joinPanel,recentPanel,lobbyState,liftLobbyScene,settingsPanel,pause,credits,foundationsPanel,ledgerPanel,profilePanel}.ts`, `src/menu/menu.strings.ts` | core, menu-3d, game-meta, net-session | M1–M3 |
| `hud` | Sonnet | `src/menu/hud/**`, `src/menu/hud.strings.ts` | core, game-run | M1–M3 |
| `net-transport` | Sonnet | `src/net/transports/**`, `src/net/codec.ts` | core | M2 (tab) – M3 |
| `net-session` | Sonnet | `src/net/{session,clocksync,replication,lobbyClient,party,voice}.ts`, `src/net/net.strings.ts` | net-transport, core | M3 |
| `lobby-server` | Sonnet | `server/**` | — (protocol per TECH §7) | M3 |
| `audio-engine` | Sonnet | `src/core/audio/{sfx,music,voice,ambience,jukebox,mixer}.ts` | core | M1–M2 |
| `music-score` | Opus | `src/core/audio/score/**` | audio-engine | M1–M2 |
| `sysmdl-core` | Opus | `src/machines/{debt_terminal,hotline}/model.ts` | core | M1 |
| `syslogic-core` | Sonnet | `src/machines/{debt_terminal,hotline}/**` except `model.ts` | core, game-run, game-hotline, sysmdl-core | M1 |
| `sysmdl-lobby` | Opus | `src/machines/{charm_vendor,concession_desk,cashier,tonic_vendor,jukebox,tape_deck,bounty_board,shrine}/model.ts` | core | M1–M2 |
| `syslogic-lobby` | Sonnet | the same 8 folders except `model.ts` | core, game-charms, game-tycoon, game-buffs, game-circuit, audio-engine | M1–M2 |
| `i18n` | Haiku | `src/i18n/{en,tr}.ts`, `docs/qa/i18n/**` | core | M1–M4 |
| `qa-sim` | Haiku | `tools/sim/**`, `scripts/qa/**`, `docs/qa/**` (except the two above) | game-data, machine rules | M1–M4 |

### 5.3 Machine packages and lanes
Per machine: **`mdl-<id>`** (Opus, owns `model.ts`, brief = Appendix A "Model brief") and **`mc-<id>`** (Sonnet, owns the rest
of the folder, brief = Appendix A "Logic brief"). `mc-<id>` depends on `core`, `mach-shared`, `mdl-<id>` (Parts type) and is
integration-tested against `game-run`. Lanes are scheduling groups (one agent works its lane top to bottom in wave order):

| Lane | Machines (wave order) |
|---|---|
| MOD-A (Opus) cabinets & reels | bigone, bandit, scratch, videopoker, pachislot, lootbox, fruitmachine |
| MOD-B (Opus) wheels & stalls | roulette, cyclone, bigsix, stacker, tombola, fantan |
| MOD-C (Opus) card tables | blackjack, hilo, holdem, baccarat, cardwar, threecard, reddog |
| MOD-D (Opus) dice & duels | coinflip, devilstable, craps, sicbo, dicetower, teetotum |
| MOD-E (Opus) drops & draws | plinko, pachinko, coinpusher, keno, bingopin, bingo, lottoblower |
| MOD-F (Opus) curios | mines, fortuneteller, elevator, derby, claw, shellgame |
| MC-1 (Sonnet) reels | bigone, bandit, scratch, pachislot, fruitmachine |
| MC-2 (Sonnet) screens & skill | hilo, mines, videopoker, cyclone, stacker |
| MC-3 (Sonnet) drops | plinko, pachinko, coinpusher, bingopin, claw |
| MC-4 (Sonnet) wheels | roulette, bigsix, lootbox, tombola, fantan |
| MC-5 (Sonnet) cards I | blackjack, baccarat, cardwar, threecard, reddog |
| MC-6 (Sonnet) cards II & PvP | holdem, devilstable, teetotum |
| MC-7 (Sonnet) dice | coinflip, craps, sicbo, dicetower |
| MC-8 (Sonnet) draws & curios | fortuneteller, elevator, keno, derby, bingo, lottoblower, shellgame |

### 5.4 Non-machine package briefs (scope summaries; the design sections cited are authoritative)
- **core** — §2.2 in full; afterwards owns integration (`main.ts`, `inGameState.ts`), merges cross-package wiring, reviews every
  API request, keeps TECH §11 in sync with the code.
- **mach-shared** — catalogue §19.2 / tables §24.1 helpers: lane-graph `SteeredPath` (pachinko, bingopin; hop curves for plinko and
  the dice tower), `peg2d`, 64 pre-baked dice trajectories + face remap (craps, sicbo, dicetower; recorded at boot by a seeded
  rigid-body pass), wheel solvers (roulette ball/rotor, Big Six flapper), draw schedulers (keno, bingo, lotto, tombola, fan-tan,
  shared cadences), `FairCommit` (SHA-256 via `crypto.subtle`, FAIR lamp states), juice helpers (GDD §10.4 tiers, §10.5 jackpot
  wave event, coin pour into `anchors.coinOut`, count-up 30 ticks/s, near-miss tease, hitstop), dust accumulator, 7-segment LED
  painter, patron head-turn helper, hold'em bots (Chen preflop + 300-runout Monte-Carlo equity in a Web Worker) and teetotum bots.
- **world-arch** — the GDD §8 level at final dimensions with ART §6 materials and kit of parts; zone data (bounds, ceilings,
  fog/light tables per GDD §8.7 snapped to the 15-bit grid, ART zone-look mapping), `layout.ts` = GDD §8.6 verbatim (+ busy-floor
  override), every §4.4 prop, nav graph data, spawn points; level ≤ 60 k tris and ≤ 80 draw calls (zone-culled).
- **world-sys** — `World` build/dispose and placement rules (TECH §5.3 resolution), per-instance wing locks, light pool +
  flicker + fog blending, visibility (current zone + nave + open wings ≤ 30 m), trapdoor plates (collision toggling, fall
  trigger), pads + delivery, Circuit badge at `anchors.marqueeTop` (suit glyph, 4 Tilt bulbs + TILT tube, Hot/Cold beacons, gold
  Heat chase), Service Plate at `anchors.servicePlate`, tycoon upgrade parts at `anchors.upgradeMounts`, Charm Board, Quota Board,
  wall clock, floor dial, Dread light scaling hooks.
- **horror** — GDD §6.2–§6.5: Dread tiers → lights/fog/music states; flicker events; mannequins that shift only when unobserved
  by every player (outside all frusta, ≥ 6 m, ≥ 2 s); patrons at Cold Lamps and staffed seats; dealers' head tracking; Collector
  sightings, Dawn walk choreography, Visitation patrol (cone 50°, 9 m, crouch halves, seen 1.5 s); footsteps down the shaft;
  whispers; floor creaks; stinger triggers C13–C17 (≤ 1 per Watch); Calm Mode and Reduce Flashing compliance.
- **player** — TECH §11.10 controller, crouch toggle, jump-step, footsteps by floor material, glide, cinematic camera, viewmodel
  (ART §8.5 hands: coin idle flip, deposit throw arc, phone handset, scratch coin, dice handful, capsule twist, tonic drink 1.2 s,
  punch card Q, JackID J), ghost modes (co-op 4 m/s through walls, Versus 6 m/s noclip + follow-cam 1–8), remote avatars
  (interpolation at hostTime − 100 ms, clip selection, sit poses at machines), emotes (wave, point, cheer, shrug, dance).
- **avatars** — mannequin dressing: 8 player masks + colours (ART §8.2), hats, nameplates (ART §8.3), ghost look, the Collector
  (2.4 m, coat `#1A1414`, wide-brim hat, brass face plate with a coin slot `#C8A040`, cream gloves, pocket watch, 12 fps), patrons
  ("guests who lost", 1970s suits, scratched JackIDs), porcelain dealer masks, the Clerk, the Pawnbroker's hands, viewmodel glove
  hands (~150 tris each).
- **game-run** — `RunApi` + GDD §2 (Nights, Watches, Bell / Play / Last Call / Closing / Settle / Intermission / Dawn, pulls,
  quota formula + Assessment, interest + activity clause + ceiling, deposits, withdrawal cut, overpay, Settle Early, House Limit,
  trapdoor, Ascent, Overdrawn), the GDD §3.3 payout pipeline (single choke point, dampener, guard 1,000, dust), currencies
  (coins, Tickets, Obols), modes debt / coop / versus / free (GDD §7), host intents and validation, persistence and offline-ish
  credit, run events (`run:bell`, `run:deposit`, `run:settle`, `run:collect`, `run:ascend`).
- **game-circuit** — GDD §3.4: suits + affinity, punch card (generation, punching, lines, blackout, rerolls), Tilt, Lamps, Heat +
  Overheat, bounty board contracts (GDD §11.9); exposes ModProviders and state for the badge and the HUD.
- **game-charms** — GDD §4: charm engine from data rows + special code charms, Pawn Window stock/odds/rerolls/locks/curse removal,
  pegs, selling, triggers through GameEvents; M1 = 22 Commons, M2 = launch cut of 71.
- **game-tycoon** — GDD §3.7: generated upgrades (6 tracks), costs and buy modes, milestones (`hasFeature`), staff (Attendants with
  1 s ticks and Settle remainder; Shills via `playHeadless`), Machine Orders (prices, delivery, sell-back), wings, House
  Improvements, Holdings / depreciation / Assessment, co-op owners and Versus rent; M1 = Payout + Cap on The Big One.
- **game-hotline** — GDD §5: random-call scheduler, ring/answer/choice flow, 39 call scripts, 17 favours + Deadline Call (co-op
  vote), scripted calls, missed-call forcing, babble voice + subtitles, Versus addressed calls; M1 = H38, H01, H02, H03, H08.
- **game-buffs** — GDD §3.8: buff engine (stacks, durations, scopes, HUD data), tonics, jukebox song buffs, Moth Shrine, global
  events (+ T2 slots), Dread computation (GDD §6.2) published as events; co-op aura.
- **game-meta** — GDD §11: Obols, Descend layers, the Foundations tree, kits, House Edge 0–10, Overdrawn House Rules, 36
  achievements, stats, collectibles, endings flags, Daily / seeded runs, daily challenges, Sump Wall, unlock codes.
- **game-data** — transcribe GDD tables into typed data with EN/TR strings: nights, econ constants, 100 charms (effects as
  `ModEffect`s), favours, calls (meta + text), buffs, tonics, events, bounties, house rules, kits, foundations, achievements, songs,
  notes/tapes keys, tycoon tracks / 39 device rows / improvements / orders. Ask, never invent.
- **story** — C01–C17 timelines (`CutsceneDef` data: camera paths, mannequin cues, lights, audio cues, subtitles, fx), EN/TR story
  text (24 notes, 8 tapes, House voice lines, Vell lore, ending beats), Topside direction; M1 = C01–C05.
- **cutscene-player** — implement `CutscenePlayer` from `src/core/cutscene/types.ts`: letterbox 400 × 170, hold-to-skip 0.8 s
  ring, input lock, every track type, SP pause, MP start at host `t0 + 150 ms`, skip vote > 50 %, late joiners skip.
- **menu-3d** — GDD §9.1–§9.4 on ART §7 geometry: boot, the jackpot menu (centre entries, left context, right lever), stations,
  facet cards EN/TR, PULL → JACKPOT (SUN) → crack → shatter → cut → landing, CONTINUE, return-to-menu, the Collector silhouette
  passing every 40–90 s, the 23:59 clock.
- **menu-ui** — pause "The Ledger" (GDD §9.7), Settings (TECH §11.12), credits, profile (name, mask/colour), Foundations and
  Ledger panels, server browser (GDD §9.6 / TECH §7.4), host form (GDD §7.6), join by code, invite link copy, recent rooms, the
  Lift lobby scene (GDD §9.5: ready on the B7 button, host START).
- **hud** — GDD §10.1–§10.3 on the core canvas layer: pocket ¢, Tickets, staff income, Watch clock + wall time, Night line, quota
  bar + INT, buff bar, pulls, charms row, mini punch card, crosshair states, prompt line, event feed, seated hint strip, phone
  indicator, Dread vignette, Upgrade Ledger (U) with the Holdings → Assessment preview, punch card (Q) / JackID (J) views,
  scoreboard (Tab), chat (T), results = The Sump receipt + Night clock pie, juice banners and number pops flying to the HUD.
- **net-transport** — TECH §6.2 backends (BroadcastChannel first, then WebRTC, relay, Trystero) + fragmentation codec.
- **net-session** — TECH §6.3–§6.5 + §11.4: host/client sessions, clock sync, transform replication, machine envelopes incl.
  `mevp`, run snapshots/deltas, late-join ordering, rate limits, kick/votes, 300 s rejoin hold, room codes and `?join=`, lobby
  client, chat/emote/ping messages, cutscene messages, proximity voice (T2).
- **lobby-server** — TECH §7 (`/api/health`, `/api/rooms`, ws `/lobby` ops, rooms registry + expiry, limits, ICE passthrough,
  static `dist/`) + `GET/POST /daily` top-100 board.
- **audio-engine** — SFX recipes for every `SfxName` + Kenney CC0 layering (pitch ±8 %), positional voices (≤ 32), buses incl.
  voice, music scheduler (25 ms tick, 100 ms lookahead, bar-quantised changes, 2 s crossfades, ducking), instrument patches and
  lo-fi master + PSX reverb (GDD §6.9), adaptive layers, House babble formant voice + `speechSynthesis` option, ambience beds.
- **music-score** — the menu theme, 9 zone themes, the House motif, 12 jukebox songs (AABA, 32 bars, 3 voicings per bar, fills,
  2 solo options), Collection / trapdoor / Topside cues, stingers, cutscene cues — all as seeded data for `audio-engine`.
- **sysmdl-core / syslogic-core / sysmdl-lobby / syslogic-lobby** — the 10 system devices of §4.3.
- **i18n** — `common.*` / `ui.*` tables (TECH §9.3 + §11.9), formatter suffix tables, TR review of everything, length checks
  (TR ≤ EN × 1.35 on diegetic canvases).
- **qa-sim** — catalogue RTP regression sims, GDD §3.12 run sims (4 policies × 100,000 runs), budget capture, per-milestone test
  checklists, MP soak scripts; reports only, no design changes.

### 5.5 Common machine contract (applies to every machine brief in Appendix A)
- `model.ts`: `export type <Id>Parts`, `export function buildModel(kit, o: ModelOpts): MachineModel<<Id>Parts>`; origin at the floor
  centre of the footprint, +Z = player side, metres; static geometry merged with `kit.finalize` (parts passed in `keep`); every
  part's origin is its pivot and `object.name` = key; detail nodes flagged `userData.lodDetail = true`; text only via canvas
  (`TextSource {key}`); no `THREE.Light`.
- **Standard anchors** on every machine: `speaker`, `prompt`, `label`, `marqueeTop` (Circuit badge mount), `servicePlate`
  (0.12 × 0.08 brass Level plate mount), `upgradeMounts` (side points for tycoon visual parts), `stand` (solo machines),
  plus `coinOut` when it pays into a tray and `light` / `light2` (≤ 2) when it glows. Tables also expose `seats: SeatDef[]`.
- Diegetic CREDIT / BET / WIN 7-segment windows (`leds.credit/bet/win`, `#FF3020` on `#200404`, 64 × 16 each; one rail meter per
  seat on tables) unless the brief says the screen shows them.
- `index.ts`: `export const def` (with §11.5 fields), `export default class`, `export const playHeadless`; state mutated only in
  `present()`; `this.rng` per round; bets via `beginRound` / `addStake` / `settle`; limits from `run.betLimits`; tycoon
  milestones via `run.tycoon.hasFeature`; EN + TR strings from the catalogue.

---

## 6. Dependency graph (build order)
```
core ──┬─► mach-shared ──► mc-<id> (×39) ◄── mdl-<id> (×39) ◄── core
       ├─► world-arch ──► world-sys ──┬─► horror ◄── game-buffs, avatars, cutscene-player
       │                               ├─► game-tycoon, game-circuit
       ├─► game-data ──► game-run ──┬─► game-circuit, game-charms, game-tycoon, game-hotline, game-buffs, game-meta
       │                            └─► hud, syslogic-core, syslogic-lobby
       ├─► avatars ──► player (remote), story
       ├─► cutscene-player ──► story
       ├─► audio-engine ──► music-score ──► menu-3d ──► menu-ui
       ├─► sysmdl-core / sysmdl-lobby ──► syslogic-*
       ├─► net-transport ──► net-session ──► menu-ui (browser, lobby), game-run (MP modes)
       └─► i18n, qa-sim (continuous)
lobby-server: independent (TECH §7), integration-tested in M3
```
Critical path to M1: core → (world-arch ∥ game-data ∥ audio-engine ∥ cutscene-player ∥ mdl-bigone) → (world-sys ∥ game-run ∥
mc-bigone ∥ menu-3d) → (hud ∥ syslogic-core ∥ game-charms ∥ story C01–C05) → core integration.

---

## 7. Definition of Done

### 7.1 Every package
Only owned files touched · `typecheck`, `build`, `check` green · no console errors or warnings over 60 s of use · every visible
string via i18n with EN + TR · no new dependencies · no `Math.random` in outcomes, no `setTimeout` in gameplay · subscriptions
disposed · final report lists files, public API, open requests to other packages, known issues.

### 7.2 Machine model (`mdl-<id>`, Opus)
1. Footprint, class, tris and draw-call caps of §4.2 met (bench F3 screenshot attached); origin, +Z front, pivots, names.
2. Every part and anchor named in its Appendix A brief exists with the stated pivot and range of motion; the exported Parts type
   matches.
3. ART palette and material presets only; ART tessellation rule; 2–5 % dead bulbs seeded; colourways per §4.2.
4. Horror-twist hook implemented or exposed (`anchors.fxTwist` or named part).
5. Visual check at 400×225, jitter MEDIUM: silhouette reads at 6 m; main controls and screen glyphs read from the play pose
   (≥ 2 internal px); nothing important thinner than 1 internal px at 2 m. Opus review approves the screenshots.
6. `dispose()` frees owned resources; Rebuild ×10 within +5 %.

### 7.3 Machine logic (`mc-<id>`, Sonnet)
1. `def` complete (id, category, slotSize = §4.2 class, seats, shared, min/max bet, actionCost, suit, staffable, tier, rtp,
   maxPayoutMult, strings EN/TR) and rules match the catalogue section exactly.
2. **RTP regression** in bench Sim within the catalogue tolerance (MACHINES_machines §19.5; MACHINES_tables §1.9 #7: ±0.3 pp over
   10^7 rounds, 10^6 for holdem, bingo, derby); skill machines meet their stated average/expert band with the reference bot.
3. Logic/present split respected; snapshot round-trip; stand-up at any time (deferred while busy, safe defaults on tables);
   disconnect paths per the catalogue; per-round RNG; private events for hidden info.
4. Hooks: every hook in the brief is read through `mod()` with the TECH §11.3 name and verified with the bench sliders; tycoon
   milestones L10/L25/L50/L100 implemented; `playHeadless` exported and used by the Sim.
5. **Juice checklist** (BRIEF Addendum 8): idle attract mode; bet placement feedback; anticipation (rising pitch, slowing reels or
   lights, near-miss tease); escalating small / medium / big / huge / mega / jackpot sequences (GDD §10.4–§10.5); loss feedback;
   coins physically pour into the tray (`fx` at `anchors.coinOut`) and fly to the HUD; sound on every interaction; big wins seen
   and heard by other players.
6. M3: 2-tab spectator test (same animation and outcome for the watcher) and late-join snapshot test pass.

### 7.4 Systems / UI / net / data / audio
- Systems: the cited GDD sections implemented with their exact numbers; unit-level checks in `docs/qa/<package>.md`; host/client
  paths both exercised (offline host counts as host).
- Menu/HUD: fully keyboard + mouse operable; PSX look per ART §10; EN and TR fit without overflow (TR ≈ +25–35 %); server browser
  handles 0 / 1 / 200 rooms and lobby-offline.
- Net: SP works with zero network; 2 tabs, 2 machines (WebRTC) and forced relay pass the M3 script; server survives 1,000 garbage
  messages; bandwidth budgets met.
- Data (Haiku): tables match the GDD row-for-row (diff report attached); every row has EN + TR; no invented values.
- Audio: ≤ 32 voices, no clipping at the compressor, music state changes bar-quantised, ducking under voice and stingers, every
  cue in the GDD tables present.

### 7.5 Milestone gates
M0–M4 exit gates of §2 are the only acceptance criteria for a milestone; the Producer signs them in `docs/qa/milestones.md`.

---

## 8. Verification and tooling
| Tool | Owner | Use |
|---|---|---|
| `npm run typecheck` / `build` / `check` | core (check.mjs) | every report |
| `/?bench=<id>` (+ Sim, Rebuild ×10, force outcome, sliders, F3) | core | every machine package |
| `/?bench=<id>&net=tab` (2 tabs) | core + net-session | M3 machine checks |
| `/?seed=<code>&skipmenu=1` | core | straight into a Debt Run |
| `tools/sim/*.mjs` (machine RTP), `tools/sim/run.mjs` (run policies) | qa-sim | M1 Big One, M2 all |
| `scripts/qa/soak.mjs` (4-tab MP soak, run hash per Bell) | qa-sim | M3 |
| Screenshot / recording reviews at 400×225 | Opus (core + modelers) | every model, every milestone |
| `docs/qa/rtp.md`, `mp-machines.md`, `milestones.md`, `api-changes.md`, `i18n/*` | qa-sim / core / i18n | records |

---

## 9. Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| 39 machines × (model + logic) | schedule | 6 Opus + 8 Sonnet lanes in parallel; waves; out-of-order fallback keeps every partial build playable; tier-3 machines may slip to M4 without blocking the M2 gate only if the Producer re-scopes in writing |
| Phase-0 type churn | rework across 70+ packages | TECH §11 frozen at M0 exit; change log; adapters inside core instead of signature changes |
| Solo machines run on the occupant (TECH model) | a modded client can foresee its own outcomes | accepted casual-trust risk (TECH §6.6); hidden-information devices are host tables |
| Mannequin GLB 7.6 MB | boot time, memory | load once at boot step 9 behind the PRESS ANY KEY screen; clone with SkeletonUtils; LOD 6 fps > 8 m, frozen > 12 m, ≤ 24 animated |
| Performance with 78 slots, mannequins and juice | frame drops | zone visibility, 6-light pool, instancing, ART caps, M2/M4 perf gates |
| Economy balance across 39 devices × 100 charms × tycoon | dominant strategies | GDD §3.11 rules, sims with 4 policies, knob order fixed, machine RTPs never tuned |
| Determinism (float / browser differences) | MP desync | integer weights, outcome-first payloads, host-only physics (coin pusher), run hash per Bell in soak |
| Turkish text length on 128-px canvases | clipped UI | +35 % layout allowance, abbreviations reviewed by Haiku, Opus spot checks |
| Tone (horror vs gambling, porcelain collateral later) | rating / taste | GDD §6.12 taste rules, Calm Mode, no gore; T2 Collateral is porcelain only and opt-out |
| IP proximity (CloverPit, UNO, Buckshot Roulette, GWYF) | legal | original names/art everywhere; Producer checklist before content lock |

---

## 10. Open questions (need the director's / client's call; work proceeds on the stated default)
1. Free Casino host migration is deferred to T3 (default: room closes; host can RESUME ROOM). Acceptable for v1.0?
2. The coin-flip "Call It" duel and spectator side-bets are T2 (default: not in v1.0).
3. Parlor Pack placement: a Lift destination "P" (separate wing south of the Lobby) — confirm before the T2 catalogue is written.
4. Proximity voice is T2 (GDD "tier 2"); confirm it is not needed for the v1.0 friends test.
5. Collateral porcelain body parts (Addendum 8) vs GDD "no body horror": default = porcelain prosthetic visuals only, opt-out with
   Calm Mode; confirm tone.
6. Boss Nights (Addendum 5) are T2 on top of the GDD Night structure; confirm they should not replace Night 4/6/7 rules in v1.0.
7. Character names from Addendum 5 (The Gambler, The Widow, The Priest, The Magician, The Twin) vs GDD kits: default = GDD kits in
   v1.0, the named characters join as kits in T2.
8. Room-code alphabet (TECH, no I/O/0/1) replaces GDD Crockford — confirm the printed example codes.
9. The 7 machines without ART entries (lootbox, fruitmachine, bingopin, threecard, reddog, fantan, teetotum) use the Appendix A
   model briefs written to ART conventions — approve or request ART sections.
10. Balance check of the SHELLS mode payout (1.9 × S at a tuned 50 % Devil win rate) once the AI exists; Producer may retune the
    AI, never the payout.

---

## Appendix A — Machine briefs (modeler and coder contracts)

Each machine has two briefs: the **Model brief** for `mdl-<id>` (Opus; `model.ts`, exported Parts type — the part and anchor
names below are the contract) and the **Logic brief** for `mc-<id>` (Sonnet; everything else in the folder). Both follow §5.5.
Numbers come from the cited catalogue sections; where a brief and a catalogue differ on a *rule*, the catalogue wins and the
Producer fixes the brief; where they differ on *size or look*, this appendix (ART-reconciled) wins.

### A.1 `bigone` — The Big One · Büyük Vurgun

Tier 1 · solo · slot WELL-01 · zone `well`

**Model brief (`mdl-bigone`, Opus).** XL hero cabinet 1.80 W × 1.40 D × 3.10 H (ART §5.1); root = top of the world-owned 4.0 × 4.0 × 0.15 dais at WELL-01, rotY 180. Y bands: plinth 0–0.20 walnut + 0.03 brass kick; belly 0.20–0.95 with glass art 1.40 × 0.55 (JackID coin sinking into black, painted "THE BIG ONE"); deck 0.95–1.05 (+0.12, 10° slope); LED strip 1.08–1.18; reel window 1.25–1.95 (chrome frame 1.40 × 0.70); top box 1.98–2.55; 13-ray sunburst crown 2.55–3.10. Body enamel_red P12, gold_trim, walnut sides with 3 brass chevrons each, two magenta neon tubes 1.6 m on the front edges. Parts (exact keys): reels[0..4] (ReelPart r 0.55, w 0.26, gap 0.02, 16 facets, axis y 1.60, per-reel CanvasTexture strip 32×512 the coder repaints), cellFrames[15] (emissive 0.26 × 0.21, index r·5+c), paylineLamps[6], patternLamps[14] on the left brass pattern plate 0.40 × 0.90, lever + leverKnob (pivot (0.95,1.20,0.10), chrome arm r 0.025 l 0.95, knob icosa 0.075 P14; pull = +1.05 rad about X), buttons.betDn/betUp/betMax/auto/spin/info, leds.credit(8)/bet(3)/win(8)/jackpot(8), hungerNeedle (semicircle dial 0–5 %, rotation.z), last10[10] lamps, screens.top (amber CRT 160×48), bulbs (88: 48 crown + 40 window), crownRays[13], medallion (JackID coin r 0.22 at (0,2.80,0.62), spins Y), topLid (hinged 25°), tray, glass (ADD 0.25), glassCrack (decal, visible until first upgrade), fogDecal, palmDecal. Anchors: speaker, prompt, label, marqueeTop, servicePlate, upgradeMounts, stand, coinOut (0,0.38,0.70), insideGlass (menu burst camera point), light (crown (0,2.9,0.4) P20 1.2 r6 BUZZ), light2 (window (0,1.6,1.0) P09 0.8 r4). Budget ≤ 3,500 tris, ≤ 24 draw calls, ≤ 6 textures. Single colourway. Must read at 6 m and from the play pose (0,1.62,1.50)→(0,1.50,0.45) FOV 58.

**Logic brief (`mc-bigone`, Sonnet).** MACHINES_machines §2. 5×3 independent cells, weights /100: MOTH 19, TOOTH 19, KEY 17, CANDLE 17, RING 11, CROWN 10, SUN 7 (values 1,1,2,2,3,4,7); MAW curse and GHOST wild (charm-only). Patterns §2.2 with absorption, CLUSTER ≥ 7 (×(n−5)), FULL 1/4000★ = ×40 + JACKPOT meter (seed 50 × max stake, feed 1 %, lobby-shared host pool 'bigone'; House-Limit excess feeds it, GDD §2.6.6). Spin order §2.3: curse roll min(0.05, 0.015+0.0025k), fill roll, grid, GHOST injection, luck coalesce min(0.30, 0.01·L), teaser MAWs, evaluate. win = stake × Σ(value × patternMult), dust-floored; machine reports base gross only. Stake ladder 1–100 via run.betLimits; actionCost 1 pull; autoplay 5/10/25 (stops on bigwin, curse, jackpot, funds, pulls). Controls: Space/LMB spin, lever drag ≥ 60 % in 0.6 s, wheel/Z/X stake, B max, G auto, 1–5 hold reel (charm), H pattern card, F fast, E stand. States ATTRACT/READY/COMMIT 0.05/SPIN_UP 0.15/SPINNING/STOPPING (reel n at 1.00+0.25n s, 0.12 s bounce)/TEASE 1.4/EVAL ≤3.3/PAYOUT/BIGWIN 3/5/7/EATEN 3.2/JACKPOT 9 (GDD §10.5 pit-wide gold wave). Events: spin {grid, pre?, curse, curseCol, fill, fillSym, teaser, coalesced, tease, hold}, eval {pays, clusters, total}, meter, jackpot. Tags win/bigwin/hugewin/megawin/jackpot/curse/nearmiss, bigone:pattern:X. Hooks m.bigone.symbolValueAdd.SYM, symbolValueMult, symbolWeight.SYM, symbolBan.SYM, patternMult.P, extraPattern, wildChance, curseChanceMult, curseWard, jackpotFeed, respin, holdReel; x.jackpotChance; events onPattern/onCurse/onFill. Milestones (hasFeature): L10 feed 1.5 %, L25 CORNERSTONE, L50 wild 0.02, L100 TWIN RAILS + holdReel. First purchased upgrade removes glassCrack. Snapshot {grid, meter, hungerK, last10, round}; playHeadless exported. Menu reels reuse the same symbol painters.

### A.2 `bandit` — One-Armed Bandit · Tek Kollu Haydut

Tier 1 · solo · slot WELL-04, WELL-06, GAL-07, GAL-08 · zone `well`

**Model brief (`mdl-bandit`, Opus).** M slot, footprint 0.44 W × 0.42 D × 1.48 H (ART §5.2): walnut pedestal 0.40 × 0.40 × 0.78 carrying a 1930s cast-metal head 0.44 × 0.42 × 0.70 with a half-cylinder crown r 0.22, two eye-shaped vents above the reel window and a "maw" window below it. Parts: reels[0..2] (ReelPart r 0.10, width 0.075, 22 facets = the 22 physical stops of catalogue §3.2, strip 32×704: STAR, PLUM, ORANGE, MELON, BAR, 2BAR, 3BAR, SHOE, blank pinstripe), window 0.30 × 0.11 with a red payline bar #D02020; lever (pivot (0.24,1.18,0), chrome arm 0.42 r 0.012, rotation.x 0→1.05 rad, trip point 0.86 rad) + leverKnob (icosa 0.035) + leverLatch (visible lock while spinning); coinSlot (brass, top); cup (payout bowl Lathe r 0.05) with anchors.coinOut; mawCoins (InstancedMesh 30, count shows jackpot size); awardGlass (paytable plane 0.40 × 0.20, canvas 128×64); leds.credit/bet/win (64×16 each on the belly glass); lamps.reel, lamps.coinAccepted, lamps.tilt; eyeVents (emissive, glow P15 for the horror twist). Colourways via variant 0–3 (brass/enamel_red/P01 knob, chrome/cobalt/P14, gunmetal/green/P09, gold_trim/black/P14). Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light (reel lamp P20 0.5 r1.2 CANDLE), fxTwist. Reel top/bottom facets vertex-shaded ×0.6. Budget ≤ 900 tris, ≤ 14 draws, ≤ 5 textures. Play pose standing (0,1.42,0.62)→(0,1.15,0) FOV 50, slightly right so the lever shows.

**Logic brief (`mc-bandit`, Sonnet).** MACHINES_machines §3. 3 reels × 22 physical stops mapped from 64-stop virtual reels (§3.2 strips; reel 2 rotated +7); centre line only; paytable per credit §3.3 (STAR×3 1,000 and 5,000 total at 3 credits; ANY BAR 15; SHOE 2/6/50). RTP 91.96 % (1–2 cr) / 92.98 % (3 cr). Bet = credits 1–3 × denomination; the denomination set is {1,5,25} × 10^k with k = max(0, floor(log10(max/75))) from run.betLimits. actionCost 1; autoplay allowed. Lucky Nudge: on a loss with p = min(0.30, 0.01·L) apply the best single-stop nudge (never creates STAR×3); nearmiss tag rule §3.4. x.jackpotChance gives an extra (mult−1)/65,536 forced STAR×3. Controls: LMB-drag lever (release ≥ trip angle) or Space auto-pull 0.45 s, wheel/Z/X credits, V denomination, B max (3 credits), G autoplay, K thump (3 in 10 s → TILT 8 s lock), H paytable, E stand. States READY/LEVER/COMMIT 0.05/SPIN (stops 1.20/1.60/2.00 s)/NUDGE 0.35/PAY (1 visible coin per credit, ≤ 40)/TILT 8. Events: lever {angle} (cosmetic, ≤ 15 Hz), pull {credits, denom, stops[3], nudge, combo, pay}, tilt {until}. Hooks m.bandit.symbolPayAdd.SYM, shoeWild, thirdCoinBonus, thumpLuck, extraLine (credits 4–5 add top/bottom lines), onNudge. Milestones L10 extraLine, L25 shoeWild, L50 thirdCoinBonus ×2, L100 symbolPayAdd.STAR +1,000/credit. Polished Molar charm: SHOE +1 per credit. Juice §3.11 (mechanical bell per 10 credits, hopper coins into the cup, jackpot overflow onto the floor). Horror: maw coins swallowed after 5 losses; after wall-clock 03:00 the lever needs 30 % more drag. WELL-04 hosts the note "Vell's Ledger" (H39). Snapshot {stops, tiltUntil, round}; playHeadless exported.

### A.3 `videopoker` — Video Poker "Jacks Up / Deuces Down" · Video Poker

Tier 1 · solo · slot CARD-04, CARD-05 · zone `cards`

**Model brief (`mdl-videopoker`, Opus).** M slot, footprint 0.62 W × 0.95 D × 1.40 H: slant-top kitCabinetShell (h 1.40, d 0.70) plus a bar stool (seat 0.68) at z +0.40 inside the slot depth. CRT 0.48 × 0.36 tilted back 25° (bulged 6×4 mesh, scheme cyan, canvas 160×120: paytable y 0–55, five 32×48 cards y 60–107, status line y 110–119). Top box with a kitMarquee neon_cyan "JACKS UP · DEUCES DOWN". Wide button deck under the glass. Parts: screen (ScreenSurface 160×120), buttons.hold0..4 (0.06 × 0.04 P09, lit P19 when held), buttons.deal (0.08 × 0.05 P19, label DEAL/DRAW), buttons.betOne, buttons.betMax, buttons.double (yellow), buttons.collect (P13), buttons.game (small toggle Jacks Up / Deuces Down), marquee, stool. Colourways variant 0–3: enamel_cobalt + chrome, enamel_black + gold_trim, enamel_cream + brass, enamel_red + chrome. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (CRT implicit light 0.4 m in front, P38 0.4 r1.5), fxTwist (53rd cursed card / K portrait turn). No physical cards; all card art is drawn by the coder from the texgen card atlas. Budget ≤ 900 tris, ≤ 14 draws, ≤ 5 textures. Play pose seated (0,1.18,0.62)→(0,0.98,0.08) FOV 50; CRT glyphs must land ≥ 2 internal px tall at 400×225.

**Logic brief (`mc-videopoker`, Sonnet).** MACHINES_machines §4. Two games, toggled with G at READY (no autoplay): Jacks Up (8/5 Jacks or Better, 97.30 % optimal) and Deuces Down (NSUD-type, 99.73 %); paytables §4.2 per credit, royal at 5 credits 4,000. Bet = credits 1–5 × denomination {1,5,25}·10^k (run.betLimits). Fresh Fisher–Yates 52-card deck at DEAL; replacement cards from deck[5..9] in order; double-up §4.4 (dealer card + 4 face-down, pick one; higher doubles, equal push, lower loses; ≤ 5 steps; cap 4,000 credits; free, via addStake 0). actionCost 1 per hand. Luck "Second Look": a losing final hand redraws its replaced cards once with p = min(0.30, 0.01·L), keep the better. Controls: 1–5 hold, Space/Enter deal/draw, D double, Q or C collect, Z/X/wheel credits, V denomination, G game, B bet max + deal, H, E. States READY/DEAL (5 × 0.12 s)/HOLD/DRAW (0.15 s each)/EVAL 0.5/WIN_DECIDE ≤ 15 s (auto-collect)/DOUBLE_PICK/PAYOUT. Events: deal {game, credits, denom, hand[5]}, hold {mask} (sent with draw), draw {final[5], rank, pay}, double {step, dealer, pick, cards[4], result}. Hooks m.videopoker.payTableUpgrade (9/6 or full-pay deuces), hintOptimal (exact 32-hold enumeration in a Web Worker < 0.5 s, HOLD lamps blink), royalBonus, doubleTieWins, peekCard (Mirror Shoe), bonusQuads. Milestones L10 hintOptimal, L25 payTableUpgrade, L50 bonusQuads, L100 royalBonus ×2. Juice §4.11 (royal: CRT roll glitch, gold backs rain, room bell). Idle 90 s in HOLD → draw with current mask and collect. Shill uses the simple strategy table in data.ts. Snapshot {state, game, hand, held, round}.

### A.4 `elevator` — The Elevator (crash) — "SERVICE CAR" · Asansör

Tier 1 · shared · slot MID-01 · zone `midway`

**Model brief (`mdl-elevator`, Opus).** XL set 4.60 W × 2.50 D × 3.70 H (catalogue §5 v1.1 note + ART §5.19 look). Back: glass-fronted miniature shaft cabinet 1.60 × 1.00 × 3.70 centred at z −0.75: concrete interior, painted log-scale marks ×1, 2, 5, 10, 25, 50, 100, 250 at y = 0.30 + 1.335·log10(m), five shaft bulbs every 0.6 m. Parts: car (brass cage car 0.30 × 0.30 × 0.40 with a 12-tri mannequin passenger, y driven by logic), cable (8 segments) + frayStrands[3] (toggled at ×2/×4/×8), carLight, shaftBulbs (instanced 6), needle (floor dial Ø0.40, B7→G log scale, rotation.z), leds.mult (5-digit amber nixie "×2.47"), boardingClock (flip clock 4 digits), historyBoard (ScreenSurface 160×32, last 20 crashes), fairLamp, roofFlood (white light card for ROOF). Front: 8 rider stations[0..7] on an arc r 1.9 about (0,0,−0.75), angles −60°…+60°: each {post (brass, 1.90 m), strap (leather #5A3A22), strapLamp (LampPart amber/green/red), stepLever (LeverPart 0.25 m brass, pull = cash out), namePlate (LabelPart 128×16)}. seats: 8 SeatDef, avatar 'stand', pose at the station looking at the shaft, free-look ±60°. Anchors: speaker, prompt, label, marqueeTop (cabinet top: "SERVICE CAR" marquee — never "Lift"), servicePlate, cableSpark, dustPuff, light (car P19 0.4 r1.0), light2 (shaft top amber 0.6 r3). Budget ≤ 2,400 tris, ≤ 24 draws. Rusted cage #4A4038 with diamond mesh CUTOUT; concrete_wet shaft; brass dial.

**Logic brief (`mc-elevator`, Sonnet).** MACHINES_machines §5, TableBase with 8 seats + 0–4 cosmetic bot "debtors" (no wallet; seated humans + bots ≤ 6). Phases: BOARDING 8.0 s (stake 1–500 via betLimits; optional auto target presets 1.5/2/3/5/10/20/50/100/250, Shift+wheel ±0.05; Space confirms) → DOORS 1.5 s (bets locked, debited, fair hash broadcast) → RIDE m(t) = e^(0.07t) → SNAP or ROOF (×250) 2.0 s → AFTERMATH 4.0 s. Crash point at DOORS: U 52-bit uniform, crash = min(250, max(1, floor(100·0.96/U)/100)); RTP 96 % for every target. Cash-out: client sends act {out, r, tc}; host accepts at m(max(tRecv − min(rtt/2, 150 ms + lateStep), tLastAccepted)) if < tSnap, else fell. Payout scaling uses run.payoutFactor applied to profit and stake (meta.factorApplied). actionCost 1 per ride joined; watchers free. Luck "Safety Net": on a fall refund 50 % with p = min(0.30, 0.01·L) (tag refund). Falls are tagged loss + bust (Sapper's Badge). Controls: Space or LMB on own lever = step off; wheel/Z/X stake and 1–9 targets during BOARDING; H rules; E leaves only during boarding. Events: phase {phase, endsAt}, seat {p, seat, stake, auto, bot?}, lock {fair}, go {t0} (clients compute m locally), out {p, mult, payout, auto}, snap {crash, tSnap, seed} / roof. Hooks m.elevator.autoInsurance, lateStep, floorBonus, onFall, onRoof. Milestones L10 floorBonus +0.02, L25 lateStep, L50 autoInsurance, L100 luck +5. Disconnect: auto target honoured, otherwise rides to the snap. Juice §5.9 (creak, floor dings, SNAP twang + shriek + wind + impact, car flicker grows with m). Achievement top_floor ×100+.

### A.5 `scratch` — Scratch-Card Vendor · Kazı Kazan Otomatı

Tier 1 · solo · slot LOB-01 · zone `lobby`

**Model brief (`mdl-scratch`, Opus).** M slot, footprint 0.90 W × 0.80 D × 1.85 H: vending machine 0.80 × 0.60 × 1.85 (mustard enamel #C9A227 with black stripes #151515, chrome trim) plus an attached scratch shelf 0.80 × 0.20 at y 1.00 projecting to the front. Glass front shows the 5 card designs as 0.12 × 0.18 plaques (PIT PENNY, LUCKY LADDER, HOUSE vs YOU, BLOOD MOON, THE DEEP END — canvas 32×48 each, texgen). Parts: buttons.card1..5 (selector buttons under each plaque, lit when selected), coinSlot, dispenser (Group; a card slides 0.10 m out of the cardMouth in 0.6 s), cardSlots[0..4] (anchors on the green-felt shelf #1F5A3A where vended cards lie fanned), cardPlanes[0..4] (0.10 × 0.15 meshes; the coder assigns a 128×192 face canvas + a scratch-mask canvas each), deskLamp (LampPart #FFE6B0), scratchCoin (brass Ø0.03) + chain (4-link tube, swings ±6°), lamps.tube (interior fluorescent, DYING), leds.credit/bet/win, marquee "SCRATCH & WIN". Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, flakes (particle emitter on the shelf), light (tube P39 0.7 r2 DYING), fxTwist (the 1-in-150 hand-scrawled panel). Budget ≤ 900 tris, ≤ 14 draws, ≤ 5 textures + dynamic card canvases. Play pose standing, camera 0.28 m above the shelf looking down 70°, FOV 50 (catalogue), so a 128×192 card fills ~40 % of the 225 px frame height.

**Logic brief (`mc-scratch`, Sonnet).** MACHINES_machines §6. Five cards with prices 2/5/10/20/50 (× Stake Index scale via betLimits): PIT PENNY 80.5 %, LUCKY LADDER 82.0 %, HOUSE vs YOU 83.4 %, BLOOD MOON 85.3 %, THE DEEP END 87.8 % (weight tables §6.1, out of 1,000,000). Independent charm-stamp roll per card (1/200 … 1/40, rarity per §6.1) → MachineOutcome.items. Faces generated deterministically from the rolled outcome (§6.2 rules; dev validator asserts no readable win on a losing card); 35 %/30 %/40 % near-miss faces tag nearmiss. Vend 1–5 cards at once (wheel/Z/X quantity); each card costs its price and 1 pull and settles as its own outcome. Scratching: LMB-drag the coin; 6 px brush stamped every 2 px on a 128×192 mask; a zone is revealed at ≥ 55 % cleared; Space = scratch all (1.2 s sweep). Leaving auto-scratches and settles (2 s). Luck: a losing card is upgraded to the lowest prize with p = min(0.15, 0.005·L), decided before face generation. Controls: 1–5 card type, wheel/Z/X quantity, Space vend / scratch all, LMB scratch, H prize tables, E. States READY/VEND (0.3 + 0.8 s per card)/SCRATCH/REVEAL 0.5/SETTLE. Events: vend {cardType, face, charm}, zone {zone}, stroke {pts} (cosmetic ≤ 15 Hz). Hooks m.scratch.topPrizeMult, extraCharmSpot, secondChance (every 10 losers → free PIT PENNY), discount (floor 1), xray. Vouchers: consume run.balance('voucher.pitPenny') from the Receipt Roll charm before charging. Milestones L10 xray, L25 discount 20 %, L50 secondChance, L100 topPrizeMult ×2. Juice §6.9. HOUSE feat: a card prize ≥ ×50.

### A.6 `pachislot` — Pachislot "Oni Feast" · Paçislot «Oni Ziyafeti»

Tier 2 · solo · slot GAL-01, GAL-02, GAL-03 · zone `gallery`

**Model brief (`mdl-pachislot`, Opus).** M slot, footprint 0.60 W × 0.95 D × 1.80 H: cabinet 0.50 × 0.45 × 0.85 sitting on a 0.95 m counter section (top at 1.80) plus a stool (seat 0.65) at z +0.40. Black enamel #111111, magenta trim #E0218A, gold #F2C14E; lantern-festival panel art with a red oni mask (original). Parts: reels[0..2] (ReelPart r 0.085, width 0.065, 21 facets, strip 32×672 per catalogue §7.2: ONI, KOI, REPLAY, LANTERN, FAN, BAR, BLANK), window 0.24 × 0.15 showing 3 rows, screens.lcd (ScreenSurface 160×120 above the reels), buttons.stop0..2 (round 0.035 caps: emissive P38 while spinning, P35 once stopped), buttons.betMax, startLever (short stick + ball left of the stops; press = −0.5 rad about X), leds.credit and leds.payout (2-digit red), trays.medals (scoop 0.40 × 0.12), lamps.side (2 vertical strips × 12 instanced LEDs), lamps.oni (carved oni mask bottom-left) with oniEyes (emissive, ignite #FF1010), lamps.lantern (paper lantern, Lathe 8 seg r 0.05 h 0.09), beacon (rotating red light card on top for BIG), stool. Colourways variant 0–3 (trim magenta / cyan / gold / red). Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut (medal tray), light (lantern P19 0.6 r1.0 when lit), fxTwist (LCD ghost peeks, neck stretch). Budget ≤ 1,100 tris, ≤ 14 draws. Play pose seated (0,1.30,0.55)→(0,1.28,0.05) FOV 50.

**Logic brief (`mc-pachislot`, Sonnet).** MACHINES_machines §7. 3 medals per game × medal value {1,2,5,10,25} (scaled by betLimits); 5 lines. Lever (Space) → per-game lottery out of 65,536 (§7.3: REPLAY, KOI, LANTERN, FAN, BIG, REG by setting) → reels spin 28 stops/s → player stops each reel (J/K/L or 1/2/3, any order); reel control §7.4 (slip 0–4 stops, score +1,000 keep flagged role alignable, −10,000 align unflagged, prefer smaller slip; MISS games avoid visible ONI pairs 50 %). Small flags not aligned are lost; BIG/REG flags carry. BIG "Oni Feast" 24 auto games 3 in / 13 out; REG "Lantern Parade" 8 games. Setting 1–6 rolled per instance per run from the world 'init' stream (S1 40 % … S6 5 %, identical for all peers); end-screen oni colour hints (purple S4–S6, gold S6). Minimum game cycle 4.1 s; auto-stop after 30 s with random presses. actionCost: 1 pull per 3 normal games (charged on games 1, 4, 7 …); bonus and replay games free of coins. One outcome per game; bonus bundled (tag bonus). Luck: BIG/REG weights × (1 + 0.02·L), cap ×1.6; x.jackpotChance × BIG weight. Controls Space lever, J/K/L or 1/2/3 stops, LMB stop buttons, V medal value, B max, H, E; no autoplay. Events: start {v} (flag not sent), stop {reel, press, final}, result {role, medals}, announce, bonus {type, game, medals}, bonusEnd {hintColour}. Hooks m.pachislot.settingPeek, settingShift, slipFrames, bonusGames, replayValue, autoAim, onBonus. Milestones L10 settingPeek, L25 slipFrames +1, L50 settingShift +1, L100 bonusGames +10. A held BIG flag stays on the instance when you stand (scavenge allowed except in Versus). Unit test: no unflagged role aligns in 10 M simulated presses. HOUSE feat: enter BIG.

### A.7 `pachinko` — Pachinko "Deep Rain" · Paçinko «Derin Yağmur»

Tier 2 · solo · slot LAU-03, LAU-04, LAU-05 · zone `laundry`

**Model brief (`mdl-pachinko`, Opus).** M slot, footprint 0.60 W × 0.85 D × 1.62 H: wall frame 0.60 × 0.45 × 1.62 holding a machine 0.55 × 0.30 × 0.90 (bottom at y 0.72) plus a low stool (seat 0.62) at z +0.35. Playfield 0.48 × 0.48 behind glass, tilted 10° back, art "Deep Rain" (night rain over a city, #1A2A5A / #2B6CB0, 64×96) inside a gold frame #E8C060. Parts: field (Group; origin = playfield bottom-left, X right, Y up), nails (InstancedMesh ~200, r 0.0015), lanes (exported data: ~60 nodes in 9 levels {id, x, y} in field coords + edges + sink entry nodes OUT, SIDE_L, SIDE_R, TULIP_L, TULIP_R, START, ECHU, ATTACKER — the coder's path generator depends on it), balls (BallPool 64, r 0.0055 chrome env), tulips[2] (two petal planes each, open 35°), windmills[2] (4 vanes r 0.02), startPocket, eChu (pink #FF4FA0 flaps), attacker (hinged plate 0.08 × 0.02 opening 60°, row of white triangle teeth), screens.lcd (160×120 in the gold frame), holdLamps[4], handle (chrome dial, rotation.z 0 → −2.4 rad), trays.upper, trays.lower, jar (side tube + jar with ≤ 200 instanced lost balls, rust tint over time), ledStrips (neon_magenta), stool. Colourways 0–3 (frame gold / chrome / red / black). Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut (lower tray), light (board backlight P38 0.5 r1.2). Budget ≤ 1,300 tris, ≤ 14 draws. Play pose seated (0,1.22,0.42)→(0,1.20,0) FOV 52.

**Logic brief (`mc-pachinko`, Sonnet).** MACHINES_machines §8. Ball value V {1,2,5} (scaled); hold Space/LMB to fire 1.6 balls/s; wallet debited in 1 s batches; handle strength zones §8.2 (FOUL < 40 % returns the ball; LEFT-SWEET 58–74 % best; RIGHT ≥ 88 % for bonus). Each ball's sink is rolled at launch from the zone/mode/tulip table (tulip Markov 1.8 % / 9.0 %); the path is generated over the model's lane graph (_base/steered.ts), never simulated. Returns: SIDE +5, TULIP +7, START +3 + digital spin (≤ 4 holds), E-CHU +3 + spin, ATTACKER +14. Digital slot: jackpot 1/199★ (kakuhen 1/40); reach table §8.3 (NORMAL / SUPER "Flood" / PREMIUM "The Drain"). Jackpot → ATTACKER 10 rounds (9 balls or 25 s) → 50 % KAKUHEN (odd triple) else normal. RTP ≈ 92.5 % in the sweet zone. actionCost 1 pull per 50 normal-mode balls; outcomes per 50-ball block and per jackpot chain (tags jackpot, bonus). Luck +0.1 % absolute START per point in the sweet zone (cap +3 %); x.jackpotChance × 1/199; payout.mult only on chain payouts. Controls hold Space/LMB fire, wheel ±2 %, A/D ±25 %/s, Shift snap to RIGHT 90 %, V ball value (no balls in flight), H, E. Events: ball {b, zone, sink, s}, spin {n, digits, reach, jackpot, kakuhen}, mode {mode, round}, tray {net} (1 Hz). Hooks m.pachinko.kakuhenRate, attackerPay, tulipBoost, holdMax, sweetWiden, onReach, onJackpot. Milestones L10 tulipBoost +10 %, L25 holdMax +1, L50 kakuhenRate +10 %, L100 sweetWiden ±10 %. Leaving during ATTACKER/KAKUHEN auto right-shoots ≤ 60 s and credits you; remaining kakuhen stays (scavenge, not in Versus). Watchers > 12 m see rain particles only. HOUSE feat: trigger the jackpot.

### A.8 `plinko` — Plinko Board · Plinko Çivi Tahtası

Tier 2 · solo · slot WELL-09 · zone `well`

**Model brief (`mdl-plinko`, Opus).** M slot, footprint 1.20 W × 0.35 D × 2.40 H upright wall board (ART §5.13 "peg drop" look): walnut frame, P01 backboard with a faint P41 deco-fan print, front glass, gold-leaf border. 12 peg rows, row k has k+2 pegs, pitch 0.08 m horizontal × 0.09 m vertical, starting 0.30 below the top funnel; 13 bottom slots 0.08 wide. Parts: pegs (InstancedMesh, chrome 6-seg r 0.008) + pegGrid data {x0, y0, dx 0.08, dy 0.09} so the coder can compute hop targets, fingerPegs[6] (seeded pegs replaced by porcelain mannequin fingers with 2 knuckle rings; twitch ±10°), pucks[0..4] (r 0.035 × 0.012, 10-seg, P09 face + P23 rim), chute (Group sliding on the top rail x −0.50…+0.50, cosmetic insert position), funnel, slots[13] (painted multiplier plates as one canvas 208×16 the coder repaints per risk; colours by value ≥10 #FF2020, ≥2 #FF9020, ≥1 #FFE040, <1 #808080; the centre plate keeps its multiplier over grin art), slotLamps[13], riskSwitch (3-position LOW/MID/HIGH toggle), last12 (lamp row), leds.credit/bet/win on the base, marquee "PLINKO BOARD" neon_cyan. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut (base tray), light (marquee P38 0.6 r3). Budget ≤ 1,200 tris, ≤ 14 draws. Play pose standing (0,1.62,1.35)→(0,1.25,0) FOV 66 so the full board is visible.

**Logic brief (`mc-plinko`, Sonnet).** MACHINES_machines §9. Choose risk LOW/MID/HIGH (multiplier tables §9.2; RTP 96.4 / 96.7 / 96.4 %), stake 1–100 per puck (betLimits), 1–5 pucks per drop. Each puck = 12 independent bits with P(right) 0.5 (u16); slot = number of rights (binomial /4,096; edge 1 in 2,048). Space drops pucks 0.30 s apart; each falls 12 hops × 0.20 s + 0.20 s settle (2.6 s), animated along the peg grid; outcome fixed by the bits. actionCost 1 per drop (not per puck); autoplay allowed (G). Luck "Rubber Pegs": per row, with p = min(0.20, 0.01·L) the puck repeats its previous direction (widens spread). One MachineOutcome per drop with meta.slots. Controls Space drop, 1/2/3 risk, wheel/Z/X stake, [ / ] pucks, LMB hole = cosmetic insert, G autoplay, H, E (pucks in flight resolve). States READY/COMMIT/DROPPING/FALLING/LANDED (label flash 0.4 s)/READY; risk and stake locked until all landed. Events: drop {risk, stake, pucks: [{bits, delayMs, golden?}]}. Hooks m.plinko.goldenSlot (one slot ×2, shown before the drop), extraPuck (free puck, same stake), edgeMult, safetyFloor, onEdge. Glass Funnel charm = extraPuck. Milestones L10 goldenSlot, L25 extraPuck, L50 safetyFloor 0.5, L100 edgeMult ×2. Juice §9.9: peg pings on a C-major pentatonic by row (C7 → C5), pegs flash 0.15 s, HIGH edge → board chase #FF2020 10 Hz + siren 3 s + coin burst. HOUSE feat: land slot 0 or 12.

### A.9 `coinpusher` — Coin Pusher "The Shelf" · Jeton İtici «Raf»

Tier 2 · shared · slot LAU-06 · zone `laundry`

**Model brief (`mdl-coinpusher`, Opus).** L slot, footprint 1.40 W × 1.20 D × 1.95 H, two player stations side by side (catalogue §10): lacquer red #9E1B32 body, chrome #C0C4CA trims, P38 LED strip, glass top, mirror-dark back wall. Playfield shelf 1.00 W × 0.50 D at y 1.00 (mirror-steel #8C949C); pusher block 1.00 × 0.20 × 0.04 moving in z (sinusoid 0.12 m stroke, 2.4 s); front drop edge split at the centre into left/right trays; side gutters 0.025 m with dark tongue-like conveyors. Parts: pusher (Group, z driven), coins (InstancedMesh cap 260, r 0.013 h 0.002, 6-seg, instanceColor for gold), prizes[6] (charm capsules: two-tone half spheres) + goldenPlate, teeth (InstancedMesh 12 porcelain teeth among the coins), chutes[2] (Group sliding 0.48 m across each half), gate (lucky-gate wheel on the back wall turning 0.25 rev/s with a 0.05 slot), bonusReels[3] (small ReelPart r 0.04 in a marquee), walls (left/right side walls that rise), trays[2], gutterConveyors[2] (uvScroll material), stationLamps[2], tiltLamp, leds.L.credit/bet/win and leds.R.credit/bet/win, marquee "THE SHELF". seats: 2 SeatDef (standing, pose 0.70 m above-front of the shelf pitch −35°, FOV 60, offset ±0.30 to each station). Anchors: speaker, prompt, label, marqueeTop, servicePlate, coinOutL, coinOutR, light (interior bulb row P20 0.6 r1.4). Budget ≤ 1,400 tris + coins, ≤ 20 draws.

**Logic brief (`mc-coinpusher`, Sonnet).** MACHINES_machines §10, TableBase with 2 stations; host-only physics-lite sim (60 Hz 2D discs, layers 0–2, pusher AABB, damping 0.90, climb p 0.15 when compressed, unsupported coins drop; cap 260 coins, ≤ 6 prizes). Instance denomination D fixed (betLimits min for the instance, i.e. 1/5/25 × 10^k). Aim the chute (mouse X or A/D), drop with Space/LMB (hold = 3 coins/s). Coins over the front edge credit the station whose half they cross; gutter coins go to the House. Lucky gate entry (≈ 6 % centre / 1 % otherwise) spins the bonus reels: SHOWER S 50 %, SHOWER L 25 %, WALLS 15 % (20 s), PRIZE 8 % (charm capsule 70/25/5), JACKPOT★ 2 % (100 coins + golden plate worth 50 D). Governor keeps RTP 88 % ± 3 % per 400-coin window by adjusting gutter width 0.015–0.035 m and shower size ×0.8–1.2 every 50 coins. Restock to 180 house coins at every Night start. actionCost 1 pull per 10 coins dropped (coins 1, 11, 21 …); one outcome per 10-coin block (payout counted until 10 s after its last drop). Luck +1 % absolute gate chance per point (cap +15 %). Controls aim, drop, K thump (second thump within 20 s → TILT 30 s, 10 front coins slid back), H, E. Events: drop {st, p, x, gold}, snap (4 Hz, players ≤ 12 m), fall {st, n, gold, items}, bonus {reels, result}, tilt {st, until}. Hooks m.coinpusher.goldCoin, wallsUp, showerSize, prizeChance, trayMagnet, onPrize. Milestones L10 wallsUp 20 coins, L25 goldCoin 2 %, L50 prizeChance ×1.5, L100 trayMagnet. Prize capsules grant charms; cassettes 1/150 drops. Unattended tray keeps ≤ 50 coins (scavenge). HOUSE feat: a prize falls.

### A.10 `cyclone` — Cyclone Light Ring · Siklon Işık Çemberi

Tier 2 · solo · slot MID-06 · zone `midway`

**Model brief (`mdl-cyclone`, Opus).** M slot, footprint 1.00 W × 0.85 D × 2.10 H (ART §5.24 body): midnight-blue cabinet #101838 with chrome ribs, deco top with a rotating siren beacon. Front: ring of exactly 48 lamps on radius 0.42 m centred at y 1.30 (8-tri lens discs Ø0.045, InstancedMesh with per-instance colour/intensity). Index 0 at 12 o'clock is the JACKPOT lamp (gold P24 when armed, dark grey #303030 unarmed); for i = 1…47 the value pattern is [0,1,0,3,0,1][i mod 6]: 0 = dim red #401010, ×1 amber #FFA020, ×3 green #30E060; lamp 24 (bottom) carries a painted eye (cosmetic). Value plates around the ring (one 256×256 ring texture). Parts: ringLamps (InstancedMesh 48; helper lampAngle(i) exported), jpLamp (separate LampPart over index 0), centre (round ScreenSurface 64×64 showing the result ×), buttons.stop (red mushroom dome 0.12 on a pedestal deck at 1.0 m), beacon (rotating light card, red when armed), leds.credit/bet/win on the deck, marquee "CYCLONE". Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (moves with the chasing lamp; the coder updates its position at 30 Hz; colour = lamp colour, 0.5 r1.5). Budget ≤ 1,000 tris, ≤ 14 draws. Play pose standing (0,1.55,0.95)→(0,1.30,0) FOV 58 with the STOP dome visible at the bottom of the frame.

**Logic brief (`mc-cyclone`, Sonnet).** MACHINES_machines §11. Stake 1–50 (betLimits). Commit rolls: armed (p = 1/30 × x.jackpotChance + 1 % absolute per luck point, cap +20 %), a lap-speed seed (40–52 lamps/s, smoothly varying per lap) and coast k uniform 0–5. If armed, the JP lamp turns gold before the chase (0.8 s reveal + pit-wide siren). Press STOP (Space/LMB) within 10 s (seeded auto-stop afterwards); the light coasts k lamps while decelerating and pays stake × lamp value; armed JP pays ×25 (cyclone.jpMult). Period-6 layout makes aiming worthless except into the armed JP (1 in 6 aimed). RTP 85.1 % random, ≈ 96–98 % aimed at an armed JP. actionCost 1; no autoplay. The occupant is the authority, so the press lamp is read locally (no RTT correction). States READY/COMMIT/CHASE ≤ 10 s/COAST 0.6 + 0.12k s/LAND 0.5 s blink/PAY. Events: start {stake, armed, speedSeed} (watchers reproduce the chase from t + seed), land {press, k, lamp, value, pay}. Hooks m.cyclone.jpMult, jpWindow (armed only: k drawn 0…5−N, min 0…2), slowMo (×0.8 speed), secondLight (second light 24 lamps behind, better pays), onArmed; x.wheel.nudge (Golden Ratchet: after LAND, N within 3 s pays 25 % stake to move one lamp clockwise). Metronome charm: luck +10. Milestones L10 slowMo, L25 jpWindow +1, L50 secondLight, L100 jpMult ×2. Juice §11.9: 4 ms ticks forming a buzz at chase rate, slowing pitch on coast, 0 = bonk, ×1 chime, ×3 triad, JP siren + 6 s fanfare + gold strobe; 3-lamp fading trail. Horror: once every 5–9 min a lap runs backwards while the sound plays forwards. HOUSE feat: hit the JP lamp.

### A.11 `mines` — Mines Terminal · Mayın Tarlası Terminali

Tier 2 · solo · slot WELL-11 · zone `well`

**Model brief (`mdl-mines`, Opus).** M slot (v1.1), footprint 1.10 W × 0.90 D × 1.60 H: olive-drab steel console #4B5320 with stencilled numbers, top tilted 15° toward the player at 1.00 m, a 5×5 grid of brass tile flaps (0.15 × 0.15, gap 0.02) on a P41 velvet bed (ART §5.20), a kitCrtMonitor on a stalk (0.30 × 0.23, green phosphor #33FF66 on #001A08, strong scanlines, canvas 160×120) showing the multiplier ladder, a chunky keyboard tray, a red guarded CASH OUT switch. Parts: tiles[25] (Groups pivoting on their back edge, flip rotation.x 0 → −1.9 rad, index row-major), coins[25] (gold coin r 0.04 with the jackid texture, hidden until revealed), traps[25] (bear trap: two semicircular jaw Groups jawL/jawR with 6 teeth each, rusty_metal; snap closes in 0.06 s) — or one pooled coin + trap moved under the revealed tile (document which), selector (emissive frame that moves between tiles), screen (ScreenSurface 160×120), cashSwitch (guard flips up, then the toggle), keys (cosmetic), lamp (hooded lamp over the grid), fingerProp (porcelain mannequin finger shown in a trap occasionally — horror, no blood), leds.credit/bet/win. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (hooded lamp P20 0.9 r2), fxTwist. Budget ≤ 1,000 tris, ≤ 14 draws. Play pose standing (0,1.60,0.70)→(0,1.00,0) FOV 55.

**Logic brief (`mc-mines`, Sonnet).** MACHINES_machines §12. Stake 1–200 (betLimits), mine count m 1–24 (presets 1/3/5/10/24 on keys 1–5, [ ] ±1). Space arms the round: Fisher–Yates over 25 cells, first m are mines; the fairness hash is shown at commit and layout + seed revealed at round end (commit–reveal mandatory). Reveal tiles one at a time: safe → mult(k) = 0.97·C(25,k)/C(25−m,k), capped ×1,000 (RTP 97.0 % for every stopping strategy); mine → bust. Cash out any time after ≥ 1 safe tile (Q, C, Enter or the switch); auto cash-out when all safe tiles are revealed or the cap is hit; idle 90 s → auto cash-out (k ≥ 1) or stake refund (k = 0, tag void). Luck "Defuse": the first mine hit is defused (shown, round continues, no multiplier step) with p = min(0.30, 0.01·L), once per round. actionCost 1; no autoplay. Controls WASD/arrows selector, Space reveal, LMB tile, Q/C/Enter cash out, P random tile, [ ] mines, 1–5 presets, wheel/Z/X stake, H, E (= cash out if k ≥ 1). States READY/ARMED (grid drops in 0.4 s)/PICK/REVEAL 0.25/BOOM 1.5/SHOW_ALL 0.8/CASHOUT. Events: start {stake, m, fair}, pick {cell, safe, mult, defused?}, end {result, mult, layout, seed}. Busts are tagged loss + bust. Hooks m.mines.scanner (one safe tile marked; Dowsing Rod), edgeBonus (+0.05× per corner), insurance (bust refunds N %; Sapper's Badge = 100 % once per Watch), capRaise (×2,000), onBust. Milestones L10 scanner, L25 edgeBonus, L50 insurance 25 %, L100 capRaise. Juice §12.10 (rising pings, beating drone, CRT whiteout + burn-in on a mine, ka-ching + green flood on cash-out). HOUSE feat: 8 safe tiles with ≥ 5 mines.

### A.12 `dicetower` — Dice Tower · Zar Kulesi

Tier 2 · shared · slot BOI-03 · zone `boiler`

**Model brief (`mdl-dicetower`, Opus).** L slot (v1.1), footprint 2.40 W × 1.80 D × 1.80 H. Round table Ø1.30 at height 0.90 centred at z −0.15, purple felt #3B1E54 with gold print #E8C060 split into 4 sector bet layouts (UNDER 7, OVER 7, LUCKY 7, DOUBLES, FIELD, CORNERS, EXACT 2–12; one 128×128 radial canvas). Tower at the back edge (z −0.55) in ART §5.32 deco-skyscraper style: 0.30 × 0.30 base stepping to 0.24 at 0.40 and 0.18 at 0.70, 0.90 tall above the table (top at 1.80), walnut + brass bands, funnel on top, 4 internal baffles visible through 4 slit windows (0.02 m), lit-window texture P19 per floor, exit door into a felt tray 0.40 × 0.30 with bumper walls. Four stools at ±25° and ±70° from +Z on radius 0.85 from the table centre. Parts: tower, towerFloors[5] (emissive per floor), baffles[4] (anchors: entry points for the dice path), dice (DicePool 2, translucent red #D0102A 0.035, white pips), tray, chips (ChipPool 200), resultBoard (flip digits, ScreenSurface 32×16 on the tower base), historyPegs[12], skullCuckoo (spring skull that pops from the tower top), phaseLamp (brass-caged bulb), fairLamp, railMeters[4] (credit/bet/win 64×16 each), seatLamps[4]. seats: 4 SeatDef (sit; camera 0.75 m from the felt edge, pitch −40°, FOV 60, tower in view). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (desk lamp P20 0.8 r2). Budget ≤ 1,300 tris, ≤ 20 draws.

**Logic brief (`mc-dicetower`, Sonnet).** MACHINES_machines §13, TableBase with 4 seats. BETTING 10 s (ends early when all seated players press Space Ready): chips in multiples of 2 (2–200 per spot, × betLimits scale), up to 4 spots. LOCK 0.5 s: fairness hash, chips debited. DROP: the shooter rotates among seated players with chips (SP: always you); Space drops (auto after 6 s); two dice d1, d2 rolled at DROP; 2.4 s seeded kinematic path through the 4 baffles and face-remap in the last 0.3 s (_base/dice.ts). RESULT 3 s: payouts §13.2 (UNDER/OVER 1:1 with half back on 7; LUCKY 7 9:2; DOUBLES 9:2; FIELD 1:1, 2 and 12 double; CORNERS 15:1; EXACT 31:1 / 15:1 / 10:1 / 7:1 / 11:2). actionCost 1 pull per drop for each player with chips; one outcome per player per roll with meta.dice = [d1, d2] (Snake-Eye Ring). Luck "Lucky Chip": a losing spot is refunded with p = min(0.30, 0.01·L) per player (dice are shared, never rerolled). Controls LMB spot = chip of the selected value, RMB tap remove, wheel/Z/X chip value (2, 4, 10, 20, 50, 100, 200 × 10^k), R repeat, Backspace clear, Space drop / Ready, H, E. States IDLE/BETTING/LOCK/DROP/RESULT. Events: phase {phase, endsAt, shooter}, bet {p, spot, amount}, clear {p}, lock {fair}, drop {shooter, d, path}, result {total, pair, wins, seed}. Hooks m.dicetower.fieldBoost, sevenPay, parlay, shooterBonus, onDoubles; Chipped Die refund. Milestones L10 fieldBoost (12 pays 3:1), L25 sevenPay, L50 parlay, L100 shooterBonus +10 %. SP: 1–2 cosmetic regulars place fake bets. Juice §13.10 (knocks descending the tower, double rattle, croupier bell, doubles → slit windows glow orange, snake eyes/boxcars → cuckoo skull laugh). HOUSE feat: a doubles roll paying ≥ ×5.

### A.13 `lootbox` — Mystery Capsule Vendor · Sürpriz Kapsül Otomatı

Tier 2 · solo · slot GAL-06 · zone `gallery`

**Model brief (`mdl-lootbox`, Opus).** M slot, footprint 0.80 W × 0.80 D × 1.90 H (no ART entry — follow ART conventions). Red cast-iron stand #8E1B1B (texRust coverage 0.2 over enamel) with brass bands, carrying a glass dome Ø0.60 (kitGlassDome r 0.30, ADD glass) filled with ~60 two-tone capsules (InstancedMesh spheres r 0.03: top half translucent random hue, bottom white P09). Front plate at 1.00 m with three chrome crank handles, each above a coin slot and an enamel badge: TIN #9AA0A6, BRASS #C9A227, GILDED #FFD040 (labels drawn on a 64×16 canvas each). A spiral exit chute (Tube helix, 2.5 turns) inside a glass strip down the stand ends in a hinged flap at y 0.55. Topper kitMarquee 0.70 × 0.18 "MYSTERY CAPSULES" (neon_magenta, 14 bulbs, 2–5 % dead). Parts: dome, capsules (InstancedMesh 60 with setColorAt), cranks[3] (kit.crank r 0.06; turn() animates 3 ratchet clicks), badges[3] (LampPart, lit = selected tier), coinSlots[3], chuteFlap (hinged), rollPath (array of 12 V3 points along the spiral for the rolling capsule), capsuleTop / capsuleBottom (the vended capsule as two hemisphere Groups at revealAnchor, for the shake/twist/pop), revealAnchor (above the flap, item floats here 1.5 s), rarityBeam (vertical ADD plane 0.15 × 2.5; the coder sets colour), leds.credit/bet/win (small panel), marquee. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (dome interior P20 0.5 r1.5), light2 (beam colour, coder-driven). Budget ≤ 1,100 tris, ≤ 14 draws, ≤ 5 textures. Play pose standing (0,1.45,0.70)→(0,1.30,0) FOV 55.

**Logic brief (`mc-lootbox`, Sonnet).** MACHINES_machines §14. Three tiers TIN / BRASS / GILDED at 10 / 40 / 150 × Stake Index (GDD §3.5 wraps the catalogue price). Content table §14.2 per tier: DUD trinket, COINS (weighted amounts), Common / Uncommon / Rare / Legendary / Cursed charm drawn from the GDD charm pool of that rarity (excluding owned non-stackables and banned); value RTP 89–92 %, coin-only ≈ 30 %. Duplicate non-stackable → 50 % of its reference price in coins (tag dupe); empty rarity pool → 100 % reference in coins. Pity: per player, the 10th BRASS/GILDED open without Rare+ is forced Rare+ (counter persists across Nights, resets per run). Tier drawn at crank commit; content revealed at open (watchers share the suspense). Charms are granted on open through the charms service (peg-full → swap prompt). actionCost 1 per capsule. Luck: 1 % absolute per point (cap 20 %) moves from the lowest tier present to the next rarity up. Controls 1/2/3 tier, Space or crank-drag buy, hold LMB + circular drag or Space to open, H content table, E (unopened capsule auto-opens). States READY/PAY 0.3/CRANK 0.9/ROLL 1.2/IN_HAND/SHAKE (0.35 s × 1–3; legendary adds a 0.6 s fake-out before a 4th)/OPEN 0.3/REVEAL 1.5. Events: vend {tier, capColour}, open {content: {kind, id?, rarity?, coins?, dupe?}}; MachineOutcome.items filled. Hooks m.lootbox.pityAt, rerollToken, cursedOdds, discount, onRarity. Milestones L10 pityAt −5, L25 rerollToken, L50 discount 20 %, L100 cursedOdds ×0. Cassettes: 1 in 8 Rare+ opens. Juice §14.9 (ratchet + capsule avalanche, spiral rattle panned round the dome, rarity stingers; Legendary choir + gold beam + 2 s pit-wide bell; Cursed reversed cymbal + violet beam, lights within 6 m dim to 40 %). HOUSE feat: a Rare+ capsule.

### A.14 `claw` — Claw Crane · Pençe Vinç

Tier 3 · solo · slot MID-03, MID-04 · zone `midway`

**Model brief (`mdl-claw`, Opus).** M slot, footprint 0.90 W × 0.90 D × 1.95 H (ART §5.23 + catalogue §15): candy pink #FF5FA2 cabinet with mint trim #7FFFD4, glass play box 0.80³ at y 0.95–1.75 (interior light #FFF0F8), marquee 0.20 tall with 16 chaser bulbs, prize chute at the front-left (0.22 × 0.22 hole with a 0.15 m acrylic guard), control panel at 1.00 m. Parts: gantry (Group moving in X/Z inside the box, 0.05 m margin), clawHead (Group on a cable, Y driven), cable (thin cylinder scaled in Y), prongs[3] (chrome, 2 segments each; close angle 0.6 rad weak / 0.9 rad strong), prizes[20] (8 coin sacks S, 5 M, 2 L in burlap #A0784A with "×5/×8/×20" tag canvases, 3 common charm capsules, 1 rare gold-tinted capsule, 1 golden egg) placed on pileHeight (exported 16 × 16 heightmap of the bumpy two-layer pile), dollHead (porcelain head that turns to the player, never grabbable), chuteLamp (#FFFF80 flash on delivery), joystick (ball top r 0.02 on a 0.08 stick, tilt ±0.35 rad), buttons.drop (dome 0.06 P14), bulbs (16), leds.credit/bet/win, leds.timer (2-digit). Colourways 0–3 (pink, mint, cobalt, oxblood) for the two instances. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut (prize hatch), sideCam (orbit point 70° to the right for RMB side-peek), light (P20 0.7 r1.5), light2 (P43 0.7 r1.5). Budget ≤ 1,300 tris, ≤ 14 draws. Play pose standing (0,1.55,0.75)→(0,1.20,0) FOV 60.

**Logic brief (`mc-claw`, Sonnet).** MACHINES_machines §15. Stake 2–50 (betLimits); 15 s timer (+claw.timer); move the gantry with WASD/arrows at 0.25 m/s (diagonals normalised), Space drops (or the timer does); DESCEND 1.2 s → CLOSE 0.6 → LIFT 1.0 (weak grip: drop check at 0.6) → TRAVEL 1.5 (weak: drop check at 0.8) → RELEASE 0.4 → prize slides out 0.8 → RETURN 1.0. Strong grip★ rolled at commit, p = 0.10 × x.jackpotChance + 1.5 % absolute per luck point (cap +30 %), hidden until the claw closes (claw.xray reveals it). Alignment a = clamp(1 − d/0.05 m, 0, 1) to the nearest top-layer prize's grab point (+0.01 m radius per claw.magnet stack; Magnet Coin gives 3 stacks); lift p = √a × g (g per prize table §15.2); carry strong 0.93 / weak 0.14 (× claw.weakCarry, cap 0.5); failed lifts nudge the prize ±0.03 m (seeded); 3 % self-tumble within 0.08 m of the chute. Golden egg only with strong grip. Prize values: sacks ×5/×8/×20 stake, capsules = 1 common / 1 rare charm, egg ×35. Pile restocks at every Night start. RTP ≈ 80 % average, ≤ 105 % perfect. actionCost 2; no autoplay. Controls WASD move, Space drop, RMB hold side-peek, wheel/Z/X stake (READY only), H, E (= immediate drop). Events: start {stake}, pos {x, z} (20 Hz cosmetic), drop {x, z}, grab {prize, a, lift, strong, dropAt, shift}, deliver {prize}, restock {pile}. Hooks m.claw.xray, timer, weakCarry, magnet, onDeliver. Milestones L10 xray, L25 timer +4 s, L50 weakCarry ×1.5, L100 magnet ×3. Cassettes 1 per 12 deliveries. Juice §15.9 (tinny 132 bpm waltz speeding ×1.25 in the last 5 s, winch noise, servo zzt, sad trombone, delivery fanfare; golden egg lullaby + gold interior). HOUSE feat: deliver a capsule.

### A.15 `stacker` — Stacker · İstif Kulesi

Tier 3 · solo · slot MID-05 · zone `midway`

**Model brief (`mdl-stacker`, Opus).** M slot, footprint 0.90 W × 0.80 D × 2.30 H (ART §5.25): black body #0A0A0A with white neon edges #F0F0FF. LED block grid of 7 columns × 15 rows of 0.07 m square lamp cells in a P01 frame 0.55 × 1.10 at y 0.75–1.85 (105 instanced quads: lit #FF2A2A, off #2A0505). MINOR band at row 10 (amber #FFB020 strip + "MINOR ×2.5" plaque) and MAJOR band at row 15 (gold #FFD040 + "MAJOR ×25"); a prize window above row 15 shows the MAJOR charm capsule on a turntable; painted night-sky cap above, hiding a faint 16th row. STOP dome 0.12 (P19) on the deck at 1.0 m. Parts: grid (InstancedMesh 105 with setCell(col, row, state) and exported cellPos(col, row)), bands.minor, bands.major, prizeTurntable (rotates Y 0.5 rad/s) + prizeAnchor, ghostRow (row 16 emissive at 5 %, horror twist), buttons.stop, leds.credit/bet/win, leds.row (2-digit), marquee "STACKER" (block-letter attract scroll is the coder's job). Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (P38 0.5 r2, the coder moves it to the active row). Budget ≤ 800 tris, ≤ 14 draws. Play pose standing (0,1.55,1.05)→(0,1.35,0) FOV 62; the camera tilts up 0.3° per row reached (coder). Single colourway.

**Logic brief (`mc-stacker`, Sonnet).** MACHINES_machines §16. Stake 1–25 (deliberately low; betLimits). Row 1: a 3-block bar bounces left↔right; Space/LMB stops it; each next row's bar width = the stack top width, capped (rows 1–5 ≤ 3, rows 6–10 ≤ 2, rows 11–15 ≤ 1); overhanging cells fall (0.3 s each); no overlap → game over (0). Speed row r = 5.0 + 0.6·(r−1) cells/s (−2 % per luck point, cap −20 %); from row 8 each traverse speed ×(1 ± 0.20) and an edge dwell 0–120 ms, seeded at commit. Start side alternates. Row 10 complete → MINOR: TAKE ×2.5 or CLIMB (5 s; default TAKE). Row 15 complete → MAJOR: ×25 + a rare charm capsule (stacker.majorCharm +1 rarity). RTP ≈ 70 % average, ≤ 110 % expert (tune only the speed table). actionCost 2; no autoplay. Controls Space/LMB STOP, Q or Space TAKE at MINOR, C CLIMB, wheel/Z/X stake, H, E (at MINOR = TAKE, otherwise forfeit). The occupant is the authority: the stop cell comes from the deterministic motion function at the local press time. States READY/COMMIT/ROW_r MOVING/STOPPED/MINOR_DECIDE/WIN/LOSE (1.5 s). Events: start {stake, seed}, row {row, cellStart, width, kept, fell}, decide {choice}, end {row, prize}. Hooks m.stacker.extraBlock (+1 width rows 1–5; Brass Knuckles), saveCell (first falling overhang caught once per play), minorMult, majorCharm, onMinor; Metronome luck +10. Milestones L10 saveCell, L25 extraBlock, L50 minorMult ×1.5, L100 majorCharm +1. Juice §16.9 (cell ticks, chunk on stop, falling whistle + smash, drone up a semitone per row, MINOR ding-dong, MAJOR gold fill top-down + fireworks + pit-wide bell). Achievement stacked; HOUSE feat: take the Minor or Major.

### A.16 `fruitmachine` — Fruit Machine "Nudge & Hold" · Meyve Makinesi «Dürt & Tut»

Tier 3 · solo · slot GAL-04, GAL-05 · zone `gallery`

**Model brief (`mdl-fruitmachine`, Opus).** M slot, footprint 0.70 W × 0.60 D × 1.80 H pub cabinet (no ART entry — kitCabinetShell upright w 0.70 d 0.60 h 1.80 + ART conventions): glossy green enamel #0F6B3A with gold #E8C060 lettering, chrome trims. Top glass 0.60 × 0.45 holds the 6-square STEP trail (trailLamps[6] labelled NUDGES ×2 · CASH ×3 · HOLD · CASH ×6 · NUDGES ×4 · CASH ×15 in the micro font), the HI/LO number display 1–12 (leds.hilo, 2-digit amber 7-seg) and the HI/LO cash ladder (ladderLamps[7]: ×2, ×4, ×8, ×15, ×25, ×50, ×100). Parts: reels[0..2] (ReelPart r 0.08, width 0.10, 20 facets; strips per catalogue §17.2: PEAR #B8D040, GRAPES #6A2C8E, STRAWBERRY #E0203A, MELON #3A9A3A, BAR, DOUBLE STAR #FFD040, MONEY BAG #8A6A30, STEP arrow on reel 3 only), window 0.36 × 0.12 with one line, buttons.hold0..2 (yellow, labelled HOLD / NUDGE, blink 3 Hz when available), buttons.start (green), buttons.collect (red), buttons.hi, buttons.lo, lamps.hold, leds.nudges (1-digit), leds.credit/bet/win, tray + coinOut, marquee "NUDGE & HOLD". Colourways 0–3 (green, oxblood, cobalt, black, all with gold lettering). Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light (top-glass backlight P20 0.5 r1.2). Budget ≤ 1,100 tris, ≤ 14 draws. Play pose standing (0,1.45,0.50)→(0,1.25,0) FOV 55 with the top glass in frame.

**Logic brief (`mc-fruitmachine`, Sonnet).** MACHINES_machines §17. Stake 1–20 (betLimits); START spins 3 reels × 20 stops, one line, pays §17.2 (PEAR 4 … MONEY BAG 100 × stake). HOLD: after a non-winning spin the HOLD lamp may light → hold 1–2 reels for the next spin. NUDGE: awarded 1–5; each press of 1–3 moves that reel down one stop; unused nudges are lost on START. STEP on reel 3 advances the trail (cash squares pay at once; trail resets after the last). HI/LO gamble after any win: a number 1–12 is shown, press HI or LO for the next; correct → climb the ladder (2, 4, 8, 15, 25, 50, 100 × stake), equal → push, wrong → lose; COLLECT any time. Compensator §17.3: per-instance bank B (persisted per run, new run B = +5 × max stake); each stake adds 0.88 × stake, payouts subtract; float F = 10 × stake (+1 × stake per luck point, cap +20); spin results whose win > B + F are redrawn (≤ 8) or forced to a loss; feature release after a loss pf = clamp(0.03·(B/stake − 10), 0, 0.6) with HOLD 40 / NUDGE 35 / STEP+1 25; trail cash above B + F skipped; HI/LO success above B + F redrawn as a loss. RTP exactly 88.0 % long-run. actionCost 1 per spin (features and gamble free). Controls Space START, 1/2/3 HOLD or NUDGE, C or Q COLLECT, W = HI, S = LO, LMB buttons, wheel/Z/X stake, H, E. States READY/SPIN (stops 1.0/1.3/1.6)/EVAL/FEATURE/GAMBLE_OFFER/GAMBLE_STEP 0.8/PAYOUT. Events: spin {stake, held, stops, win}, feature {type, n}, nudge {reel, stops}, trail {pos, square, paid}, gamble {shown, pick, next, rung}. Hooks m.fruitmachine.holdOdds, gambleSafety, trailStart, onFeature. Milestones L10 gambleSafety, L25 holdOdds ×1.2, L50 trailStart 3, L100 luck +5. Juice §17.8. HOUSE feat: any feature.

### A.17 `bingopin` — Bingo Pinball · Tombala Langırtı

Tier 3 · solo · slot LAU-08 · zone `laundry`

**Model brief (`mdl-bingopin`, Opus).** L slot (v1.1), footprint 0.75 W × 1.40 D × 1.90 H (no ART entry — ART conventions): playfield cabinet on chrome legs, playfield 0.85 m high at the front and inclined 6.5°, backbox 0.75 × 0.20 × 0.90 rising to 1.90. Woodgrain sides (wood_walnut #5A3A22), chrome trim, ivory playfield #F0E8D0 with 25 holes (Ø0.03, staggered 5 × 5, numbered 1–25 row-major top→bottom), red rubber bumper posts #E02020, lane rails. Backglass deep teal #0E5E5E carrying a 5 × 5 card of gold numbers #FFD040 (lit numbers #FFF6A0), plus EXTRA BALL and TILT lamps and a ratchet price wheel. Parts: holes[25] (anchors where a ball settles) + holeLamps[25] (emissive rings), bumpers (InstancedMesh), lanes (exported lane-graph data: nodes per row + hole entry nodes, playfield coords, for the coder's steered path), balls (BallPool 8, r 0.012 chrome), backglass (ScreenSurface 128 × 128, the coder paints the scrambled card), lamps.extraBall, lamps.tilt, priceWheel (Group rotating) + leds.price (3-digit), plunger (Group translating 0–0.06 m) at the bottom-right, buttons.lift (ball lift), leds.credit/bet/win, stool at the front. Anchors: speaker, prompt, label, marqueeTop (top of the backbox), servicePlate, stand, coinOut, light (backglass P38 0.5 r1.5). Budget ≤ 1,300 tris, ≤ 14 draws. Play pose (0,0.60 above the front of the playfield, pitch −35°, backglass visible at the top of the frame, FOV 62).

**Logic brief (`mc-bingopin`, Sonnet).** MACHINES_machines §18. Stake 1–25 per game (betLimits); 5 balls. Hold Space to pull the plunger (0–100 % over 1.0 s), release to launch. The hole is drawn at launch from free holes with power-zone weights: SOFT (< 35 %) holes 16–25 ×1.8, MEDIUM uniform, HARD (> 75 %) holes 1–10 ×1.8; the path is steered through the model's lane graph (1.8–2.6 s). In the ball's last 0.8 s A/D nudges: 35 % chance (+2 % per luck point, cap +30 %) to hop into the adjacent free hole on that side; nudge n in a game has a TILT chance of 10 % × n (TILT ends the game with no pay; bingopin.tiltGuard ignores the first). The matching number lights on the backglass card (scrambled per instance at run start, in the snapshot). After ball 5: EXTRA BALL offer at ceil(1.25 × EV₆) (exact marginal EV of one more MEDIUM ball given lit holes), up to 3 extras, each re-priced; extras cost coins via addStake and 0 pulls. Lines (5 rows, 5 columns, 2 diagonals) pay independently: 3 lit ×1, 4 lit ×20, 5 lit ×250. RTP ≈ 93.5 % for 5 balls, extras priced at 80 %. actionCost 2 per game. Controls hold/release Space, A/D nudge, Space at the offer = buy, C or Q collect, wheel/Z/X stake, H, E (remaining balls auto-launch at MEDIUM, no extras). States READY/COMMIT/PLUNGE/ROLL/SETTLE 0.3 × 5/OFFER ≤ 10 s/EXTRA ≤ 3/PAYOUT; TILT 2 s. Events: start {stake}, launch {ball, power, hole, path}, nudge {ball, dir, moved, tilt}, offer {price}, end {lit, lines, pay}. Hooks m.bingopin.freeSpace (centre lit; Glass Funnel), extraBallDiscount, lineMult.3|4|5, tiltGuard, onLine. Milestones L10 freeSpace, L25 tiltGuard, L50 extraBallDiscount 25 %, L100 lineMult.5 ×2. Juice §18.7 (plunger creak, rumble, clack-ding bumpers, relay chatter, score-reel clatter). HOUSE feat: 5 lines.

### A.18 `roulette` — Roulette "The Bone Wheel" · Rulet (Avrupa) «Kemik Çark»

Tier 1 · shared · slot WELL-02 · zone `well`

**Model brief (`mdl-roulette`, Opus).** XL slot, table 2.60 × 1.30, felt at 0.78 (ART §5.5) on a footprint ≤ 4.6 × 2.4 incl. 6 stools. Green felt #1F5A3A, padded leather_black rail, walnut apron. Wheel bowl at the −X end (centre x −0.85, Ø0.82): bowl Lathe 24 seg walnut, ball track r 0.37–0.40 inclined 12° inward (P02), 8 chrome rhombus deflectors at 45° steps. Parts: rotor (Lathe 37 seg: pocket annulus r 0.24–0.31 with 37 pockets red #9E1B22 / black #141414 / zero #1E6B3A, 37 chrome separators, number ring r 0.31–0.36 texRouletteRing in European wheel order), turret (chrome cone + cross handle), ball (icosa 0.009 P09), dolly (brass skull marker ~30 tris) + dollyJaw, layout plane 1.60 × 0.64 (texRouletteLayout, EN/TR pre-rendered) covering x −0.40…+1.20 with the racetrack strip along the far edge, rimBulbs (InstancedMesh 37 #FFB347, index = wheel position), history (flip-tile pillar, ScreenSurface 32 × 192, last 12), rake (the croupier "the Rake": a brass arm on a rail behind the wheel, no head — rakeArm lifts 0.4 s, rakeHand holds the dolly / sweeps a 1.2 m arc), chips (ChipPool 600), railMeters[6], seatLamps[6] (player colours), phaseLamp, fairLamp, goldenPocketLamp, hotColdBoard (L10, ScreenSurface 64 × 32, hidden until unlocked), stools 6 along +Z. seats: 6 SeatDef (stool; camera seat + (0,1.15,0) moved 0.12 toward the centre, target felt 0.35 ahead at y 0.80, FOV 58). Anchors: speaker, prompt, label, marqueeTop (pendant top), servicePlate (rail end), wheelCam (−1.00, 1.60, 0.25 looking down), light (green-glass pendant (0, 2.2, 0) P20 1.4 r4.5 BUZZ, with a light cone). Budget ≤ 2,500 tris excl. stools, ≤ 20 draws.

**Logic brief (`mc-roulette`, Sonnet).** MACHINES_tables §2, TableBase with 6 seats (+ cosmetic patrons in SP). OPEN (solo ∞ / shared 20 s, early on all Ready) → LOCK 0.8 s (bell, Rake hand up, pocket drawn from 37 integer weights base 100 + hooks, fair hash) → LAUNCH 0.6 → ORBIT 5.5–7.5 s (ω(t) = ω₀e^(−0.18t)) → DROP 1.2–2.4 (pre-rolled bounces) → SETTLE 0.6 → ANNOUNCE 1.5 → PAYOUT ≤ 2.5 → CLEAR 0.8. Clients solve the ball path analytically. Bets §2.3: straight 35:1, split 17:1, street/trio 11:1, corner/first four 8:1, six line 5:1, column/dozen 2:1, even-money 1:1 with la partage (half back on 0); racetrack calls (Neighbours of Zero, Third, Orphans, Zero Game, n±k) expanded by the host. Limits inside 1–100 per spot, outside 5–500, table 2,000 per player per spin (× SI × Cap via betLimits / bet.maxMult). actionCost 1 per spin with chips down; autoplay G repeats the layout. Luck: refund mode with ≥ 2 humans on the spin, else reroll the whole layout's net once with p = L/100; nearmiss = ball ±1 pocket from a lost straight-up. Controls common table set (LMB chip, RMB tap remove, Shift+LMB ×5, Ctrl+LMB / B spot max, wheel/Z/X chip, Backspace clear, D double, R repeat + Ready, Space spin / Ready) + 1 racetrack panel, 2–5 call bets, N neighbour width / nudge prompt, V wheel cam. Events: spin {pocket, orbitMs, dropMs, wheelPhase, ballPhase, bounces, extra?}, result {pocket, color, seats}, golden {pocket, pays}, peek {dozen} (private). Hooks m.roulette.pocketWeight.n, colorWeight, zeroShield, straightPayAdd, neighbourPay, extraBall, ghostChip, goldenPocketPay; x.table.peekCharges (dozen), x.wheel.nudge. Milestones L10 hot/cold board, L25 Golden Pocket 40:1, L50 free second ball every 10th spin, L100 zero rule. Staff gambler: red + dozen 2. Juice §2.11. HOUSE feat: straight-up hit.

### A.19 `blackjack` — Blackjack "Twenty-One" · Blackjack (Yirmi Bir)

Tier 1 · shared · slot WELL-03 · zone `well`

**Model brief (`mdl-blackjack`, Opus).** L slot, half-moon table 2.10 × 1.10, felt at 0.78 (ART §5.6), footprint ≤ 2.5 × 1.8 incl. 5 stools. felt_green with texBlackjackFelt arc text (BLACKJACK PAYS 3 TO 2 · DEALER MUST DRAW TO 16 AND STAND ON ALL 17S · INSURANCE PAYS 2 TO 1; TR pre-rendered), padded rail. Five boxes on an arc r 0.70 around (0, 0.78, −0.45), spread ±60°: main circle Ø0.11 + Twin Souls circle Ø0.06 each. Dealer = "the Undertaker's Hands": two jointed porcelain hands on brass rods rising from a shoe-box behind the table (partial automaton; Groups handL/handR each with wrist + 2-segment fingers; poses deal, flip, peek-tilt 20°, collect sweep, tap). Parts: boxButtons[5] (each {hit, stand, double, split, surrender} brass push-buttons on the rail, emissive when legal, #3A3A3A otherwise), shoe (kitCardShoe at (+0.55, 0.80, −0.35)) + cutCard (red, visible), discard (glass tray at (−0.55, 0.80, −0.35)) + discardStack (scaled Y with cards used), cards (CardPool 32), chips (ChipPool 300), totals[5][4] (brass flip-tiles, ScreenSurface 32 × 16, soft totals "7/17"), insuranceLine, beadCounter (brass bead abacus on each rail for Counting Bead, hidden by default), shoeGauge (L10 dial), railMeters[5], seatLamps[5], phaseLamp, fairLamp, pitBoss (anchor 1 m behind the dealer side for a standing mannequin), regularSeat (seat 5 anchor for a slumped patron). seats: 5 SeatDef (stool; table-seat pose, FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (pendant (0, 2.1, −0.2) P20 1.3 r4 BUZZ). Budget ≤ 1,800 tris, ≤ 20 draws.

**Logic brief (`mc-blackjack`, Sonnet).** MACHINES_tables §3, TableBase with 5 boxes (seats track: 2–3 boxes per player). Rules: 2 decks, cut card at 65 % (68 cards), reshuffle if < 20 remain; S17, DAS, late surrender, split to 4 hands (aces one card, no re-split, A+10 after split = 21), insurance ≤ ½ main (2:1) / even money, peek on Ace or ten; blackjack 3:2; Twin Souls side bet 8:1 / 15:1 / 30:1 (96.12 %). Main 5–500, side 1–50 (× SI × Cap). RTP ≈ 99.7 % basic strategy; counting is intended skill. actionCost 1 per round (splits, doubles, extra boxes add stakes via addStake, no pulls). Phases IDLE/OPEN (solo ∞ / shared 15 s)/DEAL (0.35 s per card)/INSURANCE (8 s, default decline)/PEEK 1.0/TURNS (15 s per decision, default Stand)/DEALER (0.6 + 0.7 s per draw)/SETTLE/SHUFFLE 3.5 s with a new fair hash. Fate draws: a busting Hit/Double card is quietly replaced with p = L/100; dealer blackjack at peek likewise only when you are the only human with a bet. Pit-boss early reshuffle per §3.12. Controls 1 Hit, 2 Stand, 3 Double, 4 Split, 5 Surrender, 6 insurance / even money, 7 decline, Space deal / Ready, LMB rail buttons, hold RMB lift card corners, H rules. Events: deal {to, box, hand, card} (hole −1), insurance, peek {dealerBJ}, turn {box, hand, timeoutMs, legal}, act, card, split, reveal / dealerDraw, settle, shuffle {penetration}; hole / ghost cards via sendPrivate. Hooks m.blackjack.peekNext, bjPayAdd (Dealer's Button +0.5), fiveCardCharlie, dealerBustBonus, bustShield, doubleAny, splitMaxAdd, earlySurrender, twinPayAdd, insuranceFree; x.table.peekCharges (hole card), x.table.pushToWin, x.table.shoeInfo (Counting Bead bead counter). Milestones L10 shoe gauge, L25 Five-Card Charlie, L50 suited blackjack 2:1, L100 70 % tell. Overheat: hands tremble, bjPayAdd +0.25 for 3 rounds. HOUSE feat: win with 5+ cards.

### A.20 `holdem` — Texas Hold'em "The Long Table" · Texas Hold'em Poker «Uzun Masa»

Tier 1 · shared · slot CARD-01 · zone `cards`

**Model brief (`mdl-holdem`, Opus).** XL slot, oval table 2.80 × 1.40, felt at 0.78 (ART §5.7) with 8 chairs (kit chair seat 0.48) around it and the dealer standing at the far long side; footprint ≤ 4.6 × 2.5 (CARD-01 rotY 90, dealer west). felt_green with a 1 px P23 racetrack ellipse inset 0.15, 5 community-card outlines (0.07 × 0.10, P09), brass pot ring Ø0.40. Parts: cards (CardPool 24), chips (ChipPool 600), potRing, dealerButton (brass puck 0.05 "D", moved by the coder), stacks[8] (anchors per seat), seatLamps[8] (blink on the acting seat), railMeters[8] (CREDIT = stack, BET = street bet), chairs[8], dealer (anchor (0,0,−0.95) for a standing faceless mannequin in a waistcoat — kit.mannequin, porcelain mask prop) + ledgerMeter (8-digit 7-seg "The Ledger" bad-beat pool on the dealer's chest anchor), botSeats[8] (seated anchors where the coder spawns patron bots: fedora / bowler / cloche / flat cap, mask paints smile / frown / blank / sleepy / weeping), pendant (rectangular brass bar lamp 1.4 × 0.12 with 3 bulbs at y 2.0) + lightCone (scale to narrow the cone 60° → 35° when a pot exceeds 50 BB), boardCam anchor (top-down). seats: 8 SeatDef (chair; camera seat + (0,1.12,0), target (0,0.80,0), FOV 60; RMB peek pitches to own hole cards). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (pendant P20 1.5 r5). Budget ≤ 2,500 tris excl. actors, ≤ 20 draws.

**Logic brief (`mc-holdem`, Sonnet).** MACHINES_tables §4, TableBase PvP, 8 seats, bots fill empty seats. No-Limit Hold'em 2–8 players: standard streets, side pots, min raise = last raise. Tables Low 1/2 (buy-in 80–200), Mid 10/20, High 50/100 (40–100 BB, top up to 100 BB; blind values scale with bet.maxMult). Rake 5 % of pots that see a flop, cap 3 BB; 20 % of rake feeds "The Ledger" bad-beat pool (pool 'ledger', §4.2). Buy-in / cash-out use run.hostBet / hostWin with meta.raw (no modifiers); each hand emits one outcome (bet = chips committed, payout = chips won). actionCost 1 per hand dealt in. Bots (_base/bots): 6 personalities (table §4.4), preflop Chen ranking, postflop 300-runout Monte-Carlo equity vs range, think 0.8–3.5 s, 70 %-reliable tells; bots get only their seat view. Luck only in pots against bots only: when all-in and behind, the next turn/river is redrawn once with p = L/100. Phases WAIT/BLINDS 0.6/DEAL_HOLE/BET (20 s + 30 s time bank; timeout check/fold)/FLOP 1.2/TURN 0.6/RIVER 0.6/RUNOUT/SHOWDOWN/AWARD/CLEANUP. Controls 1 Fold, 2 Check/Call, 3 Bet/Raise (wheel ±1 BB, Shift+wheel ±5, Z ½ pot, X ¾, C pot, Space confirm, Backspace cancel), 4 All-in (hold 0.6 s), 5 show/muck, 6 sit out, 7 top up, hold RMB peek, V board cam. Events hand, blind, hole (private), turn, act, board, pots, show / muck, award {pots, ledger?}, stack, tell, burn (private). Hooks m.holdem.extraHoleCard, tellReader, badBeatShareAdd, botTilt, seeBurn, timeBankAdd; x.table.rakeDelta; x.table.peekCharges (next board card, only with no other human in the hand). Milestones L10 pot-odds readout, L25 two fish bots, L50 owner rake −1 pp, L100 owner gets 10 % of Ledger hits. Versus: PvP winnings capped at 1 × base quota per Night (GDD §7.3). HOUSE feat: win a pot with a flush or better.

### A.21 `devilstable` — The Devil's Table · Şeytanın Masası

Tier 1 · shared · slot PAR-01 · zone `parlour`

**Model brief (`mdl-devilstable`, Opus).** L slot, footprint 2.40 W × 1.80 D × 2.10 H (PAR-01 rotY 270: player west, the Devil east). Round table Ø1.10 h 0.74, felt_violet #4A193A with a P23 rim; the player's high-back chair at +Z (z +0.70), the Devil's at −Z (z −0.70), two side stools at x ±0.95 for 3–4-player SHELLS. The Devil: horned automaton 2.1 m standing (seated head ≈ 1.55), pinstripe suit, long porcelain hands, hinged jaw, red glass eyes #FF1A1A — kit.dealer({style:'devil'}) rig exposing devil.head, devil.jaw, devil.handL, devil.handR, devil.eyes (emissive; P47 when cursed). Centre: brass turntable rig r 0.15 (turntable Group, rotation Y aims at a seat lantern) carrying two swappable guns, one visible per mode: revolver (≈160 tris: barrel, cylinder Group with chamber texture, hammer, walnut grip) and coachGun (double barrel 0.45 m, brass receiver, walnut stock, breach hinge, hammers[2]). shellTray (0.30 × 0.10 brass, 8 slot anchors) + trayFlap (leather) + shells (InstancedMesh 8: LIVE oxblood hull #5A1019 + brass cap #C59C42, BLANK grey #5A525A + dull cap). Per seat i = 0..3: defib[i] (0.22 × 0.14 × 0.10 black lacquer box with lamps[6] (green #5AFF7B / off #082919), needle, paddles on coiled cords), itemTray[i] (4 × 2 slot anchors), seatLantern[i] (brass lantern 0.4 m above the chair; lanternGlass shatterable, candle emissive). rungPips[6] (red, table edge) + ladderPlaque (canvas 64 × 48) for SIX CHAMBERS; modePlaque (SHELLS / SIX CHAMBERS); candelabra (3 candles, CANDLE flicker), hourglass, IOU tray, railMeter. seats: 4 SeatDef (chair/stool; main pose (0,1.15,0.75) looking at the gun, FOV 55, free-look ±25°). Anchors: speaker, prompt, label, marqueeTop, servicePlate, seatLantern0..3, mothBurst, light (candelabra P15/P19 0.9 r3 CANDLE), light2 (overhead P14 0.5 r4 SICK). Budget ≤ 1,600 tris incl. rig, ≤ 20 draws.

**Logic brief (`mc-devilstable`, Sonnet).** BRIEF Addendum 7 + MACHINES_tables §5A (SHELLS, default mode) and §5 (SIX CHAMBERS, quick variant chosen on the mode plaque). TableBase, 4 seats, host-resolved (hidden shell order). SHELLS: best of 3 rounds vs the Devil (solo) or last-seat-standing per round among 2–4 humans. Round table: charges 2/4/6, shells per load 2–4 / 3–6 / 4–8 (live ⌊n/2⌋ or ⌈n/2⌉, ≥ 1 of each, counts shown then order hidden), items dealt per load 0/2/4 (tray cap 8). Turn (20 s, timeout = shoot self): use items (1–8), look at a seat lantern, hold LMB 0.8 s to fire; LIVE at target −1 charge (−2 with Hacksaw), BLANK at self keeps the turn. 12 items with weights /120 (§5A.3). Devil AI §5A.5. Solo stake S ∈ [max(20, 10 % wallet), 50 % wallet] (cap 5,000 × limits); win pays 1.9 S (Loaded Chip 3.8 S), ride double-or-nothing up to 3 times (R) or collect (Q); PvP pot N·S, 5 % rake. Luck = misfire, min(0.30, L/100), max 1 per round. Loupe / Burner Phone results via sendPrivate; commit–reveal per load. SIX CHAMBERS: k ∈ {1,2,3} slugs, one spin, hold LMB/Space 1.2 s to pull, ladder §5.3 (RTP 95 %), Q collect, Devil's Due, Bargain (k = 3, 30 %, cursed charm, first pull empty), 2-human duel (YIELD = hold 2). Loss → buff.scorched (luck −10 for 5 plays) + Dread +10; presentation GDD §6.12 (aim only at lanterns; blackout, tinnitus, crack overlay, defib thump). actionCost 2 per match / game (velvet_rope −1); not staffable. Events §5A.9 and §5.11. Hooks m.devilstable.misfireAdd, misfireCapAdd, ladderMult, peekChamber, bargainChanceAdd, blackoutWard; x.table.peekCharges. Milestones §5A.11 / §5.14. Overheat: the Devil leans in, bargain ×2. HOUSE feat: win a SHELLS match or COLLECT at rung ≥ 3.

### A.22 `baccarat` — Baccarat "The Mirror Table" · Bakara (Punto Banco) «Aynalı Masa»

Tier 2 · shared · slot CARD-02 · zone `cards`

**Model brief (`mdl-baccarat`, Opus).** L slot, kidney table 2.40 × 1.20, felt at 0.78 (ART §5.8), felt_red P12, 7 stools; footprint ≤ 2.6 × 1.8 × 2.4. Each seat has PLAYER (P37 outline), BANKER (P14) and TIE (P23) boxes plus two small pair boxes; dealer area with two large card boxes "PLAYER" / "BANKER". Dealer "the Banker": seated mannequin in a top hat (kit.mannequin, Sitting pose) with a walnut paddle. Parts: paddle (Group 0.60 long, blade 0.08 × 0.05; slides cards 0.5 s), shoe (8-deck kitCardShoe) + discard, cards (CardPool 12), squeezeCards[2] (special bendable card meshes, 4 × 1 segment strips with a bend 0..1 uniform for the squeezed side, max 25°), chips (ChipPool 300), mirror (2.0 × 1.0 panel, mirror_dark env, tilted 35° toward the seats, centre y 2.05, must stay ≤ 2.4) + mirrorFigure (hidden sprite: a figure behind the player for 0.5 s on 1 coup in 40) + mirrorGrin (decal for Overheat), roadmap (LED dot board on a 1.60 m chrome pole at the +X end; ScreenSurface 96 × 48 = Bead Plate 6 × 12 + Big Road 6 × 24, red #C8102E / blue #2C4C9C / green tie slash), lamps.player / lamps.banker (winner lamps), totals.P / totals.B (brass flip tiles), commissionBox, shoeLevel (gauge), beadCounter (Counting Bead, hidden), railMeters[7], seatLamps[7], chandelier (6-bulb ring r 0.35 at y 2.30). seats: 7 SeatDef (stool, pose (0,1.18,0.75)→(0,0.78,−0.15) FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, mirrorCam (looking up into the mirror), light (chandelier P19 1.2 r4.5 CANDLE). Budget ≤ 1,700 tris, ≤ 20 draws.

**Logic brief (`mc-baccarat`, Sonnet).** MACHINES_tables §6, TableBase with 7 seats. Punto banco, 8 decks: at shoe start the first card is shown and that many burned; cut card 14 from the end. Deal P–B–P–B face down; naturals 8/9 stand; Player draws on 0–5; Banker tableau §6.2. Bets: Banker 1:1 less 5 % commission (98.94 %), Player 1:1 (98.76 %), Tie 8:1 (85.64 %), Player/Banker Pair 11:1 (89.64 %). Limits Player/Banker 10–1,000, Tie/pairs 1–100 (× SI × Cap). actionCost 1 per coup; autoplay G (fixed side, no squeeze). Squeeze: the largest bettor on each side squeezes (solo: the side you backed; Player first): hold LMB on the card and drag down (bend 0 → 1, release > 0.8 flips; solo ∞ / shared 6 s per side; Space skips). Luck: solo → the whole coup is reinserted at random positions in the remaining shoe and re-dealt with p = L/100 (invisible); shared → refund mode. Phases OPEN (solo ∞ / shared 15 s)/LOCK 0.6/DEAL 1.4/SQUEEZE/REVEAL 0.8/THIRD 0.8 each/RESULT 1.5/PAYOUT ≤ 2.5/SHUFFLE 5.0 (after the last coup). Controls LMB spots, 1/2/3 quick Player/Banker/Tie with the selected chip, squeeze drag, Space reveal / Ready, V mirror cam, common table keys. Events deal {squeezers}, squeeze {side, idx, bend} (≤ 8 Hz relay), reveal {side, idx, card}, third {side, card}, result {p, b, winner, pairs, natural, seats}, road {bead}, shoe {remaining, lastCoup}, peek {card} (private). Hooks m.baccarat.naturalBonus, tiePayAdd, pairPayAdd, tieSweetener, squeezeLuck; x.table.rakeDelta (commission; Dealer's Button −5 pp), x.table.peekCharges (next coup's first Player card), x.table.shoeInfo. Milestones L10 derived roads, L25 commission 4 %, L50 Lucky Six, L100 Tie 9:1. Overheat: the mirror shows your reflection grinning (stinger C17 at Dread ≥ 40), payout.mult +10 %. Juice §6.11 (paper creak squeeze, natural-9 gong, mirror flash). HOUSE feat: a Tie bet hits.

### A.23 `craps` — Craps "The Bone Pit" · Craps Zar Masası «Kemik Çukuru»

Tier 2 · shared · slot BOI-01 · zone `boiler`

**Model brief (`mdl-craps`, Opus).** XL slot, tub table 3.20 × 1.50, rail top 0.92, felt at 0.64 (tub depth 0.28) (ART §5.9), footprint ≤ 4.6 × 2.5. Black felt #121212 with bone-white texCrapsLayout print (192 × 96 on 2.88 × 1.24, mirrored halves, proposition box centre: PASS LINE, DON'T PASS BAR, COME, FIELD, place boxes 4 5 SIX 8 NINE 10, BIG 6/8, hardways pictograms, ANY SEVEN, ANY CRAPS, FURNACE). Inner far wall lined with a rubber pyramid texture; rail leather_black with 2 chip grooves. Stickman "the Hook": thin standing mannequin at the −Z centre (kit.mannequin, porcelain mask) holding a 1.2 m walnut stick whose hook end is a bone-white mannequin finger. Parts: stick (Group), puck (0.07 Ø, OFF side P01 / ON side P09, flips), dice (DicePool 2, translucent red #B0101C α 0.85, 0.019 m, white pips), pointLamps[6] (4, 5, 6, 8, 9, 10 boxes), furnaceLamps[6] (flame lamps #FF6A00 on the rail), last10 (ScreenSurface 64 × 16 roll strip), chips (ChipPool 600), railMeters[8], seatLamps[8], throwOrigins[8] (per rail spot), tubBounds (exported min/max for the 64 pre-baked dice trajectories in _base/dice.ts), backWall (plane anchor). seats: 8 standing rail spots (pose (spot.x, 1.55, spot.z + 0.15) → (0, 0.70, −0.2) FOV 62; the shooter pose moves to the near end, 0.10 lower). Anchors: speaker, prompt, label, marqueeTop, servicePlate, diceCam, light (pendant x −0.8, y 2.1, P20 1.2 r4 BUZZ), light2 (pendant x +0.8). Budget ≤ 2,500 tris, ≤ 20 draws.

**Logic brief (`mc-craps`, Sonnet).** MACHINES_tables §7, TableBase with 8 rail spots and a rotating shooter (SP: you always shoot). Come-out: 7/11 Pass wins, 2/3/12 Pass loses (Don't Pass pushes on 12), otherwise point (puck ON); point phase until the point (Pass wins) or 7 (seven-out, dice pass clockwise to the next seat with a line bet). Bets §7.3 with exact pays: Pass/Come 1:1, Don't (bar 12), odds 3×/4×/5× (true odds), place 6/8 7:6, 5/9 7:5, 4/10 9:5, buy 4/10 2:1 less 5 %, field (2 pays 2:1, 12 pays 3:1), Big 6/8, hardways 9:1 / 7:1, any seven 4:1, any craps 7:1, 2/12 30:1, 3/11 15:1, horn, C&E, Furnace side bet (distinct points 4/5/6 → 24/249/999:1). Limits line 5–500, props 1–100, Furnace 1–20 (× SI × Cap). Dice faces (weights base 100 + dieWeight hooks) rolled at THROW release; animation = one of 64 pre-baked trajectories + face-remap; NO_ROLL 1/60 throws cosmetic. actionCost 1 pull per roll on which a player commits new coins. Luck: solo → reroll if the bets resolved on this roll net < 0 (p = L/100); shared → refund. Phases COMEOUT_OPEN (solo ∞ / shared 12 s)/THROW ≤ 10 s/ROLL 1.6–2.6/CALL 1.0/SETTLE/POINT_OPEN (shared 8 s)/SEVEN_OUT 2.0/NO_ROLL 1.5. Controls LMB layout, shooter hold LMB on dice + flick (cosmetic) or Space auto-throw, 1 max odds, 2 working toggle, 3 press, 4 take down place/buy, 5 horn, 6 take down odds. Events shooter, throw {seat, faces, traj, noRoll}, call {total, hard, phase, point}, puck, settle {seat, spots}, furnace {seat, points}, peek {odd} (private); outcome meta.dice. Hooks m.craps.dieWeight.d.face, sevenOutShield (Hollow Dice), oddsMaxAdd, hardwayPayAdd (Weighted Cup +2), fieldTwelveAdd, furnaceMult, pointBonus; x.table.peekCharges (next roll parity). Milestones L10 Hot Rail (+2 luck per point made), L25 odds 10×, L50 Field 12 4:1, L100 Furnace ×2. Achievement hardway_home; HOUSE feat: a hardway hit.

### A.24 `sicbo` — Sic Bo "The Birdcage" · Zar Kafesi (Sic Bo)

Tier 2 · shared · slot BOI-02 · zone `boiler`

**Model brief (`mdl-sicbo`, Opus).** L slot, footprint 2.40 W × 1.40 D × 1.60 H: a lit-panel layout table 2.40 × 1.20 at y 0.80 (milk-glass panels lit from below; every bet area is its own lamp; layout per texSicBoLayout scaled: SMALL 4–10, BIG 11–17, ODD/EVEN, totals 4–17, specific doubles, specific triples, ANY TRIPLE, 15 two-dice combos, singles 1–6 as dice pictograms). Behind its centre, "The Birdcage": a brass hourglass cage 0.55 tall (two wire cones, max r 0.18, waist r 0.04, 12 vertical wires, 3 hoops; ART §5.10) on a crank pedestal, axle along X at y 1.20 between two brass posts (r 0.025), kit.crank on the right. Parts: panels (map spotId → lamp; implemented as InstancedMesh quads with per-instance emissive, winning #FFC83D), cage (Group rotating about X), crank, dice (DicePool 3, sicbo style 0.040: P09 body, P01 pips, 1 and 4 red), curseDie (blank bone die, hidden; appears during curses), history (ScreenSurface 120 × 24: last 20 rolls as die-face lamps, heat-map at L10), tripleStamp (brass "TRIPLE" stamp prop that drops onto the table), chips (ChipPool 400), railMeters[8], seatLamps[8] along the +Z edge. seats: 8 standing spots (pose (x, 1.30, 0.90) → (0, 0.85, 0) FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, cageCam, light (stand-base bulb under-lighting the dice P20 0.5 r1.2), light2 (layout glow P20 0.4 r2). Budget ≤ 1,300 tris, ≤ 20 draws.

**Logic brief (`mc-sicbo`, Sonnet).** MACHINES_tables §8, TableBase with 8 standing spots. OPEN (solo ∞ / shared 15 s) → LOCK 0.6 (three dice rolled from shared face weights base 100 + sicbo.dieWeight; fair hash) → FLIP 1.4 (cage turned 180° twice; the cranker is the largest bettor, solo: you, by LMB-dragging a half circle on the crank — cosmetic) → TUMBLE 1.8 → SETTLE 0.6 → LIGHTS 1.5 (+3 s SHAKE window when the owner holds cageShake) → PAYOUT ≤ 2.5. Paytable §8.3 (exact over 216): Small/Big and Odd/Even 1:1 losing on triples (97.22 %), totals 4/17 62:1 … 10/11 6:1, single die 1:1 / 2:1 / 12:1, specific double 11:1, specific triple 200:1, any triple 33:1, two-dice combo 6:1. Limits: small/big/odd/even 5–500, totals/combos/doubles/singles 1–100, triples 1–20, table 2,000 (× SI × Cap). actionCost 1 per roll; autoplay allowed. Luck: solo reroll (p = L/100) / shared refund. cageShake re-flip is private to the owner's bets (shown to them as a ghost cage). Controls LMB panels, 1–6 quick single die, Space Ready / flip (solo), crank drag, 7 cage-shake, V cage cam, common table keys. Events flip {faces, traj, cranker}, result {faces, total, triple, seats}, reflip {seat, faces, traj}, peek {die, face} (private); outcome meta.dice. Hooks m.sicbo.dieWeight.face, singleTripleAdd (Weighted Cup +2), totalPayAdd.t, tripleShield, cageShake (Hollow Dice +1 per roll); x.table.peekCharges (one die face during OPEN). Milestones L10 heat-map lamps, L25 specific double 12:1, L50 any triple 36:1, L100 free cageShake every 5 rolls. Highest idle yield (Y 0.53). Overheat: dice glow, single-die three-match 20:1 for 3 rolls. Juice §8.11. HOUSE feat: a triple with your winning bet.

### A.25 `bigsix` — Big Six "The Six-Score Wheel" · Büyük Altı Para Çarkı

Tier 2 · shared · slot WH-01 · zone `wheels`

**Model brief (`mdl-bigsix`, Opus).** L slot (v1.1, WH-01 at (21.0, 0, −0.95)), footprint 2.60 W × 1.80 D, wheel top 3.05 m (wall art above 1.8 m may rise to 3.1 in this slot). Front: glass-topped betting counter 2.40 × 0.60 × 0.95 with 6 lit symbol spots (1, 3, 6, 12, 25, EYE). Back: vertical wheel Ø1.80 mounted on the north wall, hub at machine-local (0, 2.15, −0.85) (ART §5.11 styling: walnut rim ring r 0.86–0.90, brass sunburst hub). 54 wedge segments in catalogue order clockwise from the top (index 0 = EYE): EYE 1 3 1 6 1 3 12 1 1 3 1 6 1 25 3 1 1 3 6 1 12 1 3 1 1 3 HOUSE 6 1 1 3 1 12 1 6 3 1 1 3 1 25 6 1 3 1 1 12 3 1 6 1 3 1; colours 1 #E8E0C8, 3 #2C4C9C, 6 #2E7D3B, 12 #A8262E, 25 #5B2A86, EYE gold #D4AF37, HOUSE black #111111 with the grin. Parts: wheel (WheelPart, axis local Z), pegs (InstancedMesh 54 brass r 0.006 l 0.04 at r 0.88), rimBulbs (InstancedMesh 54 #FFD36A), flapper (leather tongue 0.10 × 0.03 pivoting at 12 o'clock; deflects −25° per peg, springs back 0.06 s), flapper2 (6 o'clock, hidden until L100), hubHalves[2] (slide apart 0.06 m on HOUSE) + eye (eyeLid open/close, eyePupil tracks the winner 5 s), multiplierPeg (×2 lamp, L10), handle (pull handle on the frame's right; drag), spots[6] (LampPart), last12 (ScreenSurface 96 × 16), railMeters[8], seatLamps[8], dealer (anchor for a standing porcelain mannequin at the wheel's right). seats: 8 standing spots along the counter (pose (x, 1.45, 1.60)→(0, 1.60, −0.85) FOV 58). Anchors: speaker, prompt, label, marqueeTop, servicePlate, flapperCam, light ((0, 2.4, 0.6) P20 1.5 r5). Budget ≤ 1,600 tris, ≤ 20 draws.

**Logic brief (`mc-bigsix`, Sonnet).** MACHINES_tables §9, TableBase with 8 standing spots. Bet on symbols; spin; the flapper stops on a segment that pays its symbol; HOUSE = every bet loses (eye closes). 54 uniform segment weights (base 100 + bigsix.segmentWeight per symbol). Pays 1:1 (26 seg, 96.30 %), 3:1 (13), 6:1 (7, 90.74 %), 12:1 (4), 25:1 (2), EYE 50:1 (1, 94.44 %), HOUSE (1). Limits 1–200 per symbol, table 1,000 (× SI × Cap). actionCost 1 per spin; autoplay allowed. Phases OPEN (solo ∞ / shared 15 s)/LOCK 0.6 (bell, handle clunk; segment drawn; fair hash)/SPIN 6–11 s (ω₀ solved analytically to land on the drawn segment; peg clacks follow ω, last 5 spaced)/STOP 1.0 (wobble ≤ ½ peg)/ANNOUNCE 1.5/PAYOUT ≤ 2.5. Solo: dragging the handle down sets a cosmetic spin length only. Luck: solo reroll / shared refund; nearmiss = stop adjacent to EYE or 25 you backed. Controls LMB spots, 1–6 quick bet 1/3/6/12/25/EYE, Space spin (solo) / Ready, handle drag, V flapper cam, N = Golden Ratchet nudge prompt, common table keys. Events spin {seg, turns, durMs, wobble}, result {seg, symbol, seats}, peek {isOne} (private). Hooks m.bigsix.segmentWeight.symbol, houseShield (Croupier's Rake: HOUSE = push), eyePayAdd, nudge (charges: one peg short → 50 % creep, resolved at LOCK); x.wheel.nudge (Golden Ratchet, owner-only result shift); x.table.peekCharges (is the next result a "1"). Milestones L10 multiplier peg ×2, L25 HOUSE becomes a push, L50 EYE 60:1, L100 second flapper (bets settle on both pointers). Overheat: bulbs red, 6 pays 7:1 for 3 spins. Juice §9.11 (EYE choir + eye opens and stares at the winner; HOUSE blackout 1.2 s + 41 Hz drone + lid slam). HOUSE feat: the EYE segment.

### A.26 `cardwar` — War Table (War / Dragon-Tiger) · Savaş Masası (Kart Savaşı / Ejder-Kaplan)

Tier 2 · shared · slot CARD-03 · zone `cards`

**Model brief (`mdl-cardwar`, Opus).** L slot, long lacquer table 2.40 × 1.10, felt panels at 0.78, red lacquer #7A1418 with black felt panels, 8 stools along +Z (6 used in War); footprint ≤ 2.6 × 1.8 × 2.0. Two carved wooden heads on posts on the dealer side at x ±0.45, y 1.05 (≈150 tris each, boxes and wedges): dragon (left, P13 lacquer, P23 whiskers and horns) and tiger (right, P19 with P01 stripes 32 × 32, P09 fangs). Dealer "the Twin": two-faced mannequin standing behind (kit.mannequin + two-face mask prop; head yaws to the side it deals). Parts: dragon {head, jaw (hinge 0.5 rad), eyes (emissive P14)}, tiger {head, jaw, eyes (emissive P19)} (winner glow #FF2A3C), smokeL / smokeR (nostril emitters), felt (layout plane with two canvases: WAR boxes per seat, or DRAGON / TIGER / TIE / SUITED TIE / BIG / SMALL / ODD / EVEN), variantPlaque (brass plaque "WAR · DRAGON-TIGER" in the felt corner, clickable when the table is empty), shoe (kitCardShoe 6/8 decks) + discard, cards (CardPool 24), chips (ChipPool 300), history (ScreenSurface 96 × 16: D / T / tie lamps), beadCounter (Counting Bead, hidden), railMeters[8], seatLamps[8]. seats: 8 SeatDef (stool, pose (0,1.20,0.85)→(0,0.78,−0.10) FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (pendant P20 1.2 r4). CARD-03 rotY 180. Budget ≤ 1,400 tris, ≤ 20 draws.

**Logic brief (`mc-cardwar`, Sonnet).** MACHINES_tables §10, TableBase. Instance variant 'war' (default at CARD-03) or 'dragontiger', switched with the variant plaque only while no chips are down. WAR (6 decks, A high, 6 seats): bet, one card per seat and one dealer card; higher wins 1:1; tie → Go to War (raise = bet via addStake; burn 3; player card ≥ dealer → raise wins 1:1 and original pushes; else both lose) or Surrender (lose half); Tie side bet 10:1; RTP 97.12 % always-war. DRAGON-TIGER (8 decks, A low, K high, 8 spots): Dragon / Tiger 1:1 with half back on a tie (96.27 %), Tie 11:1, Suited Tie 50:1, Big/Small and Odd/Even per side 1:1 (a 7 loses). Main 5–500, sides 1–50 (× SI × Cap). Cut at 80 %; fair hash per shoe. actionCost 1 per round (a war adds none); autoplay for DT only. Luck: War — each seat's card is that seat's fate draw (reroll once if losing, p = L/100); dealer card shared → refund mode with ≥ 2 humans; DT standard reroll / refund. Phases WAR: OPEN (solo ∞ / shared 15 s)/DEAL 0.35 s per card/COMPARE 1.0/TIE_DECISION (shared 10 s, default surrender)/WAR 2.0–3.5/SETTLE ≤ 2.0; DT: OPEN 12/LOCK 0.6/DEAL 0.7/REVEAL (Dragon 0.8, pause 0.5, Tiger 0.8)/SETTLE. Controls WAR 1 go to war, 2 surrender, Space deal / Ready; DT 1/2/3 quick Dragon/Tiger/Tie, LMB spots, Space Ready. Events deal {to, seat, card}, tie {seats, timeoutMs}, choice {seat, choice}, war {burn, cards, dealer}, dt {dragon, tiger}, result {seats}, peek (private). Hooks m.cardwar.warBonus, surrenderRefundAdd, tiePayAdd, dtTieRefund, suitedTiePayAdd; x.table.peekCharges (War: dealer's war card; DT: Dragon colour), x.table.shoeInfo (Counting Bead). Milestones L10 War bonus, L25 DT Tie 12:1, L50 surrender 60 %, L100 DT ties refund in full. Juice §10.11. HOUSE feat: win a war.

### A.27 `hilo` — Hi-Lo Ladder · Yüksek-Alçak Merdiveni

Tier 2 · solo · slot WELL-08 · zone `well`

**Model brief (`mdl-hilo`, Opus).** M slot (v1.1, WELL-08 rotY 90), upright cabinet "The Ladder of Cards" 0.90 W × 0.60 D × 2.30 H (catalogue §11; replaces ART's table version). Tarnished green enamel #2F4A3A, brass #C8A040, deco top. Face: two giant split-flap cards 0.30 × 0.42 side by side — CURRENT and NEXT — each a flipBank of 4 hinged flap leaves plus a face ScreenSurface 64 × 96 drawn from the card atlas; a 12-rung lamp ladder up the right edge (top rung "×100+"); four brass dome buttons (0.07) HIGHER / LOWER / SKIP / COLLECT, each under a 7-seg window showing its live value; on the left a brass thermometer (glass tube 0.40 tall, 10 marks, P13 liquid column — ART's ladder gauge). Painted marquee "HI-LO LADDER" whose card-hand art has a six-fingered hand (horror twist, never mentioned). Parts: flapCur, flapNext (each {leaves[4], face}), rungs[12] (LampPart #FFC83D), buttons.higher / lower / skip / collect, leds.higher (5-digit), leds.lower (5-digit), leds.skips (1-digit), thermo + thermoLiquid (scale Y 0–1; drains into a pipe on bust), leds.credit/bet/win (rail meter), tray + coinOut, marquee. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light (marquee P19 0.5 r1.5). Single colourway (1 instance). Budget ≤ 900 tris, ≤ 14 draws. Play pose standing (0,1.40,0.55)→(0,1.35,0) FOV 55.

**Logic brief (`mc-hilo`, Sonnet).** MACHINES_tables §11 (solo-occupant). Stake 5–200 (betLimits). Space deals a card (infinite deck: rank uniform A = 1 … K = 13, weights base 100, suit cosmetic). Guess HIGHER-OR-SAME or LOWER-OR-SAME, or SKIP (new current card, max 3 per round, free); a guess with probability 1 is disabled (Higher on A, Lower on K). Correct → running multiplier × step multiplier m = floor(0.99/p, 2 decimals) (table §11.3, e.g. 7: ×1.83 either way; A lower ×12.87) and the next card becomes current; wrong → bust (stake lost). COLLECT (Q) any time after ≥ 1 correct guess pays stake × running multiplier; auto-collect at ×1,000. Per-step RTP 98.46–99.00 %. Fate draw: a busting card is redrawn once with p = L/100 (tag lucky); nearmiss = bust by exactly one rank. actionCost 1 per round (any number of steps); no autoplay; F fast allowed. Controls 1 / W / wheel up Higher, 2 / S / wheel down Lower, 3 Skip, Q Collect, Space Deal, LMB brass buttons (wheel is reassigned from bet while a round is live), H, E. Stand-up or disconnect in GUESS: ≥ 1 step → auto-collect, 0 steps → refund. States STAKE/DEAL 0.6/GUESS/SKIP 0.6/REVEAL 0.9 (0.4 s hold before the last flap)/STEP 0.4/BUST 1.5/COLLECT 1.5. Events start {S}, card {rank, suit, slot}, guess {dir}, step {ok, mult}, skip {rank, suit, left}, collect {payout} / bust {rank, suit}. Hooks m.hilo.skipAdd, stepRtpAdd (cap 1.02), safetyNet, sameBonus, startMult; x.table.peekCharges (a lamp tells whether the next rank is ≥ 7; Mirror Shoe). Not a shoe game, so Counting Bead does not apply. Milestones L10 4 skips, L25 step RTP 0.995, L50 Ace bridge, L100 +5 % on collects ≥ ×10. Juice §11.11. HOUSE feat: collect a 6-step ladder.

### A.28 `keno` — Keno Lounge · Keno Salonu

Tier 2 · shared · slot LAU-02 · zone `laundry`

**Model brief (`mdl-keno`, Opus).** L slot (LAU-02 rotY 0), floor footprint 2.60 W × 1.40 D × 1.60 H plus a wall-mounted board. Four walnut writing desks in a row (0.60 × 0.45 × 0.75 each, brass edging) with stools; each desk carries a brass-framed CRT ticket writer 0.30 m (kitCrtMonitor, canvas 160 × 120, 10 × 8 number grid) and a light pen on a coiled cord. At the right end a "relay brain" cabinet 0.40 × 0.40 × 1.60 with 20 relay lamps and a DRAW # 7-seg. The wall board 3.00 × 1.80 hangs above at machine-local (0, 2.80, −0.89) (= GDD (−20.0, 2.8, −1.84)) with 80 numbered lamps in 8 rows × 10 (texKenoBoard numbers 160 × 96) and a NEXT GAME 7-seg timer. Parts: desks[0..3] {screen (ScreenSurface 160 × 120), pen (Group on a cord), stool}, relayLamps[20], leds.drawNo (3-digit), board (InstancedMesh 80 lamps, setLamp(n, state): off P02, drawn P20, your hit blinking), leds.next (4-digit), railMeters[4], seatLamps[4], armchairs (2 lounge armchairs with body-dented cushions, decor, if space at the left end). seats: 4 SeatDef (desk stool; pose (x, 1.15, 0.50) toward the CRT, FOV 55). Anchors: speaker, prompt, label, marqueeTop (relay brain top), servicePlate, boardCam (looking at the wall board), light (board glow P20 0.5 r3), light2 (relay brain amber 0.3 r1.5). Budget ≤ 1,400 tris, ≤ 20 draws.

**Logic brief (`mc-keno`, Sonnet).** MACHINES_tables §12, TableBase used as a shared draw (4 desks; tickets keep running after you leave). Pick 1–10 numbers from 1–80 (or Quick Pick), stake 1–100 per ticket per draw (× SI × Cap), draws ×1 / 5 / 10 / 20; up to 4 tickets per draw (+ seats track). 20 numbers drawn without replacement (integer weights base 100). Paytable §12.3 by spots × hits (e.g. 1 spot: 1 hit ×3.8; 10 spots: 10 hits ×200,000 and 0 hits ×2); RTP 93.6–95.4 %; tag jackpot = top prize on 7+ spots. Shared cadence: one lounge draw every 25 s while any ticket is live (sales close 3 s before LOCK); SP draws on demand. actionCost 1 pull per draw participated (not per ticket; multi-draw tickets charge per draw). Luck: solo reroll of the whole draw (p = L/100) / refund with ≥ 2 humans on the draw; nearmiss = one hit short of the top prize on 6+ spots. Controls LMB toggles numbers on the CRT, 1 Quick Pick, 2 cycle spot count, 3 draws ×1/5/10/20, 4 next ticket slot, Backspace clear, Space play / submit, V board cam. Phases TICKET/LOCK 0.5/DRAW 9.0 (one number per 0.45 s; solo fast 0.20 s)/TALLY 1.0/PAYOUT ≤ 2.5 (multi-draw → LOCK after 1.5 s). Events ticket {p, slot, picks, stake, draws}, close {drawNo, t}, draw {drawNo, numbers[20], stepMs, extra?}, result {p, slot, hits, payout}, peek {n} (private). Hooks m.keno.extraNumber (Spare Number), spotWeight.n (solo draws only), payAdd.spots.hits, zeroHitPay, quickPickLuck; x.table.peekCharges (reveal 1 of the 20 before lock). Milestones L10 hot/cold lamps, L25 0 hits on 8–9 spots pays ×1, L50 owner free extra number, L100 10/10 ×400,000. Juice §12.11. HOUSE feat: 4+ hits on a 5+ spot ticket.

### A.29 `derby` — Rat Derby "The Rat Run" · Mekanik Fare Derbisi

Tier 2 · shared · slot MID-02 · zone `midway`

**Model brief (`mdl-derby`, Opus).** XL slot (MID-02, track long axis E–W = local X), footprint 4.40 W × 2.20 D × 3.00 H. Glass-topped track 4.00 × 1.20 on legs, track surface at 0.90, six slot lanes divided by brass rails; a painted grandstand backdrop 3.20 × 0.60 behind; a split-flap tote board 2.40 × 0.80 above the far side at y 2.20; a betting console along the near rail. Rats: clockwork tin rats 0.12 long (≈60 tris: tapered fur body texFur P05/P06, two ear tris, 3-segment tail, red bead eyes, brass wind-up key on the back, numbered saddle cloth): 1 Gutter Saint #C0392B, 2 Brass Tooth #D4AC0D, 3 Little Arson #E67E22, 4 Widow's Pet #8E44AD, 5 Drainpipe #2E86C1, 6 The Accountant #27AE60; a 7th "The Albino" #E8E0C8 hidden until L10. Parts: rats[0..6] (Groups moved along local X; each with key (spins) and tail (wags)), gate (starting gate Group drops 0.8 s) + gateBell, finishLine at x +1.80 with finishCam (flash anchor) and a checker flag, tote (ScreenSurface 192 × 64: win/place odds per rat + last 10 winners), buttons.rat1..rat7, buttons.win / place / exacta / quinella, laneLamps[7], drainGrate (under the table; live rats scurry out — horror), railMeters[8], seatLamps[8]. seats: 8 standing rail spots (pose (x, 1.50, 1.30) looking down the track, FOV 60). Anchors: speaker, prompt, label, marqueeTop ("NEXT RACE" dot-matrix sign), servicePlate, followCam, light (3-bulb strip over the track P20 1.0 r4). Budget ≤ 1,600 tris, ≤ 20 draws.

**Logic brief (`mc-derby`, Sonnet).** MACHINES_tables §13, TableBase used as a shared draw (8 rail spots, unlimited bets). Each race the strengths {0.6, 1.0, 1.4, 2.0, 2.8, 4.0} are shuffled among the six rats; the tote shows odds = floor(margin/p, 1 decimal), min ×1.1 (margin 0.90 Win/Place, 0.85 Exacta/Quinella); odds are fixed at LOCK. Bets Win, Place, Exacta, Quinella: 1–200 per bet, 1,000 per race (× SI × Cap). Finishing order sampled at LOCK by Plackett–Luce; RTP ≈ 90 % win/place, 85 % exotics. Race animation 14.0 s: 28 keyframes per rat from a noisy speed profile time-warped to finish times (winner 12.8–13.6 s, gaps 0.08–0.60 s, ≥ 1 lead change); photo finish when the 1–2 gap < 0.10 s. actionCost 1 pull per race with ≥ 1 bet. Luck: solo reroll of the order (p = L/100) / refund with ≥ 2 humans; nearmiss = your Win pick second by < 0.10 s. SP races on demand; shared cadence ≈ 46 s. Controls 1–6 pick rat, Shift+1–6 second pick, 7 Win, 8 Place, 9 Exacta, 0 Quinella, LMB console, Space place bet / Ready, V follow cam. Phases ODDS 1.5/OPEN (solo ∞ / shared 20 s)/LOCK 0.6/GATES 0.8/RACE 14.0/PHOTO 1.0/RESULT 2.0/PAYOUT ≤ 2.5/RESET 3.0. Events odds {raceNo, win[6], place[6], exacta[30], quinella[15]}, bet {p, type, picks, amount}, race {raceNo, frames[28][6], order, photo}, result {order, payouts}, peek {last} (private). Hooks m.derby.runnerWeight.lane (solo draws only; Tin Jockey), oddsBonus, deadHeat, longshotBonus (Tote Ticket), exactaInsurance; x.table.peekCharges (which rat finishes last). Hotline H04 The Fixer forces your next Win pick (25 % Steward Inquiry voids it and closes the derby for the Watch). Milestones L10 The Albino (strength random 0.6–4.0), L25 Win/Place margin 0.92, L50 Trifecta (margin 0.85), L100 owner names a rat (+10 % strength, odds honest). Juice §13.11. Achievement long_odds; HOUSE feat: win with a ≥ ×10 runner.

### A.30 `fortuneteller` — Fortune-Teller "Mother Moth" · Falcı Otomatı «Güve Ana»

Tier 2 · solo · slot MOUTH-01 · zone `mouth`

**Model brief (`mdl-fortuneteller`, Opus).** M slot (MOUTH-01, faces south), footprint 1.00 W × 0.80 D × 2.25 H (ART §5.30 form, catalogue character): carved walnut base 1.00 × 0.80 × 1.00 with a glass cabinet on top to 2.25, six P19 marquee bulbs along the top, dispenser slot in the front. Inside: Mother Moth, a veiled half-body automaton (kit.dealer oracle rig: moth-wing headdress of two 0.25 × 0.18 planes with the moth texture, SCREENDOOR 12/16 veil over the lower face, porcelain hands) with folded moth wings that spread on The Grand Omen; a crystal ball (icosa 0.08 detail 1, glass + inner emissive swirl texture with uvScroll 0.1/s); a velvet shelf onto which three face-down omen cards slide. Parts: oracle {head (can turn 180° — The Pit card), jaw (syllable sync), handL, handR, wings (L/R Groups)}, crystal (emissive colour set by logic: blessing #FFC83D, curse #7A2A9A, neutral grey), cardSlot, cardSlots[3] (anchors on the shelf), omenCards[3] (0.07 × 0.12 planes; faces drawn by texTarotCard for omens 0–21: roman numeral, pictogram, name plate), buttons.veil1..3 (brass), coinSlot, bulbs (6), fog (decal plane on the glass; alpha driven) + fogLetter (canvas 32 × 32 where one letter of the player's name is written stroke by stroke), leds.credit/bet/win. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (crystal P38 / P47 0.6 r1.5). Budget ≤ 1,500 tris, ≤ 14 draws. Play pose standing (0,1.40,0.60)→(0,1.05,0.10) FOV 55.

**Logic brief (`mc-fortuneteller`, Sonnet).** MACHINES_tables §14 (solo-occupant). Stake 10–200 (betLimits). The 22-card Omen deck is shuffled per reading by the authority; three face-down cards (Past · Present · Future, cosmetic names) are dealt; pick one (1/2/3 or LMB): pays stake × coin multiplier (0, 0.5, 1, 1.5, 2, 3, 5 per §14.3) and applies its omen as buff `buff.omen.<n>` through run.buffs (7 blessings, 5 curses, 10 neutral, The Mirror repeats your previous omen; The Debtor adds +2 % to the current quota; The Grand Omen grants a free common charm). Defy Fate (key 4) once within 6 s: pay the stake again (addStake, no pull) to void the card and pick one of the remaining two (final). Unpicked cards are then revealed. Coin RTP 86.36 % (19/22); with omens ≈ break-even. actionCost 1 per reading; no autoplay. Luck: if the picked card has coin < 1 or is a curse, with p = L/100 it is swapped invisibly for a random non-curse undealt card; nearmiss = The Grand Omen among the unpicked. Controls 1/2/3 or LMB pick, 4 Defy, Space insert coin / start, H omen almanac (22 cards EN/TR), E (leaving in PICK auto-picks slot 1; in DEFY_WINDOW = no defy). States SLEEP/AWAKEN 1.5/SHUFFLE 1.8/DEAL 3 × 0.5/PICK/REVEAL 1.2/DEFY_WINDOW 6/PICK2/REVEAL2 1.2/APPLY 1.0/OTHERS 1.5. Events start {S}, pick {slot}, reveal {slot, omen}, defy {slot2}, apply {omen, coins, buff}, others {slots}; veil (private, seeVeil). Hooks m.fortuneteller.omenWeight.id, defyCostMult, seeVeil, curseImmunity, omenDurationMult, grandOmenRarity; x.table.peekCharges (= seeVeil). Hotline: H11 The Census makes the next reading free; H24 makes Defy free and the first card never a curse. Milestones L10 Defy costs 0.75 S, L25 almanac shows remaining odds, L50 curses half duration, L100 Grand Omen uncommon. Not staffable. Juice §14.11. HOUSE feat: draw The Grand Omen or The Eye.

### A.31 `coinflip` — Coin-Flip Booth · Yazı-Tura Kabini

Tier 2 · solo · slot WELL-13, BOI-05 · zone `well`

**Model brief (`mdl-coinflip`, Opus).** S slot, footprint 0.78 W × 0.78 D × 2.00 H (v1.1, ART §5.28 bell-jar styling, catalogue booth character): walnut base cabinet 0.78 × 0.78 × 1.00 with brass trim; on top a P41 velvet cushion under a glass bell jar (kitGlassDome r 0.25, h 0.45) containing a mechanical brass thumb on a lever and a giant brass coin landing on a felt pad with a narrow edge groove; four slim brass posts rise to 2.00 carrying a deco sign "CALL IT" and ten neon streak segments #2AF0FF around the frame. Parts: thumb {base, mid, tip} (3 hinged segments; cock 0.3–0.4 s, flick), coinPivot (translates Y up to 0.22–0.38 m) + coin (r 0.06 × 0.008, faces CROWN and SKULL painters, rotation about local X: CROWN up at 0), pad, lamps.crown / lamps.skull / lamps.edge (above the pad), buttons.crown (P23), buttons.skull (P46), buttons.edge (small red), lever (LeverPart, drag up = flip), betDial (rotary, 8 detents), streakNeon[10] (lit per ride), leds.credit/bet/win (WIN = current ride value), marquee (sign). Colourways 0–3 for the two instances. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut (tray in the base), light (jar-top bulb P09 0.6 r1.5). Budget ≤ 700 tris, ≤ 10 draws. Play pose standing (0,1.45,0.50)→(0,1.10,0) FOV 50. This replaces the M0 core reference model (TECH §3.6).

**Logic brief (`mc-coinflip`, Sonnet).** MACHINES_tables §15 (solo-occupant). Stake 1–500 (betLimits). Call CROWN, SKULL or EDGE (keys 1/2/3); the thumb flips: one weighted draw CROWN 49 / SKULL 49 / EDGE 2. CROWN/SKULL pay 1:1 (98.0 %), EDGE pays 47:1 (96.0 %); an EDGE result loses face calls. Ride: after a win re-stake the whole payout on a new call (R = same call, or 1–3 then Space) up to 10 rides, free of pulls, or COLLECT (Q); 10 straight wins = streak:10 "Golden Thumb" (all neon gold). The 2-human "Call It" duel is a T2 item (needs a shared variant). actionCost 1 per new stake; autoplay G for single flips only (no rides). Luck: a losing flip is redrawn once with p = L/100; nearmiss = cosmetic edge teeter on 10 % of losses. Controls 1/2/3 call, Space flip (or LMB-drag the lever up), R ride, Q collect, wheel/Z/X stake, H, E (= collect during a ride; disconnect = collect). States STAKE/WIND 0.4/FLIP 1.1–1.6 (6–12 rotations)/LAND 0.5–1.2 (Euler-disk wobble, edge teeter 1.2 s)/RESULT 0.8/RIDE_OR_COLLECT/COLLECT 1.2. Events call {side, S, ride}, flip {result, spins, airMs, wobbleSeed, teeter}, collect {payout}. Hooks m.coinflip.edgeWeightAdd, edgePayAdd, faceWeight.crown|skull, rideCapAdd, streakBonus, reflip (Hollow Dice: re-flip a loss once, a winning re-flip pays ×0.8); x.table.peekCharges (the thumb twitches if the next flip is CROWN, 80 % reliable); Chipped Die refunds 15 % of losses. Milestones L10 EDGE 50:1, L25 ride cap 15, L50 streak-5 bonus +1 × S, L100 CROWN pays 1.05:1. Juice §15.11 (thumb tink, coin whirr, felt thud + ring; EDGE → long teeter, pit-wide gong; ART twist: an edge result keeps the coin standing and the booth lights die 2 s). Achievement edge_case; HOUSE feat: EDGE or a 5-ride streak.

### A.32 `threecard` — Three Card Poker · Üç Kart Poker

Tier 3 · shared · slot CARD-08 · zone `cards`

**Model brief (`mdl-threecard`, Opus).** L slot (order-only; appears at the CARD-08 pad), half-moon table 1.80 × 0.90, felt at 0.78, felt_green with six seat layouts (Ante, Play, Pair Plus circles; print canvas 128 × 64), padded leather_black rail, 6 stools; footprint ≤ 2.4 × 1.6. Dealer "the Shuffler": a standing mannequin (kit.mannequin, porcelain mask) whose torso is replaced by a mechanical card shuffler — a brass box 0.30 × 0.25 × 0.35 at chest height with a whirring card slot. Parts: shuffler (Group at the dealer anchor) {lid (hinged; pops open in gold light on a straight flush), slot (card-out anchor), gears (2 spinning discs visible through a window)}, placard (engraved "Q · 6 · 4" brass placard in front of the dealer, LampPart lit from L10), lamps.qualify (two-state QUALIFIES / NO QUALIFY), cards (CardPool 24, single deck), chips (ChipPool 300), railMeters[6], seatLamps[6], stools[6], pendant. seats: 6 SeatDef (stool; pose (x, 1.18, 0.70) FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, dealer, light (pendant P20 1.2 r4 BUZZ). Budget ≤ 1,500 tris, ≤ 20 draws. Follow ART table conventions (kitTable 'half', felt tessellated ≤ 0.5 m, brass P23 trims).

**Logic brief (`mc-threecard`, Sonnet).** MACHINES_tables §16, TableBase with 6 seats. One deck reshuffled every hand (fair hash at deal). Players post Ante (5–200) and/or Pair Plus (1–100) (× SI × Cap). Each seat and the dealer get 3 cards; own cards are private (sendPrivate), the dealer's face down. DECIDE: Play (adds a Play bet equal to the Ante via addStake) or Fold (lose the Ante; Pair Plus still settles). Dealer qualifies with Q-high or better; not qualified → Ante 1:1, Play pushes; qualified → higher hand wins Ante and Play 1:1, lower loses both, tie pushes. Ante Bonus (if you played): straight 1:1, trips 4:1, straight flush 5:1. Pair Plus: pair 1:1, flush 3:1, straight 6:1, trips 30:1, straight flush 40:1. A-2-3 is a straight. RTP 96.63 % per Ante, 92.72 % Pair Plus (verify with simulate()). actionCost 1 per hand; no autoplay. Luck: solo → the dealer's three cards are redrawn from the remaining 49 once (p = L/100) if your net < 0; shared → refund mode. Phases OPEN (solo ∞ / shared 15 s)/DEAL (0.25 s per card, shuffler whirr)/DECIDE (shared 12 s, default Fold)/REVEAL 0.9/SETTLE (Ante, Play, Bonus, Pair Plus in order). Controls 1 Play, 2 Fold, 3 swap (if charged), Space Deal / Ready, LMB circles, common table keys. Events deal {seat, cards} (private) + public {seat, cards:null}, decide {timeoutMs}, act {seat, choice}, reveal {dealer, qualifies, shown} (folded hands stay hidden), result {seats}, peek {card} (private). Hooks m.threecard.pairPlusAdd.rank, anteBonusMult, swapOne, miniRoyal; x.table.peekCharges (one dealer card, Mirror Shoe). Not a shoe game (no Counting Bead). Milestones L10 Q-6-4 placard lights when your hand beats it, L25 Pair Plus straight 7:1, L50 Ante Bonus trips 5:1, L100 mini-royal 100:1. HOUSE feat: straight flush or better. Orderable once the Card Room is open (GDD §3.7.6).

### A.33 `reddog` — Red Dog "The Kennel" · Kırmızı Köpek «Kulübe»

Tier 3 · shared · slot CARD-08 · zone `cards`

**Model brief (`mdl-reddog`, Opus).** L slot (order-only; appears at the CARD-08 pad), table 1.80 × 0.90, felt at 0.78, burgundy felt #5A1A1E, 6 stools, padded rail; footprint ≤ 2.4 × 1.6. Dealer: a dog-headed automaton in a waistcoat standing behind (kit.mannequin body + procedural dog-head prop on the Head bone: snout box, two triangle ears on hinges, hinged jaw, glass eyes) with a servo tail. Above the card spot a brass spread bar with 11 lamps and a pay label. Parts: dog {head, jaw (barks), earL, earR (up/down for the peek tell), tail (wags on wins)}, spreadLamps[11] (lit range = spread), payLabel (ScreenSurface 48 × 16, e.g. "5:1"), cardSpots[3] (left, right, middle anchors), shoe (6 decks) + discard, cards (CardPool 12), chips (ChipPool 300), beadCounter (Counting Bead, hidden), railMeters[6], seatLamps[6], stools[6], pendant. seats: 6 SeatDef (stool; pose (x, 1.18, 0.70) FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, dealer, light (pendant P20 1.2 r4). Budget ≤ 1,500 tris, ≤ 20 draws. ART table conventions (kitTable 'rect', felt tessellation, P23 trims).

**Logic brief (`mc-reddog`, Sonnet).** MACHINES_tables §17, TableBase used as a shared draw (one shared hand for the table, 6 seats). 6 decks, ranks 2…A (A high). Bet 5–200 (× SI × Cap). Two cards are dealt face up: consecutive → push; pair → a third card: three of a kind pays 11:1, otherwise push; otherwise the spread = ranks strictly between; the dog barks it (0.25 s per bark). RAISE_WINDOW: each player may raise up to their original bet (addStake); raises are collected simultaneously at the end of the window (nobody sees others' raises first). Third card strictly inside the spread → win at the spread's pay on the whole wager (spread 1: 5:1, 2: 4:1, 3: 2:1, 4–11: 1:1), else lose. RTP 97.20 % raising on spread ≥ 7 (92.03 % never raising). actionCost 1 per hand. Luck: shared → refund mode; solo → the missing third card is redrawn once (p = L/100). Phases OPEN (solo ∞ / shared 12 s)/DEAL 0.8/SPREAD (barks)/RAISE_WINDOW (shared 8 s, default no raise; skipped on consecutive/pair)/THIRD 0.9 (0.4 s hover)/SETTLE ≤ 2.0. Controls 1 Raise full, Shift+1 raise half, 2 no raise, Space Ready / Deal, common table keys. Events two {c1, c2, spread, pays}, raise {seat, amount}, third {card}, result {seats}, peek {high} (private: the dog's ears tell whether the third card is above or below 8). Hooks m.reddog.spreadPayAdd.spread, raiseMax, pairWin, tripsPayAdd; x.table.peekCharges (ears), x.table.shoeInfo (Counting Bead). Milestones L10 spread bar shows win %, L25 spread 1 pays 6:1, L50 raise up to 2×, L100 trips 15:1. Juice §17.11 (barks, tail wags, trips howl, push whimper + shrug). HOUSE feat: trips. Orderable once the Card Room is open.

### A.34 `bingo` — Bingo "Hall of Calls" · Tombala Salonu (Bingo)

Tier 3 · shared · slot LAU-01 · zone `laundry`

**Model brief (`mdl-bingo`, Opus).** XL slot (LAU-01 rotY 90: caller cage west/back, desks east/front), footprint 4.60 W × 2.50 D × 2.60 H. Back-left: the caller's booth with "the Caller" (kit.mannequin in a cardigan + hinged-jaw porcelain mask and a gooseneck microphone 0.35 m with a chrome ball) cranking a wire ball cage Ø0.40 holding 75 wooden balls; behind the caller a flash board 2.00 × 1.00 at y 1.4–2.4 with 75 lamps in B · I · N · G · O columns (texBingoBoard). Front: 8 daub desks in two rows of 4 (0.55 × 0.45 × 0.75 each, benches), each holding up to 4 paper cards. Parts: cage (Group rotating about its axle) + crank, cageBalls (InstancedMesh 75 r 0.018), ballPop (anchor where the called ball appears) + ballDisplay (ScreenSurface 64 × 24 "B-12"), board (InstancedMesh 75 lamps, lit P20), leds.balls (2-digit ball count), caller (anchor), desks[0..7] {cards[4] (0.20 × 0.24 planes; the coder draws texBingoCard 40 × 48 canvases and daubs), dauber (cylinder r 0.02 h 0.11, P43 cap), oneToGo (amber LampPart #FFB000), seat}, railMeters[8] (on the desks), bulbs (two caged ceiling bulbs on hooks at 2.6, DYING). seats: 8 SeatDef (bench; pose seat + (0, 1.12, 0) → the card 0.30 inward, FOV 55, free-look ±25° to see the board). Anchors: speaker, prompt, label, marqueeTop, servicePlate, callerCam, light (bulb A P20 0.9 r4 DYING), light2 (flash-board glow 0.5 r3). Budget ≤ 1,800 tris, ≤ 24 draws. Patrons (Regulars) at empty desks are spawned by the coder at desks[i].seat.

**Logic brief (`mc-bingo`, Sonnet).** MACHINES_tables §18, TableBase used as a shared draw (8 desks + patrons). BUY (solo ∞ / shared 15 s): 1–4 cards at stake S each (2–50, × SI × Cap; seats track / cardSlotsAdd raise the card cap); cards generated by the host, public. LOCK 0.8: all 75 balls ordered by the host (hidden). CALL: 40 balls × 1.4 s (solo fast 0.7 s). Each card is evaluated for its single best completed pattern: Line ×0.8, Corners ×1.5, Double Line ×2.5, Triple Line ×10, X ×30, Frame ×250 (jackpot). EXTRA balls (≤ 8): offered privately only when one of your cards is one number away from a better pattern; price = ceil(1.15 × exact EV gain over the remaining 35 balls), min 1; extras are the next balls in the order and apply only to buyers (addStake, no pulls). Base RTP ≈ 93.4 %. actionCost 1 pull per game. Luck: solo → the 40-ball draw is rerolled once (p = L/100) if your net < 0; shared → refund on losing cards; nearmiss = "1 TO GO" for X or Frame. Shared cadence 75–130 s per game; SP on demand. Controls 1–4 zoom a card, LMB manual daub, Space buy / Ready, 5 buy the offered extra ball, Backspace decline, V caller cam. Phases BUY/LOCK/CALL 56 s/EXTRA (offer ≤ 6 s → ball 1.4 s)/AWARD 2.0. Events cards {p, cards}, call {idx, n}, pattern {p, cardId, pattern}, offer {idx, price, target} (private), buy, extra {idx, n}, award {p, cards}, peek {n} (private). Hooks m.bingo.freeDaub, extraBallDiscount, patternPayAdd.pattern, cardSlotsAdd, secondFree, ballCountAdd (Spare Number +3 private balls); x.table.peekCharges (next extra ball). Milestones L10 "1 TO GO" helper on all cards, L25 5 cards, L50 41 base balls, L100 Frame ×500. Juice §18.11. HOUSE feat: X pattern or better.

### A.35 `lottoblower` — Lotto Ball Blower "The Breath" · Loto Küresi «Nefes»

Tier 3 · shared · slot LAU-07 · zone `laundry`

**Model brief (`mdl-lottoblower`, Opus).** M slot (LAU-07 rotY 180), footprint 1.20 W × 0.95 D × 2.20 H (ART §5.26 form): brass and walnut base 0.90 × 0.90 × 0.95 with a clear acrylic sphere r 0.32 on top (centre y 1.30) holding 30 white balls (texLottoBall numbers 1–30), a small sphere r 0.14 at the base's right side holding 8 red Moon balls, a goose-neck extraction tube rising from the big sphere and curving down to a 6-slot rack in front (5 main + 1 Moon), a 10-digit 7-seg jackpot counter on top, and a ticket kiosk CRT (0.30 × 0.23) with a DRAW lever on the right edge of the base. Parts: sphere, balls (BallPool 30 r 0.022), moonSphere, moonBalls (BallPool 8 r 0.022 red), tubePath (exported V3[] points for the drawn-ball animation), rack[6] (slot anchors), valve (Group, thunk), leds.jackpot (10-digit), kioskScreen (ScreenSurface 160 × 120: 6 × 5 number grid + Moon row 1–8), lever (LeverPart, drag down = draw in SP), winners (ScreenSurface 128 × 32 flip text), curseBall (a black ball "0" in P47, hidden; appears during curses), leds.credit/bet/win. seats: 4 standing spots around the kiosk (TableBase shared draw), pose (0,1.30,0.50)→kiosk FOV 55. Anchors: speaker, prompt, label, marqueeTop, servicePlate, sphereCam, light (base under-light P38 0.6 r1.5). Budget ≤ 1,500 tris incl. balls, ≤ 14 draws.

**Logic brief (`mc-lottoblower`, Sonnet).** MACHINES_tables §19, TableBase used as a shared draw (any number of lines from 4 kiosk spots). A line = 5 numbers from 1–30 + 1 Moon from 1–8 (Quick Pick available); line price 5 (× SI × Cap); 1–20 lines per draw. Draw: 5 main balls without replacement (weights base 100), then 1 Moon. Paytable §19.3 (× line price): 5 + Moon = progressive JACKPOT (pool 'lotto', host-owned, seed 20,000 lines, 8 % of every line feeds it, split equally among simultaneous winners), 5 ×5,000, 4 + Moon ×500, 4 ×80, 3 + Moon ×40, 3 ×8, 2 + Moon ×8, 2 ×1, 1 + Moon ×2, 0 + Moon ×1. RTP 85.97 % + jackpot ≈ 94 %. SP: the draw starts when you pull the lever (Space or LMB-drag); MP: one draw every 120 s (host setting 60–300 s) with a 10 s pit-wide CLOSE countdown. actionCost 1 pull per draw participated. Luck: solo → reroll the draw (p = L/100) if the ticket's net < 0; shared → refund per losing line batch; nearmiss = 4 main + wrong Moon. Controls LMB numbers on the CRT, 1 Quick-Pick line, 2 add line, 3 quick ×5 / ×10 / ×20 lines, Space buy (MP) / lever (SP). Phases SALES/CLOSE 10/BLOW 3.0/DRAW 5 × 3.0/MOON 5.0/RESULTS 5.0. Events buy {p, lines}, pool {jackpot} (≤ 4 Hz), close {drawNo, t}, draw {drawNo, main[5], moon, extra?, pathSeed}, result {jackpot, winners}, peek {moon} (private). Hooks m.lottoblower.extraBall (Spare Number: private extra main ball), moonWeight.n (solo only), jackpotShare, freeLine; x.table.peekCharges (Moon before close). Hotline H23 Lucky Numbers guarantees 2 of the caller's 6 numbers drawn this Watch. Milestones L10 Moon 1 of 7, L25 3 matches ×10, L50 two Moon balls (either matches), L100 jackpot seed ×5. Achievement lucky_numbers (5+). HOUSE feat: match 4+.

### A.36 `tombola` — Tombola Raffle Drum · Piyango Tamburu

Tier 3 · solo · slot WH-02 · zone `wheels`

**Model brief (`mdl-tombola`, Opus).** L slot (v1.1, WH-02 at (29.95, 0, 2.0) rotY 270), footprint 2.40 W × 1.20 D × 2.30 H: a fairground stall counter 2.00 × 0.80 × 1.00 under a striped awning (P13/P09 scallops), a hexagonal wire drum on an A-frame stand at the counter's left (ART §5.31: length 0.60, 0.45 across flats, brass frame, wire_mesh CUTOUT panels, axle at y 1.10, hatch door on one face) with kit.crank on its right; behind the counter a prize shelf of 20 lit cubbies labelled 00, 05 … 95 (4 rows × 5, 0.18 cubes); a cork board with pinned old IOUs (some dated in the future), a red ticket-roll dispenser, a hanging bare bulb. The Ticket Widow: a hand puppet in black lace popping up behind the counter. Parts: drum (Group rotating about X) + hatch, crank, tickets (InstancedMesh 100 folded slips 0.04 × 0.03 in P09 / P19 / P15; the coder tumbles them and scales ticketVolume), pulledTicket (anchor; unfolding plane 0.12 × 0.09 with a 64 × 48 number canvas), cubbies[20] {lamp (LampPart), icon (ScreenSurface 32 × 32 prize icon)}, leds.left (3-digit TICKETS LEFT), queueLamp, widow {body, head, veil, handL, handR} (pop up, clap, head shake, confetti throw), evGauge (L10 live-EV needle, hidden), leds.credit/bet/win. Anchors: speaker, prompt, label, marqueeTop (awning centre), servicePlate, stand, light (bare bulb P20 0.8 r2.5 CANDLE). Budget ≤ 1,100 tris, ≤ 14 draws. Play pose standing (0.25, 1.50, 0.70)→(0, 1.10, 0) FOV 55.

**Logic brief (`mc-tombola`, Sonnet).** MACHINES_tables §20 (solo-occupant on a shared, persistent drum: one puller at a time, others queue and watch; drum state lives in the instance snapshot). The drum holds 100 tickets 00–99 drawn without replacement; ticket price P = 10 (× SI scale). Pay → crank ≥ 1 full turn (LMB-drag circles; Space auto-crank ~1.5 s) → LMB the hatch to pull → drag up to unfold. Tickets ending in 0 or 5 win the prize in that cubby (the cubby empties). Restock (6.0 s, the Widow refills) when ≤ 30 tickets remain (tombola.restockAt) or all prizes are gone: 10 × 2P coins, 5 × 3P coins, 3 × 6P (coins or a consumable of equal value), 1 × 12P (common charm or 12P coins, player's choice), 1 × 25P Grand (uncommon charm or 25P coins). Full-drum RTP 90.0 % exactly; the live EV (remaining prize value ÷ remaining tickets) can exceed 100 % late — intended drum-reading skill. actionCost 1 per ticket. Luck: a blank ticket is slipped back and another pulled with p = L/100. Controls crank drag / Space, LMB hatch, drag up unfold, 1/2 prize option, 4 feel (peek: a blank may be dropped back once), H, E (after PULL the ticket auto-unfolds and settles). States PAY/CRANK/PULL 0.6/UNFOLD 0.8/PRIZE 1.5 (choice ≤ 10 s)/BLANK 0.8; RESTOCK 6.0. Events pay, crank {angle} (≤ 8 Hz cosmetic), pull {ticket}, prize {cubby, prize}, restock {shelf, tickets}, state {remaining, shelf}. Hooks m.tombola.priceMult, doublePull (Spare Number: pull 2 keep the better), prizeMult, restockAt; x.table.peekCharges (feel). Milestones L10 live-EV gauge, L25 restock at 20 left, L50 a 21st cubby (number 50 doubled), L100 Grand rarity +1. Cassettes drop from the Grand prize. Juice §20.11. HOUSE feat: a Grand prize ticket.

### A.37 `shellgame` — Shell Automaton "Monsieur Thimble" · Bardak Oyunu Otomatı «Mösyö Yüksük»

Tier 3 · solo · slot PAR-02 · zone `parlour`

**Model brief (`mdl-shellgame`, Opus).** M slot (PAR-02 rotY 180), footprint 1.20 W × 0.80 D × 2.00 H carnival puppet booth (ART §5.27 form, catalogue character): striped awning (16 × 16 P13/P09, scalloped triangle edge), counter at 0.95 with a green felt shelf behind glass, coin slot on the front. Behind it Monsieur Thimble: a waist-up automaton — porcelain mask with a waxed moustache on a neck pole, striped vest, white gloves, two over-long arms (3 segments of 0.35 m) with 3-joint fingers (kit.dealer puppet rig). Three brass thimble-cups (frustum 8-seg, r 0.035 / 0.05, h 0.07) and a red pearl (sphere r 0.012) on the felt. Parts: thimble {head, jaw (opens 0.3 s to show the pearl on a P15 tongue), armL, armR (3 joints each), handL, handR, fingerWag, sleeveGlint (2-frame glint sprite #FFF4C0 at the sleeve cuff)}, cups[3] (Groups; swaps run along semicircles, lift 0.08 m), pearl, heatBulbs[5] (brass bulbs on the booth top), jamSign ("OUT OF ORDER", hidden), bulbString (5 emissive bulbs under the awning), leds.credit/bet/win, coinSlot. Anchors: speaker, prompt, label, marqueeTop, servicePlate, stand, light (P20 0.9 r2.5 CANDLE). The play pose is fixed during the shuffle (camera locked for fairness): pos (0, 1.30, 0.55) → look (0, 1.00, 0), FOV 55. Budget ≤ 1,000 tris incl. automaton, ≤ 14 draws.

**Logic brief (`mc-shellgame`, Sonnet).** MACHINES_tables §21 (solo-occupant). Stake 5–20 (betLimits; L25 raises the cap to 50). INSERT → SHOW (pearl under the middle cup, 1.0 s) → COVER 0.5 → SHUFFLE (swap count, swap time and palm chance c by Heat: 0 → 6 swaps, 0.50 s, 0.15; 1 → 8, 0.42, 0.25; 2 → 10, 0.36, 0.35; 3 → 12, 0.30, 0.45; 4 → 14, 0.26, 0.55; 5 → 16, 0.22, 0.65) → PICK within 8 s (timeout = loss): pearl under your cup pays 1:1; Call Cheat (4) pays 3:1 if the pearl was palmed, otherwise loses. Heat h = consecutive wins here (0–5); a loss or > 30 s away resets it; after 5 straight wins the automaton jams (OUT OF ORDER) until the next Night. The palm (rolled at commit) shows only as a 2-frame sleeve glint. RTP: random 56.7 % at Heat 0; perfect tracking 170 / 150 / 130 / 110 / 90 / 70 % at Heat 0–5. Luck lowers the palm chance: c' = c × (1 − L/100). Streamed swaps: emit each swap 0.9 × its duration ahead and the palm event at the glint frame, so watchers never learn the final cup early. Controls 1/2/3 or LMB cup, 4 Call Cheat, Space insert coin, H, E (leaving during PICK = loss). States INSERT/SHOW/COVER/SHUFFLE/PICK/REVEAL 1.0/PAY 1.0/JAMMED. Events start {S, heat}, swap {k, a, b, durMs}, palm {k}, pick {cup | 'cheat'}, reveal {pearlCup, win}, jam. Hooks m.shellgame.swapSlow (Brass Knuckles ×0.8), glintFrames (Dowsing Rod +2), cheatPayAdd, heatCap, secondGuess; x.table.peekCharges (the pearl's cup glows 0.3 s after the shuffle). Not staffable. Milestones L10 Heat decays 1 per minute instead of resetting, L25 stake cap 50, L50 cheat pays 4:1, L100 jam after 7 wins. Juice §21.11. Achievement i_saw_that; HOUSE feat: Call Cheat correctly.

### A.38 `fantan` — Fan-Tan · Fan-Tan (Düğme Sayma)

Tier 3 · shared · slot WH-03 · zone `wheels`

**Model brief (`mdl-fantan`, Opus).** L slot (WH-03 rotY 180), footprint 2.40 W × 1.80 D × 1.80 H: a low black-lacquer table 1.40 × 1.40 at 0.70 (reduced from the catalogue's 1.60 to fit L) with a painted square 0.60 in the centre whose sides are numbered 1–4, six velvet cushions (0.45 × 0.45 × 0.10) — three along the front edge, one on each side, one at the front corner — and the croupier "Old Lacquer", a kneeling automaton behind the table at −Z (kit.mannequin in a kneeling pose with a porcelain mask; holds a bone wand). Parts: square (canvas 128 × 128) + sideLamps[4] (edge glow on the winning side), buttons (InstancedMesh 200 brass buttons r 0.01 h 0.004 with per-instance transforms for the heap and the counted groups), bowl (brass inverted bowl Group, lifts 0.25 m), wand (Group in the croupier's right hand), groupRows (anchor area where counted groups of 4 line up in rows players can count), history (ScreenSurface 96 × 16, last 12 results), gong (disc on a small stand, struck at REVEAL), goldenButton (instance index flagged gold, hidden until L50), chips (ChipPool 300), railMeters[6] (small lacquer trays), seatLamps[6], lantern (paper lantern overhead). seats: 6 SeatDef (cushion, low eye 1.05: pos (x, 1.05, z+0.20) → square, FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (lantern P19 0.8 r3 CANDLE). Budget ≤ 1,200 tris, ≤ 20 draws.

**Logic brief (`mc-fantan`, Sonnet).** MACHINES_tables §22, TableBase with 6 seats. SCOOP (2.0 s): the croupier scoops a random heap of N buttons under the bowl; N is hidden. OPEN (solo ∞ / shared 15 s): bets on the square — Fan n (3:1), Nim n/m (2:1, m pushes), Kwok adjacent pair (1:1), Odd / Even (1:1), Ssh three sides (1:3); all winnings less 5 % commission (x.table.rakeDelta). Limits 5–500 per spot (× SI × Cap). LOCK 0.6 (bets debited, fair hash), LIFT 1.0 (N revealed), COUNT: the wand removes groups of 4 (every 0.35 s, after 10 groups 0.20 s, the last 12 buttons at 0.60 s per group; 5–9 s) until 1–4 remain = r; REVEAL 1.0 (final buttons glow, gong), PAYOUT ≤ 2.0, SWEEP 1.0. Host draws r uniform 1–4 and k uniform 0–19; N = 40 + 4k + r (sent only at LIFT, after bets lock). RTP 96.25 % (Fan) – 98.75 % (Ssh). actionCost 1 per count; autoplay allowed. Luck: solo reroll (p = L/100) / shared refund. Controls LMB on the square (sides = Fan, corners = Kwok, drag from the win side to the push side = Nim), 1–4 quick Fan, Space Ready, common table keys. Events scoop, lift {n, layoutSeed}, count {stepMs[]}, result {r, seats}, peek {even} (private: N's parity before LOCK). Hooks m.fantan.sideWeight.n (solo only), nimPushPays, goldenButton; x.table.rakeDelta, x.table.peekCharges. Milestones L10 commission 4 %, L25 Nim push side pays 0.5:1, L50 Golden Button (if among the final remainder, winning bets pay double), L100 commission 0 %. Juice §22.11 (brass clinks, wand ticks, heartbeat during the last 12 buttons, gong). HOUSE feat: win a single-number (Fan) bet.

### A.39 `teetotum` — Put-and-Take Top · Al-Ver Topacı

Tier 3 · shared · slot BOI-04 · zone `boiler`

**Model brief (`mdl-teetotum`, Opus).** L slot (BOI-04 rotY 180), footprint 2.40 W × 1.80 D × 2.00 H: a round baize table Ø1.20 at 0.76 (reduced from 1.40 to fit L) centred at z −0.15, six stools on the front 220° arc (radius 0.95 about the table centre, all inside the footprint), a brass pot bowl in the centre and, beside it, the 0.18 m brass eight-sided spinning top. The top's faces carry language-free pictograms (arrow into the bowl = put, arrow out = take): +1, +2, ALL+, −1, −2, ½, ALL, ∅. Parts: top (Group: body + stem; spin, precession and fall are driven by logic) + topFaces (canvas 256 × 32 strip mapped around the 8 faces), potBowl + potChips (ChipPool 300 heaped in the bowl), stacks[6] (per-seat chip anchors), turnLamps[6], railMeters[6], stools[6], botSeats[6] (anchors where the coder spawns patron bots with jerky wooden hands), legend (brass placard explaining the 8 faces with pictograms), pendant (bare bulbs on cords, Boiler style). seats: 6 SeatDef (stool; pose (x, 1.15, 0.55) → the bowl, FOV 60). Anchors: speaker, prompt, label, marqueeTop, servicePlate, light (bare bulb P20 0.9 r3). Budget ≤ 1,100 tris, ≤ 20 draws. ART conventions: brass P22/P23, felt tessellated ≤ 0.5 m, 15 fps patron hands.

**Logic brief (`mc-teetotum`, Sonnet).** MACHINES_tables §23, TableBase PvP with 6 seats; bots fill empty seats (3 difficulty levels). Table ante A ∈ {5, 20, 100} (× SI scale, L10 adds a 500 table). A pot cycle starts with every seated player anteing A. Turns go clockwise; spin the top (stem flick or Space; 8 s timer → auto-spin): each face 1/8 (weights base 100): +1 put A, +2 put 2A, ALL+ everyone puts A, −1 take A, −2 take 2A, ½ take floor(pot/2), ALL take the whole pot (cycle ends), ∅ nothing. Before spinning you may declare Double (D): ±1 / ±2 amounts doubled for this spin. Takes are capped by the pot; broke players sit out; after 20 spins the pot is split. Rake 5 % of every ALL take and of the final split. RTP ≈ 97.4 % (zero-sum minus rake). Puts are added with addStake; one outcome per player per cycle (bet = ante + puts, payout = takes). actionCost 1 pull per pot cycle. Luck applies only against bots: a losing face (+1, +2, ALL+) on your spin is respun once with p = L/100 when no other human is seated. Controls stem flick / Space, D Double, 1 sit out next cycle, Q leave after this cycle. Phases ANTE 1.5/TURN 8/SPIN 2.5–5.0 (spin, precession, fall)/APPLY 1.0/CYCLE_END 2.0. Events ante {seats, pot}, turn {seat, timeoutMs}, double {seat}, spin {seat, face, durMs, precessSeed}, apply {seat, face, moves, pot}, end {rake, split}. Hooks m.teetotum.faceWeight.face (no other human), takeBonus (House-paid), putShield; x.table.rakeDelta; x.table.peekCharges (the top wobbles toward a take face, 80 %). Milestones L10 ante-500 table, L25 rake 4 %, L50 golden face (pays double), L100 owner earns the rake of all teetotum tables. Juice §23.11. HOUSE feat: a take-all result.
