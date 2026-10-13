/**
 * Oni Feast pachislot — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the headless
 * play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * Game: 3 medals × V (V ∈ {1,2,5,10,25}) on 5 lines. A per-game lottery (out of 65 536) draws a FLAG; the player then
 * stops the three reels (any order). Each stop slips 0–4 stops (the reel control, MACHINES §7.4) so that the flagged
 * role is aligned when possible and no unflagged role is. Small-role flags not aligned are lost; BIG / REG flags are
 * carried until aligned. Bonuses: BIG "Oni Feast" 24 games, REG "Lantern Parade" 8 games; each bonus game is 3 in /
 * 13 (BIG) or 14 (REG) out, so a session nets +240 (BIG) or +88 (REG) medals. REPLAY makes the next game free.
 *
 * Symbol strips are 21 stops each. A window shows stop−1 (top), stop (mid), stop+1 (bottom). Lines: three rows,
 * two diagonals. Every roll is driven by explicit `u`/`rng` arguments; no hidden state.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Sym = 'ONI' | 'KOI' | 'REP' | 'LAN' | 'FAN' | 'BAR' | 'BLK';
/** A flag or a line role. `MISS` = nothing. */
export type Role = 'BIG' | 'REG' | 'LANTERN' | 'KOI' | 'REPLAY' | 'FAN' | 'MISS';
export type Bonus = 'BIG' | 'REG';
export type Setting = 1 | 2 | 3 | 4 | 5 | 6;
export type Hint = 'white' | 'blue' | 'purple' | 'gold';

export const STOPS = 21;
export const SLIP = 4;              // base slip window (stops after the press)
export const SLIP_CAP = 8;          // hard ceiling with slipFrames charms
export const SPS = 28;              // reel stops per second (constant spin)
export const REEL_OFF: readonly number[] = [0, 7, 14];   // visual phase at spin start
export const CYCLE_S = 4.1;         // minimum lever-to-lever time
export const AUTO_STOP_S = 30;      // after this, the remaining reels stop at random
export const MEDALS_IN = 3;         // medals bet per normal game
export const MEDAL_VALUES: readonly number[] = [1, 2, 5, 10, 25];
export const BET_STEPS: readonly number[] = MEDAL_VALUES.map((v) => v * MEDALS_IN);

/** Strips, index = stop (0..20). Left / centre / right. */
const strip = (s: string): Sym[] => s.split(' ') as Sym[];
export const STRIPS: readonly (readonly Sym[])[] = [
  strip('ONI KOI LAN REP FAN KOI LAN REP BLK KOI LAN REP BLK KOI LAN REP FAN KOI LAN REP BLK'),
  strip('ONI KOI LAN REP BLK KOI BLK REP BLK KOI BLK REP LAN KOI BLK REP BLK KOI BLK REP BLK'),
  strip('ONI KOI LAN REP BLK KOI LAN REP BAR KOI LAN REP BLK KOI LAN REP BLK KOI LAN REP BLK'),
];

/** Lottery, out of 65 536 (MACHINES §7.3). */
export const UNITS = 65536;
export const W_REPLAY = 8978, W_KOI = 9930, W_LANTERN = 683, W_FAN = 1638;
export const BIG_W: readonly number[] = [228, 234, 243, 252, 262, 273];   // by setting 1..6
export const REG_W: readonly number[] = [144, 156, 170, 199, 218, 252];
/** Setting distribution, percent (S1 40 … S6 5). */
export const SETTING_PCT: readonly number[] = [40, 20, 15, 12, 8, 5];
export const BONUS = {
  BIG: { games: 24, out: 13 },
  REG: { games: 8, out: 14 },
} as const;
export const BET_IN = MEDALS_IN;

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK = {
  slip: 'm.pachislot.slipFrames' as ModHook,
  bonusGames: 'm.pachislot.bonusGames' as ModHook,
  replayValue: 'm.pachislot.replayValue' as ModHook,
  autoAim: 'm.pachislot.autoAim' as ModHook,
  shift: 'm.pachislot.settingShift' as ModHook,
  peek: 'm.pachislot.settingPeek' as ModHook,
  jackpot: 'm.pachislot.jackpotChance' as ModHook,
};

/** Line roles as bits. Order = payout priority (BIG first). */
export const R_BIT: Record<Role, number> = { BIG: 1, REG: 2, LANTERN: 4, KOI: 8, REPLAY: 16, FAN: 32, MISS: 0 };
const ROLE_BITS = 1 | 2 | 4 | 8 | 16 | 32;
const TEASE_BIT = 64;                       // two ONI on a line (not REG): the MISS "tease"
const ROLE_ORDER: readonly Role[] = ['BIG', 'REG', 'LANTERN', 'KOI', 'REPLAY', 'FAN'];
const ROLE_ID: Record<Role, number> = { BIG: 0, REG: 1, LANTERN: 2, KOI: 3, REPLAY: 4, FAN: 5, MISS: 6 };
const LINES: readonly (readonly [number, number, number])[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

/** Symbol at `row` (0 top, 1 mid, 2 bottom) of `reel` when stopped on `stop`. */
export function cell(reel: number, stop: number, row: number): Sym {
  return STRIPS[reel][(stop + row - 1 + STOPS) % STOPS];
}

function lineMask(a: Sym, b: Sym, c: Sym): number {
  let m = 0;
  if (a === 'ONI' && b === 'ONI' && c === 'ONI') m |= R_BIT.BIG;
  else if (a === 'ONI' && b === 'ONI' && c === 'BAR') m |= R_BIT.REG;
  else if (a === b && b === c) {
    if (a === 'KOI') m |= R_BIT.KOI;
    else if (a === 'REP') m |= R_BIT.REPLAY;
    else if (a === 'LAN') m |= R_BIT.LANTERN;
  }
  if (a === 'FAN') m |= R_BIT.FAN;                       // FAN pays on the left reel, any line
  const ones = (a === 'ONI' ? 1 : 0) + (b === 'ONI' ? 1 : 0) + (c === 'ONI' ? 1 : 0);
  if (ones === 2 && !(a === 'ONI' && b === 'ONI' && c === 'BAR')) m |= TEASE_BIT;
  return m;
}

/** Role bits present on the three stops (every line). Precomputed: index = (l·21 + c)·21 + r. */
const TRIPLE_MASK = new Uint8Array(STOPS * STOPS * STOPS);
for (let l = 0; l < STOPS; l++) for (let c = 0; c < STOPS; c++) for (let r = 0; r < STOPS; r++) {
  let m = 0;
  for (const [rl, rc, rr] of LINES) m |= lineMask(cell(0, l, rl), cell(1, c, rc), cell(2, r, rr));
  TRIPLE_MASK[(l * STOPS + c) * STOPS + r] = m;
}

/** Role bits on a complete set of stops (`st[reel]` = stop). */
export function maskOf(st: readonly number[]): number {
  return TRIPLE_MASK[(st[0] * STOPS + st[1]) * STOPS + st[2]];
}

const ALIGN_MEMO = new Map<number, boolean>();
/**
 * True if some completion of the unstopped reels (null = unknown) puts `role` on a line. `clean`: that completion
 * must also leave every other role off the lines (the look-ahead the reel control uses).
 */
export function alignable(role: Role, st: readonly (number | null)[], clean = false): boolean {
  if (role === 'MISS') return false;
  const key = (((clean ? 7 : 0) + ROLE_ID[role]) * 22 + (st[0] ?? 21)) * 484 + (st[1] ?? 21) * 22 + (st[2] ?? 21);
  const hit = ALIGN_MEMO.get(key);
  if (hit !== undefined) return hit;
  const bit = R_BIT[role];
  const other = ROLE_BITS & ~bit;
  let ok = false;
  const lo = (v: number | null): number => (v === null ? 0 : v), hi = (v: number | null): number => (v === null ? STOPS - 1 : v);
  for (let l = lo(st[0]); l <= hi(st[0]) && !ok; l++)
    for (let c = lo(st[1]); c <= hi(st[1]) && !ok; c++)
      for (let r = lo(st[2]); r <= hi(st[2]) && !ok; r++) {
        const m = TRIPLE_MASK[(l * STOPS + c) * STOPS + r];
        if ((m & bit) && !(clean && (m & other))) ok = true;
      }
  ALIGN_MEMO.set(key, ok);
  return ok;
}

export interface StopOpts {
  /** The reel being stopped. */
  reel: number;
  /** Stop index under the payline at the press. */
  press: number;
  /** Stops of the reels so far (null = still spinning). */
  stops: readonly (number | null)[];
  /** The flagged role (carried bonus first). `MISS` = no target. */
  target: Role;
  slipMax: number;
  autoAim?: boolean;
  /** MISS games: avoid a visible ONI pair (applied 50 % of games, drawn by the caller). */
  avoidTease?: boolean;
}
export interface StopPlan { final: number; slip: number; score: number }

/**
 * Reel control (MACHINES §7.4). Candidates are the press and up to `slipMax` stops after it. Scores: +1000 keeps the
 * flagged role alignable (or aligns it on the last reel); −10 000 aligns any unflagged role (last reel only);
 * −5 000 shows a tease in a MISS game when `avoidTease`; −slip prefers small slips (ties → smaller slip).
 * `autoAim` lets FAN / LANTERN be caught from anywhere on the reel (the slip is then not limited).
 */
export function chooseStop(o: StopOpts): StopPlan {
  const st = o.stops.slice();
  const last = o.stops.every((v, i) => i === o.reel || v !== null);
  const wide = !!o.autoAim && (o.target === 'FAN' || o.target === 'LANTERN');
  const span = wide ? STOPS : Math.min(STOPS, o.slipMax + 1);
  const tbit = o.target === 'MISS' ? 0 : R_BIT[o.target];
  let best: StopPlan = { final: o.press, slip: 0, score: -Infinity };
  for (let slip = 0; slip < span; slip++) {
    const s = (o.press + slip) % STOPS;
    st[o.reel] = s;
    let score = -slip;
    if (last) {
      const m = maskOf(st as number[]);
      if (tbit && (m & tbit)) score += 1000;
      if (m & ROLE_BITS & ~tbit) score -= 10000;
      if (!tbit && o.avoidTease && (m & TEASE_BIT)) score -= 5000;
    } else {
      if (tbit && alignable(o.target, st, true)) score += 1000;
      // FAN is decided by the left reel alone: an unflagged FAN is certain as soon as the left reel shows one
      if (st[0] !== null && leftFanWindow(st[0]) && !(tbit & R_BIT.FAN)) score -= 10000;
    }
    if (score > best.score) best = { final: s, slip, score };
  }
  return best;
}

/** FAN shows somewhere in the left reel's window when the reel stops on `s`. */
export function leftFanWindow(s: number): boolean {
  return cell(0, s, 0) === 'FAN' || cell(0, s, 1) === 'FAN' || cell(0, s, 2) === 'FAN';
}

/** The stop a perfect-aim player presses on (best `chooseStop` score; ties broken by `rng` when given). */
export function bestPress(o: Omit<StopOpts, 'press'>, rng?: Rng): number {
  let best = -Infinity, pick = 0, ties = 0;
  for (let p = 0; p < STOPS; p++) {
    const sc = chooseStop({ ...o, press: p }).score;
    if (sc > best) { best = sc; pick = p; ties = 1; }
    else if (sc === best && rng) { ties++; if (rng.next() * ties < 1) pick = p; }
  }
  return pick;
}

/** Visual stop under the payline at time `t` (s) after the spin started. Continuous, so presses are timed on it. */
export function posAt(reel: number, t: number): number {
  return ((REEL_OFF[reel] + SPS * t) % STOPS + STOPS) % STOPS;
}

export interface Judgement {
  role: Role;
  medals: number;
  replay: boolean;
  /** A bonus starts (BIG or REG line). */
  bonus: Bonus | null;
  /** Bonus flag still carried after this game. */
  carry: Bonus | null;
  /** A flagged small role was not aligned. */
  lost: boolean;
  tease: boolean;
}

/**
 * Judges the final stops. `target` = held bonus, else the lottery flag. `held` = bonus carried in before this game.
 * `flag` = the lottery draw of this game (may be a small role or MISS).
 */
export function judge(mask: number, flag: Role, target: Role, held: Bonus | null, replayValue: number): Judgement {
  let role: Role = 'MISS';
  for (const r of ROLE_ORDER) if (mask & R_BIT[r]) { role = r; break; }
  const bonus: Bonus | null = role === 'BIG' || role === 'REG' ? role : null;
  const pending: Bonus | null = held ?? (flag === 'BIG' || flag === 'REG' ? flag : null);
  const carry = pending && !(mask & R_BIT[pending]) ? pending : null;
  const lost = target !== 'MISS' && target !== 'BIG' && target !== 'REG' && !(mask & R_BIT[target]);
  // REPLAY returns the 3 medals wagered (its next game is funded by that credit, so the wager of every game counts)
  const medals = role === 'LANTERN' ? 12 : role === 'KOI' ? 8 : role === 'FAN' ? 2 : role === 'REPLAY' ? MEDALS_IN + replayValue : 0;
  return { role, medals, replay: role === 'REPLAY', bonus, carry, lost, tease: !!(mask & TEASE_BIT) };
}

/** Bonus session: games, medals out per game, and the net medals of the whole session. */
export function bonusPlan(type: Bonus, extraBigGames = 0): { games: number; out: number; net: number } {
  const b = BONUS[type];
  const games = b.games + (type === 'BIG' ? Math.max(0, Math.floor(extraBigGames)) : 0);
  return { games, out: b.out, net: games * (b.out - BET_IN) };
}

/** The lottery flag. `u` in [0, 65536). A carried bonus is never redrawn: BIG/REG draws become MISS. */
export function drawFlag(u: number, setting: Setting, luck: number, jackpot: number, bonusHeld: boolean): Role {
  const lm = Math.min(1.6, Math.max(0.5, 1 + 0.02 * luck));
  const bands: Array<[Role, number]> = [
    ['REPLAY', W_REPLAY], ['KOI', W_KOI], ['LANTERN', W_LANTERN], ['FAN', W_FAN],
    ['BIG', BIG_W[setting - 1] * lm * jackpot], ['REG', REG_W[setting - 1] * lm],
  ];
  let t = 0;
  for (const [role, w] of bands) {
    t += w;
    if (u < t) return bonusHeld && (role === 'BIG' || role === 'REG') ? 'MISS' : role;
  }
  return 'MISS';
}

/** Setting 1–6 from the world stream (40 / 20 / 15 / 12 / 8 / 5 %). */
export function rollSetting(rng: Rng): Setting {
  const r = rng.int(1, 100);
  let acc = 0;
  for (let i = 0; i < SETTING_PCT.length; i++) {
    acc += SETTING_PCT[i];
    if (r <= acc) return (i + 1) as Setting;
  }
  return 6;
}

export const clampSetting = (n: number): Setting => Math.min(6, Math.max(1, Math.round(n))) as Setting;
export const clampSlip = (n: number): number => Math.min(SLIP_CAP, Math.max(SLIP, Math.round(n)));

/**
 * End-screen oni colour after a bonus (a hint of the setting). Purple only on S4–S6 (20 %); gold only on S6 (5 %).
 * Authority-rolled and sent in the event, so every peer shows the same colour.
 */
export function hintColour(setting: number, rng: Rng): Hint {
  const a = rng.next(), b = rng.next();
  if (setting >= 6 && a < 0.05) return 'gold';
  if (setting >= 4 && b < 0.2) return 'purple';
  return a < 0.5 ? 'white' : 'blue';
}

/** Headless single bet for staff auto-play and balance sims (perfect aim, carry not simulated: see the sim). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const V = bet / BET_IN;
  const setting = clampSetting(rollSetting(rng) + Math.floor(h.mod(HOOK.shift, 0)));
  const slipMax = clampSlip(SLIP + Math.floor(h.mod(HOOK.slip, 0)));
  const replayValue = Math.max(0, Math.floor(h.mod(HOOK.replayValue, 0)));
  const extraBig = Math.floor(h.mod(HOOK.bonusGames, 0));
  const jackpot = Math.max(0, h.mod(HOOK.jackpot, 1));
  const autoAim = h.mod(HOOK.autoAim, 0) > 0;
  // One paid game. A REPLAY returns its 3 medals in `gross`, so the bet is covered; its free follow-up game is not
  // played here (the live machine plays it). Carried bonus flags are not simulated here (see the sim).
  const flag = drawFlag(rng.int(0, UNITS - 1), setting, h.luck, jackpot, false);
  const st: (number | null)[] = [null, null, null];
  const avoidTease = flag === 'MISS' && rng.next() < 0.5;
  for (const reel of [0, 1, 2]) {
    const press = bestPress({ reel, stops: st, target: flag, slipMax, autoAim, avoidTease }, rng);
    st[reel] = chooseStop({ reel, press, stops: st, target: flag, slipMax, autoAim, avoidTease }).final;
  }
  const j = judge(maskOf(st as number[]), flag, flag, null, replayValue);
  let gross = j.medals * V;
  let tags: string[] = [];
  if (j.bonus) {
    gross += bonusPlan(j.bonus, extraBig).net * V;
    tags = ['bonus', j.bonus];
  }
  return { gross, tags };
};
