/**
 * Clock sync against the host (NET-SESSION). NTP-style: a client sends `ping{a}` at local time `a`, the host
 * answers `pong{a,b}` with its own clock `b`. For each sample the offset is `b + rtt/2 - received`. The sample with
 * the lowest RTT of the last 8 wins, because it has the least queueing noise. Offline and host sessions use
 * `performance.now()` directly and never call this.
 */
export class ClockSync {
  private readonly ring: Array<{ rtt: number; off: number }> = [];
  private offset = 0;
  private rttMs = 0;
  private has = false;

  /** `sentAt` and `recvAt` are local `performance.now()` values; `hostTime` is the host clock at reply time. */
  sample(sentAt: number, hostTime: number, recvAt: number): void {
    const rtt = recvAt - sentAt;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5000 || !Number.isFinite(hostTime)) return;
    this.ring.push({ rtt, off: hostTime + rtt / 2 - recvAt });
    if (this.ring.length > 8) this.ring.shift();
    let best = this.ring[0];
    for (const s of this.ring) if (s.rtt < best.rtt) best = s;
    this.offset = best.off;
    this.rttMs = best.rtt;
    this.has = true;
  }

  /** Local clock to host clock (ms). Before the first sample it is the best guess: no offset. */
  toHost(local: number): number { return local + this.offset; }
  toLocal(host: number): number { return host - this.offset; }
  get synced(): boolean { return this.has; }
  get rtt(): number { return this.rttMs; }
  reset(): void { this.ring.length = 0; this.offset = 0; this.rttMs = 0; this.has = false; }
}
