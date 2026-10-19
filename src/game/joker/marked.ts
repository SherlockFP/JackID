/**
 * THE MARKED DECK (docs/JOKER.md §2.4): the champion's old twelve court cards with his grin scratched in, scattered the night he lost.
 * Pure data and counts. They are notes (story/notes.ts places them from this table in J4), not a currency, and each is a choice:
 * feed it to him (Trust +1, a memory in his words, which may lie) or hand it to the Clerk (Trust -1, Heat -1, Ink -1, the Clerk's true
 * record of the same night). Fed cards unlock gifts; a full pile of either kind names the rest of him (the Compere) before Night 8.
 */

export type MarkedSpot = 'behindMachine' | 'washLocker' | 'liftRoof' | 'clerkPlate';

export interface MarkedCard {
  id: string;
  rank: 'j' | 'q' | 'k';
  suit: 's' | 'h' | 'd' | 'c';
  /** First Night the card lies on the floor (1-based). One or two a floor; the last is on the Night 7 floor, before the reveal. */
  night: number;
  /** Where it hides (the placement wave resolves the exact anchor). */
  spot: MarkedSpot;
}

const c = (id: string, rank: MarkedCard['rank'], suit: MarkedCard['suit'], night: number, spot: MarkedSpot): MarkedCard => ({ id, rank, suit, night, spot });

/** Twelve cards: Jack, Queen and King of each suit. Their records (strings `joker.card.<id>.c`) run in order through Night 0. */
export const MARKED_CARDS: readonly MarkedCard[] = [
  c('mc01', 'j', 's', 1, 'behindMachine'),
  c('mc02', 'j', 'h', 2, 'washLocker'),
  c('mc03', 'j', 'd', 2, 'behindMachine'),
  c('mc04', 'j', 'c', 3, 'liftRoof'),
  c('mc05', 'q', 's', 3, 'behindMachine'),
  c('mc06', 'q', 'h', 4, 'washLocker'),
  c('mc07', 'q', 'd', 4, 'clerkPlate'),
  c('mc08', 'q', 'c', 5, 'behindMachine'),
  c('mc09', 'k', 's', 5, 'liftRoof'),
  c('mc10', 'k', 'h', 6, 'washLocker'),
  c('mc11', 'k', 'd', 6, 'clerkPlate'),
  c('mc12', 'k', 'c', 7, 'behindMachine'),
];

export const markedCard = (id: string): MarkedCard | undefined => MARKED_CARDS.find((m) => m.id === id);
/** Cards on the floor on a Night (those with `night` at or below it). */
export const cardsByNight = (night: number): MarkedCard[] => MARKED_CARDS.filter((m) => m.night <= night);

/** A full pile (all twelve fed, or all twelve handed over) names the rest of him, the Compere. */
export const FULL_PILE = MARKED_CARDS.length;

/** Gifts for fed cards: existing charms, given free with his grin on them. They count as cursed for Dread. */
export const GIFTS: readonly { fed: number; charm: string }[] = [
  { fed: 3, charm: 'mirror_shoe' },
  { fed: 6, charm: 'photo_negative' },
  { fed: 9, charm: 'card_of_all_suits' },
];

/** The charm unlocked when the fed count reaches `fed` exactly (null when it unlocks nothing). */
export const giftAt = (fed: number): string | null => GIFTS.find((g) => g.fed === fed)?.charm ?? null;
/** Every gift the fed count has earned. */
export const giftsFor = (fed: number): string[] => GIFTS.filter((g) => fed >= g.fed).map((g) => g.charm);
