/**
 * Pop text (CORE-RENDER): floating "+250" numbers anchored in the world, drawn as crisp pixel text, optionally handed
 * to the HUD (`ui.fly`) so they land in the wallet counter. ART_BIBLE §9.7, FxApi `popText`.
 *
 * One instanced draw call for ALL texts. Glyphs come from a lazily filled 256×256 atlas (Press Start 2P at its native
 * 8 px, alpha-thresholded; each glyph owns a white FILL cell and a black OUTLINE cell, drawn in two layers so
 * neighbouring outlines never cut into letters). The shader projects the world anchor, snaps it to a whole low-res
 * pixel and expands integer-scaled glyph quads in pixel space, so text keeps a constant crisp size at any distance
 * and never shimmers. Depth test is off (a win must always be readable); fade-out is a Bayer screen-door dissolve.
 */
import * as THREE from 'three';
import type { PopTextOpts } from './types';
import type { Hex } from '../types';
import { app } from '../app';
import { clamp } from '../math';
import { GLSL_BAYER, psxUniforms } from '../renderer/psxMaterial';
import type { FxSystem } from './layer';

const ATLAS_UPLOAD_MS = 1000 / 15;   // glyph atlas re-upload cap (≤ 15 Hz)
const CELL = 10;               // 8 px glyph + 1 px outline each side
const ATLAS = 256;
const COLS = Math.floor(ATLAS / CELL);
const ADVANCE = 8;
const MAX_POPS = 24;
const MAX_CHARS = 20;
const CAP = MAX_POPS * MAX_CHARS * 2;
const FONT = '8px "Press Start 2P", "VT323", monospace';

interface Glyph { fill: number; outline: number }       // atlas cell indices (-1 = blank)

class GlyphAtlas {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private readonly tmp = document.createElement('canvas');
  private readonly tg: CanvasRenderingContext2D;
  private readonly map = new Map<string, Glyph>();
  private next = 0;
  dirty = true;

  constructor() {
    this.canvas.width = this.canvas.height = ATLAS;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingEnabled = false;
    this.tmp.width = this.tmp.height = CELL;
    this.tg = this.tmp.getContext('2d', { willReadFrequently: true })!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.userData.shared = true;
    // the pixel font may arrive after boot: redraw every glyph once it is there
    if (typeof document !== 'undefined' && document.fonts) {
      const redo = (): void => this.redraw();
      document.fonts.addEventListener('loadingdone', redo);
      void document.fonts.load(FONT).then(redo).catch((): void => { /* fallback font stays */ });
    }
  }

  /** Upload the atlas when it changed, at most 15 times per second (glyph draws are bursty on the first pop). */
  flush(now: number): void {
    if (!this.dirty || now - this.lastUpload < ATLAS_UPLOAD_MS) return;
    this.lastUpload = now;
    this.dirty = false;
    this.tex.needsUpdate = true;
  }

  private lastUpload = -Infinity;

  get(ch: string): Glyph | null {
    let gl = this.map.get(ch);
    if (gl) return gl;
    if (ch === ' ') { gl = { fill: -1, outline: -1 }; this.map.set(ch, gl); return gl; }
    if (this.next + 2 > COLS * COLS) return null;        // atlas full: drop unknown glyphs
    gl = { outline: this.next++, fill: this.next++ };
    this.map.set(ch, gl);
    this.draw(ch, gl);
    return gl;
  }

  private draw(ch: string, gl: Glyph): void {
    const tg = this.tg;
    tg.clearRect(0, 0, CELL, CELL);
    tg.font = FONT;
    tg.textBaseline = 'top';
    tg.fillStyle = '#fff';
    tg.fillText(ch, 1, 1);
    const src = tg.getImageData(0, 0, CELL, CELL).data;
    const mask = new Uint8Array(CELL * CELL);
    for (let i = 0; i < mask.length; i++) mask[i] = src[i * 4 + 3] >= 128 ? 1 : 0;
    const fill = this.g.createImageData(CELL, CELL);
    const out = this.g.createImageData(CELL, CELL);
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const i = y * CELL + x;
        if (mask[i]) { fill.data[i * 4] = fill.data[i * 4 + 1] = fill.data[i * 4 + 2] = 255; fill.data[i * 4 + 3] = 255; }
        let near = 0;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < CELL && ny < CELL && mask[ny * CELL + nx]) { near = 1; break; }
          }
        }
        if (near) out.data[i * 4 + 3] = 255;
      }
    }
    this.g.putImageData(fill, (gl.fill % COLS) * CELL, Math.floor(gl.fill / COLS) * CELL);
    this.g.putImageData(out, (gl.outline % COLS) * CELL, Math.floor(gl.outline / COLS) * CELL);
    this.dirty = true;
  }

  private redraw(): void {
    for (const [ch, gl] of this.map) if (gl.fill >= 0) this.draw(ch, gl);
  }

  /** UV rect (u0, vBottom, u1, vTop) of a cell. */
  uv(cell: number, out: Float32Array, i: number): void {
    const cx = (cell % COLS) * CELL, cy = Math.floor(cell / COLS) * CELL;
    out[i] = cx / ATLAS; out[i + 1] = 1 - (cy + CELL) / ATLAS; out[i + 2] = (cx + CELL) / ATLAS; out[i + 3] = 1 - cy / ATLAS;
  }
}

const VERT = /* glsl */`
attribute vec4 aAnchor;   // xyz world
attribute vec4 aOff;      // x, y px offset (already scaled), z pixel scale
attribute vec4 aUV;
attribute vec4 aColor;
uniform vec2 uPsxLowRes;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 clip = projectionMatrix * (viewMatrix * vec4(aAnchor.xyz, 1.0));
  vUv = mix(aUV.xy, aUV.zw, uv);
  vColor = aColor;
  if (clip.w < 0.05) { gl_Position = vec4(3.0, 3.0, 0.0, 1.0); return; }
  vec2 hres = uPsxLowRes * 0.5;
  vec2 px = floor(clip.xy / clip.w * hres + 0.5) + aOff.xy + (position.xy + 0.5) * ${CELL}.0 * aOff.z;
  gl_Position = vec4(px / hres, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vColor;
${GLSL_BAYER}
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.5) discard;
  if (vColor.a < 0.999 && vColor.a < psxBayer4(gl_FragCoord.xy) * 0.97) discard;
  gl_FragColor = vec4(t.rgb * vColor.rgb, 1.0);
}
`;

interface Pop {
  x: number; y: number; z: number;
  glyphs: Array<Glyph | null>;
  text: string; color: Hex; r: number; g: number; b: number;
  age: number; dur: number; worldDur: number; rise: number; scale: number;
  flyTo?: string; onArrive?: () => void; sfx?: PopTextOpts['sfx']; shake: boolean; stack: number;
}

const cssColor = (c: Hex): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

export class PopTextSystem implements FxSystem {
  readonly mesh: THREE.Mesh;
  private readonly atlas = new GlyphAtlas();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly aAnchor = new Float32Array(CAP * 4);
  private readonly aOff = new Float32Array(CAP * 4);
  private readonly aUV = new Float32Array(CAP * 4);
  private readonly aColor = new Float32Array(CAP * 4);
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private pops: Pop[] = [];
  private readonly camPos = new THREE.Vector3();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs = ([['aAnchor', this.aAnchor], ['aOff', this.aOff], ['aUV', this.aUV], ['aColor', this.aColor]] as const).map(([n, arr]) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(n, a);
      return a;
    });
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTex: { value: this.atlas.tex }, uPsxLowRes: psxUniforms.uPsxLowRes },
      transparent: false, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    this.mesh.name = 'fx:popText';
  }

  get active(): boolean { return this.pops.length > 0; }
  get count(): number { return this.pops.length; }

  spawn(x: number, y: number, z: number, text: string, color: Hex, o: PopTextOpts): void {
    const chars = [...text].slice(0, MAX_CHARS);
    const dur = Math.max(0.2, o.dur ?? 1);
    // stack texts that pop at (almost) the same place so numbers never overprint each other
    let stack = 0;
    for (const p of this.pops) {
      if (p.age < 0.7 && Math.abs(p.x - x) < 0.4 && Math.abs(p.y - y) < 0.5 && Math.abs(p.z - z) < 0.4) stack = Math.max(stack, p.stack + 1);
    }
    if (this.pops.length >= MAX_POPS) this.pops.shift();
    this.pops.push({
      x, y, z, text: chars.join(''), glyphs: chars.map((c) => this.atlas.get(c)),
      color, r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255,
      age: 0, dur, worldDur: o.flyTo ? Math.max(0.35, dur * 0.6) : dur, rise: o.rise ?? 0.4, scale: o.scale ?? 1,
      flyTo: o.flyTo, onArrive: o.onArrive, sfx: o.sfx, shake: !!o.shake, stack,
    });
    if (o.sfx && !o.flyTo) app.audio.play(o.sfx, { vol: 0.7 });
  }

  update(dt: number): void {
    this.atlas.flush(performance.now());
    const cam = app?.camera;
    if (cam) cam.getWorldPosition(this.camPos);

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      if (p.flyTo && p.age >= p.worldDur) { this.handoff(p); this.pops.splice(i, 1); continue; }
      if (p.age >= p.dur) { this.pops.splice(i, 1); }
    }

    let n = 0;
    for (let layer = 0; layer < 2 && n < CAP; layer++) {
      for (const p of this.pops) {
        const k = clamp(p.age / p.worldDur, 0, 1);
        const wy = p.y + p.rise * (1 - Math.pow(1 - k, 3));
        const dx = this.camPos.x - p.x, dy = this.camPos.y - wy, dz = this.camPos.z - p.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let ps = Math.max(1, Math.min(5, Math.round(2 * p.scale)));
        if (p.age < 0.1) ps += 1;                                   // pop-in: one pixel step bigger for a few frames
        if (dist > 14) ps = Math.max(1, ps - 1);
        const w = p.glyphs.length * ADVANCE * ps;
        let ox = -w / 2;
        let oy = ps * 2 + p.stack * (CELL + 2) * ps;
        if (p.shake && p.age < 0.28) ox += Math.round(Math.sin(p.age * 90) * 3 * ps * (1 - p.age / 0.28));
        oy += Math.round(Math.sin(p.age * 9) * ps * 0.5);
        const fade = p.flyTo ? 1 : p.age > p.dur * 0.7 ? clamp(1 - (p.age - p.dur * 0.7) / (p.dur * 0.3), 0, 1) : 1;
        for (let c = 0; c < p.glyphs.length && n < CAP; c++) {
          const gl = p.glyphs[c];
          if (!gl || gl.fill < 0) continue;
          const i4 = n * 4;
          this.aAnchor[i4] = p.x; this.aAnchor[i4 + 1] = wy; this.aAnchor[i4 + 2] = p.z; this.aAnchor[i4 + 3] = 0;
          this.aOff[i4] = ox + c * ADVANCE * ps - ps; this.aOff[i4 + 1] = oy - ps; this.aOff[i4 + 2] = ps; this.aOff[i4 + 3] = 0;
          this.atlas.uv(layer === 0 ? gl.outline : gl.fill, this.aUV, i4);
          if (layer === 0) { this.aColor[i4] = this.aColor[i4 + 1] = this.aColor[i4 + 2] = 0.04; } else { this.aColor[i4] = p.r; this.aColor[i4 + 1] = p.g; this.aColor[i4 + 2] = p.b; }
          this.aColor[i4 + 3] = fade;
          n++;
        }
      }
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    // upload only the live glyph instances [0, n)
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (n > 0) { a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
  }

  /** The world phase is over: let the HUD carry the number into its counter. */
  private handoff(p: Pop): void {
    const arrive = (): void => {
      if (p.sfx) app.audio.play(p.sfx, { vol: 0.7 });
      p.onArrive?.();
    };
    if (p.flyTo && app.ui.anchor(p.flyTo)) {
      app.ui.fly({
        from: { world: new THREE.Vector3(p.x, p.y + p.rise, p.z), camera: app.camera },
        to: p.flyTo, text: p.text, color: cssColor(p.color), dur: 0.7, onArrive: arrive,
      });
    } else {
      app.tweens.ui.run(0.25, () => {}, { onDone: arrive });       // no HUD anchor registered: still honour the callback
    }
  }

  clear(): void { this.pops.length = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); this.atlas.tex.dispose(); }
}
