/**
 * Wheel inset (WAVE 20). The seat camera cannot leave the felt, so the wheel is out of shot in the seat view. While a spin
 * runs, the seated player gets a small top-down view of the wheel in the corner: the pockets turn with the rotor, the ball
 * runs on its track, and the winning pocket is ringed and named once the ball lands. It is DOM + 2D canvas only and reads
 * the wheel's own rotations every frame, so it always matches the 3D wheel. Pointer-transparent; hidden when the hold ends.
 *
 * Angles follow the 3D convention: a point at angle φ (about +Y, from +Z towards +X) sits at (sin φ, cos φ) on the wheel.
 * The canvas has +X to the right and +Z down, which is how the seated player sees the table.
 */
import { pocketAngle } from './model';
import { POCKETS, colorOf } from './rules';

const SIZE = 120;            // canvas px
const C = SIZE / 2;
const R_POCKET = 38;         // pocket ring
const R_BALL = 46;           // ball track (outside the pockets, like the 3D track: 0.37 m over a 0.31 m ring)
const R_RIM = C - 3;
const PAINT: Readonly<Record<string, string>> = { red: '#d8443e', black: '#2a2a2a', green: '#2fb063' };
const BRASS = '#ffd040', IVORY = '#f4f0e0', BG = '#06100a';

/** The rotor's and the ball's rotation about +Y, in radians (read from the 3D parts each frame). */
export interface WheelAngles { rotor: number; ball: number }

export class WheelInset {
  private readonly el: HTMLDivElement;
  private readonly g: CanvasRenderingContext2D | null;
  /** performance.now() after which the inset hides; 0 = hidden. */
  private until = 0;
  /** The winning pocket once the ball has landed, else null. */
  private landed: number | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'rl-inset';
    this.el.style.display = 'none';
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE;
    this.el.appendChild(cv);
    this.g = cv.getContext('2d');
    parent.appendChild(this.el);
  }

  /** Shows the inset for `ms` (the spin and a short hold after the landing). */
  show(ms: number): void {
    this.until = performance.now() + ms;
    this.landed = null;
    this.el.style.display = '';
  }

  /** The ball has landed in `pocket`: ring it and name it until the hold ends. */
  land(pocket: number): void { this.landed = pocket; }

  hide(): void {
    this.until = 0;
    this.landed = null;
    this.el.style.display = 'none';
  }

  /** Called every frame while the machine is in view: draws while on screen, hides when the hold is over. */
  update(read: () => WheelAngles): void {
    if (this.until === 0) return;
    if (performance.now() >= this.until) { this.hide(); return; }
    this.draw(read());
  }

  dispose(): void { this.el.remove(); }

  private draw(a: WheelAngles): void {
    const g = this.g;
    if (!g) return;
    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = BG;
    g.beginPath(); g.arc(C, C, R_RIM, 0, Math.PI * 2); g.fill();
    g.strokeStyle = BRASS; g.lineWidth = 2;
    g.beginPath(); g.arc(C, C, R_RIM, 0, Math.PI * 2); g.stroke();
    // pockets, turning with the rotor
    for (let n = 0; n < POCKETS; n++) {
      const phi = pocketAngle(n) + a.rotor;
      g.fillStyle = PAINT[colorOf(n)] ?? PAINT.black;
      g.beginPath(); g.arc(C + R_POCKET * Math.sin(phi), C + R_POCKET * Math.cos(phi), 3.6, 0, Math.PI * 2); g.fill();
    }
    // the winning pocket: a ring and its number in the middle
    if (this.landed !== null) {
      const phi = pocketAngle(this.landed) + a.rotor;
      const x = C + R_POCKET * Math.sin(phi), y = C + R_POCKET * Math.cos(phi);
      g.strokeStyle = BRASS; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = BRASS;
      g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(this.landed), C, C + 1);
    } else {
      g.fillStyle = IVORY;
      g.beginPath(); g.arc(C, C, 4, 0, Math.PI * 2); g.fill();
    }
    // the ball: the ball pivot starts at +X (angle π/2 about the rim) and turns with its rotation
    const phiB = Math.PI / 2 + a.ball;
    g.fillStyle = IVORY;
    g.beginPath(); g.arc(C + R_BALL * Math.sin(phiB), C + R_BALL * Math.cos(phiB), 2.8, 0, Math.PI * 2); g.fill();
  }
}
