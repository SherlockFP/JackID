/**
 * Giant reel drums around the menu camera (menu-inside-a-jackpot). The camera sits BEHIND the glass of a huge
 * slot machine: two vertical symbol drums flank the view and one horizontal drum runs across the top, all close
 * to the camera and turning slowly, so the player reads the menu from inside the mechanism. The symbols are the
 * Big One painters (src/machines/bigone/symbols.ts), one 32x32 cell per reel stop, chunky nearest-filtered cells.
 * Cosmetic and deterministic: the strip order is fixed, the rotation is driven by the clock (never Math.random).
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { paintSymbol } from '@/machines/bigone/symbols';
import { makeCanvasTex, type CanvasTex } from './menuArt';

const BRASS = 0xc9a040;
const STEEL = 0x241016;
/** One strip stop per cell; the sequence is fixed (a little of everything the pit pays out in). */
const STRIP = [6, 0, 4, 2, 5, 1, 3, 8, 6, 2, 4, 0, 5, 3, 1, 6, 4, 8, 2, 5, 0, 3, 6, 1];
const CELLS_U = 8;      // cells around the circumference
const CELLS_V = 6;      // cells along the drum

export interface Drums {
  readonly root: THREE.Group;
  update(dt: number, t: number): void;
  dispose(): void;
}

/** A vertical symbol strip texture (u around, v along) painted with the Big One symbol cells. */
function stripTex(): CanvasTex {
  const tex = makeCanvasTex(CELLS_U * 32, CELLS_V * 32);
  tex.paint((c, w, h) => {
    c.fillStyle = '#1c0c10';
    c.fillRect(0, 0, w, h);
    const cw = w / CELLS_U, ch = h / CELLS_V;
    for (let row = 0; row < CELLS_V; row++) {
      for (let col = 0; col < CELLS_U; col++) {
        const sym = STRIP[(row * CELLS_U + col) % STRIP.length];
        c.save();
        c.translate(col * cw, row * ch);
        c.scale(cw / 32, ch / 32);
        paintSymbol(c, sym, 0, 0, 0, 0);
        c.restore();
      }
    }
  });
  return tex;
}

interface Drum {
  readonly root: THREE.Group;
  readonly spin: THREE.Mesh;
  readonly speed: number;
}

export function buildDrums(): Drums {
  const root = new THREE.Group();
  const texes: CanvasTex[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const own = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const uniq = (o: Parameters<typeof psxMaterial>[0]): THREE.MeshBasicMaterial => {
    const m = psxMaterial({ ...o, unique: true }) as THREE.MeshBasicMaterial;
    mats.push(m);
    return m;
  };
  const drums: Drum[] = [];

  const brassMat = psxMaterial({ color: BRASS });
  const steelMat = psxMaterial({ color: STEEL });

  /** One drum: open symbol cylinder, brass rims, a dark shaft, and a dark backer tube that keeps the seam honest. */
  const addDrum = (o: {
    radius: number; length: number; axis: 'y' | 'x'; at: THREE.Vector3; speed: number; tex: CanvasTex; backer?: boolean;
  }): void => {
    const g = new THREE.Group();
    g.position.copy(o.at);
    const wrap = makeCanvasTex(o.tex.canvas.width, o.tex.canvas.height);
    wrap.paint((c, w, h) => c.drawImage(o.tex.canvas, 0, 0, w, h));
    texes.push(wrap);
    wrap.tex.wrapS = wrap.tex.wrapT = THREE.RepeatWrapping;
    wrap.tex.repeat.set(1, Math.max(1, Math.round(o.length / (o.radius * 2 * Math.PI) * (CELLS_U / CELLS_V))));
    const spin = new THREE.Mesh(own(new THREE.CylinderGeometry(o.radius, o.radius, o.length, CELLS_U * 2, 1, true)),
      uniq({ map: wrap.tex, color: 0xffffff, side: 'double', lit: false }));
    if (o.axis === 'y') g.rotation.set(0, 0, 0);
    else g.rotation.set(0, 0, Math.PI / 2);
    const inner = new THREE.Mesh(own(new THREE.CylinderGeometry(o.radius * 0.82, o.radius * 0.82, o.length * 0.98, CELLS_U, 1, true)),
      uniq({ color: 0x12060a, side: 'double', lit: false }));
    spin.add(inner);
    const rimGeo = own(new THREE.TorusGeometry(o.radius * 1.02, o.radius * 0.055, 6, CELLS_U * 2));
    const shaftGeo = own(new THREE.CylinderGeometry(o.radius * 0.12, o.radius * 0.12, o.length * 1.18, 8));
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(rimGeo, brassMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = (o.length / 2) * s;
      spin.add(rim);
    }
    const shaft = new THREE.Mesh(shaftGeo, steelMat);
    spin.add(shaft);
    if (o.backer) {
      // a dark box behind the cylinder: the strip never shows its own hollow seam against the pit
      const backer = new THREE.Mesh(own(new THREE.BoxGeometry(o.radius * 2.2, o.length * 1.02, o.radius * 2.2)),
        uniq({ color: 0x0c0407, lit: false }));
      backer.position.z = -o.radius * 0.9;
      spin.add(backer);
    }
    g.add(spin);
    root.add(g);
    drums.push({ root: g, spin, speed: o.speed });
  };

  const strip = stripTex();
  texes.push(strip);
  // Side drums: the frame's left and right edges, close to the camera (camera sits at about z 8.5).
  // The drums frame the view from the edges (each covers roughly the outer sixth of a 16:9 screen) — pulled back and
  // smaller than the first pass, which parked 1.85 m drums at 4.6 m from the camera and ate half the frame.
  addDrum({ radius: 1.5, length: 10, axis: 'y', at: new THREE.Vector3(-5.6, 0.4, 2.6), speed: 0.10, tex: strip, backer: true });
  addDrum({ radius: 1.5, length: 10, axis: 'y', at: new THREE.Vector3(5.6, 0.4, 2.6), speed: -0.085, tex: strip, backer: true });
  // Top drum: runs across the top of the frame like the machine's header reel.
  addDrum({ radius: 1.5, length: 13, axis: 'x', at: new THREE.Vector3(0, 3.6, 3.3), speed: 0.06, tex: strip });

  return {
    root,
    update(dt: number, t: number): void {
      for (const d of drums) d.spin.rotation.y += d.speed * dt;
      // the key light on the drums breathes slowly (unlit materials: tint only)
      const v = 0.92 + 0.08 * Math.sin(t * 0.9);
      for (const d of drums) {
        const m = d.spin.material as THREE.MeshBasicMaterial;
        if (m && m.color) m.color.setScalar(v);
      }
    },
    dispose(): void {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texes.forEach((x) => x.tex.dispose());
    },
  };
}