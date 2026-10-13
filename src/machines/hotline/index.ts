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
 * Controls (seated): Space/Enter pick up · 1 / 2 / 3 choose an option (within 8 s of the pick-up) · E stands up.
 * Hang-up is not in RunApi yet, so leaving only stands you up; the game resolves an unanswered call on its own clock.
 *
 * Subtitles and the caller's voice belong to game-hotline (its own overlay); the booth only plays the bell, the lamp
 * and the handset.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import type { PhoneCallState } from '@/net/protocol';
import type { HeadlessPlay } from '@/game/types';
import { t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, type HotlineParts } from './model';
import {
  ANSWER_S, RING_TOTAL_S, canAnswer, choiceCount, choiceFromAction, choiceSecondsLeft, ringIndex, ringState, targetLabel,
} from './rules';

type Ev =
  /** The local occupant picked up the handset (choices open for `ANSWER_S` after `until`). */
  | { k: 'pick'; until: number }
  /** A choice was made. `label` is the option's i18n key, already resolved to text on the sender. */
  | { k: 'choose'; i: number; label: string };

const GOLD = 0xffd040;
const LIFT_RAISE = 0.14, LIFT_FORWARD = 0.18;

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
    },
    tr: {
      name: 'Hat Telefonu',
      desc: 'Ahşap kabinde kırmızı bir telefon. Biri senden bir şey istediğinde çalar.',
      h_pick: 'AÇ', h_choose: 'SEÇ', h_leave: 'AYRIL', all: 'HEPSİ',
      s_ring: 'ÇALIYOR', s_choose: 'SEÇ', s_busy: 'HATTA', s_notYou: 'SANA DEĞİL',
      notYou: 'Bu çağrı sana ait değil.', ringing: 'TRIN TRIN', choice: 'SEÇENEK {n}',
    },
  },
};

/** System devices never wager: staff do not play them (TECH_SPEC §11.5 export; no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Hotline extends MachineBase<HotlineParts, Ev, null> {
  private callId = -1;             // id of the call the booth last saw (-1 = none)
  private lastRing = -1;           // ring cycle index whose bell already sounded
  private handsetUp = false;
  private restPos = new THREE.Vector3();
  private restRot = new THREE.Euler();
  private shownTarget = '';
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<HotlineParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.restPos.copy(this.parts.handset.position);
    this.restRot.copy(this.parts.handset.rotation);
    this.parts.lamp.setOn(false);
    this.parts.target.set('--');
    this.attractor.every('tick', 6, () => this.ctx.fx.glow(this.parts.lamp.root, 0xffd34a, 0.3, 0.5), { first: 3 });
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
    }

    if (call && call.answeredBy === null) {
      const el = (this.now() - call.ringingSince) / 1000;
      const r = ringState(el);
      this.parts.lamp.setOn(r.on);
      const idx = ringIndex(el);
      if (r.on && idx !== this.lastRing) { this.lastRing = idx; this.sfx('phoneRing'); }
    } else {
      this.parts.lamp.setOn(false);
    }

    const target = call ? targetLabel(call.target, this.t('all')) : '--';
    if (target !== this.shownTarget) { this.shownTarget = target; this.parts.target.set(target.padStart(2)); }

    if (this.isLocalOccupant) this.showHud(call);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.sfx('chime'); this.hudKey = ''; this.showHud(this.ctx.run.phone()); }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.ctx.ui.machineHud(null); this.hudKey = ''; }
  }

  onLang(): void {
    this.shownTarget = '';
    this.hudKey = '';
    if (this.isLocalOccupant) this.showHud(this.ctx.run.phone());
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down || e.repeat) return;
    const call = this.ctx.run.phone();
    if (e.action === 'primary' || e.action === 'confirm') {
      if (!call || call.answeredBy !== null) return;
      if (!canAnswer(call.target, this.selfId)) { this.toast(this.t('notYou'), 'warn'); this.sfx('error'); return; }
      this.ctx.run.answerPhone(-1);
      void this.emit({ k: 'pick', until: this.now() + ANSWER_S * 1000 });
      return;
    }
    const idx = choiceFromAction(e.action);
    if (idx < 0) return;
    if (!call || call.answeredBy !== this.selfId || idx >= choiceCount(call.options)) { this.sfx('error'); return; }
    const label = tr(call.options[idx] ?? '');
    this.ctx.run.answerPhone(idx);
    void this.emit({ k: 'choose', i: idx, label });
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

  // ── HUD ─────────────────────────────────────────────────────────────────────────────────────────
  private showHud(call: PhoneCallState | null): void {
    const now = this.now();
    let hints: HudHint[] = [];
    let stats: Array<{ label: string; value: string }> = [];
    let key = '';

    if (!call) {
      hints = [{ action: 'exit', label: this.t('h_leave') }];
      key = 'idle';
    } else if (call.answeredBy === null) {
      const el = (now - call.ringingSince) / 1000;
      const left = Math.max(0, Math.ceil(RING_TOTAL_S - el));
      hints = canAnswer(call.target, this.selfId)
        ? [{ action: 'primary', label: this.t('h_pick') }, { action: 'exit', label: this.t('h_leave') }]
        : [{ action: 'exit', label: this.t('h_leave') }];
      stats = [{ label: this.t('s_ring'), value: canAnswer(call.target, this.selfId) ? `${left}s` : this.t('s_notYou') }];
      key = `ring|${canAnswer(call.target, this.selfId) ? left : 'no'}`;
    } else if (call.answeredBy === this.selfId) {
      const n = choiceCount(call.options);
      const left = this.timerState ? choiceSecondsLeft(this.timerState.until, now) : 0;
      hints = [];
      for (let i = 0; i < n; i++) hints.push({ action: `n${i + 1}` as HudHint['action'], label: tr(call.options[i] ?? '') });
      hints.push({ action: 'exit', label: this.t('h_leave') });
      stats = [{ label: this.t('s_choose'), value: `${left}s` }];
      key = `ans|${n}|${left}`;
    } else {
      hints = [{ action: 'exit', label: this.t('h_leave') }];
      stats = [{ label: this.t('s_busy'), value: '' }];
      key = 'busy';
    }

    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud({ bet: null, hints, stats });
  }
}

