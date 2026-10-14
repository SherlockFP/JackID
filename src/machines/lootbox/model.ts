/**
 * Mystery Capsule Vendor — procedural model (`lootbox`, solo, gallery). Pattern: see `charm_vendor/model.ts`.
 *
 * Red cast-iron stand 0.72 × 0.72 m with brass bands on a 0.80 × 0.80 m plinth, a glass dome (Ø 0.60 m) on top holding
 * ~60 two-tone capsules, a spiral exit chute down the outside of the stand and a hinged flap at y 0.55. The front plate
 * at 1.00 m carries three chrome cranks, each above a coin slot and an enamel tier badge (TIN, BRASS, GILDED). The
 * topper is a magenta marquee. Origin = floor centre, +Z = the player side. Footprint 0.80 × 0.80 × 1.90 m.
 *
 * Budget: ≤ 1 100 tris, ≤ 14 draw calls, ≤ 5 textures. Capsule halves are instanced (2 draw calls).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LabelPart, LampPart, MarqueePart } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { V3 } from '@/core/types';
import { createRng, hashSeed } from '@/core/rng';

export const W = 0.80, D = 0.80, H = 1.90;
export const STAND_R = 0.36;
export const DOME_R = 0.30;
/** Top of the stand, floor of the dome. */
export const TOP_Y = 1.00;
export const CAPSULES = 60;
export const CAP_R = 0.03;
/** Vended capsule radius (hemisphere halves). */
export const VEND_R = 0.05;

const RED = 0x8e1b1b;
const DARK = 0x231414;
const BRASS = 0xc9a227;
const CHROME = 0xd8dce0;
const GLASS = 0xbfe6ff;
const MAGENTA = 0xff3fb4;
const WHITE = 0xf4f4f0;
/** Tier badge colours: TIN, BRASS, GILDED. */
export const BADGE = [0x9aa0a6, 0xc9a227, 0xffd040] as const;
/** Crank x positions on the front plate, one per tier. */
export const CRANK_X = [-0.22, 0, 0.22] as const;
const CRANK_Y = 0.90;
const PLATE_Z = 0.375;
const FRONT_Z = 0.37;   // cranks + reveal stay inside the 1.0 m footprint depth (z 0.53)
const FLAP_Y = 0.55;

export type CrankPart = ReturnType<KitX['crank']>;

export type LootboxParts = {
  /** Glass dome (transparent shell). */
  dome: THREE.Object3D;
  /** Top half of each resting capsule (instanced; `setColorAt` = random hue, cosmetic only). */
  capsules: THREE.InstancedMesh;
  /** Bottom half of each resting capsule (instanced, white). */
  capsuleBase: THREE.InstancedMesh;
  /** Three cranks, one per tier. `turn(rev, dur)` animates the ratchet clicks. */
  cranks: CrankPart[];
  /** Enamel tier badges (lit = selected tier). */
  badges: LampPart[];
  /** Printed badge labels under the cranks (TIN / BRASS / GILDED). */
  badgeLabels: LabelPart[];
  /** Coin slot anchors, one per tier. */
  coinSlots: THREE.Object3D[];
  /** Hinge pivot of the exit flap at y 0.55. Rotation.x opens it. */
  chuteFlap: THREE.Object3D;
  /** 12 points along the spiral chute, top to exit. The vended capsule rolls through them. */
  rollPath: V3[];
  /** Vended capsule, top half (hidden until a vend). Material colour = capsule colour. */
  capsuleTop: THREE.Group;
  /** Vended capsule, bottom half (hidden until a vend). */
  capsuleBottom: THREE.Group;
  /** Floating point above the flap where the item hovers during the reveal. */
  revealAnchor: THREE.Object3D;
  /** Vertical additive rarity beam (0.15 × 2.5 m). The coder sets the colour. */
  rarityBeam: THREE.Mesh;
  /** Small status lamps on the front plate. */
  leds: { credit: LampPart; bet: LampPart; win: LampPart };
  /** Magenta topper marquee. */
  marquee: MarqueePart;
};


/** Helix on the outside of the stand: `turns` turns from back-top (y 1.0) to front exit (y 0.55). */
function helixAt(t: number): V3 {
  const a = Math.PI + Math.PI * 5 * t;                     // 2.5 turns, starts at the back, ends at the front
  const y = TOP_Y - 0.02 - (TOP_Y - 0.02 - FLAP_Y - 0.02) * t;
  const r = STAND_R + 0.05;
  return [Math.sin(a) * r, y, Math.cos(a) * r];
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<LootboxParts> {
  const root = kit.group('lootbox');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });

  // ── stand (flat colours) ──
  kit.box(W, 0.12, D, DARK, at(0, 0.06, 0));                                  // plinth
  kit.box(STAND_R * 2, TOP_Y - 0.12, STAND_R * 2, RED, at(0, 0.12 + (TOP_Y - 0.12) / 2, 0));   // cast-iron body
  for (const y of [0.22, 0.62]) kit.box(STAND_R * 2 + 0.02, 0.03, STAND_R * 2 + 0.02, BRASS, at(0, y, 0));
  kit.box(0.66, 0.30, 0.03, DARK, at(0, CRANK_Y - 0.02, PLATE_Z));            // front plate
  kit.box(0.70, 0.02, 0.06, BRASS, at(0, TOP_Y + 0.01, 0.34));                // dome collar, front

  // posts up to the topper
  for (const sx of [-1, 1]) kit.cyl(0.018, 0.018, 0.55, CHROME, at(sx * 0.34, TOP_Y + 0.275, 0, { seg: 6 }));
  kit.box(W, 0.10, D, RED, at(0, 1.85, 0));                                   // crown
  kit.box(0.74, 0.04, 0.06, BRASS, at(0, 1.80, 0.36));                        // crown lip

  // ── glass dome and capsules ──
  const dome = kit.dome({ r: DOME_R, tint: GLASS, opacity: 0.30 });
  dome.position.set(0, TOP_Y, 0);
  root.add(dome);

  const topGeo = new THREE.SphereGeometry(CAP_R, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const botGeo = new THREE.SphereGeometry(CAP_R, 6, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const capMatTop = kit.mat(WHITE);
  const capMatBot = kit.mat(WHITE);
  const capsules = new THREE.InstancedMesh(topGeo, capMatTop, CAPSULES);
  const capsuleBase = new THREE.InstancedMesh(botGeo, capMatBot, CAPSULES);
  const rng = createRng(hashSeed('lootbox-capsules', o.seed));
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < CAPSULES && guard++ < 5000) {
    // rejection-sample inside the dome's hemisphere, resting on its floor
    const x = rng.float(-0.25, 0.25);
    const y = rng.float(0.0, 0.22);
    const z = rng.float(-0.25, 0.25);
    if (x * x + y * y + z * z > 0.24 * 0.24 || y * y > 0.24 * 0.24) continue;
    m.makeTranslation(x, TOP_Y + CAP_R + y, z);
    capsules.setMatrixAt(placed, m);
    capsuleBase.setMatrixAt(placed, m);
    col.setHSL(rng.int(0, 359) / 360, 0.75, 0.55);
    capsules.setColorAt(placed, col);
    capsuleBase.setColorAt(placed, col.setHex(WHITE));
    placed++;
  }
  for (let i = placed; i < CAPSULES; i++) {                                    // fallback: park the rest in the floor
    m.makeTranslation(0, TOP_Y - 1, 0);
    capsules.setMatrixAt(i, m);
    capsuleBase.setMatrixAt(i, m);
  }
  capsules.instanceMatrix.needsUpdate = true;
  capsules.instanceColor!.needsUpdate = true;
  capsuleBase.instanceMatrix.needsUpdate = true;
  capsuleBase.instanceColor!.needsUpdate = true;
  root.add(capsules, capsuleBase);

  // ── exit chute: spiral outside the stand, ends at a hinged flap ──
  const helix: V3[] = [];
  for (let i = 0; i <= 40; i++) helix.push(helixAt(i / 40));
  kit.tube(helix, 0.025, GLASS, { parent: root, seg: 48, radialSeg: 4 });
  const rollPath: V3[] = [];
  for (let i = 0; i < 12; i++) rollPath.push(helixAt(i / 11));

  const chuteFlap = new THREE.Object3D();
  chuteFlap.position.set(0, FLAP_Y, FRONT_Z + 0.02);
  kit.box(0.16, 0.012, 0.10, RED, { pos: [0, 0, 0.05], parent: chuteFlap });
  root.add(chuteFlap);

  // ── front plate: cranks, coin slots, tier badges ──
  const cranks: CrankPart[] = [];
  const badges: LampPart[] = [];
  const badgeLabels: LabelPart[] = [];
  const coinSlots: THREE.Object3D[] = [];
  CRANK_X.forEach((x, i) => {
    const c = kit.crank({ r: 0.06 });
    c.root.position.set(x, CRANK_Y, FRONT_Z);
    root.add(c.root);
    cranks.push(c);

    const slot = kit.coinSlot({ color: BRASS });
    slot.position.set(x, CRANK_Y - 0.09, PLATE_Z + 0.02);
    root.add(slot);
    const slotAnchor = new THREE.Object3D();
    slotAnchor.position.set(x, CRANK_Y - 0.09, FRONT_Z);
    root.add(slotAnchor);
    coinSlots.push(slotAnchor);

    const badge = kit.lamp({ r: 0.035, color: BADGE[i], shape: 'flat' });
    badge.root.position.set(x, CRANK_Y + 0.11, PLATE_Z + 0.01);
    root.add(badge.root);
    badges.push(badge);

    const lab = kit.label({ text: { key: `m.lootbox.${['tin', 'brass', 'gilded'][i]}` }, w: 0.13, h: 0.03, px: [64, 16], color: 0x1a1010, bg: BADGE[i], font: 'vt' });
    lab.mesh.position.set(x, CRANK_Y - 0.15, PLATE_Z + 0.02);
    root.add(lab.mesh);
    badgeLabels.push(lab);
  });

  const leds = {
    credit: kit.lamp({ r: 0.02, color: 0xff3040, shape: 'bulb' }),
    bet: kit.lamp({ r: 0.02, color: 0xffb000, shape: 'bulb' }),
    win: kit.lamp({ r: 0.02, color: 0x60ff90, shape: 'bulb' }),
  };
  leds.credit.root.position.set(-0.31, CRANK_Y, PLATE_Z + 0.02);
  leds.bet.root.position.set(-0.31, CRANK_Y - 0.06, PLATE_Z + 0.02);
  leds.win.root.position.set(0.31, CRANK_Y, PLATE_Z + 0.02);
  root.add(leds.credit.root, leds.bet.root, leds.win.root);

  // ── topper ──
  const marquee = kit.marquee({ w: 0.70, h: 0.18, text: { key: 'm.lootbox.marquee' }, color: MAGENTA, bulbs: 14 });
  marquee.root.position.set(0, 1.64, 0.02);
  root.add(marquee.root);

  // ── vended capsule (both halves, hidden until a vend) ──
  const revealAnchor = new THREE.Object3D();
  revealAnchor.position.set(0, 0.78, FRONT_Z + 0.10);
  root.add(revealAnchor);
  const capsuleTop = new THREE.Group();
  capsuleTop.add(kit.sphere(VEND_R, WHITE, { hemi: true, wSeg: 10, hSeg: 6 }));
  const capsuleBottom = new THREE.Group();
  const bot = kit.sphere(VEND_R, WHITE, { hemi: true, wSeg: 10, hSeg: 6 });
  bot.rotation.x = Math.PI;
  capsuleBottom.add(bot);
  for (const g of [capsuleTop, capsuleBottom]) {
    g.position.copy(revealAnchor.position);
    g.visible = false;
    root.add(g);
  }
  // each vended half gets its own material so a colour change never leaks to shared kit materials
  for (const g of [capsuleTop, capsuleBottom]) {
    g.traverse((c) => { if (c instanceof THREE.Mesh) c.material = (c.material as THREE.Material).clone(); });
  }
  capsuleTop.visible = false;

  const rarityBeam = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 2.5),
    new THREE.MeshBasicMaterial({ color: 0xffc020, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  rarityBeam.position.set(0, 1.25, FRONT_Z + 0.12);
  rarityBeam.visible = false;
  root.add(rarityBeam);

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 0.70, FRONT_Z); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.12, FRONT_Z + 0.02); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.76, 0.36); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.73, 0); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0, 0.42, FRONT_Z - 0.02); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0.56, 0); root.add(stand);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.72, FRONT_Z + 0.10); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0, TOP_Y + 0.12, 0);
  light.userData = { color: 0xffc060, intensity: 0.5, range: 1.5, flicker: 'STEADY' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, 1.25, FRONT_Z + 0.2);
  light2.userData = { color: 0xffc020, intensity: 0.0, range: 2.0, flicker: 'STEADY' };
  root.add(light2);

  const parts: LootboxParts = {
    dome, capsules, capsuleBase, cranks, badges, badgeLabels, coinSlots, chuteFlap, rollPath,
    capsuleTop, capsuleBottom, revealAnchor, rarityBeam, leds, marquee,
  };
  kit.finalize(root, {
    keep: [
      dome, capsules, capsuleBase, chuteFlap, capsuleTop, capsuleBottom, revealAnchor, rarityBeam,
      ...cranks.map((c) => c.root), ...badges.map((b) => b.root), ...badgeLabels.map((l) => l.mesh),
      leds.credit.root, leds.bet.root, leds.win.root, marquee.root, light, light2, ...coinSlots,
    ],
  });

  return {
    root,
    parts,
    // seat view: lifted and backed off so the capsule heap (to 1.30) and the crank row (0.75 to 1.01) clear the bottom control bar
    playPose: { pos: new THREE.Vector3(0, 1.40, 1.30), look: new THREE.Vector3(0, 1.00, 0), fov: 60, mouse: 'pick' },
    colliders: [
      { min: [-0.40, 0, -0.40], max: [0.40, TOP_Y, 0.40] },
    ],
    interact: { min: [-0.42, 0, -0.42], max: [0.42, H, 0.42] },
    anchors: {
      speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light, light2, insideGlass: dome,
    },
    dispose: () => { topGeo.dispose(); botGeo.dispose(); rarityBeam.geometry.dispose(); (rarityBeam.material as THREE.Material).dispose(); },
  };
}
