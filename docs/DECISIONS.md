# JackID — Director's Decisions (BINDING, highest precedence after BRIEF.md)

Author: the Opus game director (main session). Precedence: `BRIEF.md` > **this file** > TECH_SPEC §11 >
GDD > catalogues > ART_BIBLE > TECH_SPEC §1–10. Items reference `docs/PLAN.md` open questions (Q#) and
`docs/CRITIQUE.md` findings (C#).

## A. Team & process
- **No separate Opus subagents.** Haiku implements, Sonnet reviews/verifies and reports to the director,
  the director (main session) decides. Reviews are structured (verdict, issues, directorQuestions).
- Exclusive file ownership per package; agents typecheck only their own paths (`check.mjs --package` when available).
- Git: initial commit after the foundation lands; commit after every wave so we can roll back (C28).
  No per-lane worktrees unless conflicts appear.

## B. Scope & tiers
- Q2: coinflip **"Call It" duel = T1** (cheap, great with friends). Spectator side-bets T2.
- Q3 + C1: the **Parlor** wing (Lift destination "P", south of the Lobby) is confirmed. **SON KART, TAVLA and
  PİŞTİ are T1** (shared `TableBase` devices on PAR-03..05). OKEY and Liar's Dice are T2. `threecard` and `reddog` drop to T2.
- C2: "every gambling machine" is covered with **rules-only `def.variants`**, all T2: blackjack→Spanish 21,
  threecard→Caribbean Stud, sicbo→Crown & Anchor, coinflip→Two-Up, scratch→pull-tab, holdem→Casino Hold'em.
  Pai Gow and Faro are T3.
- Q4: proximity voice T2. Q5: porcelain Collateral is T2. It uses prosthetic visuals only (no gore) and Calm Mode removes it.
- Q6: Boss Nights T2, layered on the GDD Night structure. Q7: GDD kits in v1.0, named characters T2.
- Q9: PLAN Appendix A model briefs approved for the 7 machines without ART sections.
- Q10: SHELLS pays a fixed 1.9×. Only the Devil AI is tuned.
- Q1: v1.0 has no host migration. The room closes and the host can RESUME ROOM from its snapshot.

## C. Networking & friends
- Q11: casual trust stays. Solo devices resolve on the occupant. The **bigone jackpot pool is host-held**: the host
  validates claims (rate and size sanity) before paying.
- Q8: room codes use the TECH alphabet (no I/O/0/1).
- C3: when the lobby server is unreachable, **automatically enable the Trystero GLOBAL** transport. `docs/DEPLOY.md` is part of the
  lobby-server Definition of Done (one-box Fly/Render, `VITE_LOBBY_URL`, TURN via `ICE_SERVERS`).
- C4: `RoomPublic` gains `status` (≤ 8 chars) and `unlisted: boolean`. Unlisted rooms are hidden from `list`
  but can still be joined by id. C5: the host mints ONE id for all transports. A joiner tries server → tab → nostr, 3 s each.
- C6: `RunConfig` mirrors GDD §7.6 one-to-one. The GDD wins over `difficulty`/`shiftSeconds` defaults.
- C12: the host may START alone. Every present player must be ready, or the host force-starts.
- C24: slow-mo and hit-stop are **local presentation only** when online (tweens, camera, audio). They never touch the sim clock.
- C30: protocol becomes extensible: `interface MsgMap` (declaration merging, like `GameEvents`) + generic
  `{t:'intent', k, d, rid}` + `session.registerSnapshot(channel, get, apply)` for late join.

## D. UI, menu, look
- C7: **2D UI (HUD, panels, server browser, settings, pause) = DOM overlay**, styled pixel-perfect PSX
  (integer scale, bitmap fonts, dithered panel art). The TECH §11.7 "canvas HUD" is superseded.
  In-world screens (machines, terminals, menu reel facets) use canvas textures (`StationCanvas` helper: texture +
  raycast hit-test). C23 is therefore solved by DOM layout: 2-line rows are allowed.
- C8: menu **structure = GDD §9.2–9.3** (centre entries, left context, right lever). **ART §7 owns the look**.
  C9: the burst cut lands at 4.45 s (GDD) and ART §7.5 timing is superseded. C10: the menu uses a free cursor and
  pointer lock is taken only when entering `ingame`.
- C22: `World.prebuild()` starts after PRESS ANY KEY. The white frame holds until it is ready.
  `InGameParams.intro: 'burst' | 'lift' | 'continue'` with a camera handoff.
- C11: keymap = TECH §11.6 (GDD updated to match).
- C14: **`NoColorSpace` for all textures**, vendor ones included (colour management is off, so hex shows exactly as written).
- C13 + Q12: the mannequin GLB loads behind PRESS ANY KEY. At most **12 fully animated** mannequins are visible. Distant ones are
  frozen or culled. A low-poly LOD (≤ 1.5k tris, same skeleton) is a T2 art task.
- C36: `MachineBase.onLang()` hook repaints diegetic screens when the language changes.
- C38: `/?bench=<id>&shot=1` and `window.jackid.shot()` return a PNG data URL for screenshot review.

## E. Code contracts to add in "Contracts v1.1" (right after the foundation)
- C15/C16: align frozen types with TECH §11 names. Folder `coinflip`; snake_case ids rule removed; anchors
  `servicePlate`/`upgradeMounts`/`marqueeTop`; private event channel `mevp`/`sendPrivate`; `WinTier` adds `'mega'`;
  `betLimits`, `payoutFactor`, `lastRefusal`.
- C17: time words: **Night = `QuotaState.index`, Watch = one play window, Dawn = collection.** Remove `RunPhase`.
- C18: `run.pulls(pid)`, `run.lastRefusal()`, event `pulls:change`. Tickets come from `balance('ticket')`.
- C19: save lives under `jackid:v1` (TECH). C20: RTP sims run in Node via `scripts/tests/_vite.mjs`. Each machine's
  `rules.ts` must be pure (no three, kit or DOM). The DoD is ±1 % over 1e5 rounds (1e6 for slots).
- C21: tombola becomes a `TableBase` draw game. There is no commit-reveal on solo devices.
- C25: `SlotDef.y` is supported (WELL-01 dais y = 0.15). C26: world-sys mounts badges and plates on the **slot group**,
  never in `machine.root`.
- C27: `npcOccupy(seat, kind)` / `npcRelease()` + cosmetic `presentHeadless(result)` for staff, shills and patrons.
- C31: freeze `_base/shared.types.ts` (fair, wheel, dice, draw, steered, led, bots).
- C32: add the missing kit functions (cabinetShell, crtMonitor, cardShoe, glassDome, table, chair, stanchion, ledPanel,
  plaque, buttonPanel, towerLight, decal; dealer styles oracle/caller/cashier with jaw/eyes parts) to `kit/types.ts`.
- C33: `ActorDirector` interface (spawn, walkPath, play, lookAt, sitAt), owned by horror. world-sys provides A* over a nav graph.
- C34: each `world/props/*.ts` exports a `<Prop>Parts` type. C35: `src/core/ids.ts` lists prop ids, cutscene hook ids,
  world anchors, light targets and world/HUD sound ids.
- C29: generate `docs/OWNERS.json` from the real tree. `check.mjs` fails on unowned files.

## F. Juice (client's #1 concern)
Every machine and system ships the ART/BRIEF juice checklist. Sonnet reviewers reject packages whose
interactions lack anticipation → action → impact → follow-through, or whose win tiers don't escalate.

## G. Foundation review answers (binding)
- Fog: states build `THREE.Fog` from drawDistance (18/26/40 m); shader fog scale = 1. Pop text stays always-on-top.
- Cutscenes: positional sfx/light cues deferred to integration; input gate = Input exposes `anyPressed()`; skip is disabled while a choice is open.
- Machines: **settle (credit wallet) BEFORE presentation** is a MachineBase rule; snapshots carry explicit `owner` pid; `WinTier` adds `'mega'` with its own fx/jingle tier; `MachineAction` gains all §11.6 actions (no casts); **SLOT_DIMS = GDD §8.5**; coinflip reference brought to 700 tris / 10 draws now; bench/debug panel loaded via DEV-only dynamic import.
- Keys: machine `double` = **R** (D stays move); skip/jump share Space and are excluded from conflict checks; banner-skip press is consumed; at `pick` poses RMB goes to onPointer, free-look = hold Alt.
- Pointer lock: if lock is refused, fall back automatically to drag-to-look (also `?nolock=1`) so QA and odd browsers can play.
- Kit: `KitExtras` moves into `kit/types.ts`; dealer styles oracle/caller/cashier; cards `atlas: 'sonkart'|'okey'`; actor gets own/setFrozen/addProc/onPose. Stools stay 0.68 m and `SeatDef` gains `standY`. Mannequins auto-freeze when far or invisible (one-shot clips complete instantly on freeze). `FeltTableOpts.w/d` include seats; dealer takes `feltY` from the table. texgen felt is softened and becomes the single felt source.
- Music/audio: Last Call = `setIntensity(1)` and the composer also pitches jukebox +3 %. Milestone stingers are exempt from the cue cap and from music-bus ducking. Machines use `winJingle`/SFX, never `music.stinger`. Jukebox positional later (T2). Ducking stays default, with `SpeakOpts.duck=false` opt-out; `register()` takes optional meta {pri,bus,max,long}; a small unlock queue replays first UI sounds. `music/index.ts` exports `createMusic` and is wired by the audio engine.
- Texgen: extras promoted into the TexGen interface; roulette order/reds move to pure `core/texgen/rouletteData.ts`. Machine-specific felts/boards are built by machine owners with texgen helpers.
- UI: DOM overlay accepted (amends TECH §11.7).
