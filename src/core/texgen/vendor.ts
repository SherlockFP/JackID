/**
 * Vendor (CC0) texture loader: `tex.vendor(path, o)` and `preloadVendor` (ASSETS.md "Usage rules", TECH_SPEC §2.4).
 * Owner: CORE-TEXGEN.
 *
 * A call returns a shared texture at once: flat grey until the PNG decodes, then the same canvas is redrawn in place.
 * Pipeline per texture: nearest-neighbour downscale to size × size → flip → multiply tint → darken → per-channel
 * quantize (alpha is kept). Decoded images are cached per path, so one PNG feeds every size and tint variant.
 */
import type * as THREE from 'three';
import { log } from '../log';
import { makeCanvas, finishTexture } from './pixel';
import { VENDOR_ROOT, type VendorTexOpts } from './types';

const GREY = '#808080';

type SourceState = 'loading' | 'ok' | 'failed';
interface Source {
  state: SourceState;
  img: HTMLImageElement | null;
  ready: Promise<void>;
  /** Textures still waiting for the image; flushed once and then dropped. */
  waiting: Array<() => void>;
}

export interface VendorLoader {
  /** Shared texture for `path` with `o`: the same path and opts give the same texture. */
  texture(path: string, o?: VendorTexOpts): THREE.Texture;
  /** Fetch and decode a batch; resolves even when a file is missing (its textures stay grey). */
  preload(paths: readonly string[]): Promise<void>;
}

/** Tint, darken and quantize the downscaled canvas in place (RGB only). */
function grade(g: CanvasRenderingContext2D, size: number, o: VendorTexOpts | undefined): void {
  const tint = o?.tint ?? 0xffffff, dark = 1 - (o?.darken ?? 0), levels = o?.quantize ?? 32;
  if (tint === 0xffffff && dark === 1 && levels < 2) return;
  const tr = (((tint >> 16) & 255) / 255) * dark, tg = (((tint >> 8) & 255) / 255) * dark, tb = ((tint & 255) / 255) * dark;
  const step = levels >= 2 ? 255 / (levels - 1) : 0;
  const q = (v: number): number => (step > 0 ? Math.round(v / step) * step : v);
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = q(d[i] * tr);
    d[i + 1] = q(d[i + 1] * tg);
    d[i + 2] = q(d[i + 2] * tb);
  }
  g.putImageData(id, 0, 0);
}

/** Draw `img` (or the grey placeholder when null) into the size × size canvas, then grade it. */
function paint(cv: HTMLCanvasElement, img: HTMLImageElement | null, o: VendorTexOpts | undefined): void {
  const size = cv.width;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, size, size);
  if (!img) { g.fillStyle = GREY; g.fillRect(0, 0, size, size); return; }
  g.save();
  g.translate(o?.flipX ? size : 0, o?.flipY ? size : 0);
  g.scale(o?.flipX ? -1 : 1, o?.flipY ? -1 : 1);
  g.drawImage(img, 0, 0, size, size);
  g.restore();
  grade(g, size, o);
}

export function createVendorLoader(): VendorLoader {
  const sources = new Map<string, Source>();
  const textures = new Map<string, THREE.Texture>();

  const source = (path: string): Source => {
    const hit = sources.get(path);
    if (hit) return hit;
    const s: Source = { state: 'loading', img: null, ready: Promise.resolve(), waiting: [] };
    const flush = (): void => { for (const redraw of s.waiting.splice(0)) redraw(); };
    s.ready = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = (): void => {
        // decode() up front so the first redraw never stalls the frame
        const done = (): void => { s.img = img; s.state = 'ok'; flush(); resolve(); };
        img.decode().then(done, done);
      };
      img.onerror = (): void => {
        log.warn('texgen', `vendor texture missing: ${path}`);
        s.state = 'failed'; flush(); resolve();
      };
      img.src = VENDOR_ROOT + path;
    });
    sources.set(path, s);
    return s;
  };

  const texture = (path: string, o?: VendorTexOpts): THREE.Texture => {
    const key = `${path}|${JSON.stringify(o ?? {})}`;
    const hit = textures.get(key);
    if (hit) return hit;
    const [cv] = makeCanvas(o?.size ?? 64, o?.size ?? 64);
    const tex = finishTexture(cv, o, true);
    textures.set(key, tex);
    const s = source(path);
    const redraw = (): void => { paint(cv, s.img, o); tex.needsUpdate = true; };
    redraw();
    if (s.state === 'loading') s.waiting.push(redraw);
    return tex;
  };

  const preload = async (paths: readonly string[]): Promise<void> => {
    await Promise.all(paths.map((p) => source(p).ready));
  };

  return { texture, preload };
}
