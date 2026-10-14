/**
 * The Tally Table, procedural model (Wave 25 TALLY, lane A). Metres, origin = floor centre, +Z = the player's side.
 * Footprint L (2.6 x 1.8 x 2.4). Seats: 0 = the player's chair (+Z), 1 = the rival's chair (-Z, a bot mannequin that
 * `index.ts` dresses per rival). A masked Notary stands at the left rail; a tally board on a post shows the round and the
 * stake; three clue lamps (TELL / TABLE / MATH) sit on the rival's rail and light as each channel is seen; a brass seal
 * stamp thumps on a call. The table oddities the clues point at (a cuff glint, a shuddering needle, steam, a spare
 * glint) are anchors the machine fires effects from.
 *
 * Seat view: raised over the player's chair and pitched down so the whole felt disc, the board, the lamps and the rival's
 * hands sit between the HUD top strip and the control bar; the near rail and the chair back fall below the frame.
 */
import * as THREE from 'three';
import type { Kit, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

export const TOP = 0.74
const FELT = 0x2a1a3a
const LAMP_TELL = 0xff42a5, LAMP_TABLE = 0x63e6de, LAMP_MATH = 0xffce5a
export const CHANNEL_COLOR = { tell: LAMP_TELL, table: LAMP_TABLE, math: LAMP_MATH } as const
/** The rival's chair sits at z −0.5: a seated mannequin's bind bounds reach 0.39 m behind its origin, so −0.5 keeps them inside z −0.93. */
const RIVAL_Z = -0.5
const PLAYER_Z = 0.68

export type TallyParts = {
  rival: MannequinActor
  notary: MannequinActor
  board: ScreenSurface
  lamps: { tell: LampPart; table: LampPart; math: LampPart }
  needle: THREE.Object3D
  stamp: THREE.Object3D
  gavel: THREE.Object3D
  seal: THREE.Object3D
  /** Effect anchors for the "table" clues. */
  cuff: THREE.Object3D
  cup: THREE.Object3D
  tray: THREE.Object3D
  rivalHead: THREE.Object3D
  servicePlate: THREE.Object3D
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<TallyParts> {
  const { pal } = kit
  const root = kit.group('tallytable')
  const wood = o.variant % 2 ? pal.woodDark : 0x24140e
  const leather = pal.leather

  // pedestal, octagonal top with a violet-grey felt and a brass rim
  kit.cyl(0.46, 0.5, 0.05, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, 0.025, 0], seg: 10, parent: root })
  kit.cyl(0.14, 0.2, TOP - 0.06, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, (TOP - 0.06) / 2, 0], seg: 10, parent: root })
  kit.cyl(0.62, 0.62, 0.03, { color: FELT, map: kit.tex.felt(FELT) }, { pos: [0, TOP - 0.015, 0], seg: 8, parent: root })
  kit.torus(0.62, 0.025, pal.brass, { pos: [0, TOP, 0], rot: [90, 0, 0], seg: 8, parent: root })

  // chairs: the player's (seat 0) and the rival's (seat 1)
  const seats: SeatDef[] = []
  for (const [i, z] of [PLAYER_Z, RIVAL_Z].entries()) {
    const back = i === 1 ? -1 : 1
    kit.cyl(0.2, 0.2, 0.06, { color: leather }, { pos: [0, 0.47, z], seg: 10, parent: root })
    kit.cyl(0.03, 0.04, 0.45, pal.chrome, { pos: [0, 0.225, z], seg: 6, parent: root })
    kit.box(0.42, 0.55, 0.05, { color: leather }, { pos: [0, 0.8, z + back * 0.2], parent: root })
    seats.push({
      pose: i === 0
        ? {
          // high over the chair, steep look-down; the rival's torso is the far edge of the frame
          pos: new THREE.Vector3(0, 2.3, 1.0),
          look: new THREE.Vector3(0, TOP, 0.02),
          fov: 60,
          mouse: 'primary',
        }
        : { pos: new THREE.Vector3(0, 1.3, RIVAL_Z), look: new THREE.Vector3(0, TOP, 0), fov: 60, mouse: 'primary' },
      stand: new THREE.Vector3(0, 0, z),
      avatar: 'sit',
    })
  }

  // the rival: a seated mannequin; `index.ts` tints it and dresses it per rival
  const rival = kit.mannequin({ style: 'plain', color: 0x2a2a30, jointColor: 0x101014, height: 1.76, clip: 'Sitting_Idle_Loop' })
  rival.root.position.set(0, 0, RIVAL_Z)
  rival.root.userData.lodDetail = true   // the world hides it beyond ~9.5 m (a full mannequin is ~3.7k tris x4 meshes)
  root.add(rival.root)
  const rivalHead = new THREE.Object3D()
  rivalHead.position.set(0, 1.35, RIVAL_Z + 0.12)
  root.add(rivalHead)

  // the Notary: a masked witness at the left rail with a wooden gavel and a wax seal on the rail
  // The notary's arms run along z (turned to face the felt), so his bounds span ~1.7 m in z: he stands at z +0.3, which keeps
  // the whole-model lint box inside the L footprint (z ±0.93) once the rival sits at RIVAL_Z −0.5.
  const notary = kit.mannequin({ style: 'porcelain', mask: 'mask_porcelain', color: 0x1a1a22, jointColor: 0x2b2b34, height: 1.7, clip: 'Idle_Loop' })
  notary.root.position.set(-0.98, 0, 0.3)
  notary.root.rotation.y = Math.PI / 2
  notary.root.userData.lodDetail = true
  root.add(notary.root)
  notary.attach(kit.prop('gavel'), 'hand_r')

  // tally board on a post at the right rail: round, stake, rival (repainted by index.ts)
  kit.cyl(0.012, 0.012, 0.4, pal.brass, { pos: [0.7, TOP + 0.2, -0.1], seg: 6, parent: root })
  const board = kit.screen({ w: 0.34, h: 0.2, px: [136, 80], bezel: pal.black, scanlines: false })
  crispTexture(board.tex, 4)
  board.mesh.position.set(0.7, TOP + 0.5, -0.1)
  board.mesh.rotation.y = -Math.PI / 2.6
  root.add(board.mesh)
  const needle = kit.box(0.006, 0.07, 0.006, pal.brass, { pos: [0.7, TOP + 0.25, 0.06], parent: root })
  needle.rotation.z = 0

  // three clue lamps on a brass bar across the rival's side of the felt
  kit.box(0.5, 0.012, 0.04, pal.brass, { pos: [0, TOP + 0.006, -0.4], parent: root })
  const mk = (x: number, color: number): LampPart => {
    const l = kit.lamp({ r: 0.026, color, shape: 'dome' })
    l.root.position.set(x, TOP + 0.03, -0.4)
    root.add(l.root)
    l.setOn(false)
    return l
  }
  const lamps = { tell: mk(-0.16, LAMP_TELL), table: mk(0, LAMP_TABLE), math: mk(0.16, LAMP_MATH) }

  // the seal stamp (thumps on a call), the ledger and the wax seal
  const stamp = kit.cyl(0.035, 0.04, 0.07, pal.brass, { pos: [0.3, TOP + 0.045, 0.32], seg: 8, parent: root })
  const seal = kit.cyl(0.05, 0.05, 0.01, 0x8c1921, { pos: [-0.3, TOP + 0.005, 0.32], seg: 10, parent: root })
  const ledger = kit.prop('ledger')
  ledger.position.set(-0.05, TOP + 0.02, 0.32)
  root.add(ledger)
  const gavel = kit.prop('gavel')
  gavel.position.set(-0.55, TOP + 0.03, 0.05)
  gavel.rotation.y = 0.6
  root.add(gavel)

  // anchors the "table" clues fire from
  const cuff = new THREE.Object3D(); cuff.position.set(-0.28, TOP + 0.06, -0.42); root.add(cuff)
  const cup = new THREE.Object3D(); cup.position.set(0.28, TOP + 0.1, -0.4); root.add(cup)
  const tray = new THREE.Object3D(); tray.position.set(0, TOP + 0.04, -0.22); root.add(tray)

  // lights, speaker, prompt
  const light = new THREE.Object3D()
  light.position.set(0, 1.5, 0.1)
  light.userData = { color: 0xffe0b0, intensity: 0.6, range: 2.6, flicker: 'CANDLE' }
  root.add(light)
  const light2 = new THREE.Object3D()
  light2.position.set(0, 2.0, -0.2)
  light2.userData = { color: 0xb08aff, intensity: 0.35, range: 3, flicker: 'SICK' }
  root.add(light2)
  const prompt = new THREE.Object3D()
  prompt.position.set(0, 1.25, 0.55)
  root.add(prompt)
  const marqueeTop = new THREE.Object3D()
  marqueeTop.position.set(0, 2.1, 0.1)
  root.add(marqueeTop)
  const servicePlate = new THREE.Object3D()
  servicePlate.position.set(0, 0.25, 0.4)
  root.add(servicePlate)
  const label = kit.label({ text: { key: 'm.tallytable.plate' }, w: 0.4, h: 0.09, px: [160, 36], color: pal.gold, bg: pal.black })
  label.mesh.position.set(-0.7, TOP + 0.2, 0.1)
  label.mesh.rotation.y = Math.PI / 2.6
  root.add(label.mesh)

  root.add(kit.blobShadow(1.5, 1.8))          // inside the L footprint (z ±0.9): the shadow disc is w × d across

  const parts: TallyParts = { rival, notary, board, lamps, needle, stamp, gavel, seal, cuff, cup, tray, rivalHead, servicePlate }
  kit.finalize(root, {
    keep: [rival.root, notary.root, board.mesh, label.mesh, lamps.tell, lamps.table, lamps.math, needle, stamp, gavel, ledger, light, light2],
  })

  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-0.64, 0, -0.64], max: [0.64, TOP + 0.02, 0.64] },
      { min: [-1.2, 0, -0.75], max: [-0.8, 1.9, -0.25] },
    ],
    interact: { min: [-0.7, 0.2, -1.0], max: [0.7, 1.4, 1.0] },
    anchors: { speaker: prompt, prompt, label: label.mesh, marqueeTop, servicePlate, light, light2, coinOut: prompt },
    dispose: () => { board.dispose(); rival.dispose(); notary.dispose() },
  }
}
