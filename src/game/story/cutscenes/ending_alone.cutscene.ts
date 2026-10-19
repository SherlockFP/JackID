/** Ending card (STORY wave A5, placeholder): ALONE: Night 8 paid, the card not burned. Copy and play notes: endingCard.ts, ../endings.ts. Played at the run's end by story/index.ts. */
import type { CutsceneDef } from '@/core/cutscene/types';
import { endingCard } from './endingCard';

const def: CutsceneDef = endingCard('alone');
export default def;
