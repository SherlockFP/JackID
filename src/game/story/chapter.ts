/**
 * THE SECOND NAME (STORY lane, Wave 73): the chapter record. One small save record replaces the old unread story flags.
 *
 * Each Night is a chapter: a title card opens it (`cards`, once per Night). Four arcs carry a three-beat thread across Nights
 * (`arcs`, each a monotonic beat 0..3): Mira (N2 wrong number, N5 second call, N8 refuse Vell), the Collector (N2 warning, N5
 * knock, N7 deal), the spouse (a card message on N2, N5, N8) and the Clerk (N7 Audit, N8 reveal). Night 8 plays the reveal
 * once (`revealed`). `deal` records the Night 7 Collector deal: 1 paid, 2 refused, 0 not answered.
 *
 * Pure data and tolerant readers only: a damaged or older save reads as a fresh record, so no save ever breaks.
 */

export type ArcId = 'mira' | 'collector' | 'spouse' | 'clerk';
export const ARCS: readonly ArcId[] = ['mira', 'collector', 'spouse', 'clerk'];
/** The last Night of the chapter spine (the reveal lands here). */
export const CHAPTER_LAST_NIGHT = 8;
/** Beats each arc can reach. */
export const ARC_BEATS = 3;

export interface ChapterRecord {
  v: 1;
  /** Nights whose title card has played (1-based). */
  cards: number[];
  /** Beat reached per arc (0 = not started, 1..ARC_BEATS = the beat played). Monotonic. */
  arcs: Record<ArcId, number>;
  /** The Night 8 reveal has played. */
  revealed: boolean;
  /** Night 7 Collector deal: 0 unanswered, 1 paid (heat down), 2 refused. */
  deal: 0 | 1 | 2;
}

export function freshChapter(): ChapterRecord {
  return { v: 1, cards: [], arcs: { mira: 0, collector: 0, spouse: 0, clerk: 0 }, revealed: false, deal: 0 };
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** A saved chapter record, checked field by field. Anything damaged reads as the fresh record (or the field's default). */
export function readChapter(x: unknown): ChapterRecord {
  const c = freshChapter();
  if (!x || typeof x !== 'object') return c;
  const o = x as Record<string, unknown>;
  if (Array.isArray(o.cards)) {
    c.cards = [...new Set(o.cards.map((n) => int(n, 1, CHAPTER_LAST_NIGHT)).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  }
  if (o.arcs && typeof o.arcs === 'object') {
    const a = o.arcs as Record<string, unknown>;
    for (const id of ARCS) c.arcs[id] = int(a[id], 0, ARC_BEATS) ?? 0;
  }
  c.revealed = o.revealed === true;
  const deal = int(o.deal, 0, 2);
  c.deal = deal === 1 ? 1 : deal === 2 ? 2 : 0;
  return c;
}

/** A detached copy (the snapshot and the tests read copies, never the live record). */
export function cloneChapter(c: ChapterRecord): ChapterRecord {
  return { v: 1, cards: [...c.cards], arcs: { ...c.arcs }, revealed: c.revealed, deal: c.deal };
}

/** Marks a Night's title card as played. True when it was new (the card should play now). */
export function markCard(c: ChapterRecord, night: number): boolean {
  if (night < 1 || night > CHAPTER_LAST_NIGHT || c.cards.includes(night)) return false;
  c.cards.push(night);
  c.cards.sort((a, b) => a - b);
  return true;
}

/** Moves an arc forward to `beat` (never back). True when the arc actually moved. */
export function advanceArc(c: ChapterRecord, arc: ArcId, beat: number): boolean {
  const to = Math.min(ARC_BEATS, Math.max(0, Math.trunc(beat)));
  if (to <= c.arcs[arc]) return false;
  c.arcs[arc] = to;
  return true;
}

/** The i18n keys of a Night's title card: `story.chapter.n<N>.title` and `.line`. Null outside the chapter spine. */
export function chapterKeys(night: number): { title: string; line: string } | null {
  if (!Number.isInteger(night) || night < 1 || night > CHAPTER_LAST_NIGHT) return null;
  return { title: `story.chapter.n${night}.title`, line: `story.chapter.n${night}.line` };
}

/** The Night a spouse card message belongs to, and its arc beat (N2 = 1, N5 = 2, N8 = 3). */
export const SPOUSE_CARD_BEAT: Readonly<Record<number, number>> = { 2: 1, 5: 2, 8: 3 };
