/**
 * The Big One (`bigone`) — hero 5×3 pattern slot (MACHINES §2). Copies the coinflip pattern: the logic / present split.
 *
 *  - `spin()` runs on the authority (the local occupant): `beginRound` charges the stake, the pure rules in
 *    `rules.ts` roll the grid, and the outcome is packed into a `spin` event and an `eval` event. The `eval` event
 *    carries the settle as its `credit` (settle-before-present, DECISIONS G).
 *  - `present()` is the only place state changes and the reels move, on every peer.
 *  - juice: lever pull, reel spin-up and whirr (bulbs chase fast, the whirr thins out as reels land), staggered stops
 *    (0.75 + 0.2 n s) with a bounce and a clack that climbs reel to reel, a tick when symbols line up on a row, tease crawl
 *    on the last reel, cell and pattern lamps, coin pour, tiered win shows through `celebrate` (big / huge / mega / jackpot), curse
 *    (red flash, chroma glitch), jackpot (lid, medallion, gold count-up).
 *  - autoplay (G) with a size cycled by Backspace; it stops on big wins, curses, jackpots, no funds and no pulls.
 *
 * LUCKY 7: three Suns (the seven) on one spin pay three free spins at half value; they run as one round.
 * HOLD: after a spin that did not pay, 1–5 keeps one reel for the next spin at HOLD_COST (+50 %) the stake.
 *
 * Controls: Space / LMB / Enter spin · Z / X / wheel stake · B max · G autoplay (again = stop) · Backspace auto size
 * · 1–5 hold a reel (after a losing spin, +50 % stake) · H pattern card · F fast · E stand.
 */
import type * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import { registerDebugForce } from '@/core/debugForce';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast, windupSec } from '@/machines/_base/tiers';
import { countUp, blinkOn, emitComboShow, flashPrefs, scorePop, JACKPOT_COUNT_S, type Whirr } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { KitX } from '@/kit';
import { fmtCoins, t as tr, upper } from '@/core/i18n';
import { SeatHud, type HudControl, type HudPay, type Txt } from '@/machines/_base/seatHud';
import { TAU } from '@/core/math';
import { px5Width } from '@/core/texgen/font';
import { buildModel, type BigOneParts } from './model';
import {
  BASE_VALUE, CELLS, HOLD_COST, LUCKY_SPINS, MAW, MAX_LINE_MULT, MAX_STAKE, PATTERN_IDS, PATTERN_MULT, SEED_STAKES, SYM_COUNT, SYM_NAMES,
  buildMods, chaseOf, chaseRoll, curseChance, playHeadless, playRound, CHASE_MULT, CHASE_P,
  type ChaseOffer, type Mods, type Outcome, type PatternId, type Round,
} from './rules';
import { STRINGS } from './strings';
import { SYMBOL_BG, paintSymbol } from './symbols';
import { COMBO_MIN, IDLE_HZ, LIVE_HZ, comboPlan, hzCap, lineRun, lineUpPitch, symFrame, type FlashOpts } from './show';
import { gildLevels } from './stamps';

export { playHeadless };

/** Player flash settings (reduceFlashing / Calm). Missing save data reads as both off. */
function flashOpts(): FlashOpts { return flashPrefs(); }

/** Visible facet of each row (row 0 top, 1 middle, 2 bottom): facet 1 = top, 0 = middle, 15 = bottom (see paintReel). */
const FACET_OF_ROW = [1, 0, 15] as const;

/** Event payloads (type aliases so they stay JSON-compatible). */
type PayEv = { pat: string; sym: number; cells: number[]; amount: number; raw: number; combo: number };
type SpinEv = {
  k: 'spin'; stake: number; grid: number[]; pre: number[] | null; coalesced: number[]; teaser: number[];
  curse: boolean; curseCol: number; ward: boolean; fill: boolean; fillSym: number; respin: boolean; tease: boolean;
  /** Near-miss tell: the reel that crawls, its row and the run length lined up (-1 when none). */
  tReel: number; tRow: number; tLen: number;
  hold: number; meter: number; since: number; night: number;
  /** 0 for the staked spin, n for LUCKY 7 free spin n. */
  free: number;
};
type EvalEv = {
  k: 'eval'; stake: number; gross: number; jackpot: number; curse: boolean; fill: boolean; tease: boolean;
  /** Every paying pattern in tally order (smallest first). */
  tally: PayEv[]; tags: string[]; meter: number;
  /** LUCKY 7 round: the round's spins are called out together on the last one. */
  lucky: boolean;
  /** The three sevens of the staked spin (empty on the free spins). */
  sevens: number[];
  /** Free spin index (0 for the staked spin), and whether this is the round's last spin (it settles the round). */
  free: number; last: boolean;
  /** The round's gross (all its spins) and the round's settle tags, valid on the last spin. */
  round: number;
};
type HoldEv = { k: 'hold'; reel: number };
/** CHASE: the extra spin of a chased win. `amount` is what it pays (0 on a miss), `stake` the round's stake. */
type ChaseEv = { k: 'chase'; win: boolean; grid: number[]; line: number[]; amount: number; stake: number; tags: string[] };
/** COLLECT: the pot is taken as it stands. */
type CollectEv = { k: 'collect'; amount: number; stake: number };
type Ev = SpinEv | EvalEv | HoldEv | ChaseEv | CollectEv;
/** A chase offer waiting for the player: the pot at risk, its line and the round's stake. */
type Offer = ChaseOffer & { stake: number };
type State = {
  grid: number[]; meter: number; k: number; night: number; last10: number[]; hold: number; wardUsed: number; gross: number;
  /** The last spin's pattern breakdown, kept on the top screen until the next spin. */
  tally: PayEv[];
};

/** Reel n stops at 0.75 + 0.2 n s: a round is felt in under four seconds (MACHINES §2.3 spin order, juice timing). */
const STOP_T = [0.75, 0.95, 1.15, 1.35, 1.55];
/** Free spins run their reels at this share of the staked spin's time. */
const FREE_SPEED = 0.6;
/** Extra crawl of the anticipating reel by the run length lined up (index = length: 2 = two of three). */
const TEASE_D = [0, 0, 0.4, 0.55, 0.7];
const BOUNCE = 0.12;
/** Tally: each pattern gets a step of STEP_MAX down to STEP_MIN so the whole count stays under TALLY_CAP seconds (a normal win scores in ~1 s). */
const STEP_MAX = 0.3;
const STEP_MIN = 0.16;
const TALLY_CAP = 1.0;
/** Where the seat banner starts, in % of the screen height: under the cabinet's JACKPOT plate, readout and LCD, above the reels (seatHud.topBelow). */
const BANNER_TOP_PCT = 25;
/** Free spins tally quicker: a fixed step per pattern. */
const QUICK_STEP = 0.14;
/** Tally text colours, escalating from pale to hot. */
const TALLY_INK = ['#c8e8ff', '#ffe27a', '#ffb000', '#ff7a1a', '#ff4fa0', '#ffffff'];
const CURSE_SHOW = 3.2;
const FORCE_CHASE_TRIES = 400;          // debug force: re-rolls allowed to find a chaseable line win
/** The jackpot count starts at the show's impact (after its windup) and runs as long as the coin rain. */
const JACKPOT_WINDUP = windupSec('jackpot');
const LAST10 = 10;
/** Extra seconds the reels 2 to 4 hold back while two jackpot symbols stand side by side. */
const JP_EXTRA = [0, 0, 0.3, 0.7, 1.3];
/** How many leading columns (reels) stand fully on one and the same symbol (grid is row-major, 5 columns). */
function lockedColumns(grid: readonly number[]): number {
  const sym = grid[0];
  if (sym === undefined || sym < 0) return 0;
  let n = 0;
  for (let c = 0; c < 5; c++) {
    if (grid[c] === sym && grid[5 + c] === sym && grid[10 + c] === sym) n++;
    else break;
  }
  return n;
}
const LID_OPEN = (25 * Math.PI) / 180;
const LEVER_PULL = 1.05;
const GOLD = 0xffd040;
const RED = 0xff1a2a;
const PINK = 0xff4fa0;
const AUTO_SIZES = [5, 10, 25];
const DEFAULT_GRID = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0];
const HOLD_KEYS: Record<string, number> = { n1: 0, n2: 1, n3: 2, n4: 3, n5: 4 };

export const def: MachineDef = {
  id: 'bigone',
  category: 'slot',
  slotSize: 'XL',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: MAX_STAKE, betSteps: [1, 2, 5, 10, 20, 50, 100],
  maxPayoutMult: MAX_LINE_MULT,
  rtp: 0.947,
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'slot', 'hero', 'pattern'],
  modHooks: {
    'x.bigone.symbolValueAdd[SYM]': 'Symbol value +N (int).',
    'x.bigone.symbolValueMult': 'Multiplier on every symbol value (float).',
    'x.bigone.symbolWeight[SYM]': 'Draw weight +N (GHOST included).',
    'x.bigone.symbolBan[SYM]': 'Bans a symbol (weight 0). At least three symbols always remain.',
    'x.bigone.patternMult[PATTERN]': 'Pattern multiplier +N (float). Plain x.bigone.patternMult adds to every pattern.',
    'x.bigone.extraPattern': 'Unlocks TWIN RAILS and CORNERSTONE (charm).',
    'x.bigone.wildChance': 'Chance each cell becomes GHOST (wild), 0 to 0.2.',
    'x.bigone.curseChanceMult': 'Multiplies the curse (EATEN) chance.',
    'x.bigone.curseWard': 'Curse ward charges: an EATEN spin becomes a normal spin, consuming one.',
    'x.bigone.jackpotFeed': 'Meter feed as a fraction of every stake (default 0.01).',
    'x.bigone.respin': 'Chance after a losing spin to respin reels 4 and 5 for free.',
    'x.bigone.holdReel': 'Allows holding one reel after a spin that did not pay (keys 1 to 5). On by default, costs HOLD_COST x the stake.',
    'jackpot.mult': 'Multiplies the FULL (jackpot) odds.',
    luck: 'Luck: coalesce chance +1 % per point (cap 30 %), plus the pre-coalesce grid for a visible jump.',
  },
  // seat coach (_base/coach.ts): taught by doing on the first sits
  coach: [
    { key: 'primary', say: 'spin', done: 'round' },
    { key: 'betUp', say: 'bet', done: 'bet' },
    { key: 'auto', say: 'gamble', done: 'gamble' },
  ],
  strings: STRINGS,
};

export default class BigOne extends MachineBase<BigOneParts, Ev, State> {
  private state: State = {
    grid: DEFAULT_GRID.slice(), meter: SEED_STAKES * MAX_STAKE, k: 0, night: -1, last10: [], hold: -1, wardUsed: 0, gross: 0, tally: [],
  };
  private autoLeft = 0;
  private autoSize = AUTO_SIZES[0];
  private fastOn = false;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  private attractStep = -1;
  private inRound = false;
  /** True only while the reels are physically turning: the seat HUD must not say REELS TURNING over a shown result. */
  private reelsTurning = false;
  /** The stake of the last settled spin: the WIN line on the top screen shows its net against this. */
  private lastStake = 0;
  /** Last painted key per cell (-1 = repaint) for the render-rate symbol frames. */
  private symKey = new Int16Array(CELLS).fill(-1);
  /** Combo show: a new show bumps `comboSeq` so an older show's timers do nothing; `comboOn` keeps the celebrate from taking the bulbs. */
  private comboSeq = 0;
  private comboOn = false;
  /** A chased win waiting for the player: SPACE collects the pot, G chases it. Local only; `roundOpen` stays true meanwhile. */
  private offer: Offer | null = null;
  /** Debug force (`bigone:chase`): the next spin is re-rolled until it is a chaseable line win. */
  private force: 'chase' | 'win' | null = null;
  /** The JACKPOT LED on the cabinet: the value it shows and the value it is heading to (it ticks up instead of jumping). */
  private ledShown = -1;
  private ledTarget = -1;
  private ledSeq = 0;
  /** True while a jackpot tease / show owns the LED colour. */
  private ledBusy = false;

  protected createModel(kit: KitX): MachineModel<BigOneParts> {
    return buildModel(kit, this.modelOpts);
  }

  /** Fast mode halves every animation (local presentation only; the sim clock is unchanged). */
  protected override get speed(): number {
    return super.speed * (this.fastOn ? 0.5 : 1);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.bulbsIdle();
    this.attractor.every('medal', 9, () => this.spinMedal(), { first: 4 });
    this.attractor.every('twinkle', 13, () => this.twinkle(), { first: 7, jitter: 4 });
  }

  /** Attract sparkle: the crown bulbs twinkle for a second and a half, then the idle chase returns. Not under reduce-flashing / Calm. */
  private twinkle(): void {
    const o = flashOpts();
    if (this.busy || this.occupant !== null || this.comboOn || o.reduced || o.calm) return;
    this.parts.bulbs.crown.setPattern('twinkle', 8);
    void this.wait(1.5).then(() => { if (!this.disposed && !this.busy && this.occupant === null) this.bulbsIdle(); });
  }

  // ── attract: the pattern plate chases, the medallion turns now and then ─────────────────────────
  attract(dt: number, time: number): void {
    const step = Math.floor(time * 6) % PATTERN_IDS.length;
    if (step !== this.attractStep) {
      this.attractStep = step;
      this.parts.patternLamps.forEach((l, i) => l.setOn(i === step));
    }
    this.attractor.update(dt);
  }

  /** Debug force (bench `--force bigone:chase|win`, seated): the next spin is re-rolled until it is a line win that can be chased, or any win. */
  private debugState(state: string): boolean {
    const s = state.trim().toLowerCase();
    if ((s !== 'chase' && s !== 'win') || !this.isLocalOccupant) return false;
    this.force = s;
    return true;
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    this.bulbsIdle();
    if (local) {
      registerDebugForce(this.def.id, (s) => this.debugState(s));
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.pay(this.payStrip());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.autoLeft = 0;
      this.seatHud?.hide();
      if (this.offer) {                                // a chased win left on the table is collected, never lost
        const o = this.offer;
        this.offer = null;
        this.settle({ gross: o.pot, tags: o.tags });
      } else if (this.roundOpen) this.settle({ gross: 0 });   // safety net: never strand a stake
    }
    this.attractor.reset();
    this.refresh();
    this.bulbsIdle();
  }

  /** E / pause "STAND UP": cancel autoplay now. The current round (if any) still settles, then the seat is released. */
  protected override onStandUpRequest(): void {
    if (this.offer) this.collectKey();               // leaving with a chase on offer collects the pot first
    if (this.autoLeft === 0) return;
    this.autoLeft = 0;
    this.showHud();
  }

  /** The Watch closed: autoplay stops and a chase on offer is collected, so no key pays in Dawn. */
  protected override onWatchClosed(): void {
    this.autoLeft = 0;
    if (this.offer) this.collectKey();
    this.showHud();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.spinKey(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.maxKey(); break;
      case 'auto': this.toggleAuto(); break;
      case 'clear': this.cycleAutoSize(); break;
      case 'fast': this.fastOn = !this.fastOn; this.sfx('click'); this.toast(this.t(this.fastOn ? 'fastOn' : 'fast'), 'info'); this.showHud(); break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': this.toggleHold(HOLD_KEYS[a]); break;
    }
  }

  /** MAX key: the highest stake the pocket and the run's stake cap allow. When the cap is what stops it, a toast names the cap. */
  private maxKey(): void {
    if (this.inRound || this.roundOpen || this.autoLeft > 0) return;
    const before = this.bet;
    this.maxBet();
    if (this.bet !== before) this.sfx('click');
    this.showHud();
    const cap = this.ctx.run.betLimits(this.def.id, this.id).max;
    if (cap < this.ctx.run.wallet() && this.bet >= cap) this.toast(tr('stake.cap', { max: cap }), 'warn');
  }

  private changeBet(fn: () => void): void {
    if (this.inRound || this.roundOpen || this.autoLeft > 0) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  /** SPACE: collects a chase offer when one is open, otherwise spins. */
  private spinKey(): void {
    if (this.offer) { this.collectKey(); return; }
    if (this.autoLeft > 0) return;
    void this.spin();
  }

  /** G: chases the open offer when there is one, otherwise toggles autoplay. */
  private toggleAuto(): void {
    if (this.offer) { void this.chaseKey(); return; }
    if (this.autoLeft > 0) { this.autoStop(); return; }
    this.autoLeft = this.autoSize;
    this.sfx('button');
    if (!this.inRound && !this.busy && !this.roundOpen) void this.spin();
    this.showHud();
  }

  private cycleAutoSize(): void {
    if (this.autoLeft > 0) return;
    const i = AUTO_SIZES.indexOf(this.autoSize);
    this.autoSize = AUTO_SIZES[(i + 1) % AUTO_SIZES.length];
    this.sfx('click');
    this.toast(this.t('autoSize', { n: this.autoSize }), 'info');   // the key lives behind [H] now, so say what it did
    this.showHud();
  }

  private autoStop(): void {
    this.autoLeft = 0;
    this.showHud();
  }

  /** HOLD: arms one reel for the next spin (the same key again releases it). Opens only after a spin that did not pay. */
  private toggleHold(reel: number): void {
    if (this.inRound || this.busy || this.roundOpen || this.autoLeft > 0 || !this.currentMods().holdOn) return;
    if (this.state.hold === reel) { void this.emit({ k: 'hold', reel: -1 }); return; }
    if (!this.holdOpen()) { this.sfx('buzzer'); this.toast(this.t('holdWin'), 'warn'); return; }
    void this.emit({ k: 'hold', reel });
  }

  /** The last spin did not pay (a curse counts), and the held stake (HOLD_COST x the bet) is affordable within the cap. */
  private holdOpen(): boolean {
    const last = this.state.last10[0];
    if (last !== 0 && last !== 2) return false;
    const cost = Math.ceil(this.bet * HOLD_COST);
    return this.costOf(cost) <= this.ctx.run.wallet() && cost <= this.ctx.run.betLimits(this.def.id, this.id).max;
  }

  // ── authority-side logic: runs only on the local occupant ───────────────────────────────────────
  private async spin(): Promise<void> {
    if (this.inRound || this.busy || this.roundOpen || this.disposed || !this.isLocalOccupant) return;
    this.inRound = true;   // held until the eval presentation ends, so the next roll sees the final meter
    try {
      // an armed HOLD charges HOLD_COST x the bet for this spin; the round (and its free spins) pays at that stake
      const stake = this.state.hold >= 0 ? Math.ceil(this.bet * HOLD_COST) : this.bet;
      if (!this.beginRound(stake)) { this.autoStop(); return; }
      this.showHud();
      let res: Round | null = null;
      let offer: ChaseOffer | null = null;
      try {
        let round = this.roll(stake);
        if (this.force) {                                // debug force: re-roll (pure, no state change) until a chasable line win, or any win
          const want = this.force;
          for (let t = 0; t < FORCE_CHASE_TRIES && !(want === 'chase' ? chaseOf(round) : round.gross > 0); t++) round = this.roll(stake);
          this.force = null;
        }
        res = round;
        offer = chaseOf(round);                          // a line win may be chased: its settle waits for the player
        const since0 = this.sinceCurse();
        const night = this.ctx.run.night();
        const n = round.spins.length;
        for (let i = 0; i < n; i++) {
          const o = round.spins[i];
          const last = i === n - 1;
          const tags = last ? round.tags : o.tags;
          await this.emit(spinEvent(o, stake, since0 + i, night, i));
          const ev = evalEvent(o, stake, { free: i, lucky: round.lucky, sevens: i === 0 ? o.sevens : [], last, round: round.gross, tags });
          // the round settles once, on its last spin (settle-before-present, DECISIONS G); a chase offer settles later
          await this.emit(ev, last && !offer ? () => this.settle({ gross: round.gross, tags: round.tags }) : undefined);
        }
        if (offer) { this.offer = { ...offer, stake }; this.busy = false; }   // open the choice; releasing stays possible
      } finally {
        if (this.roundOpen && !this.offer) this.settle({ gross: 0 });   // never strand a stake (rule 7)
      }
      if (res && this.autoLeft > 0 && !this.disposed) {
        const big = tierAtLeast(juiceTier(res.gross, stake, res.tags), 'big');
        this.autoLeft = big || res.curse || res.fill || res.lucky || this.offer ? 0 : this.autoLeft - 1;
        if (this.autoLeft > 0) void this.wait(0.6).then(() => this.autoTick());
      }
    } finally {
      this.inRound = false;
      this.showHud();
    }
  }

  private autoTick(): void {
    if (this.disposed || this.autoLeft <= 0 || this.inRound || this.busy || this.roundOpen) return;
    if (!this.isLocalOccupant || this.ctx.run.pulls() < this.def.actionCost) { this.autoStop(); return; }
    void this.spin();
  }

  /** The authority's roll: pure rules over the round rng and the current state. */
  private roll(stake: number): Round {
    const s = this.state;
    const mods = this.currentMods();
    const maxStake = this.maxStake();
    return playRound(this.rng, stake, {
      mods, luck: this.luck(), sinceCurse: this.sinceCurse(), wardOn: mods.wardCharges - s.wardUsed > 0,
      meter: s.meter, maxStake, prev: s.grid, hold: s.hold,
    });
  }

  /** Spins since the last curse, reset at each Night (the curse deadline, MACHINES §2.3). */
  private sinceCurse(): number {
    return this.ctx.run.night() === this.state.night ? this.state.k : 0;
  }

  private currentMods(): Mods {
    return buildMods((hook, base) => this.mod(hook, base), (f) => this.feature(f));
  }

  private maxStake(): number {
    const l = this.betLadder();
    return l[l.length - 1] ?? MAX_STAKE;
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'spin': return this.presentSpin(ev, pc);
      case 'eval': return this.presentEval(ev, pc);
      case 'hold': return this.presentHold(ev);
      case 'chase': return this.presentChase(ev, pc);
      case 'collect': return this.presentCollect(ev, pc);
    }
  }

  /** COLLECT (SPACE): takes the pot as it stands and settles the round. */
  private collectKey(): void {
    const o = this.offer;
    if (!o || this.inRound) return;
    this.offer = null;
    this.inRound = true;
    void this.emit({ k: 'collect', amount: o.pot, stake: o.stake }, () => this.settle({ gross: o.pot, tags: o.tags }))
      .finally(() => { this.inRound = false; this.showHud(); });
  }

  /** CHASE (G): one extra spin on the same line. A hit pays x3 the pot; a miss loses it. The stake is not charged again. */
  private async chaseKey(): Promise<void> {
    const o = this.offer;
    if (!o || this.inRound || !this.isLocalOccupant) return;
    this.offer = null;
    this.inRound = true;
    try {
      const c = chaseRoll(this.rng, this.currentMods().weights, o, o.stake);
      const tags = c.win ? ['win', 'bigone:chase'] : [];
      await this.emit(
        { k: 'chase', win: c.win, grid: c.grid, line: o.line, amount: c.gross, stake: o.stake, tags },
        () => this.settle({ gross: c.gross, tags }),
      );
    } finally {
      this.inRound = false;
      this.showHud();
    }
  }

  /** The chase spin on every peer: the reels turn, the line lights on a hit, the win is called out. */
  private async presentChase(ev: ChaseEv, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.tally = [];
    this.lastStake = ev.stake;
    this.clearHighlights();
    for (let i = 0; i < 5; i++) this.paintReel(i, ev.grid);
    this.drawText(this.t('chaseSpin'));
    if (!pc.fast) {
      this.sfx('reelStart');
      const spin = this.whirr();
      let down = 0;
      this.bulbsSpin();
      this.reelsTurning = true;
      await Promise.all([0, 1, 2, 3, 4].map((i) => this.spinReel(i, STOP_T[i] * FREE_SPEED, false, () => spin.stopped(++down, 5))));
      this.reelsTurning = false;
      spin.end();
      if (this.isLocalOccupant) this.showHud();
    }
    s.gross = ev.amount;
    if (ev.win) this.lightCells(ev.line, 2);
    this.drawText(this.t(ev.win ? 'chaseHit' : 'chaseMiss', { n: fmtCoins(ev.amount) }));
    if (pc.local) this.callout(this.netOf(ev.amount, ev.stake, pc.local));
    if (ev.win) {
      this.sfx('win2');
      await this.celebrate(juiceTier(ev.amount, ev.stake, ev.tags), {
        amount: Math.max(0, this.netOf(ev.amount, ev.stake, pc.local)), mult: ev.amount / Math.max(1, ev.stake),
        bet: ev.stake, bulbs: this.comboOn ? undefined : this.parts.bulbs.window, lamps: this.parts.paylineLamps,
        restore: () => { if (!this.comboOn) this.bulbsIdle(); }, fast: pc.fast,
      });
    } else {
      this.commiserate({ amount: ev.stake, at: this.parts.screens.top.mesh });
      if (!pc.fast) await this.wait(0.3);
    }
    this.clearHighlights();
    this.drawScreen();
    if (!this.comboOn && !this.disposed) this.bulbsIdle();
  }

  /** The pot is collected: the callout names the net, the top screen shows the pot. */
  private presentCollect(ev: CollectEv, pc: PresentCtx): void {
    this.state.gross = ev.amount;
    this.lastStake = ev.stake;
    if (pc.local) this.callout(this.netOf(ev.amount, ev.stake, pc.local));
    this.sfx('win1');
    this.drawScreen();
  }

  private presentHold(ev: HoldEv): void {
    this.state.hold = ev.reel;
    this.sfx('click');
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentSpin(ev: SpinEv, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const p = this.parts;
    s.k = ev.curse ? 0 : ev.since + 1;
    s.night = ev.night;
    if (ev.ward) s.wardUsed += 1;
    s.hold = -1;
    s.grid = ev.grid.slice();
    s.meter = ev.meter;
    s.tally = [];
    this.clearHighlights();
    if (pc.fast) {
      for (let i = 0; i < 5; i++) this.paintReel(i, ev.grid);
      p.reels.forEach((r) => { r.root.rotation.x = 0; });
      this.drawScreen();
      return;
    }

    const free = ev.free > 0;
    // anticipation: lever pull and spin button (a free spin skips the lever), reels paint a random strip under the stop faces
    if (!free) {
      this.sfx('coinInsert', { vol: 0.6 });
      this.sfx('lever');
      void this.parts.buttons.spin.press(0.15);
      void this.anim(0.15, (k) => { p.lever.rotation.x = LEVER_PULL * k; }, 'outQuad')
        .then(() => this.anim(0.5, (k) => { p.lever.rotation.x = LEVER_PULL * (1 - k); }, 'outBounce'));
    }
    for (let i = 0; i < 5; i++) this.paintReel(i, ev.grid);
    this.sfx('reelStart');
    const spin = this.whirr();                              // spools up, thins out as each reel lands, ends with the last
    this.bulbsSpin();
    this.drawScreen();
    if (free) this.drawText(this.t('freeN', { n: ev.free, of: LUCKY_SPINS }));

    // near-miss tell: the reel that would complete a lined-up run crawls; every later reel waits behind it
    const tReel = !free && ev.tease && ev.tReel >= 1 && ev.tReel <= 4 && ev.tReel !== ev.hold ? ev.tReel : -1;
    const crawl = tReel >= 0 ? TEASE_D[Math.min(4, Math.max(2, ev.tLen))] : 0;
    // jackpot build-up: when the first two reels stand on the same symbol, the rest slow one by one
    const lock = !free && tReel < 0 && !ev.curse ? lockedColumns(ev.grid) : 0;
    const jpLast = Math.min(lock, 4);
    const jpExtra = (i: number): number => (lock >= 2 && i >= 2 ? JP_EXTRA[Math.min(i, jpLast)] : 0);
    const stopOf = (i: number): number => (free
      ? STOP_T[i] * FREE_SPEED
      : STOP_T[i] + (ev.respin && i >= 3 ? 0.8 : 0) + (tReel >= 0 && i >= tReel ? crawl : 0) + jpExtra(i));
    const runs: Promise<void>[] = [];
    const turning = ev.hold >= 0 ? 4 : 5;
    let down = 0;
    for (let i = 0; i < 5; i++) {
      if (i === ev.hold) { runs.push(Promise.resolve()); continue; }   // held reel stays put
      runs.push(this.spinReel(i, stopOf(i), i === tReel || (lock >= 2 && i === jpLast), () => this.landed(i, ev.grid, ++down, turning, spin)));
    }
    if (tReel >= 0) void this.teaseShow(ev, tReel, stopOf(tReel - 1), crawl);
    if (lock >= 2) void this.jackpotTease(ev, lock, stopOf(1), jpExtra(jpLast) + 0.5);
    this.reelsTurning = true;
    await Promise.all(runs);
    this.reelsTurning = false;
    spin.end();
    if (this.isLocalOccupant) this.showHud();
    for (const c of ev.coalesced) this.flashCell(c);
    this.drawScreen();
  }

  /** The held breath: once the run is lined up the cells glow, the screen asks, and the next reel ticks up in pitch. */
  private async teaseShow(ev: SpinEv, reel: number, at: number, crawl: number): Promise<void> {
    await this.wait(at);
    if (this.disposed) return;
    const cells: number[] = [];
    for (let c = reel - ev.tLen; c < reel; c++) cells.push(ev.tRow * 5 + c);
    this.lightCells(cells, 1);
    this.drawText(this.t('tease'));
    if (!this.comboOn) this.parts.bulbs.window.pattern('chase', flashOpts().reduced || flashOpts().calm ? 4 : 14);   // the window bulbs race
    // nearMiss plays the riser (as long as the crawl) and the heartbeat: a second riser here only doubled it
    await this.nearMiss({ dur: crawl + 0.35, at: this.parts.screens.top.mesh, lamps: this.parts.paylineLamps });
  }

  /**
   * Two jackpot symbols have landed side by side: the lights race, a riser climbs, the LED flashes and the reels that
   * are left slow down. A full grid pays off in presentJackpot; otherwise it was a near miss. Presentation only.
   */
  private async jackpotTease(ev: SpinEv, lock: number, at: number, dur: number): Promise<void> {
    await this.wait(at);
    if (this.disposed) return;
    if (this.isLocalOccupant) this.ctx.events.emit('music:cue', { cue: 'reel_chase', on: true });   // the score drops to a heartbeat
    const p = this.parts;
    const calm = flashOpts().reduced || flashOpts().calm;
    const hz = calm ? 4 : 12;
    const cells: number[] = [];
    for (let c = 0; c < Math.min(lock, 2); c++) for (let r = 0; r < 3; r++) cells.push(r * 5 + c);
    this.lightCells(cells, 1);
    this.drawText(this.t('jpTease'));
    this.sfx('tensionRise', { vol: 0.9, param: 1 });
    for (let t = 0; t < dur - 0.3; t += 0.8) void this.wait(t).then(() => { if (!this.disposed) this.sfx('heartbeat', { vol: 0.85, param: Math.min(1, t / dur + 0.3) }); });   // the pulse quickens
    p.bulbs.crown.setPattern('chase', hz);
    p.bulbs.window.setPattern('chase', hz);
    p.ledStrip.pattern('chase', hz);
    p.paylineLamps.forEach((l) => l.blink(hz * 0.6, dur * this.speed));
    this.ctx.fx.lightPulse(p.jackpotLed.root, { color: GOLD, mul: 1.6, dur: dur * this.speed });
    this.flashLed(dur, calm ? 2 : 6);
    await this.wait(dur);
    if (!this.disposed && !ev.fill) this.bulbsIdle();
  }

  /** The JACKPOT LED blinks gold / white for `dur` seconds, then returns to gold. */
  private flashLed(dur: number, hz: number): void {
    const led = this.parts.jackpotLed;
    this.ledBusy = true;
    let on = false;
    void this.anim(dur, (k) => {
      const now = Math.floor(k * dur * hz * 2) % 2 === 0;
      if (now !== on) { on = now; led.setColor(on ? '#ffffff' : '#ffd040'); }
    }).then(() => { led.setColor('#ffd040'); this.ledBusy = false; });
  }

  /** The LED shows the jackpot meter and counts up to a new value instead of jumping. */
  private tickLed(target: number): void {
    if (target === this.ledTarget) return;
    this.ledTarget = target;
    const from = this.ledShown < 0 ? target : this.ledShown;
    const seq = ++this.ledSeq;
    const set = (v: number): void => { this.ledShown = v; this.parts.jackpotLed.set(String(Math.max(0, Math.min(99999999, v)))); };
    if (from === target || target < from) { set(target); return; }
    void this.anim(Math.min(0.9, 0.3 + (target - from) / 4000), (k) => {
      if (seq === this.ledSeq) set(Math.round(from + (target - from) * k));
    }).then(() => { if (seq === this.ledSeq) set(target); });
  }

  /** A reel landed: the whirr thins out, and symbols lined up on a row tick a moment after the clack (the run sets the pitch). */
  private landed(i: number, grid: readonly number[], down: number, total: number, spin: Whirr): void {
    spin.stopped(down, total);
    const run = lineRun(grid, i);
    if (run >= 2) void this.wait(0.05).then(() => { if (!this.disposed) this.sfx('lineUp', { vol: 0.7, pitch: lineUpPitch(run) }); });
  }

  /** The reels turn: crown, window and LED strip chase fast (slower under reduce-flashing / Calm). Back to rest in `bulbsIdle`. */
  private bulbsSpin(): void {
    if (this.comboOn) return;
    const o = flashOpts();
    const hz = o.reduced || o.calm ? 4 : 10;
    const p = this.parts;
    p.bulbs.crown.pattern('chase', hz);
    p.bulbs.window.pattern('chase', hz * 0.8);
    p.ledStrip.pattern('chase', hz);
  }

  /**
   * One reel: whole turns that end with facet 0 at the front, decelerating, then a bounce. `slow` = the anticipating reel (ticks
   * rise). `land` runs as the reel clacks into place. The stops rise in pitch from reel to reel (param = reel / 4).
   */
  private spinReel(i: number, dur: number, slow = false, land?: () => void): Promise<void> {
    const reel = this.parts.reels[i];
    const a0 = reel.root.rotation.x;
    const end = Math.ceil((a0 + (4 + i) * TAU) / TAU) * TAU;
    let facet = Math.floor(((end - a0) * 0.8 + a0) / (TAU / 16));
    return this.anim(dur, (k) => {
      reel.root.rotation.x = a0 + (end - a0) * k;
      if (slow && k > 0.8) {   // the last turn clacks facet by facet, slower and higher each time
        const f = Math.floor(reel.root.rotation.x / (TAU / 16));
        if (f !== facet) { facet = f; this.sfx('reelTick', { vol: 0.55, pitch: Math.min(14, (k - 0.8) * 70) }); }
      }
    }, slow ? 'outExpo' : 'outCubic').then(async () => {
      this.sfx('reelStop', { vol: 0.8 + 0.05 * i, param: i / 4 });
      land?.();
      await this.anim(BOUNCE, (k) => { reel.root.rotation.x = end + 0.08 * Math.sin(Math.PI * k); });
      reel.root.rotation.x = 0;
    });
  }

  private async presentEval(ev: EvalEv, pc: PresentCtx): Promise<void> {
    if (pc.local) this.ctx.events.emit('music:cue', { cue: 'reel_chase', on: false, hit: ev.jackpot > 0 });   // ends the chase, if one runs
    const s = this.state;
    s.meter = ev.meter;
    s.gross = ev.gross;
    this.lastStake = ev.stake;
    if (pc.local) {
      if (ev.curse) this.seatHud?.result('bust', -ev.stake);
      // a counted win is called out pattern by pattern below; a LUCKY 7 round is called out once, for its total
      else if (!ev.lucky && (pc.fast || !ev.tally.length)) this.callout(this.netOf(ev.gross, ev.stake, pc.local));
    }
    const code = ev.curse ? 2 : ev.fill ? 3 : ev.gross > 0 ? 1 : 0;
    s.last10 = [code, ...s.last10].slice(0, LAST10);
    this.drawLast10();
    if (ev.curse) return this.presentCurse(pc);
    if (ev.fill) { s.tally = []; return this.presentJackpot(ev, pc); }

    s.tally = ev.tally.map((t) => ({ ...t }));
    if (ev.sevens.length) await this.luckyShow(ev, pc);
    // three or more patterns start the combo light show (it runs through the tally and the celebration)
    if (!pc.fast && ev.tally.length >= COMBO_MIN && !ev.free) this.startCombo(ev.tally.length);
    // the tally: one pattern at a time, smallest first. Each one lights, rings a higher note, and counts the total up
    if (!pc.fast && ev.tally.length) {
      await this.tallyShow(ev.tally, pc.local, ev.free > 0);
      if (pc.local && !ev.lucky) this.callout(this.netOf(ev.gross, ev.stake, pc.local));
    } else for (const pay of ev.tally) this.lightPay(pay, false);

    // a LUCKY 7 round: the staked spin and the free spins show their patterns; the round's total is felt on the last spin
    if (ev.lucky && !ev.last) {
      if (!pc.fast) await this.wait(0.12);
      return;
    }
    const total = ev.round;
    if (ev.lucky && pc.local) this.callout(this.netOf(total, ev.stake, pc.local));
    if (total > 0) {
      // the round's total: a x2 already flashes, pours coins and pops; the show scales with the multiplier
      await this.celebrate(juiceTier(total, ev.stake, ev.tags), {
        amount: Math.max(0, this.netOf(total, ev.stake, pc.local)), mult: total / Math.max(1, ev.stake),
        bet: ev.stake, bulbs: this.comboOn ? undefined : this.parts.bulbs.window, lamps: this.parts.paylineLamps,
        restore: () => { if (!this.comboOn) this.bulbsIdle(); }, fast: pc.fast,
      });
    } else {
      this.commiserate({ amount: ev.stake, at: this.parts.screens.top.mesh });
      if (!pc.fast) await this.wait(0.3);
    }
    if (total > 0) this.dimLit(); else this.clearHighlights();   // what paid stays softly lit until the next spin
    this.drawScreen();
    if (!this.comboOn && !this.disposed) this.bulbsIdle();   // the spin chase and any tease race end here
  }

  /** LUCKY 7 lands: the three sevens light, the top screen names the bonus, and the room jumps. */
  private async luckyShow(ev: EvalEv, pc: PresentCtx): Promise<void> {
    this.lightCells(ev.sevens, 2);
    this.drawText(this.t('lucky', { n: LUCKY_SPINS }));
    this.sfx('jackpot', { vol: 0.8 });
    this.ctx.fx.flash(GOLD, 0.5, 0.3);
    this.ctx.fx.glow(this.parts.screens.top.mesh, GOLD, 0.9, 0.5);
    if (pc.local) this.ctx.fx.shake(0.02, 0.45);
    if (!pc.fast) await this.wait(0.7);
  }

  /**
   * The combo light show, started by a tally of COMBO_MIN patterns or more: the crown comets, then runs its rainbow
   * (or a chase under Calm / reduceFlashing), the window bulbs march, and `show:combo` tells the world and the nearby
   * machines. Each new show bumps `comboSeq`, so a finished show never resets the bulbs of a newer one.
   */
  private startCombo(n: number): void {
    const plan = comboPlan(n, flashOpts());
    const seq = ++this.comboSeq;
    const b = this.parts.bulbs;
    this.comboOn = true;
    b.crown.setPattern('comet', plan.cometHz);
    b.window.setPattern('march', plan.marchHz);
    this.sfx('chime', { vol: 0.5 });
    emitComboShow(this.ctx, b.window.root, n, plan.totalS);
    void this.wait(plan.cometS).then(() => {
      if (seq === this.comboSeq && !this.disposed) b.crown.setPattern(plan.crown, plan.crownHz);
    });
    void this.wait(plan.totalS).then(() => {
      if (seq !== this.comboSeq || this.disposed) return;
      this.comboOn = false;
      this.bulbsIdle();
    });
  }

  /**
   * Render-rate symbol animation (runs only while the machine is visible). Winning cells (lit) cycle their symbol
   * frames at LIVE_HZ, the rest idle slowly, and every stamped symbol carries its gold paint. Only the three visible
   * facets of a cell are repainted, and only when its frame key changes, so the strip uploads stay rare.
   */
  override frame(_dt: number, t: number): void {
    if (this.disposed || this.state.grid.length !== CELLS) return;
    const o = flashOpts();
    const gild = gildLevels();
    const liveHz = hzCap(LIVE_HZ, o);
    const dirty = [false, false, false, false, false];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = r * 5 + c;
        const sym = this.state.grid[cell];
        if (!(sym >= 0) || sym === MAW) continue;
        const live = this.cellLvl[cell] > 0;
        const f = symFrame(t, live ? liveHz : IDLE_HZ, live ? 0 : cell * 0.61);
        const gilt = gild[sym] ?? 0;
        const key = (sym * 4 + f) * 4 + gilt;
        if (this.symKey[cell] === key) continue;
        this.symKey[cell] = key;
        this.paintFacet(c, FACET_OF_ROW[r], sym, f, gilt);
        dirty[c] = true;
      }
    }
    for (let c = 0; c < 5; c++) if (dirty[c]) this.parts.reels[c].strip.needsUpdate = true;
  }

  /** Repaint one symbol facet of reel `reel` (32 px high, `facet` · 32 down the strip). */
  private paintFacet(reel: number, facet: number, sym: number, f: number, gilt: number): void {
    const g = this.parts.reels[reel].canvas.getContext('2d');
    if (!g) return;
    const y = facet * 32;
    g.fillStyle = SYMBOL_BG;
    g.fillRect(0, y, 32, 32);
    paintSymbol(g, sym, 0, y, f, gilt);
  }

  /** The count-up, pattern by pattern (MACHINES §2 juice): the screen lists what has paid and the running total. */
  private async tallyShow(tally: readonly PayEv[], local = false, quick = false): Promise<void> {
    const step = quick ? QUICK_STEP : Math.min(STEP_MAX, Math.max(STEP_MIN, TALLY_CAP / tally.length));
    let total = 0;
    for (let i = 0; i < tally.length; i++) {
      const pay = tally[i];
      if (this.disposed) return;
      const from = total;
      total += pay.amount;
      const shown = tally.slice(0, i + 1);
      this.dimLit();
      this.lightPay(pay, true);
      if (local) {   // the top screen sits above the seat camera: say the same thing on the seat HUD, one pattern at a time
        const pat = `${this.t(`pat_${pay.pat}`)} x${Number.isInteger(pay.raw) ? pay.raw : pay.raw.toFixed(1)}`;
        this.seatHud?.result('win', total, step + 0.5, i > 0 ? `${pat} · ${this.t('tCombo', { n: Number.isInteger(pay.combo) ? String(pay.combo) : pay.combo.toFixed(1) })}` : pat);
      }
      // the pattern pops a step higher (the last lands on the cha-ching); from the second, its combo multiplier dings a stack above it
      scorePop(this, i, tally.length);
      if (i >= 1) void this.wait(0.08).then(() => { if (!this.disposed) scorePop(this, i - 1, tally.length, { mult: true, vol: 0.6 }); });
      this.ctx.fx.glow(this.parts.screens.top.mesh, i >= 3 ? PINK : GOLD, 0.25 + 0.08 * i, 0.3);
      if (i >= 3 && this.isLocalOccupant) this.ctx.fx.shake(0.004 * Math.min(6, i), 0.18);
      await this.anim(step * 0.8, (k) => this.drawTally(shown, Math.round(from + (total - from) * k)), 'outQuad');
      this.drawTally(shown, total);
      await this.wait(step * 0.2);
    }
    await this.wait(0.12);
  }

  private async presentCurse(pc: PresentCtx): Promise<void> {
    this.sfx('error', { vol: 0.9 });
    this.drawScreen();
    if (pc.fast) return;
    const fx = this.ctx.fx;
    fx.flash(RED, 0.5, 0.25);
    fx.tint(RED, 0.3, 0.8);
    fx.chroma(14, 0.6);
    if (pc.local) fx.shake(0.02, 0.5);
    fx.glow(this.parts.screens.top.mesh, RED, 0.6, 0.6);
    this.drawText(this.t('curseWarn'));
    // glitch: the trio of MAW cells flickers; the other cells stay dark
    const maw: number[] = [];
    this.state.grid.forEach((v, i) => { if (v === MAW) maw.push(i); });
    await this.anim(CURSE_SHOW, (k) => {
      const on = blinkOn(k * CURSE_SHOW, 9, 0.6) || this.cosmetic.next() < 0.1;
      for (const i of maw) this.setCell(i, on);
    });
    this.clearHighlights();
    this.drawScreen();
    if (!this.comboOn && !this.disposed) this.bulbsIdle();
  }

  private async presentJackpot(ev: EvalEv, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    this.drawScreen();
    if (pc.fast) { this.sfx('jackpot'); return; }   // the celebrate() below plays the jackpot jingle itself
    const fx = this.ctx.fx;
    fx.flash(GOLD, 0.8, 0.4);
    fx.hitstop(0.12);
    const calm = flashOpts().reduced || flashOpts().calm;
    p.bulbs.crown.setPattern('rainbow', calm ? 3 : 10);
    p.bulbs.window.setPattern('blink', calm ? 3 : 8);
    this.flashLed((JACKPOT_WINDUP + JACKPOT_COUNT_S) * this.speed + 1.5, calm ? 2 : 8);
    this.drawText(this.t('jpBanner'));
    fx.popText(p.medallion, this.t('jpBanner'), GOLD, { dur: 2.2, rise: 0.5, scale: 2 });
    fx.coins(p.medallion, 48, { spread: 0.6, up: 2.4, over: 2.6 });   // the coin shower from the crown
    const net = Math.max(0, this.netOf(ev.gross, ev.stake, pc.local));   // the count and the pop land on the WIN callout's figure
    await Promise.all([
      this.celebrate('jackpot', { amount: net, mult: ev.gross / Math.max(1, ev.stake), bulbs: p.bulbs.window, lamps: p.last10, restore: () => this.bulbsIdle() }),
      // the count rolls from the impact under the coin rain and lands on the kachunk
      this.wait(JACKPOT_WINDUP).then(() => countUp(this.ctx, 0, net, JACKPOT_COUNT_S * this.speed, (v) => this.drawScreen(v), { end: 'kachunk' })),   // no tick: the jackpot cue rolls its own count
      this.anim(0.4, (k) => { p.topLid.rotation.x = LID_OPEN * k; }, 'outBack')
        .then(() => this.anim(0.4, (k) => { p.topLid.rotation.x = LID_OPEN * (1 - k); })),
      this.anim(1.4, (k) => { p.medallion.rotation.y = TAU * 3 * k; }, 'outCubic'),
    ]);
    p.medallion.rotation.y = 0;
    this.clearHighlights();
    this.drawScreen();
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  private spinMedal(): void {
    if (this.busy || this.occupant !== null) return;
    void this.anim(1.2, (k) => { this.parts.medallion.rotation.y = TAU * k; }, 'outCubic');
  }

  /** Idle bulbs and the LED strip. Repeats are cheap and idempotent. */
  private bulbsIdle(): void {
    this.parts.bulbs.crown.pattern('chase', 3);
    this.parts.bulbs.window.pattern('alt', 2);
    this.parts.ledStrip.pattern('chase', 4);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const p = this.parts;
    p.reels.forEach((_, i) => this.paintReel(i, this.state.grid));
    p.reels.forEach((r) => { r.root.rotation.x = 0; });
    p.lever.rotation.x = 0;
    p.topLid.rotation.x = 0;
    p.medallion.rotation.y = 0;
    p.glassCrack.visible = !this.feature('bigone.upgraded');
    this.clearHighlights();
    this.drawLast10();
    this.setNeedle();
    this.drawScreen();
  }

  /** Paint one drum: facet 0 = middle row, facet 1 = top row, facet 15 = bottom row; other facets are cosmetic. */
  private paintReel(i: number, grid: readonly number[]): void {
    const reel = this.parts.reels[i];
    const g = reel.canvas.getContext('2d');
    if (!g) return;
    const gild = gildLevels();
    for (let f = 0; f < 16; f++) {
      const y = f * 32;
      g.fillStyle = SYMBOL_BG;
      g.fillRect(0, y, 32, 32);
      let sym: number;
      if (f === 0) sym = grid[5 + i];
      else if (f === 1) sym = grid[i];
      else if (f === 15) sym = grid[10 + i];
      else sym = this.cosmetic.int(0, SYM_COUNT - 1);
      paintSymbol(g, sym, 0, y, 0, gild[sym] ?? 0);
    }
    reel.strip.needsUpdate = true;
    // the visible facets now hold resting frames: the render-rate animation repaints them on its next pass
    for (let r = 0; r < 3; r++) this.symKey[r * 5 + i] = -1;
  }

  /** Cell frame glow: 0 dark, 1 lined up (soft), 2 the pattern being tallied (strong). */
  private cellLvl: number[] = new Array<number>(CELLS).fill(0);

  private setLevel(i: number, lvl: 0 | 1 | 2): void {
    this.cellLvl[i] = lvl;
    const m = this.parts.cellFrames[i]?.material as THREE.MeshStandardMaterial | undefined;
    if (m && 'emissiveIntensity' in m) m.emissiveIntensity = lvl === 2 ? 1.8 : lvl === 1 ? 0.85 : 0.26;
  }

  private setCell(i: number, on: boolean): void {
    this.setLevel(i, on ? 2 : 0);
  }

  private flashCell(i: number): void {
    this.setCell(i, true);
    void this.wait(0.25).then(() => this.setCell(i, false));
  }

  private lightCells(cells: readonly number[], lvl: 1 | 2 = 2): void {
    for (const c of cells) this.setLevel(c, lvl);
  }

  /** The cells of earlier tally steps stay lit, softer, so the stack builds up on the grid. */
  private dimLit(): void {
    for (let i = 0; i < CELLS; i++) if (this.cellLvl[i] === 2) this.setLevel(i, 1);
  }

  /** A paying pattern: its cells glow, its pattern lamp lights, and the payline lamps of its rows. */
  private lightPay(pay: PayEv, strong: boolean): void {
    this.lightCells(pay.cells, strong ? 2 : 1);
    const idx = PATTERN_IDS.indexOf(pay.pat as PatternId);
    if (idx >= 0) this.parts.patternLamps[idx]?.setOn(true);
    for (const r of new Set(pay.cells.map((c) => Math.floor(c / 5)))) {
      this.parts.paylineLamps[r]?.setOn(true);
      this.parts.paylineLamps[3 + r]?.setOn(true);
    }
  }

  private clearHighlights(): void {
    for (let i = 0; i < CELLS; i++) this.setCell(i, false);
    this.parts.paylineLamps.forEach((l) => l.setOn(false));
    this.parts.patternLamps.forEach((l) => l.setOn(false));
  }

  private drawLast10(): void {
    this.parts.last10.forEach((lamp, i) => {
      const code = this.state.last10[i];
      if (code === undefined || code === 0) { lamp.setOn(false); return; }
      lamp.setColor(code === 2 ? RED : code === 3 ? PINK : GOLD);
      lamp.setOn(true);
    });
  }

  /** Hunger dial: needle from left (0 %) to right (5 %) of the curse chance. */
  private setNeedle(): void {
    this.parts.hungerNeedle.rotation.z = Math.PI / 2 - Math.PI * this.hungerPct();
  }

  private hungerPct(): number {
    const pc = curseChance(this.state.k, this.currentMods().curse);
    return Math.min(1, pc / 0.05);
  }

  /** The 160×48 top screen: meter, result line, hunger bar, autoplay / hold status (or the pattern card). */
  private drawScreen(shown?: number): void {
    const s = this.state;
    this.setNeedle();
    this.tickLed(Math.floor(s.meter));
    if (shown === undefined && s.tally.length && s.last10[0] === 1) { this.drawTally(s.tally, s.gross); return; }
    this.parts.screens.top.draw((g, sc) => {
      g.fillStyle = '#120406';
      g.fillRect(0, 0, sc.w, sc.h);
      // y is the cap top of a px5 line (cap = 7 x scale); Turkish accents rise 3 x scale above it. Rows, top to bottom:
      // jackpot 4..11, main line 19..33 (accents from 13), hunger bar 36..38, hunger label + status 40..47 (the screen is 48 high).
      const ink = (c: string): { font: 'px5'; color: string; align: 'center' } => ({ font: 'px5', color: c, align: 'center' });
      sc.text(upper(`${this.t('jackpot')} ${fmtCoins(Math.floor(s.meter))}`), 80, 4, ink('#ffe45a'));
      const main = (txt: string, c: string): void => { sc.text(txt, 80, 19, { ...ink(c), scale: px5Width(txt, 2) <= 152 ? 2 : 1 }); };
      if (shown !== undefined) main(`+${fmtCoins(shown)}`, '#ffe45a');
      else if (s.last10[0] === 2) main(upper(this.t('eaten')), '#ff5060');
      else if (s.gross > 0) main(upper(this.t('win', { n: fmtCoins(Math.max(0, this.netOf(s.gross, this.lastStake, this.isLocalOccupant))) })), '#ffe45a');
      else main(upper(`${this.t('bet')} ${fmtCoins(this.bet)}`), '#8cff9a');
      g.fillStyle = '#4a1418';
      g.fillRect(20, 36, 120, 3);
      g.fillStyle = '#ff2a40';
      g.fillRect(20, 36, Math.round(120 * this.hungerPct()), 3);
      const status = this.autoLeft > 0
        ? this.t('autoOn', { n: this.autoLeft })
        : s.hold >= 0 ? this.t('hold', { n: s.hold + 1 }) : this.t('autoSize', { n: this.autoSize });
      sc.text(upper(this.t('hunger')), 3, 40, { font: 'px5', color: '#ff5a6a' });
      sc.text(upper(status), 157, 40, { font: 'px5', color: '#7dffe0', align: 'right' });
    });
  }

  /**
   * The breakdown on the top screen: header (combo), the last three patterns that paid (symbol, pattern, multiplier,
   * coins; colour heats up with each step) and the running total. Stays up after the count until the next spin.
   */
  private drawTally(items: readonly PayEv[], total: number): void {
    const n = items.length;
    if (!n) { this.state.tally = []; this.drawScreen(); return; }
    const s = this.state;
    const hot = TALLY_INK[Math.min(n - 1, TALLY_INK.length - 1)];
    const num = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    this.setNeedle();
    this.parts.screens.top.draw((g, sc) => {
      g.fillStyle = '#120406';
      g.fillRect(0, 0, sc.w, sc.h);
      const head = n > 1 ? this.t('tCombo', { n: num(items[n - 1].combo) }) : `${this.t('jackpot')} ${fmtCoins(Math.floor(s.meter))}`;
      sc.text(head, 80, 1, { font: 'px5', color: n > 1 ? hot : '#ffd040', align: 'center' });
      const rows = items.slice(-3);
      rows.forEach((p, r) => {
        const idx = n - rows.length + r;
        const y = 9 + r * 8;
        const col = TALLY_INK[Math.min(idx, TALLY_INK.length - 1)];
        const aw = sc.text(`+${fmtCoins(p.amount)}`, 157, y, { font: 'px5', color: col, align: 'right' });
        const mult = `x${num(p.raw)}`;
        const mw = sc.text(mult, 157 - aw - 5, y, { font: 'px5', color: '#a89878', align: 'right' });
        const room = 157 - aw - 5 - mw - 6;
        const pat = this.t(`pat_${p.pat}`);
        const both = `${this.t(`sym_${SYM_NAMES[p.sym] ?? 'SUN'}`)} ${pat}`;
        sc.text(px5Width(both) <= room ? both : pat, 3, y, { font: 'px5', color: col });
      });
      sc.text(this.t('tTotal'), 3, 37, { font: 'px5', color: '#7dffe0' });
      if (n > 3) sc.text(this.t('tMore', { n: n - 3 }), 3, 1, { font: 'px5', color: '#a89878' });
      sc.text(fmtCoins(total), 157, 34, { font: 'px5', scale: 2, color: hot, align: 'right' });
    });
  }

  /** A one-line caption on the top screen (tease, curse). Redrawn by `drawScreen` afterwards. */
  private drawText(line: string): void {
    this.parts.screens.top.draw((g, sc) => {
      g.fillStyle = '#120406';
      g.fillRect(0, 0, sc.w, sc.h);
      // the caption is the screen's headline: scale it up while it fits the 160 px screen
      const scale = px5Width(line) * 2 <= 152 ? 2 : 1;
      sc.text(line, 80, scale === 2 ? 18 : 20, { font: 'px5', scale, color: '#ffb0b0', align: 'center' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** The pay strip on the seat HUD: every symbol and its value (a pattern pays value × its multiplier × the stake). */
  private payStrip(): HudPay[] {
    const vals = this.currentMods().values;
    const gild = gildLevels();
    return SYM_NAMES.map((_, s) => ({
      px: 32, pays: `×${vals[s] ?? BASE_VALUE[s]}`,
      paint: (g: CanvasRenderingContext2D) => { g.fillStyle = SYMBOL_BG; g.fillRect(0, 0, 32, 32); paintSymbol(g, s, 0, 0, 0, gild[s] ?? 0); },
    }));
  }

  /** The rules card: the rules, then every pattern with its multiplier, three to a line (the symbol values are the pay strip). */
  private rulesLines(): Txt[] {
    const lines: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7', 'rule8'].map((k) => ({ k: 'm.bigone.' + k }));
    lines.push({ k: 'm.bigone.rule9', v: { max: this.k('betMax'), size: this.k('clear'), fast: this.k('fast'), hold: `${this.k('n1')}-${this.k('n5')}` } });
    for (let i = 0; i < PATTERN_IDS.length; i += 3) {
      lines.push(PATTERN_IDS.slice(i, i + 3)
        .map((pat) => `${this.t(`pat_${pat}`)} x${pat === 'CLUSTER' ? 'n-5' : PATTERN_MULT[pat]}`)
        .join('   '));
    }
    return lines;
  }

  /**
   * The player's net on a win: what `win()` credits (previewCredit, after House Favour and the limit) less the stake.
   * Every WIN figure (callout, top-screen line, pop, jackpot count) comes from here, so they never disagree.
   * Spectators have no credit of their own to preview, so they see the gross less the stake.
   */
  private netOf(gross: number, stake: number, local: boolean): number {
    const credit = local && gross > 0 ? this.ctx.run.previewCredit(gross, this.src, { bet: stake }) : gross;
    return credit - stake;
  }

  /** Result callout for the local player: `net` = coins back minus the stake. */
  private callout(net: number): void {
    this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const busy = this.inRound || this.busy || this.roundOpen;
    sh.goal({ k: 'm.bigone.goal' });
    sh.topBelow(BANNER_TOP_PCT);   // the state box and goal start under the cabinet's own JACKPOT plate and LCD
    sh.stake(this.bet);

    // STATE: a chase on offer, auto, spinning, a held reel, or ready for the next spin
    if (this.offer) sh.state({ k: 'm.bigone.stChase', v: { n: fmtCoins(this.offer.pot) } }, 'gold', { k: 'm.bigone.stChaseSub', v: { n: Math.round(1 / CHASE_P) } });
    else if (this.autoLeft > 0) sh.state({ k: 'm.bigone.stAuto', v: { n: this.autoLeft } }, 'cyan', { k: 'm.bigone.stAutoSub' });
    else if (busy && this.reelsTurning) sh.state({ k: 'm.bigone.stSpinning' }, 'cyan');
    else if (busy) sh.state({ k: 'm.bigone.stReady', v: { key: '' } }, 'gold', { k: 'm.bigone.stReadySub', v: { n: fmtCoins(this.bet) } });
    else if (s.hold >= 0) sh.state({ k: 'm.bigone.stHold', v: { n: s.hold + 1 } }, 'good', { k: 'm.bigone.stHoldSub', v: { c: fmtCoins(Math.ceil(this.bet * HOLD_COST)) } });
    else if (!SeatHud.floorOpen()) sh.floorClosed();
    else sh.state({ k: 'm.bigone.stReady', v: { key: `[${this.k('primary')}]` } }, 'gold', { k: 'm.bigone.stReadySub', v: { n: fmtCoins(this.bet) } });

    // No number row: the JACKPOT plate, the LCD (TOTAL), the hunger dial and the POCKET box already show them.
    sh.numbers([]);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (this.offer) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.bigone.cCollect', v: { n: fmtCoins(this.offer.pot) } }, action: 'primary', primary: true });
      ctrl.push({ key: this.k('auto'), label: { k: 'm.bigone.cChase', v: { m: CHASE_MULT, n: Math.round(1 / CHASE_P) } }, action: 'auto' });
    } else if (this.autoLeft > 0) {
      ctrl.push({ key: this.k('auto'), label: { k: 'm.bigone.cStopAuto' }, action: 'auto', primary: true });
    } else {
      if (!busy && SeatHud.floorOpen()) {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.bigone.cSpin' }, action: 'primary', primary: true });
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.bigone.cStake' }, action: 'betUp' });
      }
      ctrl.push({ key: this.k('auto'), label: { k: 'm.bigone.cAuto' }, action: 'auto' });
      if (!busy && this.currentMods().holdOn && this.holdOpen()) ctrl.push({ key: `${this.k('n1')}-${this.k('n5')}`, label: { k: 'm.bigone.cHold' }, action: 'n1' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.bigone.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.bigone.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── late join / save ────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, grid: [...this.state.grid], last10: [...this.state.last10], tally: this.state.tally.map((t) => ({ ...t })) };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, grid: [...s.grid], last10: [...s.last10], tally: (s.tally ?? []).map((t) => ({ ...t })) };
    this.refresh();
  }
}

/** Build the `spin` presentation event from the authority's outcome (`free` = 0 for the staked spin, n for free spin n). */
function spinEvent(o: Outcome, stake: number, since: number, night: number, free: number): SpinEv {
  return {
    k: 'spin', stake, grid: o.grid, pre: o.pre, coalesced: o.coalesced, teaser: o.teaser, curse: o.curse,
    curseCol: o.curseCol, ward: o.ward, fill: o.fill, fillSym: o.fillSym, respin: o.respin, tease: o.tease,
    tReel: o.teaseAt?.reel ?? -1, tRow: o.teaseAt?.row ?? -1, tLen: o.teaseAt?.len ?? 0,
    hold: o.hold, meter: o.meterFed, since, night, free,
  };
}

/** Build the `eval` event: the tally (every paying pattern, smallest first), the gross and the settle tags. */
function evalEvent(
  o: Outcome, stake: number,
  c: { free: number; lucky: boolean; sevens: number[]; last: boolean; round: number; tags: string[] },
): EvalEv {
  return {
    k: 'eval', stake, gross: o.gross, jackpot: o.jackpot, curse: o.curse, fill: o.fill, tease: o.tease,
    tally: o.tally.map((t) => ({ pat: t.pat, sym: t.sym, cells: t.cells, amount: t.amount, raw: t.raw, combo: t.combo })),
    tags: c.tags, meter: o.meter, lucky: c.lucky, sevens: c.sevens, free: c.free, last: c.last, round: c.round,
  };
}

