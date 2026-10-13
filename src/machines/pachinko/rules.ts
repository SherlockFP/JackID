/**
 * Pachinko "Deep Rain" — pure rules (no three, no DOM, no kit). Shared by the live machine (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * Model (MACHINES_machines §8): each fired ball rolls a SINK from the handle zone, the machine mode and the tulip
 * state. Modes: N (normal), A (attacker chain: 10 rounds; a round closes at 9 entries or 40 balls), K (kakuhen:
 * right-shot, electric chu-lip, free balls until the next jackpot). A START or E-CHU entry spins the 3-digit slot
 * (jackpot 1/199 normal, 1/40 kakuhen). A jackpot opens the attacker chain; its end decides kakuhen (50 %).
 *
 * RNG discipline: `ballStep` draws exactly one number for the sink, plus `spinRoll` (7 numbers) only when a spin is
 * granted. The tulip Markov state lives in `Sim`, so the stationary catch rate is 3.0 % in the sweet zone.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Zone = 'FOUL' | 'LOW' | 'SWEET' | 'HIGH' | 'RIGHT';
export type Mode = 'N' | 'K' | 'A';
export type Sink = 'OUT' | 'SIDE' | 'TULIP' | 'START' | 'ECHU' | 'ATTACKER';
export const SINKS: readonly Sink[] = ['OUT', 'SIDE', 'TULIP', 'START', 'ECHU', 'ATTACKER'];
export type ReachType = 'NORMAL' | 'SUPER' | 'PREMIUM';

/** Balls returned per sink (ATTACKER before `attackerPay`). */
export const RETURNS: Readonly<Record<Sink, number>> = { OUT: 0, SIDE: 5, TULIP: 7, START: 3, ECHU: 3, ATTACKER: 14 };
export const BALL_RATE = 1.6;          // balls per second while firing
export const ROUNDS = 10;              // attacker rounds per jackpot chain
export const ENTRIES_PER_ROUND = 9;    // an attacker round closes at 9 entries …
export const BALLS_PER_ROUND = 40;     // … or after 40 balls (≈ 25 s at 1.6 balls/s)
export const HOLD_BASE = 4;            // digital slot holds (max queued spins)
export const KAKU_BASE = 0.5;          // chance a jackpot chain ends in kakuhen
export const KAKU_CAP = 0.8;
export const LUCK_PER_POINT = 0.001;   // +0.1 % absolute START per luck point in the sweet zone …
export const LUCK_CAP = 0.03;          // … capped at +3 %

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_JACKPOT = 'm.pachinko.jackpotChance' as ModHook;   // × 1/199 (base 1)
export const HOOK_KAKU = 'm.pachinko.kakuhenRate' as ModHook;        // + absolute kakuhen share (base 0.5, cap 0.8)
export const HOOK_ATTACKER = 'm.pachinko.attackerPay' as ModHook;    // + balls per attacker entry (base 0)
export const HOOK_TULIP = 'm.pachinko.tulipBoost' as ModHook;        // relative open-catch boost (base 0; 0.1 = +10 %)
export const HOOK_HOLDS = 'm.pachinko.holdMax' as ModHook;           // max queued spins (base 4)
export const HOOK_SWEET = 'x.pachinko.sweetWiden' as ModHook;        // sweet half-width (fraction; charm glass_funnel)
export const HOOK_PAYOUT = 'm.pachinko.payoutMult' as ModHook;       // × jackpot-chain payouts only (base 1)

export interface Opts {
  luck: number;          // luck points (0.1 % START each in the sweet zone)
  jackpotMult: number;   // × jackpot chance
  kakuRate: number;      // chance a chain ends in kakuhen
  attackerPay: number;   // extra balls per attacker entry
  tulipBoost: number;    // relative open-catch boost
  holdMax: number;       // max queued spins
  sweetWiden: number;    // sweet zone widened by this fraction on both sides (0..0.15)
  payoutMult: number;    // jackpot-chain payout multiplier
}

export const DEFAULT_OPTS: Opts = {
  luck: 0, jackpotMult: 1, kakuRate: KAKU_BASE, attackerPay: 0, tulipBoost: 0, holdMax: HOLD_BASE, sweetWiden: 0, payoutMult: 1,
};

/** Read the hooks through the run's modifier fold (live and headless alike). */
export function readOpts(mod: (hook: ModHook, base: number) => number, luck: number): Opts {
  return {
    luck,
    jackpotMult: Math.max(0, mod(HOOK_JACKPOT, 1)),
    kakuRate: Math.min(KAKU_CAP, Math.max(0, mod(HOOK_KAKU, KAKU_BASE))),
    attackerPay: Math.max(0, Math.round(mod(HOOK_ATTACKER, 0))),
    tulipBoost: Math.max(0, mod(HOOK_TULIP, 0)),
    holdMax: Math.min(8, Math.max(1, Math.round(mod(HOOK_HOLDS, HOLD_BASE)))),
    sweetWiden: Math.min(0.15, Math.max(0, mod(HOOK_SWEET, 0))),
    payoutMult: Math.max(0, mod(HOOK_PAYOUT, 1)),
  };
}

/** Handle strength (0–100 %) → zone. Sweet = 58–74 %, widened by `widen` (fraction, applied as percentage points). */
export function zoneOf(strength: number, widen = 0): Zone {
  const w = widen * 100;
  if (strength < 40) return 'FOUL';
  if (strength < 58 - w) return 'LOW';
  if (strength < 74 + w) return 'SWEET';
  if (strength < 88) return 'HIGH';
  return 'RIGHT';
}

/** Pure machine state for the sink / chain logic (no timers, no holds). */
export interface Sim {
  mode: Mode;
  round: number;        // 1..10 while mode A, else 0
  entries: number;      // attacker entries this round
  balls: number;        // balls fired this round
  gate: boolean;        // attacker gate open
  tulip: boolean;       // tulip open (Markov state)
  kaku: boolean;        // the running chain ends in kakuhen
}

export function initSim(tulipOpen = false): Sim {
  return { mode: 'N', round: 0, entries: 0, balls: 0, gate: false, tulip: tulipOpen, kaku: false };
}

/** Sink weights for a non-FOUL zone in a state. Sums to 1; order matches `SINKS`. */
export function sinkWeights(zone: Exclude<Zone, 'FOUL'>, s: Sim, o: Opts): number[] {
  const w: Record<Sink, number> = { OUT: 0, SIDE: 0, TULIP: 0, START: 0, ECHU: 0, ATTACKER: 0 };
  if (s.mode === 'A' && !s.gate) { w.OUT = 1; return SINKS.map((k) => w[k]); }   // gate closing: everything OUT
  if (zone === 'RIGHT') {
    if (s.mode === 'A') { w.ATTACKER = 0.95; w.OUT = 0.05; }
    else if (s.mode === 'K') { w.ECHU = 0.35; w.OUT = 0.65; }
    else { w.START = 0.003; w.OUT = 0.997; }
  } else {
    if (zone === 'LOW') { w.SIDE = 0.055; w.TULIP = 0.02; w.START = 0.02; }
    else if (zone === 'SWEET') {
      w.SIDE = 0.04;
      w.TULIP = s.tulip ? 0.09 * (1 + o.tulipBoost) : 0.018;       // Markov catch: closed 1.8 %, open 9 %
      w.START = 0.035 + Math.min(LUCK_CAP, o.luck * LUCK_PER_POINT);
    } else { w.SIDE = 0.03; w.TULIP = 0.025; w.START = 0.025; }
    if (s.mode === 'A') w.ATTACKER = 0.08;                          // gate open on a left shot: 8 % taken from OUT
    w.OUT = 1 - w.SIDE - w.TULIP - w.START - w.ATTACKER;
  }
  return SINKS.map((k) => w[k]);
}

export interface Spin {
  jackpot: boolean;
  reach: ReachType | null;
  /** On a jackpot: the chain ends in kakuhen (odd triple) instead of normal (even triple). */
  kakuNext: boolean;
  digits: [number, number, number];
}

/** One digital-slot spin. Always draws exactly seven numbers. */
export function spinRoll(rng: Rng, kakuhen: boolean, o: Opts): Spin {
  const dJ = rng.next(), dR = rng.next(), dT = rng.next(), dK = rng.next();
  const dA = rng.next(), dB = rng.next(), dC = rng.next();
  const jackpot = dJ < (kakuhen ? 1 / 40 : 1 / 199) * o.jackpotMult;
  const kakuNext = dK < o.kakuRate;
  let reach: ReachType | null = null;
  if (jackpot) reach = dT < 0.10 ? 'NORMAL' : dT < 0.60 ? 'SUPER' : 'PREMIUM';
  else if (dR < 1 / 12) reach = dT < 0.85 ? 'NORMAL' : dT < 0.99 ? 'SUPER' : 'PREMIUM';
  let digits: [number, number, number];
  if (jackpot) {
    const v = kakuNext ? 1 + 2 * Math.floor(dA * 5) : 2 + 2 * Math.floor(dA * 4);   // odd 1..9 / even 2..8
    digits = [v, v, v];
  } else {
    const a = 1 + Math.floor(dA * 9), b = 1 + Math.floor(dB * 9);
    let c = 1 + Math.floor(dC * 9);
    if (a === b && b === c) c = (c % 9) + 1;                                       // never a triple by accident
    digits = [a, b, c];
  }
  return { jackpot, reach, kakuNext, digits };
}

/** Digital slot spin length in seconds (MACHINES §8.3). */
export function spinSeconds(reach: ReachType | null, kakuhen: boolean, holds: number): number {
  if (reach === 'NORMAL') return 12;
  if (reach === 'SUPER') return 25;
  if (reach === 'PREMIUM') return 35;
  return kakuhen || holds >= 3 ? 2 : 5;
}

export interface BallOut {
  foul: boolean;          // returned to the tray: no cost, no sink
  sink: Sink;
  returns: number;        // balls credited for this ball
  spin: Spin | null;
  jackpotStart: boolean;  // this ball's spin opened an attacker chain
  roundEnd: boolean;      // an attacker round just closed (caller reopens the gate after its pause)
  chainEnd: boolean;      // the attacker phase just ended (mode left A for K or N)
}

/** Open the attacker gate for the next round (headless: at once; live: after the 2 s close). */
export function openGate(s: Sim): void {
  if (s.mode === 'A' && s.round >= 1 && s.round <= ROUNDS) { s.gate = true; s.entries = 0; s.balls = 0; }
}

/** Close the current attacker round. Round 10 ends the chain: mode goes to K when the chain chose kakuhen, else N. */
export function endRound(s: Sim): void {
  s.gate = false;
  s.entries = 0;
  s.balls = 0;
  if (s.round >= ROUNDS) { s.mode = s.kaku ? 'K' : 'N'; s.round = 0; }
  else s.round++;
}

/**
 * One fired ball. `canSpin` is false when the holds are full (the entry still pays, but no spin). Mutates `s`.
 * The sink draw is always consumed (one number) so the stream does not depend on the spin outcome.
 */
export function ballStep(rng: Rng, s: Sim, zone: Zone, o: Opts, canSpin: boolean): BallOut {
  if (zone === 'FOUL') return { foul: true, sink: 'OUT', returns: 0, spin: null, jackpotStart: false, roundEnd: false, chainEnd: false };
  const wasA = s.mode === 'A';
  const weights = sinkWeights(zone, s, o);
  const u = rng.next();
  let acc = 0, sink: Sink = 'OUT';
  for (let i = 0; i < SINKS.length; i++) { acc += weights[i]; if (u < acc) { sink = SINKS[i]; break; } }
  if (sink === 'TULIP') s.tulip = !s.tulip;                                       // a catch toggles the tulip
  if (s.mode === 'A' && s.gate) s.balls++;
  let returns = RETURNS[sink];
  if (sink === 'ATTACKER') { s.entries++; returns += o.attackerPay; }
  let spin: Spin | null = null;
  let jackpotStart = false;
  if ((sink === 'START' || sink === 'ECHU') && canSpin) {
    spin = spinRoll(rng, s.mode === 'K', o);
    if (spin.jackpot) {
      jackpotStart = true;
      s.mode = 'A'; s.round = 1; s.gate = true; s.entries = 0; s.balls = 0; s.kaku = spin.kakuNext;
    }
  }
  let roundEnd = false;
  if (s.mode === 'A' && s.gate && !jackpotStart && (s.entries >= ENTRIES_PER_ROUND || s.balls >= BALLS_PER_ROUND)) {
    roundEnd = true;
    endRound(s);
  }
  const chainEnd = wasA && s.mode !== 'A';          // the attacker phase (10 rounds) is over: K or N
  return { foul: false, sink, returns, spin, jackpotStart, roundEnd, chainEnd };
}

/**
 * Headless: resolve a whole jackpot chain with RIGHT shots until the mode is back to N (gate reopened at once).
 * Returns the chain's gross returns (× payoutMult), the balls it cost and the jackpots it held.
 */
export function runChain(rng: Rng, s: Sim, o: Opts): { returns: number; fired: number; jackpots: number } {
  let returns = 0, fired = 0, jackpots = 1;
  for (let guard = 0; guard < 100000 && s.mode !== 'N'; guard++) {
    if (s.mode === 'A' && !s.gate) openGate(s);
    const b = ballStep(rng, s, 'RIGHT', o, true);
    fired++;
    returns += b.returns;
    if (b.jackpotStart) jackpots++;
  }
  return { returns: returns * o.payoutMult, fired, jackpots };
}

/**
 * Headless round = ONE normal ball from the sweet zone (bet = ball value V). Gross = its returns plus, on a jackpot,
 * the chain's net (payouts × payoutMult − balls fired). The tulip starts from its stationary law (open 1/6), so a
 * one-ball round samples the steady-state catch rate exactly.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const o = readOpts((hook, base) => h.mod(hook, base), h.luck);
  const s = initSim(rng.chance(1 / 6));
  const b = ballStep(rng, s, 'SWEET', o, true);
  let gross = b.returns;
  const tags: string[] = [];
  if (b.jackpotStart) {
    const c = runChain(rng, s, o);
    gross += c.returns - c.fired;
    tags.push('jackpot', 'bonus');
  }
  return { gross: Math.max(0, gross) * bet, tags };
};
