/**
 * Bounty Board (`bounty_board`, system, MOUTH-BOUNTY) — side contracts for the Night (GDD §11.9, BRIEF ADDENDUM 3).
 * rules.ts holds the GDD catalogue and the sign/cash checks; the game counts progress from run events and pays through
 * `run.contracts`. The board signs (accept), cashes (claim) and drops (abandon) through RunApi only. It never prices
 * anything itself. Progress from the blackjack run ("win 3 hands in a row") is the game's job, not this device's.
 *
 * Controls (seated): W/S (↑/↓) move the cursor · 1–3 jump to an offer · Space/Enter SIGN an offer or CASH IN a finished slip ·
 * RMB DROP a signed slip · E stands up.
 * Rows 1–3 are the offers (left column of the cork, numbered); rows 4–6 are the slips you have signed (right column, with
 * their progress). The slip under the cursor has a teal border; its full text is in the HUD strip.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { ContractState, HeadlessPlay } from '@/game/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fitText } from '@/kit/draw';
import { fmtNum, t as tr, upper } from '@/core/i18n';
import { lerp } from '@/core/math';
import { fitPx5, wrapPx5 } from '@/machines/_base/placard3d';
import { buildModel, STAMP_LIFT, type BountyBoardParts, type Card } from './model';
import {
  BOARD_SLOTS, MAX_ACTIVE, SLIP_PAD, SLIP_SCALE, SLIP_TEXT_W, activeFor, boardSlips, canAccept, canClaim, emptyWhy, ensureCatalogue,
  progressText, rewardOf, ticketReward, bountyDef,
} from './rules';

type Ev =
  /** A sign (`sign`), cash-in (`cash`) or drop (`drop`) on row `row`. `why` names the refusal when `ok` is false. */
  { k: 'sign' | 'cash' | 'drop'; row: number; uid: string; def: string; tickets: number; ok: boolean; why: string };

const TEAL = 0x60ffd0;
const GOLD = 0xffd040;
const RED = 0xff4040;
const ROWS = BOARD_SLOTS + MAX_ACTIVE;

// paper, ink and plank colours (canvas CSS)
const PAPER = '#e9dcae', PAPER_READY = '#cde6ae', PAPER_EDGE = '#c9b985';
const INK = '#2a1c0c', INK_SOFT = '#6a5636', REWARD = '#7a4600', READY = '#1f6a2a';
const SELECT = '#18d0a4', PIN = '#8c6b29', PIN_SELECT = '#d03030';
const PLANK = '#2a1a0e', PLANK_TEXT = '#ffd070', HEAD_TEXT = '#e6d2a0';
/** px5 cap height and line pitch at the slip scale, in texels. */
const CAP = 7 * SLIP_SCALE, LINE = 10 * SLIP_SCALE;

/** What a slip shows: number badge (offers), title, last line (reward, progress or CASH IN) and its state. */
interface SlipFace { num: string; title: string; line: string; tone: string; sel: boolean; ready: boolean }

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
  /** The slip under row `i`, offered or signed. */
  private slipAt(i: number): ContractState | null {
    return (i < BOARD_SLOTS ? this.board()[i] : this.active()[i - BOARD_SLOTS]) ?? null;
  }

  tick(): void { this.refresh(false); }

  attract(dt: number): void { this.attractor.update(dt); }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    // start on a slip, so the HUD has something selected even when every offer is gone
    this.cursor = 0;
    for (let i = 0; i < ROWS; i++) if (this.rowState(i)) { this.cursor = i; break; }
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
    if (!row) { void this.emit({ k: 'sign', row: i, uid: '', def: '', tickets: 0, ok: false, why: emptyWhy(i, this.board().length) }); return; }
    const c = this.slipAt(i);
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
    const { signed, stamp } = this.parts;
    const fx = this.ctx.fx;
    const at = this.model.anchors.coinOut;
    const name = this.t(`c.${ev.def}.t`);

    if (ev.k === 'sign') {
      // the offer is already gone (the run moved in the credit step): the stamped slip flutters in the SIGNED column
      const slip = signed[this.active().findIndex((c) => c.uid === ev.uid)]?.root ?? null;
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
    if (ev.tickets > 0) fx.popText(at, this.t('tickets', { n: ev.tickets }), GOLD, 1.4);
    await this.anim(0.25, (k) => { stamp.position.y = lerp(y0 + STAMP_LIFT, y0, k); }, 'outQuad');
    this.refresh(true);
  }

  // ── the board and the HUD ───────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const board = this.board();
    const active = this.active();
    const key = [this.cursor, board.map((c) => c.uid).join(','), active.map((c) => `${c.uid}:${c.status}:${c.progress}`).join(','), this.ctx.run.balance('ticket', this.selfId)].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    this.drawBoard(board, active);
    if (this.isLocalOccupant) this.showHud();
  }

  /** The reward on an offer's last line, e.g. "3 TICKETS", "10 % QUOTA", "PROFIT BELL". */
  private rewardText(defId: string): string {
    const r = rewardOf(bountyDef(defId) ?? this.ctx.run.contracts.defs().find((x) => x.id === defId));
    switch (r.kind) {
      case 'tickets': return upper(this.t('tickets', { n: r.n }));
      case 'quota': return upper(this.t('quota', { n: r.n }));
      case 'totem': return upper(tr(`totem.${r.id}.name`));
      case 'charm': return upper(this.t('r_charm'));
      case 'unlock': return upper(this.t('r_unlock'));
      case 'buff': return upper(this.t('r_buff'));
      case 'none': return '--';
    }
  }

  /** Repaint every card: headers, the three offers, the three signed slips, and the note when the board is empty. */
  private drawBoard(board: readonly ContractState[], active: readonly ContractState[]): void {
    const { offers, signed, note, heads } = this.parts;
    const tex = this.ctx.kit.tex;
    const head = (c: Card, text: string, color: string, pad: number): void => {
      fitText(tex, c.g, text, c.w, c.h, { font: 'px5', color, bg: PLANK, pad });
      c.tex.needsUpdate = true;
    };
    head(heads[0], this.t('ledger'), PLANK_TEXT, 8);
    head(heads[1], this.t('offers'), HEAD_TEXT, 4);
    head(heads[2], this.t('active'), HEAD_TEXT, 4);

    for (let i = 0; i < BOARD_SLOTS; i++) {
      const c = board[i] ?? null;
      offers[i].root.visible = !!c;
      if (c) this.paintSlip(offers[i], { num: String(i + 1), title: this.t(`c.${c.def}.t`), line: this.rewardText(c.def), tone: REWARD, sel: i === this.cursor, ready: false });
    }
    for (let j = 0; j < MAX_ACTIVE; j++) {
      const c = active[j] ?? null;
      signed[j].root.visible = !!c;
      if (!c) continue;
      const goal = this.ctx.run.contracts.defs().find((x) => x.id === c.def)?.goal.count ?? 1;
      const ready = c.status === 'done';
      this.paintSlip(signed[j], {
        num: '', title: this.t(`c.${c.def}.t`), line: ready ? upper(this.t('h_cash')) : progressText(c, goal),
        tone: ready ? READY : INK, sel: BOARD_SLOTS + j === this.cursor, ready,
      });
    }

    note.root.visible = board.length === 0;
    if (board.length === 0) this.paintNote(note, active.length > 0 ? this.t('note_signed', { n: active.length }) : this.t('note_none'));
  }

  /** Paper, pin and (when under the cursor) the teal border. */
  private paper(c: Card, o: { sel: boolean; ready: boolean }): void {
    const { g, w, h } = c;
    const cx = Math.round(w / 2);
    g.fillStyle = o.ready ? PAPER_READY : PAPER;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PAPER_EDGE;
    g.fillRect(0, h - 6, w, 6);                                        // shaded bottom edge
    g.fillStyle = INK_SOFT;
    g.fillRect(cx - 7, 3, 14, 14);                                     // pin: a dark square with a bright head
    g.fillStyle = o.sel ? PIN_SELECT : PIN;
    g.fillRect(cx - 5, 5, 10, 10);
    if (o.sel) { g.strokeStyle = SELECT; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); }
  }

  private paintSlip(c: Card, f: SlipFace): void {
    const { g, w, h } = c;
    const tex = this.ctx.kit.tex;
    this.paper(c, f);
    // title: up to two lines, centred between the pin and the rule; a longer one ends in '..'
    let rows = wrapPx5(f.title, SLIP_TEXT_W, SLIP_SCALE);
    if (rows.length > 2) rows = [rows[0], fitPx5(rows.slice(1).join(' '), SLIP_TEXT_W, SLIP_SCALE)];
    const cx = Math.round(w / 2);
    const lineY = h - 10 - CAP;                                        // reward / progress line, cap top
    const ruleY = lineY - 6;
    const top = 34, zone = ruleY - 8 - top;                            // 8 = descender room above the rule
    const y0 = top + Math.round((zone - (CAP + LINE * (rows.length - 1))) / 2);
    rows.forEach((r, k) => tex.drawText(g, r, cx, y0 + k * LINE, { font: 'px5', scale: SLIP_SCALE, color: INK, align: 'center' }));
    g.fillStyle = INK_SOFT;
    g.fillRect(SLIP_PAD, ruleY, w - SLIP_PAD * 2, 3);
    tex.drawText(g, f.line, cx, lineY, { font: 'px5', scale: SLIP_SCALE, color: f.tone, align: 'center' });
    if (f.num) tex.drawText(g, f.num, SLIP_PAD - 4, 6, { font: 'px5', scale: 3, color: INK_SOFT });
    c.tex.needsUpdate = true;
  }

  /** The tall card over the empty offers column: why there is nothing to sign. */
  private paintNote(c: Card, text: string): void {
    const tex = this.ctx.kit.tex;
    this.paper(c, { sel: false, ready: false });
    const rows = wrapPx5(text, SLIP_TEXT_W, SLIP_SCALE).slice(0, Math.floor((c.h - 48) / LINE));
    const y0 = Math.round((c.h - (CAP + LINE * (rows.length - 1))) / 2);
    rows.forEach((r, k) => tex.drawText(c.g, r, Math.round(c.w / 2), y0 + k * LINE, { font: 'px5', scale: SLIP_SCALE, color: INK, align: 'center' }));
    c.tex.needsUpdate = true;
  }

  private showHud(): void {
    const sel = this.slipAt(this.cursor);
    const key = [this.cursor, sel?.uid ?? '', sel?.status ?? '', this.active().length, this.board().length].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    // W/S move the cursor; Space/Enter and RMB act on the slip under it, so only the action that works there is listed
    const hints: HudHint[] = [
      { action: 'up', label: this.t('h_prev') },
      { action: 'down', label: this.t('h_next') },
    ];
    if (sel?.status === 'offered') hints.push({ action: 'primary', label: this.t('h_sign') });
    else if (sel?.status === 'done') hints.push({ action: 'primary', label: this.t('h_cash') });
    else if (sel?.status === 'active') hints.push({ action: 'secondary', label: this.t('h_drop') });
    hints.push({ action: 'exit', label: this.t('h_leave') });
    this.hud({
      bet: null,
      hints,
      stats: [
        { label: this.t('s_slips'), value: `${this.active().length}/${MAX_ACTIVE}` },
        { label: this.t('s_tickets'), value: fmtNum(this.ctx.run.balance('ticket', this.selfId)) },
        { label: this.t('s_pick'), value: sel ? this.t(`c.${sel.def}.d`) : '--' },
      ],
    });
  }
}
