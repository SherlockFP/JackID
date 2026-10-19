/**
 * THE HOTLINE (game side): CloverPit-style phone bargains. The booth (`machines/hotline`) is only a view of this module.
 *
 *   • Night 1 never rings. From Night 2 the phone may ring once per Watch: a seeded ~45 % chance (`x.phone.callChance`; Coiled
 *     Cord = 100 %, Blank JackID's `x.phone.mute` = never). The FIRST Watch of every Night always rings; a Night still silent at
 *     its last Watch gets a call there too.
 *   • It rings for 20 s (`x.phone.ringTime` adds), then the caller offers THREE deals. Pick one (1 / 2 / 3), within 15 s.
 *   • A deal is a boon with a price. Everything is expressed through the existing pipeline: buffs (`run.buffs`, which fold into
 *     `run.mod()`), `earn` / `spend`, `grantCharm`, `addDread`, `shift.extend`, `jackpotAdd`. Three run-private actions have no
 *     RunApi member yet and come in through the optional `HotlineHost` (see the WIRING list in the work report).
 *   • Costs scale with `x.phone.dealCost` (Coiled Cord ×0.75) where the cost is a number the module itself applies (pocket %,
 *     Dread, Tickets). Buff-priced costs are fixed.
 *
 * Determinism: every roll comes from `hashSeed('hotline.*', run.seed, night, watch[, callId])`, never from a running stream, so
 * the same run state gives the same calls and offers whatever the order of play, and a save needs no rng state. The only clock
 * is `tick(dt)` (sim seconds); `ringingSince` uses `opts.now()` (host ms, as the booth compares it with `net.hostTime()`).
 *
 * Drive it: `phone()` / `answer(choice)` back `RunApi.phone()` / `answerPhone()`, `tick(dt)` from the run's tick, `snapshot()` /
 * `restore()` under `RunExt`, `dispose()` with the run. The Watch phases are read from the bus (`shift:phase`, `run:window`).
 */
import { bus } from '@/core/events';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { registerStrings } from '@/core/i18n';
import type { BuffDef, RunApi } from '@/game/types';
import type { PhoneCallState } from '@/net/protocol';
import type { PlayerId } from '@/core/types';
import { allCharmDefs } from '@/game/charms/engine';
import STR from '@/game/hotline.strings';
import { charmPrice } from '@/game/economy';
import { ringTotal } from '@/machines/hotline/rules';
import { STOKER_WING } from '@/game/data/rooms';
import { locksmithZone } from '@/game/rooms';
import { storyCallFor } from '@/game/story/calls';
import { PHONE_HOUR, PHONE_MINUTE } from '@/game/hollow/rules';

declare module '@/core/events' {
  interface GameEvents {
    /** Mira's wrong-number call (lore lane): picked up on the first Watch of its Night; the host plays the subtitles. */
    'phone:story': { callId: number; id: string; speaker: string; lines: string[] };
  }
}

// ── tuning ───────────────────────────────────────────────────────────────────────────────────────────
export const CALL_CHANCE = 0.45;
export const RING_SECONDS = 20;
export const ANSWER_SECONDS = 15;
/** The call lands between these fractions of the Watch clock (clear of the Bell and of Last Call). */
export const RING_FROM = 0.2;
export const RING_TO = 0.65;
export const OFFER_COUNT = 3;
export const CALL_LINES = 6;
/** Machine id the hotline uses for `run.mod()` queries (run-level hooks, no machine). */
const MID = 'hotline';

/** Values a deal carries: numbers for the text and the apply step, strings starting '@' are i18n keys resolved at render. */
export type DealVars = Record<string, number | string>;

/** Run-private actions with no RunApi member. All optional; a missing one makes its deal fall back or step aside. */
export interface HotlineHost {
  /** Special rooms: whether a wing is still closed (sealed or key ready). Missing = the Locksmith and Stoker deals are off. */
  wingClosed?(zone: string): boolean;
  /** Special rooms: opens a wing now, for free (the tycoon's `grantZone`). False = refused. Missing = the Locksmith and Stoker deals are off. */
  openWing?(zone: string): boolean;
  /** +n pulls now (negative takes pulls away). Fallback: three Tickets per pull. */
  addPulls?(n: number): void;
  /** Pays `coins` of the current quota without touching the wallet (the Tickets-to-quota deal). */
  creditQuota?(coins: number): void;
  /** The Hot Lamp the next Bell will roll (same seeded roll as `rollLamps`), or null when it has none. */
  previewNextHot?(): { mid: string; machineId: string } | null;
  /** The Hollow Door: the 3:33 call with no caller may ring this Watch (run rules: Night 2+, door unused, phone not spent). */
  hollowCanRing?(): boolean;
  /** The 3:33 call starts ringing (the door goes to `ringing`). False = it does not ring after all. */
  hollowRing?(): boolean;
  /** The 3:33 call was answered ('godown' opens the door) or spent ('hangup': missed, declined or hung up). */
  hollowAnswer?(choice: 'godown' | 'hangup'): boolean;
}

export interface HotlineOpts {
  host?: HotlineHost;
  /** Host ms clock for `ringingSince`: PASS `() => net.hostTime()` (offline that is performance.now()). The booth measures the ring against it; the default 0 is for tests. */
  now?: () => number;
}

export interface Offer { id: string; v: DealVars }
/** The ring length of the call on screen, sent right after `phone:ring` (the HUD arc divides by it). */
declare module '@/core/events' {
  interface GameEvents { 'phone:length': { callId: number; seconds: number } }
}

/** `ringSecs`: the ring length this call was given (base 20 s plus `x.phone.ringTime`), kept so a restore re-sends it. */
interface CallRec { id: number; script: string; ringingSince: number; answeredBy: number | null; offers: Offer[]; ringSecs?: number; hollow?: boolean }

/** The Hollow Door's 3:33 call: the Watch dial reads 12 hours, so 3:33 is 3h33m of the 12 (the Watch is the Night clock). */
export const HOLLOW_CALL_CHANCE = 0.25;   // per Watch from Night 2, while the door is unused and the phone not spent
const NIGHT_CLOCK_FRAC = (PHONE_HOUR + PHONE_MINUTE / 60) / 12;
const HOLLOW_SCRIPT = 'hotline.call.hollow';
const HOLLOW_OFFERS: readonly Offer[] = [{ id: 'hollow.godown', v: {} }, { id: 'hollow.hangup', v: {} }];

/** JSON-safe state, stored under `RunExt.hotline`. */
export interface HotlineSave {
  v: 1;
  nextId: number;
  live: boolean;
  night: number;
  watch: number;
  elapsed: number;
  /** Sim seconds into the Watch when the call lands; -1 = none left this Watch. */
  ringAt: number;
  rangThisNight: number;
  call: CallRec | null;
  ringLeft: number;
  answerLeft: number;
  /** Nights whose Mira call (story lane) already played. Optional: older saves have none. */
  story?: number[];
  /** The next scheduled call (`ringAt`) is the Hollow Door's 3:33 call. Optional: older saves have none. */
  hollowAt?: boolean;
}

export interface Outcome { ok: boolean; note: string; vars: DealVars }

export interface HotlineResultEvent {
  callId: number;
  kind: 'deal' | 'missed' | 'declined';
  /** Deal id ('' for a missed or declined call). */
  deal: string;
  ok: boolean;
  /** i18n key of the result line and its vars (values starting '@' are keys). */
  note: string;
  vars: DealVars;
}
declare module '@/core/events' {
  interface GameEvents { 'hotline:result': HotlineResultEvent }
}

export interface Hotline {
  phone(): PhoneCallState | null;
  /** -1 picks up; 0..2 takes the offer at that index. */
  answer(choice: number): void;
  tick(dt: number): void;
  snapshot(): HotlineSave;
  restore(s: HotlineSave | null | undefined): void;
  dispose(): void;
  /** Rings now (debug and tests): rolls the offers for the current Night and Watch. Null when a call is already live. */
  ringNow(): PhoneCallState | null;
  /** Seconds into the Watch the call is scheduled, or -1. */
  scheduledAt(): number;
}

// ── buffs the deals hand out (registered per run; fixed ids so a save restores them) ─────────────────────
const bs = (id: string): BuffDef['strings'] => {
  const en = STR.en as Record<string, string>, tr = STR.tr as Record<string, string>;
  return { en: { name: en[`buff.${id}.name`], desc: en[`buff.${id}.desc`] }, tr: { name: tr[`buff.${id}.name`], desc: tr[`buff.${id}.desc`] } };
};
const TAGS = ['phone'];
const DAWN = 'hotline.dawn';

export const HOTLINE_BUFFS: readonly BuffDef[] = [
  {
    id: 'hotline.x2', kind: 'buff', scope: 'player', icon: 'icon.star', maxStacks: 1, duration: { kind: 'wins', n: 1 }, reapply: 'replace', tags: TAGS,
    effects: [{ hook: 'payout.mult', op: 'mult', value: 2 }],
    strings: bs('x2'),
  },
  {
    id: 'hotline.x15', kind: 'buff', scope: 'player', icon: 'icon.flame', maxStacks: 1, duration: { kind: 'wins', n: 3 }, reapply: 'replace', tags: TAGS,
    effects: [{ hook: 'payout.mult', op: 'mult', value: 1.5 }],
    strings: bs('x15'),
  },
  {
    id: 'hotline.x3', kind: 'buff', scope: 'player', icon: 'icon.crown', maxStacks: 1, duration: { kind: 'wins', n: 1 }, reapply: 'replace', tags: TAGS,
    effects: [{ hook: 'payout.mult', op: 'mult', value: 3 }],
    strings: bs('x3'),
  },
  {
    id: 'hotline.luck', kind: 'buff', scope: 'player', icon: 'icon.luck', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: TAGS,
    effects: [{ hook: 'luck', op: 'add', value: 3 }],
    strings: bs('luck'),
  },
  {
    id: 'hotline.sag', kind: 'debuff', scope: 'player', icon: 'icon.cross', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: [...TAGS, 'curse'],
    effects: [{ hook: 'payout.mult', op: 'mult', value: 0.9 }],
    strings: bs('sag'),
  },
  {
    id: 'hotline.cheap', kind: 'buff', scope: 'player', icon: 'icon.coin', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: TAGS,
    effects: [{ hook: 'bet.costMult', op: 'mult', value: 0.8 }],
    strings: bs('cheap'),
  },
  {
    id: 'hotline.slow', kind: 'debuff', scope: 'player', icon: 'icon.hourglass', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: [...TAGS, 'curse'],
    effects: [{ hook: 'player.moveSpeed', op: 'mult', value: 0.85 }],
    strings: bs('slow'),
  },
  {
    id: 'hotline.time', kind: 'buff', scope: 'player', icon: 'icon.clock', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'ignore', tags: TAGS,
    effects: [],
    strings: bs('time'),
  },
  {
    id: 'hotline.refund', kind: 'buff', scope: 'player', icon: 'icon.shield', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: TAGS,
    effects: [{ hook: 'loss.refund', op: 'add', value: 0.25 }],
    strings: bs('refund'),
  },
  {
    id: 'hotline.pricey', kind: 'debuff', scope: 'player', icon: 'icon.coin', maxStacks: 1, duration: { kind: 'shift' }, reapply: 'refresh', tags: [...TAGS, 'curse'],
    effects: [{ hook: 'bet.costMult', op: 'mult', value: 1.15 }],
    strings: bs('pricey'),
  },
  {
    id: 'hotline.interest', kind: 'debuff', scope: 'player', icon: 'icon.debt', maxStacks: 1, duration: { kind: 'permanent' }, reapply: 'ignore', tags: [...TAGS, 'curse', DAWN],
    effects: [{ hook: 'x.econ.interestAdd', op: 'add', value: -0.01 }],
    strings: bs('interest'),
  },
  {
    id: 'hotline.tax', kind: 'debuff', scope: 'player', icon: 'icon.debt', maxStacks: 1, duration: { kind: 'permanent' }, reapply: 'ignore', tags: [...TAGS, 'curse', DAWN],
    effects: [{ hook: 'payout.mult', op: 'mult', value: 0.92 }],
    strings: bs('tax'),
  },
];

// ── deals ────────────────────────────────────────────────────────────────────────────────────────────
interface DealCtx {
  run: RunApi;
  host: HotlineHost;
  night: number;
  /** Scales a cost the module applies itself (`x.phone.dealCost`); never below 1. */
  cost(x: number): number;
  rng: Rng;
}
interface DealDef {
  id: string;
  weight: number;
  minNight?: number;
  /** Null/absent = always possible. */
  eligible?(c: DealCtx): boolean;
  /** The numbers shown on the offer and used when it is taken. */
  offer(c: DealCtx): DealVars;
  apply(c: Omit<DealCtx, 'rng'>, v: DealVars): Outcome | void;
}

const num = (v: DealVars, k: string): number => Number(v[k] ?? 0);
const FAIL_PEG = 'hotline.note.noPeg';
const FAIL_LAMP = 'hotline.note.noLamp';

const addBuff = (run: RunApi, id: string): void => { run.buffs.add(id, { source: { kind: 'phone', id: 'hotline' } }); };
/** Takes `pct` % of the pocket now. */
function loseShare(run: RunApi, pct: number): void {
  const n = Math.floor(run.wallet() * pct / 100);
  if (n > 0) run.spend('coin', n, 'phone');
}
const quotaDue = (run: RunApi): number => run.shift.quota().due;
const heldIds = (run: RunApi): Set<string> => new Set(run.charms().map((c) => c.id));

/** Night gate of a charm: no code, or 'N<k>' once Night k is reached. Other codes (wins, achievements) never unlock by phone. */
function reached(unlock: string | undefined, night: number): boolean {
  if (!unlock) return true;
  const m = /^N(\d+)$/.exec(unlock);
  return m ? night >= Number(m[1]) : false;
}
/** Rare charms the Hotline may hand out: unlocked by this Night, and not held already. */
function rarePool(run: RunApi): string[] {
  const held = heldIds(run);
  const night = run.night();
  return allCharmDefs().filter((d) => d.rarity === 'rare' && reached(d.unlock, night) && !held.has(d.id)).map((d) => d.id);
}
/** Cursed charms with a sign-on fee that are fair to sign for (no quota or phone-mute curses). */
const CURSED_OK: readonly string[] = ['wet_ledger', 'sand_hourglass', 'gluttons_bib', 'moth_swarm', 'gold_tooth'];
function cursedPool(run: RunApi): string[] {
  const held = heldIds(run);
  const all = allCharmDefs();
  return CURSED_OK.filter((id) => !held.has(id) && all.some((d) => d.id === id && d.price < 0));
}

export const DEALS: readonly DealDef[] = [
  {
    id: 'overtime', weight: 10,
    offer: (c) => ({ n: 2, d: c.cost(15) }),
    apply: (c, v) => {
      if (c.host.addPulls) c.host.addPulls(num(v, 'n'));
      else c.run.earn('ticket', num(v, 'n') * 3, 'phone');
      c.run.addDread(num(v, 'd'), 'phone');
    },
  },
  {
    id: 'double', weight: 10,
    eligible: (c) => c.run.wallet() > 0,
    offer: (c) => ({ p: c.cost(10) }),
    apply: (c, v) => { loseShare(c.run, num(v, 'p')); addBuff(c.run, 'hotline.x2'); },
  },
  {
    id: 'rare', weight: 5, minNight: 2,
    eligible: (c) => rarePool(c.run).length > 0,
    offer: (c) => {
      const pool = rarePool(c.run);
      const id = pool[c.rng.int(0, pool.length - 1)];
      return { c: id, charm: `@charm.${id}.name` };
    },
    apply: (c, v) => {
      if (!c.run.grantCharm(String(v.c))) return { ok: false, note: FAIL_PEG, vars: {} };
      addBuff(c.run, 'hotline.interest');
      return { ok: true, note: 'hotline.note.charm', vars: { charm: v.charm ?? '' } };
    },
  },
  {
    id: 'lamp', weight: 6, minNight: 2,
    eligible: (c) => c.host.previewNextHot !== undefined,
    offer: (c) => ({ d: c.cost(10) }),
    apply: (c, v) => {
      const hot = c.host.previewNextHot?.() ?? null;
      if (!hot) return { ok: false, note: FAIL_LAMP, vars: {} };
      c.run.addDread(num(v, 'd'), 'phone');
      return { ok: true, note: 'hotline.note.lamp', vars: { machine: `@m.${hot.machineId}.name`, mid: hot.mid } };
    },
  },
  {
    id: 'launder', weight: 7,
    eligible: (c) => c.host.creditQuota !== undefined && quotaDue(c.run) > 0 && c.run.balance('ticket') >= c.cost(3),
    offer: (c) => ({ t: c.cost(3), q: 5 }),
    apply: (c, v) => {
      if (!c.run.spend('ticket', num(v, 't'), 'phone')) return { ok: false, note: 'hotline.note.noTickets', vars: {} };
      c.host.creditQuota?.(Math.max(1, Math.round(quotaDue(c.run) * num(v, 'q') / 100)));
    },
  },
  {
    id: 'cursed', weight: 5, minNight: 3,
    eligible: (c) => cursedPool(c.run).length > 0,
    offer: (c) => {
      const pool = cursedPool(c.run);
      const id = pool[c.rng.int(0, pool.length - 1)];
      const def = allCharmDefs().find((d) => d.id === id);
      const stake = c.run.shift.state().stake;
      const fee = def ? Math.max(1, Math.abs(charmPrice(def, stake)) * 2) : 0;
      return { c: id, charm: `@charm.${id}.name`, fee };
    },
    apply: (c, v) => {
      if (!c.run.grantCharm(String(v.c))) return { ok: false, note: FAIL_PEG, vars: {} };
      c.run.earn('coin', num(v, 'fee'), 'phone');
      return { ok: true, note: 'hotline.note.charm', vars: { charm: v.charm ?? '' } };
    },
  },
  {
    id: 'luck', weight: 8,
    offer: () => ({ l: 3, p: 10 }),
    apply: (c) => { addBuff(c.run, 'hotline.luck'); addBuff(c.run, 'hotline.sag'); },
  },
  {
    id: 'cheap', weight: 8,
    offer: () => ({ b: 20, m: 15 }),
    apply: (c) => { addBuff(c.run, 'hotline.cheap'); addBuff(c.run, 'hotline.slow'); },
  },
  {
    id: 'time', weight: 7,
    eligible: (c) => c.run.balance('ticket') >= c.cost(3),
    offer: (c) => ({ s: 30, t: c.cost(3) }),
    apply: (c, v) => {
      if (!c.run.spend('ticket', num(v, 't'), 'phone')) return { ok: false, note: 'hotline.note.noTickets', vars: {} };
      c.run.shift.extend(num(v, 's'));
      addBuff(c.run, 'hotline.time');
    },
  },
  {
    id: 'refund', weight: 8,
    eligible: (c) => c.run.wallet() > 0,
    offer: (c) => ({ r: 25, p: c.cost(5) }),
    apply: (c, v) => { loseShare(c.run, num(v, 'p')); addBuff(c.run, 'hotline.refund'); },
  },
  {
    id: 'calm', weight: 6,
    eligible: (c) => c.run.dread() >= 0.15 && c.run.wallet() > 0,
    offer: (c) => ({ d: 25, p: c.cost(12) }),
    apply: (c, v) => { loseShare(c.run, num(v, 'p')); c.run.addDread(-num(v, 'd'), 'phone'); },
  },
  {
    id: 'advance', weight: 7,
    eligible: (c) => quotaDue(c.run) > 0,
    offer: (c) => ({ c: Math.max(5, Math.round(quotaDue(c.run) * 0.06)), p: 8 }),
    apply: (c, v) => { c.run.earn('coin', num(v, 'c'), 'phone'); addBuff(c.run, 'hotline.tax'); },
  },
  {
    id: 'jackpot', weight: 5,
    eligible: (c) => c.run.jackpot('net') >= 10,
    offer: (c) => ({ a: Math.max(1, Math.round(c.run.jackpot('net') * 0.3)), j: 30, d: c.cost(10) }),
    apply: (c, v) => { c.run.jackpotAdd('net', num(v, 'a')); c.run.addDread(num(v, 'd'), 'phone'); },
  },
  {
    id: 'hothands', weight: 8,
    offer: () => ({ n: 3, b: 15 }),
    apply: (c) => { addBuff(c.run, 'hotline.x15'); addBuff(c.run, 'hotline.pricey'); },
  },
  {
    id: 'devil', weight: 4, minNight: 2,
    eligible: (c) => c.run.wallet() > 0,
    offer: (c) => ({ d: c.cost(25), p: c.cost(20) }),
    apply: (c, v) => { loseShare(c.run, num(v, 'p')); c.run.addDread(num(v, 'd'), 'phone'); addBuff(c.run, 'hotline.x3'); },
  },
  {
    // Locksmith: +15 Dread and the first closed wing (LOCKSMITH_ORDER) opens now, no key.
    id: 'locksmith', weight: 6, minNight: 2,
    eligible: (c) => !!c.host.openWing && locksmithZone((z) => !c.host.wingClosed?.(z)) !== null,
    offer: (c) => {
      const z = locksmithZone((x) => !c.host.wingClosed?.(x)) ?? 'midway';
      return { d: c.cost(15), z, zn: `@rooms.wing.${z}.name` };
    },
    apply: (c, v) => openRoomDeal(c, v),
  },
  {
    // Stoker: the Boiler opens now for +10 Dread.
    id: 'stoker', weight: 5, minNight: 2,
    eligible: (c) => !!c.host.openWing && !!c.host.wingClosed?.(STOKER_WING),
    offer: (c) => ({ d: c.cost(10), z: STOKER_WING, zn: `@rooms.wing.${STOKER_WING}.name` }),
    apply: (c, v) => openRoomDeal(c, v),
  },
];

/** Locksmith and Stoker: open the wing named in the offer (`z`), then take the Dread. A refused open costs nothing. */
function openRoomDeal(c: Omit<DealCtx, 'rng'>, v: DealVars): Outcome {
  if (!c.host.openWing?.(String(v.z))) return { ok: false, note: 'hotline.note.noWing', vars: {} };
  c.run.addDread(num(v, 'd'), 'phone');
  return { ok: true, note: 'hotline.note.opened', vars: { zone: String(v.zn ?? '') } };
}

const DEAL_BY_ID = new Map(DEALS.map((d) => [d.id, d]));

// ── option strings: "<i18n key>|k=v|k=v" (PhoneCallState.options is a string[] of keys) ───────────────────
export const dealKey = (id: string): string => `hotline.deal.${id}`;

export function encodeOption(o: Offer): string {
  const parts = Object.entries(o.v).map(([k, val]) => `${k}=${val}`);
  return [dealKey(o.id), ...parts].join('|');
}

/** Inverse of `encodeOption`: the key and its vars (numeric values come back as numbers). */
export function decodeOption(opt: string): { key: string; id: string; v: DealVars } {
  const [key = '', ...rest] = opt.split('|');
  const v: DealVars = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 1) continue;
    const raw = p.slice(i + 1);
    v[p.slice(0, i)] = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return { key, id: key.startsWith('hotline.deal.') ? key.slice('hotline.deal.'.length) : key, v };
}

// ── the module ───────────────────────────────────────────────────────────────────────────────────────
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const nowDefault = (): number => 0;

function blank(): HotlineSave {
  return { v: 1, nextId: 1, live: false, night: 0, watch: -1, elapsed: 0, ringAt: -1, rangThisNight: 0, call: null, ringLeft: 0, answerLeft: 0 };
}

export function createHotline(run: RunApi, opts: HotlineOpts = {}): Hotline {
  const host = opts.host ?? {};
  const now = opts.now ?? nowDefault;
  const unsubs: Array<() => void> = [];
  let st = blank();
  let view: PhoneCallState | null = null;
  let viewKey = '';

  // buff definitions (once per buff registry; names for the HUD under buff.<id>.*)
  for (const def of HOTLINE_BUFFS) {
    if (!run.buffs.def(def.id)) run.buffs.register(def);
    registerStrings(`buff.${def.id}.`, { en: def.strings.en, tr: def.strings.tr });
  }

  const watchInfo = (): { index: number; count: number; seconds: number } => {
    const s = run.shift.state();
    return { index: s.segment?.index ?? 0, count: s.segment?.count ?? 1, seconds: s.duration };
  };
  const costScale = (): number => clamp(run.mod('x.phone.dealCost', MID, 1), 0.25, 2);

  function ctxFor(rng: Rng): DealCtx {
    const k = costScale();
    return { run, host, night: run.night(), rng, cost: (x) => Math.max(1, Math.round(x * k)) };
  }

  /** Three distinct deals, weighted, seeded by (seed, Night, Watch, call id). */
  function rollOffers(rng: Rng): Offer[] {
    const c = ctxFor(rng);
    let pool = DEALS.filter((d) => (d.minNight ?? 1) <= c.night && (d.eligible ? d.eligible(c) : true));
    const out: Offer[] = [];
    while (out.length < OFFER_COUNT && pool.length > 0) {
      const i = rng.weightedIndex(pool.map((d) => d.weight));
      const d = pool[i];
      out.push({ id: d.id, v: d.offer(c) });
      pool = pool.filter((_, j) => j !== i);
    }
    // never short of three: pad with the always-possible deals
    for (const d of DEALS) {
      if (out.length >= OFFER_COUNT) break;
      if (!out.some((o) => o.id === d.id) && !d.eligible && (d.minNight ?? 1) <= c.night) out.push({ id: d.id, v: d.offer(c) });
    }
    return out;
  }

  function rebuildView(): void {
    const c = st.call;
    const key = c ? `${c.id}|${c.answeredBy}` : '';
    if (key === viewKey) return;
    viewKey = key;
    view = c ? {
      id: c.id, script: c.script, target: 0, ringingSince: c.ringingSince, answeredBy: c.answeredBy,
      step: c.answeredBy === null ? 0 : 1, options: c.offers.map(encodeOption),
    } : null;
  }

  function startCall(): PhoneCallState | null {
    if (st.call) return null;
    const hollow = st.hollowAt === true;
    st.hollowAt = false;
    if (hollow && !(host.hollowRing?.() ?? false)) { st.ringAt = -1; return null; }
    const id = st.nextId++;
    const rng = createRng(hashSeed('hotline.offer', run.seed, st.night, st.watch, id));
    const script = hollow ? HOLLOW_SCRIPT : `hotline.call.${rng.int(1, CALL_LINES)}`;
    const ringSecs = ringTotal(run.mod('x.phone.ringTime', MID, RING_SECONDS));
    const offers = hollow ? HOLLOW_OFFERS.map((o) => ({ id: o.id, v: { ...o.v } })) : rollOffers(rng);
    st.call = { id, script, ringingSince: now(), answeredBy: null, offers, ringSecs, ...(hollow ? { hollow: true } : {}) };
    st.ringLeft = ringSecs;
    st.answerLeft = 0;
    if (!hollow) st.rangThisNight += 1;
    st.ringAt = -1;
    rebuildView();
    bus.emit('phone:ring', { callId: id });
    bus.emit('phone:length', { callId: id, seconds: ringSecs });
    return view;
  }

  function endCall(kind: 'missed' | 'declined' | 'deal', deal: string, out: Outcome): void {
    const c = st.call;
    if (!c) return;
    st.call = null; st.ringLeft = 0; st.answerLeft = 0;
    rebuildView();
    // the 3:33 call not taken to "go down" spends the phone for the run
    if (c.hollow && kind !== 'deal') host.hollowAnswer?.('hangup');
    bus.emit('hotline:result', { callId: c.id, kind, deal, ok: out.ok, note: out.note, vars: out.vars });
    bus.emit('phone:end', { callId: c.id });
  }

  /** Bell → play: rolls whether (and when) the phone rings this Watch. */
  function onPlay(): void {
    const w = watchInfo();
    const night = run.night();
    if (night !== st.night) { st.night = night; st.rangThisNight = 0; }
    st.watch = w.index;
    st.elapsed = 0;
    st.live = true;
    st.ringAt = -1;
    if (st.call) endCall('missed', '', { ok: false, note: 'hotline.note.missed', vars: {} });
    // The Hollow Door's 3:33 call (no caller) takes this Watch's ring when it rolls: from Night 2, once the door is unused.
    const hollowRng = createRng(hashSeed('hollow.phone', run.seed, night, w.index));
    if (host.hollowCanRing?.() && hollowRng.next() < HOLLOW_CALL_CHANCE) {
      st.hollowAt = true;
      st.ringAt = w.seconds * NIGHT_CLOCK_FRAC;
      return;
    }
    const rng = createRng(hashSeed('hotline.ring', run.seed, night, w.index));
    const roll = rng.next();
    const at = w.seconds * (RING_FROM + (RING_TO - RING_FROM) * rng.next());
    if (night < 2 || run.mod('x.phone.mute', MID, 0) > 0) return;   // Night 1 is silent: the phone starts on Night 2
    // The first Watch of every Night always rings (the phone is the player's way out of a dry first Watch); later
    // Watches keep the seeded 45 %, and a Night that has not rung by its last Watch still gets its call.
    const forced = w.index === 0 || (w.index >= w.count - 1 && st.rangThisNight === 0);
    const p = clamp(run.mod('x.phone.callChance', MID, CALL_CHANCE), 0, 1);
    if (forced || roll < p) st.ringAt = at;
  }

  /** The Watch is over (or the phase left play): the line goes dead. */
  function onOff(): void {
    st.live = false;
    st.ringAt = -1;
    if (st.call) endCall('missed', '', { ok: false, note: 'hotline.note.missed', vars: {} });
  }

  unsubs.push(bus.on('shift:phase', ({ phase }) => {
    if (phase === 'play') { if (!st.live) onPlay(); }
    else if (phase === 'closing' || phase === 'settle' || phase === 'collection' || phase === 'intermission' || phase === 'over') onOff();
  }));
  // Dawn: the deals that last "until Dawn" end
  unsubs.push(bus.on('run:window', ({ window }) => { if (window === 'dawn') run.buffs.cleanse(DAWN); }));

  function answer(choice: number): void {
    const c = st.call;
    if (!c) return;
    if (choice === -1) {
      if (c.answeredBy !== null) return;
      c.answeredBy = run.selfId as PlayerId;
      st.answerLeft = ANSWER_SECONDS;
      rebuildView();
      // the first Watch of a Night with a Mira call: her lines play over the pickup (the deals still follow)
      const sc = st.watch === 0 && !c.hollow ? storyCallFor(run.night()) : null;
      if (sc && !(st.story ?? []).includes(sc.night)) {
        (st.story ??= []).push(sc.night);
        bus.emit('phone:story', { callId: c.id, id: sc.id, speaker: sc.speaker, lines: [...sc.lines] });
      }
      return;
    }
    if (c.answeredBy === null || !Number.isInteger(choice) || choice < 0 || choice >= c.offers.length) return;
    if (c.hollow) {
      const godown = choice === 0;
      host.hollowAnswer?.(godown ? 'godown' : 'hangup');
      endCall('deal', godown ? 'hollow.godown' : 'hollow.hangup', godown
        ? { ok: true, note: 'hotline.note.hollow.godown', vars: {} }
        : { ok: false, note: 'hotline.note.hollow.hangup', vars: {} });
      return;
    }
    const offer = c.offers[choice];
    const def = DEAL_BY_ID.get(offer.id);
    let out: Outcome = { ok: true, note: 'hotline.note.struck', vars: { name: `@${dealKey(offer.id)}.name` } };
    if (def) {
      const rng = createRng(hashSeed('hotline.apply', run.seed, st.night, st.watch, c.id));
      const res = def.apply(ctxFor(rng), offer.v);
      if (res) out = res;
    }
    run.stat('hotline.deals', out.ok ? 1 : 0);
    endCall('deal', offer.id, out);
  }

  function tick(dt: number): void {
    if (!st.live || dt <= 0) return;
    st.elapsed += dt;
    const c = st.call;
    if (c) {
      if (c.answeredBy === null) {
        st.ringLeft -= dt;
        if (st.ringLeft <= 0) endCall('missed', '', { ok: false, note: 'hotline.note.missed', vars: {} });
      } else {
        st.answerLeft -= dt;
        if (st.answerLeft <= 0) endCall('declined', '', { ok: false, note: 'hotline.note.declined', vars: {} });
      }
      return;
    }
    if (st.ringAt >= 0 && st.elapsed >= st.ringAt) startCall();
  }

  function restore(s: HotlineSave | null | undefined): void {
    st = s && s.v === 1 ? JSON.parse(JSON.stringify(s)) as HotlineSave : blank();
    viewKey = '#';
    rebuildView();
    if (st.call && st.call.answeredBy === null) {
      bus.emit('phone:ring', { callId: st.call.id });
      bus.emit('phone:length', { callId: st.call.id, seconds: st.call.ringSecs ?? RING_SECONDS });
    }
  }

  return {
    phone: () => view,
    answer,
    tick,
    snapshot: () => JSON.parse(JSON.stringify(st)) as HotlineSave,
    restore,
    dispose: () => { for (const u of unsubs.splice(0)) u(); },
    ringNow: () => {
      if (st.night === 0) { st.night = run.night(); st.watch = watchInfo().index; }
      st.live = true;
      return startCall();
    },
    scheduledAt: () => st.ringAt,
  };
}
