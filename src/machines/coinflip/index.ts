/**
 * Coin Flip Booth (`coinflip`) — THE reference machine (base-machines WP). Copy this pattern.
 *
 * What it demonstrates
 *  - the logic / present split: `flip()` rolls on the authority (the local occupant), packs the FULL outcome into an
 *    event and `emit`s it; `present()` is the only place state changes and animation happens, on every peer;
 *  - a multi-step round (streak ladder): the stake is paid once, a win keeps the round OPEN with a pot, the player
 *    rides (re-stakes the pot, free) up the ladder ×1.9 → ×3.6 → ×7 → ×13 or COLLECTS; leaving collects; a loss settles 0;
 *  - a tension beat on EVERY flip: the coin balances on its edge in slow motion, then falls (or stands, for an EDGE hit);
 *  - juice: anticipation (squash + button + marquee), a slow-motion toss with a glint trail, the edge balance, a near-miss
 *    tease, a count-up of the pot on every win, shake + light + sound scaled by the rung, tiered collect and a jackpot
 *    show for the EDGE call;
 *  - snapshots (`getSnapshot` / `applySnapshot`) for late joiners; `pc.fast` handling; sim-clock animation only;
 *  - charms: `luck` rerolls, plus the machine hooks `m.coinflip.pWin` / `m.coinflip.rideCap` and the tycoon
 *    feature flag `coinflip.extraRide`; attract mode (alternating lamps, an occasional hop of the coin);
 *  - `playHeadless` (shared rules) for staff auto-play and the bench "Sim" button.
 *
 * Controls: 1/2 or ←/→ call heads/tails · 3 calls the EDGE (1 in 60, pays ×54; E is Leave) · Space flip · after a win:
 * R ride up the ladder · Space or Q collect · Z/X bet. Round life-cycle: `beginRound` (stake) → `emit(flip)` → loss:
 * `settle(0)` · win: pot pending (busy=false) → `emit(flip)` again for a ride, or `emit(collect)` + `settle(pot)`.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { TweenHandle } from '@/core/tween';
import type { Kit } from '@/kit/types';
import { fmtCoins } from '@/core/i18n';
import { lerp, smoothstep, TAU } from '@/core/math';
import { buildModel, coinRestY, COIN_R, type CoinFlipParts } from './model';
import {
  EDGE_MULT, HOOK_P, HOOK_RIDES, MAX_RIDE_CAP, RIDE_CAP, STEP_MULT, WIN_P, clampP, clampRides, maxPayoutMult,
  playHeadless, roll, type Call, type Face, type Roll, type Side,
} from './rules';

export { playHeadless };

type Ev =
  | { k: 'call'; side: Call }
  /** One flip. `stake` is what rides on it (the bet, or the pot when riding); `ride` its 0-based rung on the ladder. */
  | { k: 'flip'; call: Call; res: Face; win: boolean; bet: number; stake: number; ride: number; turns: number; near: boolean; lucky: boolean }
  | { k: 'collect'; amount: number; bet: number; jackpot: boolean };
type State = { call: Call; streak: number; history: Face[]; pot: number; ride: number; bet: number; edge: boolean };

const HISTORY = 8;
const GOLD = 0xffd040;
const EDGE_C = 0xff5ad0;             // the EDGE call and its history box
const ARC = 0.36;                    // toss height above the dish (m)
const BAL_DUR = 0.75;                // the edge balance (sim s), longer for an EDGE call
const BAL_DUR_EDGE = 0.95;
const other = (s: Side): Side => (s === 'H' ? 'T' : 'H');
/** Rest angle of a face: heads 0, tails π, the edge π/2 (the coin stands on its rim). */
const faceAng = (f: Face): number => (f === 'T' ? Math.PI : f === 'E' ? Math.PI / 2 : 0);

export const def: MachineDef = {
  id: 'coinflip',
  category: 'oddity',
  slotSize: 'S',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 100, betSteps: [1, 2, 5, 10, 25, 50, 100],
  maxPayoutMult: maxPayoutMult(),
  rtp: 0.98,
  tier: 2,
  actionCost: 1,
  idleYield: 0.21,
  headless: playHeadless,
  tags: ['solo', 'dice', 'ladder'],
  modHooks: {
    'm.coinflip.pWin': `Base chance a heads/tails flip wins (${WIN_P.toFixed(3)}). Charms add, e.g. +0.05.`,
    'm.coinflip.rideCap': `Extra rides up the ladder (base ${RIDE_CAP}, hard cap ${MAX_RIDE_CAP}).`,
  },
  strings: {
    en: {
      name: 'Coin Flip Booth',
      desc: 'Call heads, tails or the edge. Win and ride the ladder up to 13x, or collect any time.',
      heads: 'Heads', tails: 'Tails', edge: 'Edge', flip: 'Flip', ride: 'Ride', collect: 'Collect',
      streak: 'STREAK {n}', pot: 'POT {n}', potLabel: 'Pot', h: 'H', t: 'T', e: 'E',
      // seat HUD (readability standard)
      goal: 'Call heads, tails or edge. Win and ride the ladder, or collect.',
      stPick: 'PICK A SIDE, THEN FLIP', stPickSub: 'You call it, the coin decides',
      stAir: 'IN THE AIR', stAirSub: 'Watch the coin balance on its edge',
      stWon: 'YOU WON: RIDE OR COLLECT', stWonSub: 'Ride for x{n} or take the pot',
      nStake: 'YOUR BET', nCall: 'YOUR CALL', nChance: 'CHANCE', nPot: 'WINNINGS', nNext: 'NEXT WIN',
      nStreak: 'STREAK', nBalance: 'BALANCE',
      cHeads: 'HEADS', cTails: 'TAILS', cEdge: 'EDGE', cFlip: 'FLIP', cRide: 'RIDE', cCollect: 'COLLECT', cBet: 'BET',
      cRules: 'RULES', cLeave: 'LEAVE',
      edgeOdds: '1 IN 60', edgeWin: 'THE COIN STANDS ON ITS EDGE!',
      tip1: 'Pick heads or tails, then flip. The coin decides.',
      tip2: '[{heads}] HEADS  ·  [{tails}] TAILS  ·  [{edge}] EDGE  ·  [{flip}] FLIP  ·  [{bet}] BET',
      tip3: 'After a win: [{ride}] RIDE up the ladder, or [{collect}] COLLECT. [{help}] RULES.',
      rule1: 'Call heads or tails and flip. A win pays 1.9x your bet.',
      rule2: 'Ride to climb the ladder: 1.9x, 3.6x, 7x, 13x. Collect any time.',
      rule3: 'A lost flip takes the amount at risk. Collecting pays the pot you hold.',
      rule4: 'The ladder tops out at 13x, and the pot then pays out by itself.',
      rule5: 'Each heads or tails flip wins about {p} of the time.',
      rule6: `EDGE (3): 1 in 60 the coin stands on its rim and pays ${EDGE_MULT}x the stake. Otherwise you lose.`,
    },
    tr: {
      name: 'Yazı-Tura Kabini',
      desc: 'Tura, yazı ya da kenar. Kazandıkça 13 kata kadar merdivende tırman, ya da kasayı al.',
      heads: 'Tura', tails: 'Yazı', edge: 'Kenar', flip: 'At', ride: 'Devam', collect: 'Kasayı Al',
      streak: 'SERİ {n}', pot: 'KASA {n}', potLabel: 'Kasa', h: 'T', t: 'Y', e: 'K',
      // seat HUD (readability standard)
      goal: 'Tura, yazı ya da kenar de. Kazanınca merdivende devam et ya da kasayı al.',
      stPick: 'BİR YÜZ SEÇ, SONRA AT', stPickSub: 'Tahmini sen yap, sonucu para belirler',
      stAir: 'HAVADA', stAirSub: 'Paranın kenarında dengelenişini izle',
      stWon: 'KAZANDIN: DEVAM ET YA DA AL', stWonSub: 'x{n} için devam et, ya da kasayı al',
      nStake: 'BAHSİN', nCall: 'TAHMİNİN', nChance: 'ŞANS', nPot: 'KASA', nNext: 'SONRAKİ',
      nStreak: 'SERİ', nBalance: 'BAKİYE',
      cHeads: 'TURA', cTails: 'YAZI', cEdge: 'KENAR', cFlip: 'AT', cRide: 'DEVAM', cCollect: 'KASAYI AL', cBet: 'BAHİS',
      cRules: 'KURALLAR', cLeave: 'AYRIL',
      edgeOdds: '60’TA 1', edgeWin: 'PARA KENARINDA DURDU!',
      tip1: 'Tura ya da yazı seç, sonra at. Sonucu para belirler.',
      tip2: '[{heads}] TURA  ·  [{tails}] YAZI  ·  [{edge}] KENAR  ·  [{flip}] AT  ·  [{bet}] BAHİS',
      tip3: 'Kazanınca [{ride}] DEVAM ile merdiveni tırman, ya da [{collect}] KASAYI AL. [{help}] KURALLAR.',
      rule1: 'Tura ya da yazı seç ve at. Bilirsen bahsinin 1,9 katını alırsın.',
      rule2: 'Devam edince merdiven yükselir: 1,9x, 3,6x, 7x, 13x. İstediğin an kasayı alabilirsin.',
      rule3: 'Kaybettiğin atışta o atışa koyduğun tutar gider. Kasayla ayrılırsan elindeki kasa ödenir.',
      rule4: 'Merdiven 13 katta biter ve kasa kendiliğinden ödenir.',
      rule5: 'Tura ya da yazı atışının her birinde kazanma şansı yaklaşık {p}.',
      rule6: `KENAR (3): 60 atıştan birinde para kenarında durur ve atılan tutarın ${EDGE_MULT} katını öder. Değilse kaybedersin.`,
    },
  },
};

export default class CoinFlip extends MachineBase<CoinFlipParts, Ev, State> {
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;
  private state: State = { call: 'H', streak: 0, history: [], pot: 0, ride: 0, bet: 0, edge: false };
  private forced: 'win' | 'loss' | 'near' | null = null;
  private hopTween: TweenHandle | null = null;
  private attractOn = true;

  protected createModel(kit: Kit): MachineModel<CoinFlipParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.idleChase();
    this.attractor.every('hop', 14, () => this.hop(), { first: 5 });
  }

  // ── attract: lamps alternate, the coin hops now and then ────────────────────────────────────────
  attract(dt: number, time: number): void {
    const on = Math.floor(time * 1.5) % 2 === 0;
    if (on !== this.attractOn) {
      this.attractOn = on;
      this.parts.lampHeads.setOn(on);
      this.parts.lampTails.setOn(!on);
    }
    this.attractor.update(dt);
  }

  private hop(): void {
    if (this.busy || this.occupant !== null || this.hopTween || this.state.history[0] === 'E') return;
    const { coinPivot, coin } = this.parts;
    const face = coin.rotation.x;
    this.sfx('coinFlick', { vol: 0.5 });
    this.hopTween = this.ctx.tweens.run(0.55, (k) => {
      coinPivot.position.y = coinRestY(0) + Math.sin(k * Math.PI) * 0.09;
      coin.rotation.x = face + TAU * k;
    }, {
      onDone: () => {
        this.hopTween = null;
        this.sfx('coinLand', { vol: 0.5 });
        this.ctx.fx.glow(this.parts.dish, GOLD, 0.25, 0.4);
      },
    });
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.hopTween?.cancel(); this.hopTween = null;
    this.refresh();
    this.idleChase();
    if (local) {
      if (this.state.pot > 0 && !this.roundOpen) this.resumeRound(this.state.bet);   // restored pot: the sitter owns it
      this.sfx('chime'); this.showHud();
      this.seatHud?.show();
      this.seatHud?.firstTip('coinflip', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.hud(null); this.seatHud?.hide(); }
    this.attractOn = !this.attractOn;           // force the lamps to re-sync in attract()
    this.attractor.reset();
    // Normal path: standUp() collected first. This is the safety net for forced / external releases.
    if (local && this.roundOpen) this.settle({ gross: this.state.pot, tags: ['ladder'] });
    this.state.pot = 0; this.state.ride = 0; this.state.edge = false;   // every peer drops the pot of whoever left
    this.refresh();
    this.idleChase();
  }

  onLang(): void {
    this.drawScreen();                              // the 96×48 display is drawn by us (kit `{ key }` labels redraw themselves)
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving with a pot on the table collects it first (the safe default for a ladder game). */
  protected override standUp(): void {
    if (this.pending) { void this.collect(); }          // busy now: settle() releases the seat afterwards
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'left': case 'n1': this.setCall('H'); break;
      case 'right': case 'n2': this.setCall('T'); break;
      case 'n3': this.setCall('E'); break;
      case 'primary': case 'confirm': if (this.pending) void this.collect(); else void this.flip(false); break;
      case 'alt': case 'double': void this.flip(true); break;
      case 'secondary': case 'collect': void this.collect(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  debugForce(arg: string): void {
    const a = arg.trim().toLowerCase();
    this.forced = a === 'win' || a === 'loss' || a === 'near' ? a : null;
    this.ctx.ui.toast(`coinflip: next flip ${this.forced ?? 'random'}`, 'sys');
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }
  private setCall(side: Call): void {
    if (this.busy || this.state.call === side) return;
    void this.emit({ k: 'call', side });
  }

  /** A win is waiting for the player's decision: ride up the ladder or collect. */
  private get pending(): boolean { return this.roundOpen && !this.busy && this.state.pot > 0; }
  private rideCap(): number {
    return clampRides(this.mod(HOOK_RIDES, RIDE_CAP) + (this.feature('coinflip.extraRide') ? 1 : 0));
  }
  /** The multiplier the next ride wins, as shown to the player. */
  private nextMult(): number { return STEP_MULT[Math.min(this.state.ride, STEP_MULT.length - 1)]; }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private async flip(ride: boolean): Promise<void> {
    if (this.busy) return;
    let stake: number, bet: number, idx: number;
    if (ride) {
      if (!this.pending || this.state.ride > this.rideCap()) return;
      stake = this.state.pot; bet = this.roundBet; idx = this.state.ride;
      this.busy = true;
    } else {
      if (this.roundOpen) return;
      if (!this.beginRound(this.bet)) return;               // charges the wallet, busy = true, re-seeds this.rng
      stake = bet = this.bet; idx = 0;
    }
    this.showHud();                                          // busy: only "Leave" stays on the strip
    const call = this.state.call;
    let r: Roll | null = null;
    try {
      r = this.forceRoll(roll(this.rng, clampP(this.mod(HOOK_P, WIN_P)), this.luck(), call), call);
      const tags = [
        ...(r.near ? ['nearmiss'] : []), ...(r.rerolled ? ['lucky'] : []), ...(idx > 0 ? ['ladder'] : []),
        ...(call === 'E' ? ['edge'] : []),
      ];
      // Settle-before-present (DECISIONS G): a loss closes the round in the credit step, before the toss is queued.
      // A win keeps the pot pending (no payout yet), so there is nothing to credit.
      const lost = !r.win;
      const credit = lost ? () => { this.settle({ gross: 0, tags }); this.busy = true; } : undefined;
      await this.emit({
        k: 'flip', call, res: r.face, win: r.win, bet, stake, ride: idx, turns: r.turns, near: r.near, lucky: r.rerolled,
      }, credit);
    } finally {
      if (this.roundOpen && !r?.win) this.settle({ gross: 0 });   // never strand a stake (rule 7)
      this.busy = false;                                          // pot pending (win) or round closed (loss)
    }
    // an EDGE hit ends the round at once; so does the top of the ladder
    if (r?.win && (call === 'E' || idx >= this.rideCap())) await this.collect();
    else this.showHud();
  }

  private async collect(): Promise<void> {
    if (!this.pending) return;
    this.busy = true;
    this.showHud();
    const amount = this.state.pot, bet = this.roundBet, jackpot = this.state.edge;
    const tags = [...(jackpot ? ['jackpot'] : []), 'ladder', ...(this.state.streak >= 2 ? [`streak:${this.state.streak}`] : [])];
    // credit first, present after (DECISIONS G): a reload mid-show must not lose the pot
    const credit = (): void => { this.settle({ gross: amount, tags }); };
    const shown = this.emit({ k: 'collect', amount, bet, jackpot }, credit);
    if (this.roundOpen) credit();                    // the emit was refused: still pay out, never strand the pot
    try { await shown; } finally { this.showHud(); }
  }

  /** Bench "force outcome": applied once, then back to random. */
  private forceRoll(r: Roll, call: Call): Roll {
    const f = this.forced;
    this.forced = null;
    if (f === 'win') return call === 'E' ? { ...r, win: true, face: 'E', near: false } : { ...r, win: true, face: call, near: false };
    if (f === 'loss' || f === 'near') {
      const face: Face = call === 'E' ? (r.face === 'E' ? 'H' : r.face) : other(call);
      return { ...r, win: false, face, near: f === 'near' };
    }
    return r;
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'call': return this.presentCall(ev);
      case 'flip': return this.presentFlip(ev, pc);
      case 'collect': return this.presentCollect(ev, pc);
    }
  }

  private presentCall(ev: Extract<Ev, { k: 'call' }>): void {
    this.state.call = ev.side;
    const { btnHeads, btnTails } = this.parts;
    if (ev.side !== 'T') void btnHeads.press();
    if (ev.side !== 'H') void btnTails.press();
    this.sfx('button');
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentFlip(ev: Extract<Ev, { k: 'flip' }>, pc: PresentCtx): Promise<void> {
    const { coin, coinPivot, btnFlip, marquee, lampHeads, lampTails, dish } = this.parts;
    const fx = this.ctx.fx;
    const won = ev.win;
    const stands = won && ev.res === 'E';                     // EDGE hit: the coin stays up on its rim
    const fast = pc.fast;
    this.hopTween?.cancel(); this.hopTween = null;

    // 1. data first (snapshots stay consistent), pixels later
    const s = this.state;
    const from = ev.ride > 0 ? ev.stake : 0;                  // the pot before this flip (count-up start)
    s.call = ev.call;
    s.history = [ev.res, ...s.history].slice(0, HISTORY);
    s.streak = won ? s.streak + 1 : 0;
    s.pot = won ? (stands ? ev.stake * EDGE_MULT : ev.bet * STEP_MULT[ev.ride]) : 0;
    s.ride = won ? ev.ride + 1 : 0;
    s.bet = ev.bet;
    s.edge = stands;

    const restRot = ev.turns * TAU + faceAng(ev.res);
    const balance = stands ? restRot : restRot - Math.PI / 2;  // the edge pose the coin balances on before it falls
    const lean = ev.near ? (ev.call === 'T' ? 0.2 : ev.call === 'H' ? -0.2 : 0) : 0;   // a near miss leans to the called face
    const r0 = coin.rotation.x;                               // the pose it starts from (an EDGE hit stands the coin up)
    const restY0 = coinRestY(r0);

    if (fast) {                                       // lagging queue: skip to the final pose
      coin.rotation.set(restRot, 0, 0);
      coinPivot.position.y = coinRestY(restRot);
    } else {
      // 2. anticipation: coil down, button, marquee races
      void btnFlip.press();
      marquee.chase('chase', 10);
      lampHeads.blink(8, 0.25); lampTails.blink(8, 0.25);
      this.sfx('button');
      await this.anim(0.16, (k) => {
        coinPivot.position.y = restY0 - 0.012 * k;
        coin.scale.set(1 + 0.1 * k, 1 - 0.3 * k, 1 + 0.1 * k);
      }, 'outQuad');
      coin.scale.set(1, 1, 1);

      // 3. the toss: arc + spins + glint trail, up to the edge pose
      this.sfx('coinFlick');
      this.sfx('whoosh', { vol: 0.5, pitch: 4 });
      const stopTrail = fx.trail(coin, { color: stands ? EDGE_C : GOLD, life: 0.35, rate: 40, size: 0.02 });
      const endY = coinRestY(balance);
      await this.anim(0.8, (k) => {
        const lift = COIN_R * smoothstep(0, 0.08, k) * (1 - smoothstep(0.9, 1, k));   // clear the felt while spinning
        coin.rotation.x = r0 + (balance - r0) * k;
        coin.rotation.z = Math.sin(k * Math.PI * 2) * 0.1;
        coinPivot.position.y = lerp(restY0, endY, k) + ARC * Math.sin(k * Math.PI) + lift;
      });
      stopTrail();
      coin.rotation.z = 0;
      if (this.disposed) return;

      // 4. the balance: slow motion, the coin rocks on its rim and leans to the called face; the tension beat
      const balDur = ev.call === 'E' ? BAL_DUR_EDGE : BAL_DUR;
      if (pc.local) fx.slowmo(0.4, 0.9);
      lampHeads.blink(10, balDur); lampTails.blink(10, balDur);
      const tease = ev.near ? this.nearMiss({ dur: balDur, at: dish, lamps: [lampHeads, lampTails] }) : Promise.resolve();
      await Promise.all([tease, this.anim(balDur, (k) => {
        const amp = 0.12 * (1 - k);
        coin.rotation.x = balance + lean * smoothstep(0, 1, k) + Math.sin(k * Math.PI * 6) * amp;
        coin.rotation.z = Math.sin(k * Math.PI * 7) * 0.07 * (1 - k);
        coinPivot.position.y = coinRestY(coin.rotation.x);
      })]);
      if (this.disposed) return;

      // 5. the fall onto the result face (an EDGE hit keeps the coin up on its rim)
      if (!stands) {
        const from0 = balance + lean;
        if (ev.near) this.sfx('thud', { vol: 0.8 });
        await this.anim(0.2, (k) => {
          coin.rotation.x = from0 + (restRot - from0) * k;
          coinPivot.position.y = coinRestY(coin.rotation.x);
        }, 'inQuad');
      }

      // 6. landing: bounce + Euler's-disk wobble (a smaller settle when it stands on its rim), dust, thud
      coin.rotation.x = restRot;
      this.sfx('coinLand');
      fx.dust(dish, 5);
      if (pc.local) fx.shake(stands ? 0.008 : 0.004, 0.15);
      const wob = stands ? 0.4 : 1;
      await this.anim(0.34, (k) => {
        const e = (1 - k) * (1 - k) * wob;
        coinPivot.position.y = coinRestY(restRot) + Math.abs(Math.sin(k * Math.PI * 2.5)) * 0.035 * e;
        coin.rotation.z = Math.sin(k * Math.PI * 9) * 0.2 * e;
        coin.rotation.x = restRot + Math.sin(k * Math.PI * 9 + 1) * 0.06 * e;
      });
      coin.rotation.set(restRot, 0, 0);
    }

    // 7. verdict
    this.refresh();
    if (won) {                                        // a hit, not yet a payout: the pot is now at risk / waiting
      const col = stands ? EDGE_C : GOLD;
      fx.sparks(dish, stands ? 40 : 10 + 4 * ev.ride, col);
      fx.glow(dish, col, stands ? 0.6 : 0.3 + 0.05 * ev.ride, 0.6);
      fx.lightPulse(dish, { color: col, mul: 1.2 + 0.2 * ev.ride, dur: 0.6 });
      fx.popText(dish, `×${stands ? EDGE_MULT : STEP_MULT[ev.ride]}`, col, {
        dur: 1.1, rise: 0.35, scale: 1.1 + 0.2 * ev.ride, shake: ev.ride > 0 || stands,
      });
      if (pc.local) fx.shake((stands ? 0.012 : 0.003 + 0.002 * ev.ride), stands ? 0.4 : 0.22);
      this.sfx(stands ? 'win3' : ev.ride === 0 ? 'win1' : ev.ride === 1 ? 'win2' : 'win3');
      marquee.chase('win', stands ? 14 : 8 + 2 * ev.ride);
      if (ev.lucky && pc.local) this.sfx('sparkle', { vol: 0.5, pitch: 7 });
      if (stands) this.toast(this.t('edgeWin'), 'good');
    } else {
      this.commiserate({ amount: ev.stake, at: dish });
      marquee.chase('blink', 1.5);
    }
    if (this.isLocalOccupant) {
      if (won) this.seatHud?.result('win', s.pot - from);     // the hit adds to the pot; the pot waits for ride or collect
      else this.seatHud?.result('lose', -ev.bet);             // a lost ride takes the whole round bet
    }
    if (!fast) {
      if (won) await countUp(this.ctx, from, s.pot, 0.4 * this.speed, (v) => this.drawScreen(v));   // the pot counts up
      this.drawScreen();
      await this.wait(0.3);
    }
    if (!this.disposed) this.idleChase();
  }

  private async presentCollect(ev: Extract<Ev, { k: 'collect' }>, pc: PresentCtx): Promise<void> {
    const { marquee, lampHeads, lampTails } = this.parts;
    const s = this.state;
    s.pot = 0; s.ride = 0; s.bet = ev.bet; s.edge = false;
    if (this.isLocalOccupant) this.seatHud?.result('win', ev.amount - ev.bet);
    const tier = juiceTier(ev.amount, ev.bet, ev.jackpot ? ['jackpot'] : undefined);
    this.drawScreen(0);
    if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
      // celebrate spawns its own coins + jingle: only add the count-up
      void this.celebrate(tier, { amount: ev.amount, marquee, lamps: [lampHeads, lampTails], restore: () => this.idleChase(), fast: pc.fast });
      await countUp(this.ctx, 0, ev.amount, pc.fast ? 0.1 : 1.2 * this.speed, (v) => this.drawScreen(v));
    } else {
      await this.pourCoins(ev.amount, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
    }
    if (!this.disposed) this.refresh();
  }

  override dispose(): void {
    this.hopTween?.cancel(); this.hopTween = null;
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, history: [...this.state.history] };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, history: [...s.history] };
    if (s.pot > 0) this.resumeRound(s.bet);          // a pot still at risk stays collectable
    this.refresh();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────────
  private idleChase(): void {
    const m = this.parts.marquee;
    if (this.state.pot > 0) m.chase('chase', 7);
    else m.chase('chase', this.occupant !== null ? 5 : 3);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const { lampHeads, lampTails, coin, coinPivot } = this.parts;
    const c = this.state.call;
    lampHeads.setOn(c === 'H' || c === 'E');
    lampTails.setOn(c === 'T' || c === 'E');
    const rot = faceAng(this.state.history[0] ?? 'H');        // an EDGE hit leaves the coin standing on its rim
    coin.rotation.set(rot, 0, 0);
    coin.scale.set(1, 1, 1);
    coinPivot.position.y = coinRestY(rot);
    this.drawScreen();
  }

  /** The 96×48 booth display: streak, last eight results, pot + ladder (`potShown` while it counts up). */
  private drawScreen(potShown?: number): void {
    const s = this.state, cap = this.rideCap();
    this.parts.screen.draw((g, sc) => {
      g.fillStyle = '#071207'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(this.t('streak', { n: s.streak }), 48, 4, { font: 'px5', color: s.streak >= 3 ? '#ffd040' : '#7dff7a', align: 'center' });
      s.history.forEach((side, i) => {
        g.fillStyle = side === 'H' ? '#e0b84a' : side === 'T' ? '#39e6ff' : '#ff5ad0';
        g.fillRect(5 + i * 11, 15, 9, 9);
        sc.text(this.t(side === 'H' ? 'h' : side === 'T' ? 't' : 'e'), 9 + i * 11, 17, { font: 'px5', color: '#071207', align: 'center' });
      });
      if (s.pot > 0) {
        sc.text(this.t('pot', { n: fmtCoins(Math.round(potShown ?? s.pot)) }), 48, 29, { font: 'px5', color: '#ffd040', align: 'center' });
        for (let i = 0; i <= cap; i++) {              // ladder: one box per rung, filled = won
          g.fillStyle = i < s.ride ? '#ffd040' : '#3a3a2a';
          g.fillRect(48 - ((cap + 1) * 7) / 2 + i * 7, 40, 5, 4);
        }
      } else if (s.bet > 0) {
        sc.text(fmtCoins(s.bet), 48, 34, { font: 'px5', color: '#4a8a4a', align: 'center' });
      }
    });
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** The chance of one heads/tails flip winning, as a whole percentage (hooks included). */
  private chance(): string { return `${Math.round(clampP(this.mod(HOOK_P, WIN_P)) * 100)}%`; }

  private tipLines(): Txt[] {
    return [
      { k: 'm.coinflip.tip1' },
      { k: 'm.coinflip.tip2', v: { heads: this.k('n1'), tails: this.k('n2'), edge: this.k('n3'), flip: this.k('primary'), bet: `${this.k('betDown')}/${this.k('betUp')}` } },
      { k: 'm.coinflip.tip3', v: { ride: this.k('double'), collect: this.k('primary'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return [
      { k: 'm.coinflip.rule1' }, { k: 'm.coinflip.rule2' }, { k: 'm.coinflip.rule3' }, { k: 'm.coinflip.rule4' },
      { k: 'm.coinflip.rule5', v: { p: this.chance() } }, { k: 'm.coinflip.rule6' },
    ];
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the booth. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const pending = this.pending;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.coinflip.goal' });

    // STATE: call and flip, in the air, or a win waiting for ride or collect
    if (this.busy) sh.state({ k: 'm.coinflip.stAir' }, 'neutral', { k: 'm.coinflip.stAirSub' });
    else if (pending) sh.state({ k: 'm.coinflip.stWon' }, 'good', { k: 'm.coinflip.stWonSub', v: { n: String(this.nextMult()) } });
    else sh.state({ k: 'm.coinflip.stPick' }, 'gold', { k: 'm.coinflip.stPickSub' });

    // KEY NUMBERS: bet (or the pot at risk), your call, chance, winnings, next rung, streak, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.coinflip.nStake' }, value: fmtCoins(this.roundOpen ? this.roundBet : this.bet), tone: 'gold' });
    nums.push({ label: { k: 'm.coinflip.nCall' }, value: { k: s.call === 'H' ? 'm.coinflip.cHeads' : s.call === 'T' ? 'm.coinflip.cTails' : 'm.coinflip.cEdge' }, tone: 'cyan' });
    nums.push(s.call === 'E'
      ? { label: { k: 'm.coinflip.nChance' }, value: { k: 'm.coinflip.edgeOdds' }, tone: 'neutral' }
      : { label: { k: 'm.coinflip.nChance' }, value: this.chance(), tone: 'neutral' });
    if (s.pot > 0) nums.push({ label: { k: 'm.coinflip.nPot' }, value: fmtCoins(s.pot), tone: 'good' });
    if (pending) nums.push({ label: { k: 'm.coinflip.nNext' }, value: `x${this.nextMult()}`, tone: 'gold' });
    nums.push({ label: { k: 'm.coinflip.nStreak' }, value: String(s.streak), tone: 'neutral' });
    nums.push({ label: { k: 'm.coinflip.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys the booth really reads
    if (!this.busy && !pending) {
      ctrl.push({ key: this.k('n1'), label: { k: 'm.coinflip.cHeads' }, action: 'left' });
      ctrl.push({ key: this.k('n2'), label: { k: 'm.coinflip.cTails' }, action: 'right' });
      ctrl.push({ key: this.k('n3'), label: { k: 'm.coinflip.cEdge' }, action: 'n3' });
      ctrl.push({ key: this.k('primary'), label: { k: 'm.coinflip.cFlip' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.coinflip.cBet' }, action: 'betUp' });
    }
    if (!this.busy && pending) {
      if (s.ride <= this.rideCap()) ctrl.push({ key: this.k('double'), label: { k: 'm.coinflip.cRide' }, action: 'double' });
      ctrl.push({ key: this.k('primary'), label: { k: 'm.coinflip.cCollect' }, action: 'collect', primary: true });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.coinflip.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.coinflip.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

}
