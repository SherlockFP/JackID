/** Steam Count (Kuro). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { steamCount } from './rules';

registerDuel(steamCount);
export * from './rules';
