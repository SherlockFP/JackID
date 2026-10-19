/**
 * Cashier cage (`cashier`, system, LOB-CASH) — exchanges coins for Tickets and back, and lends House Credit in the Free
 * Casino (GDD §7.4). rules.ts holds the rates and checks; the coins and Tickets move through `run.spend` / `run.earn`
 * in the credit step, so refusals never touch the wallet. The machine decides nothing about money on its own.
 *
 * Controls (seated): ↑/↓ or ←/→ pick an offer · 1–5 pick directly · Space/Enter EXCHANGE · E stands up.
 * `present()` runs on every peer: the tray slides out, the coins pour, the ledger repaints.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { BindingKey, MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, CAP_SINK, TRAY_SLIDE, LAMP, type CashierParts } from './model';
import { BUY_PER_SI, SELL_PER_SI, apply, check, offersFor, pocketBroke, quote, stakeOf, wrapOffer, type Offer, type OfferOp } from './rules';

type Ev =
  /** An exchange. `coins` / `tickets` are the signed amounts for the emitter; `why` names the refusal when `ok` is false. */
  { k: 'x'; i: number; op: OfferOp; coins: number; tickets: number; ok: boolean; why: string };

const GOLD = 0xffd040;
const GREEN = 0x9fe8a0;

export const def: MachineDef = {
  id: 'cashier',
  category: 'system',
  slotSize: 'M',
  zone: 'services',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'cage', 'exchange'],
  modHooks: {},
  strings: {
    en: {
      name: 'Cashier',
      desc: 'Out of coins? Sell your Tickets here. Also buys Tickets, sells you an extra Pull, and in the Free Casino lends House Credit.',
    },
    tr: {
      name: 'Kasa',
      desc: 'Paran mı bitti? Biletlerini burada sat. Ayrıca bilet alır, fazladan bir çekiş satar, Serbest Kumarhane’de ev kredisi verir.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Cashier extends MachineBase<CashierParts, Ev, null> {
  private cursor = 0;
  private repaintKey = '';
  private hudKey = '';
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  private readonly onResize = (): void => this.fitPose();

  protected createModel(kit: KitX): MachineModel<CashierParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.fitPose();
    window.addEventListener('resize', this.onResize);
    this.refresh(true);
    this.attractor.every('blink', 7, () => this.ctx.fx.glow(this.model.anchors.light, LAMP, 0.25, 0.5), { first: 4 });
  }

  /** Seat framing: the ledger fills the view from the customer's place, fitted to its corners (narrow windows widen it). */
  private fitPose(): void {
    const DEG = Math.PI / 180;
    const cam: [number, number, number] = [0, 1.8, 1.05];
    const aspect = Math.max(0.4, window.innerWidth / Math.max(1, window.innerHeight));
    let vMin = Infinity, vMax = -Infinity, hMax = 0;
    for (const x of [-0.35, 0.35]) for (const y of [2.35, 2.75]) {
      const dz = cam[2] + 0.32;                              // the ledger sits on the wall at z −0.32
      const v = Math.atan2(y - cam[1], dz);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
      hMax = Math.max(hMax, Math.atan2(Math.abs(x), dz));
    }
    const centre = (vMin + vMax) / 2;
    const vHalf = Math.max((vMax - vMin) / 2 + 6 * DEG, Math.atan(Math.tan(hMax + 3 * DEG) / aspect));
    const pose = this.model.playPose;
    pose.pos.set(cam[0], cam[1], cam[2]);
    pose.look.set(cam[0], cam[1] + Math.sin(centre), cam[2] - Math.cos(centre));
    pose.fov = Math.min(80, Math.max(20, (2 * vHalf) / DEG));
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private coins(): number { return this.ctx.run.balance('coin', this.selfId); }
  private offers(): readonly Offer[] { return offersFor(this.ctx.run.mode); }
  private tickets(): number { return this.ctx.run.balance('ticket', this.selfId); }

  tick(): void { this.refresh(false); }

  attract(dt: number): void { this.attractor.update(dt); }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.refresh(true);
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.seatHud?.hide(); this.hudKey = ''; }
  }

  onLang(): void {
    this.repaintKey = '';
    this.hudKey = '';
    this.refresh(true);
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (e.repeat) return;
    switch (e.action) {
      case 'up': case 'left': this.moveCursor(wrapOffer(this.cursor, -1)); return;
      case 'down': case 'right': this.moveCursor(wrapOffer(this.cursor, 1)); return;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5':
        this.moveCursor(Number(e.action.slice(1)) - 1);
        return;
      case 'primary': case 'confirm': this.exchange(this.cursor); return;
    }
  }

  private moveCursor(i: number): void {
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  /** Refusals are checked here; the coins and Tickets move in the credit step. */
  private exchange(i: number): void {
    const offer: Offer | undefined = this.offers()[i];
    if (!offer) return;
    const run = this.ctx.run;
    const si = stakeOf(run);
    const q = quote(offer, si, this.tickets());
    const verdict = check(offer, run, this.selfId);
    const ok = verdict === 'ok';
    const coins = offer.op === 'buy' ? -q.coins : q.coins;
    void this.emit(
      { k: 'x', i, op: offer.op, coins: ok ? coins : 0, tickets: ok ? q.tickets : 0, ok, why: ok ? '' : verdict },
      ok ? () => {
        if (!apply(offer, run, this.selfId, si)) this.ctx.ui.toast(this.t('funds'), 'bad');
      } : undefined,
    );
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    return this.presentX(ev, pc);
  }

  private denied(why: string): void {
    this.sfx('error');
    const tray = this.parts.tray;
    const z0 = tray.position.z;
    void this.anim(0.2, (k) => { tray.position.z = z0 + Math.sin(k * Math.PI * 6) * 0.012; });
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentX(ev: Ev, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    if (pc.fast) { this.refresh(true); return; }
    const { tray, caps } = this.parts;
    const fx = this.ctx.fx;
    const out = this.model.anchors.coinOut;
    const cap = caps[ev.i] ?? null;
    const z0 = tray.position.z;
    const y0 = cap ? cap.position.y : 0;
    const isBuy = ev.op === 'buy';

    // anticipation: the cap sinks, the tray slides out
    this.sfx('button');
    await this.anim(0.12, (k) => {
      tray.position.z = lerp(z0, z0 + TRAY_SLIDE, k);
      if (cap) cap.position.y = lerp(y0, y0 - CAP_SINK, k);
    }, 'outQuad');

    // action: the money changes hands
    if (ev.op === 'pull') {
      this.sfx('chime');
      fx.flash(GOLD, 0.1, 0.2);
      fx.popText(out, this.t('pulled'), GOLD, { scale: 1.3 });
    } else if (ev.op === 'loan') {
      this.sfx('win2');
      fx.flash(GOLD, 0.12, 0.25);
      fx.popText(out, this.t('lent', { n: fmtNum(ev.coins) }), GOLD, { scale: 1.3 });
      await this.pourCoins(Math.abs(ev.coins));
    } else if (isBuy) {
      this.sfx('cashRegister');
      fx.coins(out, 6, { spread: 0.1, up: 0.2 });
      fx.popText(out, this.t('bought', { n: String(ev.tickets) }), GREEN, { scale: 1.0 });
    } else {
      this.sfx('cashRegister');
      fx.popText(out, this.t('sold', { n: String(-ev.tickets) }), GREEN, { scale: 1.0 });
      await this.pourCoins(Math.abs(ev.coins));
      if (ev.op === 'sellAll') fx.popText(out, `+${fmtNum(ev.coins)}`, GOLD, { scale: 1.4 });
    }

    // impact: a loan rings the bell, a big exchange gets a flash
    if (ev.op !== 'loan' && (Math.abs(ev.tickets) >= 5 || ev.op === 'sellAll')) { this.sfx('stamp'); fx.flash(GREEN, 0.06, 0.2); }

    // follow-through: cap springs back, tray returns, ledger repaints
    await this.anim(0.25, (k) => {
      tray.position.z = lerp(z0 + TRAY_SLIDE, z0, k);
      if (cap) cap.position.y = lerp(y0 - CAP_SINK, y0, k);
    }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const key = [this.cursor, this.coins(), this.tickets(), this.ctx.run.mode, stakeOf(this.ctx.run), pocketBroke(this.ctx.run) ? 1 : 0, this.ctx.run.shift.phase].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    this.drawLedger();
    if (this.isLocalOccupant) this.showHud();
  }

  private label(o: Offer): string { return this.t(o.id); }

  /**
   * The cage board, 512 × 288 (every size is 2× the old 256 × 144 layout): a header, the coin and ticket counts, then one
   * row per offer: the key (1-5) in a chip, the name, the price in coins at the right. The selected row is a filled bar
   * with a bright chip, so the list reads at a glance from the seat.
   */
  private drawLedger(): void {
    const s = this.parts.ledger;
    const si = stakeOf(this.ctx.run);
    const offers = this.offers();
    const broke = pocketBroke(this.ctx.run) && this.tickets() > 0;
    s.clear('#081410');
    s.text(this.t('ledger'), 256, 10, { font: 'px5', scale: 4, color: '#80ffb0', align: 'center' });
    s.text(`${this.t('s_coins')} ${fmtNum(this.coins())}`, 16, 50, { font: 'px5', scale: 3, color: '#ffd060' });
    s.text(`${this.t('s_tickets')} ${this.tickets()}`, 496, 50, { font: 'px5', scale: 3, color: '#ff8a8a', align: 'right' });
    s.draw((g) => { g.fillStyle = '#0c2a1c'; g.fillRect(8, 84, 496, 2); });
    const rowY = (i: number): number => 100 + i * 34;
    offers.forEach((o, i) => {
      const y = rowY(i), on = i === this.cursor;
      const hot = broke && o.op === 'sellAll';                // out of coins: the way out is lit
      s.draw((g) => {
        if (on) { g.fillStyle = '#1f5a3a'; g.fillRect(8, y - 7, 496, 28); }
        else if (hot) { g.fillStyle = '#3a3010'; g.fillRect(8, y - 7, 496, 28); }
        g.fillStyle = on || hot ? '#ffd060' : '#16402a';
        g.fillRect(14, y - 5, 28, 22);                       // the key chip
      });
    });
    offers.forEach((o, i) => {
      const y = rowY(i), on = i === this.cursor;
      const hot = broke && o.op === 'sellAll';
      const q = quote(o, si, this.tickets());
      const price = o.op === 'pull' ? this.t('pullCost', { n: o.tickets })
        : o.op === 'buy' ? `-${fmtNum(q.coins)}` : `+${fmtNum(q.coins)}`;
      s.text(`${i + 1}`, 28, y, { font: 'px5', scale: 3, color: on || hot ? '#081410' : '#80c090', align: 'center' });
      s.text(this.label(o), 58, y, { font: 'px5', scale: 3, color: on ? '#f4fff8' : hot ? '#ffe9a0' : '#80c090' });
      s.text(price, 496, y, { font: 'px5', scale: 3, color: on ? '#ffffff' : o.op === 'buy' ? '#ff9a80' : o.op === 'pull' ? '#ff8a8a' : '#ffd060', align: 'right' });
    });
    if (broke) s.text(this.t('brokeLine', { n: fmtNum(this.tickets() * SELL_PER_SI * si) }), 256, 268, { font: 'px5', scale: 2, color: '#ffd060', align: 'center' });
    else s.text(this.t('ledgerHint'), 256, 268, { font: 'px5', scale: 2, color: '#50a070', align: 'center' });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  /** The key bound to a general action (arrows, help, exit). */
  private g(a: BindingKey): string { return this.ctx.input.keyLabel(a); }

  private rulesLines(): Txt[] {
    return [1, 2, 3, 4].map((i) => ({ k: `m.cashier.rule${i}` }));
  }

  /** Banner, coins / tickets / price and the valid controls only. Only while the local player stands here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const sel = this.offers()[this.cursor] ?? null;
    const key = [this.cursor, this.coins(), this.tickets(), pocketBroke(this.ctx.run) ? 1 : 0, this.ctx.run.shift.phase].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const ctrl: HudControl[] = [];
    const si = stakeOf(this.ctx.run);
    sh.goal({ k: 'm.cashier.goal' });

    // STATE: can the selected exchange go through
    const verdict = sel ? check(sel, this.ctx.run, this.selfId) : 'ok';
    if (pocketBroke(this.ctx.run) && sel && sel.op !== 'sellAll' && this.tickets() > 0) sh.state({ k: 'm.cashier.stBroke' }, 'warn', { k: 'm.cashier.stBrokeSub', v: { n: fmtNum(this.tickets() * SELL_PER_SI * si) } });
    else if (!sel) sh.state({ k: 'm.cashier.stNone' }, 'neutral');
    else if (verdict === 'ok') sh.state({ k: 'm.cashier.stReady' }, 'gold', this.label(sel));
    else sh.state({ k: `m.cashier.${verdict}` }, 'warn', { k: 'm.cashier.stBlocked' });

    // KEY NUMBERS
    const q = sel ? quote(sel, si, this.tickets()) : null;
    sh.numbers([
      { label: { k: 'm.cashier.nCoins' }, value: fmtNum(this.coins()), tone: 'gold' },
      { label: { k: 'm.cashier.nTickets' }, value: fmtNum(this.tickets()), tone: 'cyan' },
      { label: { k: 'm.cashier.nPrice' }, value: q ? (sel?.op === 'pull' ? { k: 'm.cashier.pullCost', v: { n: sel.tickets } } : `${fmtNum(q.coins)}`) : '--', tone: verdict === 'ok' ? 'good' : 'bad' },
      { label: { k: 'm.cashier.nRate' }, value: { k: 'm.cashier.rate', v: { b: fmtNum(BUY_PER_SI * si), s: fmtNum(SELL_PER_SI * si) } }, tone: 'neutral' },
    ]);

    // CONTROL BAR: a valid exchange only
    ctrl.push({ key: `${this.k('up')}/${this.k('down')}`, label: { k: 'm.cashier.cPick' }, action: 'up' });
    if (verdict === 'ok') ctrl.push({ key: this.k('primary'), label: { k: 'm.cashier.cGo' }, action: 'primary', primary: true });
    ctrl.push({ key: this.g('help'), label: { k: 'm.cashier.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.cashier.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
