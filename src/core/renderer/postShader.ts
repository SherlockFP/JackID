/**
 * Post pass (CORE-RENDER). Contract: ART_BIBLE §1.5 / §1.13, TECH_SPEC §2.3, `PsxPostState` juice in `renderer/types.ts`.
 *
 * ONE full-screen triangle that reads the low-res target with nearest sampling and writes the canvas:
 * zoom-punch → glitch rows → chromatic split → flash → tint/desaturate → vignette → blackout → 4×4 Bayer
 * dither + N-bit quantize (both locked to the LOW-RES pixel grid) → CRT scanlines. Outside the image rectangle
 * (letterbox/pillarbox for aspects beyond 4:3 … 21:9) the shader paints `#080808`.
 * Every input is a uniform: toggling settings or juice never recompiles.
 */
import * as THREE from 'three';
import { GLSL_BAYER } from './psxMaterial';

const VERT = /* glsl */`
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uLowRes;      // low-res target size, px
uniform vec4 uView;        // image rect in canvas px: x, y (bottom-left), w, h (scale may be fractional: FILL mode)
uniform float uLevels;     // colour levels − 1 (31 = 15-bit)
uniform float uDither;     // 0 / 1
uniform float uScan;       // scanline strength
uniform float uVig;        // vignette strength
uniform vec4 uFlash;       // rgb, mix amount
uniform vec4 uTint;        // rgb, mix amount
uniform float uChroma;     // low-res px
uniform float uZoom;
uniform float uDesat;
uniform float uBlackout;
uniform float uGlitch;
uniform float uPostTime;
${GLSL_BAYER}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fc = gl_FragCoord.xy - uView.xy;
  if (fc.x < 0.0 || fc.y < 0.0 || fc.x >= uView.z || fc.y >= uView.w) {
    gl_FragColor = vec4(8.0 / 255.0, 8.0 / 255.0, 8.0 / 255.0, 1.0);
    return;
  }
  vec2 uvFine = fc / uView.zw;                          // 0..1 across the image
  vec2 lp = min(floor(uvFine * uLowRes), uLowRes - 1.0); // low-res pixel under this fragment (exact nearest, any scale)

  // zoom punch about the centre (nearest sampling keeps it chunky)
  vec2 uv = uZoom > 1.0001 ? (uvFine - 0.5) / uZoom + 0.5 : uvFine;

  // glitch: whole rows tear sideways in short bursts
  float gSplit = 0.0;
  if (uGlitch > 0.001) {
    float step24 = floor(uPostTime * 24.0);
    float band = floor(lp.y / 3.0);
    float on = step(1.0 - 0.22 * uGlitch, hash12(vec2(band, step24)));
    uv.x += on * (hash12(vec2(band + 11.0, step24)) - 0.5) * 0.22 * uGlitch;
    gSplit = on * 2.5 * uGlitch;
  }

  vec3 col;
  float ch = (uChroma + gSplit) / uLowRes.x;
  if (ch > 0.00001) {
    col.r = texture2D(tScene, uv + vec2(ch, 0.0)).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - vec2(ch, 0.0)).b;
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  col = mix(col, uFlash.rgb, uFlash.a);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, luma * uTint.rgb * 1.6, uTint.a);
  col = mix(col, vec3(luma), uDesat);

  float vr = length(uvFine - 0.5) * 1.4142;
  col *= 1.0 - uVig * smoothstep(0.45, 0.95, vr);
  col *= 1.0 - uBlackout;

  // ordered dither + quantize on the low-res pixel grid (the pattern stays screen-locked)
  float t = psxBayer4(lp) - 0.46875;
  col += t * uDither / uLevels;
  col = floor(clamp(col, 0.0, 1.0) * uLevels + 0.5) / uLevels;

  // CRT scanlines: darkest on the border between two low-res rows
  col *= 1.0 - uScan * (0.5 + 0.5 * cos(6.2831853 * fract(uvFine.y * uLowRes.y)));

  gl_FragColor = vec4(col, 1.0);
}
`;

const COPY_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform vec2 uLowRes;
void main() {
  gl_FragColor = texture2D(tScene, (floor(gl_FragCoord.xy) + 0.5) / uLowRes);
}
`;

/** Post-pass uniforms, grouped so the renderer can write them without string lookups. */
export interface PostUniforms {
  tScene: THREE.IUniform<THREE.Texture | null>;
  uLowRes: THREE.IUniform<THREE.Vector2>;
  uView: THREE.IUniform<THREE.Vector4>;
  uLevels: THREE.IUniform<number>;
  uDither: THREE.IUniform<number>;
  uScan: THREE.IUniform<number>;
  uVig: THREE.IUniform<number>;
  uFlash: THREE.IUniform<THREE.Vector4>;
  uTint: THREE.IUniform<THREE.Vector4>;
  uChroma: THREE.IUniform<number>;
  uZoom: THREE.IUniform<number>;
  uDesat: THREE.IUniform<number>;
  uBlackout: THREE.IUniform<number>;
  uGlitch: THREE.IUniform<number>;
  uPostTime: THREE.IUniform<number>;
}

export interface PostPass {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly uniforms: PostUniforms;
  /** Copies `src` (low-res) 1:1 into whatever target is bound; used by `grab()`. */
  readonly copy: { scene: THREE.Scene; uniforms: { tScene: THREE.IUniform<THREE.Texture | null>; uLowRes: THREE.IUniform<THREE.Vector2> } };
  dispose(): void;
}

function triangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

export function createPostPass(): PostPass {
  const uniforms: PostUniforms = {
    tScene: { value: null },
    uLowRes: { value: new THREE.Vector2(400, 225) },
    uView: { value: new THREE.Vector4(0, 0, 400, 225) },
    uLevels: { value: 31 },
    uDither: { value: 1 },
    uScan: { value: 0 },
    uVig: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uTint: { value: new THREE.Vector4(0, 0, 0, 0) },
    uChroma: { value: 0 },
    uZoom: { value: 1 },
    uDesat: { value: 0 },
    uBlackout: { value: 0 },
    uGlitch: { value: 0 },
    uPostTime: { value: 0 },
  };
  const geo = triangle();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  const copyUniforms = { tScene: { value: null as THREE.Texture | null }, uLowRes: { value: new THREE.Vector2(1, 1) } };
  const copyMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COPY_FRAG, uniforms: copyUniforms as unknown as Record<string, THREE.IUniform>,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const copyMesh = new THREE.Mesh(geo, copyMat);
  copyMesh.frustumCulled = false;
  const copyScene = new THREE.Scene();
  copyScene.add(copyMesh);

  return {
    scene,
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    uniforms,
    copy: { scene: copyScene, uniforms: copyUniforms },
    dispose() { geo.dispose(); mat.dispose(); copyMat.dispose(); },
  };
}
