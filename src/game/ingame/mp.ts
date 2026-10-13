/**
 * Online hooks for the Debt Run session (`params.online`). Owned by MP-UI; `session.ts` calls `startOnlineHooks` only when
 * the run is online, so single-player never touches this file.
 *  - Remote avatars: one `createAvatarManager` mannequin per other player, fed by `pts` (20 Hz, interpolated in avatars.ts).
 *  - Own pose: `pt` to the host at 20 Hz (the host re-broadcasts it in `pts`).
 *  - Emotes: `emote` from others plays on their avatar.
 *  - Shared co-op quota: the host sends the shift quota as an `rdelta` about once a second and answers late joiners through
 *    the 'coop' snapshot channel; clients keep `sharedQuota` for the HUD.
 *  - Run end from the host: clients follow the `end` message to the Results state.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import type { Json, PlayerId, Unsub } from '@/core/types';
import type { PlayerInfo } from '@/net/protocol';
import { createAvatarManager, type AvatarManagerHost } from '@/player/avatars';
import { playerFlags } from '@/player/flags';
import type { LocalPlayerHost } from '@/player/local';
import type { DebtRun } from '@/game/run';
import type { QuotaState } from '@/game/shift.types';

export interface OnlineHooks {
  fixedUpdate(dt: number): void;
  frame(dt: number): void;
  dispose(): void;
  /** Co-op quota as the host last sent it (null until the first update, and always null on the host). */
  readonly sharedQuota: () => Readonly<QuotaState> | null;
}

const POSE_PERIOD = 1 / 20;
const QUOTA_PERIOD = 1;
const COOP_CHANNEL = 'coop';

export function startOnlineHooks(scene: THREE.Scene, player: LocalPlayerHost, run: DebtRun): OnlineHooks {
  const net = app.net;
  const avatars: AvatarManagerHost = createAvatarManager();
  scene.add(avatars.root);
  const offs: Unsub[] = [];
  let seq = 0;
  let poseAcc = 0;
  let quotaAcc = 0;
  let quota: Readonly<QuotaState> | null = null;
  let ended = false;
  const isHost = net.isHost;

  const addPeer = (p: PlayerInfo): void => {
    if (p.id !== net.selfId) avatars.add(p.id as PlayerId, p.name, p.color);
  };
  for (const p of net.players.values()) addPeer(p);

  offs.push(net.on('pjoin', (m) => addPeer(m.p)));
  offs.push(net.on('pupd', (m) => {
    const cur = avatars.get(m.id);
    if (cur && m.patch.name) cur.setName(m.patch.name, m.patch.color ?? net.players.get(m.id)?.color ?? 0xffffff);
  }));
  offs.push(net.on('pleave', (m) => avatars.remove(m.id)));
  offs.push(net.on('pts', (m) => {
    for (const [id, x, y, z, yaw, pitch, f] of m.a) {
      if (id === net.selfId) continue;
      avatars.sample(id, m.s, [x, y, z], yaw, pitch, f);
    }
  }));
  offs.push(net.on('emote', (m, from) => {
    avatars.get(m.from ?? from)?.emote(m.id);
  }));
  offs.push(net.on('rdelta', (m) => {
    if (!isHost && m.d.quota) quota = m.d.quota;
  }));
  offs.push(net.on('end', (m) => {
    if (isHost || ended) return;
    ended = true;
    void app.go('results', { summary: m.summary });
  }));

  // Late joiners get the current co-op quota with their welcome snapshot.
  const unregister = net.registerSnapshot(COOP_CHANNEL,
    () => ({ quota: run.shift.quota() as unknown as Json }),
    (snap) => {
      const q = (snap as { quota?: unknown } | null)?.quota;
      if (q && typeof q === 'object') quota = q as QuotaState;
    });
  offs.push(unregister);

  const sendPose = (): void => {
    const p = player.pos;
    const yaw = player.yaw;
    const pitch = player.pitch;
    seq += 1;
    const f = playerFlags(player);
    if (isHost) {
      net.send({ t: 'pts', s: seq, a: [[net.selfId, p.x, p.y, p.z, yaw, pitch, f]] }, 'others', 'unrel');
    } else {
      net.send({ t: 'pt', s: seq, p: [p.x, p.y, p.z], r: [yaw, pitch], f }, 'host', 'unrel');
    }
  };

  // Host-side quota broadcast (everyone else sees it through rdelta).
  const sendQuota = (): void => {
    if (!isHost) return;
    const q = { ...run.shift.quota() } as QuotaState;
    net.send({ t: 'rdelta', d: { quota: q } }, 'others');
  };

  return {
    fixedUpdate() {},
    frame(dt) {
      avatars.update(dt, net.hostTime());
      poseAcc += dt;
      if (poseAcc >= POSE_PERIOD) {
        poseAcc = 0;
        sendPose();
      }
      quotaAcc += dt;
      if (quotaAcc >= QUOTA_PERIOD) {
        quotaAcc = 0;
        sendQuota();
      }
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      avatars.clear();
      avatars.dispose();
      scene.remove(avatars.root);
    },
    sharedQuota: () => (isHost ? null : quota),
  };
}
