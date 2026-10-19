/** Ending card (wave 106): SON OYUN: the House's machine won after Night 8 (`lastGame.ts`). Copy and play notes: endingCard.ts, ../endings.ts. Played at the run's end by story/index.ts. */
import type { CutsceneDef } from '@/core/cutscene/types';
import { endingCard } from './endingCard';

const def: CutsceneDef = endingCard('last_game');
export default def;
