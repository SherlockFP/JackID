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

Script tokens:

- `Space`, `Enter`, `KeyX`, `Digit1`, `ArrowLeft` …: press and hold for 80 ms (the default)
- `Space:200`: press and hold for 200 ms
- `wait:1500`: pause for 1500 ms

Output is one JSON object on stdout. Progress lines go to stderr.

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

## What it does

1. Starts `vite` on a free loopback port (`--strictPort`), as a child process.
2. Starts `C:\Program Files\Google\Chrome\Application\chrome.exe` headless (`--headless=new`) with a free
   `--remote-debugging-port`, a temp `--user-data-dir`, `--mute-audio` and `--window-size=1280,720`.
   Set `QA_CHROME` to use another binary.
3. Opens the bench room, presses Enter on the boot veil, and waits for `window.jackid.state()` to be `ingame`.
   It then checks that rAF frames advance. If they do not, the run fails.
4. Runs the script once per round and captures a PNG after each round.
5. Collects `console.error`, uncaught exceptions and error log entries into `errors` / `consoleErrors`.
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
