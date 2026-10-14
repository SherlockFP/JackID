// Run-level economy sim (headless, no DOM, no three). Plays the base run (Nights 1-8) with three bots and reports, per
// Night, the share of runs that pay the quota and the median pocket of the runs that paid.
//
//   node scripts/sim/run.mjs                         2000 runs per bot, 10 % of pocket per pull (rotator, banker)
//   node scripts/sim/run.mjs --runs 500 --bots rotator
//   node scripts/sim/run.mjs --bet-frac 0.2          stake fraction for rotator and banker
//   node scripts/sim/run.mjs --no-charms             nobody visits the Pawn (the old "reach depends only on quota vs pocket" sim)
//   node scripts/sim/run.mjs --scale-ladder          proposal: bet steps scaled by the Night's stake index (SI)
//   node scripts/sim/run.mjs --json out.json         also write the table as JSON
//   node scripts/sim/run.mjs --quotas 40,56,80,115,165,240,350,520 --si 1,2,3,4,6,9,13,20 --interest 0.60,0.30,...
//                                                    try a schedule without editing schedule.ts (8 values each; also --pulls, --start)
//   node scripts/sim/run.mjs --calibrate --bots rotator   set each Night's quota to the --target survival curve, then print the tables
//   node scripts/sim/run.mjs --no-float              the House float off (F(n) = 12 + 6n topped up at each Night start is ON by default)
//
// DESIGN (director's decision): base machines are slightly negative EV (RTP 0.90-0.96 before Lamps). The player turns
// +EV only through decisions: Hot Lamp (x1.5), rotating off Tilt, interest on deposits, phone deals and the charms and
// engines bought at the Pawn. So this sim buys charms: at every intermission the bots shop from the REAL Pawn
// (src/game/shop.ts, same stock rules, rarity odds, unlock gates, prices = base x SI, the first-shop synergy guarantee).
//
// Real code, reused through the Vite loader (scripts/tests/_vite.mjs, the same loader sim-profiles uses):
//   src/game/data/schedule.ts  Night defs (base quota, SI, pulls, watches, interest), quotaFor, interestFor, hot Lamp count
//   src/game/circuit.ts        Circuit (per-instance pulls, Hot/Cold lamps, rollLamps), tiltFactor, HOT_MULT, COLD_MULT
//   src/game/economy.ts        settlePayout (dampener, Hot/Cold/Tilt factor, House Limit at 5 x quota), bettingLadder, snapDown,
//                              charmPrice, Night 1 stake cap, the rescue loan
//   src/game/shop.ts           the Pawn (stock, locks, prices, first-shop guarantee)
//   src/game/charms/engine.ts  the charm catalogue (defs, effects, tags)
//   src/core/rng.ts            seeded rng (Math.random is forbidden)
//   src/machines/<id>/index.ts def.headless, minBet, maxBet, betSteps of each world machine
//
// Modelled as in run.ts: quota mode, Hot Lamps from Night 1 and Cold Lamps from Night 2, Tilt after 4 pulls per instance per Watch, interest only on Watches
// with 3+ pulls, House Limit, dawn payment with the surplus back in the pocket, overpay charm rewards (1.5x / 2x), Night 1 stake cap, the
// rescue loan (pocket 0 -> +N coins now, quota +1.5N), a failed quota ends the run.
// Charm effects modelled (payout.mult inc/mult by scope and suit scaling, Hot Coal, Lampwick, Capacitor, Suit Ladder, Pressure
// Valve, Snowball Ledger, Last Gasp, Chain Link, Cuckoo Feather, Collector's Tag, Altimeter, Night Owl, interest/deposit/pull/
// Tilt-grace charms, Brass Alarm, Porcelain Pig). Machine-specific "m.*" charms count as 0 and the bots never buy what the sim
// does not model. Not modelled: tycoon holdings and Assessment, buffs, bosses, phone deals, Tickets, the clock (every Watch is
// assumed long enough for its pulls), Overdrawn Nights.
//
// Bots (all see the same Lamp rolls for a given run index, so the comparison is paired):
//   camper    half the pocket (--camper-frac 0.5, the ladder step at or below it) on the first world machine (bigone) every
//             pull, never banks, no charms; deposits as soon as the pocket covers the quota
//   rotator   stake = largest ladder step <= BET_FRAC of the pocket; a Hot Lamp instance is always taken (Hot ignores Tilt),
//             else the best non-Cold instance that has not Tilted yet (charm factor, then least played); shops at every
//             intermission. Deposits what compounds to the gap by the last settle (x --dep-margin 1.3), and when the rate is 15 %+ (interest beats play)
//             deposits --dep-frac 1 of the pocket above the float: "deposit early but keep a float", never below --float-pocket 0.3
//             of the pocket (the last Watch pays the gap in full). Float = --float 9 (3 activity pulls a Watch).
//             Once the quota is covered and the pick is not Hot it banks: the minimum stake for the 3 activity pulls of each Watch
//   banker    the same play, but deposits --banker-frac 0.8 of the pocket above the float at every Bell
//   human     a casual player (wave 19): stakes a random 2-5 coins a pull (the ladder step at or below it), rotates machine every
//             3-5 pulls, goes for the Hot Lamp ~60 % of the time it rotates (--human-hot-p 0.6), deposits a random 30-70 % slice of
//             the pocket at ~80 % of the Bells and pays the gap only on the last Watch. Banks once the quota is covered.
// Also modelled: House Favour (x1.25 / 1.15 / 1.07 on Nights 1-3), the Witching Watch +5 %, the activity float (never bet into the
// 3 pulls the next Watches need). --no-favour switches Favour off; --trace N prints the first N runs Night by Night.
//
// TARGET TABLE (wave 19 director, cumulative reach, human bot first): human N1 >= 85, N2 >= 70, N3 >= 50, N5 25-30, N8 ~5; rotator a
// bit above the human; camper N3 <= 15. Shipped (2000 runs): human 90/76/51/32/26/22/20/20; rotator 100/88/85/70/59/50/41/35;
// camper N3 16. Open: N8 (human 20 vs ~5) needs the SI ladder smoothed (SI 1,2,4 … 128 gives N8 ~4) and the rotator sits ~35 points
// above the human late (a bot/charm question, not the quota ladder). Run node scripts/sim/run.mjs --runs 2000 to see the table.
import { writeFileSync } from 'node:fs';
import { load, closeVite } from '../tests/_vite.mjs';

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const RUNS = Math.max(1, Number(argVal('--runs', 2000)) | 0);
const BOTS = argVal('--bots', 'camper,rotator,banker,human').split(',').map((s) => s.trim()).filter(Boolean);
const BET_FRAC = Number(argVal('--bet-frac', 0.10));
const SCALE_LADDER = args.includes('--scale-ladder');
const NO_CHARMS = args.includes('--no-charms');
const CAMPER_FRAC = Number(argVal('--camper-frac', 0.5));
const SPEND_FRAC = Number(argVal('--spend-frac', 0.7));
const FLOAT = Number(argVal('--float', 9));
const BANKER_FRAC = Number(argVal('--banker-frac', 0.8));
const DEP_FRAC = Number(argVal('--dep-frac', 1));
const DEP_MARGIN = Number(argVal('--dep-margin', 1.3));
const DEP_MODE = argVal("--dep-mode", "gap");
const FRONT_MIN_RATE = Number(argVal("--front-min-rate", 0.3));
const FLOAT_FRAC = Number(argVal("--float-frac", 0));
// human: the casual player. Stakes 2-5 coins a pull, rotates machine every 3-5 pulls, goes for the Hot Lamp ~60 % of rotations,
// deposits a random slice of the pocket at ~80 % of the Bells (the gap on the last Watch only).
const HUMAN_STAKE_LO = Number(argVal('--human-stake-lo', 2));      // a casual stake: a random whole 2-5 coins a pull
const HUMAN_STAKE_HI = Number(argVal('--human-stake-hi', 5));
const HUMAN_HOT_P = Number(argVal('--human-hot-p', 0.6));          // share of rotations that go to the Hot Lamp
const HUMAN_SHOP_P = Number(argVal('--human-shop-p', 0.5));        // chance the casual player visits the Pawn at a given stop
const HUMAN_DEP_P = Number(argVal('--human-dep-p', 0.8));          // chance the human deposits at a Bell (not the last Watch)
const HUMAN_DEP_LO = Number(argVal('--human-dep-lo', 0.3));        // ... and then this range of the pocket
const HUMAN_DEP_HI = Number(argVal('--human-dep-hi', 0.7));
// "deposit early but keep a float": never deposit below this share of the pocket (the last Watch still pays the gap in full).
const FLOAT_POCKET = Number(argVal("--float-pocket", 0.3));
const RESERVE_FRAC = Number(argVal('--reserve-frac', 0.35));
const JSON_OUT = argVal('--json', '');
const SEED = Number(argVal('--seed', 20261013)) | 0;
const VERBOSE = args.includes('--verbose');
const BRIEF = args.includes('--brief');
const TRACE = Number(argVal('--trace', 0)) | 0;
const NO_FAVOUR = args.includes('--no-favour');
const NO_FLOAT = args.includes('--no-float');   // the House float (F(n) = 12 + 6n at each Night start) off, for comparison

/** The machines of the player's floor, one per family. Index 0 is the camper's machine (bigone). */
const WORLD_IDS = ['bigone', 'blackjack', 'dicetower', 'roulette', 'plinko', 'elevator'];
const HOOKS = { luck: 0, mod: (_hook, base) => base };
const TOT = { wagered: 0, credited: 0, plays: 0, loans: 0, runsWithLoan: 0 };
/** Realized value per Night (credited / wagered), so the table shows where the Lamp edge comes from. */
const NIGHT_RTP = { wagered: new Array(8).fill(0), credited: new Array(8).fill(0) };
const CHARM_COUNT = { sum: new Array(8).fill(0), n: new Array(8).fill(0) };
/** House float coins advanced per Night (summed over runs; index = Night - 1). */
const FLOAT_PAID = new Array(8).fill(0);
const BOUGHT = new Map();

// Tuning overrides (comma lists of 8 values, one per Night). Without them the schedule.ts numbers are used.
const list = (name) => { const v = argVal(name, ''); return v ? v.split(',').map(Number) : null; };
const SCH = await load('src/game/data/schedule.ts');
const CIR = await load('src/game/circuit.ts');
const ECO = await load('src/game/economy.ts');
const RNG = await load('src/core/rng.ts');
const ENG = await load('src/game/charms/engine.ts');
const SHOP = await load('src/game/shop.ts');
const SUITS = await load('src/game/suits.ts');
const MT = await load('src/game/modifiers.types.ts');
const CHD = await load('src/game/data/charms.ts');
const OVERRIDE = { quotas: list('--quotas'), interest: list('--interest'), pulls: list('--pulls'), si: list('--si'), favour: list('--favour') };
const START_POCKET = Number(argVal('--start', SCH.START.pocket));
const NIGHTS = SCH.BASE_NIGHTS.map((n, i) => ({
  ...n,
  base: OVERRIDE.quotas?.[i] ?? n.base,
  interest: OVERRIDE.interest?.[i] ?? n.interest,
  pulls: OVERRIDE.pulls?.[i] ?? n.pulls,
  si: OVERRIDE.si?.[i] ?? n.si,
  favour: OVERRIDE.favour?.[i] ?? n.favour,
}));
/** Quota of a Night with no tycoon Assessment and no discount: quotaFor() rounds the base to 3 significant digits. */
const dueOf = (nd) => Number(nd.base.toPrecision(3));

const defs = {};
for (const id of WORLD_IDS) {
  const def = (await load(`src/machines/${id}/index.ts`)).def;
  if (typeof def?.headless !== 'function') throw new Error(`${id} has no headless play`);
  defs[id] = def;
}
const world = WORLD_IDS.map((machineId, i) => ({ mid: `m${i}`, machineId, suit: (SUITS.suitOf(machineId) ?? '').toLowerCase() }));
// Lamp candidates as run.ts lampCandidates(): the machine's minimum stake; the pocket decides which ones may take a Lamp (circuit.lampEligible).
const lampCands = world.map((w) => ({ mid: w.mid, machineId: w.machineId, minBet: defs[w.machineId].minBet }));
const FLOOR = world.map((w) => ({ machineId: w.machineId, tags: [w.suit], category: 'gambling' }));
const DEF = (id) => ENG.charmDef(id);

/** run.ts betLimits: ladder from betSteps (or the generated ladder), ceiling maxBet x SI. --scale-ladder scales the steps by SI.
 *  Night 1 (index 0) is capped at ~1/3 of the starting pocket (economy.night1StakeCap). */
function limitsOf(def, si, idx) {
  let ceiling = def.maxBet * si;
  if (idx === 0 && ECO.night1StakeCap) ceiling = Math.min(ceiling, Math.max(def.minBet, ECO.night1StakeCap(START_POCKET)));
  const steps = def.betSteps ?? ECO.bettingLadder(def.minBet, ceiling);
  const ladder = (SCALE_LADDER ? steps.map((v) => v * si) : steps).filter((v) => v >= def.minBet && v <= ceiling);
  const max = ECO.snapDown(ceiling, ladder) || def.minBet;
  return { min: def.minBet, max, ladder };
}

/** Largest ladder step not above `want`, the ceiling and the pocket (the minimum when the pocket covers it). */
function stakeAt(lim, want, pocket) {
  const cap = Math.min(lim.max, want, pocket);
  let best = 0;
  for (const v of lim.ladder) if (v <= cap) best = v;
  if (best === 0 && lim.min <= pocket) best = lim.min;
  return best;
}

/** Largest ladder step not above the target and the pocket (at least the minimum when the pocket covers it). */
function stakeFor(bot, lim, pocket) {
  const target = bot === 'camper' ? (CAMPER_FRAC >= 1 ? Number.POSITIVE_INFINITY : CAMPER_FRAC * pocket) : Math.max(lim.min, BET_FRAC * pocket);
  const cap = Math.min(lim.max, target, pocket);
  let best = 0;
  for (const v of lim.ladder) if (v <= cap) best = v;
  if (best === 0 && lim.min <= pocket) best = lim.min;
  return best;
}

// ── charm model ─────────────────────────────────────────────────────────────────────────────────────────
const ENGINE_BOT_TIER = new Set(['suit_ladder', 'pressure_valve', 'capacitor', 'lampwick', 'last_gasp', 'snowball_ledger']);
const BESPOKE = new Set([
  ...ENGINE_BOT_TIER, 'hot_coal', 'chain_link', 'cuckoo_feather', 'collectors_tag', 'altimeter', 'night_owl', 'brass_alarm', 'porcelain_pig',
  'cold_hands', 'red_thread', 'worn_glove', 'spare_token', 'operators_glove', 'piggy_tooth', 'wax_seal', 'crown_of_coins', 'false_ceiling',
]);
const SUIT_SCALED = CHD.SUIT_SCALED_CHARMS;
const SUIT_STEP = CHD.SUIT_SCALE_STEP;

/** What the bot knows how to use. Anything else is a machine-specific charm the sim cannot value. */
function modelled(d) {
  if (BESPOKE.has(d.id)) return true;
  return (d.effects ?? []).some((e) => e.hook === 'payout.mult' || e.hook === 'x.econ.interestAdd' || e.hook === 'deposit.bonus'
    || e.hook === 'x.run.pullsAdd' || e.hook === 'x.tilt.grace');
}

/** Shopping priority: engines and Hot Coal first, then payout charms that match a suit on the floor, then the economy charms. */
function priority(d, held) {
  if (!modelled(d) || d.rarity === 'cursed' || d.id === 'false_ceiling') return 0;
  if (d.id === 'hot_coal' || d.id === 'crown_of_coins') return 5;
  if (ENGINE_BOT_TIER.has(d.id) || d.id === 'collectors_tag' || d.id === 'cuckoo_feather') return 4;
  const pay = (d.effects ?? []).find((e) => e.hook === 'payout.mult');
  if (pay) {
    const suitHeld = d.tag ? held.filter((id) => DEF(id)?.tag === d.tag).length : 0;
    return 3 + (suitHeld > 0 ? 0.5 : 0) + (SUIT_SCALED.has(d.id) ? 0.2 : 0);
  }
  if (d.id === 'chain_link' || d.id === 'altimeter' || d.id === 'night_owl' || d.id === 'brass_alarm') return 2;
  return 1;
}

/** Fold of every held charm for one play. Returns { A, M, flat } for settlePayout plus the Hot multiplier. */
function charmFactors(S, w, ctx) {
  let A = 0, M = 1;
  const cs = S.cs;
  for (const id of S.held) {
    const d = DEF(id);
    if (!d) continue;
    const scale = SUIT_SCALED.has(id) && d.tag ? S.held.filter((h) => DEF(h)?.tag === d.tag).length : 1;
    for (const e of d.effects ?? []) {
      if (e.hook !== 'payout.mult') continue;
      if (!MT.scopeMatches(e.scope, { machineId: w.machineId, tags: [w.suit] })) continue;
      const v = e.value * (SUIT_SCALED.has(id) ? scale : 1);
      if (e.op === 'inc') A += v; else if (e.op === 'mult') M *= v;
    }
    switch (id) {
      case 'suit_ladder': if (cs.rungs > 0) M *= 1 + 0.12 * cs.rungs; break;
      case 'pressure_valve': if (cs.pressure > 0) M *= 1 + 0.10 * cs.pressure; break;
      case 'capacitor': if (ctx.hot && cs.charge > 0) M *= 1 + 0.25 * cs.charge; break;
      case 'last_gasp': if (ctx.lastCall && ctx.lastWatch && ctx.unmet) M *= 1.4; break;
      case 'chain_link': A += 0.1 * Math.min(5, cs.streak); break;
      case 'night_owl': if (ctx.lastCall) A += 0.4; break;
      case 'altimeter': A += 0.02 * Math.min(14, S.idx); break;
      case 'cuckoo_feather': if (cs.cuckoo) M *= 2; break;
      case 'collectors_tag': M *= 1 + 0.1 * S.nightsPaid; break;
      default: break;
    }
  }
  return { A, M };
}

/** Run-level numbers from the held charms: interest add, deposit bonus, pulls, Tilt grace, Hot and Cold multipliers, Hot count. */
function runFx(S) {
  const o = { interestAdd: 0, depositBonus: 0, pullsAdd: 0, grace: 0, hotMult: CIR.HOT_MULT, coldMult: CIR.COLD_MULT, hotCount: 0, limitMult: 1 };
  for (const id of S.held) {
    const d = DEF(id);
    for (const e of d?.effects ?? []) {
      if (e.hook === 'x.econ.interestAdd') o.interestAdd += e.value;
      else if (e.hook === 'deposit.bonus') o.depositBonus += e.value;
      else if (e.hook === 'x.run.pullsAdd') o.pullsAdd += e.value;
      else if (e.hook === 'x.tilt.grace') o.grace += e.value;
      else if (e.hook === 'x.lamp.hotMult' && e.op === 'set') o.hotMult = e.value;
      else if (e.hook === 'x.lamp.hotCount') o.hotCount += e.value;
      else if (e.hook === 'x.lamp.coldMult' && e.op === 'set') o.coldMult = e.value;
      else if (e.hook === 'x.house.limitMult' && e.op === 'mult') o.limitMult *= e.value;
    }
  }
  if (S.held.includes('lampwick')) o.hotMult += 0.08 * S.cs.wicks;
  o.interestAdd += S.held.includes('snowball_ledger') ? 0.01 * S.cs.snow : 0;
  return o;
}

/** The Pawn host for one run: the same contract run.ts gives the real Pawn. */
function makeHost(S, rng) {
  return {
    selfId: 1,
    rng: () => rng,
    night: () => S.shopNight,
    watch: () => S.shopWatch,
    open: () => true,
    si: () => NIGHTS[S.idx].si,
    held: () => S.held,
    canTake: (id) => !S.held.includes(id),
    pegsFree: () => 6 - S.held.length,
    wallet: () => S.pocket,
    tickets: () => S.tickets,
    spendTickets: (n) => { if (S.tickets < n) return false; S.tickets -= n; return true; },
    freeRerolls: () => 0,
    useFreeReroll: () => false,
    buyCharm: (id, price) => {
      if (price > 0 && S.pocket < price) return false;
      if (S.held.length >= 6) return false;
      S.pocket -= price;
      S.held.push(id);
      return true;
    },
    sellCharm: () => false,
    sellValue: () => 0,
    removeCurse: () => false,
    mostPlayed: () => null,
    floor: () => FLOOR,
  };
}

/** Intermission shopping: up to two purchases from the Pawn, best priority first, within SPEND_FRAC of the pocket. */
function shop(S, bot, due, rng) {
  if (NO_CHARMS || bot === 'camper') return;
  // The casual player visits the Pawn at only some Bells (--human-shop-p): a careful stake is not a charm-every-Bell shopper.
  if (bot === 'human' && rng && rng.next() >= HUMAN_SHOP_P) return;
  // Keep play money: a charm never eats the stake pool (about a third of the Night's quota stays in the pocket).
  for (let k = 0; k < 2; k++) {
    const stock = S.pawn.stock(1);
    const budget = Math.floor(Math.min(S.pocket * SPEND_FRAC, S.pocket - RESERVE_FRAC * due));
    let best = -1, bestScore = 0;
    stock.forEach((slot, i) => {
      if (!slot || slot.price <= 0 || slot.price > budget) return;
      const d = DEF(slot.charmId);
      if (!d) return;
      const sc = priority(d, S.held);
      if (sc <= 0) return;
      const key = sc * 1e6 - slot.price;
      if (key > bestScore || best < 0) { best = i; bestScore = key; }
    });
    if (best < 0) return;
    const r = S.pawn.buy(1, best);
    if (!r.ok) return;
    const id = stock[best].charmId;
    BOUGHT.set(id, (BOUGHT.get(id) ?? 0) + 1);
  }
}

function playRun(bot, runIdx) {
  const rng = RNG.createRng((SEED + runIdx * 7919) >>> 0);
  const circ = new CIR.Circuit();
  const out = { paid: [], pocket: [], charms: [] };
  const S = {
    idx: 0, pocket: START_POCKET, tickets: 2, debt: 0, held: [], nightsPaid: 0, shopNight: 0, shopWatch: 0,
    cs: { rungs: 0, last: null, pressure: 0, charge: 0, wicks: 0, streak: 0, cuckoo: false, snow: 0 },
    pawn: null,
  };
  S.pawn = new SHOP.Pawn(makeHost(S, RNG.createRng(RNG.hashSeed('simpawn', SEED, runIdx))));
  let loanedRun = false;
  const hum = { rng: RNG.createRng(RNG.hashSeed('simhuman', SEED, runIdx)), cur: null, dwell: 0 };

  for (let idx = 0; idx < SCH.BASE_RUN_NIGHTS; idx++) {
    S.idx = idx;
    const nd = NIGHTS[idx];
    let due = dueOf(nd);
    let loans = 0;
    S.cs.snow = 0; S.cs.wicks = 0;

    for (let w = 0; w < nd.watches; w++) {
      S.shopNight = idx; S.shopWatch = w;
      // Deposits at the Bell: interest only works on what is already in the Debt Terminal. The rotator deposits what compounds
      // to the gap by the last settle (the HUD shows the pace); the banker deposits as much as it can. Shopping comes after.
      let fx0 = runFx(S);
      if (bot === 'human') {
        const rem = Math.max(0, due - S.debt);
        let dep = nd.watches - w === 1 ? rem : hum.rng.next() < HUMAN_DEP_P ? Math.floor(S.pocket * (HUMAN_DEP_LO + (HUMAN_DEP_HI - HUMAN_DEP_LO) * hum.rng.next())) : 0;
        dep = Math.min(dep, S.pocket);
        if (dep > 0) { S.pocket -= dep; S.debt += Math.floor(dep * (1 + fx0.depositBonus)); }
      } else if (bot !== 'camper') {
        const left = nd.watches - w;
        const rem = Math.max(0, due - S.debt);
        const rate0 = SCH.interestRate(nd.interest, fx0.interestAdd);
        // the last Watch deposits the whole gap (no interest left to count on); earlier ones what compounds to it
        const front = DEP_MODE === 'front' && rate0 >= FRONT_MIN_RATE;
        const want = front || S.debt >= due && DEP_MODE !== 'gap' ? Math.max(0, 2 * due - S.debt) : bot === 'banker' || left === 1 ? rem : Math.ceil(DEP_MARGIN * rem / Math.pow(1 + Math.max(0, rate0), left));
        const float = left === 1 && rem > 0 && S.pocket >= rem ? 0 : Math.min(S.pocket, Math.max(FLOAT, Math.round(FLOAT_FRAC * due), Math.round((bot === 'rotator' ? FLOAT_POCKET : 0) * S.pocket)));
        let want2 = want;
        if (bot === 'banker') want2 = Math.max(0, Math.floor(BANKER_FRAC * (S.pocket - float)));
        if (bot === 'rotator' && DEP_FRAC > 0 && rate0 >= 0.15 && left > 1) want2 = Math.max(want, Math.min(Math.max(0, 2 * due - S.debt), Math.floor(DEP_FRAC * Math.max(0, S.pocket - float))));
        const dep = Math.min(want2, Math.max(0, S.pocket - float));
        if (dep > 0) { S.pocket -= dep; S.debt += Math.floor(dep * (1 + fx0.depositBonus)); }
      }
      shop(S, bot, due, hum.rng);
      fx0 = runFx(S);
      const lampRng = RNG.createRng((SEED * 31 + runIdx * 1009 + idx * 37 + w * 3 + 1) >>> 0);
      circ.startWatch(lampRng, lampCands.filter((c) => CIR.lampEligible(c, S.pocket)), { lamps: nd.no >= SCH.LAMP_FIRST_NIGHT, hot: SCH.hotLampCount(nd.no) + fx0.hotCount, cold: SCH.coldLampCount(nd.no), newIsHot: false });
      const rate = SCH.interestRate(nd.interest, fx0.interestAdd);
      let pulls = nd.pulls + fx0.pullsAdd;
      const pullsMax = pulls;
      let watchPulls = 0;
      S.cs.cuckoo = S.held.includes('cuckoo_feather');
      if (S.held.includes('brass_alarm')) S.pocket += 4 * nd.si;
      if (S.held.includes('porcelain_pig')) S.pocket += Math.min(Math.floor(S.pocket * 0.04), 40 * nd.si);

      while (pulls > 0) {
        let pick;
        if (bot === 'camper') {
          pick = world[0];
        } else if (bot === 'human') {
          const openH = (x) => defs[x.machineId].minBet <= Math.max(1, S.pocket / 3);
          if (hum.dwell <= 0 || !hum.cur || !openH(hum.cur)) {
            const hot = world.find((x) => circ.isHot(x.mid) && openH(x));
            const pool = world.filter(openH);
            const cands = pool.length ? pool : world;
            hum.cur = hot && hum.rng.next() < HUMAN_HOT_P ? hot : cands[hum.rng.int(0, cands.length - 1)];
            hum.dwell = 3 + hum.rng.int(0, 2);
          }
          hum.dwell -= 1;
          pick = hum.cur;
        } else {
          // a machine the pocket cannot open (stake minimum above the pocket) is not a candidate; Hot first
          // a sane player does not sit at a table whose minimum is a third of the pocket when a 1-coin machine is free
          const open = (x) => defs[x.machineId].minBet <= Math.max(1, S.pocket / 3);
          pick = world.find((x) => circ.isHot(x.mid) && open(x));
          if (!pick) {
            let bestKey = -Infinity;
            for (const x of world) {
              if (circ.isCold(x.mid) || !open(x)) continue;
              const plays = circ.playsOf(x.mid);
              const tilted = plays >= ECO_TILT_FREE + Math.round(fx0.grace);
              const f = charmFactors(S, x, { hot: false, lastCall: false, lastWatch: false, unmet: false });
              const key = (tilted ? -100 : 0) + (f.M * (1 + 0.5 * f.A) - 1) * 10 - plays;
              if (key > bestKey) { bestKey = key; pick = x; }
            }
            pick ??= world.find(open) ?? world.find((x) => defs[x.machineId].minBet <= S.pocket) ?? world[0];
          }
        }
        const def = defs[pick.machineId];
        const lim = limitsOf(def, nd.si, idx);
        const hotPick = circ.isHot(pick.mid);
        // Banked: the quota is covered and the pick is not Hot, so play has no edge (RTP below 1). Keep only the minimum
        // pulls the activity clause needs for interest (3 per Watch), each at the minimum stake, then stop.
        const banked = bot !== 'camper' && S.debt >= due && !hotPick;
        if (banked && watchPulls >= SCH.ACTIVITY_MIN_PULLS) break;
        // Rescue: pocket empty, quota unmet, Watches left -> the Collector's loan (+N coins now, quota +1.5N). The bots only take it
        // when the deposit's interest alone will not reach the quota.
        const projected = S.debt * Math.pow(1 + Math.max(0, rate), nd.watches - w);
        if (S.pocket < lim.min && projected < due && S.debt < due && loans < (ECO.RESCUE_MAX_PER_NIGHT ?? 3) && ECO.rescueLoan) {
          const loan = ECO.rescueLoan(due);
          S.pocket += loan.coins; due += loan.quota; loans += 1; TOT.loans += 1; loanedRun = true;
        }
        const bet = banked ? (lim.min <= S.pocket ? lim.min : 0)
          : bot === 'human' ? stakeAt(lim, HUMAN_STAKE_LO + hum.rng.int(0, HUMAN_STAKE_HI - HUMAN_STAKE_LO), S.pocket)
          : stakeFor(bot, lim, S.pocket);
        if (bet <= 0) break;
        // Activity float: after the 3 pulls interest needs, never bet into the coins the next Watches' 3 pulls each need.
        if (bot !== 'camper' && watchPulls >= SCH.ACTIVITY_MIN_PULLS && S.pocket - bet < (nd.watches - w - 1) * SCH.ACTIVITY_MIN_PULLS * defs[pick.machineId].minBet) break;
        S.pocket -= bet;
        const wasLast = pullsMax - pulls >= Math.floor(pullsMax * 0.87);
        pulls -= 1;
        watchPulls += 1;
        circ.addPlays(pick.mid, 1);
        const hot = circ.isHot(pick.mid);
        const cold = circ.isCold(pick.mid);
        const lampF = hot ? fx0.hotMult + (S.held.includes('lampwick') ? 0 : 0) : cold ? fx0.coldMult : 1;
        const tiltF = hot ? 1 : CIR.tiltFactor(circ.playsOf(pick.mid), Math.round(fx0.grace));
        const ctx = { hot, lastCall: wasLast, lastWatch: w === nd.watches - 1, unmet: S.debt < due };
        const cf = charmFactors(S, pick, ctx);
        const gross = def.headless(rng, bet, HOOKS).gross;
        const witch = SCH.isWitchingWatch(nd.watches, w) ? 0.05 : 0;
        const credited = ECO.settlePayout({ gross, bet, A: cf.A + witch, M: lampF * tiltF * cf.M * (NO_FAVOUR ? 1 : nd.favour), flat: 0, quota: due, limitMult: fx0.limitMult }).credited;
        S.pocket += credited;
        TOT.wagered += bet; TOT.credited += credited; TOT.plays += 1;
        NIGHT_RTP.wagered[idx] += bet; NIGHT_RTP.credited[idx] += credited;

        // charm state after the result
        const cs = S.cs;
        const win = gross > bet;
        if (win) cs.cuckoo = false;
        cs.streak = win ? Math.min(5, cs.streak + 1) : 0;
        cs.pressure = win ? 0 : Math.min(8, cs.pressure + 1);
        if (cs.last !== null) cs.rungs = cs.last === pick.suit ? Math.max(0, cs.rungs - 3) : Math.min(6, cs.rungs + 1);
        cs.last = pick.suit;
        if (hot) { if (win) cs.charge = 0; } else if (cold || tiltF < 1) cs.charge = Math.min(6, cs.charge + 1);
        if (hot && win && cs.wicks < 6) cs.wicks += 1;

        if (bot === 'camper' || bot === 'banker') {
          const need = due - S.debt;
          if (need > 0 && S.pocket >= need) { S.pocket -= need; S.debt += Math.floor(need * (1 + fx0.depositBonus)); }
        }
      }

      if (bot !== 'camper' && (bot !== 'human' || w === nd.watches - 1)) {
        const need = due - S.debt;
        if (need > 0 && S.pocket >= need) { S.pocket -= need; S.debt += Math.floor(need * (1 + fx0.depositBonus)); }
      }

      if (watchPulls >= SCH.ACTIVITY_MIN_PULLS && rate > 0) S.debt += SCH.interestFor(S.debt, due, rate);
      if (TRACE && runIdx < TRACE && idx < 2) console.log(`   N${nd.no} W${w + 1} end: pulls ${watchPulls} debt ${S.debt} pocket ${S.pocket}`);
      if (S.debt >= due * 0.25) S.cs.snow = Math.min(3, S.cs.snow + 1);
      S.cs.rungs = S.cs.rungs; // rungs persist across Watches (data bag), tilt does not
    }

    if (TRACE && runIdx < TRACE) console.log(`run ${runIdx} ${bot} N${nd.no} due ${due} debt ${S.debt} pocket ${S.pocket} held [${S.held.join(',')}] loans ${loans}`);
    if (S.debt < due) { out.charms = S.held.length; return out; }
    // overpay rewards: 1.5x -> pick an Uncommon, 2x -> pick a Rare (best priority of the three)
    const ratio = S.debt / due;
    for (const [need, rarity] of [[1.5, 'uncommon'], [2, 'rare']]) {
      if (ratio < need || S.held.length >= 6) continue;
      const offer = ENG.choiceOffer(rng.fork(`overpay:${idx}:${rarity}`), rarity, 3, (id) => S.held.includes(id), idx);
      offer.sort((a, b) => priority(b, S.held) - priority(a, S.held));
      if (offer[0] && (bot !== 'camper')) S.held.push(offer[0].id);
    }
    // Dawn settle (run.ts dawn()): the surplus above the quota (interest already in it) returns to the pocket.
    S.pocket += Math.max(0, S.debt - due);
    S.debt = 0;
    S.nightsPaid += 1;
    out.paid.push(nd.no);
    out.pocket.push(S.pocket);
    CHARM_COUNT.sum[idx] += S.held.length; CHARM_COUNT.n[idx] += 1;
    // Start of the next Night (openFloor): the House float tops the pocket up to F(n), free and not in the quota.
    if (idx + 1 < SCH.BASE_RUN_NIGHTS && !NO_FLOAT) { const top = ECO.houseFloatTopUp(S.pocket, idx + 1); S.pocket += top; FLOAT_PAID[idx + 1] += top; }
    // Dawn visit: the Pawn shows the next Night's stock (priced at this Night's SI).
    if (idx + 1 < SCH.BASE_RUN_NIGHTS) { S.shopNight = idx + 1; S.shopWatch = 0; shop(S, bot, dueOf(NIGHTS[idx + 1]), hum.rng); }
  }
  out.charms = S.held.length;
  if (loanedRun) TOT.runsWithLoan += 1;
  return out;
}
const ECO_TILT_FREE = SCH.TILT_FREE_PULLS;

const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtCoins = (x) => (x >= 1e6 ? `${(x / 1e6).toPrecision(3)}M` : x >= 1e4 ? `${(x / 1e3).toPrecision(3)}k` : `${Math.round(x)}`);

// --calibrate: sets each Night's base quota, in order, so that the first bot's conditional pay rate on that Night hits the
// target (cumulative target / previous cumulative target). Quotas of earlier Nights are fixed by then, so the bisection is
// exact. The ladder is forced strictly increasing. Prints the quota list to pass to --quotas.
if (args.includes('--calibrate')) {
  const bot = BOTS[0];
  const cum = (list('--target') ?? [0.94, 0.88, 0.76, 0.62, 0.48, 0.33, 0.20, 0.12]);
  const paidCount = (nightNo) => {
    let c = 0;
    for (let r = 0; r < RUNS; r++) if (playRun(bot, r).paid.includes(nightNo)) c++;
    return c;
  };
  const FIX = Number(argVal('--fix', 0)) | 0;
  for (let i = 0; i < SCH.BASE_RUN_NIGHTS; i++) {
    if (i < FIX) { console.log(`fixed N${i + 1}: base ${NIGHTS[i].base}`); continue; }
    const prevCount = i === 0 ? RUNS : paidCount(i);
    const want = cum[i] / (i === 0 ? 1 : cum[i - 1]);
    let lo = Math.log(i === 0 ? 1 : NIGHTS[i - 1].base + 1), hi = Math.log(1e8);
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      NIGHTS[i].base = Math.max(1, Math.round(Math.exp(mid)));
      const got = prevCount ? paidCount(i + 1) / prevCount : 0;
      if (got > want) lo = mid; else hi = mid;
    }
    NIGHTS[i].base = Math.max(1, Math.round(Math.exp((lo + hi) / 2)));
    if (i > 0 && NIGHTS[i].base <= NIGHTS[i - 1].base) NIGHTS[i].base = NIGHTS[i - 1].base + 1;
    console.log(`calibrated N${i + 1}: base ${NIGHTS[i].base} (target conditional ${want.toFixed(3)} for ${bot})`);
  }
  console.log(`--quotas ${NIGHTS.map((n) => n.base).join(',')}`);
}

const results = {};
for (const bot of BOTS) {
  const t0 = Date.now();
  TOT.wagered = 0; TOT.credited = 0; TOT.plays = 0; TOT.loans = 0; TOT.runsWithLoan = 0;
  NIGHT_RTP.wagered.fill(0); NIGHT_RTP.credited.fill(0);
  CHARM_COUNT.sum.fill(0); CHARM_COUNT.n.fill(0); BOUGHT.clear(); FLOAT_PAID.fill(0);
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
    const charms = CHARM_COUNT.n[i] ? +(CHARM_COUNT.sum[i] / CHARM_COUNT.n[i]).toFixed(1) : 0;
    rows.push({ night: i + 1, quota: dueOf(NIGHTS[i]), reachPct: +(100 * paid / RUNS).toFixed(1), condPct: +(100 * paid / Math.max(1, started)).toFixed(1), medianPocket: Math.round(median(pockets[i])), nightRtp, charms });
    started = paid;
  }
  results[bot] = rows;
  results[bot + '_rtp'] = TOT.wagered ? +(TOT.credited / TOT.wagered).toFixed(4) : 0;
  if (BRIEF) { console.log(`${bot.padEnd(8)} reach% ${rows.map((r) => String(Math.round(r.reachPct)).padStart(3)).join(' ')}  pocket ${rows.map((r) => fmtCoins(r.medianPocket)).join(' ')}  charms ${rows.map((r) => r.charms).join(' ')}  rtp ${results[bot + '_rtp']}`); continue; }
  console.log(`\n${bot}  (${RUNS} runs, ${((Date.now() - t0) / 1000).toFixed(1)} s${SCALE_LADDER ? ', ladder scaled by SI' : ''}${NO_CHARMS ? ', no charms' : ''}${bot === 'camper' ? '' : `, stake ${BET_FRAC * 100} % of pocket`})`);
  console.log(`realized RTP ${results[bot + '_rtp']}  plays/run ${(TOT.plays / RUNS).toFixed(1)}  rescue loans/run ${(TOT.loans / RUNS).toFixed(2)}`);
  console.log(`house float per run (N2..N8): ${FLOAT_PAID.slice(1).map((v) => (v / RUNS).toFixed(1)).join(' ')}${NO_FLOAT ? '  (off)' : ''}`);
  console.log('Night  quota     reach%  cond%   median pocket (runs that paid)   realized RTP   charms held');
  for (const row of rows) {
    console.log(`N${String(row.night).padEnd(4)} ${fmtCoins(row.quota).padEnd(9)} ${String(row.reachPct).padStart(6)}  ${String(row.condPct).padStart(6)}   ${fmtCoins(row.medianPocket).padEnd(30)} ${String(row.nightRtp).padEnd(14)} ${row.charms}`);
  }
  if (VERBOSE && BOUGHT.size) console.log('bought:', [...BOUGHT.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ runs: RUNS, betFrac: BET_FRAC, scaleLadder: SCALE_LADDER, seed: SEED, results }, null, 2));
await closeVite();
