/**
 * WS relay transport (NET-TRANSPORT, TECH §6.2). Game frames travel through the lobby socket: the server forwards
 * `relay` ops between a room's host and its members. Reliable only (unreliable traffic is sent on the same
 * reliable path, so transforms run at 10 Hz on this route). Used when WebRTC fails, and for `?net=relay`.
 */
import type { Channel, TransportKind } from '../types';
import type { LobbyClient } from '../lobbyClient';
import { HOST_PEER, TransportBase } from './base';

export class RelayTransport extends TransportBase {
  readonly kind: TransportKind = 'relay';
  private readonly lobby: LobbyClient;
  private readonly hostPeer: string;
  private readonly seen = new Set<string>();
  private readonly muted = new Set<string>();
  private unsubs: Array<() => void> = [];

  constructor(role: 'host' | 'client', lobby: LobbyClient, hostPeer = '') {
    super(role);
    this.lobby = lobby;
    this.hostPeer = hostPeer;
  }

  start(): Promise<void> {
    this.unsubs.push(this.lobby.on('relay', (from: unknown, d: unknown) => {
      const peer = String(from ?? '');
      if (typeof d !== 'string' || this.muted.has(peer)) return;
      if (this.role === 'host') {
        if (!this.seen.has(peer)) {
          this.seen.add(peer);
          this.onPeerOpen(peer);
        }
        this.onMessage(peer, d, 'rel');
      } else if (peer === this.hostPeer) {
        this.onMessage(HOST_PEER, d, 'rel');
      }
    }));
    this.unsubs.push(this.lobby.on('peerLeave', (peer: unknown) => {
      const p = String(peer ?? '');
      if (this.role === 'host' && this.seen.delete(p)) this.onPeerClose(p, 'left');
      if (this.role === 'client' && p === this.hostPeer) this.onPeerClose(HOST_PEER, 'hostLeft');
    }));
    this.unsubs.push(this.lobby.on('roomClosed', () => {
      if (this.role === 'client') this.onPeerClose(HOST_PEER, 'hostLeft');
    }));
    return Promise.resolve();
  }

  send(peer: string, data: string, _ch: Channel): void {
    this.lobby.relay(this.role === 'host' ? peer : this.hostPeer, data);
  }

  disconnect(peer: string): void {
    if (this.role !== 'host') return;
    this.seen.delete(peer);
    this.muted.add(peer);
  }

  close(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.seen.clear();
  }
}
