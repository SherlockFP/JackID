/**
 * THE PHONE UI (wave 69, Home layer): the pocket phone overlay (threads, unread chip, quick replies) over `run.homePhone()`
 * (docs/WAVE69_HOME.md). Mounted by the session for solo runs. Returns its disposer.
 *
 * DIRECTOR STUB: the phone lane replaces this body. The export is the contract and must not change.
 */
import type { DebtRun } from '../run';

export function mountPhoneUi(_run: DebtRun): () => void {
  return () => undefined;
}
