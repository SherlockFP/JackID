/**
 * Bingo Pinball "Tombala Langırtı" (`bingopin`) — procedural model (MACHINES_machines §18 cabinet + plan.json modelBrief).
 *
 * Origin = floor centre of the footprint, +Z = player side. The cabinet stands on chrome legs with its playfield at 0.85 m
 * at the front, inclined 6.5° (rising to the back). The playfield is a Group (`parts.field`) in FIELD coordinates: origin =
 * front-left corner on the table surface, X right, Y up the table toward the backglass, Z = table normal. The backbox rises
 * to 1.90 m behind the playfield and carries the 5 × 5 card on a ScreenSurface, EXTRA BALL and TILT lamps and a price wheel.
 *
 * `holePos(h)` and `LANE` are the single source of hole and rail positions: the coder's path generator and the nudge
 * anchors read them, so the picture and the logic cannot drift apart.
 *
 * BUDGET: ≤ 1 300 tris, ≤ 14 draw calls (static shell merges; animated parts are listed in `keep`).
 */
import * as THREE from 'three';
import type { Kit, BallPool, LampPart, ButtonPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

/** Contract between modeler and coder. Field coordinates are playfield-local (metres). */
export type BingoParts = {
  /** Tilted playfield group (FIELD coordinates). */
  field: THREE.Object3D;
  /** Ball pool (8) in field coordinates; a ball sits at z = BALL_R. */
  balls: BallPool;
  /** 25 hole anchors (where a ball settles), field coordinates, index = hole 0..24 (number h + 1). */
  holes: THREE.Object3D[];
  /** 25 emissive rings, one per hole (lit when its number is drawn). */
  holeLamps: LampPart[];
  /** Red rubber bumper posts (InstancedMesh, 6 instances). */
  bumpers: THREE.InstancedMesh;
  /** Backglass 128 × 128: the scrambled 5 × 5 card. */
  backglass: ScreenSurface;
  /** Backglass lamps. */
  lamps: { extraBall: LampPart; tilt: LampPart };
  /** Ratchet price wheel (Group rotating about X) and its 3-digit LED. */
  priceWheel: THREE.Object3D;
  leds: { price: ScreenSurface; credit: LampPart; bet: LampPart; win: LampPart };
  /** Plunger (Group translating along field −Y, 0–0.06 m pull) at the bottom-right lane. */
  plunger: THREE.Object3D;
  buttons: { lift: ButtonPart };
  /** Low stool in front of the cabinet. */
  stool: THREE.Object3D;
};

export const BALL_R = 0.012;
export const CAB = { w: 0.75, d: 1.40, legH: 0.25, bodyTop: 0.85, backZ: -0.52, frontZ: 0.70 };
/** Playfield: 0.62 wide, 0.95 long, front edge at z 0.62 on the table at y 0.85, inclined 6.5°. */
export const FIELD = { w: 0.62, len: 0.95, x0: -0.31, y0: 0.85, z0: 0.62, tilt: 6.5 * Math.PI / 180 };
export const HOLE_R = 0.015;
export const PLUNGER_X = 0.59;
const IVORY = 0xf0e8d0, WOOD = 0x5a3a22, RUBBER = 0xe02020, GOLD = 0xffd040, LAMP = 0xffd040, AMBER = 0xffa020, TILT_RED = 0xff3030;
const CHROME = 0xd8dce0, GLOW_TEAL = 0x0e5e5e;

/** Hole h → field (x, y). Row-major from the top (back) row: rows 0–4, five holes per row, odd rows staggered by half a pitch. */
export function holePos(h: number): [number, number] {
  const r = Math.floor(h / 5), c = h % 5;
  const x = r % 2 === 0 ? 0.07 + c * 0.095 : 0.117 + c * 0.095;
  const y = 0.86 - r * 0.09;
  return [+x.toFixed(4), +y.toFixed(4)];
}

/** Rail and lane data for the coder (field coordinates). Plunger lane is the right rail; posts are the bumper centres. */
export const LANE = {
  railX: 0.545,                       // inner edge of the plunger lane
  launch: [0.59, 0.07] as [number, number],
  posts: [[0.12, 0.34], [0.26, 0.37], [0.40, 0.31], [0.20, 0.24], [0.34, 0.22], [0.07, 0.42]] as Array<[number, number]>,
};

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<BingoParts> {
  const { pal } = kit;
  const trim = o.variant % 2 === 0 ? pal.chrome : pal.gold;   // chrome or brass trim (ART: rows should not look identical)
  const root = kit.group('bingopin');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merges into one draw) ──
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    kit.cyl(0.018, 0.018, CAB.legH, pal.chrome, at(sx * (CAB.w / 2 - 0.05), CAB.legH / 2, sz * (CAB.d / 2 - 0.12)));
  }
  const bodyZ = (CAB.backZ + CAB.frontZ) / 2, bodyD = CAB.frontZ - CAB.backZ;
  kit.box(CAB.w, CAB.bodyTop - CAB.legH, bodyD, WOOD, at(0, (CAB.bodyTop + CAB.legH) / 2, bodyZ));          // woodgrain body
  kit.box(CAB.w + 0.02, 0.02, bodyD + 0.02, trim, at(0, CAB.bodyTop + 0.01, bodyZ));                        // chrome top trim
  kit.box(0.02, 0.6, bodyD, pal.chrome, at(-CAB.w / 2 - 0.005, 0.55, bodyZ));                               // side chrome
  kit.box(0.02, 0.6, bodyD, pal.chrome, at(CAB.w / 2 + 0.005, 0.55, bodyZ));

  // backbox: 0.75 × 0.20 × 0.94 rising to 1.90 from the back edge of the playfield
  const backY0 = FIELD.y0 + FIELD.len * Math.sin(FIELD.tilt);
  const backZ = FIELD.z0 - FIELD.len * Math.cos(FIELD.tilt);
  const boxH = 1.9 - backY0;
  kit.box(CAB.w, boxH, 0.2, WOOD, at(0, backY0 + boxH / 2, backZ - 0.1));
  kit.box(CAB.w + 0.02, 0.02, 0.22, trim, at(0, 1.9 - 0.01, backZ - 0.1));                                    // top trim
  kit.box(CAB.w + 0.02, 0.03, 0.02, trim, at(0, backY0 + 0.01, backZ + 0.005));                                // sill
  kit.box(0.1, 0.1, 0.02, GLOW_TEAL, at(0, 1.25, backZ + 0.002));                                              // backglass surround

  // ── playfield (field coordinates; tilted so local Y goes up the table toward the back) ──
  const field = new THREE.Object3D();
  field.position.set(FIELD.x0, FIELD.y0, FIELD.z0);
  field.rotation.x = -Math.PI / 2 + FIELD.tilt;
  root.add(field);
  const W = FIELD.w, L = FIELD.len;
  kit.plane(W, L, IVORY, { pos: [W / 2, L / 2, 0.0], parent: field, shade: false });                          // ivory playfield
  kit.box(W + 0.02, 0.015, 0.02, WOOD, { pos: [W / 2, L + 0.006, 0.01], parent: field });                       // top rail
  kit.box(0.02, L, 0.02, WOOD, { pos: [-0.006, L / 2, 0.01], parent: field });                                  // left rail
  kit.box(0.02, L, 0.02, WOOD, { pos: [W + 0.006, L / 2, 0.01], parent: field });                               // right rail
  kit.box(0.012, L * 0.92, 0.014, pal.chrome, { pos: [LANE.railX, L * 0.46, 0.012], parent: field });            // lane rail
  kit.box(W + 0.02, 0.02, 0.02, WOOD, { pos: [W / 2, -0.006, 0.01], parent: field });                           // front rail
  const glass = kit.glass({ w: W, h: L, d: 0.008, tint: 0xbfe0ff, opacity: 0.12 });
  glass.position.set(W / 2, L / 2, 0.03);
  field.add(glass);

  // holes and their rings
  const holes: THREE.Object3D[] = [];
  const holeLamps: LampPart[] = [];
  for (let h = 0; h < 25; h++) {
    const [x, y] = holePos(h);
    const hole = new THREE.Object3D();
    hole.position.set(x, y, 0.001);
    field.add(hole);
    holes.push(hole);
    kit.cyl(HOLE_R, HOLE_R, 0.002, 0x1a1208, { pos: [x, y, 0.0005], rot: [90, 0, 0], seg: 8, parent: field });
    const lamp = kit.lamp({ r: 0.008, color: LAMP, shape: 'flat' });
    lamp.root.position.set(x, y, 0.002);
    field.add(lamp.root);
    holeLamps.push(lamp);
  }

  // red rubber bumper posts: one InstancedMesh (6 instances)
  const bumpers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 8), kit.mat(RUBBER), LANE.posts.length);
  const m4 = new THREE.Matrix4();
  LANE.posts.forEach(([x, y], i) => { m4.makeTranslation(x, y, 0.012); bumpers.setMatrixAt(i, m4); });
  bumpers.instanceMatrix.needsUpdate = true;
  field.add(bumpers);

  // plunger lane and plunger (translates along −Y when pulled)
  const plunger = new THREE.Object3D();
  plunger.position.set(PLUNGER_X, LANE.launch[1], 0.012);
  field.add(plunger);
  kit.cyl(0.008, 0.008, 0.12, pal.chrome, { pos: [0, 0.06, 0], seg: 8, parent: plunger });
  kit.sphere(0.014, pal.black, { pos: [0, 0.12, 0], parent: plunger });

  // balls in field coordinates
  const balls = kit.balls({ max: 8, r: BALL_R, color: CHROME, metal: true });
  field.add(balls.root);

  // backglass: scrambled card on a 128 × 128 ScreenSurface, lamps above it, the price wheel to the right
  const backglass = kit.screen({ w: 0.56, h: 0.56, px: [128, 128], bezel: trim });
  backglass.mesh.position.set(0, 1.42, backZ + 0.002);
  root.add(backglass.mesh);
  const extraBall = kit.lamp({ r: 0.018, color: AMBER, shape: 'dome' });
  extraBall.root.position.set(-0.2, 1.80, backZ + 0.02);
  root.add(extraBall.root);
  const tilt = kit.lamp({ r: 0.018, color: TILT_RED, shape: 'dome' });
  tilt.root.position.set(0.2, 1.80, backZ + 0.02);
  root.add(tilt.root);
  const priceWheel = new THREE.Object3D();
  priceWheel.position.set(0.26, 1.02, backZ + 0.02);
  root.add(priceWheel);
  kit.cyl(0.04, 0.04, 0.04, pal.chrome, { pos: [0, 0, 0], rot: [0, 0, 90], seg: 12, parent: priceWheel });
  kit.box(0.02, 0.03, 0.02, pal.black, { pos: [0, 0.04, 0], parent: priceWheel });
  const price = kit.screen({ w: 0.12, h: 0.04, px: [48, 16], bezel: pal.black });
  price.mesh.position.set(0.26, 0.96, backZ + 0.02);
  root.add(price.mesh);

  // control panel at the front: lift button and credit / bet / win LEDs
  const credit = kit.lamp({ r: 0.006, color: 0x7dff7a, shape: 'dome' });
  credit.root.position.set(-0.20, 0.84 + 0.005, 0.56);
  root.add(credit.root);
  const bet = kit.lamp({ r: 0.006, color: 0x7dd3ff, shape: 'dome' });
  bet.root.position.set(-0.16, 0.84 + 0.005, 0.56);
  root.add(bet.root);
  const win = kit.lamp({ r: 0.006, color: GOLD, shape: 'dome' });
  win.root.position.set(-0.12, 0.84 + 0.005, 0.56);
  root.add(win.root);
  const lift = kit.button({ shape: 'round', r: 0.018, color: 0xe02020 });
  lift.root.position.set(-0.26, 0.845, 0.52);
  root.add(lift.root);

  // stool in front of the cabinet (outside the collider, in the stand strip)
  const stool = kit.stool({ h: 0.62 });
  stool.position.set(0.62, 0, 0.72);            // beside the cabinet's front-right corner (x clears the side chrome), z keeps the seat inside 0.93
  stool.scale.set(0.8, 1, 0.8); // base spokes stay inside the L slot depth
  root.add(stool);

  // anchors
  const anchors: Record<string, THREE.Object3D> = {};
  const at2 = (name: string, x: number, y: number, z: number): void => {
    const o3 = new THREE.Object3D();
    o3.position.set(x, y, z);
    root.add(o3);
    anchors[name] = o3;
  };
  at2('speaker', 0, 1.30, backZ + 0.02);
  at2('prompt', 0, 1.62, backZ + 0.05);
  at2('label', 0, 1.00, backZ + 0.02);
  at2('marqueeTop', 0, 1.90, backZ);
  at2('servicePlate', -CAB.w / 2 - 0.02, 0.6, bodyZ);
  at2('stand', 0, 0, 0.98);
  at2('coinOut', 0.16, 0.9, 0.56);
  at2('light', 0, 1.42, backZ + 0.25);
  anchors.light.userData = { color: 0xffd040, intensity: 0.5, range: 1.4, flicker: 'STEADY' };

  const parts: BingoParts = {
    field, balls, holes, holeLamps, bumpers, backglass, lamps: { extraBall, tilt }, priceWheel,
    leds: { price, credit, bet, win }, plunger, buttons: { lift }, stool,
  };
  crispTexture(backglass.tex, 4);                              // on-machine text: linear + mips, not nearest
  crispTexture(price.tex, 4);
  kit.finalize(root, {
    keep: [field, balls.root, plunger, priceWheel, backglass.mesh, price.mesh, extraBall.root, tilt.root, lift.root,
      credit.root, bet.root, win.root, ...holeLamps.map((l) => l.root)],
  });

  return {
    root,
    parts,
    // Play pose: 0.60 m above the front of the playfield, pitch −35°, backglass in the top of the frame, FOV 62.
    playPose: { pos: new THREE.Vector3(0, 1.62, 1.90), look: new THREE.Vector3(0, 1.05, -0.50), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-CAB.w / 2, 0, CAB.backZ], max: [CAB.w / 2, 1.9, CAB.frontZ] },
    ],
    interact: { min: [-CAB.w / 2, 0.5, -0.6], max: [CAB.w / 2, 1.9, 0.75] },
    anchors,
    dispose: () => backglass.dispose(),
  };
}
