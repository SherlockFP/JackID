# JackID — Handoff (read this first if you are a new AI / developer taking over)

Last updated: 2026-10-13, Waves 7–15 on branch `wave7-controls-circuit` (HEAD 73bf5a4). Repo: https://github.com/SherlockFP/JackID (`main` is the base branch).

## 1. What this is
**JackID** is a first-person, PSX-style (1997 look) light-horror casino roguelike + tycoon, built with
TypeScript + Vite 8 + three.js 0.186. It is inspired by CloverPit, Buckshot Roulette and Gamble With Your Friends, but is
original IP. You play solo or with 2–8 friends over P2P listen servers (WebRTC; signaling, server browser and
relay come from a small Node server). The client is Turkish. Reply to them in **Turkish**, keep the UI bilingual (EN + TR).

## 2. Run it
```bash
npm install
npm run dev          # http://localhost:5180  (strict port)
npm run server       # lobby/signaling/relay on :8787 (also serves dist/)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build
npm run check        # scripts/check.mjs: i18n parity, forbidden imports, Math.random, ownership
npm test             # node scripts/tests/index.js (235 passing)
node scripts/sim/run.mjs   # economy sim. node scripts/sim-profiles.mjs [--plays N] rewrites machine odds (Tell Sheet)
```
Useful URLs:
- `/?bench=<machineId>&debug=1&nolock=1` opens one machine in a test room. `nolock` = drag-to-look, with no pointer lock.
- `&lang=tr` switches to Turkish. `/?debug=1` shows F3 stats and `window.jackid` (devtools API: `jackid.shot()`, `jackid.bench`, `jackid.app`).
- Deploy (Render, one service): build `npm ci && npm run build`, start `npm start`, env `NODE_VERSION=22`. See `docs/DEPLOY.md`.

## 3. Documents (precedence order, highest first)
1. `docs/BRIEF.md`: every client requirement, as Addenda 1–8. Includes tycoon, quotas, horror, story, buffs, assets/music,
   content pool, the party games (Son Kart/Okey/Pişti/Tavla), the Devil's Table (Buckshot-style), GWYF ideas and JUICE IS KING.
2. `docs/DECISIONS.md`: binding director decisions (A–G). Read it before changing anything structural.
3. `docs/TECH_SPEC.md` §11: binding code-shape amendments. §1–10 cover the original architecture, machine contract, net and kit.
4. `docs/GDD.md`: rules, economy, Nights/Watches/Dawn, charms, level layout §8, menu §9.
5. `docs/machines/MACHINES_machines.md` and `MACHINES_tables.md`: per-machine rules, odds, paytables, juice.
6. `docs/ART_BIBLE.md`: PSX pipeline numbers, palette, kit conventions, per-machine visuals.
7. `docs/PLAN.md` + `docs/plan.json`: milestones and per-machine `modelBrief` / `logicBrief`.
8. `docs/ASSETS.md`: CC0 vendor assets (SBS textures, Kenney casino SFX, Quaternius mannequin GLB with 43 clips).
9. `docs/OWNERS.json`: file ownership map. `docs/CRITIQUE.md`: old design critique (mostly resolved in DECISIONS).

## 4. Code map
- `src/core/`: engine services. The rule is that core imports only three and core.
  - app, loop (fixed 60 Hz + render), events, rng (seeded — Math.random is forbidden), tween, timers, settings, save, i18n
  - `renderer/`: PSX: low-res target, vertex snap, affine, dither, fog
  - `fx/`: particles, pop text, shake, flash, slow-mo
  - `audio/`: SFX synth + Kenney samples, procedural adaptive music in `audio/music/**`, House voice
  - `input`, `ui/`: DOM overlay
  - `cutscene/`: data-driven timeline player
  - `texgen/`: canvas pixel textures, cards, symbols, vendor texture loader
- `src/kit/`: procedural modeling kit for cabinets, tables, chips, cards, dice, dealer, and `kit.mannequin()` (the animated GLB actor).
- `src/machines/<id>/`: one folder per machine. Each holds `model.ts` (kit model + Parts), `rules.ts` (pure, simulatable)
  and `index.ts` (def + class extending `MachineBase` or `TableBase`). Machines are auto-registered with `import.meta.glob`.
  `_base/` holds MachineBase/TableBase (event-replay networking, settle-before-present), juice.ts (win tiers),
  cards/reels/peg2d helpers, and seatHud.ts (the readability overlay, being added now).
  The reference machines are `coinflip`, `bigone` and `blackjack`.
  - 39 gambling machines: bigone, bandit, videopoker, elevator, scratch, pachislot, pachinko, plinko, coinpusher, cyclone,
    mines, dicetower, lootbox, claw, stacker, fruitmachine, bingopin, roulette, blackjack, holdem, devilstable, baccarat,
    craps, sicbo, bigsix, cardwar, hilo, keno, derby, fortuneteller, coinflip, threecard, reddog, bingo, lottoblower,
    tombola, shellgame, fantan, teetotum.
  - 3 party tables: sonkart, tavla, pisti.
  - System devices: debt_terminal, hotline, charm_vendor, tonic_vendor, jukebox, cashier, bounty_board, shrine.
- Wave 7–15 systems: `src/game/circuit.ts` (Circuit Tilt/Lamps, Obols), `shop.ts` (Pawn), `charms/engines.ts` (engine charms),
  `bosses.ts` (boss Nights), `pace.ts` (Tell Sheet), `data/kits.ts`, `suits.ts`, `hotline.ts`, `rescue.ts`, `float.ts`, `tutorial.ts`,
  `clockHold.ts`, `core/keymap.ts` and `core/ui/settingsScreen.ts` (rebind screen).
- `src/world/`: level.ts/layout.ts (GDD §8 slots, zones, nav graph), props (clock, trapdoor, lift, quota board),
  world.ts (placement, lights), collision, interact, actors/ (ActorDirector + A*).
- `src/player/`: FPS controller, camera glide into machine play poses, viewmodel hands, remote avatars.
- `src/game/`:
  - run.ts (RunApi: Nights/Watches/Dawn, quota, pulls, wallet, mod() pipeline), economy, clock, data/ (charms, schedule, upgrades)
  - tycoon/, buffs/ + items/ (totems), horror/ (Dread director), story/ (notes, cutscenes)
  - ingame/ (session wiring, panels, mp.ts), inGameState.ts, benchRun.ts
- `src/menu/`: 3D dice main menu (menuState, menuDie, menuCabinet, menuBurst), server browser/host/lobby, HUD (hud.ts), results.
- `src/net/`: transports (BroadcastChannel tab, WebRTC, WS relay, Trystero nostr fallback), session, replication, lobbyClient.
- `server/`: Node lobby (rooms, signaling, relay, static dist). Run `node server/smoke.mjs` for 25 smoke checks.

## 5. How work has been done (process the client asked for)
- **Opus (main session) = director.** It decides, reads reports and verifies. It does not spawn Opus subagents.
- **Haiku first.** Haiku lanes do nearly all implementation, testing and docs (cost). Work is dispatched as Workflow
  scripts with parallel lanes and **exclusive file ownership** per lane (`docs/OWNERS.json`).
- **Sonnet** only for integration and review (merging lanes, cross-file bugs, critical reviews).
- **Token-thrifty:** short briefs, no whole-file re-reads, one integrator lane runs `npm run typecheck && npm test`
  (plus `npm run check` and `build` when shared code changes).
- **Agents never run git write commands.** Only the director commits and pushes, and only when the client asks.
- **Agents never kill processes they didn't start.** One tester once killed every vite/node server on the PC, including
  the client's other projects. Use your own port and stop only your own PID. Port 5173 belongs to another app here;
  the dev default is 5180 (strict).
- Browser-pane testing:
  - **Mute first:** `jackid.app.audio.ctx.suspend(); jackid.app.audio.resume=()=>{}` (`?debug=1` exposes `window.jackid`).
  - If the pane is hidden, install a rAF shim before the game loop starts (`requestAnimationFrame` → `setTimeout(fn,16)`),
    via an init script or a reload after setting it. Otherwise frames stall.
  - Automation key taps are too short to move the player. Hold keys with
    `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))` and then `keyup`.
  - Without the shim, frames advance only while screenshots are taken.

## 6. State (branch `wave7-controls-circuit`, HEAD `73bf5a4` = Wave 15)
Waves 1–6 are the base history. Waves 7–15 are committed on `wave7-controls-circuit`. Whether that branch has been
pushed or merged to `main` is not recorded here, so check git before assuming.

Verified for this handoff: `npm run typecheck` 0 errors; `npm test` 235 passing, 0 failing. `check.mjs` and `build`
were not re-run for this doc pass.

Wave log:
- **W7 controls + Circuit:** controls overhaul; settings and rebind screen (`src/core/ui/settingsScreen.ts`,
  `src/core/keymap.ts`); Circuit (`src/game/circuit.ts`): Tilt, Hot/Cold lamps, Obols; charm hook cleanup; readability.
- **W8 engines, shop, odds:** suit table (`src/game/suits.ts`); Pawn shop (`src/game/shop.ts`); 10 engine charms
  (`src/game/charms/engines.ts`, `engine.ts`); boss Nights (`src/game/bosses.ts`, `data/bosses.ts`); Tell Sheet odds and
  pace (`src/game/pace.ts`, generated `src/game/data/machineProfiles.ts`); starting kits (`data/kits.ts`); Pit Deck.
  Plan: `docs/WAVE8_PLAN.md`.
- **W9 hotline and economy:** Hotline phone bargains (`src/game/hotline.ts`); economy sim (`scripts/sim/run.mjs`);
  quota and interest rebalance; charm proc juice and badges; run post-mortem; Night 1 tutorial (`src/game/tutorial.ts`);
  Free Casino hang fixed.
- **W10:** launch Rares and gated choice offers; Night 1 fairness; hotline ring time; tutorial skip; unregistered props
  replaced; lower-poly party/table models.
- **W11:** free-roam intermission and OPEN THE FLOOR lever; debt keypad fixes; toast queue and dedupe; first-sit-only
  rules; lamp glow; economy rescale.
- **W12:** lamp halo and beam; family charm glyphs; rules chip; pop tiers; Turkish terminology pass; note/terminal focus fix.
- **W13:** Big One pattern tally and near-miss; charm-aware sim and rising quota ladder; Night 1 stake cap and high-stake
  confirm (`src/game/stake.strings.ts`); rescue loan (`src/game/rescue.ts`); clock hold for tutorial and dialogue
  (`src/game/clockHold.ts`); shop restock; HUD top band and stake readout; debt terminal and cashier list.
- **W14:** tiered win juice on all machines (`src/machines/_base/juice.ts`, `tiers.ts`); Big One about 29 % hit rate;
  Dawn surplus back to pocket; float-aware sim (`src/game/float.ts`); rotation tutorial; net-win callout; real bet limits;
  terminal, results and phone layout; phone direction hint.
- **W15:** empty-pocket rescue toast and deposit float; terminal keypad and entry fixes; one-press sit; note dismiss and
  HUD collision fixes; Pawn prices, clamped nav and two-press buy; net-win callouts on all machines.

**Latest playtest: 6.5/10. Target 8+.** The top issues from that playtest were not in this pass's brief, so the list
below carries the open items from the Wave 6 handoff. The director should add the playtest's own top issues.
1. The 3D UI (CRT server browser, lobby scene, JackID card pause, ledger, notes) is not browser-verified end to end.
2. Performance on real hardware is unmeasured. Need F3 numbers (fps/ms, calls, tris) from the pit.
3. Real two-machine WebRTC multiplayer is untested. Node tests over the real lobby pass.
4. Win and jackpot sounds were reworked but not listened to. Calibrate TRIM levels with `renderSfx`.
5. Balance still open: claw expert ~110–130 % (accepted, max bet 25); lootbox pity (BRASS ~107 %); fruitmachine headless
   83 % vs live 88 %; re-sim stacker and Big One after the W13–W14 changes.
6. Settings: CALM replaced the BACK face (Esc/Backspace still close it).
7. `check.mjs` warnings: hard-coded identifier strings; missing `playHeadless` in elevator, pisti, roulette, tavla.
8. No gamepad support yet (no gamepad code under `src/`).

## 7. Suggested next steps (in order)
1. Playtest fixes toward 8+: take the top issues from the 6.5/10 notes and fix them in Haiku lanes.
2. Full browser playthrough: menu → CRT server browser → PLAY → pit → sit/play/stand at 5 machines → Esc card → U ledger →
   J journal → Tell Sheet, Pawn shop, Circuit, hotline, rescue loan. Fix all breakage.
3. Gamepad support (none yet): menu, pit movement, machine play, settings rebind.
4. Performance to a steady 60 fps on a mid laptop. Check the mannequin LOD and pit with the client's F3 numbers.
5. Multiplayer: 2 tabs, then 2 PCs, then a Render deploy (Web Service: build `npm ci && npm run build`, start
   `npm start`, env `NODE_VERSION=22`). A friend joins via `?join=CODE`.
6. Sound pass (jackpot, wins, ambience), then machine model visuals (several are blocky).
7. Content from DECISIONS B tiers: Okey, Liar's Dice, rules-only variants, more Boss Nights, porcelain Collateral,
   proximity voice.
8. Merge `wave7-controls-circuit` into `main` when the director decides, and push only when the client asks.
