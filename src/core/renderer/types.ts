/**
 * PSX renderer & material interfaces — TD-FROZEN. Implementation: CORE-RENDER
 * (`psxRenderer.ts`, `psxMaterial.ts`, `postShader.ts`). Contract: TECH_SPEC §2.3, ART_BIBLE §1.
 */
import type * as THREE from 'three';
import type { Hex } from '../types';

export interface PsxSettings {
  enabled: boolean;          // master switch for the whole PSX pipeline (false = native res, no post)
  targetHeight: number;      // 180 | 224 | 240 | 288 | 360 ; default 224
  jitter: number;            // 0..1 vertex snap strength; grid = (1 + 2*jitter) internal px; default 0.5
  affine: boolean;           // affine UV warping; default true
  dither: boolean;           // 4×4 Bayer before quantize; default true
  colorBits: 5 | 6 | 8;      // per channel; 5 = 15-bit PSX; default 5
  crt: boolean;              // scanlines + vignette (no curvature, no bloom); default true
  scanlines: number;         // 0..1, default 0.22
  vignette: number;          // 0..1, default 0.35
  drawDistance: 'near' | 'normal' | 'far';   // fog far = 18 | 26 | 40 m; default 'normal'
}

export interface PsxUniforms {               // ONE shared object referenced by every psx material
  uPsxSnapRes: { value: THREE.Vector2 };     // = lowRes / (2 * (1 + 2*jitter))
  uPsxSnap: { value: number };               // 0/1
  uPsxAffine: { value: number };             // 0/1
  uTime: { value: number };                  // sim seconds (uv scroll)
}

/**
 * Screen-space juice state, read by the post pass every frame (cheap uniforms; **no recompiles**).
 * `FxApi` tweens these; nobody else writes them. All values are "current" (already eased).
 * Flashes honour `settings.reduceFlashing` inside FxApi, not here.
 */
export interface PsxPostState {
  flashColor: Hex; flashAlpha: number;   // dithered additive-ish overlay (win flash, bang)
  tintColor: Hex; tintAlpha: number;     // lerp-to-colour grade (curse violet, ghost ice, blood-red witching hour)
  chroma: number;                        // RGB split in low-res px (0 = off); active even if crt is off
  zoom: number;                          // 1 = none; >1 zooms in about the centre (zoom punch)
  vignetteBoost: number;                 // added to settings.vignette (porcelain-eye collateral, dread)
  desaturate: number;                    // 0..1
  blackout: number;                      // 0..1 multiply-to-black (cheap alternative to a UI fade)
  glitch: number;                        // 0..1 horizontal tear / row shift (horror stingers)
}

export interface PsxRenderer {
  readonly three: THREE.WebGLRenderer;       // antialias:false, powerPreference:'high-performance'
  readonly canvas: HTMLCanvasElement;
  readonly lowRes: THREE.Vector2;            // internal resolution in px
  readonly scale: number;                    // integer upscale factor
  readonly uniforms: PsxUniforms;
  readonly settings: PsxSettings;
  readonly post: PsxPostState;               // juice state, see above
  apply(patch: Partial<PsxSettings>): void;  // live; never triggers shader recompiles
  resize(): void;                            // on window resize
  /** Also keeps a PerspectiveCamera's `aspect` in sync with the canvas (callers never touch aspect). */
  render(scene: THREE.Scene, camera: THREE.Camera,
         overlay?: { scene: THREE.Scene; camera: THREE.Camera }): void;
  grab(): THREE.Texture;                     // copy of last low-res frame (menu glass-shatter)
  compile(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  info(): { calls: number; tris: number; geometries: number; textures: number; programs: number; cpuMs: number };
}

export interface PsxMatOpts {
  color?: Hex;               // default 0xffffff
  map?: THREE.Texture | null;
  emissive?: Hex;            // default 0x000000
  emissiveIntensity?: number;// default 1
  emissiveMap?: THREE.Texture | null;
  lit?: boolean;             // true → MeshLambertMaterial, false → MeshBasicMaterial (unlit); default true
  vertexColors?: boolean;    // default false; kit.shade() sets true
  transparent?: boolean; opacity?: number;   // default false / 1
  alphaTest?: number;        // default 0 (0.5 recommended for cut-out sprites)
  additive?: boolean;        // AdditiveBlending, depthWrite false
  side?: 'front' | 'back' | 'double';        // default 'front'
  fog?: boolean;             // default true
  snap?: boolean;            // vertex snapping, default true (false for UI-ish screens close to camera)
  affine?: boolean;          // default true (false for large screens / text)
  scroll?: [number, number]; // uv scroll speed (uv/s), e.g. marquee belts
  depthWrite?: boolean;      // default !transparent
  unique?: boolean;          // bypass cache (material will be mutated at runtime)
}

/** Signature of the factory exported by `psxMaterial.ts`. */
export type PsxMaterialFactory = (o: PsxMatOpts) => THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
