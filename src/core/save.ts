/**
 * Persistence (TD-owned). Contract: TECH_SPEC §2.12 (+ v1: meta progression, Hall of Losers, codex,
 * achievements, recent players). Storage key `jackid:v1`; every `localStorage` access is wrapped in
 * try/catch (private mode → in-memory only). Unknown / older data is migrated or reset PER FIELD, never throws.
 */
import type { Hex, MachineId } from './types';
import { DEFAULT_SETTINGS, applyPsxStyle, cloneSettings, psxStyleOf, sanitizeSettings, type Settings } from './settings';
import type { RunSnapshot, RunSummary } from '@/net/protocol';
import type { MetaState } from '@/game/types';
import type { DailyBest } from '@/game/daily';
import { bus } from './events';
import { log } from './log';
import { randomSeed } from './rng';

export const SAVE_KEY = 'jackid:v1';

/** A failed run frozen as a posed mannequin that stays in the pit forever (BRIEF ADDENDUM 5). */
export interface HallEntry { name: string; color: Hex; at: number; floor: number; shift: number; cause: string; seed: number; pose: string }
/** Someone you played with (friends infrastructure: invite shortcuts). */
export interface RecentPlayer { cid: string; name: string; color: Hex; lastSeen: number; games: number }

export interface SaveData {
  v: 1;
  profile: { id: string /* random 16 hex, stable client id */; name: string /* 1–16 chars, '' = unset */; color: Hex };
  settings: Settings;
  stats: Record<string, number>;     // lifetime counters (spins, wins, deepestFloor…)
  unlocks: string[];
  seen: Record<MachineId, number>;   // rounds played per machine (bestiary)
  history: RunSummary[];             // last 20
  resume: RunSnapshot | null;        // SP "Continue": written at each deadline start
  // ── v1 ──
  meta: MetaState;                   // prestige currency + permanent tree
  hall: HallEntry[];                 // Hall of Losers, last 50
  codex: Record<string, number>;     // discovered ids ('machine:roulette', 'charm:…', 'buff:…', 'note:…', 'boss:…') → times seen
  achievements: string[];
  recent: RecentPlayer[];            // last 30 co-players
  /** Lifetime count of Hollow Doors opened (the secret portal, once per run). Optional: older saves have none. */
  hollowSeen?: number;
  /** Stakes (game/stakes.ts): the highest stake cleared per kit id. Optional: older saves have none. */
  stakeCleared?: Record<string, number>;
  /** Daily run (game/daily.ts): the best result per UTC day, `YYYY-MM-DD`. Optional: older saves have none. */
  dailyBest?: Record<string, DailyBest>;
  /** KONSOL (game/cheats.ts): the seed of the run that took a cheat code. That run earns no achievements. Optional: older saves have none. */
  cheated?: number;
  /** Written by the Steam demo build (core/demo.ts) so the full game can tell a demo save and import it. Optional: full-game saves have none. */
  demo?: true;
}

export interface SaveStore {
  readonly data: SaveData;
  load(): void;
  update(fn: (d: SaveData) => void): void;        // mutate, debounced write 500 ms
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void;   // emits settings:changed
  flush(): void; reset(): void;
}

const PROFILE_COLORS: readonly Hex[] = [0xe6a52e, 0x4fc3ff, 0xff5a7a, 0x7dff7a, 0xc77dff, 0xff9a3c, 0x63e6de, 0xf2f2f2];

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  try { crypto.getRandomValues(a); } catch { for (let i = 0; i < bytes; i++) a[i] = randomSeed() & 255; }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
const strArr = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'number' && isFinite(x)) out[k] = x;
  return out;
}

/** Daily bests, kept only when the key is a `YYYY-MM-DD` day and the entry has its numbers. */
function dailyBestOf(v: unknown): Record<string, DailyBest> {
  const out: Record<string, DailyBest> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [day, e] of Object.entries(v as Record<string, unknown>)) {
    const x = e as Partial<DailyBest> | null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !x || typeof x !== 'object') continue;
    if (typeof x.seed !== 'number' || typeof x.night !== 'number' || typeof x.obols !== 'number') continue;
    out[day] = { date: day, seed: x.seed, kit: typeof x.kit === 'string' ? x.kit : '', night: x.night, obols: x.obols, result: typeof x.result === 'string' ? x.result : '' };
  }
  return out;
}

export function defaultMeta(): MetaState {
  return { obols: 0, spent: 0, nodes: {}, descents: 0, bestShift: 0, bestFloor: 0, unlocked: [] };
}
export function defaultSave(): SaveData {
  return {
    v: 1,
    profile: { id: randomHex(8), name: '', color: PROFILE_COLORS[randomSeed() % PROFILE_COLORS.length] },
    settings: cloneSettings(DEFAULT_SETTINGS),
    stats: {}, unlocks: [], seen: {}, history: [], resume: null,
    meta: defaultMeta(), hall: [], codex: {}, achievements: [], recent: [],
  };
}

/** Field-wise migration: anything malformed falls back to the default for that field only. */
export function migrateSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const p = (r.profile ?? {}) as Record<string, unknown>;
  if (typeof p.id === 'string' && /^[0-9a-f]{16}$/.test(p.id)) d.profile.id = p.id;
  if (typeof p.name === 'string') d.profile.name = p.name.slice(0, 16);
  if (typeof p.color === 'number') d.profile.color = p.color >>> 0;
  d.settings = sanitizeSettings(r.settings);
  d.stats = numRecord(r.stats);
  d.unlocks = strArr(r.unlocks, 2000);
  d.seen = numRecord(r.seen);
  // one-time bump: saves from before the 360p default get it once; a later lower choice sticks
  if (!d.seen['settings.res360']) { d.settings.psx.targetHeight = Math.max(d.settings.psx.targetHeight, DEFAULT_SETTINGS.psx.targetHeight); d.seen['settings.res360'] = 1; }
  // one-time: saves still on the old default look (Klasik PSX) get the lighter default; any manual PSX change stays
  if (!d.seen['settings.psxLight']) {
    if (psxStyleOf(d.settings.psx) === 'classic') d.settings.psx = applyPsxStyle(d.settings.psx, 'light');
    d.seen['settings.psxLight'] = 1;
  }
  if (Array.isArray(r.history)) d.history = (r.history as RunSummary[]).filter((h) => h && typeof h === 'object' && typeof h.seed === 'number').slice(-20);
  const rs = r.resume as RunSnapshot | null | undefined;
  d.resume = rs && typeof rs === 'object' && typeof rs.seed === 'number' && typeof rs.mode === 'string' ? rs : null;
  const m = (r.meta ?? {}) as Partial<MetaState>;
  d.meta = {
    obols: num(m.obols, 0), spent: num(m.spent, 0), nodes: numRecord(m.nodes), descents: num(m.descents, 0),
    bestShift: num(m.bestShift, 0), bestFloor: num(m.bestFloor, 0), unlocked: strArr(m.unlocked, 2000),
  };
  if (Array.isArray(r.hall)) d.hall = (r.hall as HallEntry[]).filter((h) => h && typeof h.name === 'string').slice(-50);
  d.codex = numRecord(r.codex);
  d.achievements = strArr(r.achievements, 500);
  if (Array.isArray(r.recent)) d.recent = (r.recent as RecentPlayer[]).filter((x) => x && typeof x.cid === 'string').slice(-30);
  if (typeof r.hollowSeen === 'number' && isFinite(r.hollowSeen) && r.hollowSeen >= 0) d.hollowSeen = Math.floor(r.hollowSeen);
  d.stakeCleared = numRecord(r.stakeCleared);
  d.dailyBest = dailyBestOf(r.dailyBest);
  if (typeof r.cheated === 'number' && isFinite(r.cheated)) d.cheated = r.cheated;
  if (r.demo === true) d.demo = true;
  return d;
}

class Store implements SaveStore {
  data: SaveData = defaultSave();
  private timer: number | null = null;
  private memoryOnly = false;
  private mem: string | null = null;

  load(): void {
    let text: string | null = null;
    try { text = localStorage.getItem(SAVE_KEY); } catch { this.memoryOnly = true; text = this.mem; }
    if (text) {
      try { this.data = migrateSave(JSON.parse(text)); } catch (e) { log.warn('save', 'corrupt save, resetting', e); this.data = defaultSave(); }
    } else {
      this.data = defaultSave();
    }
  }

  update(fn: (d: SaveData) => void): void {
    fn(this.data);
    this.schedule();
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
    this.data.settings[k] = v;
    this.schedule();
    bus.emit('settings:changed', { key: k });
  }

  flush(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    const text = JSON.stringify(this.data);
    if (this.memoryOnly) { this.mem = text; return; }
    try { localStorage.setItem(SAVE_KEY, text); } catch (e) { this.memoryOnly = true; this.mem = text; log.warn('save', 'storage unavailable, keeping in memory', e); }
  }

  reset(): void {
    const keep = this.data.profile;
    this.data = defaultSave();
    this.data.profile = keep;
    this.flush();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.flush(); }, 500);
  }
}

export function createSaveStore(): SaveStore {
  return new Store();
}
