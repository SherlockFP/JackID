/**
 * Replication helpers (NET-SESSION, DECISIONS C30). Two concerns:
 *  - transforms: the host keeps the latest `pt` per player and broadcasts `pts` at 20 Hz (unreliable);
 *  - late-join snapshots: `registerSnapshot(channel, get, apply)` entries. The host sends each one to a joiner right
 *    after `welcome` as a `snap` message (reliable, so it lands before any live traffic).
 */
import type { Json, PlayerId } from '@/core/types';
import { log } from '@/core/log';

declare module '@/net/protocol' {
  interface MsgMap {
    snap: { t: 'snap'; ch: string; d: Json };
  }
}

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; f: number; s: number; at: number }

export class TransformStore {
  private readonly poses = new Map<PlayerId, Pose>();
  private dirty = false;

  set(pid: PlayerId, p: [number, number, number], r: [number, number], f: number, s: number, at: number): void {
    if (![...p, ...r, f].every(Number.isFinite)) return;
    const prev = this.poses.get(pid);
    if (prev && s < prev.s) return; // out-of-order unreliable packet
    this.poses.set(pid, { x: p[0], y: p[1], z: p[2], yaw: r[0], pitch: r[1], f, s, at });
    this.dirty = true;
  }

  drop(pid: PlayerId): void { this.poses.delete(pid); }

  /** Entries for `pts`: `[id, x, y, z, yaw, pitch, f]`. Poses older than `staleMs` are skipped. */
  collect(now: number, staleMs = 2000): Array<[PlayerId, number, number, number, number, number, number]> {
    const out: Array<[PlayerId, number, number, number, number, number, number]> = [];
    for (const [pid, p] of this.poses) {
      if (now - p.at > staleMs) continue;
      out.push([pid, round(p.x), round(p.y), round(p.z), round(p.yaw), round(p.pitch), round(p.f)]);
    }
    return out;
  }

  /** True once since the last call, when a new `pt` has arrived. */
  takeDirty(): boolean { const d = this.dirty; this.dirty = false; return d; }
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export type SnapGet = (forPid: PlayerId) => Json;
export type SnapApply = (snap: Json) => void;

export class SnapshotRegistry {
  private readonly entries = new Map<string, { get: SnapGet; apply: SnapApply }>();

  register(ch: string, get: SnapGet, apply: SnapApply): () => void {
    this.entries.set(ch, { get, apply });
    return () => { if (this.entries.get(ch)?.apply === apply) this.entries.delete(ch); };
  }

  /** Host side: the snapshots to send to one joiner. */
  forPlayer(pid: PlayerId): Array<{ ch: string; d: Json }> {
    const out: Array<{ ch: string; d: Json }> = [];
    for (const [ch, e] of this.entries) {
      try { out.push({ ch, d: e.get(pid) }); } catch (err) { log.error('[net] snapshot get failed', ch, err); }
    }
    return out;
  }

  /** Client side: apply one received snapshot. Unknown channels are ignored (the feature may not be loaded). */
  apply(ch: string, d: Json): void {
    const e = this.entries.get(ch);
    if (!e) return;
    try { e.apply(d); } catch (err) { log.error('[net] snapshot apply failed', ch, err); }
  }
}
