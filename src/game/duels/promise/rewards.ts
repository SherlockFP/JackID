/**
 * What Lucan's table pays besides the stake (docs/STORY_BIBLE.md 5a): each kept-word win is one ŞANS star (the luck meter hears
 * `floor:luck`, at most 2 a duel, see `rewards` in lucan.ts) and each crack of the player's is one Heat, because broken words travel.
 * The Tally Table calls this once when a Promise duel is settled. The game layer owns the phone, so the machine goes through here.
 */
import { bus } from '@/core/events';
import { hooksOf } from '@/game/home/phone';
import type { HomePhoneApi } from '@/game/home/contract';

export interface PromisePay { stars: number; heat: number }

/** Applies the rewards to the run (stars to the luck meter, Heat to the Collector). Returns what was really applied, for the toasts. */
export function applyPromiseRewards(run: unknown, rw: { stars: number; cracks: number }): PromisePay {
  const stars = Math.max(0, Math.floor(rw.stars));
  const heat = Math.max(0, Math.floor(rw.cracks));
  if (stars > 0) bus.emit('floor:luck', { star: stars, why: 'promise' });
  if (heat > 0) {
    try {
      const phone = (run as { homePhone?: () => HomePhoneApi | null } | null)?.homePhone?.();
      hooksOf(phone)?.heat(heat, 'promise');
    } catch { /* no home layer in this run: no Heat to move */ }
  }
  return { stars, heat };
}
