/**
 * Mystery Capsule Vendor (`lootbox`, solo, gallery). Three crank tiers (TIN 10 / BRASS 40 / GILDED 150 coins × stake
 * index). Each crank charges the stake (`beginRound`, one action point), rolls the capsule's content on the authority
 * and sends `vend`; the capsule rolls down the spiral chute to your hands. Twist it open (Space, or hold LMB and circle)
 * to send `open`, which settles the coins and grants any charm through `run.grantCharm(id)`.
 *
 * Rules and tables: rules.ts (pure, shared with `playHeadless`). Model: model.ts. Strings: strings.ts.
 *
 * Controls (seated): 1/2/3 or ←/→ tier · Space crank (READY) / twist open (IN HAND) · hold LMB and circle the pointer to
 * twist · H contents · E stands up (an unopened capsule auto-opens first).
 *
 * Pity: the counter lives on the run (`run.stat('lootbox.pity.<pid>')`), so it persists across Nights and resets per run.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtNum, t as tr, type I18nVars } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, type LootboxParts } from './model';
import {
  NO_POOL, REF_PRICE, isRarePlus, nextPity, payoutOf, pityArmed, pityThreshold, rollCapsule, tierDef, tierPrice,
  type CharmRarityKey, type Content, type PoolCharm, type Rarity, type TierId,
} from './rules';
import { STRINGS } from './strings';

export { playHeadless } from './rules';
import { playHeadless } from './rules';

/** Authority-side state of the capsule in play (between crank and open). */
interface Pending { tier: TierId; price: number; content: Content; dudIdx: number; forced: boolean; threshold: number; count: number }

/** Events are flat (Json-safe). `k: 'vend'` on crank commit, `k: 'open'` on twist. */
type Ev =
  | { k: 'vend'; tier: number; price: number; cap: number }
  | { k: 'open'; tier: number; kind: string; rarity: string; charmId: string; dupe: boolean; coins: number;
      granted: boolean; fallback: boolean; dudIdx: number; forced: boolean; pity: number };

const GOLD = 0xffc020;
const VIOLET = 0x6010a0;
const BLUE = 0x60a0ff;
const GREEN = 0x60ff90;
const WHITE = 0xffffff;
const PITY_KEY = (pid: number): string => `lootbox.pity.${pid}`;
const TWIST_TURNS = 1.5;                       // full turns of pointer travel to twist a capsule open

export const def: MachineDef = {
  id: 'lootbox',
  category: 'oddity',
  slotSize: 'M',
  zone: 'gallery',
  seats: 1,
  shared: false,
  minBet: 1,
  maxBet: 150,
  betSteps: [10, 40, 150],
  maxPayoutMult: 5,
  tier: 2,
  actionCost: 1,
  tags: ['capsule', 'charm-source'],
  headless: playHeadless,
  modHooks: {
    'm.lootbox.pityAt': 'Pity threshold offset (negative lowers it, min 5). Base 10 BRASS/GILDED opens without Rare+.', // i18n-ok
    'm.lootbox.rerollToken': 'At least 1: a DUD or COINS capsule is re-opened once and the second roll is kept.', // i18n-ok
    'm.lootbox.cursedOdds': 'Multiplier on the Cursed weight (×0 removes it).', // i18n-ok
    'm.lootbox.discount': 'Fraction off the capsule price (0.2 = 20 %), capped at 90 %.', // i18n-ok
  },
  strings: STRINGS,
};

export default class Lootbox extends MachineBase<LootboxParts, Ev, null> {
  private tierSel: TierId = 0;
  private pending: Pending | null = null;
  private inHand = false;
  private twistOn = false;
  private twistAngle = 0;
  private twistLast = 0;
  private twistAcc = 0;
  /** Price of the capsule in play (set on vend, read on open for the result callout). */
  private vendPrice = 0;
  /** True while the reveal of an opened capsule runs. */
  private revealing = false;
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts) and the last key it was drawn from. */
  private seatHud?: SeatHud;
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<LootboxParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.lightTier();
    this.parts.marquee.chase('chase', 2);
    this.attractor.every('glint', 9, () => this.ctx.fx.glow(this.model.anchors.light, GOLD, 0.25, 0.5), { first: 4 });
    this.hudKey = '';
    this.refreshHud(true);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── run helpers (every peer; read-only) ─────────────────────────────────────────────────────────
  /** Stake index: `run.stakeIndex()` when the run exposes it (GDD SI track), else 1. */
  private get stakeIndex(): number {
    const f: unknown = Reflect.get(this.ctx.run, 'stakeIndex');
    const v = typeof f === 'function' ? Number(f.call(this.ctx.run)) : 1;
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  /** Launch charm pool of a rarity from `run.charmPool(rarity)` when the run exposes it; empty otherwise. */
  private charmPool(r: CharmRarityKey): readonly PoolCharm[] {
    const f: unknown = Reflect.get(this.ctx.run, 'charmPool');
    return typeof f === 'function' ? (f.call(this.ctx.run, r) as readonly PoolCharm[]) : NO_POOL;
  }
  private pityCount(): number { return this.ctx.run.stat(PITY_KEY(this.selfId)); }
  private price(tier: TierId): number { return tierPrice(tier, this.stakeIndex, this.mod('m.lootbox.discount', 0)); }

  tick(_dt: number): void { this.refreshHud(false); }

  attract(dt: number, _t: number): void { this.attractor.update(dt); }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime');
      this.hudKey = '';
      this.seatHud?.show();
      this.refreshHud(true);
      this.seatHud?.firstTip(this.def.id, this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.seatHud?.hide();
      if (this.pending) this.openCapsule();          // an unopened capsule never leaves with the player
      this.ctx.ui.machineHud(null);
      this.hudKey = '';
    }
  }

  onLang(): void {
    this.hudKey = '';
    this.refreshHud(true);
  }

  /** E stands up: open a capsule in hand first, then release (base defers while busy). */
  protected standUp(): void {
    if (this.pending) this.openCapsule();
    super.standUp();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down || e.repeat) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or contents card
    switch (e.action) {
      case 'n1': this.selectTier(0); return;
      case 'n2': this.selectTier(1); return;
      case 'n3': this.selectTier(2); return;
      case 'left': this.selectTier(((this.tierSel + 2) % 3) as TierId); return;
      case 'right': this.selectTier(((this.tierSel + 1) % 3) as TierId); return;
      case 'primary': case 'confirm':
        if (this.inHand && this.pending) this.openCapsule();
        else this.crank(this.tierSel);
        return;
      case 'help': this.seatHud?.rules(this.contentsLines(), this.tx('tableTitle')); return;
    }
  }

  /** LMB on a crank pulls it; LMB held while a capsule is in hand starts a twist (circle the pointer). */
  onPointer(e: MachinePointerEvent): void {
    if (e.type === 'down' && e.button === 0) {
      if (this.inHand && this.pending) {
        this.twistOn = true;
        this.twistLast = Math.atan2(e.ndc.y, e.ndc.x);
        this.twistAcc = 0;
        this.twistAngle = 0;
        return;
      }
      const hit = this.pick(this.parts.cranks.map((c) => c.root));
      if (hit) {
        const i = this.parts.cranks.findIndex((c) => this.within(hit.object, c.root));
        if (i >= 0) { this.selectTier(i as TierId); this.crank(i as TierId); }
      }
      return;
    }
    if (e.type === 'move' && this.twistOn && this.pending) {
      const a = Math.atan2(e.ndc.y, e.ndc.x);
      let d = a - this.twistLast;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.twistLast = a;
      this.twistAcc += d;
      this.twistAngle += d;
      if (Math.abs(this.twistAcc) > Math.PI / 2) { this.twistAcc = 0; this.sfx('tileClack'); }
      if (Math.abs(this.twistAngle) >= TWIST_TURNS * 2 * Math.PI) { this.twistOn = false; this.openCapsule(); }
      return;
    }
    if (e.type === 'up') this.twistOn = false;
  }

  private within(obj: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o === root) return true;
    return false;
  }

  private selectTier(t: TierId): void {
    if (this.tierSel !== t) this.sfx('hover');
    this.tierSel = t;
    this.lightTier();
    this.hudKey = '';
    this.refreshHud(true);
  }

  private lightTier(): void {
    this.parts.badges.forEach((b, i) => b.setOn(i === this.tierSel));
  }

  /** Crank commit: charges the stake, rolls the content on the authority and sends `vend`. */
  private crank(tier: TierId): void {
    if (this.pending || this.busy) { this.refuse('busy'); return; }
    const price = this.price(tier);
    if (!this.ctx.run.canAfford(price, this.selfId)) { this.refuse('funds'); return; }
    if (!this.beginRound(price)) return;           // base already toasted and buzzed
    const count = this.pityCount();
    const threshold = pityThreshold(this.mod('m.lootbox.pityAt', 0));
    const forced = pityArmed(count, tier, threshold);
    const content = rollCapsule(this.rng, tier, {
      luck: this.luck(),
      cursedMult: this.mod('m.lootbox.cursedOdds', 1),
      forceRarePlus: forced,
      reroll: this.mod('m.lootbox.rerollToken', 0) >= 1,
      si: this.stakeIndex,
      owned: (id) => this.ctx.run.charms(this.selfId).some((s) => s.id === id),
      pool: (r) => this.charmPool(r),
    });
    const dudIdx = this.rng.int(0, 5);
    this.pending = { tier, price, content, dudIdx, forced, threshold, count };
    this.inHand = false;
    void this.emit({ k: 'vend', tier, price, cap: this.cosmetic.int(0, 359) });
  }

  /** Twist open: credit first (coins, charm grant, pity), then present. */
  private openCapsule(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.inHand = false;
    this.twistOn = false;
    const c = p.content;
    const si = this.stakeIndex;
    const ev: Ev = {
      k: 'open', tier: p.tier, kind: c.kind, rarity: c.rarity, charmId: c.charmId, dupe: c.dupe,
      coins: payoutOf(c), granted: false, fallback: false, dudIdx: p.dudIdx, forced: p.forced, pity: p.count,
    };
    void this.emit(ev, () => {
      let coins = ev.coins;
      if (c.kind === 'charm' && !c.dupe) {
        if (this.ctx.run.grantCharm(c.charmId)) {
          ev.granted = true;
        } else {
          // peg board full, or the run refuses charm grants right now: pay the reference price in coins
          coins = Math.round(REF_PRICE[c.rarity as Exclude<Rarity, 'dud' | 'coins'>] * si);
          ev.fallback = true;
          ev.coins = coins;
        }
      }
      const count = this.pityCount();
      const next = nextPity(count, p.tier, c.rarity);
      if (next !== count) this.ctx.run.stat(PITY_KEY(this.selfId), next - count);
      this.settle({ gross: coins, tags: [c.rarity, ...(c.dupe ? ['dupe'] : [])] });
    });
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'vend': return this.presentVend(ev, pc);
      case 'open': return this.presentOpen(ev, pc);
    }
  }

  /** CRANK (0.9 s, three ratchet clicks) → ROLL (1.2 s down the spiral, rattling) → IN HAND at the exit. */
  private async presentVend(ev: Extract<Ev, { k: 'vend' }>, pc: PresentCtx): Promise<void> {
    const { cranks, capsuleTop, capsuleBottom, rollPath, revealAnchor, chuteFlap } = this.parts;
    const colour = new THREE.Color().setHSL(ev.cap / 360, 0.75, 0.55);
    for (const g of [capsuleTop, capsuleBottom]) {
      g.traverse((c) => { if (c instanceof THREE.Mesh) (c.material as THREE.MeshLambertMaterial).color?.copy(colour); });
    }
    this.vendPrice = ev.price;
    this.refreshHud(true);
    const crank = cranks[ev.tier];
    if (!pc.fast) {
      this.sfx('ratchet');
      void crank.turn(1, 0.9 * this.speed);
      let clicks = 0;
      await this.anim(0.9, (k) => {
        const n = Math.floor(k * 3);
        if (n > clicks) { clicks = n; this.sfx('ratchet'); }
      });
    } else {
      void crank.turn(1, 0.1);
    }

    // ROLL: the capsule rides the helix from the top of the stand to the exit
    for (const g of [capsuleTop, capsuleBottom]) g.visible = true;
    const pos = (k: number): void => {
      const f = Math.min(1, Math.max(0, k)) * (rollPath.length - 1);
      const i = Math.min(rollPath.length - 2, Math.floor(f));
      const q = f - i;
      const a = rollPath[i], b = rollPath[i + 1];
      const x = lerp(a[0], b[0], q), y = lerp(a[1], b[1], q), z = lerp(a[2], b[2], q);
      for (const g of [capsuleTop, capsuleBottom]) { g.position.set(x, y, z); g.rotation.y += 0.25; }
    };
    if (pc.fast) {
      pos(1);
    } else {
      let knocks = 0;
      await this.anim(1.2 * this.speed, (k) => {
        pos(k);
        const n = Math.floor(k * 9);
        if (n > knocks) { knocks = n; this.sfx('tileClack', { pos: revealAnchor }); }
      }, 'inQuad');
      // exit flap swings out then back, like the capsule knocked it
      await this.anim(0.2, (k) => { chuteFlap.rotation.x = -Math.sin(k * Math.PI) * 0.6; });
      chuteFlap.rotation.x = 0;
    }

    // IN HAND: the capsule floats at the reveal anchor and waits for the twist
    for (const g of [capsuleTop, capsuleBottom]) g.position.copy(revealAnchor.position);
    this.inHand = this.isLocalOccupant;
    this.refreshHud(true);
  }

  /** SHAKE (0.35 s × 1–3; legendary adds a 0.6 s fake-out before the 4th) → OPEN pop → REVEAL 1.5 s with a beam. */
  private async presentOpen(ev: Extract<Ev, { k: 'open' }>, pc: PresentCtx): Promise<void> {
    this.inHand = false;
    const { capsuleTop, capsuleBottom, revealAnchor, rarityBeam } = this.parts;
    const rarity = ev.rarity as Rarity;
    const at = revealAnchor;
    this.revealing = true;
    this.callResult(ev);
    this.refreshHud(true);

    if (!pc.fast) {
      const shakes = rarity === 'uncommon' ? 2 : isRarePlus(rarity) ? 3 : 1;
      for (let s = 0; s < shakes; s++) {
        if (rarity === 'legendary' && s === 3) await this.wait(0.6);
        this.sfx('tileClack', { pos: at });
        await this.anim(0.35, (k) => {
          const w = Math.sin(k * Math.PI * 4) * 0.25 * (1 - k * 0.5);
          for (const g of [capsuleTop, capsuleBottom]) g.rotation.z = w;
        });
      }
      for (const g of [capsuleTop, capsuleBottom]) g.rotation.z = 0;

      // OPEN: the halves pop apart
      this.sfx('popUp');
      await this.anim(0.3, (k) => {
        capsuleTop.position.y = at.position.y + k * 0.09;
        capsuleBottom.position.y = at.position.y - k * 0.05;
      }, 'outBack');
      capsuleTop.visible = false;
      capsuleBottom.visible = false;
    } else {
      capsuleTop.visible = false;
      capsuleBottom.visible = false;
    }

    // REVEAL: the item floats up with a rarity beam
    const { name, colour, scale } = this.describe(ev);
    const beamColour = rarity === 'legendary' ? GOLD : rarity === 'cursed' ? VIOLET : rarity === 'rare' ? BLUE : rarity === 'uncommon' ? GREEN : WHITE;
    (rarityBeam.material as THREE.MeshBasicMaterial).color.setHex(beamColour);
    rarityBeam.visible = true;
    rarityBeam.position.copy(at.position);
    rarityBeam.position.y += 1.25;
    this.parts.leds.win.setOn(rarity !== 'dud');
    this.ctx.fx.popText(at, name, colour, { scale, dur: 1.5 });

    if (!pc.fast) {
      switch (rarity) {
        case 'dud': this.sfx('whoosh'); this.sfx('lose'); break;
        case 'coins': this.sfx('coinPour'); break;
        case 'common': this.sfx('chime'); break;
        case 'uncommon': this.sfx('win1'); void this.wait(0.12).then(() => this.sfx('win1')); break;
        case 'rare': this.sfx('win2'); void this.wait(0.08).then(() => this.sfx('sparkle')); break;
        case 'legendary': this.sfx('win3'); this.sfx('bell'); this.ctx.fx.flash(GOLD, 0.3, 0.4); this.ctx.fx.zoomPunch(0.04, 0.3); break;
        case 'cursed': this.sfx('stinger'); this.sfx('lose'); this.ctx.fx.tint(VIOLET, 0.25, 1.5); break;
      }
      if (ev.granted) this.sfx('stamp');
      if (ev.coins > 0 || ev.fallback) this.ctx.fx.coins(this.model.anchors.coinOut, 8, { spread: 0.1, up: 0.2 });
      if (ev.forced) this.ctx.fx.popText(at, this.t('pity'), GOLD, { scale: 1.1 });
      if (rarity === 'cursed') this.ctx.fx.flash(VIOLET, 0.15, 0.6);
    }

    // beam fades in, holds, and fades out over the 1.5 s reveal
    const mat = rarityBeam.material as THREE.MeshBasicMaterial;
    await this.anim(0.3, (k) => { mat.opacity = 0.6 * k; });
    await this.wait(1.2);
    await this.anim(0.3, (k) => { mat.opacity = 0.6 * (1 - k); });
    rarityBeam.visible = false;
    mat.opacity = 0.6;
    this.parts.leds.win.setOn(false);
    this.revealing = false;
    this.refreshHud(true);
  }

  /** Label text, colour and scale for the reveal of one open event. */
  private describe(ev: Extract<Ev, { k: 'open' }>): { name: string; colour: number; scale: number } {
    const rarity = ev.rarity as Rarity;
    if (ev.kind === 'dud') return { name: this.t(ev.dudIdx === 0 ? 'dud' : `dud${ev.dudIdx + 1}`), colour: 0xc8b8a0, scale: 1 };
    if (ev.kind === 'coins') return { name: this.t('coins', { n: fmtNum(ev.coins) }), colour: 0xffd060, scale: 1.1 };
    if (ev.kind === 'empty') return { name: this.t('empty', { n: fmtNum(ev.coins) }), colour: 0xffd060, scale: 1.0 };
    if (ev.dupe) return { name: this.t('dupe', { n: fmtNum(ev.coins) }), colour: 0xffd060, scale: 1.0 };
    const charmName = tr(`charm.${ev.charmId}.name`);
    if (ev.fallback) return { name: `${this.t('pegFull', { n: fmtNum(ev.coins) })}`, colour: 0xffd060, scale: 1.0 };
    const colour = rarity === 'legendary' ? GOLD : rarity === 'cursed' ? 0xc0a0ff : rarity === 'rare' ? 0x90c0ff : 0xffe0a0;
    const scale = rarity === 'legendary' ? 1.6 : rarity === 'rare' ? 1.3 : 1.0;
    return { name: `${charmName}`, colour, scale };
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────────────────────────
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }

  private refuse(why: string): void {
    this.sfx('buzzer');
    if (this.isLocalOccupant) this.toast(this.t(why), 'warn');
  }

  private refreshHud(force: boolean): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const key = [this.tierSel, this.wallet(), this.price(this.tierSel), this.pityCount(), this.inHand ? 1 : 0,
      this.pending ? 1 : 0, this.revealing ? 1 : 0].join('|');
    if (!force && key === this.hudKey) return;
    this.hudKey = key;
    const pity = pityThreshold(this.mod('m.lootbox.pityAt', 0));
    const count = this.pityCount();
    sh.goal(this.tx('goal'));
    if (this.revealing) sh.state(this.tx('stReveal'), 'neutral');
    else if (this.pending && this.inHand) sh.state(this.tx('stTwist'), 'good', this.tx('stTwistSub'));
    else if (this.pending) sh.state(this.tx('stRoll'), 'cyan');
    else sh.state(this.tx('stReady'), 'gold', this.tx('stReadySub'));
    sh.numbers([
      { label: this.tx('nTier'), value: this.t(tierDef(this.tierSel).id), tone: 'gold' },
      { label: this.tx('nPrice'), value: fmtNum(this.price(this.tierSel)), tone: 'neutral' },
      { label: this.tx('nPity'), value: `${count}/${pity}`, tone: count >= pity - 2 ? 'warn' : 'neutral' },
      { label: this.tx('nBalance'), value: fmtNum(this.wallet()), tone: 'neutral' },
    ]);

    const ctrl: HudControl[] = [];
    if (this.pending && this.inHand) {
      ctrl.push({ key: this.k('primary'), label: this.tx('cTwist'), action: 'primary', primary: true });
    } else if (!this.pending && !this.revealing) {
      ctrl.push({ key: this.k('primary'), label: this.tx('cCrank'), action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n3')}`, label: this.tx('cTier'), action: 'n1' });
    }
    ctrl.push({ key: this.k('help'), label: this.tx('cContents'), action: 'help' });
    ctrl.push({ key: this.k('exit'), label: this.tx('cLeave'), action: 'exit' });
    sh.controls(ctrl);
  }

  // ── seat HUD helpers ────────────────────────────────────────────────────────────────────────────
  private tx(key: string, v?: I18nVars): Txt { return v ? { k: `m.lootbox.${key}`, v } : { k: `m.lootbox.${key}` }; }
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private tipLines(): Txt[] {
    return [
      this.tx('tip1', { tiers: `${this.k('n1')}-${this.k('n3')}`, crank: this.k('primary') }),
      this.tx('tip2', { twist: this.k('primary') }),
      this.tx('tip3', { help: this.k('help') }),
    ];
  }
  /** Contents card (H): the three tier tables. */
  private contentsLines(): Txt[] {
    return [this.tx('tableTin'), this.tx('tableBrass'), this.tx('tableGilded'), this.tx('pityRule')];
  }
  /** Result callout for one open: net = coins paid − price; a charm grant is a win with no amount shown. */
  private callResult(ev: Extract<Ev, { k: 'open' }>): void {
    if (!this.isLocalOccupant) return;
    if (ev.granted) { this.seatHud?.result('win', 0); return; }
    const net = ev.coins - this.vendPrice;
    this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }
}
