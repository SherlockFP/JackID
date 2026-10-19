/**
 * Moth Shrine (`shrine`, system, PAR-SHRINE, Parlour) — light a candle, pick a statue, raise that owner's Favour (docs/BLESSINGS.md §2.2).
 * rules.ts decides the price and the once-per-Watch gate. The coins move through `run.spend` and the Favour through the
 * `shrine:favour` bus event in the credit step. The candle count and the per-player Watch gate are machine state, snapshotted
 * for late joiners. A statue at Favour 3 weeps wax (read from the run, drawn by every peer).
 *
 * Controls (seated): Space/Enter LIGHT a candle, then 1-4 (or Left/Right and Space) pick the statue, SECONDARY goes back ·
 * E stands up. One candle per player per Watch.
 * `present()` runs on every peer: a flame catches, the moth flaps, the chosen statue sparks in its colour.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { PlayerId } from '@/core/types';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import type { GodId } from '@/game/pantheon';
import { buildModel, CANDLES, FLAME, STATUE_COLOR, type ShrineParts } from './model';
import {
  CANDLE_CAP, FAVOUR_MAX, STATUES, applyLight, canLight, favourOf, priceNow, watchKey, type LightCheck, type ShrineState,
} from './rules';

type Ev =
  /** A candle lit at a statue (`ok`, `god`) or refused (`why`). `lit` is the candle count after this candle. */
  | { k: 'light'; pid: PlayerId; ok: boolean; why: string; god: GodId | ''; cost: number; lit: number; key: string };

const GOLD = 0xffd040;
const WAX = 0xf0e8d0;
/** A marked statue rises this far (m) while the player is picking. */
const LIFT_M = 0.025;
/** Where a statue stands: the shelf top (model.ts SHELF_Y + 0.025). */
const SHELF_TOP = 1.045;

export const def: MachineDef = {
  id: 'shrine',
  category: 'system',
  slotSize: 'S',
  zone: 'parlour',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'shrine', 'favour'],
  modHooks: {},
  strings: {
    en: {
      name: 'Moth Shrine',
      desc: 'Light a candle, then pick a statue of the owners. Its Favour goes up by one. One candle per Watch.',
    },
    tr: {
      name: 'Güve Tapınağı',
      desc: 'Bir mum yak, sonra sahiplerin heykellerinden birini seç. Teveccühü bir artar. Vardiya başına bir mum.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Shrine extends MachineBase<ShrineParts, Ev, ShrineState> {
  private st: ShrineState = { lit: 0, watch: {} };
  private repaintKey = '';
  private hudKey = '';
  /** Local only: the candle is chosen and the statue is being picked (nothing is paid until the pick). `aim` is the marked statue. */
  private choosing = false;
  private aim = 0;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<ShrineParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.refresh(true);
    this.attractor.every('ember', 5, () => this.ctx.fx.glow(this.model.anchors.light, FLAME, 0.3, 0.6), { first: 2 });
    this.attractor.every('wax', 3, () => {                 // a statue at Favour 3 drips wax
      this.parts.drips.forEach((d, i) => { if (d.visible) this.ctx.fx.sparks(this.parts.statues[i], 2, WAX); });
    }, { first: 1 });
  }

  // ── state (every peer; snapshotted) ─────────────────────────────────────────────────────────────
  getSnapshot(_forPid?: PlayerId): ShrineState {
    return { lit: this.st.lit, watch: { ...this.st.watch } };
  }

  applySnapshot(s: ShrineState): void {
    this.st = { lit: s.lit, watch: { ...s.watch } };
    this.repaintKey = '';
    this.refresh(true);
  }

  private watchNow(): string {
    return watchKey(this.ctx.run.night(), this.ctx.run.shift.state().segment?.index ?? 0);
  }

  tick(): void { this.refresh(false); }

  frame(dt: number, t: number): void {
    const { flames, moth, wings, statues, drips } = this.parts;
    for (let i = 0; i < CANDLES; i++) {
      const f = flames[i];
      if (!f || !f.visible) continue;
      f.scale.y = 1 + 0.18 * Math.sin(t * 17 + i * 1.7);
    }
    statues.forEach((s, i) => {
      const want = SHELF_TOP + (this.choosing && this.isLocalOccupant && i === this.aim ? LIFT_M : 0);
      s.position.y += (want - s.position.y) * Math.min(1, dt * 12);
      const d = drips[i];
      if (d?.visible) d.scale.y = 0.7 + 0.3 * Math.sin(t * 1.3 + i);   // the wax runs and gathers
    });
    const flap = Math.sin(t * 1.4) * 0.05;
    wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * flap; });
    moth.position.y = 1.55 + Math.sin(t * 0.9) * 0.01;
  }

  attract(dt: number): void { this.attractor.update(dt); }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.refresh(true);
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.seatHud?.hide(); this.hudKey = ''; this.choosing = false; }
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
    if (this.choosing) { this.onPick(e.action); return; }
    if (e.action === 'primary' || e.action === 'confirm') this.light();
  }

  /** The statue step: 1-4 pick at once, Left/Right move the mark, PRIMARY takes the marked one, SECONDARY goes back. */
  private onPick(a: MachineAction): void {
    const n = ['n1', 'n2', 'n3', 'n4'].indexOf(a);
    if (n >= 0) this.choose(n);
    else if (a === 'primary' || a === 'confirm') this.choose(this.aim);
    else if (a === 'left' || a === 'right') {
      this.aim = (this.aim + (a === 'left' ? STATUES.length - 1 : 1)) % STATUES.length;
      this.refresh(true);
    } else if (a === 'secondary') { this.choosing = false; this.refresh(true); }
  }

  /** The candle: refusals are checked here, then the player picks a statue. Nothing is paid yet. */
  private light(): void {
    const run = this.ctx.run;
    const check: LightCheck = canLight(this.st, run, this.selfId);
    if (check !== 'ok') { this.deny(check); return; }
    this.choosing = true;
    this.aim = Math.max(0, STATUES.findIndex((g) => favourOf(run, g) < FAVOUR_MAX));
    this.refresh(true);
  }

  private deny(why: string): void {
    void this.emit({ k: 'light', pid: this.selfId, ok: false, why, god: '', cost: priceNow(this.ctx.run, this.selfId), lit: this.st.lit, key: '' });
  }

  /** The pick: the coins and the Favour move in the credit step. */
  private choose(i: number): void {
    const run = this.ctx.run;
    const pid = this.selfId;
    const god = STATUES[i];
    this.choosing = false;
    this.refresh(true);
    const check = canLight(this.st, run, pid);
    if (check !== 'ok') { this.deny(check); return; }
    if (favourOf(run, god) >= FAVOUR_MAX) { this.deny('maxed'); return; }
    const cost = priceNow(run, pid);
    void this.emit(
      { k: 'light', pid, ok: true, why: '', god, cost, lit: this.st.lit + 1, key: this.watchNow() },
      () => { if (!applyLight(run, pid, god, cost)) this.ctx.ui.toast(this.t('funds'), 'bad'); },
    );
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    return this.presentLight(ev, pc);
  }

  private denied(why: string): void {
    this.sfx('error');
    const flame = this.parts.flames[Math.max(0, Math.min(CANDLES - 1, this.st.lit % CANDLES))];
    if (flame) {
      const x0 = flame.position.x;
      void this.anim(0.2, (k) => { flame.position.x = x0 + Math.sin(k * Math.PI * 6) * 0.01; });
    }
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentLight(ev: Extract<Ev, { k: 'light' }>, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    // state first: every peer agrees on the candle count and the Watch gate
    this.st.lit = ev.lit;
    this.st.watch[String(ev.pid)] = ev.key;
    if (pc.fast) { this.refresh(true); return; }

    const { flames, wings, statues } = this.parts;
    const fx = this.ctx.fx;
    const at = this.model.anchors.coinOut;
    const idx = (ev.lit - 1) % CANDLES;
    const flame = flames[idx] ?? null;
    const god = ev.god as GodId;
    const statue = statues[STATUES.indexOf(god)];
    const color = STATUE_COLOR[god] ?? GOLD;

    // anticipation: the moth wakes, the dish takes the coins
    this.sfx('button');
    fx.coins(at, 3, { spread: 0.04, up: 0.12 });
    await this.anim(0.2, (k) => { wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * Math.sin(k * Math.PI * 4) * 0.5; }); }, 'outQuad');

    // action: the candle catches
    if (flame) {
      flame.visible = true;
      flame.scale.set(0.1, 0.1, 0.1);
      await this.anim(0.25, (k) => { flame.scale.setScalar(lerp(0.1, 1, k)); }, 'outCubic');
    }

    // impact: the statue takes the flame in its colour; the third Favour makes it weep
    const f = Math.min(FAVOUR_MAX, favourOf(this.ctx.run, god));
    this.sfx('boonPick');
    fx.flash(color, 0.08, 0.25);
    fx.sparks(statue ?? this.model.anchors.light, 10, color);
    fx.popText(this.model.anchors.light, `${tr(`pantheon.god.${god}.name`)} ${f}/${FAVOUR_MAX}`, color, { scale: 1.2 });
    if (f >= FAVOUR_MAX) this.sfx('divineEcho');

    // follow-through: the wings settle, the shelf repaints
    await this.anim(0.25, (k) => { wings.forEach((w, i) => { w.rotation.z = lerp((i ? 1 : -1) * 0.5, 0, k); }); }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const run = this.ctx.run;
    const pid = this.selfId;
    const key = [this.st.lit, this.st.watch[String(pid)] ?? '', this.watchNow(), run.balance('coin', pid), run.shift.state().stake, STATUES.map((g) => favourOf(run, g)).join('')].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    for (let i = 0; i < CANDLES; i++) {
      const f = this.parts.flames[i];
      if (f) f.visible = this.st.lit > i;
    }
    STATUES.forEach((g, i) => { const d = this.parts.drips[i]; if (d) d.visible = favourOf(run, g) >= FAVOUR_MAX; });   // weeping wax
    this.parts.price.setText(fmtNum(priceNow(run, pid)));
    if (this.isLocalOccupant) this.showHud();
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private rulesLines(): Txt[] {
    return [1, 2, 3].map((i) => ({ k: `m.shrine.rule${i}` }));
  }

  /** Banner, coins / price numbers and the valid controls only. Only while the local player stands here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const run = this.ctx.run;
    const pid = this.selfId;
    const check = canLight(this.st, run, pid);
    const key = [this.st.lit, check, run.balance('coin', pid), this.choosing, this.aim, STATUES.map((g) => favourOf(run, g)).join('')].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const cost = priceNow(run, pid);
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.shrine.goal' });

    // STATE: can a candle be lit now, or which statue gets it
    if (this.choosing) sh.state({ k: 'm.shrine.stChoose' }, 'gold', { k: 'm.shrine.stChooseSub', v: { n: fmtNum(cost) } });
    else if (check === 'ok') sh.state({ k: 'm.shrine.stReady' }, 'gold', { k: 'm.shrine.stReadySub', v: { n: fmtNum(cost) } });
    else if (check === 'once') sh.state({ k: 'm.shrine.stOnce' }, 'cyan', { k: 'm.shrine.stOnceSub' });
    else if (check === 'funds') sh.state({ k: 'm.shrine.stFunds' }, 'warn', { k: 'm.shrine.stFundsSub', v: { n: fmtNum(Math.max(0, cost - run.balance('coin', pid))) } });
    else sh.state({ k: 'm.shrine.stFull' }, 'neutral');

    // KEY NUMBERS
    sh.numbers([
      { label: { k: 'm.shrine.nCoins' }, value: fmtNum(run.balance('coin', pid)), tone: 'gold' },
      { label: { k: 'm.shrine.nCost' }, value: fmtNum(cost), tone: check === 'funds' ? 'bad' : 'gold' },
      { label: { k: 'm.shrine.nLit' }, value: `${this.st.lit}/${CANDLE_CAP}`, tone: 'cyan' },
    ]);

    // CONTROL BAR
    if (this.choosing) {
      STATUES.forEach((g, i) => ctrl.push({
        key: this.k(`n${i + 1}` as MachineAction), action: `n${i + 1}`, primary: i === this.aim,
        label: { k: 'm.shrine.cStatue', v: { name: tr(`pantheon.god.${g}.name`), f: favourOf(run, g) } },
      }));
      ctrl.push({ key: this.k('secondary'), label: { k: 'm.shrine.cBack' }, action: 'secondary' });
    } else if (check === 'ok') ctrl.push({ key: this.k('primary'), label: { k: 'm.shrine.cLight' }, action: 'primary', primary: true });
    ctrl.push({ key: this.k('help'), label: { k: 'm.shrine.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.shrine.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
