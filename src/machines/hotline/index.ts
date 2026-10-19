/**
 * Hotline booth (`hotline`, system) — the phone line of GDD §5. devices-core lane.
 *
 * The call itself (who rings, the script, the options, the consequences) belongs to the game (game-hotline). The booth
 * reads it through `ctx.run.phone()` (a `PhoneCallState` or null) and answers through `ctx.run.answerPhone(choice)`:
 * `-1` picks up, `0..2` chooses the option at that index. Nothing here decides a call.
 *
 * Every peer draws the same thing from the same state: the booth lamp and nixie follow the ring cadence (1.0 s on,
 * 0.7 s off, for 10 s from `ringingSince`). `present()` plays the juice for the two local choices: the handset lift
 * with a wobble, and the dial spin with a pop of the number chosen.
 *
 * Controls (seated): Space/Enter pick up · 1 / 2 / 3 choose an option (within 15 s of the pick-up) · E stands up.
 * From anywhere (walking or seated): P (`answerPhone`) picks a ringing line up, 1 / 2 / 3 (`phoneOpt1..3`) choose while the board
 * is up. The board stays up when the player stands and walks on. `phoneWalkKeys` is the walk-layer hook (WIRING in the work report).
 * While the board is up it is a modal (`InputExt.setModal`): seated, 1 / 2 / 3 choose through the walk-layer keys and the
 * machine is not sent them; Esc closes the board without choosing (the call and its seat buttons stay).
 * Hang-up is not in RunApi yet, so leaving only stands you up; the game resolves an unanswered call on its own clock.
 *
 * Subtitles and the caller's voice belong to game-hotline (its own overlay); the booth only plays the bell, the lamp
 * and the handset.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { BindingKey, MachineAction, MachineInputEvent } from '@/core/input/types';
import type { InputExt } from '@/core/input';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import type { PhoneCallState } from '@/net/protocol';
import type { HeadlessPlay } from '@/game/types';
import { t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { bus } from '@/core/events';
import { PX5_LINE_H } from '@/core/texgen/font';
import { BRASS, CREAM, INK, INK_SOFT, PAPER_DARK, RED, Placard3D, put, wrapPx5, fitPx5 } from '@/machines/_base/placard3d';
import type { HotlineResultEvent } from '@/game/hotline';
import { buildModel, type HotlineParts } from './model';
import {
  ANSWER_S, RESCUE_RING_S, RING_TOTAL_S, canAnswer, choiceCount, choiceFromAction, choiceSecondsLeft, offerKeys, parseOption, resolveVars, ringIndex,
  ringState, ringTotal, targetLabel,
} from './rules';

const GREEN = '#1f6b2c';
// deal sheet (3D placard held in front of the eye): canvas texels and metres
const SHEET_PX: [number, number] = [300, 214];
const SHEET_W = 0.46, SHEET_H = SHEET_W * SHEET_PX[1] / SHEET_PX[0];
const SHEET_HEAD = 20, ROW_Y = 24, ROW_H = 56, ROW_PAD = 3;

type Ev =
  /** The local occupant picked up the handset (choices open for `ANSWER_S` after `until`). */
  | { k: 'pick'; until: number }
  /** A choice was made. `label` is the option's i18n key, already resolved to text on the sender. */
  | { k: 'choose'; i: number; label: string };

const GOLD = 0xffd040;
const LIFT_RAISE = 0.14, LIFT_FORWARD = 0.18;
/** Every booth in the world. The phone is one line, so the walking keys go through the first booth (`phoneWalkKeys`). */
const booths = new Set<Hotline>();
/** The one deal board on screen (whichever booth opened it): a call's board opens once, never twice. */
let sheetOwner: Hotline | null = null;
/** The call whose board was shown and closed (or could not be shown); it does not reopen for that call. */
let sheetDone = -1;

export const def: MachineDef = {
  id: 'hotline',
  category: 'system',
  slotSize: 'M',
  zone: 'atrium',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'phone'],
  modHooks: {},
  strings: {
    en: {
      name: 'Hotline',
      desc: 'A red phone in a wood booth. It rings when someone wants something from you.',
      h_pick: 'PICK UP', h_choose: 'CHOOSE', h_leave: 'LEAVE', all: 'ALL',
      s_ring: 'RINGING', s_choose: 'CHOOSE', s_busy: 'ON THE LINE', s_notYou: 'NOT FOR YOU',
      notYou: 'That call is not for you.', ringing: 'RING RING', choice: 'OPTION {n}',
      goal: "Answer the call that is for you, then pick the reply that fits the caller.",
      stQuiet: "LINE IS QUIET",
      stQuietSub: "Wait for the phone to ring",
      stRing: "PHONE IS RINGING",
      stRingSub: "Pick up within {n}s",
      stRingOther: "CALL FOR SOMEONE ELSE",
      stRingOtherSub: "You cannot answer this one",
      stChoose: "CHOOSE A REPLY",
      stChooseSub: "Pick one of the numbered replies",
      stBusy: "ON THE LINE",
      stBusySub: "Another player is on the line",
      nCaller: "CALLER",
      nRing: "RINGING",
      nTime: "TIME LEFT",
      cPick: "PICK UP",
      cRules: "RULES",
      cLeave: "LEAVE",
      rule1: "When the phone rings, pick up. Only the player the call is for can answer it.",
      rule2: "After you pick up, the caller offers three deals, each a boon with a price. Press 1, 2 or 3 (or click one) within 15 seconds.",
      rule3: "If nobody answers in time, the game resolves the call on its own clock.",
      rule4: "E stands up from the booth. Hanging up is not possible yet; standing up keeps the call and its deal board.",
      rule5: "Answering works from anywhere, walking or seated: the answer key picks up, and the board stays up while you walk.",
      ringHint: "RING RING: [{phone}] ANSWERS FROM ANYWHERE",
      sheetTitle: "THE HOUSE CALLS", sheetHint: "Press 1 / 2 / 3 or click a deal", sheetGet: "GET", sheetPay: "PAY",
      speaker: "THE HOUSE",
    },
    tr: {
      name: 'Hat Telefonu',
      desc: 'Ahşap kabinde kırmızı bir telefon. Biri senden bir şey istediğinde çalar.',
      h_pick: 'AÇ', h_choose: 'SEÇ', h_leave: 'AYRIL', all: 'HEPSİ',
      s_ring: 'ÇALIYOR', s_choose: 'SEÇ', s_busy: 'HATTA', s_notYou: 'SANA DEĞİL',
      notYou: 'Bu çağrı sana ait değil.', ringing: 'TRIN TRIN', choice: 'SEÇENEK {n}',
      goal: "Sana gelen çağrıyı aç, sonra arayana uygun yanıtı seç.",
      stQuiet: "HAT SESSİZ",
      stQuietSub: "Telefonun çalmasını bekle",
      stRing: "TELEFON ÇALIYOR",
      stRingSub: "{n} sn içinde aç",
      stRingOther: "BAŞKASI İÇİN ÇAĞRI",
      stRingOtherSub: "Bu çağrıyı sen açamazsın",
      stChoose: "BİR YANIT SEÇ",
      stChooseSub: "Numaralı yanıtlardan birini seç",
      stBusy: "HATTA",
      stBusySub: "Başka bir oyuncu hatta",
      nCaller: "ARAYAN",
      nRing: "ÇALIYOR",
      nTime: "KALAN SÜRE",
      cPick: "AÇ",
      cRules: "KURALLAR",
      cLeave: "AYRIL",
      rule1: "Telefon çaldığında aç. Çağrı kime aitse yalnız o oyuncu açabilir.",
      rule2: "Açtıktan sonra arayan üç teklif sunar; her biri bedeli olan bir kazanç. 15 saniye içinde 1, 2 ya da 3 tuşla (ya da tıkla).",
      rule3: "Kimse zamanında açmazsa oyun çağrıyı kendi saatiyle çözer.",
      rule4: "E tuşu kabinden kalkar. Henüz kapatma yok; kalkmak çağrıyı ve teklif panosunu açık tutar.",
      rule5: "Açmak her yerden olur, yürürken ya da otururken: açma tuşu telefonu kaldırır, pano sen yürürken de açık kalır.",
      ringHint: "TRIN TRIN: [{phone}] HER YERDEN AÇILIR",
      sheetTitle: "EV ARIYOR", sheetHint: "1 / 2 / 3 tuşla ya da bir teklife tıkla", sheetGet: "KAZAN", sheetPay: "BEDEL",
      speaker: "EV",
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

/**
 * The phone from anywhere (WIRING: call once per input poll, in any mode, with the walk-layer `pressed`). `answerPhone`
 * (KeyP) picks a ringing line up; `phoneOpt1..3` (1 / 2 / 3) choose a deal while the board is up. Seated or walking, the
 * same calls and the same board; the player keeps their position. Does nothing while no booth exists.
 */
export function phoneWalkKeys(pressed: (action: string) => boolean): void {
  let booth: Hotline | null = null;
  for (const b of booths) { booth = b; break; }
  if (!booth) return;
  if (pressed('answerPhone')) booth.answerPhoneKey();
  for (let i = 0; i < 3; i++) if (pressed(`phoneOpt${i + 1}`)) booth.chooseKey(i);
}

export default class Hotline extends MachineBase<HotlineParts, Ev, null> {
  private callId = -1;             // id of the call the booth last saw (-1 = none)
  private lastRing = -1;           // ring cycle index whose bell already sounded
  private handsetUp = false;
  private restPos = new THREE.Vector3();
  private restRot = new THREE.Euler();
  private shownTarget = '';
  private hudKey = '';
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** The deal sheet (3D placard with the three offers), the call it was opened for, and the host ms it closes at. */
  private sheet: Placard3D | null = null;
  private sheetCall = -1;
  private sheetUntil = 0;
  private sheetSecs = -1;
  private offResult: (() => void) | null = null;
  private offModalCancel: (() => void) | null = null;
  /** Ring cue for the walker: the first booth tells the player once per call that the phone rings for them. */
  private cueCall = -1;

  protected createModel(kit: KitX): MachineModel<HotlineParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.restPos.copy(this.parts.handset.position);
    this.restRot.copy(this.parts.handset.rotation);
    this.parts.lamp.setOn(false);
    this.parts.target.set('--');
    this.attractor.every('tick', 6, () => this.ctx.fx.glow(this.parts.lamp.root, 0xffd34a, 0.3, 0.5), { first: 3 });
    this.offResult = bus.on('hotline:result', (e) => this.onResult(e));
    this.offModalCancel = this.inputExt().onModalCancel(() => { if (sheetOwner === this) this.closeSheet(this.sheetCall); });
    booths.add(this);
  }

  /** What the call came to (deal struck, deal off, line dead): one toast for the seated player. */
  private onResult(e: HotlineResultEvent): void {
    this.closeSheet(e.callId);
    if (!this.isLocalOccupant) return;
    const text = tr(e.note, resolveVars(e.vars, (k) => tr(k)));
    this.toast(text, e.kind === 'deal' ? (e.ok ? 'good' : 'warn') : 'info');
    if (e.kind === 'deal' && e.ok) this.ctx.fx.shake(0.01, 0.15);
  }

  /** Ring length in seconds for this run (base 20 s, plus `x.phone.ringTime`). */
  private ringSeconds(call?: { script: string } | null): number {
    const base = ringTotal(this.mod('x.phone.ringTime', RING_TOTAL_S));
    return call?.script === 'hotline.call.rescue' ? Math.max(base, RESCUE_RING_S) : base;
  }

  private now(): number { return this.ctx.net.hostTime(); }

  attract(dt: number, _t: number): void {
    this.attractor.update(dt);
  }

  // ── view of the run's call (every peer) ─────────────────────────────────────────────────────────
  tick(_dt: number): void {
    const call = this.ctx.run.phone();
    const nowId = call?.id ?? -1;
    if (nowId !== this.callId) {
      const ended = this.callId !== -1 && call === null;
      this.callId = nowId;
      this.lastRing = -1;
      if (ended && this.handsetUp) void this.liftHandset(false);   // the line went dead: hang the handset up
      // the walker is not at a booth: one cue for the call, from the first booth only (the phone is one line)
      if (call && call.answeredBy === null && !this.isLocalOccupant && canAnswer(call.target, this.selfId) && this.isFirstBooth()) {
        this.ctx.ui.toast(this.t('ringHint', { phone: this.k('answerPhone') }), 'info');
      }
    }

    if (call && call.answeredBy === null) {
      const el = (this.now() - call.ringingSince) / 1000;
      const r = ringState(el, this.ringSeconds(call));
      this.parts.lamp.setOn(r.on);
      const idx = ringIndex(el);
      if (r.on && idx !== this.lastRing) { this.lastRing = idx; this.sfx('phoneRing'); }
    } else {
      this.parts.lamp.setOn(false);
    }

    const target = call ? targetLabel(call.target, this.t('all')) : '--';
    if (target !== this.shownTarget) { this.shownTarget = target; this.parts.target.set(target.padStart(2)); }

    if (this.isLocalOccupant) this.showHud(call);
    this.syncSheet(call);                  // the board follows the handset, seated or walking
  }

  dispose(): void {
    this.offResult?.(); this.offResult = null;
    this.offModalCancel?.(); this.offModalCancel = null;
    booths.delete(this);
    if (sheetOwner === this) this.closeSheet();
    this.sheet?.dispose(); this.sheet = null;
    this.ctx.ui.root.classList.remove('hl-sheet');
    this.seatHud?.dispose();
    super.dispose();
  }

  private isFirstBooth(): boolean {
    for (const b of booths) return b === this;
    return false;
  }

  /** Seated: the outcome goes to every peer. Walking: `emit` is the seat's, so the booth shows the beat here only (the run holds the state). */
  private send(ev: Ev): void {
    if (this.isLocalOccupant) { void this.emit(ev); return; }
    void (ev.k === 'pick' ? this.presentPick(ev) : this.presentChoose(ev));
  }

  /** Answer key (seated or walking): picks the ringing line up. The handset lift is the same as the seated pick-up. */
  answerPhoneKey(): void {
    const call = this.ctx.run.phone();
    if (!call || call.answeredBy !== null) return;
    if (!canAnswer(call.target, this.selfId)) { this.ctx.ui.toast(this.t('notYou'), 'warn'); this.sfx('error'); return; }
    this.ctx.run.answerPhone(-1);
    this.send({ k: 'pick', until: this.now() + ANSWER_S * 1000 });
    if (call.script) this.ctx.ui.subtitle(tr(call.script), this.t('speaker'), 6);
  }

  /** Deal keys 1 / 2 / 3 while walking (the board stays up; the player keeps their position). */
  chooseKey(i: number): void { this.takeOffer(i); }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime'); this.hudKey = '';
      this.seatHud?.show(); this.showHud(this.ctx.run.phone());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    // standing up keeps the call and its board: the player walks on and still answers with the keys
    if (local) { this.seatHud?.hide(); this.hudKey = ''; }
  }

  onLang(): void {
    this.shownTarget = '';
    this.hudKey = '';
    this.sheet?.repaint();
    if (this.isLocalOccupant) this.showHud(this.ctx.run.phone());
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (e.repeat) return;
    if (e.action === 'primary' || e.action === 'confirm') { this.answerPhoneKey(); return; }
    const idx = choiceFromAction(e.action);
    if (idx >= 0) this.takeOffer(idx);
  }

  /** Takes offer `idx` (key 1 / 2 / 3, a click on the deal sheet, or the walking deal keys). */
  private takeOffer(idx: number): void {
    const call = this.ctx.run.phone();
    if (!call || call.answeredBy !== this.selfId || idx >= choiceCount(call.options)) { this.sfx('error'); return; }
    const o = parseOption(call.options[idx] ?? '');
    const label = tr(offerKeys(o.key).name, resolveVars(o.vars, (k) => tr(k)));
    this.closeSheet(call.id);
    this.ctx.run.answerPhone(idx);
    this.send({ k: 'choose', i: idx, label });
  }

  // ── the deal sheet: the three offers on a board in front of the eye ─────────────────────────────
  /** Opens the sheet when the local player has the handset and the call has offers; closes it when the call is gone. */
  private syncSheet(call: PhoneCallState | null): void {
    const mine = call !== null && call.answeredBy === this.selfId && choiceCount(call.options) > 0;
    if (!mine) { if (sheetOwner === this) this.closeSheet(); return; }
    if (sheetOwner !== null || sheetDone === call.id) return;   // one board at a time; closed (or taken) for this call
    this.openSheet(call);
  }

  private openSheet(call: PhoneCallState): void {
    this.sheetCall = call.id;
    this.sheetUntil = this.now() + ANSWER_S * 1000;
    this.sheetSecs = ANSWER_S;
    const p = new Placard3D({
      name: 'hotline-deals',
      w: SHEET_W, h: SHEET_H, px: SHEET_PX,
      pages: () => 1,
      bg: CREAM,
      frame: { color: 0x6b4f1d, pad: 0.012, depth: 0.008 },
      rest: [0, -0.03, -0.5],
      clearSeat: true,                             // seated: lifted above the seat stack so option 3 is not covered
      paint: (c) => this.paintSheet(c),
      tick: () => {
        const s = choiceSecondsLeft(this.sheetUntil, this.now());
        if (s === this.sheetSecs) return false;
        this.sheetSecs = s;
        return true;
      },
      act: (a) => { if (a.startsWith('pick')) this.takeOffer(Number(a.slice(4))); },
    });
    this.sheet = p;
    sheetOwner = this;
    if (!p.show()) {      // no overlay (menus, bench): the seat HUD buttons and keys remain
      p.dispose(); this.sheet = null; sheetOwner = null; sheetDone = call.id; return;
    }
    this.inputExt().setModal('hotline-deals');   // the board owns 1 / 2 / 3 and Esc until it closes
    // The deal board is up: ui.css hides the House / Collector speech bubbles meanwhile (they do not talk over the offers).
    this.ctx.ui.root.classList.add('hl-sheet');
  }

  /** Hides the one board on screen (whichever booth opened it). `done` = the call it is closed for (it will not reopen). */
  private closeSheet(done?: number): void {
    if (done !== undefined) sheetDone = done;
    const owner = sheetOwner;
    if (!owner) return;
    const p = owner.sheet;
    owner.sheet = null;
    sheetOwner = null;
    this.inputExt().setModal(null);
    this.ctx.ui.root.classList.remove('hl-sheet');
    p?.hide();
  }

  private paintSheet(c: { g: CanvasRenderingContext2D; w: number; h: number; hover: string | null; region(x: number, y: number, w: number, h: number, a: string): void }): void {
    const { g, w, h } = c;
    const call = this.ctx.run.phone();
    g.fillStyle = BRASS; g.fillRect(0, 0, w, SHEET_HEAD);
    put(g, this.t('sheetTitle'), 8, 6, INK);
    put(g, `${Math.max(0, this.sheetSecs)}s`, w - 8, 6, this.sheetSecs <= 3 ? RED : INK, 'right');
    const n = call ? choiceCount(call.options) : 0;
    const textX = 32, textW = w - textX - 10;
    const labG = this.t('sheetGet'), labP = this.t('sheetPay');
    for (let i = 0; i < n; i++) {
      const o = parseOption(call?.options[i] ?? '');
      const keys = offerKeys(o.key);
      const v = resolveVars(o.vars, (k) => tr(k));
      const y = ROW_Y + i * ROW_H;
      const hot = c.hover === `pick${i}`;
      g.fillStyle = hot ? PAPER_DARK : '#fffaf0';
      g.fillRect(6, y, w - 12, ROW_H - ROW_PAD);
      g.fillStyle = hot ? BRASS : INK_SOFT;
      g.fillRect(6, y, w - 12, 1); g.fillRect(6, y + ROW_H - ROW_PAD - 1, w - 12, 1);
      g.fillStyle = hot ? INK : INK_SOFT;
      g.fillRect(10, y + 5, 16, 16);
      put(g, String(i + 1), 18, y + 10, hot ? BRASS : CREAM, 'center');
      put(g, fitPx5(tr(keys.name, v), textW), textX, y + 4, INK);
      let ty = y + 4 + PX5_LINE_H;
      const boon = wrapPx5(`${labG}: ${tr(keys.boon, v)}`, textW).slice(0, 2);
      for (const r of boon) { put(g, r, textX, ty, GREEN); ty += PX5_LINE_H; }
      const cost = wrapPx5(`${labP}: ${tr(keys.cost, v)}`, textW).slice(0, 2);
      for (const r of cost) { put(g, r, textX, ty, RED); ty += PX5_LINE_H; }
      c.region(6, y, w - 12, ROW_H - ROW_PAD, `pick${i}`);
    }
    put(g, this.t('sheetHint'), w / 2, h - 12, INK_SOFT, 'center');
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, _pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'pick') return this.presentPick(ev);
    return this.presentChoose(ev);
  }

  private async presentPick(ev: Extract<Ev, { k: 'pick' }>): Promise<void> {
    this.sfx('phonePickup');
    this.timerState = { until: ev.until, label: this.t('h_choose') };
    this.ctx.fx.shake(0.008, 0.12);
    this.parts.lamp.setOn(false);
    await this.liftHandset(true, true);
    this.hudKey = '';
  }

  private async presentChoose(ev: Extract<Ev, { k: 'choose' }>): Promise<void> {
    this.timerState = null;
    this.sfx('click');
    const dial = this.parts.dial;
    const spin = this.anim(0.5, (k) => { dial.rotation.z = lerp(0, -Math.PI * 0.5 * (ev.i + 1), k); }, 'outQuad');
    this.ctx.fx.popText(this.model.anchors.prompt, ev.label || this.t('choice', { n: ev.i + 1 }), GOLD, { scale: 1.2 });
    await spin;
    dial.rotation.z = 0;
    this.hudKey = '';
  }

  /** Handset lift (anticipation wobble, then the raise) or drop. Cosmetic; state comes from run. */
  private liftHandset(up: boolean, wobble = false): Promise<void> {
    if (up === this.handsetUp) return Promise.resolve();
    this.handsetUp = up;
    const h = this.parts.handset;
    const p0 = h.position.clone(), r0 = h.rotation.clone();
    const p1 = this.restPos.clone().add(new THREE.Vector3(0, up ? LIFT_RAISE : 0, up ? LIFT_FORWARD : 0));
    const r1 = up ? new THREE.Euler(-0.3, 0, 0.35) : this.restRot.clone();
    const tween = (k: number): void => {
      h.position.lerpVectors(p0, p1, k);
      h.rotation.set(lerp(r0.x, r1.x, k), lerp(r0.y, r1.y, k), lerp(r0.z, r1.z, k));
    };
    if (wobble && up) {
      return this.anim(0.08, (k) => { h.rotation.z = Math.sin(k * Math.PI * 2) * 0.06; }).then(() => this.anim(0.28, tween, 'outBack'));
    }
    return this.anim(0.28, tween, 'outQuad');
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The input service with its modal surface (the machine context hands out the same service as `Input`). */
  private inputExt(): InputExt { return this.ctx.input as unknown as InputExt; }

  /** The key bound to a machine action, as the player sees it. `answerPhone` is a walk-layer action (see keymap.ts). */
  private k(a: MachineAction | 'answerPhone'): string {
    return a === 'answerPhone' ? this.ctx.input.keyLabel('answerPhone' as BindingKey) : this.ctx.input.keyLabel(`m.${a}` as BindingKey);
  }

  private rulesLines(): Txt[] {
    return [1, 2, 3, 4, 5].map((i) => ({ k: `m.hotline.rule${i}` }));
  }

  /** Banner, caller and timer numbers, and the valid controls only. Only while the local player stands here. */
  private showHud(call: PhoneCallState | null): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const now = this.now();
    const mine = call !== null && canAnswer(call.target, this.selfId);
    const ctrl: HudControl[] = [];
    const nums: HudNumber[] = [];
    let key = '';
    sh.goal({ k: 'm.hotline.goal' });

    if (!call) {
      sh.state({ k: 'm.hotline.stQuiet' }, 'neutral', { k: 'm.hotline.stQuietSub' });
      key = 'idle';
    } else if (call.answeredBy === null) {
      const left = Math.max(0, Math.ceil(this.ringSeconds(call) - (now - call.ringingSince) / 1000));
      if (mine) sh.state({ k: 'm.hotline.stRing' }, 'warn', { k: 'm.hotline.stRingSub', v: { n: left } });
      else sh.state({ k: 'm.hotline.stRingOther' }, 'neutral', { k: 'm.hotline.stRingOtherSub' });
      nums.push({ label: { k: 'm.hotline.nCaller' }, value: targetLabel(call.target, this.t('all')), tone: 'cyan' });
      nums.push({ label: { k: 'm.hotline.nRing' }, value: `${left}s`, tone: left <= 3 ? 'bad' : 'warn' });
      if (mine) ctrl.push({ key: this.k('primary'), label: { k: 'm.hotline.cPick' }, action: 'primary', primary: true });
      key = `ring|${mine ? left : 'no'}`;
    } else if (call.answeredBy === this.selfId) {
      const n = choiceCount(call.options);
      const left = this.timerState ? choiceSecondsLeft(this.timerState.until, now) : 0;
      sh.state({ k: 'm.hotline.stChoose' }, 'good', { k: 'm.hotline.stChooseSub' });
      nums.push({ label: { k: 'm.hotline.nTime' }, value: `${left}s`, tone: left <= 3 ? 'bad' : 'gold' });
      nums.push({ label: { k: 'm.hotline.nCaller' }, value: targetLabel(call.target, this.t('all')), tone: 'cyan' });
      for (let i = 0; i < n; i++) {
        const o = parseOption(call.options[i] ?? '');
        ctrl.push({
          key: this.k(`n${i + 1}` as MachineAction), label: { k: offerKeys(o.key).name, v: resolveVars(o.vars, (k) => tr(k)) },
          action: `n${i + 1}`, primary: i === 0,
        });
      }
      key = `ans|${n}|${left}`;
    } else {
      sh.state({ k: 'm.hotline.stBusy' }, 'cyan', { k: 'm.hotline.stBusySub' });
      key = 'busy';
    }

    if (key === this.hudKey) return;             // only redraw when a number or a control changed
    this.hudKey = key;
    sh.numbers(nums);
    ctrl.push({ key: this.k('help'), label: { k: 'm.hotline.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.hotline.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

