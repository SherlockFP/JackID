#!/usr/bin/env node
/**
 * Offline previews of the high-stakes score (src/core/audio/music: stakes.ts, songs/cues.ts): renders each plan below through
 * qa.renderPlan in a muted headless Chrome (`OfflineAudioContext`, nothing reaches a speaker) and writes 16-bit stereo WAVs.
 *
 *   node scripts/qa/musicRender.mjs DIR            all previews into DIR
 *   node scripts/qa/musicRender.mjs DIR name ...   only the named previews
 *
 * Same launcher as sfxLoud.mjs (own Vite + own Chrome on free ports, temp profile, both killed on exit).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [OUT, ...ONLY] = process.argv.slice(2);
if (!OUT) { console.error('usage: node scripts/qa/musicRender.mjs DIR [name ...]'); process.exit(2); }
const log = (...a) => process.stderr.write(`[musicRender] ${a.join(' ')}\n`);

/** name → plan (qa.PlanSeg[]): song ids, seconds, stakes keyframes, crossfade. A duel's last third is its final round. */
const final = (id) => [{ id, sec: 36, s: [0.35, 0.35, 0.35, 0.85, 0.85, 0.85] }];
const PLANS = {
  'floor-stakes-sweep': [{ id: 'lounge', sec: 30, i: 0.2, s: [0, 0.5, 1] }],
  'last-call': [{ id: 'lounge', sec: 6, s: [0.1] }, { id: 'lastcall', sec: 24, s: [0.5, 0.6], fade: 2.5 }],
  'duel-lucan': final('duel_lucan'),
  'duel-tamsin': final('duel_tamsin'),
  'duel-ada': final('duel_ada'),
  'burning-wager': [{ id: 'burning_wager', sec: 40, s: [0.85, 1] }],
  'jackpot-chase-hit': [{ id: 'arcade', sec: 6, s: [0.4, 0.6] }, { id: 'reel_chase', sec: 4, fade: 0.35 }, { id: 'chase_hit', sec: 4.2, fade: 0.06 }, { id: 'arcade', sec: 8, s: [0.3, 0.1], fade: 1.5 }],
  'jackpot-chase-miss': [{ id: 'arcade', sec: 6, s: [0.4, 0.6] }, { id: 'reel_chase', sec: 4, fade: 0.35 }, { id: 'chase_miss', sec: 7, fade: 0.6 }, { id: 'arcade', sec: 6, s: [0.1], fade: 1.5 }],
};
const names = ONLY.length ? ONLY : Object.keys(PLANS);
for (const n of names) if (!PLANS[n]) { console.error(`no preview "${n}"`); process.exit(2); }

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
const wav = (sr, pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

let vite = null, chrome = null;
process.once('exit', () => { killTree(chrome); killTree(vite); });
try {
  const vport = await freePort(), dport = await freePort();
  vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', join(ROOT, 'scripts', 'qa', 'vite.bench.config.mjs'),
    '--host', '127.0.0.1', '--port', String(vport), '--strictPort'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vport}/`)).ok, 120_000, 'vite');
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'jackid-music-'))}`, '--mute-audio', '--no-first-run', '--disable-extensions', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find((t) => t.type === 'page'), 30_000, 'chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP socket')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600_000 });
    if (m.result?.exceptionDetails || m.error) throw new Error(JSON.stringify(m.result?.exceptionDetails ?? m.error).slice(0, 1500));
    return m.result.result.value;
  };
  // a static file on the dev origin: the modules import from there, and the game itself never boots
  await send('Page.navigate', { url: `http://127.0.0.1:${vport}/assets/vendor/SFX_INDEX.md` });
  await new Promise((r) => setTimeout(r, 1500));
  const bad = JSON.parse(await evaluate(`(async () => JSON.stringify((await (await import('/src/core/audio/music/qa.ts')).validate()).filter((l) => /FAILED|!!/.test(l))))()`));
  if (bad.length) throw new Error(`qa.validate: ${bad.join('\n')}`);
  mkdirSync(OUT, { recursive: true });
  for (const n of names) {
    log(`rendering ${n}...`);
    const r = JSON.parse(await evaluate(`(async () => { const qa = await import('/src/core/audio/music/qa.ts'); const r = await qa.renderPlan(${JSON.stringify(PLANS[n])}); return JSON.stringify(r); })()`));
    const f = join(OUT, `${n}.wav`);
    writeFileSync(f, wav(r.sr, Buffer.from(r.b64, 'base64')));
    console.log(`${f}  ${r.stats.seconds.toFixed(1)}s  peak ${r.stats.peakDb} dB  rms ${r.stats.rmsDb} dB  clipped ${r.stats.clipped}  nan ${r.stats.nan}`);
  }
  ws.close();
} finally {
  killTree(chrome); killTree(vite);
}
