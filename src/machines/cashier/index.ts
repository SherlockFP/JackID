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
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, CAP_SINK, TRAY_SLIDE, LAMP, type CashierParts } from './model';
import { OFFERS, apply, check, quote, stakeOf, wrapOffer, type Offer, type OfferOp } from './rules';

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
      desc: 'Trade coins for Tickets and back. The cage pays less than it takes. In the Free Casino it lends House Credit.',
    },
    tr: {
      name: 'Kasa',
      desc: 'Paranı bilete, biletini paraya çevir. Kasa aldığından az öder. Serbest Kumarhane’de ev kredisi verir.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Cashier extends MachineBase<CashierParts, Ev, null> {
  private cursor = 0;
  private repaintKey = '';
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<CashierParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh(true);
    this.attractor.every('blink', 7, () => this.ctx.fx.glow(this.model.anchors.light, LAMP, 0.25, 0.5), { first: 4 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private coins(): number { return this.ctx.run.balance('coin', this.selfId); }
  private tickets(): number { return this.ctx.run.balance('ticket', this.selfId); }

  tick(): void { this.refresh(false); }

  attract(dt: number): void { this.attractor.update(dt); }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
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
    const offer: Offer | undefined = OFFERS[i];
    if (!offer) return;
    const run = this.ctx.run;
    const si = stakeOf(run);
    const q = quote(offer, si);
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
    if (ev.op === 'loan') {
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
    }

    // impact: a loan rings the bell, a big exchange gets a flash
    if (ev.op !== 'loan' && Math.abs(ev.tickets) >= 5) { this.sfx('stamp'); fx.flash(GREEN, 0.06, 0.2); }

    // follow-through: cap springs back, tray returns, ledger repaints
    await this.anim(0.25, (k) => {
      tray.position.z = lerp(z0 + TRAY_SLIDE, z0, k);
      if (cap) cap.position.y = lerp(y0 - CAP_SINK, y0, k);
    }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const key = [this.cursor, this.coins(), this.tickets(), this.ctx.run.mode, stakeOf(this.ctx.run)].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    this.drawLedger();
    if (this.isLocalOccupant) this.showHud();
  }

  private label(o: Offer): string { return this.t(o.id); }

  private drawLedger(): void {
    const s = this.parts.ledger;
    const si = stakeOf(this.ctx.run);
    s.clear('#081410');
    s.text(this.t('ledger'), 64, 4, { font: 'px5', color: '#80ffb0', align: 'center' });
    s.text(`${this.t('s_coins')} ${fmtNum(this.coins())}`, 4, 14, { font: 'px5', color: '#ffd060' });
    s.text(`${this.t('s_tickets')} ${this.tickets()}`, 124, 14, { font: 'px5', color: '#ff8a8a', align: 'right' });
    OFFERS.forEach((o, i) => {
      const y = 26 + i * 9;
      const mark = i === this.cursor ? '>' : ' ';
      const q = quote(o, si);
      const price = o.op === 'buy' ? `-${fmtNum(q.coins)}` : `+${fmtNum(q.coins)}`;
      s.text(`${mark}${i + 1} ${this.label(o)}`, 2, y, { font: 'px5', color: i === this.cursor ? '#e0ffe8' : '#80c090' });
      s.text(price, 126, y, { font: 'px5', color: o.op === 'buy' ? '#ff9a80' : '#ffd060', align: 'right' });
    });
    s.text(this.t('ledgerHint'), 64, 66, { font: 'px5', color: '#50a070', align: 'center' });
  }

  private showHud(): void {
    const sel = OFFERS[this.cursor] ?? null;
    const key = [this.cursor, this.coins(), this.tickets()].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const hints: HudHint[] = [
      { action: 'up', label: this.t('h_pick') },
      { action: 'primary', label: this.t('h_go') },
      { action: 'exit', label: this.t('h_leave') },
    ];
    this.hud({
      bet: null,
      hints,
      stats: [
        { label: this.t('s_coins'), value: fmtNum(this.coins()) },
        { label: this.t('s_tickets'), value: String(this.tickets()) },
        { label: this.t('s_offer'), value: sel ? this.label(sel) : '--' },
      ],
    });
  }
}
