/**
 * Shared internal context handed to every kit part builder (not part of the public Kit API).
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import type { TexGen } from '@/core/texgen/types';
import { PALETTE } from './palette';
import { Anim } from './anim';
import { createPrims } from './prims';
import { presets, tiled, type Presets } from './presets';
import { createTextHub, type TextHub } from './text';
import { paintGlow } from './draw';
import type { Kit, Palette } from './types';

/** A screen whose canvas needs re-uploading. */
export interface Flushable { flush(now: number): boolean; lastFlush: number }

export interface KitCtx {
  readonly tex: TexGen;
  readonly pal: Palette;
  readonly M: Presets;
  readonly anim: Anim;
  readonly text: TextHub;
  readonly P: Pick<Kit, 'group' | 'box' | 'cyl' | 'sphere' | 'torus' | 'plane' | 'lathe' | 'extrude' | 'tube' | 'shade' | 'mat'>;
  /** Screens with pending canvas uploads (flushed ≤ MAX_UPLOADS per frame by `Kit.update`). */
  readonly dirty: Set<Flushable>;
  /** Shared additive glow texture (stepped radial, white). */
  glowTex(): THREE.Texture;
  /** Shared additive sprite material per colour/intensity. */
  glowMat(color: Hex, intensity: number): THREE.SpriteMaterial;
}

export function createCtx(raw: TexGen): KitCtx {
  const tex = tiled(raw);
  const anim = new Anim();
  const sprites = new Map<string, THREE.SpriteMaterial>();
  let glowT: THREE.Texture | null = null;
  const glowTex = (): THREE.Texture => glowT ??= tex.canvas(16, 16, (g) => paintGlow(g, 16), { key: 'kit:glow', wrap: 'clamp' });
  return {
    tex, pal: PALETTE, M: presets(tex), anim, text: createTextHub(), P: createPrims(), dirty: new Set(),
    glowTex,
    glowMat(color, intensity) {
      const k = `${color}:${intensity}`;
      let m = sprites.get(k);
      if (!m) {
        const boost = Math.max(1, intensity);
        const c = new THREE.Color(color).multiplyScalar(boost);
        m = new THREE.SpriteMaterial({ map: glowTex(), color: c, transparent: true, opacity: Math.min(1, intensity), blending: THREE.AdditiveBlending, depthWrite: false });
        m.userData.shared = true;
        sprites.set(k, m);
      }
      return m;
    },
  };
}

/** Flag a MOVING node (or one with a unique, mutated material): `finalize` never merges it or what hangs under it. */
export function keep<T extends THREE.Object3D>(o: T): T { o.userData.kitKeep = true; return o; }
/**
 * Flag a part root that never moves itself, only its `keep`-flagged children do: `finalize` merges the part's static
 * children into the model even when the modeler lists the part in `keep`.
 */
export function part<T extends THREE.Object3D>(o: T): T { o.userData.kitHoist = true; return o; }
