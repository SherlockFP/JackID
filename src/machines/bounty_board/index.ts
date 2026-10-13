/**
 * Bounty Board (`bounty_board`, system, MOUTH-BOUNTY) — side contracts for the Night (GDD §11.9, BRIEF ADDENDUM 3).
 * rules.ts holds the GDD catalogue and the sign/cash checks; the game counts progress from run events and pays through
 * `run.contracts`. The board signs (accept), cashes (claim) and drops (abandon) through RunApi only. It never prices
 * anything itself. Progress from the blackjack run ("win 3 hands in a row") is the game's job, not this device's.
 *
 * Controls (seated): ↑/↓ move the cursor · 1–3 pick an offer · Space/Enter SIGN an offer or CASH IN a finished slip ·
 * RMB DROP a signed slip · E stands up.
 * Rows 1–3 are the offers on the cork; rows 4–6 are the slips you have signed (progress shown on the ledger).
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { ContractState, HeadlessPlay } from '@/game/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtNum } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, STAMP_LIFT, type BountyBoardParts } from './model';
import {
  BOARD_SLOTS, MAX_ACTIVE, activeFor, boardSlips, canAccept, canClaim, ensureCatalogue, progressText, ticketReward,
  bountyDef,
} from './rules';

type Ev =
  /** A sign (`sign`), cash-in (`cash`) or drop (`drop`) on row `row`. `why` names the refusal when `ok` is false. */
  { k: 'sign' | 'cash' | 'drop'; row: number; uid: string; def: string; tickets: number; ok: boolean; why: string };

const TEAL = 0x60ffd0;
const GOLD = 0xffd040;
const RED = 0xff4040;
const ROWS = BOARD_SLOTS + MAX_ACTIVE;

export const def: MachineDef = {
  id: 'bounty_board',
  category: 'system',
  slotSize: 'M',
  zone: 'services',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'contracts', 'board'],
  modHooks: {},
  strings: {
    en: {
      name: 'Bounty Board',
      desc: 'Side contracts pinned to the cork. Sign a slip, finish it before Dawn, and cash it in for Tickets or quota.',
    },
    tr: {
      name: 'İlan Panosu',
      desc: 'Mantarın üstündeki yan görevler. Bir pusula imzala, şafaktan önce bitir, bileti veya kotayı tahsil et.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class BountyBoard extends MachineBase<BountyBoardParts, Ev, null> {
  private cursor = 0;
  private repaintKey = '';
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<BountyBoardParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    ensureCatalogue(this.ctx.run);
    this.refresh(true);
    this.attractor.every('flutter', 6, () => this.ctx.fx.glow(this.model.anchors.light, 0xff8a50, 0.22, 0.5), { first: 3 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private board(): ContractState[] { return boardSlips(this.ctx.run); }
  private active(): ContractState[] { return activeFor(this.ctx.run, this.selfId); }
  private rowState(i: number): { uid: string; active: boolean } | null {
    if (i < BOARD_SLOTS) { const c = this.board()[i]; return c ? { uid: c.uid, active: false } : null; }
    const c = this.active()[i - BOARD_SLOTS];
    return c ? { uid: c.uid, active: true } : null;
  }

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
      case 'up': this.moveCursor((this.cursor - 1 + ROWS) % ROWS); return;
      case 'down': this.moveCursor((this.cursor + 1) % ROWS); return;
      case 'n1': case 'n2': case 'n3': this.moveCursor(Number(e.action.slice(1)) - 1); return;
      case 'primary': case 'confirm': this.press(this.cursor); return;
      case 'secondary': this.drop(this.cursor); return;
    }
  }

  private moveCursor(i: number): void {
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  /** Sign an offer, or cash in a finished slip. Refusals are checked here; the run moves the state in the credit step. */
  private press(i: number): void {
    const run = this.ctx.run;
    const row = this.rowState(i);
    if (!row) { void this.emit({ k: 'sign', row: i, uid: '', def: '', tickets: 0, ok: false, why: 'none' }); return; }
    const c = row.active ? this.active()[i - BOARD_SLOTS] : this.board()[i];
    if (!c) return;
    const d = bountyDef(c.def) ?? run.contracts.defs().find((x) => x.id === c.def);
    const tickets = ticketReward(d);
    if (row.active) {
      const v = canClaim(run, this.selfId, c.uid);
      if (v === 'ok') {
        void this.emit({ k: 'cash', row: i, uid: c.uid, def: c.def, tickets, ok: true, why: '' }, () => {
          if (!run.contracts.claim(c.uid)) this.ctx.ui.toast(this.t('notdone'), 'bad');
        });
      } else {
        void this.emit({ k: 'cash', row: i, uid: c.uid, def: c.def, tickets, ok: false, why: v });
      }
      return;
    }
    const v = canAccept(run, this.selfId, c.uid);
    void this.emit(
      { k: 'sign', row: i, uid: c.uid, def: c.def, tickets, ok: v === 'ok', why: v },
      v === 'ok' ? () => {
        if (!run.contracts.accept(c.uid)) this.ctx.ui.toast(this.t('gone'), 'bad');
      } : undefined,
    );
  }

  /** Drop a signed slip. Free; the reward is lost. */
  private drop(i: number): void {
    if (i < BOARD_SLOTS) return;
    const c = this.active()[i - BOARD_SLOTS];
    if (!c) return;
    const run = this.ctx.run;
    void this.emit({ k: 'drop', row: i, uid: c.uid, def: c.def, tickets: 0, ok: true, why: '' }, () => {
      run.contracts.abandon(c.uid);
    });
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    return this.presentSlip(ev, pc);
  }

  private denied(why: string): void {
    this.sfx('error');
    const stamp = this.parts.stamp;
    const x0 = stamp.position.x;
    void this.anim(0.2, (k) => { stamp.position.x = x0 + Math.sin(k * Math.PI * 6) * 0.012; });
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentSlip(ev: Ev, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    if (pc.fast) { this.refresh(true); return; }
    const { slips, stamp } = this.parts;
    const fx = this.ctx.fx;
    const at = this.model.anchors.coinOut;
    const name = this.t(`c.${ev.def}.t`);

    if (ev.k === 'sign') {
      const slip = slips[ev.row] ?? null;
      this.sfx('stamp');
      fx.popText(slip ?? at, name, TEAL, { scale: 1.1 });
      if (slip) {
        const z0 = slip.position.z;
        await this.anim(0.3, (k) => { slip.position.z = z0 + Math.sin(k * Math.PI) * 0.06; slip.rotation.z = Math.sin(k * Math.PI * 2) * 0.12; }, 'outQuad');
        slip.rotation.z = 0;
        slip.position.z = z0;
      }
      this.refresh(true);
      return;
    }

    if (ev.k === 'drop') {
      this.sfx('button');
      fx.popText(at, name, RED, { scale: 0.9 });
      this.refresh(true);
      return;
    }

    // cash: the stamp slams down, coins and Tickets pour out, the slip flashes
    this.sfx('button');
    const y0 = stamp.position.y;
    await this.anim(0.12, (k) => { stamp.position.y = lerp(y0, y0 + STAMP_LIFT, k); }, 'outQuad');
    this.sfx('stamp');
    fx.flash(GOLD, 0.14, 0.25);
    fx.confetti(at, 12);
    fx.coins(at, 10, { spread: 0.15, up: 0.25 });
    fx.popText(at, this.t('stamp'), GOLD, { scale: 1.4 });
    if (ev.tickets > 0) fx.popText(at, this.t('tickets', { n: fmtNum(ev.tickets) }), GOLD, 1.4);
    await this.anim(0.25, (k) => { stamp.position.y = lerp(y0 + STAMP_LIFT, y0, k); }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const board = this.board();
    const active = this.active();
    const key = [this.cursor, board.map((c) => c.uid).join(','), active.map((c) => `${c.uid}:${c.status}:${c.progress}`).join(','), this.ctx.run.balance('ticket', this.selfId)].join('|');
    for (let i = 0; i < BOARD_SLOTS; i++) {
      const slip = this.parts.slips[i];
      if (slip) slip.visible = !!board[i];
    }
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    this.drawScreen(board, active);
    if (this.isLocalOccupant) this.showHud();
  }

  private payText(defId: string): string {
    const d = this.ctx.run.contracts.defs().find((x) => x.id === defId);
    const n = ticketReward(d);
    if (n > 0) return this.t('pays', { n: `${n}T` });
    const frac = d?.reward.coins;
    if (frac && typeof frac === 'object') return this.t('pays', { n: `${Math.round(frac.quotaFrac * 100)}%` });
    return '--';
  }

  private drawScreen(board: readonly ContractState[], active: readonly ContractState[]): void {
    const s = this.parts.screen;
    s.clear('#14100a');
    s.text(this.t('ledger'), 64, 3, { font: 'px5', color: '#ffb070', align: 'center' });
    s.text(this.t('offers'), 2, 13, { font: 'px5', color: '#c8a080' });
    for (let i = 0; i < BOARD_SLOTS; i++) {
      const c = board[i] ?? null;
      const y = 22 + i * 10;
      const mark = i === this.cursor ? '>' : ' ';
      s.text(c ? `${mark}${i + 1} ${this.t(`c.${c.def}.t`).slice(0, 14)}` : `${mark}${i + 1} --`, 2, y, { font: 'px5', color: c ? '#ffe0c0' : '#604838' });
      if (c) s.text(this.payText(c.def), 126, y, { font: 'px5', color: '#ffd060', align: 'right' });
    }
    s.text(this.t('active'), 2, 56, { font: 'px5', color: '#c8a080' });
    for (let j = 0; j < MAX_ACTIVE; j++) {
      const c = active[j] ?? null;
      const y = 64 + j * 9;
      const row = BOARD_SLOTS + j;
      const mark = row === this.cursor ? '>' : ' ';
      if (!c) { s.text(`${mark}${row + 1} --`, 2, y, { font: 'px5', color: '#604838' }); continue; }
      const goal = this.ctx.run.contracts.defs().find((x) => x.id === c.def)?.goal.count ?? 1;
      const ready = c.status === 'done';
      s.text(`${mark}${row + 1} ${this.t(`c.${c.def}.t`).slice(0, 12)}`, 2, y, { font: 'px5', color: ready ? '#ffe070' : '#c8ffe0' });
      s.text(ready ? this.t('stamp') : progressText(c, goal), 126, y, { font: 'px5', color: ready ? '#ffe070' : '#80c0a0', align: 'right' });
    }
  }

  private showHud(): void {
    const sel = this.board()[this.cursor] ?? this.active()[this.cursor - BOARD_SLOTS] ?? null;
    const key = [this.cursor, this.active().length, this.board().length].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const hints: HudHint[] = [
      { action: 'up', label: this.t('h_pick') },
      { action: 'primary', label: this.t('h_sign') },
      { action: 'secondary', label: this.t('h_drop') },
      { action: 'exit', label: this.t('h_leave') },
    ];
    this.hud({
      bet: null,
      hints,
      stats: [
        { label: this.t('s_slips'), value: `${this.active().length} / ${MAX_ACTIVE}` },
        { label: this.t('s_tickets'), value: fmtNum(this.ctx.run.balance('ticket', this.selfId)) },
        { label: this.t('s_pick'), value: sel ? this.t(`c.${sel.def}.d`) : '--' },
      ],
    });
  }
}
