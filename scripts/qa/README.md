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
| `--walk-view` | no sit. Press the script keys on foot, then screenshot the first-person view to `<machine>-walk.png` (needs `--shots`) |
| `--frames "<ms,ms,...>"` | screenshots at exact offsets after the last key is released (`<machine>-f<ms>.png`, or `-round<N>-f<ms>.png`). Each shot waits for a rendered frame. Trailing `wait:` steps are part of this timeline. Needs `--shots` |
| `--world` | a real debt run (`/?skipmenu=1&seed=N`) in the pit instead of a bench room. `--machine` is not needed |
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
with held Space. Seed 7 fires on the player's first pull (the run ends as a fall). Seed 1 is a Lord win.
