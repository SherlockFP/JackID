/** Fixture: core importing the game layer as a value and a foreign package. */
import { createRng } from '@/game/types';
import type { RunApi } from '@/game/types';
import { Peer } from 'trystero';

export const leak = [createRng, Peer];
export type Api = RunApi;
