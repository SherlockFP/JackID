/**
 * Plinko Board (`plinko`) — MACHINES_machines §9, Tier 2, solo. Pattern: `coinflip/index.ts`.
 *
 * What it demonstrates
 *  - logic / present split: `drop()` rolls on the authority (the local occupant) with the pure `rules.ts`, packs the
 *    FULL outcome (every puck's bits, slot and multiplier) into one event and `emit`s it; `presentDrop()` plays it on
 *    every peer. Pucks are animated along the peg grid, so the path always ends where the bits say;
 *  - settle-before-present: the wallet is credited in the `credit` step, before the show is queued;
 *  - money: the exact float payout goes through `roundPayout` with a per-instance dust carry (unbiased for 1-coin
 *    stakes); the per-puck stake is debited once per drop (actionCost 1);
 *  - charms: `luck` (Rubber Pegs), `m.plinko.goldenSlot`, `x.plinko.extraPuck` (Glass Funnel), `m.plinko.edgeMult`,
 *    `m.plinko.safetyFloor`;
 *  - juice: anticipation (chute, marquee race, golden slot shown), the drop with a peg ping per row on a pentatonic
 *    scale and a flash on each peg, a landing thud and slot lamp, tiered win show, HIGH edge alarm (red chase + siren);
 *  - instanced parts (pegs, fingers, pucks, slot lamps) updated through matrices and instance colours;
 *  - `playHeadless` (shared rules) for staff auto-play and the bench "Sim" button.
 *
 * Controls: 1 / 2 / 3 risk LOW / MID / HIGH · Space drop · ↑ / ↓ pucks · wheel / Z / X stake · H help · E leave.
 * Round life-cycle: `beginRound(stake × pucks)` → `emit(drop, credit)` → `settle(gross)` → present → release.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { Kit } from '@/kit/types';
import { fmtCoins, t, type I18nVars } from '@/core/i18n';
import { lerp, TAU } from '@/core/math';
import { buildModel, pegX, pegY, slotX, FUNNEL_Y, LAND_Y, ROWS, DX, RISK_ANGLE, type PlinkoParts } from './model';
import {
  HOOK_EDGE, HOOK_EXTRA, HOOK_FLOOR, HOOK_GOLDEN, MAX_EXTRA, MAX_MULT, RISK_KEYS, RTP, SLOTS,
  baseMult, clampPucks, clampRisk, playHeadless, roundPayout, rollDrop, type DropOpts, type Risk,
} from './rules';

export { playHeadless };

type PuckEv = { bits: number; slot: number; mult: number; golden: boolean; free: boolean; delayMs: number };
type DropEv = {
  risk: number; stake: number; paid: number; goldenSlot: number; pucks: PuckEv[];
  gross: number; bet: number; edge: boolean; tags: string[];
};
type Ev = { k: 'cfg'; risk: number; pucks: number } | ({ k: 'drop' } & DropEv);
type State = { risk: number; pucks: number; hist: number[] };

const HIST = 12;
const GOLD = 0xffd040;
const RED = 0xff2020;
const DIM = 0x1e1e1e;
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // C major pentatonic, semitones above C5
const HOP_S = 0.2;                                        // one hop (and the final settle), seconds

/** Plate / lamp / LED colour of a multiplier (MACHINES §9.1). */
export function colourFor(m: number): number {
  if (m >= 10) return 0xff2020;
  if (m >= 2) return 0xff9020;
  if (m >= 1) return 0xffe040;
  return 0x808080;
}

/** Peg ping pitch for a row: row 1 = C7 (top), row 12 = C5 (bottom), quantised to the pentatonic scale. */
export function pingSemitones(row: number): number {
  const target = 24 - ((row - 1) * 24) / (ROWS - 1);
  return PENT.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), PENT[0]);
}

/**
 * Peg-grid path of one puck: start at the funnel, one point per peg hit (row k, index 1 + rights so far), then the
 * slot. Consecutive points differ by ±0.04 in x and 0.09 in y, so the path is exactly the bounce sequence.
 */
export function pathPoints(bits: number, slot: number): THREE.Vector3[] {
  const pts = [new THREE.Vector3(0, FUNNEL_Y, 0)];
  let rights = 0;
  for (let h = 0; h < ROWS; h++) {
    pts.push(new THREE.Vector3(pegX(h + 1, 1 + rights), pegY(h + 1), 0));
    rights += (bits >> h) & 1;
  }
  pts.push(new THREE.Vector3(slotX(slot), LAND_Y, 0));
  return pts;
}

export const def: MachineDef = {
  id: 'plinko',
  category: 'physics',
  slotSize: 'M',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 100, betSteps: [1, 2, 5, 10, 20, 50, 100],   // per puck
  maxPayoutMult: MAX_MULT * (1 + MAX_EXTRA),                       // one paid puck + 3 free extras, all edge + golden
  rtp: RTP[0],
  tier: 2,
  actionCost: 1,                                                   // per drop, not per puck
  idleYield: 0.18,
  headless: playHeadless,
  tags: ['solo', 'physics', 'pegs'],
  modHooks: {
    luck: 'Rubber Pegs: each luck point gives 1 % per row (cap 20 %) that a puck repeats its previous direction.',
    'm.plinko.goldenSlot': 'Chance per drop that one random slot shows ×2 (revealed before the drop). Base 0.',
    'x.plinko.extraPuck': `Free extra pucks per drop, same stake, not debited (cap ${MAX_EXTRA}). Base 0.`,
    'm.plinko.edgeMult': 'Multiplier on the edge slots 0 and 12. Base 1.',
    'm.plinko.safetyFloor': 'Every multiplier below this value is raised to it. Base 0.',
  },
  strings: {
    en: {
      name: 'Plinko Board',
      desc: 'Drop pucks down the brass pegs. Edge slots pay the most, the centre pays the least. Golden slots double.',
      drop: 'Drop', risk: 'Risk', low: 'LOW', mid: 'MID', high: 'HIGH', pucks: 'Pucks {n}', stake: 'Stake {n}',
      hintDrop: 'Drop', hintRisk: 'Risk', hintPucks: 'Pucks', hintStake: 'Stake',
      golden: 'GOLD ×2', edge: 'EDGE', win: 'WIN {n}', last: 'LAST', bet: 'BET {n}', credit: 'CREDIT',
      extra: '+{n} FREE', multLabel: '×{n}', lost: 'Nothing this time',
      busy: 'Pucks are still falling', chaseEdge: 'EDGE!', potLabel: 'Bet',
    },
    tr: {
      name: 'Plinko Çivi Tahtası',
      desc: 'Pirinç çivilerin arasına top bırak. Kenar gözler en çok öder, orta en az. Altın gözler ikiye katlar.',
      drop: 'Bırak', risk: 'Risk', low: 'DÜŞÜK', mid: 'ORTA', high: 'YÜKSEK', pucks: 'Top {n}', stake: 'Bahis {n}',
      hintDrop: 'Bırak', hintRisk: 'Risk', hintPucks: 'Top', hintStake: 'Bahis',
      golden: 'ALTIN ×2', edge: 'KENAR', win: 'KAZANÇ {n}', last: 'SON', bet: 'BAHİS {n}', credit: 'KREDİ',
      extra: '+{n} BEDAVA', multLabel: '×{n}', lost: 'Bu sefer olmadı',
      busy: 'Toplar hâlâ düşüyor', chaseEdge: 'KENAR!', potLabel: 'Bahis',
    },
  },
};

export default class Plinko extends MachineBase<PlinkoParts, Ev, State> {
  private state: State = { risk: 0, pucks: 1, hist: [] };
  /** Authority-side fractional payout carried between drops (per machine instance). */
  private dust = 0;
  private readonly dummy = new THREE.Object3D();
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). */
  private seatHud?: SeatHud;

  protected createModel(kit: Kit): MachineModel<PlinkoParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    const pegs = this.parts.pegs;
    if (!pegs.instanceColor) pegs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pegs.count * 3).fill(1), 3);
    this.refresh();
    this.idleChase();
    this.attractor.every('sweep', 6, () => this.lampSweep(), { first: 3 });
  }

  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    this.idleChase();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip(this.def.id, this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) this.seatHud?.hide();
    this.refresh();
    this.idleChase();
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet && a !== 'up' && a !== 'down') return;
    switch (a) {
      case 'n1': this.setRisk(0); break;
      case 'n2': this.setRisk(1); break;
      case 'n3': this.setRisk(2); break;
      case 'primary': case 'confirm': void this.drop(); break;
      case 'up': this.setPucks(this.state.pucks + 1); break;
      case 'down': this.setPucks(this.state.pucks - 1); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen || this.busy) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private setRisk(r: number): void {
    if (this.busy || this.roundOpen || this.state.risk === r) return;
    void this.emit({ k: 'cfg', risk: clampRisk(r), pucks: this.state.pucks });
  }

  private setPucks(n: number): void {
    const p = clampPucks(n);
    if (this.busy || this.roundOpen || p === this.state.pucks) return;
    void this.emit({ k: 'cfg', risk: this.state.risk, pucks: p });
  }

  // ── authority-side logic: runs only on the local occupant ──────────────────────────────────────
  private opts(risk: number, stake: number, paid: number): DropOpts {
    return {
      risk: clampRisk(risk), stake, pucks: paid, luck: this.luck(),
      goldenChance: this.mod(HOOK_GOLDEN, 0), extra: this.mod(HOOK_EXTRA, 0),
      edgeMult: this.mod(HOOK_EDGE, 1), floor: this.mod(HOOK_FLOOR, 0),
    };
  }

  private async drop(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    const risk = this.state.risk, paid = this.state.pucks, stake = this.bet;
    if (!this.beginRound(stake * paid)) return;               // charges the wallet, busy = true, re-seeds this.rng
    this.showHud();
    const roll = rollDrop(this.rng, this.opts(risk, stake, paid));
    const { gross, carry } = roundPayout(roll.exact, this.dust);
    this.dust = carry;
    const ev: { k: 'drop' } & DropEv = {
      k: 'drop', risk: roll.risk, stake, paid, goldenSlot: roll.goldenSlot,
      pucks: roll.pucks.map((p) => ({ bits: p.bits, slot: p.slot, mult: p.mult, golden: p.golden, free: p.free, delayMs: p.delayMs })),
      gross, bet: stake * paid, edge: roll.edge, tags: roll.tags,
    };
    // Settle-before-present (DECISIONS G): the payout is credited before the show is queued.
    const credit = (): void => { this.settle({ gross, tags: roll.tags }); this.busy = true; };
    try {
      const shown = this.emit(ev, credit);
      if (this.roundOpen) credit();                             // emit refused: still pay out, never strand the stake
      await shown;
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  // ── present: every peer, including the emitter ──────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'cfg') return this.presentCfg(ev);
    return this.presentDrop(ev, pc);
  }

  private presentCfg(ev: Extract<Ev, { k: 'cfg' }>): void {
    this.state.risk = ev.risk;
    this.state.pucks = ev.pucks;
    this.sfx('ratchet');
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentDrop(ev: { k: 'drop' } & DropEv, pc: PresentCtx): Promise<void> {
    const { marquee, chute, riskSwitch } = this.parts;
    const s = this.state;
    s.risk = ev.risk; s.pucks = ev.paid;
    s.hist = [...ev.pucks.map((p) => p.slot).reverse(), ...s.hist].slice(0, HIST);
    riskSwitch.rotation.x = RISK_ANGLE[ev.risk];
    this.paintPlates(ev.risk);

    if (pc.fast) {                                              // lagging queue: final state, no show
      this.hidePucks();
      this.refresh();
      return;
    }

    // 1. anticipation: the chute loads a cosmetic insert, the marquee races, the golden slot shows before the drop
    marquee.chase('chase', 9);
    this.sfx('button');
    if (ev.goldenSlot >= 0) this.setLamp(ev.goldenSlot, GOLD);
    const cx = this.cosmetic.float(-0.4, 0.4);
    await this.anim(0.22, (k) => {
      chute.position.x = lerp(0, cx, k);
      chute.position.y = 2.2 - 0.012 * Math.sin(k * Math.PI);
    }, 'outQuad');
    if (this.disposed) return;
    this.sfx('ballDrop', { vol: 0.6 });

    // 2. the drop: every puck flies its own path, staggered by delayMs
    await Promise.all(ev.pucks.map((p, i) => this.flyPuck(i, p)));
    if (this.disposed) return;
    void this.anim(0.18, (k) => { chute.position.x = lerp(cx, 0, k); chute.position.y = 2.2; }, 'inQuad');

    // 3. verdict
    await this.verdict(ev);
    if (!this.disposed) { this.refresh(); this.idleChase(); }
  }

  private async flyPuck(i: number, p: PuckEv): Promise<void> {
    const pts = pathPoints(p.bits, p.slot);
    const spin = (p.bits & 1 ? 1 : -1) * TAU * 1.5;
    this.placePuck(i, pts[0], 1, 0);
    await this.wait(p.delayMs / 1000);
    if (this.disposed) return;
    for (let h = 0; h < pts.length - 1; h++) {
      const a = pts[h], b = pts[h + 1];
      const last = h === pts.length - 2;
      await this.anim(HOP_S, (k) => {
        const bounce = last ? 0 : 0.012 * Math.sin(k * Math.PI);
        this.placePuck(i, new THREE.Vector3(lerp(a.x, b.x, k), lerp(a.y, b.y, k) + bounce, 0), 1, spin * k);
      }, last ? 'outBounce' : 'linear');
      if (this.disposed) return;
      if (!last) this.pegHit(h + 1, b);
    }
    this.placePuck(i, pts[pts.length - 1], 1, 0);
    this.landed(p);
    void this.wait(0.7).then(() => { if (!this.disposed) this.hidePuck(i); });
  }

  /** One peg hit: ping on the row's pentatonic note, a flash on the peg (or a twitch on a finger). */
  private pegHit(row: number, at: THREE.Vector3): void {
    const j = Math.round((at.x + ((row + 1) * DX) / 2) / DX);
    this.flashPeg(row, j);
    this.sfx('ballBounce', { vol: 0.35, pitch: pingSemitones(row), param: 0.5 });
  }

  private flashPeg(k: number, j: number): void {
    const { pegs, pegSlot, fingerSpots, fingers } = this.parts;
    const idx = pegSlot[k * 16 + j];
    if (idx < 0) {                                              // porcelain finger: twitch ±10°
      const fi = fingerSpots.findIndex(([a, b]) => a === k && b === j);
      if (fi < 0) return;
      const d = this.dummy;
      void this.anim(0.3, (x) => {
        d.position.set(pegX(k, j), pegY(k), 0);
        d.rotation.set(0, 0, Math.sin(x * Math.PI * 3) * (10 * Math.PI / 180) * (1 - x));
        d.updateMatrix();
        fingers.setMatrixAt(fi, d.matrix);
        fingers.instanceMatrix.needsUpdate = true;
      });
      return;
    }
    const ic = pegs.instanceColor as THREE.InstancedBufferAttribute | null;
    if (!ic) return;
    ic.setXYZ(idx, 1, 0.85, 0.3); ic.needsUpdate = true;        // emissive pulse: gold tint
    void this.wait(0.15).then(() => { if (!this.disposed) { ic.setXYZ(idx, 1, 1, 1); ic.needsUpdate = true; } });
  }

  private landed(p: PuckEv): void {
    this.setLamp(p.slot, colourFor(p.mult));
    this.sfx('thud', { vol: 0.5 });
    if (p.mult >= 2 || p.golden) {
      this.ctx.fx.popText(this.parts.slotLamps, `×${p.mult}`, p.golden ? GOLD : colourFor(p.mult), { dur: 0.9, rise: 0.25, scale: 0.9 + 0.1 * p.mult });
    }
  }

  private async verdict(ev: { k: 'drop' } & DropEv): Promise<void> {
    const { marquee } = this.parts;
    const tier = juiceTier(ev.gross, ev.bet, ev.tags);
    const net = ev.gross - ev.bet;
    if (this.isLocalOccupant) this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
    this.drawLeds(ev.gross);
    if (ev.edge && ev.risk === 2) void this.edgeAlarm();
    if (ev.gross > 0) {
      if (tierAtLeast(tier, 'medium')) {
        await this.celebrate(tier, { amount: ev.gross, marquee, restore: () => this.idleChase() });
      } else {
        await this.pourCoins(ev.gross, { bet: ev.bet, onCount: (v) => this.drawLeds(v) });
      }
    } else {
      this.commiserate({ amount: ev.bet, at: this.model.anchors.label });
      marquee.chase('blink', 1.5);
      await this.wait(0.35);
    }
  }

  /** HIGH edge: board-wide red chase at 10 Hz for 3 s with a siren. Fire and forget. */
  private edgeAlarm(): void {
    this.sfx('jackpotSiren', { vol: 0.5 });
    this.ctx.fx.glow(this.model.anchors.label, RED, 0.5, 1.2);
    void this.anim(3, (k) => {
      const on = Math.floor(k * 30) % 2 === 0;
      for (let s = 0; s < SLOTS; s++) this.setLamp(s, on ? RED : null);
    }, 'linear').then(() => { if (!this.disposed) this.refresh(); });
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  private placePuck(i: number, pos: THREE.Vector3, scale: number, rotZ: number): void {
    const d = this.dummy;
    d.position.copy(pos);
    d.rotation.set(0, 0, rotZ);
    d.scale.setScalar(scale);
    d.updateMatrix();
    this.parts.pucks.setMatrixAt(i, d.matrix);
    this.parts.pucks.instanceMatrix.needsUpdate = true;
  }

  private hidePuck(i: number): void {
    this.placePuck(i, new THREE.Vector3(0, FUNNEL_Y + 0.2, 0), 0, 0);
  }

  private hidePucks(): void {
    for (let i = 0; i < this.parts.pucks.count; i++) this.hidePuck(i);
  }

  /** Slot lamp `s`: on with `hex`, off when `hex` is null (dim). Instance colour, one upload. */
  private setLamp(s: number, hex: number | null): void {
    const ic = this.parts.slotLamps.instanceColor as THREE.InstancedBufferAttribute | null;
    if (!ic) return;
    const c = new THREE.Color(hex ?? DIM);
    ic.setXYZ(s, c.r, c.g, c.b);
    ic.needsUpdate = true;
  }

  private lampSweep(): void {
    if (this.busy || this.occupant !== null) return;
    void this.anim(0.8, (k) => {
      const at = Math.min(SLOTS - 1, Math.floor(k * SLOTS));
      for (let s = 0; s < SLOTS; s++) this.setLamp(s, s === at ? GOLD : null);
    }).then(() => { if (!this.disposed) this.refresh(); });
  }

  private idleChase(): void {
    this.parts.marquee.chase('chase', this.occupant !== null ? 5 : 3);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const s = this.state;
    this.parts.riskSwitch.rotation.x = RISK_ANGLE[s.risk];
    for (let i = 0; i < SLOTS; i++) this.setLamp(i, null);
    if (s.hist.length) this.setLamp(s.hist[0], colourFor(baseMult(s.risk as Risk, s.hist[0])));
    this.paintPlates(s.risk);
    this.drawLeds();
    this.hidePucks();
  }

  /**
   * The 13 multiplier plates, one 416 × 160 canvas (base table for the risk; charms are not shown). A slot is only ~7 low-res
   * pixels wide from the seat, so the labels sit in three staggered rows (slot % 3), 3 slots wide each, as 11 cm tall bold
   * figures (the 5 x 7 bitmap face is too small at this distance); the lamp band runs along the bottom.
   */
  private paintPlates(risk: number): void {
    const r = clampRisk(risk) as Risk;
    this.parts.slotPlates.draw((g, sc) => {
      g.fillStyle = '#120a04'; g.fillRect(0, 0, sc.w, sc.h);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      for (let s = 0; s < SLOTS; s++) {
        const m = baseMult(r, s);
        const x = s * 32 + 16, y0 = 2 + (s % 3) * 46;
        const col = '#' + (m < 1 ? 0xd0d0d0 : colourFor(m)).toString(16).padStart(6, '0');
        g.fillStyle = '#000000';
        g.fillRect(x - 48, y0, 96, 44);
        g.fillStyle = col;                                          // light figures on a dark cell: thin strokes survive the dither far better than dark on bright
        g.fillRect(x - 48, y0, 96, 3); g.fillRect(x - 48, y0 + 41, 96, 3);
        g.save(); g.translate(x, y0 + 24); g.scale(0.85, 1);
        g.font = 'bold 58px Arial, Helvetica, sans-serif';   // i18n-ok: CSS font
        g.lineWidth = 4; g.strokeStyle = col; g.strokeText(String(m), 0, 0); g.fillText(String(m), 0, 0);
        g.restore();
      }
    });
  }

  /** 160 × 32 LED strip: BET / WIN on top, the last twelve landings as coloured squares below. */
  private drawLeds(winShown?: number): void {
    const s = this.state;
    const bet = this.roundOpen ? this.roundBet : this.bet * s.pucks;
    this.parts.leds.draw((g, sc) => {
      g.fillStyle = '#080808'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(this.t('credit'), 4, 3, { font: 'px5', color: '#ff3020' });
      sc.text(this.t('bet', { n: fmtCoins(bet) }), 4, 12, { font: 'px5', color: '#ff3020' });
      sc.text(winShown !== undefined ? this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(winShown, this.src, { bet }) : winShown) }) : this.t('last'), 96, 12, { font: 'px5', color: '#ffd040' });
      s.hist.forEach((slot, i) => {
        g.fillStyle = '#' + colourFor(baseMult(s.risk as Risk, slot)).toString(16).padStart(6, '0');
        g.fillRect(4 + i * 12, 22, 8, 8);
      });
    });
  }

  /** Seat HUD: goal, phase banner, key numbers and the valid controls only. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const live = this.roundOpen || this.busy;
    const risk = this.t(RISK_KEYS[clampRisk(s.risk)]);
    sh.goal(this.tx('goal'));
    if (live) sh.state(this.tx('stFall'), 'cyan');
    else sh.state(this.tx('stReady'), 'gold', this.tx('stReadySub', { risk }));
    sh.numbers([
      { label: this.tx('nBet'), value: fmtCoins(live ? this.roundBet : this.bet * s.pucks), tone: 'gold' },
      { label: this.tx('nPucks'), value: String(s.pucks), tone: 'cyan' },
      { label: this.tx('nRisk'), value: risk, tone: 'neutral' },
      { label: this.tx('nLast'), value: s.hist.length ? `×${baseMult(s.risk as Risk, s.hist[0])}` : '-', tone: 'good' },
      { label: this.tx('nBalance'), value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
    ]);
    const ctrl: HudControl[] = [];
    if (!live) {
      ctrl.push({ key: this.k('primary'), label: this.tx('cDrop'), action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('up')}/${this.k('down')}`, label: this.tx('cPucks'), action: 'up' });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n3')}`, label: this.tx('cRisk'), action: 'n1' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: this.tx('cStake'), action: 'betUp' });
    }
    ctrl.push({ key: this.k('help'), label: this.tx('cRules'), action: 'help' });
    ctrl.push({ key: this.k('exit'), label: this.tx('cLeave'), action: 'exit' });
    sh.controls(ctrl);
  }

  // ── seat HUD helpers ────────────────────────────────────────────────────────────────────────────
  private tx(key: string, v?: I18nVars): Txt { return v ? { k: `m.${this.def.id}.${key}`, v } : { k: `m.${this.def.id}.${key}` }; }
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private tipLines(): Txt[] {
    return [
      this.tx('tip1', { risk: `${this.k('n1')}-${this.k('n3')}`, pucks: `${this.k('up')}/${this.k('down')}` }),
      this.tx('tip2', { drop: this.k('primary') }),
      this.tx('tip3', { help: this.k('help') }),
    ];
  }
  private rulesLines(): Txt[] {
    return [this.tx('rule1'), this.tx('rule2'), this.tx('rule3'), this.tx('rule4', { keys: `${this.k('betDown')}/${this.k('betUp')}` }), this.tx('rule5')];
  }

  // ── late join / save ────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, hist: [...this.state.hist] };
  }
  applySnapshot(s: State): void {
    this.state = { risk: clampRisk(s.risk), pucks: clampPucks(s.pucks), hist: [...s.hist] };
    this.refresh();
  }
}
