#!/usr/bin/env node
/**
 * QA bench: drives a single-machine bench room (`/?bench=<id>`) in headless Chrome over the DevTools protocol.
 * Zero dependencies: Node >= 22 (global WebSocket) and Node built-ins only. Usage: scripts/qa/README.md.
 *
 *   node scripts/qa/bench.mjs --machine bigone --script "Space:150,wait:3000" --rounds 3 --shots <dir>
 *   node scripts/qa/bench.mjs --world --seed 7 --js "<expr>" --probe "<expr>" --frames "300,1200" --shots <dir>
 *   node scripts/qa/bench.mjs --run "goto:coinflip;play:Space:150x3;state" --seed 1 --shots <dir>   (debt-run driver)
 *
 * The boot veil is passed with a real mouse click (main.ts enters on a click, or on Enter/Space once the veil has focus).
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

/**
 * `--run "<steps>"`: a real debt run's steps, separated by `;` (commas stay inside a play step, so its keys use the
 * parseScript list syntax). Steps (see scripts/qa/README.md, "Debt-run driver"):
 *   goto:<machineId>   teleport in front of the floor machine, face it, press E (devtools occupy as the fallback)
 *   play:<keys>xN      press the keys (parseScript syntax, e.g. play:Space:150,wait:300x3), N times (default 1)
 *   stand              stand up from the seat
 *   bank:deposit:<n>   Debt Terminal deposit of n coins (run.deposit)
 *   lever              the terminal lever the run accepts now: OPEN THE FLOOR, else the Bell, else SETTLE
 *   pawn               one Pawn Window reroll (Intermission only)
 *   wait:<ms>          pause
 *   state              record pocket, bank, quota, night, watch, pulls, phase, seated (res.run.states)
 */
export function parseRunSteps(text) {
  const out = [];
  for (const raw of String(text ?? '').split(';')) {
    const tok = raw.trim();
    if (!tok) continue;
    if (['stand', 'lever', 'pawn', 'state'].includes(tok)) { out.push({ kind: tok, text: tok }); continue; }
    let m = /^goto:([a-z][a-z0-9_]*)$/.exec(tok);
    if (m) { out.push({ kind: 'goto', machine: m[1], text: tok }); continue; }
    m = /^bank:deposit:(\d+)$/.exec(tok);
    if (m) { out.push({ kind: 'deposit', amount: Number(m[1]), text: tok }); continue; }
    m = /^wait:(\d+)$/.exec(tok);
    if (m) { out.push({ kind: 'wait', ms: Number(m[1]), text: tok }); continue; }
    m = /^play:(.+?)(?:x(\d+))?$/.exec(tok);
    if (m) {
      const n = m[2] === undefined ? 1 : Number(m[2]);
      if (!(n >= 1)) throw new Error(`bad repeat in "${tok}" (play:<keys>xN, N >= 1)`);
      out.push({ kind: 'play', keys: parseScript(m[1]), n, text: tok });
      continue;
    }
    throw new Error(`bad --run step "${tok}" (goto:<id> | play:<keys>xN | stand | bank:deposit:<n> | lever | pawn | wait:<ms> | state)`);
  }
  if (!out.length) throw new Error('--run needs at least one step, e.g. "goto:coinflip;play:Space:150x3;state"');
  return out;
}

/** `--frames "300,1200"` → sorted, unique ms offsets after the last key. */
export function parseFrames(text) {
  if (text === undefined || text === null || String(text).trim() === '') return [];
  const out = String(text).split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad --frames value "${t}" (ms, e.g. "300,1200")`);
    return n;
  });
  return [...new Set(out)].sort((a, b) => a - b);
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

/** A real left click at (x, y) in CSS pixels (the 1280x720 viewport). */
async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

/** Resolves on the next rendered frame, so a screenshot taken after it shows the frame the game just drew. */
const nextFrame = (cdp) => evaluate(cdp, 'new Promise((r) => requestAnimationFrame(() => r(true)))');

/** Evaluates `expr` (may use `await`) in the page; the value comes back as JSON (null when undefined). */
async function evalJson(cdp, expr) {
  const out = await evaluate(cdp, `(async () => JSON.stringify((await (\n${expr}\n))) ?? 'null')()`);
  return JSON.parse(out);
}

/** Evaluates `expr` in the page and returns its JSON-able value. */
async function evaluate(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────
// ── --run: the debt-run driver ─────────────────────────────────────────────────────────────────────────────
/** Skips the story intro with real Space taps: one tap (80 ms, a tap not a hold) each 1.2 s once it has played that long. */
async function skipIntro(cdp) {
  const t0 = Date.now();
  let started = 0, lastTap = 0, taps = 0;
  for (;;) {
    const id = await evaluate(cdp, 'window.jackid.app.cutscene.playing ?? null');
    if (id === 'intro') {
      if (!started) started = Date.now();
      if (taps < 8 && Date.now() - started >= 1200 && Date.now() - lastTap >= 1200) {
        await pressKey(cdp, 'Space', DEFAULT_HOLD_MS);
        lastTap = Date.now();
        taps++;
      }
    } else if (started || Date.now() - t0 > 15_000) break;   // the intro is over (skipped or played out), or none came
    await sleep(120);
  }
  return { played: started > 0, taps };
}

/** Page JS: the debt run's state, for `state` and the step records. Watch and Night are 1-based. */
const RUN_STATE_JS = `(() => {
  const a = window.jackid.app, r = a.run, b = r.bank(), pulls = r.pulls();
  return {
    phase: r.shift.phase, night: r.night(), watch: typeof r.watch === 'number' ? r.watch + 1 : null,
    pocket: b.pocket, bank: b.balance, withdrawable: b.withdrawable, quotaDue: b.due, quotaLeft: b.left,
    pullsLeft: b.pullsLeft, pulls: Number.isFinite(pulls) ? pulls : null,
    over: r.over, seated: a.player?.seat?.mid ?? null, intro: a.cutscene.playing ?? null,
  };
})()`;

/**
 * Page JS: teleports the player in front of the first unlocked floor machine of `machineId` and faces it. The front is
 * the machine's +Z (rotY turns it), `0.9 m + its interact depth` out, the stand-up distance of the bench room.
 */
const goToJs = (machineId) => `(() => {
  const a = window.jackid.app, w = a.world, id = ${JSON.stringify(machineId)};
  if (!w || !a.player) return { ok: false, reason: 'no debt run on screen' };
  const m = w.machines().find((x) => x.def.id === id && !w.isLocked(x.id));
  if (!m) return { ok: false, reason: 'no unlocked "' + id + '" on the floor (not placed, or locked this Night)' };
  const slot = w.slot(m.id);
  const th = ((slot?.rotY ?? 0) * Math.PI) / 180;
  const d = 0.9 + (m.model?.interact?.max?.[2] ?? 0.5);
  const fx = slot.pos[0] + d * Math.sin(th), fz = slot.pos[2] + d * Math.cos(th);
  const v = a.camera.position.clone();
  v.set(fx, a.player.pos.y, fz);
  a.player.teleport(v, th);
  return { ok: true, instance: m.id, at: [Math.round(fx * 100) / 100, Math.round(fz * 100) / 100] };
})()`;

/** Runs the parsed --run steps against the debt run (see parseRunSteps). Each step is recorded in `run.steps`. */
async function driveRun(cdp, steps, run) {
  const seatedIs = (want, ms) => waitFor(async () => (await evaluate(cdp, 'window.jackid.app.player?.seat != null')) === want, ms, want ? 'a seat' : 'standing up');
  for (const s of steps) {
    const t0 = Date.now();
    const rec = { step: s.text, ok: true };
    switch (s.kind) {
      case 'goto': {
        if (await evaluate(cdp, 'window.jackid.app.player?.seat != null')) {
          await evaluate(cdp, '(window.jackid.app.world.standUp(), true)');
          await seatedIs(false, 4000).catch(() => { throw new Error(`goto:${s.machine}: could not stand up first`); });
        }
        const tp = await evalJson(cdp, goToJs(s.machine));
        if (!tp.ok) throw new Error(`goto:${s.machine}: ${tp.reason}`);
        await sleep(400);                                     // the interact focus follows the new view
        await pressKey(cdp, 'KeyE', DEFAULT_HOLD_MS);
        rec.via = 'E';
        try { await seatedIs(true, 2500); } catch {
          await evaluate(cdp, `(window.jackid.app.world.occupy(${JSON.stringify(tp.instance)}), true)`);   // devtools fallback
          rec.via = 'occupy';
          await seatedIs(true, 2500).catch(() => { throw new Error(`goto:${s.machine}: not seated (E and occupy both failed)`); });
        }
        rec.instance = tp.instance;
        rec.at = tp.at;
        break;
      }
      case 'play': {
        for (let i = 0; i < s.n; i++) {
          for (const k of s.keys) {
            if (k.kind === 'wait') { await sleep(k.ms); continue; }
            await pressKey(cdp, k.code, k.ms);
          }
        }
        rec.n = s.n;
        break;
      }
      case 'stand': {
        await evaluate(cdp, '(window.jackid.app.world.standUp(), true)');
        await seatedIs(false, 4000).catch(() => { rec.ok = false; rec.reason = 'still seated (the round may be settling)'; });
        break;
      }
      case 'deposit':
        rec.amount = s.amount;
        rec.ok = (await evaluate(cdp, `window.jackid.app.run.deposit(${s.amount}) === true`)) === true;
        if (!rec.ok) rec.reason = 'refused (pocket floor, quota room, or not a quota Watch)';
        break;
      case 'lever':
        rec.lever = await evaluate(cdp, `(() => { const r = window.jackid.app.run; return r.openFloor() ? 'openFloor'
          : r.startWatch() ? 'startWatch' : r.settleEarly() ? 'settleEarly' : null; })()`);
        rec.ok = rec.lever !== null;
        break;
      case 'pawn':
        rec.ok = (await evaluate(cdp, 'window.jackid.app.run.pawn.reroll() === true')) === true;
        break;
      case 'wait':
        await sleep(s.ms);
        break;
      case 'state': {
        const st = await evalJson(cdp, RUN_STATE_JS);
        run.states.push(st);
        rec.state = st;
        log(`state: ${JSON.stringify(st)}`);
        break;
      }
      default: throw new Error(`unknown run step ${s.kind}`);
    }
    rec.ms = Date.now() - t0;
    run.steps.push(rec);
    log(`run ${s.text}: ${rec.ok ? 'ok' : 'refused'} (${rec.ms} ms)`);
  }
}

/**
 * Runs `script` (see parseScript) `rounds` times against machine `machine` in a fresh bench room. Each round is one
 * pass of the script, followed by a screenshot when `shots` is set.
 * @returns {Promise<{machine:string, seed:number, rounds:number, roundLog:object[], consoleErrors:number,
 *   errors:string[], shots:string[], state:string, framesPerSec:number, cleanup:object}>}
 */
export async function runBench(opts = {}) {
  const runSteps = opts.run === undefined ? null : parseRunSteps(opts.run);   // --run: a debt run driven by steps
  const world = Boolean(opts.world) || runSteps !== null;   // a real debt run (`/?skipmenu=1`), not a bench room
  const machine = String(opts.machine ?? (world ? 'run' : ''));
  if (!/^[a-z][a-z0-9_]*$/.test(machine)) throw new Error('machine id required, e.g. "bigone" (or --world)');
  if (world && opts.sit) throw new Error('--sit needs a bench room (drop --world / --run)');
  if (runSteps && (opts.walkView || opts.frames || opts.force !== undefined)) throw new Error('--run takes its own steps: drop --walk-view, --frames, --force');
  const steps = parseScript(opts.script ?? (opts.walkView ? 'KeyW:400,wait:600' : 'wait:1000'));
  const rounds = Math.max(1, Math.floor(Number(opts.rounds ?? 1)));
  const seed = Math.floor(Number(opts.seed ?? 1));
  const shotsDir = opts.shots ? resolve(opts.shots) : null;
  const frames = parseFrames(opts.frames);
  if (frames.length && !shotsDir) throw new Error('--frames writes screenshots: pass --shots <dir>');
  const probe = opts.probe ? String(opts.probe) : null;   // JS, read after every round (recorded as roundLog[].probe)
  const before = opts.js ? String(opts.js) : null;        // JS, run once after the room settles, before the rounds
  const sit = Boolean(opts.sit);
  const force = opts.force === undefined ? null : String(opts.force).trim();   // "<machineId>:<state>", after --sit
  if (force !== null) {
    const fm = /^([a-z][a-z0-9_]*):(.+)$/.exec(force);
    if (!fm) throw new Error(`bad --force "${force}" (want "<machineId>:<state>", e.g. "bigone:win")`);
    if (fm[1] !== machine) throw new Error(`--force is for "${fm[1]}", but --machine is "${machine}"`);
    if (!sit) throw new Error('--force needs --sit (the machine must be seated first)');
  }
  const walkView = Boolean(opts.walkView);
  const seat = opts.seat === undefined ? undefined : Math.floor(Number(opts.seat));
  const settle = opts.settle === undefined ? 4000 : Math.max(0, Math.floor(Number(opts.settle)));   // ms after sitting
  if (sit && walkView) throw new Error('--sit and --walk-view are different modes; pick one');
  if (walkView && !shotsDir) throw new Error('--walk-view writes its screenshot: pass --shots <dir>');
  if (seat !== undefined && !(seat >= 0)) throw new Error('--seat needs a seat index, e.g. 2');
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const res = {
    machine, seed, rounds: 0, roundLog: [], consoleErrors: 0, errors: [], shots: [], state: '', framesPerSec: 0,
    mode: runSteps ? 'run' : sit ? 'sit' : walkView ? 'walk-view' : 'walk', seated: false, playerMode: '', walkShot: null,
    force: null, run: null, reloads: 0, viteEvents: [],          // page loads after the first one (the veil comes back): the run is then invalid
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
    const keep = (d) => {
      viteTail.push(String(d)); if (viteTail.length > 100) viteTail.shift();
      // a dependency re-optimisation or an HMR full reload restarts the page mid-run: say so (see `reloads`)
      for (const line of String(d).split(/\r?\n/)) {
        if (/optimi[sz]ed|reload|hmr/i.test(line)) { res.viteEvents.push(line.trim()); log(`vite: ${line.trim()}`); }
      }
    };
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
    let loads = 0;
    cdp.on((method, p) => {
      if (method === 'Page.frameNavigated' && !p.frame?.parentId) { loads++; if (loads > 1) res.reloads = loads - 1; }
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
    const url = world ? `/?skipmenu=1&seed=${seed}` : `/?bench=${machine}&seed=${seed}`;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${vport}${url}` });
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
    if (runSteps) {                                       // --run: the intro is skipped with a Space tap before any step
      res.run = { intro: await skipIntro(cdp), steps: [], states: [], shot: null };
      log(`intro: played ${res.run.intro.played}, Space taps ${res.run.intro.taps}`);
    }

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

    // 3c) --js: once, before the rounds (e.g. a devtools-only reveal). Its JSON value is `before`.
    if (before !== null) {
      res.before = await evalJson(cdp, before);
      log(`before: ${JSON.stringify(res.before)}`);
      await sleep(400);
    }

    // 3d) --force "<machineId>:<state>": once, after the seat and --js, before the rounds. The bench hook puts the seated
    //     machine into <state> (registry handler, else debugForce). Recorded as `force`; ok:false fails the run.
    if (force !== null) {
      const fr = await evalJson(cdp, `window.jackid.bench.force(${JSON.stringify(force)})`);
      res.force = fr;
      if (!fr?.ok) throw new Error(`--force "${force}" failed: ${fr?.reason ?? 'no reason given'}`);
      log(`forced ${force} (via ${fr.via})`);
      await sleep(400);
    }

    // 3e) --run: the debt-run steps (no rounds). The final screenshot is run-final.png.
    if (runSteps) {
      await driveRun(cdp, runSteps, res.run);
      if (shotsDir) res.run.shot = await shoot('run-final.png');
    }

    // 4) Rounds: one pass of the script per round, then a screenshot. With --sit, the wallet and wagered are read
    //    before and after each pass.
    for (let r = 1; r <= (runSteps ? 0 : rounds); r++) {
      const before = await evaluate(cdp, 'window.__qaFrames');
      const m0 = sit ? await money() : null;
      const t0 = Date.now();
      let lastKeyUp = t0;
      // With --frames, the waits after the last key are the frame timeline (see below), so they are not slept here.
      const lastKey = steps.reduce((acc, s, i) => (s.kind === 'key' ? i : acc), -1);
      const trailing = frames.length ? steps.slice(lastKey + 1).reduce((a, s) => a + s.ms, 0) : 0;
      for (const [i, s] of steps.entries()) {
        if (frames.length && i > lastKey) break;
        if (s.kind === 'wait') { await sleep(s.ms); continue; }
        await pressKey(cdp, s.code, s.ms);
        lastKeyUp = Date.now();
      }
      const entry = { round: r, ms: Date.now() - t0, frames: (await evaluate(cdp, 'window.__qaFrames')) - before };
      if (sit) {
        const m1 = await money();
        entry.wallet = [m0.wallet, m1.wallet];
        entry.wagered = [m0.wagered, m1.wagered];
      }
      // --frames: screenshots at exact offsets after the last key is released (each synced to a rendered frame)
      if (frames.length) {
        entry.frameShots = [];
        for (const ms of frames) {
          const due = lastKeyUp + ms;
          if (due > Date.now()) await sleep(due - Date.now());
          await nextFrame(cdp);
          const at = Date.now() - lastKeyUp;
          const name = rounds > 1 ? `${machine}-round${r}-f${ms}.png` : `${machine}-f${ms}.png`;
          entry.frameShots.push({ ms, actualMs: at, shot: await shoot(name) });
        }
        const end = lastKeyUp + Math.max(trailing, frames[frames.length - 1]);
        if (end > Date.now()) await sleep(end - Date.now());
      }
      if (probe) entry.probe = await evalJson(cdp, probe);
      if (res.reloads) throw new Error(`the page reloaded during round ${r} (${res.reloads}x; the veil came back, see viteEvents)`);
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
      res.playerMode = await evaluate(cdp, '(window.jackid.bench?.player ?? window.jackid.app.player)?.mode ?? null');
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
const USAGE = 'usage: node scripts/qa/bench.mjs (--machine <id> | --world | --run "<steps>") [--script "Space:200,wait:1500,KeyX"] [--shots <dir>] '
  + '[--frames "300,1200"] [--probe "<js>"] [--js "<js>"] [--rounds <n>] [--seed <n>] [--sit [--seat <n>] [--force "<id>:<state>"]] [--walk-view]';

function parseArgs(argv) {
  const o = {};
  const flags = {
    '--machine': 'machine', '--script': 'script', '--shots': 'shots', '--rounds': 'rounds', '--seed': 'seed', '--seat': 'seat',
    '--settle': 'settle', '--frames': 'frames', '--probe': 'probe', '--js': 'js', '--force': 'force', '--run': 'run',
  };
  const switches = { '--sit': 'sit', '--walk-view': 'walkView', '--world': 'world' };
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
      if (o.help || (!o.machine && !o.world && o.run === undefined)) { process.stderr.write(USAGE + '\n'); process.exit(o.help ? 0 : 2); }
      const result = await runBench(o);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (e) {
      code = 1;
      process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }, null, 2) + '\n');
    }
    process.exit(code);
  })();
}
