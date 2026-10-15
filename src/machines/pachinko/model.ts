/**
 * Pachinko "Deep Rain" — procedural model (MACHINES_machines §8 cabinet + plan.json modelBrief).
 *
 * Wall frame 0.60 × 0.45 × 1.62 m holding the machine (0.55 × 0.30 × 0.90 m, bottom at y 0.72), a low stool at
 * z +0.35 and nothing else in front. Origin = floor centre of the footprint, +Z = player side.
 *
 * The playfield is a Group (`parts.field`, origin = playfield bottom-left, X right, Y up, metres) tilted 10° back
 * behind glass. The lane graph (`lanes.ts`) is the single source of pin and pocket positions: nails sit on its nodes
 * (minus those hidden by the LCD), pockets and the start pocket sit on its pocket positions.
 *
 * BUDGET: ≤ 1 300 tris, ≤ 14 draw calls (the static shell and the field art merge; animated parts are listed in
 * `keep`). Nails are one InstancedMesh of tetrahedra (4 tris each).
 */
import * as THREE from 'three';
import type { Kit, LampPart, ScreenSurface, BallPool } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { LANE_NODES, POCKET_DEFS } from './lanes';

/** Contract between modeler and coder. Field coordinates are playfield-local (metres). */
export type PachinkoParts = {
  /** Tilted playfield group; children use field coordinates. */
  field: THREE.Object3D;
  /** Ball pool (64) in field coordinates. */
  balls: BallPool;
  /** Two tulips (pivot at the tulip base), open 35° when caught. */
  tulips: [THREE.Object3D, THREE.Object3D];
  /** Two windmills (spinning vanes). */
  windmills: [THREE.Object3D, THREE.Object3D];
  /** Start pocket ring under the LCD (FX anchor for START). */
  startPocket: THREE.Object3D;
  /** Electric chu-lip flaps (pink), pivot at the lip. */
  eChu: THREE.Object3D;
  /** Attacker plate (hinged at its bottom edge, opens 60°). */
  attacker: THREE.Object3D;
  screens: { lcd: ScreenSurface };
  /** Four digital-slot hold lamps under the LCD. */
  holdLamps: [LampPart, LampPart, LampPart, LampPart];
  /** Chrome dial (rotation.z 0 → −2.4 rad while pulled). */
  handle: THREE.Object3D;
  trays: { upper: THREE.Object3D; lower: THREE.Object3D };
  /** Side tube and jar (rust tint over time, visual only). */
  jar: THREE.Object3D;
  /** Magenta neon strip along the playfield edge. */
  ledStrips: THREE.Object3D;
  /** Low stool in front of the cabinet. */
  stool: THREE.Object3D;
};

export const FRAME = { w: 0.6, d: 0.45, h: 1.62 };
export const CAB = { w: 0.55, d: 0.3, h: 0.9, y0: 0.72 };
export const FIELD = { size: 0.48, x: -0.24, y: 1.06, tilt: -10 * Math.PI / 180 };
export const LCD = { x: 0.24, y: 0.38, w: 0.2, h: 0.15 };
const PINK = 0xff4fa0, STEEL = 0xc8ccd0, ART_TOP = 0x1a2a5a, ART_BOT = 0x2b6cb0;

/** Colourways: frame gold / chrome / red / black (ART bible: a row of machines should not look identical). */
const FRAME_COLOURS = ['gold', 'chrome', 'red', 'black'] as const;

/** Is a pin hidden under the LCD box? (pins there would show through the screen) */
function underLcd(x: number, y: number): boolean {
  return Math.abs(x - LCD.x) < LCD.w / 2 + 0.01 && Math.abs(y - LCD.y) < LCD.h / 2 + 0.01;
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<PachinkoParts> {
  const { pal } = kit;
  const frameC = pal[FRAME_COLOURS[o.variant] ?? 'gold'];
  const root = kit.group('pachinko');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // â”€â”€ static shell (flat colours, merges into one draw) â”€â”€
  const frameZ = -0.15;
  kit.box(FRAME.w, FRAME.h, 0.04, pal.steel, at(0, FRAME.h / 2, frameZ - FRAME.d / 2 + 0.02));       // back plate
  for (const sx of [-1, 1]) kit.box(0.03, FRAME.h, FRAME.d, pal.steel, at(sx * (FRAME.w / 2 - 0.015), FRAME.h / 2, frameZ));
  kit.box(FRAME.w, 0.04, FRAME.d, pal.steel, at(0, FRAME.h - 0.02, frameZ));                          // canopy
  const cabZ = frameZ + 0.02;
  // cabinet body, built AROUND the playfield opening (the old solid box swallowed the tilted field, which sits behind its front face):
  // a back block, then a front frame of four boxes below / above / left / right of the opening (y 1.05 ... 1.56)
  const frontZ = cabZ + CAB.d / 2, openLo = 1.05, openHi = 1.56, sideW = 0.02;
  kit.box(CAB.w, CAB.h, 0.18, pal.black, at(0, CAB.y0 + CAB.h / 2, frontZ - 0.21));                    // back block (z -0.28 ... -0.10)
  kit.box(CAB.w, openLo - CAB.y0, 0.12, pal.black, at(0, (CAB.y0 + openLo) / 2, frontZ - 0.06));      // front frame: below the opening
  kit.box(CAB.w, CAB.y0 + CAB.h - openHi, 0.12, pal.black, at(0, (openHi + CAB.y0 + CAB.h) / 2, frontZ - 0.06));   // above
  for (const sx of [-1, 1]) kit.box(sideW, openHi - openLo, 0.12, pal.black, at(sx * (CAB.w / 2 - sideW / 2), (openLo + openHi) / 2, frontZ - 0.06));
  kit.box(CAB.w + 0.02, 0.02, CAB.d + 0.02, frameC, at(0, CAB.y0 + CAB.h + 0.01, cabZ));           // top bezel
  kit.box(0.03, CAB.h, 0.02, frameC, at(-CAB.w / 2, CAB.y0 + CAB.h / 2, cabZ + CAB.d / 2));        // side bezels
  kit.box(0.03, CAB.h, 0.02, frameC, at(CAB.w / 2, CAB.y0 + CAB.h / 2, cabZ + CAB.d / 2));
  kit.box(0.2, 0.012, 0.1, pal.steel, at(0.16, 0.78, cabZ + 0.13));                                 // upper tray
  kit.box(0.22, 0.02, 0.1, pal.steel, at(0.16, 0.74, cabZ + 0.12));                                 // lower tray
  kit.box(0.012, 0.6, 0.012, pal.steel, at(0.2, 1.05, cabZ + 0.12));                                 // jar side tube
  kit.box(0.18, 0.02, 0.1, frameC, at(0, 0.7, cabZ + 0.14));                                         // service ledge
  kit.box(0.06, 0.12, 0.02, frameC, at(0.24, 0.84, cabZ + 0.15));                                   // handle housing

  // â”€â”€ playfield â”€â”€
  const field = new THREE.Object3D();
  field.position.set(FIELD.x, FIELD.y, cabZ + CAB.d / 2 - 0.02);
  field.rotation.x = FIELD.tilt;
  root.add(field);
  const S = FIELD.size;
  kit.plane(S, S, ART_TOP, { pos: [S / 2, S / 2, 0.0], parent: field, shade: false });            // art (flat, dusk gradient)
  kit.plane(S, S * 0.3, ART_BOT, { pos: [S / 2, S * 0.85, 0.0005], parent: field, shade: false }); // sky band
  kit.box(S + 0.02, 0.012, 0.012, frameC, { pos: [S / 2, S + 0.006, 0.006], parent: field });   // gold frame
  kit.box(S + 0.02, 0.012, 0.012, frameC, { pos: [S / 2, -0.006, 0.006], parent: field });
  kit.box(0.012, S, 0.012, frameC, { pos: [-0.006, S / 2, 0.006], parent: field });
  kit.box(0.012, S, 0.012, frameC, { pos: [S + 0.006, S / 2, 0.006], parent: field });
  const glass = kit.glass({ w: S, h: S, d: 0.008, tint: 0xbfe0ff, opacity: 0.12 });
  glass.position.set(S / 2, S / 2, 0.02);
  field.add(glass);

  // nails: one InstancedMesh of tetrahedra on the lane nodes (hidden under the LCD)
  const pins = LANE_NODES.filter((n) => !underLcd(n.x, n.y));
  const nailGeo = new THREE.TetrahedronGeometry(0.0048, 0);
  const nailMat = kit.mat(0xffffff);
  const nails = new THREE.InstancedMesh(nailGeo, nailMat, pins.length);
  const m4 = new THREE.Matrix4();
  pins.forEach((n, i) => { m4.makeTranslation(n.x, n.y, 0.004); nails.setMatrixAt(i, m4); });
  nails.instanceMatrix.needsUpdate = true;
  field.add(nails);

  // start pocket, electric chu-lip, tulips, attacker, windmills
  const sp = POCKET_DEFS.START.pos, ec = POCKET_DEFS.ECHU.pos;
  const startPocket = kit.cyl(0.013, 0.013, 0.004, 0x222222, { pos: [sp[0], sp[1], 0.003], rot: [90, 0, 0], seg: 8, parent: field });
  const eChu = new THREE.Object3D();
  eChu.position.set(ec[0], ec[1] + 0.012, 0.006);
  field.add(eChu);
  for (const sx of [-1, 1]) kit.box(0.012, 0.004, 0.008, PINK, { pos: [sx * 0.012, 0, 0], parent: eChu, rot: [0, 0, sx * 25] });
  const tulipL = new THREE.Object3D(), tulipR = new THREE.Object3D();
  const tp = POCKET_DEFS.TULIP_L.pos, tr = POCKET_DEFS.TULIP_R.pos;
  tulipL.position.set(tp[0], tp[1], 0.006); tulipR.position.set(tr[0], tr[1], 0.006);
  field.add(tulipL, tulipR);
  for (const t of [tulipL, tulipR]) {
    for (const sx of [-1, 1]) kit.plane(0.018, 0.02, PINK, { pos: [sx * 0.009, 0.01, 0], parent: t, rot: [0, 0, sx * -35], shade: false });
  }
  const attacker = new THREE.Object3D();
  const ap = POCKET_DEFS.ATTACKER.pos;
  attacker.position.set(ap[0] - 0.04, ap[1] + 0.02, 0.006);
  field.add(attacker);
  kit.box(0.08, 0.02, 0.004, 0xffd000, { pos: [0.04, 0.01, 0], parent: attacker });               // hinged plate
  for (let i = 0; i < 4; i++) kit.cyl(0.006, 0.006, 0.004, 0xffffff, { pos: [0.01 + i * 0.018, 0.024, 0.004], rot: [90, 0, 0], seg: 3, parent: field });
  const windmills: [THREE.Object3D, THREE.Object3D] = [new THREE.Object3D(), new THREE.Object3D()];
  [[0.12, 0.25], [0.36, 0.25]].forEach(([x, y], i) => {
    windmills[i].position.set(x, y, 0.006);
    field.add(windmills[i]);
    kit.box(0.04, 0.004, 0.003, 0xe8c060, { parent: windmills[i] });
    kit.box(0.004, 0.04, 0.003, 0xe8c060, { parent: windmills[i] });
  });

  // LCD (160×120 in the gold frame), hold lamps under it, ball pool
  const lcd = kit.screen({ w: LCD.w, h: LCD.h, px: [160, 120], bezel: frameC });
  lcd.mesh.position.set(LCD.x, LCD.y, 0.012);
  field.add(lcd.mesh);
  const holdLamps = [0, 1, 2, 3].map((i) => {
    const l = kit.lamp({ r: 0.006, color: PINK, shape: 'dome' });
    l.root.position.set(LCD.x - 0.045 + i * 0.03, LCD.y - LCD.h / 2 - 0.012, 0.01);
    field.add(l.root);
    return l;
  }) as [LampPart, LampPart, LampPart, LampPart];
  const balls = kit.balls({ max: 64, r: 0.0055, color: STEEL, metal: true });
  field.add(balls.root);

  // handle (chrome dial) and trays / jar / strip / stool
  const handle = new THREE.Object3D();
  handle.position.set(0.24, 0.84, cabZ + 0.16);
  root.add(handle);
  kit.cyl(0.035, 0.035, 0.02, pal.chrome, { pos: [0, 0, 0], rot: [90, 0, 0], seg: 10, parent: handle });
  kit.box(0.005, 0.03, 0.006, pal.black, { pos: [0, 0.015, 0.012], parent: handle });
  const trays = { upper: new THREE.Object3D(), lower: new THREE.Object3D() };
  trays.upper.position.set(0.16, 0.79, cabZ + 0.13);
  trays.lower.position.set(0.16, 0.75, cabZ + 0.12);
  root.add(trays.upper, trays.lower);
  const jar = new THREE.Object3D();
  jar.position.set(0.2, 0.7, cabZ + 0.12);
  root.add(jar);
  kit.cyl(0.03, 0.03, 0.06, 0xcfd8e0, { pos: [0, 0.04, 0], seg: 8, parent: jar });
  const ledStrips = new THREE.Object3D();
  ledStrips.position.set(0, 0.7, cabZ + CAB.d / 2);
  root.add(ledStrips);
  kit.box(0.5, 0.005, 0.004, PINK, { parent: ledStrips });
  const stool = kit.stool({ h: 0.62 });
  stool.position.set(0, 0, 0.26);      // spokes reach z 0.52: inside the M footprint's half-depth (+ lint eps)
  root.add(stool);

  // light hint + speaker and coin anchors
  const light = new THREE.Object3D();
  light.position.set(0, 1.42, 0.40);   // seat-views: soft key in front of the field
  light.userData = { color: 0xb8d4ff, intensity: 1.0, range: 1.8, flicker: 'STEADY' };
  root.add(light);
  const speaker = new THREE.Object3D();
  speaker.position.set(0, 1.3, cabZ + 0.2);
  root.add(speaker);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.56, cabZ + 0.2);
  root.add(prompt);
  const label = new THREE.Object3D();
  label.position.set(0, 1.59, cabZ + 0.15);
  root.add(label);
  const marqueeTop = new THREE.Object3D();
  marqueeTop.position.set(0, FRAME.h, frameZ);
  root.add(marqueeTop);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(-0.22, 0.85, cabZ + 0.16);
  root.add(servicePlate);
  const stand = new THREE.Object3D();
  stand.position.set(0, 0, 0.6);
  root.add(stand);
  const coinOut = new THREE.Object3D();
  coinOut.position.set(0.16, 0.77, cabZ + 0.13);
  root.add(coinOut);

  const parts: PachinkoParts = {
    field, balls, tulips: [tulipL, tulipR], windmills, startPocket, eChu, attacker,
    screens: { lcd }, holdLamps, handle, trays, jar, ledStrips, stool,
  };
  kit.finalize(root, {
    keep: [field, balls.root, tulipL, tulipR, eChu, attacker, windmills[0], windmills[1], lcd.mesh, handle,
      ...holdLamps.map((l) => l.root), light],
  });

  return {
    root,
    parts,
    // seat-views: the tilted 0.48 m field (centre ~y 1.30, z -0.04) fills the band between the HUD banner and the control bar, 4:3 and 16:9
    playPose: { pos: new THREE.Vector3(0, 1.43, 0.75), look: new THREE.Vector3(0, 1.27, -0.03), fov: 52, mouse: 'primary' },
    colliders: [{ min: [-FRAME.w / 2, 0, -0.375], max: [FRAME.w / 2, FRAME.h, 0.075] }],
    interact: { min: [-FRAME.w / 2, 0.6, -0.4], max: [FRAME.w / 2, FRAME.h, 0.2] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light },
    dispose: () => lcd.dispose(),
  };
}

