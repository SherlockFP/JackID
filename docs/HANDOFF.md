# JackID — Handoff (read this first if you are a new AI / developer taking over)

Last updated: 2026-10-13 by the Opus director session. Repo: https://github.com/SherlockFP/JackID (branch `main`).

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
npm test             # node scripts/tests/index.js (63 unit tests)
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
- **Opus (main session) = director only.** It decides, reads reports and verifies. It does not spawn separate Opus subagents.
- **Haiku agents do almost all implementation** (cost). Sonnet is used only when truly needed (reviews/critical work).
  Testing is done by Haiku.
- Work is dispatched as Workflow scripts with parallel lanes and **exclusive file ownership** per lane, then an
  integrator/tester lane (typecheck, build, check, test, browser smoke).
- **Agents never run git write commands.** Only the director commits and pushes, and only pushes when the client asks.
- **Agents never kill processes they didn't start.** One tester once killed all vite/node servers on the machine, including the client's other
  projects. Use a free port and stop only your own PID.
- Browser-pane testing quirks:
  - automation key presses are too short to move the player, so hold keys via `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))` … `keyup`
  - frames advance only while taking screenshots
  - port 5173 belongs to another app on this PC

## 6. State as of this handoff (last commit on `main`, pushed)
Everything below is committed and pushed. Typecheck 0 errors, check 0 errors (~820 harmless warnings), 63/63 tests, and the production build all pass.

Done:
- Core loop:
  - foundation, contracts v1.1, the 3D dice main menu, PLAY → burst → pit
  - Debt Run (Night 1 Watch 1 start, quota, pulls, HUD)
- Content:
  - 39 gambling machines, 3 party tables (Son Kart, Tavla, Pişti) and 8 system devices. RTP simulated for each.
  - Tycoon, buffs/totems, night events, horror director + ActorDirector, story notes + cutscenes, contracts/bounty board, grantCharm.
- Multiplayer: lobby server (`server/`, 25 smoke checks), net layer (tab / WebRTC / relay / Trystero), 3D CRT server browser + 3D lobby scene.
- Polish:
  - stand-up fix and seat HUD readability on every machine (`_base/seatHud.ts`, blackjack is the gold standard)
  - juice escalation (big/huge/mega/jackpot, pit-wide gold wave, jackpot bells)
  - intro ≤ 35 s and skippable, Calm Mode, reduced head-bob/hand sway
- 3D UI: pause is the JackID card in your hands, U opens a 3D ledger book, notes/journal/rule placards are 3D.
- Perf: pixel-ratio cap, adaptive internal res, pooled uploads, mannequin LOD, GPU pass, "Performance" settings preset.
- Stacker redesigned with consolation cash-outs at rows 4/7/10.

**Open issues (priority order):**
1. The newest 3D UI (CRT server browser, lobby scene, JackID card pause, ledger, notes) is **NOT browser-verified yet**: the tester was stopped. Play through it first and fix what breaks.
2. Performance on real hardware is unmeasured. The automation browser only advances frames during screenshots. Ask the client for F3 numbers (fps/ms, calls, tris) from the pit.
3. Real two-machine WebRTC multiplayer is untested. Node tests over the real lobby pass, and the two-tab browser run never completed.
4. Jackpot/win sounds were reworked but nobody has listened to them. Calibrate TRIM levels with `renderSfx`.
5. Balance calls are still open:
   - claw expert ~110–130 % (accepted, max bet 25)
   - lootbox pity (BRASS ~107 %)
   - fruitmachine headless 83 % vs live 88 %
   - verify the new stacker numbers with sims
6. Settings die: CALM replaced the BACK face (Esc/Backspace still close it).
7. `check.mjs` warnings: hard-coded identifier strings; missing `playHeadless` in elevator, pisti, roulette, tavla.
8. The client's last score was about 6.5/10. The target is 8+.

## 7. Suggested next steps (in order)
1. Full browser playthrough (menu → MULTIPLAYER CRT → back → PLAY → pit → sit/play/stand at 5 machines → Esc card → U ledger → J journal). Fix all breakage.
2. Performance to a steady 60 fps on a mid laptop. Use the client's F3 numbers.
3. Multiplayer: 2 tabs, then 2 PCs, then a Render deploy (Web Service: build `npm ci && npm run build`, start `npm start`, env NODE_VERSION=22). A friend joins via `?join=CODE`.
4. Sound pass (jackpot, wins, ambience), then a visual pass on machine models (several are blocky).
5. Content from DECISIONS B tiers: Okey, Liar's Dice, rules-only variants, Boss Nights, porcelain Collateral, proximity voice.
