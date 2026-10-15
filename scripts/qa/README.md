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
| `--shots <dir>` | write `<machine>-round<N>.png` into this directory |
| `--seed <n>` | run seed for the bench room (default 1) |
| `--sit` | seat the player at the table first, through the bench hook `window.jackid.bench.sit()` (DEV build only). The script keys then go to the machine. The wallet and wagered are read before and after each round |
| `--seat <n>` | with `--sit`: the seat index (default: first free seat) |
| `--settle <ms>` | with `--sit`: wait after sitting before the first round (default 4000) |
| `--force "<machineId>:<state>"` | with `--sit`, same machine: after the seat (and `--js`), before the rounds, put the seated machine into `<state>` through the bench hook `window.jackid.bench.force()`. The result is in `force`. Fails the run when the machine has no handler |
| `--walk-view` | no sit. Press the script keys on foot, then screenshot the first-person view to `<machine>-walk.png` (needs `--shots`) |
| `--frames "<ms,ms,...>"` | screenshots at exact offsets after the last key is released (`<machine>-f<ms>.png`, or `-round<N>-f<ms>.png`). Each shot waits for a rendered frame. Trailing `wait:` steps are part of this timeline. Needs `--shots` |
| `--world` | a real debt run (`/?skipmenu=1&seed=N`) in the pit instead of a bench room. `--machine` is not needed |
| `--run "<steps>"` | a real debt run driven by steps (`;`-separated), see **Debt-run driver** below. Implies `--world`. Takes no `--sit`, `--force`, `--frames`, `--walk-view` |
| `--js "<expr>"` | run once after the room settles, before the rounds. The JSON value goes to `before`. `await` is allowed (`await import('/src/...')`) |
| `--probe "<expr>"` | read after every round (after the frame shots), recorded in `roundLog[].probe`. `await` is allowed |

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
```

Use `node scripts/qa/bench.mjs` for `--run` when a step list is long: `npm run` prints its banner on stdout before the JSON.

| step | what it does |
| --- | --- |
| `goto:<machineId>` | teleports the player in front of the first unlocked floor machine of that id (the machine's front, facing it), presses `E` (the real sit path). If that does not seat, it falls back to the devtools `world.occupy()`. Fails the step when the machine is not on the floor or locked. `via` says which path sat the player. Waits for the input mode to be `machine` (`inputMode` when it never is) |
| `play:<keys>xN` | presses the keys N times (default 1). Keys use the script syntax (`Space:150,wait:300`). The `x` suffix ends the step: `play:Space:150,wait:300x3` repeats both |
| `stand` | stands up from the seat (`world.standUp()`), then waits until the seat is free |
| `bank:deposit:<n>` | a Debt Terminal deposit of n coins (`run.deposit(n)`). `ok:false` when the run refuses it (pocket floor, quota room, not a quota Watch) |
| `bank:withdraw:<n>` | takes n coins back from the bank into the pocket (`run.withdraw(n)`, the broke path). `ok:false` when the window is shut or the bank is empty |
| `lever` | the terminal lever the run accepts now: OPEN THE FLOOR (Night paid), else the Bell (Intermission), else SETTLE (quota met). `lever: null` when none is open |
| `bell` | rings the Bell early (`run.ringBell()`): ends the Watch while playing or Last Call; unused pulls keep the ticket rebate. `ok:false` outside a playing Watch |
| `pawn` | one Pawn Window reroll (`run.pawn.reroll()`, Intermission only) |
| `pawn:buy:<slot>` | buys Pawn Window shelf `slot` (1-based, 1 to 6). Sits at the Pawn Window (`charm_vendor`) if not seated there, closes the tip, presses the shelf's key (`1`-`4`; `5` and `6` by `→` from shelf 4), then `Space` twice. `ok` is whether the shelf now reads sold. `charm`, `price`, `paid` say what it was. Intermission only (`reason` says so otherwise) |
| `pawn:look` | sits at the Pawn Window and screenshots the seat view to `run-pawn-look-<n>.png` (with `--shots`). `shelves` lists the stock (`null` = sold or empty, `[]` outside an Intermission) |
| `auto:night` | a bot plays one Night, see **Night bot** below. Its own actions are records with `auto: true` |
| `auto:night:event` | the same bot, but it stops at the first Watch whose floor event is live (no cutscene up), before that Watch's deposit. Its record has `end: "event"`. A later `auto:night` carries on from there |
| `events` | records and prints the live floor event (`watchEventView()`, `null` between Watches): `event` = `{ id, leftS, pulls }`, `announce` = the banner line |
| `banner:<ms>` | polls the page for the live event's announce line (up to `ms`), records `waited`, and shoots `banner-seen.png` when it shows. On a miss it records what `.t-banner` holds |
| `shot:<name>` | screenshot to `<shots>/<name>.png` (needs `--shots`) |
| `wait:<ms>` | pauses |
| `state` | records the state in `run.states` and logs it: `phase`, `night` (1-based), `watch` (1-based), `pocket`, `bank` (the balance), `withdrawable`, `quotaDue`, `quotaLeft`, `pullsLeft`, `pulls`, `minBet`, `nightDone`, `topside`, `over`, `seated` (the machine instance id or null), `intro` (the cutscene id or null), `starterOffer` (the three charm ids while the Starter Draft is open, else null), `starterLeft` (its timer, sim s), `charms` (the owned charm ids, `id xN` when stacked) |

Each step is recorded in `run.steps` as `{ step, ok, ms, … }`, in the order it ran (`via`, `at`, `instance`, `amount`, `lever`, `state`, `charm`, `price`, `paid`, `shelves`, `shot` where they apply).
A `play` or `bot:bet` record has `bets`: one `{ stake, machine, ok, refusal }` per `run.bet()` call the step made (the stake of each play, accepted or not; `refusal` is the run's refusal reason, null when accepted). Stakes are read through a wrapper that `--run` installs on the run once. A refused `lever`, `pawn`, `deposit`, `withdraw` or `bell` record has `refusal` (the run's `lastRefusal()` after the step) and `refusalNew`. The run keeps its last refusal until the next accepted bet or buy, so `refusalNew: false` means the reason may be left over from an earlier refusal; `reason` then stays the generic text. A failed step is kept: `ok:false` with `error` (a step that threw: the `goto` to a locked machine, a seat that does not take) or `reason` (a step the run refused). **The steps go on after a failed step.** `run.failed` counts the failed user steps. Only a page reload stops the list: `run.aborted` says so, the run is then invalid (see `viteEvents`), and the exit code is 1. Output is the same one JSON object; `run.intro` is `{ played, taps }`, and `run.shot` is `run-final.png` when `--shots` is set. `rounds` is 0 in this mode.

The steps use the running app's own handles (`window.jackid.app`: `world`, `player`, `run`, `cutscene`, `camera`, `input`), so no hook is added to the game.

Practical notes: `goto` needs the machine on the floor (the `coinflip`, `hilo`, `scratch`, `bigone`, `hotline`, `cashier`, `charm_vendor` ids are placed for seed 1). The quota, the Bell, the Pawn and the deposits only work in the right phase, so a full Night needs enough coins: `goto` plus `play` builds the pocket, and `lever` after a paid quota opens the floor. The first Watch of a run starts with the intro (there is no Intermission before it, so the Pawn Window is closed for it). The first sit at a machine shows a tip that the next key closes. The bot and the Pawn steps press `Digit0` first: it is no stake preset, so it closes the tip and does nothing else. Never use `Digit9` for this (it arms BIG).

### Night bot (`auto:night`)

`auto:night` plays one Night the way a sensible player would, for faster long runs. It stops when the Night rolls over (OPEN THE FLOOR), when the run ends, when it reaches the top, or after 15 minutes of wall time. Per Watch:

- **Deposit**: 40 % of the pocket while quota is owed (20 % when the terminal refuses it). Taken in the Intermission, or in the Bell or play for the first Watch of a Night (which has no Intermission before it).
- **Withdraw**: a pocket below the cheapest bet pulls the whole bank back out first.
- **Shop**: in the Intermission, the cheapest shelf that is not cursed, needs no swap, and costs at most 30 % of the pocket (`pawn:buy`, then `stand`).
- **Lever**: starts the Watch (`lever`); after a paid Night it opens the floor.
- **Bets**: 1 bet on odd Watches, 2 on even ones, rotating over the open machines of `BOT_MACHINES` (`coinflip`, `hilo`, `scratch`, `bigone`; the ones placed and unlocked now). Each bet is a `bot:bet:<id>` record: `goto`, `Digit0` (closes the tip), the stake walked down to the minimum (`KeyZ` 8 times), the machine's recipe (`BOT_RECIPE`: `Space` to play, `KeyQ` to collect, `Digit1` the hilo guess). `pulls` is `[before, after]`; `ok` is whether a pull was spent.
- **Bell**: rings the Bell (`bell`) once the Watch's bets are placed, after `stand`. Unused pulls keep the rebate. A Watch whose pulls run out closes by itself.
- **Per-Watch line**: once a Watch reaches its Bell (after its deposit), it logs `watch N<night> W<watch>: pocket, bank, quota due/left, event` to stderr and adds a record `{ step: "watch N-W", auto: true, pocket, bank, quotaDue, quotaLeft, event }` to `run.steps`. `event` is the floor event id or null.

The bot keeps its per-Watch bookkeeping on the run, so a bot step split by `auto:night:event` does not deposit twice or bet more than planned in one Watch.

### Starter Draft and floor events: a worked check

The Starter Draft opens before the first pull of Night 1 and holds the Bell until a card is taken. Pick card 2 and check the charm:

```
node scripts/qa/bench.mjs --run "shot:starter-offer;play:Digit2;wait:400;state;shot:starter-picked" --seed 1 --shots <dir>
```

The state after the pick shows `starterOffer: null` and `charms: ["lampwick"]` (seed 1). Stop at a floor event and shoot the HUD timer (the event line sits under the Watch line; it counts only in play, so the Bell holds it):

```
node scripts/qa/bench.mjs --run "play:Digit2;wait:300;auto:night:event;events;shot:event-hud;auto:night;state" --seed 1 --shots <dir>
```

Seed 1 has its first event on Watch 3 (`draft`). Seed 2 has one on Watch 1 (`tilt_switch`). A Watch 1 event fires its announce before the first step (no `event:start` reaches a listener installed after the room settles), so `banner:` cannot catch that line. Later Watches can be checked with `banner:<ms>`.

The recipes are approximate key sequences, not a strategy. A bet that does not spend a pull is recorded `ok:false` with `reason`. The summary record is `auto:night`: `night` (`[from, to]`), `end` (`night paid`, `run over`, `topside`, `lever refused`, `page reloaded`, `time budget`, `loop budget`), `deposits`, `shops`, `bets`, `bells`, `loops`. `ok` is true for `night paid` and `topside`.

## Intro skip

The debt run's story intro (`intro`) skips on a single Space tap once it has played for 1 s. The skip hint shows then: `TAP SPACE: skip intro` (Turkish: `SPACE DOKUN: girişi atla`). Earlier taps do nothing. The hold still skips any scene (`HOLD SPACE`), as before. Other scenes are unchanged: a tap advances a line, a hold skips the scene. The rule is in `src/core/cutscene/player.ts` (`INTRO_TAP_AFTER`). `--run` taps once per 1.2 s while the intro plays, so it works whichever wall-clock moment the intro starts.
