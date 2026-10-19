/**
 * THE EVENING (wave 69, Home layer): what the player sees and touches of the flow (docs/WAVE69_HOME.md §2, §3, §7).
 * The run owns the stage and its sim clock (`run.homeState()`, `HOME_TIMING` in run.ts, `RunExt.home` in the save); this module
 * is the presentation and the stations on top of it: the lift's fade, ding and teleport, the apartment's stations (bed, spouse,
 * switch, chain, peephole, window, door), the sleep that ends in the next Night, and the doomed ride (lights, three knocks).
 * The wall phone is the phone UI's (src/game/home/phone.ui.ts): this module leaves that station alone.
 *
 * THE WALK HOME (world/street): the ride up lands the player at the casino's street door, not in the flat. They walk the street
 * and the block's corridor; the Evening's clock waits (`run.homeHold`) until the key turns in their door. The morning and the
 * prologue walk the other way: out of the door, along the street, into the casino door, where the lift takes them down. From
 * Night 3 a taxi at either end skips the street. A world without the street keeps the old straight ride.
 *
 * Every beat is keyed on the run's stage clock, never on a wall clock: the session mounts the controller for solo runs and calls
 * `update(dt)` from the fixed step, so a paused game pauses the ride, a reload resumes it, and two seeded runs match.
 * A restore lands the player in the Evening at `home.spawn`; the doomed ride plays again from the top and then ends the run.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { endCutsceneMode, type InputExt } from '@/core/input';
import { fmtCoins, registerStrings, t } from '@/core/i18n';
import { hashSeed } from '@/core/rng';
import type { Unsub, V3 } from '@/core/types';
import type { UIOverlayX } from '@/core/ui/ui';
import { h } from '@/core/ui/widgets';
import { setDoorOut, shakeDoor as worldShakeDoor, showVisitor } from '@/world/home';
import { setWalk, STREET_ANCHORS, TAXI_NIGHT, walkCue, type WalkLeg } from '@/world/street';
import type { WorldHost } from '@/world/world';
import type { LocalPlayerHost } from '@/player/local';
import { HOME_TIMING, type DebtRun } from '../run';
import { HOME_AMBIENCE, HOME_ANCHORS, HOME_ORIGIN, HOME_SFX, type HomeStage, type HomeStation } from './contract';
import { dreamOf, hooksOf, HARMONY_START } from './phone';
import { ADA_KNOCK_NIGHT, adaPhase, adaSeated } from './ada';
import { CRACK_AMOUNT, createVisit, newVisit, pickCharm, readVisit, rollVisit, tollOf, type KnockIO, type Visit, type VisitResult } from './knock';
import { charmDef } from '../charms/engine';
import type { KeepsakeId } from '../keepsake';
import strings from './evening.strings';
import knockStrings from './knock.strings';
import { openKitchen, type Kitchen } from '../duels/promise/kitchen';
import { stakeFor, type FlowResult } from '../duels/promise/flow';
import type { Hand } from '../duels/promise/rules';
import { BASE_RUN_NIGHTS } from '../data/schedule';
import { hintsHeard } from '../story/chapter';

registerStrings(strings.prefix, { en: strings.en, tr: strings.tr });
registerStrings(knockStrings.prefix, { en: knockStrings.en, tr: knockStrings.tr });

/** One step out of the lift gate on the casino floor (m). */
const LIFT_STEP = 2.2;
/** The body stands this far above the flat's floor line when placed (anchors may sit at eye height; gravity settles it). */
const STAND_LIFT = 0.05;
/** The peephole look (sim s): the camera eases to the eyehole, holds, and the player's own glide brings it back. */
const PEEP_SEC = 2.5;
const PEEP_MOVE_SEC = 0.4;
const PEEP_IN_SEC = 0.25;
const PEEP_OUT_SEC = 0.35;
/** A seated player (the lift lever is pulled from the Debt Terminal's seat) gets this long to stand before the ride forces the move. */
const SEAT_WAIT_SEC = 1;
/** The doomed lights: toggles at these offsets from `flickerAt` (even = off, odd = on), so the room ends lit. */
const FLICKER: readonly number[] = [0, 0.12, 0.26, 0.55, 0.66, 1.0, 1.1, 1.35];
/** The window's one-liners (`evening.window.1`..`4`). */
const WINDOW_LINES = 4;
/** THE PROLOGUE (wave 72): the scene's id (story/cutscenes/prologue.cutscene.ts) and the objective's repeat (sim s). */
export const PROLOGUE_CUT = 'prologue';
/** ADA (story A2): a visit Evening's knock lands this long after the arrival; her night knock (N6+, texts unanswered) after this, and she stands there this long. */
const VISIT_KNOCK_SEC = 5;
const NIGHT_KNOCK_SEC = 30;
const AT_DOOR_SEC = 15;
const OBJECTIVE_EVERY_SEC = 60;   // the "take the lift down" toast: once at the start, then at most every minute

/** World position, yaw and look direction of an anchor. Forward is the anchor's -Z, the walk and camera convention (-sin yaw, -cos yaw). */
export function anchorPose(o: THREE.Object3D): { pos: THREE.Vector3; yaw: number; dir: THREE.Vector3 } {
  o.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  o.getWorldPosition(pos);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  return { pos, yaw: Math.atan2(-dir.x, -dir.z), dir };
}

/** Seconds a spoken line stays up: a floor for short ones, a cap for long ones. */
export function lineSeconds(text: string): number {
  return Math.min(6, Math.max(2.2, 1.2 + text.length * 0.05));
}

const calmish = (): { calm: boolean; noFlash: boolean } => {
  try {
    const s = app.save.data.settings;
    return { calm: s.calm === true, noFlash: s.reduceFlashing === true };
  } catch { return { calm: false, noFlash: false }; }
};
const sfx = (name: string, o: { vol?: number; pitch?: number } = {}): void => {
  try { app.audio.play(name, { vol: o.vol, pitch: o.pitch, priority: 8 }); } catch { /* audio is optional */ }
};
const ambience = (id: string, fade: number): void => {
  try { app.audio.ambience(id, fade); } catch { /* audio is optional */ }
};

export interface Evening {
  /** Called once per fixed step, after `run.tick`. */
  update(dt: number): void;
  dispose(): void;
}

/** Mounts the Evening controller on a solo run's session. Returns its `update` and disposer. */
export function mountEvening(run: DebtRun, world: WorldHost, player: LocalPlayerHost): Evening {
  const T = HOME_TIMING;
  const D = HOME_TIMING.doomed;
  const offs: Unsub[] = [];
  const ui = (): UIOverlayX => app.ui as UIOverlayX;

  /** The stage the presentation shows now (null: the casino floor). A mount that finds a restored stage treats it as an arrival. */
  let last: HomeStage | null = null;
  /** The player is in the flat (placed by the ride), so a wake-up has somewhere to come back from. */
  let atHome = false;
  let wantLock = false;
  let locked = false;
  let faded = false;
  let beats = { ding: false, tp: false, fadeIn: false, flick: 0, knocks: 0 };
  let seatWait = 0;
  /** The spouse's lines in flight: the next one shows when `wait` runs out (sim s). */
  let talk: Array<{ text: string; sec: number }> = [];
  let talkWait = 0;
  let talkMood: 'calm' | 'cheery' | 'sad' = 'calm';
  let peep: { el: HTMLDivElement; t: number } | null = null;
  /** The Evening's visitor (wave 71): the machine over the state kept in the phone's save slice, null when none comes. */
  let visit: Visit | null = null;
  /** A walk input or an interaction since the last step (the Listener hears it). */
  let movedFlag = false;
  /**
   * THE PROLOGUE (wave 72): `start` until the world is ready, `talk` while the scene plays (the spouse, the call), `walk` when the
   * objective "take the lift down" is up and the front door takes the lift, `lift` while the ride runs, `done` after it (and always
   * on a resumed or non-Home run). Sim time only: the scene and the ride count the fixed step, the run holds the clock.
   */
  let pro: 'start' | 'talk' | 'walk' | 'lift' | 'done' = run.prologueOn() ? 'start' : 'done';
  /** THE WALK (world/street): the leg under way; `past` = home: the key has turned (the Evening runs), out: the door is behind. */
  let walk: { leg: WalkLeg; past: boolean; doorOpen: boolean } | null = null;
  /** The lift down from the casino's street door (the prologue, the morning): its clock and beats, then what comes after. */
  let lift: { t: number; ding: boolean; tp: boolean; fadeIn: boolean; done: () => void } | null = null;
  let objectiveT = 0;
  let disposed = false;
  /** ADA'S KITCHEN TABLE (wave 78): the open overlay, the Nights already played, the offer's wait (sim s) and cooldown. */
  let kitchen: Kitchen | null = null;
  const kitchenPlayed = new Set<number>();
  let offerWait = -1;
  let offerCool = 0;
  let offering = false;

  /** Ada is at the table (always in the prologue; then by phase: a visit Evening across the hall, every Evening from N5 unless Harmony 0). */
  let adaHere = true;
  /** Ada stands in the hall (her night knock): the peephole shows her. */
  let adaAtDoor = false;

  // ── small presentation helpers ─────────────────────────────────────────────────────────────────────
  const fadeTo = (alpha: number, dur: number): void => {
    faded = alpha > 0;
    void app.ui.fade(alpha, dur, '#000');
  };
  /** Input locks (cutscene mode: look and walk suppressed) once the player is standing; never over a seat, a panel or a scene. */
  const tryLock = (): void => {
    if (!wantLock || locked || world.seat || app.input.mode !== 'walk') return;
    app.input.setMode('cutscene');
    locked = true;
  };
  const unlock = (): void => {
    wantLock = false;
    if (!locked) return;
    locked = false;
    if (!app.cutscene.playing) endCutsceneMode(app.input as InputExt, 'walk');
  };
  /** A line for the player: the subtitle bar, or a toast when subtitles are off (the lines carry the Evening's news). */
  const say = (text: string, who: string, sec: number): void => {
    let subs = true;
    try { subs = app.save.data.settings.subtitles !== false; } catch { /* default on */ }
    if (subs) app.ui.subtitle(text, who, sec);
    else { ui().dismissToasts(); ui().toast(text, 'info', sec); }   // one centre line at a time: the Evening's older hint steps aside
  };

  // ── placing the player ─────────────────────────────────────────────────────────────────────────────
  /** Stands the player at a Home or street anchor (false when the world has none). */
  const placeAt = (name: string): boolean => {
    const a = world.anchor(name);
    if (!a) return false;
    const p = anchorPose(a);
    player.teleport(new THREE.Vector3(p.pos.x, HOME_ORIGIN[1] + STAND_LIFT, p.pos.z), p.yaw);
    // the camera rig is suspended during a cutscene (the prologue plays right after this), so it never moves the camera to the
    // flat. The world culls zones and lights from `camera.position`, so the flat's pose is written here as well: without it
    // the apartment (about 170 m from the pit camera) is culled and the scene renders black.
    const eye = HOME_ORIGIN[1] + STAND_LIFT + player.eyeHeight;
    app.camera.position.set(p.pos.x, eye, p.pos.z);
    app.camera.quaternion.setFromEuler(new THREE.Euler(0, p.yaw, 0));
    return true;
  };
  /** The lift arrives: the player stands inside the front door, the lights are on, the chain is off, the spouse is in her chair. */
  const placeHome = (): boolean => {
    if (!placeAt(HOME_ANCHORS.spawn)) return false;
    const home = world.home;
    home?.setLights(true);
    home?.setChain(false);
    home?.setSpouse(pro !== 'done' || adaHere, adaPhase(run.night()));
    ambience(HOME_AMBIENCE, 1.5);
    atHome = true;
    return true;
  };
  /** The bed opened the next Night: the player steps out of the lift, in front of the gate, facing the pit. */
  const placeFloor = (): void => {
    const d = world.anchor('elevator.door');
    if (d) {
      const p = anchorPose(d);
      player.teleport(new THREE.Vector3(p.pos.x, 0, p.pos.z + LIFT_STEP), Math.PI);
    } else {
      const s = world.spawn('solo');
      player.teleport(new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]), s.yaw);
    }
    ambience('pit', 1.5);
    atHome = false;
  };

  // ── THE WALK (world/street) ────────────────────────────────────────────────────────────────────────
  const streetBuilt = (): boolean => !!world.anchor(STREET_ANCHORS.arrive);
  const taxiTonight = (): boolean => run.night() >= TAXI_NIGHT;
  /** The ride up lands at the casino's street door: the flat is made ready for later, the walk home begins. */
  const placeStreet = (): boolean => {
    if (!placeAt(STREET_ANCHORS.arrive)) return false;
    world.home?.setLights(true);
    world.home?.setChain(false);
    void world.home?.doorTo(0, 0);
    ambience(HOME_AMBIENCE, 1.5);
    atHome = false;
    walk = { leg: 'home', past: false, doorOpen: false };
    setWalk('home', taxiTonight());
    return true;
  };
  /** The ride's teleport: the street when it is built (the doom still lands in the flat). */
  const placeRide = (stage: HomeStage): boolean => (stage === 'ride' && streetBuilt() ? placeStreet() : placeHome());
  /** The key turns in your door (or the taxi, or a jump home): the Evening's clock runs from here. */
  const reachHome = (openDoor: boolean): void => {
    if (!walk || walk.leg !== 'home' || walk.past) return;
    walk.past = true;
    setWalk(null);
    run.homeHold(false);
    atHome = true;
    if (openDoor) { sfx(HOME_SFX.lockTurn); walk.doorOpen = true; void world.home?.doorTo(1, 0.9); }
    beginEvening(true);
  };
  /** Straight in (the taxi's fade, or a station used while still out): at the front door, inside. */
  const jumpHome = (): void => {
    if (!walk || walk.leg !== 'home' || walk.past) return;
    placeHome();
    reachHome(false);
    walk = null;
  };
  const taxiHome = (): void => {
    if (!walk || walk.leg !== 'home' || walk.past || run.homeStage() !== 'evening') return;
    sfx('doorSlam', { vol: 0.35, pitch: 1.3 });
    wantLock = true;
    fadeTo(1, 0.5);
    app.timers.sim.after(0.7, () => {
      if (disposed) return;
      jumpHome();
      unlock();
      fadeTo(0, 0.8);
    });
  };
  /** The walk out (the prologue, the morning): the front door opens from inside, the goal is the casino door. */
  const startWalkOut = (): void => {
    walk = { leg: 'out', past: false, doorOpen: false };
    setDoorOut(true);
    setWalk('casino', pro === 'done' && taxiTonight());
  };
  const openOut = (): void => {
    if (!walk || walk.leg !== 'out' || walk.doorOpen || walk.past) return;
    walk.doorOpen = true;
    sfx(HOME_SFX.lockTurn);
    void world.home?.doorTo(1, 0.9);
  };
  /** The casino door: the lift down. The prologue ends at the bottom; a morning shows the Night's banner there. */
  const toCasino = (): void => {
    if (pro === 'walk') { pro = 'lift'; startLift(() => { pro = 'done'; run.finishPrologue(); }); return; }
    startLift(() => { void ui().banner(t('ingame.night', { n: run.night() })); });
  };
  /** Where the player stands decides the walk's next beat (config `walkCue`). */
  const tickWalk = (): void => {
    if (!walk || lift) return;
    const cue = walkCue(walk.leg, player.pos.x - HOME_ORIGIN[0], player.pos.z - HOME_ORIGIN[2]);
    if (walk.leg === 'home') {
      if (run.homeStage() !== 'evening') return;   // the ride is still fading in
      if (cue === 'door' && !walk.past) reachHome(true);
      else if (cue === 'in') {
        if (!walk.past) reachHome(false);
        if (walk?.doorOpen) void world.home?.doorTo(0, 0.8);   // in and clear of the leaf: it shuts behind you
        walk = null;
      }
      return;
    }
    if (cue === 'hall' && walk.doorOpen) {
      walk.doorOpen = false;
      walk.past = true;
      setDoorOut(false);
      void world.home?.doorTo(0, 0.8);
    } else if (cue === 'lift') toCasino();
  };

  // ── stages ─────────────────────────────────────────────────────────────────────────────────────────
  const startRide = (): void => {
    beats = { ding: false, tp: false, fadeIn: false, flick: 0, knocks: 0 };
    seatWait = 0;
    wantLock = true;
    ui().dismissToasts();   // the lift starts clean: the pit's news (a stale toast, a quota line) does not ride up with the player
    if (world.seat) world.standUp();   // the lever is pulled from the terminal's seat
    fadeTo(1, T.dark);
  };

  const arriveEvening = (from: HomeStage | null): void => {
    if (from === 'ride') {
      if (!beats.tp) { beats.tp = true; placeRide('ride'); }
      if (!beats.fadeIn) { beats.fadeIn = true; fadeTo(0, 0.5); }
    } else {
      // a restored Evening: the front door, out of the dark
      const s = run.homeState();
      if (placeHome()) { world.home?.setLights(s.lights); world.home?.setChain(s.chain); }
      fadeTo(1, 0);
      fadeTo(0, 0.9);
    }
    unlock();
    if (walk?.leg === 'home' && !walk.past) {
      // on the street: the Evening waits for the door (its clock holds, the visitor and Ada come once you are in)
      run.homeHold(true);
      ui().dismissToasts();
      ui().toast(t('evening.walk.home'), 'sys', 6);
      return;
    }
    beginEvening(from === 'ride');
  };

  /** The Evening proper: the visitor's roll, Ada's plan, the kitchen wager, the hint. */
  const beginEvening = (fresh: boolean): void => {
    movedFlag = false;
    beginVisit(fresh);
    planAda(fresh);
    if (wagerDue()) queueOffer();   // THE KITCHEN WAGER: Ada's table comes before the free walk
    ui().dismissToasts();   // the arrival hint is the only centre-top line of the Evening: stale toasts from the pit step aside
    ui().toast(t('evening.hint'), 'sys', 5);
  };

  const startSleep = (): void => {
    endVisit();   // the auto-sleep can end an Evening with a visitor in the hall: an act still running is a fail
    wantLock = true;
    sfx(HOME_SFX.bed);
    fadeTo(1, T.sleep - 0.3);
    // Harmony 0 has no Ada: the bed shows the note instead (across the hall: her door stays shut)
    if ((run.homePhone()?.harmony() ?? HARMONY_START) <= 0) say(t(adaPhase(run.night()) === 'across' ? 'evening.note.across' : 'evening.note'), t('evening.speaker.note'), 3.5);
  };

  const leaveHome = (from: HomeStage | null): void => {
    if (from === null) return;
    endVisit();
    adaAtDoor = false;
    if (from === 'sleep' && atHome && streetBuilt()) {
      // the morning: wake in the flat and walk to the casino; the Night's banner waits for the lift down
      startWalkOut();
      unlock();
      fadeTo(0, 0.9);
      ui().toast(t('evening.walk.out'), 'sys', 6);
      const dream = dreamOf(run.homePhone());
      if (dream) say(t(dream.key), '', 5);
      return;
    }
    if (atHome) placeFloor();
    unlock();
    fadeTo(0, 0.9);
    void ui().banner(t('ingame.night', { n: run.night() }));
    // the Night's dream (rolled when the bed closed the last Night) is a line of the apartment, not a banner: the banner queue
    // can sit behind the Dawn banner for seconds, and the dream belongs to the waking moment, so it speaks through the subtitle
    const d = dreamOf(run.homePhone());
    if (d) say(t(d.key), '', 5);
  };

  const change = (from: HomeStage | null, to: HomeStage | null): void => {
    if (to === 'ride' || to === 'doomed') startRide();
    else if (to === 'evening') arriveEvening(from);
    else if (to === 'sleep') startSleep();
    else leaveHome(from);
  };

  /** The ride, in the run's stage clock: dark, ding, the teleport under black, the fade back in. The doom goes on from there. */
  const rideBeats = (dt: number, stage: HomeStage, left: number): void => {
    const e = (stage === 'doomed' ? D.end : T.ride) - left;
    if (!beats.ding && e >= T.dark) { beats.ding = true; sfx(HOME_SFX.ding); }
    if (!beats.tp && e >= T.teleport) {
      seatWait += dt;
      if (!world.seat || seatWait >= SEAT_WAIT_SEC) {
        // no apartment built (a world without the Home room): give up on the move once the ride is over, the flow still runs
        if (placeRide(stage) || e >= T.ride) beats.tp = true;
      }
    }
    if (beats.tp && !beats.fadeIn && e >= T.fadeIn) { beats.fadeIn = true; fadeTo(0, 0.9); }
    if (stage !== 'doomed') return;
    if (e >= T.ride) unlock();
    // the doom: the lights flicker (never in Calm or with reduced flashing), then three knocks at the door
    const m = calmish();
    if (e >= D.flickerAt && !m.calm && !m.noFlash) {
      const rel = e - D.flickerAt;
      while (beats.flick < FLICKER.length && rel >= FLICKER[beats.flick]) {
        world.home?.setLights(beats.flick % 2 === 1);
        beats.flick++;
      }
    }
    while (beats.knocks < D.knocks.length && e >= D.knocks[beats.knocks]) {
      const k = beats.knocks++;
      sfx(HOME_SFX.knock, { vol: 0.7 + 0.15 * k });
      if (!m.calm) player.shake(0.012, 0.18);   // the jolt of the knock; Calm Mode keeps the camera still
    }
  };

  // ── the visitor (wave 71, src/game/home/knock.ts): sound first, light second ────────────────────────
  const sfxAt = (name: string, o: { vol?: number; pitch?: number } = {}): void => {
    try {
      const pos = world.anchor(HOME_ANCHORS.hall) ?? undefined;
      app.audio.play(name, { vol: o.vol, pitch: o.pitch, priority: 8, pos });
    } catch { /* audio is optional */ }
  };
  /** The subtitle twin of a cue. Only with subtitles on: the cue itself is the sound or the light. */
  const caption = (key: string): void => {
    let subs = true;
    try { subs = app.save.data.settings.subtitles !== false; } catch { /* default on */ }
    if (subs) app.ui.subtitle(t(`knock.${key}`), '', 3);
  };
  const shakeDoor = (amp: number): void => {
    if (calmish().calm) return;   // Calm Mode: no jolts
    worldShakeDoor(amp, 0.3);
    player.shake(0.01, 0.15);
  };

  /** A finished visit: Heat, Harmony, the toll from the pocket and the Picker's charm. Runs once per visit. */
  const applyResult = (r: VisitResult): void => {
    const hooks = hooksOf(run.homePhone());
    if (r.heat) hooks?.heat(r.heat, r.kind);
    if (r.harmony) { hooks?.harmony(r.harmony); ui().toast(t('knock.harmony'), 'info', 3.5); }
    const toll = tollOf(r.tollPct, run.wallet(), run.debt().due);
    if (toll > 0 && run.spend('coin', toll, 'knock.toll')) ui().toast(t('knock.toll', { n: toll }), 'warn', 3.5);
    if (r.steal) {
      const owned = run.charms().map((c) => ({ id: c.id, rarity: charmDef(c.id)?.rarity ?? 'common' }));
      const id = pickCharm(run.seed, run.night(), owned);
      if (id && run.loseCharm?.(id)) ui().toast(t('knock.stolen', { name: t(`charm.${id}.name`) }), 'warn', 4);
    }
    run.homeSaveNow();   // the visit's outcome is in the pocket and the phone now: one save at the verdict, not a coalesced one
  };

  const io: KnockIO = {
    footstep(i, n, leaving) {
      const k = (i + 1) / n;
      sfxAt('footstepConcrete', { vol: leaving ? 0.55 * (1 - k * 0.8) : 0.2 + 0.45 * k, pitch: leaving ? 0.95 : 0.9 + 0.1 * (i % 2) });
      if (i === 0 && leaving) caption('leave');
    },
    shadow: (on) => {
      world.home?.setDoorShadow(on);
      showVisitor(on && visit ? visit.state.kind : null);   // the figure stands in the hall as long as his shadow is on the strip
    },
    knock() {
      sfxAt(HOME_SFX.knock, { vol: 0.9 });
      app.timers.sim.after(0.35, () => sfxAt(HOME_SFX.knock, { vol: 0.9 }));
      app.timers.sim.after(0.7, () => sfxAt(HOME_SFX.knock, { vol: 1 }));
    },
    shove(i) {
      sfxAt('doorSlam', { vol: 0.45 + 0.1 * i, pitch: 0.7 });
      shakeDoor(0.6 + 0.2 * i);
    },
    chainRattle: () => sfx(HOME_SFX.chain, { vol: 0.9 }),
    scrape: () => sfxAt(HOME_SFX.lockTurn, { vol: 0.6, pitch: 0.85 + 0.1 * (Math.floor(visit?.state.n ?? 0) % 3) }),
    crack(open) { void world.home?.doorTo(open ? CRACK_AMOUNT : 0, open ? 0.15 : 0.4); },
    caption,
    resolve: applyResult,
  };

  /** Starts the Evening's visit: a roll for a fresh Evening, or the saved visit of a restored one. */
  const beginVisit = (fresh: boolean): void => {
    visit = null;
    const phone = run.homePhone();
    const hooks = hooksOf(phone);
    if (!phone || !hooks) return;
    if (fresh) {
      const plan = rollVisit(run.seed, run.night(), phone.heat());
      if (!plan) { hooks.setVisit(null); return; }
      const st = newVisit(run.night(), plan, calmish().calm);
      hooks.setVisit(st);
      visit = createVisit(st, io);
      return;
    }
    const st = readVisit(hooks.visit());
    if (!st || st.night !== run.night() || st.phase === 'done') { hooks.setVisit(null); return; }
    hooks.setVisit(st);
    visit = createVisit(st, io);
    visit.resume();   // caught mid-act: a fail; the door and the hall start over
  };
  /** Two soft knocks at the door (hers; the Collector's are three and hard). Calm Mode keeps the sound down; the caption stays. */
  const softKnock = (): void => {
    if (!calmish().calm) { sfxAt(HOME_SFX.knock, { vol: 0.35 }); app.timers.sim.after(0.5, () => sfxAt(HOME_SFX.knock, { vol: 0.35 })); }
    caption('ada.knock');
  };
  /**
   * Who sits at the table this Evening (story A2, ada.ts). Across the hall she only visits: on a fresh arrival the chair is empty
   * until her knock, then she sits. From N6, with a text of hers unanswered, she knocks at night and stands in the hall (the peephole).
   */
  const planAda = (fresh: boolean): void => {
    const night = run.night();
    const phone = run.homePhone();
    const here = adaSeated(run.seed, night, phone?.harmony() ?? HARMONY_START);
    const visiting = fresh && here && adaPhase(night) === 'across';
    adaHere = here && !visiting;
    world.home?.setSpouse(adaHere, adaPhase(night));
    const live = (): boolean => !disposed && run.homeStage() === 'evening' && run.night() === night;
    if (visiting) {
      app.timers.sim.after(VISIT_KNOCK_SEC, () => {
        if (!live()) return;
        softKnock();
        say(t('evening.visit.knock'), t('evening.speaker.spouse'), 3.5);
        adaHere = true;
        world.home?.setSpouse(true, 'across');
      });
    } else if (fresh && night >= ADA_KNOCK_NIGHT && !visit && phone?.messages().some((m) => m.thread === 'spouse' && m.answered === null)) {
      app.timers.sim.after(NIGHT_KNOCK_SEC, () => {
        if (!live() || visit?.atDoor()) return;
        softKnock();
        adaAtDoor = true;
        app.timers.sim.after(AT_DOOR_SEC, () => { adaAtDoor = false; });
      });
    }
  };
  const endVisit = (): void => {
    visit?.abandon();
    visit = null;
  };

  /** What the Listener hears: a walk input (the body moving or a key held), or any interaction. */
  const heardMoving = (): boolean => {
    let moving = player.speed > 0.2;
    try { const m = app.input.move(); if (m.x !== 0 || m.z !== 0) moving = true; } catch { /* no input service in a bare world */ }
    const v = movedFlag || moving;
    movedFlag = false;
    return v;
  };

  // ── stations ───────────────────────────────────────────────────────────────────────────────────────
  const speak = (): void => {
    if (talk.length > 0) return;
    const phone = run.homePhone();
    if (!phone) return;
    const lines = phone.talk();
    if (lines.length === 0) return;
    const h = phone.harmony();
    talkMood = h <= 1 ? 'sad' : h >= 4 ? 'cheery' : 'calm';
    talk = lines.map((l) => { const text = t(l.key, l.vars); return { text, sec: lineSeconds(text) }; });
    talkWait = 0;
  };
  const tickTalk = (dt: number): void => {
    if (talk.length === 0) return;
    talkWait -= dt;
    if (talkWait > 0) return;
    const line = talk.shift();
    if (!line) return;
    talkWait = line.sec;
    say(line.text, t('evening.speaker.spouse'), line.sec);
    try { void app.audio.voice.speak({ speaker: 'spouse', text: line.text, mood: talkMood }).catch((): void => undefined); } catch { /* voice is optional */ }
  };

  const toggleLights = (): void => {
    const h = world.home;
    if (!h) return;
    const on = !h.lightsOn();
    h.setLights(on);
    run.homeFlags({ lights: on });
    sfx(HOME_SFX.lightSwitch);
  };
  const toggleChain = (): void => {
    const h = world.home;
    if (!h) return;
    const on = !h.chainOn();
    h.setChain(on);
    run.homeFlags({ chain: on });
    sfx(HOME_SFX.chain);
  };

  /** The look through the eyehole (2.5 s): the camera goes to the lens view, a hard-edged circle closes the screen. The world's own figure stands in the hall when he is there. */
  const peephole = (): void => {
    if (peep) return;
    sfx('drawer', { vol: 0.4, pitch: 5 });   // the little brass cover slides
    const el = h('div', 'ev-peep', ui().hudLayer);
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'none', zIndex: '3', opacity: '0',
      background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 16%, rgba(20,14,8,0.6) 21%, rgb(0,0,0) 27%)',
    } satisfies Partial<CSSStyleDeclaration>);
    // a visitor shows once his shadow is on the strip (the act); before that, and after, the hall is empty
    const there = visit?.acting() ? visit.state.kind : adaAtDoor ? 'ada' : null;
    peep = { el, t: 0 };
    const a = world.anchor(HOME_ANCHORS.peephole);
    if (a) {
      const p = anchorPose(a);
      const look = p.pos.clone().addScaledVector(p.dir, 4);
      const pos: V3 = [p.pos.x, p.pos.y, p.pos.z];
      const to: V3 = [look.x, look.y, look.z];
      void player.cinematic([{ pos, look: to, dur: PEEP_MOVE_SEC }, { pos, look: to, dur: PEEP_SEC - PEEP_MOVE_SEC }]);
    }
    say(t(there === 'ada' ? 'knock.ada.peep' : there ? `knock.peep.${there}` : 'evening.peephole'), '', PEEP_SEC + 0.6);
  };
  const tickPeep = (dt: number): void => {
    if (!peep) return;
    peep.t += dt;
    const k = Math.min(peep.t / PEEP_IN_SEC, (PEEP_SEC - peep.t) / PEEP_OUT_SEC, 1);
    peep.el.style.opacity = String(Math.max(0, k));
    if (peep.t >= PEEP_SEC) { peep.el.remove(); peep = null; }
  };

  const windowLook = (): void => {
    sfx('windGust', { vol: 0.3 });
    const n = (hashSeed(run.seed, run.night(), 'home.window') % WINDOW_LINES) + 1;
    say(t(`evening.window.${n}`), '', 3.5);
  };

  /**
   * THE KEEPSAKE CARRY (wave 75): in the Evening each touch of the spouse cycles the keepsake taken to the casino, through none and
   * then each one the player owns. The line is a toast, so the spouse's own lines still speak. Only the Evening (never the prologue).
   */
  const cycleKeepsake = (): void => {
    if (run.homeStage() !== 'evening') return;
    const opts: Array<KeepsakeId | null> = [null, ...run.keepsakeOwned()];
    const cur = run.keepsakeCarried();
    const next = opts[(opts.indexOf(cur) + 1) % opts.length] ?? null;
    if (!run.keepsakeCarry(next)) return;
    ui().toast(next === null ? t('keepsake.carry.none') : t('keepsake.carry.set', { name: t(`keepsake.${next}.name`) }), 'info', 3);
  };

  // ── ADA'S KITCHEN TABLE (wave 78): Rock, Paper, Promise, once per Evening ──────────────────────────────────────────
  /** THE KITCHEN WAGER (STORY_BIBLE 5a): the Evening that opens Night 8 plays for her name, until it is settled. */
  const wagerDue = (): boolean => run.night() === BASE_RUN_NIGHTS - 1 && run.chapterRecord().kitchen === null;
  /** After the spouse has spoken, offer the game (once per Night, only in the Evening, never with someone at the door). */
  const queueOffer = (): void => {
    if (pro !== 'done' || run.homeStage() !== 'evening' || kitchen || offering || offerWait >= 0 || offerCool > 0) return;
    if (!adaHere || kitchenPlayed.has(run.night()) || visit?.atDoor()) return;
    offerWait = talk.reduce((n, l) => n + l.sec, Math.max(0, talkWait)) + 0.4;
  };
  const offer = async (): Promise<void> => {
    if (wagerDue()) { startKitchen(); return; }
    offering = true;
    let pick = 1;
    try { pick = await ui().choice(t('promise.offer.title'), [t('promise.offer.play'), t('promise.offer.no')], { timeout: 12 }); } catch { pick = 1; }
    offering = false;
    if (disposed || pick !== 0 || run.over || run.homeStage() !== 'evening' || visit?.atDoor()) { offerCool = 20; return; }
    startKitchen();
  };
  const finishKitchen = (r: FlowResult): void => {
    kitchen = null;
    unlock();
    run.kitchenDone(r);   // a broken word, the wager's outcome; a lost wager ends the run (KEPT)
    if (run.over) return;
    if (r.left) { ui().toast(t('promise.leave'), 'info', 3); offerCool = 20; return; }
    kitchenPlayed.add(run.night());
    if (!r.kept) return;
    // an evening of kept words: Harmony +1, and one ŞANS star (the luck meter takes it through the stake event, id 'promise')
    hooksOf(run.homePhone())?.harmony(1);
    bus.emit('keepsake:stake', { state: 'won', id: run.keepsakeCarried() ?? 'ring', mid: 'promise', star: 1 });
    ui().toast(`${t('promise.bonus.harmony')}   ${t('promise.bonus.luck')}`, 'good', 4);
  };
  const startKitchen = (): void => {
    if (kitchen) return;
    wantLock = true;
    tryLock();
    const chap = run.chapterRecord();
    kitchen = openKitchen({
      parent: ui().hudLayer,
      seed: hashSeed(run.seed, run.night(), 'promise'),
      stake: stakeFor(run.seed, run.night()),
      ...(wagerDue() ? { wager: { harmony: run.homePhone()?.harmony() ?? HARMONY_START, broken: chap.broken, hints: hintsHeard(chap) } } : {}),
      playHand: (hd: Hand) => { try { void player.viewmodel.play(hd === 'rock' ? 'rpsRock' : hd === 'paper' ? 'rpsPaper' : 'rpsScissors'); } catch { /* hands are optional */ } },
      done: finishKitchen,
    });
  };
  const tickKitchen = (dt: number): void => {
    if (offerCool > 0) offerCool = Math.max(0, offerCool - dt);
    if (kitchen) {
      // the Night moves on (the ride, a knock at the door): the table is cleared
      if (run.homeStage() !== 'evening' || run.over) { kitchen.dispose(); kitchen = null; unlock(); return; }
      kitchen.update(dt);
      return;
    }
    if (offerWait >= 0) {
      offerWait -= dt;
      if (offerWait < 0) { offerWait = -1; if (!offering && run.homeStage() === 'evening') void offer(); }
    }
  };

  /** The stations that only look, talk or toggle: the same in the prologue and in the Evening. */
  const touch = (station: HomeStation): void => {
    switch (station) {
      case 'spouse': cycleKeepsake(); speak(); queueOffer(); break;
      case 'switch': toggleLights(); break;
      case 'chain': toggleChain(); break;
      case 'peephole': peephole(); break;
      case 'window': windowLook(); break;
      case 'bed': case 'door': case 'phone': break;   // their own rules (or the wall phone's UI)
    }
  };

  const interact = (station: HomeStation): void => {
    if (run.over || kitchen) return;
    if (pro !== 'done') {
      // THE PROLOGUE: the apartment is for talking and looking; the front door takes the lift down, the bed waits for Night 1
      if (pro !== 'walk' || station === 'phone') return;
      if (station === 'door') { if (walk?.leg === 'out') openOut(); else toCasino(); return; }
      if (station === 'bed') { ui().toast(t('evening.prologue.notYet'), 'warn', 2.5); return; }
      movedFlag = true;
      touch(station);
      return;
    }
    if (station === 'door' && walk?.leg === 'out') { openOut(); return; }   // the morning: out you go
    if (run.homeStage() !== 'evening') return;   // the Evening is the only stage with a free hand
    jumpHome();   // a station used while still on the street (a script, a test): straight in
    if (station !== 'peephole') movedFlag = true;   // the Listener hears every touch; the look costs only its time
    if (station === 'bed') {
      if (visit?.atDoor()) { ui().toast(t('knock.blocked'), 'warn', 2.5); return; }   // not with someone at the door
      if (wagerDue() && adaHere) { startKitchen(); return; }   // the wager first: she is waiting at the table
      run.homeSleep();
      return;
    }
    if (station === 'door') { sfx(HOME_SFX.lockTurn); ui().toast(t('evening.door'), 'info', 2.5); return; }
    touch(station);
  };
  offs.push(bus.on('home:interact', ({ station }) => interact(station)));
  offs.push(bus.on('street:taxi', ({ to }) => {
    if (run.over || lift) return;
    if (to === 'home') { taxiHome(); return; }
    if (walk?.leg !== 'out') return;
    sfx('doorSlam', { vol: 0.35, pitch: 1.3 });
    toCasino();
  }));

  // ── THE PROLOGUE (wave 72): the scene, the objective, the lift down ───────────────────────────────────────────
  /** The objective is up: the scene is over (or skipped) and the front door takes the lift down. */
  const beginWalk = (): void => {
    pro = 'walk';
    objectiveT = 0;
    unlock();
    ui().toast(t('evening.prologue.objective'), 'sys', 6);
    if (!streetBuilt()) return;
    startWalkOut();
    say(t('evening.prologue.keys'), t('evening.speaker.spouse'), 3.5);   // Ada gives you back your keys at the door
  };
  /**
   * The lift down: dark, the ding, the teleport to the elevator door on the floor, back in, then `done` (the prologue's end opens
   * Night 1 Watch 1; the intro follows on the run's `home:prologue` event).
   */
  const startLift = (done: () => void): void => {
    if (walk?.doorOpen) void world.home?.doorTo(0, 0);   // left open behind (a jump to the casino door): shut it
    walk = null;
    setWalk(null);
    setDoorOut(false);
    lift = { t: 0, ding: false, tp: false, fadeIn: false, done };
    sfx('doorOpen', { vol: 0.7 });
    wantLock = true;
    ui().dismissToasts();
    fadeTo(1, T.dark);
  };
  const tickLift = (dt: number): void => {
    const l = lift;
    if (!l) return;
    l.t += dt;
    if (!l.ding && l.t >= T.dark) { l.ding = true; sfx(HOME_SFX.ding); }
    if (!l.tp && l.t >= T.teleport) { l.tp = true; placeFloor(); }
    if (l.tp && !l.fadeIn && l.t >= T.fadeIn) { l.fadeIn = true; fadeTo(0, 0.9); }
    if (l.t < T.ride) return;
    lift = null;
    unlock();
    l.done();
  };
  /** The world is built: the apartment is placed and the scene plays. A run that is not in its prologue has nothing to start. */
  const startPrologue = (): void => {
    if (pro !== 'start') return;
    if (!run.prologueOn() || !app.cutscene.has(PROLOGUE_CUT)) { pro = 'done'; run.finishPrologue(); return; }
    pro = 'talk';
    placeHome();
    ambience(HOME_AMBIENCE, 1.5);
    void app.cutscene.play(PROLOGUE_CUT, { vars: { quota: fmtCoins(run.debt().due) } }).then(
      () => { if (!disposed && pro === 'talk') beginWalk(); },
      () => { if (!disposed && pro === 'talk') beginWalk(); },
    );
  };

  // the prologue starts once the world is built (the apartment's anchors and the room exist then)
  if (pro === 'start') {
    const ready = (world as WorldHost & { ready?: Promise<void> }).ready ?? Promise.resolve();
    void ready.then(() => { if (!disposed) startPrologue(); }, () => { if (!disposed) startPrologue(); });
  }

  return {
    update(dt) {
      tickLift(dt);
      tickWalk();
      if (pro === 'walk') {
        objectiveT += dt;
        if (objectiveT >= OBJECTIVE_EVERY_SEC) { objectiveT = 0; ui().toast(t('evening.prologue.objective'), 'sys', 6); }
      }
      if (pro !== 'done') {
        // THE PROLOGUE has no stage of its own: the run is on the intermission, so the Evening's stage checks below stay quiet
        tryLock();
        tickTalk(dt);
        tickPeep(dt);
        return;
      }
      const s = run.homeState();
      if (s.stage !== last) {
        const from = last;
        last = s.stage;
        change(from, s.stage);
      }
      if (s.stage === 'ride' || s.stage === 'doomed') rideBeats(dt, s.stage, s.left);
      tryLock();
      tickTalk(dt);
      tickPeep(dt);
      tickKitchen(dt);
      if (visit && s.stage === 'evening') {
        const moved = heardMoving();
        visit.tick(dt, { lights: world.home?.lightsOn() ?? true, chain: world.home?.chainOn() ?? false, moved, looking: peep !== null });
      }
    },
    dispose() {
      disposed = true;
      for (const off of offs.splice(0)) off();
      setWalk(null);
      setDoorOut(false);
      world.home?.setDoorShadow(false);
      showVisitor(null);
      wantLock = false; locked = false;   // the state that follows sets its own input mode
      talk = [];
      kitchen?.dispose();
      kitchen = null;
      peep?.el.remove();
      peep = null;
      if (faded) void app.ui.fade(0, 0.2, '#000');
    },
  };
}
