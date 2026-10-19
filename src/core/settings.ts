/**
 * Settings model + defaults + sanitizer (TD-owned). Contract: TECH_SPEC §2.12 (+ v1 accessibility/juice fields).
 * `sanitizeSettings` accepts anything (old saves, hand-edited JSON) and returns a complete, in-range Settings.
 */
import type { Lang } from './types';
import type { PsxSettings } from './renderer/types';

export interface Settings {
  lang: Lang;
  mouseSens: number;            // rad/px 0.0005..0.006, def 0.0022
  invertY: boolean;
  fov: number;                  // 60..95, def 72
  headBob: number;              // 0..1, def 1
  viewmodel: boolean;           // first-person hands on/off (HANDS / ELLER)
  gloves: boolean;              // dark leather gloves (true) or the old ivory gloves (false) (GLOVES / ELDİVEN)
  vol: { master: number; sfx: number; ui: number; music: number; amb: number; voice: number };
  psx: PsxSettings;
  showFps: boolean;
  crosshair: 'dot' | 'cross' | 'none';
  subtitles: boolean;
  subtitleSpeed: 'slow' | 'normal' | 'instant';   // typewriter speed of the subtitle bar (ui/subtitles.ts)
  reduceFlashing: boolean;      // photosensitivity: flashes ×0.35, ≤ 3/s, strobes off
  reduceMotion: boolean;        // subtitles appear at once; no slide, fade or caret
  calm: boolean;                // Calm Mode: horror scares off, dread bumps halved (HorrorSettings.calm)
  // ── v1 ──
  shake: number;                // 0..1 screen-shake multiplier (ART_BIBLE §9.6)
  textScale: number;            // 1..1.5 UI text scale
  uiScale: number;              // 0.6..1.3 overall UI size, 1 = 100 % (the unit `floor(H / 270)` px); def 0.75 (-25 %)
  colorblind: boolean;         // shape-backed symbols/colours
  holdToConfirm: boolean;       // accessibility: dangerous actions need a hold
  waymark: boolean;             // the objective diamond with its distance (menu/hud/waymark.ts), Advanced > Interface
  proxVoice: { enabled: boolean; pushToTalk: boolean; volume: number };
  keybinds: Partial<Record<string, string[]>>;
  net: {
    lobbyUrl: string;           // '' = default
    useServer: boolean; useTab: boolean; useP2P: boolean;   // useP2P def false
    turn: { urls: string; username: string; credential: string } | null;
  };
}

export const DEFAULT_PSX: PsxSettings = {
  enabled: true, targetHeight: 360, jitter: 0.5, affine: true, dither: true, colorBits: 5,
  crt: true, scanlines: 0.22, vignette: 0.35, drawDistance: 'normal',
};

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  mouseSens: 0.0022,
  invertY: false,
  fov: 72,
  headBob: 1,
  viewmodel: true,
  gloves: true,
  vol: { master: 0.8, sfx: 0.9, ui: 0.8, music: 0.6, amb: 0.7, voice: 0.9 },
  psx: DEFAULT_PSX,
  showFps: false,
  crosshair: 'dot',
  subtitles: true,
  subtitleSpeed: 'normal',
  reduceMotion: false,
  reduceFlashing: false,
  calm: false,
  shake: 1,
  textScale: 1,
  uiScale: 0.75,
  colorblind: false,
  holdToConfirm: false,
  waymark: true,
  proxVoice: { enabled: false, pushToTalk: true, volume: 0.8 },
  keybinds: {},
  net: { lobbyUrl: '', useServer: true, useTab: true, useP2P: false, turn: null },
};

const RANGES: Record<string, [number, number]> = {
  mouseSens: [0.0005, 0.006], fov: [60, 95], headBob: [0, 1],
  'vol.master': [0, 1], 'vol.sfx': [0, 1], 'vol.ui': [0, 1], 'vol.music': [0, 1], 'vol.amb': [0, 1], 'vol.voice': [0, 1],
  'psx.jitter': [0, 1], 'psx.scanlines': [0, 1], 'psx.vignette': [0, 1],
  shake: [0, 1], textScale: [1, 1.5], uiScale: [0.6, 1.3], 'proxVoice.volume': [0, 1],
};
const ENUMS: Record<string, readonly (string | number)[]> = {
  lang: ['en', 'tr'], crosshair: ['dot', 'cross', 'none'],
  'psx.targetHeight': [180, 224, 240, 288, 360], 'psx.colorBits': [5, 6, 8], 'psx.drawDistance': ['near', 'normal', 'far'],
};

function walk(raw: unknown, def: unknown, path: string): unknown {
  if (typeof def === 'number') {
    if (typeof raw !== 'number' || !isFinite(raw)) return def;
    const r = RANGES[path];
    const v = r ? Math.min(r[1], Math.max(r[0], raw)) : raw;
    const e = ENUMS[path];
    return e && !e.includes(v) ? def : v;
  }
  if (typeof def === 'boolean') return typeof raw === 'boolean' ? raw : def;
  if (typeof def === 'string') {
    if (typeof raw !== 'string') return def;
    const e = ENUMS[path];
    return e && !e.includes(raw) ? def : raw;
  }
  if (path === 'keybinds') {
    const out: Record<string, string[]> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[];
      }
    }
    return out;
  }
  if (path === 'net.turn') {
    const t = raw as { urls?: unknown; username?: unknown; credential?: unknown } | null;
    return t && typeof t.urls === 'string' && typeof t.username === 'string' && typeof t.credential === 'string'
      ? { urls: t.urls, username: t.username, credential: t.credential }
      : null;
  }
  if (def && typeof def === 'object') {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(def as object)) out[k] = walk(src[k], (def as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    return out;
  }
  return def;
}

/** Merge arbitrary data over the defaults; never throws, always returns a valid Settings. */
export function sanitizeSettings(raw: unknown): Settings {
  return walk(raw, DEFAULT_SETTINGS, '') as Settings;
}
export function cloneSettings(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings;
}
