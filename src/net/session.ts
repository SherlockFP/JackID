/**
 * STUB — owned by NET-SESSION. OFFLINE host only: `mode 'offline'`, `isHost`, selfId 1, `hostTime()` =
 * `performance.now()`, loopback delivery for messages addressed to ourselves, no transports.
 * `host()` / `join()` reject until the real implementation lands (transports hub, hello/welcome,
 * clock sync, replication, late-join snapshots, rate limits — TECH_SPEC §6).
 * Keep the type re-export: the spec's import path is `@/net/session`.
 */
import type { Json, PlayerId } from '@/core/types';
import type { Msg, PlayerInfo } from './protocol';
import type { Session } from './types';

export type { HostOptions, JoinTarget, Session } from './types';

export interface LocalProfile { id: string; name: string; color: number }

export function createSession(profile: () => LocalProfile): Session {
  const selfId: PlayerId = 1;
  const players = new Map<PlayerId, PlayerInfo>();
  const handlers = new Map<string, Set<(msg: never, from: PlayerId) => void>>();
  let inbox: Array<{ msg: Msg; from: PlayerId }> = [];
  const snapshots = new Map<string, { get: (forPid: PlayerId) => Json; apply: (snap: Json) => void }>();

  const syncSelf = (): void => {
    const p = profile();
    players.set(selfId, { id: selfId, cid: p.id, name: p.name, color: p.color, host: true, ready: true, state: 'alive', ping: 0 });
  };
  syncSelf();

  const session: Session = {
    mode: 'offline',
    isHost: true,
    online: false,
    selfId,
    hostId: selfId,
    room: null,
    players,
    hostTime: () => performance.now(),
    rtt: () => 0,
    startOffline() { syncSelf(); },
    host: () => Promise.reject(new Error('net: hosting is not implemented yet (NET-SESSION work package)')),
    join: () => Promise.reject(new Error('net: joining is not implemented yet (NET-SESSION work package)')),
    leave() {},
    send(msg, to) { if (to === selfId) inbox.push({ msg, from: selfId }); },
    on(t, fn) {
      let set = handlers.get(t);
      if (!set) { set = new Set(); handlers.set(t, set); }
      set.add(fn as never);
      return () => { set!.delete(fn as never); };
    },
    kick() {},
    poll() {
      if (inbox.length === 0) return;
      const q = inbox; inbox = [];
      for (const { msg, from } of q) handlers.get(msg.t)?.forEach((fn) => fn(msg as never, from));
    },
    flush() {},
    inviteLink: () => null,
    registerSnapshot(channel, get, apply) {
      snapshots.set(channel, { get, apply });
      return () => { if (snapshots.get(channel)?.apply === apply) snapshots.delete(channel); };
    },
  };
  return session;
}
