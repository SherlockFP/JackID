/**
 * Night 1 guided onboarding (first run only). A small top-centre prompt and a floor glow with a bobbing arrow point at the
 * next thing to do: walk to The Big One → spin it → deposit at the Debt Terminal → rotate off a Tilted machine → HOT lamp
 * (text only: lamps start at Night 2) → buy a charm at the Pawn Window in the intermission.
 *
 * Nothing here takes input or changes the input mode. The first-run flag is `save.stats['tutorial.n1']`; it is set when the
 * tutorial finishes, is skipped (hold Esc for about a second) or the run leaves Night 1. A run that ends or is quit mid-way
 * keeps the flag unset, so the next first run shows it again.
 *
 * Started by `ingame/session.ts` (`startTutorial`), driven from its frame, disposed with the session. Seeded rng not used.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { DEFAULT_BINDINGS, codeLabels } from '@/core/keymap';
import type { InstanceId, Unsub } from '@/core/types';
import type { WorldHost } from '@/world/world';
import type { DebtRun } from '@/game/run';

export interface TutorialHost {
  readonly world: WorldHost;
  readonly run: DebtRun;
}

export interface Tutorial {
  /** Called every render frame with the real frame time. */
  update(dt: number): void;
  /** Removes the prompt, the glow and the subscriptions. Does not set the first-run flag. */
  dispose(): void;
}

const FLAG = 'tutorial.n1';
/** Hold Esc this long (seconds) to skip. A shorter press is a pause (the pause card opens on its release). */
export const SKIP_HOLD_S = 1;
const GOLD = 0xffd36b;

/** The tutorial currently on screen (one at a time). Lets the pause card and Esc see it without a handle on the session. */
let active: { skip(): void } | null = null;

/** True while the first-run tutorial is on screen (not done, not skipped, not finished). */
export function tutorialActive(): boolean { return active !== null; }

/** Skips the tutorial that is on screen, if any: sets the first-run flag and removes the prompt. */
export function skipTutorial(): void { active?.skip(); }

type Target = 'bigone' | 'debt_terminal' | 'charm_vendor';
interface Step { key: 'walk' | 'spin' | 'deposit' | 'tilt' | 'hot' | 'pawn'; target: Target | null; }

const STEPS: readonly Step[] = [
  { key: 'walk', target: 'bigone' },
  { key: 'spin', target: 'bigone' },
  { key: 'deposit', target: 'debt_terminal' },
  { key: 'tilt', target: null },
  { key: 'hot', target: null },
  { key: 'pawn', target: 'charm_vendor' },
];

/** True once the first-run tutorial has been finished or skipped. */
export function tutorialDone(): boolean {
  try { return (app.save.data.stats[FLAG] ?? 0) > 0; } catch { return false; }
}

function setDone(): void {
  try { app.save.update((d) => { d.stats[FLAG] = 1; }); } catch { /* storage refused: the flag stays in memory only */ }
}

/** Current label of a binding for the prompt ("SPACE"), from the player's keybinds or the defaults. */
function keyLabel(key: string): string {
  const codes = app.save.data.settings.keybinds[key] ?? DEFAULT_BINDINGS[key as keyof typeof DEFAULT_BINDINGS] ?? [];
  return codeLabels(codes, 1)[0] ?? '';
}

/**
 * Start the tutorial for a new Night 1 run. Returns null when it is not needed (already done, or not on Night 1).
 * Machines are looked up lazily, so this may be called before the world has finished building.
 */
export function startTutorial(host: TutorialHost): Tutorial | null {
  const { world, run } = host;
  if (tutorialDone() || run.night() !== 1) return null;
  const self = run.selfId;

  // ── facts, counted from the bus; each step compares against a baseline taken when it starts ─────────────
  let spins = 0, others = 0, deposits = 0, bought = 0;
  let seatMid: InstanceId | null = null;
  const offs: Unsub[] = [];
  offs.push(bus.on('machine:round', (e) => {
    if (e.pid !== self) return;
    if (e.machineId === 'bigone') spins++; else others++;
  }));
  offs.push(bus.on('run:deposit', (e) => { if (e.pid === self) deposits++; }));
  offs.push(bus.on('charm:add', (e) => { if (e.pid === self) bought++; }));
  offs.push(bus.on('player:seat', (e) => { if (e.pid === self) seatMid = e.on ? e.mid : null; }));

  // ── machine lookup (cached once found) ─────────────────────────────────────────────────────────────
  const found = new Map<string, InstanceId>();
  const targetMid = (target: Target): InstanceId | null => {
    const hit = found.get(target);
    if (hit !== undefined) return hit;
    const m = world.machines().find((x) => x.def.id === target);
    if (!m) return null;
    found.set(target, m.id);
    return m.id;
  };
  const bigMid = (): InstanceId | null => targetMid('bigone');

  // ── prompt (DOM, top centre, pointer-events none) ──────────────────────────────────────────────────
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'position:fixed', 'top:14px', 'left:50%', 'transform:translateX(-50%)', 'z-index:60', 'pointer-events:none',
    'max-width:min(560px,calc(100vw - 32px))', 'padding:6px 12px', 'box-sizing:border-box',
    'background:rgba(14,11,8,.8)', 'border:1px solid #c9a24a', 'color:#f1e6cc',
    'font:13px/1.4 inherit', 'text-align:center', 'display:none',
  ].join(';');
  const line = document.createElement('div');
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;opacity:.7;margin-top:3px';
  el.append(line, hint);
  document.body.appendChild(el);

  // ── floor glow and a bobbing arrow over the target ────────────────────────────────────────────────
  const ringGeo = new THREE.RingGeometry(0.42, 0.62, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 5;
  ring.visible = false;
  const arrowGeo = new THREE.ConeGeometry(0.16, 0.4, 4);
  arrowGeo.rotateX(Math.PI);                                  // tip points down at the target
  const arrowMat = new THREE.MeshBasicMaterial({ color: GOLD, depthWrite: false });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.visible = false;
  world.root.add(ring, arrow);

  // ── steps ──────────────────────────────────────────────────────────────────────────────────────────
  let idx = 0;
  let age = 0;
  let total = 0;
  let base = { spins: 0, others: 0, deposits: 0, bought: 0 };
  let holdFrom: number | null = null;
  let disposed = false;

  const enter = (i: number): void => {
    idx = i;
    age = 0;
    base = { spins, others, deposits, bought };
  };
  enter(0);

  /** True when the current step is complete. */
  const complete = (s: Step): boolean => {
    switch (s.key) {
      case 'walk': return bigMid() !== null && seatMid === bigMid();
      case 'spin': return spins - base.spins >= 3;
      case 'deposit': return deposits > base.deposits;
      case 'tilt': return others > base.others || age > 16;
      case 'hot': return age > 9;
      case 'pawn': return bought > base.bought;
    }
  };

  const text = (s: Step): string => {
    switch (s.key) {
      case 'spin': {
        const n = run.pulls();
        return t('tut.spin', { key: keyLabel('m.primary'), n: Number.isFinite(n) ? String(n) : '∞' });
      }
      default: return t(`tut.${s.key}`);
    }
  };

  const finish = (): void => {
    if (disposed) return;
    setDone();
    dispose();
  };

  const skip = (): void => {
    if (disposed) return;
    setDone();
    dispose();
  };
  active = { skip };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && !e.repeat && holdFrom === null) holdFrom = performance.now();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') holdFrom = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (active?.skip === skip) active = null;
    for (const off of offs.splice(0)) off();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    el.remove();
    world.root.remove(ring, arrow);
    ringGeo.dispose(); ringMat.dispose(); arrowGeo.dispose(); arrowMat.dispose();
  }

  const showTarget = (mid: InstanceId | null): void => {
    const slot = mid === null ? undefined : world.slot(mid);
    if (!slot) { ring.visible = false; arrow.visible = false; return; }
    const [x, y, z] = slot.pos;
    const bob = Math.sin(total * 3) * 0.12;
    ring.position.set(x, y + 0.04, z);
    arrow.position.set(x, y + 2.3 + bob, z);
    ring.visible = true;
    arrow.visible = true;
    ringMat.opacity = 0.45 + 0.2 * Math.sin(total * 3);
  };

  return {
    update(dt: number): void {
      if (disposed) return;
      total += dt;
      age += dt;

      // Esc held for SKIP_HOLD_S skips (the pause card may open from the same press; Esc closes it as usual).
      if (holdFrom !== null && performance.now() - holdFrom >= SKIP_HOLD_S * 1000) { skip(); return; }
      // Leaving Night 1 ends the tutorial.
      if (run.night() !== 1) { finish(); return; }

      // Advance through the steps that are complete this frame (a skip past several is allowed).
      while (idx < STEPS.length && complete(STEPS[idx])) {
        if (idx === STEPS.length - 1) { finish(); return; }
        enter(idx + 1);
      }
      if (idx >= STEPS.length) { finish(); return; }

      const s = STEPS[idx];
      line.textContent = text(s);
      hint.textContent = `${t('tut.step', { i: idx + 1, total: STEPS.length })}  ·  ${t('tut.skip')}`;
      el.style.display = '';

      // The pawn window is only worth pointing at in the intermission.
      const wanted = s.target === 'charm_vendor' && run.shift.phase !== 'intermission' ? null
        : s.target !== null ? targetMid(s.target) : null;
      showTarget(wanted);
    },
    dispose,
  };
}
