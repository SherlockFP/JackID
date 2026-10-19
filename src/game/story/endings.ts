/**
 * THE ENDINGS (story wave A5, docs/STORY_BIBLE.md §4 "Endings", §5a, §9 "His part in each ending", §10 Bonds): which of the nine endings a
 * run reaches, and what it writes into the save. Pure rules and data: no DOM, no bus, no run import, no clock. The run fills an
 * {@link EndingFacts} when it ends (the A5 wiring plan in the bible), calls {@link endingRecord}, stores the record and plays
 * {@link endingScene}: `run.ts endRun()` routes it, `story/index.ts` plays it.
 *
 * Priority (first match wins, {@link PRIORITY}). The kept pair tops everything the Night 8 floor can produce. Only three run-enders can
 * be written over it, because each ends the run before the Burning Wager can be won clean:
 *   HE CAME HOME   Ink 10 ends the run on the spot (JOKER §2.2)
 *   PAID IN FULL   the Night 7 deal was signed: the run ends at that Dawn
 *   FALL           a missed quota with no seal to cover it
 * KEPT and THE CHAIR rank above it too, but they cannot meet it: they need a kitchen loss or a lost Wager, a kept pair needs the opposite.
 * A clean win is zero cracks and no takeover (§5a; JOKER §4: "He can win you any game. He can't win you a clean one."), and only a clean
 * win burns the card. DESCEND needs a card, so it ranks below both burns. Bonds never gate an ending (§10): they only decide who waits.
 */
import { clamp } from '@/core/math';
import { BOND_IDS, type BondId } from '@/game/bonds';
import type { FlowResult } from '@/game/duels/promise/flow';
import { adaPhase } from '@/game/home/ada';

/** The nine endings, in the bible's table order, then SON OYUN (wave 106: the House's machine won after Night 8). */
export const ENDING_IDS = ['kept_pair', 'cold_kitchen', 'alone', 'chair', 'kept', 'paid_in_full', 'he_came_home', 'descend', 'fall', 'last_game'] as const;
export type EndingId = (typeof ENDING_IDS)[number];
export const isEnding = (x: unknown): x is EndingId => (ENDING_IDS as readonly unknown[]).includes(x);

/** The three endings with a finished scene. The other seven play a short card (`cutscenes/endingCard.ts`). */
export const FULL_ENDINGS: readonly EndingId[] = ['kept_pair', 'cold_kitchen', 'kept'];
/** The cutscene of an ending: `cutscenes/ending_<id>.cutscene.ts`. */
export const endingScene = (id: EndingId): string => `ending_${id}`;
/** The ending's name (card title and Results line), in `endings.strings.ts`. */
export const endingTitleKey = (id: EndingId): string => `story.end.${id}.title`;

/** Hooks the full scenes call; the A5 wiring registers them (`ending.burn`: the card burns; `ending.home`: dress the flat, `{ ada: 'seat' | 'gone' }`). */
export const ENDING_HOOK = { burn: 'ending.burn', home: 'ending.home' } as const;

/** Everything the routing reads, filled by the run at its end. `freshFacts()` is the quiet start. */
export interface EndingFacts {
  /** Printed Night the run ended on (1-8). */
  night: number;
  /** Night 8 is paid and the topside is open (`run.topsideOpen`). */
  paid: boolean;
  /** The run ended on a missed quota with no seal to cover it (`fall()`: the trapdoor, or THE VISIT at home). */
  fell: boolean;
  /** Name seals still held, 0..3. Recorded only: BLANK is `fell`. */
  seals: number;
  /** The player took DESCEND (`summary.ending === 'descend'`). */
  descended: boolean;
  /** The Night 7 Collector deal (`ChapterRecord.deal`): 1 = the second name signed over. */
  deal: 0 | 1 | 2;
  /** The kitchen wager (`FlowResult.wager`; the chapter record's 'won' / 'lost' / 'pair'). null: not played. */
  kitchen: FlowResult['wager'];
  /** Kept pairs in that match (`FlowResult.pairs`). */
  pairs: number;
  /** The Burning Wager. null: not played. */
  wager: 'win' | 'lose' | null;
  /** Your cracks in it. */
  cracks: number;
  /** His hand threw any of it (a takeover in front of the Clerk). */
  lokiHand: boolean;
  /** Ink 10 (`Joker.cameHome`). */
  cameHome: boolean;
  /** Trust -3..+3 (`Joker.trust`). */
  trust: number;
  /** His word was spent on the Champion's break at match point (`Joker.snapshot().wordSpent`, spent there). */
  wordAtMatchPoint: boolean;
  /** The Visit's takeover was already used this run (`Joker.snapshot().used.visit`). */
  visitUsed: boolean;
  /** SON OYUN (`lastGame.ts`): the House's machine was won, or lost on the last seal. null: no final pull. */
  lastGame: 'win' | 'lose' | null;
  /** Ada's bond, 0..5 (`phone.harmony()`). */
  harmony: number;
  /** Friends at bond 3, never betrayed (`Bonds.floor()`). */
  waiting: readonly BondId[];
}

export const freshFacts = (): EndingFacts => ({
  night: 1, paid: false, fell: false, seals: 3, descended: false, deal: 0, kitchen: null, pairs: 0, wager: null, cracks: 0,
  lokiHand: false, cameHome: false, trust: 0, wordAtMatchPoint: false, visitUsed: false, lastGame: null, harmony: 2, waiting: [],
});

/** The Wager won clean: zero cracks, no takeover. */
const clean = (f: EndingFacts): boolean => f.wager === 'win' && f.cracks <= 0 && !f.lokiHand;

const RULES: ReadonlyArray<readonly [EndingId, (f: EndingFacts) => boolean]> = [
  ['he_came_home', (f) => f.cameHome],
  ['paid_in_full', (f) => f.deal === 1],
  ['fall', (f) => f.fell],
  ['kept', (f) => f.kitchen === 'lose'],
  // the last seal lost at the House's machine: the House keeps you in the chair
  ['chair', (f) => f.wager === 'lose' || f.lastGame === 'lose'],
  ['kept_pair', (f) => clean(f) && f.kitchen === 'pair'],
  // shortcut: a clean win with no kitchen on record reads as COLD KITCHEN; the N8 flow always plays the kitchen first
  ['cold_kitchen', (f) => clean(f)],
  // below the two burns: a clean Wager then the machine still plays its full scene
  ['last_game', (f) => f.lastGame === 'win'],
  ['descend', (f) => f.descended],
  ['alone', (f) => f.paid || f.wager === 'win'],
];
/** One set of facts on top of {@link freshFacts} that reaches each ending (the dev preview `previewEnding` and the tests). */
export const ENDING_WITNESS: Readonly<Record<EndingId, Partial<EndingFacts>>> = {
  kept_pair: { night: 8, paid: true, kitchen: 'pair', pairs: 3, wager: 'win' },
  cold_kitchen: { night: 8, paid: true, kitchen: 'win', wager: 'win' },
  alone: { night: 8, paid: true },
  chair: { night: 8, paid: true, kitchen: 'win', wager: 'lose' },
  kept: { night: 7, kitchen: 'lose' },
  paid_in_full: { night: 7, deal: 1 },
  he_came_home: { night: 6, cameHome: true },
  descend: { night: 4, descended: true },
  fall: { night: 3, fell: true, seals: 0 },
  last_game: { night: 8, paid: true, lastGame: 'win' },
};
/** The evaluation order of {@link routeEnding}. */
export const PRIORITY: readonly EndingId[] = RULES.map(([id]) => id);

/** The ending a run reaches, or null when it ended without one (a quit, an abandoned run). */
export function routeEnding(f: EndingFacts): EndingId | null {
  for (const [id, ok] of RULES) if (ok(f)) return id;
  return null;
}

// ── the save record ────────────────────────────────────────────────────────────────────────────────────

/** Where Ada ends up. 'beside': lit, in the lift. 'rides': up with you, holding your gloved hand. 'still': in her chair. 'home': waiting at home.
 *  'gone': down in your place. 'taken': to the Hall. 'waits': at the lift every Dawn. 'table': the chain on, the card between two cups. 'door': opens it herself. */
export const ADA_ENDS = ['beside', 'rides', 'still', 'home', 'gone', 'taken', 'waits', 'table', 'door'] as const;
export type AdaEnd = (typeof ADA_ENDS)[number];

/** Loki's fate (§9) and his last line (`story.end.loki.*`, '' when he says nothing). */
export const LOKI_LINE = {
  burns: 'story.end.loki.burn', stays: 'story.end.loki.stay', rides: 'story.end.loki.rides', likes: 'story.end.loki.likes',
  comes: 'story.end.loki.comes', offers: 'story.end.loki.shame', silent: 'story.end.loki.hush', home: '', wins: '',
  beaten: 'story.end.loki.beaten',
} as const;
export type LokiEnd = keyof typeof LOKI_LINE;

/** What an ending writes into the save (`resume.ext.ending`, and `RunSummary.ending` takes `id`). */
export interface EndingRecord {
  v: 1;
  id: EndingId;
  /** Printed Night the run ended on. */
  night: number;
  /** The card burned (n26, "BURNED THIS YEAR"): only a clean Wager win. */
  burned: boolean;
  ada: AdaEnd | null;
  loki: LokiEnd;
  /** The i18n key of Loki's last line, or ''. The scenes with a `{loki}` cue take it as the var. */
  lokiLine: string;
  /** Who waits for you (§10): KEPT PAIR all the bond-3 friends; COLD KITCHEN and THE CHAIR Selim. */
  waiting: BondId[];
  seals: number;
  pairs: number;
  /** DESCEND: half his Trust carries over and the Ink starts clean. */
  carry: { trust: number; ink: 0 } | null;
}

const ADA: Record<EndingId, (f: EndingFacts) => AdaEnd | null> = {
  kept_pair: () => 'beside',
  cold_kitchen: () => 'still',
  alone: (f) => (f.kitchen === 'pair' ? 'rides' : f.kitchen === 'win' ? 'still' : 'home'),
  chair: () => null,   // the bible does not say where she is
  kept: () => 'gone',
  paid_in_full: () => 'taken',
  he_came_home: () => 'table',
  descend: () => 'waits',
  fall: (f) => (adaPhase(f.night) === 'home' && f.harmony > 0 ? 'door' : null),
  last_game: () => 'home',
};

const burnsOrStays = (f: EndingFacts): LokiEnd => (f.wordAtMatchPoint ? 'stays' : 'burns');
const LOKI: Record<EndingId, (f: EndingFacts) => LokiEnd> = {
  kept_pair: burnsOrStays,
  cold_kitchen: burnsOrStays,
  alone: () => 'rides',
  chair: () => 'home',
  kept: () => 'likes',
  paid_in_full: () => 'likes',
  he_came_home: () => 'wins',
  descend: () => 'comes',
  fall: (f) => (f.visitUsed ? 'silent' : 'offers'),
  last_game: () => 'beaten',
};

const waitingOf = (id: EndingId, w: readonly BondId[]): BondId[] =>
  id === 'kept_pair' ? [...w] : id === 'cold_kitchen' || id === 'chair' ? w.filter((x) => x === 'selim') : [];

const whole = (n: number, lo: number, hi: number): number => clamp(Math.trunc(Number.isFinite(n) ? n : lo), lo, hi);

/** The record of the ending these facts reach, or null when the run ended without one. */
export function endingRecord(f: EndingFacts): EndingRecord | null {
  const id = routeEnding(f);
  if (!id) return null;
  const loki = LOKI[id](f);
  return {
    v: 1, id, night: whole(f.night, 1, 8), burned: id === 'kept_pair' || id === 'cold_kitchen',
    ada: ADA[id](f), loki, lokiLine: LOKI_LINE[loki], waiting: waitingOf(id, f.waiting),
    seals: whole(f.seals, 0, 3), pairs: whole(f.pairs, 0, 99),
    carry: id === 'descend' ? { trust: Math.trunc(whole(f.trust, -3, 3) / 2) || 0, ink: 0 } : null,
  };
}

/** A saved record, checked field by field. Anything damaged reads as a default; an unknown ending reads as null. */
export function readEnding(x: unknown): EndingRecord | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!isEnding(o.id)) return null;
  const id = o.id;
  const int = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const loki = (Object.keys(LOKI_LINE) as LokiEnd[]).find((k) => k === o.loki) ?? 'silent';
  const carry = o.carry && typeof o.carry === 'object' ? (o.carry as Record<string, unknown>) : null;
  return {
    v: 1, id, night: int(o.night, 1, 8, 8), burned: id === 'kept_pair' || id === 'cold_kitchen',
    ada: (ADA_ENDS as readonly unknown[]).includes(o.ada) ? (o.ada as AdaEnd) : null,
    loki, lokiLine: LOKI_LINE[loki],
    waiting: Array.isArray(o.waiting) ? BOND_IDS.filter((b) => (o.waiting as unknown[]).includes(b)) : [],
    seals: int(o.seals, 0, 3, 0), pairs: int(o.pairs, 0, 99, 0),
    carry: id === 'descend' ? { trust: int(carry?.trust, -1, 1, 0), ink: 0 } : null,
  };
}
