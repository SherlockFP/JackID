/**
 * Draw-distance fog helpers (CORE-RENDER). DECISIONS §G: states build `THREE.Fog` from the `drawDistance` setting
 * (18 | 26 | 40 m); the PSX shader applies the fog as given (uPsxFogScale = 1), so nothing is scaled twice.
 */
import * as THREE from 'three';
import type { Hex } from '../types';
import type { PsxSettings } from './types';

export type DrawDistance = PsxSettings['drawDistance'];

/** Fog far distance in metres per draw-distance setting. */
export const FOG_FAR: Readonly<Record<DrawDistance, number>> = { near: 18, normal: 26, far: 40 };

export function fogFar(d: DrawDistance): number {
  return FOG_FAR[d] ?? FOG_FAR.normal;
}

/** Scene fog for a zone: colour and near in metres, far taken from the draw-distance setting. */
export function makeFog(color: Hex, near: number, drawDistance: DrawDistance): THREE.Fog {
  return new THREE.Fog(color, Math.min(near, fogFar(drawDistance) - 1), fogFar(drawDistance));
}
