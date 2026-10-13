// Run-level economy sim (headless, no DOM, no three). Plays the base run (Nights 1-8) with three bots and reports, per
// Night, the share of runs that pay the quota and the median pocket of the runs that paid.
//
//   node scripts/sim/run.mjs                         2000 runs per bot, 10 % of pocket per pull (rotator, banker)
//   node scripts/sim/run.mjs --runs 500 --bots rotator
//   node scripts/sim/run.mjs --bet-frac 0.2          stake fraction for rotator and banker
//   node scripts/sim/run.mjs --scale-ladder          proposal: bet steps scaled by the Night's stake index (SI)
//   node scripts/sim/run.mjs --json out.json         also write the table as JSON
//   node scripts/sim/run.mjs --quotas 10,18,32,58,105,189,340,612 --interest 0.40,0.36,0.32,0.28,0.24,0.20,0.16,0.12
//                                                    try a schedule without editing schedule.ts (8 values each; also --pulls, --start)
//   node scripts/sim/run.mjs --calibrate --bots rotator   set each Night's quota to the --target survival curve, then print the tables
//
// Real code, reused through the Vite loader (scripts/tests/_vite.mjs, the same loader sim-profiles uses):
//   src/game/data/schedule.ts  Night defs (base quota, pulls, watches, interest), quotaFor, interestFor, hot Lamp count
//   src/game/circuit.ts        Circuit (per-instance pulls, Hot/Cold lamps, rollLamps), tiltFactor, HOT_MULT, COLD_MULT
//   src/game/economy.ts        settlePayout (dampener, Hot/Cold/Tilt factor, House Limit at 5 x quota), bettingLadder, snapDown
//   src/core/rng.ts            seeded rng (Math.random is forbidden)
//   src/machines/<id>/index.ts def.headless, minBet, maxBet, betSteps of each world machine
//
// Modelled as in run.ts: quota mode with the timed Watch (Lamps from Night 2, Tilt after 4 pulls per instance per Watch,
// interest only on Watches with 3+ pulls, House Limit, dawn payment with surplus carried, a failed quota ends the run),
// betLimits (ladder from betSteps, ceiling maxBet × SI, the ladder is NOT scaled by SI in run.ts today).
// Not modelled (sim simplifications, all would make the economy easier): tycoon holdings and Assessment, charms,
// buffs, bosses, overshoot rewards, the Tilt grace of Red Thread, pull purchases with tickets, the clock (every Watch is
// assumed long enough for its pulls), Overdrawn Nights (the target stops at Night 8).
//
// Bots (all see the same Lamp rolls for a given run index, so the comparison is paired):
//   camper    max bet on the first world machine (bigone) every pull, never banks; deposits as soon as the pocket covers
//             the quota
//   rotator   stake = largest ladder step <= BET_FRAC of the pocket; a Hot Lamp instance is always taken (Hot ignores
//             Tilt), else the least-played instance that is not Cold (respects Tilt); deposits the quota gap at the end of
//             a Watch when the pocket covers it. Once the quota is covered and the pick is not Hot, it banks: the minimum
//             stake for the 3 activity pulls of each Watch (interest needs them), no risk
//   banker    rotator's play, but deposits the quota the moment the pocket covers it (so the deposit earns the Night's
//             interest on every later settle), then banks the same way
import { writeFileSync } from 'node:fs';
import { load, closeVite } from '../tests/_vite.mjs';

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const RUNS = Math.max(1, Number(argVal('--runs', 2000)) | 0);
const BOTS = argVal('--bots', 'camper,rotator,banker').split(',').map((s) => s.trim()).filter(Boolean);
const BET_FRAC = Number(argVal('--bet-frac', 0.10));
const SCALE_LADDER = args.includes('--scale-ladder');
const JSON_OUT = argVal('--json', '');
const SEED = Number(argVal('--seed', 20261013)) | 0;

/** The machines of the player's floor, one per family. Index 0 is the camper's machine (bigone). */
const WORLD_IDS = ['bigone', 'blackjack', 'dicetower', 'roulette', 'plinko', 'elevator'];
const HOOKS = { luck: 0, mod: (_hook, base) => base };
const TOT = { wagered: 0, credited: 0, plays: 0 };
/** Realized value per Night (credited / wagered), so the table shows where the Lamp edge comes from. */
const NIGHT_RTP = { wagered: new Array(8).fill(0), credited: new Array(8).fill(0) };

// Tuning overrides (comma lists of 8 values, one per Night). Without them the schedule.ts numbers are used.
const list = (name) => { const v = argVal(name, ''); return v ? v.split(',').map(Number) : null; };
const SCH = await load('src/game/data/schedule.ts');
const CIR = await load('src/game/circuit.ts');
const OVERRIDE = { quotas: list('--quotas'), interest: list('--interest'), pulls: list('--pulls') };
const START_POCKET = Number(argVal('--start', SCH.START.pocket));
const NIGHTS = SCH.BASE_NIGHTS.map((n, i) => ({
  ...n,
  base: OVERRIDE.quotas?.[i] ?? n.base,
  interest: OVERRIDE.interest?.[i] ?? n.interest,
  pulls: OVERRIDE.pulls?.[i] ?? n.pulls,
}));
/** Quota of a Night with no tycoon Assessment and no discount: quotaFor() rounds the base to 3 significant digits. */
const dueOf = (nd) => Number(nd.base.toPrecision(3));
const ECO = await load('src/game/economy.ts');
const RNG = await load('src/core/rng.ts');

const defs = {};
for (const id of WORLD_IDS) {
  const def = (await load(`src/machines/${id}/index.ts`)).def;
  if (typeof def?.headless !== 'function') throw new Error(`${id} has no headless play`);
  defs[id] = def;
}
const world = WORLD_IDS.map((machineId, i) => ({ mid: `m${i}`, machineId }));
const lampCands = world.map((w) => ({ mid: w.mid, machineId: w.machineId }));

/** run.ts betLimits: ladder from betSteps (or the generated ladder), ceiling maxBet × SI. --scale-ladder scales the steps by SI. */
function limitsOf(def, si) {
  const ceiling = def.maxBet * si;
  const steps = def.betSteps ?? ECO.bettingLadder(def.minBet, ceiling);
  const ladder = (SCALE_LADDER ? steps.map((v) => v * si) : steps).filter((v) => v >= def.minBet && v <= ceiling);
  const max = ECO.snapDown(ceiling, ladder) || def.minBet;
  return { min: def.minBet, max, ladder };
}

/** Largest ladder step not above the target and the pocket (at least the minimum when the pocket covers it). */
function stakeFor(bot, lim, pocket) {
  const target = bot === 'camper' ? Number.POSITIVE_INFINITY : Math.max(lim.min, BET_FRAC * pocket);
  const cap = Math.min(lim.max, target, pocket);
  let best = 0;
  for (const v of lim.ladder) if (v <= cap) best = v;
  if (best === 0 && lim.min <= pocket) best = lim.min;
  return best;
}

function playRun(bot, runIdx) {
  const rng = RNG.createRng((SEED + runIdx * 7919) >>> 0);
  const circ = new CIR.Circuit();
  const out = { paid: [], pocket: [] };
  let pocket = START_POCKET;
  let debt = 0;

  for (let idx = 0; idx < SCH.BASE_RUN_NIGHTS; idx++) {
    const nd = NIGHTS[idx];
    const due = dueOf(nd);
    const rate = SCH.interestRate(nd.interest, 0);
    for (let w = 0; w < nd.watches; w++) {
      const lampRng = RNG.createRng((SEED * 31 + runIdx * 1009 + idx * 37 + w * 3 + 1) >>> 0);
      circ.startWatch(lampRng, lampCands, { lamps: nd.no >= SCH.LAMP_FIRST_NIGHT, hot: SCH.hotLampCount(nd.no), cold: 1, newIsHot: false });
      let pulls = nd.pulls;
      let watchPulls = 0;

      while (pulls > 0) {
        let pick;
        if (bot === 'camper') {
          pick = world[0];
        } else {
          pick = world.find((x) => circ.isHot(x.mid));
          if (!pick) {
            for (const x of world) {
              if (circ.isCold(x.mid)) continue;
              if (!pick || circ.playsOf(x.mid) < circ.playsOf(pick.mid)) pick = x;
            }
            pick ??= world[0];
          }
        }
        const def = defs[pick.machineId];
        const lim = limitsOf(def, nd.si);
        // Banked: the quota is covered and the pick is not Hot, so play has no edge (RTP below 1). Keep only the minimum
        // pulls the activity clause needs for interest (3 per Watch), each at the minimum stake, then stop.
        const banked = bot !== 'camper' && debt >= due && !circ.isHot(pick.mid);
        if (banked && watchPulls >= SCH.ACTIVITY_MIN_PULLS) break;
        const bet = banked ? (lim.min <= pocket ? lim.min : 0) : stakeFor(bot, lim, pocket);
        if (bet <= 0) break;
        pocket -= bet;
        pulls -= 1;
        watchPulls += 1;
        circ.addPlays(pick.mid, 1);
        const hot = circ.isHot(pick.mid);
        const cold = circ.isCold(pick.mid);
        const lampF = hot ? CIR.HOT_MULT : cold ? CIR.COLD_MULT : 1;
        const tiltF = hot ? 1 : CIR.tiltFactor(circ.playsOf(pick.mid), 0);
        const gross = def.headless(rng, bet, HOOKS).gross;
        const credited = ECO.settlePayout({ gross, bet, A: 0, M: lampF * tiltF, flat: 0, quota: due, limitMult: 1 }).credited;
        pocket += credited;
        TOT.wagered += bet; TOT.credited += credited; TOT.plays += 1;
        NIGHT_RTP.wagered[idx] += bet; NIGHT_RTP.credited[idx] += credited;

        if (bot === 'camper' || bot === 'banker') {
          const need = due - debt;
          if (need > 0 && pocket >= need) { pocket -= need; debt += need; }
        }
      }

      if (bot !== 'camper') {
        const need = due - debt;
        if (need > 0 && pocket >= need) { pocket -= need; debt += need; }
      }

      if (watchPulls >= SCH.ACTIVITY_MIN_PULLS && rate > 0) debt += SCH.interestFor(debt, due, rate);
    }

    if (debt < due) return out;
    debt -= due;
    out.paid.push(nd.no);
    out.pocket.push(pocket);
  }
  return out;
}

const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtCoins = (x) => (x >= 1e6 ? `${(x / 1e6).toPrecision(3)}M` : x >= 1e4 ? `${(x / 1e3).toPrecision(3)}k` : `${Math.round(x)}`);

// --calibrate: sets each Night's base quota, in order, so that the first bot's conditional pay rate on that Night hits the
// target (cumulative target / previous cumulative target). Quotas of earlier Nights are fixed by then, so the bisection is
// exact. Prints the quota list to pass to --quotas.
if (args.includes('--calibrate')) {
  const bot = BOTS[0];
  const cum = (list('--target') ?? [0.95, 0.95, 0.80, 0.68, 0.50, 0.35, 0.22, 0.12]);
  const paidCount = (nightNo) => {
    let c = 0;
    for (let r = 0; r < RUNS; r++) if (playRun(bot, r).paid.includes(nightNo)) c++;
    return c;
  };
  for (let i = 0; i < SCH.BASE_RUN_NIGHTS; i++) {
    const prevCount = i === 0 ? RUNS : paidCount(i);
    const want = cum[i] / (i === 0 ? 1 : cum[i - 1]);
    let lo = Math.log(1), hi = Math.log(1e8);
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      NIGHTS[i].base = Math.max(1, Math.round(Math.exp(mid)));
      const got = prevCount ? paidCount(i + 1) / prevCount : 0;
      if (got > want) lo = mid; else hi = mid;
    }
    NIGHTS[i].base = Math.max(1, Math.round(Math.exp((lo + hi) / 2)));
    console.log(`calibrated N${i + 1}: base ${NIGHTS[i].base} (target conditional ${want.toFixed(3)} for ${bot})`);
  }
  console.log(`--quotas ${NIGHTS.map((n) => n.base).join(',')}`);
}

const results = {};
for (const bot of BOTS) {
  const t0 = Date.now();
  TOT.wagered = 0; TOT.credited = 0; TOT.plays = 0;
  NIGHT_RTP.wagered.fill(0); NIGHT_RTP.credited.fill(0);
  const reached = new Array(SCH.BASE_RUN_NIGHTS).fill(0);
  const pockets = Array.from({ length: SCH.BASE_RUN_NIGHTS }, () => []);
  for (let r = 0; r < RUNS; r++) {
    const res = playRun(bot, r);
    res.paid.forEach((no, k) => { reached[no - 1]++; pockets[no - 1].push(res.pocket[k]); });
  }
  const rows = [];
  let started = RUNS;
  for (let i = 0; i < SCH.BASE_RUN_NIGHTS; i++) {
    const paid = reached[i];
    const nightRtp = NIGHT_RTP.wagered[i] ? +(NIGHT_RTP.credited[i] / NIGHT_RTP.wagered[i]).toFixed(3) : 0;
    rows.push({ night: i + 1, quota: dueOf(NIGHTS[i]), reachPct: +(100 * paid / RUNS).toFixed(1), condPct: +(100 * paid / Math.max(1, started)).toFixed(1), medianPocket: Math.round(median(pockets[i])), nightRtp });
    started = paid;
  }
  results[bot] = rows;
  results[bot + '_rtp'] = TOT.wagered ? +(TOT.credited / TOT.wagered).toFixed(4) : 0;
  console.log(`realized RTP ${results[bot + '_rtp']}  plays/run ${(TOT.plays / RUNS).toFixed(1)}`);
  console.log(`\n${bot}  (${RUNS} runs, ${((Date.now() - t0) / 1000).toFixed(1)} s${SCALE_LADDER ? ', ladder scaled by SI' : ''}${bot === 'camper' ? '' : `, stake ${BET_FRAC * 100} % of pocket`})`);
  console.log('Night  quota     reach%  cond%   median pocket (runs that paid)   realized RTP');
  for (const row of rows) {
    console.log(`N${String(row.night).padEnd(4)} ${fmtCoins(row.quota).padEnd(9)} ${String(row.reachPct).padStart(6)}  ${String(row.condPct).padStart(6)}   ${fmtCoins(row.medianPocket).padEnd(30)} ${row.nightRtp}`);
  }
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ runs: RUNS, betFrac: BET_FRAC, scaleLadder: SCALE_LADDER, seed: SEED, results }, null, 2));
await closeVite();
