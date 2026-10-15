/**
 * Coin Pusher "The Shelf" (`coinpusher`) — shared TableBase device, two stations, host-resolved (MACHINES_machines §10).
 *
 * What it demonstrates
 *  - the logic / present split for a shared table: the host rolls every drop (`rules.ts`) and `emit`s the outcome;
 *    `present()` is the only place the public state changes, on every peer. Wins settle through `emit`'s credit step,
 *    so the wallet is paid before the presentation plays;
 *  - a block economy: a 10-coin block is charged once (`chargeSeat`), unused coins are refunded when it closes, and one
 *    outcome pays the block (closed after 10 coins or 10 s idle, or when the player leaves);
 *  - a governor that steers the gutter width toward 88 % RTP from the realised return (`govStep`);
 *  - juice: the drop arc and fall, a lucky-gate spin with reel stops, shower waves, walls that rise, a golden-plate drop,
 *    tilt alarms, and tiered block celebrations;
 *  - `playHeadless` (shared rules) for staff auto-play and the bench sim.
 *
 * Controls: hold Space / LMB drop (3 a second) · A / D (←/→) aim the chute · F thump the shelf (each thump pushes a few
 * coins into the trays and fills the station's heat meter; the third pip trips the tilt alarm, which loses the tray and
 * locks the station 30 s) · H info · E stand. Coins are cosmetic on the shelf; the pile is a fixed gauge (`model.ts`).
 */
import * as THREE from 'three';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { Kit } from '@/kit/types';
import { isBot, type PlayerId } from '@/core/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { clamp, lerp } from '@/core/math';
import { fmtCoins, t as tr } from '@/core/i18n';
import { registerDebugForce } from '@/core/debugForce';
import {
  buildModel, pileXZ, STATION_X, CHUTE_TRAVEL, CHUTE_Y, TRAY_X, TRAY_Y, TRAY_Z, FLY_FIRST, FLY_COUNT, PILE_SLOTS,
  REEL_SYMBOLS, SHELF_Y, type CoinpusherParts,
} from './model';
import {
  BLOCK, HOOK_WALLS, SHOVE_COINS, THUMP_MAX, TILT_S, TRAY_CAP, TRAY_TOKEN_RATE, WALLS_S, heatNow, knobsFor, makeGov,
  govRecord, playHeadless, rollDrop, rollShove, rollUnits, trackLane, type Fate, type Gov, type Knobs, type LaneTrack,
  type StationIx,
} from './rules';
import { STRINGS } from './strings';

export { playHeadless };

/**
 * Public state (every peer; late joiners get it in the snapshot). Times are host ms. `heat` is the thump meter as
 * `heat[s]` pips at host time `heatT[s]`; it cools with time (`heatNow`).
 */
type St = {
  shelf: number; tilt: [number, number]; walls: number; blk: [number, number]; pay: [number, number]; win: [number, number];
  heat: [number, number]; heatT: [number, number];
};
/** Host-only bookkeeping that must survive a save. The heat copy here is the authority the thump checks against. */
type Host = { tray: [number, number]; tiltAt: [number, number]; wallsAt: number; lane: LaneTrack; heat: [number, number]; heatT: [number, number] };
type Snap = { s: St; g: Gov | null; h: Host | null };
type Act = { k: 'drop'; x: number } | { k: 'thump' };
/** Fate of one coin as [station, lost 0/1, units]. */
type FateTuple = [number, number, number];
type Ev =
  | { k: 'drop'; st: number; x: number; lost: number; to: number; u: number; gold: number; gate: string; prize: string; wal: number; fates: FateTuple[] }
  | { k: 'block'; st: number; n: number; pay: number; bet: number; tags: string[] }
  | { k: 'thump'; st: number; heat: number; at: number; fates: FateTuple[] }
  | { k: 'tilt'; st: number; until: number; at: number; lost: number }
  | { k: 'scav'; st: number; coins: number };
type DropEv = Extract<Ev, { k: 'drop' }>;

const AIM_SPEED = 0.8;                 // aim units per second while A/D is held
const SHOVE_JOLT = 0.10;               // metres the pusher drives forward on a THUMP (visible, then it returns)
const SHOWER_WAVE = 4;                 // coins per shower wave (≤ the flying slots)
const PILE_START = 180;                // restock level (house coins on the shelf)
const PRIZE_TIER_ICON = ['prizeCommon', 'prizeUncommon', 'prizeRare'] as const;
const GATE_SYMBOL: Readonly<Record<string, string>> = { S: 'cherry', L: 'bell', W: 'star', P: 'coin', J: 'jackpot' };
const GATE_JUICE: Readonly<Record<string, 'small' | 'medium' | 'jackpot'>> = { S: 'small', L: 'medium', W: 'small', P: 'medium', J: 'jackpot' };
const BRASS = 0xc9a227, GOLD = 0xffd040;

export const def: MachineDef = {
  id: 'coinpusher',
  category: 'physics',
  slotSize: 'L',
  zone: 'laundry',
  seats: 2,
  shared: true,
  tier: 2,
  minBet: 1, maxBet: 250,                // one block = 10 coins × denomination (1 / 5 / 25)
  maxPayoutMult: 60,
  rtp: 0.88,
  actionCost: 1,
  idleYield: 0.3,
  tags: ['table', 'physics', 'bonus', 'shared'],
  headless: playHeadless,
  modHooks: {
    'm.coinpusher.goldCoin': 'Chance a dropped coin is gold (5 D when it falls into a tray; base 0).',
    'm.coinpusher.wallsUp': 'Seconds the side walls stay up after SHOWER/WALLS (base 20).',
    'm.coinpusher.showerSize': 'Multiplier on shower sizes (base 1; the governor trims ×0.8–1.2 on top).',
    'm.coinpusher.prizeChance': 'Multiplier on the PRIZE weight of the lucky gate (base 1).',
    'm.coinpusher.trayMagnet': 'Share of crossing coins kept by the dropping station, 0–1 (base 0).',
  },
  strings: STRINGS,
};

export default class CoinPusher extends TableBase<CoinpusherParts, Ev, Snap, Act> {
  // ── public state (mirrored from events) ──
  private st: St = { shelf: PILE_START, tilt: [0, 0], walls: 0, blk: [0, 0], pay: [0, 0], win: [0, 0], heat: [0, 0], heatT: [0, 0] };
  // ── host-only authority ──
  private gov: Gov = makeGov();
  private hostState: Host = { tray: [0, 0], tiltAt: [0, 0], wallsAt: 0, lane: { st: -1, n: 0 }, heat: [0, 0], heatT: [0, 0] };
  private tok: [number, number] = [TRAY_TOKEN_RATE, TRAY_TOKEN_RATE];
  private open: [boolean, boolean] = [false, false];
  private cnt: [number, number] = [0, 0];
  private units: [number, number] = [0, 0];
  /** A 'J' (jackpot) drop landed in the open block: the block settles as the jackpot tier. */
  private jack: [boolean, boolean] = [false, false];
  private lastDrop: [number, number] = [-1e9, -1e9];
  /** Last whole heat pip drawn per station (the meter cools with time, so the screens repaint when it steps). */
  private heatShown: [number, number] = [-1, -1];
  // ── local presentation / input ──
  private D = 1;                       // denomination (betLimits.min for this instance)
  private aim = 0;
  private leftHeld = false;
  private rightHeld = false;
  private firing = false;
  private fireAcc = 0;
  private clock = 0;
  private kick = 0;
  private wallsK = 0;
  private flyIx = 0;

  protected createModel(kit: Kit): MachineModel<CoinpusherParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.D = Math.max(1, this.ctx.run.betLimits(this.def.id, this.id).min);
    this.paintPile();
    this.paintLeds();
    this.paintLamps();
    for (let s = 0; s < 2; s++) this.parts.chutes[s].position.x = STATION_X[s];
  }

  // ── client: input (local occupant) ──────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (a === 'primary') {
      if (e.down && !e.repeat) { this.firing = true; this.fireAcc = 1 / TRAY_TOKEN_RATE; }
      else if (!e.down) this.firing = false;
      return;
    }
    if (a === 'left') { this.leftHeld = e.down; return; }
    if (a === 'right') { this.rightHeld = e.down; return; }
    if (!e.down || e.repeat) return;
    if (a === 'fast') { this.act({ k: 'thump' }); return; }
    if (a === 'help') this.toast(`${tr('m.coinpusher.infoTitle')}: ${tr('m.coinpusher.infoBody')}`, 'sys');
  }

  tick(dt: number): void {
    const seat = this.localSeat;
    const dir = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
    if (dir !== 0 && seat >= 0) {
      this.aim = clamp(this.aim + dir * AIM_SPEED * dt, -1, 1);
      this.parts.chutes[seat].position.x = STATION_X[seat] + this.aim * CHUTE_TRAVEL;
    }
    if (!this.firing || seat < 0 || this.isTilted(seat)) return;
    this.fireAcc += dt;
    while (this.fireAcc >= 1 / TRAY_TOKEN_RATE) {
      this.fireAcc -= 1 / TRAY_TOKEN_RATE;
      this.act({ k: 'drop', x: this.aim });
    }
  }

  private isTilted(seat: number): boolean { return this.ctx.net.hostTime() < this.st.tilt[seat]; }

  // ── host: actions ───────────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const now = this.ctx.net.hostTime();
    if (a.k === 'drop') this.hostDrop(pid, seat, a.x, rid, now);
    else this.hostThump(pid, seat, rid, now);
  }

  /** Credits one fate: into the open block of its station, else into that station's tray (capped). */
  private credit(f: Fate): void {
    if (f.lost) return;
    if (this.open[f.st]) this.units[f.st] += f.units;
    else this.hostState.tray[f.st] = Math.min(TRAY_CAP, this.hostState.tray[f.st] + f.units);
  }

  private hostDrop(pid: PlayerId, seat: number, x: number, rid: number, now: number): void {
    if (this.tok[seat] < 1) return;                                   // rate limit: silently ignored
    if (now < this.hostState.tiltAt[seat]) { this.nak(pid, rid, 'm.coinpusher.tilted'); return; }
    if (!this.open[seat]) {
      if (!this.chargeSeat(seat, BLOCK * this.D, pid)) { this.nak(pid, rid, 'm.coinpusher.noFunds'); return; }
      this.open[seat] = true; this.cnt[seat] = 0; this.units[seat] = 0;
    }
    this.tok[seat] -= 1;
    const aim = clamp(x, -1, 1);
    const walls = now < this.hostState.wallsAt;
    const k = knobsFor(this.gov, (h, b) => this.mod(h, b), this.luck(), walls);
    const streak = trackLane(this.hostState.lane, seat as StationIx);   // accepted drops only; same-station run length
    const r = rollDrop(this.hostRng, k, seat as StationIx, aim, streak);
    if (r.kind === 'W') this.hostState.wallsAt = now + Math.max(1, this.mod(HOOK_WALLS, WALLS_S)) * 1000;
    if (r.kind === 'J') this.jack[seat as 0 | 1] = true;

    this.credit(r.coin);
    for (const f of r.fates) this.credit(f);

    this.cnt[seat] += 1;
    this.lastDrop[seat] = now;
    govRecord(this.gov, 1, rollUnits(r));

    const ev: DropEv = {
      k: 'drop', st: seat, x: aim, lost: r.coin.lost ? 1 : 0, to: r.coin.st, u: r.coin.units, gold: r.coin.gold ? 1 : 0,
      gate: r.kind ?? '', prize: r.prize ?? '', wal: r.kind === 'W' ? this.hostState.wallsAt : 0,
      fates: r.fates.map((f): FateTuple => [f.st, f.lost ? 1 : 0, f.units]),
    };
    void this.emit(ev);
    if (this.cnt[seat] >= BLOCK) this.closeBlock(seat, pid);
  }

  /** Settles the open block: pays what it won, the refund of unused coins and any tray money for this station. */
  private closeBlock(seat: number, pid: PlayerId | null = this.seats[seat]): void {
    if (!this.open[seat]) return;
    const n = this.cnt[seat];
    const refund = (BLOCK - n) * this.D;
    const pay = Math.round((this.units[seat] + this.hostState.tray[seat]) * this.D + refund);
    this.hostState.tray[seat] = 0;
    this.open[seat] = false; this.cnt[seat] = 0; this.units[seat] = 0;
    const bet = BLOCK * this.D;
    const tags = this.jack[seat as 0 | 1] ? ['jackpot'] : [];
    this.jack[seat as 0 | 1] = false;
    void this.emit({ k: 'block', st: seat, n, pay, bet, tags }, () => {
      if (pay > 0 && pid !== null) this.paySeat(seat, pay, { bet }, pid);
      else this.forfeit(seat);
    });
  }

  /**
   * THUMP: a safe thump pushes SHOVE_COINS coins off the shelf and adds a heat pip. The thump that would fill the last
   * pip trips the alarm: the station's tray is lost (the governor records the loss) and the station locks for TILT_S.
   */
  private hostThump(pid: PlayerId, seat: number, rid: number, now: number): void {
    if (now < this.hostState.tiltAt[seat]) { this.nak(pid, rid, 'm.coinpusher.tilted'); return; }
    const heat = heatNow(this.hostState.heat[seat], this.hostState.heatT[seat], now);
    if (heat + 1 > THUMP_MAX - 1) {          // the pip that would go past the last safe one trips the alarm
      const lost = this.hostState.tray[seat];
      this.hostState.tray[seat] = 0;
      this.hostState.heat[seat] = 0;
      this.hostState.heatT[seat] = now;
      this.hostState.tiltAt[seat] = now + TILT_S * 1000;
      govRecord(this.gov, 0, -lost);
      this.closeBlock(seat);
      void this.emit({ k: 'tilt', st: seat, until: this.hostState.tiltAt[seat], at: now, lost });
      return;
    }
    const walls = now < this.hostState.wallsAt;
    const k: Knobs = knobsFor(this.gov, (h, b) => this.mod(h, b), this.luck(), walls);
    const fates = rollShove(this.hostRng, k, seat as StationIx);
    let paid = 0;
    for (const f of fates) { this.credit(f); paid += f.units; }
    govRecord(this.gov, 0, paid);                 // shove pays count in the realised return, like drop credits
    this.hostState.heat[seat] = heat + 1;
    this.hostState.heatT[seat] = now;
    void this.emit({
      k: 'thump', st: seat, heat: heat + 1, at: now,
      fates: fates.map((f): FateTuple => [f.st, f.lost ? 1 : 0, f.units]),
    });
  }

  hostTick(dt: number): void {
    const now = this.ctx.net.hostTime();
    for (let s = 0; s < 2; s++) {
      this.tok[s] = Math.min(TRAY_TOKEN_RATE, this.tok[s] + dt * TRAY_TOKEN_RATE);
      if (this.open[s] && now - this.lastDrop[s] >= 10_000) this.closeBlock(s);
      const pid = this.seats[s];
      if (!this.open[s] && pid !== null && !isBot(pid) && this.hostState.tray[s] > 0) {
        const coins = Math.round(this.hostState.tray[s] * this.D);
        this.hostState.tray[s] = 0;
        this.paySeat(s, coins, { bet: coins }, pid);
        void this.emit({ k: 'scav', st: s, coins });
      }
    }
  }

  // ── seats ───────────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      registerDebugForce(this.def.id, (s) => this.debugState(s));
      this.sfx('chime', { vol: 0.5 });
      this.showHud();
    }
    this.parts.chutes[seat].position.x = STATION_X[seat] + this.aim * CHUTE_TRAVEL;
  }

  /**
   * Debug force (bench `--force coinpusher:<state>`, seated): `thump` puts the seated station on one heat pip (the next
   * THUMP is safe), `danger` on THUMP_MAX - 1 (the next THUMP trips the tilt alarm). Host-local, like the other states.
   */
  private debugState(state: string): boolean {
    const pips = state.trim().toLowerCase() === 'danger' ? THUMP_MAX - 1 : state.trim().toLowerCase() === 'thump' ? 1 : -1;
    const s = this.localSeat;
    if (pips < 0 || s < 0 || !this.isHost) return false;
    const now = this.ctx.net.hostTime();
    this.hostState.heat[s] = pips;
    this.hostState.heatT[s] = now;
    this.st.heat[s] = pips;
    this.st.heatT[s] = now;
    this.paintLeds();
    this.showHud();
    return true;
  }

  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost) this.closeBlock(seat, pid);
    this.firing = false;
    this.paintLamps();
    if (local) this.showHud();
  }

  onLang(): void {
    this.paintLeds();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots ───────────────────────────────────────────────────────────────────────────────────────
  getSnapshot(forPid?: PlayerId): Snap {
    const s: St = {
      ...this.st, tilt: [...this.st.tilt], blk: [...this.st.blk], pay: [...this.st.pay], win: [...this.st.win],
      heat: [...this.st.heat], heatT: [...this.st.heatT],
    };
    const host = forPid === undefined;
    return {
      s,
      g: host ? { ...this.gov, acc: [...this.gov.acc], hist: this.gov.hist.map((p): [number, number] => [p[0], p[1]]) } : null,
      h: host ? {
        tray: [...this.hostState.tray], tiltAt: [...this.hostState.tiltAt], wallsAt: this.hostState.wallsAt,
        lane: { ...this.hostState.lane }, heat: [...this.hostState.heat], heatT: [...this.hostState.heatT],
      } : null,
    };
  }

  applySnapshot(sn: Snap): void {
    this.st = {
      ...sn.s, tilt: [...sn.s.tilt], blk: [...sn.s.blk], pay: [...sn.s.pay], win: [...sn.s.win],
      heat: [...(sn.s.heat ?? [0, 0])], heatT: [...(sn.s.heatT ?? [0, 0])],
    };
    if (sn.g) this.gov = { ...sn.g, acc: [...sn.g.acc], hist: sn.g.hist.map((p): [number, number] => [p[0], p[1]]) };
    if (sn.h) {
      this.hostState = {
        tray: [...sn.h.tray], tiltAt: [...sn.h.tiltAt], wallsAt: sn.h.wallsAt, lane: { st: sn.h.lane?.st ?? -1, n: sn.h.lane?.n ?? 0 },
        heat: [...(sn.h.heat ?? [0, 0])], heatT: [...(sn.h.heatT ?? [0, 0])],
      };
    }
    this.paintLeds();
    this.paintLamps();
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'drop': return this.presentDrop(ev, pc);
      case 'block': return this.presentBlock(ev, pc);
      case 'thump': return this.presentThump(ev, pc);
      case 'tilt': return this.presentTilt(ev, pc);
      case 'scav': this.presentScav(ev, pc); return;
    }
  }

  private async presentDrop(ev: DropEv, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const s = ev.st as StationIx;
    this.st.blk[s] = Math.min(BLOCK, this.st.blk[s] + 1);
    p.chutes[s].position.x = STATION_X[s] + ev.x * CHUTE_TRAVEL;
    if (pc.local) this.sfx('click', { vol: 0.35 });
    const slot = FLY_FIRST + (this.flyIx++ % FLY_COUNT);
    const landing = this.cosmeticZ();
    const coinGold = ev.gold === 1;
    await this.flyCoin(slot, p.chutes[s].position.x, landing, ev.lost === 1 ? null : ev.to as StationIx, ev.lost === 1, coinGold, pc.fast);
    if (ev.lost === 1) this.sfx('thud', { vol: 0.25 });
    else {
      this.sfx(coinGold ? 'jackpot' : 'coin', { vol: 0.4 });
      this.st.pay[ev.to as StationIx] += ev.u;
      p.stationLamps[ev.to as StationIx].blink(6, 0.25);
    }
    if (ev.wal > 0) this.st.walls = ev.wal;
    if (ev.prize !== '' || ev.gate !== '') {
      await this.presentBonus(ev, pc);
    }
    if (pc.local) this.showHud();
    this.paintLeds();
  }

  private cosmeticZ(): number { return this.cosmetic.float(-0.12, 0.20); }

  /** One coin: drops from the chute onto the shelf, then slides to its fate (tray, or over the front edge for the gutter). */
  private flyCoin(slot: number, x: number, z: number, to: StationIx | null, lost: boolean, gold: boolean, fast: boolean): Promise<void> {
    const dur = fast ? 0.08 : 0.34;
    const tx = to === null ? x : TRAY_X[to];
    const ty = lost ? 0.42 : TRAY_Y + 0.05;
    const tz = lost ? 0.42 : TRAY_Z;
    this.setCoinColor(slot, gold);
    return this.anim(dur, (k) => {
      let px: number, py: number, pz: number;
      if (k < 0.45) {
        const q = k / 0.45;
        px = x; pz = lerp(0.10, z, q); py = lerp(CHUTE_Y - 0.05, SHELF_Y + 0.01, q * q);
      } else {
        const q = (k - 0.45) / 0.55;
        px = lerp(x, tx, q); pz = lerp(z, tz, q); py = lerp(SHELF_Y + 0.01, ty, q * q) + Math.sin(Math.PI * q) * 0.04;
      }
      this.placeCoin(slot, px, py, pz);
    }).then(() => {
      this.hideCoin(slot);
    });
  }

  private placeCoin(slot: number, x: number, y: number, z: number): void {
    const m = new THREE.Matrix4().makeTranslation(x, y, z);
    this.parts.coins.setMatrixAt(slot, m);
    this.parts.coins.instanceMatrix.needsUpdate = true;
  }

  private hideCoin(slot: number): void {
    this.parts.coins.setMatrixAt(slot, new THREE.Matrix4().makeScale(0, 0, 0));
    this.parts.coins.instanceMatrix.needsUpdate = true;
  }

  private setCoinColor(slot: number, gold: boolean): void {
    const c = this.parts.coins;
    c.setColorAt(slot, new THREE.Color(gold ? GOLD : BRASS));
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
  }

  /** Lucky gate: reels spin, stop on the symbol of the outcome, then the effect plays out. */
  private async presentBonus(ev: DropEv, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const s = ev.st as StationIx;
    const kind = ev.gate;
    if (kind !== '') {
      p.stationLamps[s].blink(10, 1.0);
      if (pc.local) this.toast(tr(`m.coinpusher.${kind === 'S' ? 'sS' : kind === 'L' ? 'sL' : kind === 'W' ? 'sW' : kind === 'P' ? 'sP' : 'sJ'}`), 'good');
      p.bonusReels.forEach((r) => r.startSpin(12));
      this.sfx('reelStart', { vol: 0.6 });
      await this.wait(0.8);
      const sym = GATE_SYMBOL[kind] ?? 'blank';
      const idx = Math.max(0, REEL_SYMBOLS.indexOf(sym));
      await Promise.all(p.bonusReels.map((r, i) => this.wait(0.2 * i).then(() => r.stopAt(idx, 0.35, 0.1))));
      this.sfx('reelStop', { vol: 0.7 });
    }
    if (kind === 'S' || kind === 'L' || kind === 'J') {
      this.sfx('coinShower', { vol: 0.6 });
      const pieces = ev.fates.filter((f) => f[2] > 0 || f[1] === 1).slice(0, SHOWER_WAVE * 3);
      for (let i = 0; i < pieces.length; i += SHOWER_WAVE) {
        const wave = pieces.slice(i, i + SHOWER_WAVE);
        await Promise.all(wave.map((f, j) => this.flyCoin(FLY_FIRST + j, this.cosmeticShowerX(), this.cosmeticZ(),
          f[1] === 1 ? null : f[0] as StationIx, f[1] === 1, false, pc.fast)));
      }
    }
    if (kind === 'J') {
      p.goldenPlate.visible = true;
      p.goldenPlate.position.set(0, SHELF_Y + 0.01, 0.02);
      await this.anim(pc.fast ? 0.1 : 0.6, (k) => {
        p.goldenPlate.position.set(lerp(0, TRAY_X[s], k), lerp(SHELF_Y + 0.01, TRAY_Y + 0.06, k * k) + Math.sin(Math.PI * k) * 0.1, lerp(0.02, TRAY_Z, k));
      });
      p.goldenPlate.visible = false;
    }
    if (kind === 'P') {
      const pi = Math.min(p.prizes.length - 1, Math.floor(this.cosmetic.next() * p.prizes.length));
      p.prizes[pi].visible = false;
      const tierIx = ev.prize === 'common' ? 0 : ev.prize === 'uncommon' ? 1 : 2;
      if (pc.local && ev.prize !== '') this.toast(tr(`m.coinpusher.${PRIZE_TIER_ICON[tierIx]}`), 'good');
    }
    if (kind !== '') {
      const tier = GATE_JUICE[kind] ?? 'small';
      if (pc.local && !pc.fast) await this.celebrate(tier === 'jackpot' ? 'jackpot' : tier === 'medium' ? 'medium' : 'small');
    }
    if (kind === 'W') this.sfx('whoosh', { vol: 0.6 });
    if (kind !== '') p.stationLamps[s].setOn(true);
  }

  private cosmeticShowerX(): number { return this.cosmetic.float(-0.42, 0.42); }

  private async presentBlock(ev: Extract<Ev, { k: 'block' }>, pc: PresentCtx): Promise<void> {
    const s = ev.st as StationIx;
    this.st.blk[s] = 0;
    this.st.win[s] = ev.pay;
    this.st.pay[s] = 0;
    this.paintLeds();
    if (!pc.local) return;
    this.showHud();
    if (ev.pay <= 0) { this.commiserate(); return; }
    const tier = juiceTier(ev.pay, ev.bet, ev.tags);
    void this.pourCoins(Math.min(40, Math.round(ev.pay / Math.max(1, this.D))));
    if (tier !== 'none' && tier !== 'push' && !pc.fast) await this.celebrate(tier);
  }

  /** A thump: the shelf kicks, a few coins are shoved off into the trays, and the station's meter steps up. */
  private async presentThump(ev: Extract<Ev, { k: 'thump' }>, pc: PresentCtx): Promise<void> {
    const s = ev.st as StationIx;
    this.st.heat[s] = ev.heat;
    this.st.heatT[s] = ev.at;
    this.kick = 1;
    this.sfx('thud', { vol: 0.8 });
    if (ev.heat > THUMP_MAX - 2) this.parts.tiltLamp.blink(4, 0.25);   // the next thump trips the alarm
    this.paintLeds();
    if (pc.local) this.showHud();
    const w = this.parts.pusher.getWorldPosition(new THREE.Vector3());
    this.ctx.fx.popText([w.x, w.y + 0.12, w.z], tr('m.coinpusher.heat', { n: ev.heat, m: THUMP_MAX }), 0xffb040, { scale: 0.9 });
    const pieces = ev.fates.slice(0, FLY_COUNT);
    if (!pc.fast && pieces.length > 0) {
      await Promise.all(pieces.map((f, j) => this.flyCoin(FLY_FIRST + j, this.cosmeticShowerX(), this.cosmeticZ(),
        f[1] === 1 ? null : f[0] as StationIx, f[1] === 1, false, pc.fast)));
    }
    for (const f of ev.fates) if (f[1] === 0) this.st.pay[f[0] as StationIx] += f[2];
    if (pc.local) this.showHud();
  }

  private async presentTilt(ev: Extract<Ev, { k: 'tilt' }>, pc: PresentCtx): Promise<void> {
    this.st.tilt[ev.st] = ev.until;
    this.st.blk[ev.st] = 0;
    this.st.pay[ev.st] = 0;
    this.st.heat[ev.st] = 0;
    this.st.heatT[ev.st] = ev.at;
    this.parts.tiltLamp.blink(6, 3.0);
    this.sfx('buzzer', { vol: 0.8 });
    this.ctx.ui.flash('#ff3030', 0.35);
    if (pc.local) { this.toast(tr('m.coinpusher.tilt', { n: TILT_S, lost: fmtCoins(ev.lost * this.D) }), 'warn'); this.showHud(); }
    this.paintLeds();
  }

  /** Current heat pips of a station (cooled to the host clock). */
  private heatOf(s: number): number { return heatNow(this.st.heat[s], this.st.heatT[s], this.ctx.net.hostTime()); }
  /** Pips drawn for a station: a partly cooled pip still shows, so a shown pip count of THUMP_MAX - 1 or more is the danger zone. */
  private pipsOf(s: number): number { return Math.min(THUMP_MAX, Math.ceil(this.heatOf(s) - 1e-6)); }

  private presentScav(ev: Extract<Ev, { k: 'scav' }>, pc: PresentCtx): void {
    if (!pc.local) return;
    this.sfx('coinShower', { vol: 0.5 });
    void this.pourCoins(Math.min(40, Math.max(1, Math.round(ev.coins))));
    this.toast(tr('m.coinpusher.scav', { n: fmtCoins(ev.coins) }), 'sys');
  }

  // ── per-frame visuals ───────────────────────────────────────────────────────────────────────────────
  frame(dt: number, _t: number): void {
    const p = this.parts;
    this.clock += dt;
    this.kick = Math.max(0, this.kick - dt * 2.2);
    const ph = (this.clock / 2.4) * Math.PI * 2;
    // a thump: the pusher drives forward and back over ~0.45 s (kick runs 1 → 0, the jolt peaks at the middle)
    const jolt = this.kick > 0 ? Math.sin(Math.PI * (1 - this.kick)) : 0;
    p.pusher.position.z = -0.15 + 0.06 * Math.sin(ph) + SHOVE_JOLT * jolt;
    p.gate.rotation.z += dt * Math.PI * 2 * 0.25;
    const up = this.ctx.net.hostTime() < this.st.walls ? 1 : 0;
    this.wallsK = lerp(this.wallsK, up, 1 - Math.exp(-dt * 8));
    const k = Math.max(0.0001, this.wallsK);
    p.walls[0].scale.y = k;
    p.walls[1].scale.y = k;
    // the heat meter cools with the clock: repaint the screens and the HUD when a whole pip steps down
    for (let s = 0; s < 2; s++) {
      const pips = this.pipsOf(s);
      if (pips !== this.heatShown[s]) {
        this.heatShown[s] = pips;
        this.paintLeds();
        if (this.localSeat === s) this.showHud();
      }
    }
  }

  // ── visuals: pile, lamps, screens, HUD ──────────────────────────────────────────────────────────────
  /** Fixed restock pile: the first PILE_START coin slots lie on the shelf (cosmetic gauge). */
  private paintPile(): void {
    const c = this.parts.coins;
    const m = new THREE.Matrix4();
    const n = Math.min(PILE_START, PILE_SLOTS);
    for (let i = 0; i < n; i++) {
      const [x, z] = pileXZ(i);
      m.makeTranslation(x, SHELF_Y + 0.002, z);
      c.setMatrixAt(i, m);
    }
    c.instanceMatrix.needsUpdate = true;
  }

  private paintLamps(): void {
    this.parts.stationLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
  }

  private paintLeds(): void {
    const p = this.parts;
    const screens = [p.leds.L, p.leds.R] as const;
    screens.forEach((scr, s) => {
      const heat = this.pipsOf(s);
      scr.draw((g, sc) => {
        sc.clear('#070707');
        sc.text(tr('m.coinpusher.ledBet', { n: BLOCK * this.D }), 10, 24, { font: 'vt', size: 26, color: '#ffd040' });
        sc.text(tr('m.coinpusher.ledCredit', { n: this.st.blk[s] }), 10, 50, { font: 'vt', size: 26, color: '#7fe6ff' });
        sc.text(tr('m.coinpusher.ledWin', { n: this.st.win[s] }), 150, 50, { font: 'vt', size: 26, color: '#9cff8a' });
        // THUMP meter: one pip per heat level; the pip after the last filled one is where the alarm waits
        sc.text(tr('m.coinpusher.ledThump'), 130, 24, { font: 'vt', size: 26, color: '#ff9a6a' });
        for (let i = 0; i < THUMP_MAX; i++) {
          g.fillStyle = i < heat ? (heat >= THUMP_MAX - 1 ? '#ff3a2a' : '#ffb040') : '#2a2a2a';
          g.fillRect(200 + i * 14, 10, 10, 14);
        }
      });
    });
  }

  private showHud(): void {
    const s = this.localSeat;
    if (s < 0) return;
    const now = this.ctx.net.hostTime();
    const hints: HudHint[] = [
      { action: 'primary', label: tr('m.coinpusher.hintDrop') },
      { action: 'left', label: tr('m.coinpusher.hintAim') },
      { action: 'fast', label: tr('m.coinpusher.hintThump') },
      { action: 'help', label: tr('m.coinpusher.hintInfo') },
      { action: 'exit', label: tr('m.coinpusher.hintLeave') },
    ];
    const stats: Array<{ label: string; value: string }> = [{ label: tr('m.coinpusher.block', { n: this.st.blk[s] }), value: '' }];
    const heat = this.pipsOf(s);
    stats.push({ label: tr('m.coinpusher.heat', { n: heat, m: THUMP_MAX }), value: '' });
    if (heat >= THUMP_MAX - 1) stats.push({ label: tr('m.coinpusher.tiltRisk'), value: '' });
    if (now < this.st.tilt[s]) stats.push({ label: tr('m.coinpusher.tiltTimer', { n: Math.ceil((this.st.tilt[s] - now) / 1000) }), value: '' });
    this.hud({ bet: BLOCK * this.D, hints, stats });
  }

}
