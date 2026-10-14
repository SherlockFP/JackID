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
 * keymap has no digit 0) · R pulls SETTLE (only when the quota is met) · F pulls the floor lever: OPEN THE FLOOR once the
 * Night is paid, RING THE BELL between Watches (both are run calls; the lever refuses at any other time).
 *
 * Deposit rules: PRESS with digits typed commits the typed amount (not the highlighted cell). 10/25/50 %/REST never pass
 * what is still due; once the quota is met they refuse (no spam-depositing). ALL and a typed amount are the explicit
 * overpay ladder (a typed amount still works after the quota is met). After Dawn the screen reads NIGHT N PAID and no
 * stale quota numbers (see `night.ts`); deposits are refused until the floor opens.
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
import type { OvershootTier, QuotaState, RunApi } from '@/game/types';
import { nightPaid } from './night';
import { bandFromPx, frameConsole, type Vec3 } from './fit';

const EMPTY_QUOTA: QuotaState = { due: 0, base: 0, assessment: 0, deposited: 0, perPlayer: {}, met: false, overshoot: 0, ratio: 0, claimed: [] };
import { lerp, clamp } from '@/core/math';
import { buildModel, KEY_POS, type DebtParts } from './model';
import {
  KEYS, KEY_COLS, COIN_STREAM_S, amountFor, appendDigit, backspace, clampDeposit, customAmount, nextTier, pct,
  quotaLeft, ratioOf, rollSeconds, ALL_CONFIRM_SEC, type KeyId,
} from './rules';

type Ev =
  /** One keypad action. `ok:false` = refused (no funds / nothing to pay): a red flash, no money moved. */
  | { k: 'dep'; key: string; amount: number; ok: boolean; dep: number }
  | { k: 'lever'; id: 'settle' | 'floor'; ok: boolean; bell?: boolean };

/** `DebtRun` controls the terminal reaches through the run (absent on the bench stub). */
type FloorCtl = { openFloor?(): boolean; startWatch?(): boolean };

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
      rule3: "10/25/50% and REST never pass what is due. ALL, or a typed amount, overpays on purpose. Once the quota is met, SETTLE closes the terminal early.",
      rule4: "Keys: arrows move the keypad cursor, PRESS hits a key, 1-9 type an amount, BACK removes a digit.",
      crt_paid: 'NIGHT {n} PAID', crt_carry: 'CARRIED', crt_floor: 'PULL: OPEN THE FLOOR', crt_bell: 'PULL: RING THE BELL',
      floorOpen: 'FLOOR OPEN', belled: 'BELL', nightN: 'NIGHT {n}',
      nightPaidNote: 'NIGHT PAID: OPEN THE FLOOR', metNote: 'QUOTA MET: TYPE AN AMOUNT TO OVERPAY', typeAmount: 'TYPE AN AMOUNT FIRST',
      stNone: "NO QUOTA DUE",
      stPaid: "NIGHT PAID",
      stPaidSub: "Pull the lever to open the floor",
      stBell: "BETWEEN WATCHES",
      stBellSub: "Shop, then pull the lever to ring the Bell",
      cFloor: "OPEN FLOOR",
      cBell: "RING BELL",
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
      floorKept: "Float kept: {n} coins stay in your pocket",
      allConfirm: "ALL empties your pocket. Press ALL again to confirm",
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
      rule3: "%10/%25/%50 ve KALAN borcu aşmaz. HEPSİ ya da yazdığın tutar bilerek fazla öder. Kota tamamlanınca KAPAT terminali erken kapatır.",
      rule4: "Tuşlar: oklar tuş takımında gezer, BAS tuşa basar, 1-9 tutar yazar, GERİ bir rakam siler.",
      crt_paid: '{n}. GECE ÖDENDİ', crt_carry: 'DEVİR', crt_floor: 'ÇEK: KATI AÇ', crt_bell: 'ÇEK: ZİLİ ÇAL',
      floorOpen: 'KAT AÇIK', belled: 'ZİL', nightN: '{n}. GECE',
      nightPaidNote: 'GECE ÖDENDİ: KATI AÇ', metNote: 'KOTA TAMAM: FAZLASI İÇİN TUTAR YAZ', typeAmount: 'ÖNCE TUTAR YAZ',
      stNone: "ÖDENECEK KOTA YOK",
      stPaid: "GECE ÖDENDİ",
      stPaidSub: "Katı açmak için kolu çek",
      stBell: "MOLA",
      stBellSub: "Alışveriş yap, sonra zili çalmak için kolu çek",
      cFloor: "KATI AÇ",
      cBell: "ZİLİ ÇAL",
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
      floorKept: "Yedek akçe: {n} jeton cepte kalır",
      allConfirm: "HEPSİ cebini boşaltır. Onaylamak için HEPSİ'ye tekrar bas",
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
  private lastPaid = false;
  private lastNight = -1;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** Seconds an armed ALL stays armed (the second press confirms the float breach). */
  private allArm = 0;
  /** Phase last seen by `refresh`: a change clears the typed amount. */
  private lastPhase = '';
  /** Band the pose was last fitted to (the seat bar moves with its stack), so the framing follows it. */
  private bandSig = '';
  private readonly onResize = (): void => this.fitPose();

  protected createModel(kit: KitX): MachineModel<DebtParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.fitPose();
    window.addEventListener('resize', this.onResize);
    this.shownDep = this.quota().deposited;
    this.refresh(true);
    this.drawReceipt(this.quota().base, this.quota().assessment, this.quota().due, this.shownDep);
    this.attractor.every('eye', 8, () => this.ctx.fx.glow(this.parts.emblemLid, GOLD, 0.35, 0.7), { first: 4 });
  }

  /**
   * Seat framing: the console (LEDs, CRT, keypad) sits inside the band between the seat stack's top edge and the control bar
   * (`--seat-bot-t`), at any window shape. The solver (`fit.ts`) picks the look pitch and the fov; the camera stays on the seat.
   */
  private fitPose(): void {
    const base: Vec3 = [0, 1.6, 1.1];
    const crt: Vec3[] = [[-0.23, 1.38, 0.05], [0.23, 1.38, 0.05], [-0.23, 1.74, 0.05], [0.23, 1.74, 0.05]];
    const keypad: Vec3[] = [[-0.37, 1.12, 0.0], [0.37, 1.12, 0.0], [-0.37, 1.12, 0.36], [0.37, 1.12, 0.36]];
    const leds: Vec3[] = [[-0.24, 1.94, -0.02], [0.24, 1.94, -0.02], [-0.24, 1.18, -0.02], [0.24, 1.18, -0.02]];
    const H = Math.max(1, window.innerHeight);
    const aspect = Math.max(0.4, window.innerWidth / H);
    const { topPx, botPx } = this.bandPx();
    // the keypad and the CRT must fit the band; the LEDs too when the camera can take them in (`frameConsole`)
    const f = frameConsole(base, [...crt, ...leds, ...keypad], [...crt, ...keypad], bandFromPx(topPx, botPx, H), aspect);
    const DEG = Math.PI / 180;
    const pose = this.model.playPose;
    pose.pos.set(f.cam[0], f.cam[1], f.cam[2]);
    pose.look.set(f.cam[0], f.cam[1] + Math.sin(f.look), f.cam[2] - Math.cos(f.look));
    pose.fov = (2 * f.vHalf) / DEG;
    this.bandSig = this.sigOf(topPx, botPx, H);
  }

  private sigOf(topPx: number, botPx: number, H: number): string { return `${topPx}|${botPx}|${H}|${window.innerWidth}`; }

  /** The seat stack edges in px from the top of `#ui` (NaN when the HUD is down). */
  private bandPx(): { topPx: number; botPx: number } {
    const ui = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    const cs = ui ? getComputedStyle(ui) : null;
    return {
      topPx: parseFloat(cs?.getPropertyValue('--seat-top-b') ?? ''),
      botPx: parseFloat(cs?.getPropertyValue('--seat-bot-t') ?? ''),
    };
  }

  /** Refit when the seat bar moved (its stack changes size with the controls and the tip). Two property reads per frame. */
  private fitIfBandMoved(): void {
    if (!this.isLocalOccupant) return;
    const { topPx, botPx } = this.bandPx();
    if (this.sigOf(topPx, botPx, Math.max(1, window.innerHeight)) !== this.bandSig) this.fitPose();
  }

  // ── run state (read on every peer) ──────────────────────────────────────────────────────────────
  /** The bench stubs `shift.quota()` (undefined): fall back to an empty quota so the terminal still renders. */
  private quota(): Readonly<QuotaState> { return this.ctx.run.shift.quota() ?? EMPTY_QUOTA; }
  private tiers(): readonly OvershootTier[] { return this.ctx.run.shift.overshootTiers() ?? []; }
  private wallet(): number { return this.ctx.run.wallet(this.selfId); }

  tick(dt: number): void {
    if (this.allArm > 0) this.allArm = Math.max(0, this.allArm - dt);
    this.fitIfBandMoved();
    this.refresh(false);
  }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    this.clearEntry();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.showHud();
      this.fitPose();                // the seat stack's edges exist now: frame the console between them
      this.seatHud?.firstTip('debt_terminal', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    this.clearEntry();
    if (local) this.seatHud?.hide();
  }

  /** The typed amount and the armed ALL are per visit and per press: nothing typed earlier may commit later (the stale 44). */
  private clearEntry(): void {
    this.entry = '';
    this.allArm = 0;
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
      // digits typed: PRESS commits the typed amount, never the highlighted preset cell
      case 'primary': case 'confirm': if (!e.repeat) this.pressKey(this.entry !== '' ? 'enter' : KEYS[this.cursor]); return;
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
    const left = quotaLeft(q.due, q.deposited);
    if (nightPaid(this.ctx.run)) { this.refuse('nightPaidNote'); return; }     // Dawn paid it: the next Night has no quota yet
    const run = this.ctx.run;
    // The first deposit of a Watch keeps a float in the pocket (`float.ts`); ALL goes below it only once confirmed.
    const floor = run.depositFloor?.() ?? 0;
    const room = Math.max(0, wallet - floor);
    let amount: number;
    let confirmAll = false;
    if (key === 'enter') {
      if (this.entry === '') { this.refuse('typeAmount'); return; }
      amount = clampDeposit(customAmount(this.entry), wallet);                 // a typed amount is explicit: it may overpay
      this.clearEntry();
    } else {
      if (left <= 0) { this.refuse('metNote'); return; }                       // quota met: a held PRESS must not keep depositing
      this.clearEntry();
      if (key === 'all') {
        if (floor > 0 && this.allArm <= 0) {                                   // the first press arms it, the second confirms
          this.allArm = ALL_CONFIRM_SEC;
          this.sfx('error');
          this.ctx.ui.toast(this.t('allConfirm'), 'warn');
          this.refresh(true);
          return;
        }
        confirmAll = floor > 0;
        amount = wallet;
      } else {
        amount = clampDeposit(Math.min(amountFor(key, wallet, left), left), wallet);
      }
    }
    if (!confirmAll && amount > room) {                                        // the float stays in the pocket
      amount = room;
      if (amount <= 0) { this.refuse('floorKept'); return; }
      this.ctx.ui.toast(this.t('floorKept', { n: fmtNum(floor) }), 'sys');
    }
    const ok = amount > 0 && this.ctx.run.canAfford(amount, this.selfId);
    const dep = q.deposited + (ok ? amount : 0);
    void this.emit(
      { k: 'dep', key, amount, ok, dep },
      ok ? () => { if (!run.deposit(amount, confirmAll)) this.ctx.ui.toast(this.t('denied'), 'bad'); } : undefined,
    );
    this.refresh(true);
  }
  private pullLever(id: 'settle' | 'floor'): void {
    this.clearEntry();
    if (id === 'settle') {
      const q = this.quota();
      const ok = q.met && this.ctx.run.shift.settleEarly();
      void this.emit({ k: 'lever', id, ok });
      if (!ok) this.ctx.ui.toast(this.t('notYet'), 'warn');
      return;
    }
    // The floor lever: OPEN THE FLOOR when the Night is paid, else RING THE BELL for the next Watch. Each call refuses
    // without side effects when the phase does not match, so trying both in order is safe.
    const run = this.ctx.run as RunApi & FloorCtl;
    let how: 'floor' | 'bell' | null = null;
    if (run.shift.phase === 'intermission') {
      if (run.openFloor?.()) how = 'floor';
      else if (run.startWatch?.()) how = 'bell';
    }
    void this.emit({ k: 'lever', id, ok: how !== null, bell: how === 'bell' });
    if (how === null) { this.ctx.ui.toast(this.t('floorNo'), 'warn'); return; }
    if (how === 'floor') {
      const ui = this.ctx.ui as { banner?(text: string): Promise<void> };
      void ui.banner?.(this.t('nightN', { n: run.night() }));
    }
  }

  /** A refused press: one sound and one line, no coins moved, nothing emitted. */
  private refuse(key: string): void {
    this.sfx('error');
    this.ctx.ui.toast(this.t(key), 'warn');
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
    const doneText = ev.id === 'settle' ? this.t('settled') : ev.bell ? this.t('belled') : this.t('floorOpen');
    this.sfx('lever');
    await lever.pull(0.55);
    if (!ev.ok) { this.sfx('error'); return; }
    this.sfx('stamp');
    this.ctx.fx.flash(GOLD, 0.25, 0.4);
    this.ctx.fx.popText(this.model.anchors.prompt, doneText, GOLD, { scale: 1.5 });
  }

  // ── screens and lamps ───────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const q = this.quota();
    const paid = nightPaid(this.ctx.run);
    const phase = this.ctx.run.shift.phase;
    const night = this.ctx.run.night();
    // a new phase (Watch, Dawn, Night) starts with an empty amount: a typed one never carries over (the stale entry)
    if (phase !== this.lastPhase) { this.lastPhase = phase; this.clearEntry(); }
    // a new Night or the paid screen must not keep a stale count-up value
    if (paid !== this.lastPaid || night !== this.lastNight) { this.lastPaid = paid; this.lastNight = night; this.shownDep = q.deposited; }
    const left = quotaLeft(q.due, this.shownDep);
    const key = [q.due, this.shownDep, q.base, q.assessment, this.entry, this.cursor, this.wallet(), q.met ? 1 : 0, paid ? 1 : 0, phase, night].join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.lightKeys();

    this.parts.leds.quota.set(String(fmtNum(paid ? 0 : q.due)).padStart(10, ' '));
    this.parts.leds.deposit.set(String(fmtNum(this.shownDep)).padStart(10, ' '));
    this.parts.readyLamp.setOn(q.met || paid);
    this.drawCrt(q, left, paid, phase === 'intermission');
    if (this.isLocalOccupant) this.showHud();
  }

  /**
   * The CRT is a 512 × 384 texture (2× the old layout, every size here is doubled): a label at the left and a big value
   * at the right on each row (DUE / DEPOSITED / LEFT), a boxed AMOUNT field with the typed digits, one status line.
   */
  private drawCrt(q: Readonly<QuotaState>, left: number, paid: boolean, inter: boolean): void {
    const s = this.parts.crt;
    const ratio = ratioOf(this.shownDep, q.due);
    const next = nextTier(this.tiers(), ratio);
    s.clear('#060300');
    const amber = '#ffc02a', hot = '#fff0a0';
    const row = (label: string, value: string, y: number, col = hot): void => {
      s.text(label, 14, y + 6, { font: 'vt', size: 34, color: amber, align: 'left' });
      s.text(value, 498, y + 6, { font: 'ps2p', size: 40, color: col, align: 'right' });   // a wide face: VT323 digits go thin at distance
    };
    s.text(this.t('crt_title'), 256, 4, { font: 'vt', size: 34, color: hot, align: 'center' });
    if (paid) {                                   // Dawn paid the Night: no stale quota, just the carry-over and the lever
      s.text(this.t('crt_paid', { n: this.ctx.run.night() }), 256, 90, { font: 'vt', size: 60, color: '#fff070', align: 'center' });
      if (q.deposited > 0) row(this.t('crt_carry'), fmtNum(q.deposited), 180, '#fff4b8');
      s.text(this.t('crt_floor'), 256, 320, { font: 'vt', size: 40, color: '#fff0c0', align: 'center' });
      return;
    }
    row(this.t('nDue'), fmtNum(q.due), 46);
    row(this.t('nDeposited'), fmtNum(this.shownDep), 126, '#fff4b8');
    row(this.t('nLeft'), fmtNum(left), 206, left > 0 ? '#ff9a70' : '#b4ffb4');
    // the typed amount: a boxed input field, the digits as they are typed
    s.draw((g) => { g.fillStyle = '#1e1400'; g.fillRect(6, 284, 500, 56); g.strokeStyle = amber; g.lineWidth = 2; g.strokeRect(7, 285, 498, 54); });
    s.text(this.t('nAmount'), 16, 296, { font: 'vt', size: 34, color: amber, align: 'left' });
    const typed = this.entry === '' ? '_' : `${fmtNum(customAmount(this.entry))}_`;
    s.text(typed, 498, 294, { font: 'ps2p', size: 30, color: '#fff0c0', align: 'right' });
    // status line: the share of the quota paid, then the next tier, or the bell / quota-met prompt
    s.text(`${pct(ratio)} ${this.t('crt_ratio')}`, 14, 352, { font: 'vt', size: 30, color: amber, align: 'left' });
    if (inter) s.text(this.t('crt_bell'), 498, 352, { font: 'vt', size: 30, color: hot, align: 'right' });
    else if (q.met) s.text(this.t('crt_met'), 498, 352, { font: 'vt', size: 30, color: hot, align: 'right' });
    else if (next !== null) s.text(`${this.t('crt_next')} ${pct(next.ratio)}`, 498, 352, { font: 'vt', size: 30, color: '#e0a040', align: 'right' });
  }

  /** The keypad cursor is the one lit cap plus a gold frame on its cell, so the selection reads from the seat. */
  private lightKeys(): void {
    const cur = KEYS[this.cursor];
    for (const id of KEYS) this.parts.keys.buttons[id]?.setLit(id === cur);
    this.parts.keyCursor.position.set(KEY_POS[cur].x, 0, KEY_POS[cur].z);
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

    const paid = nightPaid(this.ctx.run);
    const inter = this.ctx.run.shift.phase === 'intermission';

    // STATE: is the quota paid yet
    if (paid) sh.state({ k: 'm.debt_terminal.stPaid' }, 'good', { k: 'm.debt_terminal.stPaidSub' });
    else if (inter) sh.state({ k: 'm.debt_terminal.stBell' }, 'gold', { k: 'm.debt_terminal.stBellSub' });
    else if (q.due <= 0) sh.state({ k: 'm.debt_terminal.stNone' }, 'neutral');
    else if (q.met) sh.state({ k: 'm.debt_terminal.stMet' }, 'good', { k: 'm.debt_terminal.stMetSub' });
    else sh.state({ k: 'm.debt_terminal.stDeposit' }, 'gold', { k: 'm.debt_terminal.stDepositSub', v: { n: fmtCoins(left) } });

    // KEY NUMBERS
    sh.numbers(paid
      ? [   // no stale DUE / LEFT after Dawn: the carry-over and the wallet only
        { label: { k: 'm.debt_terminal.nDeposited' }, value: fmtCoins(q.deposited), tone: 'cyan' },
        { label: { k: 'm.debt_terminal.nWallet' }, value: fmtCoins(wallet), tone: 'neutral' },
      ]
      : [
        { label: { k: 'm.debt_terminal.nDue' }, value: fmtCoins(q.due), tone: 'gold' },
        { label: { k: 'm.debt_terminal.nDeposited' }, value: fmtCoins(q.deposited), tone: 'cyan' },
        { label: { k: 'm.debt_terminal.nLeft' }, value: fmtCoins(left), tone: left > 0 ? 'warn' : 'good' },
        { label: { k: 'm.debt_terminal.nAmount' }, value: this.entry === '' ? '-' : fmtCoins(customAmount(this.entry)), tone: 'gold' },
        { label: { k: 'm.debt_terminal.nWallet' }, value: fmtCoins(wallet), tone: 'neutral' },
      ]);

    // CONTROL BAR: the keypad, then SETTLE only once the quota is met
    if (inter) ctrl.push({ key: this.k('fast'), label: { k: paid ? 'm.debt_terminal.cFloor' : 'm.debt_terminal.cBell' }, action: 'fast', primary: true });
    if (!paid) {
      ctrl.push({ key: `${this.g('left')}/${this.g('right')}`, label: { k: 'm.debt_terminal.cMove' }, action: 'left' });
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.debt_terminal.cPress' }, action: 'confirm', primary: !inter });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n9')}`, label: { k: 'm.debt_terminal.cAmount' }, action: 'n1' });
      if (this.entry !== '') ctrl.push({ key: this.k('clear'), label: { k: 'm.debt_terminal.cBack' }, action: 'clear' });
    }
    if (q.met && !inter) ctrl.push({ key: this.k('double'), label: { k: 'm.debt_terminal.cSettle' }, action: 'double', primary: true });
    ctrl.push({ key: this.g('help'), label: { k: 'm.debt_terminal.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.debt_terminal.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

