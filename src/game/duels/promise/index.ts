/**
 * Rock, Paper, Promise. The rules are pure (`rules.ts`); Ada's kitchen table (`flow.ts`, `kitchen.ts`) is the home game and
 * `lucan.ts` is the Night 3 boss duel for the Tally Table (docs/STORY_BIBLE.md 5a, S4). Loading this file registers the duel
 * (`autoload.ts` imports every game folder's index).
 */
import { listDuels, registerDuel, unregisterDuel } from '../registry';
import { lucanDuel } from './lucan';

// Lucan plays Promise now. Ghost Shell stays registered (its tests and rules are untouched) but the registry answers a rival with the
// first game registered for them, so Promise goes first: `duelForRival('lucan')` finds it.
const others = listDuels().filter((r) => r.id !== lucanDuel.id);
unregisterDuel();
registerDuel(lucanDuel);
for (const r of others) registerDuel(r);

export * from './rules';
export { lucanDuel, setPhotoSource, rewards as lucanRewards, CALL_MIRROR, type PRState, type PRAction, type PromiseRewards } from './lucan';
