# JackID: Handoff (read this first if you are a new AI / developer taking over)

Last updated: 2026-10-20. Waves 7–108 on branch `wave7-controls-circuit`, merged into `main` (HEAD `be77435` = Wave 108 at the time of
writing; check `git log` for the latest). Repo: https://github.com/SherlockFP/JackID. Render deploys `main` to jackid.onrender.com.

## 1. What this is, and where it stands
**JackID** is a first-person PSX-style (1997 look) light-horror casino roguelike, TypeScript + Vite + three.js. Inspired by CloverPit,
Buckshot Roulette and "Welcome to the Game" (a home / phone / mafia layer), original IP, Turkish setting (Cyprus-style casino, Soviet and
Turkish touches). You play 8 Nights in a casino under a debt quota, go home between Nights, and finish the run at **SON OYUN** (the last game).

Status (2026-10-20):
- `npm test`: 1552 pass. `npm run typecheck`, `node scripts/check.mjs` (0 errors, ~1179 warnings) and `npm run build` are clean.
- QA tour: 36/36 checkpoints green, 0 console errors.
- Newcomer review (Haiku over the tour shots): first 15 minutes **7/10**, visual consistency **7/10**.
- The client said: **not selling yet**. No demo, store page, Electron or capsule work until asked. Focus is "oyun temelleri" (the fundamentals).

## 2. Run it
```bash
npm install
npm run dev          # http://localhost:5180 (strict port; other ports belong to the client's other project)
npm run typecheck    # tsc --noEmit (use NODE_OPTIONS=--max-old-space-size=4096)
npm test             # node scripts/tests/index.js (1552 tests, about 100 s)
node scripts/check.mjs   # i18n EN/TR parity, layer rules (core can't import game/world, machines can't import world), no Math.random / Date.now / setTimeout in game code
npm run build
node scripts/qa/bench.mjs --tour --size 1920x1080 --query lang=tr --out <dir>   # the 36-shot tour, ~2 min, writes tour.json
node scripts/qa/bench.mjs --run "<steps>" --seed N --shots <dir> [--js "<expr>"] [--probe "<expr>"]   # debt-run driver
node scripts/sim/run.mjs --runs 400 --bots human   # economy sim (reach % per Night, LUCK line)
```
Deploy: Render builds `main` (`npm ci && npm run build`, `npm start`). A version check (`version.json`, `__BUILD_ID__`) reloads stale tabs.

## 3. Working with this client (important)
- **Reply in Turkish, plain and casual.** The client rejects AI-sounding wording ("kehribar gözlü ne ya"). The same rule applies to in-game copy: short, everyday words.
- **Roles:** the main session is the director (plans, gates, commits). Implementation goes to subagents/workflow lanes with **exclusive file ownership**.
  Haiku for discovery and review, Sonnet for build, art, models and copy, Opus only for hard design/integration. Agents never do git writes.
- **The PC is weak and has crashed** (7800X3D, 32 GB, but the client also runs "Astra", another project with many vite servers). Run ONE heavy
  command at a time (never `npm test` and the tour chained in one command, never two benches at once). Never kill node/vite processes you did not start.
- **Fewer tests (client, 2026-10-20: "testleri azalt"):** for a small fix run typecheck + only the test files that touch it. Run the full `npm test`
  once before a bigger wave's push. Tour/bench only when a visual change needs a look.
- **Never edit source with PowerShell Get-Content/Set-Content** (UTF-8 mojibake). Use the Edit/Write tools or Python with utf-8.
- **Git:** after a gated wave, commit, push the branch, then fast-forward `main` and push (the client approved this flow):
  `git push origin wave7-controls-circuit; git checkout main; git merge --ff-only origin/main; git merge wave7-controls-circuit; git push origin main; git checkout wave7-controls-circuit`.
- Browser tests are muted. Asset downloads only when free and clearly licensed, with the licence noted (see `docs/ASSETS.md`).
- Code lanes follow minimal-change rules ("ponytail": read callers first, reuse helpers, no speculative options, root-cause fixes, a small test for new logic).
- Memory notes for this project live in the Claude memory folder (`jackid-workflow.md`, `jackid-direction-2026-10.md`, `jackid-menu-pref.md`).

## 4. Documents
`docs/BRIEF.md` (client requirements) > `docs/DECISIONS.md` > `docs/TECH_SPEC.md` > `docs/GDD.md` > `docs/machines/*` > `docs/ART_BIBLE.md` / `docs/ART.md`.
Story and systems: `docs/STORY_BIBLE.md`, `docs/BLESSINGS.md` (gods, boons, Rites, Favour, name seals), `docs/JOKER.md` (Loki), `docs/HOUSE_DIRECTOR.md`,
`docs/WAVE69_HOME.md` (home layer). QA: `scripts/qa/README.md`.

## 5. Code map (main areas)
- `src/core/`: app, loop, events bus, seeded rng (Math.random forbidden), save + migrations (`save.ts`), i18n, settings, input (`input.ts`, gamepad `input/pad.ts`),
  `ui/` (overlay, toasts, banners, subtitles queue with lanes, panels), `renderer/` (PSX: affine 0.3, 360p default), `audio/` (SFX buses, procedural + CC0 Ogg music), `cutscene/`.
- `src/machines/<id>/`: `rules.ts` (pure, headless), `model.ts`, `index.ts`. `_base/` has MachineBase, seat HUD (`seatHud.ts`, seated focus mode). Reference: `coinflip`.
- `src/game/`:
  - `run.ts`: DebtRun (Night/Watch/Dawn state machine, quota, bank, mod pipeline, seals, endings, SON OYUN API).
  - `lastGame.ts` (odds, contract), `lastGame.ui.ts` (panel), `luck.ts` (ŞANS meter), `pantheon.ts` (+ui: gods, boons, Dawn offer and receipt).
  - `food.ts` (banana, coffee, sandwich, energy, soup, **tea/çay**), `cheats.ts` (KONSOL codes; cheated runs record nothing), `achievements.ts` (31, 1000 G).
  - `terms.ts` (first-sight explainers + journal glossary), `tutorial.ts` (Night 1 coach, objective line, waymark target), `brokePrompt.ts`, `rescue.ts`.
  - `home/` (evening, phone, Ada, heat/harmony, home computer), `story/` (chapters, endings + cards, Burning Wager `wager.ts`, cutscenes, duels), `joker/` (Loki), `duels/`.
  - `data/schedule.ts` (Nights, quota ladder, House notice), `houseMood.ts`, `checkpoints.ts` (Watch tithe), `data/charms.ts`, `data/buffs.ts`.
- `src/world/`: `layout.ts` (floor slots, `LAST_GAME_POS`), `level.ts`, `props/` (incl. `lastGame.ts` cabinet, `food.ts`, `identity.ts` çay glass), `home/` (apartment), `street/` (walk home).
- `src/menu/`: main menu (die cabinet, skyscraper night background), `hud.ts` (HUD), `hud/disclose.ts` (progressive disclosure by Night), `hud/waymark.ts`.
- `src/player/`: first-person controller, `viewmodel.ts` + `viewmodel/items.ts` (hands, held items; CC0 rigged arms).

## 6. The loop today
- **Night 1 prologue:** the flat (Ada), walk the street to the casino, lift down, the casino. Coach + objective line ("HEDEF") and a run goal line
  ("Oyun: 8 gece dayan, sonra SON OYUN'u kazan") on Nights 1–2. The Night readout shows "GECE n/8".
- **A Night:** Mola (shop, bank) → Watches (pulls, clock, Last Call, Bell, Settle) → Dawn (quota paid from the bank; receipt; boon offer from the gods).
  Then the lift home: the Evening (Ada, phone, çay from the çaydanlık, home computer, bed) → sleep → next Night.
- **Name seals = 3 lives** (`SOUL_MARKS_PER_RUN`): a short Dawn spends one (and a memory); the last seal never covers a Dawn.
- **ŞANS (luck meter):** −2..5 stars (more with charms/boons). Each star = +2 % payout. Gains: quota met, overshoot tiers, a cooled Heat, keepsakes,
  ghost matches, boons. Losses: quota failed / sealed Dawn −2, a missed Watch tithe −1 (**once a Night**, wave 107), warm Heat −1, rescue loan −1.
  Shown from Night 3 (disclose.ts).
- **The end (Night 8):** story (home) runs: the Kitchen duel with Ada the Evening before Night 8, then after Night 8 is paid the Burning Wager vs the Champion.
  A Wager loss ends the run (THE CHAIR). A Wager win **opens SON OYUN**. Plain runs: the Topside panel offers SON OYUN or GO BACK DOWN (Overdrawn Nights, more luck).
- **SON OYUN** (`src/game/lastGame.ts`): the House's machine in the Lobby lights after Night 8 is paid. Odds shown part by part:
  base 5 % + 3 % per ŞANS star + 0.5 % per run-wide luck point + `x.lastGame.pct` (charm Son Jeton +8, boon Son Saat +5), clamped 2–65 %.
  Win → ending `last_game` ("SON OYUN: KAZANDIN"), or ALONE if Harmony is 0. Loss → one seal burns, pull again or walk away (the Topside choice comes back).
  Loss on the last seal → THE CHAIR. Walking away keeps GO BACK DOWN reachable.
- Endings: kept_pair, cold_kitchen, alone, chair, kept, paid_in_full, he_came_home, descend, fall, last_game (`story/endings.ts`, rule order matters).

## 7. Balance numbers
| Night | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base quota | 24 | 36 | 72 | 144 | 288 | 576 | 1152 | 2304 |
| Watches | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| Pulls | 7 | 7 | 8 | 9 | 8 | 9 | 9 | 10 |
| Interest | 0.55 | 0.50 | 0.45 | 0.40 | 0.35 | 0.30 | 0.25 | 0.20 |
| House Mood (payout ×) | 3.5 | 1.8 | 1.5 | 1.25 | 0.98 | 0.97 | 0.96 | 0.95 |

- Night 1 starts with a 12-coin pocket. House notice from Night 1: the next quota is at least 1.25 × the coins held at Dawn (`HOUSE_NOTICE_SHARE`).
  Tithe: 12 % of the Night quota per Watch from Night 3 (a miss adds the shortfall to the quota).
- Sim, human bot, 400 runs: reach N1 88 %, N2 73.5, N3 58, N4 46.8, N5 41.5, N6 36.3, N7 31.8, N8 28.5.
- Sim LUCK line (wave 107 rule): mean 4.3 stars at the Night 8 Dawn; SON OYUN about 18 % a pull (33 % with 2 seals, 45 % with 3) before charms and luck points.
  The sim does not track seals or home-only luck sources.

## 8. QA notes
- The tour (`--tour`) is the main visual regression check (36 named shots + `tour.json`). Look at the shots, not only the pass flags.
- `--run` steps: `auto:night`, `auto:night:quota`, `auto:night:evening`, `home:sleep`, `station:<id>` (e.g. `station:tea`), `goto:<machineId>`, `anchor:<name>`,
  `play:<Key>:<ms>`, `ui:click:<selector>`, `shot:<name>`, `state`, `wait:<ms>`. Hold Space (`play:Space:1300`) to skip a scene.
- The bot cannot play the Kitchen duel, so `--run` stalls at Night 7's Evening. To see SON OYUN, force it with `--js` (set `run.topside = true`,
  `run.chapterRec.wager = 'win'`, teleport with `app.player.teleport({x:1.2,y:0,z:3.7}, -Math.PI/2)`; force a win with `run.rng.chance = () => true`).
- In the full test suite, a HomePhone left alive by another test hears `run:tithe` and moves luck; luck tests count those moves out (see `luck.test.mjs`).

## 9. Known open issues
1. **SON OYUN has not been seen end to end in a real run** (only forced on Night 1). The bench bot cannot pass the Kitchen duel.
2. Walk-away → Topside panel reopen (wave 108) and the Overdrawn path with SON OYUN are only covered by reading code and unit tests, not on screen.
3. **Visual consistency 7/10:** panels differ in style (cream boon cards, green CRT, gold cashier, glitch duel). A unifying art pass is open.
4. The waymark only exists for runs started on Night 1 (`startTutorial` returns null otherwise), so a resumed late run gets the SON OYUN banner but no diamond.
5. Quotas explode with very large banked wealth (House notice 1.25 × held + interest); fine in normal play, extreme with cheats.
6. Real two-PC multiplayer and mid-laptop performance are unmeasured. `check.mjs` has ~1179 warnings (mostly hard-coded identifiers).
7. Loki J4/J5 waves (home and ending beats) are not done.

## 10. Suggested next steps
1. Play one real run to Night 8 by hand (or teach the bench bot the Kitchen duel) and check SON OYUN in context: odds, the panel, walk-away, GO BACK DOWN.
2. Re-run the newcomer review on a fresh tour and fix its top items (target 8+/10).
3. Visual consistency pass on the panel styles, keeping the client's taste (they like the gold die cabinet menu).
4. Performance numbers on a mid laptop (F3), then multiplayer smoke on two machines.
