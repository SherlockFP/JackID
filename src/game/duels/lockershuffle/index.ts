/** Locker Shuffle (Mimosa). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { lockerShuffle } from './rules';

registerDuel(lockerShuffle);
export * from './rules';
