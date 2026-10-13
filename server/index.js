// JackID lobby server: room registry, WebRTC signaling, WS relay fallback,
// static dist/ hosting. Single process, in-memory state. Spec: docs/TECH_SPEC.md §7.
// Start: `npm run server` (PORT env, default 8787). Deploy notes: docs/DEPLOY.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as rooms from './rooms.js';
import {
  roomCode, peerId, hostToken, safeEqual, cleanText, MessageLimiter, WindowLimiter,
} from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_SOCKETS = 2000;
const MAX_MSG = 64 * 1024;
const PING_MS = 20000;
const SWEEP_MS = 5000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf8')).version; } catch { return '0'; }
})();

function parseIce() {
  const def = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (!process.env.ICE_SERVERS) return def;
  try {
    const v = JSON.parse(process.env.ICE_SERVERS);
    if (Array.isArray(v)) return v;
    console.warn('[lobby] ICE_SERVERS must be a JSON array; using defaults');
  } catch {
    console.warn('[lobby] ICE_SERVERS is not valid JSON; using defaults');
  }
  return def;
}
const ICE = parseIce();

// peerId -> { id, ws, name, hostOf, roomId, createL, joinL, msgL, alive }
const peers = new Map();

const send = (ws, obj) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
};
const err = (ws, code, msg) => send(ws, { op: 'error', code, msg });

// ── HTTP ────────────────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};

function corsApi(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  const distReady = fs.existsSync(DIST);
  if (!distReady) {
    res.writeHead(pathname === '/' ? 503 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(pathname === '/' ? 'Client build missing. Run: npm run build' : 'Not found');
    return;
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
  let file = path.resolve(DIST, '.' + path.posix.normalize('/' + rel));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  let st = null;
  try { st = fs.statSync(file); } catch { st = null; }
  if (st && st.isDirectory()) {
    file = path.join(file, 'index.html');
    try { st = fs.statSync(file); } catch { st = null; }
  }
  if (!st || !st.isFile()) {
    // A missing file with an extension is a real 404; anything else is an SPA route.
    if (path.extname(pathname)) { res.writeHead(404); res.end('Not found'); return; }
    file = path.join(DIST, 'index.html');
    try { st = fs.statSync(file); } catch { res.writeHead(404); res.end('Not found'); return; }
  }
  const ext = path.extname(file).toLowerCase();
  const hashed = file.slice(DIST.length).split(path.sep).includes('assets');
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}

function onRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  if (req.method === 'OPTIONS') {
    if (p.startsWith('/api')) corsApi(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (p.startsWith('/api')) {
    corsApi(res);
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method' }); return; }
    if (p === '/api/health') {
      sendJson(res, 200, {
        ok: true, rooms: rooms.roomCount(), peers: peers.size, uptime: Math.round(process.uptime()), version: VERSION,
      });
      return;
    }
    if (p === '/api/rooms') { sendJson(res, 200, rooms.listRooms()); return; }
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, p);
}

const server = http.createServer(onRequest);

// ── WebSocket ───────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/lobby') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  const origin = req.headers.origin;
  if (ALLOWED.length && (!origin || !ALLOWED.includes(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
  }
  if (wss.clients.size >= MAX_SOCKETS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// Tells members (and the host on expiry) that a room is gone.
function notifyRoomGone(r, reason, exceptPeer = null) {
  for (const m of r.members.values()) {
    m.roomId = null;
    send(m.ws, { op: 'roomClosed', id: r.id, reason });
  }
  r.members.clear();
  const host = peers.get(r.hostPeer);
  if (host) {
    host.hostOf = null;
    if (host !== exceptPeer && reason === 'expired') send(host.ws, { op: 'roomClosed', id: r.id, reason });
  }
}

function closeRoomById(id, reason, exceptPeer = null) {
  const r = rooms.closeRoom(id);
  if (r) notifyRoomGone(r, reason, exceptPeer);
}

function removeMember(peer) {
  if (!peer.roomId) return;
  const r = rooms.getRoom(peer.roomId);
  peer.roomId = null;
  if (!r) return;
  r.members.delete(peer.id);
  const host = peers.get(r.hostPeer);
  if (host) send(host.ws, { op: 'peerLeave', peer: peer.id });
}

// signal/relay routing: a host reaches its joined members, a member reaches its host only.
function routeTarget(peer, to) {
  if (typeof to !== 'string') return null;
  if (peer.hostOf) {
    const r = rooms.getRoom(peer.hostOf);
    const m = r && r.members.get(to);
    return m ? m.ws : null;
  }
  if (peer.roomId) {
    const r = rooms.getRoom(peer.roomId);
    if (r && r.hostPeer === to) {
      const h = peers.get(to);
      return h ? h.ws : null;
    }
  }
  return null;
}

// Host-only ops: the room must exist, be ours, and the token must match.
function authRoom(peer, msg) {
  const r = typeof msg.id === 'string' ? rooms.getRoom(msg.id) : null;
  if (!r || r.hostPeer !== peer.id || !safeEqual(String(msg.token || ''), r.token)) return null;
  return r;
}

function handleOp(peer, msg) {
  const ws = peer.ws;
  switch (msg.op) {
    case 'hi': {
      peer.name = cleanText(msg.name, 24, 'PLAYER');
      send(ws, { op: 'welcome', peer: peer.id, v: 1, ice: ICE });
      return;
    }
    case 'list': {
      send(ws, { op: 'rooms', rooms: rooms.listRooms() });
      return;
    }
    case 'ping': {
      send(ws, { op: 'pong', a: msg.a });
      return;
    }
    case 'create': {
      if (!peer.createL.take()) { err(ws, 'rate', 'Too many room creations'); return; }
      if (peer.hostOf) { err(ws, 'already', 'Already hosting a room'); return; }
      if (peer.roomId) { err(ws, 'already', 'Leave your room first'); return; }
      if (!msg.room || typeof msg.room !== 'object') { err(ws, 'bad', 'Missing room'); return; }
      let id = roomCode();
      let guard = 0;
      while (!rooms.codeFree(id) && guard++ < 50) id = roomCode();
      const token = hostToken();
      const res = rooms.createRoom({ hostPeer: peer.id, hostName: peer.name, room: msg.room, token, id });
      if (res.error === 'full') { err(ws, 'full', 'Server is full'); return; }
      if (res.error) { err(ws, 'bad', 'Bad room settings'); return; }
      peer.hostOf = id;
      send(ws, { op: 'created', id, token });
      return;
    }
    case 'update': {
      const r = authRoom(peer, msg);
      if (!r) { err(ws, 'auth', 'Not the host'); return; }
      rooms.updateRoom(r.id, msg.patch);
      return;
    }
    case 'hb': {
      const r = authRoom(peer, msg);
      if (!r) { err(ws, 'auth', 'Not the host'); return; }
      rooms.touchRoom(r.id, msg.hostRtt);
      return;
    }
    case 'close': {
      const r = authRoom(peer, msg);
      if (!r) { err(ws, 'auth', 'Not the host'); return; }
      closeRoomById(r.id, 'host', peer);
      peer.hostOf = null;
      return;
    }
    case 'join': {
      if (!peer.joinL.take()) { err(ws, 'rate', 'Too many join attempts'); return; }
      if (peer.roomId || peer.hostOf) { err(ws, 'already', 'Already in a room'); return; }
      const id = typeof msg.id === 'string' ? msg.id.trim().toUpperCase() : '';
      const r = rooms.getRoom(id);
      const no = (reason) => send(ws, { op: 'joinNo', id, reason });
      if (!r) { no('nope'); return; }
      if (msg.version !== undefined && Number(msg.version) !== r.version) { no('version'); return; }
      if (r.members.size + 1 >= r.max) { no('full'); return; }
      if (r.started && !r.lateJoin) { no('started'); return; }
      if (r.verifier && !(typeof msg.proof === 'string' && safeEqual(msg.proof, r.verifier))) { no('password'); return; }
      r.members.set(peer.id, peer);
      peer.roomId = id;
      send(ws, { op: 'joinOk', id, host: r.hostPeer });
      const host = peers.get(r.hostPeer);
      if (host) send(host.ws, { op: 'peerJoin', peer: peer.id, name: peer.name });
      return;
    }
    case 'leave': {
      if (peer.hostOf) { closeRoomById(peer.hostOf, 'host', peer); peer.hostOf = null; }
      removeMember(peer);
      return;
    }
    case 'signal': {
      const target = routeTarget(peer, msg.to);
      if (!target) { err(ws, 'route', 'No such peer in your room'); return; }
      if (!msg.data || typeof msg.data !== 'object') { err(ws, 'bad', 'Bad signal'); return; }
      send(target, { op: 'signal', from: peer.id, data: msg.data });
      return;
    }
    case 'relay': {
      const target = routeTarget(peer, msg.to);
      if (!target) { err(ws, 'route', 'No such peer in your room'); return; }
      if (typeof msg.d !== 'string') { err(ws, 'bad', 'Bad relay'); return; }
      send(target, { op: 'relay', from: peer.id, d: msg.d });
      return;
    }
    default:
      err(ws, 'bad', 'Unknown op');
  }
}

wss.on('connection', (ws) => {
  const peer = {
    id: peerId(), ws, name: 'PLAYER', hostOf: null, roomId: null, alive: true,
    createL: new WindowLimiter(6, 60000),   // room creations per minute
    joinL: new WindowLimiter(30, 60000),    // join attempts per minute
    msgL: new MessageLimiter(120, 5000),    // 120 msg/s, kick after 5 s sustained
  };
  peers.set(peer.id, peer);
  ws.peer = peer;
  ws.on('pong', () => { peer.alive = true; });
  ws.on('message', (raw, isBinary) => {
    const verdict = peer.msgL.check();
    if (verdict === 'kick') { ws.close(1008, 'rate limit'); return; }
    if (verdict === 'drop') return;
    if (isBinary) { err(ws, 'bad', 'Text JSON only'); return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { err(ws, 'bad', 'Invalid JSON'); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.op !== 'string') { err(ws, 'bad', 'Missing op'); return; }
    try { handleOp(peer, msg); } catch (e) { console.error('[lobby] op failed', msg.op, e); err(ws, 'internal', 'Server error'); }
  });
  ws.on('close', () => {
    if (peer.hostOf) closeRoomById(peer.hostOf, 'host', peer);
    peer.hostOf = null;
    removeMember(peer);
    peers.delete(peer.id);
  });
  ws.on('error', () => { /* the close handler does the cleanup */ });
});

// Ping sockets every 20 s and terminate the ones that never answered.
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    const peer = ws.peer;
    if (peer && !peer.alive) { ws.terminate(); continue; }
    if (peer) peer.alive = false;
    ws.ping();
  }
}, PING_MS);

// Expire rooms whose host stopped heartbeating (15 s TTL).
const sweepTimer = setInterval(() => {
  for (const r of rooms.expireRooms()) notifyRoomGone(r, 'expired');
}, SWEEP_MS);

server.listen(PORT, HOST, () => {
  const dist = fs.existsSync(DIST) ? 'found' : 'MISSING (API only)';
  console.log(`[lobby] JackID server v${VERSION} on http://${HOST}:${PORT} | ws /lobby | dist ${dist}`);
});

function shutdown() {
  clearInterval(pingTimer);
  clearInterval(sweepTimer);
  for (const ws of wss.clients) ws.close(1001, 'server stopping');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
