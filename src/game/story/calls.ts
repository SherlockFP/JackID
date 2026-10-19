/**
 * Mira's wrong-number calls (STORY lane, WAVE24 §3). Call data only: whatever rings the phone plays a call by its `lines`,
 * one subtitle per line, in the order listed. Each line is an i18n key from `calls.strings.ts` (`story.call.<id>.<n>`).
 * The Night a call belongs to is its first Watch; the phone (hotline or rooms lane) decides how the call is picked up.
 */
export interface StoryCall {
  /** Call id; its subtitle keys are `story.call.<id>.<n>`. */
  id: string;
  /** Night (1-based) whose first Watch the call comes in on. */
  night: number;
  kind: 'wrong_number';
  /** i18n key of the speaker label. */
  speaker: string;
  /** Subtitle keys, spoken in order. */
  lines: readonly string[];
  /** A bond unlock the call needs (src/game/bonds.ts), or none. */
  bond?: string;
}

export const STORY_CALLS: readonly StoryCall[] = [
  {
    id: 'mira_n2', night: 2, kind: 'wrong_number', speaker: 'story.speaker.mira',
    lines: ['story.call.mira_n2.1', 'story.call.mira_n2.2', 'story.call.mira_n2.3'],
  },
  {
    id: 'mira_n5', night: 5, kind: 'wrong_number', speaker: 'story.speaker.mira',
    lines: ['story.call.mira_n5.1', 'story.call.mira_n5.2', 'story.call.mira_n5.3'],
  },
  // BONDS (A4): Night 7, Mira at bond 2 says the kept pair outright
  {
    id: 'mira_n7', night: 7, kind: 'wrong_number', speaker: 'story.speaker.mira', bond: 'mira.pair',
    lines: ['story.call.mira_n7.1', 'story.call.mira_n7.2', 'story.call.mira_n7.3'],
  },
  // THE SECOND NAME (wave 73): the third beat of Mira's thread, on Night 8 (she asks you to refuse Vell's table)
  {
    id: 'mira_n8', night: 8, kind: 'wrong_number', speaker: 'story.speaker.mira',
    lines: ['story.call.mira_n8.1', 'story.call.mira_n8.2', 'story.call.mira_n8.3'],
  },
];

/** THE SECOND NAME (wave 73): the Mira call id to her chapter beat (N2 = 1, N5 = 2, N8 = 3). */
export const MIRA_BEAT: Readonly<Record<string, number>> = { mira_n2: 1, mira_n5: 2, mira_n8: 3 };

/** The story call for a Night, or null when that Night has none. `has` reads the bond unlocks (none held by default). */
export function storyCallFor(night: number, has: (id: string) => boolean = () => false): StoryCall | null {
  return STORY_CALLS.find((c) => c.night === night && (!c.bond || has(c.bond))) ?? null;
}
