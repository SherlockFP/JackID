/** Sealed Wall (Tamsin). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { sealedWall } from './rules';

registerDuel(sealedWall);
export * from './rules';
