/**
 * Serverless global transport over Trystero's nostr strategy (NET-TRANSPORT, TECH §6.2, DECISIONS C3). Used when
 * the lobby is unreachable (automatic), or when `settings.net.useP2P` is on. Room = the room id, joined with the
 * room password (if any) as the encryption key. Actions: `r` (reliable), `u` (unreliable, best effort), `c` (control:
 * `hi` / `ack`). Mesh caveat: every peer hears every peer, so clients only ever send to the host, and only the host
 * answers `hi` with `ack`. A client's start() resolves on the first `ack`. Join budget: 15 s.
 *
 * Discovery and announcements use the shared `jackid:lobby` room (`ann` action, RoomInfo every 5 s).
 */
import { joinRoom } from 'trystero/nostr';
import { TRYSTERO_APP_ID, type Channel } from '../types';
import type { RoomInfo } from '../protocol';
import { HOST_PEER, TransportBase, withTimeout } from './base';

type Room = ReturnType<typeof joinRoom>;
const LOBBY_ROOM = 'lobby';
const JOIN_TIMEOUT_MS = 15000;

type Control = { k: 'hi' } | { k: 'ack' };

export class TrysteroTransport extends TransportBase {
  readonly kind = 'p2p' as const;
  private room: Room | null = null;
  private rAct: { send: (d: string, o?: { target?: string }) => Promise<void> } | null = null;
  private uAct: { send: (d: string, o?: { target?: string }) => Promise<void> } | null = null;
  private cAct: { send: (d: string, o?: { target?: string }) => Promise<void> } | null = null;
  private readonly known = new Set<string>();
  private hostPeer = '';
  private hiTimer: ReturnType<typeof setInterval> | null = null;

  constructor(role: 'host' | 'client', private readonly roomId: string, private readonly password?: string) {
    super(role);
  }

  start(): Promise<void> {
    const room = joinRoom({ appId: TRYSTERO_APP_ID, password: this.password || undefined }, this.roomId);
    this.room = room;
    const r = room.makeAction<string>('r');
    const u = room.makeAction<string>('u');
    const c = room.makeAction<string>('c');
    this.rAct = r; this.uAct = u; this.cAct = c;
    r.onMessage = (data, ctx) => this.onFrame(ctx.peerId, data, 'rel');
    u.onMessage = (data, ctx) => this.onFrame(ctx.peerId, data, 'unrel');
    c.onMessage = (data, ctx) => this.onControl(ctx.peerId, data);
    room.onPeerLeave = (peer) => {
      if (this.role === 'host') {
        if (this.known.delete(peer)) this.onPeerClose(peer, 'left');
      } else if (peer === this.hostPeer) {
        this.onPeerClose(HOST_PEER, 'hostLeft');
      }
    };
    if (this.role === 'host') return Promise.resolve();
    const found = new Promise<void>((resolve) => { this.ackResolve = resolve; });
    const hi = (): void => { void c.send(JSON.stringify({ k: 'hi' } satisfies Control)).catch(() => {}); };
    hi();
    this.hiTimer = setInterval(hi, 500);
    return withTimeout(found, JOIN_TIMEOUT_MS, 'p2p join').finally(() => {
      if (this.hiTimer !== null) clearInterval(this.hiTimer);
      this.hiTimer = null;
    });
  }

  private ackResolve: (() => void) | null = null;

  send(peer: string, data: string, ch: Channel): void {
    const target = this.role === 'host' ? peer : this.hostPeer;
    if (!target) return;
    const act = ch === 'unrel' ? this.uAct : this.rAct;
    void act?.send(data, { target }).catch(() => {});
  }

  disconnect(peer: string, reason = 'kicked'): void {
    if (this.role !== 'host') return;
    if (this.known.delete(peer)) this.onPeerClose(peer, reason);
  }

  close(): void {
    if (this.hiTimer !== null) clearInterval(this.hiTimer);
    this.hiTimer = null;
    this.known.clear();
    const room = this.room;
    this.room = null;
    if (room) void room.leave().catch(() => {});
  }

  private onControl(peer: string, data: string): void {
    let m: Control | null = null;
    try { m = JSON.parse(data) as Control; } catch { return; }
    if (this.role === 'host') {
      if (m?.k === 'hi') {
        if (!this.known.has(peer)) {
          this.known.add(peer);
          this.onPeerOpen(peer);
        }
        void this.cAct?.send(JSON.stringify({ k: 'ack' } satisfies Control), { target: peer }).catch(() => {});
      }
    } else if (m?.k === 'ack' && !this.hostPeer) {
      this.hostPeer = peer;
      this.ackResolve?.();
      this.ackResolve = null;
    }
  }

  private onFrame(peer: string, data: string, ch: Channel): void {
    if (typeof data !== 'string') return;
    if (this.role === 'host') {
      if (this.known.has(peer)) this.onMessage(peer, data, ch);
    } else if (peer === this.hostPeer) {
      this.onMessage(HOST_PEER, data, ch);
    }
  }
}

/** Host-side announcer on the shared lobby room. Returns the stop function. */
export function announceP2P(get: () => RoomInfo | null, every = 5000): () => void {
  let room: Room | null = null;
  let ann: { send: (d: string) => Promise<void> } | null = null;
  try {
    room = joinRoom({ appId: TRYSTERO_APP_ID }, LOBBY_ROOM);
    ann = room.makeAction<string>('ann');
  } catch {
    return () => {};
  }
  const send = (): void => {
    const r = get();
    if (r && ann) void ann.send(JSON.stringify(r)).catch(() => {});
  };
  const t = setInterval(send, every);
  const first = setTimeout(send, 1500);
  return () => {
    clearInterval(t);
    clearTimeout(first);
    if (room) void room.leave().catch(() => {});
  };
}

/** Browse the shared lobby for `ms`; returns the rooms heard. */
export function discoverP2P(ms = 6000): Promise<RoomInfo[]> {
  return new Promise((resolve) => {
    const found = new Map<string, RoomInfo>();
    let room: Room | null = null;
    try {
      room = joinRoom({ appId: TRYSTERO_APP_ID }, LOBBY_ROOM);
      const ann = room.makeAction<string>('ann');
      ann.onMessage = (data) => {
        try {
          const r = JSON.parse(data) as RoomInfo;
          if (typeof r?.id === 'string') found.set(r.id, { ...r, via: 'p2p' });
        } catch { /* ignore bad announcement */ }
      };
    } catch {
      resolve([]);
      return;
    }
    setTimeout(() => {
      if (room) void room.leave().catch(() => {});
      resolve([...found.values()]);
    }, ms);
  });
}
