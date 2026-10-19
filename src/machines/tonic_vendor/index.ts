/**
 * Apothecary (`tonic_vendor`, system) — buys tonics: timed buffs that feed the modifier pipeline (BRIEF ADDENDUM 3).
 * Stock, prices and buffs come from rules.ts and data/buffs.ts. The coins move through `run.spend('coin')` in the credit
 * step; the dose is applied with `run.buffs.add(id, { pid })` and a totem with `run.totems.grant(pid, id)`. The machine never prices anything itself.
 *
 * Controls (seated): 1–4 or ←/→ pick a bottle · Space/Enter buy · W/S flip between the TONICS and the FOOD page · E stands up.
 * The food page sells five snacks (banana, coffee, sandwich, energy drink, çay), 1–5 pick, one food bonus at a time (src/game/food.ts).
 * It is Selim's bar: opening it emits `bar:food` for the local player, and src/game/food.ts plays him (greeting, tip, TIP / PAY BACK).
 * Every peer draws the same shelf from the same run seed and Night. `present()` plays the juice for the local choices.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { bus } from '@/core/events';
import { lerp } from '@/core/math';
import { BOTTLE_X, buildModel, DRAWER_SLIDE, FOOD_X, type TonicVendorParts } from './model';
import { FOOD_BUFF_IDS, FOOD_SLOTS, SLOTS, foodStock, priceText, stockKey, tonicStock, wrapSlot, type TonicJuice, type TonicKind, type TonicOffer } from './rules';

declare module '@/core/events' {
  interface GameEvents {
    /** The local player opened the food page: Selim's bar (src/game/food.ts answers). */
    'bar:food': Record<string, never>;
  }
}

type Ev =
  /** A sale. `why` names the refusal when `ok` is false. */
  { k: 'buy'; i: number; kind: TonicKind; id: string; price: number; juice: TonicJuice; ok: boolean; why: string };

/** Display name / one-line effect of a shelf slot (tonic buffs and totems keep their strings under different prefixes). */
const nameOf = (o: Pick<TonicOffer, 'kind' | 'id'>): string => tr(`${o.kind === 'totem' ? 'totem' : 'buff'}.${o.id}.name`);
const descOf = (o: Pick<TonicOffer, 'kind' | 'id'>): string => tr(`${o.kind === 'totem' ? 'totem' : 'buff'}.${o.id}.desc`);

const GREEN = 0x60ff90;
const BLUE = 0x60a0ff;
const VIOLET = 0x8040ff;

export const def: MachineDef = {
  id: 'tonic_vendor',
  category: 'system',
  slotSize: 'M',
  zone: 'services',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'shop', 'apothecary'],
  modHooks: {},
  strings: {
    en: {
      name: 'Apothecary',
      desc: 'Tonics behind the glass. Each dose changes the odds for a while. Every dose has a side effect.',
      h_pick: 'PICK', h_buy: 'DRINK', h_leave: 'LEAVE',
      s_coins: 'COINS', s_dose: 'DOSE', s_length: 'LASTS',
      funds: 'NOT ENOUGH COINS', none: 'EMPTY SHELF', hand: 'HAND ALREADY FULL',
      ledger: 'APOTHECARY', ledgerHint: '1-4 PICK  SPACE DRINK  W/S FOOD',
      ledgerFood: 'FOOD COUNTER', ledgerHintFood: '1-5 PICK  SPACE EAT  W/S TONICS', h_eat: 'EAT',
      pageTonic: 'TONICS', pageFood: 'FOOD', s_food: 'FOOD', s_bonus: 'BONUS',
      free: 'FREE',
    },
    tr: {
      name: 'Eczane',
      desc: 'Camın arkasında tonikler. Her doz bir süre oranları değiştirir. Her dozun bir yan etkisi var.',
      h_pick: 'SEÇ', h_buy: 'İÇ', h_leave: 'AYRIL',
      s_coins: 'PARA', s_dose: 'DOZ', s_length: 'SÜRE',
      funds: 'PARA YETMİYOR', none: 'RAF BOŞ', hand: 'ELİ DOLU',
      ledger: 'ECZANE', ledgerHint: '1-4 SEÇ  BOŞLUK İÇ  W/S YEMEK',
      ledgerFood: 'YEMEK TEZGAHI', ledgerHintFood: '1-5 SEÇ  BOŞLUK YE  W/S TONİK', h_eat: 'YE',
      pageTonic: 'TONİKLER', pageFood: 'YEMEK', s_food: 'YEMEK', s_bonus: 'ETKİ',
      free: 'BEDAVA',
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class TonicVendor extends MachineBase<TonicVendorParts, Ev, null> {
  private cursor = 0;
  /** false: the tonic shelf; true: the food page (W/S flips). */
  private foodPage = false;
  private shelf: readonly TonicOffer[] = [];
  private shelfNight = -1;
  private shelfSeed = NaN;
  private stockCache: readonly TonicOffer[] = [];
  private readonly foodShelf: readonly TonicOffer[] = foodStock();
  private repaintKey = '';
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<TonicVendorParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh(true);
    this.attractor.every('glint', 9, () => this.ctx.fx.glow(this.model.anchors.light, GREEN, 0.25, 0.5), { first: 5 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  /** The shelf is a pure function of (seed, Night): memoised so the per-frame refresh does not re-roll it. */
  private stock(): readonly TonicOffer[] {
    if (this.foodPage) return this.foodShelf;
    const run = this.ctx.run;
    const night = run.night();
    if (night !== this.shelfNight || run.seed !== this.shelfSeed) {
      this.shelfNight = night;
      this.shelfSeed = run.seed;
      this.shelf = tonicStock(run.seed, night);
    }
    return this.shelf;
  }
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }

  tick(_dt: number): void {
    this.refresh(false);
  }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    if (local) { this.sfx('chime'); this.refresh(true); if (this.foodPage) bus.emit('bar:food', {}); }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.ctx.ui.machineHud(null); this.hudKey = ''; }
  }

  onLang(): void {
    this.repaintKey = '';
    this.hudKey = '';
    this.refresh(true);
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down || e.repeat) return;
    switch (e.action) {
      case 'left': this.moveCursor(wrapSlot(this.cursor, -1, this.slots())); return;
      case 'right': this.moveCursor(wrapSlot(this.cursor, 1, this.slots())); return;
      case 'up': case 'down':
        this.foodPage = !this.foodPage; this.cursor = Math.min(this.cursor, this.slots() - 1); this.sfx('hover'); this.refresh(true);
        if (this.foodPage) bus.emit('bar:food', {});
        return;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': this.moveCursor(Number(e.action.slice(1)) - 1); return;
      case 'primary': case 'confirm': this.buy(this.cursor); return;
    }
  }

  /** The slots on this page: the tonic shelf has four, the food page five. */
  private slots(): number { return this.foodPage ? FOOD_SLOTS : SLOTS; }

  private moveCursor(i: number): void {
    if (i >= this.slots()) return;
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  /** Purchase: refusals are checked here; the coins and the dose or totem move in the credit step. */
  private buy(i: number): void {
    const offer = this.stock()[i] ?? null;
    if (!offer || i >= this.slots()) { void this.emit({ k: 'buy', i, kind: 'buff', id: '', price: 0, juice: 'plain', ok: false, why: 'none' }); return; }
    const run = this.ctx.run;
    const why = offer.kind === 'totem' && this.handBusy() ? 'hand'
      : offer.price > 0 && !run.canAfford(offer.price, this.selfId) ? 'funds' : '';
    void this.emit(
      { k: 'buy', i, kind: offer.kind, id: offer.id, price: offer.price, juice: offer.juice, ok: why === '', why },
      why === '' ? () => this.sell(offer) : undefined,
    );
  }

  /** A carried totem already sits in the hand slot (one hand totem at a time). */
  private handBusy(): boolean {
    const totems = this.ctx.run.totems;
    return totems.mine(this.selfId).some((t) => t.pos === null && totems.def(t.def)?.carry === 'hand');
  }

  /** Credit step: a totem is granted first (so a full hand refunds nothing), then the coins move. */
  private sell(o: TonicOffer): void {
    const run = this.ctx.run;
    if (o.kind === 'totem') {
      const uid = run.totems.grant(this.selfId, o.id);
      if (!uid) { this.ctx.ui.toast(this.t('hand'), 'bad'); return; }
      if (o.price > 0 && !run.spend('coin', o.price, 'totem', this.selfId)) {
        run.totems.discard(uid);
        this.ctx.ui.toast(this.t('funds'), 'bad');
      }
      return;
    }
    if (o.price > 0 && !run.spend('coin', o.price, 'tonic', this.selfId)) {
      this.ctx.ui.toast(this.t('funds'), 'bad');
      return;
    }
    if (o.kind === 'food') {
      // one food bonus at a time: the old one goes first, so eating the same snack again still plays. The buff's own hook does the rest.
      for (const id of FOOD_BUFF_IDS) if (run.buffs.has(id, { pid: this.selfId })) run.buffs.remove(id, { pid: this.selfId });
      run.buffs.add(o.id, { pid: this.selfId, source: { kind: 'system', id: 'food' } });
      return;
    }
    run.buffs.add(o.id, { pid: this.selfId, source: { kind: 'tonic', id: o.id } });
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    return this.presentBuy(ev, pc);
  }

  private denied(why: string): void {
    this.sfx('error');
    const dr = this.parts.drawer;
    const z0 = dr.position.z;
    void this.anim(0.2, (k) => { dr.position.z = z0 + Math.sin(k * Math.PI * 6) * 0.012; });
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentBuy(ev: Ev, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    const { drawer } = this.parts;
    const bottles = this.foodPage ? this.parts.foods : this.parts.bottles;
    const fx = this.ctx.fx;
    const anchor = this.model.anchors.coinOut;
    const name = nameOf(ev);
    if (pc.fast) { this.refresh(true); return; }

    // anticipation: the drawer slides out, the bottle is tilted up
    this.sfx('button');
    const z0 = drawer.position.z;
    const bottle = bottles[ev.i] ?? null;
    const b0 = bottle ? bottle.position.y : 0;
    await this.anim(0.14, (k) => {
      drawer.position.z = lerp(z0, z0 + DRAWER_SLIDE, k);
      if (bottle) bottle.rotation.z = lerp(0, 0.25, k);
    }, 'outQuad');

    // action: the coins change hands; a cursed jar pays you a sign-on fee
    if (ev.price > 0) { this.sfx('cashRegister'); fx.coins(anchor, 8, { spread: 0.1, up: 0.2 }); }
    else this.sfx('purchase');

    // impact: tier by juice
    const at = bottle ?? anchor;
    switch (ev.juice) {
      case 'rare':
        this.sfx('win2'); fx.flash(BLUE, 0.18, 0.3); fx.popText(at, name, BLUE, { scale: 1.3 });
        break;
      case 'cursed':
        this.sfx('porcelainCrack'); fx.tint(VIOLET, 0.25, 0.6); fx.popText(at, name, VIOLET, { scale: 1.2 });
        break;
      default:
        this.sfx('stamp'); fx.popText(at, name, GREEN, { scale: 1.0 });
    }
    if (bottle) {
      await this.anim(0.25, (k) => {
        bottle.position.y = b0 + Math.sin(k * Math.PI) * 0.12;
        bottle.rotation.z = lerp(0.25, 0, k);
      }, 'outQuad');
      bottle.position.y = b0;
    }

    // follow-through: the drawer returns, the ledger repaints
    await this.anim(0.25, (k) => { drawer.position.z = lerp(z0 + DRAWER_SLIDE, z0, k); }, 'outQuad');
    this.refresh(true);
  }

  // ── screens, tags and HUD ───────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const stock = this.stock();
    this.stockCache = stock;
    const key = [stockKey(stock), this.wallet(), this.cursor, this.foodPage ? 'f' : 't'].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;

    for (let i = 0; i < FOOD_SLOTS; i++) {
      this.parts.tags[i]?.setText(priceText(stock[i] ?? null, fmtNum, this.t('free')));
    }
    this.applyPage();
    this.drawLedger(stock);
    if (this.isLocalOccupant) this.showHud();
  }

  /** The food page shows snacks on the counter (the bottles hide), the page sign switches and the ledger turns amber. */
  private applyPage(): void {
    const { bottles, foods, sign } = this.parts;
    for (const b of bottles) b.visible = !this.foodPage;
    for (const f of foods) f.visible = this.foodPage;
    // the price tags follow the page: under the bottles (four), or under the five snacks
    this.parts.tags.forEach((tag, i) => {
      const x = (this.foodPage ? FOOD_X : BOTTLE_X)[i];
      tag.mesh.visible = x !== undefined;
      if (x !== undefined) tag.mesh.position.x = x;
    });
    sign.setText(this.t(this.foodPage ? 'pageFood' : 'pageTonic'));
  }

  private drawLedger(stock: readonly TonicOffer[]): void {
    const s = this.parts.ledger;
    s.clear(this.foodPage ? '#14100a' : '#081410');
    s.text(this.t(this.foodPage ? 'ledgerFood' : 'ledger'), 64, 10, { font: 'px5', color: this.foodPage ? '#ffd060' : '#80ffb0', align: 'center' });
    for (let i = 0; i < this.slots(); i++) {
      const o = stock[i] ?? null;
      const y = 24 + i * 10;
      const mark = i === this.cursor ? '>' : ' ';
      const name = o ? nameOf(o).slice(0, 14) : this.t('none');
      s.text(`${mark}${i + 1} ${name}`, 4, y, { font: 'px5', color: o?.juice === 'cursed' ? '#c0a0ff' : '#c8ffe0' });
      s.text(o ? priceText(o, fmtNum, this.t('free')) : '--', 124, y, { font: 'px5', color: '#ffd060', align: 'right' });
    }
    s.text(this.t(this.foodPage ? 'ledgerHintFood' : 'ledgerHint'), 64, 72, { font: 'px5', color: '#50a070', align: 'center' });
  }

  private showHud(): void {
    const sel = this.stockCache[this.cursor] ?? null;
    const key = [this.cursor, this.wallet(), this.foodPage ? 'f' : 't', sel ? `${sel.kind}:${sel.id}` : ''].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const hints: HudHint[] = [
      { action: 'left', label: this.t('h_pick') },
      { action: 'primary', label: this.t(this.foodPage ? 'h_eat' : 'h_buy') },
      { action: 'up', label: this.t(this.foodPage ? 'pageTonic' : 'pageFood') },
      { action: 'exit', label: this.t('h_leave') },
    ];
    this.hud({
      title: this.t(this.foodPage ? 'ledgerFood' : 'ledger'),
      bet: null,
      hints,
      stats: [
        { label: this.t('s_coins'), value: fmtNum(this.wallet()) },
        { label: this.t(this.foodPage ? 's_food' : 's_dose'), value: sel ? nameOf(sel) : '--' },
        { label: this.t(this.foodPage ? 's_bonus' : 's_length'), value: sel ? descOf(sel) : '--' },
      ],
    });
  }
}

