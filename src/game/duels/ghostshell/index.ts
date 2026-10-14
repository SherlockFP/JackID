/** Ghost Shell (Lucan). Loading this file registers the duel (`autoload.ts` imports every game folder's index). */
import { registerDuel } from '../registry';
import { ghostShell } from './rules';

registerDuel(ghostShell);
export * from './rules';
