/**
 * Fortune-Teller "Mother Moth" (`fortuneteller`) — solo-occupant omen gamble (MACHINES_tables §14, Tier 2).
 *
 * Pattern as in `coinflip/index.ts`: the logic runs on the local occupant (the authority of a solo device), packs the
 * outcome into events and `emit`s them; `present()` is the only place that animates and changes visuals, on every peer.
 * Settle (credit the wallet) happens BEFORE the presentation of the apply step (DECISIONS G).
 *
 * Round life-cycle: `read()` (stake, deal three face-down cards) → `choose(slot)` (reveal) → Defy window (6 s, pay the
 * stake again, void the revealed card, `choose` once more) → `apply()` (settle coins, add the omen buff) → `others`.
 * Leaving in PICK auto-picks slot 1; leaving in the Defy window = no defy.
 *
 * Controls: Space read · 1/2/3 or LMB on a card (or veil button) pick · 4 Defy Fate · H omen almanac · Z/X bet · E leave.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { breathe } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { Placard3D, INK, INK_SOFT, button, paginate, put, rowsIn, rule, wrapPx5 } from '@/machines/_base/placard3d';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { Kit } from '@/kit/types';
import { fmtCoins, type I18nVars } from '@/core/i18n';
import { buildModel, CARD_TILT, CARD_X, CARD_Y, FOLD, SHELF_Z, SPREAD, CRYSTAL, roman, type FortunetellerParts } from './model';
import {
  DEFY_WINDOW_S, GRAND_OMEN, HOOK_CURSE_IMMUNE, HOOK_DEFY_MULT, HOOK_GRAND_RARITY, HOOK_OMEN_DUR, HOOK_VEIL, HOOK_WEIGHT,
  OMENS, buildDeck, buffId, coinsFor, deal, effective, isCurse, nearMiss, omenOf, playHeadless, resolvePick, type OmenKind,
} from './rules';
import { STRINGS } from './fortuneteller.strings';

export { playHeadless };

type Ev =
  | { k: 'start'; bet: number }
  | { k: 'pick'; slot: number }
  | { k: 'reveal'; slot: number; omen: number; second: boolean }
  /** The first revealed card is voided by Defy Fate; `slot2` is its slot. */
  | { k: 'defy'; slot2: number }
  /** `coins` pays the stake × multiplier; `buff` is the applied `buff.omen.<id>` (or null); `eff` the effective omen (-1 = none). */
  | { k: 'apply'; omen: number; coins: number; bet: number; buff: string | null; eff: number }
  | { k: 'others'; slots: Array<[number, number]> };

type State = { prev: number | null; last: { omen: number; coins: number; bet: number } | null };

/** Logic phase. Only `pick` / `pick2` accept a choice; only `defy` accepts Defy Fate. */
type Phase = 'idle' | 'pick' | 'reveal' | 'defy' | 'pick2' | 'apply';

const KIND_TONE: Record<OmenKind, string> = { blessing: '#ffc83d', curse: '#b56cff', neutral: '#c8c8c8', mirror: '#bfe6f2' };
const SLOT_KEYS = ['n1', 'n2', 'n3'] as const;
// almanac book geometry (canvas texels / metres)
const ALMANAC_PX: [number, number] = [288, 256];
const ALMANAC_W = 0.46, ALMANAC_H = 0.41;
const ALMANAC_TEXT_W = ALMANAC_PX[0] - 28;
const ALMANAC_BODY_H = ALMANAC_PX[1] - 30 - 36;
/** Cards stand on the shelf: half the card height lifts the plane's centre off the shelf top. */

export const def: MachineDef = {
  id: 'fortuneteller',
  category: 'oddity',
  slotSize: 'M',
  zone: 'mouth',
  seats: 1,
  shared: false,
  minBet: 10, maxBet: 200, betSteps: [10, 20, 50, 100, 200],
  maxPayoutMult: 5,                       // the Grand Omen pays 5× the stake (Defy costs no extra payout)
  rtp: 0.8636,                            // coin RTP 19/22 (exact); omen buffs are break-even by design
  tier: 2,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'oracle', 'omen'],
  modHooks: {
    'm.fortuneteller.omenWeight.<id>': 'Int add: extra copies of omen <id> in the deck (capped at +3).',
    'm.fortuneteller.defyCostMult': 'Float ×: the cost of Defy Fate is stake × this (0 = free).',
    'm.fortuneteller.seeVeil': 'Charges: the occupant peeks at one card before picking (local only).',
    'm.fortuneteller.curseImmunity': 'Charges: a curse omen is ignored (no buff). Consumption is owned by the charm.',
    'm.fortuneteller.omenDurationMult': 'Float ×: scales the duration of every omen buff.',
    'm.fortuneteller.grandOmenRarity': 'Int 0..2: rarity tier of the Grand Omen free charm.',
  },
  strings: STRINGS,
};

export default class Fortuneteller extends MachineBase<FortunetellerParts, Ev, State> {
  private state: State = { prev: null, last: null };
  private phase: Phase = 'idle';
  private dealt: number[] = [];
  private undealt: number[] = [];
  private finalSlot = -1;
  private voided = -1;
  private swapped = false;
  /** Bumped whenever the Defy window closes early, so a stale timer does nothing. */
  private token = 0;
  private faceUp: boolean[] = [false, false, false];
  /** The omen almanac (3D book in front of the eye), or null when closed. */
  private almanac: Placard3D | null = null;
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). */
  private seatHud?: SeatHud;

  protected createModel(kit: Kit): MachineModel<FortunetellerParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    const p = this.parts;
    p.buttons.veil1.cap.userData.slot = 0;
    p.buttons.veil2.cap.userData.slot = 1;
    p.buttons.veil3.cap.userData.slot = 2;
    this.placeCards();
    this.refresh();
    this.attractor.every('twitch', 9, () => this.twitch(), { first: 4 });
  }

  // ── attract: the crystal breathes, the wings twitch now and then ──────────────────────────────
  attract(dt: number, time: number): void {
    const m = this.parts.crystal.material as THREE.MeshBasicMaterial;
    m.opacity = 0.55 + 0.25 * breathe(time, 0.5);
    this.attractor.update(dt);
  }

  private twitch(): void {
    if (this.busy || this.roundOpen || this.occupant !== null) return;
    void this.anim(0.4, (k) => {
      this.parts.wingL.rotation.y = FOLD - 0.25 * Math.sin(k * Math.PI);
      this.parts.wingR.rotation.y = -FOLD + 0.25 * Math.sin(k * Math.PI);
    });
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip(this.def.id, this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) this.seatHud?.hide();
    if (local && this.roundOpen) this.settle({ gross: 0, tags: ['abandoned'] });   // safety net: never strand a stake
    this.busy = false;
    this.phase = 'idle';
    this.dealt = []; this.undealt = []; this.finalSlot = -1; this.voided = -1; this.swapped = false;
    this.token++;
    this.almanac?.hide(); this.almanac = null;
    this.refresh();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving in PICK auto-picks the first card; leaving in the Defy window = no defy (apply now). */
  protected override standUp(): void {
    if (this.roundOpen && !this.busy) {
      if (this.phase === 'pick') void this.choose(0);
      else if (this.phase === 'pick2') void this.choose(this.firstFree());
      else if (this.phase === 'defy') void this.apply();
    }
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip card
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': void this.read(); break;
      case 'n1': case 'n2': case 'n3': void this.choose(a === 'n1' ? 0 : a === 'n2' ? 1 : 2); break;
      case 'n4': case 'alt': case 'double': void this.defy(); break;
      case 'help': this.toggleAlmanac(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    const p = this.parts;
    const hit = this.pick([...p.omenCards, p.buttons.veil1.cap, p.buttons.veil2.cap, p.buttons.veil3.cap]);
    const slot = hit?.object.userData.slot;
    if (typeof slot === 'number') void this.choose(slot);
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private firstFree(): number {
    for (let i = 0; i < 3; i++) if (i !== this.voided) return i;
    return 0;
  }

  private defyCost(): number {
    return Math.max(0, Math.round(this.roundBet * this.mod(HOOK_DEFY_MULT, 1)));
  }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  /** Stake and deal three face-down cards. */
  private async read(): Promise<void> {
    if (this.busy || this.roundOpen || this.phase !== 'idle') return;
    if (!this.beginRound(this.bet)) return;                 // charges the wallet, busy = true, re-seeds this.rng
    this.busy = true;
    this.swapped = false;
    const deck = buildDeck((id) => this.mod(HOOK_WEIGHT(id), 0));
    const d = deal(this.rng, deck);
    this.dealt = d.dealt; this.undealt = d.undealt;
    this.finalSlot = -1; this.voided = -1;
    this.phase = 'pick';
    this.showHud();
    if (this.mod(HOOK_VEIL, 0) > 0) this.toast(this.t('veil', { name: this.t(`omen.${this.dealt[0]}.name`) }), 'sys');
    try {
      await this.emit({ k: 'start', bet: this.roundBet });
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  /** Reveal one card (the first pick, or the second after Defy). */
  private async choose(slot: number): Promise<void> {
    if (this.busy || slot < 0 || slot > 2) return;
    const second = this.phase === 'pick2';
    if (this.phase !== 'pick' && !second) return;
    if (second && slot === this.voided) return;
    this.busy = true;
    this.phase = 'reveal';
    this.token++;
    this.showHud();
    const r = resolvePick(this.rng, this.dealt, this.undealt, slot, this.luck());
    this.dealt = r.dealt; this.undealt = r.undealt;
    this.swapped = this.swapped || r.swapped;
    this.finalSlot = slot;
    try {
      await this.emit({ k: 'pick', slot });
      await this.emit({ k: 'reveal', slot, omen: r.omen, second });
    } finally {
      this.busy = false;
    }
    if (second) void this.apply();
    else if (this.canDefy()) this.openDefy();
    else void this.apply();
  }

  private canDefy(): boolean {
    const cost = this.defyCost();
    return cost <= 0 || this.ctx.run.canAfford(cost, this.selfId);
  }

  /** Six-second window; expiry applies the first pick. */
  private openDefy(): void {
    const token = this.token;
    this.phase = 'defy';
    this.showHud();
    void this.wait(DEFY_WINDOW_S).then(() => {
      if (this.disposed || token !== this.token || this.phase !== 'defy') return;
      void this.apply();
    });
  }

  /** Pay the stake again, void the revealed card, and pick one of the remaining two (final). */
  private async defy(): Promise<void> {
    if (this.phase !== 'defy' || this.busy) return;
    const cost = this.defyCost();
    if (cost > 0 && !this.addStake(cost)) { this.toast(this.t('defyNo'), 'sys'); return; }
    this.token++;
    this.voided = this.finalSlot;
    this.busy = true;
    this.phase = 'reveal';
    this.showHud();
    try {
      await this.emit({ k: 'defy', slot2: this.voided });
    } finally {
      this.busy = false;
    }
    this.phase = 'pick2';
    this.showHud();
  }

  /** Settle the chosen card's coins (before the presentation), apply its omen, then reveal the rest. */
  private async apply(): Promise<void> {
    if (this.busy || !this.roundOpen || this.finalSlot < 0) return;
    const omen = this.dealt[this.finalSlot];
    const kind = omenOf(omen).kind;
    const immune = isCurse(omen) && this.mod(HOOK_CURSE_IMMUNE, 0) > 0;
    const eff = effective(omen, this.state.prev);
    const coins = coinsFor(omen, this.roundBet);
    const buff = eff !== null && !immune ? buffId(eff) : null;
    const unpicked: Array<[number, number]> = [0, 1, 2].filter((i) => i !== this.finalSlot).map((i) => [i, this.dealt[i]]);
    const near = nearMiss(unpicked.map((u) => u[1]));
    const tags = [
      `omen:${omen}`, ...(kind === 'curse' ? ['curse'] : kind === 'blessing' ? ['blessing'] : []),
      ...(this.swapped ? ['lucky'] : []), ...(near ? ['nearmiss'] : []),
    ];
    this.swapped = false;
    this.busy = true;
    this.phase = 'apply';
    this.showHud();
    const credit = (): void => {
      this.settle({ gross: coins, tags });
      if (buff) {
        const data = omen === GRAND_OMEN ? { rarity: this.mod(HOOK_GRAND_RARITY, 0) } : undefined;
        this.ctx.run.buffs.add(buff, {
          pid: this.selfId, source: { kind: 'machine', id: this.def.id }, durationScale: this.mod(HOOK_OMEN_DUR, 1),
          ...(data ? { data } : {}),
        });
      }
    };
    const shown = this.emit({ k: 'apply', omen, coins, bet: this.roundBet, buff, eff: eff ?? -1 }, credit);
    if (this.roundOpen) credit();                           // the emit was refused: still pay out, never strand the stake
    try {
      await shown;
      if (unpicked.length) await this.emit({ k: 'others', slots: unpicked });
    } finally {
      this.busy = false;
      this.phase = 'idle';
      this.finalSlot = -1;
      this.showHud();
    }
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'pick': return this.presentPick(ev, pc);
      case 'reveal': return this.presentReveal(ev, pc);
      case 'defy': return this.presentDefy(ev, pc);
      case 'apply': return this.presentApply(ev, pc);
      case 'others': return this.presentOthers(ev, pc);
    }
  }

  private async presentStart(ev: Extract<Ev, { k: 'start' }>, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    this.faceUp = [false, false, false];
    this.placeCards(true);
    this.setCrystal('neutral');
    p.leds.bet.setOn(false);
    this.drawScreen();
    if (pc.fast) { this.placeCards(); return; }
    // AWAKEN: the crystal warms up and the eyes open
    this.sfx('chime', { vol: 0.4 });
    await this.anim(1.5, (k) => {
      (p.crystal.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * k;
      p.crystal.scale.setScalar(1 + 0.12 * k);
    });
    // SHUFFLE: mist rises, the letter of the occupant's name is written on the glass
    this.sfx('whoosh', { vol: 0.5, pitch: 2 });
    const name = this.ctx.net.playerName(this.selfId).trim();
    void p.oracle.pose('arms');
    await this.anim(1.8, (k) => {
      (p.fog.material as THREE.MeshBasicMaterial).opacity = 0.7 * k;
      this.paintFog(name ? name.charAt(0).toUpperCase() : '', k);
      p.cardSlots.forEach((s, i) => { p.omenCards[i].position.x = s.position.x + 0.01 * Math.sin(k * 40 + i); });
    });
    // DEAL: three cards slide out of the dispenser onto the shelf
    for (let i = 0; i < 3; i++) {
      this.sfx('coinFlick', { vol: 0.4, pitch: 3 + i });
      const card = p.omenCards[i];
      const from = p.dispenser.position.clone(), to = p.cardSlots[i].position.clone().setY(CARD_Y);
      await this.anim(0.5, (k) => {
        card.position.lerpVectors(from, to, k);
        card.position.y += 0.1 * Math.sin(k * Math.PI);
      }, 'outQuad');
    }
    if (pc.local) this.ctx.fx.dust(p.dispenser, 4);
    void p.oracle.pose('idle');
    this.paintFog('', 0);
    (p.fog.material as THREE.MeshBasicMaterial).opacity = 0;
    p.fogTex.needsUpdate = true;
  }

  private presentPick(ev: Extract<Ev, { k: 'pick' }>, pc: PresentCtx): Promise<void> | void {
    const p = this.parts;
    const btn = [p.buttons.veil1, p.buttons.veil2, p.buttons.veil3][ev.slot];
    void btn.press();
    this.sfx('button');
    if (pc.fast) return;
    const card = p.omenCards[ev.slot];
    const base = p.cardSlots[ev.slot].position.y;
    return this.anim(0.2, (k) => {
      card.position.y = base + 0.025 * Math.sin(k * Math.PI);
      card.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI));
    });
  }

  private async presentReveal(ev: Extract<Ev, { k: 'reveal' }>, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const o = omenOf(ev.omen);
    this.setCrystal(o.kind);
    this.faceUp[ev.slot] = true;
    if (pc.fast) { this.showFace(ev.slot, ev.omen); this.drawScreen(); return; }
    this.sfx(o.kind === 'curse' ? 'curse' : o.kind === 'blessing' ? 'chime' : 'whisper', { vol: 0.8 });
    if (o.kind === 'curse' && pc.local) this.ctx.fx.glow(p.fog, CRYSTAL.curse, 0.5, 0.6);
    await this.flipCard(ev.slot, ev.omen, 1.2);
    if (pc.local) this.ctx.fx.shake(0.003, 0.12);
    this.drawScreen();
    p.marquee.chase('chase', 6);
  }

  private async presentDefy(ev: Extract<Ev, { k: 'defy' }>, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    this.sfx('whoosh', { vol: 0.8, pitch: 0 });
    if (pc.local) this.ctx.fx.shake(0.006, 0.25);
    const mat = p.omenCards[ev.slot2].material as THREE.MeshBasicMaterial;
    if (pc.fast) { mat.color.setScalar(0.4); return; }
    p.marquee.chase('blink', 4);
    await this.anim(0.5, (k) => {
      mat.color.setScalar(1 - 0.6 * k);
      p.omenCards[ev.slot2].position.y -= 0.02 * k;
      (p.crystal.material as THREE.MeshBasicMaterial).color.setHex(CRYSTAL.curse);
    }, 'outQuad');
    this.setCrystal('neutral');
    p.marquee.chase('chase', 5);
  }

  private async presentApply(ev: Extract<Ev, { k: 'apply' }>, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const s = this.state;
    const o = omenOf(ev.omen);
    s.prev = ev.omen;                                       // Mirror repeats this next time
    s.last = { omen: ev.omen, coins: ev.coins, bet: ev.bet };
    const net = ev.coins - ev.bet;                          // the bet includes any Defy Fate stake
    if (this.isLocalOccupant) this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
    this.setCrystal(o.kind);
    if (ev.buff && this.isLocalOccupant) this.toast(`${this.t(`omen.${ev.omen}.name`)} — ${this.t(`omen.${ev.omen}.desc`)}`, 'sys');
    if (pc.fast) { this.drawScreen(); this.refresh(); return; }
    p.leds.win.setOn(ev.coins > 0);
    p.leds.credit.setOn(true);
    if (ev.omen === GRAND_OMEN) {
      this.sfx('win3', { vol: 0.9 });
      this.ctx.fx.sparks(p.crystal, 24, CRYSTAL.blessing);
      await this.anim(0.8, (k) => {
        p.wingL.rotation.y = FOLD + (SPREAD - FOLD) * k;
        p.wingR.rotation.y = -(FOLD + (SPREAD - FOLD) * k);
      }, 'outQuad');
    }
    if (ev.coins > 0) {
      this.sfx(ev.coins >= ev.bet * 2 ? 'win2' : 'win1');
      this.ctx.fx.sparks(p.dispenser, 8, CRYSTAL[o.kind]);
      this.ctx.fx.popText(p.fog, `×${o.coin}`, CRYSTAL[o.kind], { dur: 1.1, rise: 0.3, scale: 1.2, shake: o.coin >= 3 });
      const tier = juiceTier(ev.coins, ev.bet);
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
        void this.celebrate(tier, { amount: ev.coins, marquee: p.marquee, lamps: [p.leds.win, p.leds.bet], restore: () => p.marquee.chase('chase', 4), fast: pc.fast });
        await this.countCoins(ev.coins);
      } else {
        await this.pourCoins(ev.coins, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
      }
    } else {
      this.sfx(o.kind === 'curse' ? 'curse' : 'thud', { vol: 0.6 });
      this.commiserate({ amount: ev.bet, at: p.fog });
    }
    if (o.kind === 'curse') { (p.fog.material as THREE.MeshBasicMaterial).opacity = 0.5; await this.wait(0.4); }
    p.leds.win.setOn(false);
    this.drawScreen();
    if (!pc.fast) await this.wait(0.2);
  }

  private async presentOthers(ev: Extract<Ev, { k: 'others' }>, pc: PresentCtx): Promise<void> {
    if (pc.fast) { for (const [slot, omen] of ev.slots) this.showFace(slot, omen); return; }
    // the outcome stays on the shelf until the next reading (faces are cleared by `placeCards` on the next start)
    for (const [slot, omen] of ev.slots) {
      if (this.faceUp[slot]) continue;
      this.faceUp[slot] = true;
      void this.flipCard(slot, omen, 0.45);
      await this.wait(0.25);
    }
    await this.wait(0.3);
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────────
  /** Cards on the shelf, backs up. `atDispenser` parks them in the slot (before the deal). */
  private placeCards(atDispenser = false): void {
    const p = this.parts;
    p.omenCards.forEach((card, i) => {
      const mat = card.material as THREE.MeshBasicMaterial;
      mat.map = p.omenBack; mat.color.setScalar(1); mat.needsUpdate = true;
      card.scale.setScalar(1);
      card.rotation.set(-CARD_TILT, 0, 0);
      if (atDispenser) card.position.copy(p.dispenser.position);
      else card.position.set(CARD_X[i], CARD_Y, SHELF_Z);
    });
  }

  private showFace(slot: number, omen: number): void {
    const card = this.parts.omenCards[slot];
    const mat = card.material as THREE.MeshBasicMaterial;
    mat.map = this.parts.omenFaces[omen]; mat.needsUpdate = true;
    card.scale.setScalar(1); card.position.y = CARD_Y;
  }

  /** Edge-on flip: scale.x = |cos|, the face texture is swapped at the midpoint. */
  private async flipCard(slot: number, omen: number, dur: number): Promise<void> {
    const card = this.parts.omenCards[slot];
    const mat = card.material as THREE.MeshBasicMaterial;
    let swapped = false;
    await this.anim(dur, (k) => {
      card.scale.x = Math.max(0.02, Math.abs(Math.cos(Math.PI * k)));
      if (!swapped && k >= 0.5) { swapped = true; mat.map = this.parts.omenFaces[omen]; mat.needsUpdate = true; }
    }, 'outQuad');
    card.scale.x = 1;
  }

  private setCrystal(kind: OmenKind | 'neutral'): void {
    const m = this.parts.crystal.material as THREE.MeshBasicMaterial;
    m.color.setHex(kind === 'neutral' ? 0x8a8a92 : CRYSTAL[kind]);
    m.opacity = 0.8;
  }

  /** Mist plus one letter drawn `k` (0..1) in, 32 × 32. */
  private paintFog(letter: string, k: number): void {
    const c = this.parts.fogCanvas;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(180,200,220,0.25)'; g.fillRect(0, 0, 32, 32);
    if (letter && k > 0) {
      g.globalAlpha = Math.min(1, k);
      g.fillStyle = '#ffe9a8'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, 16, 17);
      g.globalAlpha = 1;
    }
    this.parts.fogTex.needsUpdate = true;
  }

  private async countCoins(amount: number): Promise<void> {
    await this.anim(1.0, (k) => this.drawScreen(Math.round(amount * k)));
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const p = this.parts;
    this.placeCards();
    this.setCrystal(this.state.last ? omenOf(this.state.last.omen).kind : 'neutral');
    p.leds.credit.setOn(this.occupant !== null);
    p.leds.bet.setOn(!this.roundOpen);
    p.leds.win.setOn(false);
    p.wingL.rotation.y = FOLD; p.wingR.rotation.y = -FOLD;
    (p.fog.material as THREE.MeshBasicMaterial).opacity = 0;
    p.marquee.chase(this.occupant !== null ? 'chase' : 'all', this.occupant !== null ? 5 : 1.5);
    this.drawScreen();
  }

  /** The 96 × 32 display: last omen numeral and coins (or the stake). */
  private drawScreen(winShown?: number): void {
    const s = this.state;
    this.parts.screen.draw((g, sc) => {
      g.fillStyle = '#100a14'; g.fillRect(0, 0, sc.w, sc.h);
      const last = s.last;
      sc.text(last ? roman(last.omen) : '-', 48, 4, { font: 'px5', color: '#ffc83d', align: 'center' });
      const v = winShown ?? (last ? last.coins : this.roundOpen ? this.roundBet : this.bet);
      sc.text(v > 0 ? fmtCoins(v) : '0', 48, 18, { font: 'px5', color: '#e8dcc0', align: 'center' });
    });
  }

  /** Seat HUD: goal, phase banner, key numbers and the valid controls only. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const cost = this.defyCost();
    const pick = `${this.k('n1')}-${this.k('n3')}`;
    sh.goal(this.tx('goal'));
    switch (this.phase) {
      case 'idle': sh.state(this.tx('stIdle'), 'gold', this.tx('stIdleSub')); break;
      case 'pick': sh.state(this.tx('stPick'), 'gold', this.tx('stPickSub')); break;
      case 'pick2': sh.state(this.tx('stPick2'), 'warn', this.tx('stPick2Sub')); break;
      case 'defy': sh.state(this.tx('stDefy'), 'warn', this.tx('stDefySub', { defy: this.k('n4'), cost: cost > 0 ? fmtCoins(cost) : this.t('freeWord') })); break;
      case 'apply': sh.state(this.tx('stApply'), 'neutral'); break;
      default: sh.state(this.tx('stWait'), 'cyan');
    }
    const last = s.last;
    sh.numbers([
      { label: this.tx('nStake'), value: fmtCoins(this.roundOpen ? this.roundBet : this.bet), tone: 'gold' },
      { label: this.tx('nLast'), value: last ? roman(last.omen) : '-', tone: 'neutral' },
      { label: this.tx('nPaid'), value: last ? fmtCoins(last.coins) : '-', tone: last && last.coins > 0 ? 'good' : 'neutral' },
      { label: this.tx('nDefy'), value: this.phase === 'defy' && cost > 0 ? fmtCoins(cost) : '-', tone: 'warn' },
      { label: this.tx('nBalance'), value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
    ]);

    const ctrl: HudControl[] = [];
    if (!this.busy) {
      if (this.phase === 'idle') {
        ctrl.push({ key: this.k('primary'), label: this.tx('cRead'), action: 'primary', primary: true });
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: this.tx('cStake'), action: 'betUp' });
      } else if (this.phase === 'pick') {
        ctrl.push({ key: pick, label: this.tx('cPick'), action: 'n1', primary: true });
      } else if (this.phase === 'pick2') {
        const keys = [0, 1, 2].filter((i) => i !== this.voided).map((i) => this.k(SLOT_KEYS[i]));
        ctrl.push({ key: keys.join('/'), label: this.tx('cPick'), action: 'n1', primary: true });
      } else if (this.phase === 'defy') {
        ctrl.push({ key: this.k('n4'), label: cost > 0 ? this.tx('cDefyCost', { cost: fmtCoins(cost) }) : this.tx('cDefyFree'), action: 'n4', primary: true });
      }
    }
    ctrl.push({ key: this.k('help'), label: this.tx('cAlmanac'), action: 'help' });
    ctrl.push({ key: this.k('exit'), label: this.tx('cLeave'), action: 'exit' });
    sh.controls(ctrl);
  }

  // ── seat HUD helpers ────────────────────────────────────────────────────────────────────────────
  private tx(key: string, v?: I18nVars): Txt { return v ? { k: `m.${this.def.id}.${key}`, v } : { k: `m.${this.def.id}.${key}` }; }
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private tipLines(): Txt[] {
    return [
      this.tx('tip1', { read: this.k('primary') }),
      this.tx('tip2', { pick: `${this.k('n1')}-${this.k('n3')}` }),
      this.tx('tip3', { defy: this.k('n4'), help: this.k('help') }),
    ];
  }
  /**
   * Omen almanac: all 22 cards with their coin multiplier and effect (EN/TR), a 3D book held up in front of the eye.
   * Toggled with H; Esc or a click on CLOSE shuts it, arrows / A D or a click on the page turn the pages.
   */
  private toggleAlmanac(): void {
    if (this.almanac) { this.almanac.hide(); this.almanac = null; return; }
    const rows: Array<{ text: string; color: string }> = [];
    for (const o of OMENS) {
      rows.push({ text: `${roman(o.id)}  ${this.t(`omen.${o.id}.name`)}  x${o.coin}`, color: KIND_TONE[o.kind] });
      for (const r of wrapPx5(this.t(`omen.${o.id}.desc`), ALMANAC_TEXT_W)) rows.push({ text: r, color: INK });
    }
    const pages = paginate(rows, rowsIn(ALMANAC_BODY_H));
    this.almanac = new Placard3D({
      name: 'fortuneteller-almanac',
      w: ALMANAC_W, h: ALMANAC_H, px: ALMANAC_PX,
      pages: () => pages.length,
      bg: '#e9dfbf',
      frame: { color: 0x5a2a2a, pad: 0.014, depth: 0.01 },
      rest: [0, -0.03, -0.5],
      paint: (c) => {
        const { g, w, h } = c;
        put(g, this.t('almanacTitle'), w / 2, 8, INK, 'center');
        rule(g, 14, 22, w - 28);
        pages[c.page].forEach((r, i) => put(g, r.text, 14, 30 + i * 10, r.color));
        if (pages.length > 1) {
          button(c, 14, h - 24, 22, 13, '<', 'prev');
          button(c, w - 36, h - 24, 22, 13, '>', 'next');
          put(g, `${c.page + 1}/${pages.length}`, w / 2, h - 21, INK_SOFT, 'center');
        }
        button(c, w / 2 - 34, h - 24, 68, 13, this.t('almanacClose'), 'close');
        c.region(14, 30, w - 28, ALMANAC_BODY_H, 'next');          // a click on the text turns the page
      },
      act: (a) => {
        if (a === 'prev') this.almanac?.turn(-1);
        else if (a === 'next') this.almanac?.turn(1);
        else if (a === 'close') this.toggleAlmanac();
      },
      keys: { ArrowLeft: 'prev', KeyA: 'prev', ArrowRight: 'next', KeyD: 'next', Escape: 'close' },
      onGone: () => { this.almanac = null; },
    });
    if (!this.almanac.show()) { this.almanac.dispose(); this.almanac = null; }
  }

  override dispose(): void {
    this.seatHud?.dispose();
    this.token++;
    this.almanac?.dispose(); this.almanac = null;
    super.dispose();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { prev: this.state.prev, last: this.state.last ? { ...this.state.last } : null };
  }
  applySnapshot(s: State): void {
    this.state = { prev: s.prev, last: s.last ? { ...s.last } : null };
    this.refresh();
  }
}

