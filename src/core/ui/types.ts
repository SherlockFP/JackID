/**
 * UI overlay interface — TD-FROZEN. Implementation: CORE-UI (`ui.ts`, `widgets.ts`, `ui.css`).
 * Contract: TECH_SPEC §2.10, ART_BIBLE §10.
 *
 * DOM overlay `#ui` above the canvas (`pointer-events:none` except panels). Pixel scale CSS var
 * `--px = max(1, floor(innerHeight / 270))`; all sizes are multiples of `--px`. Fonts: headings
 * `Press Start 2P` at 8×--px, body `VT323` at 16×--px. Every text argument is an **already translated**
 * string (call `t()` first).
 */
import type * as THREE from 'three';
import type { Action, MachineAction } from '../input/types';
import type { WinTier } from '@/game/types';

export type ToastKind = 'info' | 'good' | 'bad' | 'warn' | 'sys';
export interface HudHint { action: Action | `m.${MachineAction}` | MachineAction; label: string }
export interface MachineHudSpec {
  title?: string;                 // defaults to machine name
  bet?: number | null;            // shows ◄ BET n ► ; null hides
  showWallet?: boolean;           // default true
  hints: HudHint[];               // key glyph from input.keyLabel + label
  stats?: Array<{ label: string; value: string }>;   // e.g. "STREAK 3"
}
export interface ModalSpec { title: string; body?: string; buttons: Array<{ id: string; label: string; kind?: 'primary' | 'danger' }>; input?: { placeholder: string; maxLength: number; password?: boolean } }
export interface PanelHandle { readonly el: HTMLElement; close(): void }

/**
 * Named HUD targets that world-space numbers can fly to (juice: "+250" pops out of the machine and
 * lands in the wallet counter). The HUD registers its elements with {@link UIOverlay.setAnchor}.
 */
export type HudAnchorId =
  | 'wallet' | 'quota' | 'jackpot' | 'clock' | 'tickets' | 'buffs' | 'charms' | 'upgrades' | 'bank' | (string & {});

export interface FlyOpts {
  /** Start: screen px {x,y}, or a world position projected through `camera`. */
  from: { x: number; y: number } | { world: THREE.Vector3; camera: THREE.Camera };
  to: HudAnchorId;
  text: string;
  color?: string;                 // CSS colour
  dur?: number;                   // s, default 0.8
  onArrive?: () => void;          // e.g. tick the wallet counter, play 'numberTick'
}

export interface UIOverlay {
  readonly root: HTMLElement;
  readonly blocking: boolean;     // true when a modal/panel/chat has focus → Input mode 'ui'
  readonly px: number;            // current integer pixel scale (--px)
  update(dt: number): void;
  prompt(p: { action: Action; label: string; sub?: string; disabled?: boolean } | null): void; // "[E] Play Coin Flip"
  toast(text: string, kind?: ToastKind, dur?: number): void;            // top centre, max 4 stacked, default 2.5 s
  bigWin(amount: number, tier: WinTier, title: string): Promise<void>;  // big 2.5 s, huge 4 s, jackpot 6 s; skippable after 0.8 s
  machineHud(spec: MachineHudSpec | null): void;                        // bottom bar while seated
  subtitle(text: string | null, speaker?: string, dur?: number): void;  // phone dialogue
  choice(title: string, options: string[], o?: { timeout?: number }): Promise<number>;  // −1 on timeout
  modal(spec: ModalSpec): Promise<{ id: string; value?: string } | null>;
  panel(id: string, build: (el: HTMLElement) => (() => void) | void): PanelHandle;
  closePanel(id: string): void;
  crosshair(style: 'dot' | 'hand' | 'none'): void;
  fade(alpha: number, dur: number, color?: string): Promise<void>;
  flash(color: string, dur: number): void;                              // respects settings.reduceFlashing
  setHudVisible(on: boolean): void;
  // ── juice / cutscene extensions (ADDENDA 2, 8) ──
  /** Register (or clear with null) the DOM element that represents a HUD anchor. */
  setAnchor(id: HudAnchorId, el: HTMLElement | null): void;
  /** Centre of an anchor in CSS px, or null if the HUD has not registered it. */
  anchor(id: HudAnchorId): { x: number; y: number } | null;
  /** A number/text that flies from the world/screen into a HUD anchor, then bumps it. */
  fly(o: FlyOpts): void;
  /** Squash-and-pop a HUD anchor (counter just changed). */
  bump(id: HudAnchorId, strength?: number): void;
  /** Cinematic bars, 0 = off, 1 = full (≈ 12 % of height each). */
  letterbox(amount: number, dur?: number): Promise<void>;
  /** "HOLD [SPACE] TO SKIP" ring while a cutscene plays; progress 0..1, null hides. In MP shows vote counts. */
  skipHint(progress: number | null, label?: string): void;
}
