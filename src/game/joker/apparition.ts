/**
 * LOKI, SEEN (docs/JOKER.md §1, §6): the borrowed memory as a figure you catch beside you, the way a memory you carry stands in a
 * room. He shows when he speaks and at key moments (your big win, your loss, his hand), leaning on the next machine, on a bar stool,
 * in the lift's or the bar's smoked mirror, beside the rival at a duel, and for a moment in your own seat. He glitches in and out
 * (0.3 s) and leaves when you stare at him for 2 s.
 *
 * Trust sets the distance (low: far and turned away; high: close, sitting); Ink makes him show more often, closer and more solid,
 * and from Ink 8 he sometimes takes your seat. Calm Mode (and reduced motion or flashing) drops the slices and the flicker and
 * fades softly. The rules here are pure and seeded (tests: scripts/tests/apparition.test.mjs); the figure is lokiArt.ts.
 * One pooled mannequin, hidden when he is not shown (a hidden mannequin freezes); no light.
 */
import * as THREE from 'three';
import { bus } from '@/core/events';
import { clamp, angleDiff } from '@/core/math';
import { createRng, hashSeed } from '@/core/rng';
import { SLOT_DIMS, type InstanceId, type PlayerId, type SlotSize, type V3 } from '@/core/types';
import type { Kit } from '@/kit/types';
import { SEATED_HIP } from '@/kit/mannequin';
import { BAR_POS, LIFT_DOOR } from '@/world/layout';
import { RIVAL_CHAIR_Z } from '@/machines/tallytable/seat';
import { calmNow, jokerTalking } from '@/core/ui/manga/joker';
import { TRUST_MAX, TRUST_MIN, INK_MAX, INK_HAND } from './joker';
import { buildLoki, LOKI_HEIGHT, type Gesture, type LokiFigure } from './lokiArt';

// ── the rules (pure) ──────────────────────────────────────────────────────────────────────────────
export type SpotKind = 'lean' | 'stool' | 'stand' | 'mirror' | 'duel' | 'seat';
/** A place he can be: feet (stool: the seat top) at x, y, z. `yaw` fixes his facing (else he faces you); `lean` points at the machine he leans on. */
export interface Spot { kind: SpotKind; x: number; y: number; z: number; yaw?: number; lean?: readonly [number, number]; clip?: { min: V3; max: V3 } }
/** A machine front near the player: its centre, its facing and its width. Nothing may stand in the box in front of it. */
export interface Screen { x: number; z: number; nx: number; nz: number; w: number }
/** Where the player is and looks (xz). */
export interface View { x: number; z: number; fx: number; fz: number; screens: readonly Screen[] }

export interface Presence {
  /** Distance band from the player for a free spot (m). */
  near: number;
  far: number;
  turnAway: boolean;
  /** He takes a stool when there is one. */
  sit: boolean;
  /** How solid he is, 0..1 (the dither keeps this share). */
  solid: number;
  /** Chance he shows when he speaks. */
  chance: number;
  /** Seconds between two showings he chooses (a moment he is part of ignores it). */
  gap: number;
  /** Ink 8+: he sometimes sits in your seat for a moment. */
  swap: boolean;
}

/** Trust (−3..3) and Ink (0..10) → how he shows. */
export function presenceOf(trust: number, ink: number): Presence {
  const tr = clamp(Math.round(trust), TRUST_MIN, TRUST_MAX), k = clamp(ink, 0, INK_MAX) / INK_MAX;
  const [near, far] = tr <= -2 ? [4.2, 7] : tr === -1 ? [3, 5.5] : tr === 0 ? [1.8, 4.2] : tr === 1 ? [1.2, 3] : [0.7, 2.2];
  const pull = 1 - 0.35 * k;   // Ink brings him in
  return {
    near: near * pull, far: far * pull, turnAway: tr < 0, sit: tr >= 2,
    solid: 0.72 + 0.26 * k, chance: Math.min(1, 0.5 + 0.5 * k), gap: 40 - 28 * k, swap: ink >= INK_HAND,
  };
}

/** Half-angle of the view a spot must be inside (deg), and the line-of-play cone it must stay out of. */
export const VIEW_HALF = 50;
export const PLAY_HALF = 15;
/** The box in front of a machine screen nobody stands in: this deep, the screen's width plus this margin each side. */
export const SCREEN_DEEP = 1.5, SCREEN_SIDE = 0.25;
/** Spots that ignore the distance band: the place itself is the moment. */
const FIXED: ReadonlySet<SpotKind> = new Set(['mirror', 'duel', 'seat']);
const RANK: Record<SpotKind, number> = { duel: 4, mirror: 3, stool: 2, lean: 1.5, stand: 1, seat: 0 };

const deg = (fx: number, fz: number, dx: number, dz: number): number => Math.abs(angleDiff(Math.atan2(fx, fz), Math.atan2(dx, dz))) * 180 / Math.PI;

/** True when he may stand at `s`: in the band (free spots), in view, out of the line of play and off every machine's screen. */
export function spotOk(s: Spot, v: View, p: Presence): boolean {
  if (s.kind === 'seat') return true;
  const dx = s.x - v.x, dz = s.z - v.z, d = Math.hypot(dx, dz);
  if (!FIXED.has(s.kind) && (d < p.near || d > p.far)) return false;
  if (d < 0.3) return false;
  const a = deg(v.fx, v.fz, dx, dz);
  if (a > VIEW_HALF || a < PLAY_HALF) return false;
  for (const sc of v.screens) {
    const ox = s.x - sc.x, oz = s.z - sc.z;
    const fwd = ox * sc.nx + oz * sc.nz, lat = Math.abs(ox * sc.nz - oz * sc.nx);
    if (fwd > -0.1 && fwd < SCREEN_DEEP && lat < sc.w / 2 + SCREEN_SIDE) return false;
  }
  return true;
}

/** The spot he takes (an index into `spots`), or -1. Best kind first, then nearest the band's middle; `u` (0..1) picks among the top two. */
export function pickSpot(spots: readonly Spot[], v: View, p: Presence, u: number): number {
  const mid = (p.near + p.far) / 2;
  const score = (s: Spot): number => RANK[s.kind] + (s.kind === 'stool' && p.sit ? 2 : 0) - Math.abs(Math.hypot(s.x - v.x, s.z - v.z) - mid) * 0.2;
  const ok = spots.map((s, i) => ({ i, sc: score(s) })).filter((o) => spots[o.i].kind !== 'seat' && spotOk(spots[o.i], v, p)).sort((a, b) => b.sc - a.sc);
  if (ok.length === 0) return -1;
  const top = ok.filter((o) => o.sc >= ok[0].sc - 0.5).slice(0, 2);
  return top[Math.min(top.length - 1, Math.floor(u * top.length))].i;
}

/** Looking straight at him (deg) and for how long (s) before he goes, Johnny-style. */
export const LOOK_DEG = 10;
export const STARE_S = 2;
/** Stare time grows while you look at him and drains twice as fast when you look away; at STARE_S he leaves. */
export function gazeStep(stare: number, looking: boolean, dt: number): { stare: number; leave: boolean } {
  const s = looking ? stare + dt : Math.max(0, stare - dt * 2);
  return { stare: s, leave: s >= STARE_S };
}

/** Glitch in or out, and the Calm Mode fade. */
export const GLITCH_S = 0.3;
export const CALM_FADE_S = 0.8;
/** Presence through a fade at `k` (0..1 of the fade): three hard steps when glitching, a smooth ramp in Calm Mode. */
export const fadeAt = (k: number, calm: boolean): number => { const x = clamp(k, 0, 1); return calm ? x * x * (3 - 2 * x) : Math.ceil(x * 3) / 3; };

export type Moment = 'speak' | 'clap' | 'laugh' | 'swap' | 'takeover';
/** Does he show for this moment? `since`: seconds since he last showed; `u`: a seeded roll. */
export function showsFor(m: Moment, p: Presence, since: number, u: number): boolean {
  if (m === 'takeover') return true;
  if (m === 'swap') return p.swap && u < 0.3;
  if (since < p.gap) return false;
  return u < (m === 'speak' ? p.chance : p.chance * 0.35);
}

// ── the figure on the floor ───────────────────────────────────────────────────────────────────────
/** What he needs from the session (game/ingame/session.ts). */
export interface ApparitionHost {
  kit: Kit;
  /** Where his figure lives (the world root). */
  root: THREE.Object3D;
  camera: THREE.Camera;
  seed: number;
  selfId: PlayerId;
  trust(): number;
  ink(): number;
  /** He is part of the run now (Night 2 on, not hushed by a cheat). */
  active(): boolean;
  machines(): ReadonlyArray<{ id: InstanceId; machineId: string; pos: V3; rotY: number; size: SlotSize }>;
  seat(): { mid: InstanceId } | null;
}

export interface Apparition {
  frame(dt: number): void;
  /** Show him now for a moment (bench, debug): at a spot of this kind when there is one in view. */
  show(m: Moment, kind?: SpotKind): boolean;
  /** Gone at once, no fade (bench, cutscenes). */
  hide(): void;
  /** Holds him at `s`, mirrored, until released (the Burning Wager: behind the Champion's chair, his mirror image); null lets him go. */
  pin(s: Spot | null): void;
  readonly shown: boolean;
  readonly spot: Spot | null;
  dispose(): void;
}

const LINGER: Record<Moment, number> = { speak: 4.5, clap: 4, laugh: 3.5, swap: 1.2, takeover: 1.5 };
const IDLE: Record<SpotKind, readonly Gesture[]> = {
  lean: ['smoke', 'cross'], stand: ['cross', 'smoke', 'shuffle'], stool: ['shuffle'], mirror: ['cross', 'smoke'], duel: ['shuffle', 'cross'], seat: ['none'],
};
const BIG = new Set(['big', 'huge', 'mega', 'jackpot']);
const NEAR_M = 7, BAR_M = 8, LIFT_M = 8;

let current: Apparition | null = null;
/** The live apparition (bench and dev console). */
export const lokiApparition = (): Apparition | null => current;

export function mountApparition(host: ApparitionHost): Apparition {
  const fig: LokiFigure = buildLoki(host.kit);
  const actor = fig.actor;
  host.root.add(actor.root);
  let n = 0;
  const roll = (): number => createRng(hashSeed(host.seed, 'loki.ghost', n++)).next();

  let state: 'off' | 'in' | 'on' | 'out' = 'off';
  let fadeT = 0, stay = 0, stare = 0, since = 1e9, clock = 0, burst = 0, burstIn = 2;
  let spot: Spot | null = null;
  let idle: Gesture = 'none', moment: Gesture | null = null, momentT = 0;
  let wasTalking = false, cutscene = false, pendingSwap = -1;
  const cam = new THREE.Vector3(), fwd = new THREE.Vector3(), at = new THREE.Vector3();

  const view = (): View => {
    host.camera.getWorldPosition(cam);
    host.camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const screens: Screen[] = [];
    for (const m of host.machines()) {
      if (Math.hypot(m.pos[0] - cam.x, m.pos[2] - cam.z) > NEAR_M + 3) continue;
      const r = m.rotY * Math.PI / 180, d = SLOT_DIMS[m.size];
      screens.push({ x: m.pos[0] + Math.sin(r) * d.d / 2, z: m.pos[2] + Math.cos(r) * d.d / 2, nx: Math.sin(r), nz: Math.cos(r), w: d.w });
    }
    return { x: cam.x, z: cam.z, fx: fwd.x / fl, fz: fwd.z / fl, screens };
  };

  /** Every place near the player he could be, built when he shows. */
  const spots = (v: View): Spot[] => {
    const out: Spot[] = [];
    const seat = host.seat();
    for (const m of host.machines()) {
      if (Math.hypot(m.pos[0] - v.x, m.pos[2] - v.z) > NEAR_M) continue;
      const r = m.rotY * Math.PI / 180, nx = Math.sin(r), nz = Math.cos(r), rx = Math.cos(r), rz = -Math.sin(r), d = SLOT_DIMS[m.size];
      for (const sd of [-1, 1]) {      // against the cabinet's side, back from its front: never over its screen
        const o = d.w / 2 + 0.34;
        out.push({ kind: 'lean', x: m.pos[0] + rx * o * sd + nx * (d.d / 2 - 0.4), y: m.pos[1], z: m.pos[2] + rz * o * sd + nz * (d.d / 2 - 0.4), lean: [-rx * sd, -rz * sd] });
      }
      if (m.machineId === 'tallytable' && seat?.mid === m.id) {   // across the table, at the rival's shoulder (the side away from the tally board)
        out.push({ kind: 'duel', x: m.pos[0] - rx * 0.85 + nx * (RIVAL_CHAIR_Z - 0.05), y: m.pos[1], z: m.pos[2] - rz * 0.85 + nz * (RIVAL_CHAIR_Z - 0.05), yaw: r });
      }
    }
    if (Math.hypot(BAR_POS.x - v.x, BAR_POS.z - 1 - v.z) < BAR_M) {
      for (const sx of [-1.4, 0, 1.4]) out.push({ kind: 'stool', x: BAR_POS.x + sx, y: 0.76, z: BAR_POS.z - 1.15 });
      // the back bar's smoked mirror (bar.ts: 3.5 x 0.95 at y 1.55, its glass at z + 1.665): over your shoulder, among the bottles
      const mx = clamp(v.x + 0.35, BAR_POS.x - 1.3, BAR_POS.x + 1.3);
      out.push({ kind: 'mirror', x: mx, y: 0, z: BAR_POS.z + 1.6, yaw: Math.PI, clip: { min: [BAR_POS.x - 1.74, 1.08, BAR_POS.z + 1.2], max: [BAR_POS.x + 1.74, 2.02, BAR_POS.z + 1.66] } });
    }
    if (Math.hypot(LIFT_DOOR.x - v.x, LIFT_DOOR.z - v.z) < LIFT_M) {
      // the car's smoked mirror (elevator.ts: 1.5 x 0.95 at y 1.72, the glass at z −1.967 from the door): behind you in the lift
      const gz = LIFT_DOOR.z - 1.967;
      out.push({ kind: 'mirror', x: LIFT_DOOR.x + 0.32, y: 0.1, z: gz + 0.12, yaw: 0, clip: { min: [LIFT_DOOR.x - 0.75, 1.25, gz], max: [LIFT_DOOR.x + 0.75, 2.19, gz + 0.5] } });
    }
    // nobody stands inside a cabinet: a lean beside one machine may be inside its neighbour
    const inside = (s: Spot): boolean => host.machines().some((m) => {
      const r = m.rotY * Math.PI / 180, d = SLOT_DIMS[m.size], ox = s.x - m.pos[0], oz = s.z - m.pos[2];
      return Math.abs(ox * Math.cos(r) - oz * Math.sin(r)) < d.w / 2 + 0.15 && Math.abs(ox * Math.sin(r) + oz * Math.cos(r)) < d.d / 2 + 0.15;
    });
    for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === 'lean' && inside(out[i])) out.splice(i, 1);
    if (seat) out.push({ kind: 'seat', x: v.x + v.fx * 0.55, y: cam.y - 1.25, z: v.z + v.fz * 0.55, yaw: Math.atan2(v.fx, v.fz) });
    return out;
  };

  const place = (s: Spot, v: View, p: Presence): void => {
    spot = s;
    const toYou = Math.atan2(v.x - s.x, v.z - s.z);
    let yaw = s.yaw ?? toYou;
    if (p.turnAway && s.kind !== 'mirror') yaw += Math.PI * 0.65;
    const sitting = s.kind === 'stool' || s.kind === 'seat';
    actor.root.rotation.set(0, yaw, 0, 'YXZ');
    if (s.kind === 'stool') {        // hips on the seat top (mannequin SEATED_HIP), the root a little forward of the stool centre
      actor.root.position.set(s.x + Math.sin(yaw) * SEATED_HIP.back * LOKI_HEIGHT * 0.6, s.y - (SEATED_HIP.up - SEATED_HIP.contact) * LOKI_HEIGHT, s.z + Math.cos(yaw) * SEATED_HIP.back * LOKI_HEIGHT * 0.6);
    } else actor.root.position.set(s.x, s.y, s.z);
    if (s.kind === 'lean') {          // the shoulder against the cabinet: a roll toward the machine's side in his own frame
      const lx = s.lean ? s.lean[0] * Math.cos(yaw) - s.lean[1] * Math.sin(yaw) : 1;
      actor.root.rotation.z = -0.11 * Math.sign(lx || 1);
    }
    const c = s.clip;
    fig.u.uGhMin.value.set(...(c ? c.min : [-1e5, -1e5, -1e5] as V3));
    fig.u.uGhMax.value.set(...(c ? c.max : [1e5, 1e5, 1e5] as V3));
    void actor.play(sitting ? 'Sitting_Idle_Loop' : 'Idle_Loop', { fade: 0 });
    const list = IDLE[s.kind];
    idle = list[Math.floor(roll() * list.length)] ?? 'none';
    if (p.turnAway) actor.lookAt(at.set(s.x + Math.sin(yaw) * 3, 1.5, s.z + Math.cos(yaw) * 3), 0.4);
    else actor.lookAt(null);
  };

  const show = (m: Moment, kind?: SpotKind): boolean => {
    if (cutscene) return false;
    const v = view(), p = presenceOf(host.trust(), host.ink());
    const all = spots(v);
    let i: number;
    if (m === 'swap' || m === 'takeover') i = all.findIndex((s) => s.kind === 'seat');
    else if (kind) { const only = all.filter((s) => s.kind === kind); const k = pickSpot(only, v, { ...p, near: 0, far: 99 }, roll()); i = k < 0 ? -1 : all.indexOf(only[k]); }
    else i = pickSpot(all, v, p, roll());
    if (i < 0) return false;
    if (state === 'off' || state === 'out') { place(all[i], v, p); state = 'in'; fadeT = 0; stare = 0; }
    actor.root.visible = true;
    stay = Math.max(stay, LINGER[m]);
    since = 0;
    if (m === 'clap' || m === 'laugh') { moment = m; momentT = 3; }
    return true;
  };

  let pinned = false;
  const unpin = (): void => { pinned = false; actor.root.scale.x = 1; };
  const hide = (): void => { unpin(); state = 'off'; actor.root.visible = false; fig.gesture = 'none'; spot = null; stay = 0; };
  const leave = (): void => { if (state === 'in' || state === 'on') { state = 'out'; fadeT = 0; } };
  const pin = (s: Spot | null): void => {
    if (!s) { if (pinned) { unpin(); leave(); } return; }
    place(s, view(), presenceOf(host.trust(), host.ink()));
    pinned = true;
    actor.root.scale.x = -1;   // the court card's other half
    actor.root.visible = true;
    state = 'in'; fadeT = 0; stare = 0; stay = Infinity; since = 0;
  };

  const offs = [
    bus.on('machine:result', ({ pid, tier, bet }) => {
      if (pid !== host.selfId || !host.active()) return;
      const m: Moment | null = BIG.has(tier) ? 'clap' : tier === 'none' && bet > 0 ? 'laugh' : null;
      if (!m) return;
      if (state === 'in' || state === 'on') { moment = m; momentT = 3; stay = Math.max(stay, 3); return; }
      if (showsFor(m, presenceOf(host.trust(), host.ink()), since, roll())) show(m);
    }),
    bus.on('joker:takeover', () => { if (host.active()) show('takeover'); }),
    bus.on('player:seat', ({ pid, on }) => {
      if (pid !== host.selfId || !on || !host.active()) return;
      if (showsFor('swap', presenceOf(host.trust(), host.ink()), since, roll())) pendingSwap = 1.4;   // once the seat glide has landed
    }),
    bus.on('cutscene:start', () => { cutscene = true; hide(); }),
    bus.on('cutscene:end', () => { cutscene = false; }),
  ];

  const ap: Apparition = {
    get shown() { return state !== 'off'; },
    get spot() { return spot; },
    show, hide, pin,
    frame(dt) {
      clock += dt; since += dt;
      const calm = calmNow();
      const talking = jokerTalking();
      if (talking && !wasTalking && host.active() && state === 'off' && showsFor('speak', presenceOf(host.trust(), host.ink()), since, roll())) show('speak');
      wasTalking = talking;
      if (pendingSwap >= 0 && (pendingSwap -= dt) < 0 && host.seat()) show('swap');
      if (state === 'off') return;
      const p = presenceOf(host.trust(), host.ink());
      const fade = calm ? CALM_FADE_S : GLITCH_S;
      // how long he stays: while he talks, then his linger; staring at him for 2 s sends him off
      if (talking) stay = Math.max(stay, 1.5);
      stay -= dt;
      if (state === 'on' && stay <= 0) leave();
      host.camera.getWorldPosition(cam);
      host.camera.getWorldDirection(fwd);
      actor.root.getWorldPosition(at);
      at.y += spot?.kind === 'stool' || spot?.kind === 'seat' ? 1.1 : 1.45;
      const g = gazeStep(stare, fwd.angleTo(at.sub(cam)) * 180 / Math.PI < LOOK_DEG, dt);
      stare = g.stare;
      if (g.leave && spot?.kind !== 'seat' && !pinned) leave();
      // presence: the fade, his Ink solidity, and (not in Calm) a flicker and a glitch burst now and then
      let k = 1;
      if (state === 'in') { fadeT += dt; k = fadeAt(fadeT / fade, calm); if (fadeT >= fade) state = 'on'; }
      else if (state === 'out') {
        fadeT += dt; k = fadeAt(1 - fadeT / fade, calm);
        if (fadeT >= fade) { hide(); return; }
      }
      burstIn -= dt;
      if (burstIn <= 0) { burst = 0.14; burstIn = 2 + roll() * 4; }
      burst = Math.max(0, burst - dt);
      const glitching = !calm && (state === 'in' || state === 'out' || burst > 0);
      const flicker = calm ? 1 : 0.88 + 0.12 * Math.abs(Math.sin(clock * 37) * Math.sin(clock * 11));
      fig.u.uGhT.value = clock;
      fig.u.uGhG.value = glitching ? 1 : 0;
      fig.u.uGhS.value = calm ? 0.4 : 1;
      fig.u.uGhA.value = p.solid * k * flicker;
      // what his hands do: the moment (clap, laugh) for a while, else his idle; the grin flaps while his line types
      if (moment && (momentT -= dt) <= 0) moment = null;
      fig.gesture = moment ?? idle;
      fig.talk += ((talking ? 1 : 0) - fig.talk) * Math.min(1, dt * 12);
      fig.update(dt);
    },
    dispose() {
      for (const off of offs) off();
      if (current === ap) current = null;
      actor.root.removeFromParent();
      fig.dispose();
    },
  };
  current = ap;
  return ap;
}
