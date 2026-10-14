#!/usr/bin/env node
/**
 * QA bench: drives a single-machine bench room (`/?bench=<id>`) in headless Chrome over the DevTools protocol.
 * Zero dependencies: Node >= 22 (global WebSocket) and Node built-ins only. Usage: scripts/qa/README.md.
 *
 *   node scripts/qa/bench.mjs --machine bigone --script "Space:150,wait:3000" --rounds 3 --shots <dir>
 *
 * Starts its own Vite dev server and its own Chrome, each on a free port (Chrome also gets a temp profile), and
 * stops both on exit. It never touches processes it did not start.
 */
import { spawn, spawnSync } from 'node:child_process';
import { connect as netConnect, createServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_HOLD_MS = 80;
const READY_TIMEOUT_MS = 120_000;
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[qa] ${a.join(' ')}\n`);

/** A free loopback TCP port (bound, then released). */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/** True when something accepts connections on 127.0.0.1:port. Used to confirm our servers are really gone. */
function portOpen(port) {
  return new Promise((res) => {
    const s = netConnect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
}

// ── key tokens ─────────────────────────────────────────────────────────────────────────────────────────────
const NAMED = {
  Space: 32, Enter: 13, Escape: 27, Tab: 9, Backspace: 8,
  ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};
/** {code, key, vk} for a `KeyboardEvent.code` name (Space, Enter, KeyX, Digit1, ArrowLeft …). Throws if unknown. */
export function keyInfo(code) {
  if (code in NAMED) {
    const key = code === 'Space' ? ' ' : code.replace(/^Arrow/, '').replace(/(Left|Right)$/, '');
    return { code, key: code.startsWith('Arrow') ? code : key, vk: NAMED[code] };
  }
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return { code, key: m[1].toLowerCase(), vk: m[1].charCodeAt(0) };
  m = /^Digit([0-9])$/.exec(code);
  if (m) return { code, key: m[1], vk: 48 + Number(m[1]) };
  throw new Error(`unknown key code "${code}" (use e.g. Space, Enter, KeyX, Digit1, ArrowLeft)`);
}

/**
 * Parses a script such as "Space:200,wait:1500,KeyX,Space". Tokens: `Code` (held 80 ms), `Code:ms` (held ms),
 * `wait:ms`. Separated by commas; a stray trailing `>` is ignored.
 */
export function parseScript(text) {
  const steps = [];
  for (const raw of String(text ?? '').split(',')) {
    const tok = raw.trim().replace(/>$/, '').trim();
    if (!tok) continue;
    const [name, ms] = tok.split(':');
    const n = ms === undefined ? undefined : Number(ms);
    if (ms !== undefined && (!Number.isFinite(n) || n < 0)) throw new Error(`bad duration in "${tok}"`);
    if (name === 'wait') {
      if (n === undefined) throw new Error('wait needs a duration, e.g. wait:1500');
      steps.push({ kind: 'wait', ms: n });
    } else {
      keyInfo(name);                                  // validate before any process is started
      steps.push({ kind: 'key', code: name, ms: n ?? DEFAULT_HOLD_MS });
    }
  }
  return steps;
}

// ── process lifecycle ──────────────────────────────────────────────────────────────────────────────────────
/** Kills a process we started, and on Windows its whole tree (Chrome spawns helpers). */
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

// ── CDP client ─────────────────────────────────────────────────────────────────────────────────────────────
class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Set();
  }
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

/** Presses one key (KeyboardEvent.code) and holds it `ms`, as a real keyboard would. */
async function pressKey(cdp, code, ms) {
  const k = keyInfo(code);
  const params = { code: k.code, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
  await sleep(ms);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

/** Evaluates `expr` in the page and returns its JSON-able value. */
async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Runs `script` (see parseScript) `rounds` times against machine `machine` in a fresh bench room. Each round is one
 * pass of the script, followed by a screenshot when `shots` is set.
 * @returns {Promise<{machine:string, seed:number, rounds:number, roundLog:object[], consoleErrors:number,
 *   errors:string[], shots:string[], state:string, framesPerSec:number, cleanup:object}>}
 */
export async function runBench(opts = {}) {
  const machine = String(opts.machine ?? '');
  if (!/^[a-z][a-z0-9_]*$/.test(machine)) throw new Error('machine id required, e.g. "bigone"');
  const steps = parseScript(opts.script ?? (opts.walkView ? 'KeyW:400,wait:600' : 'wait:1000'));
  const rounds = Math.max(1, Math.floor(Number(opts.rounds ?? 1)));
  const seed = Math.floor(Number(opts.seed ?? 1));
  const shotsDir = opts.shots ? resolve(opts.shots) : null;
  const sit = Boolean(opts.sit);
  const walkView = Boolean(opts.walkView);
  const seat = opts.seat === undefined ? undefined : Math.floor(Number(opts.seat));
  const settle = opts.settle === undefined ? 4000 : Math.max(0, Math.floor(Number(opts.settle)));   // ms after sitting
  if (sit && walkView) throw new Error('--sit and --walk-view are different modes; pick one');
  if (walkView && !shotsDir) throw new Error('--walk-view writes its screenshot: pass --shots <dir>');
  if (seat !== undefined && !(seat >= 0)) throw new Error('--seat needs a seat index, e.g. 2');
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const res = {
    machine, seed, rounds: 0, roundLog: [], consoleErrors: 0, errors: [], shots: [], state: '', framesPerSec: 0,
    mode: sit ? 'sit' : walkView ? 'walk-view' : 'walk', seated: false, playerMode: '', walkShot: null,
    cleanup: { vite: 'not started', chrome: 'not started', profile: 'not created', ports: 'n/a' },
  };
  let vite = null, chrome = null, cdp = null, profile = null, vport = 0, dport = 0, stopping = false;
  const onExit = () => { stopping = true; try { cdp?.close(); } catch { /* */ } killTree(chrome); killTree(vite); };
  process.once('exit', onExit);
  try {
    // 1) Vite dev server on a free port.
    vport = await freePort();
    vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1', '--port', String(vport), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const viteTail = [];
    const keep = (d) => { viteTail.push(String(d)); if (viteTail.length > 100) viteTail.shift(); };
    vite.stdout.on('data', keep);
    vite.stderr.on('data', keep);
    vite.on('exit', (code) => { if (code && !stopping) res.errors.push(`vite exited with code ${code}`); });
    log(`vite on :${vport}`);
    await waitFor(async () => (await fetch(`http://127.0.0.1:${vport}/`)).ok, READY_TIMEOUT_MS, 'vite');

    // 2) Headless Chrome: free debugging port, temp profile, 1280x720.
    dport = await freePort();
    profile = mkdtempSync(join(tmpdir(), 'jackid-qa-'));
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, '--mute-audio', '--window-size=1280,720',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    chrome.on('error', (e) => res.errors.push(`chrome spawn: ${e.message}`));
    log(`chrome debugging on :${dport}`);
    const page = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 30_000, 'chrome debugging endpoint');
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    cdp.on((method, p) => {
      let text = null;
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      else if (method === 'Runtime.exceptionThrown') text = p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception';
      else if (method === 'Log.entryAdded' && p.entry?.level === 'error') text = p.entry.url ? `${p.entry.text} ${p.entry.url}` : p.entry.text;
      if (text === null) return;
      if (/favicon\.ico/.test(text) && /404/.test(text)) return;   // the dev server has no favicon: not a game error
      res.consoleErrors++;
      if (res.errors.length < 50) res.errors.push(text);
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    // 3) Bench room: boot veil (Enter), then the game is on screen and rAF is advancing.
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${vport}/?bench=${machine}&seed=${seed}` });
    await waitFor(() => evaluate(cdp, 'typeof window.jackid === "object"'), READY_TIMEOUT_MS, 'window.jackid');
    await evaluate(cdp, 'window.__qaFrames = 0; (function f() { window.__qaFrames++; requestAnimationFrame(f); })(); true');
    const stateOf = () => evaluate(cdp, 'String((() => { const s = window.jackid.state(); return typeof s === "string" ? s : (s && (s.name ?? s.id ?? s.kind)) ?? JSON.stringify(s); })())');
    // The veil appears after boot and takes Enter; keep pressing it until the room has started.
    const enterVeil = async () => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    };
    await waitFor(async () => { await enterVeil(); await sleep(700); return (await stateOf()).includes('ingame'); }, READY_TIMEOUT_MS, 'ingame state')
      .catch(async (e) => { throw new Error(`${e.message} (state: ${await stateOf().catch(() => '?')})`); });
    await sleep(1500);                                   // room settles: camera, first frames
    const f0 = await evaluate(cdp, 'window.__qaFrames');
    await sleep(1000);
    const f1 = await evaluate(cdp, 'window.__qaFrames');
    res.framesPerSec = f1 - f0;
    if (res.framesPerSec <= 0) throw new Error('rendering did not advance (rAF frames stalled)');
    res.state = await stateOf();
    log(`in game (${res.state}), ${res.framesPerSec} fps`);

    const shoot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const path = join(shotsDir, name);
      writeFileSync(path, Buffer.from(data, 'base64'));
      res.shots.push(path);
      return path;
    };
    // Debug bench hook (DEV only, src/world/bench.ts): wallet and wagered come from the bench run.
    const money = async () => JSON.parse(await evaluate(cdp, 'JSON.stringify({ wallet: window.jackid.bench.run.wallet(), '
      + 'wagered: window.jackid.bench.run.stats.wagered, rounds: window.jackid.bench.run.stats.rounds })'));

    // 3b) --sit: seat the player through the bench hook (the E key path needs a walk to the machine; this does not),
    //     then the script's keys go to the machine. Proof of the seat: sat + input mode "machine".
    if (sit) {
      await waitFor(() => evaluate(cdp, 'Boolean(window.jackid.bench && window.jackid.bench.main)'), 30_000, 'bench hook');
      const ok = await evaluate(cdp, `window.jackid.bench.sit(${seat === undefined ? '' : seat})`);
      if (ok !== true) throw new Error('sit(): the player did not sit down (no free seat, or the seat is taken)');
      await sleep(1200 + settle);                        // glide to the seat, then the table reaches its OPEN phase
      res.seated = await evaluate(cdp, 'window.jackid.bench.seated === true');
      const inputMode = await evaluate(cdp, 'window.jackid.app.input.mode');
      if (!res.seated || inputMode !== 'machine') throw new Error(`seated=${res.seated}, input mode "${inputMode}" (want "machine")`);
      // The FIRST-SIT tip is a placard: the next machine action only closes it (seatHud.blocking), so it would eat
      // the script's first key. Digit9 is the neutral press that closes it; it is sent only while the placard is up.
      if (await evaluate(cdp, 'Boolean(window.jackid.bench.main?.m?.seatHud?.blocking)')) {
        await pressKey(cdp, 'Digit9', DEFAULT_HOLD_MS);
        await sleep(600);
        log('first-sit tip closed (Digit9)');
      }
      log(`seated (input mode ${inputMode})`);
    }

    // 4) Rounds: one pass of the script per round, then a screenshot. With --sit, the wallet and wagered are read
    //    before and after each pass.
    for (let r = 1; r <= rounds; r++) {
      const before = await evaluate(cdp, 'window.__qaFrames');
      const m0 = sit ? await money() : null;
      const t0 = Date.now();
      for (const s of steps) {
        if (s.kind === 'wait') { await sleep(s.ms); continue; }
        await pressKey(cdp, s.code, s.ms);
      }
      const entry = { round: r, ms: Date.now() - t0, frames: (await evaluate(cdp, 'window.__qaFrames')) - before };
      if (sit) {
        const m1 = await money();
        entry.wallet = [m0.wallet, m1.wallet];
        entry.wagered = [m0.wagered, m1.wagered];
      }
      if (shotsDir) {
        entry.shot = await shoot(`${machine}-round${r}.png`);
      }
      res.roundLog.push(entry);
      res.rounds = r;
      log(`round ${r}/${rounds}: ${entry.ms} ms, ${entry.frames} frames`);
    }

    // 5) --walk-view: the player is on foot (no sit). Keys have been pressed; screenshot the first-person view.
    if (walkView) {
      await sleep(600);                                  // let the last key's motion and the camera settle
      res.playerMode = await evaluate(cdp, 'window.jackid.bench.player.mode');
      res.walkShot = await shoot(`${machine}-walk.png`);
      log(`walk view (player mode ${res.playerMode}) -> ${res.walkShot}`);
    }
  } finally {
    // 5) Cleanup: everything we started, nothing else.
    stopping = true;
    try { cdp?.close(); } catch { /* */ }
    killTree(chrome);
    killTree(vite);
    if (chrome) await waitFor(async () => chrome.exitCode !== null || chrome.signalCode !== null, 10_000, 'chrome exit').catch(() => {});
    res.cleanup.chrome = chrome ? (chrome.exitCode !== null || chrome.signalCode !== null ? 'stopped' : 'kill sent') : 'not started';
    res.cleanup.vite = vite ? 'stopped' : 'not started';
    if (vport && dport) {
      const busy = [await portOpen(vport), await portOpen(dport)];
      res.cleanup.ports = busy.some(Boolean) ? `still open: vite ${busy[0]}, chrome ${busy[1]}` : 'freed';
    }
    if (profile) {
      res.cleanup.profile = 'left behind';
      for (let i = 0; i < 10; i++) {
        try { rmSync(profile, { recursive: true, force: true }); res.cleanup.profile = 'removed'; break; } catch { await sleep(300); }
      }
    }
    process.removeListener('exit', onExit);
  }
  return res;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────
const USAGE = 'usage: node scripts/qa/bench.mjs --machine <id> [--script "Space:200,wait:1500,KeyX"] [--shots <dir>] '
  + '[--rounds <n>] [--seed <n>] [--sit [--seat <n>]] [--walk-view]';

function parseArgs(argv) {
  const o = {};
  const flags = { '--machine': 'machine', '--script': 'script', '--shots': 'shots', '--rounds': 'rounds', '--seed': 'seed', '--seat': 'seat', '--settle': 'settle' };
  const switches = { '--sit': 'sit', '--walk-view': 'walkView' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a in switches) { o[switches[a]] = true; continue; }
    if (!(a in flags)) throw new Error(`unknown argument ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    o[flags[a]] = v;
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (async () => {
    let code = 0;
    try {
      const o = parseArgs(process.argv.slice(2));
      if (o.help || !o.machine) { process.stderr.write(USAGE + '\n'); process.exit(o.help ? 0 : 2); }
      const result = await runBench(o);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (e) {
      code = 1;
      process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }, null, 2) + '\n');
    }
    process.exit(code);
  })();
}
