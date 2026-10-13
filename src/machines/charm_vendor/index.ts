/**
 * Pawn Window (`charm_vendor`, system) — the shop of GDD §4.1, open only in intermissions. devices-core lane.
 *
 * Stock, odds, prices and Ticket costs come from game-charms through `pawnFrom(ctx.run)` (`PawnApi`, see rules.ts).
 * The purchase itself goes through `ctx.run.buyCharm(charmId, price)`. Coins are checked with `run.canAfford`, Tickets
 * with `run.balance('ticket')`. The machine never prices anything.
 *
 * Controls (seated): 1–4 or ←/→ pick a slot · Space/Enter buy · Z/X are unused · R (double) locks the slot for the next
 * visit (1 Ticket) · Q (collect) removes the curse from your first cursed charm (5 Tickets) · E stands up.
 * Reroll is the ALT key (1 Ticket, +1 per further reroll this intermission).
 *
 * Every peer draws the same stock from the same state (tags, ledger, ticket LED, shutter). `present()` plays the juice
 * for the local choices. Credit first, present after: the wallet step runs inside `emit`'s credit.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, SHUTTER_DROP, type CharmVendorParts } from './model';
import {
  LOCK_TICKETS, REMOVE_CURSE_TICKETS, SLOTS, buyJuice, pawnFrom, priceText, stockKey, wrapSlot,
  type PawnApi, type PawnSlot,
} from './rules';

type Juice = 'plain' | 'rare' | 'legend' | 'cursed';
type Ev =
  /** A purchase. `why` names the refusal when `ok` is false. */
  | { k: 'buy'; i: number; charmId: string; price: number; juice: Juice; ok: boolean; why: string }
  | { k: 'reroll'; ok: boolean; why: string }
  | { k: 'lock'; i: number; ok: boolean; why: string }
  | { k: 'curse'; charmId: string; ok: boolean; why: string };

const GOLD = 0xffd040;
const BLUE = 0x60a0ff;
const VIOLET = 0x8040ff;
const IDLE_DRUM_S = 10;

export const def: MachineDef = {
  id: 'charm_vendor',
  category: 'system',
  slotSize: 'L',
  zone: 'services',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'shop'],
  modHooks: {},
  strings: {
    en: {
      name: 'Pawn Window',
      desc: 'Charms under the counter, in intermissions only. Everything has a price.',
      h_pick: 'PICK', h_buy: 'BUY', h_reroll: 'REROLL', h_lock: 'LOCK', h_curse: 'UNCURSE', h_leave: 'LEAVE',
      s_coins: 'COINS', s_tickets: 'TICKETS', s_item: 'ITEM',
      closed: 'WINDOW CLOSED', funds: 'NOT ENOUGH COINS', tickets: 'NO TICKETS', none: 'NOTHING THERE',
      noService: 'NOTHING TO UNCURSE', free: 'FREE', locked: 'LOCKED', rerolled: 'NEW STOCK', cleansed: 'CLEANSED',
      sold: 'SOLD', paid: 'PAID', ledger: 'PAWN LEDGER', ledgerClosed: 'CLOSED',
      ledgerHint: '1-4 PICK  SPACE BUY', ledgerTickets: 'TICKETS',
    },
    tr: {
      name: 'Rehin Penceresi',
      desc: 'Tezgahın altında tılsımlar, yalnızca aralarda. Her şeyin bir fiyatı var.',
      h_pick: 'SEÇ', h_buy: 'AL', h_reroll: 'YENİLE', h_lock: 'KİLİTLE', h_curse: 'LANET AÇ', h_leave: 'AYRIL',
      s_coins: 'PARA', s_tickets: 'BİLET', s_item: 'EŞYA',
      closed: 'PENCERE KAPALI', funds: 'PARA YETMİYOR', tickets: 'BİLET YOK', none: 'BURADA BİR ŞEY YOK',
      noService: 'AÇILACAK LANET YOK', free: 'BEDAVA', locked: 'KİLİTLİ', rerolled: 'YENİ STOK', cleansed: 'TEMİZLENDİ',
      sold: 'SATILDI', paid: 'ÖDENDİ', ledger: 'REHİN DEFTERİ', ledgerClosed: 'KAPALI',
      ledgerHint: '1-4 SEÇ  BOŞLUK AL', ledgerTickets: 'BİLET',
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class CharmVendor extends MachineBase<CharmVendorParts, Ev, null> {
  private cursor = 0;
  private stockCache: readonly (PawnSlot | null)[] = [];
  private repaintKey = '';
  private hudKey = '';
  private idle = 0;
  private drumming = false;

  protected createModel(kit: KitX): MachineModel<CharmVendorParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh(true);
    this.attractor.every('glint', 11, () => this.ctx.fx.glow(this.model.anchors.light, GOLD, 0.25, 0.5), { first: 6 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private pawn(): PawnApi | null { return pawnFrom(this.ctx.run); }
  private open(): boolean { const p = this.pawn(); return p !== null && p.open(); }
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }
  private tickets(): number { return this.ctx.run.balance('ticket', this.selfId); }

  tick(dt: number): void {
    const target = this.open() ? 0 : -SHUTTER_DROP;
    const sh = this.parts.shutter;
    sh.position.y += (target - sh.position.y) * Math.min(1, dt * 6);
    this.idle += dt;
    this.refresh(false);
  }

  frame(_dt: number, t: number): void {
    // idle: the Pawnbroker drums ringed fingers on the counter
    const drum = this.idle > IDLE_DRUM_S && !this.busy;
    if (drum !== this.drumming) { this.drumming = drum; if (!drum) this.parts.hands.rotation.x = 0; }
    if (drum) this.parts.hands.rotation.x = Math.sin(t * 14) * 0.08;
  }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    this.idle = 0;
    if (local) { this.sfx('chime'); this.refresh(true); }
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
    this.idle = 0;
    switch (e.action) {
      case 'left': this.moveCursor(wrapSlot(this.cursor, -1)); return;
      case 'right': this.moveCursor(wrapSlot(this.cursor, 1)); return;
      case 'n1': case 'n2': case 'n3': case 'n4': this.moveCursor(Number(e.action.slice(1)) - 1); return;
      case 'primary': case 'confirm': this.buy(this.cursor); return;
      case 'alt': this.reroll(); return;
      case 'double': this.lock(this.cursor); return;
      case 'collect': this.uncurse(); return;
    }
  }

  private moveCursor(i: number): void {
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  /** Purchase: refusal reasons are checked here; the coins move in the credit step; the stock is read again next tick. */
  private buy(i: number): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'buy', i, charmId: '', price: 0, juice: 'plain', ok: false, why: 'closed' }); return; }
    const slot = pawn.stock(this.selfId)[i] ?? null;
    if (!slot) { void this.emit({ k: 'buy', i, charmId: '', price: 0, juice: 'plain', ok: false, why: 'none' }); return; }
    const ok = slot.price <= 0 || this.ctx.run.canAfford(slot.price, this.selfId);
    const why = ok ? '' : 'funds';
    const juice = buyJuice(slot.rarity, slot.cursed);
    void this.emit(
      { k: 'buy', i, charmId: slot.charmId, price: slot.price, juice, ok, why },
      ok ? () => { if (!this.ctx.run.buyCharm(slot.charmId, slot.price)) this.ctx.ui.toast(this.t('funds'), 'bad'); } : undefined,
    );
  }

  private reroll(): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'reroll', ok: false, why: 'closed' }); return; }
    const cost = pawn.rerollCost();
    const ok = this.tickets() >= cost;
    void this.emit({ k: 'reroll', ok, why: ok ? '' : 'tickets' }, ok ? () => { pawn.reroll(); } : undefined);
  }

  private lock(i: number): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'lock', i, ok: false, why: 'closed' }); return; }
    const slot = pawn.stock(this.selfId)[i] ?? null;
    if (!slot) { void this.emit({ k: 'lock', i, ok: false, why: 'none' }); return; }
    const ok = this.tickets() >= LOCK_TICKETS && !slot.locked;
    void this.emit({ k: 'lock', i, ok, why: ok ? '' : (slot.locked ? 'locked' : 'tickets') }, ok ? () => { pawn.lock(i); } : undefined);
  }

  private uncurse(): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'curse', charmId: '', ok: false, why: 'closed' }); return; }
    const id = pawn.cursedOwned(this.selfId)[0];
    if (id === undefined) { void this.emit({ k: 'curse', charmId: '', ok: false, why: 'noService' }); return; }
    const ok = this.tickets() >= REMOVE_CURSE_TICKETS;
    void this.emit({ k: 'curse', charmId: id, ok, why: ok ? '' : 'tickets' }, ok ? () => { pawn.removeCurse(id); } : undefined);
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'buy': return this.presentBuy(ev, pc);
      case 'reroll': return this.presentReroll(ev);
      case 'lock': return this.presentLock(ev);
      case 'curse': return this.presentCurse(ev);
    }
  }

  private denied(why: string): void {
    this.sfx('error');
    const sh = this.parts.shutter;
    const y0 = sh.position.y;
    void this.anim(0.2, (k) => { sh.position.y = y0 + Math.sin(k * Math.PI * 6) * 0.01; });
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentBuy(ev: Extract<Ev, { k: 'buy' }>, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    const { tray, itemSlots } = this.parts;
    const fx = this.ctx.fx;
    const anchor = this.model.anchors.coinOut;
    const name = tr(`charm.${ev.charmId}.name`);
    if (pc.fast) { this.refresh(true); return; }

    // anticipation: the tray slides out to the customer
    this.sfx('button');
    const trayZ0 = tray.position.z;
    await this.anim(0.14, (k) => { tray.position.z = lerp(trayZ0, trayZ0 + 0.3, k); }, 'outQuad');

    // action: coins change hands; a cursed sale pays the customer
    if (ev.price > 0) {
      this.sfx('cashRegister');
      fx.coins(anchor, 10, { spread: 0.1, up: 0.2 });
    } else if (ev.price < 0) {
      this.sfx('coinPour');
      void this.pourCoins(-ev.price);
    } else {
      this.sfx('purchase');
    }
    this.parts.lamp.blink(6, 0.4);

    // impact: tier by rarity
    const slotObj = itemSlots[ev.i];
    const at = slotObj ?? anchor;
    switch (ev.juice) {
      case 'legend':
        this.sfx('win3'); fx.flash(GOLD, 0.3, 0.4); fx.zoomPunch(0.04, 0.3); fx.popText(at, name, GOLD, { scale: 1.6, dur: 1.4 });
        break;
      case 'rare':
        this.sfx('win2'); fx.flash(BLUE, 0.18, 0.3); fx.popText(at, name, BLUE, { scale: 1.3 });
        break;
      case 'cursed':
        this.sfx('porcelainCrack'); fx.tint(VIOLET, 0.25, 0.6); fx.popText(at, name, VIOLET, { scale: 1.2 });
        break;
      default:
        this.sfx('stamp'); fx.popText(at, name, GOLD, { scale: 1.0 });
    }

    // follow-through: the tray returns, the ledger stamps
    await this.anim(0.25, (k) => { tray.position.z = lerp(trayZ0 + 0.3, trayZ0, k); }, 'outQuad');
    this.sfx('stamp');
    this.refresh(true);
  }

  private async presentReroll(ev: Extract<Ev, { k: 'reroll' }>): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    this.sfx('shuffle');
    const hands = this.parts.hands;
    this.parts.lamp.blink(8, 0.4);
    await this.anim(0.4, (k) => { hands.rotation.y = Math.sin(k * Math.PI * 2) * 0.4; });
    hands.rotation.y = 0;
    this.ctx.fx.popText(this.model.anchors.prompt, this.t('rerolled'), GOLD, { scale: 1.1 });
    this.refresh(true);
  }

  private async presentLock(ev: Extract<Ev, { k: 'lock' }>): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    this.sfx('click');
    const tag = this.parts.tags[ev.i];
    if (tag) this.ctx.fx.squash(tag.mesh, 0.15, 0.2);
    this.ctx.fx.popText(this.parts.itemSlots[ev.i] ?? this.model.anchors.prompt, this.t('locked'), GOLD, { scale: 1.1 });
    this.refresh(true);
  }

  private async presentCurse(ev: Extract<Ev, { k: 'curse' }>): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    this.sfx('sparkle');
    this.ctx.fx.flash(VIOLET, 0.25, 0.4);
    this.ctx.fx.tint(VIOLET, 0.2, 0.6);
    this.ctx.fx.popText(this.model.anchors.prompt, this.t('cleansed'), 0xc0a0ff, { scale: 1.4 });
    this.refresh(true);
  }

  // ── screens, tags and HUD ───────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const pawn = this.pawn();
    const open = pawn !== null && pawn.open();
    const stock = pawn && open ? pawn.stock(this.selfId) : [];
    this.stockCache = stock;
    const key = [stockKey(stock), open ? 1 : 0, this.wallet(), this.tickets(), this.cursor].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;

    for (let i = 0; i < SLOTS; i++) {
      const s = stock[i] ?? null;
      const txt = !open ? '--' : s?.locked ? this.t('locked') : priceText(s, fmtNum, this.t('free'));
      this.parts.tags[i]?.setText(txt);
    }
    this.parts.ticketLed.set(String(fmtNum(this.tickets())).padStart(4, ' '));
    this.drawLedger(stock, open);
    if (this.isLocalOccupant) this.showHud();
  }

  private drawLedger(stock: readonly (PawnSlot | null)[], open: boolean): void {
    const s = this.parts.ledger;
    s.clear('#140e08');
    s.text(this.t('ledger'), 64, 12, { font: 'px5', color: '#ffd060', align: 'center' });
    if (!open) {
      s.text(this.t('ledgerClosed'), 64, 40, { font: 'px5', color: '#a07020', align: 'center' });
      return;
    }
    for (let i = 0; i < SLOTS; i++) {
      const sl = stock[i] ?? null;
      const y = 26 + i * 11;
      const mark = i === this.cursor ? '>' : ' ';
      const name = sl ? tr(`charm.${sl.charmId}.name`).slice(0, 14) : this.t('sold');
      s.text(`${mark}${i + 1} ${name}`, 4, y, { font: 'px5', color: sl?.cursed ? '#c0a0ff' : '#ffe0a0' });
      s.text(sl ? priceText(sl, fmtNum, this.t('free')) : '--', 124, y, { font: 'px5', color: '#ffd060', align: 'right' });
    }
    s.text(`${this.t('ledgerTickets')} ${fmtNum(this.tickets())}`, 4, 72, { font: 'px5', color: '#a07020' });
  }

  private showHud(): void {
    const key = [this.cursor, this.wallet(), this.tickets(), this.open() ? 1 : 0, this.stockCache[this.cursor]?.charmId ?? ''].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const sel = this.stockCache[this.cursor] ?? null;
    const hints: HudHint[] = [
      { action: 'left', label: this.t('h_pick') },
      { action: 'primary', label: this.t('h_buy') },
      { action: 'alt', label: this.t('h_reroll') },
      { action: 'double', label: this.t('h_lock') },
      { action: 'collect', label: this.t('h_curse') },
      { action: 'exit', label: this.t('h_leave') },
    ];
    this.hud({
      bet: null,
      hints,
      stats: [
        { label: this.t('s_coins'), value: fmtNum(this.wallet()) },
        { label: this.t('s_tickets'), value: fmtNum(this.tickets()) },
        { label: this.t('s_item'), value: sel ? tr(`charm.${sel.charmId}.name`) : '--' },
      ],
    });
  }
}
