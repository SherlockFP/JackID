/**
 * Same-browser transport over BroadcastChannel (NET-TRANSPORT, TECH §6.2). Used for `?net=tab` and for local
 * multi-tab testing. Discovery: hosts announce their RoomInfo on `jackid:lobby` every 2 s; a `q` frame asks them to
 * announce at once. Room traffic runs on `jackid:room:<id>`. A joiner says `hi` and waits for the host's `ack`
 * (retried every 250 ms, 3 s budget). A client's `bye` (or `pagehide`) closes its peer on the host.
 */
import { BROADCAST_LOBBY, broadcastRoom, type Channel } from '../types';
import type { RoomInfo } from '../protocol';
import { HOST_PEER, TransportBase, randomId, withTimeout } from './base';

type Frame =
  | { k: 'hi'; from: string }
  | { k: 'ack'; to: string }
  | { k: 'bye'; from: string }
  | { k: 'drop'; to: string; reason: string }
  | { k: 'close' }
  | { k: 'd'; from: string; to: string; c: Channel; d: string };

const ROLE_HOST_TO = HOST_PEER;

export class TabTransport extends TransportBase {
  readonly kind = 'tab' as const;
  private ch: BroadcastChannel | null = null;
  private readonly me = randomId();
  private readonly known = new Set<string>();
  private ackResolve: (() => void) | null = null;
  private hiTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onPageHide = (): void => {
    if (this.role === 'client') this.post({ k: 'bye', from: this.me });
    else this.post({ k: 'close' });
  };

  constructor(role: 'host' | 'client', private readonly roomId: string) { super(role); }

  start(): Promise<void> {
    this.ch = new BroadcastChannel(broadcastRoom(this.roomId));
    this.ch.onmessage = (e: MessageEvent<Frame>) => this.onFrame(e.data);
    if (typeof addEventListener === 'function') addEventListener('pagehide', this.onPageHide);
    if (this.role === 'host') return Promise.resolve();
    const reached = new Promise<void>((resolve) => { this.ackResolve = resolve; });
    const hi = (): void => this.post({ k: 'hi', from: this.me });
    hi();
    this.hiTimer = setInterval(hi, 250);
    return withTimeout(reached, 3000, 'tab join').finally(() => this.stopHi());
  }

  send(peer: string, data: string, ch: Channel): void {
    if (this.role === 'host') this.post({ k: 'd', from: ROLE_HOST_TO, to: peer, c: ch, d: data });
    else this.post({ k: 'd', from: this.me, to: ROLE_HOST_TO, c: ch, d: data });
  }

  disconnect(peer: string, reason = 'kicked'): void {
    if (this.role !== 'host') return;
    this.known.delete(peer);
    this.post({ k: 'drop', to: peer, reason });
  }

  close(): void {
    this.stopHi();
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', this.onPageHide);
    if (this.ch) {
      if (this.role === 'host') this.post({ k: 'close' });
      else this.post({ k: 'bye', from: this.me });
      this.ch.onmessage = null;
      this.ch.close();
      this.ch = null;
    }
    this.known.clear();
  }

  private stopHi(): void {
    if (this.hiTimer !== null) clearInterval(this.hiTimer);
    this.hiTimer = null;
  }

  private post(f: Frame): void {
    try { this.ch?.postMessage(f); } catch { /* channel closed */ }
  }

  private onFrame(f: Frame | undefined): void {
    if (!f || typeof f !== 'object') return;
    if (this.role === 'host') {
      if (f.k === 'hi') {
        if (!this.known.has(f.from)) {
          this.known.add(f.from);
          this.onPeerOpen(f.from);
        }
        this.post({ k: 'ack', to: f.from });
      } else if (f.k === 'bye') {
        if (this.known.delete(f.from)) this.onPeerClose(f.from, 'left');
      } else if (f.k === 'd' && f.to === ROLE_HOST_TO && this.known.has(f.from)) {
        this.onMessage(f.from, f.d, f.c);
      }
      return;
    }
    // client
    if (f.k === 'ack' && f.to === this.me) {
      this.ackResolve?.();
      this.ackResolve = null;
    } else if (f.k === 'd' && f.to === this.me && this.ackResolve === null) {
      this.onMessage(HOST_PEER, f.d, f.c);
    } else if (f.k === 'drop' && f.to === this.me) {
      this.onPeerClose(HOST_PEER, f.reason);
    } else if (f.k === 'close') {
      this.onPeerClose(HOST_PEER, 'hostQuit');
    }
  }
}

/**
 * Host-side announcer: posts the current RoomInfo every 2 s and whenever a `q` query arrives. Returns the stop function.
 * `get` returns null while the room should not be listed (private rooms, or closed).
 */
export function announceTab(get: () => RoomInfo | null, every = 2000): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(BROADCAST_LOBBY);
  const send = (): void => {
    const room = get();
    if (room) try { ch.postMessage({ k: 'room', room }); } catch { /* closed */ }
  };
  ch.onmessage = (e: MessageEvent<{ k?: string }>) => { if (e.data?.k === 'q') send(); };
  const t = setInterval(send, every);
  send();
  return () => { clearInterval(t); ch.close(); };
}

/** Client-side browse: asks every host to announce, collects replies for `ms`. */
export function discoverTab(ms = 1200): Promise<RoomInfo[]> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map<string, RoomInfo>();
    const ch = new BroadcastChannel(BROADCAST_LOBBY);
    ch.onmessage = (e: MessageEvent<{ k?: string; room?: RoomInfo }>) => {
      if (e.data?.k === 'room' && e.data.room && typeof e.data.room.id === 'string') {
        found.set(e.data.room.id, { ...e.data.room, via: 'tab' });
      }
    };
    ch.postMessage({ k: 'q' });
    setTimeout(() => { ch.close(); resolve([...found.values()]); }, ms);
  });
}
