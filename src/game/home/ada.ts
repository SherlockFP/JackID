/**
 * ADA'S PHASE (story wave A2, docs/STORY_BIBLE.md §8): before Night 5 she is the girl across the hall (she texts, she knocks, she visits
 * on some Evenings); from Night 5 she lives with you. One pure rule, read by the phone (which text pool), the Evening (is she at the
 * table) and the apartment (what the empty chair says). The internal thread id stays `spouse`.
 */
import { createRng, hashSeed } from '@/core/rng';

export type AdaPhase = 'across' | 'home';

/** The first Night she lives with you. */
export const ADA_HOME_NIGHT = 5;
/** Across, she only visits when the bond is at least this (Harmony 0..1 she does not answer). */
export const VISIT_MIN_HARMONY = 2;
/** From this Night, if her texts go unanswered, she knocks at night (two soft knocks; the peephole shows her standing still). */
export const ADA_KNOCK_NIGHT = 6;
/** Chance she visits an Evening of the across phase (seeded per Night). */
export const VISIT_CHANCE = 0.6;

export const adaPhase = (night: number): AdaPhase => (night >= ADA_HOME_NIGHT ? 'home' : 'across');

/** The i18n infix of her ACROSS pool (`phone.sp.<id>.x.t`, `phone.talk.x.h2.1`, `phone.dream.x.good.1`); '' for the home pool. */
export const poolOf = (night: number): '' | '.x' => (adaPhase(night) === 'across' ? '.x' : '');

/** Is she at your table this Evening? Home: whenever Harmony is above 0. Across: only on a seeded visit Evening, and only at Harmony 2+. */
export function adaSeated(seed: number, night: number, harmony: number): boolean {
  if (harmony <= 0) return false;
  if (adaPhase(night) === 'home') return true;
  return harmony >= VISIT_MIN_HARMONY && createRng(hashSeed(seed, night, 'ada.visit')).chance(VISIT_CHANCE);
}
