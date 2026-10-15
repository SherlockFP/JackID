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
const PAWN_SLOTS_MAX = 6;   // charm_vendor SLOTS_MAX: 4 shelves plus up to 2 Second Window extras
const STAKE_MAX = 7;       // stakes.ts STAKE_MAX
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
 *   goto:hot           the same, for the Hot cabinet (the first Hot Lamp lit now, run.circuit.lamps().hot[0])
 *   nightcard:<1|2>    pick Night Card <1|2> of the offer: the id at that index of run.nightCardOffer().candidates goes to run.pickNightCard(id)
 *   play:<keys>xN      press the keys (parseScript syntax, e.g. play:Space:150,wait:300x3), N times (default 1)
 *   stand              stand up from the seat
 *   bank:deposit:<n>   Debt Terminal deposit of n coins (run.deposit)
 *   bank:withdraw:<n>  take n coins back from the bank into the pocket (run.withdraw, the broke path)
 *   lever              the terminal lever the run accepts now: OPEN THE FLOOR, else the Bell, else SETTLE
 *   bell               ring the Bell early (run.ringBell: ends the Watch while playing or Last Call, unused pulls rebate)
 *   pawn               one Pawn Window reroll (Intermission only)
 *   pawn:buy:<slot>    buy Pawn Window shelf <slot> (1-6, 1-based): sits there, the shelf key, Space twice
 *   pawn:look          sit at the Pawn Window, screenshot the seat view (run-pawn-look-<n>.png)
 *   auto:night         a bot plays one Night (deposit 40 %, shop, lever, rotating coin bets, Bell); prints each Watch's state
 *   auto:night:event   the same, but stops at the first Watch with a floor event (shot it, then auto:night carries on)
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
    if (tok === 'auto:night:event') { out.push({ kind: 'auto', untilEvent: true, text: tok }); continue; }
    let m0 = /^shot:([A-Za-z0-9_-]{1,60})$/.exec(tok);
    if (m0) { out.push({ kind: 'shot', name: m0[1], text: tok }); continue; }
    m0 = /^banner:(\d+)$/.exec(tok);
    if (m0) { out.push({ kind: 'banner', ms: Number(m0[1]), text: tok }); continue; }
      if (tok === 'goto:hot') { out.push({ kind: 'goto', hot: true, text: tok }); continue; }
    m0 = /^nightcard:([12])$/.exec(tok);
    if (m0) { out.push({ kind: 'nightcard', n: Number(m0[1]), text: tok }); continue; }
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
    throw new Error(`bad --run step "${tok}" (goto:<id> | goto:hot | nightcard:<1|2> | play:<keys>xN | stand | bank:deposit:<n> | bank:withdraw:<n> | lever | bell | pawn | pawn:buy:<slot> | pawn:look | auto:night | auto:night:event | events | banner:<ms> | shot:<name> | wait:<ms> | state | kit:<id> | stake:<n> | daily)`);
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
 * Page JS helper (inlined into the page scripts): the ids of the open Night Card offer, in offer order (card 1 first), or null
 * when no offer is open. run.nightCardOffer() returns { candidates: NightCardDef[], left, night }, so the ids are read from it.
 */
const NIGHT_CARD_IDS_JS = `function nightCardIds(r) {
  const o = r.nightCardOffer?.();
  return o && Array.isArray(o.candidates) && o.candidates.length ? o.candidates.map((c) => c.id) : null;
}`;

/**
 * Page JS: Night Card <n> (1-based) of the open offer. The offer's id at that index goes to run.pickNightCard(id) (it takes the
 * id, not the index). Resolves to { missing, ok, offer (ids or null), card (the id picked or null) }.
 */
function pickNightCardJs(n) {
  return `(() => {
    ${NIGHT_CARD_IDS_JS}
    const r = window.jackid.app.run;
    if (!r) return { missing: false, ok: false, offer: null, card: null };
    if (typeof r.pickNightCard !== 'function') return { missing: true, ok: false, offer: null, card: null };
    const offer = nightCardIds(r);
    const id = offer?.[${n - 1}] ?? null;
    return { missing: false, ok: id != null && r.pickNightCard(id) === true, offer, card: id };
  })()`;
}

/** Page JS: the debt run's state, for `state`, the step records and the auto:night loop. Watch and Night are 1-based. */
const RUN_STATE_JS = `(async () => {
  ${NIGHT_CARD_IDS_JS}
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

/** The floor machines the auto:night bot bets on, in rotation (the open ones only, see OPEN_BOT_JS). */
const BOT_MACHINES = ['coinflip', 'hilo', 'scratch', 'bigone'];
/** Page JS: the BOT_MACHINES that are placed and unlocked on the floor now, in rotation order. */
const OPEN_BOT_JS = `(() => {
  const w = window.jackid.app.world, ids = ${JSON.stringify(BOT_MACHINES)};
  if (!w) return [];
  const open = new Set(w.machines().filter((m) => !w.isLocked(m.id)).map((m) => m.def.id));
  return ids.filter((id) => open.has(id));
})()`;
/**
 * One coin bet per machine, as keys: close the first-sit tip (Digit0, a neutral key: Digit7/8/9 are the SAFE/BOLD/BIG stake
 * presets, and Digit9 would arm BIG), walk the stake down to the minimum (KeyZ), then place the bet and collect it (KeyQ).
 */
const BOT_RECIPE = {
  coinflip: 'Space:120,wait:2600,KeyQ:120,wait:500',
  hilo: 'Space:120,wait:1200,Digit1:120,wait:1500,KeyQ:120,wait:500',
  scratch: 'Space:120,wait:1500,Space:120,wait:1800,KeyQ:120,wait:500',
  bigone: 'Space:120,wait:3200,KeyQ:120,wait:500',
};
const BOT_MIN_STAKE = 'KeyZ:60,wait:120';
const TIP_KEY = 'Digit0';   // the neutral press that closes a first-sit tip (any key does; not a stake preset)
const botKeys = (machine) => parseScript(`${TIP_KEY}:60,wait:300,${Array(8).fill(BOT_MIN_STAKE).join(',')},${BOT_RECIPE[machine]}`);

const AUTO_MAX_MS = 15 * 60_000;   // auto:night stops after this much wall time (the run is left where it is)
const AUTO_MAX_LOOPS = 4000;
const AUTO_LEVER_FAILS = 6;        // lever refused this many times in a row: the Night cannot move on

/** Reads the debt-run state (RUN_STATE_JS). */
const readState = (ctx) => evalJson(ctx.cdp, RUN_STATE_JS);

const seatedIs = (ctx, want, ms) => waitFor(
  async () => (await evaluate(ctx.cdp, 'window.jackid.app.player?.seat != null')) === want, ms, want ? 'a seat' : 'standing up');

/**
 * The `goto` step: teleport in front of the first unlocked floor machine (`machine`, a machine id), or of the Hot cabinet
 * (`{ hot: true }`), face it, press E (devtools occupy as the fallback).
 */
async function gotoMachine(ctx, machine, rec) {
  const { cdp } = ctx;
  const sel = typeof machine === 'string' ? { machine } : { hot: true };
  const label = typeof machine === 'string' ? machine : 'hot';
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

/** auto:night's shop pick: the cheapest clean shelf (not cursed, no swap) costing at most 30 % of the pocket. */
async function shopPick(ctx) {
  const b = await evalJson(ctx.cdp, PAWN_JS);
  if (!b.open) return null;
  let best = null;
  b.stock.forEach((s, i) => {
    if (!s || s.cursed || s.swap || s.price <= 0 || s.price > b.wallet * 0.3) return;
    if (!best || s.price < best.price) best = { slot: i + 1, price: s.price };
  });
  return best;
}

/** The live floor event (watchEvents.ts `watchEventView`), or null between Watches. */
const EVENT_JS = `(await import('/src/game/watchEvents.ts')).watchEventView()`;
/** The event's announce line as the banner shows it (the bus id is watch.<id>, its strings are event.watch.<id>.*). */
const ANNOUNCE_JS = (id) => `(async () => (await import('/src/core/i18n.ts')).t(${JSON.stringify('event.watch.' + id + '.announce')}, { suit: '' }))()`;
const evText = (ev) => (ev ? `${ev.id} (${Math.ceil(ev.leftS)} s${ev.pulls == null ? '' : `, ${ev.pulls} pulls`})` : 'none');

/** One per-Watch line: pocket, bank, quota and the floor event. Logged, and kept as an `auto: true` record in run.steps. */
function watchRec(ctx, st, ev) {
  ctx.run.steps.push({
    step: `watch ${st.night}-${st.watch}`, ok: true, auto: true, night: st.night, watch: st.watch, pocket: st.pocket,
    bank: st.bank, quotaDue: st.quotaDue, quotaLeft: st.quotaLeft, event: ev?.id ?? null,
  });
  log(`watch N${st.night} W${st.watch}: pocket ${st.pocket}, bank ${st.bank}, quota due ${st.quotaDue} left ${st.quotaLeft}, event ${evText(ev)}`);
}

/**
 * `auto:night`: a sensible bot plays one Night. Per Watch: shop the cheapest affordable shelf in the intermission, then
 * lever (starts the Watch). In play: 1 bet on odd Watches, 2 on even ones, rotating over the open machines. Once the bets
 * are in, the bot deposits 40 % of the pocket (20 % when refused) while quota is owed, so the Watch's winnings are banked
 * before the Bell; then the Bell (unused pulls keep the rebate). A broke pocket withdraws the bank first.
 * Each Watch's state (pocket, bank, quota, floor event) is printed once, at its Bell. `untilEvent`
 * (`auto:night:event`) stops at the first Watch that has a floor event, so the event can be shot; a later auto:night carries on.
 * Ends when the Night rolls over (OPEN THE FLOOR), the run is over, or it reaches the top. Each action is its own record
 * (`auto: true`), in order, before the summary record.
 */
async function autoNight(ctx, rec, untilEvent = false) {
  const { res } = ctx;
  const t0 = Date.now();
  const auto = (o) => ({ ...o, auto: true });
  // Per-Watch bookkeeping lives on the run, so a second auto:night step carries on where an event stop left the Watch.
  const bot = (ctx.bot ??= { betsTried: new Map(), handled: new Set(), banked: new Set(), logged: new Set(), evStop: new Set(), rot: 0 });
  const n0 = (await readState(ctx)).night;
  const count = { deposits: 0, shops: 0, bets: 0, bells: 0 };
  const events = [];                    // ids of the floor events of the Watches this call reached
  let leverFails = 0, loops = 0, end = null, st = null;
  /** A Watch's state, printed once (at its Bell, so the pocket is the one the Watch ends with). */
  const logWatchOnce = async (key) => {
    if (bot.logged.has(key)) return;
    bot.logged.add(key);
    const ev = await evalJson(ctx.cdp, EVENT_JS);
    watchRec(ctx, await readState(ctx), ev);
    if (ev) events.push(ev.id);
  };
  /** This Watch's deposit: 40 % of the pocket while quota is owed (20 % when the terminal refuses it). Once per Watch, after the bets. */
  const depositFor = async (s) => {
    if (!(s.quotaLeft > 0 && s.pocket > 0)) return;
    for (const pct of [0.4, 0.2]) {
      const amount = Math.floor(s.pocket * pct);
      if (amount <= 0) return;
      const r = await exec(ctx, auto({ kind: 'deposit', amount, text: `bank:deposit:${amount}` }));
      if (r.ok) { count.deposits++; return; }
    }
  };
  while (!end) {
    if (++loops > AUTO_MAX_LOOPS) { end = 'loop budget'; break; }
    if (Date.now() - t0 > AUTO_MAX_MS) { end = 'time budget'; break; }
    if (res.reloads) { end = 'page reloaded'; break; }
    st = await readState(ctx);
    if (st.over) { end = 'run over'; break; }
    if (st.topside) { end = 'topside'; break; }
    if (st.night !== n0) { end = 'night paid'; break; }
    const key = `${st.night}:${st.watch}`;

    if (st.pocket < st.minBet && st.withdrawable > 0) {
      const r = await exec(ctx, auto({ kind: 'withdraw', amount: st.withdrawable, text: `bank:withdraw:${st.withdrawable}` }));
      if (!r.ok) await sleep(300);
      continue;
    }
    // The first Watch of a Night starts with the intro (no intermission before it): its deposit is taken in the Bell or play.
    if (st.phase === 'bell' || st.phase === 'play' || st.phase === 'lastCall') {
      // --event: stop at the Watch's floor event (no cutscene up, so its banner and HUD timer are on screen), before the bets.
      if (untilEvent && !bot.evStop.has(key) && st.intro == null) {
        const ev = await evalJson(ctx.cdp, EVENT_JS);
        if (ev) { bot.evStop.add(key); events.push(ev.id); end = 'event'; break; }
      }
      if (st.phase === 'bell') await logWatchOnce(key);   // the Bell is already rung (not by this bot's own play)
    }
    if (st.phase === 'intermission') {
      if (st.nightCardOffer) {
        // A paid Dawn opened a Night Card offer (the lever waits on it). The bot pauses here: when the script's next step is
        // nightcard:<n>, that step picks; otherwise the bot picks card 1 itself, and logs it.
        if (ctx.next?.kind === 'nightcard') { end = 'night card'; break; }
        const r = await exec(ctx, auto({ kind: 'nightcard', n: 1, text: 'nightcard:1' }));
        log(`auto:night: Dawn Night Card offer ${JSON.stringify(st.nightCardOffer)}: the script did not pick one, auto-picked card 1 (${r.id ?? 'none'})`);
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
        if (pick) {
          const r = await exec(ctx, auto({ kind: 'pawnbuy', slot: pick.slot, text: `pawn:buy:${pick.slot}` }));
          if (r.ok) count.shops++;
          await exec(ctx, auto({ kind: 'stand', text: 'stand' }));
        }
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
      const bets = st.watch % 2 === 1 ? 1 : 2;
      if (tried < bets && (st.pulls ?? Infinity) > 0 && st.pocket >= st.minBet) {
        bot.betsTried.set(key, tried + 1);
        const open = await evalJson(ctx.cdp, OPEN_BOT_JS);
        if (open.length === 0) { bot.betsTried.set(key, bets); continue; }   // nothing open to bet on: ring the Bell below
        const machine = open[bot.rot % open.length];
        bot.rot++;
        const r = await exec(ctx, auto({ kind: 'bet', machine, text: `bot:bet:${machine}` }));
        if (r.ok) count.bets++;
        continue;
      }
      // the bets are in: bank the Watch's winnings (deposit, once per Watch), then print the Watch and ring the Bell
      if (!bot.banked.has(key)) { bot.banked.add(key); await depositFor(st); continue; }
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
  Object.assign(rec, count);
  rec.ok = end === 'night paid' || end === 'topside' || end === 'event' || end === 'run over' || end === 'night card';
  if (!rec.ok) rec.reason = end;
}

/** Runs one parsed step (see parseRunSteps); the record `rec` is filled in as it goes. Throws on a step error. */
async function runKind(ctx, s, rec) {
  const { cdp, run } = ctx;
  switch (s.kind) {
    case 'goto': return gotoMachine(ctx, s.hot ? { hot: true } : s.machine, rec);
    case 'nightcard': {
      // Night Card <n> (1-based) of the offer. The run contract: nightCardOffer() (ids or null), pickNightCard(n) (boolean).
      rec.card = s.n;
      const before = await evaluate(cdp, REFUSAL_JS);
      const res = await evalJson(cdp, pickNightCardJs(s.n));
      rec.offer = res.offer;
      rec.id = res.card ?? null;
      rec.ok = res.ok;
      if (res.missing) { rec.ok = false; rec.reason = 'no Night Card on this build (run.pickNightCard is missing)'; return; }
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
      const before = (await readState(ctx)).pulls;
      await gotoMachine(ctx, s.machine, rec);
      const mode = await evaluate(cdp, 'window.jackid.app.input?.mode');
      if (mode !== 'machine') { rec.ok = false; rec.reason = `not at the machine for input (input mode "${mode}"); no keys sent`; return; }
      const n0 = await evaluate(cdp, BET_COUNT_JS);
      await playKeys(cdp, botKeys(s.machine));
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
    case 'auto': return autoNight(ctx, rec, s.untilEvent === true);
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
      const t0 = Date.now();
      let seen = false;
      while (!seen && Date.now() - t0 < s.ms) {
        seen = (await evaluate(cdp, onPage)) === true;
        if (!seen) await sleep(100);
      }
      rec.waited = Date.now() - t0;
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
  const t0 = Date.now();
  const rec = { step: s.text, ok: true };
  if (s.auto) rec.auto = true;
  ctx.run.steps.push(rec);
  try { await runKind(ctx, s, rec); } catch (e) { rec.ok = false; rec.error = String(e?.message ?? e); }
  rec.ms = Date.now() - t0;
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
    ctx.next = steps[i + 1] ?? null;   // auto:night looks here: a following nightcard step picks the Dawn offer, not the bot
    await exec(ctx, steps[i]);
    if (ctx.res.reloads) { ctx.run.aborted = `the page reloaded after "${steps[i].text}" (the run is invalid, see viteEvents)`; break; }
  }
  ctx.run.failed = ctx.run.steps.filter((r) => r.ok === false && !r.auto).length;
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
    // --run start config (kit / stake / daily): wrapped before the veil is entered, so the run starts with it.
    const startRec = startSpec ? await evalJson(cdp, startConfigJs(startSpec)) : null;
    if (startRec && !startRec.ok) throw new Error(`--run start config: ${startRec.error}`);
    if (startRec) log(`start config: kit ${startRec.kit}, stake ${startRec.stake}${startRec.daily ? ' (daily)' : ''}`);
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
      await driveRun({ cdp, res, run: res.run, shoot, shotsDir, looks: 0 }, runSteps);
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
    // The JSON is written once, after runBench has resolved (the steps finished, or the run ended and the rest was
    // skipped, and the cleanup ran). Exit only after the write has flushed, so a piped output is never cut short.
    let code = 0, out;
    try {
      const o = parseArgs(process.argv.slice(2));
      if (o.help || (!o.machine && !o.world && o.run === undefined)) { process.stderr.write(USAGE + '\n'); process.exit(o.help ? 0 : 2); }
      const result = await runBench(o);
      out = result;
      if (result.run?.aborted) code = 1;                 // steps that failed are in the JSON; a reload invalidates the run
    } catch (e) {
      code = 1;
      out = { error: String(e?.message ?? e) };
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n', () => process.exit(code));
  })();
}
