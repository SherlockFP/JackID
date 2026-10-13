/**
 * Quota Board (GDD §8.6 WELL-BOARD, PLAN §4.4): a double-sided split-flap style screen 4.0 × 1.5 m hung in the Well at
 * (0, 6.5, −16.5) on two brass chains. Shows DUE, DEPOSITED, TIME LEFT, the co-op "who paid" ledger and a PAID / SHORT
 * stamp. Front faces south (rotY 0), the back faces north. All text is i18n (`prop.quota.*`).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { Hex } from '@/core/types';
import type { QuotaBoardProp } from '../types';
import type { ScreenSurface } from '@/kit/types';
import { t } from '@/core/i18n';
import { Sched } from './sched';

export const BOARD_W = 4.0;
export const BOARD_H = 1.5;

export interface QuotaBoardParts {
  root: THREE.Group;
  front: ScreenSurface;
  back: ScreenSurface;
  chains: THREE.Object3D[];
  dispose(): void;
}

/** `ceiling` = local y of the ceiling the chains hang from (board centre is the origin). */
export function buildQuotaBoard(kit: KitX, o: { ceiling: number }): QuotaBoardParts {
  const root = kit.group('quotaBoard');
  const front = kit.screen({ w: BOARD_W, h: BOARD_H, px: [512, 192], bezel: 0x3a2a14, glow: 0.7, scanlines: true });
  front.mesh.position.z = 0.06;
  root.add(front.mesh);
  const backGroup = kit.group('back');
  backGroup.rotation.y = Math.PI;
  const back = kit.screen({ w: BOARD_W, h: BOARD_H, px: [512, 192], bezel: 0x3a2a14, glow: 0.7, scanlines: true });
  back.mesh.position.z = 0.06;
  backGroup.add(back.mesh);
  root.add(backGroup);

  // brass chains to the dome, one at each end of the board
  const chains: THREE.Object3D[] = [];
  const top = BOARD_H / 2 + 0.05;
  for (const x of [-BOARD_W / 2 + 0.3, BOARD_W / 2 - 0.3]) {
    const c = kit.tube([[x, top, 0], [x, o.ceiling, 0]], 0.012, kit.pal.brass, { seg: 6, radialSeg: 3, parent: root });
    chains.push(c);
  }
  return {
    root, front, back, chains,
    dispose() {
      front.dispose();
      back.dispose();
      root.traverse((obj) => { const m = obj as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}

interface BoardState {
  due: number;
  deposited: number;
  ratio: number;
  timeLeft: number;
  lastCall: boolean;
  ledger: Array<{ name: string; color: Hex; amount: number }>;
  stamp: 'PAID' | 'SHORT' | null;
}

const fmt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const hex = (c: Hex): string => `#${c.toString(16).padStart(6, '0')}`;

export class QuotaBoard implements QuotaBoardProp {
  readonly id = 'quotaBoard';
  readonly root: THREE.Group;
  private readonly sched = new Sched();
  private state: BoardState = { due: 0, deposited: 0, ratio: 0, timeLeft: 0, lastCall: false, ledger: [], stamp: null };
  private stampPulse = 0;

  constructor(private readonly parts: QuotaBoardParts, private readonly kit: KitX) {
    this.root = parts.root;
    this.paint();
  }

  set(q: { due: number; deposited: number; ratio: number; timeLeft: number; lastCall: boolean }): void {
    Object.assign(this.state, q);
    this.paint();
  }

  setLedger(lines: Array<{ name: string; color: Hex; amount: number }>): void {
    this.state.ledger = lines.slice(0, 4);
    this.paint();
  }

  /** PAID or SHORT stamp slams on for 1.6 s, then clears. Resolves when the stamp has cleared. */
  stamp(kind: 'PAID' | 'SHORT'): Promise<void> {
    this.state.stamp = kind;
    this.stampPulse = 0;
    this.paint();
    return this.sched.run(1.6, (k) => {
      this.stampPulse = k < 0.1 ? 1 - k / 0.1 : 0; // slam scale on the first tenth
    }).then(() => {
      this.state.stamp = null;
      this.paint();
    });
  }

  update(dt: number): void {
    const was = this.stampPulse;
    this.sched.update(dt);
    if (this.state.stamp && was !== this.stampPulse) this.paint();
  }

  private paint(): void {
    const s = this.state;
    const draw = (sc: ScreenSurface): void => {
      sc.draw((g, surf) => {
        const W = surf.w, H = surf.h;
        g.fillStyle = '#0d0906';
        g.fillRect(0, 0, W, H);
        const amber = '#ffb000';
        const tex = this.kit.tex;
        // headers
        tex.drawText(g, t('prop.quota.title'), W / 2, 6, { font: 'px5', color: amber, align: 'center', scale: 3 });
        tex.drawText(g, t('prop.quota.due'), W * 0.16, 44, { font: 'px5', color: '#c08a20', align: 'center' });
        tex.drawText(g, t('prop.quota.deposited'), W * 0.5, 44, { font: 'px5', color: '#c08a20', align: 'center' });
        tex.drawText(g, t('prop.quota.timeLeft'), W * 0.84, 44, { font: 'px5', color: '#c08a20', align: 'center' });
        // values
        const vcol = s.lastCall ? '#ff4a3a' : amber;
        tex.drawText(g, fmt(s.due), W * 0.16, 62, { font: 'px5', color: vcol, align: 'center', scale: 3 });
        tex.drawText(g, fmt(s.deposited), W * 0.5, 62, { font: 'px5', color: vcol, align: 'center', scale: 3 });
        tex.drawText(g, clock(s.timeLeft), W * 0.84, 62, { font: 'px5', color: vcol, align: 'center', scale: 3 });
        // ratio bar
        g.fillStyle = '#2a1a10';
        g.fillRect(16, 118, W - 32, 14);
        g.fillStyle = s.ratio >= 1 ? '#7dff7a' : s.lastCall ? '#ff4a3a' : '#ffb000';
        g.fillRect(16, 118, Math.max(0, Math.min(1, s.ratio)) * (W - 32), 14);
        // ledger (co-op)
        tex.drawText(g, t('prop.quota.ledger'), 16, 140, { font: 'px5', color: '#8a6a30', align: 'left' });
        s.ledger.forEach((l, i) => {
          const x = 16 + (i % 2) * (W / 2), y = 152 + Math.floor(i / 2) * 16;
          tex.drawText(g, l.name.slice(0, 12), x, y, { font: 'px5', color: hex(l.color), align: 'left' });
          tex.drawText(g, fmt(l.amount), x + 150, y, { font: 'px5', color: amber, align: 'right' });
        });
        // stamp (rotated, slams in)
        if (s.stamp) {
          const scale = 1 + 0.8 * this.stampPulse;
          g.save();
          g.translate(W * 0.72, H * 0.45);
          g.rotate(-0.18);
          g.scale(scale, scale);
          g.globalAlpha = 0.85;
          const col = s.stamp === 'PAID' ? '#7dff7a' : '#ff4a3a';
          g.strokeStyle = col;
          g.lineWidth = 4;
          g.strokeRect(-90, -30, 180, 60);
          tex.drawText(g, t(s.stamp === 'PAID' ? 'prop.quota.paid' : 'prop.quota.short'), 0, -18, { font: 'px5', color: col, align: 'center', scale: 5 });
          g.restore();
        }
      });
    };
    draw(this.parts.front);
    draw(this.parts.back);
  }

  dispose(): void {
    this.sched.clear();
    this.parts.dispose();
  }
}

/** Factory used by level.ts: builds the board at `pos` (its centre) and wraps it in the prop. */
export function createQuotaBoard(kit: KitX, o: { pos: [number, number, number]; ceiling: number }): QuotaBoard {
  const parts = buildQuotaBoard(kit, { ceiling: o.ceiling - o.pos[1] });
  parts.root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  return new QuotaBoard(parts, kit);
}
