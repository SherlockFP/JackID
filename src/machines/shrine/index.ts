/**
 * Moth Shrine (`shrine`, system, PAR-SHRINE, from Night 4) — light a candle for a blessing or a curse (GDD §3.8.5).
 * rules.ts decides the price, the once-per-Watch gate and the omen (seeded by run seed, player, Night, Watch and candle
 * count, so every peer agrees). The coins and the buff move through `run.spend` / `run.buffs.add` in the credit step.
 * The candle count and the per-player Watch gate are machine state, snapshotted for late joiners.
 *
 * Controls (seated): Space/Enter LIGHT a candle · E stands up. One candle per player per Watch.
 * `present()` runs on every peer: a flame catches, the moth flaps, the omen flashes in gold or violet.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { PlayerId } from '@/core/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtNum } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, CANDLES, FLAME, type ShrineParts } from './model';
import {
  CANDLE_CAP, applyLight, blessOdds, canLight, priceNow, rollOmen, watchKey, type LightCheck, type ShrineState,
} from './rules';

type Ev =
  /** A candle lit (`ok`) or refused (`why`). `buffId` and `kind` are the omen; `lit` is the count after this candle. */
  | { k: 'light'; pid: PlayerId; ok: boolean; why: string; kind: 'blessing' | 'curse' | ''; buffId: string; cost: number; lit: number; key: string };

const GOLD = 0xffd040;
const TEAL = 0x60ffd0;
const VIOLET = 0x8040ff;

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
  tags: ['system', 'shrine', 'blessing', 'curse'],
  modHooks: {},
  strings: {
    en: {
      name: 'Moth Shrine',
      desc: 'Light a candle for the moth. Seven times in ten it blesses you. Otherwise it takes its due. One candle per Watch.',
    },
    tr: {
      name: 'Güve Tapınağı',
      desc: 'Güve için bir mum yak. Her on kerenin yedisinde kutsar. Diğerlerinde hakkını alır. Watch başına bir mum.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Shrine extends MachineBase<ShrineParts, Ev, ShrineState> {
  private st: ShrineState = { lit: 0, watch: {} };
  private repaintKey = '';
  private hudKey = '';

  protected createModel(kit: KitX): MachineModel<ShrineParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh(true);
    this.attractor.every('ember', 5, () => this.ctx.fx.glow(this.model.anchors.light, FLAME, 0.3, 0.6), { first: 2 });
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
    const { flames, moth, wings } = this.parts;
    for (let i = 0; i < CANDLES; i++) {
      const f = flames[i];
      if (!f || !f.visible) continue;
      f.scale.y = 1 + 0.18 * Math.sin(t * 17 + i * 1.7);
    }
    const flap = Math.sin(t * 1.4) * 0.05;
    wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * flap; });
    moth.position.y = 1.55 + Math.sin(t * 0.9) * 0.01;
  }

  attract(dt: number): void { this.attractor.update(dt); }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
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
    if (e.action === 'primary' || e.action === 'confirm') this.light();
  }

  /** Refusals are checked here; the coins and the buff move in the credit step. */
  private light(): void {
    const run = this.ctx.run;
    const pid = this.selfId;
    const check: LightCheck = canLight(this.st, run, pid);
    const cost = priceNow(run, pid);
    if (check !== 'ok') {
      void this.emit({ k: 'light', pid, ok: false, why: check, kind: '', buffId: '', cost, lit: this.st.lit, key: '' });
      return;
    }
    const key = this.watchNow();
    const omen = rollOmen(run.seed, pid, key, this.st.lit, blessOdds(run, pid));
    const lit = this.st.lit + 1;
    void this.emit(
      { k: 'light', pid, ok: true, why: '', kind: omen.kind, buffId: omen.buffId, cost, lit, key },
      () => {
        if (!applyLight(run, pid, omen.buffId, cost)) this.ctx.ui.toast(this.t('funds'), 'bad');
      },
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

    const { flames, wings } = this.parts;
    const fx = this.ctx.fx;
    const at = this.model.anchors.coinOut;
    const idx = (ev.lit - 1) % CANDLES;
    const flame = flames[idx] ?? null;
    const name = this.t(`${ev.kind === 'curse' ? 'cu' : 'bl'}.${ev.buffId}.n`);
    const blessing = ev.kind === 'blessing';

    // anticipation: the moth wakes, the dish takes the coins
    this.sfx('button');
    fx.coins(at, 3, { spread: 0.04, up: 0.12 });
    await this.anim(0.2, (k) => { wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * Math.sin(k * Math.PI * 4) * 0.5; }); }, 'outQuad');

    // action: the candle catches (or the flame dies blue for a curse)
    if (flame) {
      flame.visible = true;
      flame.scale.set(0.1, 0.1, 0.1);
      await this.anim(0.25, (k) => { flame.scale.setScalar(lerp(0.1, 1, k)); }, 'outCubic');
    }

    // impact: escalate by omen
    if (blessing) {
      this.sfx('win2');
      fx.flash(GOLD, 0.1, 0.25);
      fx.sparks(this.model.anchors.light, 10, GOLD);
      fx.popText(this.model.anchors.light, name, TEAL, { scale: 1.2 });
    } else {
      this.sfx('porcelainCrack');
      fx.tint(VIOLET, 0.22, 0.6);
      fx.popText(this.model.anchors.light, name, VIOLET, { scale: 1.2 });
      if (flame) {
        const f0 = flame.scale.y;
        await this.anim(0.15, (k) => { flame.scale.y = lerp(f0, 0.35, k); }, 'outQuad');
        await this.anim(0.2, (k) => { flame.scale.y = lerp(0.35, f0, k); }, 'outQuad');
      }
    }

    // follow-through: the wings settle, the shelf repaints
    await this.anim(0.25, (k) => { wings.forEach((w, i) => { w.rotation.z = lerp((i ? 1 : -1) * 0.5, 0, k); }); }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const run = this.ctx.run;
    const pid = this.selfId;
    const key = [this.st.lit, this.st.watch[String(pid)] ?? '', this.watchNow(), run.balance('coin', pid), run.shift.state().stake].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    for (let i = 0; i < CANDLES; i++) {
      const f = this.parts.flames[i];
      if (f) f.visible = this.st.lit > i;
    }
    this.parts.price.setText(fmtNum(priceNow(run, pid)));
    if (this.isLocalOccupant) this.showHud();
  }

  private showHud(): void {
    const run = this.ctx.run;
    const pid = this.selfId;
    const check = canLight(this.st, run, pid);
    const key = [this.st.lit, check, run.balance('coin', pid)].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const hints: HudHint[] = [
      { action: 'primary', label: this.t('h_light') },
      { action: 'exit', label: this.t('h_leave') },
    ];
    const odds = Math.round(blessOdds(run, pid) * 100);
    this.hud({
      bet: null,
      hints,
      stats: [
        { label: this.t('s_coins'), value: fmtNum(run.balance('coin', pid)) },
        { label: this.t('s_cost'), value: fmtNum(priceNow(run, pid)) },
        { label: this.t('s_odds'), value: `${odds} / ${100 - odds}` },
        { label: this.t('s_lit'), value: `${this.st.lit}/${CANDLE_CAP}` },
      ],
    });
  }
}
