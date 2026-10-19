/**
 * Jukebox (`jukebox`, system) — diegetic song list in the Lobby (GDD §6.9, BRIEF ADDENDUM 4). The music engine owns the
 * tracks (`audio.music.catalog()` / `play()`); rules.ts decides price, unlocks and the song buff; every ticket and buff
 * goes through `run.spend('ticket')` and `run.buffs.add()` in the credit step. Nothing here decides money.
 *
 * Controls (seated): ←/→ and ↑/↓ move the cursor over the twelve songs · 1–9 pick a song · Space/Enter PLAY (1 Ticket)
 * · RMB / R STOP (free) · E stands up. Playing the song that is already on costs nothing and stops the box.
 * `present()` runs on every peer: the song starts for the whole room, the vinyl spins up, the keys sink.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { HeadlessPlay } from '@/game/types';
import type { JukeboxTrack } from '@/core/audio/types';
import type { BindingKey, MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtNum, t as tr } from '@/core/i18n';
import { lerp } from '@/core/math';
import { buildModel, GLOW, KEY_SINK, type JukeboxParts } from './model';
import { SONG_PRICE, applyPlay, clearSong, moveCursor, playCheck, songRows, type SongRow } from './rules';

type Ev =
  /** A play (`id`) or a refusal (`ok:false`, `why` names it). `stop` = the box was turned off. */
  | { k: 'play'; i: number; id: string; ok: boolean; why: string }
  | { k: 'stop'; ok: boolean };

const GOLD = 0xffd040;
const TEAL = 0x60ffd0;
const RED = 0xff4040;

export const def: MachineDef = {
  id: 'jukebox',
  category: 'system',
  slotSize: 'M',
  zone: 'services',
  seats: 1,
  shared: false,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1,
  tier: 0,
  actionCost: 0,
  tags: ['system', 'music', 'jukebox'],
  modHooks: {},
  strings: {
    en: {
      name: 'Jukebox',
      desc: 'Twelve songs behind the glass. One Ticket buys a tune for the rest of the Watch. One song at a time.',
    },
    tr: {
      name: 'Jukebox',
      desc: 'Camın arkasında on iki şarkı. Bir bilet, Watch’ın geri kalanı için bir parça alır. Aynı anda tek şarkı.',
    },
  },
};

/** System devices never wager: staff do not play them (no-op). */
export const playHeadless: HeadlessPlay = () => ({ gross: 0, tags: [] });

export default class Jukebox extends MachineBase<JukeboxParts, Ev, null> {
  private cursor = 0;
  private catalog: readonly JukeboxTrack[] = [];
  private repaintKey = '';
  private hudKey = '';
  private spin = 0;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<JukeboxParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.ctx.ui.machineHud(null);                          // the seat HUD replaces the generic bottom bar
    this.catalog = this.ctx.audio.music.catalog();
    this.refresh(true);
    this.attractor.every('glow', 8, () => this.ctx.fx.glow(this.model.anchors.light, GLOW, 0.3, 0.5), { first: 4 });
  }

  // ── run state (every peer) ──────────────────────────────────────────────────────────────────────
  private rows(): SongRow[] {
    return songRows(this.catalog, this.ctx.run, this.ctx.audio.music.current);
  }
  private wallet(): number { return this.ctx.run.balance('ticket', this.selfId); }

  tick(): void {
    this.refresh(false);
  }

  frame(dt: number, t: number): void {
    const playing = this.ctx.audio.music.current !== null;
    this.spin += dt * (playing ? 4.2 : 0);
    this.parts.spinner.rotation.z = this.spin;
    const pulse = playing ? 1 + 0.04 * Math.sin(t * 6.0) : 1;
    for (const tb of this.parts.tubes) tb.scale.y = pulse;
  }

  attract(dt: number): void {
    this.attractor.update(dt);
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.cursor = 0;
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.refresh(true);
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.seatHud?.hide(); this.hudKey = ''; }
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
    const n = this.catalog.length;
    switch (e.action) {
      case 'left': this.moveTo(moveCursor(this.cursor, n, -1, 0)); return;
      case 'right': this.moveTo(moveCursor(this.cursor, n, 1, 0)); return;
      case 'up': this.moveTo(moveCursor(this.cursor, n, 0, -1)); return;
      case 'down': this.moveTo(moveCursor(this.cursor, n, 0, 1)); return;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': case 'n7': case 'n8': case 'n9':
        if (Number(e.action.slice(1)) - 1 < n) this.moveTo(Number(e.action.slice(1)) - 1);
        return;
      case 'primary': case 'confirm': this.play(this.cursor); return;
      case 'secondary': this.stop(); return;
    }
  }

  private moveTo(i: number): void {
    this.cursor = i;
    this.sfx('hover');
    this.refresh(true);
  }

  /** Pressing a song: refusals are checked here; the ticket and the buff move in the credit step. */
  private play(i: number): void {
    const row = this.rows()[i] ?? null;
    const check = playCheck(row, this.ctx.run, this.selfId);
    if (check === 'stop') { this.stop(); return; }
    if (check !== 'ok' || !row) { void this.emit({ k: 'play', i, id: '', ok: false, why: check }); return; }
    const track = row.track;
    void this.emit({ k: 'play', i, id: track.id, ok: true, why: '' }, () => {
      if (!applyPlay(this.ctx.run, this.selfId, track)) this.ctx.ui.toast(this.t('funds'), 'bad');
    });
  }

  /** Turns the box off. Free, and only meaningful when something is playing. */
  private stop(): void {
    if (this.ctx.audio.music.current === null) return;
    void this.emit({ k: 'stop', ok: true }, () => clearSong(this.ctx.run, this.selfId));
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'stop') {
      this.ctx.audio.music.stop(0.8);
      if (!pc.fast) { this.sfx('button'); this.refresh(true); }
      return;
    }
    return this.presentPlay(ev, pc);
  }

  private denied(why: string): void {
    this.sfx('error');
    const keys = this.parts.keys;
    const k = keys[this.cursor];
    if (k) {
      const x0 = k.position.x;
      void this.anim(0.2, (u) => { k.position.x = x0 + Math.sin(u * Math.PI * 6) * 0.012; });
    }
    if (this.isLocalOccupant && why) this.toast(this.t(why), 'warn');
  }

  private async presentPlay(ev: Extract<Ev, { k: 'play' }>, pc: PresentCtx): Promise<void> {
    if (!ev.ok) { this.denied(ev.why); return; }
    const track = this.catalog.find((c) => c.id === ev.id) ?? null;
    if (!track) return;
    this.ctx.audio.music.play(track.id, { fade: 1.2 });
    if (pc.fast) { this.refresh(true); return; }

    const key = this.parts.keys[ev.i] ?? null;
    const fx = this.ctx.fx;
    const at = key ?? this.model.anchors.coinOut;
    const title = tr(track.titleKey);

    // anticipation: the key sinks a little, the vinyl winds up
    this.sfx('button');
    const y0 = key ? key.position.y : 0;
    await this.anim(0.1, (k) => { if (key) key.position.y = lerp(y0, y0 - KEY_SINK, k); }, 'outQuad');

    // action: the needle drops, the coins clink into the slot
    this.sfx('cashRegister');
    fx.coins(this.model.anchors.coinOut, 2, { spread: 0.05, up: 0.15 });

    // impact: the song name flies out; buff-carrying songs flash their genre colour
    this.sfx('stamp');
    fx.popText(at, title, TEAL, { scale: 1.1 });
    if (track.genre === 'carnival' || track.genre === 'music-box') fx.tint(0x8040ff, 0.15, 0.5);
    else fx.flash(GOLD, 0.08, 0.2);

    // follow-through: the key springs back, the list repaints
    await this.anim(0.2, (k) => { if (key) key.position.y = lerp(y0 - KEY_SINK, y0, k); }, 'outQuad');
    this.refresh(true);
  }

  // ── screen and HUD ──────────────────────────────────────────────────────────────────────────────
  private refresh(force: boolean): void {
    const rows = this.rows();
    const current = this.ctx.audio.music.current ?? '';
    const key = [current, this.cursor, this.wallet(), rows.map((r) => (r.locked ? 'L' : 'o')).join('')].join('|');
    if (!force && key === this.repaintKey) { if (this.isLocalOccupant) this.showHud(); return; }
    this.repaintKey = key;
    this.drawScreen(rows);
    if (this.isLocalOccupant) this.showHud();
  }

  private drawScreen(rows: readonly SongRow[]): void {
    const s = this.parts.screen;
    s.clear('#140a06');
    s.text(this.t('ledger'), 64, 2, { font: 'px5', color: '#ffb070', align: 'center' });
    rows.forEach((r, i) => {
      const y = 12 + i * 7;
      const mark = i === this.cursor ? '>' : ' ';
      const name = r.locked ? this.t('locked') : tr(r.track.titleKey).slice(0, 17);
      const color = r.playing ? '#ffe0a0' : r.locked ? '#6a5040' : '#ffc8a0';
      s.text(`${mark}${i + 1} ${name}`, 2, y, { font: 'px5', color });
      if (r.playing) s.text('>>', 124, y, { font: 'px5', color: '#60ffd0', align: 'right' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  /** The key bound to a general action (arrows, help, exit). */
  private g(a: BindingKey): string { return this.ctx.input.keyLabel(a); }

  private rulesLines(): Txt[] {
    return [1, 2, 3].map((i) => ({ k: `m.jukebox.rule${i}` }));
  }

  /** Banner, tickets / song numbers and the valid controls only. Only while the local player stands here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const rows = this.rows();
    const sel = rows[this.cursor] ?? null;
    const key = [this.cursor, this.wallet(), this.ctx.audio.music.current ?? '', sel?.track.id ?? ''].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const ctrl: HudControl[] = [];
    const now = this.ctx.audio.music.current;
    const playingTitle = now ? tr(this.catalog.find((c) => c.id === now)?.titleKey ?? now) : null;
    const check = playCheck(sel, this.ctx.run, this.selfId);
    sh.goal({ k: 'm.jukebox.goal' });

    // STATE
    if (sel && check === 'funds') sh.state({ k: 'm.jukebox.stFunds' }, 'warn', { k: 'm.jukebox.stFundsSub', v: { n: SONG_PRICE } });
    else if (sel && check === 'locked') sh.state({ k: 'm.jukebox.stLocked' }, 'warn', { k: 'm.jukebox.stLockedSub' });
    else if (playingTitle) sh.state({ k: 'm.jukebox.stPlaying' }, 'cyan', playingTitle);
    else sh.state({ k: 'm.jukebox.stPick' }, 'gold', { k: 'm.jukebox.stPickSub', v: { n: SONG_PRICE } });

    // KEY NUMBERS
    sh.numbers([
      { label: { k: 'm.jukebox.nTickets' }, value: fmtNum(this.wallet()), tone: 'gold' },
      { label: { k: 'm.jukebox.nPrice' }, value: fmtNum(SONG_PRICE), tone: 'neutral' },
      { label: { k: 'm.jukebox.nNow' }, value: playingTitle ?? { k: 'm.jukebox.off' }, tone: 'cyan' },
      { label: { k: 'm.jukebox.nSelected' }, value: sel ? tr(sel.track.titleKey) : '--', tone: 'neutral' },
    ]);

    // CONTROL BAR: only what is valid right now
    if (rows.length > 1) {
      ctrl.push({ key: `${this.g('left')}/${this.g('right')}`, label: { k: 'm.jukebox.cMove' }, action: 'left' });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n9')}`, label: { k: 'm.jukebox.cPick' }, action: 'n1' });
    }
    if (check === 'ok') ctrl.push({ key: this.k('primary'), label: { k: 'm.jukebox.cPlay' }, action: 'primary', primary: true });
    if (now !== null) ctrl.push({ key: this.k('secondary'), label: { k: 'm.jukebox.cStop' }, action: 'secondary' });
    ctrl.push({ key: this.g('help'), label: { k: 'm.jukebox.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.jukebox.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
