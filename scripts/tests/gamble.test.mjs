// Unit tests for the risk layer (src/game/gamble.ts + src/machines/_base/riskLayer.ts): DOUBLE OR NOTHING ladder EV,
// HIGH STAKES ledger (RTP within 2 points), ALL-IN SHOT EV, and the seat controller's wallet flow against a mock run port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let G, RL, RNG, STR;
before(async () => {
  G = await load('src/game/gamble.ts');
  RL = await load('src/machines/_base/riskLayer.ts');
  RNG = await load('src/core/rng.ts');
  STR = (await load('src/game/gamble.strings.ts')).default;
});

// ── DOUBLE OR NOTHING ─────────────────────────────────────────────────────────────────────────────
test('ladder: one rung is worth 0.97 of the stake (analytic and sampled)', () => {
  assert.ok(Math.abs(G.ladderEv(1) - 0.97) < 1e-9);
  const rng = RNG.createRng(11);
  let paid = 0; const n = 200000;
  for (let i = 0; i < n; i++) { const L = new G.GambleLadder(rng, 100); paid += L.pick(i % 2 ? 'red' : 'black').pot; }
  const ev = paid / (n * 100);
  assert.ok(Math.abs(ev - 0.97) < 0.015, `sampled EV ${ev}`);
});

test('ladder: climbing every rung pays x2..x16 and ends at the top; a loss ends it at 0', () => {
  const rng = RNG.createRng(5);
  let tops = 0, n = 100000, paid = 0;
  for (let i = 0; i < n; i++) {
    const L = new G.GambleLadder(rng, 10);
    let r;
    while (!L.over) r = L.pick('red');
    if (r.maxed) { tops++; assert.equal(L.pot, 160); }
    else assert.equal(L.pot, 0);
    paid += L.pot;
  }
  assert.ok(Math.abs(tops / n - 0.485 ** 4) < 0.004, `top rate ${tops / n}`);
  assert.ok(Math.abs(paid / (n * 10) - G.ladderEv(4)) < 0.05);
  const L = new G.GambleLadder(RNG.createRng(1), 10);
  L.drain();
  assert.throws(() => L.pick('red'));
});

test('ladder: the same seed gives the same cards; the card matches the roll', () => {
  const run = () => { const L = new G.GambleLadder(RNG.createRng(99), 8); const out = []; while (!L.over) { const r = L.pick('black'); out.push(`${r.card.suit}${r.card.rank}${r.won}`); assert.equal(r.won, r.card.color === 'black'); } return out.join(','); };
  assert.equal(run(), run());
});

// ── HIGH STAKES ───────────────────────────────────────────────────────────────────────────────────
/** A machine paytable as [multiple of the bet, probability]; the rest is a loss. */
const SLOT = [[1, 0.12], [2, 0.08], [3, 0.05], [5, 0.03], [10, 0.012], [25, 0.004], [100, 0.0006], [500, 0.00008]];
const TABLE = [[1, 0.09], [2, 0.44]];                 // a table game: no top outcomes
const rtp = (d) => d.reduce((a, [m, p]) => a + m * p, 0);
function sampleRtp(dist, shaped, seed, n = 400000) {
  const rng = RNG.createRng(seed), led = new G.HsLedger();
  let paid = 0;
  for (let i = 0; i < n; i++) {
    let u = rng.next(), m = 0;
    for (const [mm, p] of dist) { if (u < p) { m = mm; break; } u -= p; }
    paid += shaped ? led.shape(m * 100, 100) : m * 100;
  }
  return paid / (n * 100);
}

test('high stakes: RTP stays within 2 points of the base game (slot-like and table-like)', () => {
  for (const [name, d] of [['slot', SLOT], ['table', TABLE]]) {
    // the same seed on both runs: the shaped game sees exactly the same outcomes, so the difference is the shaping alone
    const base = sampleRtp(d, false, 21), hs = sampleRtp(d, true, 21);
    assert.ok(Math.abs(hs - base) < 0.02, `${name}: base ${base.toFixed(4)} hs ${hs.toFixed(4)}`);
    assert.ok(Math.abs(base - rtp(d)) < 0.05, `${name}: sampled base ${base} vs ${rtp(d)}`);
  }
});

test('high stakes: top wins pay x1.3, losses and pushes are untouched, small wins only repay what was owed', () => {
  const led = new G.HsLedger();
  assert.equal(led.shape(0, 100), 0);
  assert.equal(led.shape(100, 100), 100);
  assert.equal(led.shape(200, 100), 200);                // nothing owed yet: no trim
  assert.equal(led.shape(5000, 100), 6500);              // x50 -> x65
  assert.equal(led.owed, 1500);
  assert.equal(led.shape(200, 100), 150);                // x2 now trims 25%
  assert.equal(led.owed, 1450);
  assert.equal(led.shape(100, 100), 100);                // a push is never trimmed
  assert.equal(led.shape(1000, 100), 1000);              // mid wins (x10) are never trimmed
  assert.ok(G.hsUnlocked(2) && !G.hsUnlocked(1));
});

// ── ALL-IN SHOT ───────────────────────────────────────────────────────────────────────────────────
test('all-in: 1 in 4 for x4.5 is EV 1.125 (analytic and sampled); the two-press arm', () => {
  assert.ok(Math.abs(G.allInEv() - 1.125) < 1e-9);
  const rng = RNG.createRng(3);
  let wins = 0; const n = 200000;
  for (let i = 0; i < n; i++) if (G.allInRoll(rng)) wins++;
  assert.ok(Math.abs(wins / n - 0.25) < 0.005);
  assert.ok(Math.abs((wins / n) * G.ALLIN_MULT - 1.125) < 0.03);
  assert.equal(G.allInPayout(1001), 4504);
  const a = new G.AllInArm();
  assert.equal(a.press(0), 'arm');
  assert.equal(a.press(2), 'fire');
  assert.equal(a.press(3), 'arm');
  assert.equal(a.press(3 + G.ALLIN_CONFIRM_S + 1), 'arm');   // too slow: a fresh arm
});

// ── the seat controller against a mock run ────────────────────────────────────────────────────────
function mk({ night = 1, wallet = 1000, shared = false, windowId = 'watch', seed = 1234 } = {}) {
  const st = { wallet, night, watch: 7, used: false, log: [], busy: false, roundOpen: false, live: true, flashes: [], fx: [] };
  const port = {
    watchId: () => st.watch,
    allInUsed: () => st.used,
    markAllIn: () => { st.used = true; },
    debit: (n, src, why) => { if (n > st.wallet) return false; st.wallet -= n; st.log.push(['debit', n, why]); return true; },
    credit: (n, src, why) => { st.wallet += n; st.log.push(['credit', n, why]); return n; },
  };
  const ui = new Proxy({}, { get: (_t, k) => (k === 'flash' ? (...a) => st.flashes.push(a[0]) : () => {}) });
  const host = {
    id: 'm1', src: { mid: 'm1', machineId: 'slot' }, runSeed: seed, shared, isLocalOccupant: true,
    get roundOpen() { return st.roundOpen; },
    get gamblesLive() { return st.live; },
    get busy() { return st.busy; }, set busy(v) { st.busy = v; },
    run: { wallet: () => st.wallet, night: () => st.night, window: () => windowId },
    wait: () => Promise.resolve(),
    toast: (x) => st.log.push(['toast', x]),
    sfx: () => {},
    fx: (kind, step, pot) => st.fx.push([kind, step, pot]),
    ui: () => ui,
  };
  const layer = new RL.RiskLayer(host, { gamble: port });
  const key = (action, o = {}) => layer.route({ action, down: true, repeat: false, ...o });
  const tick = (s) => { for (let i = 0; i < s * 60; i++) layer.step(1 / 60); };
  const settleP = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { st, layer, key, tick, settleP, port };
}

test('layer: no port, no layer (dormant, nothing consumed)', () => {
  const layer = new RL.RiskLayer({ shared: false, isLocalOccupant: true, run: {}, ui: () => ({}) }, {});
  assert.equal(layer.active, false);
  assert.equal(layer.route({ action: 'auto', down: true, repeat: false, code: 'KeyG' }), false);
  assert.equal(layer.hsBegin(10, 10), 1);
});

test('layer: offer -> G -> collect pays the pot back; a loss keeps the coins gone', async () => {
  const w = mk({ wallet: 500 });
  assert.equal(w.key('auto', { code: 'KeyG' }), false);          // no offer: G stays the machine's autoplay
  w.layer.offerWin(200);
  assert.ok(w.layer.offerLive);
  assert.equal(w.key('auto', { code: 'KeyG' }), true);
  await w.settleP();
  assert.equal(w.st.wallet, 300);                                 // 200 at risk
  assert.ok(w.st.busy);
  assert.equal(w.key('collect'), true);                           // swallowed while the ladder is open
  await w.settleP(); await w.settleP();
  assert.equal(w.st.wallet, 500);                                 // collected at x1
  assert.ok(!w.st.busy && !w.layer.ladderOpen);

  // play many ladders: the pocket ends near 0.97 of what was risked on average
  let risked = 0, back = 0;
  for (let i = 0; i < 400; i++) {
    const x = mk({ wallet: 1e6, seed: 1000 + i });
    x.layer.offerWin(100); x.key('auto', { code: 'KeyG' }); await x.settleP();
    const before = x.st.wallet;
    x.key('left'); await x.settleP();
    x.key('collect'); await x.settleP();
    risked += 100; back += x.st.wallet - before;
  }
  assert.ok(back / risked > 0.8 && back / risked < 1.15, `ladder return ${back / risked}`);
});

test('layer: the offer expires, a new stake cancels it, tiny wins are not offered', () => {
  const w = mk();
  w.layer.offerWin(1);
  assert.ok(!w.layer.offerLive);
  w.layer.offerWin(50); w.tick(G.GAMBLE_OFFER_S + 0.5);
  assert.ok(!w.layer.offerLive);
  w.layer.offerWin(50); w.layer.hsBegin(10, 10);
  assert.ok(!w.layer.offerLive);
});

// ── the Watch closes: nothing pending may pay in Dawn ──────────────────────────────────────────────
test('gamblesLive: live while the floor takes plays (and on the bench), locked from the close on', () => {
  for (const p of ['play', 'lastCall', 'idle', undefined]) assert.equal(G.gamblesLive(p), true, String(p));
  for (const p of ['bell', 'closing', 'settle', 'collection', 'intermission', 'over']) assert.equal(G.gamblesLive(p), false, p);
});

test('every machine with its own pending gamble (chase, double-up, ladder, pot) wraps it up when the Watch closes', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROOT } = await import('./_vite.mjs');
  for (const m of ['bigone', 'videopoker', 'hilo', 'bandit', 'coinflip', 'mines']) {
    const src = readFileSync(join(ROOT, 'src/machines', m, 'index.ts'), 'utf8');
    assert.ok(/override onWatchClosed()/.test(src), `${m} overrides onWatchClosed`);
  }
  const base = readFileSync(join(ROOT, 'src/machines/_base/MachineBase.ts'), 'utf8');
  assert.ok(/this.onWatchClosed()/.test(base), 'the base calls the hook from its fixed step');
});

test('layer: when the Watch closes the offer lapses, nothing new is offered and G / the all-in do nothing', () => {
  const w = mk({ wallet: 500 });
  w.layer.offerWin(50);
  assert.ok(w.layer.offerLive);
  w.st.live = false; w.tick(0.1);
  assert.ok(!w.layer.offerLive, 'the open offer is voided at the close');
  assert.equal(w.st.wallet, 500, 'the credited win stays in the pocket');
  w.layer.offerWin(50);
  assert.ok(!w.layer.offerLive, 'a win credited after the close is not offered');
  assert.equal(w.key('auto', { code: 'KeyG' }), false, 'G stays the machine key');
  w.key('key', { code: 'KeyK' }); w.key('key', { code: 'KeyK' });
  assert.equal(w.st.wallet, 500, 'no all-in shot after the close');
  w.st.live = true; w.layer.offerWin(50);
  assert.ok(w.layer.offerLive, 'the next Watch offers again');
});

test('layer: an offer taken just before the close pays out at the close; a flipping card pays when it lands', async () => {
  const w = mk({ wallet: 500 });
  w.layer.offerWin(200); w.key('auto', { code: 'KeyG' }); await w.settleP();
  assert.equal(w.st.wallet, 300);                                 // 200 at risk on the ladder
  w.st.live = false; w.tick(0.1); await w.settleP(); await w.settleP();
  assert.equal(w.st.wallet, 500, 'an idle ladder collects at x1 when the Watch closes');
  assert.ok(!w.st.busy && !w.layer.ladderOpen);
  w.st.live = true;

  let paid = 0, lost = 0;
  for (let i = 0; i < 60; i++) {                                  // mid-flip at the close: collect after the card lands (or nothing if it lost)
    const x = mk({ wallet: 500, seed: 70 + i });
    x.layer.offerWin(100); x.key('auto', { code: 'KeyG' }); await x.settleP();
    x.key('left');                                                // the card is in the air
    x.st.live = false; x.tick(0.1);
    for (let k = 0; k < 40; k++) await x.settleP();
    assert.ok(!x.st.busy && !x.layer.ladderOpen, 'the ladder ends by itself');
    if (x.st.wallet === 400) lost++; else { paid++; assert.ok(x.st.wallet > 400); }
  }
  assert.ok(paid > 10 && lost > 10, `both outcomes happen (paid ${paid}, lost ${lost})`);
});

test('layer: high stakes needs Night 2, Shift+H, and takes the extra x4 from the pocket', () => {
  const lock = mk({ night: 1 });
  assert.equal(lock.key('help', { code: 'KeyH', mods: { shift: true } }), true);
  assert.ok(!lock.layer.highStakes);
  assert.equal(lock.key('help', { code: 'KeyH' }), false);        // plain H is still the rules key
  const w = mk({ night: 2, wallet: 100 });
  assert.equal(w.key('help', { code: 'KeyH', mods: { shift: true } }), true);
  assert.ok(w.layer.highStakes);
  assert.equal(w.layer.hsBegin(10, 10), G.HS_MULT);
  assert.equal(w.st.wallet, 60);                                  // 4 x 10 extra (the run charges the 10)
  w.layer.hsUndo(10);
  assert.equal(w.st.wallet, 100);
  assert.equal(w.layer.hsBegin(40, 40), 0);                       // 40 + 160 > 100
  assert.equal(w.layer.hsPay(300, 100, 5), 1500);                 // x3 on a 100 bet, x5 stake
  w.layer.hsBegin(10, 10);
  const big = w.layer.hsPay(2500, 10, 5);                         // x250: boosted x1.3 then x5
  assert.equal(big, 3250 * 5);
  assert.equal(mk({ shared: true }).key('help', { code: 'KeyH', mods: { shift: true } }), false);   // tables: no high stakes
});

test('layer: all-in needs two presses, once per Watch, and moves the whole pocket', async () => {
  const w = mk({ wallet: 400 });
  assert.equal(w.key('key', { code: 'KeyK' }), true);             // arm
  assert.equal(w.st.wallet, 400);
  w.tick(6);                                                      // the window lapses
  w.key('key', { code: 'KeyK' });                                 // a fresh arm, not a fire
  assert.equal(w.st.wallet, 400);
  w.key('key', { code: 'KeyK' });                                 // fire
  assert.ok(w.st.log.some(([k, n, why]) => k === 'debit' && n === 400 && why === 'allin'));
  await w.settleP();
  const won = w.st.log.some(([k, , why]) => k === 'credit' && why === 'allin');
  assert.equal(w.st.wallet, won ? 1800 : 0);
  assert.ok(w.st.used);
  assert.ok(!w.st.busy);
  w.st.wallet = 400; w.key('key', { code: 'KeyK' });
  assert.equal(w.st.wallet, 400);                                 // a second shot never fires
});

test('layer: the all-in outcome is fixed per Watch (a reload cannot re-roll it)', () => {
  const roll = (watch, seed) => G.allInRoll(RNG.createRng(RNG.hashSeed(seed, 'allin', watch)));
  for (let w = 0; w < 20; w++) assert.equal(roll(w, 9), roll(w, 9));
  let wins = 0; for (let w = 0; w < 4000; w++) if (roll(w, 9)) wins++;
  assert.ok(Math.abs(wins / 4000 - 0.25) < 0.03);
});

test('strings: every gamble key exists in EN and TR', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  for (const [k, v] of Object.entries(STR.tr)) assert.ok(v.length > 0, k);
});
