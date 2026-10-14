/**
 * Put-and-Take Top (`teetotum`) — procedural model (TableBase party table, 6 seats, slot BOI-04, L footprint).
 *
 * A round baize table (Ø 1.20, shifted to z −0.15 to fit the L slot) with six stools on the front 220° arc, a brass pot
 * bowl in the centre and, beside it, the 0.18 m brass eight-sided spinning top. The top is a Group of (yaw → tilt →
 * body): the yaw spins it upright, the tilt lays it on its side so the chosen face ends up on top. Its open 8-sided
 * body carries the pictogram strip (256 × 32 canvas, one 32 px column per face; face i = column i). Pot chips sit
 * heaped in the bowl, every seat has a chip anchor, a turn lamp and a small rail meter. House mannequins (patrons) sit
 * on the stools and wait for a bot. Metres, origin = floor centre, +Z = the front (the players' side).
 */
import * as THREE from 'three';
import type { ChipPool, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { V3 } from '@/core/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { FACES, SEATS, type Face } from './rules';

const FELT = 0x1f6040;   // baize green: the playfield the top and the bowl sit on, read from the seat
const TABLE_D = 1.2;
/** Table centre (machine-local z): the table is pushed back to fit the L slot. */
export const CENTRE_Z = -0.25;
const TOP_R = 0.09;
const TOP_H = 0.12;
const STOOL_H = 0.68;
const STOOL_R = 0.85;
const LAMP_OFF = 0x2a2a2a;
const LAMP_ON = 0xffd040;
const FACE_PX = 32;
const STRIP_W = 256, STRIP_H = 32;
/** Each face's pictogram: a rail arrow (put = down into the bowl, take = up out of it) plus a language-free glyph. */
export const GLYPH: Record<Face, string> = { p1: '+1', p2: '+2', pa: '+*', m1: '-1', m2: '-2', half: '½', all: '*', none: '∅' };
const PUT_FACES: readonly Face[] = ['p1', 'p2', 'pa'];

export type TeetotumParts = {
  /** Spinning top (Group): yaw → tilt → body. Spin = yaw, fall = tilt to 90° with the chosen face up. */
  top: THREE.Group;
  topYaw: THREE.Group;
  topTilt: THREE.Group;
  /** The open 8-sided body with the pictogram strip (face i = texture column i). */
  topFaces: THREE.Mesh;
  /** Pot bowl (brass lathe) in the centre of the felt. */
  potBowl: THREE.Object3D;
  /** Chips heaped in the bowl (pool of 120; the pile shows at most 60). */
  potChips: ChipPool;
  /** Per-seat chip anchors on the felt (where a seat's stake and winnings stack). */
  stacks: THREE.Object3D[];
  /** Turn lamp per seat (brass-caged dome). */
  turnLamps: LampPart[];
  /** Rail meter per seat: stake / won, flat on the rail in front of the seat. */
  railMeters: ScreenSurface[];
  /** Stool per seat (0.68 m). */
  stools: THREE.Group[];
  /** Anchors where the coder seats patron bots (same spots as the stools). */
  botSeats: THREE.Object3D[];
  /** House mannequins with jerky wooden hands (15 fps), hidden until a bot takes the seat. */
  bots: MannequinActor[];
  /** Brass placard on the back wall explaining the eight faces. */
  legend: THREE.Group;
  /** Bare bulbs on cords over the table (Boiler style). */
  pendant: THREE.Group;
  /** Status screen on the back wall: phase, pot, ante. */
  screen: ScreenSurface;
  /** Invisible pick box over the top (LMB on the top spins it). */
  picks: THREE.Mesh[];
  /** Gold glow over the bowl, shown while a golden face is in play (L50). */
  goldGlow: THREE.Sprite;
  /** Stool positions (machine-local, y = 0). */
  seatPos: THREE.Vector3[];
  /** Centre of the felt (y = felt height): the bowl sits here. */
  centre: THREE.Vector3;
  /** Rest position of the top (y = felt height). */
  topPos: THREE.Vector3;
  feltY: number;
};

/** Stool position of seat `s` on the front 220° arc (φ from −110° to +110°, seat 0 on the left). */
export function seatOffset(s: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(-110 + s * 44);
  return new THREE.Vector3(STOOL_R * Math.sin(phi), 0, STOOL_R * Math.cos(phi));
}

/** Angle of face `i`'s centre on the body (the face normal is (sin, 0, cos)). */
export function faceAngle(i: number): number {
  return ((i + 0.5) / FACES.length) * Math.PI * 2;
}
/** Yaw that puts face `f` on top once the body is laid on its side (tilt +90° about Z). */
export function faceYaw(f: Face): number {
  return Math.PI / 2 - faceAngle(FACES.indexOf(f));
}

/** Draw the 8-face pictogram strip. Put faces point down (into the bowl), take faces point up (out of it). */
function drawStrip(g: CanvasRenderingContext2D): void {
  FACES.forEach((f, i) => {
    const x0 = i * FACE_PX;
    g.fillStyle = PUT_FACES.includes(f) ? '#7a1f16' : f === 'none' ? '#3a3a34' : '#1d4a34';
    g.fillRect(x0, 0, FACE_PX, STRIP_H);
    g.strokeStyle = '#d4af37'; g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, 0.5, FACE_PX - 1, STRIP_H - 1);
    // rail arrow: down-triangle = put (into the bowl), up-triangle = take (out of it), a bar for the rest
    g.fillStyle = '#f2e3b0';
    g.beginPath();
    const cx = x0 + FACE_PX / 2;
    if (PUT_FACES.includes(f)) { g.moveTo(cx - 4, 3); g.lineTo(cx + 4, 3); g.lineTo(cx, 9); }
    else if (f === 'none') { g.fillRect(cx - 4, 5, 8, 2); }
    else { g.moveTo(cx - 4, 9); g.lineTo(cx + 4, 9); g.lineTo(cx, 3); }
    g.fill();
    g.fillStyle = '#f7ecc4';
    g.font = 'bold 15px monospace';
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(GLYPH[f], cx, STRIP_H - 4);
  });
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<TeetotumParts> {
  void o;
  const { pal } = kit;
  const root = kit.group('teetotum');
  const brass = pal.brass;
  const centre = new THREE.Vector3(0, 0, CENTRE_Z);

  // round felt table (kit), pushed back to the L slot's centre; its colliders are moved to match
  const centre0 = new THREE.Vector3(0, 0, CENTRE_Z);
  const ft = kit.feltTable({ shape: 'round', w: 1.2, d: TABLE_D, felt: FELT, rail: pal.woodDark, seats: SEATS, stools: false, dealer: false });
  ft.root.position.z = CENTRE_Z;
  // the kit's red casino chairs sit on the rail, between the seated camera and the bowl: drop them (our stools and seated bots are the seats)
  const kitChairs: THREE.Object3D[] = [];
  ft.root.traverse((o) => { if (o.name === 'chair') kitChairs.push(o); });
  for (const c of kitChairs) c.parent?.remove(c);
  root.add(ft.root);
  const feltY = ft.feltY;
  // the playfield: the kit's felt ring is sized for seats outside the rail (w − 2 × 0.64 m), which leaves a 1.2 m table a
  // stub. The baize is laid here as a disc, so the surface the spinning top lands on is the one in the seat view.
  const playfield = kit.cyl(0.58, 0.58, 0.012, FELT, { pos: [centre0.x, feltY - 0.004, centre0.z], seg: 40, parent: root, name: 'playfield' });
  void playfield;
  const colliders = ft.colliders.map((b) => ({ min: [b.min[0], b.min[1], b.min[2] + CENTRE_Z] as [number, number, number], max: [b.max[0], b.max[1], b.max[2] + CENTRE_Z] as [number, number, number], tag: b.tag }));
  const c3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(centre.x + x, feltY + y, centre.z + z);

  // stools, seat anchors and the play poses (camera at the seat's own x, looking at the bowl)
  const seatPos: THREE.Vector3[] = [];
  const stools: THREE.Group[] = [];
  const seats: SeatDef[] = [];
  const botSeats: THREE.Object3D[] = [];
  for (let s = 0; s < SEATS; s++) {
    const off = seatOffset(s);
    const p = new THREE.Vector3(centre.x + off.x, 0, centre.z + off.z);
    seatPos.push(p);
    // dark leather seats: the near stools no longer read as big red foreground masses in the seat view
    const stool = kit.stool({ h: STOOL_H, seat: 0x3a2418 });
    stool.position.copy(p);
    root.add(stool);
    stools.push(stool);
    const anchor = new THREE.Object3D();
    anchor.position.copy(p);
    root.add(anchor);
    botSeats.push(anchor);
    seats.push({
      pose: {
        // seat standard: felt, spinning top and the status screen in frame; the seat stools and red seat pads sit below the frame
        pos: new THREE.Vector3(0, 1.8, 1.5),
        look: new THREE.Vector3(centre.x, 0.85, CENTRE_Z),
        fov: 60,
        mouse: 'pick',
      },
      stand: new THREE.Vector3(p.x, 0, p.z),
      avatar: 'sit',
      standY: STOOL_H,
    });
  }

  // bowl, top and pot chips
  const bowl = kit.lathe([[0.001, 0], [0.10, 0.0], [0.15, 0.04], [0.16, 0.08], [0.155, 0.085]], 8, brass, { pos: [centre.x, feltY, centre.z] });
  root.add(bowl);
  // pool sized for the bowl pile (repaint caps it at 60) plus in-flight chips; each chip instance costs 48 tris
  const potChips = kit.chips({ max: 120 });
  root.add(potChips.root);

  const top = new THREE.Group();
  top.name = 'top';
  const topPos = c3(0.3, 0, 0);
  const topTilt = new THREE.Group();
  topTilt.position.set(topPos.x, feltY + TOP_R, topPos.z);
  const topYaw = new THREE.Group();
  topTilt.add(topYaw);
  top.add(topTilt);
  root.add(top);
  // the face strip is a kit screen's canvas (never mounted): 256 × 32, one 32 px column per face
  const strip = kit.screen({ w: TOP_R * 2, h: TOP_H, px: [STRIP_W, STRIP_H] });
  strip.mesh.visible = false;
  strip.draw((g) => drawStrip(g));
  const stripTex = strip.tex;
  stripTex.colorSpace = THREE.NoColorSpace;
  stripTex.magFilter = THREE.NearestFilter;
  stripTex.minFilter = THREE.NearestFilter;
  const stripMat = new THREE.MeshLambertMaterial({ map: stripTex });
  const topFaces = kit.cyl(TOP_R, TOP_R, TOP_H, stripMat, { seg: FACES.length, open: true, pos: [0, 0, 0] });
  topFaces.name = 'topFaces';
  topYaw.add(topFaces);
  const capTop = kit.cyl(0.035, TOP_R, 0.03, brass, { pos: [0, TOP_H / 2 + 0.015, 0], seg: 8 });
  const capBot = kit.cyl(TOP_R, 0.02, 0.02, brass, { pos: [0, -TOP_H / 2 - 0.01, 0], seg: 8 });
  const stem = kit.cyl(0.008, 0.008, 0.05, brass, { pos: [0, TOP_H / 2 + 0.05, 0], seg: 6 });
  topYaw.add(capTop, capBot, stem);
  // the top starts upright, its tip just above the felt
  topTilt.rotation.z = 0;

  // pick box over the top (raycast target only)
  const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pick = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.26), pickMat);
  pick.name = 'pickTop';
  pick.position.set(topPos.x, feltY + 0.1, topPos.z);
  root.add(pick);
  const picks = [pick];

  // golden glow above the bowl (L50 golden face)
  const goldGlow = kit.glow({ color: 0xffc83d, size: 0.5, intensity: 0 });
  goldGlow.position.set(centre.x, feltY + 0.22, centre.z);
  goldGlow.visible = false;
  root.add(goldGlow);

  // chip anchors and turn lamps on the rim; rail meters flat on the rail
  const stacks: THREE.Object3D[] = [];
  const turnLamps: LampPart[] = [];
  const railMeters: ScreenSurface[] = [];
  for (let s = 0; s < SEATS; s++) {
    const off = seatOffset(s).normalize();
    const st = new THREE.Object3D();
    st.position.copy(c3(off.x * 0.42, 0, off.z * 0.42));
    root.add(st);
    stacks.push(st);
    const lamp = kit.lamp({ r: 0.018, color: LAMP_OFF, shape: 'dome' });
    lamp.root.position.copy(c3(off.x * 0.5, 0, off.z * 0.5));
    root.add(lamp.root);
    turnLamps.push(lamp);
    const meter = kit.screen({ w: 0.1, h: 0.04, px: [96, 40], bezel: pal.black, glow: 0.3 });
    meter.mesh.rotation.x = -Math.PI / 2;
    meter.mesh.position.copy(c3(off.x * 0.7, 0.003, off.z * 0.7));
    root.add(meter.mesh);
    railMeters.push(meter);
  }

  // back wall: status screen, label, legend placard
  const screen = kit.screen({ w: 0.36, h: 0.14, px: [192, 72], bezel: pal.black, glow: 0.6 });
  screen.mesh.position.set(0, 1.42, -0.86);
  root.add(screen.mesh);
  const label = kit.label({ text: { key: 'm.teetotum.name' }, w: 0.4, h: 0.08, px: [256, 48], color: pal.gold, bg: pal.black });
  label.mesh.position.set(0, 1.62, -0.86);
  root.add(label.mesh);
  const legend = kit.plaque({ text: { key: 'm.teetotum.legend' }, w: 0.42, h: 0.12, color: brass });
  legend.position.set(0, 1.0, -0.86);
  root.add(legend);

  // pendant: three bare bulbs on cords over the table
  const pendant = new THREE.Group();
  pendant.name = 'pendant';
  for (const x of [-0.42, 0, 0.42]) {
    const bulb = kit.sphere(0.035, pal.cream, { pos: [centre.x + x, 1.55, centre.z] });
    pendant.add(bulb);
    const cord: V3[] = [[centre.x + x, 2.0, centre.z], [centre.x + x, 1.6, centre.z]];
    pendant.add(kit.tube(cord, 0.004, pal.black));
  }
  root.add(pendant);

  // house mannequins: patrons on the stools, hidden until a bot takes the seat
  const bots: MannequinActor[] = seatPos.map((p, s) => {
    const m = kit.mannequin({ style: 'plain', color: [0x2a1a14, 0x3a2a1e, 0x1e2a33, 0x2d1f2f, 0x3d2a10, 0x202a20][s % 6], jointColor: 0x3a3a3a, height: 1.7, clip: 'Sitting_Idle_Loop' });
    m.root.position.set(p.x, STOOL_H, p.z);
    m.root.rotation.y = Math.atan2(-p.x, -(p.z - centre.z));
    m.setStepFps(15);
    m.setVisible(false);
    root.add(m.root);
    return m;
  });

  // light, anchors
  const light = new THREE.Object3D();
  light.position.set(0, 1.6, centre.z);   // lower and stronger: the felt and the bowl need to read from the seat
  light.userData = { color: 0xffe2a0, intensity: 2.2, range: 2.6, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, 0.6);
  root.add(prompt);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.62, -0.86);
  root.add(labelAnchor);
  const marqueeTop = new THREE.Object3D();
  marqueeTop.position.set(0, 1.78, -0.86);
  root.add(marqueeTop);
  const coinOut = new THREE.Object3D();
  coinOut.position.set(centre.x, feltY + 0.12, centre.z);
  root.add(coinOut);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(0.5, 0.9, -0.86);
  root.add(servicePlate);

  // static geometry merges per material; the spinning top, pot bowl, stools, pot chips and raycast pick stay live
  kit.finalize(root, { keep: [top, bowl, pick, potChips.root, ...stools] });

  const parts: TeetotumParts = {
    top, topYaw, topTilt, topFaces, potBowl: bowl, potChips, stacks, turnLamps, railMeters, stools, botSeats, bots,
    legend, pendant, screen, picks, goldGlow, seatPos, centre, topPos, feltY,
  };
  return {
    root,
    parts,
    playPose: seats[0].pose,
    seats,
    colliders: [...colliders],
    interact: { min: [-1.2, 0.2, -1.0], max: [1.2, 1.6, 0.95] },
    anchors: { speaker: prompt, prompt, label: labelAnchor, marqueeTop, servicePlate, coinOut, light },
    dispose: () => { screen.dispose(); railMeters.forEach((m) => m.dispose()); strip.dispose(); pickMat.dispose(); },
  };
}

/** Lamp colours (turn lamp off / on). */
export const LAMP = { off: LAMP_OFF, on: LAMP_ON } as const;
