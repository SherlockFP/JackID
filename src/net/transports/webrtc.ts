/**
 * WebRTC transport via lobby signalling (NET-TRANSPORT, TECH §6.2). The client creates the offer with two data channels:
 * `rel` (ordered) and `unrel` (unordered, no retransmits). ICE is non-trickle: each side waits for gathering to finish
 * (3 s cap) and sends one SDP that already holds its candidates. That keeps the signalling to one offer and one answer
 * with no candidate-before-offer ordering problem. Both channels must open within `timeoutMs` (8 s) or the client
 * rejects and the caller falls back to the WS relay. The host accepts any number of peers.
 */
import type { Channel, TransportKind } from '../types';
import type { LobbyClient } from '../lobbyClient';
import { HOST_PEER, TransportBase } from './base';

interface Link {
  pc: RTCPeerConnection;
  rel: RTCDataChannel | null;
  unrel: RTCDataChannel | null;
  open: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  settle?: { ok: () => void; fail: (e: Error) => void };
}

export class WebRtcTransport extends TransportBase {
  readonly kind: TransportKind = 'webrtc';
  private readonly lobby: LobbyClient;
  private readonly hostPeer: string;
  private readonly timeoutMs: number;
  private readonly links = new Map<string, Link>();
  private unsubs: Array<() => void> = [];

  constructor(role: 'host' | 'client', lobby: LobbyClient, hostPeer = '', timeoutMs = 8000) {
    super(role);
    this.lobby = lobby;
    this.hostPeer = hostPeer;
    this.timeoutMs = timeoutMs;
  }

  start(): Promise<void> {
    this.unsubs.push(this.lobby.on('signal', (from: unknown, data: unknown) => {
      void this.onSignal(String(from ?? ''), data);
    }));
    this.unsubs.push(this.lobby.on('peerLeave', (peer: unknown) => {
      const p = String(peer ?? '');
      if (this.role === 'host') this.drop(p, 'left');
      else if (p === this.hostPeer) this.drop(HOST_PEER, 'hostLeft');
    }));
    if (this.role === 'host') return Promise.resolve();
    return this.connect();
  }

  send(peer: string, data: string, ch: Channel): void {
    const link = this.links.get(this.role === 'host' ? peer : HOST_PEER);
    if (!link || !link.open) return;
    const useUnrel = ch === 'unrel' && link.unrel?.readyState === 'open';
    const dc = useUnrel ? link.unrel : link.rel;
    if (!dc || dc.readyState !== 'open') return;
    try { dc.send(data); } catch { /* frame too large or channel closing */ }
  }

  disconnect(peer: string, reason = 'kicked'): void { this.drop(peer, reason); }

  close(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const k of [...this.links.keys()]) this.drop(k, 'closed', true);
  }

  // ── client ──
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const link = this.makeLink(HOST_PEER);
      link.settle = {
        ok: resolve,
        fail: (e) => { this.drop(HOST_PEER, 'failed', true); reject(e); },
      };
      link.timer = setTimeout(() => link.settle?.fail(new Error('net: webrtc timed out')), this.timeoutMs);
      link.rel = link.pc.createDataChannel('rel', { ordered: true });
      link.unrel = link.pc.createDataChannel('unrel', { ordered: false, maxRetransmits: 0 });
      this.attach(HOST_PEER, link, link.rel);
      this.attach(HOST_PEER, link, link.unrel);
      void (async () => {
        try {
          const offer = await link.pc.createOffer();
          await link.pc.setLocalDescription(offer);
          await gatherDone(link.pc);
          this.lobby.signal(this.hostPeer, { sdp: link.pc.localDescription?.toJSON() });
        } catch (e) {
          link.settle?.fail(e instanceof Error ? e : new Error(String(e)));
        }
      })();
    });
  }

  // ── host and client signalling ──
  private async onSignal(from: string, data: unknown): Promise<void> {
    if (typeof data !== 'object' || data === null) return;
    const sdp = (data as { sdp?: RTCSessionDescriptionInit }).sdp;
    if (!sdp || typeof sdp.type !== 'string') return;
    if (this.role === 'client') {
      if (from !== this.hostPeer || sdp.type !== 'answer') return;
      const link = this.links.get(HOST_PEER);
      if (!link) return;
      try { await link.pc.setRemoteDescription(sdp); } catch (e) { link.settle?.fail(asError(e)); }
      return;
    }
    if (sdp.type !== 'offer' || !from) return;
    this.drop(from, 'replaced', true);
    const link = this.makeLink(from);
    link.pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      if (dc.label === 'rel') link.rel = dc;
      else if (dc.label === 'unrel') link.unrel = dc;
      else return;
      this.attach(from, link, dc);
    };
    try {
      await link.pc.setRemoteDescription(sdp);
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      await gatherDone(link.pc);
      this.lobby.signal(from, { sdp: link.pc.localDescription?.toJSON() });
    } catch {
      this.drop(from, 'failed', true);
    }
  }

  // ── internals ──
  private makeLink(peer: string): Link {
    const pc = new RTCPeerConnection({ iceServers: [...this.lobby.ice, ...this.lobby.extraIce] });
    const link: Link = { pc, rel: null, unrel: null, open: false, timer: null };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(peer, 'ice', true);
    };
    this.links.set(peer, link);
    return link;
  }

  private attach(peer: string, link: Link, dc: RTCDataChannel): void {
    const ch: Channel = dc.label === 'unrel' ? 'unrel' : 'rel';
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e: MessageEvent<unknown>) => {
      if (typeof e.data === 'string') this.onMessage(peer, e.data, ch);
    };
    dc.onopen = () => this.checkOpen(peer, link);
    dc.onclose = () => this.drop(peer, 'closed');
    if (dc.readyState === 'open') this.checkOpen(peer, link);
  }

  private checkOpen(peer: string, link: Link): void {
    if (link.open || this.links.get(peer) !== link) return;
    if (link.rel?.readyState !== 'open' || link.unrel?.readyState !== 'open') return;
    link.open = true;
    if (link.timer !== null) clearTimeout(link.timer);
    link.timer = null;
    if (link.settle) { link.settle.ok(); link.settle = undefined; }
    if (this.role === 'host') this.onPeerOpen(peer);
  }

  private drop(peer: string, reason: string, silent = false): void {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    if (link.timer !== null) clearTimeout(link.timer);
    try { link.pc.close(); } catch { /* already closed */ }
    if (link.settle) {
      link.settle.fail(new Error(`net: webrtc ${reason}`));
      link.settle = undefined;
    }
    if (link.open && !silent) this.onPeerClose(peer, reason);
  }
}

/** Resolves once ICE gathering completes, or after 3 s. */
function gatherDone(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, 3000);
    function done(): void {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', onState);
      resolve();
    }
    function onState(): void { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', onState);
  });
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
