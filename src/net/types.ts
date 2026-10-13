/**
 * Transport interface — TD-FROZEN. Implementations: NET-TRANSPORT (`net/transports/*`). Contract: TECH_SPEC §6.2.
 *
 * | backend           | file                  | channels                                    |
 * |-------------------|-----------------------|---------------------------------------------|
 * | WebRTC (via lobby)| transports/webrtc.ts  | rel + unrel (both open within 8 s or fallback) |
 * | WS relay          | transports/relay.ts   | rel only (unrel mapped to rel, transforms 10 Hz) |
 * | BroadcastChannel  | transports/broadcast.ts | rel + unrel (same-browser tabs)           |
 * | Trystero (opt.)   | transports/trystero.ts | rel (+unrel best-effort), off by default    |
 *
 * Host hub: `Session` starts all enabled host transports at once; peers are keyed `'<kind>:<peerId>'`
 * internally and mapped to a `PlayerId`. Clients send only to the host (`peer === 'host'`).
 */
import type { GameMode, Json, PlayerId, Unsub } from '@/core/types';
import type { Msg, PlayerInfo, RoomInfo } from './protocol';

export type TransportKind = 'webrtc' | 'relay' | 'tab' | 'p2p';
export type Channel = 'rel' | 'unrel';

export interface Transport {
  readonly kind: TransportKind;
  readonly role: 'host' | 'client';
  start(): Promise<void>;                              // host: accept peers; client: connect to host (rejects on timeout)
  send(peer: string, data: string, ch: Channel): void; // client: peer = 'host'
  disconnect(peer: string, reason?: string): void;
  close(): void;
  rtt(peer: string): number | undefined;               // ms, if the transport measures it
  onPeerOpen: (peer: string) => void;
  onPeerClose: (peer: string, reason: string) => void;
  onMessage: (peer: string, data: string, ch: Channel) => void;
}

/** Channel/room names shared by transports and the lobby server (JackID naming; spec said 'jackpit:*'). */
export const NET_APP_ID = 'jackid';
export const BROADCAST_LOBBY = `${NET_APP_ID}:lobby`;
export const broadcastRoom = (roomId: string): string => `${NET_APP_ID}:room:${roomId}`;
export const TRYSTERO_APP_ID = `${NET_APP_ID}-v1`;

// ── Session (TECH_SPEC §6.3). `net/session.ts` implements it and re-exports these types. ─────────
export interface HostOptions {
  name: string; mode: GameMode; max: number /* 2..8 */; password?: string; public: boolean; lateJoin: boolean;
  /** Only listed to people on the host's recent-players list (invite link / room code still works). */
  friendsOnly?: boolean;
}
export type JoinTarget = { via: 'server' | 'tab' | 'p2p'; roomId: string };

export interface Session {
  readonly mode: 'offline' | 'host' | 'client';
  readonly isHost: boolean; readonly online: boolean;
  readonly selfId: PlayerId; readonly hostId: PlayerId;
  readonly room: RoomInfo | null;
  readonly players: ReadonlyMap<PlayerId, PlayerInfo>;
  hostTime(): number;                                    // ms, host clock (offline: performance.now())
  rtt(pid?: PlayerId): number;
  startOffline(): void;
  host(o: HostOptions): Promise<RoomInfo>;
  join(target: JoinTarget, o: { password?: string }): Promise<void>;   // resolves after 'welcome'
  leave(reason?: string): void;
  send(msg: Msg, to?: PlayerId | 'host' | 'all' | 'others', ch?: Channel): void;   // client: always host
  on<T extends Msg['t']>(t: T, fn: (msg: Extract<Msg, { t: T }>, from: PlayerId) => void): () => void;
  kick(pid: PlayerId, reason?: string): void;
  poll(): void;                                          // loop: deliver queued inbound
  flush(dt: number): void;                               // loop: transforms 20 Hz, pings 1 Hz
  /** Shareable link for friends: `<origin>/?join=<ROOMCODE>` (null when not hosting a joinable room). */
  inviteLink(): string | null;
  /**
   * Late-join state for a feature channel (DECISIONS C30). The host calls `get(forPid)` when a player joins
   * (or a machine snapshot is requested) and the joiner's `apply(snap)` restores it. Returns the unsubscribe.
   */
  registerSnapshot(channel: string, get: (forPid: PlayerId) => Json, apply: (snap: Json) => void): Unsub;
}
