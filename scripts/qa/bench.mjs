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
 * By default the page runs on the fixed clock (`?fixedstep=1&clock=manual`): the harness steps it, so waits, budgets and
 * the bot's decisions are sim time and a seeded run repeats exactly. `--real-time` restores the wall clock.
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
const PAWN_SLOTS_MAX = 6;   // charm_vendor SLOTS_MAX: 4 shelves plus up to 2 Second Window extras
const STAKE_MAX = 7;       // stakes.ts STAKE_MAX
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_HOLD_MS = 80;
const READY_TIMEOUT_MS = 120_000;
/** Page loads after the first one in the current run (module-level, so the CLI can name a reload that failed a run). */
let pageReloads = 0;
const WIN = process.platform === 'win32';
/** The page's loop runs at this rate in the fixed-step clock (src/core/loop.ts: one sim step per frame of 1/60 s). */
const FRAME_HZ = 60;
/** A page promise that has not settled after this many frames (60 s of sim time) fails the call. */
const PENDING_MAX_FRAMES = 3600;
/** Real-time looks (5 ms apart, about 100 ms) at a page promise before any frame is stepped. */
const PENDING_GRACE_POLLS = 20;
/**
 * The harness clock. Wall time by default. In the fixed-step manual clock (the page boots with `fixedstep=1&clock=manual`,
 * see `--real-time`), the page moves only when the harness steps it, so every wait and budget counts sim frames:
 * `step` is set while the clock is on and `frames` counts the frames stepped.
 */
const clock = { step: null, frames: 0 };
/** Milliseconds now: sim ms while the harness steps the page, else wall time. */
const nowMs = () => (clock.step ? (clock.frames * 1000) / FRAME_HZ : new Date().getTime());
/** Waits `ms`: whole sim frames (rounded to the frame, at least one for a positive wait) when the page is stepped, else real time. */
const sleep = (ms) => (clock.step ? clock.step(ms) : new Promise((r) => setTimeout(r, ms)));
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
 *   goto:hot           the same, for the Hot cabinet (the first Hot Lamp lit now, run.circuit.lamps().hot[0])
 *   nightcard:<1|2>    pick Night Card <1|2> of the offer: the id at that index of run.nightCardOffer().candidates goes to run.pickNightCard(id)
 *   nightcard:best     pick the card with the highest expected value (CARD_EV, summarizeOffer): risk-on (payouts) when ahead of the
 *                      Dawn projection, quota-lowering when behind; logs the reason; ties keep card 1
 *   play:<keys>xN      press the keys (parseScript syntax, e.g. play:Space:150,wait:300x3), N times (default 1)
 *   stand              stand up from the seat
 *   bank:deposit:<n>   Debt Terminal deposit of n coins (run.deposit)
 *   bank:withdraw:<n>  take n coins back from the bank into the pocket (run.withdraw, the broke path)
 *   lever              the terminal lever the run accepts now: OPEN THE FLOOR, else the Bell, else SETTLE
 *   bell               ring the Bell early (run.ringBell: ends the Watch while playing or Last Call, unused pulls rebate)
 *   pawn               one Pawn Window reroll (Intermission only)
 *   pawn:buy:<slot>    buy Pawn Window shelf <slot> (1-6, 1-based): sits there, the shelf key, Space twice
 *   pawn:look          sit at the Pawn Window, screenshot the seat view (run-pawn-look-<n>.png)
 *   auto:night         a bot plays one Night like a sensible human (Hot first, spotlight, Tilt rotation, push-your-luck, SAFE / BOLD / BIG stakes, Dawn deposits, Mola); logs each decision
 *   auto:night:event   the same, but stops at the first Watch with a floor event (shot it, then auto:night carries on)
 *   auto:night:quota   the same, but stops in the Watch whose deposit meets the quota (before its Bell: the NIGHT PLAN's
 *                      OVERSHOOT line is on screen; shot it, then auto:night carries on)
 *   events             record and print the live floor event (watchEvents.ts watchEventView), null between Watches
 *   shot:<name>        screenshot to <shots>/<name>.png (needs --shots)
 *   wait:<ms>          pause
 *   state              record pocket, bank, quota, night, watch, pulls, phase, seated, starterOffer, charms (res.run.states)
 *   kit:<id>           start config (applied at run start, not a step): the kit, as the kit picker's config passes it
 *   stake:<n>          start config: the stake 0-7 (STAKE_MAX)
 *   daily              start config: the day's run (kit, stake 3 and seed from the UTC day, as the picker's daily toggle)
 * The start config is applied once, when the run starts (see startConfigJs); its step records are first in run.steps.
 */
export function parseRunSteps(text) {
  const out = [];
  for (const raw of String(text ?? '').split(';')) {
    const tok = raw.trim();
    if (!tok) continue;
    if (['stand', 'lever', 'bell', 'pawn', 'state', 'events'].includes(tok)) { out.push({ kind: tok, text: tok }); continue; }
    if (tok === 'daily') { out.push({ kind: 'daily', text: tok }); continue; }
    if (tok === 'pawn:look') { out.push({ kind: 'pawnlook', text: tok }); continue; }
    if (tok === 'auto:night') { out.push({ kind: 'auto', text: tok }); continue; }
    if (tok === 'auto:night:event') { out.push({ kind: 'auto', stopAt: 'event', text: tok }); continue; }
    if (tok === 'auto:night:quota') { out.push({ kind: 'auto', stopAt: 'quota', text: tok }); continue; }
    let m0 = /^shot:([A-Za-z0-9_-]{1,60})$/.exec(tok);
    if (m0) { out.push({ kind: 'shot', name: m0[1], text: tok }); continue; }
    m0 = /^banner:(\d+)$/.exec(tok);
    if (m0) { out.push({ kind: 'banner', ms: Number(m0[1]), text: tok }); continue; }
      if (tok === 'goto:hot') { out.push({ kind: 'goto', hot: true, text: tok }); continue; }
    m0 = /^nightcard:([12]|best)$/.exec(tok);
    if (m0) { out.push(m0[1] === 'best' ? { kind: 'nightcard', best: true, text: tok } : { kind: 'nightcard', n: Number(m0[1]), text: tok }); continue; }
    let m = /^goto:([a-z][a-z0-9_]*)$/.exec(tok);
    if (m) { out.push({ kind: 'goto', machine: m[1], text: tok }); continue; }
    m = /^pawn:buy:(\d+)$/.exec(tok);
    if (m) {
      const slot = Number(m[1]);
      if (!(slot >= 1 && slot <= PAWN_SLOTS_MAX)) throw new Error(`bad shelf in "${tok}" (pawn:buy:<1-${PAWN_SLOTS_MAX}>, shelves 1-4 are the 1-4 keys)`);
      out.push({ kind: 'pawnbuy', slot, text: tok });
      continue;
    }
    m = /^kit:([a-z][a-z0-9_]*)$/.exec(tok);
    if (m) { out.push({ kind: 'kit', id: m[1], text: tok }); continue; }
    m = /^stake:(\d+)$/.exec(tok);
    if (m) {
      const n = Number(m[1]);
      if (!(n >= 0 && n <= STAKE_MAX)) throw new Error(`bad stake in "${tok}" (stake:<0-${STAKE_MAX}>)`);
      out.push({ kind: 'stake', n, text: tok });
      continue;
    }
    m = /^bank:deposit:(\d+)$/.exec(tok);
    if (m) { out.push({ kind: 'deposit', amount: Number(m[1]), text: tok }); continue; }
    m = /^bank:withdraw:(\d+)$/.exec(tok);
    if (m) { out.push({ kind: 'withdraw', amount: Number(m[1]), text: tok }); continue; }
    m = /^wait:(\d+)$/.exec(tok);
    if (m) { out.push({ kind: 'wait', ms: Number(m[1]), text: tok }); continue; }
    m = /^play:(.+?)(?:x(\d+))?$/.exec(tok);
    if (m) {
      const n = m[2] === undefined ? 1 : Number(m[2]);
      if (!(n >= 1)) throw new Error(`bad repeat in "${tok}" (play:<keys>xN, N >= 1)`);
      out.push({ kind: 'play', keys: parseScript(m[1]), n, text: tok });
      continue;
    }
    throw new Error(`bad --run step "${tok}" (goto:<id> | goto:hot | nightcard:<1|2|best> | play:<keys>xN | stand | bank:deposit:<n> | bank:withdraw:<n> | lever | bell | pawn | pawn:buy:<slot> | pawn:look | auto:night | auto:night:event | auto:night:quota | events | banner:<ms> | shot:<name> | wait:<ms> | state | kit:<id> | stake:<n> | daily)`);
  }
  if (!out.length) throw new Error('--run needs at least one step, e.g. "goto:coinflip;play:Space:150x3;state"');
  const once = (kind) => {
    const hits = out.filter((s) => s.kind === kind);
    if (hits.length > 1) throw new Error(`"${hits[1].text}": one ${kind} step per --run`);
    return hits[0];
  };
  const daily = once('daily'), kit = once('kit'), stake = once('stake');
  if (daily && (kit || stake)) throw new Error('"daily" fixes the kit and the stake: drop kit:<id> and stake:<n> (the kit picker does the same)');
  return out;
}

/** The start config from the kit/stake/daily steps (applied at run start, not steps), or null when there are none. */
const START_KINDS = new Set(['kit', 'stake', 'daily']);
/** Steps that only read or wait: they do not change the Night, so auto:night's next-step look skips them. */
const READ_ONLY_KINDS = new Set(['state', 'shot', 'events', 'wait', 'banner']);
export function startSpecOf(parsed) {
  const cfg = parsed.filter((s) => START_KINDS.has(s.kind));
  if (!cfg.length) return null;
  const spec = { text: cfg.map((s) => s.text).join(';') };
  for (const s of cfg) {
    if (s.kind === 'kit') spec.kit = s.id;
    else if (s.kind === 'stake') spec.stake = s.n;
    else spec.daily = true;
  }
  return spec;
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
  const t0 = nowMs();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (nowMs() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
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

/**
 * Sends one real key event (CDP). With the manual clock, it then waits in real time until the page has counted it (the
 * `window.__qaKeys` listener, installed in capture phase at boot): the page takes the event in the same task, so the key
 * is queued before the harness steps the next frame. Without this, a key could land on either side of a stepped frame.
 */
async function sendKey(cdp, type, params) {
  const kind = type === 'keyUp' ? 'up' : 'down';
  const seen = clock.step ? await evaluate(cdp, `window.__qaKeys.${kind}`) : null;
  await cdp.send('Input.dispatchKeyEvent', { type, ...params });
  if (!clock.step) return;
  for (let i = 0; i < 200; i++) {                       // up to about 1 s of real time
    if ((await evaluate(cdp, `window.__qaKeys.${kind}`)) > seen) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`the page did not take the ${kind} of ${params.code}`);
}

/** Presses one key (KeyboardEvent.code) and holds it `ms`, as a real keyboard would. */
async function pressKey(cdp, code, ms) {
  const k = keyInfo(code);
  const params = { code: k.code, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await sendKey(cdp, 'rawKeyDown', params);
  await sleep(ms);
  await sendKey(cdp, 'keyUp', params);
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

/**
 * Evaluates `expr` in the page and returns its JSON-able value. With the manual clock the page moves only when stepped, so a
 * promise the expression returns (a seat glide, a cutscene) cannot be awaited over CDP: its result goes to `window.__qaSlot`,
 * and the harness steps one frame at a time until it settles. Each frame is a fixed sim step, so the wait is deterministic.
 */
async function evaluate(cdp, expr) {
  if (!clock.step) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  }
  const r = await cdp.send('Runtime.evaluate', {
    expression: `window.__qaSlot = { done: false }; ((v) => { if (v && typeof v.then === 'function') {
      v.then((x) => { window.__qaSlot = { done: true, value: x }; }, (e) => { window.__qaSlot = { done: true, error: String((e && e.message) || e) }; });
      return { pending: true }; } return { value: v }; })((${expr}))`,
    returnByValue: true,
    awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  const first = r.result?.value;
  if (!first?.pending) return first?.value;
  // A promise that needs only tasks (a cached module's import()) settles a few ms of real time after the call, not on a
  // frame. So the probe waits that long in real time before the first frame: a race with the task would otherwise cost a
  // frame in some runs and not in others. Only a promise that needs sim time (a glide, a cutscene) steps the page.
  const probe = async () => (await cdp.send('Runtime.evaluate', { expression: 'window.__qaSlot', returnByValue: true })).result?.value;
  let slot = await probe();
  for (let w = 0; !slot?.done && w < PENDING_GRACE_POLLS; w++) {
    await new Promise((r) => setTimeout(r, 5));
    slot = await probe();
  }
  for (let n = 0; !slot?.done; n++) {
    if (n >= PENDING_MAX_FRAMES) throw new Error(`the page promise did not settle within ${PENDING_MAX_FRAMES} frames (${expr.slice(0, 80)})`);
    await stepFrames(cdp, 1000 / FRAME_HZ);            // one frame of sim time, then look again
    slot = await probe();
  }
  if (slot.error !== undefined) throw new Error(slot.error);
  return slot.value;
}

/**
 * Runs `ms` of sim time in the page (`window.__qaClock.step`, src/core/loop.ts): whole frames, rounded, and at least one
 * for a positive wait. It runs in chunks, so no single CDP call holds the page for long. Chunking does not change the
 * run: the frames are the same, in the same order, with nothing in between.
 */
async function stepFrames(cdp, ms) {
  let left = ms > 0 ? Math.max(1, Math.round((ms * FRAME_HZ) / 1000)) : 0;
  while (left > 0) {
    const n = Math.min(left, 300);
    // the plain CDP call, not evaluate(): evaluate's promise wait steps through here, and must not reset its own slot
    const r = await cdp.send('Runtime.evaluate', { expression: `window.__qaClock.step(${n})`, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    clock.frames += n;
    left -= n;
  }
}

/**
 * The modules the page expressions above import on demand. Loaded in one batch before the manual clock attaches (see
 * runBench), so a first `import()` inside an expression never waits on the network while the harness steps frames.
 */
const PAGE_MODULES = [
  '/src/core/i18n.ts', '/src/game/charms/engine.ts', '/src/game/charms/sets.ts', '/src/game/daily.ts',
  '/src/game/data/charmsEngines.ts', '/src/game/data/kits.ts', '/src/game/data/schedule.ts', '/src/game/nightCards.ts',
  '/src/game/pace.ts', '/src/game/spotlight.ts', '/src/game/stakes.ts', '/src/game/watchEvents.ts',
  '/src/machines/_base/stakePresets.ts', '/src/machines/bigone/rules.ts',
];
const PRELOAD_JS = `Promise.all([${PAGE_MODULES.map((m) => `import('${m}')`).join(', ')}]).then(() => true)`;

/** Frames the page has run: the sim frame count with the manual clock, else the rAF counter (`window.__qaFrames`). */
const framesOf = (cdp) => evaluate(cdp, clock.step ? 'window.__qaClock.frames()' : 'window.__qaFrames');

// ── the run ────────────────────────────────────────────────────────────────────────────────────────────────
// ── --run: the debt-run driver ─────────────────────────────────────────────────────────────────────────────
/** Skips the story intro with real Space taps: one tap (80 ms, a tap not a hold) each 1.2 s once it has played that long. */
async function skipIntro(cdp) {
  const t0 = nowMs();
  let started = 0, lastTap = 0, taps = 0;
  for (;;) {
    const id = await evaluate(cdp, 'window.jackid.app.cutscene.playing ?? null');
    if (id === 'intro') {
      if (!started) started = nowMs();
      if (taps < 8 && nowMs() - started >= 1200 && nowMs() - lastTap >= 1200) {
        await pressKey(cdp, 'Space', DEFAULT_HOLD_MS);
        lastTap = nowMs();
        taps++;
      }
    } else if (started || nowMs() - t0 > 15_000) break;   // the intro is over (skipped or played out), or none came
    await sleep(120);
  }
  return { played: started > 0, taps };
}

/**
 * Page JS: wraps the run's `bet()` once (idempotent) so every stake attempt is kept on `run.__qaBets` as
 * `{ stake, machine, ok, refusal }`. The machines call `run.bet()` on the run object, so the wrapper sees every play.
 */
const BET_TAP_JS = `(() => {
  const r = window.jackid.app.run;
  if (!r) return false;
  if (!r.__qaBets) {
    const tap = (r.__qaBets = []);
    const bet = r.bet.bind(r);
    r.bet = (amount, src, o) => {
      const ok = bet(amount, src, o);
      tap.push({ stake: amount, machine: src?.machineId ?? null, ok, refusal: ok ? null : (r.lastRefusal?.() ?? null) });
      return ok;
    };
  }
  return true;
})()`;
/** Page JS: the run's last refusal (`run.lastRefusal()`), or null. It is not cleared by every step (see noteRefusal). */
const REFUSAL_JS = '(window.jackid.app.run.lastRefusal?.() ?? null)';
/** Page JS: the stake attempts recorded from index n on (see BET_TAP_JS). */
const betsFrom = (n) => `(window.jackid.app.run?.__qaBets ?? []).slice(${n})`;
const BET_COUNT_JS = '(window.jackid.app.run?.__qaBets ?? []).length';
/**
 * Page JS: the run has ended (`run.over`), or the run is gone (session teardown clears `app.run` once the menu takes the
 * screen back). Checked before each step, so the steps after it are skipped instead of throwing.
 */
const RUN_OVER_JS = '(() => { const r = window.jackid?.app?.run; return !r || r.over === true; })()';

/**
 * Page JS: applies the start config (the kit picker's `config`: `{ kit, stake, daily }`) to the next debt `ingame` start.
 * It wraps `app.go` once: the first `go('ingame', { mode: 'debt' })` (the veil's click, the same call the kit picker makes
 * in menuState.ts) gets `config` merged in. The daily run takes today's kit and DAILY_STAKE, as the picker's toggle does.
 * The stake and kit are not gated here: the picker's unlock rules are reported as `gated` (the QA profile is fresh).
 */
const startConfigJs = (spec) => `(async () => {
  const a = window.jackid.app, spec = ${JSON.stringify(spec)};
  const { KITS } = await import('/src/game/data/kits.ts');
  const daily = await import('/src/game/daily.ts');
  const stakes = await import('/src/game/stakes.ts');
  const cfg = spec.daily ? { kit: daily.dailyKit(daily.dayKey()), stake: daily.DAILY_STAKE, daily: true }
    : { kit: spec.kit, stake: spec.stake, daily: false };
  const kit = cfg.kit ?? 'pauper';
  const row = KITS.find((k) => k.id === kit);
  if (!row) return { ok: false, error: 'unknown kit "' + kit + '"' };
  const stake = cfg.stake ?? 0;
  const unlocked = a.save?.data?.meta?.unlocked ?? [];
  const gated = {
    kit: !cfg.daily && row.unlockCost > 0 && !unlocked.includes('kit:' + kit),
    stake: !cfg.daily && stake > 0 && !stakes.stakeUnlocked(a.save?.data?.stakeCleared ?? {}, kit, stake),
  };
  let pending = { kit: cfg.kit, stake: cfg.stake, daily: cfg.daily };
  const go = a.go.bind(a);
  a.go = (to, params) => {
    if (pending && to === 'ingame' && params && params.mode === 'debt') {
      const config = { ...(params.config ?? {}), ...pending };
      pending = null;
      return go(to, { ...params, config });
    }
    return go(to, params);
  };
  return { ok: true, kit, stake, daily: cfg.daily, gated };
})()`;

/**
 * A refused step's refusal: `refusal` is the run's `lastRefusal()` after the step, `refusalNew` whether it changed during
 * the step. The run keeps its last refusal until the next accepted bet (or buy), so an unchanged value may be stale.
 */
function noteRefusal(rec, before, now) {
  rec.refusal = now;
  rec.refusalNew = now !== before;
  rec.reason = rec.refusalNew && now ? `refused (${now})` : (rec.reason ?? 'refused');
}

/**
 * Page JS helpers: `houseCutOf` is the house cut the owned machines have paid tonight (run.nightLedger().cut, paid at each Watch
 * settle, see run.ts payHouseCut), null when the build has no ledger; it is read into the state record as `houseCut`.
 * `watchTitheOf` is the Watch tithe (run.watchTithe(): { on, target, earned, met, shortfall }), null when the build has none;
 * it is read into the state record as `tithe`.
 */
const TITHE_FN_JS = `function houseCutOf(r) {
  const l = typeof r.nightLedger === 'function' ? r.nightLedger() : null;
  return l && Number.isFinite(l.cut) ? l.cut : null;
}
function watchTitheOf(r) {
  const t = typeof r.watchTithe === 'function' ? r.watchTithe() : null;
  return t ? { on: t.on === true, target: t.target, earned: t.earned, met: t.met === true, shortfall: t.shortfall } : null;
}`;

/** The Dawn projection body (uses `r`): the bank at Dawn if the Night plays on, the gap to the quota, the float to keep. */
const DAWN_BODY = `
  const { dawnPlan } = await import('/src/game/pace.ts');
  const { nightDef } = await import('/src/game/data/schedule.ts');
  const b = r.bank();
  const settles = Math.max(0, nightDef(r.night() - 1).watches - ((typeof r.watch === 'number' ? r.watch : 0) + 1));
  const p = dawnPlan({ due: b.due, balance: b.balance, settles, interestAt: b.interestAt });
  return { due: b.due, balance: b.balance, settles, projected: p.projected, gap: p.gap, met: p.met, float: r.depositFloor() };`;
/** Page JS: the Dawn projection of the open run (null without one). */
const DAWN_JS = `(async () => { const r = window.jackid.app.run; if (!r) return null; ${DAWN_BODY} })()`;

/**
 * Page JS helper (inlined into the page scripts): the ids of the open Night Card offer, in offer order (card 1 first), or null
 * when no offer is open. run.nightCardOffer() returns { candidates: NightCardDef[], left, night }, so the ids are read from it.
 */
const NIGHT_CARD_IDS_JS = `function nightCardIds(r) {
  const o = r.nightCardOffer?.();
  return o && Array.isArray(o.candidates) && o.candidates.length ? o.candidates.map((c) => c.id) : null;
}`;

/**
 * Page JS: the open Night Card offer with each card's preview, read for `nightcard:<n|best>` and the auto:night stop. Resolves
 * to { missing, night, have, quotaBase, cards } (cards null when no offer is open). `night` is the 0-based Night index the
 * cards are for (the same index nightCardPreview takes), `have` is pocket + bank now, `quotaBase` the Night's ladder quota
 * (quotaFor), and each card has `lines` (nightCardPreview: key + vars), `text` (the card face's preview line, translated) and
 * `quotaTo` (the coming quota the card leaves: its quota line's `to`, else quotaBase).
 */
const NIGHT_CARD_OFFER_JS = `(async () => {
  ${TITHE_FN_JS}
  const none ={ missing: false, night: null, have: null, quotaBase: null, cards: null };
  const r = window.jackid.app.run;
  if (!r) return none;
  if (typeof r.pickNightCard !== 'function') return { ...none, missing: true };
  const o = r.nightCardOffer?.();
  if (!o || !Array.isArray(o.candidates) || !o.candidates.length) return none;
  const { nightCardPreview } = await import('/src/game/nightCards.ts');
  const { quotaFor } = await import('/src/game/data/schedule.ts');
  const { t, lang } = await import('/src/core/i18n.ts');
  const b = r.bank();
  // The plain next-Night read (ladder + overshoot discount + notice), not the bare ladder: otherwise every card shows a phantom change.
  const quotaBase = r.nextQuotaPreview?.(1)?.due ?? quotaFor(o.night);
  const comma = lang() === 'tr';
  const vars = (v) => {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === 'x' ? String(x).replace('.', comma ? ',' : '.') : x;
    return out;
  };
  // The exact read the game's own panel uses (ladder + discount + assessment + House notice + the card's multiplier).
  const dueWith = (m) => r.nextQuotaPreview?.(m)?.due ?? null;
  const cards = o.candidates.map((def) => {
    const lines = nightCardPreview(def, o.night, dueWith);
    const q = lines.find((p) => p.key === 'quota');
    return {
      id: def.id, tone: def.tone, lines,
      text: lines.map((p) => t('nightcard.prev.' + p.key, vars(p.vars))).join(' · '),
      quotaTo: q ? q.vars.to : (dueWith(1) ?? quotaBase),
    };
  });
  // The Dawn projection (the same read as the state record's dawn): met says the bank covers the quota at Dawn (the ahead/behind switch).
  const dawn = await (async () => { ${DAWN_BODY} })();
  return { missing: false, night: o.night, have: b.pocket + b.balance, quotaBase, cards, dawn, houseCut: houseCutOf(r) };
})()`;

/** Page JS: takes the offered card `id` (run.pickNightCard takes the id, not the index). Resolves to true when the run accepts it. */
function pickNightCardJs(id) {
  return `(() => {
    const r = window.jackid.app.run;
    if (!r || typeof r.pickNightCard !== 'function') return false;
    return r.pickNightCard(${JSON.stringify(id)}) === true;
  })()`;
}

/**
 * nightcard:best scoring (v2, expected value). Every term is a ratio of the bank (pocket + bank = `have`), so the weights are
 * unitless. The EV of a card is
 *   pay * gain - quota * dQuota - short * short
 * gain   = (payout x effective) - 1, times payoutShare (the share of the bank a Night's payouts move), plus the flat payout
 *          (flat coins x winsPerNight, the wins a Night pays) over `have`. effective = payout x (pulls after / pulls before).
 * dQuota = (quota the card leaves - the Night's base quota) / have: a lower quota is a gain, a higher one a cost.
 * short  = the quota the card leaves above `have` / have: quota the pocket+bank cannot cover.
 * Ahead of the Dawn projection (dawn.met: the bank covers the quota at Dawn): risk-on, payouts count and quota growth is cheap.
 * Behind it (or with no projection): quota-lowering, the quota counts and payouts cost little.
 */
const CARD_EV = {
  payoutShare: 0.25,
  winsPerNight: 4,
  ahead: { pay: 1, quota: 0.25, short: 1 },
  behind: { pay: 0.25, quota: 1, short: 2 },
};

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** One card's EV terms under `mode` ('ahead' | 'behind' | 'unknown'). `unknown` scores with the behind weights. */
function cardEV(c, offer, mode) {
  const have = Math.max(1, offer.have ?? 0);
  const w = mode === 'ahead' ? CARD_EV.ahead : CARD_EV.behind;
  const find = (key) => c.lines?.find((p) => p.key === key)?.vars ?? null;
  const payout = find('payout'), flat = find('flat'), pulls = find('pulls');
  const effX = (payout ? payout.x : 1) * (pulls && pulls.from > 0 ? pulls.to / pulls.from : 1);
  const gain = (effX - 1) * CARD_EV.payoutShare + (flat ? (flat.n * CARD_EV.winsPerNight) / have : 0);
  const dQuota = (c.quotaTo - offer.quotaBase) / have;
  const short = Math.max(0, c.quotaTo - have) / have;
  return { effX, ev: w.pay * gain - w.quota * dQuota - w.short * short };
}

/**
 * The open offer as the harness records it: each card with its index, id, tone, preview (`text`, `lines`), `quotaTo`, `ratio`
 * (quotaTo / pocket+bank, 2 dp), `payoutX` (the effective payout, see CARD_EV) and `ev`. `mode` is ahead / behind / unknown (the
 * Dawn projection). `best` is the nightcard:best pick, the 1-based card with the highest EV; a tie keeps card 1. `reason` says
 * why, in words. Returns null without an offer.
 */
function summarizeOffer(offer) {
  if (!offer?.cards?.length) return null;
  const have = offer.have ?? 0;
  const dawn = offer.dawn ?? null;
  const mode = dawn ? (dawn.met ? 'ahead' : 'behind') : 'unknown';
  const scored = offer.cards.map((c, i) => {
    const e = cardEV(c, offer, mode);
    return {
      index: i + 1, id: c.id, tone: c.tone, text: c.text, lines: c.lines, quotaTo: c.quotaTo,
      ratio: round(c.quotaTo / Math.max(1, have), 2), payoutX: round(e.effX, 2), ev: round(e.ev, 3),
    };
  });
  let best = 0;
  for (let i = 1; i < scored.length; i++) if (scored[i].ev > scored[best].ev + 1e-9) best = i;
  const b = scored[best];
  const tie = scored.some((c, i) => i !== best && Math.abs(c.ev - b.ev) < 1e-9);
  const head = mode === 'ahead'
    ? `ahead of Dawn (projected ${dawn.projected} >= due ${dawn.due}): risk-on`
    : mode === 'behind'
      ? `behind Dawn (projected ${dawn.projected} < due ${dawn.due}, gap ${dawn.gap}): quota-lowering`
      : 'no Dawn projection: quota-lowering (behind weights)';
  const others = scored.filter((_, i) => i !== best).map((c) => `${c.index} ${c.id} EV ${c.ev}`).join(', ');
  const reason = `${head}; card ${b.index} ${b.id} (EV ${b.ev}, payout x${b.payoutX}, quota ${b.quotaTo} vs base ${offer.quotaBase})`
    + (tie ? '; tie, card 1 kept' : ` over ${others}`);
  return {
    night: offer.night, have, quotaBase: offer.quotaBase, ids: scored.map((c) => c.id), cards: scored,
    best: best + 1, mode, reason, dawn,
  };
}

/** Prints an offer summary: one line per card (its preview, EV, the quota it leaves against pocket+bank), the best one marked, and the reason. */
function logOffer(sum, tag) {
  log(`${tag}: Night ${sum.night + 1} Dawn offer, pocket+bank ${sum.have}, quota ${sum.quotaBase}, mode ${sum.mode}`);
  for (const c of sum.cards) {
    log(`  ${c.index} ${c.id} [${c.tone}] EV ${c.ev} quota ${c.quotaTo} (${c.ratio}x pocket+bank) | ${c.text}${c.index === sum.best ? '  <- best' : ''}`);
  }
  log(`  why: ${sum.reason}`);
}

/** The open offer's summary (summarizeOffer), or null when no offer is open. */
async function offerSummary(cdp) {
  return summarizeOffer(await evalJson(cdp, NIGHT_CARD_OFFER_JS));
}

/** Page JS helper: the Machine of the Night for the state record (null between Nights). */
const SPOTLIGHT_FN_JS = `function spotlightOf(r) {
  const s = r.spotlightView?.();
  return s ? { machineId: s.machineId, night: s.night, plays: s.plays, progress: s.progress } : null;
}`;

/**
 * Page JS helper: the OVERSHOOT view (run.overshootView(): the bank against the overpay tiers) for the state record, null when
 * the build has none. `next` is the tier above the bank: its id, target coins and the gap still to go (null at the top tier).
 */
const OVERSHOOT_FN_JS = `function overshootOf(r) {
  const o = typeof r.overshootView === 'function' ? r.overshootView() : null;
  if (!o) return null;
  return { balance: o.balance, due: o.due, tier: o.tier ?? null, reached: o.reached, next: o.next ? { id: o.next.id, target: o.next.target, gap: o.next.gap } : null };
}`;

/** Page JS: the debt run's state, for `state`, the step records and the auto:night loop. Watch and Night are 1-based. */
const RUN_STATE_JS = `(async () => {
  ${NIGHT_CARD_IDS_JS}
  ${SPOTLIGHT_FN_JS}
  ${TITHE_FN_JS}
  ${OVERSHOOT_FN_JS}
  const a = window.jackid.app, r = a.run;
  if (!r) return { over: true, run: null };   // the run is gone: the menu took the screen back
  const b = r.bank(), pulls = r.pulls();
  // Lamps: each lit Hot / Cold instance with its machine id and the zone its slot sits in (the Bell's roll, circuit.ts).
  const lv = r.circuit?.lamps?.() ?? { hot: [], cold: [] };
  const lampOf = (list) => list.map((e) => ({ instance: e.mid, machineId: e.machineId, zone: a.world?.slot?.(e.mid)?.zone ?? null }));
  const ev = (await import('/src/game/watchEvents.ts')).watchEventView();   // the live floor event, or null
  return {
    lamps: { hot: lampOf(lv.hot), cold: lampOf(lv.cold) },
    event: ev ? { id: ev.id, leftS: ev.leftS, pulls: ev.pulls } : null,
    nightCard: r.nightCard?.()?.id ?? null,        // the Night Card picked for this Night (id), or null
    nightCardOffer: nightCardIds(r),               // the offered card ids while the offer is open, else null
    phase: r.shift.phase, night: r.night(), watch: typeof r.watch === 'number' ? r.watch + 1 : null,
    pocket: b.pocket, bank: b.balance, withdrawable: b.withdrawable, quotaDue: b.due, quotaLeft: b.left,
    pullsLeft: b.pullsLeft, pulls: Number.isFinite(pulls) ? pulls : null, minBet: b.minBet,
    nightDone: r.nightPaid, topside: r.topsideOpen,
    over: r.over, seated: a.player?.seat?.mid ?? null, intro: a.cutscene.playing ?? null,
    starterOffer: r.starterDraft()?.candidates.map((d) => d.id) ?? null, starterLeft: r.starterDraft()?.left ?? null,
    charms: r.charms().map((c) => (c.stacks > 1 ? c.id + " x" + c.stacks : c.id)),
    spotlight: spotlightOf(r),                     // Machine of the Night: { machineId, night, plays, progress }, or null
    tithe: watchTitheOf(r),                        // the Watch tithe (run.watchTithe()): { on, target, earned, met, shortfall }, or null
    houseCut: houseCutOf(r),                       // the house cut paid tonight so far (run.nightLedger().cut), or null
    overshoot: overshootOf(r),                     // OVERSHOOT (run.overshootView()): { balance, due, tier, reached, next: { id, target, gap } | null }, or null
    dawn: await (async () => { ${DAWN_BODY} })(),  // the Dawn projection the deposits aim at (pace.ts dawnPlan)
  };
})()`;


/**
 * Page JS: teleports the player in front of the first unlocked floor machine of `machineId` and faces it. The front is
 * the machine's +Z (rotY turns it), `0.9 m + its interact depth` out, the stand-up distance of the bench room.
 */
const goToJs = (sel) => `(() => {
  const a = window.jackid.app, w = a.world, sel = ${JSON.stringify(sel)};
  if (!w || !a.player) return { ok: false, reason: 'no debt run on screen' };
  let m;
  if (sel.hot) {
    // The Hot cabinet: the first Hot Lamp lit now (the Bell's roll). It must be on the floor and unlocked.
    const hot = a.run?.circuit?.lamps?.().hot ?? [];
    if (!hot.length) return { ok: false, reason: 'no Hot lamp is lit now (the Lamps light at each Bell)' };
    const want = hot[0];
    m = w.machines().find((x) => x.id === want.mid);
    if (!m) return { ok: false, reason: 'the Hot cabinet (' + want.machineId + ') is not on the floor' };
    if (w.isLocked(m.id)) return { ok: false, reason: 'the Hot cabinet (' + want.machineId + ') is locked this Night' };
  } else if (sel.instance) {
    m = w.machines().find((x) => x.id === sel.instance && !w.isLocked(x.id));
    if (!m) return { ok: false, reason: 'the chosen machine (' + sel.instance + ') is not open now' };
  } else {
    m = w.machines().find((x) => x.def.id === sel.machine && !w.isLocked(x.id));
    if (!m) return { ok: false, reason: 'no unlocked "' + sel.machine + '" on the floor (not placed, or locked this Night)' };
  }
  const slot = w.slot(m.id);
  const th = ((slot?.rotY ?? 0) * Math.PI) / 180;
  const d = 0.9 + (m.model?.interact?.max?.[2] ?? 0.5);
  const fx = slot.pos[0] + d * Math.sin(th), fz = slot.pos[2] + d * Math.cos(th);
  const v = a.camera.position.clone();
  v.set(fx, a.player.pos.y, fz);
  a.player.teleport(v, th);
  return { ok: true, instance: m.id, machineId: m.def.id, at: [Math.round(fx * 100) / 100, Math.round(fz * 100) / 100] };
})()`;

/** Page JS: the seat test for `machineId` (the unlocked instance on the floor, and whether the player sits at it). */
const SEAT_JS = (machineId) => `(() => {
  const a = window.jackid.app, w = a.world, id = ${JSON.stringify(machineId)};
  const m = w ? w.machines().find((x) => x.def.id === id && !w.isLocked(x.id)) : undefined;
  return { instance: m ? m.id : null, seatedHere: Boolean(m) && a.player?.seat?.mid === m.id };
})()`;

/** Page JS: the Pawn Window's shelves (0-based; null = sold or empty), the wallet, the last refusal. */
const PAWN_JS = `(() => {
  const r = window.jackid.app.run, p = r.pawn, me = r.selfId;
  return {
    open: p.open(), wallet: r.wallet(), tickets: r.balance('ticket'), refusal: r.lastRefusal(),
    mode: window.jackid.app.input?.mode ?? null,
    stock: p.stock(me).map((s, i) => (s === null ? null : {
      charmId: s.charmId, price: s.price, cursed: s.cursed, locked: s.locked, swap: p.needsSwap(me, i),
    })),
  };
})()`;

/**
 * The bot's machine recipes (keys after the stake is set). Digit0 closes a first-sit tip (a neutral key: Digit7/8/9 are the
 * SAFE/BOLD/BIG stake presets, and Digit9 would arm BIG). coinflip and bigone decide mid-round (botRound), the rest are keys.
 */
const BOT_RECIPE = {
  hilo: 'Space:120,wait:1200,Digit1:120,wait:1500,KeyQ:120,wait:500',
  scratch: 'Space:120,wait:1500,Space:120,wait:1800,KeyQ:120,wait:500',
};
/** Any other machine the bot bets on (a slot or lottery kind, or the spotlight): one spin, then collect. */
const BOT_RECIPE_GENERIC = 'Space:120,wait:2000,KeyQ:120,wait:500';
/** Machine kinds the bot may bet on besides the spotlight (the rest of the floor is not played: tables, the Pawn, the phone). */
const BOT_CATEGORIES = new Set(['slot', 'lottery']);
const BOT_MIN_STAKE = 'KeyZ:60,wait:120';
const TIP_KEY = 'Digit0';   // the neutral press that closes a first-sit tip (any key does; not a stake preset)
const BOLD_MIN_MULT = 14;   // BOLD (Digit8, ~15 % of the pocket) only when the pocket holds at least this many minimum bets
const BIG_MIN_MULT = 20;    // BIG (Digit9, ~30 % of the pocket) only from this many minimum bets up
const PUSH_BIG_ROLL = 0.2;  // BIG on a push-your-luck bet when a seeded roll comes under this (about 1 bet in 5)
/** The machines whose push-your-luck decision the bot makes mid-round (botRound). Only these may take BIG. */
const PUSH_MACHINES = new Set(['coinflip', 'bigone']);
const STAKE_DIGIT = { safe: 'Digit7', bold: 'Digit8', big: 'Digit9' };   // the presets' keys (stakePresets.ts STAKE_PRESET_ACTION)
const CHASE_P_JS = `(async () => (await import('/src/machines/bigone/rules.ts')).CHASE_P)()`;
const COINFLIP_COLLECT_AT = 3.6;   // coinflip: ride the first win once, collect at x3.6 (STEP_MULT[1] in coinflip/rules.ts)
/** Machine instance state for the coinflip and bigone decisions (their fields are read at runtime, not in the page API). */
const instJs = (id, body) => `(() => { const m = window.jackid.app.world?.machines().find((x) => x.id === ${JSON.stringify(id)}); return m ? (${body}) : null; })()`;
const CF_STATE_JS = (id) => instJs(id, `{ pending: Boolean(m.roundOpen && !m.busy && m.state?.pot > 0), pot: m.state?.pot ?? 0, bet: m.roundBet ?? 0 }`);
const BIGONE_STATE_JS = (id) => instJs(id, `{ offer: Boolean(m.offer) }`);
/**
 * Waits until the machine's round is over: `busy` (a flip, its toss, the balance and the present) or bigone's `inRound`.
 * A fixed sleep read the coin mid-toss. `pending` is false while busy, so a win read as "pot 0" and its ride or collect was
 * skipped. Measured: a coinflip flip stays busy ~2.7 s on a loss and ~3.1 s on a win; the bot checked at 2.6 s.
 * `start`: wait up to 1.2 s first for the round to begin (a refused press never begins one, so that wait is then the cost).
 */
async function waitRoundIdle(cdp, instance, { start = false, maxMs = 12000 } = {}) {
  const t0 = nowMs();
  const busy = async () => (await evaluate(cdp, instJs(instance, '(m.busy === true) || (m.inRound === true)'))) === true;
  if (start) while (nowMs() - t0 < 1200 && !(await busy())) await sleep(40);
  let saw = false;
  while (nowMs() - t0 < maxMs && (await busy())) { saw = true; await sleep(60); }
  if (saw) await sleep(120);                 // the frame after the last write (pot, history, wallet)
}
/**
 * Page JS: the floor machines the bot may bet on now (placed, unlocked, eligible), each with its tilt (`lit`: full-value pulls
 * left, 0..4; Hot machines ignore Tilt), whether it is a Hot Lamp, whether it is the spotlight kind, and `keep`: the stake
 * digits it leaves to the presets (7 SAFE, 8 BOLD, 9 BIG; all false for a machine that never stakes).
 */
const BOT_CANDS_JS = `(async () => {
  const a = window.jackid.app, r = a.run, w = a.world;
  if (!r || !w) return [];
  const { isSpotlightEligible } = await import('/src/game/spotlight.ts');
  const { stakeKeyOwned } = await import('/src/machines/_base/stakePresets.ts');
  const hot = new Set((r.circuit?.lamps?.().hot ?? []).map((e) => e.mid));
  const spot = r.spotlightView?.()?.machineId ?? null;
  const known = ${JSON.stringify(['coinflip', 'bigone', ...Object.keys(BOT_RECIPE)])};
  const cats = ${JSON.stringify([...BOT_CATEGORIES])};
  return w.machines().filter((m) => !w.isLocked(m.id) && isSpotlightEligible(m.def.id, m.def.category)
      && (known.includes(m.def.id) || cats.includes(m.def.category) || m.def.id === spot))
    .map((m) => {
      const t = r.circuit?.tilt?.(m.id) ?? null;
      const staking = m.def.minBet > 0;
      const keep = { safe: staking && !stakeKeyOwned(m.def.id, 'n7'), bold: staking && !stakeKeyOwned(m.def.id, 'n8'), big: staking && !stakeKeyOwned(m.def.id, 'n9') };
      return { instance: m.id, machineId: m.def.id, lit: t ? t.lit : 4, hot: hot.has(m.id), spot: m.def.id === spot, keep };
    });
})()`;
/** Node: the one machine the bot bets on next, and why. Hot first, then the spotlight, then the least-tilted (the stake is pickStake's). */
function pickBet(cands, bot, key) {
  const ok = cands.filter((c) => (bot.fails.get(c.instance) ?? 0) < 2);   // two refusals in a row: not a machine the bot can play
  if (!ok.length) return null;
  const played = bot.played.get(key) ?? new Set();
  const pool = ok.filter((c) => !played.has(c.instance));
  const use = pool.length ? pool : ok;
  const hot = use.find((c) => c.hot);
  if (hot) return { c: hot, why: 'Hot cabinet first (its Lamp is lit; Tilt does not apply)' };
  const spot = use.find((c) => c.spot);
  if (spot) return { c: spot, why: `the spotlight ${spot.machineId} (x1.25 this Night)` };
  const order = [...use].sort((x, y) => y.lit - x.lit || (bot.last.get(x.instance) ?? 0) - (bot.last.get(y.instance) ?? 0)
    || (x.instance < y.instance ? -1 : 1));
  const c = order[0];
  return { c, why: `rotate off Tilt: ${c.machineId} has ${c.lit} full-value pulls left` };
}

/** A seeded PRNG (mulberry32, values in [0, 1)): the bot's stake rolls depend only on --seed, never on Math.random. */
function seededRng(seed) {
  let a = (Math.floor(seed) ^ 0x6a09e667) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The push-your-luck rule of a machine, read before its bet: coinflip rides a won flip once (the bot's COINFLIP_COLLECT_AT
 * rule, always on); bigone chases a line win at CHASE_P or better (the same test botRound makes). Resolves to { live, why }.
 */
async function pushRule(ctx, machineId) {
  if (machineId === 'coinflip') return { live: true, why: `a won flip rides once for x${COINFLIP_COLLECT_AT}` };
  if (machineId === 'bigone') {
    const p = await evalJson(ctx.cdp, CHASE_P_JS);
    return { live: p >= 1 / 3 - 1e-9, why: `a line win chases at 1 in ${Math.round(1 / p)}, 1 in 3 or better` };
  }
  return { live: false, why: 'no push-your-luck rule' };
}

/**
 * Node: the stake for one bet, with its reason (the caller logs it). SAFE by default. BOLD on the Hot cabinet, on the spotlight,
 * or while ahead of the Dawn projection (dawn.met), when the pocket holds BOLD_MIN_MULT minimum bets. BIG only on a
 * push-your-luck machine (PUSH_MACHINES) whose rule is live, on an occasional seeded roll (PUSH_BIG_ROLL), from BIG_MIN_MULT
 * minimum bets up. A digit the machine keeps for itself, or a pocket under the multiple, takes the next step down
 * (BIG, BOLD, SAFE, then the minimum walked down with KeyZ). Resolves to { stake: 'big' | 'bold' | 'safe' | 'min', why }.
 */
async function pickStake(ctx, c, st) {
  const keep = c.keep ?? {};
  const mins = st.minBet > 0 ? st.pocket / st.minBet : 0;   // the pocket in minimum bets
  const fits = { big: Boolean(keep.big) && mins >= BIG_MIN_MULT, bold: Boolean(keep.bold) && mins >= BOLD_MIN_MULT, safe: Boolean(keep.safe), min: true };
  let want = 'safe', why = 'SAFE by default';
  if (PUSH_MACHINES.has(c.machineId) && fits.big) {
    const rule = await pushRule(ctx, c.machineId);
    if (rule.live) {
      ctx.rng ??= seededRng(ctx.seed ?? 1);
      const roll = ctx.rng();
      if (roll < PUSH_BIG_ROLL) { want = 'big'; why = `push-your-luck rule (${rule.why}), occasional roll ${roll.toFixed(2)} under ${PUSH_BIG_ROLL}`; }
    }
  }
  if (want === 'safe') {
    if (c.hot) { want = 'bold'; why = 'the Hot cabinet: BOLD'; }
    else if (c.spot) { want = 'bold'; why = `the spotlight ${c.machineId}: BOLD`; }
    else if (st.dawn?.met) { want = 'bold'; why = 'ahead of the Dawn projection: BOLD'; }
  }
  const chain = { big: ['big', 'bold', 'safe', 'min'], bold: ['bold', 'safe', 'min'], safe: ['safe', 'min'] }[want];
  const stake = chain.find((k) => fits[k]);
  if (stake !== want) why += `; ${want.toUpperCase()} not taken (${keep[want] === false ? 'the machine keeps its digit' : 'pocket under its multiple'}), ${stake.toUpperCase()} instead`;
  if (stake === 'min') why += '; no preset digit here, so the stake walks down to the minimum';
  return { stake, why };
}

/** Node: writes one bot decision as a record (`auto: true`, with its reason) and logs it. */
function decide(ctx, what, reason) {
  ctx.run.steps.push({ step: `decide: ${what}`, ok: true, auto: true, reason });
  log(`bot ${what}: ${reason}`);
}

const AUTO_MAX_MS = 15 * 60_000;   // auto:night stops after this much wall time (the run is left where it is)
const AUTO_MAX_LOOPS = 4000;
const BELL_KEEP_PULLS = 2;         // the bot spends the Watch's pulls down to this many, then deposits and rings the Bell (1-2 stay unused: the rebate)
const AUTO_BETS_MAX = 60;          // a bot bet cap per Watch (each bet spends a pull; refusals retire a machine, see pickBet)
const AUTO_LEVER_FAILS = 6;        // lever refused this many times in a row: the Night cannot move on

/** How long the first Night 1 read waits for the Starter Draft to open (its timer is slow in a headless run). */
const STARTER_WAIT_MS = 6000;

/**
 * Reads the debt-run state (RUN_STATE_JS). The Starter Draft opens a moment after the run starts, so on Night 1 with no charm
 * yet, the first read waits (once per run, up to STARTER_WAIT_MS) until `starterOffer` is non-null. A later read with the
 * draft taken (or no draft on this build) does not wait; a draft that never opens reads null after the wait.
 */
async function readState(ctx) {
  let st = await evalJson(ctx.cdp, RUN_STATE_JS);
  if (!ctx.starterWaited && st.starterOffer == null && !st.over && st.night === 1 && (st.charms ?? []).length === 0) {
    ctx.starterWaited = true;
    const t0 = nowMs();
    while (st.starterOffer == null && !st.over && nowMs() - t0 < STARTER_WAIT_MS) {
      await sleep(200);
      st = await evalJson(ctx.cdp, RUN_STATE_JS);
    }
  }
  noteNight(ctx, st);
  return st;
}

/**
 * Folds one state read into its Night's summary (ctx.nights, see nightSummaries). Every read counts: the state step, the bot's
 * loop and its Watch lines. The quota and the bank are the last read of the Night; met and paid stick once seen; the OVERSHOOT
 * tier is the highest reached; the card and the charms are the last seen; the events are the floor events read.
 */
function noteNight(ctx, st, ev = st?.event ?? null) {
  if (!st || st.over || st.night == null) return;
  const acc = (ctx.nights ??= new Map());
  const a = acc.get(st.night) ?? { quota: null, bank: null, met: false, paid: false, overshoot: null, reached: -1, card: null, charms: null, events: new Set() };
  if (st.quotaDue > 0) a.quota = st.quotaDue;
  if (st.bank != null) a.bank = st.bank;
  if (st.quotaDue > 0 && st.quotaLeft <= 0) a.met = true;
  if (st.nightDone) a.paid = true;
  if (st.overshoot && st.overshoot.reached > a.reached) { a.reached = st.overshoot.reached; a.overshoot = st.overshoot.tier; }
  if (st.nightCard) a.card = st.nightCard;
  if (st.charms) a.charms = st.charms;
  if (ev) a.events.add(ev.id);
  acc.set(st.night, a);
}

const seatedIs = (ctx, want, ms) => waitFor(
  async () => (await evaluate(ctx.cdp, 'window.jackid.app.player?.seat != null')) === want, ms, want ? 'a seat' : 'standing up');

/**
 * The `goto` step: teleport in front of the first unlocked floor machine (`machine`, a machine id), or of the Hot cabinet
 * (`{ hot: true }`), face it, press E (devtools occupy as the fallback).
 */
async function gotoMachine(ctx, machine, rec) {
  const { cdp } = ctx;
  // a string: the machine kind (first open one); { instance }: that floor instance; otherwise the Hot cabinet
  const sel = typeof machine === 'string' ? { machine } : machine.instance ? { instance: machine.instance } : { hot: true };
  const label = typeof machine === 'string' ? machine : machine.instance ?? 'hot';
  if (await evaluate(cdp, 'window.jackid.app.player?.seat != null')) {
    await evaluate(cdp, '(window.jackid.app.world.standUp(), true)');
    await seatedIs(ctx, false, 4000).catch(() => { throw new Error(`goto:${label}: could not stand up first`); });
  }
  const tp = await evalJson(cdp, goToJs(sel));
  if (!tp.ok) throw new Error(`goto:${label}: ${tp.reason}`);
  await sleep(400);                                     // the interact focus follows the new view
  await pressKey(cdp, 'KeyE', DEFAULT_HOLD_MS);
  rec.via = 'E';
  try { await seatedIs(ctx, true, 2500); } catch {
    await evaluate(cdp, `(window.jackid.app.world.occupy(${JSON.stringify(tp.instance)}), true)`);   // devtools fallback
    rec.via = 'occupy';
    await seatedIs(ctx, true, 2500).catch(() => { throw new Error(`goto:${label}: not seated (E and occupy both failed)`); });
  }
  rec.instance = tp.instance;
  rec.machineId = tp.machineId;
  rec.at = tp.at;
  if (sel.hot) rec.lamp = 'hot';
  // The seat is granted before the camera glides in; the keys of a seated machine only count once the input mode is 'machine'.
  await waitFor(async () => (await evaluate(cdp, 'window.jackid.app.input?.mode')) === 'machine', 2500, 'machine input').catch(() => { rec.inputMode = 'not machine'; });
}

/** Seats the player at `machine` (the Pawn Window's steps), unless already seated there. */
async function sitAt(ctx, machine, rec) {
  const seat = await evalJson(ctx.cdp, SEAT_JS(machine));
  if (!seat.instance) throw new Error(`${machine}: not on the floor (not placed, or locked this Night)`);
  if (seat.seatedHere) { rec.via = 'already seated'; rec.instance = seat.instance; return; }
  await gotoMachine(ctx, machine, rec);
}

/** Presses a parsed key list (parseScript output): keys held, waits in between. */
async function playKeys(cdp, keys) {
  for (const k of keys) {
    if (k.kind === 'wait') await sleep(k.ms);
    else await pressKey(cdp, k.code, k.ms);
  }
}

/** `pawn:buy:<slot>`: the Pawn Window, shelf `slot` (1-based): the Digit key (5 and 6 by ArrowRight), Space twice. */
async function pawnBuy(ctx, slot, rec) {
  const { cdp } = ctx;
  rec.slot = slot;
  await sitAt(ctx, 'charm_vendor', rec);
  await pressKey(cdp, TIP_KEY, DEFAULT_HOLD_MS);        // closes the first-sit tip (a no-op otherwise)
  await sleep(300);
  const b = await evalJson(cdp, PAWN_JS);
  if (!b.open) { rec.ok = false; rec.reason = 'window closed (it opens between Watches)'; return; }
  if (slot > b.stock.length) { rec.ok = false; rec.reason = `the window has ${b.stock.length} shelves`; return; }
  const s = b.stock[slot - 1];
  if (!s) { rec.ok = false; rec.reason = 'nothing on that shelf (sold or empty)'; return; }
  rec.charm = s.charmId;
  rec.price = s.price;
  rec.mode = b.mode;
  if (b.mode !== 'machine') { rec.ok = false; rec.reason = `not at the window for input (input mode "${b.mode}"); no keys sent`; return; }
  if (s.swap) { rec.ok = false; rec.reason = 'pegs full (a buy needs a swap pick; not bought)'; return; }
  if (s.price > b.wallet) { rec.ok = false; rec.reason = 'not enough coins'; return; }
  if (slot <= 4) await pressKey(cdp, `Digit${slot}`, DEFAULT_HOLD_MS);
  else {
    await pressKey(cdp, 'Digit4', DEFAULT_HOLD_MS);
    for (let k = 4; k < slot; k++) { await sleep(150); await pressKey(cdp, 'ArrowRight', DEFAULT_HOLD_MS); }
  }
  await sleep(300);
  await pressKey(cdp, 'Space', 120);                    // the first press shows the price
  await sleep(350);
  await pressKey(cdp, 'Space', 120);                    // the second, within 3 s, buys
  await sleep(700);
  const a = await evalJson(cdp, PAWN_JS);
  rec.paid = b.wallet - a.wallet;
  rec.ok = a.stock[slot - 1] === null;
  if (!rec.ok) rec.reason = a.refusal ? `refused (${a.refusal})` : 'not bought';
}

/** `pawn:look`: sit at the Pawn Window, close the tip, screenshot the seat view (`run-pawn-look-<n>.png`). */
async function pawnLook(ctx, rec) {
  const { cdp } = ctx;
  await sitAt(ctx, 'charm_vendor', rec);
  await pressKey(cdp, TIP_KEY, DEFAULT_HOLD_MS);        // the tip card would cover the window
  await sleep(900);                                     // the camera glide into the seat
  const b = await evalJson(cdp, PAWN_JS);
  rec.open = b.open;
  rec.wallet = b.wallet;
  rec.shelves = b.stock.map((s) => (s === null ? null : `${s.charmId} ${s.price}${s.cursed ? ' (cursed)' : ''}`));
  ctx.looks = (ctx.looks ?? 0) + 1;
  if (ctx.shotsDir) rec.shot = await ctx.shoot(`run-pawn-look-${ctx.looks}.png`);
}

/**
 * Page JS: the Mola shop pick. A shelf is bought when it is clean (not cursed, no swap), costs at most 30 % of the pocket, and
 * either completes an archetype set (the set switches on with it) or shares an archetype with a held charm. A set completion
 * comes first, then the cheapest. Resolves to { slot, charmId, price, why } (slot null with the reason when nothing qualifies).
 */
const SHOP_PICK_JS = `(async () => {
  const r = window.jackid.app.run, p = r.pawn, me = r.selfId;
  if (!p.open()) return { slot: null, why: 'the Pawn Window is shut' };
  const { charmDef } = await import('/src/game/charms/engine.ts');
  const { activeSets } = await import('/src/game/charms/sets.ts');
  const { ENGINE_ARCHETYPES } = await import('/src/game/data/charmsEngines.ts');
  const wallet = r.wallet();
  const tagsOf = (id) => charmDef(id)?.tags;
  const held = r.charms().map((c) => ({ id: c.id }));
  const heldArch = new Set(held.flatMap((h) => (tagsOf(h.id) ?? []).filter((t) => ENGINE_ARCHETYPES.includes(t))));
  const setsNow = activeSets(held, tagsOf).length;
  let best = null;
  p.stock(me).forEach((s, i) => {
    if (!s || s.cursed || p.needsSwap(me, i) || s.price <= 0 || s.price > wallet * 0.3) return;
    const tags = tagsOf(s.charmId) ?? [];
    const arch = tags.filter((t) => ENGINE_ARCHETYPES.includes(t));
    const completes = activeSets([...held, { id: s.charmId }], tagsOf).length > setsNow;
    const matches = arch.some((t) => heldArch.has(t));
    if (!completes && !matches) return;
    const cand = { slot: i + 1, charmId: s.charmId, price: s.price, completes, arch: arch[0] ?? null };
    if (!best || (cand.completes && !best.completes) || (cand.completes === best.completes && cand.price < best.price)) best = cand;
  });
  if (!best) return { slot: null, why: 'no affordable charm matches a held archetype or completes a set' };
  best.why = best.completes ? 'completes the ' + best.arch + ' set' : 'shares the ' + best.arch + ' archetype with a held charm';
  return best;
})()`;

/**
 * Page JS: the Starter Draft's pick for the bot: the first engine (archetype) charm on offer, since a set needs two of one
 * archetype, else the first card. Resolves to { id, ok, why } (id null when no draft is open).
 */
const STARTER_PICK_JS = `(async () => {
  const r = window.jackid.app.run, d = r?.starterDraft?.();
  if (!d || !d.candidates?.length) return { id: null, ok: false, why: 'no starter draft open' };
  const { ENGINE_ARCHETYPES } = await import('/src/game/data/charmsEngines.ts');
  const arch = d.candidates.find((c) => (c.tags ?? []).some((t) => ENGINE_ARCHETYPES.includes(t)));
  const pick = arch ?? d.candidates[0];
  const why = arch ? 'an archetype charm (a set switches on with a second of it)' : 'the first card (no archetype on offer)';
  return { id: pick.id, ok: r.pickStarter(pick.id) === true, why };
})()`;

/** auto:night's shop pick (SHOP_PICK_JS): the shelf to buy and the reason, or slot null with the reason. */
async function shopPick(ctx) {
  return evalJson(ctx.cdp, SHOP_PICK_JS);
}

/** The live floor event (watchEvents.ts `watchEventView`), or null between Watches. */
const EVENT_JS = `(await import('/src/game/watchEvents.ts')).watchEventView()`;
/** The event's announce line as the banner shows it (the bus id is watch.<id>, its strings are event.watch.<id>.*). */
const ANNOUNCE_JS = (id) => `(async () => (await import('/src/core/i18n.ts')).t(${JSON.stringify('event.watch.' + id + '.announce')}, { suit: '' }))()`;
const evText = (ev) => (ev ? `${ev.id} (${Math.ceil(ev.leftS)} s${ev.pulls == null ? '' : `, ${ev.pulls} pulls`})` : 'none');

/** One per-Watch line: pocket, bank, quota and the floor event. Logged, and kept as an `auto: true` record in run.steps. */
function watchRec(ctx, st, ev) {
  const t = st.tithe ?? null;
  const tithe = t ? (t.on ? `${t.earned}/${t.target}${t.met ? ' met' : ` short ${t.shortfall}`}` : 'off') : null;
  const o = st.overshoot ?? null;
  const over = o ? `${o.tier ?? 'none'}${o.next ? ` (next ${o.next.id} +${o.next.gap})` : ''}` : '-';
  noteNight(ctx, st, ev);
  ctx.run.steps.push({
    step: `watch ${st.night}-${st.watch}`, ok: true, auto: true, night: st.night, watch: st.watch, pocket: st.pocket,
    bank: st.bank, quotaDue: st.quotaDue, quotaLeft: st.quotaLeft, tithe: t, houseCut: st.houseCut ?? null, event: ev?.id ?? null,
    overshoot: o,
  });
  log(`watch N${st.night} W${st.watch}: pocket ${st.pocket}, bank ${st.bank}, quota due ${st.quotaDue} left ${st.quotaLeft}, overshoot ${over}, tithe ${tithe ?? '-'}, house cut ${st.houseCut ?? '-'}, event ${evText(ev)}`);
}

/**
 * `auto:night`: a sensible bot plays one Night. Per Watch: shop the cheapest affordable shelf in the intermission, then
 * lever (starts the Watch). In play: bets rotate over the open machines (Hot, spotlight, least Tilt) until the Watch's pulls
 * are down to BELL_KEEP_PULLS or the pocket is under the cheapest bet. Then the bot deposits only what it needs, into the
 * pocket above the float: the Dawn gap while quota is owed; once the quota is met, the gap to the next OVERSHOOT tier when the
 * pocket allows it (else nothing, and the bot keeps playing). Then the Bell (unused pulls keep the rebate). A broke pocket
 * withdraws only the top-up to the float plus one bet, not the whole bank (no withdraw and redeposit churn).
 * Each Watch's state (pocket, bank, quota, OVERSHOOT, floor event) is printed once, at its Bell. `stopAt` (`auto:night:event`
 * or `auto:night:quota`) stops at the first Watch with a floor event, or the first Watch whose deposit meets the quota (before
 * its Bell), so the event or the OVERSHOOT line can be shot; a later auto:night carries on.
 * Ends when the Night rolls over (OPEN THE FLOOR), the run is over, or it reaches the top. Each action is its own record
 * (`auto: true`), in order, before the summary record.
 */
async function autoNight(ctx, rec, stopAt = null) {
  const { res } = ctx;
  const t0 = nowMs();
  const auto = (o) => ({ ...o, auto: true });
  // Per-Watch bookkeeping lives on the run, so a second auto:night step carries on where an event stop left the Watch.
  const bot = (ctx.bot ??= {
    betsTried: new Map(), handled: new Set(), banked: new Set(), logged: new Set(), evStop: new Set(),
    played: new Map(),   // Watch key -> instances bet on in it
    fails: new Map(),    // instance -> bets in a row that spent no pull
    last: new Map(), seq: 0,   // instance -> the bet sequence number of its last bet (rotation ties)
    metStop: new Set(),  // Nights whose quota-met stop has been taken (auto:night:quota)
  });
  const n0 = (await readState(ctx)).night;
  const count = { deposits: 0, shops: 0, bets: 0, bells: 0 };
  const events = [];                    // ids of the floor events of the Watches this call reached
  let leverFails = 0, loops = 0, end = null, st = null, offer = null;   // offer: the Dawn offer the bot saw (summarizeOffer)
  /** A Watch's state, printed once (at its Bell, so the pocket is the one the Watch ends with). */
  const logWatchOnce = async (key) => {
    if (bot.logged.has(key)) return;
    bot.logged.add(key);
    const ev = await evalJson(ctx.cdp, EVENT_JS);
    watchRec(ctx, await readState(ctx), ev);
    if (ev) events.push(ev.id);
  };
  /**
   * This Watch's deposit, once per Watch after the bets: only what is needed, never into the float (the terminal's floor).
   * While quota is owed: the Dawn gap (the coins the projection still lacks). Once met: the gap to the next OVERSHOOT tier
   * (run.overshootView), only when the pocket above the float covers it. A refusal retries at half.
   */
  const depositFor = async () => {
    const s = await readState(ctx);
    if (!(s.pocket > 0)) return;
    const d = await evalJson(ctx.cdp, DAWN_JS);
    const floor = d?.float ?? 0;
    const room = Math.max(0, s.pocket - floor);
    let need, why;
    if (s.quotaLeft > 0) {
      need = d ? d.gap : s.quotaLeft;
      why = `the quota gap ${need} (Dawn projection ${d?.projected} of quota ${d?.due})`;
    } else {
      const next = s.overshoot?.next ?? null;
      if (!next) { need = 0; why = 'quota met, top OVERSHOOT tier reached'; }
      else if (next.gap <= room) { need = next.gap; why = `quota met, toward ${next.id} (target ${next.target})`; }
      else { need = 0; why = `quota met, ${next.id} needs ${next.gap} above the float, pocket room ${room}: keep playing`; }
    }
    const amount = Math.min(room, need);
    if (amount <= 0) { decide(ctx, 'deposit', `none: ${why}; float ${floor} kept`); return; }
    decide(ctx, 'deposit', `${amount} of pocket ${s.pocket}: ${why}, float ${floor} kept`);
    for (const amt of [amount, Math.floor(amount / 2)]) {
      if (amt <= 0) break;
      const r = await exec(ctx, auto({ kind: 'deposit', amount: amt, text: `bank:deposit:${amt}` }));
      if (r.ok) { count.deposits++; return; }
    }
  };
  while (!end) {
    if (++loops > AUTO_MAX_LOOPS) { end = 'loop budget'; break; }
    if (nowMs() - t0 > AUTO_MAX_MS) { end = 'time budget'; break; }
    if (res.reloads) { end = 'page reloaded'; break; }
    st = await readState(ctx);
    if (st.over) { end = 'run over'; break; }
    if (st.topside) { end = 'topside'; break; }
    if (st.night !== n0) { end = 'night paid'; break; }
    const key = `${st.night}:${st.watch}`;

    if (st.starterOffer) {
      // The Starter Draft holds the Bell until a card is taken (its timer is slow in a headless run): the bot takes one now.
      const p = await evalJson(ctx.cdp, STARTER_PICK_JS);
      if (p.ok) decide(ctx, 'starter', `take ${p.id}: ${p.why}`);
      else await sleep(300);
      continue;
    }

    if (st.pocket < st.minBet && st.withdrawable > 0) {
      // Top up only: the float plus one bet, not the whole bank (the bank is what the quota counts, so a full withdraw churns).
      const d = await evalJson(ctx.cdp, DAWN_JS);
      const amount = Math.min(st.withdrawable, Math.max(st.minBet - st.pocket, (d?.float ?? 0) + st.minBet - st.pocket));
      const r = await exec(ctx, auto({ kind: 'withdraw', amount, text: `bank:withdraw:${amount}` }));
      if (!r.ok) await sleep(300);
      continue;
    }
    // The first Watch of a Night starts with the intro (no intermission before it): its deposit is taken in the Bell or play.
    if (st.phase === 'bell' || st.phase === 'play' || st.phase === 'lastCall') {
      // --event: stop at the Watch's floor event (no cutscene up, so its banner and HUD timer are on screen), before the bets.
      if (stopAt === 'event' && !bot.evStop.has(key) && st.intro == null) {
        const ev = await evalJson(ctx.cdp, EVENT_JS);
        if (ev) { bot.evStop.add(key); events.push(ev.id); end = 'event'; break; }
      }
      // --quota: stop in the Watch whose deposit met the quota, before its Bell (the NIGHT PLAN's OVERSHOOT line is on screen).
      if (stopAt === 'quota' && st.phase === 'play' && st.quotaDue > 0 && st.quotaLeft <= 0 && st.intro == null
        && !bot.metStop.has(st.night)) {
        bot.metStop.add(st.night);
        end = 'quota met';
        break;
      }
    }
    // The Watch line of a Watch the game closes by itself (clock or pulls out). 'closing' is the last phase before the
    // settle, so the Watch tithe is still open there. 'bell' is the 2 s START cue (run.ts BELL_SEC, before any bet): a line
    // logged there reads the Watch at its start (tithe 0, pocket before the bets), and the Bell's own line then never runs.
    if (st.phase === 'closing') await logWatchOnce(key);
    if (st.phase === 'intermission') {
      if (st.nightCardOffer) {
        // A paid Dawn opened a Night Card offer (the lever waits on it). The bot pauses here: when the script's next step is
        // nightcard:<n|best>, that step picks; otherwise the bot picks the best card itself (nightcard:best), and logs it.
        offer = await offerSummary(ctx.cdp);
        if (ctx.next?.kind === 'nightcard') { end = 'night card'; break; }   // the next nightcard step prints the offer and picks
        decide(ctx, 'night card', `Dawn offer ${JSON.stringify(st.nightCardOffer)}: the highest expected value (nightcard:best)`);
        const r = await exec(ctx, auto({ kind: 'nightcard', best: true, text: 'nightcard:best' }));
        if (!r.ok) { end = 'night card refused'; break; }
        continue;
      }
      if (st.nightDone) {                               // the Night is paid: OPEN THE FLOOR (the lever)
        const r = await exec(ctx, auto({ kind: 'lever', text: 'lever' }));
        leverFails = r.ok ? 0 : leverFails + 1;
        if (leverFails >= AUTO_LEVER_FAILS) { end = 'lever refused'; break; }
        if (!r.ok) await sleep(300);
        continue;
      }
      if (!bot.handled.has(key)) {
        bot.handled.add(key);
        const pick = await shopPick(ctx);
        if (pick.slot) {
          decide(ctx, 'shop', `buy ${pick.charmId} (slot ${pick.slot}, ${pick.price} coins): ${pick.why}`);
          const r = await exec(ctx, auto({ kind: 'pawnbuy', slot: pick.slot, text: `pawn:buy:${pick.slot}` }));
          if (r.ok) count.shops++;
          await exec(ctx, auto({ kind: 'stand', text: 'stand' }));
        } else decide(ctx, 'shop', `no buy: ${pick.why}`);
        continue;
      }
      const r = await exec(ctx, auto({ kind: 'lever', text: 'lever' }));   // starts this Watch
      leverFails = r.ok ? 0 : leverFails + 1;
      if (leverFails >= AUTO_LEVER_FAILS) { end = 'lever refused'; break; }
      if (!r.ok) await sleep(300);
      continue;
    }
    if (st.phase === 'play' || st.phase === 'lastCall') {
      const tried = bot.betsTried.get(key) ?? 0;
      // Spend the Watch's pulls down to BELL_KEEP_PULLS (or until the pocket is under the cheapest bet), then bank and ring.
      if (tried < AUTO_BETS_MAX && (st.pulls ?? Infinity) > BELL_KEEP_PULLS && st.pocket >= st.minBet) {
        bot.betsTried.set(key, tried + 1);
        const pick = pickBet(await evalJson(ctx.cdp, BOT_CANDS_JS), bot, key);
        if (!pick) { bot.betsTried.set(key, AUTO_BETS_MAX); decide(ctx, 'bet', 'no open machine to play: ring the Bell'); continue; }
        const { c } = pick;
        const stake = await pickStake(ctx, c, st);
        if (!bot.played.has(key)) bot.played.set(key, new Set());
        bot.played.get(key).add(c.instance);
        bot.last.set(c.instance, ++bot.seq);
        decide(ctx, `bet ${c.machineId} (${stake.stake.toUpperCase()})`, `${pick.why}; stake ${stake.stake.toUpperCase()}: ${stake.why}`);
        const r = await exec(ctx, auto({ kind: 'bet', instance: c.instance, machine: c.machineId, stake: stake.stake, stakeWhy: stake.why, night: st.night, text: `bot:bet:${c.machineId}` }));
        if (r.ok) { count.bets++; bot.fails.set(c.instance, 0); } else bot.fails.set(c.instance, (bot.fails.get(c.instance) ?? 0) + 1);
        continue;
      }
      // the bets are in: bank the Watch's winnings (deposit, once per Watch), then print the Watch and ring the Bell
      if (!bot.banked.has(key)) { bot.banked.add(key); await depositFor(); continue; }
      await logWatchOnce(key);
      if (st.seated != null) await exec(ctx, auto({ kind: 'stand', text: 'stand' }));
      const r = await exec(ctx, auto({ kind: 'bell', text: 'bell' }));
      if (r.ok) count.bells++; else await sleep(300);
      continue;
    }
    await sleep(300);                                   // bell, closing, settle, collection: the game moves on by itself
  }
  rec.night = [n0, st?.night ?? null];
  rec.watch = st?.watch ?? null;
  rec.end = end;
  rec.loops = loops;
  rec.events = events;
  if (end === 'night card' && offer) { rec.offer = offer.ids; rec.cards = offer.cards; rec.have = offer.have; }   // the two cards for the script to choose from
  Object.assign(rec, count);
  rec.ok = end === 'night paid' || end === 'topside' || end === 'event' || end === 'quota met' || end === 'run over' || end === 'night card';
  if (!rec.ok) rec.reason = end;
}

/**
 * One bot bet, seated at the machine: close the tip, set the stake (pickStake's: a preset digit, or walked down to the minimum
 * with KeyZ), then the machine's round. The stake the machine holds is recorded as `bet` (`stakeOk`: it is the stake asked for).
 * Push-your-luck decisions read the machine's state between keys:
 *  - coinflip: flip; after a win, ride once while the pot is under x3.6 (COINFLIP_COLLECT_AT), then collect (KeyQ).
 *  - bigone: spin; a line win leaves a CHASE offer: chase (KeyG) only when CHASE_P is 1 in 3 or better, else collect (Space).
 *  - hilo, scratch and the rest: the recipe keys (BOT_RECIPE / BOT_RECIPE_GENERIC), then collect.
 */
/** Node: sets the stake of one bot bet on the seated machine (`stake` from pickStake). BIG arms on its first press, sets on the second. */
async function setStake(cdp, stake) {
  if (stake === 'min') { await playKeys(cdp, parseScript(Array(8).fill(BOT_MIN_STAKE).join(','))); return; }
  await pressKey(cdp, STAKE_DIGIT[stake], DEFAULT_HOLD_MS);
  if (stake === 'big') { await sleep(300); await pressKey(cdp, STAKE_DIGIT.big, DEFAULT_HOLD_MS); }   // the second press confirms (6 s window)
  await sleep(300);
}

async function botRound(ctx, s, rec) {
  const { cdp } = ctx;
  await waitRoundIdle(cdp, s.instance);     // a round still in the air (an earlier bet on this machine) takes the keys away
  await pressKey(cdp, TIP_KEY, 60);
  await sleep(300);
  await setStake(cdp, s.stake);
  rec.stake = s.stake;
  rec.stakeWhy = s.stakeWhy;
  // The stake the machine holds now (MachineBase.bet) against the one asked for: a preset's amount, or the minimum.
  const set = await evalJson(cdp, instJs(s.instance, `{ bet: m.bet ?? null, minBet: m.def?.minBet ?? null, presets: typeof m.stakePresets === 'function' ? m.stakePresets() : null }`));
  rec.bet = set?.bet ?? null;
  rec.stakeOk = set ? (s.stake === 'min' ? set.bet === set.minBet : set.bet === set.presets?.[s.stake]) : null;
  if (s.machine === 'coinflip') {
    await pressKey(cdp, 'Space', 120);
    await waitRoundIdle(cdp, s.instance, { start: true });   // the flip is in the air until its present ends (see waitRoundIdle)
    let st = await evalJson(cdp, CF_STATE_JS(s.instance));
    if (!st?.pending) decide(ctx, 'flip', st ? `no win to ride or collect (pot ${st.pot})` : 'machine not found');   // was a literal "pot 0" for any pot
    if (st?.pending) {
      const x = Math.round((st.pot / Math.max(1, st.bet)) * 10) / 10;
      if (x < COINFLIP_COLLECT_AT) {
        decide(ctx, 'ride', `won x${x} on coinflip: ride once for x${COINFLIP_COLLECT_AT}`);
        await pressKey(cdp, 'KeyR', 120);
        await waitRoundIdle(cdp, s.instance, { start: true });
        st = await evalJson(cdp, CF_STATE_JS(s.instance));
        if (!st?.pending) decide(ctx, 'ride lost', 'the ride flip lost the pot');
      }
      st = await evalJson(cdp, CF_STATE_JS(s.instance));
      if (st?.pending) {
        decide(ctx, 'collect', `pot x${Math.round((st.pot / Math.max(1, st.bet)) * 10) / 10} (target x${COINFLIP_COLLECT_AT})`);
        await pressKey(cdp, 'KeyQ', 120);
        await waitRoundIdle(cdp, s.instance, { start: true });
      }
    }
    return;
  }
  if (s.machine === 'bigone') {
    await pressKey(cdp, 'Space', 120);
    await waitRoundIdle(cdp, s.instance, { start: true });
    const st = await evalJson(cdp, BIGONE_STATE_JS(s.instance));
    if (!st?.offer) decide(ctx, 'spin', 'no line win, so no chase offer');
    if (st?.offer) {
      const chaseP = await evalJson(cdp, `(async () => (await import('/src/machines/bigone/rules.ts')).CHASE_P)()`);
      if (chaseP >= 1 / 3 - 1e-9) {
        decide(ctx, 'chase', `line win on bigone: chase at 1 in ${Math.round(1 / chaseP)} (x3 the pot), 1 in 3 or better`);
        await pressKey(cdp, 'KeyG', 120);
        await waitRoundIdle(cdp, s.instance, { start: true });
      } else decide(ctx, 'collect', `chase at 1 in ${Math.round(1 / chaseP)} is under 1 in 3`);
      const after = await evalJson(cdp, BIGONE_STATE_JS(s.instance));
      if (after?.offer) {
        decide(ctx, 'collect', 'the chase offer is still open: collect the pot');
        await pressKey(cdp, 'Space', 120);
        await waitRoundIdle(cdp, s.instance, { start: true });
      }
    }
    return;
  }
  await playKeys(cdp, parseScript(BOT_RECIPE[s.machine] ?? BOT_RECIPE_GENERIC));
}

/** Runs one parsed step (see parseRunSteps); the record `rec` is filled in as it goes. Throws on a step error. */
async function runKind(ctx, s, rec) {
  const { cdp, run } = ctx;
  switch (s.kind) {
    case 'goto': return gotoMachine(ctx, s.hot ? { hot: true } : s.machine, rec);
    case 'nightcard': {
      // Night Card <n> (1-based), or `best` (the highest expected value, see CARD_EV and summarizeOffer). The offer's id at that
      // index goes to run.pickNightCard(id). The record keeps the offer: `offer` (the ids), `cards` (each with its preview lines
      // and EV), `index`, `id`; for `best` also `best`, `mode` (ahead / behind / unknown) and `why` (the reason).
      rec.card = s.best ? 'best' : s.n;
      const before = await evaluate(cdp, REFUSAL_JS);
      const o = await evalJson(cdp, NIGHT_CARD_OFFER_JS);
      if (o.missing) { rec.ok = false; rec.reason = 'no Night Card on this build (run.pickNightCard is missing)'; return; }
      const sum = summarizeOffer(o);
      rec.offer = sum?.ids ?? null;
      rec.cards = sum?.cards ?? null;
      if (sum) logOffer(sum, `nightcard:${s.best ? 'best' : s.n}`);
      const card = sum ? sum.cards[(s.best ? sum.best : s.n) - 1] ?? null : null;
      if (s.best) { rec.best = sum?.best ?? null; rec.mode = sum?.mode ?? null; rec.why = sum?.reason ?? null; }
      rec.index = card?.index ?? null;
      rec.id = card?.id ?? null;
      rec.ok = card ? (await evalJson(cdp, pickNightCardJs(card.id))) === true : false;
      if (!rec.ok) {
        rec.reason = 'refused (no Night Card offer open, or the card is not in it)';
        noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      }
      return;
    }
    case 'play':
      rec.bets = [];
      for (let i = 0; i < s.n; i++) {
        if (i > 0 && await evaluate(cdp, RUN_OVER_JS)) { rec.note = `run over after ${i} of ${s.n}`; break; }   // no repeat after the end
        const n0 = await evaluate(cdp, BET_COUNT_JS);
        await playKeys(cdp, s.keys);
        rec.bets.push(...(await evalJson(cdp, betsFrom(n0))));
      }
      rec.n = s.n;
      return;
    case 'bet': {
      rec.night = s.night ?? null;
      const before = (await readState(ctx)).pulls;
      await gotoMachine(ctx, { instance: s.instance }, rec);
      const mode = await evaluate(cdp, 'window.jackid.app.input?.mode');
      if (mode !== 'machine') { rec.ok = false; rec.reason = `not at the machine for input (input mode "${mode}"); no keys sent`; return; }
      const n0 = await evaluate(cdp, BET_COUNT_JS);
      await botRound(ctx, s, rec);
      rec.bets = await evalJson(cdp, betsFrom(n0));
      const after = (await readState(ctx)).pulls;
      rec.machine = s.machine;
      rec.pulls = [before, after];
      rec.ok = before == null || after == null || after < before;
      if (!rec.ok) rec.reason = 'no pull spent (refused, or the stake or pocket was short)';
      return;
    }
    case 'stand':
      await evaluate(cdp, '(window.jackid.app.world.standUp(), true)');
      await seatedIs(ctx, false, 4000).catch(() => { rec.ok = false; rec.reason = 'still seated (the round may be settling)'; });
      return;
    case 'deposit': {
      rec.amount = s.amount;
      const before = await evaluate(cdp, REFUSAL_JS);
      rec.ok = (await evaluate(cdp, `window.jackid.app.run.deposit(${s.amount}) === true`)) === true;
      if (!rec.ok) {
        rec.reason = 'refused (pocket floor, quota room, or not a quota Watch)';
        noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      }
      return;
    }
    case 'withdraw': {
      rec.amount = s.amount;
      const before = await evaluate(cdp, REFUSAL_JS);
      rec.ok = Number(await evaluate(cdp, `window.jackid.app.run.withdraw(${s.amount})`)) > 0;
      if (!rec.ok) {
        rec.reason = 'refused (window shut, or nothing in the bank)';
        noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      }
      return;
    }
    case 'lever': {
      const before = await evaluate(cdp, REFUSAL_JS);
      rec.lever = await evaluate(cdp, `(() => { const r = window.jackid.app.run; return r.openFloor() ? 'openFloor'
        : r.startWatch() ? 'startWatch' : r.settleEarly() ? 'settleEarly' : null; })()`);
      rec.ok = rec.lever !== null;
      if (!rec.ok) noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      return;
    }
    case 'bell': {
      const before = await evaluate(cdp, REFUSAL_JS);
      rec.ok = (await evaluate(cdp, 'window.jackid.app.run.ringBell() === true')) === true;
      if (!rec.ok) {
        rec.reason = 'refused (no Watch in play or Last Call, or the run ended)';
        noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      }
      return;
    }
    case 'pawn': {
      const before = await evaluate(cdp, REFUSAL_JS);
      rec.ok = (await evaluate(cdp, 'window.jackid.app.run.pawn.reroll() === true')) === true;
      if (!rec.ok) noteRefusal(rec, before, await evaluate(cdp, REFUSAL_JS));
      return;
    }
    case 'pawnbuy': return pawnBuy(ctx, s.slot, rec);
    case 'pawnlook': return pawnLook(ctx, rec);
    case 'auto': return autoNight(ctx, rec, s.stopAt ?? null);
    case 'events': {
      const ev = await evalJson(cdp, EVENT_JS);
      rec.event = ev;
      ctx.eventAnnounce = ev ? await evalJson(cdp, ANNOUNCE_JS(ev.id)) : null;
      rec.announce = ctx.eventAnnounce;
      log(`event: ${evText(ev)}${ctx.eventAnnounce ? ` · '${ctx.eventAnnounce}'` : ''}`);
      return;
    }
    case 'banner': {   // polls the page text for the live event's announce line; shoots it the moment it shows
      rec.text = ctx.eventAnnounce ?? null;
      if (!ctx.eventAnnounce) { rec.ok = false; rec.reason = 'no live event (run events first)'; return; }
      // A banner is a `.t-banner` whose letters are spans (dropLetters), so compare its textContent with the spaces dropped.
      const squash = (x) => x.toUpperCase().replace(/\s+/g, '');
      const want = JSON.stringify(squash(ctx.eventAnnounce));
      const onPage = `[...document.querySelectorAll('.t-banner')].map((e) => e.textContent).join('|').toUpperCase().replace(/\\s+/g, '').includes(${want})`;
      const t0 = nowMs();
      let seen = false;
      while (!seen && nowMs() - t0 < s.ms) {
        seen = (await evaluate(cdp, onPage)) === true;
        if (!seen) await sleep(100);
      }
      rec.waited = nowMs() - t0;
      rec.ok = seen;
      if (seen) { if (ctx.shotsDir) rec.shot = await ctx.shoot('banner-seen.png'); }
      else {
        rec.reason = `announce line not on the page within ${s.ms} ms`;
        rec.banners = await evalJson(cdp, `[...document.querySelectorAll('.t-banner')].map((e) => e.textContent.slice(0, 80))`);
      }
      return;
    }
    case 'shot': {
      if (!ctx.shotsDir) { rec.ok = false; rec.reason = 'no --shots dir'; return; }
      rec.shot = await ctx.shoot(`${s.name}.png`);
      return;
    }
    case 'wait':
      await sleep(s.ms);
      return;
    case 'state': {
      const st = await readState(ctx);
      run.states.push(st);
      rec.state = st;
      log(`state: ${JSON.stringify(st)}`);
      return;
    }
    default: throw new Error(`unknown run step ${s.kind}`);
  }
}

/**
 * Runs one step as a record in `run.steps` (pushed first, so a macro's own records follow it). A step that throws
 * (a goto to a locked machine, a seat that does not take) is recorded with `ok: false` and `error`; the caller goes on.
 */
async function exec(ctx, s) {
  const t0 = nowMs();
  const rec = { step: s.text, ok: true };
  if (s.auto) rec.auto = true;
  ctx.run.steps.push(rec);
  try { await runKind(ctx, s, rec); } catch (e) { rec.ok = false; rec.error = String(e?.message ?? e); }
  rec.ms = nowMs() - t0;
  log(`run ${s.text}: ${rec.error ? `error (${rec.error})` : rec.ok ? 'ok' : 'refused'} (${rec.ms} ms)`);
  return rec;
}

/**
 * Runs the parsed --run steps in order. Every step gets its record, failed ones included, and the steps go on. Only a
 * page reload stops the list (`run.aborted`: the run is then invalid, see viteEvents).
 */
async function driveRun(ctx, steps) {
  await evaluate(ctx.cdp, BET_TAP_JS);
  for (let i = 0; i < steps.length; i++) {
    // The run has ended (or is gone): every remaining step is skipped, with one note for all of them.
    if (await evaluate(ctx.cdp, RUN_OVER_JS)) {
      const skipped = steps.slice(i).map((x) => x.text);
      ctx.run.steps.push({ step: 'run over', ok: true, note: `run over: skipped ${skipped.length} remaining step(s)`, skipped });
      log(`run over: skipped ${skipped.length} remaining step(s) (${skipped.join('; ')})`);
      break;
    }
    // auto:night looks here: a following nightcard step picks the Dawn offer, not the bot. Read-only steps (state, shot, events,
    // wait, banner) between them do not count, so `auto:night;state;nightcard:best` still hands the offer to the step.
    ctx.next = steps.slice(i + 1).find((x) => !READ_ONLY_KINDS.has(x.kind)) ?? null;
    await exec(ctx, steps[i]);
    if (ctx.res.reloads) { ctx.run.aborted = `the page reloaded after "${steps[i].text}" (the run is invalid, see viteEvents)`; break; }
  }
  ctx.run.failed = ctx.run.steps.filter((r) => r.ok === false && !r.auto).length;
}

/**
 * The per-Night summary (`run.nights`, one entry per Night the run reached), from the state reads (noteNight) and the bot's
 * bet records: quota (the Night's due), bank (the last read), met (the quota met at some read), paid (the Night was paid),
 * overshoot (the highest OVERSHOOT tier reached), card (the Night Card picked for it), events (the floor events read in its
 * Watches), charms (the owned charms at its last read) and stakes (the bets that spent a pull, by stake: safe, bold, big, min).
 */
function nightSummaries(ctx) {
  const acc = ctx.nights ?? new Map();
  return [...acc.keys()].sort((x, y) => x - y).map((night) => {
    const a = acc.get(night);
    const stakes = {};
    for (const r of ctx.run.steps) if (r.night === night && r.ok && r.stake) stakes[r.stake] = (stakes[r.stake] ?? 0) + 1;
    return { night, quota: a.quota, bank: a.bank, met: a.met, paid: a.paid, overshoot: a.overshoot, card: a.card, events: [...a.events], charms: a.charms ?? [], stakes };
  });
}

/** One stderr line per Night of nightSummaries. */
function nightLine(n) {
  const stakes = Object.entries(n.stakes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  return `night ${n.night}: quota ${n.quota ?? '-'}, bank ${n.bank ?? '-'} (${n.met ? 'met' : 'not met'}), ${n.paid ? 'paid' : 'not paid'}, `
    + `overshoot ${n.overshoot ?? 'none'}, card ${n.card ?? 'none'}, events ${n.events.join(', ') || 'none'}, `
    + `charms ${n.charms.join(', ') || 'none'}, stakes ${stakes}`;
}

/**
 * Runs `script` (see parseScript) `rounds` times against machine `machine` in a fresh bench room. Each round is one
 * pass of the script, followed by a screenshot when `shots` is set.
 * @returns {Promise<{machine:string, seed:number, rounds:number, roundLog:object[], consoleErrors:number,
 *   errors:string[], shots:string[], state:string, framesPerSec:number, cleanup:object}>}
 */
export async function runBench(opts = {}) {
  const parsedRun = opts.run === undefined ? null : parseRunSteps(opts.run);   // --run: a debt run driven by steps
  const startSpec = parsedRun ? startSpecOf(parsedRun) : null;                  // kit / stake / daily: applied at run start
  const runSteps = parsedRun ? parsedRun.filter((s) => !START_KINDS.has(s.kind)) : null;
  const realTime = Boolean(opts.realTime);                  // --real-time: wall-clock page (no fixed step, no manual clock)
  const world = Boolean(opts.world) || runSteps !== null;   // a real debt run (`/?skipmenu=1`), not a bench room
  const menu = Boolean(opts.menu);                          // `/`: the main menu; the script keys drive the die
  if (menu && (world || opts.sit || opts.force !== undefined || opts.machine !== undefined)) {
    throw new Error('--menu boots the main menu on its own: drop --machine, --world, --run, --sit, --force');
  }
  const machine = String(opts.machine ?? (world ? 'run' : menu ? 'menu' : ''));
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
    // vite.bench.config.mjs = the root config with HMR and the src watcher off: an edit made mid-run must not reload the page
    vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config', join(ROOT, 'scripts', 'qa', 'vite.bench.config.mjs'),
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

    // 2) Headless Chrome: free debugging port, temp profile, 1280x720 (or --size WxH).
    const [vw, vh] = opts.size ? String(opts.size).toLowerCase().split('x').map(Number) : [1280, 720];
    if (!(vw > 0 && vh > 0)) throw new Error(`--size expects WxH, got ${opts.size}`);
    dport = await freePort();
    profile = mkdtempSync(join(tmpdir(), 'jackid-qa-'));
    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, '--mute-audio', `--window-size=${vw},${vh}`,
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
      if (method === 'Page.frameNavigated' && !p.frame?.parentId) { loads++; if (loads > 1) { res.reloads = loads - 1; pageReloads = res.reloads; } }
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });

    // 3) Bench room: boot veil (Enter), then the game is on screen and rAF is advancing.
    // --query "lang=tr" appends extra boot params (bootParams: lang); the HUD caches its strings, so the language must be set at boot.
    const extra = opts.query ? `&${String(opts.query).replace(/^[?&]+/, '')}` : '';
    // The fixed-step manual clock (default): the page moves only when this harness steps it, so waits and budgets are sim time.
    const fixed = realTime ? '' : '&fixedstep=1&clock=manual';
    const url = menu ? `/?seed=${seed}${extra}${fixed}` : world ? `/?skipmenu=1&seed=${seed}${extra}${fixed}` : `/?bench=${machine}&seed=${seed}${extra}${fixed}`;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${vport}${url}` });
    await waitFor(() => evaluate(cdp, 'typeof window.jackid === "object"'), READY_TIMEOUT_MS, 'window.jackid');
    // --run start config (kit / stake / daily): wrapped before the veil is entered, so the run starts with it.
    const startRec = startSpec ? await evalJson(cdp, startConfigJs(startSpec)) : null;
    if (startRec && !startRec.ok) throw new Error(`--run start config: ${startRec.error}`);
    if (startRec) log(`start config: kit ${startRec.kit}, stake ${startRec.stake}${startRec.daily ? ' (daily)' : ''}`);
    await evaluate(cdp, 'window.__qaFrames = 0; (function f() { window.__qaFrames++; requestAnimationFrame(f); })(); true');
    // Counts the key events the page takes (capture phase: before any game handler), for sendKey's wait.
    await evaluate(cdp, 'window.__qaKeys = { down: 0, up: 0 }; '
      + "window.addEventListener('keydown', () => { window.__qaKeys.down++; }, true); "
      + "window.addEventListener('keyup', () => { window.__qaKeys.up++; }, true); true");
    const stateOf = () => evaluate(cdp, 'String((() => { const s = window.jackid.state(); return typeof s === "string" ? s : (s && (s.name ?? s.id ?? s.kind)) ?? JSON.stringify(s); })())');
    // The veil appears after boot and takes Enter; keep pressing it until the room has started.
    const enterVeil = async () => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 });
    };
    // --menu: the veil is dismissed by a real mouse press at its centre (the menu is already the state, so the Enter loop
    // below would stop before the veil is gone); the veil then has to be off the page before the menu counts as ready.
    const readyState = menu ? 'menu' : 'ingame';
    const veilUp = () => evaluate(cdp, 'Boolean(document.querySelector(".veil"))');
    const pressVeil = async () => {
      if (!menu) return enterVeil();
      if (!(await veilUp())) return;
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button: 'left', clickCount: 1 });
      }
    };
    await waitFor(async () => { await pressVeil(); await sleep(700); return (await stateOf()).includes(readyState) && (!menu || !(await veilUp())); }, READY_TIMEOUT_MS, `${readyState} state`)
      .catch(async (e) => { throw new Error(`${e.message} (state: ${await stateOf().catch(() => '?')})`); });
    // The page is ready. With the manual clock it moves only from here on: every sleep() steps it (see stepFrames).
    if (!realTime) {
      if (!(await evaluate(cdp, 'typeof window.__qaClock === "object"'))) {
        throw new Error('no window.__qaClock: the fixed-step clock is DEV-only (run the Vite dev server), or pass --real-time');
      }
      await evaluate(cdp, PRELOAD_JS);                   // real time, before any frame is stepped: no page expression waits on the network later
      clock.step = (ms) => stepFrames(cdp, ms);
      clock.frames = 0;
    }
    await sleep(1500);                                   // room settles: camera, first frames
    const f0 = await framesOf(cdp);
    await sleep(1000);
    const f1 = await framesOf(cdp);
    res.framesPerSec = f1 - f0;
    if (res.framesPerSec <= 0) throw new Error('rendering did not advance (rAF frames stalled)');
    res.state = await stateOf();
    log(`in game (${res.state}), ${res.framesPerSec} fps`);
    if (runSteps) {                                       // --run: the intro is skipped with a Space tap before any step
      res.run = { intro: await skipIntro(cdp), steps: [], states: [], shot: null, failed: 0, aborted: null, start: startRec };
      log(`intro: played ${res.run.intro.played}, Space taps ${res.run.intro.taps}`);
      if (startRec) res.run.steps.push({ step: startSpec.text, ok: true, start: true, kit: startRec.kit, stake: startRec.stake, daily: startRec.daily, gated: startRec.gated });
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
      // the script's first key. TIP_KEY (Digit0) is the neutral press that closes it; it is sent only while the placard is up.
      if (await evaluate(cdp, 'Boolean(window.jackid.bench.main?.m?.seatHud?.blocking)')) {
        await pressKey(cdp, TIP_KEY, DEFAULT_HOLD_MS);
        await sleep(600);
        log(`first-sit tip closed (${TIP_KEY})`);
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
      const ctx = { cdp, res, run: res.run, shoot, shotsDir, looks: 0, seed };
      await driveRun(ctx, runSteps);
      res.run.nights = nightSummaries(ctx);   // the per-Night summary: quota, paid, overshoot, card, events, charms, stakes
      for (const n of res.run.nights) log(nightLine(n));
      if (shotsDir) res.run.shot = await shoot('run-final.png');
    }

    // 4) Rounds: one pass of the script per round, then a screenshot. With --sit, the wallet and wagered are read
    //    before and after each pass.
    for (let r = 1; r <= (runSteps ? 0 : rounds); r++) {
      const before = await framesOf(cdp);
      const m0 = sit ? await money() : null;
      const t0 = nowMs();
      let lastKeyUp = t0;
      // With --frames, the waits after the last key are the frame timeline (see below), so they are not slept here.
      const lastKey = steps.reduce((acc, s, i) => (s.kind === 'key' ? i : acc), -1);
      const trailing = frames.length ? steps.slice(lastKey + 1).reduce((a, s) => a + s.ms, 0) : 0;
      for (const [i, s] of steps.entries()) {
        if (frames.length && i > lastKey) break;
        if (s.kind === 'wait') { await sleep(s.ms); continue; }
        await pressKey(cdp, s.code, s.ms);
        lastKeyUp = nowMs();
      }
      const entry = { round: r, ms: nowMs() - t0, frames: (await framesOf(cdp)) - before };
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
          if (due > nowMs()) await sleep(due - nowMs());
          await nextFrame(cdp);
          const at = nowMs() - lastKeyUp;
          const name = rounds > 1 ? `${machine}-round${r}-f${ms}.png` : `${machine}-f${ms}.png`;
          entry.frameShots.push({ ms, actualMs: at, shot: await shoot(name) });
        }
        const end = lastKeyUp + Math.max(trailing, frames[frames.length - 1]);
        if (end > nowMs()) await sleep(end - nowMs());
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
    // 5) Cleanup: everything we started, nothing else. The clock goes back to wall time first (the waits below are real).
    clock.step = null;
    clock.frames = 0;
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
const USAGE = 'usage: node scripts/qa/bench.mjs (--machine <id> | --world | --menu | --run "<steps>") [--script "Space:200,wait:1500,KeyX"] [--shots <dir>] '
  + '[--frames "300,1200"] [--probe "<js>"] [--js "<js>"] [--rounds <n>] [--seed <n>] [--sit [--seat <n>] [--force "<id>:<state>"]] [--walk-view]';

function parseArgs(argv) {
  const o = {};
  const flags = {
    '--machine': 'machine', '--script': 'script', '--shots': 'shots', '--rounds': 'rounds', '--seed': 'seed', '--seat': 'seat',
    '--settle': 'settle', '--frames': 'frames', '--probe': 'probe', '--js': 'js', '--force': 'force', '--run': 'run', '--query': 'query', '--size': 'size',
  };
  const switches = { '--sit': 'sit', '--walk-view': 'walkView', '--world': 'world', '--menu': 'menu', '--real-time': 'realTime' };
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
    // The JSON is written once, after runBench has resolved (the steps finished, or the run ended and the rest was
    // skipped, and the cleanup ran). Exit only after the write has flushed, so a piped output is never cut short.
    let code = 0, out;
    try {
      const o = parseArgs(process.argv.slice(2));
      if (o.help || (!o.machine && !o.world && !o.menu && o.run === undefined)) { process.stderr.write(USAGE + '\n'); process.exit(o.help ? 0 : 2); }
      const result = await runBench(o);
      out = result;
      if (result.run?.aborted) code = 1;                 // steps that failed are in the JSON; a reload invalidates the run
    } catch (e) {
      code = 1;
      out = { error: String(e?.message ?? e) };
      // a page reload (vite full reload, dependency re-optimise) makes most errors read as a missing bench hook: name it
      if (pageReloads) out.error = `the page reloaded ${pageReloads}x during the run (the veil came back): the run is invalid, rerun it. Was: ${out.error}`;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n', () => process.exit(code));
  })();
}
