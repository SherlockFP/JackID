/**
 * Cutscene effect cues (CUTSCENE WP): audio, screen FX, lights and subtitles. Each function applies one cue to the
 * live services. `seek = true` means "jump to the end state": state cues (music, fades, light levels, letterbox)
 * settle instantly, transient cues (one-shots, shakes, flashes, pulses) are skipped. Only the cutscene calls these.
 */
import * as THREE from 'three';
import type { AudioCue, CutTarget, FxCue, LightCue, SubtitleCue } from './types';
import type { WorldLightTarget } from '@/world/types';
import type { Voice } from '../audio/types';
import { app } from '../app';
import { glitchPulse } from '../fx';
import { subtitles } from '../ui/subtitles';
import { t, type I18nVars } from '../i18n';
import type { PointResolver } from './actors';

/** A voice started by a cue; stopped when its `until` passes (or at the end of the run). */
export interface TrackedVoice { voice: Voice; until: number }

export interface EffectCtx {
  resolve: PointResolver;
  /** Current timeline time (s). */
  t: number;
  voices: TrackedVoice[];
}

/** Audio cue. One-shots and stingers are transient; music, ambience, jukebox and muffle are state. */
export function applyAudio(c: AudioCue, seek: boolean, ctx: EffectCtx): void {
  const music = app.audio.music;
  switch (c.do) {
    case 'sfx': {
      if (seek) return;
      const pos = c.at ? ctx.resolve(c.at, 'pos', new THREE.Vector3()) : undefined;
      const voice = app.audio.play(c.name, { vol: c.vol, pitch: c.pitch, pos, loop: c.loop });
      if (voice && (c.stopAfter !== undefined || c.loop)) {
        ctx.voices.push({ voice, until: c.stopAfter !== undefined ? ctx.t + c.stopAfter : Infinity });
      }
      return;
    }
    case 'stinger':
      if (!seek) music.stinger(c.id, { vol: c.vol });
      return;
    case 'music': {
      const fade = seek ? 0 : c.fade;
      music.setState(c.state, { fade });
      if (c.intensity !== undefined) music.setIntensity(c.intensity, seek ? 0 : (c.fade ?? 0.5));
      if (c.dread !== undefined) music.setDread(c.dread, seek ? 0 : (c.fade ?? 0.5));
      return;
    }
    case 'ambience':
      app.audio.ambience(c.id, seek ? 0 : c.fade);
      return;
    case 'jukebox':
      if (c.track === null) music.stop(seek ? 0 : 0.5);
      else music.play(c.track, { fade: seek ? 0 : 0.5 });
      return;
    case 'muffle':
      app.audio.setMuffle(c.amount, seek ? 0 : c.ramp);
      return;
  }
}

/**
 * The HUD root while a letterboxed scene runs: `.cut-lb` (ui.css) hides the seat HUD and the machine bar under the bars.
 * Set by the letterbox cue and by the player at scene start / end; a missing HUD is ignored.
 */
export function cutLetterbox(on: boolean): void {
  try { document.querySelector('.px-root')?.classList.toggle('cut-lb', on); } catch { /* no HUD yet */ }
}

/** Screen FX cue. Fades and letterbox are state; shakes, flashes, tints, zooms, slow-mo and hit-stop are transient. */
export function applyFx(c: FxCue, seek: boolean): void {
  switch (c.do) {
    case 'fade':
      void app.ui.fade(c.alpha, seek ? 0 : c.dur, c.color);
      return;
    case 'letterbox':
      void app.ui.letterbox(c.amount, seek ? 0 : c.dur);
      cutLetterbox(c.amount > 0);
      return;
    case 'shake':
      if (!seek) app.fx.shake(c.amp, c.dur, { roll: c.roll });
      return;
    case 'flash':
      if (!seek) app.fx.flash(c.color, c.alpha ?? 1, c.dur);
      return;
    case 'tint':
      if (!seek) app.fx.tint(c.color, c.alpha, c.dur);
      return;
    case 'chroma':
      if (!seek) app.fx.chroma(c.px, c.dur);
      return;
    case 'zoom':
      if (!seek) app.fx.zoomPunch(c.amount, c.dur);
      return;
    case 'slowmo':
      if (!seek) app.fx.slowmo(c.scale, c.dur);
      return;
    case 'hitstop':
      if (!seek) app.fx.hitstop(c.sec);
      return;
    case 'glitch':
      if (!seek) glitchPulse(c.amount, c.dur);
      return;
  }
}

/** Light cue. Levels settle (state); pulses and flickers are transient. */
export function applyLight(c: LightCue, seek: boolean): void {
  const lights = app.world?.lights;
  if (!lights) return;
  const target = lightTarget(c.target);
  if (target === null) return;
  if (c.restore) {
    if (!seek) lights.pulse(target, { color: c.color ?? undefined, mul: c.level ?? 1.8, dur: c.dur ?? 0.6 });
    return;
  }
  if (c.flicker !== undefined && !seek) lights.flicker(target, c.flicker, c.dur ?? 1);
  if (c.level !== undefined || c.color !== undefined) {
    lights.setLevel(target, c.level ?? 1, seek ? 0 : (c.dur ?? 0), c.color ?? null);
  }
}

function lightTarget(tg: LightCue['target']): WorldLightTarget | null {
  if (tg === 'all' || typeof tg === 'string') return tg;
  if ('machine' in tg) return tg.machine;
  const obj = app.world?.anchor(tg.anchor) ?? null;
  if (!obj) return null;
  return obj;
}

/**
 * Subtitle cue: translated text and speaker, typed out in the cue's voice when it names one (ui/subtitles.ts). The cue's
 * `dur` is the line's whole on-screen time, so the typing fits inside the authored cue. A seeking peer (`since` s after
 * the cue was due) gets what is still left of the line, shown at once and silent.
 */
export function showSubtitle(c: SubtitleCue, vars: I18nVars, seek: boolean, since = 0): void {
  if (seek && since >= c.dur) return;
  const text = t(c.key, { ...vars, ...c.vars });
  const speaker = c.speaker ? t(c.speaker) : undefined;
  subtitles.say({
    text, speaker, lane: 'cutscene',
    voice: seek ? undefined : c.voice,
    fit: seek ? c.dur - since : c.dur,
    instant: seek,
  });
  // Per-letter blips do not duck the score the way voice.speak did: hold the music down while the line is voiced.
  if (!seek && c.voice) app.audio.duck('music', 0.35, c.dur);
}

export type { CutTarget };

/** How the Gambler's Eye cut treats the screen: Calm Mode keeps the slow motion and drops flash, hit-stop and chroma. */
export interface EyeCloseUp {
  calm: boolean;
  /** reduceFlashing: no white flash. */
  noFlash: boolean;
  /** Length of the cut in seconds (default 0.6). */
  dur?: number;
  /** Long read (true) slows time more than a key-throw cut (false). */
  read?: boolean;
}

/**
 * The world half of the eye close-up (STORY_BIBLE section 6.5 and 6.6): a hard cut-in (a zoom punch standing in for the narrow
 * fov 18 lens), slow motion, a cold tint, and the hit. The DOM half (vignette, eye panel, thought) is `core/ui/manga/eye.ts`.
 * Slow motion never weakens a running one (`fx.slowmo`), and it is capped in online play. Transient: nothing to restore.
 */
export function eyeCloseUp(o: EyeCloseUp): void {
  const dur = o.dur ?? 0.6;
  const fx = app.fx;
  fx.slowmo(o.read === false ? 0.45 : 0.25, dur + 0.5);
  fx.tint(0x1a2230, o.calm ? 0.18 : 0.3, dur + 0.6);
  if (o.calm) return;
  fx.zoomPunch(0.28, dur);
  fx.chroma(2, 0.3);
  fx.hitstop(0.05);
  if (!o.noFlash) fx.flash(0xffffff, 0.22, 0.12);
}
