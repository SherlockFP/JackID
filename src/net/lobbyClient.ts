/**
 * Lobby / signalling client (NET-SESSION, TECH §7.2–7.3). One WebSocket to `/lobby` per session, opened lazily.
 * It carries room list/create/join, WebRTC signalling and WS relay frames. Requests are matched to replies by op
 * (the server has no request ids): the oldest waiter whose reply op matches wins. Everything here is best effort;
 * a dead lobby just makes `connect()` resolve false and the session falls back to the other transports.
 */
import { PROTO } from './protocol';
import type { GameMode, Unsub } from '@/core/types';
import type { RoomInfo } from './protocol';

export interface RoomPublic {
  id: string; name: string; host: string; mode: GameMode; players: number; max: number; locked: boolean;
  salt: string; started: boolean; lateJoin: boolean; version: number; hostRtt: number; createdAt: number;
  status?: string; unlisted?: boolean;
}

export interface LobbyCreate {
  name: string; mode: GameMode; max: number; lateJoin: boolean; version: number;
  salt?: string; verifier?: string; status?: string; unlisted?: boolean;
}

export type LobbyEvent = 'signal' | 'relay' | 'peerJoin' | 'peerLeave' | 'roomClosed';
type Handler = (...args: never[]) => void;

export const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** `settings.net.lobbyUrl` → `VITE_LOBBY_URL` → same host `/lobby`. */
export function resolveLobbyUrl(configured = ''): string {
  if (configured) return configured;
  const env = import.meta.env.VITE_LOBBY_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/lobby`;
}

/** HTTP base for `/api` (same origin as the socket). */
export function httpBaseOf(wsUrl: string): string {
  const u = new URL(wsUrl, location.href);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/api';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Room-password proof: `sha256hex(salt + ':' + password)`, as the lobby stores `verifier`. */
export const passwordProof = (salt: string, password: string): Promise<string> => sha256hex(`${salt}:${password}`);

/** RoomPublic → RoomInfo for the browser. `via` is set by the caller. */
export function roomInfoOf(r: RoomPublic, via: RoomInfo['via']): RoomInfo {
  return {
    id: r.id, name: r.name, host: r.host, mode: r.mode, players: r.players, max: r.max, locked: r.locked,
    started: r.started, lateJoin: r.lateJoin, version: r.version, via, ping: r.hostRtt, salt: r.salt,
    friendsOnly: false,
  };
}

interface Waiter {
  ops: ReadonlySet<string>;
  match: (m: Record<string, unknown>) => boolean;
  resolve: (m: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LobbyClient {
  peer = '';
  ice: RTCIceServer[] = DEFAULT_ICE;
  /** Extra servers from settings (TURN). Appended to the lobby list. */
  extraIce: RTCIceServer[] = [];
  readonly url: string;
  private ws: WebSocket | null = null;
  private ready: Promise<boolean> | null = null;
  private readonly waiters: Waiter[] = [];
  private readonly handlers = new Map<LobbyEvent | 'closed', Set<Handler>>();

  constructor(url: string) { this.url = url; }

  get connected(): boolean { return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.peer !== ''; }

  /** Opens the socket and waits for `welcome`. Resolves false on any failure (never rejects). */
  connect(timeoutMs = 3000): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      let done = false;
      let ws: WebSocket;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok) { try { ws?.close(); } catch { /* already closed */ } this.ws = null; }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try { ws = new WebSocket(this.url); } catch { finish(false); return; }
      this.ws = ws;
      ws.onopen = () => this.raw({ op: 'hi', v: PROTO, name: 'JackID' });
      ws.onmessage = (e: MessageEvent<string>) => {
        const m = parseMsg(e.data);
        if (!m) return;
        if (m.op === 'welcome') {
          this.peer = String(m.peer ?? '');
          if (Array.isArray(m.ice) && m.ice.length > 0) this.ice = m.ice as RTCIceServer[];
          finish(this.peer !== '');
        } else {
          this.dispatch(m);
        }
      };
      ws.onerror = () => finish(false);
      ws.onclose = () => {
        const was = this.ws === ws;
        finish(false);
        if (was) this.gone();
      };
    }).then((ok) => { if (!ok) this.ready = null; return ok; });
    return this.ready;
  }

  /** Rooms the server lists (unlisted rooms are not included). */
  async list(): Promise<RoomPublic[]> {
    const m = await this.request({ op: 'list' }, new Set(['rooms']));
    return Array.isArray(m.rooms) ? (m.rooms as RoomPublic[]) : [];
  }

  async create(id: string, room: LobbyCreate): Promise<{ id: string; token: string }> {
    const m = await this.request({ op: 'create', id, room }, new Set(['created']));
    return { id: String(m.id ?? id), token: String(m.token ?? '') };
  }

  /** Resolves with the host peer id. Rejects with the lobby reason (`nope`, `full`, `password`, …). */
  async join(id: string, proof?: string): Promise<string> {
    const m = await this.request({ op: 'join', id, proof }, new Set(['joinOk', 'joinNo']), (x) => x.id === id);
    if (m.op === 'joinNo') throw new Error(String(m.reason ?? 'nope'));
    return String(m.host ?? '');
  }

  update(id: string, token: string, patch: Partial<Pick<RoomPublic, 'players' | 'started' | 'name' | 'mode' | 'max' | 'lateJoin'>>): void {
    this.raw({ op: 'update', id, token, patch });
  }
  heartbeat(id: string, token: string, hostRtt: number): void { this.raw({ op: 'hb', id, token, hostRtt }); }
  closeRoom(id: string, token: string): void { this.raw({ op: 'close', id, token }); }
  signal(to: string, data: unknown): void { this.raw({ op: 'signal', to, data }); }
  relay(to: string, d: string): void { this.raw({ op: 'relay', to, d }); }
  leave(): void { this.raw({ op: 'leave' }); }

  on(ev: LobbyEvent, fn: Handler): Unsub {
    return this.addHandler(ev, fn);
  }
  /** Fired when an established socket drops. */
  onClosed(fn: () => void): Unsub { return this.addHandler('closed', fn as Handler); }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    this.gone();
    try { ws?.close(); } catch { /* already closed */ }
  }

  private addHandler(ev: LobbyEvent | 'closed', fn: Handler): Unsub {
    let set = this.handlers.get(ev);
    if (!set) { set = new Set(); this.handlers.set(ev, set); }
    set.add(fn);
    return () => { this.handlers.get(ev)?.delete(fn); };
  }

  private gone(): void {
    this.peer = '';
    this.ready = null;
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error('lobby closed')); }
    this.handlers.get('closed')?.forEach((fn) => (fn as () => void)());
  }

  private raw(o: Record<string, unknown>): void {
    if (!this.connected) return;
    try { this.ws?.send(JSON.stringify(o)); } catch { /* socket closing */ }
  }

  private request(
    body: Record<string, unknown>,
    ops: ReadonlySet<string>,
    match: (m: Record<string, unknown>) => boolean = () => true,
    ms = 4000,
  ): Promise<Record<string, unknown>> {
    if (!this.connected) return Promise.reject(new Error('lobby not connected'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('lobby request timed out'));
      }, ms);
      const w: Waiter = {
        ops, match,
        resolve: (m) => { clearTimeout(timer); resolve(m); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        timer,
      };
      this.waiters.push(w);
      this.raw(body);
    });
  }

  private dispatch(m: Record<string, unknown>): void {
    const op = String(m.op ?? '');
    if (op === 'error') {
      // The server answers a failed create/join with `error`; fail the oldest request.
      const w = this.waiters.shift();
      if (w) w.reject(new Error(String(m.code ?? 'error')));
      return;
    }
    const idx = this.waiters.findIndex((w) => w.ops.has(op) && w.match(m));
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      w.resolve(m);
      return;
    }
    switch (op) {
      case 'signal': this.emit('signal', m.from, m.data); break;
      case 'relay': this.emit('relay', m.from, m.d); break;
      case 'peerJoin': this.emit('peerJoin', m.peer, m.name); break;
      case 'peerLeave': this.emit('peerLeave', m.peer); break;
      case 'roomClosed': this.emit('roomClosed', m.id, m.reason); break;
      default: break;
    }
  }

  private emit(ev: LobbyEvent, ...args: unknown[]): void {
    this.handlers.get(ev)?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  }
}

function parseMsg(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const o: unknown = JSON.parse(raw);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
