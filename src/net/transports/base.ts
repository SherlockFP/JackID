/**
 * Shared base for the concrete transports (NET-TRANSPORT). Handlers are plain fields so the session can attach them
 * before `start()`, which keeps early inbound frames from being lost.
 */
import type { Channel, Transport, TransportKind } from '../types';

export const HOST_PEER = 'host';

export function randomId(bytes = 8): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`net: ${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export abstract class TransportBase implements Transport {
  abstract readonly kind: TransportKind;
  readonly role: 'host' | 'client';
  onPeerOpen: (peer: string) => void = () => {};
  onPeerClose: (peer: string, reason: string) => void = () => {};
  onMessage: (peer: string, data: string, ch: Channel) => void = () => {};

  constructor(role: 'host' | 'client') { this.role = role; }

  abstract start(): Promise<void>;
  abstract send(peer: string, data: string, ch: Channel): void;
  disconnect(_peer: string, _reason?: string): void {}
  close(): void {}
  rtt(_peer: string): number | undefined { return undefined; }
}
