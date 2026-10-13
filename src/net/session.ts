/**
 * Session (NET-SESSION, TECH §6.3–6.5, DECISIONS C5/C6/C24/C30). One object for all three modes:
 *  - offline: loopback only (single player). `isHost`, selfId 1, no transports.
 *  - host: listen server. Starts every enabled host transport at once (tab, lobby WebRTC + relay, Trystero when
 *    enabled or when the lobby is unreachable). Peers are keyed `'<kind>:<peer>'` and mapped to PlayerIds.
 *  - client: joins server → tab → Trystero in that order (3 s each, Trystero 15 s). Sends only to the host.
 * Inbound messages are decoded and checked here (host-only types from clients are dropped, rate limits apply), then
 * queued and delivered on `poll()`, so the game loop sees them in one place.
 */
import type { Json, Lang, PlayerId, Unsub } from '@/core/types';
import { bootParams } from '@/core/bootParams';
import { log } from '@/core/log';
import type { Settings } from '@/core/settings';
import {
  PROTO, RATE_LIMITS, UNRELIABLE, type Msg, type MsgType, type PlayerInfo, type RoomInfo,
} from './protocol';
import { type Channel, type HostOptions, type JoinTarget, type Session, type Transport } from './types';
import { ClockSync } from './clocksync';
import { Reassembler, encodeMsg } from './codec';
import { SnapshotRegistry, TransformStore } from './replication';
import {
  LobbyClient, httpBaseOf, passwordProof, resolveLobbyUrl, roomInfoOf, sha256hex, type RoomPublic,
} from './lobbyClient';
import { TabTransport, announceTab, discoverTab } from './transports/broadcast';
import { WebRtcTransport } from './transports/webrtc';
import { RelayTransport } from './transports/relay';
import { TrysteroTransport, announceP2P, discoverP2P } from './transports/trystero';
import { HOST_PEER, withTimeout } from './transports/base';

export type { HostOptions, JoinTarget, Session } from './types';

export interface LocalProfile { id: string; name: string; color: number }

export interface SessionOptions {
  /** Live `settings.net` (lobby URL, transport toggles). Defaults: server + tab on, Trystero off. */
  net?: () => Settings['net'];
  /** Live UI language, sent in `hello`. */
  lang?: () => Lang;
}

/** A join or host refused by the other side. `reason` is the protocol reason (`password`, `full`, …). */
export class NetDenied extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`net: denied (${reason})`);
    this.reason = reason;
  }
}

/** The public Session plus browser-side discovery (the menu's server browser). */
export interface NetSession extends Session {
  discover(): Promise<RoomInfo[]>;
}

type NetSettings = Settings['net'];
const DEFAULT_NET: NetSettings = { lobbyUrl: '', useServer: true, useTab: true, useP2P: false, turn: null };

/** Messages only the host may send. A client sending one is ignored. */
const HOST_ONLY: ReadonlySet<MsgType> = new Set<MsgType>([
  'welcome', 'deny', 'pjoin', 'pupd', 'pleave', 'kick', 'close', 'lcfg', 'start', 'end', 'toLobby', 'pts',
  'sys', 'moccOk', 'moccNo', 'mrelOk', 'msnap', 'tnak', 'rsnap', 'rdelta', 'ecoD', 'ecoNo', 'charmD', 'jp', 'jpWin',
  'tycNo', 'tycD', 'buffD', 'totemD', 'collD', 'evt', 'contracts', 'phone', 'vote', 'voteEnd', 'cut', 'cutGate',
  'cutEnd', 'fall', 'ascend', 'mbot', 'mpriv', 'mevp', 'snap',
]);

const HOST_PEER_ID: PlayerId = 1;
const PROTOCOL_DENY: ReadonlySet<string> = new Set(['full', 'password', 'version', 'started', 'kicked']);
const HOLD_MS = 300_000;          // DECISIONS/TECH §6.4: a dropped player keeps their seat 300 s
const SILENCE_PEER_MS = 10_000;   // host drops a peer silent for this long
const SILENCE_HOST_MS = 6000;     // client gives up on a host silent this long (pings every 1 s)
const HEARTBEAT_MS = 5000;
const PUPD_PING_MS = 2000;
const PT_MS = 50;                 // 20 Hz transforms
const RATE_WINDOW_MS = 1000;
const RATE_STRIKES = 3;
const RATE_STRIKE_WINDOW_MS = 10_000;
const DEFAULT_LIMIT = 60;
const CHAT_MAX = 200;
const NAME_MAX = 24;

interface PeerRec {
  key: string;
  peer: string;
  transport: Transport;
  rs: Reassembler;
  pid: PlayerId;          // 0 until hello is accepted
  cid: string;
  heard: number;
  rtt: number;
  rate: Map<string, { t: number; n: number }>;
  strikes: number[];
}

interface ClientLink {
  t: Transport;
  rs: Reassembler;
  heard: number;
  rtt: number;
}

interface Pending { resolve: () => void; reject: (e: Error) => void }

const clean = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
};
const clampInt = (v: number, lo: number, hi: number, fb: number): number =>
  Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : fb;
const clampHex = (v: unknown): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff ? (v as number) : 0xffffff);
const now = (): number => performance.now();

/** Room codes use the TECH alphabet (no I/O/0/1), minted by the host from crypto randomness. */
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintCode(len = 6): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return s;
}
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSession(profile: () => LocalProfile, opts: SessionOptions = {}): NetSession {
  const netCfg = (): NetSettings => opts.net?.() ?? DEFAULT_NET;
  const langNow = (): Lang => opts.lang?.() ?? (document.documentElement.lang === 'tr' ? 'tr' : 'en');
  const forced = bootParams.net;

  // ── shared state ──
  let mode: 'offline' | 'host' | 'client' = 'offline';
  let selfId: PlayerId = 1;
  let hostId: PlayerId = 1;
  let roomState: RoomInfo | null = null;
  const players = new Map<PlayerId, PlayerInfo>();
  let inbox: Array<{ msg: Msg; from: PlayerId }> = [];
  const handlers = new Map<string, Set<(msg: never, from: PlayerId) => void>>();
  const snaps = new SnapshotRegistry();
  const tx = new TransformStore();
  const clock = new ClockSync();
  let ptSeq = 0;
  let ptAcc = 0;
  let nextTick = 0;
  let lastPupd = 0;
  let lastHb = 0;
  let lastFlush = 0;
  let handshakeSentAt = 0;

  // ── host state ──
  const transports: Transport[] = [];
  const stops: Array<() => void> = [];
  const peers = new Map<string, PeerRec>();
  const byPid = new Map<PlayerId, PeerRec>();
  const held = new Map<string, { pid: PlayerId; until: number }>();
  const kicked = new Set<string>();
  let password: string | undefined;
  let publicRoom = false;
  let lobbyRoomId = '';
  let lobbyToken = '';
  let p2pUp = false;

  // ── client state ──
  let link: ClientLink | null = null;
  let pending: Pending | null = null;

  // ── lobby ──
  let lobby: LobbyClient | null = null;
  const getLobby = (): LobbyClient => {
    if (!lobby) {
      lobby = new LobbyClient(resolveLobbyUrl(netCfg().lobbyUrl));
      const turn = netCfg().turn;
      if (turn && turn.urls) lobby.extraIce = [{ urls: turn.urls, username: turn.username, credential: turn.credential }];
      lobby.onClosed(() => {
        if (mode === 'host' && lobbyRoomId) {
          lobbyRoomId = '';
          lobbyToken = '';
          startP2PHost();
        }
      });
    }
    return lobby;
  };

  const selfInfo = (host: boolean): PlayerInfo => {
    const p = profile();
    return { id: selfId, cid: p.id, name: clean(p.name, NAME_MAX) || 'PLAYER', color: clampHex(p.color), host, ready: host, state: host ? 'lobby' : 'alive', ping: 0 };
  };

  const resetPlayers = (host: boolean): void => {
    players.clear();
    players.set(selfId, selfInfo(host));
  };

  const queue = (msg: Msg, from: PlayerId): void => { inbox.push({ msg, from }); };

  const applyPlayerMsg = (msg: Msg): void => {
    if (msg.t === 'pjoin') players.set(msg.p.id, msg.p);
    else if (msg.t === 'pupd') {
      const cur = players.get(msg.id);
      if (cur) players.set(msg.id, { ...cur, ...msg.patch, id: cur.id });
    } else if (msg.t === 'pleave') players.delete(msg.id);
  };

  // ── transmit helpers ──
  const sendFrames = (t: Transport, peer: string, frames: string[], ch: Channel): void => {
    for (const f of frames) t.send(peer, f, ch);
  };

  /** Joined host-side peers, optionally excluding one PlayerId. */
  const joined = (exclude?: PlayerId): PeerRec[] => {
    const out: PeerRec[] = [];
    for (const p of byPid.values()) if (p.pid !== exclude) out.push(p);
    return out;
  };

  const broadcast = (msg: Msg, ch: Channel, exclude?: PlayerId): void => {
    const frames = encodeMsg(msg);
    for (const p of joined(exclude)) sendFrames(p.transport, p.peer, frames, ch);
  };

  const pushLobby = (patch: Partial<Pick<RoomPublic, 'players' | 'started' | 'name' | 'mode' | 'max' | 'lateJoin'>>): void => {
    if (lobbyRoomId && lobby?.connected) lobby.update(lobbyRoomId, lobbyToken, patch);
  };

  // ── host: peer bookkeeping ──
  const peerFor = (t: Transport, peer: string): PeerRec => {
    const key = `${t.kind}:${peer}`;
    let p = peers.get(key);
    if (!p) {
      p = { key, peer, transport: t, rs: new Reassembler(), pid: 0, cid: '', heard: now(), rtt: 0, rate: new Map(), strikes: [] };
      peers.set(key, p);
    }
    return p;
  };

  /** Removes a host-side peer. Joined players announce `pleave` and keep their seat for HOLD_MS. */
  const removePeer = (p: PeerRec, reason: 'left' | 'timeout' | 'kicked', tellTransport: boolean): void => {
    if (!peers.delete(p.key)) return;
    if (p.pid) {
      byPid.delete(p.pid);
      players.delete(p.pid);
      tx.drop(p.pid);
      if (reason !== 'kicked') held.set(p.cid, { pid: p.pid, until: now() + HOLD_MS });
      const msg: Msg = { t: 'pleave', id: p.pid, reason };
      broadcast(msg, 'rel');
      queue(msg, selfId);
      pushLobby({ players: byPid.size + 1 });
      if (roomState) roomState.players = byPid.size + 1;
    }
    if (tellTransport) {
      try { p.transport.disconnect(p.peer, reason); } catch { /* transport already gone */ }
    }
  };

  const strike = (p: PeerRec): void => {
    const t = now();
    p.strikes = p.strikes.filter((s) => t - s < RATE_STRIKE_WINDOW_MS);
    p.strikes.push(t);
    if (p.strikes.length >= RATE_STRIKES) {
      if (p.pid) session.kick(p.pid, 'rate');
      else removePeer(p, 'left', true);
    }
  };

  const allow = (p: PeerRec, t: MsgType): boolean => {
    const limit = RATE_LIMITS[t] ?? DEFAULT_LIMIT;
    const at = now();
    const w = p.rate.get(t);
    if (!w || at - w.t >= RATE_WINDOW_MS) { p.rate.set(t, { t: at, n: 1 }); return true; }
    if (w.n < limit) { w.n++; return true; }
    strike(p);
    return false;
  };

  const deny = (p: PeerRec, reason: string): void => {
    transmit(p.transport, p.peer, { t: 'deny', reason } as Msg, 'rel');
    removePeer(p, 'left', false);
    setTimeout(() => { try { p.transport.disconnect(p.peer, reason); } catch { /* gone */ } }, 300);
  };

  const transmit = (t: Transport, peer: string, msg: Msg, ch: Channel): void => {
    sendFrames(t, peer, encodeMsg(msg), UNRELIABLE.has(msg.t) ? 'unrel' : ch);
  };

  const firstFreePid = (max: number): PlayerId | null => {
    for (let pid = 2; pid <= max; pid++) if (!byPid.has(pid)) return pid;
    return null;
  };

  const handleHello = (p: PeerRec, h: Extract<Msg, { t: 'hello' }>): void => {
    const room = roomState;
    if (!room) return deny(p, 'started');
    if (h.v !== PROTO) return deny(p, 'version');
    if (kicked.has(h.cid)) return deny(p, 'kicked');
    if (password !== undefined && (h.pass ?? '') !== password) return deny(p, 'password');
    if (room.started && !room.lateJoin) return deny(p, 'started');
    let pid: PlayerId | null = null;
    // Same person connecting again (other transport or after a drop): reuse their seat.
    for (const q of byPid.values()) {
      if (q.cid === h.cid && q !== p) { pid = q.pid; removePeer(q, 'left', true); break; }
    }
    if (pid === null) {
      const hold = held.get(h.cid);
      if (hold && hold.until > now() && !byPid.has(hold.pid)) pid = hold.pid;
    }
    held.delete(h.cid);
    if (pid !== null && byPid.has(pid)) pid = null;
    if (pid === null) {
      if (byPid.size + 1 >= room.max) return deny(p, 'full');
      pid = firstFreePid(room.max);
      if (pid === null) return deny(p, 'full');
    }
    const started = room.started;
    const info: PlayerInfo = {
      id: pid, cid: h.cid, name: clean(h.name, NAME_MAX) || 'PLAYER', color: clampHex(h.color), host: false,
      ready: false, state: started ? 'alive' : 'lobby', ping: Math.round(p.rtt),
      char: typeof h.char === 'string' ? clean(h.char, 24) : undefined,
    };
    p.pid = pid;
    p.cid = h.cid;
    byPid.set(pid, p);
    players.set(pid, info);
    room.players = byPid.size + 1;
    pushLobby({ players: room.players });
    transmit(p.transport, p.peer, {
      t: 'welcome', you: pid, room: { ...room }, players: [...players.values()],
      phase: started ? 'ingame' : 'lobby', hostTime: now(), occ: [],
    }, 'rel');
    for (const s of snaps.forPlayer(pid)) transmit(p.transport, p.peer, { t: 'snap', ch: s.ch, d: s.d }, 'rel');
    const pj: Msg = { t: 'pjoin', p: info };
    broadcast(pj, 'rel', pid);
    queue(pj, selfId);
  };

  /** Host applies one inbound frame from a transport. */
  const onHostFrame = (t: Transport, peer: string, data: string, _ch: Channel): void => {
    const p = peerFor(t, peer);
    const at = now();
    p.heard = at;
    const msg = p.rs.push(data, at);
    if (!msg) return;
    if (!p.pid) {
      if (msg.t === 'hello') handleHello(p, msg);
      return;
    }
    if (msg.t === 'hello') return;                       // duplicate
    if (HOST_ONLY.has(msg.t)) return;
    switch (msg.t) {
      case 'ping':
        transmit(t, peer, { t: 'pong', a: msg.a, b: now() }, 'rel');
        return;
      case 'pong': {
        p.rtt = Math.max(0, at - msg.a);
        const cur = players.get(p.pid);
        if (cur) cur.ping = Math.round(p.rtt);
        return;
      }
      case 'pt':
        if (!allow(p, 'pt')) return;
        tx.set(p.pid, msg.p, msg.r, msg.f, msg.s, at);
        queue(msg, p.pid);
        return;
      case 'ready': {
        if (!allow(p, 'ready')) return;
        const cur = players.get(p.pid);
        if (cur) cur.ready = !!msg.r;
        broadcast({ t: 'pupd', id: p.pid, patch: { ready: !!msg.r } }, 'rel');
        queue(msg, p.pid);
        return;
      }
      case 'prof': {
        if (!allow(p, 'prof')) return;
        const patch: Partial<PlayerInfo> = {};
        if (typeof msg.name === 'string') patch.name = clean(msg.name, NAME_MAX) || 'PLAYER';
        if (msg.color !== undefined) patch.color = clampHex(msg.color);
        if (typeof msg.char === 'string') patch.char = clean(msg.char, 24);
        applyPlayerMsg({ t: 'pupd', id: p.pid, patch });
        broadcast({ t: 'pupd', id: p.pid, patch }, 'rel');
        queue(msg, p.pid);
        return;
      }
      case 'chat': {
        if (!allow(p, 'chat')) return;
        const text = clean(msg.text, CHAT_MAX);
        if (!text) return;
        session.send({ t: 'chat', from: p.pid, text }, 'all');
        return;
      }
      case 'emote':
      case 'mark':
        if (!allow(p, msg.t)) return;
        session.send({ ...msg, from: p.pid } as Msg, 'all');
        return;
      case 'vsig': {
        if (!allow(p, 'vsig')) return;
        const target = byPid.get(msg.to);
        if (target) transmit(target.transport, target.peer, { ...msg, from: p.pid }, 'rel');
        return;
      }
      default:
        if (!allow(p, msg.t)) return;
        queue(msg, p.pid);
    }
  };

  // ── client: inbound from the host ──
  const onClientFrame = (data: string): void => {
    const l = link;
    if (!l) return;
    const at = now();
    l.heard = at;
    const msg = l.rs.push(data, at);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        if (pending) acceptWelcome(msg);
        return;
      case 'deny':
        if (pending) { const pe = pending; pending = null; pe.reject(new NetDenied(msg.reason)); }
        return;
      case 'ping':
        transmit(l.t, HOST_PEER, { t: 'pong', a: msg.a, b: at }, 'rel');
        return;
      case 'pong':
        clock.sample(msg.a, msg.b, at);
        l.rtt = clock.rtt;
        return;
      case 'snap':
        snaps.apply(msg.ch, msg.d);
        return;
      case 'pjoin':
      case 'pupd':
      case 'pleave':
        applyPlayerMsg(msg);
        queue(msg, hostId);
        return;
      case 'kick':
      case 'close':
        queue(msg, hostId);
        teardown();
        return;
      default:
        queue(msg, hostId);
    }
  };

  const acceptWelcome = (w: Extract<Msg, { t: 'welcome' }>): void => {
    const pe = pending;
    pending = null;
    mode = 'client';
    selfId = w.you;
    hostId = HOST_PEER_ID;
    roomState = w.room;
    players.clear();
    for (const p of w.players) players.set(p.id, p);
    if (!players.has(selfId)) players.set(selfId, selfInfo(false));
    clock.reset();
    clock.sample(handshakeSentAt, w.hostTime, now());
    if (link) link.rtt = clock.rtt;
    nextTick = 0;
    pe?.resolve();
  };

  /** Called when the host link dies (transport close, timeout, roomClosed). */
  const onClientLost = (reason: string): void => {
    if (pending) {
      const pe = pending;
      pending = null;
      pe.reject(new NetDenied(reason));
      return;
    }
    if (!link) return;
    queue({ t: 'close', reason: reason === 'hostLeft' ? 'hostLeft' : 'hostQuit' }, hostId);
    teardown();
  };

  const teardown = (): void => {
    const l = link;
    link = null;
    if (l) { try { l.t.close(); } catch { /* ignore */ } }
    pending = null;
    if (mode === 'client') {
      mode = 'offline';
      selfId = 1;
      hostId = 1;
      roomState = null;
      resetPlayers(true);
    }
    lobby?.disconnect();
  };

  // ── transports wiring ──
  const wireHost = (t: Transport): void => {
    t.onPeerOpen = (peer) => { peerFor(t, peer); };
    t.onPeerClose = (peer, reason) => {
      const p = peers.get(`${t.kind}:${peer}`);
      if (!p) return;
      removePeer(p, reason === 'timeout' ? 'timeout' : 'left', false);
    };
    t.onMessage = (peer, data, ch) => onHostFrame(t, peer, data, ch);
    transports.push(t);
  };
  const wireClient = (t: Transport): void => {
    t.onPeerOpen = () => { /* client has one peer: the host */ };
    t.onPeerClose = (_peer, reason) => { if (link?.t === t || pending) onClientLost(reason); };
    t.onMessage = (_peer, data) => { if (link?.t === t || pending) onClientFrame(data); };
  };

  // ── host lifecycle ──
  const startP2PHost = (room?: RoomInfo | null): void => {
    if (p2pUp || !roomState) return;
    const r = room ?? roomState;
    const t = new TrysteroTransport('host', r.id, password);
    wireHost(t);
    p2pUp = true;
    void t.start().catch((e) => log.error('[net] trystero host', e));
    stops.push(announceP2P(() => (publicRoom && roomState ? roomState : null)));
  };

  const closeHost = (): void => {
    for (const s of stops.splice(0)) { try { s(); } catch { /* ignore */ } }
    for (const t of transports.splice(0)) { try { t.close(); } catch { /* ignore */ } }
    if (lobbyRoomId && lobby) {
      try { lobby.closeRoom(lobbyRoomId, lobbyToken); } catch { /* ignore */ }
    }
    peers.clear();
    byPid.clear();
    held.clear();
    kicked.clear();
    password = undefined;
    publicRoom = false;
    lobbyRoomId = '';
    lobbyToken = '';
    p2pUp = false;
    lobby?.disconnect();
    mode = 'offline';
    selfId = 1;
    hostId = 1;
    roomState = null;
    resetPlayers(true);
  };

  // ── Session ──
  const session: NetSession = {
    get mode() { return mode; },
    get isHost() { return mode !== 'client'; },
    get online() { return mode !== 'offline'; },
    get selfId() { return selfId; },
    get hostId() { return hostId; },
    get room() { return roomState; },
    players,

    hostTime(): number {
      return mode === 'client' ? clock.toHost(now()) : now();
    },

    rtt(pid?: PlayerId): number {
      if (mode === 'host') {
        if (pid === undefined || pid === selfId) return 0;
        return byPid.get(pid)?.rtt ?? 0;
      }
      if (mode === 'client') {
        if (pid === undefined || pid === hostId) return link?.rtt ?? clock.rtt;
        return players.get(pid)?.ping ?? 0;
      }
      return 0;
    },

    startOffline(): void {
      if (mode !== 'offline') teardown();
      if (mode === 'host') closeHost();
      mode = 'offline';
      selfId = 1;
      hostId = 1;
      resetPlayers(true);
    },

    async host(o: HostOptions): Promise<RoomInfo> {
      if (mode !== 'offline') session.leave();
      const net = netCfg();
      const useTab = forced ? forced === 'tab' : net.useTab;
      const useServer = forced ? forced === 'relay' || forced === 'webrtc' : net.useServer;
      const useP2P = forced ? forced === 'p2p' : net.useP2P;
      const name = clean(o.name, NAME_MAX) || 'ROOM';
      const max = clampInt(o.max, 2, 8, 4);
      const pwd = o.password ? clean(o.password, 32) : '';
      password = pwd || undefined;
      publicRoom = o.public;
      mode = 'host';
      selfId = 1;
      hostId = 1;

      let id = mintCode();
      let salt = '';
      let verifier = '';
      if (password) {
        salt = randomHex(16);
        verifier = await sha256hex(`${salt}:${password}`);
      }
      const base = { name, mode: o.mode, max, lateJoin: o.lateJoin, version: PROTO };
      const room: RoomInfo = {
        id, name, host: name, mode: o.mode, players: 1, max, locked: !!password, started: false,
        lateJoin: o.lateJoin, version: PROTO, via: 'tab', salt: salt || undefined, friendsOnly: o.friendsOnly === true,
      };
      roomState = room;
      resetPlayers(true);

      // Lobby first: it decides the room id (collisions retry), then local transports use the final id.
      let lobbyOk = false;
      if (useServer) {
        const lb = getLobby();
        lobbyOk = await lb.connect(3000);
        if (lobbyOk) {
          let created = false;
          for (let attempt = 0; attempt < 3 && !created; attempt++) {
            try {
              const r = await lb.create(id, { ...base, salt: salt || undefined, verifier: verifier || undefined, status: 'LOBBY', unlisted: !o.public });
              lobbyRoomId = r.id || id;
              lobbyToken = r.token;
              created = true;
            } catch {
              id = mintCode();
              room.id = id;
            }
          }
          lobbyOk = created;
        }
        if (lobbyOk) {
          room.via = 'server';
          const serverMode = forced === 'webrtc' ? 'webrtc' : forced === 'relay' ? 'relay' : 'both';
          const lb2 = getLobby();
          if (serverMode !== 'relay') { const w = new WebRtcTransport('host', lb2, ''); wireHost(w); await w.start(); }
          if (serverMode !== 'webrtc') { const r = new RelayTransport('host', lb2, ''); wireHost(r); await r.start(); }
        }
      }
      if (useTab) {
        const t = new TabTransport('host', id);
        wireHost(t);
        await t.start();
        stops.push(announceTab(() => (publicRoom && roomState ? roomState : null)));
        if (!lobbyOk) room.via = 'tab';
      }
      if (useP2P || (useServer && !lobbyOk)) {
        if (!lobbyOk && useServer) room.via = 'p2p';
        startP2PHost(room);
      }
      if (lobbyOk) lastHb = now();
      return room;
    },

    async join(target: JoinTarget, o: { password?: string }): Promise<void> {
      if (mode !== 'offline') session.leave();
      const net = netCfg();
      const pwd = o.password ? clean(o.password, 32) : undefined;
      const order: Array<'server' | 'tab' | 'p2p'> = [];
      if (forced) {
        if (forced === 'relay' || forced === 'webrtc') order.push('server');
        else if (forced === 'tab') order.push('tab');
        else order.push('p2p');
      } else {
        if (net.useServer) order.push('server');
        if (net.useTab) order.push('tab');
        order.push('p2p');
      }
      let lastErr: Error = new NetDenied('nope');
      for (const via of order) {
        try {
          await attempt(via, target.roomId, pwd);
          return;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (err instanceof NetDenied && PROTOCOL_DENY.has(err.reason)) throw err;
          lastErr = err;
        }
      }
      throw lastErr;
    },

    leave(_reason?: string): void {
      if (mode === 'host') {
        const q: Msg = { t: 'close', reason: 'hostQuit' };
        broadcast(q, 'rel');
        closeHost();
      } else if (mode === 'client') {
        teardown();
      }
      mode = 'offline';
    },

    send(msg: Msg, to: PlayerId | 'host' | 'all' | 'others' = 'others', ch: Channel = 'rel'): void {
      const channel: Channel = UNRELIABLE.has(msg.t) ? 'unrel' : ch;
      if (mode === 'client') {
        if (link) transmit(link.t, HOST_PEER, msg, channel);
        return;
      }
      if (mode === 'offline') {
        if (to === 'all' || to === 'host' || to === selfId) queue(msg, selfId);
        return;
      }
      // host: apply host-side bookkeeping for what it sends
      if (msg.t === 'pt') tx.set(selfId, msg.p, msg.r, msg.f, msg.s, now());
      if (msg.t === 'pjoin' || msg.t === 'pupd' || msg.t === 'pleave') applyPlayerMsg(msg);
      if (msg.t === 'start' && roomState) { roomState.started = true; pushLobby({ started: true }); }
      if (msg.t === 'toLobby' && roomState) { roomState.started = false; pushLobby({ started: false }); }
      if (msg.t === 'lcfg' && roomState) {
        roomState.mode = msg.mode;
        roomState.max = msg.max;
        roomState.lateJoin = msg.lateJoin;
        pushLobby({ mode: msg.mode, max: msg.max, lateJoin: msg.lateJoin });
      }
      if (to === 'others') { broadcast(msg, channel); return; }
      if (to === 'all') { broadcast(msg, channel); queue(msg, selfId); return; }
      if (to === 'host' || to === selfId) { queue(msg, selfId); return; }
      const p = byPid.get(to);
      if (p) transmit(p.transport, p.peer, msg, channel);
    },

    on<T extends Msg['t']>(t: T, fn: (msg: Extract<Msg, { t: T }>, from: PlayerId) => void): Unsub {
      let set = handlers.get(t);
      if (!set) { set = new Set(); handlers.set(t, set); }
      set.add(fn as never);
      return () => { set!.delete(fn as never); };
    },

    kick(pid: PlayerId, reason?: string): void {
      if (mode !== 'host' || pid === selfId) return;
      const p = byPid.get(pid);
      if (!p) return;
      kicked.add(p.cid);
      transmit(p.transport, p.peer, { t: 'kick', reason }, 'rel');
      removePeer(p, 'kicked', true);
    },

    poll(): void {
      if (inbox.length === 0) return;
      const q = inbox;
      inbox = [];
      for (const { msg, from } of q) {
        const set = handlers.get(msg.t);
        if (!set) continue;
        for (const fn of [...set]) {
          try { (fn as (m: Msg, f: PlayerId) => void)(msg, from); } catch (e) { log.error('[net] handler', msg.t, e); }
        }
      }
    },

    flush(_dt: number): void {
      const t = now();
      const dtMs = lastFlush > 0 ? Math.min(250, t - lastFlush) : 0;
      lastFlush = t;
      if (mode === 'host') {
        ptAcc += dtMs;
        if (ptAcc >= PT_MS) {
          ptAcc %= PT_MS;
          if (tx.takeDirty()) {
            const a = tx.collect(t);
            if (a.length) broadcast({ t: 'pts', s: ++ptSeq, a }, 'unrel');
          }
        }
        if (t >= nextTick) {
          nextTick = t + 1000;
          for (const p of [...peers.values()]) {
            if (p.pid) transmit(p.transport, p.peer, { t: 'ping', a: t }, 'rel');
            if (t - p.heard > SILENCE_PEER_MS) removePeer(p, 'timeout', true);
          }
          if (t - lastPupd >= PUPD_PING_MS) {
            lastPupd = t;
            for (const p of byPid.values()) broadcast({ t: 'pupd', id: p.pid, patch: { ping: Math.round(p.rtt) } }, 'rel');
          }
        }
        if (lobbyRoomId && lobby?.connected && t - lastHb >= HEARTBEAT_MS) {
          lastHb = t;
          lobby.heartbeat(lobbyRoomId, lobbyToken, 0);
        }
      } else if (mode === 'client' && link) {
        if (t >= nextTick) {
          nextTick = t + 1000;
          transmit(link.t, HOST_PEER, { t: 'ping', a: t }, 'rel');
          if (t - link.heard > SILENCE_HOST_MS) onClientLost('timeout');
        }
      }
      // pending inbound peers that never say hello
      if (mode === 'host') {
        for (const p of [...peers.values()]) if (!p.pid && t - p.heard > SILENCE_PEER_MS) removePeer(p, 'timeout', true);
      }
    },

    inviteLink(): string | null {
      if (mode !== 'host' || !roomState) return null;
      const loc = globalThis.location;
      if (!loc) return null;
      return `${loc.origin}${loc.pathname}?join=${roomState.id}`;
    },

    registerSnapshot(channel: string, get: (forPid: PlayerId) => Json, apply: (snap: Json) => void): Unsub {
      return snaps.register(channel, get, apply);
    },

    async discover(): Promise<RoomInfo[]> {
      const net = netCfg();
      const out = new Map<string, RoomInfo>();
      let serverOk = false;
      if (net.useServer && !forced || forced === 'relay' || forced === 'webrtc') {
        const lb = getLobby();
        serverOk = await lb.connect(3000);
        if (serverOk) {
          try {
            for (const r of await lb.list()) if (!out.has(r.id)) out.set(r.id, roomInfoOf(r, 'server'));
          } catch { /* list failed: fall through to HTTP */ }
        }
        if (!serverOk) {
          try {
            const res = await withTimeout(fetch(`${httpBaseOf(lb.url)}/rooms`, { cache: 'no-store' }), 3000, 'rooms');
            if (res.ok) {
              const list = (await res.json()) as RoomPublic[];
              for (const r of list) if (!out.has(r.id)) out.set(r.id, roomInfoOf(r, 'server'));
            }
          } catch { /* lobby unreachable */ }
        }
      }
      if (net.useTab && (!forced || forced === 'tab')) {
        for (const r of await discoverTab(1200)) if (!out.has(r.id)) out.set(r.id, r);
      }
      if ((net.useP2P && !forced) || forced === 'p2p' || (net.useServer && !serverOk && !forced)) {
        for (const r of await discoverP2P(6000)) if (!out.has(r.id)) out.set(r.id, r);
      }
      return [...out.values()];
    },
  };

  /** Attempts one join route. Resolves once the host's `welcome` arrives. Throws on any failure. */
  const attempt = async (via: 'server' | 'tab' | 'p2p', roomId: string, pwd: string | undefined): Promise<void> => {
    let t: Transport;
    let timeoutMs = 4000;
    if (via === 'server') {
      const lb = getLobby();
      if (!(await lb.connect(3000))) throw new NetDenied('timeout');
      let proof: string | undefined;
      if (pwd) {
        const rooms = await lb.list().catch(() => [] as RoomPublic[]);
        const salt = rooms.find((r) => r.id === roomId)?.salt;
        if (salt) proof = await passwordProof(salt, pwd);
      }
      let hostPeer: string;
      try {
        hostPeer = await lb.join(roomId, proof);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'nope';
        throw reason === 'nope' || reason === 'lobby closed' || reason.includes('timed out') ? new NetDenied('nope') : new NetDenied(reason);
      }
      const mode2 = forced === 'webrtc' ? 'webrtc' : forced === 'relay' ? 'relay' : 'both';
      const rtc = mode2 !== 'relay' ? new WebRtcTransport('client', lb, hostPeer) : null;
      let chosen: Transport | null = null;
      if (rtc) {
        wireClient(rtc);
        try { await rtc.start(); chosen = rtc; } catch { rtc.close(); }
      }
      if (!chosen) {
        if (mode2 === 'webrtc') { lb.leave(); throw new NetDenied('nope'); }
        const relay = new RelayTransport('client', lb, hostPeer);
        wireClient(relay);
        await relay.start();
        chosen = relay;
      }
      t = chosen;
      timeoutMs = 4000;
    } else if (via === 'tab') {
      const tab = new TabTransport('client', roomId);
      wireClient(tab);
      try { await tab.start(); } catch { tab.close(); throw new NetDenied('nope'); }
      t = tab;
    } else {
      const p2p = new TrysteroTransport('client', roomId, pwd);
      wireClient(p2p);
      try { await p2p.start(); } catch { p2p.close(); throw new NetDenied('nope'); }
      t = p2p;
      timeoutMs = 15000;
    }

    link = { t, rs: new Reassembler(), heard: now(), rtt: 0 };
    const hs = new Promise<void>((resolve, reject) => { pending = { resolve, reject }; });
    handshakeSentAt = now();
    const p = profile();
    transmit(t, HOST_PEER, {
      t: 'hello', v: PROTO, cid: p.id, name: clean(p.name, NAME_MAX) || 'PLAYER', color: clampHex(p.color),
      lang: langNow(), pass: pwd,
    }, 'rel');
    try {
      await withTimeout(hs, timeoutMs, 'welcome');
    } catch (e) {
      pending = null;
      link = null;
      try { t.close(); } catch { /* ignore */ }
      throw e;
    }
    nextTick = 0;
    void kickstart();
  };

  const kickstart = async (): Promise<void> => {
    if (link) transmit(link.t, HOST_PEER, { t: 'ping', a: now() }, 'rel');
  };

  resetPlayers(true);
  return session;
}
