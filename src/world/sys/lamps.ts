/**
 * Circuit lamp glow (WORLD-SYS). Listens to `circuit:lamps` (fired at each Bell and empty at Settle) and puts a pooled
 * light over every Hot and Cold machine, plus a visible halo and a light column, so the Lamps read from across the pit:
 *   Hot  warm amber, strong breathing (about 0.4 Hz, ±45 %), a halo over the cabinet and a tall beam above it.
 *   Cold clear dim blue, steady, a halo and a short faint column.
 * The lights live in the shared LightPool (world/sys/lightPool), so the pool's six slots still decide what is real.
 * The halo and beam are additive sprites / open cylinders parented to the pool's scene root (no picking, no shadows).
 * Reduce flashing shrinks the breathing to a quarter. Seeded or timed only; no randomness.
 */
import * as THREE from 'three';
import { bus } from '@/core/events';
import type { Hex, InstanceId, Unsub } from '@/core/types';
import type { LightPool } from './lightPool';

const HOT_COLOR: Hex = 0xffa040;
const COLD_COLOR: Hex = 0x4a7dff;
const HOT_BASE = 3.6;
const COLD_BASE = 1.1;
const HOT_RANGE = 9;
const COLD_RANGE = 4.5;
/** Metres above the slot origin (over the cabinet top). */
const MOUNT_Y = 2.1;
const BREATH_HZ = 0.4;
const BEAM_H = 3.2;

export interface LampGlowOpts {
  pool: Pick<LightPool, 'add' | 'api' | 'lights'>;
  /** World position of an instance's slot, or null when it has none. */
  at(mid: InstanceId): { x: number; y: number; z: number } | null;
  /** Accessibility: reduce flashing. */
  reduced(): boolean;
}

export interface LampGlow {
  /** Per frame: breathing levels for the live Hot lamps. */
  update(dt: number): void;
  /** Removes every light, halo and beam, and the bus subscription. */
  dispose(): void;
}

interface Glow { sprite: THREE.Sprite; sm: THREE.SpriteMaterial; beam: THREE.Mesh; bm: THREE.MeshBasicMaterial }
interface Live { owner: string; hot: boolean; off: () => void; phase: number; glow: Glow | null }

/** Shared textures and column geometry, made on first use (needs a DOM canvas; absent in node, the glow is then light only). */
interface Shared { halo: THREE.CanvasTexture; beam: THREE.CanvasTexture; hotCol: THREE.CylinderGeometry; coldCol: THREE.CylinderGeometry }
let shared: Shared | null = null;

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (g) paint(g);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sharedGlow(): Shared | null {
  if (shared) return shared;
  if (typeof document === 'undefined') return null;
  const halo = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  // canvas top is the column's top (uv.y = 1): clear up there, opaque at the lamp
  const beam = canvasTex(8, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 128);
  });
  shared = {
    halo, beam,
    hotCol: new THREE.CylinderGeometry(0.55, 0.12, BEAM_H, 14, 1, true),
    coldCol: new THREE.CylinderGeometry(0.3, 0.1, BEAM_H * 0.6, 12, 1, true),
  };
  return shared;
}

export function createLampGlow(o: LampGlowOpts): LampGlow {
  const live: Live[] = [];
  let clock = 0;
  let serial = 0;

  const makeGlow = (host: THREE.Object3D, x: number, y: number, z: number, hot: boolean): Glow | null => {
    const sh = sharedGlow();
    if (!sh) return null;
    const sm = new THREE.SpriteMaterial({
      map: sh.halo, color: hot ? HOT_COLOR : COLD_COLOR, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0,
    });
    const sprite = new THREE.Sprite(sm);
    const size = hot ? 2.4 : 1.2;
    sprite.scale.set(size, size, 1);
    sprite.position.set(x, y + MOUNT_Y - 0.1, z);
    sprite.raycast = () => undefined;
    const bm = new THREE.MeshBasicMaterial({
      map: sh.beam, color: hot ? HOT_COLOR : COLD_COLOR, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide, fog: false,
    });
    const beam = new THREE.Mesh(hot ? sh.hotCol : sh.coldCol, bm);
    beam.position.set(x, y + MOUNT_Y + (hot ? BEAM_H : BEAM_H * 0.6) / 2, z);
    beam.raycast = () => undefined;
    host.add(sprite, beam);
    return { sprite, sm, beam, bm };
  };

  const dropGlow = (g: Glow | null): void => {
    if (!g) return;
    g.sprite.removeFromParent();
    g.beam.removeFromParent();
    g.sm.dispose();
    g.bm.dispose();
  };

  const clear = (): void => {
    for (const l of live) { l.off(); dropGlow(l.glow); }
    live.length = 0;
  };

  const add = (mid: InstanceId, hot: boolean): void => {
    const p = o.at(mid);
    if (!p) return;
    const owner = `lamp:${hot ? 'hot' : 'cold'}:${mid}`;
    const offLight = o.pool.add({
      id: owner, owner,
      pos: { x: p.x, y: p.y + MOUNT_Y, z: p.z },
      color: hot ? HOT_COLOR : COLD_COLOR,
      intensity: hot ? HOT_BASE : COLD_BASE,
      range: hot ? HOT_RANGE : COLD_RANGE,
      flicker: 'STEADY',
    });
    // the scene root the pool's lights hang from (the halo and beam go there too)
    const host = o.pool.lights[0]?.parent ?? null;
    const glow = host ? makeGlow(host, p.x, p.y, p.z, hot) : null;
    live.push({ owner, hot, off: offLight, phase: (serial++ * 0.618) % 1, glow });
  };

  const unsub: Unsub = bus.on('circuit:lamps', (e) => {
    clear();
    for (const m of e.hot) add(m.mid, true);
    for (const m of e.cold) add(m.mid, false);
  });

  return {
    update(dt: number): void {
      if (live.length === 0) return;
      clock += dt;
      const amp = o.reduced() ? 0.25 : 1;
      for (const l of live) {
        const s = 0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * BREATH_HZ + l.phase * Math.PI * 2);
        const level = l.hot ? 1 + amp * (0.9 * s - 0.45) : 1 - amp * 0.1 * s;
        o.pool.api.setLevel(l.owner, level, 0);
        if (l.glow) {
          if (l.hot) {
            l.glow.sm.opacity = 0.55 + amp * 0.4 * s;
            l.glow.bm.opacity = 0.22 + amp * 0.2 * s;
          } else {
            l.glow.sm.opacity = 0.35;
            l.glow.bm.opacity = 0.12;
          }
        }
      }
    },
    dispose(): void {
      unsub();
      clear();
    },
  };
}
