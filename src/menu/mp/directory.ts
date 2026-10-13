/**
 * Room directory for the server browser. Rooms come from pluggable sources: the lobby server (`LOBBY`, registered by the
 * net layer through `addRoomSource`) and same-browser tabs (`TAB`, BroadcastChannel announcements on `BROADCAST_LOBBY`).
 * Announcement shape: `{ t: 'ann', room: RoomInfo }`, re-sent about every 2 s; an entry expires 6 s after its last one.
 * Global (Trystero/Nostr) rooms come in through the same `addRoomSource` with `net: 'NOSTR'`.
 */
import { BROADCAST_LOBBY, type JoinTarget } from '@/net/types';
import type { RoomInfo } from '@/net/protocol';

/** `unlisted` rides on RoomPublic from the lobby server (DECISIONS C4) and is not in the frozen RoomInfo type yet. */
export const isUnlisted = (r: RoomInfo): boolean => (r as RoomInfo & { unlisted?: boolean }).unlisted === true;

export type RoomNet = 'LOBBY' | 'TAB' | 'NOSTR';
export interface ListedRoom extends RoomInfo { net: RoomNet; seen: number }
export interface RoomSource { readonly net: RoomNet; list(): Promise<RoomInfo[]> }

const TAB_TTL_MS = 6000;
const sources: RoomSource[] = [];
const tabRooms = new Map<string, { room: RoomInfo; seen: number }>();
let channel: BroadcastChannel | null = null;

/** Register a room source (the lobby client or Trystero). Registering the same `net` twice replaces the old one. */
export function addRoomSource(s: RoomSource): void {
  const i = sources.findIndex((x) => x.net === s.net);
  if (i >= 0) sources[i] = s; else sources.push(s);
}

/** Opens the announcement channel once. Returns true when it was opened by this call (replies need a moment). */
function ensureChannel(): boolean {
  if (channel || typeof BroadcastChannel === 'undefined') return false;
  try {
    channel = new BroadcastChannel(BROADCAST_LOBBY);
    channel.onmessage = (ev: MessageEvent<unknown>) => {
      // Frames are `{ k: 'room', room }` (net/transports/broadcast.ts announceTab).
      const m = ev.data as { k?: string; room?: RoomInfo } | null;
      if (m?.k === 'room' && m.room && typeof m.room.id === 'string') tabRooms.set(m.room.id, { room: m.room, seen: Date.now() });
    };
    channel.postMessage({ k: 'q' });   // ask open hosts to announce now
    return true;
  } catch {
    channel = null;   // private windows and locked-down browsers: the tab source simply stays empty
    return false;
  }
}

/** Every known room, unsorted. Unlisted rooms are never returned (they only join by code). Source errors are skipped. */
export async function listRooms(): Promise<ListedRoom[]> {
  if (ensureChannel()) await new Promise((r) => setTimeout(r, 150));   // first call: let the hosts answer the query
  const now = Date.now();
  for (const [id, e] of tabRooms) if (now - e.seen > TAB_TTL_MS) tabRooms.delete(id);
  const out: ListedRoom[] = [];
  for (const e of tabRooms.values()) {
    if (!isUnlisted(e.room)) out.push({ ...e.room, net: 'TAB', seen: e.seen });
  }
  for (const s of sources) {
    try {
      for (const r of await s.list()) if (!isUnlisted(r)) out.push({ ...r, net: s.net, seen: now });
    } catch {
      // that source is offline right now; the others still list
    }
  }
  return out;
}

/** Join target for a listed room: the transport it was announced on. */
export function targetOf(r: Pick<ListedRoom, 'id' | 'net'>): JoinTarget {
  const via = r.net === 'TAB' ? 'tab' : r.net === 'NOSTR' ? 'p2p' : 'server';
  return { via, roomId: r.id };
}
