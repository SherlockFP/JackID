/**
 * LOKI'S WHISPERS (docs/JOKER.md §3). The pool is pairs: every entry is one fact he can tell you straight (TRUE, a memory, I and you)
 * or twist (LIE, a plan, "we" / TR "biz"). The strings live in joker.strings.ts under `joker.w.<id>.t | .l | .s`:
 *   t  the true line,  l  the lie (always carries the tell),  s  the same lie with the tell dropped (only said from Ink 8, see symptoms).
 * `serves` says who a lie would help: 'free' (gossip, a lie gains him nothing) or 'him' (a lie pushes you toward risk, toward needing
 * him, away from Ada or toward a broken word). That picks the truth table row. `fact` names what the true line states, so the wiring
 * can pick the entry that matches the machine, rival or table in front of the player. Pure data and pure picks: no bus, no DOM.
 */
import type { Rng } from '@/core/rng';

/** Where he speaks. Never the phone (it is Mira's) and never the kitchen below Ink 8 (he can't read her). */
export type WhisperCtx =
  | 'machine' | 'bigBet' | 'duel' | 'crooked' | 'knock' | 'homePc' | 'window' | 'bounty' | 'nightCard' | 'kitchen' | 'wager'
  | 'card';
export type Serves = 'free' | 'him';

export interface WhisperDef {
  id: string;
  ctx: WhisperCtx;
  serves: Serves;
  /** What the true line states, so the wiring can match it to the real thing. */
  fact: string;
  /** First Ink at which he speaks here (the kitchen: 8). */
  minInk?: number;
}

const w = (id: string, ctx: WhisperCtx, serves: Serves, fact: string, minInk?: number): WhisperDef => ({ id, ctx, serves, fact, ...(minInk ? { minInk } : {}) });

export const WHISPERS: readonly WhisperDef[] = [
  w('cold', 'machine', 'free', 'cold'),
  w('near', 'machine', 'free', 'near'),
  w('half', 'bigBet', 'him', 'half'),
  w('lucan', 'duel', 'him', 'watch'),
  w('collector', 'duel', 'him', 'card'),
  w('middle', 'crooked', 'him', 'middle'),
  w('thumb', 'crooked', 'him', 'thumb'),
  w('listening', 'knock', 'him', 'listening'),
  w('toll', 'knock', 'him', 'toll'),
  w('sell', 'homePc', 'free', 'sell'),
  w('bakery', 'homePc', 'him', 'hold'),
  w('till', 'window', 'free', 'till'),
  w('easy', 'bounty', 'free', 'easy'),
  w('late', 'bounty', 'free', 'late'),
  w('plain', 'nightCard', 'him', 'plain'),
  w('keep', 'kitchen', 'him', 'keep', 8),
  w('win', 'kitchen', 'him', 'win', 8),
  w('quiet', 'wager', 'him', 'quiet'),
  w('opens', 'wager', 'him', 'opens'),
  w('left', 'wager', 'him', 'left'),
  w('word', 'wager', 'him', 'word'),        // his word at the Burning Wager's match point (always on his word: true, no tell)
];

/** The bleed prefixes (strings `joker.bleed.1..N`): from Ink 6 some true lines start with his memory saying "we". */
export const BLEED_COUNT = 4;
/** The generic lies a fed marked card can tell (strings `joker.lie.1..N`), all with the tell. */
export const CARD_LIES = 4;

export function whisperDef(id: string): WhisperDef | undefined { return WHISPERS.find((d) => d.id === id); }

export interface PickOpts {
  /** Only entries that state this fact. */
  fact?: string;
  /** The player's Ink: below an entry's `minInk` he is silent there. */
  ink?: number;
  /** Entries to skip (recently used). */
  exclude?: readonly string[];
}

/** One entry for a context, or null when he has nothing to say there (the kitchen below Ink 8, an unknown fact, all used). */
export function pickWhisper(rng: Rng, ctx: WhisperCtx, o: PickOpts = {}): WhisperDef | null {
  const pool = WHISPERS.filter((d) => d.ctx === ctx && (o.fact === undefined || d.fact === o.fact)
    && (o.ink ?? 0) >= (d.minInk ?? 0) && !o.exclude?.includes(d.id));
  // always draw once, so the stream does not depend on how many entries matched
  const u = rng.next();
  return pool.length ? pool[Math.floor(u * pool.length)] : null;
}

/**
 * The string keys to show for a rolled whisper, in order (join with a space). A true line that says "we" (Ink 6+) wears a bleed prefix;
 * a lie that dropped the tell (Ink 8+) uses the `.s` line.
 */
export function lineKeys(def: WhisperDef, truth: boolean, we: boolean, bleed = 1): string[] {
  const base = `joker.w.${def.id}`;
  if (truth) return we ? [`joker.bleed.${1 + ((bleed - 1 + BLEED_COUNT) % BLEED_COUNT)}`, `${base}.t`] : [`${base}.t`];
  return [we ? `${base}.l` : `${base}.s`];
}

/**
 * The tell, as the player reads it: "we", "us", "our" (TR: biz, bize, bizi, bizim ... written out). Used by the tests and by the Tally Sheet.
 * Matches whole words only, so "user" and "Bizans" stay clean.
 */
export function saysWe(lang: 'en' | 'tr', text: string): boolean {
  return lang === 'tr' ? /(^|[^\p{L}])biz\p{L}*/iu.test(text) : /\b(?:we|us|our|ours)\b/i.test(text);
}
