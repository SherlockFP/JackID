/**
 * The Big One symbol painters (32 × 32 pixel-art cells, MACHINES §2.1). Shared by the reel strips and by the
 * menu reels (the menu reuses these exact painters). Pure canvas 2D; the caller clears the background.
 *
 * Idle frames: `frame` 0..3 is one step of the symbol's loop (MOTH wings flap, CANDLE flame flickers, SUN rays turn,
 * CROWN gems twinkle, RING gem glints, MAW teeth chatter, GHOST hem waves). Frame 0 is the resting pose.
 * Gilt: `gilt` 0..3 is the stamp level of that symbol: a gold paint over the body and a glint that sweeps the cell.
 */

/** Painted symbol colours (flat, PSX-style). Index = symbol id. */
export const SYMBOL_BG = '#2a1a14';

import { GHOST, MAW } from './rules';

const TAU = Math.PI * 2;
/** Wing height per frame (1 = open): flap = open, half, closed, half. */
const FLAP = [1, 0.6, 0.35, 0.6];
/** Candle flame height per frame. */
const FLAME = [5, 4.2, 5.6, 4.6];
/** Sun ray turn per frame (a quarter of the 45° ray spacing per step). */
const RAY_TURN = Math.PI / 16;
/** Maw teeth chatter offset per frame. */
const CHATTER = [0, 1, 0, -1];
/** Ghost hem height per frame. */
const HEM = [26, 25, 26, 27];
/** Glint position per frame (sweeps the cell corner to corner, then back). */
const GLINT_X = [9, 23, 22, 8];
const GLINT_Y = [8, 12, 24, 22];

/** Draw symbol `sym` into the 32×32 box at (x, y). Unknown ids draw nothing. */
export function paintSymbol(g: CanvasRenderingContext2D, sym: number, x: number, y: number, frame = 0, gilt = 0): void {
  const f = frame & 3;
  g.save();
  g.translate(x, y);
  switch (sym) {
    case 0: { // MOTH: grey body, two wings (flapping), eye-spots
      const flap = FLAP[f];
      g.fillStyle = '#B8B0A0';
      g.beginPath(); g.ellipse(16, 16, 3, 10, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(8, 13, 7, 6 * flap, -0.3, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(24, 13, 7, 6 * flap, 0.3, 0, TAU); g.fill();
      g.fillStyle = '#3A2A20';
      g.beginPath(); g.ellipse(8, 13, 2, 2 * flap, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(24, 13, 2, 2 * flap, 0, 0, TAU); g.fill();
      break;
    }
    case 1: // TOOTH: ivory crown with dark roots
      g.fillStyle = '#F2EAD0';
      g.fillRect(7, 6, 18, 14);
      g.fillStyle = '#6A5040';
      g.fillRect(8, 19, 6, 9); g.fillRect(18, 19, 6, 9);
      g.fillStyle = '#F2EAD0';
      g.fillRect(14, 19, 4, 4);
      break;
    case 2: // KEY: rusty bow, shaft, teeth
      g.fillStyle = '#A0522D';
      g.beginPath(); g.arc(9, 16, 6, 0, TAU); g.fill();
      g.fillStyle = '#2a1a14';
      g.beginPath(); g.arc(9, 16, 2.5, 0, TAU); g.fill();
      g.fillStyle = '#A0522D';
      g.fillRect(14, 14, 14, 4);
      g.fillRect(22, 18, 3, 4); g.fillRect(27, 18, 3, 6);
      break;
    case 3: { // CANDLE: wax body, flickering flame
      g.fillStyle = '#E8D8B0';
      g.fillRect(11, 13, 10, 17);
      g.fillStyle = f === 2 ? '#FFC24A' : '#FFB000';
      g.beginPath(); g.ellipse(16, 9, 3, FLAME[f], 0, 0, TAU); g.fill();
      g.fillStyle = '#FFF2B0';
      g.fillRect(15, 8, 2, 3);
      break;
    }
    case 4: // RING: gold band, red gem (the gem brightens on frame 2)
      g.strokeStyle = '#E8B830'; g.lineWidth = 4;
      g.beginPath(); g.arc(16, 19, 8, 0, TAU); g.stroke();
      g.fillStyle = f === 2 ? '#FF5A6A' : '#C0182A';
      g.beginPath(); g.arc(16, 9, 3.5, 0, TAU); g.fill();
      break;
    case 5: // CROWN: gold points, teal gems (the centre gem twinkles)
      g.fillStyle = '#FFD040';
      g.beginPath();
      g.moveTo(5, 25); g.lineTo(5, 12); g.lineTo(11, 18); g.lineTo(16, 7); g.lineTo(21, 18); g.lineTo(27, 12); g.lineTo(27, 25);
      g.closePath(); g.fill();
      g.fillStyle = f % 2 ? '#A8FFF4' : '#20B0A0';
      g.beginPath(); g.arc(16, 21, 2, 0, TAU); g.fill();
      g.fillStyle = '#20B0A0';
      g.beginPath(); g.arc(10, 22, 1.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(22, 22, 1.6, 0, TAU); g.fill();
      break;
    case 6: { // SUN: face with rays (the rays turn)
      const turn = f * RAY_TURN;
      g.strokeStyle = '#FFC000'; g.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + turn;
        g.beginPath(); g.moveTo(16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11); g.lineTo(16 + Math.cos(a) * 15, 16 + Math.sin(a) * 15); g.stroke();
      }
      g.fillStyle = '#FF7A00';
      g.beginPath(); g.arc(16, 16, 9, 0, TAU); g.fill();
      g.fillStyle = '#FFC000';
      g.beginPath(); g.arc(16, 16, 6, 0, TAU); g.fill();
      break;
    }
    case MAW: { // MAW: lipless mouth, pale teeth (the teeth chatter)
      const d = CHATTER[f];
      g.fillStyle = '#5A0008';
      g.beginPath(); g.ellipse(16, 16, 13, 9, 0, 0, TAU); g.fill();
      g.fillStyle = '#E8E0C8';
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(6 + i * 6, 12 - d); g.lineTo(9 + i * 6, 17); g.lineTo(12 + i * 6, 12 - d); g.fill();
        g.beginPath(); g.moveTo(6 + i * 6, 20 + d); g.lineTo(9 + i * 6, 15); g.lineTo(12 + i * 6, 20 + d); g.fill();
      }
      break;
    }
    case GHOST: { // GHOST: pale sheet, wavy hem (the hem waves), dark eyes
      const h = HEM[f];
      g.fillStyle = '#A0F0FF';
      g.beginPath(); g.arc(16, 13, 10, Math.PI, 0); g.lineTo(26, h);
      g.lineTo(22, 22); g.lineTo(19, h); g.lineTo(16, 22); g.lineTo(13, h); g.lineTo(10, 22); g.lineTo(6, h);
      g.closePath(); g.fill();
      g.fillStyle = '#1a2a30';
      g.fillRect(11, 12, 3, 3); g.fillRect(18, 12, 3, 3);
      break;
    }
    default:
      break;
  }
  if (gilt > 0) {
    // gold paint over the body (source-atop: only the painted pixels take it), then a glint sweeping the cell
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(255, 200, 60, ${0.2 + 0.1 * Math.min(3, gilt)})`;
    g.fillRect(0, 0, 32, 32);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#FFFFFF';
    const gx = GLINT_X[f], gy = GLINT_Y[f];
    g.fillRect(gx - 0.5, gy - 3, 1, 6);
    g.fillRect(gx - 3, gy - 0.5, 6, 1);
  }
  g.restore();
}
