// Juice pass B (table, card and pick machines): the presentation contracts, read off the source. Presentation only, so
// none of these tests touch an outcome: every celebrate passes its stake (the multiple scales the flash and the pour),
// a natural celebrates at medium, the legendary breath lands before the last shake, and the reveals that were added
// have their strings in EN and TR. The machine suites and the RTP checks cover the outcomes themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MACHINES = [
  'blackjack', 'claw', 'mines', 'lootbox', 'videopoker', 'scratch', 'shellgame', 'fantan', 'baccarat', 'sicbo',
  'stacker', 'tombola', 'fortuneteller',
];
const src = (machine, file = 'index.ts') => readFileSync(join(ROOT, 'src', 'machines', machine, file), 'utf8');

/** The argument text of every `this.celebrate(` call in a source text, with its parentheses matched. */
function celebrateCalls(text) {
  const out = [];
  const key = 'this.celebrate(';
  let at = text.indexOf(key);
  while (at >= 0) {
    const open = at + key.length - 1;
    let depth = 0, end = open;
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++;
      else if (text[end] === ')' && --depth === 0) break;
    }
    out.push(text.slice(open, end + 1));
    at = text.indexOf(key, end);
  }
  return out;
}

test('every celebrate in the juice B machines passes its stake, so the multiple scales the show', () => {
  for (const m of MACHINES) {
    for (const call of celebrateCalls(src(m))) {
      assert.match(call, /\bbet\b/, `${m}: celebrate without a bet ${call.slice(0, 80)}`);
    }
  }
});

test('blackjack: a natural is floored at medium, and every positive settle pours coins', () => {
  const bj = src('blackjack');
  assert.match(bj, /bj && !tierAtLeast\(jt, 'medium'\) \? 'medium' : jt/);
  assert.match(bj, /void this\.pourCoins\(win, \{ bet: ev\.stake, from: at, fast \}\)/);
});

test('claw: a lost prize slips (wobble and near-miss beat) before it drops, and the win shows gross less the stake', () => {
  const claw = src('claw');
  assert.match(claw, /private async slip\(/);
  assert.match(claw, /this\.nearMiss\(\{ at: mesh, dur: 0\.3/);
  assert.match(claw, /amount: Math\.max\(0, ev\.gross - bet\), bet/);
});

test('lootbox: the legendary breath lands before the last shake, and the coin spray scales with the value', () => {
  const lb = src('lootbox');
  assert.match(lb, /rarity === 'legendary' && s === shakes - 1\)/);
  assert.doesNotMatch(lb, /s === 3\)/, 'the old breath index could never run');
  assert.match(lb, /coinCount\(ev\.coins\)/);
});

test('videopoker: a royal flush is the jackpot show at the draw and a glitch pulse', () => {
  const vp = src('videopoker');
  assert.match(vp, /this\.celebrate\('jackpot'/);
  assert.match(vp, /glitchPulse\(0\.7, 0\.5\)/);
});

test('scratch: BUY THE THIRD carries the hit, holds the spot shut, then reveals with PAIR! or a buzzer', () => {
  const sc = src('scratch');
  assert.match(sc, /k: 'buy'; i: number; cells: number\[\]; gross: number; mult: number; cost: number; hit: boolean/);
  assert.match(sc, /cost: t\.cost, hit: t\.hit \}/);
  assert.match(sc, /const BUY_TICK_GAPS = \[/);
  assert.match(sc, /this\.buyResult\(ev\.i, buy\.hit\)/);
  const strings = src('scratch', 'strings.ts');
  assert.match(strings, /pairHit: 'PAIR!'/);
  assert.match(strings, /pairHit: 'ÇİFT!'/);
});

test('shellgame: a medium-plus cup win celebrates, and a hot streak raises a riser in the shuffle', () => {
  const sg = src('shellgame');
  assert.match(sg, /tierAtLeast\(tier, 'medium'\)/);
  assert.match(sg, /if \(s\.heat >= 3\) this\.sfx\('tensionRise'/);
});

test('sicbo: a near miss holds the last die one face off before it lands', () => {
  const sb = src('sicbo');
  assert.match(sb, /await this\.holdLastDie\(faces\)/);
  assert.match(sb, /r\.nearmiss\)\)/);
});

test('stacker: the take-or-climb window has a shrinking countdown, speeding ticks and a riser on the deadline', () => {
  const st = src('stacker');
  assert.match(st, /private drawWindow\(/);
  assert.match(st, /this\.sfx\('tensionRise', \{ vol: 0\.6, param: 1 \}\)/);
  assert.match(st, /this\.sfx\('clockTick', \{ vol: 0\.4, pitch: Math\.round\(6 \* \(1 - left \/ DECIDE_S\)\) \}\)/);
});

test('tombola: the pull carries the hold, the ring counts it down, and a result unrolls the paper first', () => {
  const tb = src('tombola');
  assert.match(tb, /remaining: this\.hs\.drum\.length, hold: HOLD_S \}\)/);
  assert.match(tb, /private async unroll\(/);
  assert.match(tb, /await this\.unroll\(ev\.ticket, pc\.fast\)/);
  assert.match(tb, /UNROLL_S = 0\.5/);
});

test('fortuneteller: the Grand Omen among the unpicked cards flips last, after a held near-miss beat', () => {
  const ft = src('fortuneteller');
  assert.match(ft, /omen === GRAND_OMEN\) continue;/);
  assert.match(ft, /await this\.nearMiss\(\{ at: card, dur: 0\.6 \}\)/);
  const strings = src('fortuneteller', 'fortuneteller.strings.ts');
  assert.match(strings, /grandSeen: 'THE GRAND OMEN WAS HERE'/);
  assert.match(strings, /grandSeen: 'BÜYÜK KEHANET BURADAYDI'/);
});

test('fantan: every winning seat of the local player celebrates at its own lamp', () => {
  const fn = src('fantan');
  assert.match(fn, /if \(w === best \|\| w\.seat !== this\.localSeat \|\| w\.gross <= w\.stake\) continue;/);
});

test('baccarat: a third card holds before the winner shows, and a loss one point short gets the near-miss beat', () => {
  const bc = src('baccarat');
  assert.match(bc, /st\.cards\.some\(\(row\) => \(row\[2\] \?\? ''\) !== ''\)/);
  assert.match(bc, /Math\.abs\(ev\.p - ev\.b\) === 1/);
});
