// Shared bits of the music QA scripts (musicEncode.mjs, musicTransitions.mjs): free ports, a process-tree kill, and one
// headless, MUTED Chrome driven over the DevTools protocol. Nothing here reaches a speaker (`--mute-audio`); the caller
// owns the page and must call `close()` (the scripts also kill Chrome on process exit).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

export const killTree = (c) => {
  if (!c || c.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  try { c.kill('SIGKILL'); } catch { /* gone */ }
};

export const waitFor = async (fn, ms, what) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** 16-bit stereo WAV from interleaved little-endian PCM. */
export const wav = (sr, pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

/** Opens `url` in a headless muted Chrome. Returns `{ evaluate(expr), close() }`; `evaluate` awaits promises and returns by value. */
export async function openPage(url) {
  const port = await freePort();
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'jackid-music-'))}`, '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--disable-extensions', url], { stdio: 'ignore', windowsHide: true });
  const close = () => killTree(chrome);
  process.once('exit', close);
  const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'), 30_000, 'chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP socket')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 900_000 });
    if (m.result?.exceptionDetails || m.error) throw new Error(JSON.stringify(m.result?.exceptionDetails ?? m.error).slice(0, 1500));
    return m.result.result.value;
  };
  return { evaluate, close: () => { try { ws.close(); } catch { /* closed */ } close(); } };
}
