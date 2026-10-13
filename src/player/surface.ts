/**
 * Footstep surfaces. The floor theme comes from the zone the feet are in (GDD §8.3 "Floor theme"); the
 * sound recipe is `footstep` / `footstepWet` with `param` = hardness (0 = muffled carpet … 1 = ringing metal)
 * and a per-surface pitch offset, so CORE-AUDIO needs only two recipes.
 */
export type Surface = 'carpet' | 'wood' | 'tile' | 'metal' | 'dirt' | 'wet';

export interface SurfaceSound {
  name: 'footstep' | 'footstepWet';
  /** Semitones added on top of the random ±1 variation. */
  pitch: number;
  /** Volume multiplier. */
  vol: number;
  hardness: number;
}

export const SURFACE_SOUND: Readonly<Record<Surface, SurfaceSound>> = {
  carpet: { name: 'footstep', pitch: -3, vol: 0.7, hardness: 0.1 },
  wood:   { name: 'footstep', pitch: -1, vol: 1.0, hardness: 0.45 },
  tile:   { name: 'footstep', pitch: 2, vol: 1.0, hardness: 0.8 },
  metal:  { name: 'footstep', pitch: 4, vol: 1.1, hardness: 1.0 },
  dirt:   { name: 'footstep', pitch: -4, vol: 0.8, hardness: 0.25 },
  wet:    { name: 'footstepWet', pitch: 0, vol: 1.0, hardness: 0.5 },
};

const ZONE_SURFACE: Readonly<Record<string, Surface>> = {
  mouth: 'carpet', well: 'carpet', lobby: 'carpet', midway: 'dirt', cards: 'carpet', laundry: 'tile',
  boiler: 'metal', gallery: 'carpet', wheels: 'carpet', parlour: 'wood', counting: 'wood', lift: 'metal', sump: 'wet',
  // spec v1.0 zone names
  atrium: 'carpet', slots: 'carpet', tables: 'carpet', arcade: 'carpet', lottery: 'carpet', services: 'wood',
};

export function surfaceForZone(zone: string | null | undefined): Surface {
  return (zone && ZONE_SURFACE[zone]) || 'carpet';
}
