/**
 * Cyclone Light Ring — procedural model (MACHINES_machines §11, PLAN machines[id=cyclone].modelBrief, ART §5.24).
 *
 * Solo M-slot cabinet, 1.00 W × 0.85 D × 2.10 H m. Origin = floor centre, +Z = front. Midnight-blue body with
 * chrome ribs, a deco top with a rotating siren card, a 1.0 m value plate carrying a ring of 48 lamps (radius
 * 0.42 m, centre y 1.30), a round centre display, a STOP mushroom on a pedestal at 1.0 m and a credit/bet/win LED
 * strip under the ring.
 *
 * Geometry contract (index.ts animates the light along it): lamp i (0…47) sits at angle θ = i·2π/48 measured
 * clockwise from 12 o'clock, position x = R·sin θ, y = RING_Y + R·cos θ. Lamp 0 is the JACKPOT (own LampPart).
 * Lamp 24 (6 o'clock) carries a painted eye on the plate (cosmetic).
 *
 * BUDGET (PLAN): ≤ 1,000 tris, ≤ 14 draws. Draw plan: static shell (merged) 1 · ring lamps (instanced) 1 · JP
 * lamp 1 · value plate 1 · centre 1 · STOP button 2 · beacon 1 · LED strip 1 · marquee 2 · pedestal folded into
 * the shell = 11 plus lamp housings.
 */
import * as THREE from 'three';
import type { ButtonPart, Kit, LampPart, MarqueePart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

export const W = 1.0, D = 0.85, H = 2.1;
export const BODY_D = 0.7;                   // body front sits behind the lamps; the base and top are full depth
export const FRONT_Z = BODY_D / 2;           // 0.35: plate face
export const LAMPS = 48;
export const RING_Y = 1.3, RING_R = 0.42;
export const LAMP_R = 0.022;                 // Ø0.044 lens discs
export const LAMP_Z = FRONT_Z + 0.012;
export const STOP_X = 0.39, STOP_TILT = 55;                  // STOP mushroom: lower-right corner of the plate, clear of the ring and of the seat HUD
export const PLATE_R = 0.4725;               // value numerals sit just outside the lamps (the plate's edge is at 0.5)

/** Clockwise angle of lamp `i` from 12 o'clock (radians). */
export const lampAngle = (i: number): number => (i * 2 * Math.PI) / LAMPS;
/** Lamp centre in machine-local x / y (z = LAMP_Z). */
export const lampXY = (i: number, r = RING_R): [number, number] => {
  const a = lampAngle(i);
  return [r * Math.sin(a), RING_Y + r * Math.cos(a)];
};

/** Contract with the coder (`index.ts`). */
export type CyclonParts = {
  /** 48 lamp discs (instanced, instance colour = lamp colour × intensity). Instance 0 is parked at scale 0; the JP uses `jpLamp`. */
  ringLamps: THREE.InstancedMesh;
  /** The JACKPOT lamp at 12 o'clock (gold when armed, dark grey otherwise). */
  jpLamp: LampPart;
  /** Round centre display (64 × 64): the multiplier won. */
  centre: ScreenSurface;
  /** The 1.0 m value plate behind the ring (256 × 256): ×1 / ×3 / 0 numbers, eye at lamp 24. */
  valuePlate: ScreenSurface;
  buttons: { stop: ButtonPart };
  /** Rotating siren card on the top deck (red when armed). */
  beacon: THREE.Mesh;
  /** Credit / bet / win LEDs (one canvas). */
  leds: ScreenSurface;
  marquee: MarqueePart;
};

/** Lamp colours (MACHINES §11): dim red 0 · amber ×1 · green ×3 · JP dark grey / gold. */
export const LAMP_HEX = { zero: 0x8a2424, x1: 0xffa020, x3: 0x30e060, jpOff: 0x303030, jpOn: 0xffd040 } as const;

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<CyclonParts> {
  const { pal } = kit;
  const root = kit.group('cyclone');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const midnight = 0x101838, chrome = pal.chrome, black = pal.black;

  // ── static shell (flat colours, merged into one draw by kit.finalize) ─────────────────────────────
  kit.box(W, 0.25, D, midnight, at(0, 0.125, 0));                                     // plinth / base
  kit.box(W, 1.55, BODY_D, midnight, at(0, 0.25 + 0.775, 0));                         // body 0.25 → 1.80
  kit.box(W, 0.3, D, midnight, at(0, 1.95, 0));                                       // deco top 1.80 → 2.10
  kit.box(0.02, 1.55, 0.02, chrome, at(-0.49, 1.025, FRONT_Z + 0.01));              // chrome ribs
  kit.box(0.02, 1.55, 0.02, chrome, at(0.49, 1.025, FRONT_Z + 0.01));
  kit.box(W, 0.025, 0.04, chrome, at(0, 1.80, FRONT_Z + 0.02));                       // chrome band under the deco
  kit.box(W, 0.02, 0.85, chrome, at(0, 2.1, 0));                                      // crown line
  kit.box(0.5, 0.2, 0.12, midnight, at(0, 0.36, FRONT_Z + 0.02));                     // base face plinth
  kit.box(0.3, 0.12, 0.04, chrome, at(0.36, 0.3, D / 2 - 0.01));                     // coin tray lip
  // (seat-views: the STOP pedestal moved to the lower-right corner, outside the ring: dead centre at 0.92-1.0 m it hid the bottom lamps and
  // the painted eye, and any lower it vanished behind the seat HUD)
  // the deck and the mushroom are tilted 55 deg towards the player: the flat disc was edge-on (invisible) from the seat
  kit.box(0.22, 0.14, 0.12, midnight, at(STOP_X, 0.66, FRONT_Z + 0.06));             // STOP pedestal (lower)
  kit.box(0.22, 0.02, 0.22, 0x2c3458, { pos: [STOP_X, 0.765, FRONT_Z + 0.075], rot: [STOP_TILT, 0, 0], parent: root });   // pedestal deck

  // ── value plate: one canvas behind the lamp ring ──────────────────────────────────────────────────
  // 512 x 512 + linear/mip filtering, no scanlines: the numerals are the only way to read the ring (seat-views)
  const valuePlate = kit.screen({ w: 1.0, h: 1.0, px: [512, 512], bezel: black, scanlines: false });
  crispTexture(valuePlate.tex, 4);
  {                                                   // flat glass: kit.screen bulges 7 cm at the centre, which swallowed half of every lamp (they sit 1-2 cm proud of the plate)
    const pg = valuePlate.mesh.geometry, pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, 0);
    pp.needsUpdate = true; pg.computeVertexNormals();
  }
  valuePlate.mesh.position.set(0, RING_Y, FRONT_Z + 0.002);
  root.add(valuePlate.mesh);
  paintPlate(valuePlate);

  // ── 48 lamp discs (instanced) ─────────────────────────────────────────────────────────────────────
  const lensGeo = new THREE.CylinderGeometry(LAMP_R, LAMP_R, 0.02, 8);
  lensGeo.rotateX(Math.PI / 2);                                                       // axis → +Z
  const ringLamps = new THREE.InstancedMesh(lensGeo, kit.mat({ color: 0xffffff, lit: false }), LAMPS);
  ringLamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LAMPS * 3).fill(0.25), 3);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < LAMPS; i++) {
    const [x, y] = lampXY(i);
    if (i === 0) m4.makeScale(0, 0, 0).setPosition(x, y, LAMP_Z);                     // JP handled by jpLamp
    else m4.makeTranslation(x, y, LAMP_Z);
    ringLamps.setMatrixAt(i, m4);
    col.setHex(valueHex(i));
    ringLamps.setColorAt(i, col.multiplyScalar(0.35));                                // dim until the chase lights it
  }
  ringLamps.instanceMatrix.needsUpdate = true;
  root.add(ringLamps);

  const jpLamp = kit.lamp({ r: 0.03, color: LAMP_HEX.jpOff, shape: 'dome' });
  const [jx, jy] = lampXY(0);
  jpLamp.root.position.set(jx, jy, LAMP_Z);
  root.add(jpLamp.root);

  // ── centre display (round 64 × 64) ────────────────────────────────────────────────────────────────
  const centre = kit.screen({ w: 0.24, h: 0.24, px: [64, 64], bezel: black });
  centre.mesh.position.set(0, RING_Y, FRONT_Z + 0.03);
  root.add(centre.mesh);

  // ── STOP mushroom on the pedestal deck (0.80 m, lower right) ──────────────────────────────────────────────────
  const stop = kit.button({ shape: 'mushroom', r: 0.085, color: pal.red, lit: true });
  stop.root.position.set(STOP_X, 0.775, FRONT_Z + 0.083);
  stop.root.rotation.x = STOP_TILT * Math.PI / 180;
  (stop.cap.material as THREE.Material).side = THREE.DoubleSide;   // the mushroom's lathe faces point inward: its crown was culled and the chrome base showed as a white disc
  root.add(stop.root);

  // ── siren card on the deco top (rotates; red when armed) ──────────────────────────────────────────
  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), kit.mat({ color: 0xffa020, lit: false }));
  beacon.position.set(0, 2.05, 0);
  root.add(beacon);

  // ── LED strip under the ring ─────────────────────────────────────────────────────────────────────
  const leds = kit.screen({ w: 0.5, h: 0.12, px: [160, 32], bezel: black });
  leds.mesh.position.set(0, 0.5, FRONT_Z + 0.08);
  root.add(leds.mesh);

  // ── marquee on the deco top ─────────────────────────────────────────────────────────────────────
  const marquee = kit.marquee({ w: 0.8, h: 0.12, text: { key: 'm.cyclone.name' }, color: pal.neonYellow, bg: black, bulbs: 12 });
  marquee.root.position.set(0, 1.92, FRONT_Z + 0.03);
  root.add(marquee.root);

  // ── light hints (pooled lights; `light` moves with the chasing lamp, `light2` = secondLight) ───────
  const light = new THREE.Object3D();
  light.position.set(0, RING_Y + RING_R, FRONT_Z + 0.5);
  light.userData = { color: LAMP_HEX.x1, intensity: 0.5, range: 2.0, flicker: 'STEADY' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, RING_Y - RING_R, FRONT_Z + 0.5);
  light2.userData = { color: LAMP_HEX.x3, intensity: 0.3, range: 1.5, flicker: 'STEADY' };
  root.add(light2);

  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D(); a.position.set(x, y, z); root.add(a); return a;
  };
  const speaker = anchor(0, 1.2, FRONT_Z + 0.2);
  const label = anchor(0, 0.36, FRONT_Z + 0.1);
  const marqueeTop = anchor(0, H, 0);
  const servicePlate = anchor(-W / 2 + 0.02, 1.2, 0);
  const stand = anchor(0, 0, D / 2 + 0.6);
  const coinOut = anchor(0.36, 0.3, D / 2);

  const parts: CyclonParts = {
    ringLamps, jpLamp, centre, valuePlate, buttons: { stop }, beacon, leds, marquee,
  };
  kit.finalize(root, {
    keep: [ringLamps, jpLamp.root, centre.mesh, valuePlate.mesh, stop.root, beacon, leds.mesh, marquee.root, light, light2],
  });

  void o;   // colourway/seed reserved: the ring is fixed by the rules, only the trim could vary.
  return {
    root,
    parts,
    // framing: the whole 1 m ring (top lamp under the banner, bottom lamp just above the stake plate) and the STOP mushroom, 4:3 and 16:9
    playPose: { pos: new THREE.Vector3(0, 1.32, 1.68), look: new THREE.Vector3(0, 1.2, 0.35), fov: 58, mouse: 'pick' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H, BODY_D / 2] }],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H, D / 2 + 0.3] },
    anchors: { speaker, prompt: stop.root, label, marqueeTop, servicePlate, stand, coinOut, light, light2 },
    dispose: () => { valuePlate.dispose(); centre.dispose(); leds.dispose(); },
  };
}

/** Lamp colour at rest for lamp `i` (JP dark grey unless armed; index.ts lights it gold). */
export function valueHex(i: number): number {
  if (i === 0) return LAMP_HEX.jpOff;
  const v = [0, 1, 0, 3, 0, 1][i % 6];
  return v === 1 ? LAMP_HEX.x1 : v === 3 ? LAMP_HEX.x3 : LAMP_HEX.zero;
}

/**
 * Paint the value plate: a lit slate band with a socket under every lamp and the multiplier numeral of each lamp just outside it
 * (amber 1, green 3, a dim red 0), the JP label and the painted eye at lamp 24 (cosmetic). seat-views: the numerals used to be 1x
 * 5x7 'x1' / 'x3' marks on a near-black plate and dead lamps had none, so the ring could not be read from the seat.
 */
function paintPlate(s: ScreenSurface): void {
  s.draw((g, sc) => {
    const cx = sc.w / 2, cy = sc.h / 2, k = sc.w / 256;
    g.fillStyle = '#101a3a'; g.fillRect(0, 0, sc.w, sc.h);
    g.beginPath(); g.arc(cx, cy, 0.5 * sc.w, 0, Math.PI * 2); g.fillStyle = '#1e2f66'; g.fill();                 // the lit band
    g.beginPath(); g.arc(cx, cy, (RING_R - 0.045) * sc.w, 0, Math.PI * 2); g.fillStyle = '#0f1838'; g.fill();    // the dark field inside the ring
    g.strokeStyle = '#c0c8d8'; g.lineWidth = 2 * k; g.beginPath(); g.arc(cx, cy, (RING_R - 0.045) * sc.w, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#8fa3d8'; g.lineWidth = 1.5 * k; g.beginPath(); g.arc(cx, cy, 0.497 * sc.w, 0, Math.PI * 2); g.stroke();
    for (let i = 1; i < LAMPS; i++) {
      const a = lampAngle(i), sn = Math.sin(a), cs = Math.cos(a);
      const lx = cx + RING_R * sc.w * sn, ly = cy - RING_R * sc.w * cs;
      g.beginPath(); g.arc(lx, ly, (LAMP_R + 0.006) * sc.w, 0, Math.PI * 2);                                      // lamp socket
      g.fillStyle = '#05081a'; g.fill(); g.strokeStyle = '#7f93cc'; g.lineWidth = 1.2 * k; g.stroke();
      const x = cx + PLATE_R * sc.w * sn, y = cy - PLATE_R * sc.w * cs;
      if (i === 24) {                                                                  // the eye (cosmetic)
        g.fillStyle = '#e8e0c0'; g.beginPath(); g.ellipse(x, y, 9 * k, 5 * k, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#101010'; g.beginPath(); g.arc(x, y, 2.8 * k, 0, Math.PI * 2); g.fill();
        continue;
      }
      const v = [0, 1, 0, 3, 0, 1][i % 6];
      const sz = v === 0 ? 3 : 4;
      sc.text(String(v), x, y - Math.floor(3.5 * sz), { font: 'px5', scale: sz, align: 'center', color: v === 3 ? '#50ff80' : v === 1 ? '#ffb030' : '#b05a5a', outline: '#05081a' });
    }
    sc.text('JP', cx, cy - PLATE_R * sc.w - 10, { font: 'px5', color: '#ffd040', align: 'center', scale: 3, outline: '#05081a' });
  });
}
