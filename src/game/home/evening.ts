/**
 * THE EVENING (wave 69, Home layer): what the player sees and touches of the flow (docs/WAVE69_HOME.md §2, §3, §7).
 * The run owns the stage and its sim clock (`run.homeState()`, `HOME_TIMING` in run.ts, `RunExt.home` in the save); this module
 * is the presentation and the stations on top of it: the lift's fade, ding and teleport, the apartment's stations (bed, spouse,
 * switch, chain, peephole, window, door), the sleep that ends in the next Night, and the doomed ride (lights, three knocks).
 * The wall phone is the phone UI's (src/game/home/phone.ui.ts): this module leaves that station alone.
 *
 * Every beat is keyed on the run's stage clock, never on a wall clock: the session mounts the controller for solo runs and calls
 * `update(dt)` from the fixed step, so a paused game pauses the ride, a reload resumes it, and two seeded runs match.
 * A restore lands the player in the Evening at `home.spawn`; the doomed ride plays again from the top and then ends the run.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { registerStrings, t } from '@/core/i18n';
import { hashSeed } from '@/core/rng';
import type { Unsub, V3 } from '@/core/types';
import type { UIOverlayX } from '@/core/ui/ui';
import { h } from '@/core/ui/widgets';
import type { WorldHost } from '@/world/world';
import type { LocalPlayerHost } from '@/player/local';
import { HOME_TIMING, type DebtRun } from '../run';
import { HOME_AMBIENCE, HOME_ANCHORS, HOME_ORIGIN, HOME_SFX, type HomeStage, type HomeStation } from './contract';
import strings from './evening.strings';

registerStrings(strings.prefix, { en: strings.en, tr: strings.tr });

/** One step out of the lift gate on the casino floor (m). */
const LIFT_STEP = 2.2;
/** The body stands this far above the flat's floor line when placed (anchors may sit at eye height; gravity settles it). */
const STAND_LIFT = 0.05;
/** The peephole look (sim s): the camera eases to the eyehole, holds, and the player's own glide brings it back. */
const PEEP_SEC = 2;
const PEEP_MOVE_SEC = 0.4;
const PEEP_IN_SEC = 0.25;
const PEEP_OUT_SEC = 0.35;
/** A seated player (the lift lever is pulled from the Debt Terminal's seat) gets this long to stand before the ride forces the move. */
const SEAT_WAIT_SEC = 1;
/** The doomed lights: toggles at these offsets from `flickerAt` (even = off, odd = on), so the room ends lit. */
const FLICKER: readonly number[] = [0, 0.12, 0.26, 0.55, 0.66, 1.0, 1.1, 1.35];
/** The window's one-liners (`evening.window.1`..`4`). */
const WINDOW_LINES = 4;

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

  const spousePresent = (): boolean => (run.homePhone()?.harmony() ?? 3) > 0;

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
    if (app.input.mode === 'cutscene' && !app.cutscene.playing) app.input.setMode('walk');
  };
  /** A line for the player: the subtitle bar, or a toast when subtitles are off (the lines carry the Evening's news). */
  const say = (text: string, who: string, sec: number): void => {
    let subs = true;
    try { subs = app.save.data.settings.subtitles !== false; } catch { /* default on */ }
    if (subs) app.ui.subtitle(text, who, sec);
    else ui().toast(text, 'info', sec);
  };

  // ── placing the player ─────────────────────────────────────────────────────────────────────────────
  /** The lift arrives: the player stands inside the front door, the lights are on, the chain is off, the spouse is in her chair. */
  const placeHome = (): boolean => {
    const a = world.anchor(HOME_ANCHORS.spawn);
    if (!a) return false;
    const p = anchorPose(a);
    player.teleport(new THREE.Vector3(p.pos.x, HOME_ORIGIN[1] + STAND_LIFT, p.pos.z), p.yaw);
    const home = world.home;
    home?.setLights(true);
    home?.setChain(false);
    home?.setSpouse(spousePresent());
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

  // ── stages ─────────────────────────────────────────────────────────────────────────────────────────
  const startRide = (): void => {
    beats = { ding: false, tp: false, fadeIn: false, flick: 0, knocks: 0 };
    seatWait = 0;
    wantLock = true;
    if (world.seat) world.standUp();   // the lever is pulled from the terminal's seat
    fadeTo(1, T.dark);
  };

  const arriveEvening = (from: HomeStage | null): void => {
    if (from === 'ride') {
      if (!beats.tp) { beats.tp = true; placeHome(); }
      if (!beats.fadeIn) { beats.fadeIn = true; fadeTo(0, 0.5); }
    } else {
      // a restored Evening: the front door, out of the dark
      const s = run.homeState();
      if (placeHome()) { world.home?.setLights(s.lights); world.home?.setChain(s.chain); }
      fadeTo(1, 0);
      fadeTo(0, 0.9);
    }
    unlock();
    world.home?.setSpouse(spousePresent());
    ui().toast(t('evening.hint'), 'sys', 5);
  };

  const startSleep = (): void => {
    wantLock = true;
    sfx(HOME_SFX.bed);
    fadeTo(1, T.sleep - 0.3);
    // a flat of Harmony 0 has no spouse: the bed shows the note instead
    if ((run.homePhone()?.harmony() ?? 3) <= 0) say(t('evening.note'), t('evening.speaker.note'), 3.5);
  };

  const leaveHome = (from: HomeStage | null): void => {
    if (from === null) return;
    if (atHome) placeFloor();
    unlock();
    fadeTo(0, 0.9);
    void ui().banner(t('ingame.night', { n: run.night() }));
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
        if (placeHome() || e >= T.ride) beats.tp = true;
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

  /** A 2 s look through the eyehole: the camera goes to `home.peephole`, a hard-edged circle closes the screen, and the hall is empty. */
  const peephole = (): void => {
    if (peep) return;
    const el = h('div', 'ev-peep', ui().hudLayer);
    Object.assign(el.style, {
      position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'none', zIndex: '3', opacity: '0',
      background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 16%, rgba(20,14,8,0.6) 21%, rgb(0,0,0) 27%)',
    } satisfies Partial<CSSStyleDeclaration>);
    peep = { el, t: 0 };
    const a = world.anchor(HOME_ANCHORS.peephole);
    if (a) {
      const p = anchorPose(a);
      const look = p.pos.clone().addScaledVector(p.dir, 4);
      const pos: V3 = [p.pos.x, p.pos.y, p.pos.z];
      const to: V3 = [look.x, look.y, look.z];
      void player.cinematic([{ pos, look: to, dur: PEEP_MOVE_SEC }, { pos, look: to, dur: PEEP_SEC - PEEP_MOVE_SEC }]);
    }
    say(t('evening.peephole'), '', PEEP_SEC + 0.6);
  };
  const tickPeep = (dt: number): void => {
    if (!peep) return;
    peep.t += dt;
    const k = Math.min(peep.t / PEEP_IN_SEC, (PEEP_SEC - peep.t) / PEEP_OUT_SEC, 1);
    peep.el.style.opacity = String(Math.max(0, k));
    if (peep.t >= PEEP_SEC) { peep.el.remove(); peep = null; }
  };

  const windowLook = (): void => {
    const n = (hashSeed(run.seed, run.night(), 'home.window') % WINDOW_LINES) + 1;
    say(t(`evening.window.${n}`), '', 3.5);
  };

  const interact = (station: HomeStation): void => {
    if (run.over || run.homeStage() !== 'evening') return;   // the Evening is the only stage with a free hand
    switch (station) {
      case 'bed': run.homeSleep(); break;
      case 'spouse': speak(); break;
      case 'switch': toggleLights(); break;
      case 'chain': toggleChain(); break;
      case 'peephole': peephole(); break;
      case 'window': windowLook(); break;
      case 'door': sfx(HOME_SFX.lockTurn); ui().toast(t('evening.door'), 'info', 2.5); break;
      case 'phone': break;   // the wall phone belongs to the phone UI
    }
  };
  offs.push(bus.on('home:interact', ({ station }) => interact(station)));

  return {
    update(dt) {
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
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      wantLock = false; locked = false;   // the state that follows sets its own input mode
      talk = [];
      peep?.el.remove();
      peep = null;
      if (faded) void app.ui.fade(0, 0.2, '#000');
    },
  };
}
