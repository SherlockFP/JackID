// LOKI balance sim (docs/JOKER.md §7, wave J1): five bots play 1000 seeds x 8 Nights on the REAL run economy (scripts/sim/run.mjs) with Loki's real
// rules (src/game/joker/*.ts) layered on through run.mjs's --hook seams. This file is both halves:
//
//   node scripts/sim/joker.mjs                       run the five bots (and an unhooked baseline) as child processes, print the table against the targets
//   node scripts/sim/joker.mjs --runs 300 --bold 0.3 fewer runs; a bold bet in 30 % of Watches for every bot (so the big-bet whispers matter)
//   node scripts/sim/run.mjs --bots human --hook scripts/sim/joker.mjs --joker-bot measured --brief     one bot, by hand
//
// Flags (also forwarded to run.mjs): --runs 1000 --seed 20261013 --base human (the player the bots ride on; run.mjs's casual bot)
//   --bold P      chance per Watch that the player makes one bold bet (a third of the pocket) on its second pull. Default 0, so the abstain row is
//                 identical to the unhooked run; with P > 0 the bold bet is part of the player and abstain makes it too (paired).
//   --ada-away P  chance Ada is at her sister's on a given evening (sleep heals 1, not 2). Default 0.2
//   --evening P   chance of an evening of kept words at Ada's table (-1 Ink).   Default 0.6   (measured only)
//   --soup P      chance of soup with Ada (-1 Ink; -2 once admitted).           Default 0.6   (measured only)
//   --kept P      chance of one kept word a Night (a duel win; -1 Ink).          Default 0.6   (measured only)
//                 These three are what the home wave (J4) has to deliver for a careful player. With sleep (1.8) and the promise kept at Dawn (0.9) the
//                 careful player heals about 4.4 Ink a Night against about 4.1 raised (one takeover, two Asks).
//   --find P      chance a bot finds a marked card lying on its floor.            Default 0.7
//   --react P     chance the reader presses C in time on a line with "we".       Default 0.8
//   --moments K   multiplies how often the player meets an unasked-takeover moment (base per Night: Knock 0.4, match point 0.5, Crooked call 0.4, Ada's table 0.5). Default 1
//   --dare-rate P chance he offers a dare in a Watch (yes: Trust +1 and it costs about 1.5 % of the pocket; no: Trust -1). Default 0.5
//   --hair-tie / --coffee   Ada's hair tie is worn / the player drinks coffee before every Watch (unasked takeovers blocked)
//
// THE BOTS (the §7 table). All ride the casual `human` bot and share its lamps, so the comparison is paired.
//   abstain   never uses him: ignores every whisper, dare, promise and card.
//   measured  one asked takeover a Night (the middle Watch), two Asks a Night at the first moments he has a fact to give, follows only what it asked;
//             accepts every dare and promise (keeps 90 %: refusing one is -1), feeds half the cards it finds; heals: sleep, evenings, soup, kept words.
//   leaner    a takeover every Watch (never twice in a row at one machine); ignores whispers, dares, promises and cards; heals by sleep only.
//   believer  follows every tip; accepts every dare and promise (keeps 85 %), feeds 70 % of the cards it finds; never calls him a liar.
//   reader    follows only lines without "we" and presses C on the rest; accepts dares while Trust is below +3 (a refusal is -1, so at +3 it declines and takes the dip), accepts every promise (keeps all), feeds 70 % of the cards it finds.
//
// WHAT IT MODELS EXACTLY: the truth table, the tell, Ink and Trust moves, healing, unasked odds and kind, the limits (a Watch, a run, the machine row),
// the marked deck, and a takeover pull's payout (10 x the stake counted at most 2.5 % of the Night quota, the bot staking the largest step under that
// cap) inside the real quota economy.
// WHAT IT ASSUMES (no J2-J4 wiring exists yet, so these are parameters, not game facts):
//   - Machine tips come at a machine the bot walks up to: on a Cold machine (fact "cold") or after a lost pull (fact "near"). Following a TRUE
//     one is worth +V x the stake and following a LIE costs V x the stake, V = (1 - COLD_MULT) x 0.94 = 0.235 for cold and 0.06 (one house edge) for near.
//   - A big-bet tip (a bet of a quarter of the pocket or more): the true line halves the stake, the lie goes all in (the table maximum the pocket covers).
//     The base player never bets that much (bold 0), so these only matter with --bold.
//   - A dare costs 6 % (one house edge) of a stake of a quarter of the pocket, taken from the next pull. Duels, the Knock, the Crooked Table and Ada's table are not played here: they only show up as the key moments where an
//     unasked takeover can strike (per Night: Knock 0.4, match point 0.5, Crooked call 0.4, Ada's table 0.5; --moments scales them), costing Ink but moving no coins.
//   - Home: promises are asked at the Evening and settled at the next Dawn; sleep every Night; nobody admits him to Ada.
// RESULTS (J1 + the balance pass, 1000 seeds, seed 20261013, human base; node scripts/sim/joker.mjs). Mean reach is the average of the eight Nights' reach %.
//   abstain   HOME 0 %, reach 94 80 62 46 39 33 29 27 (mean 51.1): identical to the unhooked run.
//   measured  HOME 0.1 % (target < 5), +10.1 points (target +5 to +10), Ink <= 6 at every moment in 97 % of runs and after every Dawn in 99.9 %.
//             Margin: --evening/--soup/--kept 0.5 gives HOME 1.2 % and 94 %; 0.4 gives HOME 2.9 % and 84 % (the 90 % line is crossed at about 0.45).
//             --moments 2 (twice the unasked-takeover moments): HOME 0.5 %. What moved it from 11 % was the careful player taking every promise (kept
//             promises heal) and Trust staying above -1 (an Ask costs 2, not 3), then a little kinder Ada (0.5 -> 0.6). The Dawn Ink sits at about 0.3, so BLEED
//             (Ink 4) is not reached by N8 by a careful player: the doc's "+0.5 a Night" needs a less careful one, or a lower heal.
//   leaner    HOME 88 % by N3, 95 % by N6 (target 70 % by N6); the first Dawn is Ink 3.8, the end comes in Night 2-3.
//   believer  -0.5 % coins vs abstain (target: no better); with --bold 0.3 it is +3.0 %: at high Trust the big-bet tip is mostly the true "bet half".
//   reader    +0.6 % coins (target +5-10 %, MISS: only machine tips are valued here, so it is a floor). Trust +3 held at a Dawn by N6 in 39.9 % of runs
//             (any moment 79 %; target about half). The decay alone left 94 %, because anyone who does a favour moves Trust every Night and the decay never
//             fires; the Night's +1 cap is what slows it. A perfect reader is at +3 on the third Dawn, which only the 62 % of runs that pay Night 3 see.
//   Tell errors at Ink <= 5: 0 in ~45 000 whispers here and in 1e5 rolls in scripts/tests/joker.test.mjs.
// HE CAME HOME ends the run on the spot (the ending), so a run that gets there pays no later quota.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

const BOTS = {
  abstain: { active: false },
  measured: { takeover: 'night', asks: 2, follow: 'asked', dare: 1, promise: 1, keep: 0.9, feed: 0.5, home: 'kind' },
  leaner: { takeover: 'watch', asks: 0, follow: 'none', dare: 0, promise: 0, keep: 0, feed: 0, home: 'sleep' },
  believer: { takeover: null, asks: 0, follow: 'all', dare: 1, promise: 1, keep: 0.85, feed: 0.7, home: 'sleep' },
  reader: { takeover: null, asks: 0, follow: 'noWe', calls: true, dare: 1, dareMax: 3, promise: 1, keep: 1, feed: 0.7, home: 'sleep' },
};
const ORDER = ['abstain', 'measured', 'leaner', 'believer', 'reader'];
/** Key moments an unasked takeover can strike at, and how many a Night the base player meets them. */
const MOMENTS = [['knock', 0.4, {}], ['matchPoint', 0.5, { duel: 'promise', rival: 'lucan' }], ['crookedCall', 0.4, {}], ['adaThrow', 0.5, {}]];
/** A dare costs about one house edge on a stake of a quarter of the pocket ("his machine at his stake, raise when he says raise"). */
const DARE_COST = 0.06 * 0.25;

// ── the hook half (imported by run.mjs) ──────────────────────────────────────────────────────────────────────
let J, W, M, R, S, V_COLD;
const V_NEAR = 0.06;
if (!IS_MAIN) {
  const { load } = await import('../tests/_vite.mjs');
  J = await load('src/game/joker/joker.ts');
  W = await load('src/game/joker/whispers.ts');
  M = await load('src/game/joker/marked.ts');
  R = await load('src/core/rng.ts');
  S = (await load('src/game/joker/joker.strings.ts')).default;
  V_COLD = (1 - (await load('src/game/circuit.ts')).COLD_MULT) * 0.94;
}

let CFG = null;
const AGG = { runs: [], bot: '' };
const text = (keys) => keys.map((k) => S.en[k.replace(/^joker\./, '')]).join(' ');
/** Largest ladder step not above `want` and the pocket (the minimum when the pocket covers it). Same rule as run.mjs's stakeAt. */
function stakeAt(lim, want, pocket) {
  const cap = Math.min(lim.max, want, pocket);
  let best = 0;
  for (const v of lim.ladder) if (v <= cap) best = v;
  return best === 0 && lim.min <= pocket ? lim.min : best;
}

function readCfg(args) {
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
  const num = (n, d) => Number(val(n, d));
  const bot = val('--joker-bot', 'abstain');
  if (!BOTS[bot]) throw new Error(`unknown --joker-bot ${bot} (${ORDER.join(', ')})`);
  AGG.bot = bot;
  return { bot, bold: num('--bold', 0), adaAway: num('--ada-away', 0.2), evening: num('--evening', 0.6), soup: num('--soup', 0.6), kept: num('--kept', 0.6),
    find: num('--find', 0.7), react: num('--react', 0.8), moments: num('--moments', 1), dareRate: num('--dare-rate', 0.5), hairTie: args.includes('--hair-tie'), coffee: args.includes('--coffee') };
}

export function start({ runIdx, seed, args }) {
  CFG ??= readCfg(args);
  const P = BOTS[CFG.bot];
  const jk = new J.Joker(R.hashSeed('jokersim', seed, runIdx));
  const rng = R.createRng(R.hashSeed('jokerbot', seed, runIdx));
  const st = {
    night: 0, nightQuota: 0, lastMid: null, lastLost: false, boldWatch: false, boldNow: false, planWatch: -1, tookNight: 0, tookWatch: false,
    asksLeft: 0, next: null, tip: 0, dareDebt: false, peak: 0, homeNight: 0, trust3: false, trust3Any: false, took: 0, unasked: 0, whispers: 0, tellErrors: 0, inkDawn: [], trustDawn: [],
  };
  const peek = () => {
    if (jk.ink > st.peak) st.peak = jk.ink;
    if (jk.cameHome && !st.homeNight) st.homeNight = st.night;
    if (st.night <= 6 && jk.trust >= 3) st.trust3Any = true;
  };

  /** One whisper the bot hears and acts on. Returns the effect on the pull. */
  function hear(ctx, fact, ask, c, bet) {
    const w = jk.whisper({ ctx, fact, ask });
    if (!w) return bet;
    st.whispers += 1;
    const saysWe = W.saysWe('en', text(w.keys));
    if (jk.ink <= 5 && saysWe === w.truth) st.tellErrors += 1;
    const follow = P.follow === 'all' || P.follow === 'asked' || (P.follow === 'noWe' && !saysWe);
    if (P.calls && saysWe && rng.chance(CFG.react)) jk.callLiar();
    if (!follow) return bet;
    if (ctx === 'bigBet') return w.truth ? Math.min(bet, stakeAt(c.lim, c.pocket / 2, c.pocket) || bet) : stakeAt(c.lim, Infinity, c.pocket) || bet;
    st.tip = (w.truth ? 1 : -1) * (fact === 'cold' ? V_COLD : V_NEAR) * bet;
    return bet;
  }

  return {
    night(no, q) {
      st.night = no; st.nightQuota = q; st.tookNight = 0; st.asksLeft = P.asks ?? 0;
      if (P.active === false) return;
      jk.beginNight(no);
      for (const card of M.MARKED_CARDS) if (card.night === no && rng.chance(CFG.find) && rng.chance(P.feed)) jk.feedCard(card.id);
      peek();
    },
    watch(w, watches) {
      st.lastMid = null; st.tookWatch = false; st.boldWatch = CFG.bold > 0 && rng.chance(CFG.bold); st.planWatch = Math.floor(watches / 2);
      if (P.active === false) return;
      if (CFG.coffee) jk.drinkCoffee();
      jk.beginWatch(w + 1);
      if (jk.canDare() && rng.chance(CFG.dareRate)) { const yes = P.dareMax !== undefined ? jk.trust < P.dareMax : rng.chance(P.dare); st.dareDebt = jk.dare(yes).asked && yes; }
    },
    bet(bet, c) {
      st.next = null; st.tip = 0;
      if (st.boldWatch && c.watchPulls === 1) { bet = stakeAt(c.lim, c.pocket / 3, c.pocket) || bet; st.boldNow = true; } else st.boldNow = false;
      if (P.active === false) return bet;
      if (st.dareDebt) { st.tip -= DARE_COST * c.pocket; st.dareDebt = false; }
      const approach = c.mid !== st.lastMid;
      st.lastMid = c.mid;
      const big = bet >= 0.25 * c.pocket;
      // 1. his hand moves on its own (Ink 6+) at a bet of a quarter of the pocket or more
      if (big && jk.ink >= 6) {
        const u = jk.unasked('bigBet', { machineId: c.machineId, stake: bet, quota: c.nightQuota, hairTie: CFG.hairTie });
        if (u.struck) { st.unasked += 1; st.next = u.result; }
      }
      // 2. the bot asks him to take the pull: the stake is the largest step under 2.5 % of the Night quota
      if (!st.next && P.takeover && (P.takeover === 'watch' ? !st.tookWatch : st.tookNight < 1 && c.w === st.planWatch)) {
        const stake = stakeAt(c.lim, 0.025 * c.nightQuota, c.pocket);
        if (stake > 0) {
          const r = jk.askTakeover({ where: 'machine', machineId: c.machineId, stake, quota: c.nightQuota });
          if (r.ok) { st.took += 1; st.tookNight += 1; st.tookWatch = true; st.next = r.result; bet = stake; }
        }
      }
      // 3. a tip, or an Ask, with a fact to give
      if (!st.next) {
        const ctx = big ? 'bigBet' : approach ? 'machine' : null;
        const fact = big ? 'half' : approach ? (c.cold ? 'cold' : st.lastLost ? 'near' : null) : null;
        if (ctx && fact) {
          const ask = P.asks > 0 && st.asksLeft > 0;
          if (P.follow === 'all' || P.follow === 'noWe' || ask) { if (ask) st.asksLeft -= 1; bet = hear(ctx, fact, ask, c, bet); }
        }
      }
      peek();
      return bet;
    },
    pull(c) {
      let cr = c.credited;
      if (st.next) cr = st.next.act === 'bigWin' ? st.next.payout : 0;       // his hand: a big win, or he throws the pull
      else if (st.tip) cr = Math.max(0, Math.round(cr + st.tip));            // the value of a followed tip
      st.lastLost = cr < c.bet;
      peek();
      return cr;
    },
    over() { peek(); return jk.cameHome; },
    dawn() {
      if (P.active === false) return;
      if (jk.promise) jk.settlePromise(rng.chance(P.keep));
      for (const [m, freq, ctx] of MOMENTS) {
        const f = freq * CFG.moments;
        for (let k = Math.floor(f) + (rng.chance(f % 1) ? 1 : 0); k > 0; k--) { if (jk.unasked(m, { ...ctx, hairTie: CFG.hairTie }).struck) st.unasked += 1; }
      }
      if (P.home === 'kind') {
        if (rng.chance(CFG.evening)) jk.adaEvening();
        if (rng.chance(CFG.soup)) jk.soup();
        if (rng.chance(CFG.kept)) jk.keptWord('duel');
      }
      jk.sleep(rng.chance(CFG.adaAway));
      if (P.promise && jk.canAskPromise()) jk.promiseAnswer(rng.chance(P.promise), 'p');
      jk.dawn();
      st.inkDawn.push(jk.ink); st.trustDawn.push(jk.trust);
      if (st.night <= 6 && jk.trust >= 3) st.trust3 = true;   // held at a Dawn
      peek();
    },
    end({ nightsPaid, wealth }) {
      peek();
      AGG.runs.push({ nightsPaid, wealth, peak: st.peak, dawnPeak: Math.max(0, ...st.inkDawn), home: st.homeNight, trust3: st.trust3, trust3Any: st.trust3Any, took: st.took, unasked: st.unasked, whispers: st.whispers, tellErrors: st.tellErrors, inkDawn: st.inkDawn, trustDawn: st.trustDawn });
    },
  };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const pct = (n, d) => (d ? (100 * n) / d : 0);

/** The numbers of one bot over its runs (what run.mjs stores under `hook` in --json). */
export function finish({ runs }) {
  const rs = AGG.runs;
  const reach = Array.from({ length: 8 }, (_, i) => pct(rs.filter((r) => r.nightsPaid > i).length, rs.length));
  const homeBy = Array.from({ length: 8 }, (_, i) => pct(rs.filter((r) => r.home && r.home <= i + 1).length, rs.length));
  const inkN = Array.from({ length: 8 }, (_, i) => mean(rs.filter((r) => r.inkDawn.length > i).map((r) => r.inkDawn[i])));
  const out = {
    bot: AGG.bot, runs: rs.length || runs, reach, meanReach: mean(reach), meanWealth: mean(rs.map((r) => r.wealth)),
    medianWealth: median(rs.map((r) => r.wealth)), survivorsWealth: median(rs.filter((r) => r.nightsPaid >= 8).map((r) => r.wealth)),
    home: pct(rs.filter((r) => r.home).length, rs.length), homeBy, peakLe6: pct(rs.filter((r) => r.peak <= 6).length, rs.length), dawnLe6: pct(rs.filter((r) => r.dawnPeak <= 6).length, rs.length),
    trust3ByN6: pct(rs.filter((r) => r.trust3).length, rs.length), trust3Any: pct(rs.filter((r) => r.trust3Any).length, rs.length), meanInkDawn: inkN, tookPerRun: mean(rs.map((r) => r.took)), unaskedPerRun: mean(rs.map((r) => r.unasked)),
    whispers: sum(rs.map((r) => r.whispers)), tellErrors: sum(rs.map((r) => r.tellErrors)),
    meanTrustDawn: Array.from({ length: 8 }, (_, i) => mean(rs.filter((r) => r.trustDawn.length > i).map((r) => r.trustDawn[i]))),
  };
  console.log(`joker ${AGG.bot}: HE CAME HOME ${out.home.toFixed(1)} %, mean reach ${out.meanReach.toFixed(1)} %, peak Ink <= 6 in ${out.peakLe6.toFixed(1)} %, Trust +3 held at a Dawn by N6 ${out.trust3ByN6.toFixed(1)} % (at any moment ${out.trust3Any.toFixed(1)} %; Dawn Trust ${out.meanTrustDawn.map((v) => v.toFixed(1)).join(' ')}), whispers ${out.whispers} (tell errors ${out.tellErrors})`);
  return out;
}

// ── the CLI half (spawns run.mjs once per bot) ───────────────────────────────────────────────────────────────
function runChild(label, extra, args, dir) {
  const out = join(dir, `${label}.json`);
  const a = [join(HERE, 'run.mjs'), '--bots', baseOf(args), '--brief', '--json', out, ...extra, ...args];
  const r = spawnSync(process.execPath, a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`run.mjs failed for ${label}:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf8'));
}
function baseOf(args) { const i = args.indexOf('--base'); return i >= 0 ? args[i + 1] : 'human'; }

if (IS_MAIN) {
  const args = process.argv.slice(2);
  const runs = args.includes('--runs') ? args[args.indexOf('--runs') + 1] : '1000';
  const forwarded = args.filter((a, i) => a !== '--base' && args[i - 1] !== '--base' && a !== '--runs' && args[i - 1] !== '--runs');
  const dir = mkdtempSync(join(tmpdir(), 'jokersim-'));
  const base = runChild('baseline', ['--runs', runs], forwarded, dir).results[baseOf(args)];
  const baseReach = mean(base.map((r) => r.reachPct));
  const R_ = {};
  for (const b of ORDER) R_[b] = runChild(b, ['--runs', runs, '--hook', SELF, '--joker-bot', b], forwarded, dir).hook;
  rmSync(dir, { recursive: true, force: true });

  const a = R_.abstain;
  const f1 = (x) => x.toFixed(1);
  const d = (x, y) => (x - y >= 0 ? '+' : '') + f1(x - y);
  const dw = (x) => ((x / a.meanWealth - 1) * 100 >= 0 ? '+' : '') + f1((x / a.meanWealth - 1) * 100) + ' %';
  const checks = [];
  const check = (bot, what, ok, got) => checks.push({ bot, what, ok, got });
  check('abstain', 'HE CAME HOME 0 %', a.home === 0, `${f1(a.home)} %`);
  check('abstain', 'mean reach within 1 point of the unhooked run', Math.abs(a.meanReach - baseReach) <= 1, `${d(a.meanReach, baseReach)} points`);
  const m = R_.measured, l = R_.leaner, be = R_.believer, rd = R_.reader;
  check('measured', 'HE CAME HOME under 5 %', m.home < 5, `${f1(m.home)} %`);
  check('measured', 'pass rate +5 to +10 points (0.5 slack)', m.meanReach - a.meanReach >= 5 && m.meanReach - a.meanReach <= 10.5, `${d(m.meanReach, a.meanReach)} points (N8 ${d(m.reach[7], a.reach[7])})`);
  check('measured', 'Ink <= 6 in 90 % of runs (any moment / after Dawn)', m.peakLe6 >= 90, `${f1(m.peakLe6)} % / ${f1(m.dawnLe6)} %`);
  check('leaner', 'HE CAME HOME in 70 %+ of runs by Night 6', l.homeBy[5] >= 70, `${f1(l.homeBy[5])} %`);
  check('believer', 'coins no better than abstain', be.meanWealth <= a.meanWealth * 1.0, dw(be.meanWealth));
  check('reader', 'coins 5-10 % above abstain', rd.meanWealth >= a.meanWealth * 1.05 && rd.meanWealth <= a.meanWealth * 1.1, dw(rd.meanWealth));
  check('reader', 'Trust +3 held at a Dawn by N6, no takeover, about half the runs (Dawn / any moment)', rd.trust3ByN6 >= 35 && rd.trust3ByN6 <= 65, `${f1(rd.trust3ByN6)} % / ${f1(rd.trust3Any)} %`);
  check('all', 'zero tell errors at Ink <= 5', sum(ORDER.map((b) => R_[b].tellErrors)) === 0, `${sum(ORDER.map((b) => R_[b].tellErrors))} in ${sum(ORDER.map((b) => R_[b].whispers))} whispers`);

  console.log(`\nLOKI sim: ${runs} seeds x 8 Nights on the ${baseOf(args)} bot, seed ${args.includes('--seed') ? args[args.indexOf('--seed') + 1] : '20261013 (run.mjs default)'}${args.includes('--bold') ? `, bold ${args[args.indexOf('--bold') + 1]}` : ''}`);
  console.log(`unhooked ${baseOf(args)}: reach% ${base.map((r) => Math.round(r.reachPct)).join(' ')}  mean ${f1(baseReach)}\n`);
  console.log('bot       HOME%  HOME by N3/N4/N6   reach% N1..N8                     mean   d vs abstain   wealth   peak<=6   Trust3<=N6  takeovers/run (own)   Ink at Dawn N1..N8');
  for (const b of ORDER) {
    const x = R_[b];
    console.log(`${b.padEnd(9)} ${f1(x.home).padStart(5)}  ${[2, 3, 5].map((i) => f1(x.homeBy[i]).padStart(5)).join(' ')}      ${x.reach.map((v) => String(Math.round(v)).padStart(3)).join(' ')}   ${f1(x.meanReach).padStart(6)}   ${d(x.meanReach, a.meanReach).padStart(6)} pts   ${dw(x.meanWealth).padStart(8)}   ${f1(x.peakLe6).padStart(5)}%   ${f1(x.trust3ByN6).padStart(6)}%   ${x.tookPerRun.toFixed(2)} (${x.unaskedPerRun.toFixed(2)})      ${x.meanInkDawn.map((v) => v.toFixed(1)).join(' ')}`);
  }
  console.log('\nTARGETS');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'MISS'} ${c.bot.padEnd(9)} ${c.what.padEnd(58)} ${c.got}`);
  const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
  if (outArg) writeFileSync(outArg, JSON.stringify({ baseline: base, bots: R_, checks }, null, 2));
}
