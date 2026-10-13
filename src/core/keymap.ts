/**
 * Key map (CORE-INPUT). Default bindings = the FINAL keymap of TECH_SPEC §11.6 (GDD §10.6 + catalogue §1.3
 * reconciled), the layer rules the input service applies, and localized key / action labels.
 *
 * Codes are `KeyboardEvent.code`; mouse buttons `Mouse0..4`; wheel `WheelUp` / `WheelDown`.
 * Two layers: WALK actions (plain names) and MACHINE actions (`m.<name>`, delivered to the seated machine's sink).
 *
 * `EXTRA_BINDINGS` are §11.6 actions the frozen `Action` / `MachineAction` unions do not name yet (jump, punch card,
 * collect, fast, auto, camera, clear, double …). The input service already delivers them at runtime; once TD adds them
 * to the unions, move them into `DEFAULT_BINDINGS` (the compiler will point at the missing keys).
 */
import type { BindingKey } from './input/types';
import { has, t, upper } from './i18n';

export const DEFAULT_BINDINGS: Record<BindingKey, string[]> = {
  // ── walk ──
  fwd: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'], interact: ['KeyE'], pause: ['Escape'],
  scoreboard: ['Tab'], chat: ['KeyT', 'Enter'], give: ['KeyG'], help: ['F1'], debug: ['F3'], debugColliders: ['F4'],
  upgrade: ['KeyU'], use: ['KeyF'], place: ['KeyB'], emote: ['KeyV'], ping: ['Mouse1', 'KeyZ'],
  talk: ['KeyY'], journal: ['KeyJ'],
  // `skip` is Space in the pit (also the hop key); during cutscenes Enter / Escape count as well (CUTSCENE_SKIP_CODES)
  skip: ['Space'],
  // ── machine (seated) ──
  'm.primary': ['Space', 'Mouse0'],
  'm.secondary': ['Mouse2'],                                  // RMB TAP (< 0.2 s); RMB hold = free-look
  'm.up': ['KeyW', 'ArrowUp'], 'm.down': ['KeyS', 'ArrowDown'], 'm.left': ['KeyA', 'ArrowLeft'], 'm.right': ['KeyD', 'ArrowRight'],
  'm.betUp': ['KeyX', 'WheelUp', 'Equal'], 'm.betDown': ['KeyZ', 'WheelDown', 'Minus'], 'm.betMax': ['KeyB'],
  'm.confirm': ['Enter', 'NumpadEnter'],
  // alt = the machine's second action (charm vendor REROLL, Son Kart JUMP CARD, double-ups). KeyC is free while seated:
  // the walk-layer `crouch` that shares the code is suppressed at a machine (not in SEATED_WALK_ACTIONS).
  'm.alt': ['KeyC'], 'm.help': ['KeyH'], 'm.exit': ['KeyE'],
  'm.n1': ['Digit1', 'Numpad1'], 'm.n2': ['Digit2', 'Numpad2'], 'm.n3': ['Digit3', 'Numpad3'],
  'm.n4': ['Digit4', 'Numpad4'], 'm.n5': ['Digit5', 'Numpad5'], 'm.n6': ['Digit6', 'Numpad6'],
  'm.n7': ['Digit7', 'Numpad7'], 'm.n8': ['Digit8', 'Numpad8'], 'm.n9': ['Digit9', 'Numpad9'],
  // TECH §11.6 machine actions (v1.1)
  'm.collect': ['KeyQ'], 'm.fast': ['KeyF'], 'm.auto': ['KeyG'], 'm.camera': ['KeyV'],
  'm.clear': ['Backspace'], 'm.double': ['KeyR'],   // DECISIONS G: double = R (D stays move)
};

/** §11.6 walk-side actions not yet in the frozen `Action` union. Keys are binding keys, same syntax as above. */
export const EXTRA_BINDINGS: Record<string, string[]> = {
  jump: ['Space'], punch: ['KeyQ'], cheer: ['Digit7'], shrug: ['Digit8'], dance: ['Digit9'],
};

/** Every binding key the service knows (frozen + extra) with its default codes. */
export const ALL_DEFAULTS: Readonly<Record<string, readonly string[]>> = { ...DEFAULT_BINDINGS, ...EXTRA_BINDINGS };

export type Layer = 'walk' | 'machine';
export const layerOf = (key: string): Layer => (key.startsWith('m.') ? 'machine' : 'walk');

/** Walk-layer actions that stay live while seated (everything else is suppressed at a machine). */
export const SEATED_WALK_ACTIONS: ReadonlySet<string> = new Set([
  'pause', 'scoreboard', 'chat', 'debug', 'debugColliders', 'help', 'upgrade', 'journal',
]);
/** During a cutscene these codes act as `skip` in addition to the user's binding. */
export const CUTSCENE_SKIP_CODES: readonly string[] = ['Space', 'Enter', 'NumpadEnter', 'Escape'];
/**
 * Machine actions that may auto-repeat while their key is held (bet ladder, cursor / aim movement). Everything else
 * (primary, confirm, collect, number buttons, device letters …) fires once per physical press: key-repeat never
 * re-triggers a spin, a guess, a deposit or any other irreversible action.
 */
export const REPEATABLE_MACHINE_ACTIONS: ReadonlySet<string> = new Set([
  'betUp', 'betDown', 'betMax', 'up', 'down', 'left', 'right',
]);
/**
 * Machine-layer presses worth replaying when they were made during the glide into the seat (the camera is still moving
 * and the machine sink is not attached yet). Movement, bet ladder, help and exit are deliberately left out.
 */
export const BUFFERABLE_MACHINE_ACTIONS: ReadonlySet<string> = new Set([
  'primary', 'confirm', 'collect', 'fast', 'auto', 'camera', 'clear', 'double', 'alt',
  'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9',
]);
/** Codes whose machine binding fires on a quick TAP only (hold = free-look). */
export const TAP_ONLY_CODES: ReadonlySet<string> = new Set(['Mouse2']);
/** Codes that never reach the game: browser / OS shortcuts the player expects to keep. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);
/** Pure modifiers: never delivered as raw device keys (their state rides on `mods`). */
export const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
]);

const SYMBOLS: Record<string, string> = {
  Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', NumpadAdd: '+', NumpadSubtract: '−', NumpadMultiply: '×',
  NumpadDivide: '/', NumpadDecimal: '.', IntlBackslash: '<',
};

/** Human label for a key code, localized for special keys ("BOŞLUK"). */
export function codeLabel(code: string): string {
  const named = `ui.key.${code}`;
  if (has(named)) return t(named);
  if (SYMBOLS[code]) return SYMBOLS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Mouse')) return 'M' + (Number(code.slice(5)) + 1);
  return upper(code.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

/** Distinct labels of several codes (ShiftLeft + ShiftRight → one "SHIFT"), at most `max`. */
export function codeLabels(codes: readonly string[], max = 2): string[] {
  return [...new Set(codes.map(codeLabel))].slice(0, max);
}

/** Localized label of a binding key ("Raise bet"), for the controls card and the rebinding list. */
export function actionLabel(key: string): string {
  return t(`ui.action.${key}`);
}

/**
 * Walk actions that deliberately share one code (DECISIONS G): skip and jump both use Space in the pit. Sharing is
 * not a conflict, so the rebinding UI never swaps them apart.
 */
export const SHARED_CODES: Readonly<Record<string, readonly string[]>> = { Space: ['skip', 'jump'] };

/** Binding keys of the same layer (other than `key`) that already use `code`, minus deliberate shares. */
export function conflictsFor(bindings: Readonly<Record<string, readonly string[]>>, key: string, code: string): string[] {
  const layer = layerOf(key);
  const shared = SHARED_CODES[code];
  return Object.keys(bindings).filter((k) => {
    if (k === key || layerOf(k) !== layer || !bindings[k].includes(code)) return false;
    return !(shared?.includes(key) && shared.includes(k));
  });
}
