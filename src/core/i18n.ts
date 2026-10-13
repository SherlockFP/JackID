/**
 * i18n runtime (TD-owned). Contract: TECH_SPEC §2.11 + §9.3, big-number formatting per GDD §3.9.
 *
 * Every player-visible string goes through `t()`; numbers through `fmtCoins`/`fmtNum`/`fmtTime`;
 * upper-casing through `upper()` (Turkish i → İ). Keys are registered per folder via `*.strings.ts`
 * (`{ prefix, en, tr }`) — there is no shared table to edit. Missing key: current lang → en → the key
 * itself (+ one dev warning). Plurals: if `vars.n` is given and `<key>.one` / `<key>.other` exist, English
 * picks `.one` when n === 1; Turkish always uses `.other`.
 */
import type { Lang } from './types';
import { bus } from './events';
import { log } from './log';

export type I18nVars = Record<string, string | number>;
export type StringTable = Record<string, string>;

const tables: Record<Lang, Map<string, string>> = { en: new Map(), tr: new Map() };
let current: Lang = 'en';

export function registerStrings(prefix: string, t: { en: StringTable; tr: StringTable }): void {
  for (const l of ['en', 'tr'] as const) {
    const map = tables[l];
    for (const [k, v] of Object.entries(t[l] ?? {})) {
      const key = prefix + k;
      if (import.meta.env?.DEV && map.has(key) && map.get(key) !== v) log.warn('i18n', `duplicate key "${key}" (${l})`);
      map.set(key, v);
    }
  }
}

const VAR = /\{(\w+)\}/g;
function interpolate(s: string, vars?: I18nVars): string {
  return vars ? s.replace(VAR, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
function lookup(key: string): string | undefined {
  return tables[current].get(key) ?? tables.en.get(key);
}

export function has(key: string): boolean {
  return tables[current].has(key) || tables.en.has(key);
}

export function t(key: string, vars?: I18nVars): string {
  let k = key;
  if (vars && typeof vars.n === 'number') {
    const form = current === 'en' && vars.n === 1 ? '.one' : '.other';
    if (has(key + form)) k = key + form;
  }
  const s = lookup(k);
  if (s === undefined) {
    if (import.meta.env?.DEV) log.warnOnce(`i18n:${key}`, 'i18n', `missing key "${key}"`);
    return interpolate(key, vars);
  }
  return interpolate(s, vars);
}

export function setLang(l: Lang): void {
  if (l !== 'en' && l !== 'tr') return;
  const changed = l !== current;
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  if (changed) bus.emit('lang:changed', { lang: l });
}
export function lang(): Lang { return current; }

// ── number formatting ───────────────────────────────────────────────────────────────────────────
const SUFFIX: Record<Lang, readonly string[]> = {
  en: ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'],
  tr: ['', 'B', 'Mn', 'Mr', 'Tn', 'Ka', 'Kn', 'Sk', 'Sp', 'Ok', 'No', 'Dc'],   // bin, milyon, milyar, trilyon, katrilyon, kentilyon …
};
const SEP: Record<Lang, { group: string; dec: string }> = { en: { group: ',', dec: '.' }, tr: { group: '.', dec: ',' } };
const COMPACT_FROM = 100_000;

function groupInt(n: number, group: string): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/** Full integer with locale separators: en "1,250", tr "1.250". Never abbreviates. */
export function fmtNum(n: number): string {
  if (!isFinite(n)) return n > 0 ? '∞' : n < 0 ? '−∞' : '—';
  const neg = n < 0;
  const s = Math.abs(n) >= 1e21 ? Math.abs(n).toExponential(2) : groupInt(Math.abs(n), SEP[current].group);
  return neg ? '−' + s : s;
}

/**
 * THE coin formatter (HUD, diegetic canvas screens, popText). Below 100 000: full with separators.
 * From 100 000: three significant digits + suffix (`123K`, `1.23M`, `12.3B`, … `Dc`), then `1.23e36`.
 * `withSuffix` appends `common.coinSuffix` (the currency glyph).
 */
export function fmtCoins(n: number, withSuffix = false): string {
  const unit = withSuffix ? t('common.coinSuffix') : '';
  if (!isFinite(n)) return fmtNum(n) + unit;
  const neg = n < 0;
  const a = Math.abs(n);
  let out: string;
  if (a < COMPACT_FROM) {
    out = groupInt(a, SEP[current].group);
  } else {
    let idx = Math.floor(Math.log10(a) / 3);
    let mant = a / Math.pow(1000, idx);
    // 3 significant digits; promote when rounding reaches 1000 (999.6K → 1.00M)
    const dec = mant >= 100 ? 0 : mant >= 10 ? 1 : 2;
    mant = Math.round(mant * Math.pow(10, dec)) / Math.pow(10, dec);
    if (mant >= 1000) { mant /= 1000; idx++; }
    const suffix = SUFFIX[current];
    if (idx >= suffix.length) {
      const e = a.toExponential(2).replace('e+', 'e');
      out = current === 'tr' ? e.replace('.', ',') : e;
    } else {
      const shown = mant >= 100 ? 0 : mant >= 10 ? 1 : 2;
      out = mant.toFixed(shown).replace('.', SEP[current].dec) + suffix[idx];
    }
  }
  return (neg ? '−' : '') + out + unit;
}

/** "4:05" for 245 s; "1:02:03" from one hour. */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (v: number): string => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Locale-correct upper-case (Turkish `i → İ`, `ı → I`). */
export function upper(s: string): string {
  return s.toLocaleUpperCase(current === 'tr' ? 'tr-TR' : 'en-US');
}
