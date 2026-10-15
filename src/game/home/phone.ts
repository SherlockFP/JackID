/**
 * THE PHONE (wave 69, Home layer): the player's own phone with two threads, the spouse (EŞİM / SPOUSE) and the Collector
 * (TAHSİLDAR / THE COLLECTOR), per docs/WAVE69_HOME.md §4–6. The run creates it with `createPhone(run)` and ticks it every
 * frame; the UI (phone.ui.ts) reads it through `run.homePhone()`, and the flow calls `onEvening()` and `talk()` at home.
 *
 * Messages arrive during Watches only (shift phase 'play'). Every roll is a fresh stream, hashSeed(run seed, Night, Watch,
 * 'msg.<thread>'), so a seeded run and a bench replay get the same phone. A reply applies once; coins go through `run.spend`;
 * Harmony (spouse, 0..5, start 3) and Heat (Collector, 0..6, start 0) are clamped. Time is sim seconds from `tick(dt)`.
 */
import { bus } from '@/core/events';
import { log } from '@/core/log';
import { createRng, hashSeed } from '@/core/rng';
import type { HomePhoneApi, PhoneMessage, PhoneSave, PhoneThread } from './contract';
import type { DebtRun } from '../run';

// ── rules (numbers from the spec; tune here, nowhere else) ────────────────────────────────────────────────────────────
export const HARMONY_START = 3;
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
/** The first talk of an Evening at this Harmony or more grants the blessing. */
export const BLESS_HARMONY = 4;
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

/** Collector replies: "I'll pay" is free, "I need time" adds one Heat. Keys `phone.co.reply.pay|time`. */
export const COLLECTOR_REPLIES: readonly { key: string; heat: number }[] = [
  { key: 'phone.co.reply.pay', heat: 0 },
  { key: 'phone.co.reply.time', heat: 1 },
];
/** Collector message text variants per stage: keys `phone.co.s<stage>.<variant>`. */
export const COLLECTOR_VARIANTS = 3;

const SPOUSE_BY_TEXT: ReadonlyMap<string, SpouseDef> = new Map(SPOUSE_MESSAGES.map((d) => [`phone.sp.${d.id}.t`, d]));

/** Coins a `send` reply costs for a Night's quota: a share of it, at least one coin. */
export function coinCost(due: number, share: number): number {
  return Math.max(1, Math.round(due * share));
}

/**
 * What a reply to `msg` costs in coins (0 for words). The UI uses it to grey out a reply the pocket cannot cover; `reply()`
 * spends exactly this amount, so the two always agree.
 */
export function replyCoinCost(msg: PhoneMessage, choice: number): number {
  if (msg.thread !== 'spouse' || !Number.isInteger(choice)) return 0;
  const def = SPOUSE_BY_TEXT.get(msg.textKey);
  const reply = def?.replies[choice];
  if (!def || !reply || reply.kind !== 'send') return 0;
  return Math.max(0, Number(msg.vars?.cost ?? 0));
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Plan { thread: PhoneThread; night: number; watch: number; last: boolean; at: number; pick: number }
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
  /** The first talk of this Evening has happened. */
  talked: boolean;
  /** A play Watch is running: plans are live and `elapsed` counts its sim seconds. */
  playing: boolean;
  watchKey: string;
  elapsed: number;
  plans: Plan[];
}

function freshState(): State {
  return {
    harmony: HARMONY_START, heat: 0, msgs: [], spouseNight: 0, collectorSent: 0, heatMoved: false, talked: false,
    playing: false, watchKey: '', elapsed: 0, plans: [],
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
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0, pick: intIn(o.pick, 0, 999, 0),
  };
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
    if (w <= 1 && st.spouseNight !== night) {
      const r = createRng(hashSeed(seed, night, w, 'msg.spouse'));
      if (r.chance(SPOUSE_CHANCE)) {
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

  /** The play window ended (or the phase left play): the pending messages do not arrive. */
  function endWatch(): void {
    st.playing = false;
    st.watchKey = '';
    st.elapsed = 0;
    st.plans = [];
  }

  function bumpHeat(d: number): void {
    const before = st.heat;
    st.heat = clamp(st.heat + d, 0, HEAT_MAX);
    if (st.heat !== before) st.heatMoved = true;
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
    const def = SPOUSE_MESSAGES[p.pick % SPOUSE_MESSAGES.length];
    const cost = def.share ? coinCost(run.debt().due, def.share) : 0;
    push({
      id: msgId(p), thread: 'spouse', night: p.night, watch: p.watch + 1,
      textKey: `phone.sp.${def.id}.t`, vars: { cost },
      replies: def.replies.map((_, i) => `phone.sp.${def.id}.r${i}`),
      read: false, answered: null,
    });
    st.spouseNight = p.night;
  }

  /** The Collector writes only when the Night is behind: from Watch 2, and more than the share still owed. */
  function deliverCollector(p: Plan): void {
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

  unsubs.push(bus.on('shift:phase', ({ phase }) => {
    if (phase === 'play') beginWatch();
    else if (phase === 'closing' || phase === 'settle' || phase === 'collection' || phase === 'intermission' || phase === 'over') endWatch();
  }));

  return {
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
      let harmony = 0, heat = 0, coins = 0;
      if (msg.thread === 'spouse') {
        const reply = SPOUSE_BY_TEXT.get(msg.textKey)?.replies[choice];
        if (!reply) return false;
        harmony = reply.harmony;
        coins = replyCoinCost(msg, choice);
      } else {
        heat = COLLECTOR_REPLIES[choice]?.heat ?? 0;
      }
      if (coins > 0 && !run.spend('coin', coins, 'phone.reply')) return false;   // not enough in the pocket: nothing applies
      st.harmony = clamp(st.harmony + harmony, 0, HARMONY_MAX);
      if (heat) bumpHeat(heat);
      msg.answered = choice;
      msg.read = true;
      bus.emit('msg:reply', { id, thread: msg.thread, choice });
      return true;
    },

    harmony(): number { return st.harmony; },

    heat(): number { return st.heat; },

    onEvening(): void {
      const due = run.debt().due;
      if (due > 0) {
        // The Night's surplus stays in the ledger until the next Night opens; `debt().paid` has been reset by Dawn.
        const margin = Math.max(0, run.nightLedger().carried) / due;
        if (margin >= MARGIN_WARM) st.harmony = clamp(st.harmony + 1, 0, HARMONY_MAX);
        else if (margin < MARGIN_THIN) {
          st.harmony = clamp(st.harmony - 1, 0, HARMONY_MAX);
          bumpHeat(1);
        }
      }
      // A quiet Night (no Heat change at all, this Evening's margin included) cools off by one.
      if (!st.heatMoved && st.heat > 0) st.heat = clamp(st.heat - 1, 0, HEAT_MAX);
      st.heatMoved = false;
      st.talked = false;
    },

    talk(): Array<{ key: string; vars?: Record<string, string | number> }> {
      const h = st.harmony;
      const lines: Array<{ key: string; vars?: Record<string, string | number> }> = [
        { key: `phone.talk.h${h}.1` },
        { key: `phone.talk.h${h}.2` },
      ];
      if (!st.talked) {
        st.talked = true;
        if (h >= BLESS_HARMONY) {
          run.buffs.add('blessed', { source: { kind: 'phone', id: 'spouse' } });
          lines.push({ key: 'phone.talk.bless' });
        }
      }
      return lines;
    },

    snapshot(): PhoneSave | undefined {
      const save: PhoneSave = {
        v: 1, harmony: st.harmony, heat: st.heat, msgs: st.msgs, spouseNight: st.spouseNight,
        collectorSent: st.collectorSent, heatMoved: st.heatMoved, talked: st.talked, playing: st.playing,
        watchKey: st.watchKey, elapsed: st.elapsed, plans: st.plans,
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
        next.talked = s.talked === true;
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
}
