/**
 * Circuit lamp glow (WORLD-SYS). Listens to `circuit:lamps` (fired at each Bell and empty at Settle) and puts a pooled
 * light over every Hot and Cold machine, plus a visible halo and a light column, so the Lamps read from across the pit:
 *   Hot  warm amber, strong breathing (about 0.4 Hz, ±45 %), a halo over the cabinet, a tall beam above it, and a
 *        floating "HOT ×1.5" tag over the beam (grows with distance, never breathes).
 *   Cold clear dim blue, steady, a halo and a short faint column.
 * The lights live in the shared LightPool (world/sys/lightPool), so the pool's six slots still decide what is real.
 * The halo and beam are additive sprites / open cylinders parented to the pool's scene root (no picking, no shadows).
 * Reduce flashing shrinks the breathing to a quarter. Seeded or timed only; no randomness.
 */
import * as THREE from 'three';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import type { Hex, InstanceId, Unsub } from '@/core/types';
import { HOT_MULT } from '@/game/circuit';
import type { LightPool } from './lightPool';
import { app } from '@/core/app';

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
/** The Hot cabinet's floating tag ("HOT ×1.5"): metres above the lamp mount, and its world size at the near end. */
const TAG_Y = 1.1;
const TAG_W = 1.9;
const TAG_H = 0.57;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

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

interface Glow { sprite: THREE.Sprite; sm: THREE.SpriteMaterial; beam: THREE.Mesh; bm: THREE.MeshBasicMaterial; size: number }
interface Tag { sprite: THREE.Sprite; sm: THREE.SpriteMaterial; tex: THREE.CanvasTexture }
interface Live { owner: string; hot: boolean; off: () => void; phase: number; glow: Glow | null; tag: Tag | null; at: THREE.Vector3 }

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
    return { sprite, sm, beam, bm, size };
  };

  const dropGlow = (g: Glow | null): void => {
    if (!g) return;
    g.sprite.removeFromParent();
    g.beam.removeFromParent();
    g.sm.dispose();
    g.bm.dispose();
  };

  /** The tag: a dark plate with the Hot multiplier, read in the current language when the Lamps are lit (each Bell). */
  const makeTag = (host: THREE.Object3D, x: number, y: number, z: number): Tag | null => {
    if (!sharedGlow()) return null;
    const label = t('circuit.hot', { x: HOT_MULT });
    const tex = canvasTex(320, 96, (g) => {
      g.fillStyle = 'rgba(18,9,3,0.88)';
      g.fillRect(0, 0, 320, 96);
      g.strokeStyle = '#ffa040';
      g.lineWidth = 6;
      g.strokeRect(3, 3, 314, 90);
      g.fillStyle = '#ffd08a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // shrink the type to fit the plate (Turkish runs longer than English)
      g.font = 'bold 44px sans-serif';
      const w = g.measureText(label).width;
      if (w > 290) g.font = `bold ${Math.floor(44 * 290 / w)}px sans-serif`;
      g.fillText(label, 160, 50);
    });
    const sm = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(sm);
    sprite.scale.set(TAG_W, TAG_H, 1);
    sprite.position.set(x, y + MOUNT_Y + TAG_Y, z);
    sprite.raycast = () => undefined;
    host.add(sprite);
    return { sprite, sm, tex };
  };

  const dropTag = (g: Tag | null): void => {
    if (!g) return;
    g.sprite.removeFromParent();
    g.sm.dispose();
    g.tex.dispose();
  };

  const clear = (): void => {
    for (const l of live) { l.off(); dropGlow(l.glow); dropTag(l.tag); }
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
    const tag = host && hot ? makeTag(host, p.x, p.y, p.z) : null;
    live.push({ owner, hot, off: offLight, phase: (serial++ * 0.618) % 1, glow, tag, at: new THREE.Vector3(p.x, p.y + MOUNT_Y, p.z) });
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
      const cam = app.camera as THREE.Object3D | undefined;
      const cp = cam?.position;
      for (const l of live) {
        // WAVE 23: the beacon reads from across the pit. Its distance from the camera (0 close, 1 from ~30 m) lifts the light, the
        // halo and the beam, so a Hot Lamp seen from far away is the brightest thing in its row.
        const far = cp ? clamp01((l.at.distanceTo(cp) - 5) / 25) : 0;
        const s = 0.5 + 0.5 * Math.sin(clock * Math.PI * 2 * BREATH_HZ + l.phase * Math.PI * 2);
        const level = (l.hot ? 1 + amp * (0.9 * s - 0.45) : 1 - amp * 0.1 * s) * (1 + (l.hot ? 0.6 : 0.3) * far);
        o.pool.api.setLevel(l.owner, level, 0);
        // the tag grows with distance, so it reads from across the pit (it does not breathe)
        if (l.tag) l.tag.sprite.scale.set(TAG_W * (1 + 0.6 * far), TAG_H * (1 + 0.6 * far), 1);
        if (l.glow) {
          const g = l.glow;
          if (l.hot) {
            g.sm.opacity = Math.min(1, 0.55 + amp * 0.4 * s + 0.4 * far);
            g.bm.opacity = Math.min(1, 0.22 + amp * 0.2 * s + 0.35 * far);
            g.sprite.scale.setScalar(g.size * (1 + 1.2 * far));
          } else {
            g.sm.opacity = Math.min(1, 0.35 + 0.25 * far);
            g.bm.opacity = Math.min(1, 0.12 + 0.18 * far);
            g.sprite.scale.setScalar(g.size * (1 + 0.8 * far));
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
