# JackID: Handoff (read this first if you are a new AI / developer taking over)

Last updated: 2026-10-15. Waves 7–58 on branch `wave7-controls-circuit` (HEAD `5c168a9` = Wave 58). Repo: https://github.com/SherlockFP/JackID (`main` is the base branch).

## 1. What this is
**JackID** is a first-person, PSX-style (1997 look) light-horror casino roguelike + tycoon, built with TypeScript + Vite 8 + three.js 0.186. Inspired by CloverPit, Buckshot Roulette and Gamble With Your Friends, but original IP. Solo or 2–8 players over P2P listen servers (WebRTC; signaling, server browser and relay from a small Node server). The client is Turkish: reply to them in **Turkish**, keep the UI bilingual (EN + TR).

## 2. Run it
```bash
npm install
npm run dev          # http://localhost:5180 (strict port; 5173 belongs to another app on this PC)
npm run server       # lobby/signaling/relay on :8787 (also serves dist/)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build
npm run check        # scripts/check.mjs: i18n parity, forbidden imports, Math.random, ownership
npm test             # node scripts/tests/index.js (674 passing at Wave 58)
npm run qa -- --machine <id> ...        # headless machine bench, see section 8
node scripts/qa/bench.mjs --run "..."   # debt-run driver (use node directly for long step lists)
node scripts/sim/run.mjs [flags]        # economy sim, see section 8
```
Useful URLs: `/?bench=<machineId>&debug=1&nolock=1` (one machine in a test room), `&lang=tr`, `/?debug=1` (F3 stats, `window.jackid`:
`jackid.shot()`, `jackid.bench`, `jackid.app`). Deploy (Render, one service): `npm ci && npm run build`, start `npm start`, `NODE_VERSION=22`. See `docs/DEPLOY.md`.

## 3. Documents (precedence, highest first)
1. `docs/BRIEF.md` (client requirements, Addenda 1–8). 2. `docs/DECISIONS.md` (binding director decisions; read before structural changes).
3. `docs/TECH_SPEC.md` §11. 4. `docs/GDD.md` (rules, economy, Nights/Watches/Dawn). 5. `docs/machines/*` (per-machine odds and juice).
6. `docs/ART_BIBLE.md`. 7. `docs/PLAN.md` + `docs/plan.json`. 8. `docs/ASSETS.md` (CC0 assets). 9. `docs/OWNERS.json` (file ownership).
Wave plans: `docs/WAVE8_PLAN.md`, `docs/WAVE24_PLAN.md`, `docs/WAVE25_TALLY.md` (TALLY duels and Mahjong Little Wall).

## 4. Code map
- `src/core/`: engine (app, loop 60 Hz, events, seeded rng: **Math.random is forbidden**, tween, save, i18n, settings, keymap,
  `ui/settingsScreen.ts` rebind screen), `renderer/` (PSX), `fx/`, `audio/` (SFX + procedural music + House voice), `cutscene/`, `texgen/`.
- `src/kit/`: procedural modeling kit (cabinets, tables, cards, dice, dealer, `kit.mannequin()`).
- `src/machines/<id>/`: `model.ts`, `rules.ts` (pure, simulatable), `index.ts`. `_base/` holds MachineBase/TableBase, `juice.ts` and tiers.
  Reference machines: `coinflip`, `bigone`, `blackjack`. 39 gambling machines, 3 party tables (sonkart, tavla, pisti), system devices
  (debt_terminal, hotline, charm_vendor (Pawn), tonic_vendor, jukebox, cashier, bounty_board, shrine).
- `src/game/` (run loop and economy):
  - `run.ts`: RunApi, the Night / Watch / Dawn state machine, pulls, wallet, Bell, closing, settle, quota, mod() pipeline.
  - `bank.ts`, `economy.ts`, `float.ts` (House float), `pace.ts` (Dawn projection, Tell Sheet), `checkpoints.ts` (Watch tithe), `houseMood.ts`.
  - `data/schedule.ts`: Night definitions, quota ladder, interest, House notice. `data/charms.ts`, `charmsEngines.ts`, `kits.ts`, `bosses.ts`, `machineProfiles.ts` (generated odds), `rooms.ts`.
  - `nightCards.ts` (Night Cards), `spotlight.ts` (Machine of the Night), `watchEvents.ts` (floor events), `draft.ts` (starter draft),
    `circuit.ts` (Tilt, Hot/Cold Lamps, Obols), `stakes.ts`, `daily.ts`, `shop.ts` (Pawn), `stamps.ts` (Symbol Stamps),
    `charms/` (behaviours, engine, engines, sets), `suits.ts`, `hotline.ts`, `rescue.ts`, `tutorial.ts`, `clockHold.ts`, `rooms.ts`,
    `duels/` (TALLY duel engine + Sealed Wall, Ghost Shell, Steam Count, Locker Shuffle, Last Count, The Question), `bosses.ts`, `horror/`, `story/`, `ingame/`.
  - `*.strings.ts` hold the EN/TR text (i18n parity is checked by `npm run check`).
- `src/world/`: level/layout (GDD §8), props, rooms (Jade Room, Wash lockers, Boiler, Counting, Keyring), `hollow/` (Hollow Door, Underneath),
  `bench.ts` and `benchPanel.ts` (QA hooks), actors (ActorDirector + A*).
- `src/player/`, `src/menu/` (3D dice menu, server browser, HUD), `src/net/` (WebRTC, WS relay, Trystero fallback), `server/` (lobby; `node server/smoke.mjs`).

## 5. How work has been done (process the client asked for)
- **Opus (main session) = director.** It decides, reads reports and verifies. It does not spawn Opus subagents.
- **Haiku does implementation, testing and docs** (cost). Work goes out as Workflow lanes with **exclusive file ownership** (`docs/OWNERS.json`).
  Sonnet is only for integration and critical review.
- **Harness-verified.** A change is done when the QA harness or sim shows it, not when it compiles: the bench (`npm run qa`), the debt-run
  driver (`--run`), the `auto:night` bot, the sim, `npm test`, `npm run typecheck`.
- **Mute audio first** in browser-pane tests: `jackid.app.audio.ctx.suspend(); jackid.app.audio.resume=()=>{}`. Without the rAF shim
  (`requestAnimationFrame` → `setTimeout(fn,16)`) a hidden pane stalls frames. Hold keys with `dispatchEvent(new KeyboardEvent('keydown',{code}))` and `keyup`.
- **Edit source only with Edit/Write.** Never PowerShell `Set-Content` / `Out-File` for source: Wave 47 had to repair mojibake and BOMs that such edits introduced.
- **Agents never run git write commands.** Only the director commits and pushes, and only when the client asks.
- **Agents never kill processes they did not start.** One tester once killed every vite/node server on the PC. Use your own port, stop only your own PID.
- **Token-thrifty:** short briefs, no whole-file re-reads, one integrator lane runs typecheck and tests (plus `check` and `build` when shared code changes).

## 6. The core loop (current, Waves 16–58)
- **Night** = 3 Watches (Nights 1–4) or 4 Watches (Nights 5–8). Printed Night 1 is the teaching Night (Starter Draft before the first pull, min bet 1 on coinflip/hilo/scratch).
- **Watch phases:** Bell (start) → Play (pulls, real-time clock) → Last Call (20 s; 30 s in the last Watch; Clutch set +6 s) →
  Closing (3 s, `CLOSING_SEC`) → Settle (interest note, tithe check, pulls' rebate) → **Mola** (the Intermission; the UI label is "Mola"):
  Pawn Window open, Debt Terminal deposits and withdrawals, NEXT NIGHT line. Then the next Watch, or Dawn after the last Watch.
- **Bell** (Debt Terminal) ends a Watch at any time, in play or Last Call; unused pulls keep the rebate. A Watch whose pulls run out closes by itself.
- **Bank:** deposits earn interest each Night (rate falls per Night, section 7). Deposits and withdrawals stay open through Closing and Settle.
  Withdrawal is allowed from Mola to the end of Settle. Surplus above the quota stays in the bank until Dawn ("NIGHT n PAID"). `bank().left` reads 0 once paid.
- **Quota:** the Night's ladder value, modified by Discount, Assessment, charms, and the House notice (Night 6+). Met = the lever offers OPEN THE FLOOR
  (Night paid). The lever order is OPEN THE FLOOR, else the Bell in Mola, else SETTLE when the quota is met.
- **Watch tithe (W58):** from Night 3 each quota Watch must earn 12 % of the Night quota in play (net wins less stakes, never deposits,
  withdrawals or interest). Met: +1 Ticket. Missed: the shortfall is added to tonight's quota. The overtime Watch has none.
- **House Mood (W46/W57):** a Night-scaled payout multiplier, shown in the HUD and the Mola preview. Shown as "PAYOUT" with a breakdown chip (W47).
- **House notice (W47, moved to Night 6 in W58):** the quota is at least 1.2 x the coins held at Dawn. The ladder stays the floor.
- **Night Cards (W53–W55):** a paid Dawn opens a two-card offer of risk/reward Night modifiers. Each card previews the exact next-Night quota,
  Watches and payout. Ten ids: bankers_night, charm_fair, double_down, grace, high_table, lamp_festival, lean_night, payday_night, quiet_night, rush_night.
- **Machine of the Night / Spotlight (W55):** one machine kind x1.25 this Night; a Ticket every 5 plays. Gold beam and tag (W56).
- **Floor events (W43+):** 11 ids, one per Watch at most (75 % chance), announced by banner and HUD timer: cashier_bonus, cold_snap, dealers_break,
  draft, happy_minute, high_roller, jackpot_whisper, loose_slots, lucky_lamp, tilt_holiday, tilt_switch.
- **Circuit (W7+):** Tilt rotates value off a machine you overplay. Hot Lamp (x1.5, zone and distance HUD) and Cold Lamps, lit at each Bell.
  Obols are the meta currency (Foundations screen).
- **Pawn (charm shop, six shelves):** prices are base x SI, capped against the Night quota (quota-aware warning, price plates with
  need-N-more). Always offers one affordable build charm (W57). Sets (archetypes, `charms/sets.ts`) give set bonuses. Engine charms EVOLVE
  (+ versions via Pawn). The STAMPS tab gilds, shifts or etches the Big One build (`stamps.ts`).
- **Stakes 0–7** (`stakes.ts`, `STAKE_MAX = 7`): Balatro-style, per-kit unlocks, Obol bonus. Stake presets on every machine: `7` SAFE (~5 % of pocket),
  `8` BOLD (~15 %), `9` BIG (~30 %, arms on the first press and fires on the second). `STAKE_QUOTA = 1.08`, `STAKE_INTEREST_CUT = 0.03`.
- **Daily Run (W50):** UTC-day seed, fixed kit and stake 3 (`daily.ts`), best-of-day and a copy line.
- **Starting kits** (`data/kits.ts`) and **charms** (common / rare / legendary; Turnstile, Mimic, Lampwick etc.).
- **Hotline:** phone deals (answer anywhere with P, guaranteed ring from Night 2). Rescue loan on an empty pocket (W13/W15).
- **Hollow Door (W32–W34):** a secret reached by three triggers, only in a debt run. It opens the Underneath, where Dark Lords run a
  Russian-roulette table (Ash, Ledgers, Mirrors) that forgives quota. Keys: W walks the seam; E sits; Space pulls.
- **Rooms and mahjong (W24):** Mahjong Little Wall in the Jade Room, the Keyring, openable wings, lockers, Boiler pressure and the Counting room with zone rules, lore notes.
- **TALLY duels (W25–W26):** anime-style duels against rivals (Tamsin, Lucan (N3 boss), Kuro, Mimosa, Orrin (N6), Vell (N8)) with cheats, cut-ins and Soul Marks.
  A peaceful ending path exists.
- **Tycoon floor (W27–W29):** four machines on Night 1, two to three unlock per Night, tarps and marquees; buy machines and EMPIRE floor income.

## 7. Balance numbers (current, from `src/game/data/schedule.ts`, `houseMood.ts`, `checkpoints.ts`, `stakes.ts`)
| Night | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base quota | 24 | 36 | 72 | 144 | 288 | 576 | 1152 | 2304 |
| Watches | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| Pulls | 7 | 7 | 8 | 9 | 8 | 9 | 9 | 10 |
| Clock (s) | 150 | 150 | 165 | 165 | 180 | 180 | 195 | 210 |
| Stake index (SI) | 1 | 3 | 10 | 30 | 100 | 300 | 1000 | 3000 |
| Interest rate | 0.55 | 0.50 | 0.45 | 0.40 | 0.35 | 0.30 | 0.25 | 0.20 |
| House Mood (payout x) | 1.18 | 1.10 | 1.03 | 1.00 | 0.98 | 0.97 | 0.96 | 0.95 |

- Ladder: each step at most 2x (N1 → N2 is 1.5x). Overdrawn Nights (past N8) grow the base by 1.7x; their interest is `0.20 - 0.04 k`, floor 0.04.
- Tithe: 12 % of Night quota per Watch from Night 3. House notice: from Night 6, quota >= 1.2 x coins held at Dawn.
- Floor: `F(n) = 12 + 6n` top-up at each Night start (`--no-float` turns it off). Hot Lamp x1.5. Machine of the Night x1.25.
- Human-bot reach (sim, 2000 runs, seed 20261013, with tithe): N1 94 %, N2 82 %, N3 60 %, N4 44 %, N5 37 %, N6 28 %, N7 24 %, N8 16 %.
  Without the tithe (`--no-tithe`): 94 / 82 / 66 / 52 / 45 / 36 / 29 / 27.
- The Wave 57 interest cut was tried and reverted: it made N2–N3 too hard. Interest vs play is tracked by the sim's `int%` column.

## 8. QA harness (`scripts/qa`) and sim (`scripts/sim/run.mjs`)
Full docs: `scripts/qa/README.md`. Key commands:
- **Machine bench:** `npm run qa -- --machine bigone --script "Space:150,wait:3000" --rounds 3 --shots <dir>`. Flags: `--sit`, `--seat`, `--force "<id>:<state>"`
  (decision states, registry in `src/core/debugForce.ts`), `--frames`, `--walk-view`, `--world`, `--js`, `--probe`. Each run starts its own
  vite and headless Chrome and cleans up only those.
- **Debt-run driver:** `node scripts/qa/bench.mjs --run "kit:rotator;stake:2;auto:night;state" --seed 1 --shots <dir>`. Steps (`;`-separated):
  `goto:<id>`, `goto:hot`, `play:<keys>xN`, `stand`, `bank:deposit:<n>`, `bank:withdraw:<n>`, `lever`, `bell`, `pawn`, `pawn:buy:<slot>`,
  `pawn:look`, `nightcard:<1|2|best>`, `auto:night`, `auto:night:event`, `events`, `banner:<ms>`, `shot:<name>`, `wait:<ms>`, `state`.
  Start config (not steps): `kit:<id>`, `stake:<n>`, `daily`. The run steps go on after a failed step; `run.over` skips the rest with one record.
- **`auto:night` bot (W56):** plays one Night like a sensible human: Hot cabinet first, then the spotlight, then the least-tilted machine; deposits
  to the Dawn projection; shops set-aware; takes a push-your-luck offer only at 1 in 3 or better; picks the best Night Card when no
  `nightcard:` follows. Stops with `end` = `night paid`, `topside`, `night card`, `time budget`, and so on.
- **Night Card choice:** `nightcard:best` picks by expected value (`CARD_EV` in bench.mjs), a QA heuristic, not a game rule.
- **Sim:** `node scripts/sim/run.mjs` (default: 2000 runs per bot, rotator and banker, 10 % of pocket per pull).
  Bots: `--bots human|rotator|banker|camper|careful|newbie|stamper`. Other flags:
  `--runs N`, `--no-tithe`, `--no-charms`, `--no-shop`, `--no-float`, `--mood a,b,...` (8 values), `--quotas`, `--si`, `--interest`, `--pulls`, `--start`,
  `--calibrate --target`, `--json out.json`, `--stamp-report [--spins N]`.
- **Tests and checks:** `npm test` (674 passing), `npm run check`, `npm run typecheck`, `npm run build`.

## 9. State and verification
Waves 7–58 are committed on `wave7-controls-circuit` (HEAD `5c168a9`). Whether it is pushed or merged to `main` is not recorded here: check git.

Verified for this pass (2026-10-15, Wave 58 HEAD): `npx tsc --noEmit` 0 errors; `node scripts/tests/index.js` 674 pass, 0 fail.
`check.mjs`, `build` and a live playtest were not run in this pass.

**Latest playtest: 6.5/10 (Wave 6). Target 8+.** No playtest has been recorded since, so the Wave 7–58 changes are not yet rated.

## 10. Known open issues
1. **Stale sim header:** `scripts/sim/run.mjs` line 9 says the tithe is 20 % of the Night quota. The code (`checkpoints.ts`, `TITHE_SHARE`) is 12 %.
   Fix the comment in a sim lane.
2. **Tithe as the late tension:** it cut the human reach at N3 (82 → 60 %) and N4 (52 → 44 %). Check it against the playtest before retuning.
3. **Not browser-verified end to end:** the 3D UI (CRT server browser, lobby, ledger, notes), Night Cards and the tithe line in the NIGHT PLAN, the starter draft UI.
4. **Performance on real hardware is unmeasured.** Need F3 numbers (fps/ms, calls, tris) from a mid laptop.
5. **Real two-machine WebRTC multiplayer is untested.** Node tests over the lobby pass.
6. **Audio:** win and jackpot SFX were reworked but not listened to. Calibrate TRIM with `renderSfx`.
7. **Balance still open:** claw expert ~110–130 % (accepted, max bet 25); lootbox pity (BRASS ~107 %); fruitmachine headless 83 % vs live 88 %;
   re-sim stacker and Big One after the W13–W14 changes.
8. **Gamepad support:** none yet (not re-checked this pass).
9. **`check.mjs` warnings:** hard-coded identifier strings; missing `playHeadless` in elevator, pisti, roulette, tavla.
10. **Playtest top issues** from the 6.5/10 notes are still not listed here. The director should add them.

## 11. Suggested next steps (in order)
1. **Playtest the current build** (Waves 16–58 changed the loop a lot) toward 8+. Use one real debt run plus `auto:night` as a sanity check.
2. **Re-sim after any balance change:** `node scripts/sim/run.mjs --bots human --runs 2000`, and update the schedule comments with the new numbers. Fix the tithe comment (issue 1).
3. **Browser pass:** starter draft, Night Cards (`nightcard:best` and a manual pick), Pawn (buy, EVOLVE, STAMPS), tithe in NIGHT PLAN, Hollow Door, TALLY duel, Daily Run.
4. **Gamepad support** (menu, pit movement, machine play, settings rebind).
5. **Performance** to a steady 60 fps on a mid laptop, using the client's F3 numbers.
6. **Multiplayer:** 2 tabs, then 2 PCs, then a Render deploy. A friend joins via `?join=CODE`.
7. **Sound pass** (jackpot, wins, ambience), then the blocky machine models.
8. **Content:** DECISIONS B tiers (Okey, Liar's Dice, rules-only variants, more Boss Nights, porcelain Collateral, proximity voice).
9. Merge `wave7-controls-circuit` into `main` when the director decides. Push only when the client asks.
