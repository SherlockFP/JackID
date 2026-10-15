# Multiplayer smoke (two headless pages)

Driver: `scripts/qa/mp.mjs` (config `scripts/qa/vite.mp.config.mjs`). Run it from the project root:

```
node scripts/qa/mp.mjs                      # default transport chain (server first)
node scripts/qa/mp.mjs --net relay          # forces ?net=relay on both pages
node scripts/qa/mp.mjs --shots <dir>        # also writes host/client PNGs at lobby, pit and seated
```

It starts, in order: the lobby server (`server/index.js` on a free port, `PORT` env, `HOST=127.0.0.1`), a Vite dev
server on a free port with a config that proxies `/lobby` and `/api` to that lobby port (the root `vite.config.ts`
hard-codes `:8787`), then two headless Chrome processes with separate temp profiles. The host and the client
therefore share no `BroadcastChannel`, so the tab transport cannot carry the join: it must go through the lobby. Output
is one JSON object on stdout; progress goes to stderr. Exit code 0 means every step passed. Everything it started is
stopped and its profile removed; the ports are checked to be free afterwards. Requires Node 22+ and Chrome at
`C:\Program Files\Google\Chrome\Application\chrome.exe` (override with `QA_CHROME`).

## Steps

| # | step | how |
| --- | --- | --- |
| 1 | lobby server up | `node server/index.js`, `GET /api/health` ok |
| 2 | Vite up | `vite --config scripts/qa/vite.mp.config.mjs` |
| 3 | host and client boot to menu | real click on the boot veil |
| 4 | host creates the room | `app.net.host({ name, mode: 'coop', max: 4, public: true, lateJoin: true })` |
| 5 | room listed | `GET /api/rooms` contains the room id |
| 6 | host lobby screen | `app.go('lobby', { role: 'host' })` |
| 7 | client joins by code | `app.net.join({ via: 'server', roomId })`, then `app.go('lobby', { role: 'client' })` |
| 8 | host sees 2 players | `app.net.players.size >= 2` |
| 9 | run starts | real `F4` key on the host lobby (the lever); both pages reach `ingame` |
| 10 | both in the pit | world present, machines placed, `seatPhase` free on both |
| 11 | client seats | `app.world.occupy(<first unlocked machine>)` (the E request, sent as `mocc`); wait for `seated` |
| 12 | client plays | real `Space` x3 on the client page |
| 13 | host sees the play | host copy of the machine lists the client's PlayerId in `seats`; host received `mev` envelopes |
| 14 | client stands up | `app.world.standUp()`; host copy of the seat is freed |

## Results

Both runs passed all 14 steps, with zero console errors and zero page reloads on either page.

| run | transport | room join | pit | seat on client | host saw play | host freed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | default (server first) | ok, client `selfId` 2 | both `ingame`, 21 / 22 machines | `WELL-01` (bigone), `seated` | 4 `mev` from client, host `seats` = [2] | yes |
| 2 | `?net=relay` | ok | both `ingame` | `seated` | 1 `mev`, host `seats` = [2] | yes |

Pit snapshot (run 1): host `selfId` 1, `isHost` true, 2 players; client `selfId` 2, `isHost` false, 2 players. The
host's `world.machines()` count (21) differs from the client's (22) and the unlocked count (16 vs 17). Both sides are
per-page placements, so this is recorded as an observation, not a failure. It is not explained by this smoke; check
it if you rely on identical floors per client.

Cleanup: every run stopped chrome, vite and the lobby server, removed both profiles, and freed both ports.

## What works

- Room creation on the lobby server, listing in `/api/rooms`, and a join by code from a second browser profile with no shared tab.
- The lobby handoff (`lobby` state for both sides) and the start: F4 on the host moves both pages into the pit.
- The seat request and grant: the client's `mocc` is granted by the host, and the client reaches `seated`.
- Play reaches the host: the client's machine envelopes arrive at the host (`mev`), and the host's copy of the machine lists the client as seated. Standing up frees that seat on the host.
- The same flow works when the page is forced to the relay transport (`?net=relay`).

## What did not work

Nothing failed in these two runs. No error text was produced by the game.

## Limits of this smoke (what it does not cover)

- The host and client are set up through the devtools API (`window.jackid.app.net.host/join`, `app.go('lobby')`), not through the menu UI (host panel, server browser, join by code screen). The real input is the boot veil click, the lobby F4 start, and the Space presses.
- The client seats through `world.occupy()` (the same request as E), not by walking to a machine and pressing E.
- The transport actually used is not read back. The join runs in a separate profile, so it cannot be the tab transport. WebRTC versus relay under the default chain is not distinguished; `?net=relay` forces the relay path through bootParams.
- Not exercised: WebRTC (`?net=webrtc`), Trystero global P2P, the tab transport, password rooms, a denied join (full, password, started), kick, host leave, late join, chat, emotes, the reverse direction (host plays, client sees), the co-op quota, and reconnect.
- Two-player only. The lobby limit (max 8) and the 15 s room expiry are not tested.
- The floor layout is not the same for both pages (21 vs 22 machines in run 1); the smoke only checks the machine it seats at.

## Files

- `scripts/qa/mp.mjs`: the driver (new).
- `scripts/qa/vite.mp.config.mjs`: Vite config with the lobby proxy on the run's own port (new).
- `docs/MP_SMOKE.md`: this page (new).
- Uses, without changing: `server/index.js`, `docs/DEPLOY.md` (run and proxy notes), `src/net/session.ts`, `src/world/world.ts` (`occupy`), `src/world/sys/router.ts` (`request`).
