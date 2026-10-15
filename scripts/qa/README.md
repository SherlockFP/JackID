# QA bench (headless)

`scripts/qa/bench.mjs` drives one machine in its bench room (`/?bench=<id>`) in headless Chrome, over the
DevTools protocol. It has no dependencies: Node 22+ (global `WebSocket`) and Node built-ins only.

## Usage

```
npm run qa -- --machine bigone --script "Space:150,wait:3000" --rounds 3 --shots <dir>
```

| flag | meaning |
| --- | --- |
| `--machine <id>` | machine id, e.g. `bigone` (required) |
| `--script "<keys>"` | comma-separated steps, see below (default `wait:1000`) |
| `--rounds <n>` | run the script n times; one screenshot after each round (default 1) |
| `--shots <dir>` | write `<machine>-round<N>.png` into this directory. A file name already used (in this run, or already on disk) gets `-2`, `-3` … before `.png`: a shot is never overwritten |
| `--seed <n>` | run seed for the bench room (default 1) |
| `--sit` | seat the player at the table first, through the bench hook `window.jackid.bench.sit()` (DEV build only). The script keys then go to the machine. The wallet and wagered are read before and after each round |
| `--seat <n>` | with `--sit`: the seat index (default: first free seat) |
| `--settle <ms>` | with `--sit`: wait after sitting before the first round (default 4000) |
| `--force "<machineId>:<state>"` | with `--sit`, same machine: after the seat (and `--js`), before the rounds, put the seated machine into `<state>` through the bench hook `window.jackid.bench.force()`. The result is in `force`. Fails the run when the machine has no handler |
| `--walk-view` | no sit. Press the script keys on foot, then screenshot the first-person view to `<machine>-walk.png` (needs `--shots`) |
| `--frames "<ms,ms,...>"` | screenshots at exact offsets after the last key is released (`<machine>-f<ms>.png`, or `-round<N>-f<ms>.png`). Each shot waits for a rendered frame. Trailing `wait:` steps are part of this timeline. Needs `--shots` |
| `--world` | a real debt run (`/?skipmenu=1&seed=N`) in the pit instead of a bench room. `--machine` is not needed |
| `--menu` | the main menu (`/?seed=N`), no room. The veil is dismissed by a mouse press, then the script keys drive the die (`ArrowLeft` rolls to SETTINGS, `Enter` selects the face toward the camera, `KeyI` opens the credits). Takes no `--machine`, `--world`, `--run`, `--sit` or `--force` |
| `--run "<steps>"` | a real debt run driven by steps (`;`-separated), see **Debt-run driver** below. Implies `--world`. Takes no `--sit`, `--force`, `--frames`, `--walk-view` |
| `--js "<expr>"` | run once after the room settles, before the rounds. The JSON value goes to `before`. `await` is allowed (`await import('/src/...')`) |
| `--probe "<expr>"` | read after every round (after the frame shots), recorded in `roundLog[].probe`. `await` is allowed |
| `--query "<params>"` | extra boot query params, e.g. `--query "lang=tr"`. The language must be set at boot: the HUD caches its strings, so a `--js` setting would leave them in English |
| `--size <W>x<H>` | the Chrome viewport (default `1280x720`), e.g. `--size 1920x1080` |
| `--real-time` | the page runs on the wall clock (no fixed step). Default is the fixed clock, see **Fixed clock** below |

Script tokens:

- `Space`, `Enter`, `KeyX`, `Digit1`, `ArrowLeft` …: press and hold for 80 ms (the default)
- `Space:200`: press and hold for 200 ms
- `wait:1500`: pause for 1500 ms

Output is one JSON object on stdout. With `--sit`, each `roundLog` entry has `wallet: [before, after]` and `wagered: [before, after]`. Progress lines go to stderr.

```
{
  "machine": "bigone", "seed": 1, "rounds": 3,
  "roundLog": [{ "round": 1, "ms": 3160, "frames": 1138, "shot": "…/bigone-round1.png" }, …],
  "consoleErrors": 0, "errors": [], "shots": ["…"],
  "state": "ingame", "framesPerSec": 364,
  "cleanup": { "vite": "stopped", "chrome": "stopped", "profile": "removed", "ports": "freed" }
}
```

On failure the output is `{ "error": "…" }` and the exit code is 1. Cleanup still runs.

## Fixed clock (determinism)

By default the page boots with `?fixedstep=1&clock=manual` (DEV build only, `src/core/loop.ts`). Then:

- Each sim step is exactly 1/60 s, and the page moves only when the harness steps it (`window.__qaClock.step(n)`, one full
  step and render per frame). Every `wait:`, key hold, `--frames` offset, round and budget counts sim frames, not wall time.
- `performance.now()` reads the sim clock, so a wall-clock read in gameplay code (the rescue rings, the seat-replay window)
  cannot change the run. The offline `net.hostTime()` reads `app.time.sim` directly (`src/net/session.ts`, in every mode), so
  the timed machines (elevator, bandit, coinpusher, dicetower, hotline) follow the sim clock and stop when it pauses. The
  online host and client paths are unchanged. Known gap: the run's hotline clock (`src/game/run.ts`) still reads
  `performance.now()`, which equals `net.hostTime()` only in this manual clock. `Date.now()` is left alone (save catch-up).
- A promise the page returns (a seat glide, a cutscene) is awaited by stepping one frame at a time, so the harness never
  deadlocks on a promise that needs sim time.
- The per-Night summaries are the same for the same `--seed` and steps. Two invocations are compared with
  `node scripts/qa/bench.mjs --run "auto:night;nightcard:best;auto:night;state" --seed 3` (run twice, diff `run.nights`).
- `--real-time` restores the wall-clock page and the wall-clock waits (the old behaviour; not reproducible).

## Forcing a decision state (`--force`)

A machine's push-your-luck decision (Big One CHASE, scratch BUY THE THIRD, craps PRESS, keno DOUBLE DOWN, lootbox
TRADE UP, coinpusher THUMP) is offered only in a state the player reaches by luck. `--force` puts the seated machine
straight into that state so the decision can be shot and timed:

```
npm run qa -- --machine coinflip --sit --force "coinflip:win" --script "wait:1500" --shots <dir>
```

The bench hook `window.jackid.bench.force('<machineId>:<state>')` (src/world/bench.ts) dispatches to the handler the
machine registered with `registerDebugForce(machineId, fn)` (src/core/debugForce.ts, `fn(state) => boolean`). With no
registered handler it falls back to the optional `debugForce(state)` method (MachineBase; the bench panel's force field
uses it too). It returns `{ ok, via: 'registry' | 'method' | 'none', reason? }`. A machine opts in by registering at
module load, e.g. `registerDebugForce('bigone', (s) => { …; return true; })`, or by implementing `debugForce`. The
state names are the machine's own (`coinflip` takes `win | loss | near`).

## Table machines (`--sit`)

Table games (baccarat, craps, sicbo, derby, keno, threecard, sonkart …) need the player seated, and walking up with E is
not scripted. `--sit` calls the debug hook, which is the same path as E:

```
npm run qa -- --machine baccarat --sit --script "Digit1,Space:120,wait:2500,Space:120,wait:7000" --rounds 3 --shots <dir>
npm run qa -- --machine craps --sit --script "Digit5,Enter:120,wait:6000" --rounds 3 --shots <dir>
```

Baccarat: `1` bets Player, `Space` locks, `Space` skips the squeeze. Craps: `5` is a horn bet, `Enter` throws (shooter only).
The first sit shows a tip card that the next key closes. `--sit` closes it with `Digit0` before the first round, and only
while it is up.

**Stake presets (`Digit7` / `Digit8` / `Digit9`).** On a seated machine with a stake, `7` is SAFE (about 5 % of the pocket),
`8` is BOLD (about 15 %) and `9` is BIG (about 30 %). BIG asks for a second press within the confirm window, so a single
`Digit9` only arms it. Scripts and bot recipes must not press `Digit9` as a tip-closer: it arms BIG. The tip closer is
`Digit0` (`TIP_KEY` in `bench.mjs`), which no keymap binds in the game. Keys that a script presses during a round are real key events (CDP `Input.dispatchKeyEvent`).

## What it does

1. Starts `vite` on a free loopback port (`--strictPort`), as a child process.
2. Starts `C:\Program Files\Google\Chrome\Application\chrome.exe` headless (`--headless=new`) with a free
   `--remote-debugging-port`, a temp `--user-data-dir`, `--mute-audio` and `--window-size=1280,720`.
   Set `QA_CHROME` to use another binary.
3. Opens the bench room (or the debt run with `--world`), clicks the centre of the boot veil with a real mouse press
   (`CLICK TO ENTER THE PIT`) and waits for `window.jackid.state()` to be `ingame`.
   It then checks that rAF frames advance. If they do not, the run fails.
4. Runs the script once per round and captures a PNG after each round.
5. Collects `console.error`, uncaught exceptions and error log entries into `errors` / `consoleErrors`. The dev server has no
   favicon, so `favicon.ico` 404s are not counted.
6. Always stops both processes it started (`taskkill /T` on Windows) and removes the temp profile. It checks
   that the ports are free. It never touches other Chrome or Node processes.

## API

```js
import { runBench, parseScript, keyInfo } from './scripts/qa/bench.mjs';
const r = await runBench({ machine: 'bigone', script: 'Space:150,wait:3000', rounds: 3, shots: dir });
```

`runBench` returns the same object as the CLI. It throws on failure, after cleaning up.

## Notes

- Keep the machine's own timing in mind: `wait:` must be longer than one round, or the next press will
  land while the machine is still busy.
- Each run boots a fresh Vite server, so the first run takes a few seconds longer.
- The Vite server runs `scripts/qa/vite.bench.config.mjs`: the root config with HMR off and `src/` and `scripts/` not watched. An edit made while a run is up cannot reload the page (that used to fail the run with a bare "reading 'seated'" error).
- A bot round waits for the machine to go idle (`waitRoundIdle` in `bench.mjs`: `busy`, or bigone's `inRound`) instead of a fixed sleep. Measured: a coinflip flip is busy about 2.9 s after the press on a loss and 3.3 s on a win, so a 2.6 s sleep read a win as "no pot" and skipped its ride. A press that lands while the machine is busy is dropped by the machine.
- The per-Watch line is logged in phase `closing` (the last phase before the settle, when the Watch tithe is still open) or at the bot's own Bell, not at `bell` (the 2 s start cue of each Watch, before any bet).
- A page reload mid-run (the boot veil comes back, the screen goes black) fails the run with `the page reloaded during
  round N`. `reloads` counts them, and `viteEvents` keeps any Vite optimiser or HMR line seen during the run.

## Hollow Door (world mode)

The Underneath is reached through the Hollow Door, which needs a debt run. The reveal is a devtools call (the run's own
`revealHollow`, the same path as the triggers). Everything after it is real keys:

```
npm run qa -- --world --seed 7 --shots <dir> \
  --js "(async () => (await import('/src/world/hollow/index.ts')).revealHollow('seam'))()" \
  --script "wait:1500,Space:1000,wait:600,Space:1000,wait:600,Space:1000,wait:1500,KeyW:2500,wait:1500" \
  --probe "({ phase: (await import('/src/world/hollow/index.ts')).hollowDoor()?.phase })" --frames "300"
```

Keys: `W` walks through the seam, `A/D/W/S` walk, `E` sits at a Lord station and at the table, `Space` pulls, `R` spins
(one Ticket), `C` calls CHEAT. Digit0 closes the table's first-sit tip (it eats the next key). The intro tape is skipped
with a single Space tap (see **Intro skip** below). Seed 7 fires on the player's first pull (the run ends as a fall). Seed 1 is a Lord win.

## Debt-run driver (`--run`)

`--run "<steps>"` starts a real debt run (`/?skipmenu=1&seed=N`, the seed from `--seed`), skips the story intro, and runs the
steps in order. Steps are separated by `;`. A `play` step's keys use the script syntax, so its commas stay inside it. The
`xN` repeat suffix belongs at the end of the whole `play` list:

```
npm run qa -- --run "goto:coinflip;wait:600;state;play:Digit0,Space:120,wait:1500x2;state;stand;bank:deposit:5;state" --seed 1 --shots <dir>
node scripts/qa/bench.mjs --run "auto:night;state" --seed 1 --shots <dir>
node scripts/qa/bench.mjs --run "kit:rotator;stake:2;auto:night;state" --seed 1 --shots <dir>   # start config first, then the Night
node scripts/qa/bench.mjs --run "daily;auto:night;state" --seed 1 --shots <dir>                 # the day's run
```

Use `node scripts/qa/bench.mjs` for `--run` when a step list is long: `npm run` prints its banner on stdout before the JSON.

| step | what it does |
| --- | --- |
| `goto:<machineId>` | teleports the player in front of the first unlocked floor machine of that id (the machine's front, facing it), presses `E` (the real sit path). If that does not seat, it falls back to the devtools `world.occupy()`. Fails the step when the machine is not on the floor or locked. `via` says which path sat the player. Waits for the input mode to be `machine` (`inputMode` when it never is) |
| `goto:hot` | the same, for the Hot cabinet: the first Hot Lamp lit now (`run.circuit.lamps().hot[0]`, lit at each Bell). Fails when no Hot lamp is lit or the cabinet is locked. `machineId` and `lamp: "hot"` say which machine it was |
| `nightcard:<1\|2\|best>` | picks Night Card 1 or 2 of the offer, or `best` (see **Night Card choice** below): the id at that index of `run.nightCardOffer().candidates` goes to `run.pickNightCard(id)` (it takes the id). `offer` lists the offered ids, `cards` each card with its preview (`index`, `id`, `tone`, `text`, `lines`, `quotaTo`, `ratio`, `payoutX`, `ev`), `index` and `id` the one picked, and for `best` only, `best` the card the heuristic chose (1 or 2), `mode` (`ahead` / `behind` / `unknown`) and `why` (the reason) | Prints the offer. Fails with `no Night Card on this build` when the run has no `pickNightCard`, and is refused (no offer open) when none is up |
| `play:<keys>xN` | presses the keys N times (default 1). Keys use the script syntax (`Space:150,wait:300`). The `x` suffix ends the step: `play:Space:150,wait:300x3` repeats both |
| `stand` | stands up from the seat (`world.standUp()`), then waits until the seat is free |
| `bank:deposit:<n>` | a Debt Terminal deposit of n coins (`run.deposit(n)`). `ok:false` when the run refuses it (pocket floor, quota room, not a quota Watch) |
| `bank:withdraw:<n>` | takes n coins back from the bank into the pocket (`run.withdraw(n)`, the broke path). `ok:false` when the window is shut or the bank is empty |
| `lever` | the terminal lever the run accepts now: OPEN THE FLOOR (Night paid), else the Bell (Intermission), else SETTLE (quota met). `lever: null` when none is open. With the Home layer a paid Night's OPEN THE FLOOR is TAKE THE LIFT (`home` says the stage after: `ride`), and at home it is the bed (`sleep`) |
| `bell` | rings the Bell early (`run.ringBell()`): ends the Watch while playing or Last Call; unused pulls keep the ticket rebate. `ok:false` outside a playing Watch |
| `pawn` | one Pawn Window reroll (`run.pawn.reroll()`, Intermission only) |
| `pawn:buy:<slot>` | buys Pawn Window shelf `slot` (1-based, 1 to 6). Sits at the Pawn Window (`charm_vendor`) if not seated there, closes the tip, presses the shelf's key (`1`-`4`; `5` and `6` by `→` from shelf 4), then `Space` twice. `ok` is whether the shelf now reads sold. `charm`, `price`, `paid` say what it was. Intermission only (`reason` says so otherwise) |
| `pawn:look` | sits at the Pawn Window and screenshots the seat view to `run-pawn-look-<n>.png` (with `--shots`). `shelves` lists the stock (`null` = sold or empty, `[]` outside an Intermission) |
| `home:lift` | TAKE THE LIFT: `run.homeLiftReady()` then `run.openFloor()` on a paid Night with the Home layer, then waits (sim time, up to 10 s) for stage `evening` (the ride is 2.6 s). `night` is the Night paid, `stage` the stage reached. Fails (`reason`) off the casino floor, with the layer off, on a Night Card offer the lever is held for, or on Night 8 (the Topside choice) |
| `home:sleep` | the bed: the world's own `home:interact` event for station `bed`, sent through the app bus (`window.jackid.app.events`), then waits for the sleep (1.8 s) to open the next Night. `night` is the Night slept through, `nightAfter` the next one. Then it waits (up to 300 polls of 100 ms sim) for the arrival fade (`.px-fade`) to clear, so the next step starts on the casino floor in the light: `fadeClear` is true when it has. A dark screen that never clears fails the step. Fails off the Evening |
| `home:peep` | the peephole: the world's `home:interact` for station `peephole` (the 2 s look through the door). Waits the look out (2.2 s sim), then `stage` must still be `evening`. Fails off the Evening |
| `home:knock-check` | logs the Home state: `run` (`run.homeState()`: `stage`, `left` in sim s, `lights`, `chain`) and `world` (`world.home` `lights` and `chain`), also logged as `knock-check:` on stderr. `ok` needs the Home layer and the apartment built. Read-only: it runs after the run has ended, like `state` |
| `anchor:<name>` | teleports the player to a named world anchor (`world.anchor(name)`, e.g. `anchor:home.spawn`, `anchor:home.peephole`, `anchor:elevator.door`), standing at its world position (+0.05 m, as the Home placement stands) and facing the way the anchor faces. `at` and `yaw` say where it landed. For visual checks only. Needs a debt run; a Home anchor needs the apartment built (`ok:false`, `reason` names the missing anchor). A game step: it is skipped once the run has ended |
| `home:talk` | the spouse: station `spouse`. The record has `lines` (the i18n keys `phone.talk()` returned, `null` when a talk was already running), `harmony` and `blessed` (the `blessed` buff is held: the first talk of an Evening at Harmony 4+) |
| `home:switch` / `home:chain` | the ceiling light / the door chain: stations `switch` and `chain`. The record has `before` and `after` (`world.home` `lights` and `chain`) and `run` (`run.homeState()`); `ok` is false when the state did not flip |
| `phone:open` | presses the phone key (default `KeyT`, read from `input.bindings().phone`), then reads the phone: `open` (the `.px-phone` overlay is up), `unread`, `harmony`, `heat`, `messages`, `pending` (messages that wait for a reply). Walk mode only |
| `phone:reply:<n>` | presses digit `n` (1-3) while the phone is open; `answered` is `[before, after]` and `ok` is whether a reply was taken (`harmony` and `heat` are `[before, after]` too). A message arrives only in a Watch (`play`): reach one with `auto:night:event` or a long `wait`, then `phone:open` |
| `auto:night` | a bot plays one Night, see **Night bot** below. Its own actions are records with `auto: true` |
| `auto:night:event` | the same bot, but it stops at the first Watch whose floor event is live (no cutscene up), before that Watch's deposit. Its record has `end: "event"`. A later `auto:night` carries on from there |
| `auto:night:quota` | the same bot, but it stops in the Watch whose deposit meets the quota, before that Watch's Bell, so the NIGHT PLAN's OVERSHOOT line is on screen (shoot it, then `auto:night` carries on). Its record has `end: "quota met"` |
| `events` | records and prints the live floor event (`watchEventView()`, `null` between Watches): `event` = `{ id, leftS, pulls }`, `announce` = the banner line |
| `banner:<ms>` | polls the page for the live event's announce line (up to `ms`), records `waited`, and shoots `banner-seen.png` when it shows. On a miss it records what `.t-banner` holds |
| `shot:<name>` | screenshot to `<shots>/<name>.png` (needs `--shots`). A name already taken gets `-2`, `-3` … (never overwritten) |
| `wait:<ms>` | pauses |
| `state` | records the state in `run.states` and logs it: `phase`, `night` (1-based), `watch` (1-based), `pocket`, `bank` (the balance), `withdrawable`, `sealed` and `sealCoins` (the Overshoot Seal: while `sealed` is true it holds `sealCoins` of the bank, and `withdrawable` reads 0), `quotaDue`, `quotaLeft`, `pullsLeft`, `pulls`, `minBet`, `cheapestMin` (the cheapest minimum bet on the floor now, Night Card multipliers included: `betLimits`), `quotaSplit` (`{ base, titheAdded }`: the quota before the Watch tithes, and the coins the missed tithes added tonight), `nightDone`, `topside`, `over`, `seated` (the machine instance id or null), `intro` (the cutscene id or null), `starterOffer` (the three charm ids while the Starter Draft is open, else null), `starterLeft` (its timer, sim s), `charms` (the owned charm ids, `id xN` when stacked), `lamps` (`{ hot, cold }`: each lit Lamp as `{ instance, machineId, zone }`, the zone of its slot; empty between Watches), `event` (the live floor event as `{ id, leftS, pulls }`, or null), `nightCard` (the Night Card picked for this Night, or null), `nightCardOffer` (the offered Night Card ids while the offer is open, else null), `tithe` (the Watch tithe, `run.watchTithe()`: `{ on, target, earned, met, shortfall }`, or null) `houseCut` (the house cut paid tonight so far, `run.nightLedger().cut`, or null) and `overshoot` (the OVERSHOOT view, `run.overshootView()`: `{ balance, due, tier, reached, next: { id, target, gap } | null }`, or null) |
| `kit:<id>` | start config, not a step: the starting kit (`kits.ts` id, e.g. `kit:rotator`). Applied when the run starts, through the same `config` the kit picker passes to `app.go('ingame', …)` (`src/menu/menuState.ts` → `session.ts` → `createRun`). Unknown kit: the run is not started (error) |
| `stake:<n>` | start config, not a step: the stake 0-7 (`STAKE_MAX`), applied the same way. The picker's unlock rules are not enforced (the QA profile is fresh, so every stake above 0 would be locked); the start record's `gated.kit` / `gated.stake` say whether the picker would have held it back |
| `daily` | start config, not a step: the day's run, as the picker's daily toggle (today's kit, stake 3, the UTC day's seed; `run.ts` fixes the seed and kit). Cannot be combined with `kit:` or `stake:` |

Start config steps can sit anywhere in the list; each applies once, at run start, and is recorded first in `run.steps` as `{ step: "kit:…", start: true, kit, stake, daily, gated }`. `run.start` holds the same object.

`--run` blocks until the steps finish, or until the run ends (then the steps left over are skipped, see below), and only then writes the JSON, once. The process exits after that write has flushed. The exception is a page reload, which ends the list at once (see below).

When the run has ended (`run.over`, or the run is gone because the menu took the screen back), only the game-driving steps are skipped. They are listed in one record `{ step: "run over", ok: true, note, skipped: [...] }`, placed where the first skipped step was. The read-only steps still run after the end: `state`, `shot`, `wait`, `events`, `banner` and `home:knock-check`, so the mafia_visit cutscene and the results can be shot. A `play` repeat that comes after the end is not pressed (its record has `note: "run over after N of M"`). No step throws in that case.

Each step is recorded in `run.steps` as `{ step, ok, ms, … }`, in the order it ran (`via`, `at`, `instance`, `amount`, `lever`, `state`, `charm`, `price`, `paid`, `shelves`, `shot` where they apply).
A `play` or `bot:bet` record has `bets`: one `{ stake, machine, ok, refusal }` per `run.bet()` call the step made (the stake of each play, accepted or not; `refusal` is the run's refusal reason, null when accepted). Stakes are read through a wrapper that `--run` installs on the run once. A refused `lever`, `pawn`, `deposit`, `withdraw`, `bell` or `nightcard` record has `refusal` (the run's `lastRefusal()` after the step) and `refusalNew`. The run keeps its last refusal until the next accepted bet or buy, so `refusalNew: false` means the reason may be left over from an earlier refusal; `reason` then stays the generic text. A failed step is kept: `ok:false` with `error` (a step that threw: the `goto` to a locked machine, a seat that does not take) or `reason` (a step the run refused). **The steps go on after a failed step.** `run.failed` counts the failed user steps. Only a page reload stops the list: `run.aborted` says so, the run is then invalid (see `viteEvents`), and the exit code is 1. The run ending does not (see the `run over` note above). Output is the same one JSON object; `run.intro` is `{ played, taps }`, and `run.shot` is `run-final.png` when `--shots` is set. `rounds` is 0 in this mode.

The steps use the running app's own handles (`window.jackid.app`: `world`, `player`, `run`, `cutscene`, `camera`, `input`), so no hook is added to the game.

Practical notes: `goto` needs the machine on the floor (the `coinflip`, `hilo`, `scratch`, `bigone`, `hotline`, `cashier`, `charm_vendor` ids are placed for seed 1). The quota, the Bell, the Pawn and the deposits only work in the right phase, so a full Night needs enough coins: `goto` plus `play` builds the pocket, and `lever` after a paid quota opens the floor. The first Watch of a run starts with the intro (there is no Intermission before it, so the Pawn Window is closed for it). The first sit at a machine shows a tip that the next key closes. The bot and the Pawn steps press `Digit0` first: it is no stake preset, so it closes the tip and does nothing else. Never use `Digit9` for this (it arms BIG).

### Night bot (`auto:night`)

`auto:night` plays one Night the way a sensible human would, so long runs measure the design and not a min-stake loop. It plays the Night it is in. A call that starts on a paid Night (its OPEN THE FLOOR waiting) plays the next Night instead, which it opens first. It stops when that Night rolls over (the Night after it opens), when the run ends, when it reaches the top, or after 15 minutes of sim time (the fixed clock, see **Fixed clock**). Every decision is logged on stderr as `bot <what>: <reason>` and kept as a record `{ step: "decide: <what>", auto: true, reason }` in `run.steps`. Per Watch:

- **Bets**: bets go on until the Watch's pulls are down to 2 (`BELL_KEEP_PULLS`; the 1-2 left stay unused) or the pocket cannot cover a bet and keep one cheapest minimum bet (`canBet`: under 2 × `cheapestMin`), capped at 60 bets (`AUTO_BETS_MAX`). Each bet picks one machine, in this order: the **Hot cabinet** (the Hot Lamp lit now; Tilt does not apply) first, then the **spotlight** kind (`run.spotlightView()`, x1.25 this Night), then the **least-tilted** open machine (the most full-value pulls left, `run.circuit.tilt(id).lit`, so the bot rotates off Tilt). A machine is never bet twice in one Watch while another is open. Eligible: placed and unlocked slot or lottery machines, the spotlight kind, and the known recipes, whose minimum bet (`betLimits`) leaves one cheapest minimum bet in the pocket (`keepsMinAfter`). Two bets in a row that spend no pull drop a machine from the pool until the next Night (the counts clear at each Night).
- **Stake** (`pickStake`): **SAFE** (`Digit7`, about 5 % of the pocket) by default. **BOLD** (`Digit8`, about 15 %) on the Hot cabinet, on the spotlight, or while ahead of the Dawn projection (`dawn.met`). **BIG** (`Digit9`, about 30 %, a second press confirms it) only on a push-your-luck machine (`coinflip`, `bigone`) whose rule is live (coinflip rides a won flip once; bigone chases at `CHASE_P` or better), on an occasional seeded roll (about 1 bet in 5, `PUSH_BIG_ROLL`, a mulberry32 from `--seed`, never `Math.random`). BOLD needs 14 minimum bets in the pocket and BIG 20 (`BOLD_MIN_MULT`, `BIG_MIN_MULT`). The minimum bet is `cheapestMin`, so a Night Card that doubles the floor (HIGH TABLE) halves the count. A preset is taken only when its amount (the machine's `stakePresets`) clears the machine's minimum now (`betLimits`, a Night Card floor included: the run refuses a bet under it with `limit`) and the pocket left after it still holds one cheapest minimum bet.
- **Floor and minimum**: a bet is taken only when the pocket left after it still holds one cheapest minimum bet (`cheapestMin`, the cheapest minimum bet on the floor now, Night Card multipliers included, from `betLimits`), so no bet takes the pocket under the cheapest bet. The bot bets from 2 × `cheapestMin` up. Its pocket float is `botFloor` = **3 × `cheapestMin`** (`BOT_FLOAT_MIN_BETS`), or the game's own `run.depositFloor()` (2 × the cheapest bet) when that is higher. A digit the machine keeps for itself (`stakeKeyOwned`), or a pocket under the multiple, takes the next step down (BIG, BOLD, SAFE, then the minimum walked down with `KeyZ` 8 times, then raised with `KeyX` to the minimum the run accepts: `betLadder` stops at the machine's own `minBet`, so a Night Card floor such as HIGH TABLE can leave the walk-down under the run's `betLimits.min`). `Digit0` closes a first-sit tip first. The decision is logged as `bet <machine> (<STAKE>)` with its reason.
- **Push-your-luck**: coinflip flips (`Space`); after a win it rides once (`KeyR`) while the pot is under x3.6, then collects at x3.6 (`KeyQ`). bigone spins (`Space`); a line win leaves a chase offer, which it takes (`KeyG`) only at 1 in 3 or better (`CHASE_P` from `bigone/rules.ts`), else collects (`Space`). The other recipes are the key sequences of `BOT_RECIPE` (hilo, scratch) or `BOT_RECIPE_GENERIC` (one spin, then `KeyQ`).
- **Deposit**: once per Watch, after the bets, only what is needed and never below the bot float (`botFloor`, 3 × `cheapestMin`, see **Floor and minimum** above; the game's float applies too when higher). While quota is owed: the gap to the Dawn projection (`dawnPlan`, pace.ts: the bank at Dawn against the quota), 0 when the projection covers it. Once the quota is met: the gap to the next OVERSHOOT tier (`run.overshootView()`) when the pocket above the float covers it, else nothing, and the bot keeps playing toward that tier. A refusal retries at half.
- **Shop** (the Mola: the Intermission, the Pawn Window): a shelf that is clean (not cursed, no swap) and costs at most 30 % of the pocket. With **no charm held yet**, the best of those by rarity (legendary, rare, uncommon, common), then by price. With a charm held, only a shelf that completes an archetype set or shares an archetype with a held charm (`charms/sets.ts`): a set completion first, then the cheapest. Buys with `pawn:buy`, then `stand`.
- **Night Card**: a paid Dawn opens a two-card offer (`nightCardOffer`, the lever waits on it). The bot stops there (`end: "night card"`) when the next step in the list is `nightcard:<n|best>`, which then picks. Read-only steps (`state`, `shot`, `events`, `wait`, `banner`) between the two do not count, so `auto:night;state;nightcard:best` hands over the offer too. With no such next step it picks the best card itself (`nightcard:best`, the highest expected value, see **Night Card choice**). The stop record carries the offer: `offer` (the ids), `cards` (with their preview lines) and `have` (pocket + bank). An offer open at a later step is handled the same way.
- **Lever**: starts the Watch (`lever`); after a paid Night it opens the floor, which with the Home layer is the lift (see **The Evening**).
- **The Evening** (Home layer, solo runs): after the lift the bot is at home (`homeStage`). In the Evening it talks to the spouse once (`home:talk`, logged as `bot home`) and goes to bed (`home:sleep`), and the call ends when the next Night opens, as before. The ride, the sleep and the doom (a missed quota: `homeStage: doomed`, the run then ends `fell` with ending `shot`) are waited out by sim time. `evening stuck` ends the call when the bed is refused six times. The summary record has `evenings` (talks made).
- **Withdraw**: a pocket under two cheapest minimum bets (`canBet` fails: no bet, and one kept) withdraws to the bot float (3 × `cheapestMin`) before it bets, not the whole bank (a full withdraw and redeposit churns the quota). A refused withdraw is not retried in that Watch.
- **Overshoot Seal**: while the seal holds coins (`sealed` true, `sealCoins` above 0), `withdrawable` reads 0 and the bot does not withdraw. It does not break the seal either (BREAK THE SEAL forfeits tonight's tiers, a player choice). The pocket then stays at a minimum bet or more (no bet takes it under one), and the Watch rings its Bell. A sealed bank is therefore not a pocket-under-minimum failure: the check reads `withdrawable` (0 when sealed or empty), not `bank`.
- **Bell**: rings the Bell (`bell`) once the Watch's pulls are down to 2, or the pocket cannot cover a bet and keep one minimum bet, and its deposit is made, after `stand`. Unused pulls keep the rebate. A Watch whose pulls run out closes by itself.
- **Per-Watch line**: once a Watch reaches its Bell (after its deposit), it logs `watch N<night> W<watch>: pocket, bank, sealed (when it holds coins), quota due/left, overshoot (tier, next tier and gap), event` to stderr and adds a record `{ step: "watch N-W", auto: true, pocket, bank, withdrawable, sealCoins, minBet, quotaDue, quotaLeft, tithe, houseCut, event, overshoot }` to `run.steps`. `tithe` is the Watch tithe (`run.watchTithe()`, see the state record), `houseCut` the house cut so far tonight, `event` the floor event id or null.

The bet record is `bot:bet:<machine>` with `instance`, `night`, `stake` (`safe`, `bold`, `big` or `min`), `stakeWhy` (the reason), `bet` (the stake the machine holds after the keys), `stakeOk` (it is the stake asked for, the preset's amount or the minimum) and `bets` (the stake attempts). `pulls` is `[before, after]`; `ok` is whether a pull was spent.

**Per-Night summary (`run.nights`).** When a `--run` ends (or the steps run out), the JSON has `run.nights`, one entry per Night the run reached: `night`, `quota` (the final due, the last read), `baseQuota` (the quota before the Watch tithes: no tithes, no rescue loans), `titheAdded` (the coins the missed Watch tithes added tonight; `quota` = base + titheAdded + the rescue loans, to rounding, and a Lord's-writ Night reads 0), `bank` (the last read), `met` (the quota met at some read), `paid` (the Night was paid), `overshoot` (the highest OVERSHOOT tier reached, or null), `card` (the Night Card picked for it, or null), `events` (the floor event ids read in its Watches), `charms` (the owned charms at its last read) and `stakes` (the bets that spent a pull, by stake: `{ safe, bold, big, min }`). Each Night is also logged as one stderr line (`night N: quota …`), so a tester can read the run at a glance. The `state` record adds `spotlight` (`{ machineId, night, plays, progress }` or null), `lamps` (the lit Hot and Cold Lamps) and `dawn` (`{ due, balance, settles, projected, gap, met, float }`, the Dawn projection).

The bot keeps its per-Watch bookkeeping on the run, so a bot step split by `auto:night:event` does not deposit twice or bet more than planned in one Watch.

### Starter Draft and floor events: a worked check

The Starter Draft opens on a fresh Watch 1 before any pull, or at a Night 1 intermission (the Mola), and holds the Bell until a card is taken. Its three cards are seeded (`starterOffer(seed)`), so they differ by seed, and the bot's pick is logged as `bot starter` (a refused pick is logged once as `pick <id> refused`). The first state read on Night 1 with no charm yet waits (once per run) while the offer is still to come (`starterPending`: the run has not made it) until `starterOffer` is non-null, so an early `state` does not read a draft that has not opened yet. The offer waits for the intro, the title card and a quiet beat, so it opens about 12 s of sim time in under the fixed clock; the wait caps at 40 s (`STARTER_WAIT_MS`) and logs `starter draft: no offer after N ms` when it gives up. Pick card 2 and check the charm:

```
node scripts/qa/bench.mjs --run "shot:starter-offer;play:Digit2;wait:400;state;shot:starter-picked" --seed 1 --shots <dir>
```

The state after the pick shows `starterOffer: null` and `charms: ["lampwick"]` (seed 1). On seed 3 the draft was offered at the Night 1 intermission after Watch 2, and the bot took `ticket_press` (`bot starter` in the log), so the first charm is not always lampwick. Stop at a floor event and shoot the HUD timer (the event line sits under the Watch line; it counts only in play, so the Bell holds it):

```
node scripts/qa/bench.mjs --run "play:Digit2;wait:300;auto:night:event;events;shot:event-hud;auto:night;state" --seed 1 --shots <dir>
```

Seed 1 has its first event on Watch 3 (`draft`). Seed 2 has one on Watch 1 (`tilt_switch`). A Watch 1 event fires its announce before the first step (no `event:start` reaches a listener installed after the room settles), so `banner:` cannot catch that line. Later Watches can be checked with `banner:<ms>`.

The recipes are approximate key sequences, not a strategy. A bet that does not spend a pull is recorded `ok:false` with `reason`. The summary record is `auto:night`: `night` (`[from, to]`), `end` (`night paid`, `run over`, `topside`, `lever refused`, `night card`, `night card refused`, `page reloaded`, `time budget`, `loop budget`), `deposits`, `shops`, `bets`, `bells`, `loops`. `ok` is true for `night paid`, `topside` and `night card` (the pause).

### Night Card choice (`nightcard:best`)

A Dawn offer is two Night Cards. Each card's preview is the concrete change it makes to the coming Night (`nightCardPreview`: the
quota before and after, the Watches, the payout, and so on). To pick by the numbers, script the stop and the pick:

```
node scripts/qa/bench.mjs --run "auto:night;nightcard:best;auto:night;state" --seed 1 --shots <dir>
```

`auto:night` stops at the Dawn offer (`end: "night card"`) and prints both cards. The next `auto:night` opens and plays the Night the pick is for (see **Night bot**), so each pair of steps is one Night and one explicit pick. The sequence `auto:night;nightcard:best;auto:night;nightcard:best;auto:night;state` gives two explicit picks (the Night 1 and Night 2 offers). The last `auto:night` plays Night 3 (on seed 3: quota 76 = base 72 + tithes 4, met and paid), auto-picks the Night 4 card, and stops when Night 4 opens. `nightcard:best` picks the card with the
**highest expected value** (`EV`, `CARD_EV` and `summarizeOffer` in `bench.mjs`). Every term is a ratio of **pocket + bank** (`have`):

- `gain`: the payout multiplier (the preview's `payout` x `pulls` after/before) minus 1, times 0.25 (the share of the bank a Night's
  payouts move), plus the flat payout (`flat` coins x 4 wins) over `have`.
- `dQuota`: (the quota the card leaves - the Night's base quota) / `have`. A lower quota is a gain, a higher one a cost.
- `short`: the quota the card leaves above `have` / `have`, the part the pocket and bank cannot cover.

The mode comes from the Dawn projection (`dawn`, the state record's, the bank at Dawn against the quota):

- **ahead** (`dawn.met`, the bank covers the quota at Dawn): risk-on. Weights pay 1, quota 0.25, short 1, so a payout card wins
  over a quota one.
- **behind** (or no projection, `unknown`, which scores with these weights too): quota-lowering. Weights pay 0.25, quota 1, short 2,
  so a card that lowers the quota (RUSH NIGHT) wins over a payout card.

A tie keeps card 1. The record keeps `best` (1 or 2), `mode`, `why` (the reason in words, also logged as `why:` under the offer)
and each card's `ev` and `payoutX`. The proxies (0.25, 4 wins, the weights) are QA choices, not game numbers. Read the printed
lines before trusting the pick; it is a bot choice for QA, not a strategy.

The state record's `tithe` is the Watch tithe (`run.watchTithe()`: `{ on, target, earned, met, shortfall }`, `on` false outside a
tithe Watch), and `houseCut` is the house cut the owned machines have paid tonight at each Watch settle (`run.nightLedger().cut`).
Either is null on a build without that API. The per-Watch line and record carry both.

## The Evening (Home layer, wave 69)

A solo debt run has the Home layer (`run.homeOn`): a paid Night's floor lever is TAKE THE LIFT, the Evening is a sub-state of the
intermission (stages `ride`, `evening`, `sleep`; never a new phase), and a missed quota is the doomed ride (`doomed`) that ends with
`fell` and ending `shot`. The run owns every stage on sim time (`HOME_TIMING` in `src/game/run.ts`: ride 2.6 s, Evening 120 s then it
sleeps by itself, sleep 1.8 s, doom 8 s), so the fixed clock walks it byte for byte. `auto:night` passes the Evening on its own (the lift,
one talk, the bed). The explicit steps (see the step table) drive it by hand:

```
node scripts/qa/bench.mjs --run "auto:night;home:lift;state;home:talk;home:switch;home:chain;phone:open;home:sleep;state" --seed 3 --shots <dir>
```

`auto:night` stops at the rollover, so after it the Night is paid only if the bot paid it; `home:lift` needs a paid Night and the Dawn offer
picked (`nightcard:best`) when the lever is held for it. The state record adds `homeStage` (`ride` | `evening` | `sleep` | `doomed` | null),
`home` (`{ stage, left, lights, chain }`, `left` in sim s) and `phone` (`{ unread, harmony, heat, messages, answered }`), and
`starterPending`. The apartment's stations are driven through the same `home:interact` event the world's E prompts emit (`window.jackid.app.events`),
so a run without the apartment built (no `world.home`) still passes the flow; the teleport and the fades need the apartment (`home.spawn`).
Two invocations with the same seed give the same `run.nights` and the same stage trace.

`home:miss` forces a missed quota with no bets: it starts every Watch (the lever), rings the Bell once the Watch is in play, and repeats until
the doom ride starts or the run ends (`stage: "doomed"`, then the run ends with `fell` / ending `shot` and the mafia cutscene). Do not use
`lever` and `bell` by hand for this: the lever refuses during a Watch ending and the Bell refuses outside play. Try
`--run "home:miss;wait:9000;state" --seed 1902`.

**Recipe: capture the forced-miss scene (mafia_visit).** Seed 1902 on Night 1 misses the quota with no bets, so the doom ride
runs and the run ends `fell` / `shot`. The cutscene starts after the end, which is why the shots after the end must still run:

```
node scripts/qa/bench.mjs --run "home:miss;wait:9000;shot:mafia-visit;wait:4000;shot:mafia-later;state" --seed 1902 --shots <dir>
```

- `home:miss` returns once the stage is `doomed` (about 60 s of sim time: the Watches run out). `wait:9000` lands in the
  cutscene: `mafia-visit.png` shows the goon in the apartment hall. `state` then has `over: true`, `homeStage: "doomed"` and
  `intro: "mafia_visit"` while the cutscene plays. The later shot (13 s after the miss) is a later beat of the scene, not the
  results screen. Tune the `wait:` offsets for the beat you want, or add `--frames` if you need exact offsets.
- The steps after the end are read-only, so they run: `shot`, `wait`, `state` and `home:knock-check` (the doom's lights and
  chain). Game steps such as `anchor:` are skipped with the `run over` record.
- For a frame of the apartment itself (the hall, the door), take the Evening instead: `auto:night;nightcard:best;home:lift;anchor:home.spawn;shot:evening`
  (checked on seed 3: `home:lift` is held for the Dawn offer, so `nightcard:best` must come first). Then `anchor:home.peephole` for the door.

## Intro skip

The debt run's story intro (`intro`) skips on a single Space tap once it has played for 1 s. The skip hint shows then: `TAP SPACE: skip intro` (Turkish: `SPACE DOKUN: girişi atla`). Earlier taps do nothing. The hold still skips any scene (`HOLD SPACE`), as before. Other scenes are unchanged: a tap advances a line, a hold skips the scene. The rule is in `src/core/cutscene/player.ts` (`INTRO_TAP_AFTER`). `--run` taps once per 1.2 s while the intro plays, so it works whichever wall-clock moment the intro starts.
