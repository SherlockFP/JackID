/**
 * Light-horror director (BRIEF Addendum 1, GDD §6). Owns the Dread meter and the scares: flicker and blackout bursts,
 * the House's PA babble with subtitles, mannequins that shift only while unobserved, whispers when luck is low, the
 * Collector's Dawn walk with coin-clink footsteps, and rare jump stingers. Calm Mode turns the scares off and keeps the
 * mood. Randomness comes from the seeded run RNG only (never Math.random). Player text is in horror.strings.ts.
 */
import * as THREE from 'three';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { clamp } from '@/core/math';
import type { Rng } from '@/core/rng';
import type { AudioEngine } from '@/core/audio/types';
import type { WorldLights, WorldLightTarget } from '@/world/types';
import type { V3, ZoneId } from '@/core/types';
import { ActorDirectorImpl, DarkPatrons, LiveActor, NAV_POINTS, observed, nearestViewer, type Viewer } from '@/world/actors';
import type { ActorHandle } from '@/core/cutscene/types';
import { DreadMeter, TIER_RANK, type DreadEventKind, type DreadInput, type DreadTier } from './dread';

export type HorrorBeat = 'flicker' | 'blackout' | 'whisper' | 'pa' | 'jump' | 'collectorWalk' | 'patronShift' | DreadEventKind;

declare module '@/core/events' {
  interface GameEvents {
    /** `dread` is 0..1 (the same unit as dread:change). */
    'horror:event': { kind: HorrorBeat; dread: number };
  }
}

/** Per-frame run state the director reads. Everything here comes from the run; nothing is stored in the world. */
export interface HorrorState extends DreadInput {
  /** Effective luck at the player's current machine. Whispers when ≤ −3. */
  luck: number;
  /** The `bad_run` buff is active. Also triggers whispers. */
  badRun: boolean;
}

export interface HorrorSettings { calm: boolean; reduceFlashing: boolean; subtitles: boolean }

export interface HorrorDeps {
  audio: AudioEngine;
  /** Subtitle overlay (UIOverlay.subtitle). */
  subtitle(text: string | null, speaker?: string, dur?: number): void;
  /** The world's lights; null before the level exists. */
  lights(): WorldLights | null;
  actors: ActorDirectorImpl;
  rng: Rng;
  /** Player positions (and cameras, for the frustum test). */
  viewers(): readonly Viewer[];
  settings(): HorrorSettings;
  /** Zones that can flicker or black out one at a time. Empty = whole pit. */
  zones?: readonly ZoneId[];
  /** Free seat for a patron to move to at Dread ≥ 60 (Watched and up). */
  freeSpot?(zone: string): V3 | null;
}

const LIFT: V3 = [-4, 0, -30];          // d.lift node (GDD §8.8)
const HALL: readonly V3[] = NAV_POINTS
  .filter((p) => p[0] !== LIFT[0] || p[1] !== LIFT[2])
  .map((p): V3 => [p[0], 0, p[1]]);
const CLINK_GAP = 0.9;                  // s between Collector steps (GDD: 1 step / 0.9 s)
const CALM_DAWN_SECONDS = 30;           // Calm Mode: footsteps only, for this long
const EYE_HEIGHT = 1.6;

/** Patron (guest mannequin) registered for the shift rule. */
interface Patron { actor: LiveActor; seated: boolean; zone: string; unseen: number; headTimer: number; talking: boolean; turned: boolean }

const FLICKER_EVERY: Record<DreadTier, number> = { calm: 0, uneasy: 45, haunted: 25, watched: 15, dire: 10 };
/** Shared per-zone cooldown between patron changes (GDD §6.4). */
const PATRON_COOL: Record<DreadTier, number> = { calm: 0, uneasy: 20, haunted: 10, watched: 5, dire: 5 };
const PA_EVERY = 100;                   // s, mean interval from Uneasy up
const WHISPER_MIN = 6, WHISPER_MAX = 10;
const JUMP_MIN = 240, JUMP_MAX = 420;

export class HorrorDirector {
  readonly dread = new DreadMeter();
  private lastRounded = -1;
  private gradeTimer = 0;
  private lastMusicDread = -1;

  private tFlicker = 0;
  private tBlackout = 0;
  private blackoutLeft = 0;
  private tWhisper = 0;
  private tPa = 0;
  private tJump = 0;
  private paLast = -1;
  private whisperLast = -1;

  private readonly patrons: Patron[] = [];
  private readonly patronCool = new Map<string, number>();

  private walkToken = 0;
  private collector: LiveActor | null = null;
  private clinkLeft = 0;
  private clinkTimer = 0;
  // THE DARK CROWD (wave 72): 4-6 dark patrons wander the floor. Built here, spawned once the level exists (`lights()` is set).
  private readonly darkPatrons: DarkPatrons;
  private darkPatronsStarted = false;

  constructor(private readonly d: HorrorDeps) {
    this.darkPatrons = new DarkPatrons({ actors: d.actors, rnd: () => d.rng.next() });
    this.tFlicker = this.jitter(FLICKER_EVERY.uneasy);
    this.tBlackout = this.jitter(90);
    this.tWhisper = this.jitter((WHISPER_MIN + WHISPER_MAX) / 2);
    this.tPa = this.jitter(PA_EVERY);
    this.tJump = this.jitter((JUMP_MIN + JUMP_MAX) / 2);
  }

  /** Current Dread 0..100 (slewed). */
  get value(): number { return this.dread.value; }
  get tier(): DreadTier { return this.dread.tier; }
  /** Dread as 0..1 (matches RunApi.dread()). */
  get fraction(): number { return this.dread.value / 100; }

  /** Advance one sim frame. `dt` is sim seconds (paused with the game); `realDt` moves the actors and their heads. */
  update(dt: number, s: HorrorState, realDt = dt): void {
    const set = this.d.settings();
    const v = this.dread.update(dt, s);
    const tier = this.dread.tier;
    // dread:change is 0..1, the unit RunApi.dread() emits (run.ts), so the story stingers and the light grade read one scale.
    const rounded = Math.round(v);
    if (rounded !== this.lastRounded) { this.lastRounded = rounded; bus.emit('dread:change', { value: rounded / 100 }); }

    // Grade the room and the score. Cheap, so once every half second is plenty.
    this.gradeTimer -= dt;
    if (this.gradeTimer <= 0) {
      this.gradeTimer = 0.5;
      this.d.lights()?.setDread(v / 100);
    }
    if (Math.abs(v / 100 - this.lastMusicDread) > 0.01) {
      this.lastMusicDread = v / 100;
      this.d.audio.music.setDread(v / 100, 1.5);
    }

    if (this.blackoutLeft > 0) {
      this.blackoutLeft -= dt;
      if (this.blackoutLeft <= 0) this.endBlackout();
    }

    if (!set.calm) this.tickScares(dt, s, tier);
    this.tickPa(dt, tier, set);
    this.tickPatrons(realDt, tier, set);
    this.tickCollector(dt, s);
    if (!this.darkPatronsStarted && this.d.lights()) { this.darkPatronsStarted = true; void this.darkPatrons.start(); }
    this.darkPatrons.tick(realDt);
    this.d.actors.update(realDt);
  }

  /** Bump Dread from a run event (curse, shrine, full moon…). Calm Mode halves the bump. */
  notify(kind: DreadEventKind): void {
    const calm = this.d.settings().calm;
    this.dread.bump(kind, calm ? 0.5 : 1);
    bus.emit('horror:event', { kind, dread: this.fraction });
  }

  /** Speak a House PA line (index 0..7, or random). Called by the scheduler and by beats (Last Call, Dawn). */
  pa(index?: number): void {
    const n = 8;
    let i = index ?? this.d.rng.int(0, n - 1);
    if (index === undefined && i === this.paLast) i = (i + 1) % n;
    this.paLast = i;
    const set = this.d.settings();
    const text = t(`horror.pa.${clamp(i, 0, n - 1)}`);
    const distort = set.calm ? 0 : this.dread.tier === 'calm' ? 0.1 : this.dread.tier === 'uneasy' ? 0.2 : 0.4;
    this.speak('house', text, t('horror.speaker.house'), { mood: 'calm', distort, duck: true }, set.subtitles);
    bus.emit('horror:event', { kind: 'pa', dread: this.fraction });
  }

  /** Register a guest mannequin for the shift rule. Seated guests use the sitting clips. */
  addPatron(actor: ActorHandle, zone: string, seated = false): void {
    if (!(actor instanceof LiveActor)) return;
    this.patrons.push({ actor, seated, zone, unseen: 0, headTimer: 0, talking: false, turned: false });
  }

  removePatron(actor: ActorHandle): void {
    const i = this.patrons.findIndex((p) => p.actor === actor);
    if (i >= 0) this.patrons.splice(i, 1);
  }

  /**
   * Dawn: the Collector walks the halls before the deposit is settled (GDD §6.4). Does nothing when the quota is met.
   * Calm Mode keeps only the coin-clink footsteps from the lift shaft, with no figure.
   */
  startDawnWalk(s: HorrorState): void {
    if (this.collector || this.clinkLeft > 0) return;
    if (s.quota > 0 && s.deposit >= s.quota) return;
    if (this.d.settings().calm) { this.clinkLeft = CALM_DAWN_SECONDS; this.clinkTimer = 0; return; }
    void this.spawnCollector(++this.walkToken);
  }

  /** Stop the walk now and remove the Collector (also called when the deposit meets the quota). */
  stopDawnWalk(): void {
    this.walkToken++;
    this.clinkLeft = 0;
    if (this.collector) { this.d.actors.despawn(this.collector); this.collector = null; }
  }

  dispose(): void {
    this.stopDawnWalk();
    this.darkPatrons.dispose();
    this.patrons.length = 0;
    this.endBlackout();
    this.d.lights()?.setDread(0);
    this.d.audio.music.setDread(0, 1);
  }

  // ── scares ────────────────────────────────────────────────────────────────────────────────────

  private tickScares(dt: number, s: HorrorState, tier: DreadTier): void {
    const set = this.d.settings();
    // flicker bursts: Uneasy and up
    if (tier !== 'calm') {
      this.tFlicker -= dt;
      if (this.tFlicker <= 0) {
        this.tFlicker = this.jitter(FLICKER_EVERY[tier]);
        this.flicker(set.reduceFlashing);
      }
    }
    // blackout bursts: Watched and up, a single zone at a time (whole pit when no zones given)
    if (tier === 'watched' || tier === 'dire') {
      this.tBlackout -= dt;
      if (this.tBlackout <= 0 && this.blackoutLeft <= 0) {
        this.tBlackout = this.jitter(tier === 'dire' ? 60 : 90);
        this.blackout();
      }
    }
    // whispers: luck ≤ −3 or bad_run
    if (s.luck <= -3 || s.badRun) {
      this.tWhisper -= dt;
      if (this.tWhisper <= 0) {
        this.tWhisper = this.jitter((WHISPER_MIN + WHISPER_MAX) / 2);
        this.whisper();
      }
    } else {
      this.tWhisper = 3;   // first whisper ~3 s after the condition starts; no RNG draw per frame
    }
    // jump stingers: rare, Haunted and up
    if (TIER_RANK[tier] >= TIER_RANK.haunted) {
      this.tJump -= dt;
      if (this.tJump <= 0) {
        this.tJump = this.jitter((JUMP_MIN + JUMP_MAX) / 2);
        this.jump(set.reduceFlashing);
      }
    }
  }

  private flicker(reduceFlashing: boolean): void {
    const lights = this.d.lights();
    if (!lights) return;
    const amount = reduceFlashing ? 0.2 : 0.55;
    lights.flicker(this.pickZone(), amount, this.d.rng.float(0.2, 0.6));
    this.d.audio.play('lightFlicker', { vol: 0.6, pos: this.nearestOf(), bus: 'sfx' });
    bus.emit('horror:event', { kind: 'flicker', dread: this.fraction });
  }

  private blackout(): void {
    const lights = this.d.lights();
    const dur = this.d.rng.float(12, 20);
    this.blackoutLeft = dur;
    this.d.audio.play('powerDown', { vol: 0.8 });
    this.d.audio.setMuffle(0.6, 0.3);
    lights?.setLevel(this.pickZone(), 0.12, 0.25);
    this.notify('blackout');
  }

  private endBlackout(): void {
    this.blackoutLeft = 0;
    this.d.lights()?.setLevel('all', 1, 1.2);
    this.d.audio.setMuffle(0, 1);
    this.d.audio.play('powerUp', { vol: 0.7 });
  }

  private jump(reduceFlashing: boolean): void {
    this.d.audio.music.stinger('jumpscare', { vol: 0.8 });
    if (!reduceFlashing) this.d.lights()?.pulse('all', { color: 0x330000, mul: 0.4, dur: 0.5 });
    bus.emit('horror:event', { kind: 'jump', dread: this.fraction });
  }

  private whisper(): void {
    const set = this.d.settings();
    let i = this.d.rng.int(0, 11);
    if (i === this.whisperLast) i = (i + 1) % 12;
    this.whisperLast = i;
    const text = t(`horror.whisper.${i}`);
    this.speak('mannequin', text, t('horror.speaker.whisper'), { mood: 'whisper', distort: 0, duck: false }, set.subtitles);
    bus.emit('horror:event', { kind: 'whisper', dread: this.fraction });
  }

  private tickPa(dt: number, tier: DreadTier, set: HorrorSettings): void {
    if (tier === 'calm') return;
    this.tPa -= dt;
    if (this.tPa <= 0) {
      this.tPa = this.jitter(set.calm ? PA_EVERY * 2 : PA_EVERY);
      this.pa();
    }
  }

  // ── speech ────────────────────────────────────────────────────────────────────────────────────

  private speak(
    speaker: 'house' | 'mannequin', text: string, label: string,
    o: { mood: 'calm' | 'whisper'; distort: number; duck: boolean }, subs: boolean,
  ): void {
    const dur = clamp(1.5 + text.length * 0.06, 2, 8);
    if (subs) this.d.subtitle(text, label, dur);
    this.d.audio.voice.speak({ speaker, text, mood: o.mood, distort: o.distort, duck: o.duck }).catch((): void => undefined);
  }

  // ── patrons: shift only while unobserved (GDD §6.4) ─────────────────────────────────────────

  private tickPatrons(dt: number, tier: DreadTier, set: HorrorSettings): void {
    for (const [z, c] of this.patronCool) if (c - dt <= 0) this.patronCool.delete(z); else this.patronCool.set(z, c - dt);
    const viewers = this.d.viewers();
    if (viewers.length === 0) return;
    for (let i = this.patrons.length - 1; i >= 0; i--) {
      const p = this.patrons[i];
      if (!p.actor.alive) { this.patrons.splice(i, 1); continue; }
      const pos = new THREE.Vector3(p.actor.root.position.x, p.actor.root.position.y + 1, p.actor.root.position.z);
      const seen = observed(viewers, pos);
      if (seen) {
        p.unseen = 0;
        if (p.turned) { this.d.actors.lookForward(p.actor); p.turned = false; }
        continue;
      }
      p.unseen += dt;
      if (p.turned) {
        p.headTimer -= dt;
        if (p.headTimer <= 0) { this.d.actors.lookForward(p.actor); p.turned = false; }
      }
      if (set.calm || TIER_RANK[tier] < TIER_RANK.uneasy || p.unseen < 2) continue;
      if ((this.patronCool.get(p.zone) ?? 0) > 0) continue;
      this.shiftPatron(p, tier, viewers);
      this.patronCool.set(p.zone, PATRON_COOL[tier]);
      p.unseen = 0;
    }
  }

  private shiftPatron(p: Patron, tier: DreadTier, viewers: readonly Viewer[]): void {
    const rng = this.d.rng;
    if (TIER_RANK[tier] >= TIER_RANK.watched && this.d.freeSpot && rng.chance(0.25)) {
      const spot = this.d.freeSpot(p.zone);
      if (spot) {
        void this.d.actors.walkPath(p.actor, spot);
        this.patronBeat();
        return;
      }
    }
    if (rng.chance(0.5)) {
      p.talking = !p.talking;
      const clip = p.seated
        ? (p.talking ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop')
        : (p.talking ? 'Idle_Talking_Loop' : 'Idle_Loop');
      void this.d.actors.play(p.actor, clip, { loop: true });
    } else {
      const root = p.actor.root;
      const near = nearestViewer(viewers, root.position);
      if (!near) return;
      const want = Math.atan2(near.x - root.position.x, near.z - root.position.z);
      // head yaw toward the nearest player, never more than 90° away from the body's facing
      const rel = clamp(normalizeAngle(want - root.rotation.y), -Math.PI / 2, Math.PI / 2);
      const yaw = root.rotation.y + rel;
      const aim: V3 = [root.position.x + Math.sin(yaw) * 3, EYE_HEIGHT, root.position.z + Math.cos(yaw) * 3];
      this.d.actors.lookAt(p.actor, aim);
      p.turned = true;
      p.headTimer = 4;
    }
    this.patronBeat();
  }

  private patronBeat(): void {
    bus.emit('horror:event', { kind: 'patronShift', dread: this.fraction });
  }

  // ── the Collector (Dawn walk) ───────────────────────────────────────────────────────────────

  private async spawnCollector(token: number): Promise<void> {
    const a = await this.d.actors.spawn('collector', LIFT, { dressing: 'collector' });
    if (!(a instanceof LiveActor)) return;
    if (token !== this.walkToken) { this.d.actors.despawn(a); return; }
    this.collector = a;
    a.walkClip = 'Walk_Formal_Loop';
    a.walkSpeed = 1.2;
    a.stepEvery = 1.2 * CLINK_GAP;
    a.onStep = (c) => this.d.audio.play('coin', { pos: c.root, vol: 0.7, priority: 6 });
    bus.emit('horror:event', { kind: 'collectorWalk', dread: this.fraction });

    const stops = this.d.rng.shuffle([...HALL]).slice(0, 3);
    for (const p of [...stops, LIFT]) {
      if (token !== this.walkToken) return;
      const ok = await this.d.actors.walkPath(a, p);
      if (!ok) break;
    }
    if (token === this.walkToken) this.stopDawnWalk();
  }

  private tickCollector(dt: number, s: HorrorState): void {
    const met = s.quota > 0 && s.deposit >= s.quota;
    if (met && (this.collector || this.clinkLeft > 0)) { this.stopDawnWalk(); return; }
    if (this.clinkLeft > 0) {
      this.clinkLeft -= dt;
      this.clinkTimer -= dt;
      if (this.clinkTimer <= 0) {
        this.clinkTimer = CLINK_GAP;
        this.d.audio.play('coin', { pos: new THREE.Vector3(LIFT[0], 1.5, LIFT[2]), vol: 0.5, priority: 6 });
      }
      if (this.clinkLeft <= 0) this.clinkLeft = 0;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────

  private jitter(mean: number): number { return mean * this.d.rng.float(0.75, 1.25); }

  private pickZone(): WorldLightTarget {
    const zs = this.d.zones;
    if (!zs || zs.length === 0) return 'all';
    return this.d.rng.pick(zs);
  }

  /** A sound source near the first viewer (flicker buzz). Undefined = non-positional. */
  private nearestOf(): THREE.Vector3 | undefined {
    const v = this.d.viewers()[0];
    if (!v) return undefined;
    return new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]);
  }
}

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function createHorror(deps: HorrorDeps): HorrorDirector {
  return new HorrorDirector(deps);
}
