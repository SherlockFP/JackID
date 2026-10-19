/**
 * Crisp world signs (WORLD-ARCH, wave 77). The kit's label and neon draw small web-font text into a tiny canvas that
 * smears when the camera is far or the language is Turkish. These two helpers paint the 5x7 bitmap font (full Turkish
 * coverage, no web-font load) at an integer scale on a canvas sized for the sign: nearest when magnified, mipmapped when
 * far, with room above the cap line for the accent dots.
 *
 *   crispLabel(kit, { text, w, h, color, bg })   a flat plate, same shape as `kit.label`
 *   crispNeon(kit, { text, h, color })           a lit sign (dark plate, bright frame and letters), same shape as `kit.neon`
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { Hex } from '@/core/types';
import type { LabelPart, NeonPart, TextSource } from '@/kit/types';
import { bus } from '@/core/events';
import { t as tr, upper } from '@/core/i18n';

/**
 * Sign faces. 'px5' is the built-in 5x7 bitmap font; 'public' (Public Pixel, CC0) and 'chetyre' (Chetyre, OFL) are vendored
 * TTFs with the full Turkish set (never Thintel: it has no Turkish letters). A web face paints through a 1-bit alpha
 * threshold so it stays crisp, and until the file has loaded the sign shows the bitmap font, then repaints itself.
 */
export type SignFont = 'px5' | 'public' | 'chetyre';
const FACES: Record<Exclude<SignFont, 'px5'>, { family: string; file: string }> = {
  public: { family: 'JackID Public Pixel', file: 'ggbot-public-pixel/PublicPixel.ttf' },
  chetyre: { family: 'JackID Chetyre', file: 'hanshuyuri-chetyre/Chetyre-Regular.ttf' },
};
const faceState = new Map<string, 'loading' | 'ready' | 'failed'>();
const faceWaiters = new Map<string, Array<() => void>>();

/** True once the face is usable; the first call starts the load and queues `onReady` for when it lands. */
function faceReady(font: SignFont, onReady: () => void): boolean {
  if (font === 'px5') return false;
  const face = FACES[font];
  const st = faceState.get(font);
  if (st === 'ready') return true;
  if (st === 'failed') return false;
  (faceWaiters.get(font) ?? faceWaiters.set(font, []).get(font)!).push(onReady);
  if (st === undefined) {
    faceState.set(font, 'loading');
    try {
      const ff = new FontFace(face.family, `url(${import.meta.env.BASE_URL}assets/vendor/${face.file})`);
      void ff.load().then((loaded) => {
        document.fonts.add(loaded);
        faceState.set(font, 'ready');
        for (const w of faceWaiters.get(font) ?? []) w();
        faceWaiters.delete(font);
      }, () => { faceState.set(font, 'failed'); faceWaiters.delete(font); });
    } catch { faceState.set(font, 'failed'); faceWaiters.delete(font); }
  }
  return false;
}

let scratch: HTMLCanvasElement | null = null;
const scratchCtx = (): CanvasRenderingContext2D => {
  scratch ??= document.createElement('canvas');
  return scratch.getContext('2d', { willReadFrequently: true })!;
};
const fontCss = (font: SignFont, px: number): string => `${px}px "${FACES[font as Exclude<SignFont, 'px5'>].family}"`;

/** Width in px of `str` set in a web face at `px`. */
function measureFace(font: SignFont, str: string, px: number): number {
  const g = scratchCtx();
  g.font = fontCss(font, px);
  return g.measureText(str).width;
}

/** Draw `str` centred at (cx, cy) in a web face with no anti-aliasing: render, threshold alpha, stamp the 1-bit result. */
function drawFace(g: CanvasRenderingContext2D, font: SignFont, str: string, cx: number, cy: number, px: number, color: string, wpx: number, hpx: number): void {
  const sg = scratchCtx();
  const cv = sg.canvas;
  cv.width = wpx; cv.height = hpx;
  sg.clearRect(0, 0, wpx, hpx);
  sg.font = fontCss(font, px);
  sg.textAlign = 'center'; sg.textBaseline = 'middle';
  sg.fillStyle = '#ffffff';
  sg.fillText(str, cx, cy);
  const id = sg.getImageData(0, 0, wpx, hpx), d = id.data;
  const c = parseInt(color.slice(1), 16), r = (c >> 16) & 255, gr = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < d.length; i += 4) {
    const on = d[i + 3] >= 128;
    d[i] = r; d[i + 1] = gr; d[i + 2] = b; d[i + 3] = on ? 255 : 0;
  }
  sg.putImageData(id, 0, 0);
  g.drawImage(cv, 0, 0);
}

/** Texels per metre of sign height. 150 gives a 0.4 m plate 60 texels: scale 5 letters. */
const PPM = 150;
const CAP = 7;

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const resolve = (src: TextSource): string => (typeof src === 'string' ? src : tr(src.key, src.vars));

/** Nearest when magnified (sharp pixels up close), trilinear mips when minified (no shimmer from across the hall). */
export function crispFilters(tex: THREE.Texture): void {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.userData.mips = true;   // psxTexture would otherwise reset the filters when the material is built
  tex.needsUpdate = true;
}

interface PlateOpts { text: TextSource; w: number; h: number; color: Hex; bg: Hex | null; frame?: Hex | null; ppm?: number; font?: SignFont; sub?: TextSource; subColor?: Hex }
interface Plate { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; setText(t: TextSource): void }

function makePlate(kit: KitX, o: PlateOpts): Plate {
  const hpx = Math.max(24, Math.round(o.h * (o.ppm ?? PPM)));
  const wpx = Math.max(32, Math.min(1024, Math.round((o.w * hpx) / o.h)));
  const texture = kit.tex.canvas(wpx, hpx, () => undefined, { wrap: 'clamp' });
  const cv = texture.image as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  let src = o.text;
  const frameW = o.frame ? Math.max(2, Math.round(hpx / 16)) : 0;
  const paint = (): void => {
    const str = upper(resolve(src));
    g.clearRect(0, 0, wpx, hpx);
    if (o.bg !== null) { g.fillStyle = css(o.bg); g.fillRect(0, 0, wpx, hpx); }
    if (o.frame) {
      g.fillStyle = css(o.frame);
      g.fillRect(0, 0, wpx, frameW); g.fillRect(0, hpx - frameW, wpx, frameW);
      g.fillRect(0, 0, frameW, hpx); g.fillRect(wpx - frameW, 0, frameW, hpx);
    }
    const pad = frameW + Math.round(hpx * 0.1);
    /** One line in the band [top, top + bh): the largest whole scale whose cap block plus two accent rows fits, shrunk until it fits the width. */
    const line = (txt: string, top: number, bh: number, color: Hex): void => {
      if (!txt) return;
      let s = Math.max(1, Math.floor(bh / (CAP + 4)));
      while (s > 1 && kit.tex.measure(txt, { font: 'px5', scale: s }) > wpx - pad * 2) s--;
      const y = top + Math.max(2 * s, Math.round((bh - CAP * s) / 2));
      kit.tex.drawText(g, txt, Math.round(wpx / 2), y, { font: 'px5', scale: s, color: css(color), align: 'center' });
    };
    // a bilingual sign: the Turkish line big on top, the English line small under it (docs/ART.md "Identity")
    const split = o.sub ? Math.round(hpx * 0.64) : hpx;
    line(str, 0, split, o.color);
    if (o.sub) line(upper(resolve(o.sub)), split - frameW, hpx - split, o.subColor ?? o.color);
    texture.needsUpdate = true;
  };
  paint();
  crispFilters(texture);
  const off = bus.on('lang:changed', paint);
  texture.addEventListener('dispose', () => off());
  const mat = kit.mat({ map: texture, lit: false, affine: false, snap: false, unique: true, alphaTest: o.bg === null ? 0.5 : 0 }) as THREE.MeshBasicMaterial;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
  mesh.name = 'sign';
  return { mesh, mat, setText(t) { src = t; paint(); } };
}

/** A flat text plate (drop-in for `kit.label`): dark ground, bright letters, a thin frame, readable at any distance. */
export function crispLabel(kit: KitX, o: { text: TextSource; w: number; h: number; color: Hex; bg?: Hex | null; frame?: Hex | null; ppm?: number; font?: SignFont }): LabelPart {
  const p = makePlate(kit, { text: o.text, w: o.w, h: o.h, color: o.color, bg: o.bg === undefined ? 0x1a120c : o.bg, frame: o.frame, ppm: o.ppm, font: o.font });
  return { mesh: p.mesh, setText: p.setText };
}

/**
 * A two-line plate in the casino's sign style: `text` big (the Turkish word), `sub` small under it (the English one). Both are string
 * keys, repainted on a language change like every crisp sign.
 */
export function crispBilingual(kit: KitX, o: { text: TextSource; sub: TextSource; w: number; h: number; color: Hex; subColor?: Hex; bg?: Hex | null; frame?: Hex | null; ppm?: number }): LabelPart {
  const p = makePlate(kit, { text: o.text, sub: o.sub, subColor: o.subColor, w: o.w, h: o.h, color: o.color, bg: o.bg === undefined ? 0x1a120c : o.bg, frame: o.frame, ppm: o.ppm });
  return { mesh: p.mesh, setText: p.setText };
}

/**
 * A lit sign (drop-in for `kit.neon`): a dark plate with a bright frame and bright letters, over a soft additive glow.
 * The plate is sized from the current text; a longer translation shrinks to fit instead of growing.
 */
export function crispNeon(kit: KitX, o: { text: TextSource; h: number; color: Hex; flicker?: number; font?: SignFont }): NeonPart {
  const root = kit.group('neon');
  const first = upper(resolve(o.text));
  const hpx = Math.round(o.h * PPM);
  const s = Math.max(1, Math.floor(hpx / (CAP + 6)));
  const w = Math.max(o.h * 1.6, (o.h * (kit.tex.measure(first, { font: 'px5', scale: s }) + Math.round(hpx * 0.7))) / hpx);
  const plate = makePlate(kit, { text: o.text, w, h: o.h, color: 0xffffff, bg: 0x120a08, frame: 0xffffff, font: o.font });
  // tint: the letters take the sign colour through the material (white texels x colour), the frame stays the sign colour
  plate.mat.color.setHex(o.color);
  const glowTex = kit.tex.canvas(32, 16, (g, gw, gh) => {
    const grad = g.createRadialGradient(gw / 2, gh / 2, 1, gw / 2, gh / 2, gw / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, gw, gh);
  }, { wrap: 'clamp' });
  const glowMat = kit.mat({ map: glowTex, color: o.color, lit: false, additive: true, transparent: true, opacity: 0.45, affine: false, snap: false, unique: true });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, o.h * 2.2), glowMat);
  glow.position.z = -0.01;
  glow.renderOrder = 1;
  root.add(glow, plate.mesh);
  const api: NeonPart = {
    root,
    setOn(v) {
      plate.mat.color.setHex(v ? o.color : 0x3a2a24);
      glow.visible = v;
    },
    flicker() { /* the sign is steady: a flicker smears the letters */ },
  };
  api.setOn(true);
  return api;
}
