/**
 * Fortune-Teller "Mother Moth" — procedural model (MACHINES_tables §14, ART §5.30). Pattern as in `coinflip/model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `Parts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side).
 *
 * Booth: 1.00 × 0.80 × 2.25 m walnut cabinet (kit `booth` style) with a glass front, a velvet shelf, the veiled oracle
 * (kit `oracle` dealer rig) with moth wings, a crystal ball, three omen cards that stand on the shelf, three brass
 * veil buttons, a coin slot, a dispenser, six marquee bulbs, three LEDs and a mist decal for one player letter.
 * Play pose: standing (0, 1.40, 0.60) looking at the shelf (0, 1.05, 0.10), FOV 55.
 *
 * Budget (ART §5.30): ≤ 1,500 tris, ≤ 14 draws. Animated parts are listed in `keep` (not merged).
 * Card faces are drawn here with canvas (roman numeral + kind pictogram); the omen name is shown by the HUD and the almanac.
 */
import * as THREE from 'three';
import type { Kit, ButtonPart, LampPart, MarqueePart, ScreenSurface, DealerPart, Palette } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { OMENS, type OmenKind } from './rules';

/** Contract between modeler and coder. */
export type FortunetellerParts = {
  /** Half-body automaton (kit oracle rig): `head` turns, `jaw` syncs to syllables, `handL/handR` gesture. */
  oracle: DealerPart;
  /** Moth-wing headdress groups; folded = rotation.y ±FOLD, spread = rotation.y ±SPREAD. */
  wingL: THREE.Group;
  wingR: THREE.Group;
  /** Crystal ball with its own material (colour set by logic: blessing gold, curse violet, neutral grey). */
  crystal: THREE.Mesh;
  /** Three shelf anchors where the omen cards stand. */
  cardSlots: THREE.Object3D[];
  /** Three 0.07 × 0.12 omen card planes (double-sided: back = `omenBack`, front = face texture). */
  omenCards: THREE.Mesh[];
  /** 22 face textures, one per omen id. */
  omenFaces: THREE.CanvasTexture[];
  omenBack: THREE.CanvasTexture;
  /** Brass veil buttons: pick 1 / 2 / 3. */
  buttons: { veil1: ButtonPart; veil2: ButtonPart; veil3: ButtonPart };
  /** Credit / bet / win LEDs on the front panel. */
  leds: { credit: LampPart; bet: LampPart; win: LampPart };
  /** 96 × 32 px reading display (last omen, coins). */
  screen: ScreenSurface;
  /** Six-bulb top marquee. */
  marquee: MarqueePart;
  /** Mist decal on the glass; alpha driven by logic. `fogCanvas` (32 × 32) holds the mist and one player letter. */
  fog: THREE.Mesh;
  fogCanvas: HTMLCanvasElement;
  fogTex: THREE.CanvasTexture;
  /** Dispenser slot where the cards come out (FX origin for the deal). */
  dispenser: THREE.Object3D;
};

export const W = 1.0, D = 0.8, H = 2.25;
export const SHELF_Y = 1.02;
export const SHELF_Z = 0.16;
// seat-views: cards are big enough to read from the seat (0.13 x 0.21 m, tilted back to face the player's eye)
export const CARD_W = 0.13, CARD_H = 0.21;
export const CARD_X = [-0.2, 0, 0.2] as const;
export const CARD_Y = SHELF_Y + CARD_H / 2, CARD_TILT = 0.2;
export const FOLD = 1.25, SPREAD = 0.2;
const FRONT_Z = D / 2 - 0.015;          // front-face elements sit just inside the footprint (bounds rule)
const COLOURWAYS: ReadonlyArray<{ body: keyof Palette; trim: keyof Palette }> = [
  { body: 'woodDark', trim: 'brass' },
  { body: 'redDark', trim: 'gold' },
  { body: 'feltDark', trim: 'brass' },
  { body: 'carpet', trim: 'chrome' },
];

const TONE: Record<OmenKind, string> = {
  blessing: '#FFC83D', curse: '#B56CFF', neutral: '#9A9A9A', mirror: '#BFE6F2',
};
/** Crystal colour per omen kind (DESIGN §14.9: gold blessing, violet curse, grey neutral). */
export const CRYSTAL: Record<OmenKind, number> = { blessing: 0xffc83d, curse: 0x7a2a9a, neutral: 0x8a8a92, mirror: 0xbfe6f2 };

/** Roman numeral for 1..21; 0 is "0" (the Pit's card). */
export function roman(n: number): string {
  if (n <= 0) return '0';
  const t: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let r = '', k = n;
  for (const [v, s] of t) while (k >= v) { r += s; k -= v; }
  return r;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Omen card face: dark field, tone frame, roman numeral, kind pictogram. Canvas 64 × 96. */
function paintFace(id: number): HTMLCanvasElement {
  const c = canvas(64, 96);
  const g = c.getContext('2d');
  if (!g) return c;
  const kind: OmenKind = OMENS[id]?.kind ?? 'neutral', tone = TONE[kind];
  g.fillStyle = '#1a0f0a'; g.fillRect(0, 0, 64, 96);
  g.strokeStyle = tone; g.lineWidth = 3; g.strokeRect(4, 4, 56, 88);
  g.fillStyle = tone; g.textAlign = 'center'; g.font = 'bold 20px monospace';
  g.fillText(roman(id), 32, 28);
  g.strokeStyle = tone; g.fillStyle = tone; g.lineWidth = 4;
  if (kind === 'blessing') { g.beginPath(); g.arc(32, 56, 14, 0, Math.PI * 2); g.fill(); }
  else if (kind === 'curse') { g.beginPath(); g.moveTo(20, 42); g.lineTo(44, 70); g.moveTo(44, 42); g.lineTo(20, 70); g.stroke(); }
  else if (kind === 'mirror') { g.fillRect(24, 40, 6, 32); g.fillRect(34, 40, 6, 32); }
  else { g.beginPath(); g.arc(32, 56, 14, 0, Math.PI * 2); g.stroke(); }
  return c;
}

/** Back of the omen card: a dark field with a brass moth. */
function paintBack(): HTMLCanvasElement {
  const c = canvas(64, 96);
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#2a1608'; g.fillRect(0, 0, 64, 96);
  g.strokeStyle = '#C8922E'; g.lineWidth = 3; g.strokeRect(4, 4, 56, 88);
  g.fillStyle = '#C8922E';
  g.beginPath(); g.ellipse(22, 48, 16, 24, 0.3, 0, Math.PI * 2); g.ellipse(42, 48, 16, 24, -0.3, 0, Math.PI * 2); g.fill();
  return c;
}

/** Moth wing texture for the headdress: a lobe with an eye spot. Canvas 64 × 46. */
function paintWing(): HTMLCanvasElement {
  const c = canvas(64, 46);
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#4a3a2a';
  g.beginPath(); g.ellipse(32, 23, 30, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d8b56a';
  g.beginPath(); g.ellipse(32, 23, 16, 11, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a1f14';
  g.beginPath(); g.arc(32, 23, 5, 0, Math.PI * 2); g.fill();
  return c;
}

/** Blank mist for the glass decal: a faint veil, no letter yet. */
function paintFogBlank(c: HTMLCanvasElement): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(180,200,220,0.25)'; g.fillRect(0, 0, 32, 32);
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<FortunetellerParts> {
  const { pal } = kit;
  const cw = COLOURWAYS[o.variant] ?? COLOURWAYS[0];
  const body = pal[cw.body], trim = pal[cw.trim];
  const root = kit.group('fortuneteller');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (merged by finalize) ──
  const cab = kit.cabinet({ style: 'booth', w: W, h: H, d: D, body, trim, accent: pal.neonPink });
  root.add(cab.root);
  kit.box(0.84, 0.03, 0.4, pal.redDark, at(0, SHELF_Y - 0.015, SHELF_Z));                  // velvet shelf
  kit.box(0.2, 0.02, 0.05, pal.black, at(0, 0.56, FRONT_Z));                                // dispenser slot
  kit.box(0.04, 0.06, 0.02, pal.black, at(0.36, 0.93, FRONT_Z));                            // coin slot

  // ── oracle and wings (animated) ──
  // the rig stands on the floor and lifts its reach targets by feltY - 0.76 (kit/dealer.ts); the old root at y = SHELF_Y put its feet ON the
  // shelf, so a 2.2 m giant filled the view from the waist up
  const oracle = kit.dealer({ style: 'oracle', height: 1.7, suit: pal.feltDark, skin: pal.cream, feltY: SHELF_Y });
  oracle.root.position.set(0, 0, -0.12);
  root.add(oracle.root);
  const mothTex = new THREE.CanvasTexture(paintWing());
  mothTex.colorSpace = THREE.NoColorSpace;
  const wingMat = new THREE.MeshBasicMaterial({ map: mothTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.2 });
  const wingL = kit.group('wingL', kit.plane(0.25, 0.18, wingMat, { pos: [-0.125, 0, 0] }));
  const wingR = kit.group('wingR', kit.plane(0.25, 0.18, wingMat, { pos: [0.125, 0, 0] }));
  wingL.position.set(-0.02, 1.55, -0.16); wingL.rotation.y = FOLD;
  wingR.position.set(0.02, 1.55, -0.16); wingR.rotation.y = -FOLD;
  root.add(wingL, wingR);

  // ── crystal ball on the shelf ──
  const crystalMat = new THREE.MeshBasicMaterial({ color: CRYSTAL.neutral, transparent: true, opacity: 0.8 });
  // (moved to the right-hand end of the shelf so it no longer hides the middle card from the seat)
  const crystal = kit.sphere(0.065, crystalMat, { pos: [0.34, SHELF_Y + 0.085, 0.2], wSeg: 12, hSeg: 8, parent: root });
  kit.sphere(0.014, 0xffffff, { pos: [-0.025, 0.03, 0.045], wSeg: 6, hSeg: 4, parent: crystal });          // glint: reads as glass, not a grey blob

  // ── omen cards (animated) ──
  const omenFaces: THREE.CanvasTexture[] = [];
  for (let id = 0; id < OMENS.length; id++) {
    const t = new THREE.CanvasTexture(paintFace(id));
    t.colorSpace = THREE.NoColorSpace;
    omenFaces.push(t);
  }
  const omenBack = new THREE.CanvasTexture(paintBack());
  omenBack.colorSpace = THREE.NoColorSpace;
  const cardSlots: THREE.Object3D[] = [];
  const omenCards: THREE.Mesh[] = [];
  CARD_X.forEach((x, i) => {
    const slot = new THREE.Object3D();
    slot.position.set(x, CARD_Y, SHELF_Z);
    root.add(slot);
    cardSlots.push(slot);
    const m = new THREE.MeshBasicMaterial({ map: omenBack, side: THREE.DoubleSide });
    const card = kit.plane(CARD_W, CARD_H, m, { parent: root, pos: [x, CARD_Y, SHELF_Z], rot: [-CARD_TILT * 180 / Math.PI, 0, 0] });
    card.userData.slot = i;
    omenCards.push(card);
  });

  // ── veil buttons and LEDs (animated) ──
  const buttons = {
    veil1: kit.button({ shape: 'round', r: 0.022, color: pal.brass }),
    veil2: kit.button({ shape: 'round', r: 0.022, color: pal.brass }),
    veil3: kit.button({ shape: 'round', r: 0.022, color: pal.brass }),
  };
  buttons.veil1.root.position.set(-0.2, 0.93, FRONT_Z);
  buttons.veil2.root.position.set(0, 0.93, FRONT_Z);
  buttons.veil3.root.position.set(0.2, 0.93, FRONT_Z);
  root.add(buttons.veil1.root, buttons.veil2.root, buttons.veil3.root);
  const leds = {
    credit: kit.lamp({ r: 0.012, color: pal.green, shape: 'dome' }),
    bet: kit.lamp({ r: 0.012, color: pal.gold, shape: 'dome' }),
    win: kit.lamp({ r: 0.012, color: pal.red, shape: 'dome' }),
  };
  leds.credit.root.position.set(-0.3, 0.93, FRONT_Z);
  leds.bet.root.position.set(-0.27, 0.93, FRONT_Z);
  leds.win.root.position.set(-0.24, 0.93, FRONT_Z);
  root.add(leds.credit.root, leds.bet.root, leds.win.root);

  // ── glass, mist, screen, marquee (animated) ──
  const glass = kit.glass({ w: 0.8, h: 1.0, d: 0.02, tint: pal.glass, opacity: 0.16 });
  glass.position.set(0, 1.5, FRONT_Z);
  root.add(glass);
  const fogCanvas = canvas(32, 32);
  paintFogBlank(fogCanvas);
  const fogTex = new THREE.CanvasTexture(fogCanvas);
  fogTex.colorSpace = THREE.NoColorSpace;
  const fog = kit.plane(0.8, 1.0, new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, opacity: 0, depthWrite: false }), { parent: root, pos: [0, 1.5, FRONT_Z - 0.012] });
  const screen = kit.screen({ w: 0.3, h: 0.1, px: [96, 32], bezel: pal.black });
  screen.mesh.position.set(0, 0.78, FRONT_Z);
  root.add(screen.mesh);
  const marquee = kit.marquee({ w: 0.92, h: 0.16, text: { key: 'm.fortuneteller.name' }, color: pal.neonYellow, bg: pal.black, bulbs: 6 });
  marquee.root.position.set(0, 2.08, FRONT_Z + 0.005);
  root.add(marquee.root);

  // ── crystal light hint for the pooled lights (no THREE.Light inside machines) ──
  const light = new THREE.Object3D();
  light.position.set(0, 1.55, 0.55);   // seat-views: a warm key over the shelf, between the player and the cards
  light.userData = { color: 0xffd890, intensity: 1.1, range: 2.2, flicker: 'STEADY' };
  root.add(light);

  // ── anchors ──
  const speaker = cab.anchors.speaker;
  const dispenser = new THREE.Object3D();
  dispenser.position.set(0, 0.56, FRONT_Z + 0.02);
  root.add(dispenser);
  const coinSlot = new THREE.Object3D();
  coinSlot.position.set(0.36, 0.93, FRONT_Z + 0.02);
  root.add(coinSlot);
  const marqueeTop = new THREE.Object3D();
  marqueeTop.position.set(0, H, 0);
  root.add(marqueeTop);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(0.52, 0.3, 0);
  root.add(servicePlate);
  const stand = new THREE.Object3D();
  stand.position.set(0, 0, D / 2 + 0.3);
  root.add(stand);

  const parts: FortunetellerParts = {
    oracle, wingL, wingR, crystal, cardSlots, omenCards, omenFaces, omenBack,
    buttons, leds, screen, marquee, fog, fogCanvas, fogTex, dispenser,
  };
  kit.finalize(root, {
    keep: [
      oracle.root, wingL, wingR, crystal, ...omenCards, buttons.veil1.root, buttons.veil2.root, buttons.veil3.root,
      leds.credit.root, leds.bet.root, leds.win.root, screen.mesh, marquee.root, fog, light,
    ],
  });

  return {
    root,
    parts,
    // framing: the three cards (y 1.02-1.23) and the oracle's hands inside the band between the HUD banner and the control bar
    playPose: { pos: new THREE.Vector3(0, 1.64, 1.4), look: new THREE.Vector3(0, 1.36, 0.1), fov: 50, mouse: 'pick' },
    colliders: cab.colliders,
    interact: { min: [-W / 2, 0, -D / 2], max: [W / 2, H - 0.02, D / 2 + 0.1] },
    anchors: { speaker, prompt: marquee.root, marqueeTop, servicePlate, stand, light, coinOut: dispenser, coinSlot },
    dispose: () => { screen.dispose(); mothTex.dispose(); wingMat.dispose(); crystalMat.dispose(); },
  };
}
