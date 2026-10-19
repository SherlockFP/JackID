/**
 * LOKI, THE BORROWED VOICE (docs/JOKER.md, wave J1): pure, seeded rules. No bus, no DOM, no three, no wall clock.
 *
 *   Trust  -3..+3, starts at 0. His mood; it decides how often he lies (the truth table).
 *   Ink    0..10, his memory writing over yours. It decides whether you can tell (the "we" tell) and when his hand moves on its own.
 *          The run stores this one integer and Dread reads `inkDread(ink)` (4 points an Ink) as a new input, like a cursed charm.
 *
 * Everything that changes state returns plain data plus `events`: `{ name, data }` pairs named like the bus events (joker:trust,
 * joker:ink, joker:whisper, joker:takeover). The run emits them; this file never touches the bus. Rolls come from an Rng built from
 * `hashSeed(seed, night, watch, 'joker', n)`, so a replay with the same calls is identical and an unrelated roll can't shift them.
 * The run creates `new Joker(run.seed)`, saves `snapshot()` under `resume.ext.joker` and calls `restore()` on resume.
 */
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { clamp } from '@/core/math';
import type { GameEvents } from '@/core/events';
import { BLEED_COUNT, CARD_LIES, lineKeys, pickWhisper, type Serves, type WhisperCtx } from './whispers';
import { MARKED_CARDS, FULL_PILE, giftAt, markedCard } from './marked';
import { askCost, machineAllowed, resolveTakeover, type TakeoverCtx, type TakeoverResult, type TakeoverWhere } from './takeover';

export const TRUST_MIN = -3;
export const TRUST_MAX = 3;
export const INK_MAX = 10;
/** Dread points one Ink adds (JOKER §2.2: dread += 4 x ink). */
export const INK_DREAD = 4;
/** A boon's Ink price never takes Ink past this: a boon alone does not bring him home (the takeovers do). */
export const BOON_INK_CAP = 9;
export const ASK_TRUTH_BONUS = 0.1;
/** Ink steps of the symptom table. */
export const INK_BLEED = 4;
export const INK_HUD = 6;
export const INK_HAND = 8;
/** Unasked takeover odds by Ink band, and the Ink one costs. */
export const UNASKED_CHANCE = { low: 0.1, high: 0.25 } as const;
export const UNASKED_INK = 2;
/** From Ink 6 this share of his true lines gets a "we"; from Ink 8 this share of his lies drops it. */
export const TRUE_WE_CHANCE = 0.25;
export const LIE_DROP_CHANCE = 0.5;
/** Kept words heal at most this much Ink a Night. */
export const KEPT_HEAL_MAX = 2;
/** Free tips a Watch at Ink 0 (one more from Ink 2). */
export const TIPS_BASE = 3;

// ── bus events (named like the bus; the run emits them) ───────────────────────────────────────────────
export interface JokerTrustEvent { trust: number; delta: number; why: string }
export interface JokerInkEvent { ink: number; delta: number; why: string }
export interface JokerWhisperEvent { n: number; ctx: WhisperCtx; id: string; ask: boolean; truth: boolean; we: boolean; keys: string[] }
export interface JokerTakeoverEvent extends TakeoverResult { ink: number; paid: number; promise: boolean }

declare module '@/core/events' {
  interface GameEvents {
    /** His mood moved (-3..+3). `why` is the move's name. */
    'joker:trust': JokerTrustEvent;
    /** His memory moved (0..10). `why` is the source. */
    'joker:ink': JokerInkEvent;
    /** He said something: the lines to show (join the keys with a space) and whether it was true. */
    'joker:whisper': JokerWhisperEvent;
    /** His hand moved. */
    'joker:takeover': JokerTakeoverEvent;
  }
}
export type JokerEventName = 'joker:trust' | 'joker:ink' | 'joker:whisper' | 'joker:takeover';
export type JokerEvent = { [K in JokerEventName]: { name: K; data: GameEvents[K] } }[JokerEventName];

// ── pure rules ─────────────────────────────────────────────────────────────────────────────────────────
/** Dread the Ink adds (the Dread input). */
export const inkDread = (ink: number): number => INK_DREAD * clamp(Math.floor(ink), 0, INK_MAX);

/**
 * What a boon of "cost n" charges in Ink (for the pantheon): a whole number, never negative and never past the cap. Whether the player can
 * pay it now is `Joker.canPayInk`; paying is `Joker.payInk`.
 */
export const inkCost = (n: number): number => clamp(Math.round(Number.isFinite(n) ? n : 0), 0, BOON_INK_CAP);

/** The chance a whisper is true: 0.70 + 0.08 x trust when a lie gains him nothing, 0.40 + 0.10 x trust when it serves him, +0.10 for an Ask, 0.05..0.95. */
export function truthChance(trust: number, serves: Serves, ask = false): number {
  const base = serves === 'free' ? 0.7 + 0.08 * trust : 0.4 + 0.1 * trust;
  return clamp(base + (ask ? ASK_TRUTH_BONUS : 0), 0.05, 0.95);
}

export interface RollIn { trust: number; ink: number; serves: Serves; ask?: boolean; onHisWord?: boolean }
export interface Roll { truth: boolean; /** The line shown carries a "we" (the tell). */ we: boolean; p: number }

/**
 * One whisper's truth and tell. Always draws two numbers. Ink 0-5 the tell is perfect (a lie says "we", a truth never does); from Ink 6 a
 * quarter of true lines say "we"; from Ink 8 half the lies drop it. On his word it is true and has no tell, whatever the Ink.
 */
export function rollWhisper(rng: Rng, i: RollIn): Roll {
  const u = rng.next(), v = rng.next();
  if (i.onHisWord) return { truth: true, we: false, p: 1 };
  const p = truthChance(i.trust, i.serves, i.ask);
  const truth = u < p;
  const we = truth ? i.ink >= INK_HUD && v < TRUE_WE_CHANCE : !(i.ink >= INK_HAND && v < LIE_DROP_CHANCE);
  return { truth, we, p };
}

/** How many free tips he offers a Watch: about three, one more from Ink 2. */
export const tipsPerWatch = (ink: number): number => TIPS_BASE + (ink >= 2 ? 1 : 0);

/** Odds that his hand moves on its own at a key moment: 0 below Ink 6, 10 % at 6-7, 25 % at 8-9. */
export const unaskedChance = (ink: number): number => (ink >= INK_MAX ? 0 : ink >= INK_HAND ? UNASKED_CHANCE.high : ink >= INK_HUD ? UNASKED_CHANCE.low : 0);

/** What an unasked takeover does: Trust +1 or more helps, -1 or less is spite, 0 is a coin flip (`u` is a draw in [0,1)). */
export const unaskedKind = (trust: number, u: number): 'help' | 'spite' => (trust >= 1 ? 'help' : trust <= -1 ? 'spite' : u < 0.5 ? 'help' : 'spite');

/** Two draws: whether it strikes, and (at Trust 0) which way. */
export function rollUnasked(rng: Rng, i: { ink: number; trust: number }): { strike: boolean; kind: 'help' | 'spite' } {
  const u = rng.next(), k = rng.next();
  return { strike: u < unaskedChance(i.ink), kind: unaskedKind(i.trust, k) };
}

export type Mood = 'sour' | 'flat' | 'fond';
export const moodOf = (trust: number): Mood => (trust < 0 ? 'sour' : trust > 0 ? 'fond' : 'flat');
/** The card's grin: seven frames, 0 = bared teeth ... 6 = wide grin. */
export const grinFrame = (trust: number): number => clamp(Math.round(trust), TRUST_MIN, TRUST_MAX) + 3;
/** The frame the card shows: from Ink 6 one glance in three is a wrong frame. The journal shows `grinFrame`. */
export function shownFrame(rng: Rng, trust: number, ink: number): number {
  const u = rng.next(), w = rng.int(0, 5);
  const real = grinFrame(trust);
  return ink >= INK_HUD && u < 1 / 3 ? (w >= real ? w + 1 : w) : real;
}

/** The glove: black tips (an even Ink) and one stained tip when the Ink is odd. */
export const gloveOf = (ink: number): { black: number; stained: boolean } => ({ black: Math.floor(clamp(ink, 0, INK_MAX) / 2), stained: ink % 2 === 1 });

export interface Symptoms {
  /** 0 clean (Ink 0-1), 1 talkative (2-3), 2 BLEED (4-5), 3 THE HUD LIES (6-7), 4 HIS HAND (8-9), 5 HE CAME HOME (10). */
  band: 0 | 1 | 2 | 3 | 4 | 5;
  blackTips: number;
  extraTip: boolean;
  /** His head sits silent in every glass; one NPC subtitle in five turns a word into his; your inner line ends in his voice. */
  bleed: boolean;
  /** The pocket count-up overshoots by up to 5 % and snaps back; the card shows a wrong frame; rims flicker. */
  hudLies: boolean;
  /** Share of his true lines that say "we". */
  trueWe: number;
  /** Share of his lies that drop the tell. */
  lieDropsWe: number;
  /** Chance his hand moves on its own at a key moment. */
  unasked: number;
  /** Once a Night he finishes a reply to Ada and its Harmony move drops by 1. */
  hisHand: boolean;
  /** He talks at home and remembers her kitchen as his. */
  talksAtHome: boolean;
  home: boolean;
}

export function symptoms(ink: number): Symptoms {
  const i = clamp(Math.floor(ink), 0, INK_MAX);
  return {
    band: (i >= INK_MAX ? 5 : i >= INK_HAND ? 4 : i >= INK_HUD ? 3 : i >= INK_BLEED ? 2 : i >= 2 ? 1 : 0) as Symptoms['band'],
    blackTips: Math.floor(i / 2), extraTip: i >= 2, bleed: i >= INK_BLEED, hudLies: i >= INK_HUD,
    trueWe: i >= INK_HUD ? TRUE_WE_CHANCE : 0, lieDropsWe: i >= INK_HAND ? LIE_DROP_CHANCE : 0, unasked: unaskedChance(i),
    hisHand: i >= INK_HAND && i < INK_MAX, talksAtHome: i >= INK_HAND, home: i >= INK_MAX,
  };
}

// ── Trust moves (§2.1) ─────────────────────────────────────────────────────────────────────────────────
type Cap = 'watch' | 'night' | 'run';
/** Every Trust move: the change and how often it can count. */
export const TRUST_MOVES = {
  dare: { d: 1, cap: 'watch' },        // take a dare: max +1 a Watch
  feed: { d: 1 },                      // feed him a marked card
  kept: { d: 1 },                      // keep a promise made to him (checked at Dawn)
  caught: { d: 1, cap: 'night' },      // catch a lie: C within 3 s of a lie, once a Night
  asked: { d: 1, cap: 'night' },       // ask him to take over: he likes being needed, once a Night
  wrongLiar: { d: -1 },                // call him a liar when he told the truth
  refuse: { d: -1 },                   // refuse a dare or a promise
  clerkCard: { d: -1 },                // hand a marked card to the Clerk
  broke: { d: -2 },                    // break a promise to him
  admit: { d: -2, cap: 'run' },        // admit him to Ada (N5, once)
  adaBreak: { d: 1 },                  // at Ada's table, break your word because he asked
  adaKeep: { d: -1 },                  // ... or keep it
} as const satisfies Record<string, { d: number; cap?: Cap }>;
export type TrustMove = keyof typeof TRUST_MOVES;

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────
export interface Tally { we: number; weWrong: number; plain: number; plainWrong: number }
export interface Whisper { n: number; ctx: WhisperCtx; id: string; ask: boolean; truth: boolean; we: boolean; keys: string[]; onHisWord: boolean; p: number }
export interface Outcome { events: JokerEvent[] }
export type WhisperOut = Whisper & Outcome;

export interface JokerSave {
  v: 1;
  trust: number; ink: number;
  night: number; watch: number; n: number; tk: number; un: number; tips: number;
  /** Once-a-Watch / Night / run counters: the token (Watch, Night or 1) the move last counted in. */
  used: Record<string, number>;
  admitted: boolean; wordOffered: boolean; wordSpent: boolean;
  fed: string[]; handed: string[];
  healed: { night: number; n: number };
  lastAskMachine: string | null;
  coffee: 0 | 1 | 2;
  promise: { id: string; night: number } | null;
  last: { n: number; truth: boolean; called: boolean } | null;
  tally: Tally;
}

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : d);
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!markedCard(x)))] : []);

export type AskWhy = 'ended' | 'cooldown' | 'sameMachine' | 'once' | 'machine' | 'promiseOpen' | 'noPromise';
export type AskResult =
  | { ok: false; why: AskWhy; events: JokerEvent[] }
  | { ok: true; result: TakeoverResult; /** Ink paid. */ paid: number; /** Paid with a promise instead (Trust -1 or lower). */ promise: boolean; events: JokerEvent[] };

export interface AskCtx extends Omit<TakeoverCtx, 'asked' | 'kind'> {
  /** The N1 tutorial takeover costs no Ink. */
  tutorial?: boolean;
  /** At Trust -1 or lower: pay with a promise instead of Ink. */
  pay?: 'ink' | 'promise';
}

/** The key moments an unasked takeover can strike at (JOKER §4). */
export type Moment = 'bigBet' | 'matchPoint' | 'crookedCall' | 'knock' | 'adaThrow' | 'kitchenWager';
const MOMENT_WHERE: Record<Moment, TakeoverWhere> = { bigBet: 'machine', matchPoint: 'duel', crookedCall: 'crooked', knock: 'knock', adaThrow: 'duel', kitchenWager: 'duel' };
export interface UnaskedCtx extends Omit<TakeoverCtx, 'where' | 'asked' | 'kind'> {
  /** Ada's hair tie is on your wrist: the first unasked takeover each Night slips off. */
  hairTie?: boolean;
}
export type UnaskedResult =
  | { struck: false; blocked?: 'coffee' | 'hairTie' | 'machine' | 'ended'; /** The hair tie's line, when it slipped. */ lines: string[]; events: JokerEvent[] }
  | { struck: true; kind: 'help' | 'spite'; result: TakeoverResult; events: JokerEvent[] };

export interface CardOut extends Outcome {
  id: string; action: 'feed' | 'clerk'; truth: boolean; we: boolean;
  /** Keys to show, joined with a space: the memory (or the lie) when fed, the Clerk's record when handed over. */
  keys: string[];
  /** Collector Heat change (-1 for the Clerk). */
  heat: number;
  /** The charm his gift unlocks when this feed reaches 3, 6 or 9. */
  gift: string | null;
  /** A full pile now names the rest of him (the Compere). */
  namesCompere: boolean;
}

export class Joker {
  trust = 0;
  ink = 0;
  private night = 0;
  private watch = 0;
  private n = 0;
  private tk = 0;
  private un = 0;
  private tips = 0;
  private used: Record<string, number> = {};
  private admitted = false;
  private wordOffered = false;
  private wordSpent = false;
  private fed: string[] = [];
  private handed: string[] = [];
  private healed = { night: 0, n: 0 };
  private lastAskMachine: string | null = null;
  private coffee: 0 | 1 | 2 = 0;
  private promiseOpen: { id: string; night: number } | null = null;
  private last: { n: number; truth: boolean; called: boolean } | null = null;
  private tallyNow: Tally = { we: 0, weWrong: 0, plain: 0, plainWrong: 0 };

  constructor(readonly seed: number) {}

  // ── reads ──
  get cameHome(): boolean { return this.ink >= INK_MAX; }
  get mood(): Mood { return moodOf(this.trust); }
  get frame(): number { return grinFrame(this.trust); }
  get symptoms(): Symptoms { return symptoms(this.ink); }
  /** Dread the Ink adds right now. */
  get dread(): number { return inkDread(this.ink); }
  /** His word is earned (Trust +3 once) and not spent. */
  get wordReady(): boolean { return this.wordOffered && !this.wordSpent; }
  get tally(): Readonly<Tally> { return this.tallyNow; }
  get fedCards(): readonly string[] { return this.fed; }
  get handedCards(): readonly string[] { return this.handed; }
  get promise(): Readonly<{ id: string; night: number }> | null { return this.promiseOpen; }
  /** A Watch's unasked takeovers are blocked (coffee). */
  get coffeeOn(): boolean { return this.coffee === 2; }
  /** He has tips left this Watch. */
  get tipsLeft(): number { return Math.max(0, tipsPerWatch(this.ink) - this.tips); }
  /** A full pile of either kind names the rest of him, the Compere. */
  get namesCompere(): boolean { return this.fed.length >= FULL_PILE || this.handed.length >= FULL_PILE; }

  // ── time ──
  beginNight(night: number): void {
    this.night = Math.max(0, Math.floor(night));
    this.watch = 0;
    this.tips = 0;
  }
  /** A Watch starts: his tips refill, and a coffee drunk since the last Watch blocks unasked takeovers for this one. */
  beginWatch(watch: number): void {
    this.watch = Math.max(0, Math.floor(watch));
    this.tips = 0;
    this.coffee = this.coffee === 1 ? 2 : 0;
  }
  /** Coffee blocks his unasked takeovers for the next Watch. */
  drinkCoffee(): void { this.coffee = 1; }

  private tok(scope: Cap): number { return scope === 'watch' ? this.night * 100 + this.watch : scope === 'night' ? this.night : 1; }
  /** True the first time `key` counts in its scope, false after. */
  private once(key: string, scope: Cap): boolean {
    const t = this.tok(scope);
    if (this.used[key] === t) return false;
    this.used[key] = t;
    return true;
  }

  // ── Trust ──
  private shiftTrust(d: number, why: string, out: JokerEvent[]): number {
    const before = this.trust;
    this.trust = clamp(this.trust + d, TRUST_MIN, TRUST_MAX);
    if (this.trust >= TRUST_MAX) this.wordOffered = true;
    const delta = this.trust - before;
    if (delta !== 0) out.push({ name: 'joker:trust', data: { trust: this.trust, delta, why } });
    return delta;
  }

  /** One Trust move. A move past its cap (a second dare in a Watch, a second catch in a Night) changes nothing. */
  trustMove(move: TrustMove): Outcome & { delta: number } {
    const events: JokerEvent[] = [];
    const m: { d: number; cap?: Cap } = TRUST_MOVES[move];
    if (m.cap && !this.once(`trust.${move}`, m.cap)) return { delta: 0, events };
    return { delta: this.shiftTrust(m.d, move, events), events };
  }

  /** Answer a dare: yes is +1 (max +1 a Watch), no is -1. */
  dare(accept: boolean): Outcome & { delta: number } { return this.trustMove(accept ? 'dare' : 'refuse'); }

  /** He asks one promise a Night at most: true when he may ask now. */
  canAskPromise(): boolean { return this.promiseOpen === null && this.used['promiseAsked'] !== this.tok('night'); }
  /** Answer his promise. Yes opens it until Dawn; no is -1. */
  promiseAnswer(accept: boolean, id = 'p'): Outcome & { delta: number } {
    if (!accept) return this.trustMove('refuse');
    if (!this.canAskPromise()) return { delta: 0, events: [] };
    this.used['promiseAsked'] = this.tok('night');
    this.promiseOpen = { id, night: this.night };
    return { delta: 0, events: [] };
  }
  /** Dawn: the open promise was kept (+1 and the kept word heals Ink) or broken (-2). */
  settlePromise(kept: boolean): Outcome & { delta: number } {
    if (!this.promiseOpen) return { delta: 0, events: [] };
    this.promiseOpen = null;
    if (!kept) return this.trustMove('broke');
    const t = this.trustMove('kept');
    return { delta: t.delta, events: [...t.events, ...this.keptWord('promise').events] };
  }

  /** Admit him to Ada (N5, once): -2. */
  admit(): Outcome & { delta: number } {
    const r = this.trustMove('admit');
    if (r.delta !== 0) this.admitted = true;
    return r;
  }
  get isAdmitted(): boolean { return this.admitted; }

  /**
   * At Ada's table (Ink 8+) he asks you to break your word to her. Breaking: Trust +1, Harmony -1 and a crack. Keeping: Trust -1, and the kept
   * word still heals Ink. Returns the Harmony change and the crack for the wiring.
   */
  adaWord(broke: boolean): Outcome & { delta: number; harmony: number; crack: boolean } {
    if (broke) return { ...this.trustMove('adaBreak'), harmony: -1, crack: true };
    const t = this.trustMove('adaKeep');
    return { delta: t.delta, events: [...t.events, ...this.keptWord('ada').events], harmony: 0, crack: false };
  }

  /** Press C on the last whisper: a lie caught is +1 (once a Night), a truth called a lie is -1. Each whisper can be called once. */
  callLiar(): Outcome & { right: boolean | null; delta: number } {
    const l = this.last;
    if (!l || l.called) return { right: null, delta: 0, events: [] };
    l.called = true;
    const r = this.trustMove(l.truth ? 'wrongLiar' : 'caught');
    return { right: !l.truth, delta: r.delta, events: r.events };
  }

  // ── Ink ──
  private shiftInk(d: number, why: string, out: JokerEvent[]): number {
    const before = this.ink;
    this.ink = clamp(this.ink + d, 0, INK_MAX);
    const delta = this.ink - before;
    if (delta !== 0) out.push({ name: 'joker:ink', data: { ink: this.ink, delta, why } });
    return delta;
  }
  /** Raises Ink by `n` (the pantheon uses `payInk`). */
  raiseInk(n: number, why: string): Outcome & { delta: number } {
    const events: JokerEvent[] = [];
    return { delta: this.shiftInk(Math.abs(n), why, events), events };
  }
  private heal(n: number, why: string): Outcome & { delta: number } {
    const events: JokerEvent[] = [];
    return { delta: this.shiftInk(-Math.abs(n), why, events), events };
  }
  /** A boon of cost `n` can be paid now without bringing him home. */
  canPayInk(n: number): boolean { return this.ink + inkCost(n) <= BOON_INK_CAP; }
  /** The pantheon's price: pays `inkCost(n)` Ink, or nothing if that would take Ink past the cap. */
  payInk(n: number, why = 'boon'): Outcome & { ok: boolean; paid: number } {
    if (!this.canPayInk(n)) return { ok: false, paid: 0, events: [] };
    const r = this.raiseInk(inkCost(n), why);
    return { ok: true, paid: r.delta, events: r.events };
  }

  /** Sleep at home: -2 (-1 if Ada is at her sister's). */
  sleep(adaAway = false): Outcome & { delta: number } { return this.heal(adaAway ? 1 : 2, 'sleep'); }
  /** An evening of kept words at Ada's table: -1. */
  adaEvening(): Outcome & { delta: number } { return this.heal(1, 'evening'); }
  /** Soup with Ada: -1 (-2 once you've admitted him). */
  soup(): Outcome & { delta: number } { return this.heal(this.admitted ? 2 : 1, 'soup'); }
  /** Any kept word (a kept-word duel win, a promise to him kept at Dawn): -1 each, at most 2 a Night. */
  keptWord(why = 'kept'): Outcome & { delta: number } {
    if (this.healed.night !== this.night) this.healed = { night: this.night, n: 0 };
    if (this.healed.n >= KEPT_HEAL_MAX) return { delta: 0, events: [] };
    this.healed.n += 1;
    return this.heal(1, why);
  }
  /** His hand: once a Night, at Ink 8-9, he finishes your reply to Ada and its Harmony move drops by 1. True when it happens now. */
  hisHandReply(): boolean { return this.symptoms.hisHand && this.once('hand', 'night'); }

  // ── whispers ──
  /**
   * He speaks. `ask` is the card key (Ink +1, +10 points of truth); a tip is free but limited per Watch; `onHisWord` is the once-a-run
   * answer that is always true and has no tell. Returns null when he has nothing to say (no tips left, the kitchen below Ink 8, no
   * entry for the fact, he is home), and then nothing changes.
   */
  whisper(req: { ctx: WhisperCtx; ask?: boolean; fact?: string; onHisWord?: boolean; exclude?: readonly string[] }): WhisperOut | null {
    const ask = req.ask === true;
    if (this.cameHome || (!ask && this.tips >= tipsPerWatch(this.ink))) return null;
    const r = createRng(hashSeed(this.seed, this.night, this.watch, 'joker', this.n));
    const def = pickWhisper(r.fork('pick'), req.ctx, { fact: req.fact, ink: this.ink, exclude: req.exclude });
    if (!def) return null;
    const onHisWord = req.onHisWord === true && this.wordReady;
    const roll = rollWhisper(r, { trust: this.trust, ink: this.ink, serves: def.serves, ask, onHisWord });
    const keys = lineKeys(def, roll.truth, roll.we, r.fork('bleed').int(1, BLEED_COUNT));
    const w: Whisper = { n: this.n, ctx: def.ctx, id: def.id, ask, truth: roll.truth, we: roll.we, keys, onHisWord, p: roll.p };
    const events: JokerEvent[] = [];
    this.record(w, events);
    if (onHisWord) this.wordSpent = true;
    if (ask) this.shiftInk(1, 'ask', events);
    else this.tips += 1;
    return { ...w, events };
  }

  private record(w: Whisper, events: JokerEvent[]): void {
    this.n += 1;
    this.last = { n: w.n, truth: w.truth, called: false };
    const t = this.tallyNow;
    if (w.we) { t.we += 1; if (w.truth) t.weWrong += 1; } else { t.plain += 1; if (!w.truth) t.plainWrong += 1; }
    events.push({ name: 'joker:whisper', data: { n: w.n, ctx: w.ctx, id: w.id, ask: w.ask, truth: w.truth, we: w.we, keys: w.keys } });
  }

  // ── marked cards ──
  /** Feed him a marked card (Trust +1): he tells the memory, which may lie. Hand it to the Clerk instead with `clerkCard`. */
  feedCard(id: string): CardOut | null {
    if (!markedCard(id) || this.fed.includes(id) || this.handed.includes(id)) return null;
    const r = createRng(hashSeed(this.seed, this.night, this.watch, 'joker', this.n));
    const roll = rollWhisper(r, { trust: this.trust, ink: this.ink, serves: 'him' });
    // a card's lie has one line (always with the tell); a true memory can wear a bleed "we"
    const we = roll.truth ? roll.we : true;
    const keys = roll.truth
      ? (we ? [`joker.bleed.${r.fork('bleed').int(1, BLEED_COUNT)}`, `joker.card.${id}.m`] : [`joker.card.${id}.m`])
      : [`joker.lie.${r.fork('lie').int(1, CARD_LIES)}`];
    const events: JokerEvent[] = [];
    this.fed.push(id);
    this.shiftTrust(TRUST_MOVES.feed.d, 'feed', events);
    this.record({ n: this.n, ctx: 'card', id, ask: false, truth: roll.truth, we, keys, onHisWord: false, p: roll.p }, events);
    return { id, action: 'feed', truth: roll.truth, we, keys, heat: 0, gift: giftAt(this.fed.length), namesCompere: this.namesCompere, events };
  }

  /** Hand a marked card to the Clerk: Trust -1, Heat -1, Ink -1, and the Clerk's true record of the same night. */
  clerkCard(id: string): CardOut | null {
    if (!markedCard(id) || this.fed.includes(id) || this.handed.includes(id)) return null;
    const events: JokerEvent[] = [];
    this.handed.push(id);
    this.shiftTrust(TRUST_MOVES.clerkCard.d, 'clerkCard', events);
    this.shiftInk(-1, 'clerkCard', events);
    return { id, action: 'clerk', truth: true, we: false, keys: [`joker.card.${id}.c`], heat: -1, gift: null, namesCompere: this.namesCompere, events };
  }

  // ── Change of Hands ──
  /**
   * Ask him to take the hand. Price: Ink 2 (3 at Trust -1 or lower, or a promise instead), 4 at the Visit, 0 in the N1 tutorial. Limits: one a
   * Watch on the floor, never twice in a row at one machine, the Knock and the Visit once a run, never the cashier, the Debt Terminal or the bell.
   * Asking is Trust +1, once a Night. In front of the Clerk the result is never clean.
   */
  askTakeover(c: AskCtx): AskResult {
    const no = (why: AskWhy): AskResult => ({ ok: false, why, events: [] });
    if (this.cameHome) return no('ended');
    if (c.where === 'machine' && (!c.machineId || !machineAllowed(c.machineId))) return no('machine');
    const floor = c.where === 'machine' || c.where === 'duel' || c.where === 'crooked';
    if ((c.where === 'knock' || c.where === 'visit') && this.used[c.where] === 1) return no('once');
    if (floor && this.used['ask'] === this.tok('watch')) return no('cooldown');
    if (c.where === 'machine' && c.machineId === this.lastAskMachine) return no('sameMachine');
    const cost = askCost(this.trust, c.where, c.tutorial);
    const byPromise = c.pay === 'promise' && cost.promiseOk;
    if (c.pay === 'promise' && !cost.promiseOk) return no('noPromise');
    if (byPromise && this.promiseOpen) return no('promiseOpen');

    const events: JokerEvent[] = [];
    if (c.where === 'knock' || c.where === 'visit') this.used[c.where] = 1;
    if (floor) this.used['ask'] = this.tok('watch');
    this.lastAskMachine = c.where === 'machine' ? c.machineId ?? null : null;
    events.push(...this.trustMove('asked').events);
    const paid = byPromise ? 0 : cost.ink;
    if (byPromise) this.promiseOpen = { id: 'takeover', night: this.night };
    this.shiftInk(paid, c.where === 'visit' ? 'visit' : 'takeover', events);
    const result = resolveTakeover(createRng(hashSeed(this.seed, this.night, this.watch, 'joker.t', this.tk++)), { ...c, asked: true });
    events.push({ name: 'joker:takeover', data: { ...result, ink: this.ink, paid, promise: byPromise } });
    return { ok: true, result, paid, promise: byPromise, events };
  }

  /**
   * A key moment: a bet of a quarter of the pocket or more, a duel's match point, a Crooked Table call, the Knock, a throw at Ada's table.
   * From Ink 6 his hand may move on its own: 10 % at Ink 6-7, 25 % at 8-9, for Ink +2. Coffee blocks it for the Watch; Ada's hair tie makes
   * the first one each Night slip off ("not that hand") and costs no Ink. The N8 kitchen wager ('kitchenWager') is Clerk-witnessed and help and
   * spite look the same there.
   */
  unasked(moment: Moment, c: UnaskedCtx = {}): UnaskedResult {
    const roll = rollUnasked(createRng(hashSeed(this.seed, this.night, this.watch, 'joker.u', this.un++)), { ink: this.ink, trust: this.trust });
    const where = MOMENT_WHERE[moment];
    const none = (blocked?: 'coffee' | 'hairTie' | 'machine' | 'ended', lines: string[] = []): UnaskedResult => ({ struck: false, blocked, lines, events: [] });
    if (this.cameHome) return none('ended');
    if (!roll.strike) return none();
    if (where === 'machine' && (!c.machineId || !machineAllowed(c.machineId))) return none('machine');
    if (this.coffeeOn) return none('coffee');
    if (c.hairTie && this.once('tie', 'night')) return none('hairTie', ['joker.takeover.slip']);
    const ada = moment === 'adaThrow' || moment === 'kitchenWager';
    const ctx: TakeoverCtx = {
      ...c, where, asked: false, kind: roll.kind,
      ...(ada ? { duel: c.duel ?? 'promise', rival: c.rival ?? 'ada' } : {}),
      ...(moment === 'kitchenWager' ? { witness: c.witness ?? 'kitchen' } : {}),
    };
    const result = resolveTakeover(createRng(hashSeed(this.seed, this.night, this.watch, 'joker.t', this.tk++)), ctx);
    const events: JokerEvent[] = [];
    this.shiftInk(UNASKED_INK, 'unasked', events);
    events.push({ name: 'joker:takeover', data: { ...result, ink: this.ink, paid: UNASKED_INK, promise: false } });
    return { struck: true, kind: result.kind, result, events };
  }

  // ── save ──
  snapshot(): JokerSave {
    return {
      v: 1, trust: this.trust, ink: this.ink, night: this.night, watch: this.watch, n: this.n, tk: this.tk, un: this.un, tips: this.tips,
      used: { ...this.used }, admitted: this.admitted, wordOffered: this.wordOffered, wordSpent: this.wordSpent,
      fed: [...this.fed], handed: [...this.handed], healed: { ...this.healed }, lastAskMachine: this.lastAskMachine, coffee: this.coffee,
      promise: this.promiseOpen ? { ...this.promiseOpen } : null, last: this.last ? { ...this.last } : null, tally: { ...this.tallyNow },
    };
  }

  /** Restores from a save. A damaged or missing slice reads as a fresh start; nothing is emitted. */
  restore(s: unknown): void {
    const o = (s && typeof s === 'object' ? s : {}) as Partial<JokerSave>;
    this.trust = num(o.trust, TRUST_MIN, TRUST_MAX, 0);
    this.ink = num(o.ink, 0, INK_MAX, 0);
    this.night = num(o.night, 0, 99, 0);
    this.watch = num(o.watch, 0, 99, 0);
    this.n = num(o.n, 0, 1e9, 0);
    this.tk = num(o.tk, 0, 1e9, 0);
    this.un = num(o.un, 0, 1e9, 0);
    this.tips = num(o.tips, 0, 99, 0);
    this.used = {};
    for (const [k, v] of Object.entries(o.used && typeof o.used === 'object' ? o.used : {})) if (typeof v === 'number' && Number.isFinite(v)) this.used[k] = v;
    this.admitted = o.admitted === true;
    this.wordOffered = o.wordOffered === true;
    this.wordSpent = o.wordSpent === true;
    this.fed = ids(o.fed);
    this.handed = ids(o.handed).filter((x) => !this.fed.includes(x));
    this.healed = { night: num(o.healed?.night, 0, 99, 0), n: num(o.healed?.n, 0, KEPT_HEAL_MAX, 0) };
    this.lastAskMachine = typeof o.lastAskMachine === 'string' ? o.lastAskMachine : null;
    this.coffee = o.coffee === 1 || o.coffee === 2 ? o.coffee : 0;
    this.promiseOpen = o.promise && typeof o.promise.id === 'string' ? { id: o.promise.id, night: num(o.promise.night, 0, 99, 0) } : null;
    this.last = o.last && typeof o.last === 'object' ? { n: num(o.last.n, 0, 1e9, 0), truth: o.last.truth === true, called: o.last.called === true } : null;
    const t: Partial<Tally> = o.tally ?? {};
    this.tallyNow = { we: num(t.we, 0, 1e9, 0), weWrong: num(t.weWrong, 0, 1e9, 0), plain: num(t.plain, 0, 1e9, 0), plainWrong: num(t.plainWrong, 0, 1e9, 0) };
  }
}

/** Every marked card id (for the placement wave and the tests). */
export const MARKED_IDS: readonly string[] = MARKED_CARDS.map((m) => m.id);
