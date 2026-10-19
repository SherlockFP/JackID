/**
 * Night 1 guided onboarding (first run only). A small top-centre prompt and a floor glow with a bobbing arrow point at the
 * next thing to do: walk to The Big One → spin it → deposit at the Bank Terminal. (The charm comes from the Starter Draft, so
 * there is no Pawn Window step.) (Wave 72: the TILT and HOT steps are gone; those readouts wait for Night 2, see `menu/hud/disclose.ts`.)
 *
 * The steps (walk, spin, deposit) hold the Watch clock (`clockHold`), so the first Watch never runs out while the player is still
 * being shown how to play. The box shows a small "clock paused" tag while it holds. Nothing here takes input or changes the input mode. The first-run flag is `save.stats['tutorial.n1']`; it is set when the
 * tutorial finishes, is skipped (hold Esc for about a second) or the run leaves Night 1. A run that ends or is quit mid-way
 * keeps the flag unset, so the next first run shows it again.
 *
 * Wave 72: the OBJECTIVE line. On Nights 1 and 2 one line always names what to do next (`objectiveFor`, menu/hud/disclose.ts), with
 * a waypoint on the target machine. It takes the place of the tutorial box once that box is down (the box carries the same job
 * while it is up), so there is never more than one line of guidance.
 *
 * Wave 27: `startTutorial` also owns the BROKE PROMPT (`brokePrompt.ts`): on every fresh Night 1, tutorial done or not, a big centre card lists
 * the ways out of an empty pocket (bank WITHDRAW, the phone, the cashier, the House loan). It rides this object so the session needs no change.
 *
 * Started by `ingame/session.ts` (`startTutorial`), driven from its frame, disposed with the session. Seeded rng not used.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { lang, t } from '@/core/i18n';
import { DEFAULT_BINDINGS, codeLabels } from '@/core/keymap';
import type { InstanceId, PlayerId, Unsub } from '@/core/types';
import type { WorldHost } from '@/world/world';
import type { DebtRun } from '@/game/run';
import type { UIOverlayX } from '@/core/ui/ui';
import { holdClock, releaseClock } from '@/game/clockHold';
import { inUnderneath } from '@/world/hollow';
import { TILT_FREE_PULLS } from '@/game/data/schedule';
import { createBrokePrompt } from '@/game/brokePrompt';
import { machineName } from '@/game/progression';
import { objectiveFor, objectiveShown, type Objective } from '@/menu/hud/disclose';
import '@/menu/hud/objective.css';

export interface TutorialHost {
  readonly world: WorldHost;
  readonly run: DebtRun;
}

export interface Tutorial {
  /**
   * Called every render frame. The tutorial's own timers (step age, the Esc hold) run on sim time, so slow-mo, hit-stop
   * and pause hold them as they hold the Watch clock. `dt` (the frame's real time) is for the broke prompt only.
   */
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

type Target = 'bigone' | 'debt_terminal';
interface Step { key: 'walk' | 'spin' | 'deposit'; target: Target; }

const STEPS: readonly Step[] = [
  { key: 'walk', target: 'bigone' },
  { key: 'spin', target: 'bigone' },
  { key: 'deposit', target: 'debt_terminal' },
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
 * Start the Night 1 helpers for a new run: the first-run tutorial (when it is not done yet), the objective line (Nights 1-2)
 * and the broke prompt (every run). Returns null only when the run is not on Night 1.
 * Machines are looked up lazily, so this may be called before the world is built.
 */
export function startTutorial(host: TutorialHost): Tutorial | null {
  if (host.run.night() !== 1) return null;
  const broke = createBrokePrompt(host.run);
  const steps = startSteps(host);
  const objective = startObjective(host, () => steps?.shown() ?? false);
  return {
    update(dt: number): void { steps?.update(dt); objective.update(); broke.update(dt); },
    dispose(): void { steps?.dispose(); objective.dispose(); broke.dispose(); },
  };
}

/** The HUD layer (its news feed and `--tut-b` live there). */
function hudHostEl(): HTMLElement {
  return (app.ui as UIOverlayX | undefined)?.hudLayer ?? document.body;
}

/**
 * The root overlay the guidance boxes (`.px-tut`, `.px-obj`) are appended to: one level above the HUD layer, so the floor banner
 * (the big-win layer, z 7) never covers them. The HUD layer's own stacking context (z 1) would keep them under it.
 */
function overlayEl(): HTMLElement {
  return hudHostEl().parentElement ?? hudHostEl();
}

interface Marker { show(mid: InstanceId | null, time: number): void; showAt(obj: THREE.Object3D | null, time: number): void; hide(): void; dispose(): void }

function createMarker(world: WorldHost): Marker {
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
  const hide = (): void => { ring.visible = false; arrow.visible = false; };
  const place = (x: number, y: number, z: number, time: number): void => {
    const bob = Math.sin(time * 3) * 0.12;
    ring.position.set(x, y + 0.04, z);
    arrow.position.set(x, y + 2.3 + bob, z);
    ring.visible = true;
    arrow.visible = true;
    ringMat.opacity = 0.45 + 0.2 * Math.sin(time * 3);
  };
  const tmp = new THREE.Vector3();
  return {
    show(mid: InstanceId | null, time: number): void {
      const slot = mid === null ? undefined : world.slot(mid);
      if (!slot) { hide(); return; }
      const [x, y, z] = slot.pos;
      place(x, y, z, time);
    },
    // A waypoint on a world object (the Bell anchor): its world position, mapped into the overlay's root space.
    showAt(obj: THREE.Object3D | null, time: number): void {
      if (!obj) { hide(); return; }
      obj.getWorldPosition(tmp);
      world.root.worldToLocal(tmp);
      place(tmp.x, tmp.y, tmp.z, time);
    },
    hide,
    dispose(): void {
      world.root.remove(ring, arrow);
      ringGeo.dispose(); ringMat.dispose(); arrowGeo.dispose(); arrowMat.dispose();
    },
  };
}

/** The first-run tutorial steps. Null when already done, or not on Night 1. */
function startSteps(host: TutorialHost): Tutorial & { shown(): boolean } | null {
  const { world, run } = host;
  if (tutorialDone() || run.night() !== 1) return null;
  const self = run.selfId;

  // ── facts, counted from the bus; each step compares against a baseline taken when it starts ─────────────
  let rounds = 0, others = 0, deposits = 0;
  let seatMid: InstanceId | null = null;
  const offs: Unsub[] = [];
  // Every round counts for the spin step (any machine); `others` (rounds off The Big One) is what the TILT step waits for.
  offs.push(bus.on('machine:round', (e) => {
    if (e.pid !== self) return;
    rounds++;
    if (e.machineId !== 'bigone') others++;
  }));
  offs.push(bus.on('run:deposit', (e) => { if (e.pid === self) deposits++; }));
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

  // ── prompt (DOM, top centre, pointer-events none) ──────────────────────────────────────────────────
  // Bottom-left anchor inside the HUD layer (`.px-tut` in ui.css), above the charm row and clear of PULLS and the top band.
  const el = document.createElement('div');
  el.className = 'px-tut';
  el.setAttribute('role', 'status');
  el.style.display = 'none';
  const line = document.createElement('div');
  const hint = document.createElement('div');
  hint.className = 'hint';
  // The clock tag: shown while the box holds the Watch clock (steps 1-3).
  const tag = document.createElement('div');
  tag.className = 'px-clock-tag';
  tag.textContent = t('tut.paused');
  el.append(line, hint, tag);
  const hudHost = hudHostEl();
  overlayEl().appendChild(el);
  // The news feed sits under the box (ui/hud.css reads --tut-b): publish the box's bottom edge while it is on screen.
  let shownB = '';
  const placeFeed = (): void => {
    const b = el.style.display === 'none' ? '' : `${el.offsetTop + el.offsetHeight}px`;
    if (b === shownB) return;
    shownB = b;
    if (b) hudHost.style.setProperty('--tut-b', b); else hudHost.style.removeProperty('--tut-b');
  };

  // ── floor glow and a bobbing arrow over the target ────────────────────────────────────────────────
  const marker = createMarker(world);

  // ── steps ──────────────────────────────────────────────────────────────────────────────────────────
  let idx = 0;
  let age = 0;
  let total = 0;
  let base = { rounds: 0, others: 0, deposits: 0 };
  /** Sim time (app.time.sim) the Esc hold began, for SKIP_HOLD_S. */
  let holdFrom: number | null = null;
  /** Sim time the last update saw; the step timers advance by the sim time that passed since. */
  let seenSim = app.time.sim;
  let disposed = false;

  const enter = (i: number): void => {
    idx = i;
    age = 0;
    base = { rounds, others, deposits };
  };
  enter(0);

  /**
   * True when the current step is complete. Each step's target counts on ANY machine, so the Watch clock hold (steps 1-3) always
   * releases: walk = seated at any machine (The Big One is only the hint), spin = four rounds on any machine.
   */
  const complete = (s: Step): boolean => {
    switch (s.key) {
      case 'walk': return seatMid !== null;
      case 'spin': return rounds - base.rounds >= TILT_FREE_PULLS;   // four full-pay pulls, then the player moves on
      case 'deposit': return deposits > base.deposits;
    }
  };

  /** "BÜYÜK VURGUN" → "Büyük Vurgun" (locale-correct), so the name sits in the card's sentence case, not in capitals. */
  const titleCase = (s: string): string => {
    const loc = lang() === 'tr' ? 'tr-TR' : 'en-US';
    return s.toLocaleLowerCase(loc).replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toLocaleUpperCase(loc));
  };

  const text = (s: Step): string => {
    switch (s.key) {
      case 'walk': return t('tut.walk', { name: titleCase(machineName('bigone')) });   // the machine's own name, in the language on screen, in the card's sentence case
      case 'spin': {
        return t('econ.spinAny', { key: keyLabel('m.primary') });
      }
      case 'deposit': return t('tut.deposit', { rate: run.interestPct(), n: run.shift.state().segment?.count ?? 3 });
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
    if (e.code === 'Escape' && !e.repeat && holdFrom === null) holdFrom = app.time.sim;
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
    marker.dispose();
  }

  /** Hides the box, the target marker and the clock hold. The step and its timer wait (they resume with the next Watch). */
  const hide = (): void => {
    el.style.display = 'none';
    marker.hide();
    releaseClock('tutorial');
    placeFeed();
  };

  return {
    shown: (): boolean => !disposed && el.style.display !== 'none',
    update(): void {
      const sdt = Math.max(0, app.time.sim - seenSim);   // sim seconds since the last update (0 while paused or in hit-stop)
      seenSim = app.time.sim;
      if (disposed) return;
      // THE UNDERNEATH pauses the tutorial: its box and target marker hide, and no step, timer or skip moves until the player is back up.
      if (inUnderneath()) { el.style.display = 'none'; marker.hide(); releaseClock('tutorial'); return; }
      // THE PROLOGUE (wave 72): the apartment holds the tutorial; its box stays hidden and no timer runs until the lift lands (`home:prologue`).
      if (run.prologueOn()) { hide(); return; }

      // Esc held for SKIP_HOLD_S skips (the pause card may open from the same press; Esc closes it as usual).
      if (holdFrom !== null && app.time.sim - holdFrom >= SKIP_HOLD_S) { skip(); return; }
      // Leaving Night 1 ends the tutorial.
      if (run.night() !== 1) { finish(); return; }

      // Only a Watch shows the steps. The Bell's countdown, the settle, and Dawn hide the box; the step waits and
      // resumes with the next Watch.
      const phase = run.shift.state().phase;
      if (phase !== 'play' && phase !== 'lastCall') { hide(); return; }

      total += sdt;
      age += sdt;

      // Advance through the steps that are complete this frame (a skip past several is allowed).
      while (idx < STEPS.length && complete(STEPS[idx])) {
        if (idx === STEPS.length - 1) { finish(); return; }
        enter(idx + 1);
      }
      if (idx >= STEPS.length) { finish(); return; }

      const s = STEPS[idx];
      holdClock('tutorial', 3);
      line.textContent = text(s);
      hint.textContent = `${t('tut.step', { i: idx + 1, total: STEPS.length })}  ·  ${t('tut.skip')}`;
      // A step shows only where it applies: the walk and spin lines step aside while the player sits at the Bank Terminal (the clock stays held).
      const atBank = seatMid !== null && s.key !== 'deposit' && world.machines().some((x) => x.id === seatMid && x.def.id === 'debt_terminal');
      el.style.display = atBank ? 'none' : '';
      placeFeed();
      marker.show(targetMid(s.target), total);
    },
    dispose,
  };
}

/**
 * The OBJECTIVE line (Nights 1 and 2): one line of what to do next, with a waypoint on the target machine. Silent while the tutorial
 * box is up (`boxUp`), since that box carries the same job. Counts rounds and deposits per Night, so each Night starts its own list.
 */
function startObjective(host: TutorialHost, boxUp: () => boolean): { update(): void; dispose(): void } {
  const { world, run } = host;
  const self: PlayerId = run.selfId;
  const el = document.createElement('div');
  el.className = 'px-obj';
  el.style.display = 'none';
  const label = document.createElement('span');
  label.className = 'k';
  label.textContent = t('tut.obj.label');
  const text = document.createElement('span');
  el.append(label, text);
  overlayEl().appendChild(el);
  const marker = createMarker(world);

  let roundsAll = 0, depositsAll = 0;
  const offs: Unsub[] = [];
  offs.push(bus.on('machine:round', (e) => { if (e.pid === self) roundsAll++; }));
  offs.push(bus.on('run:deposit', (e) => { if (e.pid === self) depositsAll++; }));
  let night = run.night();
  let base = { rounds: 0, deposits: 0 };
  let shownKey = '';
  const found = new Map<string, InstanceId>();
  const targetMid = (target: 'bigone' | 'debt_terminal'): InstanceId | null => {
    const hit = found.get(target);
    if (hit !== undefined) return hit;
    const m = world.machines().find((x) => x.def.id === target);
    if (!m) return null;
    found.set(target, m.id);
    return m.id;
  };
  let disposed = false;

  const hide = (): void => {
    el.style.display = 'none';
    marker.hide();
  };

  return {
    update(): void {
      if (disposed) return;
      if (run.night() !== night) { night = run.night(); base = { rounds: roundsAll, deposits: depositsAll }; }
      // At home (the Evening) the HUD's evening card carries the goal (rest, tomorrow's quota); "take the lift" would be wrong there.
      if (!objectiveShown(night) || boxUp() || inUnderneath() || run.prologueOn() || run.homeStage() !== null) { hide(); return; }
      const sh = run.shift.state();
      const o = objectiveFor({
        phase: sh.phase,
        paid: run.nightPaid,
        rounds: roundsAll - base.rounds,
        deposits: depositsAll - base.deposits,
        pocket: run.wallet(self),
        owed: run.bank().left,
      });
      const key = `${night}|${o.key}`;
      if (key !== shownKey) {
        shownKey = key;
        text.textContent = t(`tut.obj.${o.key as Objective}`);
      }
      el.style.display = '';
      // The Bell: its prop anchor when the art lane has placed it; without one, the Debt Terminal (where the Bell hangs) is the waypoint.
      if (o.target === 'bell') {
        const bell = world.anchor('bell');
        if (bell) marker.showAt(bell, app.time.sim);
        else marker.show(targetMid('debt_terminal'), app.time.sim);
      } else {
        marker.show(o.target !== null ? targetMid(o.target) : null, app.time.sim);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of offs.splice(0)) off();
      el.remove();
      marker.dispose();
    },
  };
}
