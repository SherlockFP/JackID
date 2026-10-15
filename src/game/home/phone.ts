/**
 * THE PHONE (wave 69, Home layer): the player's own phone with two threads, the spouse and the Collector
 * (docs/WAVE69_HOME.md). The run creates it with `createPhone(run)` and ticks it every frame, and the UI reads it via
 * `run.homePhone()`. All rolls are hashSeed(run seed, night, watch, thread) so saves and benches stay deterministic.
 *
 * DIRECTOR STUB: the phone lane replaces this body (message tables, scheduling, reply effects, Harmony, Heat, the spouse
 * talk). The export and the HomePhoneApi shape are the contract and must not change.
 */
import type { HomePhoneApi } from './contract';
import type { DebtRun } from '../run';

export function createPhone(_run: DebtRun): HomePhoneApi {
  return {
    tick: () => undefined,
    messages: () => [],
    unread: () => 0,
    markRead: () => undefined,
    reply: () => false,
    harmony: () => 3,
    heat: () => 0,
    onEvening: () => undefined,
    talk: () => [],
    snapshot: () => undefined,
    restore: () => undefined,
    dispose: () => undefined,
  };
}
