# JackID — Deploy

One Node process serves the built client (`dist/`), the lobby REST API (`/api`) and the
signaling/relay WebSocket (`/lobby`). State is in memory: one instance only, no database.

Requirements: **Node 22** (Node 20+ works). Dependencies: `ws` (server) and `trystero` (client P2P),
both already in `package.json`. No new packages are needed.

## 1. One box (Render Web Service, recommended)

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm run server` (runs `node server/index.js`) |
| Health check path | `/api/health` |
| Environment | `NODE_VERSION=22` |
| Environment | `PORT` is injected by Render. Do not hardcode it; the server reads `process.env.PORT`, default 8787 |

Optional environment variables:

| Variable | Purpose |
|---|---|
| `ALLOWED_ORIGINS` | Comma list of origins allowed to open `/lobby`, e.g. `https://jackid.example.com`. Unset = any origin. Set it on split deployments. |
| `ICE_SERVERS` | JSON array of ICE servers sent to every client in `welcome`. Default: two public STUN servers. Add TURN here (see §4). |
| `HOST` | Bind address. Default `0.0.0.0`. |

After the first deploy, check:

* `https://<your-service>.onrender.com/api/health` returns `{"ok":true,...}`.
* `https://<your-service>.onrender.com/` loads the game.
* `https://<your-service>.onrender.com/api/rooms` returns `[]` or the public rooms.

Render terminates TLS, so clients connect to `wss://` automatically (the client picks `wss` on `https:` pages).

Render's free plan sleeps idle services. The first request after a sleep takes about 30 s and
open rooms are lost on sleep. Use a paid instance for an event night.

## 2. Split hosting (static client elsewhere, lobby on Node)

Use this when the game is served from a CDN or a static host and only the lobby runs on Node.

1. Build the client with the lobby URL baked in (`VITE_LOBBY_URL` is read at build time):

   ```sh
   VITE_LOBBY_URL=wss://lobby.example.com/lobby npm run build
   ```

   The HTTP base is derived from the same host with `/api`, so the lobby must serve both.
2. Upload `dist/` to the static host (Netlify, Cloudflare Pages, S3 + CDN, ...).
3. Run the lobby with the static origin allowed:

   ```sh
   ALLOWED_ORIGINS=https://jackid.example.com PORT=8787 npm run server
   ```

4. Put the lobby behind TLS (Render, Fly, or Caddy/nginx on a VPS). Caddy example:

   ```
   lobby.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

   Caddy and nginx both proxy WebSocket upgrades on `/lobby` without extra config in Caddy.
   For nginx add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`.

Without `VITE_LOBBY_URL` the client uses `location.host + /lobby`, which is correct only when the
static files and the lobby share one origin (the one-box setup).

## 3. Local development

```sh
npm run server     # lobby on :8787 (WS /lobby, API /api)
npm run dev        # Vite on :5173, proxies /lobby and /api to :8787
```

Friends on the same LAN open `http://<your-ip>:5173`. For a production-like check use
`npm run build && npm run server` and open `http://localhost:8787`.

## 4. TURN (for players behind strict NAT)

WebRTC uses STUN by default. Some networks (symmetric NAT, corporate or mobile CGNAT) need a TURN
relay. Set `ICE_SERVERS` to a JSON array. The server forwards it to each client in `welcome`:

```sh
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.example.com:3478","turns:turn.example.com:5349?transport=tcp"],"username":"<user>","credential":"<secret>"}]'
```

* Anything in `ICE_SERVERS` reaches every browser that joins a room. Use **short-lived** TURN
  credentials (for example coturn's time-limited REST secret), not a permanent password.
* If WebRTC still fails, the client falls back to the WS relay on the lobby (`relay` op), which
  needs no TURN but adds latency. Keep the lobby close to your players.
* Cheapest TURN: run coturn on the same VPS as the lobby, or use a managed TURN provider.

If the lobby is unreachable, clients fall back to Trystero GLOBAL P2P (DECISIONS C3). No server
action is needed for that.

## 5. Operations notes

* Limits (in code): 500 rooms, 2 000 sockets, 64 KB per message, 120 messages/s per socket
  (sustained 5 s over the limit closes the socket with 1008), 6 room creations/min and
  30 joins/min per socket.
* Rooms expire 15 s after the host stops heartbeating (`hb` every 5 s). A host socket that closes
  closes its room immediately.
* The server pings sockets every 20 s and drops dead ones.
* SIGTERM/SIGINT close sockets with 1001 and exit within 3 s.
* Logs: one start line, plus an `[lobby] op failed` line for unexpected errors.
* Single instance only. Scaling out needs sticky routing and shared state, which is out of scope for v1.0.
