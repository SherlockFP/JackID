/**
 * Horror barrel (the light-horror director and its Dread meter). Dread is shared on the bus as dread:change, 0..1 (the
 * RunApi.dread() unit), so the story stingers and the light grade read one scale.
 */
export { HorrorDirector, createHorror } from './director';
export type { HorrorBeat, HorrorDeps, HorrorSettings, HorrorState } from './director';
export { DreadMeter, nightBase, pressure, targetDread, tierOf, dreadCap, EVENT_DREAD, TIER_RANK } from './dread';
export type { DreadTier, DreadEventKind, DreadInput } from './dread';
