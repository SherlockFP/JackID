# Completeness critic (design phase)

No file written (role says do not edit files). Findings, ordered by impact:

**Missing vs the client's request**
1. All the Turkish/party games from Addendum 6 are deferred to T2 in PLAN §3: SON KART, OKEY, PİŞTİ, TAVLA. So are Totems, Collateral, boss Nights and randomised line-ups. Fix: move TAVLA, PİŞTİ and SON KART to T1 as `TableBase` devices on PAR-03..05. Move `threecard` and `reddog` (order-only) to T2 to free the time.
2. "Every gambling machine" is not met. Missing: Pai Gow, Caribbean Stud / Let It Ride, Casino Hold'em, Crown & Anchor, Two-Up, pull-tab / punchboard, Spanish 21, Faro. Fix: add `def.variants`, the same way `cardwar` has dragontiger (blackjack→Spanish21, threecard→Caribbean, sicbo→Crown&Anchor, coinflip→Two-Up, scratch→pull-tab, holdem→Casino Hold'em). That is about 6 games for rules-only cost.
3. Friends on the internet cannot find rooms out of the box. The lobby defaults to the same host, there is no hosted lobby, and Trystero GLOBAL is off (`useP2P:false`). Fix: turn GLOBAL on automatically when the lobby is unreachable. Add `docs/DEPLOY.md` (Fly/Render one-box, `VITE_LOBBY_URL`, TURN via `ICE_SERVERS`) to the lobby-server Definition of Done.
4. The server browser STATE column ("B5 · W2") and Friends-only rooms have no field on the server. `RoomPublic` and `update.patch` lack them. Fix: add `status` (≤ 8 chars) and `unlisted: boolean`. The server hides unlisted rooms from `list` but still allows `join` by id.
5. `?join=CODE` has no defined lookup when server, tab and nostr rooms each use their own ids. Fix: the host mints one id for all transports. The joiner tries server, then tab, then nostr, 3 s each.
6. Most host-form fields from GDD §7.6 are not in `RunConfig`: House Edge, SI preset, seed, jackpot intro, disconnect policy, horror/Dread lock, Roaming Collector. Meanwhile `RunConfig.difficulty` and `shiftSeconds:360` contradict GDD §2.4. Fix: core mirrors §7.6 one-to-one.

**Contradictions**
7. The "PSX menus too" requirement clashes with the code. The existing `UIOverlay` is DOM (`panel(el)`, `setAnchor(el)`), but TECH §11.7 says the HUD is a canvas. Fix: add `ui.layer(id,z,draw(g,w,h))` + `ui.hit()`. For menu stations, add a `StationCanvas` (texture + raycast hit-test + text-input proxy). menu-3d owns it; menu-ui fills it.
8. The menu structure is still split. ART §7.3 has 3 cascading reels (MAIN/MODE/ACTION). GDD §9.2–9.3 has centre entries, left context and right lever, with 8 entries. Register #18 does not settle the structure. Fix: the Producer writes the facet list per reel.
9. Burst timing differs. ART §7.5 cuts at 3.45 s with 96-tri shards; GDD §9.4 cuts at 4.45 s with 64 shards. Fix: mark ART §7.5 superseded.
10. Pointer lock is requested at PRESS ANY KEY, but the menu needs hover and click on facets. Fix: the menu uses a free cursor; lock only when entering `ingame`.
11. Key bindings: GDD §7.6 has ping on B and point-emote on Shift+V. TECH §11.6 has ping on MMB/Z, B for Totem, and hold-V for the radial. Fix: change GDD to match §11.6.
12. Lobby START: GDD says ≥ 2 ready; TECH §6.4 says ≥ 1 player. Pick one.
13. The mannequin GLB is about 13.7k tris. With up to 24 animated that is about 330k, against a 70k frame budget and the 450-tri avatar in ART §8.1. Fix: Opus avatars ships a ≤ 1.2k-tri skinned LOD on the UAL skeleton. Use the full GLB only for cutscene close-ups; cap full-detail mannequins at 12.
14. ASSETS.md says `SRGBColorSpace`, but TECH §1.6 turns colour management off with linear output, so vendor textures will render darker than canvas art. Fix: use `NoColorSpace` everywhere.
15. Machine ids:
    - The code ships `src/machines/coin_flip` with id `'coin_flip'`, while §11.1 says `coinflip`.
    - TECH §9.2 still says ids are snake_case.
    - Result: two coinflip folders will both register.
    - Fix: rename in M0 and drop the §9.2 rule.
16. The existing frozen types are pre-v1.1:
    - anchors are `plate`/`staff` instead of `servicePlate`/`upgradeMounts`/`marqueeTop`;
    - private events are `mpriv` instead of `mevp`/`sendPrivate`;
    - `WinTier` has no `'mega'`;
    - `betLimits`, `payoutFactor` and `lastRefusal` are missing.
    - Fix: the M0 exit check greps `src` for every §11 name.
17. Time words don't line up. GDD uses Night/Watch/Dawn; the code uses `ShiftState.segment` and `ShiftPhase`, plus the old `RunPhase`. Fix: a mapping table in TECH §11 (Night = `QuotaState.index`, Watch = one play window, Dawn = `collection`) and remove `RunPhase`.
18. Pulls (7–10 per Watch, the core CloverPit-style limit) have no getter or event. Fix: add `run.pulls(pid)`, `run.lastRefusal()` and an event `pulls:change`; Tickets come from `balance('ticket')`.
19. Save key: GDD App. C uses `jackid.meta.v1`; TECH §11.11 puts meta inside `jackid:v1`. Use TECH.
20. RTP Definition of Done: TECH says ±1 % over 1e5 rounds; PLAN says ±0.3 pp over 1e7. The bench button cannot run 1e7 hold'em rounds. Fix: Node sims through the existing `scripts/tests/_vite.mjs` loader; `rules.ts` files must be pure (no three, kit or DOM).
21. Commit-reveal is "mandatory" on `mines`, which is solo and decided by its own player, so it means nothing there. `tombola` is listed as "solo (shared drum)", so nobody clearly owns the draw. Fix: tombola becomes a `TableBase` draw game; drop commit-reveal from solo devices.

**Unimplementable as written**
22. The seamless cut at 4.45 s can't happen if the world is only built on `enter('ingame')` (about 1.5 s plus compile plus GLB). Fix: start `World.prebuild()` after PRESS ANY KEY and hold the white frame until it's ready. Add `InGameParams.intro: 'burst'|'lift'|'continue'` plus a camera handoff.
23. The server browser's 8 columns need about 60 characters per row. A 256×192 CRT fits about 42 at 6 px each, and TR text is longer. Fix: 2-line rows or a 384×288 canvas; show ROOM at ≤ 14 characters and move HOST to a detail pane.
24. `fx.slowmo`/`hitstop` scale `app.time.sim` online. On the host this slows the shared clock, table timers and every other player's machine. Fix: online slow-mo affects only local presentation (tweens, camera, audio).
25. The Big One's root sits on top of a 0.15 m dais, but WELL-01 has y = 0. Fix: set the SlotDef y to 0.15.
26. world-sys mounts the Circuit badge, Service Plate and upgrade parts into `machine.root`. `MachineBase.dispose()` then frees them too (double free), and the Rebuild ×10 leak check fails. Fix: mount them on the slot group instead.
27. Shills, Attendants and patrons can't actually sit at machines: there is no NPC-seat API, no "step aside 0.6 s" flow, and staffed machines don't visibly play. Fix: add `npcOccupy(seat, kind)` / `npcRelease` and a cosmetic `presentHeadless(result)`.

**What breaks with about 40 parallel agents**
28. The repo has no commits. Everyone in one working tree means nobody can get a green typecheck (required by the Definition of Done), and nothing can be rolled back. Fix: make an initial commit, one worktree per lane, and have the integrator merge in PLAN §6 order. Add `check.mjs --package <id>` that checks only owned paths.
29. Several existing files and folders have no owner under PLAN §5: `menu/resultsState.ts`, `player/{avatars,flags,noise,surface,types}.ts`, `world/sys/arch.ts`, `core/audio/music/**`, `core/bootParams.ts`, `scripts/tests/**`, `kitdemo/`. Also, `player/avatars.ts` collides with the avatars package's `player/avatars/**`, and TECH places the HUD at `menu/*.ts` while PLAN uses `menu/hud/**`. Fix: generate `docs/OWNERS.json` from the real tree and make `check.mjs` fail on unowned files.
30. The network message type can't be extended without editing core's `protocol.ts`, and many needed messages don't exist:
    - Circuit state: lamps, punch card, tilt, heat.
    - Terminal votes: withdraw, favour, wing, ghost call, bless/curse, X plate, bail, ready chain.
    - Vending: tonic, jukebox, shrine.
    - Late join: `RunSnapshot` has no circuit/shift fields.
    - Fix: an extensible `interface MsgMap` (like `GameEvents`) plus a generic `{t:'intent',k,d,rid}`, and `session.registerSnapshot(ch, get, apply)`.
31. The shared machine helpers (`fair`, `wheel`, `dice`, `draw`, `steered`, `led`, bots) have no frozen signatures, yet wave-1 tables need them on day 1 of M2. Fix: core freezes `_base/shared.types.ts` in M0.
32. The ART/PLAN briefs call kit functions that don't exist:
    - Missing from `Kit`: `kitCabinetShell`, `kitCrtMonitor`, `kitCardShoe`, `kitGlassDome`, `kitTable`, `kitChair`, `kitStanchion`, `kitLedPanel`, `kitPlaque`, `kitButtonPanel`, `kitTowerLight`, `kitDecal`.
    - `dealer` lacks the oracle/caller/cashier styles PLAN M0 promises, and the `jaw`/`eyes` parts the devilstable brief needs.
    - Fix: core adds these plus a name table in TECH §4. Otherwise 6 modelers hand-roll them, since machine folders can't share code.
33. The Collector has four owners (avatars, horror, world-sys, story) and nobody owns pathfinding. Fix: an `ActorDirector` interface (spawn, walkPath, play, lookAt, sitAt) owned by horror; world-sys does A* over the nav graph.
34. World props (clock, quota board, lift, trapdoors, floor dial) have no parts contract between world-arch, which builds them, and world-sys, which animates them. Fix: each `world/props/*.ts` exports a `<Prop>Parts` type.
35. There are no shared id lists for `kit.prop` ids, cutscene hook ids, world anchor and light targets, or world/HUD sounds. Fix: core publishes these in M0 in an `ids.ts`.
36. Switching language won't redraw text the coders paint on machine screens, so 39 screens stay in English. Fix: an `onLang()` override in `MachineBase`.
37. M0 is one serial Opus pass covering renderer, kit, every texture painter and the mannequin, and everyone else waits. Fix: split into M0a (types, stubs, bench) and M0b (look fidelity), with lanes coding against the stubs.
38. Screenshot review is a Definition of Done gate, but there is no way to capture screenshots. Fix: `/?bench=<id>&shot=…` plus `window.jackid.shot()`.
39. Lanes are unbalanced. MC-8 has 7 devices; MC-6 has the hold'em bots, the Devil AI and teetotum. Fix: move keno and lottoblower to MC-4, and teetotum to MC-7.