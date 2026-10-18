/**
 * In-game HUD (GDD §10.1–§10.4, ART §10). Owner: HUD lane.
 *
 * `createHud()` mounts a DOM layer into `app.ui.hudLayer` (UIOverlayX). The state that runs a Night (InGame) creates it on
 * enter, calls `update(dt)` every frame and `dispose()` on exit. Everything reads the run facade (`app.run`) when it exists
 * and shows neutral values otherwise; live changes arrive through the event bus (pops, feed lines, phone, charms).
 *
 * Juice: wallet counter rolls 30 ticks/s; gains fly as numbers into the wallet anchor and bump it; spends bump, red only when the pocket is short; big
 * results add hit-stop and a feed line; Last Call runs a banner and blinks the clock.
 * Meta moments (wave 7 juice, juiceMath.ts): the centre win figure rolls up from 0 and lands on a burst; the wallet ticks pitched while
 * it rises; the quota bar has a lagging ghost, rolled numbers and quarter ticks; QUOTA MET bumps and bursts (one stinger, with the
 * cutscene); an overshoot tier slams a stamp; a set switched on toasts and hops; an evolved charm hops; HOT / COLD / OVERHEAT banner
 * on the last machine played, with a HEAT meter under the quota; a huge win takes the title card.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus, type GameEvents } from '@/core/events';
import { fmtCoins, has, lang, t } from '@/core/i18n';
import type { Action } from '@/core/input/types';
import type { HudAnchorId } from '@/core/ui/types';
import { claimAnnounce, type UIOverlayX } from '@/core/ui/ui';
import { COLORS, h, uiSfx } from '@/core/ui/widgets';
import { circuitView, lampLabel, type LampEntry, type LampView } from '@/game/circuit';
import { dawnPlan } from '@/game/pace';
import { watchEventView } from '@/game/watchEvents';
import { compereLine } from '@/game/events/compere';
import { subtitles } from '@/core/ui/subtitles';
import { presetRevealed, revealed, ticketsShown } from './hud/disclose';
import { STAKE_PRESET_KEYS } from '@/machines/_base/stakePresets';
import type { BankView, DebtRun, NextQuotaPreview, OvershootView } from '@/game/run';
import type { BrokeHelp, BrokeStep } from '@/game/rescue';
import { inUnderneath } from '@/world/hollow';
import { WIN_TIERS, type BuffState, type CharmState, type WinTier } from '@/game/types';
import type { InstanceId, PlayerId } from '@/core/types';
import { initial, mmss, Roller, signed } from './hud/fmt';
import { createProcPops, goldBurst, pegBadge, pegLabel, playProcTick, renderSetChips, setChipName } from './hud/charmProc';
import { countUpSec, heatTone, overTierLevel, overTierSting, quotaCrossings, rollPitch, TickGate } from './hud/juiceMath';
import { FIXED_STEP } from '@/core/loop';
import { charmDef } from '@/game/charms/engine';
import { activeSets, type SetId } from '@/game/charms/sets';
import { houseMoodPreviewParts, payoutChip, type PayoutPart } from '@/game/houseMood';
import { spotlightChip, type SpotlightView } from '@/game/spotlight';
import './hud/hud.css';
import './hud/evening.css';
import './hud/luck.css';
import { LUCK_MAX } from '@/game/luck';
import { nightPaid } from '@/machines/debt_terminal/night';
import { SeatHud } from '@/machines/_base/seatHud';

/** The walk actions the floor event and the keepsake hints name (wave 75; they are not in the frozen `Action` union yet). */
const FLOOR_KEY = 'floorAct' as Action;
const KEEPSAKE_KEY = 'keepsake' as Action;
const CALL_KEY = 'callCheat' as Action;
const PHONE_SECONDS = 10;
const FEED_LIFE = 6;
const FEED_MAX = 4;
const BUFF_REFRESH_S = 0.25;
const PAYOUT_REFRESH_S = 0.25;
/** Shift phases in which the run's payout.mult sources are live (the run's own inWatch set); Mola (`intermission`) shows a preview. */
const PAYOUT_LIVE_PHASES: ReadonlySet<string> = new Set(['bell', 'play', 'lastCall', 'closing', 'settle']);
/** The Bell's length in sim seconds (mirrors run.ts BELL_SEC); the top bar counts it down while the phase is `bell`. */
const BELL_SEC = 2;
/** The Hot Lamp's distance and arrow refresh this often while a Lamp is lit (the text itself is written on change only). */
const CHASE_S = 0.2;

export interface HudPrompt { action: Action; label: string; sub?: string }

export interface Hud {
  readonly el: HTMLElement;
  /** Per-frame: rolling values, clock, timers, feed fade. Cheap: DOM is written only on change. */
  update(dt: number): void;
  setVisible(on: boolean): void;
  /** Interact prompt (GDD §10.1 "[E] …" line). Pass null to clear. */
  setPrompt(p: HudPrompt | null): void;
  /** The Crooked Table's one-line prompt ("[C] Call the cheat"), shown while the player stands at, faces or sits at a marked table. */
  setCallHint(on: boolean): void;
  dispose(): void;
}

const self = (): PlayerId => app.run?.selfId ?? 0;
/** The printed Night the run is on (onboarding gates read it; Night 1 before a run exists). */
const nightNow = (): number => app.run?.night() ?? 1;
const ui = (): UIOverlayX => app.ui as UIOverlayX;
const coinSym = (): string => t('common.coinSuffix').trim();
const money = (n: number): string => fmtCoins(n);
/**
 * The broke hint (NIGHT PLAN): the bank first (WITHDRAW at the terminal, the same order the broke card lists them), else the phone,
 * where the rescue call (the House loan) or a hotline rings. '' when neither way out is open.
 */
function brokeHint(steps: BrokeStep[]): string {
  if (steps.some((s) => s.id === 'bank')) return t('hud.plan.broke.bank');
  if (steps.some((s) => s.id === 'phone' || s.id === 'loan')) return t('hud.plan.broke.phone');
  return '';
}
const hexCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** Machine strings register under `m.<id>.` (registry.ts), so the display name is `m.<id>.name`. */
const machineName = (id: string): string => (has(`m.${id}.name`) ? t(`m.${id}.name`) : id);
const tierIndex = (tier: WinTier): number => WIN_TIERS.indexOf(tier);
const SMALL = WIN_TIERS.indexOf('small');
const BIG = WIN_TIERS.indexOf('big');
const HUGE = WIN_TIERS.indexOf('huge');
/** A tier's win pop is scaled by this many ms after its machine:result (the payout follows it in the same tick). */
const WIN_LINK_MS = 600;
/** The centre figure holds this long after it lands, before its rise and fade (UI seconds). */
const WIN_POP_TAIL_S = 0.9;
/** The QUOTA MET stinger waits this long, so a quota_met cutscene that the same event starts can take the lead (one stinger). */
const MET_STINGER_CHECK_S = 0.12;
/** The overshoot stamp's life, seconds. */
const STAMP_LIFE_S = 1.6;
/** Buffs that are streak state (buffs/streaks.ts): HOT stacks, COLD and OVERHEAT. */
const STREAK_IDS: ReadonlySet<string> = new Set(['hot', 'cold', 'overheat']);

function setText(el: HTMLElement, s: string): void { if (el.textContent !== s) el.textContent = s; }
function setCls(el: HTMLElement, cls: string, on: boolean): void { el.classList.toggle(cls, on); }

/** Settings the juice reads: calm mutes the shake and the flashes (the figures and the sounds stay). */
const juiceSettings = () => app.save?.data?.settings;
const calmOn = (): boolean => !!juiceSettings()?.calm;
const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** One roll tick on the UI bus: pitch rises with the roll's progress (0..1). Silent when audio is not ready. */
function rollTick(progress: number, vol: number): void {
  try { app.audio.play('numberTick', { bus: 'ui', vol, pitch: rollPitch(progress) }); } catch { /* audio is optional */ }
}
/** Restarts a CSS class animation on an element (remove, reflow, add). */
function replayClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Screen point where the big numbers start (centre, a little above the middle). */
function popOrigin(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 };
}

/** A centre win figure rolling from 0 to its amount (winPop): it lands with a gold burst, then holds, rises and fades. */
interface WinRoll { el: HTMLElement; num: HTMLElement; target: number; idx: number; dur: number; life: number; t: number; shown: number; landed: boolean; gate: TickGate }
/** A stamp slammed over the HUD (the overshoot tier), removed when its life is up. */
interface Stamp { el: HTMLElement; t: number }

export function createHud(): Hud {
  const root = h('div', 'hud');
  ui().hudLayer.appendChild(root);
  const disposers: Array<() => void> = [];
  const on = <K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void): void => {
    disposers.push(bus.on(type, fn));
  };
  // Watch tithe (wave 58): the Settle's result as a toast in play (src/menu/hud/tithe.strings.ts). run.ts emits this event just
  // before its own banner with the same news, so the toast claims the news first and the banner's repeat is dropped.
  // Home stages (wave 71 polish): leaving a place clears its toasts. The Evening clears its own arrival toasts (the lift start and the
  // front door), so only the exits are swept here: the floor, the bed and the Collector's doom. A sweep on arrival would take the
  // Evening's own hint, which is raised in the same emit.
  on('home:stage', ({ stage }) => { if (stage === null || stage === 'sleep' || stage === 'doomed') ui().dismissToasts(); });
  on('run:tithe', (e) => {
    if (e.pid !== self()) return;
    if (e.state === 'met') ui().toast(t('hud.tithe.met', { n: e.tickets }), 'good', 4);
    else ui().toast(t('hud.tithe.missed', { n: fmtCoins(e.shortfall) }), 'bad', 4.5);
  });
  // The seat HUD's STAKE / POCKET readout reads the local player and pocket from the run while this HUD is up.
  SeatHud.stakeSource = () => {
    const r = app.run;
    return r ? { self: r.selfId, pocket: r.wallet(r.selfId) } : { self: -1, pocket: 0 };
  };
  // The seat's Tilt bulbs and preset row follow the onboarding schedule by printed Night (disclose.ts).
  SeatHud.readout = () => {
    const n = nightNow();
    return { tilt: revealed(n, 'tilt'), presets: STAKE_PRESET_KEYS.filter((k) => presetRevealed(n, k)) };
  };

  // The top band is a three-column grid (left | centre), the centre clock is capped so it never runs under the right stack.
  const top = h('div', 'hud-top', root);
  const topL = h('div', 'hud-tl', top);
  const topC = h('div', 'hud-tc', top);
  // The right stack (quota, PAYOUT, NIGHT PLAN, EMPIRE, buffs, phone) is one column of its own, not part of the band's height:
  // a tall stack then never pushes the feed or the seat banners down.
  const topR = h('div', 'hud-rs', root);
  disposers.push(mountSpotlightChip(topR));
  // The seat HUD's state banner and tooltip stack under this band: it reads `--hud-top-h` (seatHud.css) from the #ui root.
  const host = ui().hudLayer.parentElement;
  const setTopH = (): void => { host?.style.setProperty('--hud-top-h', `${top.offsetTop + top.offsetHeight}px`); };
  const topRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setTopH) : null;
  topRo?.observe(top);
  setTopH();
  // The right stack's bottom edge (`--hud-rs-b`, the same frame as --hud-top-h): a toast anchored under it never sits on the stack.
  const setRsB = (): void => { host?.style.setProperty('--hud-rs-b', `${topR.offsetTop + topR.offsetHeight}px`); };
  const rsRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setRsB) : null;
  rsRo?.observe(topR);
  setRsB();

  // ── top-left: pocket, tickets, staff ────────────────────────────────────────────────────────────
  const wallet = h('div', 'hb wallet', topL);
  const walletNum = h('span', 'num', wallet, `${coinSym()} 0`);
  const tix = h('div', 'hb tix', topL);
  h('span', 'lbl', tix, t('hud.tickets'));
  const tixNum = h('span', 'num', tix, '0');
  const staff = h('div', 'hb staff hidden', topL);
  const roll = new Roller();
  let walletSeen = false;
  // BİLET shows once the player has held a ticket (onboarding: no ticket readout until there is one to read).
  let ticketsSeen = false;
  // The wallet's roll ticks: where the current rise started (the pitch climbs over it), and the 12 Hz throttle.
  let rollStart = 0;
  const rollGate = new TickGate();

  // ── top-centre: clock + night line ──────────────────────────────────────────────────────────────
  const clock = h('div', 'clock', topC);
  const clockNum = h('span', 'num', clock, '00:00');
  const clockPhase = h('span', 'phase', clock, '');
  // ELAPSED: the run's time so far (mm:ss), small, beside the Watch clock. Sim time, so it stops with the game's pauses.
  const elapsedEl = h('span', 'elapsed', clock, '');
  elapsedEl.style.cssText = 'margin-left:10px;font-size:13px;opacity:0.7;font-variant-numeric:tabular-nums;white-space:nowrap';
  // One clock line (the Watch clock above); the night line under it. The wall-clock "SAAT" line was a duplicate and is gone.
  const sub = h('div', 'sub', topC);
  const night = h('span', 'night', sub, '');
  // THE CIRCUIT: the Watch's Hot / Cold Lamps. Deferred out of the centre column (legibility pass): the chase line is a
  // long, live line and the centre keeps one slot per message kind (phase / event / toasts / banner / prompt). It reads just
  // as well under the wallet at the top left, and its news already has a feed line (`circuit.feed.hot`).
  const lampsEl = h('div', 'lamps hidden', topL);
  const lampHot = h('span', 'hot', lampsEl);
  const lampCold = h('span', 'cold', lampsEl);
  // Watch floor event (wave 43): its name, the Minute timer and a Lucky Lamp's pulls, under the Lamps (reuses the lamps style)
  const watchEl = h('div', 'lamps hidden', topC);
  const watchTxt = h('span', 'ev', watchEl);
  watchTxt.style.color = '#ffd060';
  // The event's one line under the Watch line (its state, or the key to press), and the keepsake seat hint under that (wave 75)
  const watchInfo = h('div', 'lamps hidden', topC);
  watchInfo.style.color = '#ffd060';
  const keepHint = h('div', 'lamps hidden', topC);
  keepHint.style.color = 'var(--bone)';
  const callHint = h('div', 'lamps hidden', topC);
  callHint.style.color = '#ffd060';
  let lampsSeen: LampView = { hot: [], cold: [] };
  /** True while the player is in THE UNDERNEATH: the pit's lamp lines stay hidden there. */
  let voidOn = false;
  let seated = false;

  // ── top-right: quota ────────────────────────────────────────────────────────────────────────────
  // THE EVENING card (wave 69): the apartment's one compact read-out, shown only while the run is at home (evening.css).
  const evCard = h('div', 'hud-evening', topR);
  h('span', 'ev-title', evCard, t('hud.evening.title'));
  const evObj = h('span', 'ev-obj', evCard, '');
  const evHarm = h('div', 'ev-row', evCard);
  h('span', 'lbl', evHarm, t('hud.evening.harmony'));
  const harmPips: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) harmPips.push(h('span', 'pip harm', evHarm, '♥'));
  const evHeat = h('div', 'ev-row', evCard);
  h('span', 'lbl', evHeat, t('hud.evening.heat'));
  const heatPips: HTMLElement[] = [];
  for (let i = 0; i < 6; i++) heatPips.push(h('span', 'pip heat', evHeat));
  let evKey = '';
  const quota = h('div', 'hb quota', topR);
  h('span', 'lbl', quota, t('hud.quota.label'));
  const quotaNum = h('span', 'num', quota, '0 / 0');
  const quotaBar = h('div', 'bar', quota);
  // The ghost is the pale lead segment under the amber fill: a rise shows it at once and the fill grows into it (a lagging fill).
  const quotaGhost = h('i', 'gh', quotaBar);
  const quotaFill = h('i', '', quotaBar);
  for (const m of [25, 50, 75]) h('b', 'mark', quotaBar).style.left = `${m}%`;
  const quotaShort = h('span', 'short', quota, '');
  // Legibility pass: the quota is the run's goal, so it takes the top slot of the right stack (before the spotlight chip and
  // THE EVENING card). hud.css gives it the biggest number and the widest bar on screen.
  topR.prepend(quota);
  // ŞANS (wave 72, game/luck.ts): the luck meter, one row under the quota from Night 2 (disclose.ts). Red when negative. Each star
  // is a 1 % payout bonus, shown as "wins +3%" (EN) / "kazanç +%3" (TR). The meter emits `luck:change` on each move; the row
  // pops and toasts it with the reason when the source gives one. Silent until the readout is shown.
  const luckEl = h('div', 'hb luck hidden', topR);
  quota.after(luckEl);
  luckEl.title = t('luck.tip');
  luckEl.dataset.tip = t('luck.tip');   // the readable tooltip (hud/luck.css): the native title is small and slow
  h('span', 'lbl', luckEl, t('luck.label'));
  const luckStars = h('span', 'stars', luckEl, '');
  const luckBonus = h('span', 'bonus', luckEl, '');
  let luckRun: unknown = null;
  let luckKey = '';
  const luckText = (s: number): string => {
    const sign = s > 0 ? '+' : s < 0 ? '−' : '±';
    return t('luck.bonus', { s: sign, n: String(Math.abs(s)) });
  };
  // the reason keys, spelled out so the string check sees each one (a heat reason with no key toasts the change alone)
  const LUCK_WHY: Record<string, string> = {
    quota: 'luck.why.quota', overshoot: 'luck.why.overshoot', failed: 'luck.why.failed', tithe: 'luck.why.tithe',
    loan: 'luck.why.loan', time: 'luck.why.time', deal: 'luck.why.deal', thin: 'luck.why.thin', quiet: 'luck.why.quiet',
  };
  on('luck:change', ({ delta, why }) => {
    if (!app.run || !revealed(nightNow(), 'luck')) return;
    const n = delta > 0 ? '+1' : '-1';
    const key = LUCK_WHY[why];
    const reason = key && has(key) ? t(key) : '';
    ui().toast(reason ? t('luck.toastWhy', { n, why: reason }) : t('luck.toast', { n }), delta > 0 ? 'good' : 'bad', 3.5);
    luckEl.classList.remove('pop');
    void luckEl.offsetWidth;
    luckEl.classList.add('pop');
    goldBurst(luckEl, '50%', 0);
  });
  const luckRender = (): void => {
    const run = app.run;
    if (run && luckRun !== run) { luckRun = run; luckKey = ''; }
    const shown = !!run && revealed(nightNow(), 'luck');
    luckEl.classList.toggle('hidden', !shown);
    if (!run) return;
    const s = run.luckStars?.() ?? 0;
    const key = String(s);
    if (key === luckKey) return;
    luckKey = key;
    luckStars.textContent = s < 0 ? `${'☆'.repeat(LUCK_MAX)} −${-s}` : '★'.repeat(s) + '☆'.repeat(LUCK_MAX - s);
    luckBonus.textContent = luckText(s);
    luckEl.classList.toggle('neg', s < 0);
  };
  // The quota figure rolls toward the deposited amount (Roller, as the wallet). The fill's last percent and the Night it was read in
  // decide the 25 / 50 / 75 / 100 % ticks: a Night's first read is silent.
  const quotaRoll = new Roller();
  let quotaSeen = false;
  let quotaPct = -1;
  let quotaNight = -1;
  // HEAT meter (the streak heat of the machine the player played last), under the quota. Hidden until that machine has heat.
  const heatEl = h('div', 'hb heat hidden', topR);
  h('span', 'lbl', heatEl, t('hud.juice.heat'));
  const heatBar = h('div', 'bar', heatEl);
  const heatFill = h('i', '', heatBar);
  let heatMid: InstanceId | null = null;
  let heatColor = '';
  let heatPct = -1;
  // PAYOUT chip (wave 47): every global payout.mult source (House Favour, the House Mood, the Witching bonus, ...) under the quota.
  // Shown in play, and in Mola as the next Watch's preview. Plain text on a dark plate, 14px+, each part coloured by its sign.
  const payout = h('div', 'hb payout hidden', topR);
  let payoutKey = '';
  let payoutLeft = 0;
  // NIGHT PLAN (under the quota), four lines: the Night's due, the bank and its projection at Dawn (banked coins only), the
  // pocket (to deposit, so it counts), and the Watch with how it ends (pulls, clock, the Bell). Between Watches the last line names the next one.
  const plan = h('div', 'plan hidden', topR);
  // NEXT NIGHT (wave 55): at Dawn and in Mola the plan shows this line alone, the exact quota of the coming Night.
  const planNext = h('span', 'pn hidden', plan);
  planNext.style.cssText = 'font-weight:700';
  // The core four lines: the bank against the Dawn quota, the pocket, the Watch (pulls, clock), the tithe. The quota itself is on the
  // QUOTA line above, so no head line. The OVERSHOOT line (planOver) joins under the bank line once the quota is banked. Optional
  // lines: the broke hint (under the pocket), and the unpaid tithe (under the tithe), which stays until the Night ends.
  const planBank = h('span', 'pb', plan);
  // OVERSHOOT (wave 7 controls lane): once the quota is banked, the next overpay tier, what it pays and the coins to go.
  const planOver = h('span', 'po hidden', plan);
  const planPocket = h('span', 'pk', plan);
  // BROKE HINT: the pocket cannot cover the cheapest bet and tonight's quota is unpaid. Names the way out (bank, else phone).
  const planBroke = h('span', 'pbk hidden', plan);
  const planEnds = h('span', 'pe', plan);
  // WATCH TITHE (Night 3 on): the Watch tithe line (net winnings), green once met. Shown only while run.watchTithe() reports it active.
  const planTithe = h('span', 'pt hidden', plan);
  // UNPAID TITHE: the quota the missed Watches added tonight. Shown from the first missed Settle to the end of the Night.
  const planUnpaid = h('span', 'pu hidden', plan);
  let planKey = '';
  // The NIGHT PLAN counts Settles from the run's segment, which still names the settled Watch during its intermission. These
  // two remember which Watch settled last in which Night, so the Night's first intermission (no Watch settled yet) counts all of them.
  let planNight = -1;
  let settledAt = -1;
  // The highest OVERSHOOT tier index this Night's toast has announced (null: not read yet this Night, so the first read is silent).
  let overSeen: number | null = null;
  // Last read: the Night's seal was broken (BREAK THE SEAL). Its rising edge clears the terminal's warning toast.
  let sealBrokeSeen = false;
  // EMPIRE chip (tycoon): machines you bought and the house cut they pay per Watch. Hidden until the first purchase.
  const empire = h('div', 'hb empire hidden', topR);
  empire.style.cssText = 'padding:2px 8px;max-width:100%;color:#ffd34a;font-size:12px;letter-spacing:.06em;white-space:normal;overflow-wrap:anywhere;text-align:right';
  empire.title = t('prog.empire.tip');
  const empireNum = h('span', 'num', empire, '');
  let empireKey = '';

  // ── right stack, last: buffs (a wrapping row under the EMPIRE chip) ───────────────────────────────
  const buffs = h('div', 'hb buffs', topR);
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
  let pegs: Array<{ el: HTMLElement; face: HTMLElement; base: string; name: string; text: string; title: string }> = [];
  let lastWin = { idx: 0, at: Number.NEGATIVE_INFINITY };
  const procPops = createProcPops(root);
  /** Centre win figures still rolling or holding, and the overshoot stamps still up (both driven by update(dt)). */
  const winRolls: WinRoll[] = [];
  const stamps: Stamp[] = [];
  /** Charm sets switched on so far (null until the first read, so a run that opens with sets on does not toast them). */
  let setsSeen: SetId[] | null = null;
  /** Evolved charm ids waiting for their peg: the peg is rebuilt on the same frame the evolution lands. */
  const evoPending: string[] = [];
  /** Streak buff stacks already announced, per owner and id ('i:<machine>|hot'): a refresh at the same stacks is not news. */
  const streakSeen = new Map<string, number>();
  /** Seconds left before the QUOTA MET stinger is decided (0 = none pending). */
  let metStingerLeft = 0;

  // ── feed, phone, prompt, dread ──────────────────────────────────────────────────────────────────
  const feed = h('div', 'feed', root);
  const feedLines: Array<{ el: HTMLElement; age: number }> = [];
  const phone = h('div', 'hb phone hidden', topR);
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
  let bellLeft = 0;
  // ELAPSED (run time): sim seconds since this run began; restarts when the run object changes.
  let elapsedRun: unknown = null;
  let elapsedSim = 0;
  let elapsedSeen = 0;

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

  /**
   * The gain at the centre of the screen for a win: a big gold figure, scaled by tier (small 1× up to jackpot 2×). It rolls up
   * from 0 over the tier's count-up (`countUpSec`), with a rising pitch-ticked roll, and lands with a gold burst (bigger by
   * tier) and, for big and up, the camera shake. The roll is driven by `updateWinRolls` (the frame time), not a timer.
   */
  function winPop(amount: number, idx: number): void {
    const el = h('div', idx >= HUGE ? 'win-pop huge' : 'win-pop', root);
    el.style.setProperty('--k', String(Math.min(2, 1 + 0.2 * (idx - SMALL))));
    const num = h('span', 'wn', el, signed(0, money));
    const dur = countUpSec(idx);
    const life = dur + WIN_POP_TAIL_S;
    // The CSS pop lasts the whole life: it pops in, holds through the roll and the landing, then rises and fades.
    el.style.animationDuration = `${life.toFixed(2)}s`;
    winRolls.push({ el, num, target: Math.max(0, Math.round(amount)), idx, dur, life, t: 0, shown: 0, landed: false, gate: new TickGate() });
  }

  /** The win figure's landing: the figure reads its final value, a gold burst (by tier), the camera shake for big and up, a bump. */
  function landWin(w: WinRoll): void {
    setText(w.num, signed(w.target, money));
    goldBurst(root, '42%', w.idx >= HUGE ? 2 : w.idx >= BIG ? 1 : 0);
    if (w.idx >= BIG && !calmOn()) {
      try { app.fx.shake(w.idx >= HUGE ? 0.02 : 0.012, w.idx >= HUGE ? 0.5 : 0.3, { roll: 0.6 }); } catch { /* the shake is optional */ }
    }
    if (!reduceMotion()) w.num.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }

  /** A modal (the Night Card offer, the Dawn receipt) owns the screen: the HUD's centre figures and stamps hide under it
   *  (they keep their timers, so they do not restart when the modal closes). */
  function hudHiddenByModal(): boolean {
    try { return !!ui().blocking; } catch { return false; }
  }

  function updateWinRolls(dt: number): void {
    const hidden = hudHiddenByModal();
    for (let i = winRolls.length - 1; i >= 0; i--) {
      const w = winRolls[i];
      w.el.style.visibility = hidden ? 'hidden' : '';
      w.t += dt;
      if (!w.landed) {
        const k = Math.min(1, w.t / w.dur);
        const v = Math.round(w.target * (1 - Math.pow(1 - k, 3)));   // ease-out, as the Roller's count-up
        const changed = v !== w.shown;
        if (changed) { w.shown = v; setText(w.num, signed(v, money)); }
        // a tick per change, at most 12 Hz, pitched up with the roll (the gate counts down on every frame)
        if (w.gate.pass(dt, changed && v > 0)) rollTick(k, 0.3);
        if (k >= 1) { w.landed = true; landWin(w); }
      }
      if (w.t >= w.life) { w.el.remove(); winRolls.splice(i, 1); }
    }
  }

  /** A stamp slammed over the HUD (the overshoot tier's name): it lands big and settles, then fades and is removed. */
  function slamStamp(text: string, k: number): void {
    const el = h('div', 'hud-stamp', root, text);
    el.style.setProperty('--k', String(k.toFixed(2)));
    stamps.push({ el, t: 0 });
  }

  function updateStamps(dt: number): void {
    const hidden = hudHiddenByModal();
    for (let i = stamps.length - 1; i >= 0; i--) {
      const s = stamps[i];
      s.el.style.visibility = hidden ? 'hidden' : '';
      s.t += dt;
      if (s.t >= STAMP_LIFE_S) { s.el.remove(); stamps.splice(i, 1); }
    }
  }

  /**
   * WAVE 23 (flow-fixes): the Hot / Cold lines are never cut short. HOT is its own line with the nearest Hot Lamp's name, its
   * distance and an 8-way arrow from the camera's view ("HOT · Bandit · 14m ↗"); COLD stacks on a second line. Full machine names.
   */
  const lampName = (e: LampEntry): string => lampLabel(machineName(e.machineId), e.dup);
  /** Up to two names, then "+N" for the rest. */
  const lampList = (list: LampEntry[]): string => {
    const names = list.slice(0, 2).map(lampName);
    if (list.length > 2) names.push(`+${list.length - 2}`);
    return names.join(', ');
  };
  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const fwdDir = new THREE.Vector3();
  /** Distance (whole metres) and the 8-way arrow from the player's view to a Lamp's slot; null without a world. */
  const lampBearing = (mid: InstanceId): { d: number; arrow: string } | null => {
    const w = app.world, p = app.player, cam = app.camera;
    const s = w?.slot(mid);
    if (!w || !p || !cam || !s) return null;
    const dx = s.pos[0] - p.pos.x, dz = s.pos[2] - p.pos.z;
    cam.getWorldDirection(fwdDir);
    const ahead = fwdDir.x * dx + fwdDir.z * dz;
    const lateral = -fwdDir.z * dx + fwdDir.x * dz;            // right-hand side, as the phone chip
    const k = ((Math.round(Math.atan2(lateral, ahead) / (Math.PI / 4)) % 8) + 8) % 8;
    return { d: Math.round(Math.hypot(dx, dz)), arrow: ARROWS[k] };
  };
  /** The short place name of a Lamp's slot zone ('' when the slot is unknown). */
  const lampZone = (mid: InstanceId): string => {
    const z = app.world?.slot(mid)?.zone;
    return z && has(`hud.zone.${z}`) ? t(`hud.zone.${z}`) : '';
  };
  /** The machine's short name for the HOT line: the name without its subtitle ("Blackjack (Yirmi Bir)" → "Blackjack"). */
  const hotName = (e: LampEntry): string => {
    const full = machineName(e.machineId);
    const short = full.replace(/\s*[("«].*$/, '').trim() || full;
    return lampLabel(short, e.dup);
  };
  /** The HOT line: nearest Hot Lamp, its zone (when asked), distance and arrow, "+N" for the other Hot Lamps. '' when none. */
  const hotLine = (list: LampEntry[], withZone: boolean): string => {
    if (list.length === 0) return '';
    let best: { e: LampEntry; d: number; arrow: string } | null = null;
    for (const e of list) {
      const b = lampBearing(e.mid);
      if (b && (!best || b.d < best.d)) best = { e, ...b };
    }
    const lead = best?.e ?? list[0];
    const where = withZone ? lampZone(lead.mid) : '';
    const parts = [where
      ? t('hud.lampChase.hotAt', { name: hotName(lead), where })
      : t('hud.lampChase.hot', { name: hotName(lead) })];
    if (best) parts.push(t('hud.lampChase.dist', { d: best.d, a: best.arrow }));
    if (list.length > 1) parts.push(`+${list.length - 1}`);
    return parts.join(' · ');
  };
  function renderLamps(): void {
    const v = lampsSeen;
    const hot = hotLine(v.hot, true);
    const cold = v.cold.length ? t('circuit.hud.cold', { name: lampList(v.cold) }) : '';
    setText(lampHot, hot);
    setText(lampCold, cold);
    const none = !hot && !cold && !!v.pocketShort;
    if (none) setText(lampHot, t('lamps.none'));
    // Onboarding: the Hot / Cold lines wait for Night 2 (disclose.ts); the Lamps stay in the game either way.
    setCls(lampsEl, 'hidden', voidOn || seated || !revealed(nightNow(), 'hot') || (!hot && !cold && !none));
    if (hot) fitHotLine(v.hot);
  }
  /** The HOT line stays one line in the top plate: when the line with its zone would wrap, the zone goes (the short name stays). */
  function fitHotLine(list: LampEntry[]): void {
    const wasHidden = lampsEl.classList.contains('hidden');
    setCls(lampsEl, 'hidden', false);   // measured while shown; a hidden plate reads as zero width
    if (lampHot.scrollWidth > lampHot.clientWidth + 1) setText(lampHot, hotLine(list, false));
    setCls(lampsEl, 'hidden', wasHidden);
  }
  function showLamps(v: LampView): void {
    lampsSeen = v;
    renderLamps();
  }
  const circuit0 = circuitView(app.run);
  if (circuit0) showLamps(circuit0.lamps());

  // ── events ──────────────────────────────────────────────────────────────────────────────────────
  /**
   * HOT / COLD / OVERHEAT on the machine the local player last played (`heatMid`): a banner with its sound when the streak starts
   * or a HOT stack goes up. A refresh at the same stacks is not news. Other machines and other players' streaks stay quiet here.
   */
  function onStreakBuff(owner: string, buff: BuffState): void {
    const base = buff.id.split(':')[0];
    if (!STREAK_IDS.has(base) || heatMid === null || owner !== `i:${heatMid}`) return;
    const key = `${owner}|${base}`;
    const prev = streakSeen.get(key) ?? 0;
    streakSeen.set(key, buff.stacks);
    if (buff.stacks <= prev) return;
    if (base === 'hot') {
      void ui().banner(t('hud.juice.hot', { n: buff.stacks }), { color: COLORS.shine, hold: 1.1, size: 16 });
      uiSfx('buffGain', 0.9);
    } else if (base === 'cold') {
      void ui().banner(t('hud.juice.cold'), { color: COLORS.ice, hold: 1.1, size: 16 });
      uiSfx('buffLose', 0.8);
    } else {
      void ui().banner(t('hud.juice.overheat'), { color: COLORS.coral, hold: 1.4, size: 16 });
      uiSfx('buffLose', 1);
      if (!calmOn()) app.fx.flash(0xc52129, 0.25, 0.35);
    }
  }

  /**
   * An overshoot tier crossed in the Watch (the NIGHT PLAN's OVERSHOOT line): the tier's name slams as a stamp, a gold burst, one
   * flash (not in calm), a sting by tier, and the OVERSHOOT line hops. The grant itself lands at Dawn (inGameState's receipt).
   */
  function overshootCrossed(tier: string): void {
    slamStamp(t(`hud.juice.over.${tier}`), 1 + 0.08 * Math.max(0, overTierLevel(tier)));
    goldBurst(root, '42%', 2);
    if (!calmOn()) app.fx.flash(0xffd34a, 0.2, 0.3);
    uiSfx(overTierSting(tier), 0.8);
    replayClass(planOver, 'hop');
  }

  /**
   * A charm set switched on (the active sets, from the charms the player holds): a toast, a gold burst on the charm strip, the new
   * set chip hops, and the chime. The first read of a run is silent (a set already on at the start is not news).
   */
  function setOn(id: SetId, chip: HTMLElement | undefined): void {
    ui().toast(t('hud.juice.setOn', { name: setChipName(id), desc: t(`hud.set.${id}.desc`) }), 'good', 4, `set:${id}`);
    goldBurst(charms, '50%', 1);
    if (chip) replayClass(chip, 'hop');
    uiSfx('chime', 0.9);
  }

  on('eco:wallet', ({ pid, delta }) => {
    if (pid !== self() || delta === 0) return;
    if (delta > 0) {
      // machine:result is emitted just before the payout, so a win that tier-scales the gain is still the last one seen.
      const idx = performance.now() - lastWin.at < WIN_LINK_MS ? lastWin.idx : 0;
      const win = idx >= SMALL;
      if (win) winPop(delta, idx);
      ui().fly({
        from: popOrigin(), to: 'wallet', text: win ? '' : signed(delta, money), color: COLORS.shine,
        onArrive: () => { ui().bump('wallet', 1 + Math.min(1, delta / 2000)); uiSfx('numberTick', 0.7); },
      });
    } else {
      // a spend (stake, purchase) is not an alarm: it bumps the figure, it does not turn it red
      ui().bump('wallet', 0.6);
    }
  });

  on('machine:result', ({ pid, machineId, tier, bet, gross, credited }) => {
    if (pid !== self()) return;
    const idx = tierIndex(tier);
    lastWin = { idx, at: performance.now() };
    if (idx < BIG) return;
    const mult = bet > 0 ? Math.round(gross / bet) : 0;
    addFeed(t('hud.feed.win', { who: t('hud.feed.you'), x: mult, machine: machineName(machineId) }), idx >= HUGE ? 'gold' : '');
    app.fx.hitstop(idx >= HUGE ? 0.08 : 0.04);
    ui().fly({ from: popOrigin(), to: 'wallet', text: t(`hud.tier.${tier}`), color: COLORS.bulb, dur: 1.0 });
    // A local huge (or above) machine win gets the title card with the rolling amount. Skipped in the QA fixed-step clock (the bench).
    if (idx >= HUGE && !FIXED_STEP && credited > 0) void ui().bigWin(credited, tier, t(`hud.tier.${tier}`));
  });

  // The local player's machine (the one they last played): its streak heat and the HOT / COLD / OVERHEAT banners follow it.
  on('machine:round', ({ pid, mid }) => { if (pid === self()) heatMid = mid; });
  on('buff:add', ({ owner, buff }) => onStreakBuff(owner, buff));
  on('buff:remove', ({ owner, id }) => { streakSeen.delete(`${owner}|${id.split(':')[0]}`); });

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

  // QUOTA MET: the quota box bumps and bursts. The stinger is decided a few frames later (update), so the quota_met cutscene that
  // the same event may start carries the one stinger and nothing stacks on it.
  on('quota:met', () => {
    addFeed(t('hud.feed.quotaMet'), 'gold');
    ui().bump('quota', 1.4);
    goldBurst(quota, '50%', 2);
    metStingerLeft = MET_STINGER_CHECK_S;
  });
  on('quota:failed', () => { addFeed(t('hud.feed.quotaFailed'), 'red'); });
  on('event:start', ({ id }) => { feedNews(t('hud.feed.event', { name: t(`event.${id}.name`) }), 'gold'); });
  on('event:end', ({ id }) => { feedNews(t('hud.feed.eventEnd', { name: t(`event.${id}.name`) }), ''); });
  // A floor event's spoken line (Tamsin's intro, the Clerk's ruling): the ambient subtitle lane
  on('floor:say', (l) => { subtitles.say({ text: l.text, speaker: l.speaker, voice: l.voice, lane: 'ambient', source: l.source }); });
  on('event:start', ({ id }) => { if (id.startsWith('watch.')) { uiSfx('popUp', 0.9); compereSay(id.slice('watch.'.length)); } });   // a Watch floor event: its banner comes with a sound and the Compere's line
  on('tycoon:milestone', ({ upgrade, level }) => {
    const name = has(`upg.${upgrade}.name`) ? t(`upg.${upgrade}.name`) : upgrade;
    addFeed(t('hud.feed.milestone', { name, n: level }), 'gold');
  });
  on('charm:add', ({ pid, charmId }) => { if (pid === self()) addFeed(t('hud.feed.charm', { name: t(`charm.${charmId}.name`) })); });
  // A second copy evolves its charm (no new peg): the peg hops with an EVOLVED pop and the upgrade sound, once it is rebuilt.
  on('charm:evolve', ({ pid, charmId }) => { if (pid === self()) evoPending.push(charmId); });
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
    if (!walletSeen) { roll.set(w, true); walletSeen = true; rollStart = w; }
    else {
      // a new rise starts where the figure is now: the ticks climb over that rise (a fall ticks nothing)
      if (w !== roll.target && w > roll.shown) rollStart = roll.shown;
      roll.set(w);
    }
    const moved = roll.tick(dt);
    // the rising roll ticks at most 12 Hz, pitched up with its progress (0 at the rise's start, an octave at its end)
    if (roll.target > roll.shown && rollGate.pass(dt, moved)) {
      rollTick((roll.shown - rollStart) / Math.max(1, roll.target - rollStart), 0.22);
    } else rollGate.pass(dt, false);
    setText(walletNum, `${coinSym()} ${money(roll.shown)}`);
    // red only while the pocket cannot cover the last thing asked for (the run refused it for funds)
    setCls(wallet, 'short', r.lastRefusal() === 'funds');
    setCls(pulls, 'short', r.lastRefusal() === 'pulls');
    const tk = r.balance('ticket', self());
    if (tk > 0) ticketsSeen = true;
    setCls(tix, 'hidden', !ticketsShown(ticketsSeen, tk));
    setText(tixNum, String(tk));
    const perMin = r.tycoon.incomePerSec() * 60;
    setCls(staff, 'hidden', perMin <= 0);
    setText(staff, t('hud.staff.perMin', { n: money(Math.round(perMin)) }));
  }

  function updateClock(dt: number): void {
    const r = app.run;
    const sh = r?.shift.state();
    const phase = sh?.phase ?? 'idle';
    const left = r ? r.shift.timeLeft() : 0;
    // Bell: the Watch's start. The Starter Draft holds the Bell (its own timer shows instead); otherwise the Bell counts down its 2 s.
    const bell = phase === 'bell';
    if (bell && lastPhase !== 'bell') bellLeft = BELL_SEC;
    const starter = bell ? (r as (typeof r & { starterDraft?: () => { left: number } | null }) | null)?.starterDraft?.() ?? null : null;
    if (bell && !starter) bellLeft = Math.max(0, bellLeft - dt);
    const bellN = Math.max(1, Math.ceil(starter ? starter.left : bellLeft));
    const lastCall = phase === 'lastCall';
    // Intermission (MOLA): the top line says what to do next, not the Watch clock.
    const interm = phase === 'intermission';
    setCls(clock, 'lastcall', lastCall);
    setCls(clock, 'interm', interm);
    // Settle (wave 42, decision 2): the bank stays open and the top line counts down to the lever, one line, no clock number.
    const settling = phase === 'settle';
    const settleSec = settling ? Math.ceil((r as (typeof r & { bank?: () => BankView }) | null)?.bank?.()?.settleLeft ?? 0) : 0;
    setText(clockNum, interm || settling ? '' : mmss(left));
    // Closing (director wave 41): the last 3 s of a Watch, the deposits / withdrawals / Pawn still open, so the label says so.
    setText(clockPhase, interm ? t('interm.topBar') : settling ? t('bank.settle', { s: settleSec }) : bell ? t('hud.clock.bell', { s: bellN }) : phase === 'closing' ? t('hud.clock.closing') : lastCall ? t('hud.clock.lastCall') : r?.window() === 'dawn' ? t('hud.clock.dawn') : t('hud.clock.watch'));
    if (phase !== lastPhase) {
      if (lastCall && !clockAlarmed) {
        clockAlarmed = true;
        void ui().banner(t('hud.clock.lastCall'), { hold: 1.2, size: 16, color: COLORS.signal });
        feedNews(t('hud.feed.lastCall'), 'red');
        uiSfx('clockAlarm', 1);
      }
      lastPhase = phase;
    }
    if (r !== elapsedRun) { elapsedRun = r; elapsedSim = 0; elapsedSeen = app.time.sim; }
    elapsedSim += Math.max(0, app.time.sim - elapsedSeen);
    elapsedSeen = app.time.sim;
    setText(elapsedEl, r ? mmss(elapsedSim) : '');
    if (r) {
      const n = r.night();
      const seg = sh?.segment;
      // Intermission: the night number only (the Watch segment belongs to the Watch clock, which is not running).
      setText(night, seg && !interm ? t('hud.night', { n, w: seg.index + 1, c: seg.count }) : t('hud.nightBare', { n }));
    }
  }

  /**
   * The quota bar: a rise shows its pale ghost at the new width at once and the amber fill grows into it; a fall drops the fill fast
   * and the ghost drains after it. Ticks sound as the fill crosses 25 / 50 / 75 / 100 % (not on the Night's first read).
   */
  function setQuotaBar(frac: number, night: number): void {
    const pct = Math.round(frac * 1000) / 10;
    const w = `${pct}%`;
    if (quotaPct < 0 || night !== quotaNight) {
      quotaNight = night;
      quotaPct = pct;
      quotaGhost.style.transition = 'none';
      quotaFill.style.transition = 'none';
      quotaGhost.style.width = w;
      quotaFill.style.width = w;
      return;
    }
    if (pct === quotaPct) return;
    if (pct > quotaPct) {
      quotaGhost.style.transition = 'none';
      quotaGhost.style.width = w;
      quotaFill.style.transition = reduceMotion() ? 'none' : 'width .45s steps(8)';
    } else {
      quotaFill.style.transition = reduceMotion() ? 'none' : 'width .12s steps(3)';
      quotaGhost.style.transition = reduceMotion() ? 'none' : 'width .6s ease-out .15s';
      quotaGhost.style.width = w;
    }
    quotaFill.style.width = w;
    for (const m of quotaCrossings(quotaPct, pct)) uiSfx('numberTick', m === 100 ? 0.9 : 0.6);
    quotaPct = pct;
  }

  function updateQuota(dt: number): void {
    const r = app.run;
    if (!r) return;
    const q = r.shift.quota();
    const due = Math.max(0, q.due);
    const dep = Math.max(0, q.deposited);
    const frac = due > 0 && !nightPaid(r) ? Math.min(1, dep / due) : 1;
    // the deposited figure rolls toward the amount (the Roller, as the wallet's), a Night's first read sets it at once
    if (!quotaSeen) { quotaRoll.set(dep, true); quotaSeen = true; } else quotaRoll.set(dep);
    quotaRoll.tick(dt);
    setText(quotaNum, `${money(Math.round(quotaRoll.shown))} / ${money(due)}`);
    setQuotaBar(frac, r.night());
    const paid = nightPaid(r);
    const met = paid || q.met || (due > 0 && dep >= due);
    if (paid) setText(quotaNum, t('hud.paidTag', { n: r.night() }));   // short tag: it must not clip the top banner
    setCls(quota, 'met', met);
    setCls(quota, 'short', !met);
    const late = r.shift.phase === 'lastCall' || r.shift.timeLeft() < 30;
    setCls(quota, 'late', !met && late);
    setText(quotaShort, met || paid ? '' : t('hud.quota.short', { n: money(Math.max(0, due - dep)) }));
  }

  /** A source's name on the PAYOUT chip: the Night's own House sources by kind, a charm or buff by its name, else its id. */
  function payoutSourceLabel(id: string, op: 'mult' | 'inc'): string {
    if (id.startsWith('mood:')) return t('payout.mood');
    if (id.startsWith('night:')) return op === 'inc' ? t('payout.witch') : t('payout.favour');
    if (id.startsWith('watch.') && has(`event.watch.${id.slice(6)}.name`)) return t(`event.watch.${id.slice(6)}.name`);
    if (has(`charm.${id}.name`)) return t(`charm.${id}.name`);
    if (has(`buff.${id}.name`)) return t(`buff.${id}.name`);
    return id.toUpperCase();
  }

  /**
   * PAYOUT chip (wave 47): in play, the parts are the run's own payout.mult breakdown with no machine (the global sources); in Mola,
   * the next Watch's preview (mood, House Favour, the Witching bonus). Re-read a few times a second; the DOM is written on change only.
   */
  function updatePayout(dt: number): void {
    payoutLeft -= dt;
    if (payoutLeft > 0) return;
    payoutLeft = PAYOUT_REFRESH_S;
    // Onboarding: the PAYOUT chip (House Favour, Mood, air) waits for Night 2 (disclose.ts).
    if (!revealed(nightNow(), 'payout')) { setCls(payout, 'hidden', true); payoutKey = ''; return; }
    const r = app.run;
    const q = r?.shift.quota();
    const sh = r?.shift.state();
    const seg = sh?.segment;
    const phase = sh?.phase ?? 'idle';
    const live = PAYOUT_LIVE_PHASES.has(phase);
    const mola = phase === 'intermission';
    if (!r || !q || !(q.due > 0) || !(live || (mola && seg))) {
      setCls(payout, 'hidden', true);
      payoutKey = '';
      return;
    }
    let parts: PayoutPart[];
    let label: string;
    if (live) {
      const br = r.explain('payout.mult', '', 1, { pid: self() });
      parts = [];
      for (const s of br.steps) {
        if (s.op !== 'mult' && s.op !== 'inc') continue;
        parts.push({ label: payoutSourceLabel(s.source.id, s.op), op: s.op, value: s.value });
      }
      label = t('payout.label');
    } else {
      // Mola: the segment still names the Watch just settled, so the next Watch is one on.
      parts = houseMoodPreviewParts(r.night() - 1, seg?.count ?? 0, (seg?.index ?? 0) + 1);
      label = t('payout.next');
    }
    const view = payoutChip(parts);
    const key = `${label}|${view.totalText}|${view.totalTone}|${view.parts.map((p) => `${p.tone}:${p.text}`).join('|')}`;
    setCls(payout, 'hidden', false);
    if (key === payoutKey) return;
    payoutKey = key;
    payout.replaceChildren();
    // The total's × sits in its own span: the pixel face's × rides high on the body line, so .mx drops it to the baseline (hud.css).
    const tot = h('span', `tot ${view.totalTone}`, payout, `${label} `);
    h('span', 'mx', tot, '×');
    tot.append(view.totalText.replace('×', ''));
    for (const p of view.parts) {
      if (p.tone === 'flat') continue; // a zero part (MOOD 0%) adds nothing to the win: not shown
      h('span', 'sep', payout, '·');
      h('span', p.tone, payout, p.text);
    }
    h('span', 'note', payout, t('payout.note'));
  }

  /**
   * NIGHT PLAN: shown in the Watches (not at Dawn, not once the Night is paid). The projection is the bank compounded over the
   * Settles still to come, plus the pocket. Written on change only; green when it covers the quota, red with the gap otherwise.
   */
  function updatePlan(): void {
    const r = app.run;
    const q = r?.shift.quota();
    const sh = r?.shift.state();
    const seg = sh?.segment;
    if (r && planNight !== r.night()) { planNight = r.night(); settledAt = -1; overSeen = null; }
    if (seg && sh?.phase === 'settle') settledAt = seg.index;
    // The bank view is on the real run (DebtRun), not on the RunApi facade: probe it as `empire()` is probed above.
    const bank = (r as (typeof r & { bank?: () => BankView }) | null)?.bank?.();
    // BREAK THE SEAL: the terminal's "forfeits tonight's overshoot" confirm is answered, and the overshoot toast of this Night
    // is stale (its rewards are forfeit), so both leave the screen at once: the result toast gets the slots. Once per break:
    // the flag clears when the seal is whole again (a new Night).
    const broken = bank?.sealBroken === true;
    if (broken && !sealBrokeSeen) {
      ui().dismissToasts({ kind: 'warn' });
      ui().dismissToasts({ tag: 'overshoot' });
    }
    sealBrokeSeen = broken;
    // Dawn and Mola (wave 55): the NEXT NIGHT line, the exact quota of the coming Night, replaces the Watch plan.
    const next = r && (r.window() === 'dawn' || nightPaid(r))
      ? (r as (typeof r & { nextQuotaPreview?: () => NextQuotaPreview | null }) | null)?.nextQuotaPreview?.() ?? null
      : null;
    if (r && next && bank) { showNextNight(next, bank.pocket, bank.balance); return; }
    const show = !!r && !!q && !!seg && !!bank && q.due > 0 && r.window() === 'watch' && !nightPaid(r);
    setCls(plan, 'hidden', !show);
    // The broke line leaves with the plan: home, Dawn, a paid Night, a Night change. planKey resets so it redraws when it returns.
    if (!show) { setCls(planBroke, 'hidden', true); setText(planBroke, ''); planKey = ''; }
    // The Watch tithe: run.watchTithe() reports { on, target, earned, met, shortfall, added } (src/game/checkpoints.ts). Probed
    // like the other optional run views, so a run without it reads null and the tithe lines stay hidden.
    const tithe = (r as (typeof r & { watchTithe?: () => { on: boolean; earned: number; target: number; added?: number } | null }) | null)?.watchTithe?.() ?? null;
    const titheN = tithe?.on ? Math.floor(tithe.target) : 0;
    const titheE = tithe?.on ? Math.max(0, Math.floor(tithe.earned)) : 0;
    const titheOn = titheN > 0;
    if (!r || !q || !seg || !bank || !show) return;
    // OVERSHOOT: a tier reached in the Watch toasts once per Night (the grant itself lands at Dawn). The first read of a Night is
    // silent, so a Night that opens already past a tier does not toast. Runs before the key check: a new tier always moves the balance.
    const ov = (r as (typeof r & { overshootView?: () => OvershootView }) | null)?.overshootView?.() ?? null;
    if (ov && revealed(nightNow(), 'overshoot')) {
      if (overSeen === null) overSeen = ov.reached;
      else if (ov.reached > overSeen && ov.tier) {
        overSeen = ov.reached;
        ui().toast(t('hud.plan.overToast', { r: t(`hud.plan.ov.${ov.tier}`) }), 'good', 4, 'overshoot');
        overshootCrossed(ov.tier);
      }
    }
    const due = Math.max(0, Math.floor(q.due));
    // Watches already settled this Night: in a Watch the current one is not yet; at an intermission the segment still names the
    // Watch just settled (when one did), and the Night's first intermission has none. The last line names the next Watch.
    const interm = sh?.phase === 'intermission';
    const done = interm && settledAt === seg.index ? seg.index + 1 : seg.index;
    const watch = done + 1;
    const settles = seg.count - done;
    const p = dawnPlan({ due, balance: bank.balance, settles, interestAt: bank.interestAt });
    const pocket = Math.max(0, Math.floor(bank.pocket));
    // The Watch ends at 0 pulls, at the clock, or at the Bell (the Debt Terminal).
    const pulls = r.pulls(self());
    const pullsTxt = Number.isFinite(pulls) ? String(Math.max(0, Math.floor(pulls))) : '∞';
    const clock = mmss(r.shift.timeLeft());
    // The unpaid tithe: the quota the missed Watches added, kept until the Night ends (run.watchTithe().added, on or off a Watch).
    const unpaid = Math.max(0, Math.floor(tithe?.added ?? 0));
    // The broke hint: only while the pocket cannot cover the cheapest bet (brokeHelp is null otherwise) and tonight's quota is unpaid.
    const paidNow = bank.balance >= due;
    const help = (r as (typeof r & { brokeHelp?: () => BrokeHelp | null }) | null)?.brokeHelp?.() ?? null;
    const brokeTxt = !paidNow && help ? brokeHint(help.steps) : '';
    const key = `${nightNow()}|${due}|${watch}|${seg.count}|${bank.balance}|${pocket}|${interm}|${p.projected}|${p.gap}|${pullsTxt}|${clock}|${titheE}/${titheN}|${unpaid}|${brokeTxt}|${broken ? 1 : 0}`;
    if (key === planKey) return;
    planKey = key;
    setCls(planNext, 'hidden', true);
    setCls(planBank, 'hidden', false);
    setCls(planEnds, 'hidden', false);
    const titheShown = revealed(nightNow(), 'tithe');
    setCls(planTithe, 'hidden', !titheOn || !titheShown);
    if (titheOn) {
      setText(planTithe, t('hud.plan.tithe', { n: titheN, e: titheE }));
      // Green once the Watch has paid the tithe in play; amber while it is still a target (the plan's own colour read as a note).
      planTithe.style.color = titheE >= titheN ? 'var(--green)' : '#ffd34a';
    }
    setCls(planUnpaid, 'hidden', unpaid <= 0 || !titheShown);
    if (unpaid > 0) setText(planUnpaid, t('hud.plan.unpaid', { n: money(unpaid) }));
    setCls(planBroke, 'hidden', !brokeTxt);
    setText(planBroke, brokeTxt);
    setCls(plan, 'ok', p.met);
    setCls(plan, 'gap', !p.met);
    // Green when the projection covers the quota, red otherwise (the plan classes below); one wording for both.
    // Quota paid before the Dawn: no quota-left line, the surplus that returns at Dawn instead.
    // Onboarding: Night 1 reads the bank against the quota (no Dawn projection until Night 2, disclose.ts).
    setText(planBank, paidNow
      ? t('hud.plan.paid', { n: money(p.surplus) })
      : revealed(nightNow(), 'projection')
        ? t('hud.plan.bank', { p: money(p.projected), q: money(due) })
        : t('hud.plan.bankNow', { p: money(bank.balance), q: money(due) }));
    setCls(planPocket, 'hidden', pocket <= 0);
    setText(planPocket, t('hud.plan.pocket', { p: money(pocket) }));
    // OVERSHOOT line: once the quota is banked. A broken seal forfeits tonight's tiers (overshootView is then null), so the line
    // says so in red. Otherwise the next tier's target and the coins to go; past the top tier, a plain line.
    setCls(planOver, 'hidden', !(broken || (ov && paidNow)) || !revealed(nightNow(), 'overshoot'));
    if (broken) {
      setText(planOver, t('hud.plan.overForfeit'));
      planOver.style.color = '#ff5a4a';
    } else if (ov && paidNow) {
      const nx = ov.next;
      setText(planOver, nx
        ? t('hud.plan.over', { b: money(ov.balance), q: money(nx.target), r: t(`hud.plan.ov.${nx.id}`), g: money(nx.gap) })
        : t('hud.plan.overTop'));
      planOver.style.color = nx ? '#ffd34a' : 'var(--green)';
    }
    setText(planEnds, interm
      ? t('hud.plan.next', { w: watch, n: seg.count })
      : t('hud.plan.ends', { w: watch, n: seg.count, p: pullsTxt, c: clock }));
  }

  /**
   * NEXT NIGHT (wave 55): at Dawn and in Mola the NIGHT PLAN is this one line, the exact quota of the coming Night and its step
   * from tonight's (×k). It turns red when the quota is above what the player holds: pocket + 2 × bank. A projected Dawn (not yet
   * paid) reads the same way. Written on change only.
   */
  function showNextNight(next: NextQuotaPreview, pocketRaw: number, bankRaw: number): void {
    const pocket = Math.max(0, Math.floor(pocketRaw));
    const banked = Math.max(0, Math.floor(bankRaw));
    const red = next.due > pocket + 2 * banked;
    const key = `N|${next.night}|${next.due}|${next.k}|${red}|${next.projected}`;
    setCls(plan, 'hidden', false);
    if (key === planKey) return;
    planKey = key;
    const k = next.k.toFixed(1).replace('.', lang() === 'tr' ? ',' : '.');
    setCls(plan, 'ok', false);
    setCls(plan, 'gap', red);
    setCls(planNext, 'hidden', false);
    planNext.style.color = red ? '#ff5a4a' : '';
    setText(planNext, t('hud.plan.night', { q: money(next.due), k }));
    for (const el of [planBank, planOver, planPocket, planBroke, planEnds, planTithe, planUnpaid]) setCls(el, 'hidden', true);
  }

  function updateEmpire(): void {
    const r = app.run as (typeof app.run & { empire?: () => { count: number; perWatch: number } }) | null;
    const e = r?.empire?.();
    const key = e ? `${e.count}|${e.perWatch}` : '';
    if (key === empireKey) return;
    empireKey = key;
    setCls(empire, 'hidden', !e || e.count <= 0);
    if (e && e.count > 0) setText(empireNum, `${t('prog.empire', { n: e.count })}  ${t('prog.empire.income', { n: money(e.perWatch) })}`);
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
        pegs.push({ el, face: h('span', 'face', el, initial(name)), base: initial(name), name, text: '', title: '' });
      }
      // Archetype set chips (sets.ts) next to the pegs: one per set switched on by the held charms. Rebuilt with the pegs. A set
      // that was not on before its chip appears is news: the set-on toast, burst, hop and chime.
      const sets = activeSets(list, (id) => charmDef(id)?.tags);
      const chips = renderSetChips(charmRow, sets);
      const prevSets = setsSeen;
      if (prevSets) sets.forEach((s, i) => { if (!prevSets.includes(s)) setOn(s, chips[i]); });
      setsSeen = sets;
    }
    // An evolved charm: its peg (rebuilt above when the stacks changed) hops with an EVOLVED pop and the upgrade sound.
    for (const id of evoPending.splice(0)) {
      const el = charmRow.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (el) replayClass(el, 'hop');
      procPops.show(t('hud.evo.label'), 2);
      uiSfx('upgrade', 0.9);
    }
    // Live counters: the face shows the charm's counter (3/6, +16%) when it has one, else its initial. Written on change only.
    for (let i = 0; i < pegs.length && i < list.length; i++) {
      const peg = pegs[i];
      // The peg's hover title is the full readout ("PRESSURE 3/8 · next win ×1.3"), or the charm name when it has none.
      const title = pegLabel(list[i].id, list[i].data) || peg.name;
      if (title !== peg.title) { peg.title = title; peg.el.title = title; }
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
    // Metres, spaced like the lamp chase (`hud.lampChase.dist`), so "12 m" cannot read as twelve minutes.
    return `${lateral >= 0 ? '→' : '←'} ${Math.round(best)} m`;
  }

  function updateFeed(dt: number): void {
    for (const ln of feedLines) {
      ln.age += dt;
      setCls(ln.el, 'old', ln.age > FEED_LIFE - 0.6);
    }
    while (feedLines.length && feedLines[0].age > FEED_LIFE) feedLines.shift()?.el.remove();
  }

  /** The Hot line follows the player: its distance and arrow are re-read a few times a second while a Hot Lamp is lit. */
  let chaseLeft = 0;
  function updateLamps(dt: number): void {
    chaseLeft -= dt;
    if (chaseLeft > 0 || lampsSeen.hot.length === 0 || seated || voidOn) return;
    chaseLeft = CHASE_S;
    renderLamps();
  }

  /** Hides the pit's lamp lines while the player is down in THE UNDERNEATH (zone `hollow`); shows them again on the way up. */
  function updateVoid(): void {
    const v = inUnderneath();
    if (v === voidOn) return;
    voidOn = v;
    renderLamps();
  }

  /** Watch floor event: name, Minute timer, and a Lucky Lamp's pulls left. Hidden between Watches and on boss Nights. */
  function updateWatchEvent(): void {
    const v = revealed(nightNow(), 'floorEvents') ? watchEventView() : null;
    if (!v) { setCls(watchEl, 'hidden', true); setCls(watchInfo, 'hidden', true); return; }
    const pulls = v.pulls !== null ? `  ${t('event.watch.hud.pulls', { n: v.pulls })}` : '';
    setText(watchTxt, `${t(`event.watch.${v.id}.name`)}  ${mmss(v.leftS)}${pulls}`);
    setCls(watchEl, 'hidden', false);
    // one line: the event's state, with the floor key named where the player presses it (N: dare or bid)
    const info = v.info ? t(v.info.key, { ...v.info.vars, key: app.input.keyLabel(v.id === 'crooked_table' ? CALL_KEY : FLOOR_KEY) }) : '';
    setText(watchInfo, info);
    setCls(watchInfo, 'hidden', info === '');
  }

  /** THE KEEPSAKE STAKE (wave 75): at a seat, with a keepsake carried and not yet staked this Night, one line names the key. */
  function updateKeepsakeHint(): void {
    const r = app.run as Partial<DebtRun> | null;   // the bench stub run has no keepsakes
    const id = r && app.player?.seat != null && r.keepsakeFreeTonight?.() ? (r.keepsakeCarried?.() ?? null) : null;
    if (!id) { setCls(keepHint, 'hidden', true); return; }
    setText(keepHint, t('keepsake.seat.hint', { key: app.input.keyLabel(KEEPSAKE_KEY), name: t(`keepsake.${id}.obj`) }));
    setCls(keepHint, 'hidden', false);
  }

  /** The Compere's one line for a floor event that has one (the five wave 75 events): the subtitles, speaker COMPERE. */
  function compereSay(evId: string): void {
    if (has(`event.watch.${evId}.compere`)) subtitles.say(compereLine(evId));
  }

  function updateDread(): void {
    const d = app.run ? Math.max(0, Math.min(1, app.run.dread())) : 0;
    dread.style.opacity = String(Math.min(1, 0.35 * d));
  }

  /**
   * HEAT meter: the streak heat of the machine the player played last. The run reads it through the optional `streakHeat(mid)`
   * probe (like the other optional run views); without the probe, or with no heat, the meter stays hidden. Amber to red, and it
   * blinks above 75.
   */
  function updateHeat(): void {
    const r = app.run as (typeof app.run & { streakHeat?: (mid: InstanceId) => number }) | null;
    const v = r?.streakHeat && heatMid !== null ? r.streakHeat(heatMid) : 0;
    const pct = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
    setCls(heatEl, 'hidden', pct <= 0);
    if (pct <= 0) { heatPct = -1; return; }
    if (pct === heatPct) return;
    heatPct = pct;
    const tone = heatTone(pct);
    if (tone.color !== heatColor) { heatColor = tone.color; heatFill.style.background = tone.color; }
    heatFill.style.width = `${pct}%`;
    setCls(heatEl, 'blink', tone.blink);
  }

  /**
   * The QUOTA MET stinger, once the event's frame has passed: a quota_met cutscene that started (it carries its own stinger) takes
   * the lead, and only a met quota with no scene on plays the stinger here.
   */
  function updateMetStinger(dt: number): void {
    if (metStingerLeft <= 0) return;
    metStingerLeft -= dt;
    if (metStingerLeft > 0) return;
    metStingerLeft = 0;
    if (app.cutscene.playing === null) {
      try { app.audio.music.stinger('quotaMet', { vol: 0.8 }); } catch { /* the stinger is optional */ }
    }
  }

  /**
   * THE EVENING card: at home (run.homeStage() set) the pit's stack and modifier rows give way to it (`.evening-on` on the root,
   * evening.css). The objective is the next Night's quota; Harmony and Heat are the spouse's and the Collector's read-outs.
   */
  function updateEvening(): void {
    const r = app.run;
    const stage = (r as (typeof r & { homeStage?: () => string | null }) | null)?.homeStage?.() ?? null;
    // the prologue (wave 72) is in the apartment before Night 1: the pit stack gives way to the card here too
    const pro = (r as (typeof r & { prologueOn?: () => boolean }) | null)?.prologueOn?.() === true;
    const at = !!r && (stage !== null || pro);
    setCls(root, 'evening-on', at);
    if (!r || !at) return;
    const ph = r.homePhone();
    const harmony = ph?.harmony() ?? 0;
    const heat = ph?.heat() ?? 0;
    const next = (r as typeof r & { nextQuotaPreview?: () => NextQuotaPreview | null }).nextQuotaPreview?.() ?? null;
    const key = `${harmony}|${heat}|${next ? next.due : -1}`;
    if (key === evKey) return;
    evKey = key;
    setText(evObj, next ? t('hud.evening.objective', { q: money(next.due) }) : t('hud.evening.rest'));
    harmPips.forEach((p, i) => setCls(p, 'on', i < harmony));
    heatPips.forEach((p, i) => setCls(p, 'on', i < heat));
  }

  return {
    el: root,
    update(dt: number): void {
      updateWallet(dt);
      updateClock(dt);
      updateEvening();
      updateQuota(dt);
      luckRender();
      updatePayout(dt);
      updatePlan();
      updateEmpire();
      updateBuffs(dt);
      updatePulls();
      updateCharms();
      updatePhone(dt);
      updateVoid();
      updateLamps(dt);
      updateWatchEvent();
      updateKeepsakeHint();
      updateFeed(dt);
      updateDread();
      updateWinRolls(dt);
      updateStamps(dt);
      updateHeat();
      updateMetStinger(dt);
    },
    setVisible(show: boolean): void { ui().setHudVisible(show); },
    setCallHint(on: boolean): void {
      if (on) setText(callHint, t('event.watch.crooked_table.prompt', { key: app.input.keyLabel(CALL_KEY) }));
      setCls(callHint, 'hidden', !on);
    },
    setPrompt(p: HudPrompt | null): void {
      if (!p) { ui().prompt(null); return; }
      ui().prompt({ action: p.action, label: p.label, sub: p.sub });
    },
    dispose(): void {
      for (const off of disposers.splice(0)) off();
      for (const [id] of anchors) ui().setAnchor(id, null);
      procPops.dispose();
      topRo?.disconnect();
      rsRo?.disconnect();
      SeatHud.stakeSource = () => ({ self: -1, pocket: 0 });
      host?.style.removeProperty('--hud-top-h');
      host?.style.removeProperty('--hud-rs-b');
      host?.classList.remove('seated');
      root.remove();
    },
  };
}

/**
 * SPOTLIGHT chip (wave 55): the Night's spotlight machine, its x1.25 and the plays toward the next Ticket, in the right stack.
 * Driven by the `spotlight:change` event (null hides it). On mount it reads the run's current spotlight, when the run exposes one.
 */
export function mountSpotlightChip(parent: HTMLElement): () => void {
  const chip = h('div', 'hb spotlight hidden', parent);
  chip.style.color = '#ffd34a';
  let key = '';
  const show = (raw: SpotlightView | null): void => {
    const v = raw && revealed(app.run?.night() ?? 1, 'spotlight') ? raw : null;   // onboarding: the Spotlight waits for Night 4
    if (!v) { setCls(chip, 'hidden', true); key = ''; return; }
    const text = spotlightChip(v, machineName(v.machineId));
    setCls(chip, 'hidden', false);
    if (text === key) return;
    key = text;
    setText(chip, text);
  };
  const off = bus.on('spotlight:change', show);
  const run = app.run as (typeof app.run & { spotlightView?: () => SpotlightView | null }) | undefined;
  show(run?.spotlightView?.() ?? null);
  return () => { off(); chip.remove(); };
}
