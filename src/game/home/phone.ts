/**
 * THE PHONE (wave 69, Home layer): the player's own phone with two threads, the spouse (EŞİM / SPOUSE) and the Collector
 * (TAHSİLDAR / THE COLLECTOR), per docs/WAVE69_HOME.md §4–6. The run creates it with `createPhone(run)` and ticks it every
 * frame; the UI (phone.ui.ts) reads it through `run.homePhone()`, and the flow calls `onEvening()` and `talk()` at home.
 *
 * Messages arrive during Watches only (shift phase 'play'). Every roll is a fresh stream, hashSeed(run seed, Night, Watch,
 * 'msg.<thread>'), so a seeded run and a bench replay get the same phone. A reply applies once; coins go through `run.spend`;
 * Harmony (Ada's bond, 0..5, start 2) and Heat (Collector, 0..6, start 0) are clamped. Time is sim seconds from `tick(dt)`.
 *
 * The Night closes on the bed (`home:stage` 'sleep', Design pillar 7: one mechanic, many readings). Closing it costs one
 * Harmony when no spouse reply and no talk came that Night, and rolls the Night's dream from Harmony and calm (1 − dread):
 * a good dream grants `blessed`, a cold one grants `restless`, a plain one nothing. Talking gives warmth only (+1 Harmony at
 * most once a Night, and only if the Night was paid with a margin of at least 5 %).
 */
import { bus } from '@/core/events';
import { log } from '@/core/log';
import { createRng, hashSeed } from '@/core/rng';
import type { HomePhoneApi, PhoneMessage, PhoneSave, PhoneThread } from './contract';
import type { DebtRun } from '../run';
import { advanceArc, SPOUSE_CARD_BEAT } from '../story/chapter';
import { poolOf } from './ada';

declare module '@/core/events' {
  interface GameEvents {
    /** The Collector's Heat moved (wave 71): the phone chip shows it. `why` names the input (time, thin, tithe, seal, loan, quiet, listener ...). */
    'home:heat': { delta: number; heat: number; why: string };
  }
}

// ── rules (numbers from the spec; tune here, nowhere else) ────────────────────────────────────────────────────────────
export const HARMONY_START = 2;
export const HARMONY_MAX = 5;
export const HEAT_MAX = 6;
/** Chance that a spouse message is planned for a Watch 1 or 2 (at most one per Night). */
const SPOUSE_CHANCE = 0.5;
/** Seconds into the Watch when a spouse message lands. */
const SPOUSE_AT: readonly [number, number] = [12, 40];
/** Seconds into the Watch when a Collector message lands (only from Watch 2 on). */
const COLLECTOR_AT: readonly [number, number] = [30, 90];
/** Behind schedule: the Collector writes when more than this share of the quota is still owed (Watch 2 / the last Watch). */
const COLLECTOR_BEHIND = 0.5;
const COLLECTOR_BEHIND_LAST = 0.25;
/** Lines escalate courtesy, reminder, final notice, on our way (stage = messages the Collector has sent so far). */
export const COLLECTOR_STAGES = 4;
/** Quota margin of a paid Night: at least this share above the quota is warm, under MARGIN_THIN is thin. */
export const MARGIN_WARM = 0.25;
export const MARGIN_THIN = 0.05;
/** A talk at home gives warmth (+1 Harmony, once a Night) only when the Night's margin is at least this share. */
export const MARGIN_TALK = MARGIN_THIN;
/** The dream: Harmony at or above DREAM_GOOD dreams well, at or below DREAM_COLD dreams cold, the rest plain. */
export const DREAM_GOOD = 4;
export const DREAM_COLD = 1;
/** Calm (1 − dread) below CALM_LOW can sour a dream one tier (seeded, half the time); at CALM_HIGH it can lift one (a fifth). */
export const CALM_LOW = 0.3;
export const CALM_HIGH = 0.8;
/** Missed Watch tithes in one Night: the first is free, each one beyond it adds a Heat. */
export const TITHE_FREE_MISSES = 1;
/** The phone keeps this many messages (oldest drop off). */
const MAX_MESSAGES = 40;

// ── message tables (noir, warm but tired; original text lives in phone.strings.ts) ────────────────────────────────────
/** What a reply does. `send` spends coins (the share of the quota in `share`); the rest are words. */
export type ReplyKind = 'send' | 'promise' | 'plain' | 'lie' | 'ignore';
export interface SpouseReply { kind: ReplyKind; harmony: number }
export interface SpouseDef {
  id: string;
  /** Share of the Night's quota the `send` reply costs (at least 1 coin). */
  share?: number;
  /** Reply options in order; their i18n keys are `phone.sp.<id>.r<n>`. */
  replies: readonly SpouseReply[];
}

/** Ten spouse messages, two or three replies each. Harmony moves by −1, 0 or +1 per reply (small and fair). */
export const SPOUSE_MESSAGES: readonly SpouseDef[] = [
  { id: 'rent', share: 0.05, replies: [{ kind: 'send', harmony: 1 }, { kind: 'promise', harmony: 0 }, { kind: 'lie', harmony: -1 }] },
  { id: 'trip', share: 0.03, replies: [{ kind: 'send', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'dinner', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'worry', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'lie', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'faith', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'dream', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'eating', replies: [{ kind: 'lie', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'home', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'fridge', share: 0.06, replies: [{ kind: 'send', harmony: 1 }, { kind: 'promise', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'drawing', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
];

/**
 * THE SECOND NAME (wave 73): the spouse's card messages, one each on Nights 2, 5 and 8 (SPOUSE_CARD_BEAT). They replace the
 * random spouse message on those Nights, and carry the card and the second name. Keys phone.sp.card<n>.t / .r<n>.
 */
export const CARD_MESSAGES: readonly SpouseDef[] = [
  { id: 'card2', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'card5', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
  { id: 'card8', replies: [{ kind: 'promise', harmony: 1 }, { kind: 'plain', harmony: 0 }, { kind: 'ignore', harmony: -1 }] },
];
/** THE SECOND NAME (wave 73): the Collector's N2 warning (Heat 1 or more), and the N7 deal: pay a share of the pocket, Heat drops by two. */
export const WARN_NIGHT = 2;
export const WARN_KEY = 'phone.co.warn.n2';
export const DEAL_NIGHT = 7;
export const DEAL_KEY = 'phone.co.deal.t';
export const DEAL_SHARE = 0.2;
export const DEAL_HEAT = -2;
const DEAL_REPLIES: readonly string[] = ['phone.co.deal.r0', 'phone.co.deal.r1'];

/** Collector replies: "I'll pay" is free, "I need time" adds one Heat. Keys `phone.co.reply.pay|time`. */
export const COLLECTOR_REPLIES: readonly { key: string; heat: number }[] = [
  { key: 'phone.co.reply.pay', heat: 0 },
  { key: 'phone.co.reply.time', heat: 1 },
];
/** Collector message text variants per stage: keys `phone.co.s<stage>.<variant>`. */
export const COLLECTOR_VARIANTS = 3;
/** Dream text variants per tier: keys `phone.dream.<tier>.<n>` (n = 1..DREAM_VARIANTS). */
export const DREAM_VARIANTS = 3;

const SPOUSE_BY_TEXT: ReadonlyMap<string, SpouseDef> = new Map([
  ...[...SPOUSE_MESSAGES, ...CARD_MESSAGES].map((d): [string, SpouseDef] => [`phone.sp.${d.id}.t`, d]),
  ...SPOUSE_MESSAGES.map((d): [string, SpouseDef] => [`phone.sp.${d.id}.x.t`, d]),   // the across pool (cards have one text for both)
]);

/** Coins a `send` reply costs for a Night's quota: a share of it, at least one coin. */
export function coinCost(due: number, share: number): number {
  return Math.max(1, Math.round(due * share));
}

/**
 * What a reply to `msg` costs in coins (0 for words). The UI uses it to grey out a reply the pocket cannot cover; `reply()`
 * spends exactly this amount, so the two always agree.
 */
export function replyCoinCost(msg: PhoneMessage, choice: number): number {
  if (msg.thread === 'collector') return msg.textKey === DEAL_KEY && choice === 0 ? Math.max(0, Number(msg.vars?.cost ?? 0)) : 0;
  if (msg.thread !== 'spouse' || !Number.isInteger(choice)) return 0;
  const def = SPOUSE_BY_TEXT.get(msg.textKey);
  const reply = def?.replies[choice];
  if (!def || !reply || reply.kind !== 'send') return 0;
  return Math.max(0, Number(msg.vars?.cost ?? 0));
}

// ── the dream (the Night's close) ────────────────────────────────────────────────────────────────────────────────────
export type DreamTier = 'good' | 'plain' | 'cold';
/** The Night's dream: its tier, its text key (`phone.dream.<tier>.<n>`) and the Night it closed. */
export interface Dream { night: number; tier: DreamTier; key: string }
const DREAM_TIERS: readonly DreamTier[] = ['cold', 'plain', 'good'];

/**
 * The tier of a dream from Harmony and calm (1 − dread, 0..1), with `roll` a seeded draw in [0, 1). Harmony sets the tier
 * (≥ DREAM_GOOD good, ≤ DREAM_COLD cold, else plain). Calm moves it one step at most: a frightened head (calm < CALM_LOW) sours
 * the dream half the time, a quiet one (calm ≥ CALM_HIGH) lifts it a fifth of the time.
 */
export function dreamTier(harmony: number, calm: number, roll: number): DreamTier {
  let i = harmony >= DREAM_GOOD ? 2 : harmony <= DREAM_COLD ? 0 : 1;
  if (calm < CALM_LOW && roll < 0.5) i = Math.max(0, i - 1);
  else if (calm >= CALM_HIGH && roll < 0.2) i = Math.min(2, i + 1);
  return DREAM_TIERS[i];
}

/** The Night's dream of a phone (null before the first Night closes, or when it is not a phone of this layer). */
const DREAMS = new WeakMap<object, () => Dream | null>();
export function dreamOf(phone: HomePhoneApi | null | undefined): Dream | null {
  if (!phone) return null;
  return DREAMS.get(phone)?.() ?? null;
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Plan { thread: PhoneThread; night: number; watch: number; last: boolean; at: number; pick: number; /** A spouse card message (wave 73). */ card?: boolean }
interface State {
  harmony: number;
  heat: number;
  msgs: PhoneMessage[];
  /** The Night a spouse message last arrived in (0 = none yet): at most one per Night. */
  spouseNight: number;
  /** Collector messages sent in the run; the stage of the next one is min(this, COLLECTOR_STAGES - 1). */
  collectorSent: number;
  /** Heat moved since the last Evening (the quiet-Night rule). */
  heatMoved: boolean;
  /** The quota margin of the Night in its Evening (0 when unpaid): gates the talk's warmth. */
  margin: number;
  /** The Night a talk last gave its warmth (0 = none): at most one per Night. */
  warmNight: number;
  /** The Night a talk last happened in (0 = none), and the Night a spouse reply last came in (0 = none): the quiet-Night rule. */
  talkNight: number;
  replyNight: number;
  /** The dream of the last Night closed on the bed, or null. */
  dream: Dream | null;
  /** A play Watch is running: plans are live and `elapsed` counts its sim seconds. */
  playing: boolean;
  watchKey: string;
  elapsed: number;
  plans: Plan[];
  /** Missed Watch tithes in `titheNight` (wave 71): the second and later ones heat the Collector. */
  titheNight: number;
  titheMisses: number;
  /** The Evening's visitor (wave 71, src/game/home/knock.ts owns the shape): saved with the phone, so a reload resumes the visit. */
  visit: unknown;
}

function freshState(): State {
  return {
    harmony: HARMONY_START, heat: 0, msgs: [], spouseNight: 0, collectorSent: 0, heatMoved: false, margin: 0, warmNight: 0,
    talkNight: 0, replyNight: 0, dream: null, playing: false, watchKey: '', elapsed: 0, plans: [], titheNight: 0, titheMisses: 0, visit: null,
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const intIn = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : dflt;

/** A saved message, checked field by field (a damaged save drops the message rather than breaking the phone). */
function readMsg(x: unknown): PhoneMessage | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if ((o.thread !== 'spouse' && o.thread !== 'collector') || typeof o.id !== 'string' || typeof o.textKey !== 'string') return null;
  if (!Array.isArray(o.replies) || !o.replies.every((r) => typeof r === 'string')) return null;
  let answered: number | null | undefined;
  if (o.answered === null) answered = null;
  else if (typeof o.answered === 'number' && Number.isInteger(o.answered)) answered = o.answered;
  if (answered === undefined) return null;
  const vars = o.vars && typeof o.vars === 'object' && !Array.isArray(o.vars) ? o.vars as Record<string, string | number> : undefined;
  return {
    id: o.id, thread: o.thread, night: intIn(o.night, 1, 999, 1), watch: intIn(o.watch, 1, 99, 1), textKey: o.textKey,
    vars, replies: o.replies as string[], read: o.read === true, answered,
  };
}

function readPlan(x: unknown): Plan | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.thread !== 'spouse' && o.thread !== 'collector') return null;
  return {
    thread: o.thread, night: intIn(o.night, 1, 999, 1), watch: intIn(o.watch, 0, 99, 0), last: o.last === true,
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0, pick: intIn(o.pick, 0, 999, 0), card: o.card === true,
  };
}

function readDream(x: unknown): Dream | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if ((o.tier !== 'good' && o.tier !== 'plain' && o.tier !== 'cold') || typeof o.key !== 'string') return null;
  return { night: intIn(o.night, 0, 999, 0), tier: o.tier, key: o.key };
}

// ── hooks for the knock lane (wave 71) ───────────────────────────────────────────────────────────────────────────────
/** What the visitor machine (knock.ts) and the run reach on a phone beyond `HomePhoneApi`: Heat and Harmony nudges, the visit slice. */
export interface PhoneHooks {
  /** Moves Heat by `d` (clamped 0..HEAT_MAX); a gain marks the Night as not quiet. Emits `home:heat` when Heat really moved. */
  heat(d: number, why: string): void;
  harmony(d: number): void;
  /** The visit's save slice (opaque here; knock.ts validates it). It is saved live: the object is read at snapshot time. */
  visit(): unknown;
  setVisit(v: unknown): void;
}
const HOOKS = new WeakMap<object, PhoneHooks>();
export function hooksOf(phone: HomePhoneApi | null | undefined): PhoneHooks | null {
  return phone ? HOOKS.get(phone) ?? null : null;
}

// ── the model ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function createPhone(run: DebtRun): HomePhoneApi {
  const seed = run.seed;
  let st: State = freshState();
  let disposed = false;
  const unsubs: Array<() => void> = [];

  /** Watch start: plan this Watch's messages from its seeded streams. Idempotent for the same (Night, Watch). */
  function beginWatch(): void {
    const night = run.night();
    const seg = run.shift.state().segment;
    const w = seg?.index ?? 0;
    const count = seg?.count ?? 1;
    const key = `${night}:${w}`;
    if (st.playing && st.watchKey === key) return;
    st.playing = true;
    st.watchKey = key;
    st.elapsed = 0;
    st.plans = [];
    // THE SECOND NAME (wave 73): a card night whose spouse beat is still owed gets the card message, not the random one
    const cardBeat = cardBeatDue(night);
    if (w <= 1 && st.spouseNight !== night) {
      const r = createRng(hashSeed(seed, night, w, 'msg.spouse'));
      if (cardBeat) {
        st.plans.push({
          thread: 'spouse', night, watch: w, last: w === count - 1,
          at: r.int(SPOUSE_AT[0], SPOUSE_AT[1]), pick: cardBeat - 1, card: true,
        });
      } else if (r.chance(SPOUSE_CHANCE)) {
        st.plans.push({
          thread: 'spouse', night, watch: w, last: w === count - 1,
          at: r.int(SPOUSE_AT[0], SPOUSE_AT[1]), pick: r.int(0, SPOUSE_MESSAGES.length - 1),
        });
      }
    }
    if (w >= 1) {
      const r = createRng(hashSeed(seed, night, w, 'msg.collector'));
      st.plans.push({
        thread: 'collector', night, watch: w, last: w === count - 1,
        at: r.int(COLLECTOR_AT[0], COLLECTOR_AT[1]), pick: r.int(0, COLLECTOR_VARIANTS - 1),
      });
    }
  }

  /** The spouse card beat (1..3) still owed on `night`, or 0 when none is owed (wave 73). */
  function cardBeatDue(night: number): number {
    const beat = SPOUSE_CARD_BEAT[night] ?? 0;
    const c = run.chapterRecord?.();
    return beat > 0 && c && c.arcs.spouse < beat ? beat : 0;
  }

  /** The play window ended (or the phase left play): the pending messages do not arrive. */
  function endWatch(): void {
    st.playing = false;
    st.watchKey = '';
    st.elapsed = 0;
    st.plans = [];
  }

  /** Heat moves by `d`. Only a GAIN spoils the quiet Night (a counter's relief must not); the chip hears every real move. */
  function bumpHeat(d: number, why = 'time'): void {
    const before = st.heat;
    st.heat = clamp(st.heat + d, 0, HEAT_MAX);
    if (st.heat > before) st.heatMoved = true;
    if (st.heat !== before) bus.emit('home:heat', { delta: st.heat - before, heat: st.heat, why });
  }

  function push(msg: PhoneMessage): void {
    if (st.msgs.some((m) => m.id === msg.id)) return;
    st.msgs.push(msg);
    if (st.msgs.length > MAX_MESSAGES) st.msgs.splice(0, st.msgs.length - MAX_MESSAGES);
    bus.emit('msg:in', { msg });
  }

  /** Printed Watch (1-based). One message per thread per Watch, so the id is unique within a run. */
  function msgId(p: Plan): string {
    return `${p.thread}:${p.night}:${p.watch + 1}:0`;
  }

  function deliverSpouse(p: Plan): void {
    const def = p.card ? CARD_MESSAGES[p.pick % CARD_MESSAGES.length] : SPOUSE_MESSAGES[p.pick % SPOUSE_MESSAGES.length];
    const cost = def.share ? coinCost(run.debt().due, def.share) : 0;
    const pool = p.card ? '' : poolOf(p.night);   // N1-N4 she texts from across the hall; the card messages are one text for both
    push({
      id: msgId(p), thread: 'spouse', night: p.night, watch: p.watch + 1,
      textKey: `phone.sp.${def.id}${pool}.t`, vars: { cost },
      replies: def.replies.map((_, i) => `phone.sp.${def.id}${pool}.r${i}`),
      read: false, answered: null,
    });
    st.spouseNight = p.night;
    const chap = run.chapterRecord?.();
    if (p.card && chap) advanceArc(chap, 'spouse', SPOUSE_CARD_BEAT[p.night] ?? 0);
  }

  /** The Collector writes only when the Night is behind: from Watch 2, and more than the share still owed. */
  function deliverCollector(p: Plan): void {
    // THE SECOND NAME (wave 73): the N2 warning (Heat 1 or more) and the N7 deal come before the behind-check
    const chap = run.chapterRecord?.();
    if (chap && p.night === DEAL_NIGHT && chap.arcs.collector < 3) {
      advanceArc(chap, 'collector', 3);
      push({
        id: msgId(p), thread: 'collector', night: p.night, watch: p.watch + 1,
        textKey: DEAL_KEY, vars: { cost: Math.max(1, Math.round(run.wallet() * DEAL_SHARE)) },
        replies: [...DEAL_REPLIES], read: false, answered: null,
      });
      return;
    }
    if (chap && p.night === WARN_NIGHT && st.heat >= 1 && chap.arcs.collector < 1) {
      advanceArc(chap, 'collector', 1);
      push({
        id: msgId(p), thread: 'collector', night: p.night, watch: p.watch + 1,
        textKey: WARN_KEY, vars: {}, replies: COLLECTOR_REPLIES.map((r) => r.key), read: false, answered: null,
      });
      return;
    }
    const { due, paid } = run.debt();
    const left = Math.max(0, due - paid);
    if (due <= 0 || left <= 0) return;
    if (left / due <= (p.last ? COLLECTOR_BEHIND_LAST : COLLECTOR_BEHIND)) return;
    const stage = Math.min(COLLECTOR_STAGES - 1, st.collectorSent);
    st.collectorSent += 1;
    push({
      id: msgId(p), thread: 'collector', night: p.night, watch: p.watch + 1,
      textKey: `phone.co.s${stage}.${p.pick}`, vars: { left: Math.ceil(left) },
      replies: COLLECTOR_REPLIES.map((r) => r.key), read: false, answered: null,
    });
  }

  function fire(p: Plan): void {
    if (p.thread === 'spouse') {
      if (st.spouseNight !== p.night) deliverSpouse(p);
    } else deliverCollector(p);
  }

  /**
   * The Night closes on the bed. A quiet Night (no spouse reply and no talk) costs one Harmony; then the Night's dream is rolled
   * from Harmony and calm (1 − dread): a good dream grants `blessed`, a cold one `restless`, a plain one nothing.
   */
  function closeNight(): void {
    if (disposed) return;
    const night = run.night();
    if (st.replyNight !== night && st.talkNight !== night) st.harmony = clamp(st.harmony - 1, 0, HARMONY_MAX);
    const r = createRng(hashSeed(seed, night, 'home.dream'));
    const roll = r.next();
    const n = r.int(1, DREAM_VARIANTS);
    const calm = 1 - clamp(run.dread(), 0, 1);
    const tier = dreamTier(st.harmony, calm, roll);
    st.dream = { night, tier, key: `phone.dream${tier === 'plain' ? '' : poolOf(night)}.${tier}.${n}` };   // plain dreams are shared
    if (tier === 'good') run.buffs.add('blessed', { source: { kind: 'phone', id: 'spouse' } });
    else if (tier === 'cold') run.buffs.add('restless', { source: { kind: 'phone', id: 'spouse' } });
  }

  unsubs.push(bus.on('shift:phase', ({ phase }) => {
    if (phase === 'play') beginWatch();
    else if (phase === 'closing' || phase === 'settle' || phase === 'collection' || phase === 'intermission' || phase === 'over') endWatch();
  }));
  // Heat inputs from the run (wave 71): each missed Watch tithe beyond the first in a Night, and a rescue loan taken.
  unsubs.push(bus.on('run:tithe', (e) => {
    if (disposed || e.state !== 'missed') return;
    const night = run.night();
    if (st.titheNight !== night) { st.titheNight = night; st.titheMisses = 0; }
    st.titheMisses += 1;
    if (st.titheMisses > TITHE_FREE_MISSES) bumpHeat(1, 'tithe');
  }));
  unsubs.push(bus.on('run:rescue', (e) => { if (!disposed && e.state === 'taken') bumpHeat(1, 'loan'); }));
  unsubs.push(bus.on('home:stage', ({ stage }) => { if (stage === 'sleep') closeNight(); }));

  const api: HomePhoneApi = {
    tick(dt: number): void {
      if (disposed) return;
      // The phase event is the normal start; a phone created mid-Watch catches up on its first tick.
      if (!st.playing && run.shift?.phase === 'play') beginWatch();
      if (!st.playing) return;
      st.elapsed += dt;
      let i = st.plans.findIndex((p) => p.at <= st.elapsed);
      while (i >= 0) {
        const [p] = st.plans.splice(i, 1);
        fire(p);
        i = st.plans.findIndex((q) => q.at <= st.elapsed);
      }
    },

    messages(): readonly PhoneMessage[] { return st.msgs; },

    unread(): number { return st.msgs.reduce((n, m) => n + (m.read ? 0 : 1), 0); },

    markRead(thread: PhoneThread): void {
      for (const m of st.msgs) if (m.thread === thread) m.read = true;
    },

    reply(id: string, choice: number): boolean {
      const msg = st.msgs.find((m) => m.id === id);
      if (!msg || msg.answered !== null || !Number.isInteger(choice) || choice < 0 || choice >= msg.replies.length) return false;
      let harmony = 0, heat = 0, coins = 0, deal: 0 | 1 | 2 = 0;
      if (msg.thread === 'spouse') {
        const reply = SPOUSE_BY_TEXT.get(msg.textKey)?.replies[choice];
        if (!reply) return false;
        harmony = reply.harmony;
        coins = replyCoinCost(msg, choice);
      } else if (msg.textKey === DEAL_KEY) {
        // THE DEAL (wave 73): pay the share of the pocket and Heat drops; refuse and nothing moves
        deal = choice === 0 ? 1 : 2;
        if (choice === 0) { coins = Math.max(0, Number(msg.vars?.cost ?? 0)); heat = DEAL_HEAT; }
      } else {
        heat = COLLECTOR_REPLIES[choice]?.heat ?? 0;
      }
      if (coins > 0 && !run.spend('coin', coins, 'phone.reply')) return false;   // not enough in the pocket: nothing applies
      st.harmony = clamp(st.harmony + harmony, 0, HARMONY_MAX);
      if (heat) bumpHeat(heat, deal ? 'deal' : 'time');
      if (deal) { const c = run.chapterRecord?.(); if (c) c.deal = deal; }
      if (msg.thread === 'spouse') st.replyNight = msg.night;
      msg.answered = choice;
      msg.read = true;
      bus.emit('msg:reply', { id, thread: msg.thread, choice });
      return true;
    },

    harmony(): number { return st.harmony; },

    heat(): number { return st.heat; },

    onEvening(): void {
      const due = run.debt().due;
      st.margin = 0;
      if (due > 0) {
        // The Night's surplus stays in the ledger until the next Night opens; `debt().paid` has been reset by Dawn.
        const margin = Math.max(0, run.nightLedger().carried) / due;
        st.margin = margin;
        if (margin >= MARGIN_WARM) st.harmony = clamp(st.harmony + 1, 0, HARMONY_MAX);
        else if (margin < MARGIN_THIN) {
          st.harmony = clamp(st.harmony - 1, 0, HARMONY_MAX);
          bumpHeat(1, 'thin');
        }
      }
      // A quiet Night (no Heat change at all, this Evening's margin included) cools off by one.
      if (!st.heatMoved && st.heat > 0) bumpHeat(-1, 'quiet');
      st.heatMoved = false;
    },

    talk(): Array<{ key: string; vars?: Record<string, string | number> }> {
      const h = st.harmony;
      const night = run.night();
      const lines: Array<{ key: string; vars?: Record<string, string | number> }> = [
        { key: `phone.talk${poolOf(night)}.h${h}.1` },
        { key: `phone.talk${poolOf(night)}.h${h}.2` },
      ];
      st.talkNight = night;
      // warmth only: +1 Harmony at most once a Night, and only when the Night was paid with a real margin
      if (st.margin >= MARGIN_TALK && st.warmNight !== night) {
        st.warmNight = night;
        st.harmony = clamp(st.harmony + 1, 0, HARMONY_MAX);
      }
      return lines;
    },

    snapshot(): PhoneSave | undefined {
      const save: PhoneSave = {
        v: 2, harmony: st.harmony, heat: st.heat, msgs: st.msgs, spouseNight: st.spouseNight,
        collectorSent: st.collectorSent, heatMoved: st.heatMoved, margin: st.margin, warmNight: st.warmNight,
        talkNight: st.talkNight, replyNight: st.replyNight, dream: st.dream, playing: st.playing,
        watchKey: st.watchKey, elapsed: st.elapsed, plans: st.plans, titheNight: st.titheNight, titheMisses: st.titheMisses,
        visit: st.visit,
      };
      return JSON.parse(JSON.stringify(save)) as PhoneSave;
    },

    restore(s: PhoneSave | undefined): void {
      const next = freshState();
      if (s && typeof s === 'object') {
        next.harmony = intIn(s.harmony, 0, HARMONY_MAX, HARMONY_START);
        next.heat = intIn(s.heat, 0, HEAT_MAX, 0);
        next.msgs = Array.isArray(s.msgs) ? s.msgs.map(readMsg).filter((m): m is PhoneMessage => m !== null) : [];
        next.spouseNight = intIn(s.spouseNight, 0, 999, 0);
        next.collectorSent = intIn(s.collectorSent, 0, 999, 0);
        next.heatMoved = s.heatMoved === true;
        next.margin = typeof s.margin === 'number' && Number.isFinite(s.margin) ? clamp(s.margin, 0, 1e6) : 0;
        next.warmNight = intIn(s.warmNight, 0, 999, 0);
        next.talkNight = intIn(s.talkNight, 0, 999, 0);
        next.replyNight = intIn(s.replyNight, 0, 999, 0);
        next.dream = readDream(s.dream);
        next.titheNight = intIn(s.titheNight, 0, 999, 0);
        next.titheMisses = intIn(s.titheMisses, 0, 99, 0);
        next.visit = s.visit && typeof s.visit === 'object' ? s.visit : null;
        next.playing = s.playing === true;
        next.watchKey = typeof s.watchKey === 'string' ? s.watchKey : '';
        next.elapsed = typeof s.elapsed === 'number' && Number.isFinite(s.elapsed) ? Math.max(0, s.elapsed) : 0;
        next.plans = Array.isArray(s.plans) ? s.plans.map(readPlan).filter((p): p is Plan => p !== null) : [];
        if (!next.playing) { next.plans = []; next.watchKey = ''; next.elapsed = 0; }
      }
      st = next;
    },

    dispose(): void {
      disposed = true;
      for (const off of unsubs.splice(0)) {
        try { off(); } catch (err) { log.error('phone', err); }
      }
    },
  };
  DREAMS.set(api, () => st.dream);
  HOOKS.set(api, {
    heat: (d, why) => { if (!disposed) bumpHeat(d, why); },
    harmony: (d) => { if (!disposed) st.harmony = clamp(st.harmony + d, 0, HARMONY_MAX); },
    visit: () => st.visit,
    setVisit: (v) => { st.visit = v; },
  });
  return api;
}
