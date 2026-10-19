// PANTHEON balance sim (docs/BLESSINGS.md §2.2 and §6 wave D1): four bots play N seeds x 8 Nights on the REAL run economy (scripts/sim/run.mjs, the casual
// `human` bot underneath) with the real boon data and the real offer (src/game/pantheon.ts: pantheonOffer, OFFER_SHAPE, payoutCap) layered on through run.mjs's
// --hook seams. This file is both halves, like joker.mjs:
//
//   node scripts/sim/pantheon.mjs                    unhooked baseline + the four bots as child processes; prints the reach-by-night table and the targets
//   node scripts/sim/pantheon.mjs --runs 1000        fewer runs (default 4000, about 4 s each)
//   node scripts/sim/run.mjs --bots human --hook scripts/sim/pantheon.mjs --pantheon-bot greedy --brief     one bot, by hand
//
// THE BOTS (what the player does with each Dawn's offer; every bot sees the same seeded offers, so the comparison is paired):
//   none       takes nothing. Must match the unhooked run (and today's rate: the fold of House Favour into House Mood is exact).
//   random     keeps a seeded random card.
//   greedy     keeps the card whose biggest percentage is highest: a mult counts |v - 1| (x1.5 is 50), an add counts |v| when it is under 1 (+5 % is 5);
//              counts and seconds ("+20 s", "+1 lamp") are not percentages. Ties go left.
//   sensible   keeps the first card of SENSIBLE (what pays in this economy: interest, Hot lamps, deposits, Tilt grace, write-offs), else the greedy pick.
//   Golden tier cards (2x quota banked) pick two; the offer shape follows the overpay tier (1.5x: 4 cards, 2x: pick 2, 3x: a Rite or duo slot).
//
// WHAT IT MODELS: payout.mult (through payoutCap, so the x1.35 cap is the real one), quota.mult, watchAdd, x.econ.interestAdd, deposit.bonus, x.run.pullsAdd,
// x.tilt.grace, x.lamp.hotMult / hotCount, loss.refund (5 % of the stake on a total loss), Rounding Error (<=5 % shortfall written off at Dawn).
// WHAT IT DOES NOT (counts as 0, so every bot is a floor): luck stars (the sim's machines run at luck 0), jackpot.mult, Pawn discount and slots, clock and Last Call,
// Dread, duels, Crooked Tables, seals, Loki's swap (the bots never swap), Favour from candles. The old overpay charm picks stay in all four bots (the real game
// replaces them with the offer), so the table is a ceiling on what boons add, not a forecast.
// shortcut: boons are picked at the Dawn only (no Mola pick); upgrade when run.ts opens a mid-Night offer.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const ORDER = ['none', 'random', 'greedy', 'sensible'];
/** What a thoughtful player takes in this economy, best first. Anything not listed falls back to the greedy score. */
const SENSIBLE = ['ledg_compound', 'well_warm', 'ledg_count', 'well_lamps', 'ash_hand', 'ledg_round', 'ash_short', 'mir_back', 'ledg_double'];
/** Reach by Night of the unhooked human bot, 4000 runs, seed 20261013: wave 85 (the 12-coin start, the House notice on every Night, the early House Mood); it was 94 82 61 47 40 33 29 27 with the 30-coin exploit. */
const TODAY = [86, 72, 53, 42, 36, 32, 28, 26];

const { load, closeVite } = await import('../tests/_vite.mjs');
const PA = await load('src/game/pantheon.ts');
const R = await load('src/core/rng.ts');

/** The percentage a card shows loudest (the greedy bot's score). */
function loud(id) {
  const d = PA.boonDef(id);
  const nums = [...d.effects.map((f) => (f.op === 'mult' ? Math.abs(f.value - 1) : f.op === 'add' && Math.abs(f.value) < 1 ? Math.abs(f.value) : 0)),
    ...Object.values(d.fx ?? {}).map((v) => (Math.abs(v) < 1 ? Math.abs(v) : 0))];
  return Math.max(0, ...nums);
}
const tierOf = (ratio) => (ratio >= 3 ? 'seal' : ratio >= 2 ? 'golden' : ratio >= 1.5 ? 'uncommon' : 'base');

/** The best pick among `cards` for a bot. */
function choose(bot, cards, rng) {
  if (bot === 'random') return rng.pick(cards);
  const byLoud = () => cards.reduce((a, b) => (loud(b) > loud(a) ? b : a));
  if (bot === 'greedy') return byLoud();
  for (const id of SENSIBLE) if (cards.includes(id)) return id;
  return byLoud();
}

// ── the hook half (imported by run.mjs) ──────────────────────────────────────────────────────────────────────
const AGG = { runs: [], bot: 'none', maxPay: 1 };

export function start({ runIdx, seed, args }) {
  const i = args.indexOf('--pantheon-bot');
  const bot = i >= 0 ? args[i + 1] : 'none';
  if (!ORDER.includes(bot)) throw new Error(`unknown --pantheon-bot ${bot} (${ORDER.join(', ')})`);
  AGG.bot = bot;
  const rng = R.createRng(R.hashSeed('pantheonbot', seed, runIdx));
  const kept = [];
  const live = () => kept.flatMap((id) => PA.boonDef(id).effects);
  const sum = (hook) => live().filter((f) => f.hook === hook && f.op === 'add').reduce((a, f) => a + f.value, 0);
  const prod = (hook) => live().filter((f) => f.hook === hook && f.op === 'mult').reduce((a, f) => a * f.value, 1);
  const fxSum = (key) => kept.reduce((a, id) => a + (PA.boonDef(id).fx?.[key] ?? 0), 0);
  return {
    night() {}, watch() {}, bet: (b) => b, over: () => false,
    pull: ({ bet, credited, gross }) => (gross <= 0 && kept.includes('mir_back') ? credited + Math.floor(bet * sum('loss.refund')) : credited),
    quotaMult: () => prod('quota.mult'),
    watchAdd: () => fxSum('watchAdd'),
    payMult() { const p = PA.payoutCap(kept).payout; if (p > AGG.maxPay) AGG.maxPay = p; return p; },
    fx: () => ({ interestAdd: sum('x.econ.interestAdd'), depositBonus: sum('deposit.bonus'), pullsAdd: sum('x.run.pullsAdd'), grace: sum('x.tilt.grace'),
      hotMult: prod('x.lamp.hotMult'), hotCount: sum('x.lamp.hotCount') }),
    writeOff: () => fxSum('writeOffPct'),
    dawn({ nightNo, ratio }) {
      if (bot === 'none' || nightNo < PA.FIRST_OFFER_NIGHT || nightNo >= 8) return;   // the last offer is Night 7's Dawn
      const tier = tierOf(ratio);
      const cards = PA.pantheonOffer(R.createRng(R.hashSeed('pantheonsim', seed, runIdx, nightNo)), nightNo, { tier, kept });
      for (let p = PA.OFFER_SHAPE[tier].picks; p > 0 && cards.length > 0; p--) {
        const pool = cards.filter((id) => PA.boonDef(id).kind !== 'duo' || kept.filter((k) => PA.boonDef(k).kind === 'duo').length < PA.DUOS_MAX);
        if (pool.length === 0) break;
        const id = choose(bot, pool, rng);
        kept.push(id);
        cards.splice(cards.indexOf(id), 1);
      }
    },
    end({ nightsPaid }) { AGG.runs.push({ nightsPaid, kept: kept.length }); },
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The numbers of one bot over its runs (what run.mjs stores under `hook` in --json). */
export function finish() {
  const rs = AGG.runs;
  const reach = Array.from({ length: 8 }, (_, i) => (rs.length ? (100 * rs.filter((r) => r.nightsPaid > i).length) / rs.length : 0));
  const out = { bot: AGG.bot, runs: rs.length, reach, meanReach: mean(reach), boons: mean(rs.map((r) => r.kept)), maxPay: AGG.maxPay };
  console.log(`pantheon ${AGG.bot}: reach ${reach.map((v) => v.toFixed(1)).join(' ')} mean ${out.meanReach.toFixed(1)}, boons ${out.boons.toFixed(1)}, top payout x${out.maxPay.toFixed(3)}`);
  return out;
}

// ── the CLI half (spawns run.mjs once per bot) ───────────────────────────────────────────────────────────────
function runChild(label, extra, args, dir) {
  const out = join(dir, `${label}.json`);
  const r = spawnSync(process.execPath, [join(HERE, 'run.mjs'), '--bots', 'human', '--brief', '--json', out, ...extra, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`run.mjs failed for ${label}:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf8'));
}

if (IS_MAIN) {
  const args = process.argv.slice(2);
  const runs = args.includes('--runs') ? args[args.indexOf('--runs') + 1] : '4000';
  const forwarded = args.filter((a, i) => a !== '--runs' && args[i - 1] !== '--runs');
  const dir = mkdtempSync(join(tmpdir(), 'pantheonsim-'));
  const base = runChild('baseline', ['--runs', runs], forwarded, dir).results.human.map((r) => r.reachPct);
  const B = {};
  for (const b of ORDER) B[b] = runChild(b, ['--runs', runs, '--hook', SELF, '--pantheon-bot', b], forwarded, dir).hook;
  rmSync(dir, { recursive: true, force: true });

  const f1 = (x) => x.toFixed(1);
  const baseMean = mean(base);
  console.log(`PANTHEON sim: ${runs} seeds x 8 Nights on the human bot (reach %, share of runs that pay the Night)`);
  console.log('bot        ' + [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `N${n}`.padStart(5)).join('') + '   mean  boons  top payout');
  console.log(`unhooked   ${base.map((v) => f1(v).padStart(5)).join('')}  ${f1(baseMean).padStart(5)}`);
  for (const b of ORDER) console.log(`${b.padEnd(10)} ${B[b].reach.map((v) => f1(v).padStart(5)).join('')}  ${f1(B[b].meanReach).padStart(5)}  ${f1(B[b].boons).padStart(5)}  x${B[b].maxPay.toFixed(3)}`);

  const all = PA.BOONS.map((b) => b.id);
  const cap = PA.payoutCap(all);
  const worst = cap.payout * cap.atDread;
  const checks = [];
  const check = (what, ok, got) => checks.push({ what, ok, got });
  check(`best build (every boon): payout x atDread at most x${PA.PAYOUT_CAP}`, worst <= PA.PAYOUT_CAP + 1e-9, `raw x${cap.rawPayout.toFixed(3)} / x${cap.rawAtDread.toFixed(3)} -> x${worst.toFixed(3)}`);
  const topPay = Math.max(...ORDER.map((b) => B[b].maxPay));
  check(`payout multiplier seen in play at most x${PA.PAYOUT_CAP}`, topPay <= PA.PAYOUT_CAP + 1e-9, `x${topPay.toFixed(3)}`);
  const sameBase = Math.abs(B.none.meanReach - baseMean) <= 0.5;
  check('no boons == the unhooked run (mean within 0.5 point)', sameBase, `${f1(B.none.meanReach - baseMean)} points`);
  const defaults = !args.includes('--seed') && Number(runs) >= 2000;
  if (defaults) check(`no boons clears N8 at today's rate (${TODAY[7]} %, within 2 points)`, Math.abs(B.none.reach[7] - TODAY[7]) <= 2, `${f1(B.none.reach[7])} %`);
  const edge = B.greedy.meanReach / B.sensible.meanReach - 1;
  check('greedy beats sensible by at most 15 % of reach (mean over the Nights)', edge <= 0.15, `${edge >= 0 ? '+' : ''}${f1(edge * 100)} % (N8 ${f1(B.greedy.reach[7] - B.sensible.reach[7])} points)`);
  console.log('\nTARGETS');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'MISS'} ${c.what.padEnd(78)} ${c.got}`);
  const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
  if (outArg) writeFileSync(outArg, JSON.stringify({ baseline: base, bots: B, checks }, null, 2));
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
  await closeVite();
}
