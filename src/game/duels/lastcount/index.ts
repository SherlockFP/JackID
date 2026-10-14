/** The Last Count (Vell). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { lastCount } from './rules';

registerDuel(lastCount);
export * from './rules';
