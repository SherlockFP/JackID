/**
 * Kit API (procedural parts for modelers) — TD-FROZEN. Implementation: KIT WP (`src/kit/*` except this file).
 * Contract: TECH_SPEC §4, ART_BIBLE §4 + §8, BRIEF ADDENDUM 4 (animated mannequin, vendor textures).
 *
 * Everything returns objects **not yet added** to any scene, built from `psxMaterial`s, origin at the
 * part's natural pivot (buttons: base centre; levers: hinge; reels: axle centre). Dimensions in metres.
 * Default segment counts are PSX-low (cylinders 8–12, spheres 8×6). `MatLike` = `Hex` (lit material of
 * that colour) | `PsxMatOpts` | `THREE.Material`. `TextSource` = plain string **only for non-language
 * text** (numbers, symbols) or `{ key, vars }` (translated, auto-redrawn on `lang:changed`).
 *
 * Vendor (CC0) textures: `kit.tex.vendor(path, { size, quantize })` (see texgen/types). Use them to dress
 * the environment/material surfaces; keep game-specific art (cards, chips, symbols, signage) procedural.
 */
import type * as THREE from 'three';
import type { Hex, LocalAABB, PlayPose, SeatDef, SlotSize, V3 } from '@/core/types';
import type { PsxMatOpts } from '@/core/renderer/types';
import type { CardId, FontId, SymbolId, TexGen, TextOpts } from '@/core/texgen/types';
import type { I18nVars } from '@/core/i18n';

export type MatLike = Hex | PsxMatOpts | THREE.Material;
export type TextSource = string | { key: string; vars?: I18nVars };
export interface PrimOpts { pos?: V3; rot?: V3 /* degrees XYZ */; scale?: V3 | number; name?: string; parent?: THREE.Object3D; shade?: boolean /* bake vertex gradient, default true */ }
export type Palette = Record<'black' | 'white' | 'cream' | 'bone' | 'brass' | 'gold' | 'chrome' | 'steel' | 'rust'
  | 'red' | 'redDark' | 'blood' | 'green' | 'felt' | 'feltDark' | 'blue' | 'woodDark' | 'wood' | 'leather'
  | 'carpet' | 'neonPink' | 'neonCyan' | 'neonYellow' | 'glass' | 'void', Hex>;

// ── Animated mannequin (Quaternius UAL, 43 clips) ───────────────────────────────────────────────
/** Source GLB. Load ONCE (GLTFLoader), clone per instance with `SkeletonUtils.clone`, share clips. */
export const MANNEQUIN_GLB = '/assets/vendor/quaternius-ual/UAL1_Standard.glb';
/** Exact clip names inside the GLB (ASSETS.md). */
export const MANNEQUIN_CLIPS = [
  'A_TPose', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Death01', 'Driving_Loop', 'Fixing_Kneeling',
  'Hit_Chest', 'Hit_Head', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Interact', 'Jog_Fwd_Loop',
  'Jump_Land', 'Jump_Loop', 'Jump_Start', 'PickUp_Table', 'Pistol_Aim_Down', 'Pistol_Aim_Neutral',
  'Pistol_Aim_Up', 'Pistol_Idle_Loop', 'Pistol_Reload', 'Pistol_Shoot', 'Punch_Cross', 'Punch_Jab', 'Push_Loop',
  'Roll', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Spell_Simple_Enter',
  'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Sprint_Loop', 'Swim_Fwd_Loop',
  'Swim_Idle_Loop', 'Sword_Attack', 'Sword_Idle', 'Walk_Formal_Loop', 'Walk_Loop',
] as const;
export type MannequinClip = (typeof MANNEQUIN_CLIPS)[number];
/** Skeleton joints worth attaching things to (verified against the GLB; note the capital `Head`). */
export const MANNEQUIN_BONES = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
] as const;
export type MannequinBone = (typeof MANNEQUIN_BONES)[number] | (string & {});

export interface MannequinOpts {
  /** Body tint (`M_Main`): player colour, suit, dealer black. */
  color?: Hex;
  /** Joint tint (`M_Joints`). */
  jointColor?: Hex;
  height?: number;                 // metres, default 1.75
  /** Material preset: plain wood-doll, cracked porcelain, translucent ghost, dark shadow, the Collector. */
  style?: 'plain' | 'porcelain' | 'ghost' | 'shadow' | 'collector';
  /** Procedural face/hat attached to `Head` (kit `prop` id), e.g. 'mask_porcelain', 'hat_collector'. */
  mask?: string | null;
  clip?: MannequinClip | string;   // initial clip, default 'Idle_Loop'
  /** PSX stepped animation fps (default 15); null = smooth. */
  stepFps?: number | null;
  /** Skip mixer updates entirely (distant LOD / frozen pose). */
  frozen?: boolean;
}
export interface MannequinPlayOpts {
  fade?: number;                   // crossfade seconds, default 0.2
  loop?: boolean;                  // default: true for *_Loop clips, false otherwise
  speed?: number;                  // default 1
  /** Hold the last frame after a non-looping clip instead of snapping back to idle. */
  hold?: boolean;
  /** Start offset in seconds (cutscene seek). */
  at?: number;
}
export interface MannequinActor {
  readonly root: THREE.Group;      // add this to your scene; origin at the feet, +Z forward
  /** Resolves when the GLB is loaded and the real mesh replaced the placeholder (instant if cached). */
  readonly ready: Promise<void>;
  readonly isReady: boolean;
  readonly clips: readonly string[];
  readonly clip: string | null;
  /** Play a clip with crossfade. Resolves when a non-looping clip finishes. Calls before `ready` are queued. */
  play(clip: MannequinClip | string, o?: MannequinPlayOpts): Promise<void>;
  stop(fade?: number): void;
  setSpeed(k: number): void;
  setTint(color: Hex | null, amount?: number): void;     // null restores `opts.color`
  setOpacity(a: number): void;                            // ghosts, fade-outs
  setVisible(on: boolean): void;
  setStepFps(fps: number | null): void;
  /** Bone object for attachments/IK-lite; null before ready or if the name is unknown. */
  bone(name: MannequinBone): THREE.Object3D | null;
  /** Parent `obj` to a bone (queued until ready). Returns detach(). */
  attach(obj: THREE.Object3D, bone: MannequinBone, o?: { pos?: V3; rot?: V3 /* deg */; scale?: number }): () => void;
  /** Procedural head turn towards a world point (blended over the clip); null releases. */
  lookAt(target: THREE.Vector3 | null, dur?: number): void;
  update(dt: number): void;       // advanced automatically by `Kit.update`; call manually only for off-screen actors
  dispose(): void;                // frees non-shared GPU resources, stops the mixer
  // ── DECISIONS G: actor own / setFrozen / addProc / onPose ──
  /** Dispose `obj` (a prop built for this actor) together with the actor. */
  own(obj: THREE.Object3D): void;
  /** Freeze / thaw the mixer (distance LOD: mannequins far or invisible freeze; one-shot clips complete instantly). */
  setFrozen(on: boolean): void;
  /** Register named procedural events fired from clip markers (`proc` tracks). */
  addProc(names: readonly string[]): void;
  /** Per-frame pose hook after (`post`, default) or before (`pre`) the mixer. Returns the unsubscribe. */
  onPose(fn: (dt: number) => void, phase?: 'pre' | 'post'): () => void;
}
/** @deprecated spec-era name for the procedural mannequin; kept so older snippets compile. */
export type MannequinPart = MannequinActor;

// ── radius items (BRIEF ADDENDUM 8 "Totems") ────────────────────────────────────────────────────
export interface TotemPart {
  root: THREE.Group;
  /** Glowing floor ring showing the effect radius. */
  ring: THREE.Mesh;
  setRadius(r: number): void;
  setActive(on: boolean): void;            // lit + ring visible when placed
  pulse(): void;                           // proc feedback
  dispose(): void;
}

export interface Kit {
  readonly pal: Palette;
  readonly tex: TexGen;
  mat(o: MatLike): THREE.Material;
  // ── primitives ──
  group(name: string, ...children: THREE.Object3D[]): THREE.Group;
  box(w: number, h: number, d: number, m: MatLike, o?: PrimOpts & { bevel?: number }): THREE.Mesh;
  cyl(rTop: number, rBot: number, h: number, m: MatLike, o?: PrimOpts & { seg?: number; open?: boolean; thetaLen?: number }): THREE.Mesh;
  sphere(r: number, m: MatLike, o?: PrimOpts & { wSeg?: number; hSeg?: number; hemi?: boolean }): THREE.Mesh;
  torus(r: number, tube: number, m: MatLike, o?: PrimOpts & { seg?: number; tubeSeg?: number; arc?: number }): THREE.Mesh;
  plane(w: number, h: number, m: MatLike, o?: PrimOpts & { segW?: number; segH?: number }): THREE.Mesh;
  lathe(profile: Array<[r: number, y: number]>, seg: number, m: MatLike, o?: PrimOpts): THREE.Mesh;
  extrude(shape: Array<[x: number, y: number]>, depth: number, m: MatLike, o?: PrimOpts & { bevel?: number }): THREE.Mesh;
  tube(points: V3[], r: number, m: MatLike, o?: PrimOpts & { seg?: number; radialSeg?: number }): THREE.Mesh;
  // ── finishing ──
  finalize(root: THREE.Object3D, o?: { keep?: Array<THREE.Object3D | { root: THREE.Object3D }> }): { meshesBefore: number; drawCalls: number; tris: number };
  aabb(obj: THREE.Object3D, relativeTo: THREE.Object3D, pad?: number): LocalAABB;
  shade(mesh: THREE.Mesh, o?: { top?: number; bottom?: number }): void;   // bake vertex colours (vertex-lit look)
  // ── cabinets & displays ──
  cabinet(o: CabinetOpts): CabinetPart;
  screen(o: { w: number; h: number; px: [number, number]; bezel?: Hex; glow?: number; scanlines?: boolean }): ScreenSurface;
  marquee(o: { w: number; h: number; text: TextSource; color?: Hex; bg?: Hex; bulbs?: number; font?: FontId }): MarqueePart;
  label(o: { text: TextSource; w: number; h: number; px?: [number, number]; color?: Hex; bg?: Hex | null; font?: FontId }): LabelPart;
  neon(o: { text: TextSource; h: number; color: Hex; flicker?: number }): NeonPart;
  // ── controls ──
  button(o: { shape?: 'round' | 'rect' | 'mushroom'; r?: number; w?: number; h?: number; color: Hex; label?: TextSource; lit?: boolean }): ButtonPart;
  lever(o?: { length?: number; knob?: Hex; side?: 'left' | 'right' }): LeverPart;   // default length 0.45, red knob, right side
  coinSlot(o?: { color?: Hex }): THREE.Group;
  coinTray(o?: { w?: number; color?: Hex }): { root: THREE.Group; anchor: THREE.Object3D };
  crank(o?: { r?: number }): { root: THREE.Group; handle: THREE.Object3D; turn(rev: number, dur: number): Promise<void> };
  // ── lights (emissive only, no THREE.Light) ──
  lamp(o: { r: number; color: Hex; shape?: 'dome' | 'bulb' | 'flat' }): LampPart;
  bulbChain(o: { path: V3[] | { rect: [w: number, h: number] }; count: number; colors: Hex[]; r?: number }): BulbChain;
  glow(o: { color: Hex; size: number; intensity?: number }): THREE.Sprite;   // additive fake light
  blobShadow(w: number, d: number, opacity?: number): THREE.Mesh;
  // ── gambling hardware ──
  reel(o: { radius: number; width: number; symbols: SymbolId[]; cell?: number }): ReelPart;
  wheel(o: { radius: number; segments: Array<{ label: TextSource; color: Hex }>; axis: 'vertical' | 'horizontal'; pegs?: boolean; pocketed?: boolean; hub?: Hex }): WheelPart;
  feltTable(o: FeltTableOpts): FeltTablePart;
  stool(o?: { h?: number; seat?: Hex; leg?: Hex }): THREE.Group;
  chips(o: { max: number }): ChipPool;
  cards(o: { max: number; back?: 'red' | 'blue' | 'black'; scale?: number }): CardPool;
  dice(o: { count: number; size?: number; body?: Hex; pip?: Hex }): DicePool;
  coin(o?: { r?: number; thick?: number; heads?: SymbolId; tails?: SymbolId; color?: Hex }): THREE.Mesh;
  balls(o: { max: number; r: number; color?: Hex; metal?: boolean }): BallPool;
  glass(o: { w: number; h: number; d?: number; tint?: Hex; opacity?: number }): THREE.Mesh;
  dome(o: { r: number; tint?: Hex; opacity?: number }): THREE.Mesh;
  cage(o: { r: number; h: number; bars: number; color?: Hex }): THREE.Group;
  // ── characters ──
  /** `feltY`: the table top the dealer works at (FeltTablePart.feltY); reach targets follow it. */
  dealer(o: { style: DealerStyle; height?: number; suit?: Hex; skin?: Hex; feltY?: number }): DealerPart;
  /** Animated actor backed by the Quaternius GLB (placeholder capsule until it loads). */
  mannequin(o?: MannequinOpts): MannequinActor;
  /** Fetch + parse the mannequin GLB once (boot step 9 / menu build) so `mannequin()` has no pop-in. */
  loadMannequin(): Promise<void>;
  // ── props & items ──
  /** Small hand-held / wearable props: hats, masks, briefcase, ledger, shotgun, mint tin, phone… */
  prop(id: string, o?: { color?: Hex; scale?: number }): THREE.Group;
  /** Physical radius item model + glowing floor ring (BRIEF ADDENDUM 8). */
  totem(o: { shape: string; color: Hex; radius: number }): TotemPart;
  // ── states ──
  lockOverlay(size: SlotSize): THREE.Group;     // chains + padlock + CLOSED sign (i18n)
  outOfOrder(size: SlotSize): THREE.Group;      // placeholder cabinet "OUT OF ORDER"
  /** Advance animated actors (mixers, stepped animation). Called once per frame by the loop. */
  update(dt: number): void;
  /** Camera for the mannequin distance LOD (DECISIONS G): far or hidden actors freeze, at most 12 animate. Null = visibility and cap only. */
  setLodCamera(cam: THREE.Camera | null): void;
}

export interface CabinetOpts {
  style: 'upright' | 'slant' | 'lowboy' | 'counter' | 'tower' | 'booth' | 'wall';
  w: number; h: number; d: number;
  body: Hex; trim?: Hex; accent?: Hex;
  bevel?: number;                                        // default 0.03
  screen?: { w: number; h: number; y: number; tilt?: number /* deg */ };
  topper?: { h: number };
  panel?: { y: number; depth: number; tilt?: number };   // control deck shelf
  tray?: boolean; kick?: number /* plinth h, default 0.08 */; grime?: number /* 0..1 */;
}
export interface CabinetPart {
  root: THREE.Group; body: THREE.Mesh;
  anchors: { speaker: THREE.Object3D; screen?: THREE.Object3D; panel?: THREE.Object3D; topper?: THREE.Object3D; tray?: THREE.Object3D; coinSlot?: THREE.Object3D };
  colliders: LocalAABB[]; suggestedPose: PlayPose;
}
export interface ScreenSurface {
  mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; readonly w: number; readonly h: number;
  draw(fn: (g: CanvasRenderingContext2D, s: ScreenSurface) => void): void;   // marks dirty; upload ≤ 1×/frame
  text(str: string, x: number, y: number, o?: TextOpts): number;
  clear(color?: string): void;
  dispose(): void;
}
export interface MarqueePart { root: THREE.Group; setText(t: TextSource): void; chase(p: 'chase' | 'blink' | 'all' | 'off' | 'win', hz?: number): void }
export interface LabelPart { mesh: THREE.Mesh; setText(t: TextSource): void }
export interface NeonPart { root: THREE.Group; setOn(on: boolean): void; flicker(amount: number): void }
export interface ButtonPart { root: THREE.Group; cap: THREE.Mesh; press(dur?: number): Promise<void>; setLit(on: boolean): void; setEnabled(on: boolean): void }
export interface LeverPart { root: THREE.Group; arm: THREE.Object3D; pull(dur?: number /* 0.55 */): Promise<void> }
export interface LampPart { root: THREE.Group; setOn(on: boolean): void; setColor(c: Hex): void; blink(hz: number, dur?: number): void }
export interface BulbChain { root: THREE.InstancedMesh; pattern(p: 'chase' | 'alt' | 'blink' | 'rainbow' | 'all' | 'off', hz?: number): void; setBulb(i: number, c: Hex | null): void }
export interface ReelPart { root: THREE.Group; drum: THREE.Mesh; readonly count: number; angleOf(index: number): number; setIndex(index: number): void; startSpin(speed: number /* rev/s */): void; stopAt(index: number, dur: number, bounce?: number): Promise<void> }
export interface WheelPart { root: THREE.Group; disc: THREE.Object3D; angleOf(i: number): number; spinTo(i: number, turns: number, dur: number): Promise<void>; pegs: THREE.Object3D[] }
/** `w`/`d` are the FULL footprint including the seats (DECISIONS G). */
export interface FeltTableOpts { shape: 'rect' | 'kidney' | 'oval' | 'round' | 'craps'; w: number; d: number; h?: number /* 0.76 */; felt: Hex; rail: Hex; print?: THREE.Texture; seats: number; stools?: boolean; dealer?: boolean }
export interface FeltTablePart { root: THREE.Group; top: THREE.Mesh; seats: SeatDef[]; seatAnchors: THREE.Object3D[]; dealerAnchor: THREE.Object3D; chipTray: THREE.Object3D; colliders: LocalAABB[]; /** Felt top height, m (pass to `dealer({ feltY })`). */ feltY: number }
export type ChipValue = 1 | 5 | 10 | 25 | 100 | 500 | 1000 | 5000;
export interface ChipPool { root: THREE.InstancedMesh; add(v: ChipValue, at: THREE.Vector3): number; stack(vs: ChipValue[], at: THREE.Vector3): number[]; move(id: number, to: THREE.Vector3, dur?: number, arc?: number): Promise<void>; remove(id: number): void; clear(): void; readonly count: number }
export interface CardPool { root: THREE.Group; add(card: CardId | null, at: THREE.Vector3, rotY?: number): number; setCard(id: number, c: CardId): void; flip(id: number, dur?: number): Promise<void>; move(id: number, to: THREE.Vector3, dur?: number, o?: { arc?: number; rotY?: number }): Promise<void>; remove(id: number): void; clear(): void }
export interface DicePool { dice: THREE.Mesh[]; setFace(i: number, face: number): void; roll(i: number, from: THREE.Vector3, to: THREE.Vector3, face: number, dur: number): Promise<void> }
export interface BallPool { root: THREE.InstancedMesh; set(i: number, x: number, y: number, z: number): void; hide(i: number): void; readonly max: number }
export type DealerPose = 'idle' | 'deal' | 'reach' | 'spin' | 'collect' | 'point' | 'bow' | 'arms';
/** Croupier, porcelain, puppet, devil (Quaternius-era styles) and oracle, caller, cashier (Contracts v1.1). */
export type DealerStyle = 'croupier' | 'porcelain' | 'puppet' | 'devil' | 'oracle' | 'caller' | 'cashier';
export interface DealerPart { root: THREE.Group; head: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; handL: THREE.Object3D; handR: THREE.Object3D;
  /** Face proxies (children of `head`): chin and eye line. */
  jaw: THREE.Object3D; eyes: THREE.Object3D; pose(p: DealerPose, dur?: number): Promise<void>; lookAt(target: THREE.Vector3, dur?: number): void; gesture(g: 'deal' | 'collect' | 'spin' | 'point' | 'nod' | 'shake' | 'wave', target?: THREE.Vector3): Promise<void>; idle(on: boolean): void }

// ── Kit extras (DECISIONS C32 / G: moved here from kit/extras.ts in Contracts v1.1) ─────────────────
export interface LedPanelPart { root: THREE.Object3D; screen: ScreenSurface; set(text: string): void; setColor(css: string): void }
export interface PanelButtonSpec { id: string; label?: TextSource; color: Hex; x: number; z: number; w?: number; h?: number; lit?: boolean; font?: FontId }
export interface ButtonPanelOpts { buttons: PanelButtonSpec[]; w: number; d: number; slope?: number /* deg, default 12 */; plate?: Hex; capH?: number }
export interface PanelButton { id: string; /** Anchor at the cap's top centre (panel space). */ root: THREE.Object3D; press(dur?: number): Promise<void>; setLit(on: boolean): void; setEnabled(on: boolean): void }
export interface ButtonPanelPart {
  /** Origin = plate centre, +Y = plate normal; already tilted by `slope`. */
  root: THREE.Group;
  /** The single dynamic mesh holding every cap (raycast target). */
  caps: THREE.Mesh;
  buttons: Record<string, PanelButton>;
  list: PanelButton[];
  /** Which button owns a raycast hit on `caps`. */
  pick(hit: THREE.Intersection): PanelButton | null;
}

/** `CardPool` for atlases whose card ids are plain strings. */
export interface StringCardPool extends Omit<CardPool, 'add' | 'setCard'> {
  add(card: string | null, at: THREE.Vector3, rotY?: number): number;
  setCard(id: number, card: string): void;
}

export interface KitExtras {
  chair(o?: { h?: number; seat?: Hex; wood?: Hex }): THREE.Group;
  crtMonitor(o?: { w?: number; h?: number; px?: [number, number]; scheme?: 'green' | 'amber' | 'cyan' | 'red'; glow?: number }): { root: THREE.Group; screen: ScreenSurface };
  ledPanel(o: { digits: number; color?: string; h?: number }): LedPanelPart;
  plaque(o: { text: TextSource; w?: number; h?: number; color?: Hex }): THREE.Group;
  towerLight(o?: { colors?: [Hex, Hex] }): { root: THREE.Group; top: LampPart; bottom: LampPart };
  stanchion(o?: { h?: number; color?: Hex }): THREE.Group;
  velvetRope(a: V3, b: V3, o?: { sag?: number; color?: Hex }): THREE.Mesh;
  cardShoe(): { root: THREE.Group; mouth: THREE.Object3D };
  decal(o: { tex: THREE.Texture; w: number; h: number; alphaTest?: number }): THREE.Mesh;
  buttonPanel(o: ButtonPanelOpts): ButtonPanelPart;
  /** Card pool on the SON KART / OKEY texgen atlas (string ids: `R7`, `W+4`, `K13`, `FJ`, …; `back` is the card back). */
  cards(o: { max: number; scale?: number; atlas: 'sonkart' | 'okey' }): StringCardPool;
  /** Emissive light strip made of `segments` bars along `axis` (centred): pattern chase / alt / blink / all / off / rainbow. */
  lightStrip(o: { length: number; color: Hex; thickness?: number; segments?: number; axis?: 'x' | 'y' | 'z' }): BulbChain;
}

