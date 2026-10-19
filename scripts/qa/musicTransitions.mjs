#!/usr/bin/env node
/**
 * Records the real conductor (src/core/audio/music/index.ts) while it crosses into and out of the two recorded tracks
 * (oga.ts), as 16-bit stereo WAVs of the music bus:
 *
 *   node scripts/qa/musicTransitions.mjs DIR            all plans into DIR
 *   node scripts/qa/musicTransitions.mjs DIR name ...   only the named plans
 *
 * Own Vite (HMR and watcher off, like bench.mjs) and one muted headless Chrome (`--mute-audio`; the capture is a
 * ScriptProcessor on the bus whose output is a gain of 0, so nothing reaches a speaker). It runs in REAL time, because the
 * conductor schedules on a timer: a 20 s clip takes 20 s plus a warm-up that loads the track and lets it fade out again.
 * Each plan drives the conductor only through its public API and the event bus (setZone, gamble:fx, music:cue), the way
 * the game does. Both processes are killed on exit. Prints the loudness per second so the trims in oga.ts can be checked.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, killTree, openPage, wav, waitFor } from './_cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [OUT, ...ONLY] = process.argv.slice(2);
if (!OUT) { console.error('usage: node scripts/qa/musicTransitions.mjs DIR [name ...]'); process.exit(2); }

/**
 * name → { secs, layer (index in debug().oga.loaded to warm), on/off (the trigger that brings that track in, and out), steps }.
 * A step is [seconds into the clip, 'zone' | 'stakes' | 'cue', value].
 */
const PLANS = {
  'saloon-bar-in-out': { secs: 20, layer: 0, on: ['zone', 'bar'], off: ['zone', 'lobby'], steps: [[0.1, 'zone', 'lobby'], [5, 'zone', 'bar'], [13, 'zone', 'lobby']] },
  'pursuit-stakes-in-out': { secs: 20, layer: 1, on: ['stakes', 1], off: ['stakes', 0], steps: [[3, 'stakes', 1], [12, 'stakes', 0]] },
  'pursuit-burning-wager': { secs: 20, layer: 1, on: ['cue', 'burning_wager'], off: ['cue', ''], steps: [[3, 'cue', 'burning_wager'], [13, 'cue', '']] },
};
const names = ONLY.length ? ONLY : Object.keys(PLANS);
for (const n of names) if (!PLANS[n]) { console.error(`no plan "${n}"`); process.exit(2); }

/** Runs inside the page (serialised with toString()). Returns the clip as Int16 base64 plus the loudness per second. */
async function pagePlay(plan) {
  const { createMusic } = await import('/src/core/audio/music/index.ts');
  const { bus } = await import('/src/core/events.ts');
  const ctx = new AudioContext({ sampleRate: 44100 });
  await ctx.resume();
  const out = ctx.createGain();
  const rec = { l: [], r: [], on: false };
  const tap = ctx.createScriptProcessor(4096, 2, 2), mute = ctx.createGain();
  tap.onaudioprocess = (e) => { if (rec.on) { rec.l.push(e.inputBuffer.getChannelData(0).slice()); rec.r.push(e.inputBuffer.getChannelData(1).slice()); } };
  mute.gain.value = 0; out.connect(tap); tap.connect(mute); mute.connect(ctx.destination);
  const music = createMusic({ ctx, out, reverb: ctx.createGain(), noise: null, engine: null });
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const act = ([kind, v]) => {
    if (kind === 'zone') music.setZone(v);
    else if (kind === 'stakes') bus.emit('gamble:fx', { kind: v ? 'allinFire' : 'lose', step: 1, pot: 100 });
    else if (kind === 'cue') { if (v) bus.emit('music:cue', { cue: v, on: true }); else bus.emit('music:cue', { cue: 'burning_wager', on: false }); }
  };
  music.setState('lounge', { fade: 0.1 });
  music.setIntensity(0.35);
  music.setZone('lobby');
  await sleep(2);
  // warm-up: bring the track in once so it is fetched and decoded, then let it fade out and the stakes settle
  act(plan.on);
  for (let k = 0; k < 600 && !music.debug().oga.loaded[plan.layer]; k++) await sleep(0.1);
  await sleep(5);
  act(plan.off);
  await sleep(16);
  const dbg0 = music.debug();
  // the clip
  const t0 = ctx.currentTime;
  rec.on = true;
  for (const [t, kind, v] of plan.steps) {
    while (ctx.currentTime - t0 < t) await sleep(0.02);
    act([kind, v]);
  }
  while (ctx.currentTime - t0 < plan.secs) await sleep(0.05);
  rec.on = false;
  const dbg1 = music.debug();
  const n = Math.min(rec.l.length * 4096, plan.secs * 44100), pcm = new Int16Array(n * 2), per = [];
  let acc = 0, cnt = 0, f = 0;
  for (let b = 0; b < rec.l.length && f < n; b++) for (let i = 0; i < 4096 && f < n; i++, f++) {
    const l = rec.l[b][i], r = rec.r[b][i];
    pcm[f * 2] = Math.max(-1, Math.min(1, l)) * 32767; pcm[f * 2 + 1] = Math.max(-1, Math.min(1, r)) * 32767;
    acc += (l * l + r * r) / 2; cnt++;
    if (cnt === 44100) { per.push(+(10 * Math.log10(acc / cnt + 1e-12)).toFixed(1)); acc = 0; cnt = 0; }
  }
  const u8 = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { b64: btoa(s), sr: 44100, seconds: n / 44100, perSecondDb: per, before: dbg0.oga, after: dbg1.oga, warm: dbg0.state };
}

let vite = null, page = null;
process.once('exit', () => { killTree(vite); page?.close(); });
try {
  const vport = await freePort();
  vite = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', join(ROOT, 'scripts', 'qa', 'vite.bench.config.mjs'),
    '--host', '127.0.0.1', '--port', String(vport), '--strictPort'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${vport}/`)).ok, 120_000, 'vite');
  const origin = `http://127.0.0.1:${vport}`;
  // a static file on the dev origin: the modules import from there, and the game itself never boots
  page = await openPage(`${origin}/assets/vendor/SFX_INDEX.md`);
  await waitFor(async () => (await page.evaluate('location.origin')) === origin, 30_000, 'the page to load');
  mkdirSync(OUT, { recursive: true });
  for (const n of names) {
    process.stderr.write(`[musicTransitions] recording ${n} (about ${PLANS[n].secs + 30} s)...\n`);
    const r = JSON.parse(await page.evaluate(`(async () => JSON.stringify(await (${pagePlay})(${JSON.stringify(PLANS[n])})))()`));
    const f = join(OUT, `${n}.wav`);
    writeFileSync(f, wav(r.sr, Buffer.from(r.b64, 'base64')));
    console.log(`${f}  ${r.seconds.toFixed(1)} s`);
    console.log(`  rms dB per second: ${r.perSecondDb.join(' ')}`);
    console.log(`  before ${JSON.stringify(r.before)}  after ${JSON.stringify(r.after)}`);
  }
} finally {
  page?.close(); killTree(vite);
}
