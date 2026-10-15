/**
 * Night 1 guided onboarding (first run only). A small top-centre prompt and a floor glow with a bobbing arrow point at the
 * next thing to do: walk to The Big One → spin it → deposit at the Debt Terminal → rotate off a Tilted machine → HOT lamp
 * (text only: lamps start at Night 1) → buy a charm at the Pawn Window in the intermission.
 *
 * Steps 1-3 (walk, spin, deposit) hold the Watch clock (`clockHold`), so the first Watch never runs out while the player is still
 * being shown how to play. Nothing here takes input or changes the input mode. The first-run flag is `save.stats['tutorial.n1']`; it is set when the
 * tutorial finishes, is skipped (hold Esc for about a second) or the run leaves Night 1. A run that ends or is quit mid-way
 * keeps the flag unset, so the next first run shows it again.
 *
 * Wave 27: `startTutorial` also owns the BROKE PROMPT (`brokePrompt.ts`): on every fresh Night 1, tutorial done or not, a big centre card lists
 * the ways out of an empty pocket (bank WITHDRAW, the phone, the cashier, the House loan). It rides this object so the session needs no change.
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
import type { UIOverlayX } from '@/core/ui/ui';
import { holdClock, releaseClock } from '@/game/clockHold';
import { inUnderneath } from '@/world/hollow';
import { TILT_FREE_PULLS } from '@/game/data/schedule';
import { createBrokePrompt } from '@/game/brokePrompt';

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
/** The first three steps (walk, spin, deposit) hold the Watch clock. */
const HOLD_STEPS = 3;

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
 * Start the Night 1 helpers for a new run: the first-run tutorial (when it is not done yet) and the broke prompt (every run).
 * Returns null only when the run is not on Night 1. Machines are looked up lazily, so this may be called before the world is built.
 */
export function startTutorial(host: TutorialHost): Tutorial | null {
  if (host.run.night() !== 1) return null;
  const broke = createBrokePrompt(host.run);
  const steps = startSteps(host);
  if (!steps) return broke;
  return {
    update(dt: number): void { steps.update(dt); broke.update(dt); },
    dispose(): void { steps.dispose(); broke.dispose(); },
  };
}

/** The first-run tutorial steps. Null when already done, or not on Night 1. */
function startSteps(host: TutorialHost): Tutorial | null {
  const { world, run } = host;
  if (tutorialDone() || run.night() !== 1) return null;
  const self = run.selfId;

  // ── facts, counted from the bus; each step compares against a baseline taken when it starts ─────────────
  let rounds = 0, others = 0, deposits = 0, bought = 0;
  let seatMid: InstanceId | null = null;
  const offs: Unsub[] = [];
  // Every round counts for the spin step (any machine); `others` (rounds off The Big One) is what the TILT step waits for.
  offs.push(bus.on('machine:round', (e) => {
    if (e.pid !== self) return;
    rounds++;
    if (e.machineId !== 'bigone') others++;
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
  // Bottom-left anchor inside the HUD layer (`.px-tut` in ui.css), above the charm row and clear of PULLS and the top band.
  const el = document.createElement('div');
  el.className = 'px-tut';
  el.setAttribute('role', 'status');
  el.style.display = 'none';
  const line = document.createElement('div');
  const hint = document.createElement('div');
  hint.className = 'hint';
  el.append(line, hint);
  const hudHost: HTMLElement = (app.ui as UIOverlayX | undefined)?.hudLayer ?? document.body;
  hudHost.appendChild(el);
  // The news feed sits under the box (ui/hud.css reads --tut-b): publish the box's bottom edge while it is on screen.
  let shownB = '';
  const placeFeed = (): void => {
    const b = el.style.display === 'none' ? '' : `${el.offsetTop + el.offsetHeight}px`;
    if (b === shownB) return;
    shownB = b;
    if (b) hudHost.style.setProperty('--tut-b', b); else hudHost.style.removeProperty('--tut-b');
  };

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
  let base = { rounds: 0, others: 0, deposits: 0, bought: 0 };
  let holdFrom: number | null = null;
  let disposed = false;

  const enter = (i: number): void => {
    idx = i;
    age = 0;
    base = { rounds, others, deposits, bought };
  };
  enter(0);

  /**
   * True when the current step is complete. Each step's target counts on ANY machine, so the Watch clock hold (steps 1-3) always
   * releases: walk = seated at any machine (The Big One is only the hint), spin = four rounds on any machine.
   */
  const complete = (s: Step): boolean => {
    switch (s.key) {
      case 'walk': return seatMid !== null;
      case 'spin': return rounds - base.rounds >= TILT_FREE_PULLS;   // four full-pay pulls, then rotate (TILT, GDD §3.4.3)
      case 'deposit': return deposits > base.deposits;
      case 'tilt': return others > base.others || age > 16;
      case 'hot': return age > 9;
      case 'pawn': return bought > base.bought;
    }
  };

  const text = (s: Step): string => {
    switch (s.key) {
      case 'spin': {
        return t('econ.spinAny', { key: keyLabel('m.primary') });
      }
      case 'deposit': return t('tut.deposit', { rate: run.interestPct(), n: run.shift.state().segment?.count ?? 3 });
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
    releaseClock('tutorial');
    el.remove();
    hudHost.style.removeProperty('--tut-b');
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
      // THE UNDERNEATH pauses the tutorial: its box and target marker hide, and no step, timer or skip moves until the player is back up.
      if (inUnderneath()) { el.style.display = 'none'; showTarget(null); releaseClock('tutorial'); return; }
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
      if (idx < HOLD_STEPS) holdClock('tutorial', 3); else releaseClock('tutorial');
      line.textContent = text(s);
      hint.textContent = `${t('tut.step', { i: idx + 1, total: STEPS.length })}  ·  ${t('tut.skip')}`;
      el.style.display = '';
      placeFeed();

      // The pawn window is only worth pointing at in the intermission.
      const wanted = s.target === 'charm_vendor' && run.shift.phase !== 'intermission' ? null
        : s.target !== null ? targetMid(s.target) : null;
      showTarget(wanted);
    },
    dispose,
  };
}
