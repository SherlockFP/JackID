/** The Question (Orrin). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { theQuestion } from './rules';

registerDuel(theQuestion);
export * from './rules';
