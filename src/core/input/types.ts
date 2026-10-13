/**
 * Input interfaces — TD-FROZEN. Implementation: CORE-INPUT (`core/input.ts`, `core/keymap.ts`).
 * Contract: TECH_SPEC §2.6. `core/input.ts` re-exports everything here so `import type { … } from '@/core/input'`
 * (the spec's path) works — CORE-INPUT must keep the `export type * from './input/types'` line.
 *
 * Default bindings (codes are `KeyboardEvent.code`; mouse: `Mouse0/1/2`, `WheelUp/WheelDown`):
 *   walk:    fwd/back/left/right W S A D + arrows · sprint ShiftLeft · crouch C · interact E · pause Escape
 *            scoreboard (hold) Tab · chat T/Enter · give G · help F1 · debug F3 · debugColliders F4
 *            upgrade U · use F · place B (totem place/pick up) · emote V · ping Mouse1 · talk (hold) N · journal J
 *   machine: primary Space/Mouse0* · secondary F/Mouse2* · up/down/left/right W S A D + arrows ·
 *            betUp X / WheelUp / = · betDown Z / WheelDown / − · betMax Q · confirm Enter · alt R · help H
 *            exit E/Escape · n1..n9 Digit1..9 / Numpad1..9
 *   cutscene: skip (hold) Space/Enter/Escape — everything else suppressed.
 * (*) When the play pose has `mouse:'pick'`, mouse buttons go to `onPointer` instead.
 */
import type * as THREE from 'three';

export type Action =
  | 'fwd' | 'back' | 'left' | 'right' | 'sprint' | 'crouch' | 'interact' | 'pause'
  | 'scoreboard' | 'chat' | 'give' | 'help' | 'debug' | 'debugColliders'
  // tycoon / party / items (ADDENDA 1, 5, 8)
  | 'upgrade' | 'use' | 'place' | 'emote' | 'ping' | 'talk' | 'journal' | 'skip';
export type MachineAction =
  | 'primary' | 'secondary' | 'up' | 'down' | 'left' | 'right' | 'betUp' | 'betDown' | 'betMax'
  | 'confirm' | 'alt' | 'help' | 'exit' | 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'n6' | 'n7' | 'n8' | 'n9';
export const MACHINE_ACTIONS: readonly MachineAction[] = [
  'primary', 'secondary', 'up', 'down', 'left', 'right', 'betUp', 'betDown', 'betMax', 'confirm', 'alt', 'help',
  'exit', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9',
];
/**
 * Resolve a HUD hint action to a binding key. A bare MachineAction ('primary', 'left', 'help' …) means the
 * MACHINE binding (`m.left`); walk actions and explicit `m.*` keys pass through.
 */
export function hintKey(a: Action | `m.${MachineAction}` | MachineAction): BindingKey {
  if (a.startsWith('m.')) return a as BindingKey;
  return (MACHINE_ACTIONS as readonly string[]).includes(a) ? (`m.${a}` as BindingKey) : (a as Action);
}

/** `cutscene`: all gameplay actions suppressed except `skip`/`pause`. */
export type InputMode = 'menu' | 'walk' | 'machine' | 'ui' | 'cutscene';
export type BindingKey = Action | `m.${MachineAction}`;

export interface MachineInputEvent { action: MachineAction; down: boolean; repeat: boolean; t: number }
export interface MachinePointerEvent {
  type: 'down' | 'up' | 'move'; button: 0 | 1 | 2; ndc: THREE.Vector2; t: number;
}
export interface MachineSink {
  onInput(e: MachineInputEvent): void;
  onPointer(e: MachinePointerEvent): void;
  /** `'pick'` = mouse buttons/moves go to `onPointer` only; default `'primary'` = buttons map to primary/secondary. */
  readonly mouse?: 'primary' | 'pick';
}

export interface Input {
  readonly mode: InputMode;
  setMode(m: InputMode): void;
  readonly locked: boolean;                          // pointer lock state
  requestLock(): Promise<boolean>;                   // must be called inside a user-gesture handler
  exitLock(): void;
  // polled (walk mode), valid inside fixedUpdate
  down(a: Action): boolean;
  pressed(a: Action): boolean;                       // went down this step
  released(a: Action): boolean;
  move(): { x: number; z: number };                  // normalized WASD vector
  look(): { dx: number; dy: number };                // px since last step (consumed)
  // event style
  on(a: Action, fn: (down: boolean) => void): () => void;
  setMachineSink(s: MachineSink | null): void;       // events queued & delivered at beginStep()
  readonly pointerNdc: THREE.Vector2;
  bindings(): Record<BindingKey, string[]>;
  rebind(a: BindingKey, codes: string[]): void;
  keyLabel(a: BindingKey): string;                   // localized, e.g. "E", "BOŞLUK", "LMB"
  textFocus(el: HTMLInputElement | null): void;      // chat/name fields; switches to 'ui'
  beginFrame(): void; beginStep(): void; endStep(): void;
}
