// In-memory room registry with heartbeat expiry. No I/O: index.js does the notifying.
import { cleanText, cleanInt, cleanHex, MODES } from './util.js';

export const ROOM_TTL_MS = 15000;   // room expires 15 s after the last hb/create/update
export const MAX_ROOMS = 500;

const rooms = new Map();            // id -> room

// Internal room shape (never sent raw; see publicRoom()).
// { id, token, hostPeer, hostName, name, mode, max, lateJoin, version, salt, verifier,
//   status, unlisted, players, started, hostRtt, createdAt, lastSeen, members: Map<peerId,{ws,name}> }

export function createRoom({ hostPeer, hostName, room, token, id }) {
  if (rooms.size >= MAX_ROOMS) return { error: 'full' };
  const mode = MODES.has(room?.mode) ? room.mode : null;
  if (!mode) return { error: 'mode' };
  const salt = cleanHex(room.salt, 32);
  const verifier = cleanHex(room.verifier, 64);
  const now = Date.now();
  const r = {
    id,
    token,
    hostPeer,
    hostName,
    name: cleanText(room.name, 24, hostName || 'ROOM'),
    mode,
    max: cleanInt(room.max, 2, 8, 4),
    lateJoin: room.lateJoin !== false,
    version: cleanInt(room.version, 0, 1e6, 0),
    salt: salt || '',
    verifier: verifier && salt ? verifier : null, // no salt, no password
    status: cleanText(room.status, 8, 'LOBBY'),
    unlisted: room.unlisted === true,
    players: 1,
    started: false,
    hostRtt: 0,
    createdAt: now,
    lastSeen: now,
    members: new Map(),
  };
  rooms.set(id, r);
  return { room: r };
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function roomExists(id) {
  return rooms.has(id);
}

export function codeFree(id) {
  return !rooms.has(id);
}

export function touchRoom(id, hostRtt) {
  const r = rooms.get(id);
  if (!r) return null;
  r.lastSeen = Date.now();
  if (hostRtt !== undefined) r.hostRtt = cleanInt(hostRtt, 0, 10000, r.hostRtt);
  return r;
}

const PATCH_KEYS = {
  players: (v) => cleanInt(v, 1, 8, null),
  started: (v) => (typeof v === 'boolean' ? v : null),
  name: (v) => cleanText(v, 24, null),
  mode: (v) => (MODES.has(v) ? v : null),
  max: (v) => cleanInt(v, 2, 8, null),
  lateJoin: (v) => (typeof v === 'boolean' ? v : null),
  status: (v) => cleanText(v, 8, null),
  unlisted: (v) => (typeof v === 'boolean' ? v : null),
};

// Applies whitelisted fields only. Returns the room or null.
export function updateRoom(id, patch) {
  const r = rooms.get(id);
  if (!r || !patch || typeof patch !== 'object') return null;
  for (const k of Object.keys(PATCH_KEYS)) {
    if (!(k in patch)) continue;
    const v = PATCH_KEYS[k](patch[k]);
    if (v !== null && v !== undefined) r[k] = v;
  }
  r.lastSeen = Date.now();
  return r;
}

export function listRooms() {
  const now = Date.now();
  const out = [];
  for (const r of rooms.values()) {
    if (r.unlisted || now - r.lastSeen >= ROOM_TTL_MS) continue;
    out.push(publicRoom(r));
  }
  return out;
}

export function publicRoom(r) {
  return {
    id: r.id,
    name: r.name,
    host: r.hostName,
    mode: r.mode,
    // Host may report extra players (ghosts, away) via update; never below live members.
    players: Math.min(r.max, Math.max(1 + r.members.size, r.players)),
    max: r.max,
    locked: !!r.verifier,
    salt: r.salt,
    started: r.started,
    lateJoin: r.lateJoin,
    version: r.version,
    hostRtt: r.hostRtt,
    createdAt: r.createdAt,
    status: r.status,
    unlisted: r.unlisted,
  };
}

// Removes the room and returns it so the caller can notify its members.
export function closeRoom(id) {
  const r = rooms.get(id);
  if (!r) return null;
  rooms.delete(id);
  return r;
}

// Returns the rooms that expired (already removed) so the caller can notify members.
export function expireRooms(now = Date.now()) {
  const dead = [];
  for (const r of rooms.values()) {
    if (now - r.lastSeen >= ROOM_TTL_MS) dead.push(r.id);
  }
  return dead.map((id) => closeRoom(id)).filter(Boolean);
}

export function roomCount() {
  return rooms.size;
}
