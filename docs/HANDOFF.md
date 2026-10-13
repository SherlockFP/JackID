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

## 6. State as of this handoff
Done and pushed:
- Foundation, contracts v1.1, 3D dice menu → PLAY burst → pit
- Debt Run (Night 1 Watch 1 start, quota, pulls, HUD)
- All 39 machines + 3 party tables + 8 system devices
- Tycoon, buffs/totems, horror director, story/cutscenes wired in
- Lobby server, net layer, server browser
- RTP of every machine simulated (most within ±1 % of the catalogue)

**Completed since the first handoff:** perf pass (pixel-ratio cap, adaptive internal res, pooled uploads, mannequin LOD), stand-up fix (pause/resume restored machine mode + STAND UP button), seat HUD readability on every machine (`_base/seatHud.ts`, blackjack = gold standard), juice escalation + mega/jackpot sounds + pit-wide gold wave, intro ≤35 s skippable, Calm Mode, contracts/bounty board, grantCharm, totems/buffs persistence.

**Known issues / client feedback still open:**
- Client score ≈ 5/10 before the polish waves; re-score after a real playtest. Target 8+.
- Stacker average-player RTP ≈ 15 % (expert ≈ 101 %): needs a structural rethink (slip/jitter model rows 6–10 or consolation prizes).
- Lag was not measured on real hardware (automation browser only advances frames during screenshots). CPU frame time measured ~1–2 ms in bench, so check GPU/fill and the real game with F3 on the client PC.
- Settings die: CALM replaced the BACK face (Esc/Backspace still close settings).
- The game lags. Jackpot sounds are bad. The camera/hands shook too much while walking: bob constants in
  `player/local.ts` and `player/viewmodel.ts` were reduced by the director, so verify it feels good.
- The client wants EVERYTHING 3D. Still-2D panels to convert to diegetic 3D next:
  - server browser, host panel, lobby (`src/menu/*`)
  - pause/intermission panels and upgrade ledger (`src/game/ingame/panels.ts`)
  - note reader (`src/game/story/notes.ts`)
  - fortuneteller and tavla rule panels
  - The HUD may stay 2D.
- Real two-machine WebRTC multiplayer has not been tested yet.
- Some RTP edge cases have open director calls in lane reports: claw expert ~126–130 % (accepted with max bet 25), lootbox pity,
  fruitmachine headless 83 % vs live 88 %.
- `check.mjs` shows hundreds of warnings (hard-coded identifier strings, missing `playHeadless` in a few machines).

## 7. Suggested next steps (in order)
1. Merge and verify the in-flight waves: green build, then play the real game in the browser (menu → pit → sit/stand at 5 machines).
2. Play feel: stand-up reliability, readable seat HUD, juice and sounds (especially the jackpot), no shaking hands.
3. Performance: 60 fps in the pit on a mid laptop. Measure with F3.
4. Convert the remaining 2D panels to 3D diegetic UI.
5. Multiplayer: 2 tabs, then 2 machines (WebRTC), then a Render deploy with a friend joining via `?join=CODE`.
6. Content tiers from DECISIONS B: Okey, Liar's Dice, rules-only variants, Boss Nights, porcelain Collateral, proximity voice.
