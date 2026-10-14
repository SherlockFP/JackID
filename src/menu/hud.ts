/**
 * In-game HUD (GDD §10.1–§10.4, ART §10). Owner: HUD lane.
 *
 * `createHud()` mounts a DOM layer into `app.ui.hudLayer` (UIOverlayX). The state that runs a Night (InGame) creates it on
 * enter, calls `update(dt)` every frame and `dispose()` on exit. Everything reads the run facade (`app.run`) when it exists
 * and shows neutral values otherwise; live changes arrive through the event bus (pops, feed lines, phone, charms).
 *
 * Juice: wallet counter rolls 30 ticks/s; gains fly as numbers into the wallet anchor and bump it; spends flash red; big
 * results add hit-stop and a feed line; Last Call runs a banner and blinks the clock.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus, type GameEvents } from '@/core/events';
import { fmtCoins, has, t } from '@/core/i18n';
import type { Action } from '@/core/input/types';
import type { HudAnchorId } from '@/core/ui/types';
import { claimAnnounce, type UIOverlayX } from '@/core/ui/ui';
import { COLORS, h, uiSfx } from '@/core/ui/widgets';
import { circuitView, type LampEntry, type LampView } from '@/game/circuit';
import { WIN_TIERS, type BuffState, type CharmState, type WinTier } from '@/game/types';
import type { PlayerId } from '@/core/types';
import { initial, mmss, Roller, signed, wallClock } from './hud/fmt';
import { createProcPops, goldBurst, pegBadge, playProcTick } from './hud/charmProc';
import './hud/hud.css';
import { nightPaid } from '@/machines/debt_terminal/night';
import { SeatHud } from '@/machines/_base/seatHud';

const PHONE_SECONDS = 10;
const FEED_LIFE = 6;
const FEED_MAX = 4;
const BUFF_REFRESH_S = 0.25;

export interface HudPrompt { action: Action; label: string; sub?: string }

export interface Hud {
  readonly el: HTMLElement;
  /** Per-frame: rolling values, clock, timers, feed fade. Cheap: DOM is written only on change. */
  update(dt: number): void;
  setVisible(on: boolean): void;
  /** Interact prompt (GDD §10.1 "[E] …" line). Pass null to clear. */
  setPrompt(p: HudPrompt | null): void;
  dispose(): void;
}

const self = (): PlayerId => app.run?.selfId ?? 0;
const ui = (): UIOverlayX => app.ui as UIOverlayX;
const coinSym = (): string => t('common.coinSuffix').trim();
const money = (n: number): string => fmtCoins(n);
const hexCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const machineName = (id: string): string => (has(`machine.${id}.name`) ? t(`machine.${id}.name`) : id);
const tierIndex = (tier: WinTier): number => WIN_TIERS.indexOf(tier);
const SMALL = WIN_TIERS.indexOf('small');
const BIG = WIN_TIERS.indexOf('big');
const HUGE = WIN_TIERS.indexOf('huge');
/** A tier's win pop is scaled by this many ms after its machine:result (the payout follows it in the same tick). */
const WIN_LINK_MS = 600;

function setText(el: HTMLElement, s: string): void { if (el.textContent !== s) el.textContent = s; }
function setCls(el: HTMLElement, cls: string, on: boolean): void { el.classList.toggle(cls, on); }

/** Screen point where the big numbers start (centre, a little above the middle). */
function popOrigin(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };
}

export function createHud(): Hud {
  const root = h('div', 'hud');
  ui().hudLayer.appendChild(root);
  const disposers: Array<() => void> = [];
  const on = <K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void): void => {
    disposers.push(bus.on(type, fn));
  };
  // The seat HUD's STAKE / POCKET readout reads the local player and pocket from the run while this HUD is up.
  SeatHud.stakeSource = () => {
    const r = app.run;
    return r ? { self: r.selfId, pocket: r.wallet(r.selfId) } : { self: -1, pocket: 0 };
  };

  // The top band is a three-column grid (left | centre | right), so the centre clock never overlaps the corner blocks.
  const top = h('div', 'hud-top', root);
  const topL = h('div', 'hud-tl', top);
  const topC = h('div', 'hud-tc', top);
  const topR = h('div', 'hud-tr', top);
  // The seat HUD's state banner and tooltip stack under this band: it reads `--hud-top-h` (seatHud.css) from the #ui root.
  const host = ui().hudLayer.parentElement;
  const setTopH = (): void => { host?.style.setProperty('--hud-top-h', `${top.offsetTop + top.offsetHeight}px`); };
  const topRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setTopH) : null;
  topRo?.observe(top);
  setTopH();

  // ── top-left: pocket, tickets, staff ────────────────────────────────────────────────────────────
  const wallet = h('div', 'hb wallet', topL);
  const walletNum = h('span', 'num', wallet, `${coinSym()} 0`);
  const tix = h('div', 'hb tix', topL);
  h('span', 'lbl', tix, t('hud.tickets'));
  const tixNum = h('span', 'num', tix, '0');
  const staff = h('div', 'hb staff hidden', topL);
  const roll = new Roller();
  let walletSeen = false;
  let walletFlash = 0;

  // ── top-centre: clock + night line ──────────────────────────────────────────────────────────────
  const clock = h('div', 'clock', topC);
  const clockNum = h('span', 'num', clock, '00:00');
  const clockPhase = h('span', 'phase', clock, '');
  const sub = h('div', 'sub', topC);
  const night = h('span', 'night', sub, '');
  const clockWall = h('span', 'wall', sub, '');
  // THE CIRCUIT: the Watch's Hot / Cold Lamps, shown while walking the floor
  const lampsEl = h('div', 'lamps hidden', topC);
  const lampHot = h('span', 'hot', lampsEl);
  const lampCold = h('span', 'cold', lampsEl);
  let lampsSeen: LampView = { hot: [], cold: [] };
  let seated = false;

  // ── top-right: quota ────────────────────────────────────────────────────────────────────────────
  const quota = h('div', 'hb quota', topR);
  const quotaNum = h('span', 'num', quota, '0 / 0');
  const quotaBar = h('div', 'bar', quota);
  const quotaFill = h('i', '', quotaBar);
  const quotaShort = h('span', 'short', quota, '');

  // ── right edge: buffs ───────────────────────────────────────────────────────────────────────────
  const buffs = h('div', 'hb buffs', root);
  let buffKey = '';
  let buffTimers: Array<{ el: HTMLElement; b: BuffState; color: string }> = [];
  let buffIds = new Set<string>();
  let buffRefresh = 0;

  // ── bottom: pulls tokens, charms ───────────────────────────────────────────────
  const pulls = h('div', 'hb pulls', root);
  h('span', 'lbl', pulls, t('hud.pulls'));
  const tokens = h('div', 'tokens', pulls);
  let pullsPeak = 0;
  let pullsKey = '';
  const charms = h('div', 'hb charms', root);
  const charmRow = h('div', 'charm-row', charms);
  let charmKey = '';
  let pegs: Array<{ face: HTMLElement; base: string; text: string }> = [];
  let lastWin = { idx: 0, at: Number.NEGATIVE_INFINITY };
  const procPops = createProcPops(root);

  // ── feed, phone, prompt, dread ──────────────────────────────────────────────────────────────────
  const feed = h('div', 'feed', root);
  const feedLines: Array<{ el: HTMLElement; age: number }> = [];
  const phone = h('div', 'hb phone hidden', root);
  const phoneArc = h('div', 'arc', phone);
  h('div', 'bell', phone);
  h('span', 'lbl', phone, t('hud.phone.ring'));
  // Direction and distance to the nearest hotline booth while it rings: "← 12m" (refreshed in updatePhone).
  const phoneDir = h('span', 'dir', phone);
  let phoneLeft = 0;
  const dread = h('div', 'dread', root);

  // anchors for fly-to targets
  const anchors: Array<[HudAnchorId, HTMLElement]> = [
    ['wallet', wallet], ['tickets', tix], ['clock', clock], ['quota', quota], ['buffs', buffs], ['charms', charms], ['pulls', pulls],
  ];
  for (const [id, el] of anchors) ui().setAnchor(id, el);

  let clockAlarmed = false;
  let lastPhase = '';

  function addFeed(text: string, cls = ''): void {
    const el = h('div', `ln ${cls}`, feed, text);
    feedLines.push({ el, age: 0 });
    while (feedLines.length > FEED_MAX) feedLines.shift()?.el.remove();
  }
  /**
   * A feed line for news that may also get a banner or toast (event start / end, Last Call). It runs one tick later so a
   * banner announced in the same tick claims the news first; the line is then dropped (one news item, one display).
   */
  function feedNews(text: string, cls = ''): void {
    window.setTimeout(() => { if (claimAnnounce(text)) addFeed(text, cls); }, 0);
  }

  /** The gain at the centre of the screen for a win: big gold figure, scaled by tier (small 1× up to jackpot 2×). */
  function winPop(text: string, idx: number): void {
    const el = h('div', idx >= HUGE ? 'win-pop huge' : 'win-pop', root, text);
    el.style.setProperty('--k', String(Math.min(2, 1 + 0.2 * (idx - SMALL))));
    // Big and huge wins: a gold burst at the figure and a camera shake, stronger by tier (the shake setting scales it).
    if (idx >= BIG) {
      goldBurst(root, '42%', idx >= HUGE ? 2 : 1);
      try { app.fx.shake(idx >= HUGE ? 0.02 : 0.012, idx >= HUGE ? 0.5 : 0.3, { roll: 0.6 }); } catch { /* the shake is optional */ }
    }
    window.setTimeout(() => el.remove(), 900);
  }

  /** The machine's display name (`machine.<id>.name` via t()), never its internal id. */
  const lampName = (e: LampEntry): string => machineName(e.machineId);
  function showLamps(v: LampView): void {
    lampsSeen = v;
    const hot = v.hot.map(lampName).join(', ');
    const cold = v.cold.map(lampName).join(', ');
    setText(lampHot, hot ? t('circuit.hud.hot', { name: hot }) : '');
    setText(lampCold, cold ? t('circuit.hud.cold', { name: cold }) : '');
    setCls(lampsEl, 'hidden', seated || (!hot && !cold));
  }
  const circuit0 = circuitView(app.run);
  if (circuit0) showLamps(circuit0.lamps());

  // ── events ──────────────────────────────────────────────────────────────────────────────────────
  on('eco:wallet', ({ pid, delta }) => {
    if (pid !== self() || delta === 0) return;
    if (delta > 0) {
      // machine:result is emitted just before the payout, so a win that tier-scales the gain is still the last one seen.
      const idx = performance.now() - lastWin.at < WIN_LINK_MS ? lastWin.idx : 0;
      const win = idx >= SMALL;
      if (win) winPop(signed(delta, money), idx);
      ui().fly({
        from: popOrigin(), to: 'wallet', text: win ? '' : signed(delta, money), color: COLORS.shine,
        onArrive: () => { ui().bump('wallet', 1 + Math.min(1, delta / 2000)); uiSfx('numberTick', 0.7); },
      });
    } else {
      walletFlash = 0.2;
      setCls(wallet, 'spend', true);
      ui().bump('wallet', 0.6);
    }
  });

  on('machine:result', ({ pid, machineId, tier, bet, gross }) => {
    if (pid !== self()) return;
    const idx = tierIndex(tier);
    lastWin = { idx, at: performance.now() };
    if (idx < BIG) return;
    const mult = bet > 0 ? Math.round(gross / bet) : 0;
    addFeed(t('hud.feed.win', { who: t('hud.feed.you'), x: mult, machine: machineName(machineId) }), idx >= HUGE ? 'gold' : '');
    app.fx.hitstop(idx >= HUGE ? 0.08 : 0.04);
    ui().fly({ from: popOrigin(), to: 'wallet', text: t(`hud.tier.${tier}`), color: COLORS.bulb, dur: 1.0 });
  });

  on('machine:jackpot', ({ pid, machineId, amount }) => {
    if (pid !== self()) return;
    addFeed(t('hud.feed.jackpot', { who: t('hud.feed.you'), machine: machineName(machineId) }), 'gold');
    ui().fly({ from: popOrigin(), to: 'wallet', text: fmtCoins(amount), color: COLORS.shine, dur: 1.2 });
  });

  on('pulls:change', ({ pid, pulls: n }) => {
    if (pid !== self()) return;
    if (Number.isFinite(n)) pullsPeak = Math.max(pullsPeak, n);
  });

  on('charm:proc', ({ pid, charmId, tier, label }) => {
    if (pid !== self()) return;
    for (const el of charmRow.querySelectorAll<HTMLElement>(`[data-id="${charmId}"]`)) {
      el.classList.add('proc');
      el.classList.remove('hop');
      void el.offsetWidth;
      el.classList.add('hop');
      window.setTimeout(() => el.classList.remove('proc'), 100);
    }
    playProcTick(tier ?? 0);
    if (label) procPops.show(label, tier ?? 0);
  });

  on('quota:met', () => { addFeed(t('hud.feed.quotaMet'), 'gold'); uiSfx('quotaTick', 1); });
  on('quota:failed', () => { addFeed(t('hud.feed.quotaFailed'), 'red'); });
  on('event:start', ({ id }) => { feedNews(t('hud.feed.event', { name: t(`event.${id}.name`) }), 'gold'); });
  on('event:end', ({ id }) => { feedNews(t('hud.feed.eventEnd', { name: t(`event.${id}.name`) }), ''); });
  on('tycoon:milestone', ({ upgrade, level }) => {
    const name = has(`upg.${upgrade}.name`) ? t(`upg.${upgrade}.name`) : upgrade;
    addFeed(t('hud.feed.milestone', { name, n: level }), 'gold');
  });
  on('charm:add', ({ pid, charmId }) => { if (pid === self()) addFeed(t('hud.feed.charm', { name: t(`charm.${charmId}.name`) })); });
  on('circuit:lamps', (v) => {
    showLamps(v);
    if (v.hot.length > 0) addFeed(t('circuit.feed.hot', { name: v.hot.map(lampName).join(', ') }), 'gold');
  });
  on('player:seat', ({ pid, on: sat }) => {
    if (pid !== self()) return;
    seated = sat;
    // Seated: the world interact prompt and the mouse-capture hint step aside (ui.css `.seated`). CSS, not a prompt
    // clear: the interaction system sends a prompt only when its text changes, so a cleared prompt would stay hidden.
    host?.classList.toggle('seated', sat);
    showLamps(lampsSeen);
  });
  let phoneTotal = PHONE_SECONDS;
  on('phone:length', ({ seconds }) => { phoneTotal = seconds; phoneLeft = seconds; });
  on('phone:ring', () => { phoneTotal = PHONE_SECONDS; phoneLeft = PHONE_SECONDS; setCls(phone, 'hidden', false); uiSfx('phoneRing', 0.8); });
  on('phone:end', () => { phoneLeft = 0; setCls(phone, 'hidden', true); });

  // ── per-frame update ───────────────────────────────────────────────────────────────────────────
  function updateWallet(dt: number): void {
    const r = app.run;
    if (!r) return;
    const w = r.wallet(self());
    if (!walletSeen) { roll.set(w, true); walletSeen = true; }
    else roll.set(w);
    roll.tick(dt);
    setText(walletNum, `${coinSym()} ${money(roll.shown)}`);
    if (walletFlash > 0) {
      walletFlash -= dt;
      if (walletFlash <= 0) setCls(wallet, 'spend', false);
    }
    setText(tixNum, String(r.balance('ticket', self())));
    const perMin = r.tycoon.incomePerSec() * 60;
    setCls(staff, 'hidden', perMin <= 0);
    setText(staff, t('hud.staff.perMin', { n: money(Math.round(perMin)) }));
  }

  function updateClock(): void {
    const r = app.run;
    const sh = r?.shift.state();
    const phase = sh?.phase ?? 'idle';
    const left = r ? r.shift.timeLeft() : 0;
    const lastCall = phase === 'lastCall';
    // Intermission (MOLA): the top line says what to do next, not the Watch clock.
    const interm = phase === 'intermission';
    setCls(clock, 'lastcall', lastCall);
    setCls(clock, 'interm', interm);
    setText(clockNum, interm ? '' : mmss(left));
    setText(clockPhase, interm ? t('interm.topBar') : lastCall ? t('hud.clock.lastCall') : r?.window() === 'dawn' ? t('hud.clock.dawn') : t('hud.clock.watch'));
    setText(clockWall, interm ? '' : t('hud.clock.wall', { n: wallClock(sh?.clock ?? 0) }));
    if (phase !== lastPhase) {
      if (lastCall && !clockAlarmed) {
        clockAlarmed = true;
        void ui().banner(t('hud.clock.lastCall'), { hold: 1.2, size: 16, color: COLORS.signal });
        feedNews(t('hud.feed.lastCall'), 'red');
        uiSfx('clockAlarm', 1);
      }
      lastPhase = phase;
    }
    if (r) {
      const n = r.night();
      const seg = sh?.segment;
      // Intermission: the night number only (the Watch segment belongs to the Watch clock, which is not running).
      setText(night, seg && !interm ? t('hud.night', { n, w: seg.index + 1, c: seg.count }) : t('hud.nightBare', { n }));
    }
  }

  function updateQuota(): void {
    const r = app.run;
    if (!r) return;
    const q = r.shift.quota();
    const due = Math.max(0, q.due);
    const dep = Math.max(0, q.deposited);
    const frac = due > 0 && !nightPaid(r) ? Math.min(1, dep / due) : 1;
    setText(quotaNum, `${money(dep)} / ${money(due)}`);
    quotaFill.style.width = `${Math.round(frac * 100)}%`;
    const paid = nightPaid(r);
    const met = paid || q.met || (due > 0 && dep >= due);
    if (paid) setText(quotaNum, t('interm.paidShort', { n: r.night() }));
    setCls(quota, 'met', met);
    setCls(quota, 'short', !met);
    const late = r.shift.phase === 'lastCall' || r.shift.timeLeft() < 30;
    setCls(quota, 'late', !met && late);
    setText(quotaShort, met || paid ? '' : t('hud.quota.short', { n: money(Math.max(0, due - dep)) }));
  }

  function updateBuffs(dt: number): void {
    const r = app.run;
    buffRefresh -= dt;
    if (r && buffRefresh <= 0) {
      buffRefresh = BUFF_REFRESH_S;
      const list = r.buffs.list({ pid: self() });
      const key = list.map((b) => `${b.id}:${b.stacks}`).join('|');
      if (key !== buffKey) {
        const fresh = new Set(list.map((b) => b.id).filter((id) => !buffIds.has(id)));
        buffIds = new Set(list.map((b) => b.id));
        buffKey = key;
        buffs.replaceChildren();
        buffTimers = [];
        for (const b of list.slice(0, 8)) {
          const def = r.buffs.def(b.id);
          const color = def?.color !== undefined ? hexCss(def.color) : def?.kind === 'debuff' ? COLORS.signal : COLORS.green;
          const name = has(`buff.${b.id}.name`) ? t(`buff.${b.id}.name`) : b.id;
          const el = h('div', `ico${def?.kind === 'debuff' ? ' debuff' : ''}${fresh.has(b.id) ? ' hop' : ''}`, buffs);
          el.title = name;
          const timer = h('i', 'timer', el);
          timer.style.setProperty('--c', color);
          h('span', '', el, initial(name));
          if (b.stacks > 1) h('span', 'stk', el, String(b.stacks));
          buffTimers.push({ el: timer, b, color });
        }
      }
    }
    if (r) {
      for (const bt of buffTimers) {
        const frac = Math.max(0, Math.min(1, r.buffs.remaining(bt.b)));
        bt.el.style.setProperty('--p', `${Math.round(frac * 360)}deg`);
      }
    }
  }

  function updatePulls(): void {
    const r = app.run;
    const n = r ? r.pulls(self()) : 0;
    if (!Number.isFinite(n)) {           // Free Casino: unlimited pulls. Never loop over Infinity (that froze the page).
      if (pullsKey === 'inf') return;
      pullsKey = 'inf';
      tokens.replaceChildren();
      h('i', 'tok', tokens);
      return;
    }
    pullsPeak = Math.max(pullsPeak, n);
    const key = `${pullsPeak}:${n}`;
    if (key === pullsKey) return;
    pullsKey = key;
    tokens.replaceChildren();
    for (let i = 0; i < pullsPeak; i++) h('i', i < n ? 'tok' : 'tok spent', tokens);
  }

  function updateCharms(): void {
    const r = app.run;
    const list: readonly CharmState[] = r ? r.charms(self()) : [];
    const key = list.map((c) => `${c.id}x${c.stacks}`).join('|');
    if (key !== charmKey) {
      charmKey = key;
      charmRow.replaceChildren();
      pegs = [];
      for (const c of list) {
        const name = has(`charm.${c.id}.name`) ? t(`charm.${c.id}.name`) : c.id;
        const el = h('div', 'charm', charmRow);
        el.dataset.id = c.id;
        el.title = name;
        pegs.push({ face: h('span', 'face', el, initial(name)), base: initial(name), text: '' });
      }
    }
    // Live counters: the face shows the charm's counter (3/6, +16%) when it has one, else its initial. Written on change only.
    for (let i = 0; i < pegs.length && i < list.length; i++) {
      const peg = pegs[i];
      const text = pegBadge(list[i].id, list[i].data) || peg.base;
      if (text === peg.text) continue;
      peg.text = text;
      setText(peg.face, text);
    }
  }

  function updatePhone(dt: number): void {
    if (phoneLeft <= 0) return;
    phoneLeft = Math.max(0, phoneLeft - dt);
    phoneArc.style.setProperty('--p', `${Math.round((phoneLeft / phoneTotal) * 360)}deg`);
    setText(phoneDir, boothHint());
    if (phoneLeft <= 0) setCls(phone, 'hidden', true);
  }

  /** "← 12m" / "→ 4m" toward the nearest hotline booth from the local player's view; '' when the booth is not placed. */
  const boothAt = new THREE.Vector3();
  const boothFwd = new THREE.Vector3();
  function boothHint(): string {
    const w = app.world, p = app.player, cam = app.camera;
    if (!w || !p || !cam) return '';
    let best = Infinity, bx = 0, bz = 0;
    for (const m of w.machines()) {
      if (m.def.id !== 'hotline') continue;
      const root = (m as unknown as { model?: { root?: THREE.Object3D } }).model?.root;
      if (!root) continue;
      root.getWorldPosition(boothAt);
      const d = Math.hypot(boothAt.x - p.pos.x, boothAt.z - p.pos.z);
      if (d < best) { best = d; bx = boothAt.x; bz = boothAt.z; }
    }
    if (!Number.isFinite(best)) return '';
    // Lateral side: the booth's offset along the camera's right vector (right = forward x up, on the ground plane).
    cam.getWorldDirection(boothFwd);
    const dx = bx - p.pos.x, dz = bz - p.pos.z;
    const lateral = -boothFwd.z * dx + boothFwd.x * dz;
    return `${lateral >= 0 ? '→' : '←'} ${Math.round(best)}m`;
  }

  function updateFeed(dt: number): void {
    for (const ln of feedLines) {
      ln.age += dt;
      setCls(ln.el, 'old', ln.age > FEED_LIFE - 0.6);
    }
    while (feedLines.length && feedLines[0].age > FEED_LIFE) feedLines.shift()?.el.remove();
  }

  function updateDread(): void {
    const d = app.run ? Math.max(0, Math.min(1, app.run.dread())) : 0;
    dread.style.opacity = String(Math.min(1, 0.35 * d));
  }

  return {
    el: root,
    update(dt: number): void {
      updateWallet(dt);
      updateClock();
      updateQuota();
      updateBuffs(dt);
      updatePulls();
      updateCharms();
      updatePhone(dt);
      updateFeed(dt);
      updateDread();
    },
    setVisible(show: boolean): void { ui().setHudVisible(show); },
    setPrompt(p: HudPrompt | null): void {
      if (!p) { ui().prompt(null); return; }
      ui().prompt({ action: p.action, label: p.label, sub: p.sub });
    },
    dispose(): void {
      for (const off of disposers.splice(0)) off();
      for (const [id] of anchors) ui().setAnchor(id, null);
      procPops.dispose();
      topRo?.disconnect();
      SeatHud.stakeSource = () => ({ self: -1, pocket: 0 });
      host?.style.removeProperty('--hud-top-h');
      host?.classList.remove('seated');
      root.remove();
    },
  };
}
