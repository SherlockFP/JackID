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
The first sit shows a tip card that the next key closes. `--sit` closes it with `Digit9` before the first round, and only
while it is up. Keys that a script presses during a round are real key events (CDP `Input.dispatchKeyEvent`).

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
(one Ticket), `C` calls CHEAT. Digit9 closes the table's first-sit tip (it eats the next key). The intro tape is skipped
with a single Space tap (see **Intro skip** below). Seed 7 fires on the player's first pull (the run ends as a fall). Seed 1 is a Lord win.

## Debt-run driver (`--run`)

`--run "<steps>"` starts a real debt run (`/?skipmenu=1&seed=N`, the seed from `--seed`), skips the story intro, and runs the
steps in order. Steps are separated by `;`. A `play` step's keys use the script syntax, so its commas stay inside it:

```
npm run qa -- --run "goto:coinflip;wait:600;state;play:Digit9,Space:120x2;wait:1500;state;stand;bank:deposit:5;state" --seed 1 --shots <dir>
```

| step | what it does |
| --- | --- |
| `goto:<machineId>` | teleports the player in front of the first unlocked floor machine of that id (the machine's front, facing it), presses `E` (the real sit path). If that does not seat, it falls back to the devtools `world.occupy()`. Fails the run when the machine is not on the floor or locked. `via` says which path sat the player |
| `play:<keys>xN` | presses the keys N times (default 1). Keys use the script syntax (`Space:150,wait:300`). The `x` suffix ends the step: `play:Space:150,wait:300x3` repeats both |
| `stand` | stands up from the seat (`world.standUp()`), then waits until the seat is free |
| `bank:deposit:<n>` | a Debt Terminal deposit of n coins (`run.deposit(n)`). `ok:false` when the run refuses it (pocket floor, quota room, not a quota Watch) |
| `bank:withdraw:<n>` | takes n coins back from the bank into the pocket (`run.withdraw(n)`, the broke path). `ok:false` when the window is shut or the bank is empty |
| `lever` | the terminal lever the run accepts now: OPEN THE FLOOR (Night paid), else the Bell (Intermission), else SETTLE (quota met). `lever: null` when none is open |
| `pawn` | one Pawn Window reroll (`run.pawn.reroll()`, Intermission only) |
| `wait:<ms>` | pauses |
| `state` | records the state in `run.states` and logs it: `phase`, `night` (1-based), `watch` (1-based), `pocket`, `bank` (the balance), `withdrawable`, `quotaDue`, `quotaLeft`, `pullsLeft`, `pulls`, `over`, `seated` (the machine instance id or null), `intro` (the cutscene id or null) |

Each step is recorded in `run.steps` as `{ step, ok, ms, … }` (with `via`, `at`, `instance`, `amount`, `lever`, `state` or `reason` where they apply). Output is the same one JSON object; `run.intro` is `{ played, taps }`, and `run.shot` is `run-final.png` when `--shots` is set. `rounds` is 0 in this mode.

The steps use the running app's own handles (`window.jackid.app`: `world`, `player`, `run`, `cutscene`, `camera`), so no hook is added to the game. A step that the run refuses is recorded with `ok:false` and the steps go on. A teleport or seat that fails fails the run. Keep in mind that the first sit at a machine shows a tip that the next key closes (`Digit9`, as above).

Practical notes: `goto` needs the machine on the floor (the `coinflip`, `hilo`, `scratch`, `bigone`, `hotline`, `cashier` ids are placed for seed 1). The quota, the Bell and the Pawn only work in the right phase, so a full Night needs enough coins: `goto` plus `play` builds the pocket, and `lever` after a paid quota opens the floor.

## Intro skip

The debt run's story intro (`intro`) skips on a single Space tap once it has played for 1 s. The skip hint shows then: `TAP SPACE: skip intro` (Turkish: `SPACE DOKUN: girişi atla`). Earlier taps do nothing. The hold still skips any scene (`HOLD SPACE`), as before. Other scenes are unchanged: a tap advances a line, a hold skips the scene. The rule is in `src/core/cutscene/player.ts` (`INTRO_TAP_AFTER`). `--run` taps once per 1.2 s while the intro plays, so it works whichever wall-clock moment the intro starts.
