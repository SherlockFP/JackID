/** Ending card (STORY wave A5, placeholder): DESCEND: the lift goes down. Copy and play notes: endingCard.ts, ../endings.ts. Played at the run's end by story/index.ts. */
import type { CutsceneDef } from '@/core/cutscene/types';
import { endingCard } from './endingCard';

const def: CutsceneDef = endingCard('descend');
export default def;
