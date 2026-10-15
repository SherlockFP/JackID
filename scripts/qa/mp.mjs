// Multiplayer smoke: one lobby server, one Vite dev server and two headless Chrome profiles (host and client).
//   node scripts/qa/mp.mjs [--net relay|webrtc] [--shots <dir>]
// Host (profile A): net.host() on the lobby server, lobby screen, F4 starts the run. Client (profile B): net.join()
// by the room code, lobby screen, follows the start. Both reach the pit. The client seats at the first unlocked
// machine (world.occupy, the same request as E), presses Space, and the host checks its own copy of the machine.
// Output: one JSON object on stdout (steps, errors, what the host saw). Every process it started is stopped and its
// temp profile removed. It never touches other Chrome or Node processes. Notes: docs/MP_SMOKE.md.
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect as tcpConnect } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WIN = process.platform === 'win32';
const READY_MS = 120_000;
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const NET = flag('--net');     // optional ?net= transport, on both pages
const SHOTS = flag('--shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[mp] ${a.join(' ')}\n`);

/** A free loopback TCP port (bound, then released). */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

/** True when something accepts connections on 127.0.0.1:port. */
function portOpen(port) {
  return new Promise((res) => {
    const s = tcpConnect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// ── CDP client (same shape as scripts/qa/bench.mjs) ────────────────────────────────────────────────────────
class Cdp {
  constructor(url) { this.url = url; this.nextId = 0; this.pending = new Map(); this.handlers = new Set(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('CDP websocket failed to open'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { res, rej, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result ?? {});
      } else if (msg.method) {
        for (const h of this.handlers) h(msg.method, msg.params ?? {});
      }
    };
  }
  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { res, rej, timer });
    });
  }
  on(fn) { this.handlers.add(fn); }
  close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

// Key codes this smoke presses (KeyboardEvent.code, key, Windows virtual-key code).
const KEYS = { Space: [' ', 32], F4: ['F4', 115] };
async function press(cdp, code, ms = 120) {
  const [key, vk] = KEYS[code];
  const p = { code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
  await sleep(ms);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
}

/** A real left click at (x, y) in CSS pixels (the 1280x720 viewport). */
async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

/** Evaluates `expr` (may use await) and returns its JSON value (null when undefined). */
async function evalJson(cdp, expr) {
  const out = await evaluate(cdp, `(async () => JSON.stringify((await (\n${expr}\n))) ?? 'null')()`);
  return JSON.parse(out);
}

const STATE_JS = `(() => { const s = window.jackid.state(); return typeof s === 'string' ? s : (s && (s.name ?? s.id ?? s.kind)) ?? JSON.stringify(s); })()`;

// ── one headless page ──────────────────────────────────────────────────────────────────────────────────────
class Page {
  constructor(label) {
    this.label = label; this.errors = []; this.consoleErrors = 0; this.loads = 0; this.reloads = 0;
    this.proc = null; this.profile = null; this.cdp = null; this.port = 0;
  }
  async launch(url) {
    this.port = await freePort();
    this.profile = mkdtempSync(join(tmpdir(), `jackid-mp-${this.label}-`));
    this.proc = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${this.port}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${this.profile}`, '--mute-audio', '--window-size=1280,720',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    this.proc.on('error', (e) => this.note(`chrome spawn: ${e.message}`));
    const page = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 30_000, `${this.label} chrome debugging endpoint`);
    this.cdp = new Cdp(page.webSocketDebuggerUrl);
    await this.cdp.open();
    this.cdp.on((method, p) => {
      if (method === 'Page.frameNavigated' && !p.frame?.parentId) { this.loads++; if (this.loads > 1) this.reloads = this.loads - 1; }
      let text = null;
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      else if (method === 'Runtime.exceptionThrown') text = p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception';
      else if (method === 'Log.entryAdded' && p.entry?.level === 'error') text = p.entry.url ? `${p.entry.text} ${p.entry.url}` : p.entry.text;
      if (text !== null) this.note(text);
    });
    for (const m of ['Runtime.enable', 'Log.enable', 'Page.enable']) await this.cdp.send(m);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await this.cdp.send('Page.navigate', { url });
  }
  note(text) {
    if (/favicon\.ico/.test(text) && /404/.test(text)) return;   // the dev server has no favicon
    this.consoleErrors++;
    if (this.errors.length < 30) this.errors.push(text.slice(0, 300));
  }
  js(expr) { return evalJson(this.cdp, expr); }
  state() { return evaluate(this.cdp, STATE_JS); }
  async shot(name) {
    if (!SHOTS) return null;
    mkdirSync(SHOTS, { recursive: true });
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(SHOTS, `${this.label}-${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async stop() {
    try { this.cdp?.close(); } catch { /* ignore */ }
    killTree(this.proc);
    await sleep(300);
    if (this.profile) { try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* chrome may still hold a file */ } }
  }
}

/** Clicks the boot veil (a real mouse press) until the game leaves 'boot' for the menu. */
async function bootToMenu(p) {
  await waitFor(() => evaluate(p.cdp, 'typeof window.jackid === "object"'), READY_MS, `${p.label} window.jackid`);
  const t0 = Date.now();
  for (;;) {
    const st = await p.state();
    if (st && st !== 'boot') return st;
    if (Date.now() - t0 > 60_000) throw new Error(`${p.label}: still in boot after 60 s`);
    await clickAt(p.cdp, 640, 360);
    await sleep(800);
  }
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────
const R = {
  net: NET ?? 'default', ok: false, error: null, steps: [], room: null, lobbyRoomListed: null,
  pit: {}, seat: {}, host: {}, client: {}, errors: {}, cleanup: {},
};
let lobby = null, vite = null, host = null, client = null, stopping = false;
const onExit = () => { stopping = true; killTree(host?.proc); killTree(client?.proc); killTree(vite); killTree(lobby); };
process.once('exit', onExit);

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    R.steps.push({ step: name, ok: true, ms: Date.now() - t0, ...(out === undefined ? {} : { out }) });
    log(`ok   ${name}`);
    return out;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    R.steps.push({ step: name, ok: false, ms: Date.now() - t0, error });
    log(`FAIL ${name}: ${error}`);
    throw e;
  }
}

const APP = 'window.jackid.app';

async function run() {
  const lobbyPort = await freePort();
  const vitePort = await freePort();
  R.lobbyPort = lobbyPort; R.vitePort = vitePort;
  const base = `http://127.0.0.1:${vitePort}/${NET ? `?net=${NET}` : ''}`;

  await step('lobby server up (npm run server, own port)', async () => {
    lobby = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
      cwd: ROOT, env: { ...process.env, PORT: String(lobbyPort), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    lobby.stdout.on('data', (d) => { R.serverLog = String(d).trim().slice(0, 200); });
    lobby.stderr.on('data', (d) => { R.serverErr = String(d).trim().slice(0, 300); });
    lobby.on('exit', (code) => { if (!stopping) R.serverExit = code; });
    const h = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${lobbyPort}/api/health`);
      return r.ok ? r.json() : null;
    }, 20_000, 'lobby /api/health');
    return { port: lobbyPort, health: h };
  });

  await step('vite dev server up (lobby proxy -> that port)', async () => {
    vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config', join(ROOT, 'scripts', 'qa', 'vite.mp.config.mjs'),
      '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    { cwd: ROOT, env: { ...process.env, QA_MP_LOBBY_PORT: String(lobbyPort) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    vite.on('exit', (code) => { if (code && !stopping) R.viteExit = code; });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${vitePort}/`)).ok, READY_MS, 'vite');
    return { port: vitePort };
  });

  host = new Page('host');
  client = new Page('client');
  await step('host chrome: boot to menu', async () => {
    await host.launch(base);
    return { state: await bootToMenu(host) };
  });
  await step('client chrome: boot to menu', async () => {
    await client.launch(base);
    return { state: await bootToMenu(client) };
  });

  const created = await step('host: net.host() creates the room on the lobby server', async () => {
    const r = await host.js(`${APP}.net.host({ name: 'QA SMOKE', mode: 'coop', max: 4, public: true, lateJoin: true })
      .then((x) => ({ id: x.id, name: x.name, mode: x.mode, max: x.max }))`);
    if (!r?.id) throw new Error(`no room id from net.host(): ${JSON.stringify(r)}`);
    return r;
  });
  R.room = created.id;

  await step('lobby REST lists the room (GET /api/rooms)', async () => {
    const list = await (await fetch(`http://127.0.0.1:${lobbyPort}/api/rooms`)).json();
    const rooms = Array.isArray(list) ? list : (list.rooms ?? []);
    const hit = rooms.find((x) => x.id === created.id);
    R.lobbyRoomListed = Boolean(hit);
    if (!hit) throw new Error(`room ${created.id} not in /api/rooms (${rooms.length} listed)`);
    return { listed: rooms.length };
  });

  await step('host: lobby screen (role host)', async () => {
    await host.js(`(async () => { await ${APP}.go('lobby', { role: 'host' }); return true; })()`);
    await waitFor(async () => (await host.state()) === 'lobby', 15_000, 'host lobby state');
    return { state: 'lobby' };
  });

  await step('client: net.join() by room code, then lobby screen', async () => {
    const r = await client.js(`(async () => {
      await ${APP}.net.join({ via: 'server', roomId: ${JSON.stringify(created.id)} }, {});
      await ${APP}.go('lobby', { role: 'client' });
      return { room: ${APP}.net.room?.id ?? null, mode: ${APP}.net.mode, selfId: ${APP}.net.selfId };
    })()`);
    R.client.join = r;
    return r;
  });

  await step('host sees 2 players in the room', async () => {
    const t0 = Date.now();
    for (;;) {
      const n = await host.js(`${APP}.net.players.size`);
      if (n >= 2) return { players: n };
      if (Date.now() - t0 > 20_000) throw new Error(`host sees ${n} player(s) after 20 s`);
      await sleep(300);
    }
  });

  await shotBoth('lobby');

  await step('host: F4 starts the run (lobby lever)', async () => {
    await host.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'F4', key: 'F4', windowsVirtualKeyCode: 115 });
    await host.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F4', key: 'F4', windowsVirtualKeyCode: 115 });
    return true;
  });
  await step('both pages reach the pit (state ingame)', async () => {
    const t0 = Date.now();
    const hs = await waitFor(async () => (await host.state()) === 'ingame' && 'ok', READY_MS, 'host ingame');
    const cs = await waitFor(async () => (await client.state()) === 'ingame' && 'ok', READY_MS, 'client ingame');
    return { host: hs, client: cs, ms: Date.now() - t0 };
  });

  await shotBoth('pit');
  const pitSnap = `(() => { const a = window.jackid.app; const w = a.world; return {
      isHost: a.net.isHost, selfId: a.net.selfId, players: a.net.players.size, world: Boolean(w),
      machines: w ? w.machines().length : 0, unlocked: w ? w.machines().filter((m) => !m.locked).length : 0,
      seatPhase: w ? w.seatPhase : null }; })()`;
  R.pit.host = await host.js(pitSnap);
  R.pit.client = await client.js(pitSnap);

  // The host records what reaches it, then the client seats and plays.
  await host.js(`(() => {
    const a = window.jackid.app;
    window.__mp = { mev: [] };
    a.net.on('mev', (m, from) => window.__mp.mev.push({ from, e: JSON.stringify(m.e ?? m).slice(0, 160) }));
    return true;
  })()`);
  await client.js(`(() => {
    const a = window.jackid.app;
    window.__mp = { moccOk: [], moccNo: [] };
    a.net.on('moccOk', (m) => window.__mp.moccOk.push(m.mid));
    a.net.on('moccNo', (m) => window.__mp.moccNo.push(m.reason));
    return true;
  })()`);

  const pick = await step('client: pick an unlocked machine', async () => {
    const m = await client.js(`(() => {
      const x = window.jackid.app.world.machines().find((k) => !k.locked);
      return x ? { id: x.id, kind: x.def?.id ?? x.machineId ?? null } : null;
    })()`);
    if (!m) throw new Error('no unlocked machine in the pit');
    return m;
  });
  R.seat.machine = pick;

  await step('client: occupy the machine (world.occupy = the E request)', async () => {
    await client.js(`(() => { window.jackid.app.world.occupy(${JSON.stringify(pick.id)}); return true; })()`);
    const t0 = Date.now();
    for (;;) {
      const p = await client.js(`window.jackid.app.world.seatPhase`);
      if (p === 'seated') { R.seat.clientPhase = p; return { phase: p }; }
      const no = await client.js(`window.__mp.moccNo`);
      if (no?.length) throw new Error(`host refused the seat: ${no.join(', ')}`);
      if (Date.now() - t0 > 15_000) throw new Error(`client seat phase is '${p}' after 15 s (no moccOk or moccNo)`);
      await sleep(250);
    }
  });

  await step('client: plays (Space x3)', async () => {
    for (let i = 0; i < 3; i++) { await press(client.cdp, 'Space', 120); await sleep(2000); }
    return true;
  });

  await step('host: sees the play (its copy of the machine + received envelopes)', async () => {
    const seen = await waitFor(async () => {
      const n = await host.js(`window.__mp.mev.length`);
      return n > 0 ? n : null;
    }, 10_000, 'mev on host').catch(() => 0);
    const mine = await host.js(`(() => { const m = window.jackid.app.world.machine(${JSON.stringify(pick.id)}); return m ? { seats: m.seats.slice(), locked: m.locked } : null; })()`);
    const clientId = await client.js(`window.jackid.app.net.selfId`);
    const seatedHere = Boolean(mine?.seats?.includes(clientId));
    R.seat.host = { mevCount: seen, sample: await host.js(`window.__mp.mev.slice(-2)`), machine: mine, clientId, seatedHere };
    if (!seatedHere) throw new Error(`host copy of ${pick.id} does not show the client seated (seats ${JSON.stringify(mine?.seats)})`);
    return { mevCount: seen, seatedHere };
  });
  await shotBoth('seated');

  await step('client: stands up; host copy is freed', async () => {
    await client.js(`(() => { window.jackid.app.world.standUp(); return true; })()`);
    await waitFor(async () => (await client.js(`window.jackid.app.world.seatPhase`)) === 'free', 10_000, 'client free');
    const freed = await waitFor(async () => {
      const m = await host.js(`(() => { const x = window.jackid.app.world.machine(${JSON.stringify(pick.id)}); return x ? x.seats.includes(${JSON.stringify(R.seat.host.clientId)}) : false; })()`);
      return m === false;
    }, 8_000, 'host copy freed').catch(() => false);
    return { hostFreed: freed };
  });

  R.ok = R.steps.every((s) => s.ok);
}

async function shotBoth(name) {
  if (!SHOTS) return;
  const files = [];
  for (const p of [host, client]) if (p?.cdp) files.push(await p.shot(name));
  R.steps.push({ step: `screenshots: ${name}`, ok: true, ms: 0, out: files });
}

try {
  await run();
} catch (e) {
  R.error = e instanceof Error ? e.message : String(e);
} finally {
  for (const [k, p] of [['host', host], ['client', client]]) {
    if (!p) continue;
    R.errors[k] = { count: p.consoleErrors, first: p.errors, reloads: p.reloads };
    if (p.cdp) {
      try {
        const extra = await p.js(`(() => { const l = window.jackid.logs?.() ?? []; return l.filter((x) => /net|join|relay|rtc|lobby/i.test(JSON.stringify(x))).slice(-4).map((x) => JSON.stringify(x).slice(0, 200)); })()`);
        R.errors[k].netLog = extra;
      } catch { /* page gone */ }
    }
    await p.stop();
  }
  killTree(vite);
  killTree(lobby);
  await sleep(500);
  R.cleanup = {
    chrome: 'stopped', vite: vite ? 'stopped' : 'not started', server: lobby ? 'stopped' : 'not started',
    profiles: 'removed',
    ports: { lobby: (await portOpen(R.lobbyPort)) ? 'STILL OPEN' : 'freed', vite: (await portOpen(R.vitePort)) ? 'STILL OPEN' : 'freed' },
  };
  if (R.error) R.ok = false;
  process.stdout.write(`${JSON.stringify(R, null, 2)}\n`);
  process.exitCode = R.ok ? 0 : 1;
}
