/**
 * Gamepad layer (CORE-INPUT): the pure part. Standard mapping (Xbox layout, also what Steam Input gives the Deck).
 * The pad is folded into the keyboard model: every press becomes a virtual code ("Pad0" = A) that the input service
 * queues like a key, so walk, seated and cutscene routing is shared. The bindings live in keymap.ts (DEFAULT_PAD_BINDINGS).
 *
 * Codes: `Pad<n>` = standard button n. LT (6) and RT (7) never fire alone: they are SHIFTS. A button pressed while one is
 * held is `Pad6+<n>` / `Pad7+<n>`. `PadLsU/D/L/R` = the left stick as four digital directions (not emitted while walking:
 * walking reads the stick as analog, see `PadState.move`). The right stick is the camera.
 */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

export const PAD_DEADZONE = 0.2;
const STICK_ON = 0.55, STICK_OFF = 0.35;      // digital stick hysteresis
export const PAD_LOOK_RAD_S = 3.4;             // full right-stick deflection at sensitivity 1 (about 195 deg / s)
export const PAD_REPEAT_DELAY_S = 0.4;
export const PAD_REPEAT_S = 0.1;

/** Radial dead zone, rescaled so the output still reaches 1 at full tilt. */
export function stickVec(x: number, y: number, dz = PAD_DEADZONE): { x: number; y: number; mag: number } {
  const m = Math.hypot(x, y);
  if (!(m > dz)) return { x: 0, y: 0, mag: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k, mag: Math.min(1, (m - dz) / (1 - dz)) };
}

/** Look response: slow and precise near the centre, full speed at the rim. */
export const lookCurve = (m: number): number => (m <= 0 ? 0 : m >= 1 ? 1 : m * m);

const BTN_LABEL = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'L3', 'R3', '↑', '↓', '←', '→'];
const STICK_LABEL: Record<string, string> = { PadLsU: 'LS ↑', PadLsD: 'LS ↓', PadLsL: 'LS ←', PadLsR: 'LS →' };

/** Glyph text for a pad code ("A", "LT+X", "↑"). */
export function padLabel(code: string): string {
  if (STICK_LABEL[code]) return STICK_LABEL[code];
  const m = /^Pad(\d+)(?:\+(\d+))?$/.exec(code);
  if (!m) return code;
  const a = BTN_LABEL[Number(m[1])] ?? m[1];
  return m[2] === undefined ? a : `${a}+${BTN_LABEL[Number(m[2])] ?? m[2]}`;
}

export const isPadCode = (c: string): boolean => c.startsWith('Pad');

/** Button order of the seated number actions n1..n9 (RT + button). Also the digit keys sent to overlays. */
export const PAD_DIGIT_BUTTONS: readonly number[] = [PAD.A, PAD.B, PAD.X, PAD.Y, PAD.LB, PAD.RB, PAD.UP, PAD.DOWN, PAD.LEFT];

/** The DOM key a pad code stands for while the game has no walk or seat (menus, panels, cutscene overlays): [code, key]. */
export function padDomKey(code: string, mode: string): [string, string] | null {
  const ch = /^Pad7\+(\d+)$/.exec(code);
  if (ch) { const i = PAD_DIGIT_BUTTONS.indexOf(Number(ch[1])); return i < 0 ? null : [`Digit${i + 1}`, String(i + 1)]; }
  if (mode === 'cutscene') {                    // duel overlays read 1-5: d-pad = 1 2 3 4, X = 5
    const d = ({ Pad14: 1, Pad12: 2, Pad15: 3, Pad13: 4, Pad2: 5 } as Record<string, number>)[code];
    if (d) return [`Digit${d}`, String(d)];
  }
  switch (code) {
    case 'Pad12': case 'PadLsU': return ['ArrowUp', 'ArrowUp'];
    case 'Pad13': case 'PadLsD': return ['ArrowDown', 'ArrowDown'];
    case 'Pad14': case 'PadLsL': return ['ArrowLeft', 'ArrowLeft'];
    case 'Pad15': case 'PadLsR': return ['ArrowRight', 'ArrowRight'];
    case 'Pad0': return ['Enter', 'Enter'];
    case 'Pad1': case 'Pad9': return ['Escape', 'Escape'];
    case 'Pad2': return ['Space', ' '];
    case 'Pad3': return ['KeyE', 'e'];
    case 'Pad4': case 'Pad5': return ['Tab', 'Tab'];
    default: return null;
  }
}

export interface PadSnapshot { buttons: ArrayLike<{ pressed: boolean }>; axes: ArrayLike<number> }
export interface PadEdges { down: string[]; up: string[] }

/** Edge detector over successive pad snapshots. Holds no clock and no DOM, so it tests headless. */
export class PadState {
  /** Left stick (dead zone applied, y down is +), right stick likewise. */
  lx = 0; ly = 0; rx = 0; ry = 0;
  /** True when a button is down or a stick is well off centre (the player is using the pad right now). */
  active = false;
  private held = new Map<string, string>();   // source ('b3', 's:U') -> the code it fired

  /** `digital` = also fire the left stick as PadLsU/D/L/R (every mode but walking). */
  poll(gp: PadSnapshot | null, digital: boolean): PadEdges {
    const out: PadEdges = { down: [], up: [] };
    const btn = (n: number): boolean => !!gp?.buttons[n]?.pressed;
    const ax = (n: number): number => (gp ? gp.axes[n] || 0 : 0);
    const l = stickVec(ax(0), ax(1)), r = stickVec(ax(2), ax(3));
    this.lx = l.x; this.ly = l.y; this.rx = r.x; this.ry = r.y;
    const shift = btn(PAD.LT) ? 'Pad6+' : btn(PAD.RT) ? 'Pad7+' : 'Pad';
    const set = (src: string, want: boolean, code: string): void => {
      const cur = this.held.get(src);
      if (want && !cur) { this.held.set(src, code); out.down.push(code); }
      else if (!want && cur) { this.held.delete(src); out.up.push(cur); }
    };
    for (let n = 0; n < 16; n++) if (n !== PAD.LT && n !== PAD.RT) set(`b${n}`, btn(n), `${shift}${n}`);
    const raw = Math.hypot(ax(0), ax(1));
    const dirs: Array<[string, string, boolean]> = [['U', 'PadLsU', ax(1) < 0], ['D', 'PadLsD', ax(1) > 0], ['L', 'PadLsL', ax(0) < 0], ['R', 'PadLsR', ax(0) > 0]];
    for (const [d, code, side] of dirs) {
      const v = d === 'U' || d === 'D' ? Math.abs(ax(1)) : Math.abs(ax(0));
      const on = this.held.has(`s${d}`);
      set(`s${d}`, digital && side && v >= (on ? STICK_OFF : STICK_ON) && raw > PAD_DEADZONE, code);
    }
    this.active = out.down.length > 0 || raw >= STICK_ON || Math.hypot(ax(2), ax(3)) >= STICK_ON;
    return out;
  }

  /** Codes currently held (for auto-repeat). */
  heldCodes(): string[] { return [...this.held.values()]; }

  /** Release everything (pad unplugged, window blur). */
  releaseAll(): string[] { const c = [...this.held.values()]; this.held.clear(); this.lx = this.ly = this.rx = this.ry = 0; return c; }
}
