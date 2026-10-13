// `npm run check` — static project lint (QA-owned; TECH_SPEC §10.4). Exit 1 on any error; warnings never fail.
//
//  1. i18n      en/tr parity for src/i18n/*, every *.strings.ts and every machine def.strings: identical key sets,
//               no empty values, identical {placeholders}, `.one` has an `.other`; en.ts/tr.ts hold common.* and ui.* only.
//  2. keys      every literal t('key') in src resolves to a registered key (charm.* / phone.* only warn: their strings
//               are registered from defs that may not exist yet).
//  2b. charms   every hook a LAUNCH_CHARM_IDS charm sets needs a reader in src outside src/game/data/ (warn
//               'inert-charm'; charms with a code behaviour, and circuit-lane x.lamp.* / x.tilt.* hooks, are skipped).
//  3. literals  prose string literals outside t() in UI code (core/ui, core/cutscene, menu, game, machines, world).
//               ERROR inside a text sink (.textContent, .innerHTML, .placeholder, .title, label:/text:/title: …,
//               toast(), banner(), …); WARNING elsewhere. Literals inside `en:` / `tr:` tables (def.strings) are data and
//               skipped; opt out one line with the marker `i18n-ok`.
//  4. layers    TECH_SPEC §1.1 for value imports: core → core + three; kit → core + kit + three; net → core + net +
//               game/types; machines → core, kit, i18n, machines/_base, own folder, game/types, three. No machine may
//               import another machine folder (type-only too). `import type` is free otherwise. Paths are resolved first.
//  5. rules     Math.random outside core/rng.ts · console.* outside core/log.ts · setTimeout/setInterval in machines/game ·
//               "clover"/"chest" in code or strings (TECH_SPEC §9.2, original IP) · wall-clock reads in machines/game (warn) ·
//               DOM / window listeners outside their folders (warn, TECH_SPEC §9.2) · missing header comment (warn).
//  6. machines  snake_case folder, id in the TECH_SPEC §11.1 catalogue (warn otherwise), index.ts with `export const def`
//               and a default class, def.id === folder, `playHeadless` export (warn), model.ts (warn).
//  7. budgets   Optional JACKID_BENCH_DUMP=<file.json> from an F3 bench run, checked against TECH_SPEC §8 and §11.7
//               (format in checkBudgets()). Without it the section is skipped with an info line.
//
// The i18n, key and machine checks load the real modules through Vite's SSR loader, so they test actual code.
// The source scan uses a small lexer (comments, strings, template literals, regex literals) so that code-like text
// inside strings and comments is never mistaken for code.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// JACKID_CHECK_ROOT points the lint at another tree with the same layout (used by the fixture tests in scripts/tests).
const ROOT = process.env.JACKID_CHECK_ROOT
  ? resolve(process.env.JACKID_CHECK_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const errors = [];
const warnings = [];
const info = [];

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const where = (p) => { const r = rel(p); return r.startsWith('..') ? p : r; };
const err = (p, msg) => errors.push(`${where(p)}: ${msg}`);
const warn = (p, msg) => warnings.push(`${where(p)}: ${msg}`);

// TECH_SPEC §11.1 catalogue (machines + system devices).
const CATALOGUE = new Set([
  'bigone', 'bandit', 'videopoker', 'elevator', 'scratch', 'pachislot', 'pachinko', 'plinko', 'coinpusher', 'cyclone',
  'mines', 'dicetower', 'lootbox', 'claw', 'stacker', 'fruitmachine', 'bingopin', 'roulette', 'blackjack', 'holdem',
  'devilstable', 'baccarat', 'craps', 'sicbo', 'bigsix', 'cardwar', 'hilo', 'keno', 'derby', 'fortuneteller', 'coinflip',
  'threecard', 'reddog', 'bingo', 'lottoblower', 'tombola', 'shellgame', 'fantan', 'teetotum',
  'debt_terminal', 'hotline', 'charm_vendor', 'concession_desk', 'cashier', 'jukebox', 'tape_deck', 'tonic_vendor',
  'bounty_board', 'shrine',
]);

// ── lexer ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Returns `code` (same length as src; comments and string/template/regex contents blanked, quotes kept) and
 * `tokens` ({ kind: 'str' | 'tpl', value, start }). A template literal yields one 'tpl' token per static piece;
 * expressions inside `${}` stay in `code`, so calls inside them are still visible to the rules.
 */
function lex(src) {
  const n = src.length;
  const code = src.split('');
  const tokens = [];
  const tplStack = [];          // brace depth recorded at each open `${`
  let depth = 0, prev = '', i = 0;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (code[k] !== '\n') code[k] = ' '; };
  const piece = (from, to, start) => { tokens.push({ kind: 'tpl', value: src.slice(from, to), start }); blank(from, to); };
  const readTpl = (from, start) => {
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { piece(from, j, start); return j + 1; }
      if (c === '$' && src[j + 1] === '{') { piece(from, j, start); tplStack.push(depth); return j + 2; }
      j++;
    }
    piece(from, n, start);
    return n;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let e = src.indexOf('\n', i); if (e < 0) e = n; blank(i, e); i = e; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && (prev === '' || '=(,:[!&|?{};'.includes(prev))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') break;
        j++;
      }
      if (j < n && src[j] === '/') { blank(i, j + 1); i = j + 1; prev = '/'; continue; }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      tokens.push({ kind: 'str', value: src.slice(i + 1, j), start: i });
      blank(i + 1, j);
      i = j < n && src[j] === c ? j + 1 : j;
      prev = c;
      continue;
    }
    if (c === '`') { i = readTpl(i + 1, i); prev = '`'; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      if (tplStack.length && tplStack[tplStack.length - 1] === depth) { tplStack.pop(); i = readTpl(i + 1, i); prev = '{'; continue; }
      depth--;
    }
    if (c.trim()) prev = c;
    i++;
  }
  return { code: code.join(''), tokens };
}

function lineStarts(src) {
  const s = [0];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) s.push(k + 1);
  return s;
}
function lineAt(starts, off) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const units = files.map((f) => {
  const src = readFileSync(f, 'utf8');
  const { code, tokens } = lex(src);
  const starts = lineStarts(src);
  const parts = rel(f).split('/');   // ['src', top, sub, …]
  return {
    f, src, code, tokens, lines: src.split('\n'),
    r: rel(f), top: parts[1] ?? '', sub: parts[2] ?? '',
    line: (off) => lineAt(starts, off),
  };
});

/** Reports every match of a global regex on the masked code, one message with up to three line numbers. */
function reportHits(u, re, msg, level = err) {
  const lines = [...u.code.matchAll(re)].map((m) => u.line(m.index));
  if (lines.length) level(u.f, `${msg} (line ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? ' …' : ''})`);
}

const preview = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

// ── imports (rule 4) ────────────────────────────────────────────────────────────────────────────
const MODULE_CTX = /(?:\bfrom|\bimport)\s*\(?\s*$/;

/** Classifies an import specifier token; null when the string is not a module specifier. */
function importOf(u, tok) {
  const before = u.code.slice(Math.max(0, tok.start - 400), tok.start);
  if (!MODULE_CTX.test(before)) return null;
  const heads = [...before.matchAll(/\b(?:import|export)\b/g)];
  const head = heads.length ? before.slice(heads[heads.length - 1].index).replace(/\s+/g, ' ').trim() : '';
  const named = /^import \{([^}]*)\} from$/.exec(head);
  const typeOnly = /^(?:import|export) type\b/.test(head) || (!!named && named[1].split(',').every((s) => /^\s*type\s/.test(s)));
  return { spec: tok.value, line: u.line(tok.start), typeOnly };
}

function classify(p) {
  const r = relative(SRC, p);
  if (r.startsWith('..') || isAbsolute(r)) return { layer: '<outside>', sub: '', rel: r };
  const parts = r.split(sep);
  return { layer: parts[0], sub: parts[1] ?? '', rel: parts.join('/') };
}
const isGameTypes = (c) => c.layer === 'game' && c.rel === 'game/types';
const pkgRoot = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

function checkImport(u, imp) {
  const { spec, line, typeOnly } = imp;
  const at = `line ${line}`;
  if (spec.startsWith('@/') || spec.startsWith('.')) {
    const c = classify(spec.startsWith('@/') ? join(SRC, spec.slice(2)) : resolve(dirname(u.f), spec));
    const own = u.top === 'machines' ? u.sub : null;
    if (own !== null && c.layer === 'machines' && c.sub && c.sub !== '_base' && c.sub !== own) {
      err(u.f, `${at}: machine imports another machine folder "${spec}" (TECH_SPEC §1.1 rule 3)`);
      return;
    }
    if (typeOnly) return;
    let ok = true;
    if (u.top === 'core') ok = c.layer === 'core';
    else if (u.top === 'kit') ok = c.layer === 'core' || c.layer === 'kit';
    else if (u.top === 'net') ok = c.layer === 'core' || c.layer === 'net' || isGameTypes(c);
    else if (own !== null) {
      ok = c.layer === 'core' || c.layer === 'kit' || c.layer === 'i18n' || isGameTypes(c)
        || (c.layer === 'machines' && (c.sub === '_base' || c.sub === own));
      if (c.rel === 'core/app' || c.rel === 'game/inGameState') err(u.f, `${at}: machine must use this.ctx, not "${spec}"`);
    }
    if (!ok) err(u.f, `${at}: ${u.top}${own !== null ? '/' + u.sub : ''} must not import "${spec}" as a value (TECH_SPEC §1.1)`);
    return;
  }
  if (typeOnly) return;
  if (['core', 'kit', 'machines'].includes(u.top) && pkgRoot(spec) !== 'three') {
    err(u.f, `${at}: ${u.top} may import only three, found package "${spec}"`);
  }
}

// ── per-file rules (rule 5, 6-header) ───────────────────────────────────────────────────────────
// TECH_SPEC §9.2 bans clover/chest symbols. `Hit_Chest` is a clip name of the CC0 Quaternius Mannequin (kit, §4),
// an external identifier rather than game content, so it is exempt.
const IP_TERM = /(?<!Hit_)(?:clover|chest)/gi;
const IP_TERM_CI = /(?<!Hit_)(?:clover|chest)/i;
const DOM_OK = /^src\/(core\/|kit\/|main\.ts|menu\/|net\/)/;
const WINDOW_OK = /^src\/(core\/input|core\/keymap|core\/loop\.ts|core\/renderer\/|core\/ui\/|net\/|main\.ts)/;
for (const u of units) {
  for (const tok of u.tokens) {
    if (tok.kind !== 'str') continue;
    const imp = importOf(u, tok);
    if (imp) checkImport(u, imp);
  }
  if (u.r !== 'src/core/rng.ts') reportHits(u, /\bMath\s*\.\s*random\b/g, '`Math.random` is forbidden — use the seeded rng (TECH_SPEC §2.8)');
  if (u.r !== 'src/core/log.ts') reportHits(u, /\bconsole\s*\.\s*\w+/g, '`console.*` is forbidden — use core/log.ts (TECH_SPEC §9.2)');
  if (/^src\/(machines|game)\//.test(u.r)) {
    reportHits(u, /\b(?:setTimeout|setInterval)\s*\(/g, 'setTimeout/setInterval in gameplay code — use app.timers.sim / MachineBase.wait');
    reportHits(u, /\b(?:Date\.now|performance\.now)\s*\(/g, 'wall-clock read in gameplay code breaks replay determinism', warn);
  }
  reportHits(u, IP_TERM, 'forbidden original-IP term (TECH_SPEC §9.2: no clover / chest)');
  for (const tok of u.tokens) {
    if (IP_TERM_CI.test(tok.value)) err(u.f, `forbidden original-IP term in string "${preview(tok.value)}" (TECH_SPEC §9.2)`);
  }
  if (!DOM_OK.test(u.r)) reportHits(u, /\bdocument\s*\.\s*\w+/g, 'DOM access outside core/ui, core/input, menu/, net/ or texgen (TECH_SPEC §9.2)', warn);
  if (!WINDOW_OK.test(u.r)) reportHits(u, /\bwindow\s*\.\s*(?:add|remove)EventListener\b/g, 'window listener outside core/input, core/loop, core/renderer, net/ (TECH_SPEC §9.2)', warn);
  if (!/^﻿?\s*(\/\*\*|\/\/)/.test(u.src)) warn(u.f, 'missing file header comment');
}

// ── literal scan (rule 3) ───────────────────────────────────────────────────────────────────────
const UI_SCOPE = /^src\/(core\/ui\/|core\/cutscene\/|menu\/|game\/|machines\/|world\/)/;
const KEY_CTX = /(?:^|[^.\w$])t\s*\(\s*$/;
const SINK_CALL = /(?:^|[^.\w$])(?:toast|banner|alert|subtitle|marquee|notify|say)\s*\(\s*$/;
const SINK_PROP = /\.(?:textContent|innerText|innerHTML|placeholder|title|ariaLabel|alt|value)\s*\+?=\s*$|(?:^|[\s{,(])(?:label|text|title|hint|caption|subtitle|tooltip|placeholder|message|msg|header)\s*:\s*$/;
// Data tables (`name:` / `desc:` in def.strings, className, ids) and developer-facing calls are not player text.
const NOT_TEXT_PROP = /(?:^|[\s{,(])(?:name|desc|id|key|code|type|kind|tag|class|flicker|slot|zone|suit|role|action|event)\s*:\s*$|\bclassName\s*=\s*$/;
// Comparisons and switch labels hold identifiers (KeyboardEvent.code values, card ids), never display text.
const NOT_TEXT_OP = /(?:[!=]==?|\bcase)\s*$/;
const NOT_TEXT_CALL = /(?:\bclassList\.\w+\s*\(|\bsetAttribute\s*\(\s*['"](?:class|id|style|role|type|for|href|src|d|viewBox|fill|stroke|data-[\w-]+)['"]\s*,|\blog\.\w+\s*\(|\bnew Error\s*\(|\b(?:errs|errors|problems|issues|warnings)\s*\.\s*push\s*\()[^;]*$/;

/** True when the innermost object literal around `pos` is an `en:` or `tr:` table (TECH_SPEC §9.3 def.strings). */
function inStringTable(code, pos) {
  let depth = 0;
  for (let k = pos - 1, floor = Math.max(0, pos - 5000); k >= floor; k--) {
    const c = code[k];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) return /\b(?:en|tr)\s*:\s*$/.test(code.slice(Math.max(0, k - 20), k));
      depth--;
    }
  }
  return false;
}

/** Prose heuristic: at least two letters, not code/markup/URL, not a bare key or identifier, and visibly human. */
function looksLikeText(s) {
  const t = s.trim();
  if (!/\p{L}{2,}/u.test(t)) return false;
  if (/[<>{}[\]();=#@\\]|https?:|\/\//.test(t)) return false;
  if (/^[a-z][\w.:/-]*$/.test(t)) return false;
  const nonAscii = /[^\x00-\x7F]/.test(t);
  if (!/\s/.test(t)) return /^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,})$/u.test(t) || (nonAscii && /^\p{L}+$/u.test(t));   // single word: Bet, PLAY, işlem
  return /\p{Lu}/u.test(t) || nonAscii;
}

for (const u of units) {
  const isTypes = /(?:^|\/)types\.ts$|\.types\.ts$/.test(u.r);
  if (!UI_SCOPE.test(u.r) || isTypes || u.r.endsWith('.strings.ts')) continue;
  for (const tok of u.tokens) {
    if (!looksLikeText(tok.value)) continue;
    const before = u.code.slice(Math.max(0, tok.start - 300), tok.start);
    if (MODULE_CTX.test(before) || KEY_CTX.test(before) || inStringTable(u.code, tok.start)) continue;
    const line = u.line(tok.start);
    if (u.lines[line - 1]?.includes('i18n-ok')) continue;
    const msg = `hard-coded text "${preview(tok.value)}" outside t() (line ${line})`;
    if (SINK_CALL.test(before) || SINK_PROP.test(before)) err(u.f, msg);
    else if (NOT_TEXT_OP.test(before) || NOT_TEXT_PROP.test(before) || NOT_TEXT_CALL.test(before)) continue;
    else warn(u.f, msg);
  }
}

// ── i18n, keys and machines (rules 1, 2, 6) — these load the real modules ───────────────────────
const placeholders = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join(',') || 'none';

function compareTables(file, label, en, tr) {
  if (!en || !tr) { err(file, `${label}: both en and tr tables are required`); return; }
  const ek = Object.keys(en), tk = Object.keys(tr);
  for (const k of ek) if (!Object.hasOwn(tr, k)) err(file, `${label}: "${k}" missing in tr`);
  for (const k of tk) if (!Object.hasOwn(en, k)) err(file, `${label}: "${k}" missing in en`);
  for (const k of ek) {
    if (!Object.hasOwn(tr, k)) continue;
    if (!String(en[k]).trim() || !String(tr[k]).trim()) err(file, `${label}: empty value for "${k}"`);
    if (placeholders(en[k]) !== placeholders(tr[k])) err(file, `${label}: placeholders differ for "${k}" (${placeholders(en[k])} vs ${placeholders(tr[k])})`);
  }
  for (const k of ek) {
    if (k.endsWith('.one') && !Object.hasOwn(en, `${k.slice(0, -4)}.other`)) err(file, `${label}: plural "${k}" has no "${k.slice(0, -4)}.other"`);
  }
}

const machinesDir = join(SRC, 'machines');
const machineIds = existsSync(machinesDir)
  ? readdirSync(machinesDir).filter((n) => !n.startsWith('_') && statSync(join(machinesDir, n)).isDirectory()).sort()
  : [];
const defined = new Set();
const addKeys = (table, prefix) => { for (const k of Object.keys(table ?? {})) defined.add(prefix + k); };

for (const id of machineIds) {
  const dir = join(machinesDir, id);
  if (!/^[a-z][a-z0-9_]*$/.test(id)) err(dir, 'folder must be snake_case');
  if (!CATALOGUE.has(id)) warn(dir, 'id is not in the TECH_SPEC §11.1 catalogue');
  if (!existsSync(join(dir, 'model.ts'))) warn(dir, 'missing model.ts');
}

const vite = await (await import('vite')).createServer({
  root: ROOT, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  ...(process.env.JACKID_CHECK_CACHE ? { cacheDir: process.env.JACKID_CHECK_CACHE } : {}),
});
try {
  const load = (f) => vite.ssrLoadModule('/' + rel(f));

  const enF = join(SRC, 'i18n', 'en.ts'), trF = join(SRC, 'i18n', 'tr.ts');
  if (existsSync(enF) && existsSync(trF)) {
    try {
      const en = (await load(enF)).default, tr = (await load(trF)).default;
      compareTables(enF, 'i18n', en, tr);
      for (const k of Object.keys(en ?? {})) if (!/^(common|ui)\./.test(k)) err(enF, `key "${k}" outside common.* / ui.* (TECH_SPEC §9.3)`);
      addKeys(en, '');
    } catch (e) {
      err(enF, `failed to load: ${e?.message ?? e}`);
    }
  } else {
    err(SRC, 'src/i18n/en.ts and src/i18n/tr.ts are required');
  }

  let stringFiles = 0;
  for (const f of files.filter((p) => p.endsWith('.strings.ts'))) {
    stringFiles++;
    let d;
    try { d = (await load(f)).default; } catch (e) { err(f, `failed to load: ${e?.message ?? e}`); continue; }
    if (!d || typeof d.prefix !== 'string' || !d.prefix.endsWith('.')) { err(f, 'default export must be { prefix: "ns.", en, tr }'); continue; }
    compareTables(f, d.prefix, d.en, d.tr);
    addKeys(d.en, d.prefix);
  }

  for (const id of machineIds) {
    const idx = join(machinesDir, id, 'index.ts');
    if (!existsSync(idx)) { err(join(machinesDir, id), 'missing index.ts'); continue; }
    try {
      const mod = await load(idx);
      if (!mod.def) { err(idx, 'missing `export const def`'); continue; }
      if (mod.def.id !== id) err(idx, `def.id "${mod.def.id}" !== folder "${id}"`);
      if (typeof mod.default !== 'function') err(idx, 'missing default-exported machine class');
      if (mod.playHeadless == null) warn(idx, 'missing `playHeadless` named export (TECH_SPEC §11.5)');
      for (const l of ['en', 'tr']) for (const k of ['name', 'desc']) if (!mod.def.strings?.[l]?.[k]) err(idx, `strings.${l}.${k} is required`);
      compareTables(idx, `m.${id}`, mod.def.strings?.en, mod.def.strings?.tr);
      addKeys(mod.def.strings?.en, `m.${id}.`);
    } catch (e) {
      err(idx, `failed to load: ${e?.message ?? e}`);
    }
  }

  // Literal t('…') keys anywhere in src must resolve. Template-literal and computed keys are not checked.
  for (const u of units) {
    for (const tok of u.tokens) {
      if (tok.kind !== 'str' || !/^[\w.]+$/.test(tok.value)) continue;
      if (!KEY_CTX.test(u.code.slice(Math.max(0, tok.start - 40), tok.start))) continue;
      const key = tok.value;
      if (defined.has(key) || defined.has(`${key}.one`) || defined.has(`${key}.other`)) continue;
      const msg = `t("${key}") is not registered in any i18n table or *.strings.ts (line ${u.line(tok.start)})`;
      if (/^(charm|phone)\./.test(key)) warn(u.f, msg); else err(u.f, msg);
    }
  }
  // Charm hooks (rule 2b): every hook a launch charm sets needs a reader in src/ outside src/game/data/ (data files
  // name hooks, they do not read them). A charm with a code behaviour (charms/behaviours.ts) is live and skipped.
  // Circuit-lane hooks (x.lamp.*, x.tilt.*) and the circuit charms are pending, not inert.
  const charmFile = join(SRC, 'game', 'data', 'charms.ts');
  if (existsSync(charmFile)) {
    const { CHARM_DATA, LAUNCH_CHARM_IDS } = await load(charmFile);
    const behaviourFile = join(SRC, 'game', 'charms', 'behaviours.ts');
    const behaviours = existsSync(behaviourFile) ? ((await load(behaviourFile)).BEHAVIOURS ?? {}) : {};
    const corpus = units.filter((u) => !u.r.startsWith('src/game/data/')).map((u) => u.src).join('\n');
    const CIRCUIT_PENDING_CHARMS = new Set(['hot_coal', 'cold_hands', 'worn_glove', 'red_thread', 'circuit_breaker', 'blackout_lamp']);
    const CIRCUIT_PENDING_HOOK = /^x\.(lamp|tilt)\./;
    const hasReader = (hook) => {
      const base = hook.replace(/\[[^\]]*\]$/, '');
      if (corpus.includes(base)) return true;
      const dot = base.lastIndexOf('.');
      return dot > 0 && corpus.includes(`${base.slice(0, dot + 1)}\${`);   // template reader, e.g. `m.bandit.symbolPayAdd.${s}`
    };
    for (const def of CHARM_DATA) {
      if (!LAUNCH_CHARM_IDS.has(def.id) || CIRCUIT_PENDING_CHARMS.has(def.id) || behaviours[def.id]) continue;
      if (!def.effects?.length) { warn(charmFile, `inert-charm: ${def.id} sets no hooks and has no behaviour`); continue; }
      for (const e of def.effects) {
        if (CIRCUIT_PENDING_HOOK.test(e.hook) || hasReader(e.hook)) continue;
        const alt = e.hook.replace(/^x\./, 'm.');
        const hint = alt !== e.hook && hasReader(alt) ? ` (code reads ${alt.replace(/\[[^\]]*\]$/, '')})` : '';
        warn(charmFile, `inert-charm: ${def.id} sets ${e.hook}, no reader in src${hint}`);
      }
    }
  }
  info.push(`i18n: ${defined.size} keys across en.ts, ${stringFiles} *.strings.ts file(s) and ${machineIds.length} machine def(s)`);
} finally {
  await vite.close();
}

// ── budgets (rule 7) ────────────────────────────────────────────────────────────────────────────
/**
 * Bench dump (written by the F3 panel of /?bench=<id>; any extra fields are ignored):
 *   { "frame":    { "tris", "drawCalls", "textureBytes", "jsMsFrame", "jsMsTick" },
 *     "machines": [ { "id", "size": "S|M|L|XL", "tris", "drawCalls", "textures" } ] }
 * Frame limits are TECH_SPEC §11.7 (which overrides §8); per-machine limits are TECH_SPEC §8.
 */
const FRAME_BUDGET = { tris: 70000, drawCalls: 300, textureBytes: 24 * 1024 * 1024, jsMsFrame: 2, jsMsTick: 1 };
const MACHINE_BUDGET = {
  tris: { S: 2500, M: 5000, L: 8000, XL: 14000 },
  drawCalls: { S: 20, M: 20, L: 35, XL: 50 },
  textures: 8,
};

function checkBudgets(path) {
  let dump;
  try { dump = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { err(path, `bench dump unreadable: ${e.message}`); return; }
  if (!dump || typeof dump !== 'object') { err(path, 'bench dump must be a JSON object'); return; }
  const frame = dump.frame ?? {};
  for (const [key, max] of Object.entries(FRAME_BUDGET)) {
    if (typeof frame[key] !== 'number') continue;
    if (frame[key] > max) err(path, `frame ${key} ${frame[key]} over budget ${max}`);
  }
  for (const m of dump.machines ?? []) {
    const lim = { tris: MACHINE_BUDGET.tris[m.size], drawCalls: MACHINE_BUDGET.drawCalls[m.size] };
    if (!lim.tris) { err(path, `machine "${m.id}" has unknown size "${m.size}"`); continue; }
    const over = [];
    if (m.tris > lim.tris) over.push(`tris ${m.tris}/${lim.tris}`);
    if (m.drawCalls > lim.drawCalls) over.push(`drawCalls ${m.drawCalls}/${lim.drawCalls}`);
    if (m.textures > MACHINE_BUDGET.textures) over.push(`textures ${m.textures}/${MACHINE_BUDGET.textures}`);
    if (over.length) err(path, `machine "${m.id}" (${m.size}) over budget: ${over.join(', ')}`);
    else info.push(`budget ${m.id} (${m.size}): tris ${m.tris}/${lim.tris}, draws ${m.drawCalls}/${lim.drawCalls}, tex ${m.textures}/${MACHINE_BUDGET.textures} ok`);
  }
}

const dumpPath = process.env.JACKID_BENCH_DUMP;
if (dumpPath) checkBudgets(resolve(dumpPath));
else info.push('budgets: no bench dump (set JACKID_BENCH_DUMP=<file.json> after an F3 run of /?bench=<id>); skipped');

// ── report ──────────────────────────────────────────────────────────────────────────────────────
console.log(`check: ${files.length} source files, ${machineIds.length} machine folder(s)`);
for (const line of info) console.log(`  info  ${line}`);
for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);
console.log(`check: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exitCode = errors.length ? 1 : 0;
