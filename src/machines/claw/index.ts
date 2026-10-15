/**
 * Claw Crane (`claw`) — solo grabber (MACHINES_machines §15). Copies the mines/coinflip pattern: the logic / present split.
 *
 *  - the authority (the local occupant) owns the round: `start` charges the stake (`beginRound`), restocks on a new
 *    Night and rolls the strong grip (hidden until the claw closes); the gantry moves in `tick` and is sent as `pos`
 *    (10 Hz, cosmetic); `drop` runs the pure `settleDrop` and emits the whole result with the wallet step as its
 *    credit (DECISIONS G: settle before present);
 *  - `present()` is the only place the visible state changes: the pile mirror (`applyGrab`, deterministic), the claw
 *    phases DESCEND 1.2 → CLOSE 0.6 → LIFT 1.0 → TRAVEL 1.5 → RELEASE 0.4 → RETURN 1.0, the chute and the juice;
 *  - the move window is 15 s (+ claw.timer). The timer or E drop the claw, so a round never strands a stake.
 *
 * Controls: WASD / arrows move the claw (diagonals normalised) · Space / Enter / the DROP dome start a play, then
 * drop · wheel / Z / X stake (READY) · B max · H help · E drop and stand up.
 */
import type * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { t } from '@/core/i18n';
import { clamp } from '@/core/math';
import { createRng } from '@/core/rng';
import {
  buildModel, dressPrize, pileSpot, type ClawParts, HEAD_DOWN, HEAD_TOP, PRONG_OPEN, PRONG_STRONG, PRONG_WEAK, RAIL_Y,
} from './model';
import {
  aimAt, applyGrab, buildPile, charmsOf, CHUTE, GANTRY_LIM, GANTRY_SPEED, grossOf, HOOK_JACKPOT, HOOK_MAGNET, HOOK_TIMER,
  HOOK_WEAK, HOOK_XRAY, KIND, playHeadless, settleDrop, STAKE_MAX, STAKE_MIN, strongChance, TIMER_S,
  type Grab, type Kind, type Prize,
} from './rules';
import STR from './claw.strings';

export { playHeadless };

/** Event payloads (type aliases so they stay JSON-compatible). */
type StartEv = { k: 'start'; stake: number; night: number; timer: number; restock: Prize[] | null };
type PosEv = { k: 'pos'; x: number; z: number };
type DropEv = { k: 'drop'; x: number; z: number; strong: boolean; gross: number; grab: Grab; kinds: Kind[]; tags: string[] };
type Ev = StartEv | PosEv | DropEv;

/** Presentation mirror (every peer) and the saved pile. */
type State = { pile: Prize[]; night: number; stake: number; wins: number };
type Snap = { s: State };

const POS_HZ = 0.1;                 // seconds between `pos` events
const MOVE_TURN = 0.35;             // joystick tilt, rad
const IDLE_TILT = -0.1;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export const def: MachineDef = {
  id: 'claw',
  category: 'physics',
  slotSize: 'M',
  zone: 'midway',
  seats: 1,
  shared: false,
  minBet: STAKE_MIN, maxBet: STAKE_MAX, betSteps: [2, 5, 10, 20, 50],
  maxPayoutMult: 60,
  rtp: 0.80,
  tier: 3,
  actionCost: 2,
  headless: playHeadless,
  tags: ['solo', 'physics', 'skill', 'claw'],
  modHooks: {
    'm.claw.xray': 'Claw lamp shows the grip strength before the drop (> 0 enables).',
    'm.claw.timer': 'Adds N seconds to the 15 s move window.',
    'm.claw.weakCarry': 'Multiplies the weak grip survival (base 1, total capped at 0.5).',
    'm.claw.magnet': 'Adds 0.01 m of alignment radius per stack.',
    'm.claw.jackpotChance': 'Multiplies the strong grip chance (base 1).',
    luck: 'Luck: +1.5 % strong grip chance per point (cap +30 %).',
  },
  strings: { en: STR.en, tr: STR.tr },
};

export default class Claw extends MachineBase<ClawParts, Ev, Snap> {
  private st: State = { pile: [], night: -1, stake: 0, wins: 0 };
  // authority-only copies (the round in flight; the mirror `st` follows through `present`)
  private pileA: Prize[] = [];
  private nightA = -1;
  private strong = false;
  private dropping = false;
  private aim = { x: 0, z: 0 };
  private hold = { l: false, r: false, u: false, d: false };
  private posAcc = 0;
  private timerShown = '';
  private depth = HEAD_TOP;
  private twitchLive = false;

  protected createModel(kit: KitX): MachineModel<ClawParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    // idle display pile: the real pile is restocked by the first play of a Night, but the pit must not sit empty in the meantime
    if (this.st.pile.length === 0) {
      this.st.pile = buildPile(createRng(this.modelOpts.seed ^ 0x51ac));
      for (const p of this.st.pile) dressPrize(this.parts, p.id, p.kind);
    }
    this.setDepth(HEAD_TOP);
    this.setProngs(PRONG_OPEN);
    this.parts.marquee.chase('chase', 6);
    this.attractor.every('twitch', 15, () => this.twitch(), { first: 6 });
    this.refresh();
  }

  // ── attract: the claw homes, twitches open and closed every 15 s, the marquee chases ─────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private twitch(): void {
    if (this.busy || this.roundOpen || this.twitchLive) return;
    this.twitchLive = true;
    void this.anim(0.3, (k) => this.setProngs(lerp(PRONG_OPEN, 0.05, Math.sin(k * Math.PI))))
      .then(() => { this.twitchLive = false; });
  }

  // ── occupancy ────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.showHud();
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    // Normal path: standUp() dropped the claw first. Safety net for forced releases: never strand a stake.
    if (local && this.roundOpen) {
      this.dropping = false;
      this.settle({ gross: 0, tags: ['void'] });
    }
    this.hold = { l: false, r: false, u: false, d: false };
    this.refresh();
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  /** E: an open round drops first (never forfeits the stake); then the usual stand-up. */
  protected override standUp(): void {
    if (this.roundOpen && !this.dropping) this.drop();
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
      this.setHold(a, e.down);
      return;
    }
    if (!e.down) return;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.onPrimary(); break;
      case 'collect': this.drop(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
      case 'help': this.toast(this.t('help')); this.sfx('click'); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    const hit = this.pick([this.parts.buttons.drop.root]);
    if (!hit || e.type !== 'down' || e.button !== 0) return;
    this.onPrimary();
  }

  private setHold(a: 'left' | 'right' | 'up' | 'down', on: boolean): void {
    if (a === 'left') this.hold.l = on;
    else if (a === 'right') this.hold.r = on;
    else if (a === 'up') this.hold.u = on;
    else this.hold.d = on;
  }

  private onPrimary(): void {
    if (this.roundOpen) this.drop();
    else this.startRound();
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen || this.busy || this.dropping) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  // ── sim clock: gantry motion, timer, cosmetic position stream ────────────────────────────────────
  tick(dt: number): void {
    if (!this.roundOpen || this.dropping) return;
    if (this.timerState) {
      const left = this.timerLeft;
      const txt = String(Math.ceil(left)).padStart(2, '0');
      if (txt !== this.timerShown) {
        this.timerShown = txt;
        this.parts.timer.set(txt);
        if (this.isLocalOccupant && left <= 3 && left > 0) this.sfx('clockTick');
      }
      if (this.isLocalOccupant && left <= 0) this.drop();
    }
    if (!this.isLocalOccupant || this.dropping) return;
    const dx = (this.hold.r ? 1 : 0) - (this.hold.l ? 1 : 0);
    const dz = (this.hold.d ? 1 : 0) - (this.hold.u ? 1 : 0);   // up = away from the player (−z)
    if (dx === 0 && dz === 0) {
      this.parts.joystick.rotation.set(IDLE_TILT, 0, 0);
      return;
    }
    const len = Math.hypot(dx, dz);
    const step = (GANTRY_SPEED * dt) / len;
    this.aim.x = clamp(this.aim.x + dx * step, -GANTRY_LIM, GANTRY_LIM);
    this.aim.z = clamp(this.aim.z + dz * step, -GANTRY_LIM, GANTRY_LIM);
    this.setGantry(this.aim.x, this.aim.z);
    this.parts.joystick.rotation.set(IDLE_TILT + dz * MOVE_TURN * 0.3, 0, -dx * MOVE_TURN);
    this.posAcc += dt;
    if (this.posAcc >= POS_HZ) {
      this.posAcc = 0;
      void this.emit({ k: 'pos', x: this.aim.x, z: this.aim.z });
    }
  }

  // ── authority-side logic: runs only on the local occupant ───────────────────────────────────────
  /** Start a play: charge the stake, restock on a new Night, roll the strong grip. */
  private startRound(): void {
    if (this.busy || this.roundOpen || this.dropping || !this.isLocalOccupant) return;
    const night = this.ctx.run.night();
    if (night === this.nightA && this.pileA.length === 0) {
      this.toast(this.t('empty'), 'bad');
      this.sfx('buzzer');
      return;
    }
    const stake = this.bet;
    if (!this.beginRound(stake)) return;        // charges the wallet, busy = true, re-seeds this.rng
    let restock: Prize[] | null = null;
    if (night !== this.nightA) {
      restock = buildPile(this.rng);
      this.pileA = restock.map((p) => ({ ...p }));
      this.nightA = night;
    }
    this.strong = this.rng.chance(strongChance(this.luck(), this.mod(HOOK_JACKPOT, 1)));
    this.aim = { x: 0, z: 0 };
    this.hold = { l: false, r: false, u: false, d: false };
    this.posAcc = 0;
    const timer = TIMER_S + Math.max(0, this.mod(HOOK_TIMER, 0));
    if (this.mod(HOOK_XRAY, 0) > 0) this.toast(this.strong ? this.t('xrayOn') : this.t('xrayOff'));
    void this.emit({ k: 'start', stake, night, timer, restock });
    this.showHud();
  }

  /** Drop the claw at the current aim: the pure rules decide; the wallet settles before the show (DECISIONS G). */
  private drop(): void {
    if (!this.roundOpen || this.dropping || !this.isLocalOccupant) return;
    this.dropping = true;
    const stake = this.roundBet;
    const aimed = aimAt(this.pileA, this.aim.x, this.aim.z, this.mod(HOOK_MAGNET, 0));
    const r = settleDrop(this.rng, this.pileA, aimed, this.strong, { weakMult: this.mod(HOOK_WEAK, 1) });
    this.pileA = r.pile;
    const gross = grossOf(r.delivered, stake);
    const tags: string[] = ['claw'];
    if (r.grab.won !== null) tags.push('claw-win');
    if (r.delivered.includes('egg')) tags.push('golden');
    for (const c of charmsOf(r.delivered)) tags.push(`charm-${c}`);
    const ev: DropEv = {
      k: 'drop', x: this.aim.x, z: this.aim.z, strong: this.strong, gross, grab: r.grab, kinds: r.delivered, tags,
    };
    const shown = this.emit(ev, () => {
      // capsules pay a free charm when the run takes one; otherwise their coin value stays in the gross
      ev.gross = this.capsulePayout(r.delivered, stake, gross);
      this.settle({ gross: ev.gross, tags });
    });
    void shown.then(() => {
      this.dropping = false;
      this.showHud();
    });
  }

  /** Coins a drop pays after the capsules: each capsule whose charm the run grants drops its coin value. */
  private capsulePayout(kinds: readonly Kind[], stake: number, gross: number): number {
    let g = gross;
    for (const k of kinds) {
      const rarity = KIND[k].charm;
      if (rarity && this.grantCapsuleCharm(rarity)) g -= KIND[k].mult * stake;
    }
    return Math.max(0, g);
  }

  /** Grants one charm of the capsule's rarity from the run's launch pool, skipping charms already held. False: pay coins. */
  private grantCapsuleCharm(rarity: 'common' | 'rare'): boolean {
    const run = this.ctx.run;
    const f: unknown = Reflect.get(run, 'charmPool');
    if (typeof f !== 'function') return false;
    const pool = f.call(run, rarity) as ReadonlyArray<{ id: string; maxStacks?: number }>;
    const owned = new Set(run.charms(this.selfId).map((s) => s.id));
    const open = pool.filter((p) => (p.maxStacks ?? 1) > 1 || !owned.has(p.id));
    if (open.length === 0) return false;
    return run.grantCharm(open[Math.floor(this.rng.next() * open.length)].id);
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'pos': this.setGantry(ev.x, ev.z); return;
      case 'drop': return this.presentDrop(ev, pc);
    }
  }

  private presentStart(ev: StartEv, pc: PresentCtx): void {
    const s = this.st;
    s.stake = ev.stake;
    s.night = ev.night;
    if (ev.restock) {
      for (const p of ev.restock) dressPrize(this.parts, p.id, p.kind);
      s.pile = ev.restock.map((p) => ({ ...p }));
    }
    this.layoutPile();
    this.timerState = { until: pc.t + ev.timer * 1000, label: this.t('moving') };
    this.timerShown = '';
    this.parts.leds.bet.setOn(true);
    this.parts.marquee.chase('chase', 10);
    if (!pc.fast) this.sfx('lever', { vol: 0.5 });
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentDrop(ev: DropEv, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const g = ev.grab;
    this.timerState = null;
    this.timerShown = '';
    const pre = this.st.pile;
    const target = g.target !== null ? pre.find((q) => q.id === g.target) ?? null : null;
    const mesh = target ? p.prizes[target.id] : null;
    const tumbleMesh = g.tumble !== null ? p.prizes[g.tumble] : null;
    this.st.pile = applyGrab(pre, g);
    if (g.won !== null) this.st.wins += 1;
    const won = g.won !== null || g.tumble !== null;

    if (pc.fast) {
      this.setGantry(ev.x, ev.z);
      this.setDepth(HEAD_TOP);
      this.setProngs(PRONG_OPEN);
      this.layoutPile();
      this.finishRound(ev, won);
      return;
    }

    const coinOut = this.model.anchors.coinOut;
    this.sfx('motor', { vol: 0.5 });
    void this.anim(0.3, (k) => { p.dollHead.rotation.y = Math.PI * (1 - k); }, 'outQuad');
    this.setGantry(ev.x, ev.z);
    // DESCEND 1.2 s
    await this.anim(1.2, (k) => this.setDepth(lerp(HEAD_TOP, HEAD_DOWN, k)), 'inQuad');
    // CLOSE 0.6 s: the strong grip reveals itself here
    this.sfx('ratchet');
    const closeTo = ev.strong ? PRONG_STRONG : PRONG_WEAK;
    if (ev.strong) p.leds.win.setOn(true);
    await this.anim(0.6, (k) => this.setProngs(lerp(PRONG_OPEN, closeTo, k)), 'outQuad');
    if (!g.lift) {
      this.sfx('buzzer', { vol: 0.3 });
      await this.anim(0.8, (k) => this.setDepth(lerp(HEAD_DOWN, HEAD_TOP, k)), 'outQuad');
      await this.returnClaw(ev, won);
      return;
    }

    // LIFT 1.0 s (a weak grip lets go at 0.6 s, mid-lift)
    const liftDrop = g.dropAt === 'lift';
    let fell = false;
    const carry = (m: THREE.Object3D | null): void => { if (m && !fell) this.carry(m); };
    await this.anim(1.0, (k) => {
      this.setDepth(lerp(HEAD_DOWN, HEAD_TOP, k));
      if (liftDrop && !fell && k >= 0.6) { fell = true; void this.slip(mesh, target); }
      carry(mesh);
    }, 'outQuad');
    if (liftDrop) {
      await this.returnClaw(ev, won);
      return;
    }

    // TRAVEL 1.5 s to the chute (a weak grip lets go at 0.8 s)
    const x0 = this.parts.gantry.position.x, z0 = this.parts.gantry.position.z;
    const travelDrop = g.dropAt === 'travel';
    this.sfx('motor', { vol: 0.4 });
    await this.anim(1.5, (k) => {
      this.setGantry(lerp(x0, CHUTE.x, k), lerp(z0, CHUTE.z, k));
      if (travelDrop && !fell && k >= 0.8 / 1.5) { fell = true; void this.slip(mesh, target); }
      carry(mesh);
    }, 'inOutQuad');
    if (travelDrop) {
      await this.returnClaw(ev, won);
      return;
    }

    // RELEASE 0.4 s, then a won prize slides down the chute
    await this.anim(0.4, (k) => this.setProngs(lerp(closeTo, PRONG_OPEN, k)), 'outQuad');
    if (g.won !== null && mesh) {
      this.sfx('coinDrop');
      const from = mesh.position.clone();
      await this.anim(0.8, (k) => this.slideTo(mesh, from, coinOut.position, k), 'inQuad');
      mesh.visible = false;
      p.chuteLamp.setOn(true);
      this.sfx('whoosh', { vol: 0.5 });
    }
    if (tumbleMesh && g.tumble !== null) {
      const from = tumbleMesh.position.clone();
      void this.anim(0.5, (k) => this.slideTo(tumbleMesh, from, coinOut.position, k), 'inQuad');
    }
    await this.returnClaw(ev, won);
  }

  /** RETURN 1.0 s: the head rises, the gantry goes home, then the pile is laid out again. */
  private returnClaw(ev: DropEv, won: boolean): Promise<void> {
    const x0 = this.parts.gantry.position.x, z0 = this.parts.gantry.position.z, d0 = this.depth;
    this.setProngs(PRONG_OPEN);
    return this.anim(1.0, (k) => {
      this.setDepth(lerp(d0, HEAD_TOP, k));
      this.setGantry(lerp(x0, 0, k), lerp(z0, 0, k));
    }, 'outQuad').then(() => {
      this.aim = { x: 0, z: 0 };
      this.layoutPile();
      this.finishRound(ev, won);
    });
  }

  /** The round's juice once the claw is home: a win plays its tier, a loss plays the sad trombone. */
  private finishRound(ev: DropEv, won: boolean): void {
    this.parts.leds.win.setOn(false);
    this.parts.chuteLamp.setOn(false);
    this.parts.leds.bet.setOn(false);
    this.parts.marquee.chase('chase', 6);
    if (!won) {
      this.commiserate();
    } else {
      if (ev.kinds.includes('egg')) this.sfx('jackpot');
      else this.sfx('win2');
      // the stake was charged at start, so the win shown is the gross less the stake; the multiple uses the gross
      const bet = this.st.stake;
      void this.celebrate(juiceTier(ev.gross, bet, ev.tags), { amount: Math.max(0, ev.gross - bet), bet });
      if (ev.gross > 0) void this.pourCoins(ev.gross, { bet });
      for (const c of charmsOf(ev.kinds)) this.toast(t(c === 'rare' ? 'm.claw.charmRare' : 'm.claw.charmCommon'), 'good');
    }
    this.parts.timer.set('--');
    this.timerShown = '';
    if (this.isLocalOccupant) this.showHud();
  }

  /**
   * A slip: the prize leaves the grip and hangs for a beat. A 0.3 s wobble and a near-miss tease (heartbeat, red pulse,
   * the win LED flutters) run first, then it falls onto its pile spot with the thud.
   */
  private async slip(mesh: THREE.Object3D | null, target: Prize | null): Promise<void> {
    if (mesh) {
      const r0 = mesh.rotation.z;
      const wobble = this.anim(0.3, (k) => { mesh.rotation.z = r0 + Math.sin(k * Math.PI * 4) * 0.22 * (1 - k); }, 'outQuad');
      await Promise.all([wobble, this.nearMiss({ at: mesh, dur: 0.3, lamps: [this.parts.leds.win] })]);
      mesh.rotation.z = r0;
    }
    this.sfx('thud', { vol: 0.5 });
    await this.dropPrize(mesh, target);
  }

  /** The prize drops (failed or weak grip): it falls onto its pile spot. */
  private dropPrize(mesh: THREE.Object3D | null, target: Prize | null): Promise<void> {
    if (!mesh || !target) return Promise.resolve();
    const from = mesh.position.clone();
    const landed = this.st.pile.find((q) => q.id === target.id) ?? target;
    const sp = pileSpot(landed.x, landed.z, landed.layer);
    return this.anim(0.35, (k) => {
      mesh.position.set(lerp(from.x, sp.x, k), lerp(from.y, sp.y, k * k), lerp(from.z, sp.z, k));
    }, 'outQuad');
  }

  private slideTo(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, k: number): void {
    mesh.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k), lerp(from.z, to.z, k));
  }

  /** The prize rides under the claw head (root space). */
  private carry(mesh: THREE.Object3D): void {
    const gx = this.parts.gantry.position.x, gz = this.parts.gantry.position.z;
    mesh.position.set(gx, RAIL_Y - this.depth - 0.07, gz);
  }

  // ── rig helpers ───────────────────────────────────────────────────────────────────────────────────
  private setDepth(d: number): void {
    this.depth = d;
    const p = this.parts;
    p.clawHead.position.y = -d;
    p.cable.scale.y = Math.max(0.001, d);
    p.cable.position.y = -d / 2;
  }

  private setProngs(close: number): void {
    for (const pr of this.parts.prongs) pr.rotation.z = -close;
  }

  private setGantry(x: number, z: number): void {
    this.parts.gantry.position.set(x, RAIL_Y, z);
  }

  /** Every pile slot shows its prize (or nothing) at its place. */
  private layoutPile(): void {
    const have = new Map<number, Prize>(this.st.pile.map((q) => [q.id, q]));
    this.parts.prizes.forEach((m, id) => {
      const q = have.get(id);
      m.visible = !!q;
      if (!q) return;
      const sp = pileSpot(q.x, q.z, q.layer);
      m.position.set(sp.x, sp.y, sp.z);
      m.rotation.y = (q.rotY * Math.PI) / 180;
    });
  }

  /** Idle panel: the credit LED shows a pile with prizes left. */
  private drawPanel(): void {
    this.parts.leds.credit.setOn(this.st.pile.length > 0);
    if (!this.roundOpen) this.parts.timer.set('--');
  }

  /** Call after any mirror or round change, outside the animations (never while a prize is in flight). */
  private refresh(): void {
    this.layoutPile();
    this.drawPanel();
    if (this.isLocalOccupant) this.showHud();
  }

  private showHud(): void {
    const hints: HudHint[] = this.dropping ? [] : this.roundOpen
      ? [
        { action: 'primary', label: this.t('hDrop') },
        { action: 'left', label: this.t('hMove') },
      ]
      : [
        { action: 'primary', label: this.t('hPlay') },
        { action: 'betUp', label: t('common.bet') },
      ];
    hints.push({ action: 'help', label: this.t('hHelp') });
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: this.roundOpen ? null : this.bet,
      hints,
      stats: [
        { label: this.t('timer'), value: this.roundOpen ? this.timerShown || '--' : '--' },
        { label: this.t('sStake'), value: String(this.roundOpen ? this.roundBet : this.bet) },
      ],
    });
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return { s: { ...this.st, pile: this.st.pile.map((p) => ({ ...p })) } };
  }

  applySnapshot(snap: Snap): void {
    this.st = { ...snap.s, pile: snap.s.pile.map((p) => ({ ...p })) };
    this.pileA = this.st.pile.map((p) => ({ ...p }));
    this.nightA = this.st.night;
    this.refresh();
  }
}
