/**
 * "Performance" graphics preset (CORE-RENDER). A fill-rate and draw-cost preset for weak GPUs: internal frame 320×180
 * (16:9), CRT scanlines/vignette off, near draw distance (fog far 18 m). Apply with `renderer.apply(PERFORMANCE_PSX)`;
 * the settings screen stores the same values in `settings.psx`. Other PSX fields (jitter, affine, dither, colour bits)
 * keep the player's values.
 */
import type { PsxSettings } from './types';

export const PERFORMANCE_PSX: Pick<PsxSettings, 'targetHeight' | 'crt' | 'drawDistance'> = {
  targetHeight: 180,      // 320×180 internal frame at 16:9
  crt: false,
  drawDistance: 'near',   // fog far = 18 m (fogFar in fog.ts)
};
