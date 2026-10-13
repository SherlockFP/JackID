// Smoke test for the lobby server: `node server/smoke.mjs`
// Spawns server/index.js on a free port, then drives it with ws clients.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/lobby`;
const sha = (s) => createHash('sha256').update(s).digest('hex');

const srv = spawn(process.execPath, [path.join(here, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; });

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) fails++;
};

function client(name) {
  const ws = new WebSocket(WS);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  const next = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const hit = inbox.findIndex(pred);
    if (hit >= 0) return resolve(inbox.splice(hit, 1)[0]);
    const t = setTimeout(() => reject(new Error(`${name}: timeout waiting`)), ms);
    waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
  });
  const send = (o) => ws.send(JSON.stringify(o));
  const open = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return { ws, open, next, send, inbox };
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start:\n' + srvOut);
}

try {
  await waitHealthy();
  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(health.ok === true, 'GET /api/health ok');
  ok((await fetch(`${BASE}/api/rooms`)).headers.get('access-control-allow-origin') === '*', 'CORS header on /api');

  const host = client('host');
  const joiner = client('joiner');
  const bad = client('bad');
  await Promise.all([host.open, joiner.open, bad.open]);
  host.send({ op: 'hi', v: 1, name: 'Boss<script>' });
  joiner.send({ op: 'hi', v: 1, name: 'Ali' });
  const hw = await host.next((m) => m.op === 'welcome');
  const jw = await joiner.next((m) => m.op === 'welcome');
  ok(Array.isArray(hw.ice) && hw.ice.length > 0, 'welcome carries ICE servers');

  // Create a public room with a password (salt + verifier, no plaintext).
  const salt = 'ab12cd34'.repeat(4);
  const verifier = sha(`${salt}:pw123`);
  host.send({ op: 'create', room: { name: 'Night Shift', mode: 'coop', max: 4, lateJoin: true, version: 7, salt, verifier, status: 'LOBBY', unlisted: false } });
  const created = await host.next((m) => m.op === 'created');
  ok(/^[A-Z2-9]{6}$/.test(created.id) && created.token.length === 32, `created room ${created.id}`);

  // Unlisted room is hidden from list but joinable by id.
  host.send({ op: 'create', room: { name: 'Secret', mode: 'free', max: 2, version: 7 } });
  // (second create from same socket must fail: one room per host socket)
  const dup = await host.next((m) => m.op === 'error');
  ok(dup.code === 'already', 'second create on same socket refused');
  const hidden = client('hidden');
  await hidden.open;
  hidden.send({ op: 'create', room: { name: 'Secret', mode: 'free', max: 2, version: 7, unlisted: true } });
  const hid = await hidden.next((m) => m.op === 'created');

  joiner.send({ op: 'list' });
  const list = await joiner.next((m) => m.op === 'rooms');
  const listed = list.rooms.find((r) => r.id === created.id);
  ok(listed && listed.locked === true && listed.status === 'LOBBY' && listed.max === 4, 'list shows public room with status/locked');
  ok(!list.rooms.some((r) => r.id === hid.id), 'unlisted room hidden from list');
  const httpRooms = await (await fetch(`${BASE}/api/rooms`)).json();
  ok(httpRooms.some((r) => r.id === created.id) && !httpRooms.some((r) => r.id === hid.id), 'GET /api/rooms matches list');
  ok(!('verifier' in listed), 'verifier is never exposed');

  // Password enforcement.
  bad.send({ op: 'join', id: created.id, proof: sha(`${salt}:wrong`) });
  const badNo = await bad.next((m) => m.op === 'joinNo');
  ok(badNo.reason === 'password', 'wrong password refused');
  bad.send({ op: 'join', id: created.id.toLowerCase() });
  ok((await bad.next((m) => m.op === 'joinNo')).reason === 'password', 'no proof refused (lower-case id accepted)');

  // Correct password join, host notified.
  joiner.send({ op: 'join', id: created.id, proof: verifier, version: 7 });
  const jok = await joiner.next((m) => m.op === 'joinOk');
  ok(jok.host === hw.peer, 'joinOk names host peer');
  const pj = await host.next((m) => m.op === 'peerJoin');
  ok(pj.peer === jw.peer && pj.name === 'Ali', 'host receives peerJoin');

  // Version mismatch.
  const vm = client('vm');
  await vm.open;
  vm.send({ op: 'hi', name: 'Old' });
  await vm.next((m) => m.op === 'welcome');
  vm.send({ op: 'join', id: created.id, proof: verifier, version: 6 });
  ok((await vm.next((m) => m.op === 'joinNo')).reason === 'version', 'version mismatch refused');

  // Signaling: host -> member and member -> host.
  host.send({ op: 'signal', to: jw.peer, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  const sig = await joiner.next((m) => m.op === 'signal');
  ok(sig.from === hw.peer && sig.data.sdp.type === 'offer', 'signal relayed host -> member');
  joiner.send({ op: 'signal', to: hw.peer, data: { ice: { candidate: 'c1', sdpMid: '0' } } });
  ok((await host.next((m) => m.op === 'signal')).from === jw.peer, 'signal relayed member -> host');

  // Members cannot reach other members (routing is host-star only).
  host.send({ op: 'signal', to: 'nobody', data: { sdp: {} } });
  ok((await host.next((m) => m.op === 'error')).code === 'route', 'signal to unknown peer refused');

  // WS relay fallback.
  joiner.send({ op: 'relay', to: hw.peer, d: 'hello-game' });
  const rl = await host.next((m) => m.op === 'relay');
  ok(rl.d === 'hello-game' && rl.from === jw.peer, 'ws relay member -> host');

  // Host-only ops are refused for non-hosts.
  joiner.send({ op: 'update', id: created.id, token: created.token, patch: { started: true } });
  ok((await joiner.next((m) => m.op === 'error')).code === 'auth', 'member cannot update room');

  // Host update: status + started (lateJoin true keeps the door open).
  host.send({ op: 'update', id: created.id, token: created.token, patch: { status: 'PLAYING', started: true, name: 'Night Shift' } });
  host.send({ op: 'hb', id: created.id, token: created.token, hostRtt: 42 });
  await new Promise((r) => setTimeout(r, 100));
  joiner.send({ op: 'list' });
  const l2 = (await joiner.next((m) => m.op === 'rooms')).rooms.find((r) => r.id === created.id);
  ok(l2.status === 'PLAYING' && l2.started === true && l2.hostRtt === 42, 'update + hb reflected in list');

  // Host closes: member gets roomClosed, room disappears.
  host.send({ op: 'close', id: created.id, token: created.token });
  const rc = await joiner.next((m) => m.op === 'roomClosed');
  ok(rc.id === created.id && rc.reason === 'host', 'member notified on host close');
  joiner.send({ op: 'list' });
  ok(!(await joiner.next((m) => m.op === 'rooms')).rooms.some((r) => r.id === created.id), 'closed room gone from list');

  // Socket close of a host also closes its room (no leftover ghost rooms).
  const ghost = client('ghost');
  await ghost.open;
  ghost.send({ op: 'create', room: { name: 'Ghost', mode: 'versus', max: 2, version: 7 } });
  const gr = await ghost.next((m) => m.op === 'created');
  const watcher = client('watch');
  await watcher.open;
  watcher.send({ op: 'join', id: gr.id });
  await watcher.next((m) => m.op === 'joinOk');
  ghost.ws.close();
  ok((await watcher.next((m) => m.op === 'roomClosed')).reason === 'host', 'host socket drop closes room');

  // Room id validity: unknown id.
  watcher.send({ op: 'join', id: 'ZZZZZZ' });
  ok((await watcher.next((m) => m.op === 'joinNo')).reason === 'nope', 'unknown room id refused');

  // Bad input does not crash the server.
  watcher.ws.send('{not json');
  ok((await watcher.next((m) => m.op === 'error')).code === 'bad', 'invalid JSON answered with error');

  for (const c of [host, joiner, bad, hidden, vm, watcher]) c.ws.close();
} catch (e) {
  fails++;
  console.log('FAIL exception:', e.message);
} finally {
  srv.kill();
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
