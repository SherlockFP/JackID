/**
 * Debt Terminal (`debt_terminal`, system) — THE BANK (GDD §2.6, wave 27 bank-econ). devices-core lane.
 *
 * Three big actions on the top row of the keypad:
 *   DEPOSIT   coins go in. They count toward tonight's quota AND earn interest at every Bell (Settle). Overpay comes back at once.
 *   WITHDRAW  coins come back to the pocket any time before the Watch is settled. They stop counting and stop earning, and the
 *             screen says exactly what that costs (interest, quota, overpay reward) before the key is pressed.
 *   QUOTA     tonight's quota status: due, base + assessment, how much the bank holds, the next interest, the next reward.
 *             Press it again once the quota is met to SETTLE early.
 * The six keys under them are the amounts: 10 / 25 / 50 % / ALL of what the chosen action can move, REST (deposit: what the quota
 * still needs; withdraw: PLAY, enough to play on) and ENTER (the typed amount).
 *
 * Talks to the game ONLY through `ctx.run`: `run.shift.quota()`, `run.shift.overshootTiers()`, `run.wallet()`, `run.canAfford()`,
 * `run.deposit()`, `run.shift.settleEarly()` and, on the real run, `run.bank()`, `run.withdrawPreview()`, `run.withdraw()` (absent on
 * the bench stub: the terminal then shows the deposit side only). Nothing here decides money; one `dep` / `wd` event per press, and
 * `present()` plays it on every peer.
 *
 * Controls (seated, play pose is `mouse: 'pick'`): arrows move the keypad cursor · Space/Enter press the cell · LMB presses a cell ·
 * C (alt) cycles DEPOSIT > WITHDRAW > QUOTA · B (bet max) = ALL · 1–9 type a custom amount · Backspace removes a digit · BET UP (X) types
 * a 0 · R pulls SETTLE (only when the quota is met) · F pulls the floor lever: OPEN THE FLOOR once the Night is paid, RING THE BELL
 * between Watches · Q ends the Watch early (END WATCH while playing; the first press asks, the second within 6 s ends it, the unused
 * pulls keep the settle rebate; decision 1: a Watch is never stuck).
 *
 * Deposit rules: PRESS with digits typed commits the typed amount (not the highlighted cell). 10/25/50 %/REST never pass what is
 * still due; once the quota is met they refuse (no spam-depositing). ALL and a typed amount are the explicit overpay ladder. After
 * Dawn the screen reads NIGHT N PAID and no stale quota numbers (see `night.ts`); deposits are refused until the floor opens.
 *
 * Presentation pattern: state is read from run on every peer (`tick` keeps the LEDs/CRT in step); `present()` only
 * animates. Credit first, present after: the deposit / withdraw is applied inside `emit`'s credit step.
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
import type { BankView } from '@/game/run';
import type { WithdrawPreview } from '@/game/bank';
import { nightPaid } from './night';
import { bandFromPx, CONTROL_MARGIN, frameConsole, type Vec3 } from './fit';

const EMPTY_QUOTA: QuotaState = { due: 0, base: 0, assessment: 0, deposited: 0, perPlayer: {}, met: false, overshoot: 0, ratio: 0, claimed: [] };
import { lerp, clamp } from '@/core/math';
import { buildModel, KEY_POS, type DebtParts } from './model';
import {
  KEYS, KEY_COLS, KEY_ROWS, COIN_STREAM_S, amountFor, appendDigit, backspace, clampDeposit, customAmount, cycleMode, modeOfKey, nextTier,
  pct, playNeed, quotaLeft, ratioOf, rollSeconds, ALL_CONFIRM_SEC, withdrawAmountFor, type KeyId, type Mode,
} from './rules';

type Ev =
  /** One keypad deposit. `ok:false` = refused (no funds / nothing to pay): a red flash, no money moved. */
  | { k: 'dep'; key: string; amount: number; ok: boolean; dep: number }
  /** One withdraw: `amount` coins from the bank to the pocket; `lost` is the interest per Bell it costs. */
  | { k: 'wd'; key: string; amount: number; ok: boolean; lost: number }
  | { k: 'lever'; id: 'settle' | 'floor'; ok: boolean; bell?: boolean };

/** `DebtRun` controls the terminal reaches through the run (absent on the bench stub). */
type FloorCtl = { openFloor?(): boolean; startWatch?(): boolean };
type BellCtl = { ringBell?(): boolean };
type BankCtl = { bank?(): BankView; withdraw?(n: number): number; withdrawPreview?(n: number): WithdrawPreview };

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
      name: 'Bank Terminal',
      desc: 'The House bank. DEPOSIT coins for the quota (they earn interest), WITHDRAW them back any time, check the QUOTA.',
      k_dep: 'DEPOSIT', k_wd: 'WITHDRAW', k_quota: 'QUOTA',
      k_p10: '10%', k_p25: '25%', k_p50: '50%', k_all: 'ALL', k_rest: 'REST', k_play: 'PLAY', k_enter: 'ENTER',
      crt_title: 'HOUSE BANK', crt_base: 'BASE', crt_assess: 'ASSESSMENT', crt_quota: 'QUOTA',
      crt_dep: 'DEPOSITED', crt_left: 'LEFT', crt_ratio: 'OF QUOTA', crt_next: 'NEXT AT', crt_entry: 'AMOUNT',
      crt_wallet: 'POCKET', crt_hint: '1-9 AMOUNT  ENTER OK', crt_met: 'QUOTA MET: SETTLE',
      rc_title: 'RECEIPT', rc_dep: 'DEPOSIT', rc_wd: 'WITHDRAW', rc_bank: 'BANK', rc_quota: 'QUOTA', rc_left: 'LEFT', rc_thanks: 'THANK YOU',
      rc_base: 'BASE', rc_assess: 'ASSESS',
      quotaMet: 'QUOTA MET', denied: 'DENIED', settled: 'SETTLED', notYet: 'NOT YET', floorNo: 'FLOOR LOCKED',
      h_move: 'MOVE', h_press: 'PRESS', h_digits: 'AMOUNT', h_clear: 'BACK', h_settle: 'SETTLE', h_leave: 'LEAVE',
      s_entry: 'AMOUNT',
      goal: "DEPOSIT coins for the quota, WITHDRAW them if you need to play. Bank coins earn interest at every Bell.",
      rule1: "BANK: coins you DEPOSIT count toward tonight's quota and earn interest every Bell. Pay the quota and the extra comes back to your pocket.",
      rule2: "WITHDRAW takes coins back to your pocket any time before the Bell. Taken coins stop counting and stop earning. The screen shows what you lose first.",
      rule3: "Keypad: pick DEPOSIT or WITHDRAW on the top row, then 10%, 25%, 50%, ALL, REST, or type an amount and press ENTER. QUOTA shows the status and settles it once it is met.",
      rule4: "Keys: arrows move the cursor, PRESS hits a key, C switches DEPOSIT / WITHDRAW / QUOTA, 1-9 type an amount, BACK removes a digit.",
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
      stWithdraw: "WITHDRAW TO PLAY",
      stWithdrawSub: "{n} can come back to your pocket",
      stWdNone: "NOTHING TO WITHDRAW",
      stWdNoneSub: "The bank is empty or the window is shut",
      stQuota: "QUOTA STATUS",
      stQuotaSub: "{n} still due",
      nDue: "DUE",
      nDeposited: "DEPOSITED",
      nBank: "BANK",
      nLeft: "LEFT",
      nAmount: "AMOUNT",
      nWallet: "POCKET",
      nCanTake: "CAN TAKE",
      nInterest: "BELL INTEREST",
      cMove: "MOVE",
      cPress: "PRESS",
      cAmount: "AMOUNT",
      cBack: "BACK",
      cSettle: "SETTLE",
      cEnd: "END WATCH",
      bellConfirm: "End Watch with {n} pulls unused? Press {k} again to confirm",
      bellDone: "Watch ended. The bank keeps growing.",
      cMode: "DEPOSIT / WITHDRAW / QUOTA",
      cRules: "RULES",
      cLeave: "LEAVE",
      tip1: "THE BANK. Top row: DEPOSIT (coins in, earn interest), WITHDRAW (coins back to your pocket), QUOTA (status).",
      tip2: "[{move}] MOVE  ·  [{press}] PRESS  ·  [{digits}] TYPE AN AMOUNT  ·  [{mode}] SWITCH",
      tip3: "Out of coins? WITHDRAW some. Quota met? [{settle}] SETTLE  ·  [{help}] RULES",
      floorKept: "Float kept: {n} coins stay in your pocket",
      c_float: 'keeps {n} in pocket (float)',
      allConfirm: "ALL empties your pocket. Press ALL again to confirm",
      c_bank: 'BANK', c_pocket: 'POCKET', c_left: 'LEFT TO PAY', c_metBig: 'QUOTA MET', c_interest: 'BELL INTEREST',
      c_rate: '{r}% A WATCH, MAX +{c}', c_pulls: 'PLAY {n} MORE PULLS FOR IT', c_with: 'WITH THIS: +{n}',
      c_take: 'TAKE OUT', c_lose: 'YOU LOSE', c_loseInt: '-{n} INTEREST EVERY BELL', c_loseNone: 'NO INTEREST LOST',
      c_loseQ: 'QUOTA LEFT {a} > {b}', c_loseMet: 'QUOTA NOT MET ANY MORE', c_loseTier: 'OVERPAY REWARD LOST',
      c_wdPick: 'PICK AN AMOUNT', c_wdClosed: 'WITHDRAW IS CLOSED NOW', c_wdEmpty: 'NOTHING IN THE BANK TO TAKE',
      q_due: 'QUOTA DUE', q_base: 'BASE {b} + ASSESS {a}', q_loan: '+ LOAN {l}', q_bank: 'BANK {b}  =  {p} OF QUOTA',
      q_next: 'NEXT BELL INTEREST +{n}', q_reward: 'NEXT REWARD AT {p}', q_settle: 'PRESS QUOTA AGAIN: SETTLE',
      wdDone: 'Took {n} coins out. You lose {i} interest per Bell.', wdDoneFree: 'Took {n} coins out.',
      wdClosed: 'WITHDRAW IS CLOSED NOW', wdNone: 'NOTHING TO WITHDRAW', pickFirst: 'PICK DEPOSIT OR WITHDRAW',
    },
    tr: {
      name: 'Banka Terminali',
      desc: 'Evin bankası. Kota için jeton YATIR (faiz kazanır), istediğin an GERİ ÇEK, KOTAYI gör.',
      k_dep: 'YATIR', k_wd: 'ÇEK', k_quota: 'KOTA',
      k_p10: '%10', k_p25: '%25', k_p50: '%50', k_all: 'HEPSİ', k_rest: 'KALAN', k_play: 'OYUN', k_enter: 'ONAY',
      crt_title: 'EV BANKASI', crt_base: 'TABAN', crt_assess: 'DEĞERLEME', crt_quota: 'KOTA',
      crt_dep: 'YATIRILAN', crt_left: 'KALAN', crt_ratio: 'KOTANIN', crt_next: 'SONRAKİ', crt_entry: 'TUTAR',
      crt_wallet: 'CEP', crt_hint: '1-9 TUTAR  ENTER ONAY', crt_met: 'KOTA TAMAM: KAPAT',
      rc_title: 'FİŞ', rc_dep: 'YATIRMA', rc_wd: 'ÇEKME', rc_bank: 'BANKA', rc_quota: 'KOTA', rc_left: 'KALAN', rc_thanks: 'TEŞEKKÜRLER',
      rc_base: 'TABAN', rc_assess: 'DEĞER',
      quotaMet: 'KOTA TAMAM', denied: 'REDDEDİLDİ', settled: 'KAPANDI', notYet: 'HENÜZ DEĞİL', floorNo: 'KAT KİLİTLİ',
      h_move: 'GEZ', h_press: 'BAS', h_digits: 'TUTAR', h_clear: 'GERİ', h_settle: 'KAPAT', h_leave: 'AYRIL',
      s_entry: 'TUTAR',
      goal: "Kota için jeton YATIR, oynamak için gerekirse GERİ ÇEK. Bankadaki jeton her Zil'de faiz kazanır.",
      rule1: "BANKA: yatırdığın jeton bu gecenin kotasına sayılır ve her Zil'de faiz kazanır. Kotayı ödersen fazlası cebine döner.",
      rule2: "ÇEK, Zil'den önce istediğin an jetonu cebine geri alır. Çekilen jeton kotaya sayılmaz ve faiz kazanmaz. Ekran, ne kaybettiğini önceden gösterir.",
      rule3: "Tuş takımı: üst sırada YATIR ya da ÇEK'i seç, sonra %10, %25, %50, HEPSİ, KALAN'a bas ya da bir tutar yazıp ONAY'a bas. KOTA durumu gösterir, tamamlanınca kapatır.",
      rule4: "Tuşlar: oklar imleci gezdirir, BAS tuşa basar, C YATIR / ÇEK / KOTA arasında geçer, 1-9 tutar yazar, GERİ bir rakam siler.",
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
      stWithdraw: "OYNAMAK İÇİN ÇEK",
      stWithdrawSub: "{n} cebine geri dönebilir",
      stWdNone: "ÇEKİLECEK BİR ŞEY YOK",
      stWdNoneSub: "Banka boş ya da pencere kapalı",
      stQuota: "KOTA DURUMU",
      stQuotaSub: "{n} hâlâ borç",
      nDue: "BORÇ",
      nDeposited: "YATIRILAN",
      nBank: "BANKA",
      nLeft: "KALAN",
      nAmount: "TUTAR",
      nWallet: "CEP",
      nCanTake: "ÇEKİLEBİLİR",
      nInterest: "ZİL FAİZİ",
      cMove: "GEZ",
      cPress: "BAS",
      cAmount: "TUTAR",
      cBack: "GERİ",
      cSettle: "KAPAT",
      cEnd: "NÖBETİ BİTİR",
      bellConfirm: "{n} pul kullanılmadan nöbet bitsin mi? Onaylamak için {k} tuşuna tekrar bas",
      bellDone: "Nöbet bitti. Banka büyümeye devam eder.",
      cMode: "YATIR / ÇEK / KOTA",
      cRules: "KURALLAR",
      cLeave: "AYRIL",
      tip1: "BANKA. Üst sıra: YATIR (jeton girer, faiz kazanır), ÇEK (jeton cebine döner), KOTA (durum).",
      tip2: "[{move}] GEZ  ·  [{press}] BAS  ·  [{digits}] TUTAR YAZ  ·  [{mode}] DEĞİŞTİR",
      tip3: "Jetonun mu bitti? Biraz ÇEK. Kota tamam mı? [{settle}] KAPAT  ·  [{help}] KURALLAR",
      floorKept: "Yedek akçe: {n} jeton cepte kalır",
      c_float: 'cepte {n} kalır (yedek akçe)',
      allConfirm: "HEPSİ cebini boşaltır. Onaylamak için HEPSİ'ye tekrar bas",
      c_bank: 'BANKA', c_pocket: 'CEP', c_left: 'ÖDENECEK', c_metBig: 'KOTA TAMAM', c_interest: 'ZİL FAİZİ',
      c_rate: 'VARDİYA BAŞI %{r}, EN FAZLA +{c}', c_pulls: 'İÇİN {n} ÇEKİŞ DAHA OYNA', c_with: 'BUNUNLA: +{n}',
      c_take: 'ÇEKİLEN', c_lose: 'KAYBEDERSİN', c_loseInt: 'HER ZİLDE -{n} FAİZ', c_loseNone: 'FAİZ KAYBI YOK',
      c_loseQ: 'KALAN KOTA {a} > {b}', c_loseMet: 'KOTA ARTIK TAMAM DEĞİL', c_loseTier: 'FAZLA ÖDEME ÖDÜLÜ GİDER',
      c_wdPick: 'BİR TUTAR SEÇ', c_wdClosed: 'ÇEKME ŞİMDİ KAPALI', c_wdEmpty: 'BANKADA ÇEKİLECEK YOK',
      q_due: 'ÖDENECEK KOTA', q_base: 'TABAN {b} + DEĞER {a}', q_loan: '+ BORÇ {l}', q_bank: 'BANKA {b}  =  KOTANIN {p}',
      q_next: 'SONRAKİ ZİL FAİZİ +{n}', q_reward: 'SONRAKİ ÖDÜL: {p}', q_settle: 'KOTAYA TEKRAR BAS: KAPAT',
      wdDone: '{n} jeton çektin. Her Zil’de {i} faiz kaybedersin.', wdDoneFree: '{n} jeton çektin.',
      wdClosed: 'ÇEKME ŞİMDİ KAPALI', wdNone: 'ÇEKİLECEK BİR ŞEY YOK', pickFirst: 'ÖNCE YATIR YA DA ÇEK SEÇ',
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class DebtTerminal extends MachineBase<DebtParts, Ev, null> {
  /** Keypad cursor (0..8, row-major over KEYS). Local UI only. */
  private cursor = 0;
  /** The chosen action: what the amount keys do. Local UI only. */
  private mode: Mode = 'dep';
  /** Typed custom amount (digits). Local UI only. */
  private entry = '';
  /** Bank balance shown on the counter (count-up target is the run's value). */
  private shownDep = 0;
  private lastKey = '';
  private lastPaid = false;
  private lastNight = -1;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** Seconds an armed ALL stays armed (the second press confirms the float breach). */
  private allArm = 0;
  /** Seconds an armed END WATCH stays armed (the second press ends the Watch). */
  private bellArm = 0;
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
    this.shownDep = this.bk().balance;
    this.refresh(true);
    this.drawReceipt('dep', 0, this.shownDep, this.quota().due);
    this.attractor.every('eye', 8, () => this.ctx.fx.glow(this.parts.emblemLid, GOLD, 0.35, 0.7), { first: 4 });
  }

  /**
   * Seat framing: the console (LEDs, CRT, keypad) sits inside the band between the seat stack's top edge and the control bar
   * (`--seat-bot-t`), at any window shape. The solver (`fit.ts`) picks the look pitch and the fov; the camera stays on the seat.
   */
  private fitPose(): void {
    const base: Vec3 = [0, 1.6, 1.1];
    const crt: Vec3[] = [[-0.23, 1.38, 0.05], [0.23, 1.38, 0.05], [-0.23, 1.74, 0.05], [0.23, 1.74, 0.05]];
    const keypad: Vec3[] = [[-0.37, 1.13, -0.02], [0.37, 1.13, -0.02], [-0.37, 1.04, 0.4], [0.37, 1.04, 0.4]];
    const leds: Vec3[] = [[-0.24, 1.94, -0.02], [0.24, 1.94, -0.02], [-0.24, 1.18, -0.02], [0.24, 1.18, -0.02]];
    const H = Math.max(1, window.innerHeight);
    const aspect = Math.max(0.4, window.innerWidth / H);
    const { topPx, botPx } = this.bandPx();
    // the keypad and the CRT must fit the band; the LEDs too when the camera can take them in (`frameConsole`)
    const f = frameConsole(base, [...crt, ...leds, ...keypad], [...crt, ...keypad], bandFromPx(topPx, botPx, H), aspect, CONTROL_MARGIN);
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
  private bankRun(): RunApi & BankCtl { return this.ctx.run as RunApi & BankCtl; }

  /** The bank in numbers. The bench stub has none: the deposit side is rebuilt from the quota. */
  private bk(): BankView {
    const run = this.bankRun();
    const b = run.bank?.();
    if (b) return b;
    const q = this.quota();
    return {
      balance: q.deposited, withdrawable: 0, pocket: this.wallet(), due: q.due, left: quotaLeft(q.due, q.deposited), ratePct: 0,
      interestNext: 0, interestAt: () => 0, pullsToQualify: 0, interestCap: 0, open: false, pullsLeft: 0, minBet: 1,
    };
  }

  /** What a withdraw of `amount` would do (the run's numbers; a closed stub reports nothing to take). */
  private wdPreview(amount: number): WithdrawPreview {
    const run = this.bankRun();
    const p = run.withdrawPreview?.(amount);
    if (p) return p;
    return { coins: 0, bankAfter: this.bk().balance, leftAfter: this.bk().left, metLost: false, interestLost: 0, tierLost: null };
  }

  tick(dt: number): void {
    if (this.allArm > 0) this.allArm = Math.max(0, this.allArm - dt);
    if (this.bellArm > 0) this.bellArm = Math.max(0, this.bellArm - dt);
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
    this.cursor = KEYS.indexOf('p25');
    this.mode = 'dep';
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
    this.bellArm = 0;
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
      case 'up': this.moveCursor(((row + KEY_ROWS - 1) % KEY_ROWS) * KEY_COLS + col); return;
      case 'down': this.moveCursor(((row + 1) % KEY_ROWS) * KEY_COLS + col); return;
      // digits typed: PRESS on an amount key commits the typed amount, never the highlighted preset cell
      case 'primary': case 'confirm': {
        if (e.repeat) return;
        const cell = KEYS[this.cursor];
        this.pressKey(this.entry !== '' && modeOfKey(cell) === null ? 'enter' : cell);
        return;
      }
      case 'alt': if (!e.repeat) this.setMode(cycleMode(this.mode)); return;
      case 'betMax': if (!e.repeat) this.pressKey('all'); return;
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
      case 'collect': if (!e.repeat) this.ringBell(); return;
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

  private setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.clearEntry();
    this.sfx('click');
    this.refresh(true);
  }

  private typeDigit(d: number): void {
    const next = appendDigit(this.entry, d);
    if (next === this.entry) return;
    this.entry = next;
    this.sfx('click');
    this.refresh(true);
  }

  /** One keypad press. A top-row key picks the action (QUOTA twice settles); an amount key works on the chosen action. */
  private pressKey(key: KeyId): void {
    const picked = modeOfKey(key);
    if (picked !== null) {
      if (picked === 'quota' && this.mode === 'quota' && this.quota().met && !nightPaid(this.ctx.run)) { this.pullLever('settle'); return; }
      const before = this.mode;
      this.setMode(picked);
      if (picked === before) this.sfx('hover');
      return;
    }
    if (this.mode === 'quota') this.setMode('dep');            // an amount key always acts: it takes the screen to DEPOSIT
    if (this.mode === 'wd') this.pressWithdraw(key);
    else this.pressDeposit(key);
  }

  /** Authority side: work out the amount, take the money (credit step), then present the stream on every peer. */
  private pressDeposit(key: KeyId): void {
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
    if (!confirmAll && amount > room) {                                        // the float stays in the pocket, even for the last coins of the quota (only ALL goes below it)
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

  /** WITHDRAW: the amount comes from what the bank can give back; the run applies it in the credit step. */
  private pressWithdraw(key: KeyId): void {
    if (nightPaid(this.ctx.run)) { this.refuse('nightPaidNote'); return; }
    const run = this.bankRun();
    if (!run.withdraw) { this.refuse('wdClosed'); return; }
    const bank = this.bk();
    if (!bank.open) { this.refuse('wdClosed'); return; }
    if (bank.withdrawable <= 0) { this.refuse('wdNone'); return; }
    let amount: number;
    if (key === 'enter') {
      if (this.entry === '') { this.refuse('typeAmount'); return; }
      amount = Math.min(customAmount(this.entry), bank.withdrawable);
    } else {
      amount = this.cellWithdraw(key, bank);
    }
    this.clearEntry();
    const pv = this.wdPreview(amount);
    const ok = pv.coins > 0;
    void this.emit(
      { k: 'wd', key, amount: pv.coins, ok, lost: pv.interestLost },
      ok ? () => {
        const got = run.withdraw?.(pv.coins) ?? 0;
        if (got <= 0) { this.ctx.ui.toast(this.t('denied'), 'bad'); return; }
        this.ctx.ui.toast(pv.interestLost > 0 ? this.t('wdDone', { n: fmtNum(got), i: fmtNum(pv.interestLost) }) : this.t('wdDoneFree', { n: fmtNum(got) }), 'sys');
      } : undefined,
    );
    this.refresh(true);
  }

  /** What an amount key takes out of a bank that can give back `bank.withdrawable`. PLAY = enough to play on. */
  private cellWithdraw(key: KeyId, bank: BankView): number {
    if (key !== 'p10' && key !== 'p25' && key !== 'p50' && key !== 'all' && key !== 'rest') return 0;
    return withdrawAmountFor(key, bank.withdrawable, playNeed(bank.pullsLeft, bank.minBet, bank.pocket));
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

  /**
   * END WATCH (decision 1): ends the Watch now, in play or Last Call. The first press asks (the toast names the pulls left), the
   * second within ALL_CONFIRM_SEC ends it. Nothing moves the coins: the bank keeps growing and unused pulls keep the rebate.
   */
  private ringBell(): void {
    this.entry = '';                       // not clearEntry(): that would disarm the confirm just armed
    const run = this.ctx.run as RunApi & BellCtl;
    if (!run.ringBell) return;
    if (this.bellArm <= 0) {
      this.bellArm = ALL_CONFIRM_SEC;
      this.sfx('click');
      this.ctx.ui.toast(this.t('bellConfirm', { n: this.bk().pullsLeft, k: this.k('collect') }), 'warn');
      return;
    }
    this.bellArm = 0;
    if (!run.ringBell()) { this.refuse('notYet'); return; }
    this.sfx('lever');
    this.ctx.ui.toast(this.t('bellDone'), 'good');
  }

  /** A refused press: one sound and one line, no coins moved, nothing emitted. */
  private refuse(key: string): void {
    this.sfx('error');
    this.ctx.ui.toast(this.t(key), 'warn');
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'lever') return this.presentLever(ev, pc);
    if (ev.k === 'wd') return this.presentWithdraw(ev, pc);
    return this.presentDeposit(ev, pc);
  }

  private async presentDeposit(ev: Extract<Ev, { k: 'dep' }>, pc: PresentCtx): Promise<void> {
    const { keys, mouthLips, receiptPivot, swipe } = this.parts;
    const fx = this.ctx.fx;
    const anchor = this.model.anchors.coinOut;
    const btn = keys.buttons[ev.key];
    const prev = this.shownDep;
    const target = this.bk().balance;

    if (pc.fast) {
      this.shownDep = target;
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
    const rolling = countUp(this.ctx, prev, target, rollSeconds(target - prev), (v) => {
      this.shownDep = Math.round(v);
      this.refresh(true);
    });
    const chew = this.anim(0.5, (k) => { mouthLips.scale.y = 1 + 0.25 * Math.sin(k * Math.PI * 4) * (1 - k); });
    await Promise.all([rolling, chew]);
    this.shownDep = target;

    this.drawReceipt('dep', ev.amount, target, this.quota().due);
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

  /** The way back: the mouth opens, coins come out on the counter, the bank counter rolls down, the receipt prints. */
  private async presentWithdraw(ev: Extract<Ev, { k: 'wd' }>, pc: PresentCtx): Promise<void> {
    const { keys, mouthLips, receiptPivot, swipe } = this.parts;
    const fx = this.ctx.fx;
    const hand = this.model.anchors.collectorHand ?? this.model.anchors.coinOut;
    const btn = keys.buttons[ev.key];
    const prev = this.shownDep;
    const target = this.bk().balance;

    if (pc.fast) { this.shownDep = target; this.refresh(true); return; }
    void btn?.press(0.1);
    this.sfx('button');
    if (!ev.ok) {
      if (this.isLocalOccupant) this.seatHud?.result('lose');
      this.sfx('error');
      fx.shake(0.01, 0.15);
      fx.popText(hand, this.t('denied'), RED, { scale: 1.1 });
      await this.wait(0.2);
      return;
    }
    swipe.blink(10, 0.2);
    this.sfx('beep', { vol: 0.5, pitch: 0.8 });
    await this.anim(0.12, (k) => { mouthLips.scale.y = lerp(1, 1.8, k); }, 'outQuad');

    const n = clamp(Math.round(6 + Math.log10(ev.amount + 1) * 6), 6, 40);
    this.sfx('cashRegister');
    this.sfx('coinShower', { vol: 0.8 });
    fx.coins(hand, n, { spread: 0.1, up: 0.3 });
    fx.popText(hand, `-${fmtNum(ev.amount)}`, 0xff9a70, { scale: 1.2 });
    const rolling = countUp(this.ctx, prev, target, rollSeconds(target - prev), (v) => { this.shownDep = Math.round(v); this.refresh(true); });
    const close = this.anim(0.45, (k) => { mouthLips.scale.y = lerp(1.8, 1.0, k); });
    await Promise.all([rolling, close]);
    this.shownDep = target;

    this.drawReceipt('wd', ev.amount, target, this.quota().due);
    receiptPivot.scale.y = 0.01;
    this.sfx('printer');
    await this.anim(0.35, (k) => { receiptPivot.scale.y = lerp(0.01, 1, k); }, 'outBack');
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
    const bank = this.bk();
    const paid = nightPaid(this.ctx.run);
    const phase = this.ctx.run.shift.phase;
    const night = this.ctx.run.night();
    // a new phase (Watch, Dawn, Night) starts with an empty amount: a typed one never carries over (the stale entry)
    if (phase !== this.lastPhase) { this.lastPhase = phase; this.clearEntry(); }
    // a new Night or the paid screen must not keep a stale count-up value
    if (paid !== this.lastPaid || night !== this.lastNight) { this.lastPaid = paid; this.lastNight = night; this.shownDep = bank.balance; }
    const key = [q.due, this.shownDep, q.base, q.assessment, this.entry, this.cursor, this.mode, bank.pocket, bank.withdrawable, bank.interestNext,
      bank.pullsToQualify, bank.open ? 1 : 0, q.met ? 1 : 0, paid ? 1 : 0, phase, night, this.ctx.run.depositFloor?.() ?? 0].join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.lightKeys();

    this.parts.leds.quota.set(String(fmtNum(paid ? 0 : q.due)).padStart(10, ' '));
    this.parts.leds.deposit.set(String(fmtNum(this.shownDep)).padStart(10, ' '));
    this.parts.readyLamp.setOn(q.met || paid);
    this.drawCrt(q, bank, paid, phase === 'intermission');
    if (this.isLocalOccupant) this.showHud();
  }

  /** The amount the highlighted key (or the typed digits) would move now, in the chosen action. 0 on a top-row key. */
  private focusAmount(bank: BankView): number {
    if (this.entry !== '') {
      const typed = customAmount(this.entry);
      return this.mode === 'wd' ? Math.min(typed, bank.withdrawable) : Math.min(typed, this.wallet());
    }
    const cell = KEYS[this.cursor];
    if (modeOfKey(cell) !== null || cell === 'enter') return 0;
    if (this.mode === 'wd') return this.cellWithdraw(cell, bank);
    const wallet = this.wallet();
    return clampDeposit(Math.min(amountFor(cell, wallet, bank.left), cell === 'all' ? wallet : bank.left), wallet);
  }

  /**
   * The CRT is a 512 × 384 texture seen from about a metre, so type is big: labels 30-34 px, figures up to 60 px. Top: three tabs
   * (DEPOSIT, WITHDRAW, QUOTA), the active one lit. Under them BANK and POCKET (always). Then ONE main figure of the chosen action,
   * two lines of detail and the amount box. A figure shrinks only when it would run past its column.
   */
  private drawCrt(q: Readonly<QuotaState>, bank: BankView, paid: boolean, inter: boolean): void {
    const s = this.parts.crt;
    s.clear('#060300');                              // an opaque dark ground: the figures are full-bright on it
    const amber = '#ffc02a', hot = '#fff0a0', dim = '#c0982e', red = '#ff9a78', green = '#b4ffb4', cyan = '#9fe8ff';
    const RIGHT = 504;
    const fit = (v: string, max: number, w: number): number => Math.min(max, Math.floor(w / Math.max(1, v.length)));
    const label = (str: string, x: number, y: number, color = amber, size = 32, align: 'left' | 'right' | 'center' = 'left'): void => {
      s.text(str, x, y, { font: 'vt', size, color, align });
    };
    if (paid) {                                   // Dawn paid the Night: no stale quota, just the carry-over and the lever
      s.text(this.t('crt_paid', { n: this.ctx.run.night() }), 256, 40, { font: 'vt', size: 60, color: '#fff070', align: 'center' });
      if (q.deposited > 0) {
        label(this.t('crt_carry'), 14, 124, amber, 34);
        const v = fmtNum(q.deposited);
        s.text(v, RIGHT, 168, { font: 'ps2p', size: fit(v, 72, 486), color: '#fff4b8', align: 'right' });
      }
      s.text(this.t('crt_floor'), 256, 300, { font: 'vt', size: 42, color: '#fff0c0', align: 'center' });
      return;
    }
    // tabs
    const tabs: Array<[Mode, string]> = [['dep', 'k_dep'], ['wd', 'k_wd'], ['quota', 'k_quota']];
    tabs.forEach(([m, k], i) => {
      const x = 4 + i * 169, w = 166, on = this.mode === m;
      s.draw((g) => {
        g.fillStyle = on ? amber : '#241800'; g.fillRect(x, 2, w, 44);
        if (!on) { g.strokeStyle = '#8a6a14'; g.lineWidth = 2; g.strokeRect(x + 1, 3, w - 2, 42); }
      });
      s.text(this.t(k), x + w / 2, 6, { font: 'vt', size: 44, color: on ? '#1a1000' : '#d8aa30', align: 'center' });
    });
    // BANK and POCKET, always
    const bv = fmtNum(this.shownDep), pv = fmtNum(bank.pocket);
    label(this.t('c_bank'), 12, 48, amber, 34);
    s.text(bv, 248, 84, { font: 'ps2p', size: fit(bv, 44, 236), color: hot, align: 'right' });
    label(this.t('c_pocket'), 268, 48, amber, 34);
    s.text(pv, RIGHT, 84, { font: 'ps2p', size: fit(pv, 44, 236), color: cyan, align: 'right' });
    s.draw((g) => { g.fillStyle = '#6a4e12'; g.fillRect(4, 134, 504, 3); g.fillRect(258, 52, 3, 78); });

    const amt = this.focusAmount(bank);
    const typedTxt = this.entry === '' ? '_' : `${fmtNum(customAmount(this.entry))}_`;
    const box = (y: number): void => {
      s.draw((g) => { g.fillStyle = '#241800'; g.fillRect(4, y, 504, 38); g.strokeStyle = amber; g.lineWidth = 2; g.strokeRect(5, y + 1, 502, 36); });
      label(this.t('nAmount'), 14, y + 3, amber, 34);
      s.text(typedTxt, RIGHT - 6, y + 9, { font: 'ps2p', size: 24, color: '#fff0c0', align: 'right' });
    };

    if (this.mode === 'dep') {
      const lv = fmtNum(bank.left);
      label(this.t(bank.left > 0 ? 'c_left' : 'c_metBig'), 12, 140, amber, 36);
      s.text(lv, RIGHT, 168, { font: 'ps2p', size: fit(lv, 64, 490), color: bank.left > 0 ? red : green, align: 'right' });
      if (bank.ratePct > 0) {
        label(this.t('c_interest'), 12, 234, amber, 36);
        s.text(`+${fmtNum(bank.interestNext)}`, RIGHT, 238, { font: 'ps2p', size: 28, color: hot, align: 'right' });
        const withIt = amt > 0 ? bank.interestAt(bank.balance + amt) : 0;
        if (withIt > bank.interestNext) label(this.t('c_with', { n: fmtNum(withIt) }), 12, 270, hot, 32);
        else if (bank.pullsToQualify > 0) label(this.t('c_pulls', { n: bank.pullsToQualify }), 12, 270, red, 30);
        else label(this.t('c_rate', { r: bank.ratePct, c: fmtNum(bank.interestCap) }), 12, 270, dim, 30);
      }
      box(302);
      // the float of this Watch: what every deposit leaves in the pocket (fixed for the Watch, see float.ts)
      const floor = this.ctx.run.depositFloor?.() ?? 0;
      if (floor > 0) label(this.t('c_float', { n: fmtNum(floor) }), 12, 346, cyan, 30);
    } else if (this.mode === 'wd') {
      if (!bank.open || bank.withdrawable <= 0) {
        label(this.t(!bank.open ? 'c_wdClosed' : 'c_wdEmpty'), 256, 200, red, 40, 'center');
      } else {
        const pw = this.wdPreview(amt);
        const tv = fmtNum(pw.coins);
        label(this.t('c_take'), 12, 140, amber, 36);
        s.text(tv, RIGHT, 168, { font: 'ps2p', size: fit(tv, 64, 490), color: pw.coins > 0 ? hot : dim, align: 'right' });
        if (pw.coins <= 0) {
          label(this.t('c_wdPick'), 12, 238, amber, 38);
        } else {
          if (pw.interestLost > 0) label(this.t('c_loseInt', { n: fmtNum(pw.interestLost) }), 12, 234, red, 36);
          else label(this.t('c_loseNone'), 12, 234, dim, 36);
          if (pw.metLost) label(this.t('c_loseMet'), 12, 270, red, 32);
          else if (pw.leftAfter > bank.left) label(this.t('c_loseQ', { a: fmtNum(bank.left), b: fmtNum(pw.leftAfter) }), 12, 270, red, 32);
          else if (pw.tierLost) label(this.t('c_loseTier'), 12, 270, red, 32);
        }
      }
      box(302);
    } else {
      const dv = fmtNum(bank.due);
      label(this.t('q_due'), 12, 140, amber, 36);
      s.text(dv, RIGHT, 168, { font: 'ps2p', size: fit(dv, 64, 490), color: hot, align: 'right' });
      const extra = Math.max(0, q.due - q.base - q.assessment);
      label(this.t('q_base', { b: fmtNum(q.base), a: fmtNum(q.assessment) }) + (extra > 0 ? `  ${this.t('q_loan', { l: fmtNum(extra) })}` : ''), 12, 226, dim, 32);
      label(this.t('q_bank', { b: fmtNum(bank.balance), p: pct(ratioOf(bank.balance, q.due)) }), 12, 260, amber, 34);
      if (bank.ratePct > 0) label(this.t('q_next', { n: fmtNum(bank.interestNext) }), 12, 294, hot, 34);
      const next = nextTier(this.tiers(), ratioOf(this.shownDep, q.due));
      if (q.met) label(this.t('q_settle'), 12, 332, green, 36);
      else if (next !== null) label(this.t('q_reward', { p: pct(next.ratio) }), 12, 332, '#e0a040', 34);
    }
    // status line
    if (this.mode !== 'quota') {
      if (inter) label(this.t('crt_bell'), RIGHT, 346, hot, 34, 'right');
      else if (q.met) label(this.t('crt_met'), RIGHT, 346, hot, 34, 'right');
    }
  }

  /** The keypad cursor is the one lit cap plus a gold frame on its cell; the active action's cap stays lit too. */
  private lightKeys(): void {
    const cur = KEYS[this.cursor];
    for (const id of KEYS) this.parts.keys.buttons[id]?.setLit(id === cur || id === this.mode);
    this.parts.keyCursor.position.set(KEY_POS[cur].x, 0, KEY_POS[cur].z);
    // REST means "what the quota still needs" on DEPOSIT and "enough to play on" on WITHDRAW
    this.parts.keyLabels.rest?.setText({ key: this.mode === 'wd' ? 'm.debt_terminal.k_play' : 'm.debt_terminal.k_rest' });
  }

  private drawReceipt(kind: 'dep' | 'wd', amount: number, bank: number, due: number): void {
    const r = this.parts.receipt;
    r.clear('#f4efe0');
    const line = (str: string, y: number): void => { r.text(str, 4, y, { font: 'px5', color: '#202020' }); };
    line(this.t('rc_title'), 8);
    line(`${this.t(kind === 'dep' ? 'rc_dep' : 'rc_wd')} ${kind === 'dep' ? '+' : '-'}${fmtNum(amount)}`, 22);
    line(`${this.t('rc_bank')} ${fmtNum(bank)}`, 36);
    line(`${this.t('rc_quota')} ${fmtCoins(due)}`, 48);
    line(`${this.t('rc_left')} ${fmtNum(Math.max(0, due - bank))}`, 60);
    line(this.t('rc_thanks'), 74);
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to an action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private g(a: BindingKey): string { return this.ctx.input.keyLabel(a); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.debt_terminal.tip1' },
      { k: 'm.debt_terminal.tip2', v: { move: this.g('left'), press: this.k('confirm'), digits: this.k('n1'), mode: this.k('alt') } },
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
    const bank = this.bk();
    const left = bank.left;
    const wallet = this.wallet();
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.debt_terminal.goal' });

    const paid = nightPaid(this.ctx.run);
    const inter = this.ctx.run.shift.phase === 'intermission';

    // STATE: what this screen does, then whether the quota is paid yet
    if (paid) sh.state({ k: 'm.debt_terminal.stPaid' }, 'good', { k: 'm.debt_terminal.stPaidSub' });
    else if (q.due <= 0) sh.state({ k: 'm.debt_terminal.stNone' }, 'neutral');
    else if (this.mode === 'wd') {
      if (bank.open && bank.withdrawable > 0) sh.state({ k: 'm.debt_terminal.stWithdraw' }, 'cyan', { k: 'm.debt_terminal.stWithdrawSub', v: { n: fmtCoins(bank.withdrawable) } });
      else sh.state({ k: 'm.debt_terminal.stWdNone' }, 'warn', { k: 'm.debt_terminal.stWdNoneSub' });
    } else if (this.mode === 'quota') sh.state({ k: 'm.debt_terminal.stQuota' }, q.met ? 'good' : 'gold', { k: 'm.debt_terminal.stQuotaSub', v: { n: fmtCoins(left) } });
    else if (inter) sh.state({ k: 'm.debt_terminal.stBell' }, 'gold', { k: 'm.debt_terminal.stBellSub' });
    else if (q.met) sh.state({ k: 'm.debt_terminal.stMet' }, 'good', { k: 'm.debt_terminal.stMetSub' });
    else sh.state({ k: 'm.debt_terminal.stDeposit' }, 'gold', { k: 'm.debt_terminal.stDepositSub', v: { n: fmtCoins(left) } });

    // KEY NUMBERS
    const nums: HudNumber[] = paid
      ? [   // no stale DUE / LEFT after Dawn: the carry-over and the pocket only
        { label: { k: 'm.debt_terminal.nBank' }, value: fmtCoins(bank.balance), tone: 'cyan' },
        { label: { k: 'm.debt_terminal.nWallet' }, value: fmtCoins(wallet), tone: 'neutral' },
      ]
      : [
        { label: { k: 'm.debt_terminal.nDue' }, value: fmtCoins(q.due), tone: 'gold' },
        { label: { k: 'm.debt_terminal.nBank' }, value: fmtCoins(bank.balance), tone: 'cyan' },
        { label: { k: 'm.debt_terminal.nLeft' }, value: fmtCoins(left), tone: left > 0 ? 'warn' : 'good' },
        { label: { k: 'm.debt_terminal.nWallet' }, value: fmtCoins(wallet), tone: 'neutral' },
        this.mode === 'wd'
          ? { label: { k: 'm.debt_terminal.nCanTake' }, value: fmtCoins(bank.withdrawable), tone: 'gold' }
          : { label: { k: 'm.debt_terminal.nAmount' }, value: this.entry === '' ? '-' : fmtCoins(customAmount(this.entry)), tone: 'gold' },
      ];
    sh.numbers(nums);

    // CONTROL BAR: the keypad, the action switch, then SETTLE only once the quota is met
    if (inter) ctrl.push({ key: this.k('fast'), label: { k: paid ? 'm.debt_terminal.cFloor' : 'm.debt_terminal.cBell' }, action: 'fast', primary: true });
    if (!paid) {
      ctrl.push({ key: `${this.g('left')}/${this.g('right')}`, label: { k: 'm.debt_terminal.cMove' }, action: 'left' });
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.debt_terminal.cPress' }, action: 'confirm', primary: !inter });
      ctrl.push({ key: this.k('alt'), label: { k: 'm.debt_terminal.cMode' }, action: 'alt' });
      // digits 1-9 and the real key for 0 (BET UP types a 0; its binding, not a fixed "0")
      ctrl.push({ key: `${this.k('n1')}-${this.k('n9')}/${this.k('betUp')}`, label: { k: 'm.debt_terminal.cAmount' }, action: 'n1' });
      if (this.entry !== '') ctrl.push({ key: this.k('clear'), label: { k: 'm.debt_terminal.cBack' }, action: 'clear' });
    }
    if (q.met && !inter) ctrl.push({ key: this.k('double'), label: { k: 'm.debt_terminal.cSettle' }, action: 'double', primary: true });
    const phase = this.ctx.run.shift.phase;
    if (phase === 'play' || phase === 'lastCall') ctrl.push({ key: this.k('collect'), label: { k: 'm.debt_terminal.cEnd' }, action: 'collect' });
    ctrl.push({ key: this.g('help'), label: { k: 'm.debt_terminal.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.debt_terminal.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
