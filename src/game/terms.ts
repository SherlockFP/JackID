/**
 * The HUD's own words, explained once (newcomer pass). Pure: no DOM, no app.
 *  - `TERMS`: the terms a first-time player meets (KOTA, MÜHÜR, ŞANS ...). The HUD shows one short explainer toast the first
 *    time each one appears in a profile; the flag lives in the save's `seen` record (`term.<id>`), so it is once per profile.
 *  - the journal's TERİMLER page lists the terms seen so far (`glossBody`).
 *  - `goalLine`: the plain-language goal strip under the quota box ("Pay 24 by dawn · 19 left").
 * Strings: game/terms.strings.ts (`term.<id>.n` the name, `term.<id>.d` the one-line meaning).
 */

export const TERMS = ['quota', 'seal', 'luck', 'payout', 'hunger', 'series', 'stakes', 'harmony', 'heat'] as const;
export type TermId = typeof TERMS[number];

type Seen = Record<string, number>;
const flag = (id: TermId): string => `term.${id}`;
export const isTerm = (id: string): id is TermId => (TERMS as readonly string[]).includes(id);
export const termSeen = (seen: Readonly<Seen>, id: TermId): boolean => (seen[flag(id)] ?? 0) > 0;
/** Marks a term seen. True the first time (the caller shows the explainer), false when it was already known. */
export function termMark(seen: Seen, id: TermId): boolean {
  if (termSeen(seen, id)) return false;
  seen[flag(id)] = 1;
  return true;
}
/** The terms seen so far, in the order of `TERMS`. */
export const termsSeen = (seen: Readonly<Seen>): TermId[] => TERMS.filter((id) => termSeen(seen, id));

/** The journal page text: each seen term, its name, then its meaning. `tr` is `t`. */
export function glossBody(seen: Readonly<Seen>, tr: (key: string) => string): string {
  return termsSeen(seen).map((id) => `${tr(`term.${id}.n`)}\n${tr(`term.${id}.d`)}`).join('\n\n');
}

export interface GoalIn { due: number; deposited: number; paid: boolean; sealed: boolean }
export interface GoalView { key: string; n: number; left: number }
/**
 * The goal line under the quota box. Null while no quota is set (before the Night opens). `n` is the quota, `left` what is still
 * to pay. Paid and sealed Nights have their own plain lines; a covered quota that waits for dawn says so.
 */
export function goalLine(g: GoalIn): GoalView | null {
  const n = Math.max(0, Math.round(g.due));
  const left = Math.max(0, n - Math.max(0, Math.round(g.deposited)));
  if (g.paid) return { key: g.sealed ? 'term.goal.sealed' : 'term.goal.paid', n, left: 0 };
  if (n <= 0) return null;
  return { key: left > 0 ? 'term.goal.pay' : 'term.goal.met', n, left };
}
