/**
 * FX / juice toolkit (CORE-RENDER). Contract: `fx/types.ts` (frozen), BRIEF ADDENDUM 8 "JUICE IS KING", ART_BIBLE §9.
 * Keep the type re-export below: the spec's import path is `@/core/fx`.
 *
 * World-space effects live in `fx/particles.ts` (7 instanced emitters) and `fx/popText.ts` (one instanced text
 * mesh); both render in the FX layer right after the main scene, so they work in every state with no scene wiring.
 * Screen-space effects tween the post state (`renderer.post`: flash, tint, chroma, zoom, glitch) with ONE tween per
 * channel (a new pulse replaces the old one; a weaker flash never cuts a stronger one). Camera shake and light
 * pulses are applied by the renderer at draw time and undone afterwards (`fx/layer.ts`). Slow-mo / hit-stop drive
 * `app.timeScale` / `app.hitstopLeft` (the loop clamps online play) and the audio time-scale.
 *
 * Honours `settings.shake` (multiplier) and `settings.reduceFlashing` (flash alpha ×0.35, ≥ 333 ms apart).
 * Extras outside the frozen interface: {@link glitchPulse} (horror stingers), {@link setPostLevel}.
 */
import * as THREE from 'three';
import type { BurstOpts, FxApi, ParticlePreset, PopTextOpts } from './fx/types';
import type { Hex, PosLike } from './types';
import type { PsxPostState } from './renderer/types';
import type { Ease, TweenHandle } from './tween';
import type { WinTier } from '@/game/types';
import { app } from './app';
import { bus } from './events';
import { fmtCoins } from './i18n';
import { clamp } from './math';
import { fxLayer } from './fx/layer';
import { ParticleSystem } from './fx/particles';
import { PopTextSystem } from './fx/popText';

export type * from './fx/types';

const GOLD = 0xefd67b;        // P24 GOLD_SHINE
const PAPER = 0xf7efde;       // P10
const WIN_GREEN = 0x5aff7b;   // P33
const LOSS_RED = 0xc52129;    // P14
const FLASH_GAP_MS = 333;

const POST_KEYS = ['flashAlpha', 'tintAlpha', 'chroma', 'zoom', 'vignetteBoost', 'desaturate', 'blackout', 'glitch'] as const;
type PostKey = (typeof POST_KEYS)[number];

/** One tween per post channel; starting a new one cancels the previous. */
const channels = new Map<PostKey, TweenHandle>();
function ramp(key: PostKey, from: number, to: number, dur: number, ease: Ease, hold = 0): void {
  const post = app.renderer.post;
  channels.get(key)?.cancel();
  post[key] = from;
  if (dur <= 0) { post[key] = to; return; }
  channels.set(key, app.tweens.ui.to(post, { [key]: to } as Partial<Record<PostKey, number>>, dur, { ease, delay: hold }));
}

/** Short horizontal-tear + RGB-split burst (horror stingers, cutscene `glitch` cues). 0..1. */
export function glitchPulse(amount: number, dur: number): void {
  if (app.save.data.settings.reduceFlashing) amount *= 0.35;
  ramp('glitch', clamp(amount, 0, 1), 0, dur, 'outQuad');
}

/** Sustained post levels (not part of FxApi): ease a channel to `value` over `dur`; 0 returns to rest. */
export function setPostLevel(key: 'vignetteBoost' | 'desaturate' | 'blackout', value: number, dur = 0.3): void {
  const post = app.renderer.post;
  ramp(key, post[key], value, dur, 'inOutQuad');
}

/** Resolve a `PosLike` into `out` (world space). */
function resolve(at: PosLike, out: THREE.Vector3): THREE.Vector3 {
  if (Array.isArray(at)) return out.set(at[0], at[1], at[2]);
  if ((at as THREE.Object3D).isObject3D) return (at as THREE.Object3D).getWorldPosition(out);
  const v = at as { x: number; y: number; z: number };
  return out.set(v.x, v.y, v.z);
}

export function createFx(): FxApi {
  const ps = new ParticleSystem();
  const pops = new PopTextSystem();
  fxLayer.scene.add(ps.group, pops.mesh);
  fxLayer.register(ps);
  fxLayer.register(pops);

  const v = new THREE.Vector3();
  const reduce = (): boolean => app.save.data.settings.reduceFlashing;
  const post = (): PsxPostState => app.renderer.post;
  let slowH: TweenHandle | null = null;
  let slowAudio = 1;
  let lastFlashAt = -1e9;

  const resetSlowmo = (): void => {
    slowH?.cancel(); slowH = null;
    if (app.timeScale !== 1) app.timeScale = 1;
    if (slowAudio !== 1) { slowAudio = 1; app.audio.setTimeScale(1, 0.1); }
  };
  // Gameplay clocks never leak across states (`app.go` resets the time scale itself); stop our tween too.
  bus.on('app:state', () => { resetSlowmo(); fxLayer.reset(); });

  const api: FxApi = {
    // ── particles ──
    burst(preset: ParticlePreset, at: PosLike, n: number, o?: BurstOpts) {
      resolve(at, v);
      ps.burst(preset, v.x, v.y, v.z, n, o, (at as THREE.Object3D).isObject3D ? (at as THREE.Object3D) : null);
    },
    coins(at, n, o) {
      api.burst('coins', at, Math.min(60, n), { spread: o?.spread, up: o?.up, over: o?.over });
    },
    sparks(at, n, color) { api.burst('sparks', at, n, { color }); },
    confetti(at, n) { api.burst('confetti', at, n); },
    smoke(at, n) { api.burst('smoke', at, n); },
    dust(at, n = 6) { api.burst('dust', at, n); },
    glow(at, color, size, dur = 0.4) { resolve(at, v); ps.glow(v.x, v.y, v.z, color, size, dur); },
    trail: (target, o) => ps.trail(target, o),
    decal(at, kind, o) { resolve(at, v); ps.decal(v.x, v.y, v.z, kind, o); },

    // ── floating numbers ──
    popText(at, text, color, dur) {
      resolve(at, v);
      const o: PopTextOpts = typeof dur === 'number' ? { dur } : dur ?? {};
      pops.spawn(v.x, v.y, v.z, text, color, o);
    },

    // ── screen space ──
    shake(amp, dur, o) {
      const k = app.save.data.settings.shake;
      if (k <= 0) return;
      fxLayer.addShake(amp * k, dur, (o?.roll ?? amp * 35) * k, o?.freq ?? 25, o?.sustain ?? 0);
    },
    flash(color, alpha, dur) {
      const p = post();
      const now = performance.now();
      if (reduce()) {
        if (now - lastFlashAt < FLASH_GAP_MS) return;
        alpha *= 0.35;
      }
      if (p.flashAlpha > alpha * 0.8 && channels.get('flashAlpha') && !channels.get('flashAlpha')!.done) return;
      lastFlashAt = now;
      p.flashColor = color;
      ramp('flashAlpha', alpha, 0, dur, 'outQuad', 0.017);
    },
    chroma(px, dur) { ramp('chroma', px, 0, dur, 'outQuad', 0.017); },
    tint(color, alpha, dur) {
      post().tintColor = color;
      ramp('tintAlpha', alpha, 0, dur, 'outQuad');
    },
    zoomPunch(amount, dur) { ramp('zoom', 1 + amount, 1, dur, 'outCubic', 0.017); },
    slowmo(scale, dur, o) {
      let s = clamp(scale, 0.05, 1);
      if (app.net.online) s = Math.max(s, 0.6);
      if (slowH && !slowH.done && app.timeScale < s) return;            // never weaken a running slow-mo
      slowH?.cancel();
      app.timeScale = s;
      slowAudio = s;
      app.audio.setTimeScale(s, 0.04);
      slowH = app.tweens.ui.run(dur, (k) => {
        const cur = s + (1 - s) * k;
        app.timeScale = cur;
        if (Math.abs(cur - slowAudio) > 0.06) { slowAudio = cur; app.audio.setTimeScale(cur, 0.05); }
      }, {
        ease: o?.ease ?? 'inQuad',
        onDone: () => { app.timeScale = 1; slowAudio = 1; app.audio.setTimeScale(1, 0.15); slowH = null; },
      });
    },
    hitstop(sec) {
      app.hitstopLeft = Math.max(app.hitstopLeft, Math.min(sec, app.net.online ? 0.12 : 0.25));
    },

    // ── object juice ──
    squash: (obj, amount, dur) => app.tweens.sim.squash(obj, amount, dur),
    lightPulse(target, o) {
      resolve(target, v);
      const radius = o?.radius ?? 6;
      fxLayer.addBoost(v.x, v.y, v.z, { color: o?.color ?? null, mul: o?.mul ?? 2, radius, dur: o?.dur ?? 0.35 });
      ps.glow(v.x, v.y, v.z, o?.color ?? 0xffce5a, Math.max(0.35, radius * 0.12), (o?.dur ?? 0.35) * 1.2);
    },

    // ── composites ──
    winBurst(tier: WinTier, at, o) {
      if (tier === 'none') return;
      resolve(at, v);
      const x = v.x, y = v.y, z = v.z;
      const color = o?.color ?? GOLD;
      const big = tier === 'big' || tier === 'huge' || tier === 'jackpot';
      const at3: PosLike = [x, y, z];
      const coins = (n: number, over: number): void => ps.burst('coins', x, y, z, n, { over, dir: [0, 1, 0.6] });

      switch (tier) {
        case 'push':
          ps.glow(x, y, z, color, 0.3, 0.4);
          break;
        case 'small':
          coins(8, 0.4);
          ps.glow(x, y, z, color, 0.35, 0.4);
          break;
        case 'medium':
          coins(14, 0.6);
          api.sparks(at3, 14, color);
          api.lightPulse(at3, { color, mul: 1.5, radius: 5, dur: 0.4 });
          break;
        case 'big':
          coins(40, 1.2);
          api.sparks(at3, 28, color);
          api.flash(GOLD, 0.35, 0.05);
          api.shake(0.02, 0.5, { roll: 0.8 });
          api.hitstop(0.06);
          api.lightPulse(at3, { color, mul: 2, radius: 8, dur: 0.6 });
          break;
        case 'huge':
          coins(100, 2);
          api.confetti(at3, 80);
          api.sparks(at3, 40, color);
          api.flash(GOLD, 0.45, 0.05);
          api.shake(0.03, 0.7, { roll: 1.1 });
          api.zoomPunch(0.05, 0.5);
          api.hitstop(0.08);
          api.lightPulse(at3, { color, mul: 2.4, radius: 10, dur: 0.9 });
          break;
        case 'jackpot':
          coins(200, 3);
          api.confetti(at3, 160);
          api.sparks(at3, 60, color);
          api.flash(PAPER, 0.7, 0.033);
          app.timers.ui.after(0.06, () => api.flash(GOLD, 0.3, 0.05));
          api.shake(0.05, 0.8, { roll: 1.5 });
          api.zoomPunch(0.07, 0.6);
          api.hitstop(0.12);
          api.tint(GOLD, 0.25, 1.6);
          api.chroma(1.5, 0.8);
          api.lightPulse(at3, { color, mul: 3, radius: 14, dur: 1.2 });
          break;
        default:
          break;
      }

      if (o?.amount !== undefined && tier !== 'push') {
        const scale = tier === 'small' ? 1 : tier === 'medium' ? 1.15 : tier === 'big' ? 1.5 : tier === 'huge' ? 1.8 : 2.2;
        api.popText([x, y + 0.25, z], `+${fmtCoins(o.amount, true)}`, WIN_GREEN, {
          dur: big ? 1.4 : 1.1, rise: big ? 0.6 : 0.4, scale, shake: big,
          flyTo: o.flyToWallet ? 'wallet' : undefined, sfx: o.flyToWallet ? 'numberTick' : undefined,
        });
      }
    },

    loss(at, o) {
      resolve(at, v);
      const x = v.x, y = v.y, z = v.z;
      ps.burst('dust', x, y, z, 5);
      api.shake(0.006, 0.22, { roll: 0.25 });
      if (o?.amount !== undefined) {
        api.popText([x, y + 0.25, z], `-${fmtCoins(Math.abs(o.amount), true)}`, LOSS_RED, { dur: 1, rise: 0.3, scale: 1 });
      }
    },

    clear() {
      ps.clear();
      pops.clear();
      fxLayer.reset();
      resetSlowmo();
      const p = post();
      for (const k of POST_KEYS) channels.get(k)?.cancel();
      channels.clear();
      p.flashAlpha = 0; p.tintAlpha = 0; p.chroma = 0; p.zoom = 1; p.vignetteBoost = 0; p.desaturate = 0; p.blackout = 0; p.glitch = 0;
    },
  };
  return api;
}
