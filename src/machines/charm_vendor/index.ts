/**
 * Pawn Window (`charm_vendor`, system) — the shop of GDD §4.1, open only in intermissions. devices-core lane.
 *
 * Stock, odds, prices and Ticket costs come from game-charms through `pawnFrom(ctx.run)` (`PawnApi`, see rules.ts).
 * The purchase itself goes through `ctx.run.buyCharm(charmId, price)`. Coins are checked with `run.canAfford`, Tickets
 * with `run.balance('ticket')`. The machine never prices anything.
 *
 * Controls (seated): 1–4 or ←/→ pick a slot (no wrap, every slot visited) · Space/Enter twice within 3 s buys (the first press shows
 * the price) · R (double) locks the slot (1 Ticket, it stays until bought;
 * R again unlocks) · Q (collect) removes the curse from your first cursed charm (5 Tickets) · E stands up.
 * Reroll is the ALT key (free rerolls first, then 1 Ticket, +1 per further paid reroll). Only unlocked, unsold slots change.
 * Pegs full: buying opens the swap picker (←/→ choose the charm to replace, Space/Enter confirm, secondary cancels);
 * the replaced charm sells back for 50 %. Each slot shows a FIT n badge; the HUD previews the payout on your main machine.
 *
 * Every peer draws the same stock from the same state (tags, ledger, ticket LED, shutter). `present()` plays the juice
 * for the local choices. Credit first, present after: the wallet step runs inside `emit`'s credit.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { rulesFirstEver, rulesMarkShown } from '@/machines/_base/placard3d';
import { showRulesHint } from '@/machines/_base/rulesHint';
import { bus } from '@/core/events';
import type { CharmRarity } from '@/game/types';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, SHUTTER_DROP, type CharmVendorParts } from './model';
import { charmIconPix, rarityColor, stampIconPix } from './icons';
import './pawnCard.css';
import {
  BUY_CONFIRM_S, LOCK_TICKETS, MAX_LOCKS, REMOVE_CURSE_TICKETS, SLOTS, SLOTS_MAX, buyJuice, multText, pawnFrom, priceText, stepIndex, stepSlot,
  stockKey, STAMP_MAX_LOCKS, STAMP_SLOTS, stampColor, stampKey, stampPips, stampsFrom, stepStamp,
  type PawnApi, type PawnSlot, type StampApi, type StampOffer, type SwapChoice,
} from './rules';

type Juice = 'plain' | 'rare' | 'legend' | 'cursed';
type Ev =
  /** A purchase. `why` names the refusal when `ok` is false. */
  | { k: 'buy'; i: number; charmId: string; price: number; juice: Juice; ok: boolean; why: string }
  | { k: 'reroll'; ok: boolean; why: string }
  | { k: 'lock'; i: number; ok: boolean; why: string; off?: boolean }
  | { k: 'curse'; charmId: string; ok: boolean; why: string }
  /** The STAMPS tab: a stamp purchase, a reroll of the board, a lock. */
  | { k: 'sbuy'; i: number; kind: StampOffer['kind']; target: string; ok: boolean; why: string }
  | { k: 'sreroll'; ok: boolean; why: string }
  | { k: 'slock'; i: number; ok: boolean; why: string; off?: boolean };

/** The selected card's DOM parts. */
interface PawnCard { el: HTMLElement; icon: HTMLCanvasElement; name: HTMLElement; meta: HTMLElement; price: HTMLElement; desc: HTMLElement; note: HTMLElement; pips: HTMLElement }

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
      goal: "Buy a charm you can afford. Reroll or lock stock with tickets, and remove curses for a fee.",
      stShut: "WINDOW CLOSED",
      stShutSub: "The pawn window opens between shifts",
      stEmpty: "NOTHING IN THIS SLOT",
      stEmptySub: "Pick another slot",
      stFunds: "NOT ENOUGH COINS",
      stFundsSub: "Short by {n} coins",
      stChoose: "CHOOSE A CHARM",
      stChooseSub: "Buy it, reroll the stock or lock it for later",
      nPrice: "PRICE",
      nCoins: "COINS",
      nTickets: "TICKETS",
      nReroll: "REROLL",
      nItem: "ITEM",
      cPick: "PICK",
      cBuy: "BUY",
      cReroll: "REROLL · {n} TIX",
      cLock: "LOCK {n} TIX",
      cCurse: "UNCURSE {n} TIX",
      cRules: "RULES",
      cLeave: "LEAVE",
      rule1: "The pawn window is open between shifts only. Pick a slot and buy a charm with coins.",
      rule2: "REROLL refreshes the stock for tickets. Each further reroll in the same intermission costs one more ticket.",
      rule3: "LOCK keeps one charm for your next visit. A cursed charm pays you coins when you buy it; UNCURSE removes a curse for tickets.",
      rule4: "Keys: arrows or 1-4 pick a slot, PRIMARY buys, the ALT key rerolls, E leaves.",
      tip1: "The pawn window is open only between shifts. Pick a charm, then buy it.",
      tip2: "[{move}] PICK A CHARM  ·  [{buy}] BUY WITH COINS",
      tip3: "Tickets: [{reroll}] REROLL  ·  [{lock}] LOCK  ·  [{help}] RULES",
      rarCommon: 'COMMON', rarUncommon: 'UNCOMMON', rarRare: 'RARE', rarLegendary: 'LEGENDARY', rarCursed: 'CURSED',
      tagLocked: 'LOCKED', tagSale: 'SALE', tagSecret: 'UNDER THE COUNTER',
      curseNote: 'Cursed: the house pays you to take it. It cannot be sold back.',
      swapOut: 'THIS ONE LEAVES  ·  SELL BACK {n}',
      noDesc: 'No description.',
      stArm: '{key} again to buy · {price}',
      stArmSub: 'Second press within {s} s',
      cConfirm: 'CONFIRM',
    },
    tr: {
      name: 'Rehin Penceresi',
      desc: 'Tezgahın altında tılsımlar, yalnızca Molalarda. Her şeyin bir fiyatı var.',
      h_pick: 'SEÇ', h_buy: 'AL', h_reroll: 'YENİLE', h_lock: 'KİLİTLE', h_curse: 'LANET AÇ', h_leave: 'AYRIL',
      s_coins: 'PARA', s_tickets: 'BİLET', s_item: 'EŞYA',
      closed: 'PENCERE KAPALI', funds: 'PARA YETMİYOR', tickets: 'BİLET YOK', none: 'BURADA BİR ŞEY YOK',
      noService: 'AÇILACAK LANET YOK', free: 'BEDAVA', locked: 'KİLİTLİ', rerolled: 'YENİ STOK', cleansed: 'TEMİZLENDİ',
      sold: 'SATILDI', paid: 'ÖDENDİ', ledger: 'REHİN DEFTERİ', ledgerClosed: 'KAPALI',
      ledgerHint: '1-4 SEÇ  BOŞLUK AL', ledgerTickets: 'BİLET',
      goal: "Ödeyebildiğin bir tılsım al. Stoku biletlerle yenile ya da kilitle, lanetleri bedelini ödeyip aç.",
      stShut: "PENCERE KAPALI",
      stShutSub: "Rehin penceresi Molalarda açılır",
      stEmpty: "BU YUVADA BİR ŞEY YOK",
      stEmptySub: "Başka bir yuva seç",
      stFunds: "PARA YETMİYOR",
      stFundsSub: "{n} jeton eksik",
      stChoose: "BİR TILSIM SEÇ",
      stChooseSub: "Al, stoku yenile ya da sonraya kilitle",
      nPrice: "FİYAT",
      nCoins: "PARA",
      nTickets: "BİLET",
      nReroll: "YENİLEME",
      nItem: "EŞYA",
      cPick: "SEÇ",
      cBuy: "AL",
      cReroll: "YENİLE · {n} BİLET",
      cLock: "KİLİTLE {n} BİLET",
      cCurse: "LANETİ AÇ {n} BİLET",
      cRules: "KURALLAR",
      cLeave: "AYRIL",
      rule1: "Rehin penceresi yalnızca Molalarda açık. Bir yuva seç ve tılsımı parayla al.",
      rule2: "YENİLE stoku biletle yeniler. Aynı Molada her ek yenileme bir bilet daha tutar.",
      rule3: "KİLİTLE bir tılsımı bir sonraki ziyaretine saklar. Lanetli tılsım alınca sana para öder; LANETİ AÇ laneti biletle kaldırır.",
      rule4: "Tuşlar: ok ya da 1-4 yuva seçer, BİRİNCİL satın alır, ALT yenilettirir, E ayrılır.",
      tip1: "Rehin penceresi yalnızca Molalarda açık. Bir tılsım seç, sonra al.",
      tip2: "[{move}] TILSIM SEÇ  ·  [{buy}] PARAYLA AL",
      tip3: "Biletler: [{reroll}] YENİLE  ·  [{lock}] KİLİTLE  ·  [{help}] KURALLAR",
      rarCommon: 'SIRADAN', rarUncommon: 'YARI NADİR', rarRare: 'NADİR', rarLegendary: 'EFSANEVİ', rarCursed: 'LANETLİ',
      tagLocked: 'KİLİTLİ', tagSale: 'İNDİRİM', tagSecret: 'TEZGAH ALTI',
      curseNote: 'Lanetli: ev seni almaya para öder. Geri satılamaz.',
      swapOut: 'BU ÇIKAR  ·  GERİ SATIŞ {n}',
      noDesc: 'Açıklama yok.',
      stArm: '{key} TEKRAR BAS · {price}',
      stArmSub: '{s} sn içinde ikinci kez bas',
      cConfirm: 'ONAYLA',
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class CharmVendor extends MachineBase<CharmVendorParts, Ev, null> {
  private cursor = 0;
  /** Shelves shown (SLOTS plus Second Window extras). */
  private slotN = SLOTS;
  private stockCache: readonly (PawnSlot | null)[] = [];
  /** 0 = CHARMS, 1 = STAMPS (local to the seated player; the shelf shows charms for everyone else). */
  private tab: 0 | 1 = 0;
  private stampCache: readonly (StampOffer | null)[] = [];
  private repaintKey = '';
  private hudKey = '';
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  private idle = 0;
  private drumming = false;
  /** Swap picker (pegs full): which slot is being bought and which charm would be replaced. */
  private swap: { i: number; choices: readonly SwapChoice[]; idx: number } | null = null;
  /** First Space on a buyable slot: the price shows and a second Space on the same slot buys, within BUY_CONFIRM_S. */
  private armed: { i: number; left: number } | null = null;
  /** The selected charm's card (DOM, crisp text): name, rarity, effect. */
  private card?: PawnCard;
  /** The CHARMS | STAMPS tab strip above the card. */
  private tabs?: { el: HTMLElement; charms: HTMLElement; stamps: HTMLElement };
  private cardKey = '';
  private uiBlocked = false;
  private offBlock: (() => void) | null = null;
  private offHint: (() => void) | null = null;
  private readonly onResize = (): void => this.fitPose();

  protected createModel(kit: KitX): MachineModel<CharmVendorParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.buildCard();
    this.fitPose();
    window.addEventListener('resize', this.onResize);
    this.offBlock = bus.on('ui:blocking', ({ blocking }) => { this.uiBlocked = blocking; this.syncCard(); });
    this.refresh(true);
    this.attractor.every('glint', 11, () => this.ctx.fx.glow(this.model.anchors.light, GOLD, 0.25, 0.5), { first: 6 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private pawn(): PawnApi | null { return pawnFrom(this.ctx.run); }
  private stamps(): StampApi | null { return stampsFrom(this.ctx.run); }
  private open(): boolean { const p = this.pawn(); return p !== null && p.open(); }
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }
  private tickets(): number { return this.ctx.run.balance('ticket', this.selfId); }

  tick(dt: number): void {
    if (this.swap && !this.open()) this.swap = null;
    const target = this.open() ? 0 : -SHUTTER_DROP;
    const sh = this.parts.shutter;
    sh.position.y += (target - sh.position.y) * Math.min(1, dt * 6);
    this.idle += dt;
    if (this.armed) { this.armed.left -= dt; if (this.armed.left <= 0) this.armed = null; }
    this.refresh(false);
  }

  frame(dt: number, t: number): void {
    for (const ic of this.parts.icons) ic.animate(t, dt);
    // idle: the Pawnbroker drums ringed fingers on the counter
    const drum = this.idle > IDLE_DRUM_S && !this.busy;
    if (drum !== this.drumming) { this.drumming = drum; if (!drum) this.parts.hands.rotation.x = 0; }
    if (drum) this.parts.hands.rotation.x = Math.sin(t * 14) * 0.08;
  }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  dispose(): void {
    this.offBlock?.(); this.offBlock = null;
    this.offHint?.(); this.offHint = null;
    window.removeEventListener('resize', this.onResize);
    this.card?.el.remove(); this.card = undefined;
    this.tabs?.el.remove(); this.tabs = undefined;
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    this.tab = 0;
    this.idle = 0;
    this.armed = null;
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.refresh(true);
      this.cardKey = '';
      // HOW TO PLAY opens only on the first sit in the whole save; after that a small hint names the rules key
      this.seatHud?.firstTip('charm_vendor', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    this.swap = null;
    this.tab = 0;
    this.armed = null;
    if (local) {
      this.seatHud?.hide(); this.hudKey = '';
      this.offHint?.(); this.offHint = null;
      this.syncCard();
    }
  }

  onLang(): void {
    this.cardKey = '';
    this.repaintKey = '';
    this.hudKey = '';
    this.refresh(true);
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (e.repeat) return;
    this.idle = 0;
    if (this.swap) { this.onSwapInput(e); return; }
    if (e.action === 'secondary') { this.toggleTab(); return; }
    if (this.tab === 1) { this.onStampInput(e); return; }
    switch (e.action) {
      case 'left': this.stepCursor(-1); return;
      case 'right': this.stepCursor(1); return;
      case 'n1': case 'n2': case 'n3': case 'n4': this.moveCursor(Number(e.action.slice(1)) - 1); return;
      case 'primary': case 'confirm': this.buy(this.cursor); return;
      case 'alt': this.reroll(); return;
      case 'double': this.lock(this.cursor); return;
      case 'collect': this.uncurse(); return;
    }
  }

  private moveCursor(i: number): void {
    this.cursor = i;
    this.armed = null;
    this.sfx('hover');
    this.refresh(true);
  }

  /** A/D (or ←/→) step one slot. The ends stop the cursor (no wrap) and say so; every slot, empty ones too, is landed on. */
  private stepCursor(dir: 1 | -1): void {
    const next = stepSlot(this.cursor, dir, this.slotN);
    if (next === this.cursor) { this.sfx('buzzer', { vol: 0.4 }); return; }
    this.moveCursor(next);
  }

  /**
   * Purchase, two presses: the first Space arms the slot (its price shows in the banner), a second Space on the same slot
   * inside BUY_CONFIRM_S buys it. Refusals (closed, empty, short of coins) answer at once. The coins move in the credit step.
   */
  private buy(i: number): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { this.armed = null; void this.emit({ k: 'buy', i, charmId: '', price: 0, juice: 'plain', ok: false, why: 'closed' }); return; }
    const slot = pawn.stock(this.selfId)[i] ?? null;
    if (!slot) { this.armed = null; void this.emit({ k: 'buy', i, charmId: '', price: 0, juice: 'plain', ok: false, why: 'none' }); return; }
    if (pawn.needsSwap(this.selfId, i)) {                       // pegs full: choose the charm to replace first
      this.armed = null;
      const choices = pawn.swapChoices(this.selfId, i);
      if (!choices.length) { void this.emit({ k: 'buy', i, charmId: slot.charmId, price: slot.price, juice: 'plain', ok: false, why: 'shop.limit' }); return; }
      this.swap = { i, choices, idx: 0 };
      this.sfx('hover');
      this.refresh(true);
      return;
    }
    const ok = slot.price <= 0 || this.ctx.run.canAfford(slot.price, this.selfId);
    if (!ok) { this.armed = null; this.commitBuy(pawn, i, slot, false, 'funds'); return; }
    if (this.armed?.i !== i) {                                  // first press: arm and show the price
      this.armed = { i, left: BUY_CONFIRM_S };
      this.sfx('hover');
      this.refresh(true);
      return;
    }
    this.armed = null;                                          // second press in time
    this.commitBuy(pawn, i, slot, true, '');
  }

  /** Emit the purchase; the wallet moves inside the credit step through `pawn.buy`, which also marks the slot sold. */
  private commitBuy(pawn: PawnApi, i: number, slot: PawnSlot, ok: boolean, why: string, replaceId?: string): void {
    const juice = buyJuice(slot.rarity, slot.cursed);
    void this.emit(
      { k: 'buy', i, charmId: slot.charmId, price: slot.price, juice, ok, why },
      ok ? () => {
        const r = pawn.buy(this.selfId, i, replaceId);
        if (!r.ok) this.ctx.ui.toast(r.why === 'funds' ? this.t('funds') : tr(r.why === 'limit' ? 'shop.limit' : 'shop.fail'), 'bad');
      } : undefined,
    );
  }

  private onSwapInput(e: MachineInputEvent): void {
    const sw = this.swap;
    const pawn = this.pawn();
    if (!sw || !pawn) { this.swap = null; return; }
    switch (e.action) {
      case 'left': case 'up': sw.idx = stepIndex(sw.idx, -1, sw.choices.length); this.sfx('hover'); this.refresh(true); return;
      case 'right': case 'down': sw.idx = stepIndex(sw.idx, 1, sw.choices.length); this.sfx('hover'); this.refresh(true); return;
      case 'secondary': this.swap = null; this.sfx('click'); this.refresh(true); return;
      case 'primary': case 'confirm': {
        const slot = pawn.stock(this.selfId)[sw.i] ?? null;
        const pick = sw.choices[sw.idx];
        this.swap = null;
        if (!slot || !pick) { this.refresh(true); return; }
        const ok = slot.price <= 0 || this.wallet() + pick.refund >= slot.price;
        this.commitBuy(pawn, sw.i, slot, ok, ok ? '' : 'funds', pick.id);
        this.refresh(true);
        return;
      }
    }
  }

  // ── STAMPS tab (game/stamps.ts, read from run.stamps) ─────────────────────────────────────────────
  private toggleTab(): void {
    if (!this.stamps()) { this.sfx('buzzer', { vol: 0.4 }); return; }
    this.tab = this.tab === 1 ? 0 : 1;
    this.cursor = 0;
    this.armed = null;
    this.cardKey = '';
    this.sfx('click');
    this.refresh(true);
  }

  private onStampInput(e: MachineInputEvent): void {
    switch (e.action) {
      case 'left': this.stepStampCursor(-1); return;
      case 'right': this.stepStampCursor(1); return;
      case 'n1': case 'n2': case 'n3': this.moveCursor(Number(e.action.slice(1)) - 1); return;
      case 'primary': case 'confirm': this.buyStamp(this.cursor); return;
      case 'alt': this.rerollStamps(); return;
      case 'double': this.lockStamp(this.cursor); return;
    }
  }

  private stepStampCursor(dir: 1 | -1): void {
    const next = stepStamp(this.cursor, dir);
    if (next === this.cursor) { this.sfx('buzzer', { vol: 0.4 }); return; }
    this.moveCursor(next);
  }

  /** Two presses like a charm: the first arms the offer (the price shows), the second inside BUY_CONFIRM_S buys. */
  private buyStamp(i: number): void {
    const st = this.stamps();
    const fail = (why: string, o?: StampOffer | null): void => { this.armed = null; void this.emit({ k: 'sbuy', i, kind: o?.kind ?? 'gild', target: o?.target ?? '', ok: false, why }); };
    if (!st || !st.open()) { fail('stamp.why.closed'); return; }
    const o = st.offers()[i] ?? null;
    if (!o) { fail('stamp.why.none'); return; }
    if (st.count() >= st.cap()) { fail('stamp.why.full', o); return; }
    if (!this.ctx.run.canAfford(o.price, this.selfId)) { fail('stamp.why.funds', o); return; }
    if (this.armed?.i !== i) {
      this.armed = { i, left: BUY_CONFIRM_S };
      this.sfx('hover');
      this.refresh(true);
      return;
    }
    this.armed = null;
    void this.emit(
      { k: 'sbuy', i, kind: o.kind, target: o.target, ok: true, why: '' },
      () => { const r = st.buy(i); if (!r.ok) this.ctx.ui.toast(tr(r.why === 'funds' ? 'stamp.why.funds' : r.why === 'full' ? 'stamp.why.full' : 'stamp.why.fail'), 'bad'); },
    );
  }

  private rerollStamps(): void {
    const st = this.stamps();
    if (!st || !st.open()) { void this.emit({ k: 'sreroll', ok: false, why: 'stamp.why.closed' }); return; }
    if (!st.canReroll()) { void this.emit({ k: 'sreroll', ok: false, why: 'stamp.why.noReroll' }); return; }
    const ok = this.tickets() >= st.rerollCost();
    void this.emit({ k: 'sreroll', ok, why: ok ? '' : 'stamp.why.tickets' }, ok ? () => { st.reroll(); } : undefined);
  }

  private lockStamp(i: number): void {
    const st = this.stamps();
    if (!st || !st.open()) { void this.emit({ k: 'slock', i, ok: false, why: 'stamp.why.closed' }); return; }
    const offers = st.offers();
    const o = offers[i] ?? null;
    if (!o) { void this.emit({ k: 'slock', i, ok: false, why: 'stamp.why.none' }); return; }
    if (o.locked) { void this.emit({ k: 'slock', i, ok: true, why: '', off: true }, () => { st.unlock(i); }); return; }
    const locks = offers.filter((x) => x?.locked).length;
    const ok = this.tickets() >= LOCK_TICKETS && locks < STAMP_MAX_LOCKS;
    void this.emit({ k: 'slock', i, ok, why: ok ? '' : locks >= STAMP_MAX_LOCKS ? 'stamp.why.lockFull' : 'stamp.why.tickets' }, ok ? () => { st.lock(i); } : undefined);
  }

  /** "GILD: Sun", "ETCH: Trey" (the card title and the pop-up). */
  private stampTitle(kind: StampOffer['kind'], target: string): string {
    return tr('stamp.title', { kind: tr(`stamp.kind.${kind}`), name: tr(kind === 'etch' ? `stamp.pat.${target}` : `stamp.sym.${target}`) });
  }

  /** The effect of an offer in plain words, one sentence per line. */
  private stampDesc(o: StampOffer): string {
    const f = (n: number): string => String(Math.round(n * 100) / 100);
    const name = tr(o.kind === 'etch' ? `stamp.pat.${o.target}` : `stamp.sym.${o.target}`);
    const vars = { name, from: f(o.from), to: f(o.to) };
    if (o.kind === 'gild') return tr('stamp.eff.gild', vars);
    if (o.kind === 'shift') return `${tr('stamp.eff.shift', vars)}\n${tr('stamp.eff.shiftDonor', { n: f(o.donor) })}`;
    return tr('stamp.eff.etch', vars);
  }

  private reroll(): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'reroll', ok: false, why: 'closed' }); return; }
    if (!pawn.canReroll()) { void this.emit({ k: 'reroll', ok: false, why: 'shop.noReroll' }); return; }
    const cost = pawn.rerollCost();
    const ok = this.tickets() >= cost;
    void this.emit({ k: 'reroll', ok, why: ok ? '' : 'tickets' }, ok ? () => { pawn.reroll(); } : undefined);
  }

  private lock(i: number): void {
    const pawn = this.pawn();
    if (!pawn || !pawn.open()) { void this.emit({ k: 'lock', i, ok: false, why: 'closed' }); return; }
    const slot = pawn.stock(this.selfId)[i] ?? null;
    if (!slot) { void this.emit({ k: 'lock', i, ok: false, why: 'none' }); return; }
    if (slot.locked) { void this.emit({ k: 'lock', i, ok: true, why: '', off: true }, () => { pawn.unlock(i); }); return; }
    const locks = pawn.stock(this.selfId).filter((s) => s?.locked).length;
    const ok = this.tickets() >= LOCK_TICKETS && locks < MAX_LOCKS;
    void this.emit({ k: 'lock', i, ok, why: ok ? '' : (locks >= MAX_LOCKS ? 'shop.lockFull' : 'tickets') }, ok ? () => { pawn.lock(i); } : undefined);
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
      case 'sbuy': return this.presentStampBuy(ev, pc);
      case 'sreroll': return this.presentStampReroll(ev);
      case 'slock': return this.presentStampLock(ev);
    }
  }

  private denied(why: string): void {
    this.sfx('error');
    const sh = this.parts.shutter;
    const y0 = sh.position.y;
    void this.anim(0.2, (k) => { sh.position.y = y0 + Math.sin(k * Math.PI * 6) * 0.01; });
    if (this.isLocalOccupant && why) this.toast(why.startsWith('shop.') || why.startsWith('stamp.') ? tr(why) : this.t(why), 'warn');
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
    // the name pop stays small and low, over its own slot, so it never covers the shop
    switch (ev.juice) {
      case 'legend':
        this.sfx('win3'); fx.flash(GOLD, 0.3, 0.4); fx.zoomPunch(0.04, 0.3); fx.popText(at, name, GOLD, { scale: 0.95, dur: 0.9, rise: 0.1 });
        break;
      case 'rare':
        this.sfx('win2'); fx.flash(BLUE, 0.18, 0.3); fx.popText(at, name, BLUE, { scale: 0.85, dur: 0.8, rise: 0.1 });
        break;
      case 'cursed':
        this.sfx('porcelainCrack'); fx.tint(VIOLET, 0.25, 0.6); fx.popText(at, name, VIOLET, { scale: 0.85, dur: 0.8, rise: 0.1 });
        break;
      default:
        this.sfx('stamp'); fx.popText(at, name, GOLD, { scale: 0.75, dur: 0.7, rise: 0.08 });
    }

    // follow-through: the tray returns, the ledger stamps
    await this.anim(0.25, (k) => { tray.position.z = lerp(trayZ0 + 0.3, trayZ0, k); }, 'outQuad');
    this.sfx('stamp');
    this.refresh(true);
  }

  private async presentStampBuy(ev: Extract<Ev, { k: 'sbuy' }>, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    if (pc.fast) { this.refresh(true); return; }
    const col = stampColor(ev.kind);
    const fx = this.ctx.fx;
    const at = this.parts.itemSlots[ev.i] ?? this.model.anchors.coinOut;
    this.sfx('button');
    this.sfx('cashRegister');
    fx.coins(this.model.anchors.coinOut, 8, { spread: 0.1, up: 0.2 });
    this.parts.lamp.blink(6, 0.4);
    const tag = this.parts.tags[ev.i];
    if (tag) fx.squash(tag.mesh, 0.2, 0.25);
    await this.anim(0.18, () => undefined);
    this.sfx('stamp');
    fx.flash(col, 0.22, 0.35);
    fx.popText(at, `${tr('stamp.stamped')}: ${this.stampTitle(ev.kind, ev.target)}`, col, { scale: 0.85, dur: 0.9, rise: 0.1 });
    this.refresh(true);
  }

  private async presentStampReroll(ev: Extract<Ev, { k: 'sreroll' }>): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    this.sfx('shuffle');
    const hands = this.parts.hands;
    this.parts.lamp.blink(8, 0.4);
    await this.anim(0.4, (k) => { hands.rotation.y = Math.sin(k * Math.PI * 2) * 0.4; });
    hands.rotation.y = 0;
    this.ctx.fx.popText(this.model.anchors.prompt, tr('stamp.rerolled'), GOLD, { scale: 1.1 });
    this.refresh(true);
  }

  private async presentStampLock(ev: Extract<Ev, { k: 'slock' }>): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    this.sfx(ev.off ? 'hover' : 'click');
    const tag = this.parts.tags[ev.i];
    if (tag) this.ctx.fx.squash(tag.mesh, 0.15, 0.2);
    this.ctx.fx.popText(this.parts.itemSlots[ev.i] ?? this.model.anchors.prompt, ev.off ? tr('shop.unlocked') : this.t('locked'), GOLD, { scale: 1.1 });
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
    this.sfx(ev.off ? 'hover' : 'click');
    const tag = this.parts.tags[ev.i];
    if (tag) this.ctx.fx.squash(tag.mesh, 0.15, 0.2);
    this.ctx.fx.popText(this.parts.itemSlots[ev.i] ?? this.model.anchors.prompt, ev.off ? tr('shop.unlocked') : this.t('locked'), GOLD, { scale: 1.1 });
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
    const st = this.stamps();
    if (this.tab === 1 && !st) this.tab = 0;
    const sm = this.tab === 1 && st !== null;
    const open = sm ? st.open() : pawn !== null && pawn.open();
    const stock = pawn && open && !sm ? pawn.stock(this.selfId) : [];
    this.stockCache = stock;
    const offers = st && sm && open ? st.offers() : [];
    this.stampCache = offers;
    const n = sm ? STAMP_SLOTS : Math.min(SLOTS_MAX, Math.max(SLOTS, pawn?.slotCount?.() ?? stock.length));
    if (n !== this.slotN) { this.slotN = n; this.fitPose(); }
    for (let i = SLOTS; i < SLOTS_MAX; i++) { const t = this.parts.tags[i]; if (t) t.mesh.visible = i < n; }
    const key = [sm && st ? `S${stampKey(offers)}.${st.count()}` : stockKey(stock), st ? 1 : 0, open ? 1 : 0, this.wallet(), this.tickets(), this.cursor, this.swap ? `s${this.swap.i}.${this.swap.idx}` : '', this.armed?.i ?? -1].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); this.syncCard(); return; }
    this.repaintKey = key;

    // every tag carries its price, locked ones in brackets (the lock shows on the shelf and in the ledger)
    for (let i = 0; i < SLOTS_MAX; i++) {
      let txt: string;
      if (sm) {
        const o = offers[i] ?? null;
        txt = !open || !o ? '--' : o.locked ? `[${fmtNum(o.price)}]` : String(fmtNum(o.price));
      } else {
        const s = stock[i] ?? null;
        const price = priceText(s, fmtNum, this.t('free'));
        txt = !open ? '--' : s?.locked ? `[${price}]` : price;
      }
      this.parts.tags[i]?.setText(txt);
    }
    this.parts.ticketLed.set(String(fmtNum(this.tickets())).padStart(4, ' '));
    for (let i = 0; i < SLOTS_MAX; i++) {
      const sel = this.isLocalOccupant && i === this.cursor;
      if (sm) {
        const o = open ? offers[i] ?? null : null;
        this.parts.icons[i]?.setStamp(o ? { kind: o.kind, sym: o.sym, cells: o.cells, level: o.level } : null, sel);
        continue;
      }
      const s = open ? stock[i] ?? null : null;
      this.parts.icons[i]?.set(s ? { id: s.charmId, rarity: s.rarity, cursed: s.cursed, tag: s.tag } : null, sel);
    }
    if (sm && st) this.drawStampLedger(offers, open, st); else this.drawLedger(stock, open);
    if (this.isLocalOccupant) this.showHud();
    this.syncCard();
  }

  private drawLedger(stock: readonly (PawnSlot | null)[], open: boolean): void {
    const s = this.parts.ledger;
    s.clear('#140e08');
    s.text(this.t('ledger'), 64, 12, { font: 'px5', color: '#ffd060', align: 'center' });
    if (!open) {
      s.text(this.t('ledgerClosed'), 64, 40, { font: 'px5', color: '#a07020', align: 'center' });
      return;
    }
    const sw = this.swap;
    if (sw) {                                                    // swap picker: the charm that would be replaced
      s.text(tr('shop.ledgerSwap'), 64, 24, { font: 'px5', color: '#ffe0a0', align: 'center' });
      const c = sw.choices[sw.idx];
      if (c) {
        s.text(tr(`charm.${c.id}.name`).slice(0, 24), 64, 40, { font: 'px5', color: '#ffd060', align: 'center' });
        s.text(`${sw.idx + 1}/${sw.choices.length}  +${fmtNum(c.refund)}`, 64, 52, { font: 'px5', color: '#a07020', align: 'center' });
      }
      s.text(`${this.t('ledgerTickets')} ${fmtNum(this.tickets())}`, 4, 72, { font: 'px5', color: '#a07020' });
      return;
    }
    const rowH = stock.length > SLOTS ? 8 : 11;
    for (let i = 0; i < Math.max(SLOTS, stock.length); i++) {
      const sl = stock[i] ?? null;
      const y = 26 + i * rowH;
      const mark = i === this.cursor ? '>' : ' ';
      const name = sl ? tr(`charm.${sl.charmId}.name`).slice(0, 12) : this.t('sold');
      s.text(`${mark}${i + 1} ${name}`, 4, y, { font: 'px5', color: sl?.cursed ? '#c0a0ff' : '#ffe0a0' });
      if (sl && sl.fit > 0) s.text(tr('shop.fit', { n: sl.fit }), 78, y, { font: 'px5', color: '#80d0ff' });
      s.text(sl ? priceText(sl, fmtNum, this.t('free')) : '--', 124, y, { font: 'px5', color: sl?.locked ? '#ffffff' : '#ffd060', align: 'right' });
    }
    s.text(`${this.t('ledgerTickets')} ${fmtNum(this.tickets())}`, 4, 72, { font: 'px5', color: '#a07020' });
  }

  private drawStampLedger(offers: readonly (StampOffer | null)[], open: boolean, st: StampApi): void {
    const s = this.parts.ledger;
    s.clear('#140e08');
    s.text(tr('stamp.ledger'), 64, 12, { font: 'px5', color: '#ffd060', align: 'center' });
    if (!open) {
      s.text(this.t('ledgerClosed'), 64, 40, { font: 'px5', color: '#a07020', align: 'center' });
      return;
    }
    for (let i = 0; i < STAMP_SLOTS; i++) {
      const o = offers[i] ?? null;
      const y = 26 + i * 11;
      const name = o ? this.stampTitle(o.kind, o.target).slice(0, 15) : tr('stamp.ledgerEmpty');
      s.text(`${i === this.cursor ? '>' : ' '}${i + 1} ${name}`, 4, y, { font: 'px5', color: '#ffe0a0' });
      s.text(o ? `${o.locked ? '[' : ''}${fmtNum(o.price)}${o.locked ? ']' : ''}` : '--', 124, y, { font: 'px5', color: o?.locked ? '#ffffff' : '#ffd060', align: 'right' });
    }
    s.text(tr('stamp.ledgerBook', { n: st.count(), cap: st.cap() }), 4, 60, { font: 'px5', color: '#80d0ff' });
    s.text(`${this.t('ledgerTickets')} ${fmtNum(this.tickets())}`, 4, 72, { font: 'px5', color: '#a07020' });
  }

  // ── selected-charm card (DOM, so the text is crisp) ───────────────────────────────────────────
  /**
   * Seat framing, fitted to the actual corners of what the customer must read: the price tags on the counter front
   * (x ±0.88 at z 0.64, only ~0.7 m from the seat), the four pedestals and the ledger above them. The old fit assumed
   * every slot sat 1.15 m away, which put the nearer tag (and the leftmost slot's tag) outside the field.
   * The field is the smallest that holds all the corners, and widens for narrow windows instead of cropping.
   */
  private fitPose(): void {
    const DEG = Math.PI / 180;
    const cam = [0, 1.25, 1.8];
    const pts: Array<[number, number, number]> = [];
    for (const x of [-0.98, 0.98]) for (const y of [0.72, 0.88]) pts.push([x, y, 0.64]);
    if (this.slotN > SLOTS) for (const x of [0, 0.5]) pts.push([x, 0.5, 0.64]);               // second tag line (Second Window)   // price plates (0.46 m wide)
    for (const x of [-0.75, 0.75]) for (const y of [1.0, 1.3]) pts.push([x, y, 0.2]);      // pedestals and charms
    for (const x of [-0.28, 0.28]) for (const y of [2.03, 2.37]) pts.push([x, y, -0.62]);  // ledger
    let vMin = Infinity, vMax = -Infinity, hMax = 0;
    for (const p of pts) {
      const dz = cam[2] - p[2];
      const v = Math.atan2(p[1] - cam[1], dz);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
      hMax = Math.max(hMax, Math.atan2(Math.abs(p[0]), dz));
    }
    const aspect = Math.max(0.4, window.innerWidth / Math.max(1, window.innerHeight));
    // The seat's control strip covers the bottom ~30 % of the frame, so the frame is shifted down: the LOWEST price plate
    // sits FLOOR_SHARE of the frame above its bottom edge, and every corner still fits above it.
    const FLOOR_SHARE = 0.3;
    const vSpan = vMax - vMin;
    const vHalf = Math.max(vSpan / (2 * (1 - FLOOR_SHARE)) + 4 * DEG, Math.atan(Math.tan(hMax + 3 * DEG) / aspect));
    const centre = vMin + (1 - 2 * FLOOR_SHARE) * vHalf;
    const pose = this.model.playPose;
    pose.pos.set(cam[0], cam[1], cam[2]);
    pose.look.set(cam[0], cam[1] + Math.sin(centre), cam[2] - Math.cos(centre));
    pose.fov = Math.min(80, Math.max(40, (2 * vHalf) / DEG));
  }

  private buildCard(): void {
    const el = document.createElement('div');
    el.className = 'pawn-card';
    const top = document.createElement('div'); top.className = 'pc-top';
    const icon = document.createElement('canvas'); icon.className = 'pc-icon'; icon.width = 24; icon.height = 24;
    const head = document.createElement('div');
    const name = document.createElement('div'); name.className = 'pc-name';
    const meta = document.createElement('div'); meta.className = 'pc-meta';
    const price = document.createElement('div'); price.className = 'pc-price';   // the price chip: the figure the buy spends
    head.append(name, meta, price);
    top.append(icon, head);
    const desc = document.createElement('div'); desc.className = 'pc-desc';
    const pips = document.createElement('div'); pips.className = 'pc-pips'; pips.style.display = 'none';
    const note = document.createElement('div'); note.className = 'pc-note';
    el.append(top, desc, pips, note);
    this.ctx.ui.root.appendChild(el);
    this.card = { el, icon, name, meta, price, desc, note, pips };
    // CHARMS | STAMPS: the tab strip over the card (the secondary key switches)
    const tabsEl = document.createElement('div'); tabsEl.className = 'pawn-tabs';
    const charms = document.createElement('span'); charms.className = 'pt';
    const stamps = document.createElement('span'); stamps.className = 'pt';
    tabsEl.append(charms, stamps);
    this.ctx.ui.root.appendChild(tabsEl);
    this.tabs = { el: tabsEl, charms, stamps };
  }

  private rarityName(r: CharmRarity, cursed: boolean): string {
    if (cursed) return this.t('rarCursed');
    switch (r) {
      case 'uncommon': return this.t('rarUncommon');
      case 'rare': return this.t('rarRare');
      case 'legendary': return this.t('rarLegendary');
      case 'cursed': return this.t('rarCursed');
      default: return this.t('rarCommon');
    }
  }

  /** The CHARMS | STAMPS strip: visible while seated and the stamp service exists. */
  private syncTabs(): void {
    const t = this.tabs;
    if (!t) return;
    const st = this.stamps();
    const show = this.isLocalOccupant && !this.uiBlocked && !this.seatHud?.blocking && st !== null && st.open();
    t.el.classList.toggle('on', show);
    if (!show) return;
    const a = tr('stamp.tab.charms'), b = tr('stamp.tab.stamps');
    if (t.charms.textContent !== a) t.charms.textContent = a;
    if (t.stamps.textContent !== b) t.stamps.textContent = b;
    t.charms.classList.toggle('act', this.tab === 0);
    t.stamps.classList.toggle('act', this.tab === 1);
  }

  /** The card of the cursor's stamp: kind and symbol, price, level pips, and the effect in numbers. */
  private syncStampCard(c: PawnCard): void {
    const st = this.stamps();
    const o = this.stampCache[this.cursor] ?? null;
    const show = this.isLocalOccupant && !this.uiBlocked && !this.seatHud?.blocking && st !== null && st.open() && o !== null;
    c.el.classList.toggle('on', show);
    if (!show || !st || !o) return;
    const full = st.count() >= st.cap();
    const key = `S|${o.kind}|${o.target}|${o.level}|${o.price}|${o.locked ? 1 : 0}|${st.count()}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    c.el.style.setProperty('--rc', `#${stampColor(o.kind).toString(16).padStart(6, '0')}`);
    c.name.textContent = this.stampTitle(o.kind, o.target);
    c.desc.textContent = this.stampDesc(o);
    const g = c.icon.getContext('2d');
    if (g) { g.clearRect(0, 0, 24, 24); stampIconPix({ kind: o.kind, sym: o.sym, cells: o.cells, level: o.level }, true).drawTo(g); }
    c.price.textContent = String(fmtNum(o.price));
    c.price.style.display = '';
    const bits = [tr('stamp.level', { n: o.level + 1, max: o.max }), tr('stamp.book', { n: st.count(), cap: st.cap() })];
    if (o.locked) bits.push(this.t('tagLocked'));
    c.meta.textContent = bits.join('  ·  ');
    c.pips.style.display = '';
    c.pips.textContent = '';
    for (const k of stampPips(o.level, o.max)) { const p = document.createElement('span'); p.className = `p ${k}`; c.pips.appendChild(p); }
    c.note.textContent = full ? tr('stamp.bookFull') : tr(`stamp.note.${o.kind}`);
    c.note.style.display = '';
  }

  /** Shows the card for the cursor's charm (or the charm a swap would replace) while the local player is seated. */
  private syncCard(): void {
    const c = this.card;
    if (!c) return;
    this.syncTabs();
    c.el.classList.toggle('stamp', this.tab === 1);
    if (this.tab === 1) { this.syncStampCard(c); return; }
    c.pips.style.display = 'none';
    const pawn = this.pawn();
    const sel = this.stockCache[this.cursor] ?? null;
    const sw = this.swap;
    const out = sw ? sw.choices[sw.idx] ?? null : null;
    const show = this.isLocalOccupant && !this.uiBlocked && !this.seatHud?.blocking && pawn !== null && pawn.open() && (sw ? out !== null : sel !== null);
    c.el.classList.toggle('on', show);
    if (!show) return;
    const id = sw && out ? out.id : sel?.charmId ?? '';
    const rarity: CharmRarity = sw ? 'common' : sel?.rarity ?? 'common';
    const cursed = !sw && !!sel?.cursed;
    const state = sw ? `o${out?.refund ?? 0}` : `${sel?.price ?? 0}.${sel?.fit ?? 0}.${sel?.locked ? 1 : 0}.${sel?.discounted ? 1 : 0}.${sel?.underCounter ? 1 : 0}`;
    const key = `${id}|${state}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    c.el.style.setProperty('--rc', `#${rarityColor(cursed ? 'cursed' : rarity).toString(16).padStart(6, '0')}`);
    c.name.textContent = tr(`charm.${id}.name`);
    const descKey = `charm.${id}.desc`;
    const d = tr(descKey);
    c.desc.textContent = d === descKey ? this.t('noDesc') : d;
    const g = c.icon.getContext('2d');
    if (g) { g.clearRect(0, 0, 24, 24); charmIconPix(id, rarity, cursed, true, sw ? undefined : sel?.tag).drawTo(g); }
    c.price.textContent = sw ? '' : sel ? priceText(sel, fmtNum, this.t('free')) : '';
    c.price.style.display = c.price.textContent ? '' : 'none';
    if (sw && out) {
      c.meta.textContent = this.t('swapOut', { n: fmtNum(out.refund) });
      c.note.textContent = '';
    } else if (sel) {
      const bits = [this.rarityName(rarity, cursed)];
      if (sel.fit > 0) bits.push(tr('shop.fit', { n: sel.fit }));
      if (sel.locked) bits.push(this.t('tagLocked'));
      if (sel.discounted) bits.push(this.t('tagSale'));
      if (sel.underCounter) bits.push(this.t('tagSecret'));
      c.meta.textContent = bits.join('  ·  ');
      c.note.textContent = cursed ? this.t('curseNote') : '';
    }
    c.note.style.display = c.note.textContent ? '' : 'none';
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.charm_vendor.tip1' },
      { k: 'm.charm_vendor.tip2', v: { move: `${this.k('left')}/${this.k('right')}`, buy: this.k('primary') } },
      { k: 'm.charm_vendor.tip3', v: { reroll: this.k('alt'), lock: this.k('double'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    const st = this.stamps();
    const stampRules: Txt[] = st ? [1, 2, 3].map((i) => ({ k: `stamp.rule${i}`, v: { cap: st.cap() } })) : [];
    return [...[1, 2, 3, 4].map((i) => ({ k: `m.charm_vendor.rule${i}` })), { k: 'shop.rule5' }, ...stampRules];
  }

  /** Banner, coins / tickets / price numbers and the valid controls only. Only while the local player stands here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const cur = this.stockCache[this.cursor] ?? null;
    const stq = this.stamps();
    const key = [this.cursor, this.wallet(), this.tickets(), this.open() ? 1 : 0, cur?.charmId ?? '', cur?.locked ? 1 : 0, cur?.fit ?? 0,
      this.pawn()?.rerollCost() ?? 0, this.swap ? `s${this.swap.idx}` : '', this.armed?.i ?? -1, this.tab, stq ? 1 : 0,
      this.tab === 1 && stq ? `${stampKey(this.stampCache)}.${stq.count()}.${stq.rerollCost()}` : ''].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const open = this.open(), wallet = this.wallet(), tix = this.tickets();
    const pawn = this.pawn();
    const sel = this.stockCache[this.cursor] ?? null;
    const full = sel !== null && pawn !== null && pawn.needsSwap(this.selfId, this.cursor);
    const canBuy = sel !== null && (sel.price <= 0 || wallet >= sel.price || (full && pawn !== null && pawn.swapChoices(this.selfId, this.cursor).some((c) => wallet + c.refund >= sel.price)));
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.charm_vendor.goal' });
    if (this.tab === 1 && stq) { this.showStampHud(sh, stq, open, wallet, tix); return; }

    // SWAP PICKER (pegs full): the HUD shows only the picker
    const sw = this.swap;
    if (sw && open && pawn && sel) {
      const c = sw.choices[sw.idx];
      sh.state({ k: 'shop.swapState' }, 'warn', { k: 'shop.swapSub' });
      sh.numbers([
        { label: { k: 'm.charm_vendor.nItem' }, value: c ? tr(`charm.${c.id}.name`) : '--', tone: 'neutral' },
        { label: { k: 'm.charm_vendor.nCoins' }, value: fmtNum(wallet), tone: 'gold' },
        { label: { k: 'm.charm_vendor.nPrice' }, value: fmtNum(Math.max(0, sel.price - (c?.refund ?? 0))), tone: 'gold' },
      ]);
      sh.controls([
        { key: `${this.k('left')}/${this.k('right')}`, label: { k: 'shop.cPickSwap' }, action: 'left' },
        { key: this.k('primary'), label: { k: 'shop.cReplace' }, action: 'primary', primary: true },
        { key: this.k('secondary'), label: { k: 'shop.cCancel' }, action: 'secondary' },
      ]);
      return;
    }

    // STATE
    const armedHere = open && sel !== null && canBuy && this.armed !== null && this.armed.i === this.cursor;
    if (!open) sh.state({ k: 'm.charm_vendor.stShut' }, 'neutral', { k: 'm.charm_vendor.stShutSub' });
    else if (!sel) sh.state({ k: 'm.charm_vendor.stEmpty' }, 'neutral', { k: 'm.charm_vendor.stEmptySub' });
    else if (!canBuy) sh.state({ k: 'm.charm_vendor.stFunds' }, 'warn', { k: 'm.charm_vendor.stFundsSub', v: { n: fmtNum(sel.price - wallet) } });
    else if (armedHere) sh.state({ k: 'm.charm_vendor.stArm', v: { key: this.k('primary'), price: priceText(sel, fmtNum, this.t('free')) } }, 'gold', { k: 'm.charm_vendor.stArmSub', v: { s: BUY_CONFIRM_S } });
    else sh.state({ k: 'm.charm_vendor.stChoose' }, 'gold', { k: 'm.charm_vendor.stChooseSub' });

    // KEY NUMBERS
    const nums: HudNumber[] = [
      { label: { k: 'm.charm_vendor.nPrice' }, value: priceText(sel, fmtNum, this.t('free')), tone: sel && sel.price < 0 ? 'good' : 'gold' },
      { label: { k: 'm.charm_vendor.nCoins' }, value: fmtNum(wallet), tone: 'gold' },
      { label: { k: 'm.charm_vendor.nTickets' }, value: fmtNum(tix), tone: 'cyan' },
    ];
    if (open && pawn) nums.push({ label: { k: 'm.charm_vendor.nReroll' }, value: fmtNum(pawn.rerollCost()), tone: 'neutral' });
    if (open && sel && sel.fit > 0) nums.push({ label: { k: 'shop.nFit' }, value: { k: 'shop.fit', v: { n: sel.fit } }, tone: 'cyan' });
    const pv = open && pawn && sel ? pawn.preview(this.selfId, this.cursor) : null;
    if (pv) nums.push({ label: { k: 'shop.nPayout' }, value: { k: 'shop.payout', v: { from: multText(pv.from), to: multText(pv.to) } }, tone: pv.to > pv.from ? 'good' : 'neutral' });
    nums.push({ label: { k: 'm.charm_vendor.nItem' }, value: sel ? tr(`charm.${sel.charmId}.name`) : '--', tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    if (open) {
      ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: { k: 'm.charm_vendor.cPick' }, action: 'left' });
      if (canBuy) ctrl.push({ key: this.k('primary'), label: { k: this.armed?.i === this.cursor ? 'm.charm_vendor.cConfirm' : 'm.charm_vendor.cBuy' }, action: 'primary', primary: true });
      // always listed while rerolling is possible, cost included, so the price is known before the press (an unaffordable press says NO TICKETS)
      if (pawn && pawn.canReroll()) {
        ctrl.push({
          key: this.k('alt'), action: 'alt',
          label: pawn.rerollCost() === 0 ? { k: 'shop.rerollFree' } : { k: 'm.charm_vendor.cReroll', v: { n: pawn.rerollCost() } },
        });
      }
      if (sel?.locked) ctrl.push({ key: this.k('double'), label: { k: 'shop.cUnlock' }, action: 'double' });
      else if (sel && tix >= LOCK_TICKETS) ctrl.push({ key: this.k('double'), label: { k: 'm.charm_vendor.cLock', v: { n: LOCK_TICKETS } }, action: 'double' });
      if (pawn && pawn.cursedOwned(this.selfId).length > 0 && tix >= REMOVE_CURSE_TICKETS) {
        ctrl.push({ key: this.k('collect'), label: { k: 'm.charm_vendor.cCurse', v: { n: REMOVE_CURSE_TICKETS } }, action: 'collect' });
      }
    }
    if (open && stq) ctrl.push({ key: this.k('secondary'), label: { k: 'stamp.cTab' }, action: 'secondary' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.charm_vendor.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.charm_vendor.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  /** The STAMPS tab's HUD: banner, price / coins / tickets / reroll / book numbers, and only the controls that work now. */
  private showStampHud(sh: SeatHud, st: StampApi, open: boolean, wallet: number, tix: number): void {
    const sel = this.stampCache[this.cursor] ?? null;
    const full = st.count() >= st.cap();
    const canBuy = open && sel !== null && !full && wallet >= sel.price;
    const armedHere = canBuy && this.armed !== null && this.armed.i === this.cursor;
    if (!open) sh.state({ k: 'm.charm_vendor.stShut' }, 'neutral', { k: 'm.charm_vendor.stShutSub' });
    else if (full) sh.state({ k: 'stamp.bookFull' }, 'neutral', { k: 'stamp.bookFullSub' });
    else if (!sel) sh.state({ k: 'stamp.stEmpty' }, 'neutral', { k: 'stamp.stEmptySub' });
    else if (!canBuy) sh.state({ k: 'stamp.stFunds' }, 'warn', { k: 'stamp.stFundsSub', v: { n: fmtNum(sel.price - wallet) } });
    else if (armedHere) sh.state({ k: 'stamp.stArm', v: { key: this.k('primary'), price: fmtNum(sel?.price ?? 0) } }, 'gold', { k: 'stamp.stArmSub', v: { s: BUY_CONFIRM_S } });
    else sh.state({ k: 'stamp.stChoose' }, 'gold', { k: 'stamp.stChooseSub' });
    sh.numbers([
      { label: { k: 'm.charm_vendor.nPrice' }, value: sel ? fmtNum(sel.price) : '--', tone: 'gold' },
      { label: { k: 'm.charm_vendor.nCoins' }, value: fmtNum(wallet), tone: 'gold' },
      { label: { k: 'm.charm_vendor.nTickets' }, value: fmtNum(tix), tone: 'cyan' },
      { label: { k: 'm.charm_vendor.nReroll' }, value: fmtNum(st.rerollCost()), tone: 'neutral' },
      { label: { k: 'stamp.nStamps' }, value: `${st.count()}/${st.cap()}`, tone: full ? 'warn' : 'neutral' },
    ]);
    const ctrl: HudControl[] = [];
    if (open) {
      ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: { k: 'm.charm_vendor.cPick' }, action: 'left' });
      if (canBuy) ctrl.push({ key: this.k('primary'), label: { k: this.armed?.i === this.cursor ? 'm.charm_vendor.cConfirm' : 'stamp.cStamp' }, action: 'primary', primary: true });
      if (st.canReroll()) ctrl.push({ key: this.k('alt'), label: { k: 'stamp.cReroll', v: { n: st.rerollCost() } }, action: 'alt' });
      if (sel?.locked) ctrl.push({ key: this.k('double'), label: { k: 'shop.cUnlock' }, action: 'double' });
      else if (sel && tix >= LOCK_TICKETS) ctrl.push({ key: this.k('double'), label: { k: 'm.charm_vendor.cLock', v: { n: LOCK_TICKETS } }, action: 'double' });
      ctrl.push({ key: this.k('secondary'), label: { k: 'stamp.cTabBack' }, action: 'secondary' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.charm_vendor.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.charm_vendor.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
