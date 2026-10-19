#!/usr/bin/env node
/**
 * Encodes the two recorded music tracks (CC0, OpenGameArt) into web-sized Ogg Opus, with no ffmpeg:
 *
 *   node scripts/qa/musicEncode.mjs SRC_DIR OUT_DIR [SEAM_DIR]
 *
 * SRC_DIR holds drunken_saloon.mp3 and determined_pursuit_loop.wav. A muted headless Chrome decodes each one (48 kHz),
 * encodes it with WebCodecs `AudioEncoder` (Opus, 20 ms frames, faster than real time) and this file's page code muxes the packets
 * into Ogg (RFC 7845: OpusHead with the encoder's pre-skip, last granule = pre-skip + input length, so a decoder returns
 * exactly the input's sample count and a loop stays sample-exact). The result is decoded again and compared with the source
 * (length, best lag, SNR), and the loop seam of both is measured. Writes OUT_DIR/<id>.ogg, prints one line per track; with
 * SEAM_DIR it also writes <id>-loop-seam.wav (the last 6 s of the encoded loop, then its first 6 s) to listen to the join.
 * Chrome is killed on exit; nothing is played.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { openPage, waitFor, wav } from './_cdp.mjs';

const [SRC, OUT, SEAM] = process.argv.slice(2);
if (!SRC || !OUT) { console.error('usage: node scripts/qa/musicEncode.mjs SRC_DIR OUT_DIR'); process.exit(2); }
/** file → output id, Opus bitrate (bit/s). The orchestral loop gets more bits than the small-band jazz. */
const JOBS = [
  { file: 'drunken_saloon.mp3', id: 'drunken_saloon', bitrate: 96_000 },
  { file: 'determined_pursuit_loop.wav', id: 'determined_pursuit', bitrate: 128_000 },
];

/** Runs inside the page. Self-contained: it is serialised with toString(). */
async function pageEncode(job) {
  const SR = 48000;
  const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
  const ab = await (await fetch(job.url)).arrayBuffer();
  const src = await new OfflineAudioContext(2, 1, SR).decodeAudioData(ab);
  const N = src.length;
  const L = src.getChannelData(0), R = src.numberOfChannels > 1 ? src.getChannelData(1) : L;

  const seam = (a, b) => {
    const mono = (i) => (a[i] + b[i]) / 2, n = a.length, w = Math.round(0.05 * SR);
    let lead = 0, trail = 0, hs = 0, ts = 0, step = 0;
    while (lead < n && Math.abs(a[lead]) < 1e-3 && Math.abs(b[lead]) < 1e-3) lead++;
    while (trail < n && Math.abs(a[n - 1 - trail]) < 1e-3 && Math.abs(b[n - 1 - trail]) < 1e-3) trail++;
    for (let i = 0; i < w; i++) { hs += mono(i) ** 2; ts += mono(n - 1 - i) ** 2; }
    for (let i = n - 1000; i < n - 1; i++) step += Math.abs(mono(i + 1) - mono(i));
    return { leadSamples: lead, trailSamples: trail, headRmsDb: +db(Math.sqrt(hs / w)).toFixed(1), tailRmsDb: +db(Math.sqrt(ts / w)).toFixed(1),
      jumpOverStep: +(Math.abs(mono(0) - mono(n - 1)) / Math.max(1e-9, step / 999)).toFixed(2) };
  };
  const loud = (a, b) => {
    let pk = 0, s = 0;
    for (let i = 0; i < a.length; i++) { pk = Math.max(pk, Math.abs(a[i]), Math.abs(b[i])); s += a[i] * a[i] + b[i] * b[i]; }
    return { peakDb: +db(pk).toFixed(1), rmsDb: +db(Math.sqrt(s / (2 * a.length))).toFixed(1) };
  };

  // ── encode ──
  const cfg = { codec: 'opus', sampleRate: SR, numberOfChannels: 2, bitrate: job.bitrate, bitrateMode: 'variable',
    opus: { application: 'audio', signal: 'music', frameDuration: 20000, complexity: 10, format: 'opus' } };
  if (!(await AudioEncoder.isConfigSupported(cfg)).supported) throw new Error('this Chrome has no WebCodecs Opus encoder');
  const pkts = []; let desc = null, encErr = null;
  const enc = new AudioEncoder({
    output: (c, m) => {
      const b = new Uint8Array(c.byteLength); c.copyTo(b); pkts.push(b);
      const d = m && m.decoderConfig && m.decoderConfig.description;
      if (d && !desc) desc = new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    },
    error: (e) => { encErr = e; },
  });
  enc.configure(cfg);
  for (let off = 0; off < N; off += 4800) {
    const n = Math.min(4800, N - off), data = new Float32Array(n * 2);
    data.set(L.subarray(off, off + n), 0); data.set(R.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 40) await new Promise((r) => enc.addEventListener('dequeue', r, { once: true }));
  }
  await enc.flush(); enc.close();
  if (encErr) throw encErr;

  // ── Ogg ──
  const crcT = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; crcT[n] = c >>> 0; }
  const crc = (u) => { let c = 0; for (let i = 0; i < u.length; i++) c = ((c << 8) ^ crcT[((c >>> 24) ^ u[i]) & 255]) >>> 0; return c >>> 0; };
  const serial = 0x4a41434b;
  let seq = 0;
  const page = (type, granule, packets) => {
    const lac = [];
    for (const p of packets) { let n = p.length; while (n >= 255) { lac.push(255); n -= 255; } lac.push(n); }
    if (lac.length > 255) throw new Error('ogg page overflow');
    const size = packets.reduce((s, p) => s + p.length, 0), out = new Uint8Array(27 + lac.length + size), dv = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53, 0, type]); dv.setBigUint64(6, BigInt(granule), true); dv.setUint32(14, serial, true); dv.setUint32(18, seq++, true);
    out[26] = lac.length; out.set(lac, 27);
    let o = 27 + lac.length; for (const p of packets) { out.set(p, o); o += p.length; }
    dv.setUint32(22, crc(out), true);
    return out;
  };
  const text = (s) => new TextEncoder().encode(s);
  let head = desc;
  if (!head || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') {
    head = new Uint8Array(19); head.set(text('OpusHead')); head[8] = 1; head[9] = 2; new DataView(head.buffer).setUint16(10, 312, true);
    new DataView(head.buffer).setUint32(12, SR, true);
  }
  const preskip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
  const vendor = text('JackID musicEncode'), tags = new Uint8Array(8 + 4 + vendor.length + 4), tdv = new DataView(tags.buffer);
  tags.set(text('OpusTags')); tdv.setUint32(8, vendor.length, true); tags.set(vendor, 12);
  const parts = [page(2, 0, [head]), page(0, 0, [tags])];
  const PER = 40, FRAME = 960, total = preskip + N;
  for (let i = 0; i < pkts.length; i += PER) {
    const last = i + PER >= pkts.length, end = Math.min(i + PER, pkts.length);
    parts.push(page(last ? 4 : 0, last ? Math.min(end * FRAME, total) : end * FRAME, pkts.slice(i, end)));
  }
  const ogg = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  { let o = 0; for (const p of parts) { ogg.set(p, o); o += p.length; } }

  // ── verify: decode it again and compare with the source ──
  const back = await new OfflineAudioContext(2, 1, SR).decodeAudioData(ogg.buffer.slice(0));
  const bl = back.getChannelData(0), br = back.getChannelData(1);
  const mid = Math.floor(N / 2), W = SR;
  let bestLag = 0, best = -Infinity;
  for (let lag = -2400; lag <= 2400; lag += 1) {
    let c = 0;
    for (let i = 0; i < W; i += 2) c += L[mid + i] * (bl[mid + i + lag] ?? 0);
    if (c > best) { best = c; bestLag = lag; }
  }
  let es = 0, ee = 0;
  for (let i = 0; i < N; i++) { const j = i + bestLag; if (j < 0 || j >= back.length) continue; es += L[i] ** 2; ee += (L[i] - bl[j]) ** 2; }
  const bin = (u) => { let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(b); };
  const W6 = 6 * SR, seamPcm = new Int16Array(W6 * 4), tail0 = back.length - W6;
  for (let i = 0; i < W6; i++) for (const [k, at] of [[0, tail0 + i], [W6, i]]) {
    seamPcm[(k + i) * 2] = Math.max(-1, Math.min(1, bl[at])) * 32767; seamPcm[(k + i) * 2 + 1] = Math.max(-1, Math.min(1, br[at])) * 32767;
  }
  return {
    id: job.id, seconds: +(N / SR).toFixed(3), samples: N, bytes: ogg.length, kbps: +((ogg.length * 8) / (N / SR) / 1000).toFixed(1),
    preskip, packets: pkts.length, decodedSamples: back.length, lag: bestLag, snrDb: +db(Math.sqrt(es / Math.max(1e-12, ee))).toFixed(1),
    src: { ...loud(L, R), ...seam(L, R) }, out: { ...loud(bl, br), ...seam(bl, br) }, b64: bin(ogg), seam64: bin(new Uint8Array(seamPcm.buffer)),
  };
}

const server = createServer((req, res) => {
  const f = decodeURIComponent((req.url ?? '').slice(1));
  try { const buf = readFileSync(join(SRC, basename(f))); res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(buf); }
  catch { res.writeHead(f === '' ? 200 : 404, { 'content-type': 'text/html' }).end('<!doctype html><title>encode</title>'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let page = null;
try {
  page = await openPage(`${origin}/`);
  await waitFor(async () => (await page.evaluate('location.origin')) === origin, 30_000, 'the page to load');   // a secure context: WebCodecs needs one
  mkdirSync(OUT, { recursive: true });
  for (const j of JOBS) {
    const r = JSON.parse(await page.evaluate(`(async () => JSON.stringify(await (${pageEncode})(${JSON.stringify({ ...j, url: `${origin}/${j.file}` })})))()`));
    const { b64, seam64, ...stats } = r;
    writeFileSync(join(OUT, `${j.id}.ogg`), Buffer.from(b64, 'base64'));
    if (SEAM) { mkdirSync(SEAM, { recursive: true }); writeFileSync(join(SEAM, `${j.id}-loop-seam.wav`), wav(48000, Buffer.from(seam64, 'base64'))); }
    console.log(JSON.stringify(stats));
  }
} finally {
  page?.close();
  server.close();
}
