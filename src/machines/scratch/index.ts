/**
 * Scratch-Card Vendor (`scratch`) — Tier 1, solo. Pattern: `coinflip/index.ts`.
 *
 * Flow. VEND (1–5 cards of one type, paid up front as one round) → the cards slide out, one by one → SCRATCH (drag
 * the coin over the active card: strokes, zones reveal at ≥ 55 % cleared; Space = sweep the active card) → REVEAL
 * (a card is done when every zone is open) → SETTLE (the whole batch pays once, credited BEFORE the last reveal is
 * presented). Leaving with cards left auto-sweeps them and settles.
 *
 * Authority (the local occupant) rolls every card at vend (`rules.rollCard`) and drives the scratching: it emits
 * `stroke` (cosmetic), `zone` (reliable, a zone opened) and `done` (a card finished). Every peer presents them.
 *
 * Controls: 1–5 card type · ← / → cycle type · wheel / Z / X quantity 1–5 · Space / Enter vend, or sweep the active
 * card when one is scratching · LMB drag scratch · H prize tables · Leave (exit) auto-sweeps and settles.
 */
import type * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtCoins, t } from '@/core/i18n';
import { buildModel, CARD_Y, FRONT_Z, SLOT_X, SLOT_Z, type ScratchParts } from './model';
import {
  CARD_COUNT, HOOK_CHARM, HOOK_DISCOUNT, HOOK_SECOND, HOOK_TOP, MAX_QTY, PRIZE_MULTS, PRIZE_WEIGHTS,
  RARITY_RARE, RARITY_UNCOMMON, SECOND_CHANCE_EVERY, WEIGHT_TOTAL, ZONE_REVEAL, playHeadless, priceOf, rollCard,
  type Card, type CardOpts,
} from './rules';
import { FACE_H, FACE_W, brush, clearedFraction, paintFace, paintFoil, zoneRects, type Text } from './faces';
import { STRINGS } from './strings';

export { playHeadless };

type Batch = { t: number; price: number; cards: Card[]; rev: number[]; done: boolean[] };
type State = { sel: number; qty: number; bet: number; batch: Batch | null; losers: number; bin: number; hist: number[] };

type Ev =
  | { k: 'vend'; t: number; price: number; paid: number; freeUsed: number; cards: Card[] }
  | { k: 'stroke'; i: number; pts: number[] }
  | { k: 'zone'; i: number; z: number }
  /** how: 0 = scratched out, 1 = swept (Space), 2 = auto-swept when leaving. */
  | { k: 'done'; i: number; how: number; gross: number };

/** Authority-side bookkeeping for the batch in progress (rebuilt from the batch after a restore). */
type Pend = { n: number; total: number; next: number; gross: number[]; zoneSent: Set<number>[]; paid: number };
type View = { face: CanvasRenderingContext2D; foil: CanvasRenderingContext2D; out: CanvasRenderingContext2D; tex: THREE.CanvasTexture };

const VOUCHER = 'voucher.pitPenny';
const GOLD = 0xffd040;
const RARITY_COL = [0, 0xc59c42, 0x63e6de, 0xff42a5];
const LED_CREDIT = 0x6bff8a, LED_BET = 0x63e6de, LED_WIN = 0xffce5a;
const FLUSH_S = 1 / 15;

/** Stroke points are flat [x, y, x, y …] in face pixels. */
function drawPolyline(g: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 2) return;
  brush(g, pts[0], pts[1]);
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const x0 = pts[k - 2], y0 = pts[k - 1], x1 = pts[k], y1 = pts[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let s = 1; s <= n; s++) brush(g, x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
  }
}

const zoneIds = (mask: number, count: number): number[] => {
  const out: number[] = [];
  for (let z = 0; z < count; z++) if (mask & (1 << z)) out.push(z);
  return out;
};

export const def: MachineDef = {
  id: 'scratch',
  category: 'lottery',
  slotSize: 'M',
  zone: 'lobby',
  seats: 1,
  shared: false,
  minBet: 2, maxBet: 50, betSteps: [2, 5, 10, 20, 50],
  // top prize: BLOOD MOON ×1000 (×2 with the milestone top-prize charm); DEEP END tops out at 100 × 10 = ×1000
  maxPayoutMult: 2000,
  rtp: 0.859,
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'lottery', 'scratch', 'charm'],
  modHooks: {
    'm.scratch.topPrizeMult': 'Multiplies the weight of the top prize row on every card (default 1, a loss gives way).',
    'm.scratch.extraCharmSpot': 'Multiplies the charm-stamp chance on every card (default 1).',
    'm.scratch.secondChance': 'Above 0: every 10 losing cards add one free PIT PENNY to the second-chance bin.',
    'm.scratch.discount': 'Card price −N % (floor 1 coin). Default 0.',
    'm.scratch.xray': 'Above 0: one zone per card glows faintly before it is scratched.',
    luck: 'Luck: each losing card has a 0.5 % chance per point (cap 15 %) to be upgraded to the lowest prize.',
  },
  strings: STRINGS,
};

export default class ScratchVendor extends MachineBase<ScratchParts, Ev, State> {
  private state: State = { sel: 0, qty: 1, bet: 0, batch: null, losers: 0, bin: 0, hist: [] };
  private pend: Pend | null = null;
  private views: View[] = [];
  private stroking = false;
  private strokeQ: number[] = [];
  private flushT = 0;
  private showTables = false;

  protected createModel(kit: KitX): MachineModel<ScratchParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    const tex = this.ctx.kit.tex;
    this.views = this.parts.cardTex.map((card) => {
      // scratch canvases come from the texgen helper (no DOM access in machines)
      const face = (tex.canvas(FACE_W, FACE_H, () => undefined).image as HTMLCanvasElement).getContext('2d')!;
      const foil = (tex.canvas(FACE_W, FACE_H, () => undefined).image as HTMLCanvasElement).getContext('2d')!;
      const out = (card.image as HTMLCanvasElement).getContext('2d')!;
      return { face, foil, out, tex: card };
    });
    this.refreshVisuals();
    this.attractor.every('flick', 9, () => this.flickTube(), { first: 4 });
  }

  // ── attract: the tube dies now and then ─────────────────────────────────────────────────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private flickTube(): void {
    if (this.busy || this.occupant !== null) return;
    this.parts.tube.pattern('blink', 4);
    this.sfx('lightFlicker', { vol: 0.4 });
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      if (this.state.batch && !this.pend && !this.roundOpen) {       // a batch left open (reload / release): resume it
        this.rebuildPend();
        this.resumeRound(this.state.bet);
      }
      this.sfx('chime');
    }
    this.refreshVisuals();
    if (local) this.showHud();
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local && this.pend) {                 // forced release mid-batch: settle what was bought, never strand the stake
      const total = this.pend.total;
      this.pend = null;
      if (this.roundOpen) this.settle({ gross: total, tags: ['scratch'] });
      this.state.batch = null;
    }
    this.refreshVisuals();
  }

  onLang(): void {
    this.repaintBatch();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving with cards still to scratch auto-sweeps them and settles (the safe default for a batch game). */
  protected override standUp(): void {
    if (this.pend) this.autoFinish();
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isQty = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isQty) return;
    switch (a) {
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': this.select(Number(a.slice(1)) - 1); break;
      case 'left': this.select(this.state.sel - 1); break;
      case 'right': this.select(this.state.sel + 1); break;
      case 'betUp': this.setQty(this.state.qty + 1); break;
      case 'betDown': this.setQty(this.state.qty - 1); break;
      case 'betMax': this.setQty(MAX_QTY); break;
      case 'primary': case 'confirm': if (this.pend) this.sweepActive(); else this.vend(); break;
      case 'collect': case 'secondary': if (this.pend) this.autoFinish(); break;
      case 'help': this.showTables = !this.showTables; this.sfx('click'); this.showHud(); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    const p = this.pend;
    if (!p || p.next >= p.n || !this.state.batch || !this.isLocalOccupant) return;
    if (e.type === 'down' && e.button === 0) {
      const hit = this.pick([this.parts.cardPlanes[p.next]]);
      if (!hit?.uv) return;
      this.stroking = true;
      this.strokeQ = this.uvPx(hit.uv);
    } else if (e.type === 'move' && this.stroking) {
      const hit = this.pick([this.parts.cardPlanes[p.next]]);
      if (hit?.uv) this.strokeQ.push(...this.uvPx(hit.uv));
    } else if (e.type === 'up' && this.stroking) {
      this.stroking = false;
      this.flushStroke();
      this.strokeQ = [];
    }
  }

  tick(dt: number): void {
    if (!this.stroking || !this.pend) return;
    this.flushT += dt;
    if (this.flushT >= FLUSH_S && this.strokeQ.length >= 4) { this.flushT = 0; this.flushStroke(); }
  }

  private uvPx(uv: THREE.Vector2): number[] {
    return [Math.min(FACE_W - 1, Math.max(0, Math.round(uv.x * FACE_W))), Math.min(FACE_H - 1, Math.max(0, Math.round((1 - uv.y) * FACE_H)))];
  }

  private select(i: number): void {
    if (this.busy || this.roundOpen || this.state.batch) return;
    this.state.sel = ((i % CARD_COUNT) + CARD_COUNT) % CARD_COUNT;
    this.bet = priceOf(this.state.sel, this.discount());
    this.sfx('click');
    this.refreshVisuals();
    this.showHud();
  }

  private setQty(n: number): void {
    if (this.busy || this.roundOpen || this.state.batch) return;
    this.state.qty = Math.min(MAX_QTY, Math.max(1, n));
    this.sfx('click');
    this.showHud();
  }

  // ── authority: vend, scratch, finish ─────────────────────────────────────────────────────────────
  private vend(): void {
    const s = this.state;
    if (this.busy || this.roundOpen || s.batch || this.pend) return;
    const type = s.sel, q = s.qty;
    const disc = this.discount();
    const price = priceOf(type, disc);
    // Receipt Roll vouchers cover PIT PENNY cards first; the rest of the batch is paid
    const vouchers = type === 0 ? Math.min(q, this.ctx.run.balance(VOUCHER)) : 0;
    const paid = q - vouchers;
    const total = paid * price;
    if (!this.beginRound(total)) return;                 // charges the stake + 1 pull, busy = true, re-seeds rng
    if (vouchers > 0) this.ctx.run.spend(VOUCHER, vouchers, 'scratch');
    const o = this.rollOpts();
    const cards: Card[] = [];
    for (let i = 0; i < q; i++) cards.push(rollCard(this.rng, type, price, { ...o, free: i >= paid }));
    // the second-chance bin: free PIT PENNY cards ride along with a paid vend
    const freeN = Math.min(s.bin, MAX_QTY - q);
    const freePrice = priceOf(0, disc);
    for (let i = 0; i < freeN; i++) cards.push(rollCard(this.rng, 0, freePrice, { ...o, free: true }));
    const gross = cards.map((c) => c.gross);
    this.pend = { n: cards.length, total: gross.reduce((a, b) => a + b, 0), next: 0, gross, zoneSent: cards.map(() => new Set<number>()), paid: total };
    this.busy = false;                                    // the round stays open: scratching is interactive
    this.stroking = false; this.strokeQ = [];
    void this.emit({ k: 'vend', t: type, price, paid: total, freeUsed: freeN, cards });
  }

  /** Scratch-out check after a stroke: send the zones that are now open, and finish the card when all are. */
  private flushStroke(): void {
    const p = this.pend;
    const b = this.state.batch;
    if (!p || !b || p.next >= p.n || this.strokeQ.length < 2) return;
    const i = p.next;
    const pts = this.strokeQ;
    this.strokeQ = this.stroking ? pts.slice(-2) : [];    // keep the tail so the next flush continues the line
    const v = this.views[i];
    drawPolyline(v.foil, pts);
    this.refreshCard(i);
    void this.emit({ k: 'stroke', i, pts });
    const zones = zoneRects(b.cards[i].t);
    zones.forEach((z, zi) => {
      if (!p.zoneSent[i].has(zi) && clearedFraction(v.foil, z) >= ZONE_REVEAL) {
        p.zoneSent[i].add(zi);
        void this.emit({ k: 'zone', i, z: zi });
      }
    });
    if (p.zoneSent[i].size >= zones.length) this.finishCard(0);
  }

  private sweepActive(): void {
    if (this.busy || !this.pend) return;
    this.finishCard(1);
  }

  /** Auto-sweep every card still open (leaving, or the collect key). The last one settles the batch. */
  private autoFinish(): void {
    this.busy = true;                                     // holds the release until the batch has settled
    while (this.pend && this.pend.next < this.pend.n) this.finishCard(2);
  }

  private finishCard(how: number): void {
    const p = this.pend;
    if (!p || p.next >= p.n) return;
    const i = p.next++;
    const gross = p.gross[i];
    const last = p.next >= p.n;
    const total = p.total;
    const credit = last ? () => { this.settle({ gross: total, tags: ['scratch'] }); } : undefined;
    if (last) this.pend = null;
    void this.emit({ k: 'done', i, how, gross }, credit);
  }

  private rollOpts(): CardOpts {
    return {
      luck: this.luck(),
      top: this.mod(HOOK_TOP, 1) * (this.feature('scratch.topPrizeMult') ? 2 : 1),
      charm: this.mod(HOOK_CHARM, 1),
    };
  }

  private discount(): number {
    return Math.min(100, this.mod(HOOK_DISCOUNT, 0) + (this.feature('scratch.discount') ? 20 : 0));
  }

  private secondChance(): boolean {
    return this.mod(HOOK_SECOND, 0) > 0 || this.feature('scratch.secondChance');
  }

  /** Authority-side resume after a reload or a late seat: rebuild the bookkeeping from the batch. */
  private rebuildPend(): void {
    const b = this.state.batch;
    if (!b) return;
    const n = b.cards.length;
    const open = b.done.findIndex((d) => !d);
    const gross = b.cards.map((c) => c.gross);
    this.pend = {
      n, total: gross.reduce((a, c) => a + c, 0), next: open < 0 ? n : open, gross,
      zoneSent: b.cards.map((c, i) => new Set(zoneIds(b.rev[i], zoneRects(c.t).length))),
      paid: this.state.bet,
    };
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'vend': return this.presentVend(ev, pc);
      case 'stroke': return this.presentStroke(ev, pc);
      case 'zone': return this.presentZone(ev);
      case 'done': return this.presentDone(ev, pc);
    }
  }

  private async presentVend(ev: Extract<Ev, { k: 'vend' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.sel = ev.t;
    s.bet = ev.paid;
    s.bin = Math.max(0, s.bin - ev.freeUsed);
    s.batch = { t: ev.t, price: ev.price, cards: ev.cards, rev: ev.cards.map(() => 0), done: ev.cards.map(() => false) };
    this.repaintBatch();
    const P = this.parts;
    P.marquee.chase('win', 8);
    this.sfx('coinDrop');
    P.chainPivot.rotation.x = 0.12;                       // the coin clunks on the shelf
    if (!pc.fast) await this.wait(0.3);
    P.chainPivot.rotation.x = 0;
    for (let i = 0; i < ev.cards.length; i++) {
      const plane = P.cardPlanes[i];
      plane.visible = true;
      if (pc.fast) { this.placeCard(i, 1); continue; }
      this.sfx('whoosh', { vol: 0.4 });
      await this.anim(0.8, (k) => this.placeCard(i, k));
    }
    this.refreshVisuals();
    if (this.isLocalOccupant) this.showHud();
  }

  /** A card leaves the mouth (vertical), arcs over the lip and lies flat on its shelf slot. */
  private placeCard(i: number, k: number): void {
    const plane = this.parts.cardPlanes[i];
    const sx = SLOT_X(i);
    const kk = Math.min(1, Math.max(0, k));
    const y = 0.93 + (CARD_Y - 0.93) * kk + 0.1 * Math.sin(Math.PI * kk);
    plane.position.set(sx * kk, y, FRONT_Z + 0.02 + (SLOT_Z - FRONT_Z - 0.02) * kk);
    plane.rotation.x = -(Math.PI / 2) * kk;
  }

  private presentStroke(ev: Extract<Ev, { k: 'stroke' }>, pc: PresentCtx): void {
    const v = this.views[ev.i];
    if (!v || !this.state.batch) return;
    drawPolyline(v.foil, ev.pts);
    this.refreshCard(ev.i);
    this.parts.chainPivot.rotation.z = Math.sin(ev.pts[ev.pts.length - 2] * 0.05) * 0.1;   // the coin swings with the stroke
    if (pc.local && ev.pts.length >= 6) this.sfx('card', { vol: 0.05 });
  }

  private presentZone(ev: Extract<Ev, { k: 'zone' }>): void {
    const b = this.state.batch;
    const v = this.views[ev.i];
    if (!b || !v) return;
    const z = zoneRects(b.cards[ev.i].t)[ev.z];
    b.rev[ev.i] |= 1 << ev.z;
    v.foil.clearRect(z.x, z.y, z.w, z.h);
    this.refreshCard(ev.i);
    this.sfx('click', { vol: 0.6 });
    this.ctx.fx.sparks(this.parts.cardPlanes[ev.i], 3, GOLD);
  }

  private async presentDone(ev: Extract<Ev, { k: 'done' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const b = s.batch;
    if (!b) return;
    const i = ev.i, c = b.cards[i];
    const plane = this.parts.cardPlanes[i];
    const fx = this.ctx.fx;
    b.done[i] = true;
    b.rev[i] = (1 << zoneRects(c.t).length) - 1;
    s.hist = [c.mult, ...s.hist].slice(0, 8);
    if (ev.how !== 0 && !pc.fast) await this.sweep(i, ev.how === 1 ? 1.2 : 0.4);
    this.views[i].foil.clearRect(0, 0, FACE_W, FACE_H);
    this.refreshCard(i);

    if (c.gross === 0) {
      s.losers++;
      if (s.losers % SECOND_CHANCE_EVERY === 0 && this.secondChance()) {
        s.bin++;
        this.sfx('chime', { vol: 0.6 });
      }
    }
    const tier = juiceTier(c.gross, c.price, c.lucky ? ['lucky'] : []);
    if (c.gross > 0) {
      fx.popText(plane, `×${c.mult}`, GOLD, { dur: 1.1, rise: 0.3, scale: 1.1 + 0.1 * Math.min(4, Math.log10(c.mult + 1)), shake: c.mult >= 50 });
      fx.sparks(plane, 8 + Math.min(20, Math.round(Math.log10(c.mult + 1) * 6)), GOLD);
      this.sfx(tier === 'small' ? 'win1' : tier === 'medium' ? 'win2' : 'win3');
      if (c.mult >= 50) { this.sfx('jackpot', { vol: 0.8 }); fx.confetti(plane, 16); }
      if (c.lucky) this.sfx('sparkle', { vol: 0.5 });
    } else if (c.near) {
      void this.nearMiss({ at: plane, dur: 0.6, lamps: [this.parts.deskLamp] });
    } else {
      this.commiserate({ amount: c.price, at: plane });
    }
    if (c.charm) {
      const rare = c.charm === RARITY_RARE;
      fx.sparks(plane, rare ? 16 : 8, RARITY_COL[c.charm]);
      this.sfx('sparkle', { vol: 0.6, pitch: rare ? 7 : 3 });
      fx.popText(plane, this.t(c.charm === RARITY_RARE ? 'charmR' : c.charm === RARITY_UNCOMMON ? 'charmU' : 'charmC'), RARITY_COL[c.charm], { dur: 1.0, rise: 0.25 });
    }

    if (b.done.every(Boolean)) {                          // the batch is over: pay the show, clear the shelf
      const total = b.cards.reduce((a, x) => a + x.gross, 0);
      s.batch = null;
      const bet = s.bet;
      s.bet = 0;
      if (total > 0) {
        const tt = juiceTier(total, bet);
        if (tierAtLeast(tt, 'medium')) {
          void this.celebrate(tt, { amount: total, marquee: this.parts.marquee, lamps: [this.parts.deskLamp], restore: () => this.idleChase(), fast: pc.fast });
        } else {
          await this.pourCoins(total, { bet, fast: pc.fast });
        }
      }
    }
    this.refreshVisuals();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── cosmetic, from the state only ───────────────────────────────────────────────────────────────
  private textAdapter(): Text {
    const tex = this.ctx.kit.tex;
    return {
      draw: (g, s, x, y, color) => tex.drawText(g, s, x, y, { font: 'px5', color }),
      width: (s) => tex.measure(s, { font: 'px5' }),
    };
  }

  /** Paint every card of the batch from its outcome, with the scratched zones already open. */
  private repaintBatch(): void {
    const b = this.state.batch;
    if (!b) return;
    const tx = this.textAdapter();
    b.cards.forEach((c, i) => {
      const v = this.views[i];
      if (!v) return;
      paintFace(v.face, c, this.t(`c${c.t}`), (k) => this.t(`lab_${k}`), tx);
      paintFoil(v.foil, c.t);
      for (const zi of zoneIds(b.rev[i], zoneRects(c.t).length)) {
        const z = zoneRects(c.t)[zi];
        v.foil.clearRect(z.x, z.y, z.w, z.h);
      }
      this.composeCard(i);
      this.refreshCard(i);
    });
  }

  /** Face under foil, composited into the card texture (the face canvas is painted once per vend). */
  private composeCard(i: number): void {
    const v = this.views[i];
    v.out.clearRect(0, 0, FACE_W, FACE_H);
    v.out.drawImage(v.face.canvas, 0, 0);
    v.out.drawImage(v.foil.canvas, 0, 0);
  }

  private refreshCard(i: number): void {
    this.composeCard(i);
    this.parts.cardTex[i].needsUpdate = true;
  }

  private sweep(i: number, dur: number): Promise<void> {
    const v = this.views[i];
    return this.anim(dur, (k) => {
      const y = Math.min(FACE_H - 1, k * FACE_H);
      for (let x = 0; x <= FACE_W; x += 4) brush(v.foil, x, y);
      this.refreshCard(i);
    });
  }

  private idleChase(): void {
    this.parts.marquee.chase('chase', this.pend ? 8 : this.isLocalOccupant ? 5 : 3);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refreshVisuals(): void {
    const s = this.state, P = this.parts, b = s.batch;
    P.buttons.list.forEach((btn, i) => btn.setLit(i === s.sel));
    P.cardPlanes.forEach((p, i) => { p.visible = !!b && i < b.cards.length; });
    P.deskLamp.setOn(!!b || this.isLocalOccupant);
    P.leds.setBulb(0, this.isLocalOccupant ? LED_CREDIT : null);
    P.leds.setBulb(1, b || this.roundOpen ? LED_BET : null);
    P.leds.setBulb(2, (s.hist[0] ?? 0) > 0 ? LED_WIN : null);
    this.idleChase();
  }

  private showHud(): void {
    const s = this.state, p = this.pend;
    const price = priceOf(s.sel, this.discount());
    const hints: HudHint[] = this.busy ? []
      : p && p.next < p.n
        ? [{ action: 'primary', label: this.t('scratchAll') }]
        : [
          { action: 'primary', label: `${this.t('vend')} ${fmtCoins(price * s.qty)}` },
          { action: 'left', label: this.t('card') },
          { action: 'betUp', label: t('common.bet') },
          { action: 'help', label: this.t('prizes') },
        ];
    hints.push({ action: 'exit', label: t('common.leave') });
    const stats = this.showTables
      ? PRIZE_MULTS[s.sel].map((m, j) => ({ label: this.t('tblLine', { m, p: (PRIZE_WEIGHTS[s.sel][j] / WEIGHT_TOTAL * 100).toFixed(2) }), value: '' }))
      : [
        { label: this.t('card'), value: this.t(`c${s.sel}`) },
        { label: this.t('leftLabel'), value: p ? String(p.n - p.next) : '-' },
        ...(s.bin > 0 ? [{ label: this.t('binFree'), value: String(s.bin) }] : []),
      ];
    this.hud({ bet: s.batch ? null : price * s.qty, hints, stats });
  }

  getSnapshot(): State {
    return JSON.parse(JSON.stringify(this.state)) as State;
  }

  applySnapshot(s: State): void {
    this.state = JSON.parse(JSON.stringify(s)) as State;
    if (this.state.batch && this.isLocalOccupant && !this.pend && !this.roundOpen) {
      this.rebuildPend();
      this.resumeRound(this.state.bet);
    }
    this.repaintBatch();
    this.refreshVisuals();
  }
}
