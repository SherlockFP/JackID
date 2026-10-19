/**
 * The Results hand-off's wait on the story queue (`holdForStory`), capped so one scene that never ends cannot soft-lock the run
 * on a black screen. Pure: the caller passes the UI clock's `wait`.
 */

/** Seconds of slack on top of the queued scenes' own duration (their fades and the cutscene player's staging wait). */
export const HOLD_SLACK_S = 6;

/** The longest the hand-off waits for scenes owing `owedS` seconds: half again their length, plus the slack. */
export const holdCap = (owedS: number): number => owedS * 1.5 + HOLD_SLACK_S;

/** Resolves when `tail` settles or `capS` has passed on `wait`'s clock, whichever is first. */
export function holdWithin(tail: Promise<unknown>, capS: number, wait: (sec: number) => Promise<void>): Promise<void> {
  return Promise.race([tail.then((): void => undefined, (): void => undefined), wait(capS)]);
}
