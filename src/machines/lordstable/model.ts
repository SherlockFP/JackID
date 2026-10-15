/**
 * The Lords' Table: procedural model (Hollow Door, the Underneath). Owner: lordstable.
 *  - `buildModel(kit, o)` returns the `MachineModel`; `LordsParts` is the contract with `index.ts`.
 *  - Metres, origin = floor centre, +Z = the player's side, Y up. Footprint 2.60 W × 1.80 D, height 2.60.
 *
 * A long low table in a void room under one hanging lamp. The player sits at +Z. Three DARK LORDS stand at the far side
 * (−Z), each a dealer in the 'devil' style scaled 1.6×. The chosen Lord steps forward and points; the others bow back.
 * The revolver lies on the felt: its cylinder turns with the hammer (`cylinder.rotation.z`) and its hammer cocks on a pull.
 */
import * as THREE from 'three';
import type { DealerPart, Kit, ScreenSurface } from '@/kit/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.78;                          // table top, m
export const LORD_SCALE = 1.6;
/** Lord stands on the far side, in order of the three Lords: ash, ledgers, mirrors (x = −1.3, 0, 1.3). */
export const LORD_X: readonly number[] = [-1.3, 0, 1.3];
export const LORD_Z = -0.72;
/** The revolver's size on the felt (1.5x the bench model, so it reads from the seat). */
export const GUN_SCALE = 1.5;
/** Chamber angle step of the cylinder, radians (six chambers). */
export const CHAMBER_STEP = Math.PI / 3;

export interface LordsParts {
  lords: DealerPart[];                    // 0 = ash, 1 = ledgers, 2 = mirrors
  gun: THREE.Group;                       // the revolver (lies across the felt in front of the player)
  cylinder: THREE.Object3D;               // turns about the barrel axis; rotation.z = chamber × CHAMBER_STEP
  hammer: THREE.Object3D;                 // cocks (rotation.x) before a pull
  screen: ScreenSurface;                  // readout on the table's edge: tickets, bullets, last clicks
  speaker: THREE.Object3D;                // the player's side, positional voice
  lordStand: THREE.Object3D[];            // the three stand anchors (cut-ins line up on these)
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<LordsParts> {
  const { pal } = kit;
  const root = kit.group('lordstable');
  const wood = o.variant % 2 ? pal.woodDark : 0x1a0e0c;

  // the void: a dark floor disc and one lamp
  kit.cyl(1.5, 1.5, 0.03, { color: pal.black, map: kit.tex.felt(pal.feltDark) }, { pos: [0, 0.015, 0], seg: 24, parent: root });

  // the table: a long low box with a felt top, and four legs
  kit.box(2.2, 0.06, 0.9, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, TOP - 0.03, 0], parent: root });
  kit.box(2.1, 0.02, 0.8, { color: pal.feltDark, map: kit.tex.felt(pal.feltDark) }, { pos: [0, TOP + 0.005, 0], parent: root });
  for (const [x, z] of [[-1.0, -0.38], [1.0, -0.38], [-1.0, 0.38], [1.0, 0.38]]) {
    kit.box(0.07, TOP - 0.06, 0.07, { color: wood, map: kit.tex.wood(wood) }, { pos: [x, (TOP - 0.06) / 2, z], parent: root });
  }

  // the revolver: barrel, frame, cylinder with six chamber bores, hammer. Old and tarnished (dull steel, dark brass, worn
  // grip), lying across the felt in front of the player's seat, at 1.5x so it reads from the seat.
  const steel = 0x4a4640, brass = 0x7a5c2e, bore = 0x060404;
  const gun = new THREE.Group();
  gun.position.set(0, TOP + 0.02, 0.12);
  gun.scale.setScalar(GUN_SCALE);
  gun.rotation.y = Math.PI / 2;           // lies across the felt, so its profile reads from the seat
  root.add(gun);
  kit.box(0.09, 0.07, 0.2, steel, { pos: [0, 0.035, -0.06], parent: gun });
  kit.cyl(0.018, 0.018, 0.24, steel, { pos: [0, 0.05, -0.26], rot: [90, 0, 0], seg: 8, parent: gun });
  kit.box(0.05, 0.1, 0.07, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, -0.02, 0.07], rot: [12, 0, 0], parent: gun });
  const cylinder = new THREE.Group();
  cylinder.position.set(0, 0.05, -0.04);
  gun.add(cylinder);
  kit.cyl(0.05, 0.05, 0.05, brass, { rot: [90, 0, 0], seg: 12, parent: cylinder });
  for (let i = 0; i < 6; i++) {
    const a = i * CHAMBER_STEP;
    kit.cyl(0.011, 0.011, 0.052, bore, { pos: [Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0], rot: [90, 0, 0], seg: 6, parent: cylinder });
  }
  const hammer = kit.box(0.02, 0.03, 0.02, brass, { pos: [0, 0.09, 0.05], parent: gun });

  // the light over the table: the room's cone shade is the lamp (see world/hollow), this is its glow on the felt
  const light = new THREE.Object3D();
  light.position.set(0, 1.9, 0);
  light.userData = { color: 0xffd9a0, intensity: 0.7, range: 3.2, flicker: 'CANDLE' };
  root.add(light);

  // a red rim light behind the Lords: it draws their silhouettes off the dark wall
  const rim = new THREE.Object3D();
  rim.position.set(0, 1.9, LORD_Z - 0.9);
  rim.userData = { color: 0xff2a1a, intensity: 1.1, range: 3.4, flicker: 'STEADY' };
  root.add(rim);

  // the readout on the table's near edge
  const screen = kit.screen({ w: 0.42, h: 0.14, px: [336, 112], bezel: pal.black, glow: 0.8, scanlines: true });
  screen.mesh.position.set(0, TOP + 0.09, 0.4);
  screen.mesh.rotation.x = -0.6;
  root.add(screen.mesh);

  // the three Lords on the far side (dealer 'devil', scaled 1.6×)
  const lords: DealerPart[] = [];
  const lordStand: THREE.Object3D[] = [];
  LORD_X.forEach((x, i) => {
    const d = kit.dealer({ style: 'devil', height: 1.7, feltY: TOP, suit: 0x17151c, skin: 0x8c8782 });
    d.root.position.set(x, 0, LORD_Z);
    d.root.scale.setScalar(LORD_SCALE);
    root.add(d.root);
    lords.push(d);
    const stand = new THREE.Object3D();
    stand.position.set(x, 0, LORD_Z + 0.22);
    stand.name = `lordStand${i}`;
    root.add(stand);
    lordStand.push(stand);
  });

  // the player's speaker sits on the near edge; the seats are at +Z (player) and −Z (the Lord)
  const speaker = new THREE.Object3D();
  speaker.position.set(0, 1.3, 0.85);
  root.add(speaker);

  root.add(kit.blobShadow(2.2, 1.6));

  const parts: LordsParts = { lords, gun, cylinder, hammer, screen, speaker, lordStand };
  kit.finalize(root, {
    keep: [gun, cylinder, hammer, light, rim, screen.mesh, ...lords.map((d) => d.root)],
  });

  const seats: SeatDef[] = [
    {
      pose: {
        pos: new THREE.Vector3(0, 1.45, 1.8),
        look: new THREE.Vector3(0, TOP + 0.05, -0.25),
        fov: 55,
        mouse: 'primary',
      },
      stand: new THREE.Vector3(0, 0, 1.0),
      avatar: 'sit',
    },
    {
      pose: {
        pos: new THREE.Vector3(0, 1.5, -1.35),
        look: new THREE.Vector3(0, TOP, 0.1),
        fov: 55,
        mouse: 'primary',
      },
      stand: new THREE.Vector3(0, 0, -1.0),
      avatar: 'sit',
    },
  ];

  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-1.1, 0, -0.45], max: [1.1, TOP + 0.02, 0.45] },
      ...LORD_X.map((x) => ({ min: [x - 0.35, 0, -0.9] as [number, number, number], max: [x + 0.35, 1.8, -0.55] as [number, number, number] })),
    ],
    interact: { min: [-1.3, 0.2, -0.9], max: [1.3, 1.4, 0.9] },
    anchors: {
      speaker: speaker, prompt: speaker, label: screen.mesh, light, light2: rim, marqueeTop: light,
      lordStand0: lordStand[0], lordStand1: lordStand[1], lordStand2: lordStand[2],
    },
    dispose: () => screen.dispose(),
  };
}
