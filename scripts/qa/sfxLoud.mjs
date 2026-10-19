#!/usr/bin/env node
/**
 * Offline loudness of the casino-loop sounds: renders the spin cues and the win ladder (as juice.celebrate stacks them) in a
 * muted headless Chrome (`OfflineAudioContext`, nothing reaches a speaker) and writes scripts/tests/fixtures/sfxLoudness.json,
 * which spinFeel.test.mjs checks (tier order, headroom, and that the trims it was measured with are still the trims in sfx.ts).
 *
 *   node scripts/qa/sfxLoud.mjs            measure and write the fixture
 *   node scripts/qa/sfxLoud.mjs --dry      measure and print only
 *
 * Re-run after changing a recipe, a TRIM, a clip level in real.ts, or the tier layers in juice.ts (TIERS below mirrors them).
 * Zero dependencies, same launcher pattern as bench.mjs (own Vite + own Chrome on free ports, temp profile, killed on exit).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = join(ROOT, 'scripts', 'tests', 'fixtures', 'sfxLoudness.json');
const DRY = process.argv.includes('--dry');
const log = (...a) => process.stderr.write(`[sfxLoud] ${a.join(' ')}\n`);

/** Default settings volumes (src/core/settings.ts DEFAULTS.vol). */
const VOLUMES = { master: 0.8, sfx: 0.9, ui: 0.8, music: 0.6, amb: 0.7, voice: 0.9 };
/** Every slider at the top: the headroom check renders the jackpot here too. */
const MAX_VOLUMES = { master: 1, sfx: 1, ui: 1, music: 1, amb: 1, voice: 1 };
/** Single cues: rendered alone, no bus chain (the same numbers the TRIM table is calibrated on). */
const CUES = ['button', 'lever', 'reelStart', 'reelStop', 'reelLoop', 'lineUp', 'lose', 'numberTick', 'countDing', 'streakPing', 'coinClink', 'heartbeat', 'kachunk', 'alarmBell', 'win1', 'win2', 'win3', 'winHuge', 'winMega', 'jackpotShow'];

// juice.celebrate for the local player at the tier's typical multiple: winJingle (vol 0.75 + 0.35·k, pitch from winFeel) and the
// engine's cheer, the TIER_SHOW layer, winFeelLayer's coins, escalate's extras. k = ln(mult) / ln(50); pitch = FEEL_PITCH.
const k = (m) => Math.min(1, Math.log(m) / Math.log(50));
const jv = (m) => 0.75 + 0.35 * k(m);
const TIERS = {
  small: { mult: 2, s: 2.5, layers: [{ name: 'win1', vol: jv(2), pitch: 0 }] },
  medium: { mult: 5, s: 3.5, layers: [{ name: 'win2', vol: jv(5), pitch: 2 }, { name: 'coinPour', vol: 0.35 + 0.5 * k(5) }] },
  big: { mult: 10, s: 5, layers: [
    { name: 'tensionRise', vol: 0.9, param: 0 },
    { name: 'win3', at: 0.6, vol: jv(10) }, { name: 'chime', at: 0.6, vol: 0.45 }, { name: 'coinPour', at: 0.6, vol: 0.35 + 0.5 * k(10) },
    { name: 'cheer', at: 0.6, param: 0.4, vol: 0.6 },
  ] },
  huge: { mult: 25, s: 7, layers: [
    { name: 'tensionRise', vol: 0.9, param: 0.6 },
    { name: 'winHuge', at: 1.2, vol: jv(25) }, { name: 'chime', at: 1.2, vol: 0.8 }, { name: 'coinPour', at: 1.2, vol: 0.35 + 0.5 * k(25) },
    { name: 'winRise', at: 1.2, vol: 0.8 }, { name: 'cheer', at: 1.2, param: 0.7, vol: 0.8 },
  ] },
  mega: { mult: 50, s: 9, layers: [
    { name: 'tensionRise', vol: 0.9, param: 0.6 },
    { name: 'winMega', at: 1.2, vol: jv(50) }, { name: 'bell', at: 1.2, vol: 0.8 }, { name: 'coinPour', at: 1.2, vol: 0.85 },
    { name: 'winRise', at: 1.2, vol: 0.8 }, { name: 'cheer', at: 1.2, param: 0.9, vol: 0.9 },
  ] },
  jackpot: { mult: 100, s: 12, layers: [
    { name: 'tensionRise', vol: 0.9, param: 0.6 },
    { name: 'jackpotShow', at: 1.2, vol: jv(100) * 1.5 }, { name: 'jackpotSiren', at: 1.2, vol: 0.55 }, { name: 'winRise', at: 1.2, vol: 0.5 },
    { name: 'cheer', at: 1.2, param: 1, vol: 1 },
    { name: 'jackpotBells', at: 1.6, vol: 0.9 }, { name: 'jackpotBells', at: 4.6, vol: 0.7, pitch: 2 },
    { name: 'coinRain', at: 1.2, vol: 0.7, loop: true, loopFor: 6 },
    { name: 'kachunk', at: 7.2, vol: 0.8 },
  ] },
};

/** Page side: decode every clip once, then render and measure. Peak = sample peak; st = loudest 400 ms RMS window (dBFS). */
const PAGE = (task) => `(async () => {
  const task = ${JSON.stringify(task)};
  const A = await import('/src/core/audio/audio.ts'), S = await import('/src/core/audio/synth.ts');
  const X = await import('/src/core/audio/sfx.ts'), R = await import('/src/core/audio/real.ts');
  const dec = new OfflineAudioContext(2, 1, 44100), bufs = new Map();
  await Promise.all([...new Set([...X.SAMPLE_URLS, ...R.CLIP_URLS])].map(async (u) => {
    try { bufs.set(u, await dec.decodeAudioData(await (await fetch(u)).arrayBuffer())); } catch (e) { bufs.set(u, null); }
  }));
  const missing = [...bufs].filter(([, b]) => !b).map(([u]) => u);
  const fill = () => { for (const [u, b] of bufs) if (b) S.sampleStore.set(u, b); };   // real.ts drops long clips from its LRU pool
  const db = (x) => Math.round(200 * Math.log10(Math.max(1e-9, x))) / 10;
  const stats = (buf) => {
    const L = buf.getChannelData(0), Rr = buf.getChannelData(1), sr = buf.sampleRate, w = Math.round(sr * 0.4), hop = Math.round(sr * 0.05);
    let peak = 0, last = 0;
    const sq = new Float64Array(L.length + 1);
    for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(Rr[i])); if (a > peak) peak = a; if (a > 0.001) last = i; sq[i + 1] = sq[i] + (L[i] * L[i] + Rr[i] * Rr[i]) / 2; }
    let st = 0;
    for (let i = 0; i + w <= L.length; i += hop) st = Math.max(st, (sq[i + w] - sq[i]) / w);
    return { peak: Math.round(peak * 1000) / 1000, peakDb: db(peak), stDb: db(Math.sqrt(st)), len: Math.round((last / sr) * 100) / 100 };
  };
  const med = (xs, key) => xs.map((x) => x[key]).sort((a, b) => a - b)[1];
  const three = async (fn) => { const r = []; for (let i = 0; i < 3; i++) { fill(); r.push(stats(await fn())); } return { peak: med(r, 'peak'), peakDb: med(r, 'peakDb'), stDb: med(r, 'stDb'), len: med(r, 'len') }; };
  const out = { missing, cues: {}, tiers: {}, headroom: {}, trims: {} };
  for (const n of task.cues) out.cues[n] = await three(() => A.renderSfx(n, { seconds: 4, param: n === 'reelLoop' ? 0.6 : undefined }));
  for (const [t, d] of Object.entries(task.tiers)) out.tiers[t] = await three(() => A.renderMix(d.layers, { seconds: d.s, volumes: task.volumes }));
  // headroom: the jackpot stacks about ten layers. Raw = the sum before the buses and the master compressor (it may pass 1: the
  // compressor is what holds it); max = through the chain with every slider at 1, which must not clip.
  const jp = task.tiers.jackpot;
  out.headroom.jackpotRaw = await three(() => A.renderMix(jp.layers, { seconds: jp.s }));
  out.headroom.jackpotMax = await three(() => A.renderMix(jp.layers, { seconds: jp.s, volumes: task.maxVolumes }));
  for (const n of new Set([...task.cues, ...Object.values(task.tiers).flatMap((d) => d.layers.map((l) => l.name))])) out.trims[n] = X.SFX_DEFS.get(n).meta.gain;
  return JSON.stringify(out);
})()`;

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const killTree = (c) => {
  if (!c || c.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  try { c.kill('SIGKILL'); } catch { /* gone */ }
};
const waitFor = async (fn, ms, what) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

let vite = null, chrome = null;
process.once('exit', () => { killTree(chrome); killTree(vite); });
try {
  const vport = await freePort(), dport = await freePort();
  vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', join(ROOT, 'scripts', 'qa', 'vite.bench.config.mjs'),
    '--host', '127.0.0.1', '--port', String(vport), '--strictPort'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vport}/`)).ok, 120_000, 'vite');
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'jackid-sfx-'))}`, '--mute-audio', '--no-first-run', '--disable-extensions', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find((t) => t.type === 'page'), 30_000, 'chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP socket')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  // a static file on the dev origin: the modules import from there, and the game itself never boots
  await send('Page.navigate', { url: `http://127.0.0.1:${vport}/assets/vendor/SFX_INDEX.md` });
  await new Promise((r) => setTimeout(r, 1500));
  log('rendering (about a minute)...');
  const m = await send('Runtime.evaluate', { expression: PAGE({ cues: CUES, tiers: TIERS, volumes: VOLUMES, maxVolumes: MAX_VOLUMES }), awaitPromise: true, returnByValue: true, timeout: 600_000 });
  if (m.result?.exceptionDetails || m.error) throw new Error(JSON.stringify(m.result?.exceptionDetails ?? m.error).slice(0, 1500));
  const res = JSON.parse(m.result.result.value);
  const fixture = { note: 'written by scripts/qa/sfxLoud.mjs; peak = sample peak, stDb = loudest 400 ms RMS (dBFS); tiers through default bus volumes + master compressor', volumes: VOLUMES, ...res };
  console.log(JSON.stringify(fixture, null, 1));
  if (res.missing.length) log(`WARNING: clips failed to decode: ${res.missing.join(', ')}`);
  if (!DRY) { writeFileSync(OUT, JSON.stringify(fixture, null, 1) + '\n'); log(`wrote ${OUT}`); }
  ws.close();
} finally {
  killTree(chrome); killTree(vite);
}
