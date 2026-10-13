/**
 * Debt Terminal (`debt_terminal`, system) — deposits towards the Night's quota (GDD §2.6). devices-core lane.
 *
 * Talks to the game ONLY through `ctx.run`: `run.shift.quota()` (due, deposited, base, assessment, ratio, met),
 * `run.shift.overshootTiers()`, `run.wallet()`, `run.canAfford()`, `run.deposit()`, `run.shift.settleEarly()`.
 * Nothing here decides money. The terminal turns keypad presses into one `dep` event; `present()` plays the coin
 * stream, chews, rolls the counter and prints the receipt on every peer.
 *
 * Controls (seated, play pose is `mouse: 'pick'`): arrows move the keypad cursor · Space/Enter press the cell ·
 * LMB presses a cell · 1–9 type a custom amount · Backspace removes a digit · BET UP (X) types a 0 (the machine
 * keymap has no digit 0) · R pulls SETTLE (only when the quota is met) · F pulls OPEN THE FLOOR (not wired yet).
 *
 * Presentation pattern: state is read from run on every peer (`tick` keeps the LEDs/CRT in step); `present()` only
 * animates. Credit first, present after: the deposit is applied inside `emit`'s credit step.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import { countUp } from '@/machines/_base/juice';
import type { BindingKey, MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtCoins, fmtNum } from '@/core/i18n';
import type { OvershootTier, QuotaState } from '@/game/types';

const EMPTY_QUOTA: QuotaState = { due: 0, base: 0, assessment: 0, deposited: 0, perPlayer: {}, met: false, overshoot: 0, ratio: 0, claimed: [] };
import { lerp, clamp } from '@/core/math';
import { buildModel, type DebtParts } from './model';
import {
  KEYS, KEY_COLS, COIN_STREAM_S, amountFor, appendDigit, backspace, clampDeposit, customAmount, nextTier, pct,
  quotaLeft, ratioOf, rollSeconds, type KeyId,
} from './rules';

type Ev =
  /** One keypad action. `ok:false` = refused (no funds / nothing to pay): a red flash, no money moved. */
  | { k: 'dep'; key: string; amount: number; ok: boolean; dep: number }
  | { k: 'lever'; id: 'settle' | 'floor'; ok: boolean };

const GOLD = 0xffd040;
const RED = 0xff3030;

export const def: MachineDef = {
  id: 'debt_terminal',
  category: 'system',
  slotSize: 'M',
  zone: 'tables',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'terminal'],
  modHooks: {},
  strings: {
    en: {
      name: 'Debt Terminal',
      desc: 'Deposit coins towards tonight’s quota. Settle early when you have paid.',
      k_p10: '10%', k_p25: '25%', k_p50: '50%', k_all: 'ALL', k_rest: 'REST', k_enter: 'ENTER',
      crt_title: 'HOUSE DEBT TERMINAL', crt_base: 'BASE', crt_assess: 'ASSESSMENT', crt_quota: 'QUOTA',
      crt_dep: 'DEPOSITED', crt_left: 'LEFT', crt_ratio: 'OF QUOTA', crt_next: 'NEXT AT', crt_entry: 'AMOUNT',
      crt_wallet: 'WALLET', crt_hint: '1-9 AMOUNT  ENTER OK', crt_met: 'QUOTA MET: SETTLE',
      rc_title: 'RECEIPT', rc_base: 'BASE', rc_assess: 'ASSESS', rc_dep: 'DEP', rc_quota: 'QUOTA', rc_left: 'LEFT', rc_thanks: 'THANK YOU',
      quotaMet: 'QUOTA MET', denied: 'DENIED', settled: 'SETTLED', notYet: 'NOT YET', floorNo: 'FLOOR LOCKED',
      h_move: 'MOVE', h_press: 'PRESS', h_digits: 'AMOUNT', h_clear: 'BACK', h_settle: 'SETTLE', h_leave: 'LEAVE',
      s_entry: 'AMOUNT',
      goal: "Pay tonight's quota in coins. Once it is met, settle the terminal.",
      rule1: "The house sets a quota for tonight. Deposit coins towards it until it is covered.",
      rule2: "Keypad: 10%, 25% or 50% of your wallet, ALL, or REST (what is still due). Or type an amount and press ENTER.",
      rule3: "Deposits never exceed your wallet. Once the quota is met, SETTLE closes the terminal early.",
      rule4: "Keys: arrows move the keypad cursor, PRESS hits a key, 1-9 type an amount, BACK removes a digit.",
      stNone: "NO QUOTA DUE",
      stMet: "QUOTA MET",
      stMetSub: "Press SETTLE to close the terminal",
      stDeposit: "DEPOSIT TO MEET THE QUOTA",
      stDepositSub: "{n} still due",
      nDue: "DUE",
      nDeposited: "DEPOSITED",
      nLeft: "LEFT",
      nAmount: "AMOUNT",
      nWallet: "WALLET",
      cMove: "MOVE",
      cPress: "PRESS",
      cAmount: "AMOUNT",
      cBack: "BACK",
      cSettle: "SETTLE",
      cRules: "RULES",
      cLeave: "LEAVE",
      tip1: "Pay the quota in coins. Pick an amount on the keypad and press it.",
      tip2: "[{move}] MOVE  ·  [{press}] PRESS  ·  [{digits}] TYPE AN AMOUNT",
      tip3: "Quota met? [{settle}] SETTLE  ·  [{help}] RULES",
    },
    tr: {
      name: 'Borç Terminali',
      desc: 'Bu gecenin kotasına doğru para yatır. Ödeyince erken kapat.',
      k_p10: '%10', k_p25: '%25', k_p50: '%50', k_all: 'HEPSİ', k_rest: 'KALAN', k_enter: 'ONAY',
      crt_title: 'EV BORÇ TERMİNALİ', crt_base: 'TABAN', crt_assess: 'DEĞERLEME', crt_quota: 'KOTA',
      crt_dep: 'YATIRILAN', crt_left: 'KALAN', crt_ratio: 'KOTANIN', crt_next: 'SONRAKİ', crt_entry: 'TUTAR',
      crt_wallet: 'CÜZDAN', crt_hint: '1-9 TUTAR  ENTER ONAY', crt_met: 'KOTA TAMAM: KAPAT',
      rc_title: 'FİŞ', rc_base: 'TABAN', rc_assess: 'DEĞER', rc_dep: 'YAT', rc_quota: 'KOTA', rc_left: 'KALAN', rc_thanks: 'TEŞEKKÜRLER',
      quotaMet: 'KOTA TAMAM', denied: 'REDDEDİLDİ', settled: 'KAPANDI', notYet: 'HENÜZ DEĞİL', floorNo: 'KAT KİLİTLİ',
      h_move: 'GEZ', h_press: 'BAS', h_digits: 'TUTAR', h_clear: 'GERİ', h_settle: 'KAPAT', h_leave: 'AYRIL',
      s_entry: 'TUTAR',
      goal: "Bu gecenin kotasını jetonla öde. Kota tamamlanınca terminali kapat.",
      rule1: "Ev bu gece için bir kota koyar. Kota kapanana kadar jeton yatır.",
      rule2: "Tuş takımı: cüzdanının %10, %25 ya da %50'si, HEPSİ, ya da KALAN (hâlâ borçlu olduğun). Ya da bir tutar yaz ve ONAY'a bas.",
      rule3: "Yatırım cüzdanını aşamaz. Kota tamamlanınca KAPAT terminali erken kapatır.",
      rule4: "Tuşlar: oklar tuş takımında gezer, BAS tuşa basar, 1-9 tutar yazar, GERİ bir rakam siler.",
      stNone: "ÖDENECEK KOTA YOK",
      stMet: "KOTA TAMAM",
      stMetSub: "Terminali kapatmak için KAPAT'a bas",
      stDeposit: "KOTAYI TAMAMLAMAK İÇİN YATIR",
      stDepositSub: "{n} hâlâ borç",
      nDue: "BORÇ",
      nDeposited: "YATIRILAN",
      nLeft: "KALAN",
      nAmount: "TUTAR",
      nWallet: "CÜZDAN",
      cMove: "GEZ",
      cPress: "BAS",
      cAmount: "TUTAR",
      cBack: "GERİ",
      cSettle: "KAPAT",
      cRules: "KURALLAR",
      cLeave: "AYRIL",
      tip1: "Kotayı jetonla öde. Tuş takımından bir tutar seçip bas.",
      tip2: "[{move}] GEZ  ·  [{press}] BAS  ·  [{digits}] TUTAR YAZ",
      tip3: "Kota tamam mı? [{settle}] KAPAT  ·  [{help}] KURALLAR",
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class DebtTerminal extends MachineBase<DebtParts, Ev, null> {
  /** Keypad cursor (0..5, row-major over KEYS). Local UI only. */
  private cursor = 0;
  /** Typed custom amount (digits). Local UI only. */
  private entry = '';
  /** Deposit total shown on the counter (count-up target is the run's value). */
  private shownDep = 0;
  private lastKey = '';
  private lastDue = -1;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<DebtParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.shownDep = this.quota().deposited;
    this.refresh(true);
    this.drawReceipt(this.quota().base, this.quota().assessment, this.quota().due, this.shownDep);
    this.attractor.every('eye', 8, () => this.ctx.fx.glow(this.parts.emblemLid, GOLD, 0.35, 0.7), { first: 4 });
  }

  // ── run state (read on every peer) ──────────────────────────────────────────────────────────────
  /** The bench stubs `shift.quota()` (undefined): fall back to an empty quota so the terminal still renders. */
  private quota(): Readonly<QuotaState> { return this.ctx.run.shift.quota() ?? EMPTY_QUOTA; }
  private tiers(): readonly OvershootTier[] { return this.ctx.run.shift.overshootTiers() ?? []; }
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }

  tick(_dt: number): void {
    this.refresh(false);
  }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    if (local) {
      this.entry = ''; this.sfx('chime');
      this.seatHud?.show(); this.showHud();
      this.seatHud?.firstTip('debt_terminal', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.entry = ''; this.seatHud?.hide(); }
  }

  onLang(): void {
    this.lastKey = '';            // force a repaint of the CRT and LEDs
    this.refresh(true);
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const row = Math.floor(this.cursor / KEY_COLS), col = this.cursor % KEY_COLS;
    switch (e.action) {
      case 'left': this.moveCursor(row * KEY_COLS + ((col + KEY_COLS - 1) % KEY_COLS)); return;
      case 'right': this.moveCursor(row * KEY_COLS + ((col + 1) % KEY_COLS)); return;
      case 'up': case 'down': this.moveCursor((1 - row) * KEY_COLS + col); return;
      case 'primary': case 'confirm': if (!e.repeat) this.pressKey(KEYS[this.cursor]); return;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': case 'n7': case 'n8': case 'n9':
        this.typeDigit(Number(e.action.slice(1))); return;
      case 'betUp': {                                        // no digit 0 in the machine keymap (see header)
        // the mouse wheel is bound to betUp too: a stray notch must never type a digit
        const code = (e as MachineInputEvent & { code?: string }).code ?? '';
        if (e.repeat || code.startsWith('Wheel')) return; // i18n-ok: key code
        this.typeDigit(0);
        return;
      }
      case 'clear': if (!e.repeat) { this.entry = backspace(this.entry); this.sfx('click'); this.refresh(true); } return;
      case 'double': if (!e.repeat) this.pullLever('settle'); return;
      case 'fast': if (!e.repeat) this.pullLever('floor'); return;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    const hit = this.pick([this.parts.keys.caps]);
    const btn = hit ? this.parts.keys.pick(hit) : null;
    if (!btn) return;
    const i = KEYS.indexOf(btn.id as KeyId);
    if (i >= 0) { this.cursor = i; this.pressKey(KEYS[i]); }
  }

  private moveCursor(i: number): void {
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  private typeDigit(d: number): void {
    const next = appendDigit(this.entry, d);
    if (next === this.entry) return;
    this.entry = next;
    this.sfx('click');
    this.refresh(true);
  }

  /** Authority side: work out the amount, take the money (credit step), then present the stream on every peer. */
  private pressKey(key: KeyId): void {
    const q = this.quota();
    const wallet = this.wallet();
    const amount = key === 'enter'
      ? clampDeposit(customAmount(this.entry), wallet)
      : clampDeposit(amountFor(key, wallet, quotaLeft(q.due, q.deposited)), wallet);
    if (key === 'enter') this.entry = '';
    const ok = amount > 0 && this.ctx.run.canAfford(amount, this.selfId);
    const dep = q.deposited + (ok ? amount : 0);
    void this.emit(
      { k: 'dep', key, amount, ok, dep },
      ok ? () => { if (!this.ctx.run.deposit(amount)) this.ctx.ui.toast(this.t('denied'), 'bad'); } : undefined,
    );
    this.refresh(true);
  }

  private pullLever(id: 'settle' | 'floor'): void {
    if (id === 'settle') {
      const q = this.quota();
      const ok = q.met && this.ctx.run.shift.settleEarly();
      void this.emit({ k: 'lever', id, ok });
      if (!ok) this.ctx.ui.toast(this.t('notYet'), 'warn');
      return;
    }
    // OPEN THE FLOOR needs a run-level start call that RunApi does not expose yet: the lever only refuses for now.
    void this.emit({ k: 'lever', id, ok: false });
    this.ctx.ui.toast(this.t('floorNo'), 'warn');
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'lever') return this.presentLever(ev, pc);
    return this.presentDeposit(ev, pc);
  }

  private async presentDeposit(ev: Extract<Ev, { k: 'dep' }>, pc: PresentCtx): Promise<void> {
    const { keys, mouthLips, receiptPivot, swipe } = this.parts;
    const fx = this.ctx.fx;
    const anchor = this.model.anchors.coinOut;
    const btn = keys.buttons[ev.key];
    const prev = this.shownDep;

    if (pc.fast) {
      this.shownDep = ev.dep;
      this.refresh(true);
      return;
    }
    const due = this.quota().due;
    const wasMet = ev.ok && ev.dep - ev.amount >= due;

    void btn?.press(0.1);
    this.sfx('button');

    if (!ev.ok) {
      if (this.isLocalOccupant) this.seatHud?.result('lose');
      this.sfx('error');
      fx.shake(0.012, 0.18);
      fx.popText(anchor, this.t('denied'), RED, { scale: 1.2 });
      await this.wait(0.2);
      return;
    }

    // anticipation: the mouth opens, the swipe light blinks (card on every deposit)
    swipe.blink(10, 0.2);
    this.sfx('beep', { vol: 0.5 });
    await this.anim(0.12, (k) => { mouthLips.scale.y = lerp(1, 1.8, k); }, 'outQuad');

    // action: the coin stream arcs into the mouth (0.6 s, GDD §2.6.1)
    const n = clamp(Math.round(6 + Math.log10(ev.amount + 1) * 6), 6, 40);
    this.sfx('coinShower');
    fx.coins(anchor, n, { spread: 0.08, up: 0.25 });
    await this.anim(COIN_STREAM_S, (k) => { mouthLips.scale.y = lerp(1.8, 1.0, k); });

    // impact: the lips chew, the counter rolls, the receipt prints
    this.sfx('lever', { vol: 0.3, pitch: 2 });
    fx.popText(anchor, `+${fmtNum(ev.amount)}`, GOLD, { scale: 1.3 });
    const rolling = countUp(this.ctx, prev, ev.dep, rollSeconds(ev.dep - prev), (v) => {
      this.shownDep = Math.round(v);
      this.refresh(true);
    });
    const chew = this.anim(0.5, (k) => { mouthLips.scale.y = 1 + 0.25 * Math.sin(k * Math.PI * 4) * (1 - k); });
    await Promise.all([rolling, chew]);
    this.shownDep = ev.dep;

    const q = this.quota();
    this.drawReceipt(q.base, q.assessment, q.due, ev.dep);
    receiptPivot.scale.y = 0.01;
    this.sfx('printer');
    await this.anim(0.35, (k) => { receiptPivot.scale.y = lerp(0.01, 1, k); }, 'outBack');

    // follow-through: quota met for the first time this Night
    if (this.quota().met && !wasMet) {
      this.sfx('quotaMet');
      fx.flash(GOLD, 0.2, 0.35);
      fx.popText(this.model.anchors.prompt, this.t('quotaMet'), GOLD, { scale: 1.6, dur: 1.6 });
      this.parts.readyLamp.blink(4, 1.5);
    }
    this.refresh(true);
  }

  private async presentLever(ev: Extract<Ev, { k: 'lever' }>, _pc: PresentCtx): Promise<void> {
    const lever = ev.id === 'settle' ? this.parts.settleLever : this.parts.floorLever;
    if (ev.id === 'settle' && ev.ok && this.isLocalOccupant) this.seatHud?.result('win');
    this.sfx('lever');
    await lever.pull(0.55);
    if (!ev.ok) { this.sfx('error'); return; }
    this.sfx('stamp');
    this.ctx.fx.flash(GOLD, 0.25, 0.4);
    this.ctx.fx.popText(this.model.anchors.prompt, this.t('settled'), GOLD, { scale: 1.5 });
  }

  // ── screens and lamps ───────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const q = this.quota();
    const left = quotaLeft(q.due, this.shownDep);
    const key = [q.due, this.shownDep, q.base, q.assessment, this.entry, this.cursor, this.wallet(), q.met ? 1 : 0].join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    this.parts.leds.quota.set(String(fmtNum(q.due)).padStart(10, ' '));
    this.parts.leds.deposit.set(String(fmtNum(this.shownDep)).padStart(10, ' '));
    this.parts.readyLamp.setOn(q.met);
    this.drawCrt(q, left);
    if (this.isLocalOccupant) this.showHud();
  }

  private drawCrt(q: Readonly<QuotaState>, left: number): void {
    const s = this.parts.crt;
    const ratio = ratioOf(this.shownDep, q.due);
    const next = nextTier(this.tiers(), ratio);
    s.clear('#120a00');
    const c = (str: string, y: number, col = '#ffb000', align: 'left' | 'center' | 'right' = 'left', x = 10): void => {
      s.text(str, align === 'center' ? 128 : x, y, { font: 'vt', size: 17, color: col, align });
    };
    c(this.t('crt_title'), 18, '#ffd060', 'center');
    c(`${this.t('crt_base')}  ${fmtNum(q.base)}`, 44);
    c(`${this.t('crt_assess')}  ${fmtNum(q.assessment)}`, 62);
    c(`${this.t('crt_quota')}  ${fmtNum(q.due)}`, 84, '#ffd060');
    c(`${this.t('crt_dep')}  ${fmtNum(this.shownDep)}`, 110);
    c(`${this.t('crt_left')}  ${fmtNum(left)}`, 128);
    c(`${pct(ratio)} ${this.t('crt_ratio')}`, 146, '#ffb000', 'right', 246);
    if (next !== null) c(`${this.t('crt_next')} ${pct(next.ratio)}`, 164, '#a07020');
    if (q.met) c(this.t('crt_met'), 164, '#ffd040', 'center');
    c(`${this.t('crt_entry')} > ${this.entry === '' ? '_' : fmtNum(customAmount(this.entry))}`, 184, '#ffe0a0');
  }

  private drawReceipt(base: number, assess: number, due: number, dep: number): void {
    const r = this.parts.receipt;
    r.clear('#f4efe0');
    const line = (str: string, y: number): void => { r.text(str, 4, y, { font: 'px5', color: '#202020' }); };
    line(this.t('rc_title'), 10);
    line(`${this.t('rc_quota')} ${fmtCoins(due)}`, 28);
    line(`${this.t('rc_base')} ${fmtNum(base)}`, 40);
    line(`${this.t('rc_assess')} ${fmtNum(assess)}`, 52);
    line(`${this.t('rc_dep')} ${fmtNum(dep)}`, 64);
    line(this.t('rc_thanks'), 76);
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to an action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private g(a: BindingKey): string { return this.ctx.input.keyLabel(a); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.debt_terminal.tip1' },
      { k: 'm.debt_terminal.tip2', v: { move: this.g('left'), press: this.k('confirm'), digits: this.k('n1') } },
      { k: 'm.debt_terminal.tip3', v: { settle: this.k('double'), help: this.g('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return [1, 2, 3, 4].map((i) => ({ k: `m.debt_terminal.rule${i}` }));
  }

  /** Banner, key numbers and the valid controls only. Only while the local player stands here. */
  private showHud(): void {
    if (!this.seatHud || !this.isLocalOccupant) return;
    const sh = this.seatHud;
    const q = this.quota();
    const left = quotaLeft(q.due, q.deposited);
    const wallet = this.wallet();
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.debt_terminal.goal' });

    // STATE: is the quota paid yet
    if (q.due <= 0) sh.state({ k: 'm.debt_terminal.stNone' }, 'neutral');
    else if (q.met) sh.state({ k: 'm.debt_terminal.stMet' }, 'good', { k: 'm.debt_terminal.stMetSub' });
    else sh.state({ k: 'm.debt_terminal.stDeposit' }, 'gold', { k: 'm.debt_terminal.stDepositSub', v: { n: fmtCoins(left) } });

    // KEY NUMBERS
    sh.numbers([
      { label: { k: 'm.debt_terminal.nDue' }, value: fmtCoins(q.due), tone: 'gold' },
      { label: { k: 'm.debt_terminal.nDeposited' }, value: fmtCoins(q.deposited), tone: 'cyan' },
      { label: { k: 'm.debt_terminal.nLeft' }, value: fmtCoins(left), tone: left > 0 ? 'warn' : 'good' },
      { label: { k: 'm.debt_terminal.nAmount' }, value: this.entry === '' ? '-' : fmtCoins(customAmount(this.entry)), tone: 'gold' },
      { label: { k: 'm.debt_terminal.nWallet' }, value: fmtCoins(wallet), tone: 'neutral' },
    ]);

    // CONTROL BAR: the keypad, then SETTLE only once the quota is met
    ctrl.push({ key: `${this.g('left')}/${this.g('right')}`, label: { k: 'm.debt_terminal.cMove' }, action: 'left' });
    ctrl.push({ key: this.k('confirm'), label: { k: 'm.debt_terminal.cPress' }, action: 'confirm', primary: true });
    ctrl.push({ key: `${this.k('n1')}-${this.k('n9')}`, label: { k: 'm.debt_terminal.cAmount' }, action: 'n1' });
    if (this.entry !== '') ctrl.push({ key: this.k('clear'), label: { k: 'm.debt_terminal.cBack' }, action: 'clear' });
    if (q.met) ctrl.push({ key: this.k('double'), label: { k: 'm.debt_terminal.cSettle' }, action: 'double', primary: true });
    ctrl.push({ key: this.g('help'), label: { k: 'm.debt_terminal.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.debt_terminal.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

