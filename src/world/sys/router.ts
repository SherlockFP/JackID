/**
 * Machine router (WORLD-SYS): who sits where, and how machine events travel. TECH_SPEC §3.2 (occupy / release),
 * §6.1 (solo machines are occupant-authoritative, tables host-authoritative), §6.5 + §11.4 (messages).
 *
 * Seating protocol (single player = offline host, so the same code path runs everywhere):
 *   E on a machine → `request` → host `grant` (free seat, not locked, not a ghost, one seat per player) →
 *   `moccOk{seed}` to everyone → every peer `machine._occupy` → the local peer glides the camera in, hands the machine's
 *   sink to the input service and switches to 'machine' mode. Standing up is the mirror image (`mrel` / `mrelOk`).
 *
 * Event traffic: `MachineNet.sendEvent` → `mev` (client → host, host forwards to the others except the sender) ·
 * private events → `mpriv` to exactly one player · table actions → `tact` · refusals → `tnak` · bots → `mbot` ·
 * late-join state → `msnap`. The router also implements `MachineNet` for every machine.
 */
import * as THREE from 'three';
import type { InstanceId, Json, PlayerId, PlayPose } from '@/core/types';
import { botId, isBot } from '@/core/types';
import type { AnyMachine, MachineEnvelope, MachineNet } from '@/machines/_base/types';
import type { MachineSnap } from '@/machines/_base/MachineBase';
import { TableBase } from '@/machines/_base/TableBase';
import type { Session } from '@/net/types';
import type { LocalPlayerHost, SeatOptions } from '@/player/local';
import type { LocalPlayer } from '@/player/types';
import { app } from '@/core/app';
import { hashSeed } from '@/core/rng';
import { has, t } from '@/core/i18n';
import { log } from '@/core/log';
import type { SlotRec } from './slot';

export type SeatDenial = 'busy' | 'locked' | 'ghost' | 'seated' | 'noseat';
export type SeatPhase = 'free' | 'requesting' | 'entering' | 'seated';

const REQUEST_TIMEOUT_S = 4;
const EXIT_DISTANCE = 0.9;
const SOLO_STAND_OFFSET = 0.55;

/** What the router needs from the world. */
export interface RouterHost {
  slot(mid: InstanceId): SlotRec | undefined;
  /** The slot's wing is closed (or the machine type is gated). */
  isClosed(slot: SlotRec): boolean;
  /** A standing body fits here (floor present, nothing solid in the way). */
  clearAt(x: number, y: number, z: number): boolean;
  readonly runSeed: number;
  all(): Iterable<SlotRec>;
}

/** `reason` is set exactly when `ok` is false (this project compiles without strictNullChecks, so no union narrowing). */
interface Grant { ok: boolean; reason?: SeatDenial; seed: number; occ: number }

export class Router {
  private phase_: SeatPhase = 'free';
  private seat_: { mid: InstanceId; seat: number } | null = null;
  private token = 0;
  private cancelTimeout: (() => void) | null = null;
  private readonly occCount = new Map<InstanceId, number>();
  private readonly seatOf = new Map<PlayerId, { mid: InstanceId; seat: number }>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly host: RouterHost) {
    const n = this.net;
    this.offs.push(
      n.on('mocc', (m, from) => this.onMocc(m.mid, m.seat, from)),
      n.on('moccOk', (m) => this.applyGrant(m.mid, m.seat, m.pid, m.seed)),
      n.on('moccNo', (m) => this.onMoccNo(m.mid, m.reason)),
      n.on('mrel', (m, from) => this.onMrel(m.mid, m.seat, from)),
      n.on('mrelOk', (m) => this.applyRelease(m.mid, m.seat, m.pid)),
      n.on('mev', (m, from) => this.onMev(m.e, from)),
      n.on('mpriv', (m) => this.onMpriv(m.mid, m.to, m.seq, m.ev)),
      n.on('tact', (m, from) => this.onTact(m.mid, m.seat, m.rid, m.a, from)),
      n.on('tnak', (m) => this.onTnak(m.reason)),
      n.on('msnap', (m, from) => this.onMsnap(m.mid, m.snap as unknown as MachineSnap, from)),
      n.on('mbot', (m) => this.onMbot(m.mid, m.seat, m.name, m.level)),
    );
  }

  private get net(): Session { return app.net; }
  get phase(): SeatPhase { return this.phase_; }
  /** The local player's seat (set from the moment the grant is applied until standing up). */
  get seat(): { mid: InstanceId; seat: number } | null { return this.seat_; }
  /** The local player is occupied with a machine (requesting, gliding or seated). */
  get busy(): boolean { return this.phase_ !== 'free'; }

  // ── local requests ────────────────────────────────────────────────────────────────────────────
  /** E on a machine. */
  request(mid: InstanceId, seat: number): void {
    if (this.phase_ !== 'free') return;
    if (!app.player) { this.deny('unavailable'); return; }
    const net = this.net;
    if (net.isHost) {
      const g = this.grant(net.selfId, mid, seat);
      if (!g.ok) { this.deny(g.reason); return; }
      net.send({ t: 'moccOk', mid, seat, pid: net.selfId, seed: g.seed, occ: g.occ }, 'others');
      this.applyGrant(mid, seat, net.selfId, g.seed);
      return;
    }
    this.phase_ = 'requesting';
    net.send({ t: 'mocc', mid, seat }, 'host');
    this.cancelTimeout?.();
    this.cancelTimeout = app.timers.ui.after(REQUEST_TIMEOUT_S, () => {
      if (this.phase_ !== 'requesting') return;
      this.phase_ = 'free';
      this.deny('timeout');
    });
  }

  /** Stand up (deferred by the machine while it is busy). */
  standUp(): void {
    const s = this.seat_;
    if (!s) return;
    this.host.slot(s.mid)?.machine?.requestStandUp();
  }

  private deny(reason: SeatDenial | 'timeout' | 'unavailable'): void {
    app.ui.toast(reason === 'unavailable' ? t('world.unavailable') : t(`world.seat.${reason}`), 'warn');
    app.audio.play('buzzer', { vol: 0.5 });
  }

  // ── host-side validation ─────────────────────────────────────────────────────────────────────
  private grant(pid: PlayerId, mid: InstanceId, seat: number): Grant {
    const slot = this.host.slot(mid);
    const m = slot?.machine;
    if (!slot || !m) return { ok: false, reason: 'noseat', seed: 0, occ: 0 };
    if (!Number.isInteger(seat) || seat < 0 || seat >= m.seats.length) return { ok: false, reason: 'noseat', seed: 0, occ: 0 };
    if (slot.locked || m.locked || this.host.isClosed(slot)) return { ok: false, reason: 'locked', seed: 0, occ: 0 };
    if (this.seatOf.has(pid)) return { ok: false, reason: 'seated', seed: 0, occ: 0 };
    if (app.run && !app.run.alive(pid)) return { ok: false, reason: 'ghost', seed: 0, occ: 0 };
    const cur = m.seats[seat];
    if (cur !== null) {
      const ok = isBot(cur) && this.net.isHost && m instanceof TableBase
        && (m as { canTakeBotSeat?: (s: number, p: PlayerId) => boolean }).canTakeBotSeat?.(seat, pid) === true;
      if (!ok) return { ok: false, reason: 'busy', seed: 0, occ: 0 };
      (m as TableBase<any, any, any, any>).removeBot(seat);
    }
    const occ = (this.occCount.get(mid) ?? 0) + 1;
    this.occCount.set(mid, occ);
    return { ok: true, seed: hashSeed(this.host.runSeed, mid, occ), occ };
  }

  private onMocc(mid: InstanceId, seat: number, from: PlayerId): void {
    if (!this.net.isHost) return;
    const g = this.grant(from, mid, seat);
    if (!g.ok) { this.net.send({ t: 'moccNo', mid, reason: g.reason }, from); return; }
    this.net.send({ t: 'moccOk', mid, seat, pid: from, seed: g.seed, occ: g.occ }, 'others');
    this.applyGrant(mid, seat, from, g.seed);
  }

  private onMoccNo(mid: InstanceId, reason: SeatDenial): void {
    void mid;
    if (this.phase_ !== 'requesting') return;
    this.cancelTimeout?.(); this.cancelTimeout = null;
    this.phase_ = 'free';
    this.deny(reason);
  }

  private onMrel(mid: InstanceId, seat: number, from: PlayerId): void {
    if (!this.net.isHost) return;
    const m = this.host.slot(mid)?.machine;
    if (!m || m.seats[seat] !== from) return;
    this.net.send({ t: 'mrelOk', mid, seat, pid: from }, 'others');
    this.applyRelease(mid, seat, from);
  }

  // ── applying decisions (every peer) ──────────────────────────────────────────────────────────
  private applyGrant(mid: InstanceId, seat: number, pid: PlayerId, seed: number): void {
    const slot = this.host.slot(mid);
    const m = slot?.machine;
    if (!slot || !m || m.seats[seat] === pid) return;
    this.seatOf.set(pid, { mid, seat });
    const local = pid === this.net.selfId;
    m._occupy(pid, seat, seed, local);
    if (local) void this.beginLocal(slot, m, seat);
  }

  private applyRelease(mid: InstanceId, seat: number, pid: PlayerId): void {
    const m = this.host.slot(mid)?.machine;
    const cur = this.seatOf.get(pid);
    if (cur && cur.mid === mid && cur.seat === seat) this.seatOf.delete(pid);
    if (!m || m.seats[seat] !== pid) return;
    const local = pid === this.net.selfId;
    m._release(pid, seat, local);
    if (local) this.endLocal();
  }

  // ── local player: camera, input, sink ────────────────────────────────────────────────────────
  private async beginLocal(slot: SlotRec, m: AnyMachine, seat: number): Promise<void> {
    const player = app.player as (LocalPlayer & Partial<LocalPlayerHost>) | null;
    if (!player) { log.warn('world', 'seated without a local player'); return; }
    const my = ++this.token;
    this.cancelTimeout?.(); this.cancelTimeout = null;
    this.phase_ = 'entering';
    this.seat_ = { mid: m.id, seat };
    app.ui.prompt(null);
    app.audio.play('seat', { vol: 0.7 });
    const { pose, opts } = this.rig(slot, m, seat);
    slot.group.updateMatrixWorld(true);
    await (player as LocalPlayerHost).enterMachine(m.id, seat, pose, slot.group.matrixWorld, opts);
    if (my !== this.token || this.phase_ !== 'entering') return;
    app.input.setMachineSink(m.sink);
    app.input.setMode('machine');
    this.phase_ = 'seated';
  }

  private endLocal(): void {
    if (this.phase_ === 'free') return;
    this.token++;
    this.cancelTimeout?.(); this.cancelTimeout = null;
    this.phase_ = 'free';
    this.seat_ = null;
    app.audio.play('seat', { vol: 0.5, pitch: 3 });
    app.input.setMachineSink(null);
    app.input.setMode('walk');
    void app.player?.exitMachine();
  }

  /** Camera pose + body placement for a seat. */
  private rig(slot: SlotRec, m: AnyMachine, seat: number): { pose: PlayPose; opts: SeatOptions } {
    const model = m.model;
    const sd = model.seats?.[seat];
    const pose = sd?.pose ?? model.playPose;
    const itz = model.interact.max[2];
    const standLocal = sd?.stand ?? new THREE.Vector3(0, 0, itz + SOLO_STAND_OFFSET);
    const y = slot.def.pos[1];
    const stand = slot.toWorld(standLocal).setY(y);
    const opts: SeatOptions = { stand, sit: sd?.avatar === 'sit' };
    const exit = this.exitPoint(slot, m, standLocal, !!sd);
    if (exit) opts.exit = exit;
    return { pose, opts };
  }

  /** First stand-up spot that is free: the model's `stand` anchor, 0.9 m in front / outward, else the pre-seat position. */
  private exitPoint(slot: SlotRec, m: AnyMachine, standLocal: THREE.Vector3, table: boolean): THREE.Vector3 | null {
    const y = slot.def.pos[1];
    const candidates: THREE.Vector3[] = [];
    const anchor = m.model.anchors.stand;
    if (anchor) {
      slot.group.updateMatrixWorld(true);
      candidates.push(anchor.getWorldPosition(new THREE.Vector3()).setY(y));
    }
    if (table) {
      const ib = m.model.interact;
      const cx = (ib.min[0] + ib.max[0]) / 2, cz = (ib.min[2] + ib.max[2]) / 2;
      const dx = standLocal.x - cx, dz = standLocal.z - cz;
      const len = Math.hypot(dx, dz) || 1;
      for (const k of [EXIT_DISTANCE, EXIT_DISTANCE + 0.5]) {
        candidates.push(slot.toWorld(new THREE.Vector3(standLocal.x + (dx / len) * k, 0, standLocal.z + (dz / len) * k)).setY(y));
      }
    } else {
      const z = m.model.interact.max[2] + EXIT_DISTANCE;
      candidates.push(slot.toWorld([0, 0, z]).setY(y), slot.toWorld([0.6, 0, z]).setY(y), slot.toWorld([-0.6, 0, z]).setY(y));
    }
    return candidates.find((c) => this.host.clearAt(c.x, c.y, c.z)) ?? null;
  }

  // ── machine networking ───────────────────────────────────────────────────────────────────────
  /** The `MachineNet` handed to a machine's context. */
  netFor(slot: SlotRec): MachineNet {
    const router = this;
    return {
      get selfId() { return router.net.selfId; },
      get isHost() { return router.net.isHost; },
      get online() { return router.net.online; },
      sendEvent(env) {
        const n = router.net;
        if (!n.online) return;
        n.send({ t: 'mev', e: env }, n.isHost ? 'others' : 'host');
      },
      sendPrivate(to, env) {
        const n = router.net;
        if (!n.isHost || isBot(to) || to === n.selfId) return;
        n.send({ t: 'mpriv', mid: env.mid, to, seq: env.seq, ev: env.ev }, to);
      },
      sendAction(mid, seat, rid, a) { router.net.send({ t: 'tact', mid, seat, rid, a }, 'host'); },
      sendNak(to, mid, rid, reason) { router.net.send({ t: 'tnak', mid, rid, reason }, to); },
      requestRelease(mid, seat) { router.requestRelease(mid, seat); },
      announceBot(mid, seat, name, level) { router.net.send({ t: 'mbot', mid, seat, name, level }, 'others'); },
      playerName(pid) {
        if (isBot(pid)) {
          const bots = (slot.machine as { bots?: Array<{ seat: number; name: string }> } | null)?.bots;
          return bots?.find((b) => botId(b.seat) === pid)?.name ?? '';
        }
        return router.net.players.get(pid)?.name ?? '';
      },
      playerColor(pid) { return router.net.players.get(pid)?.color ?? 0xb8b8b8; },
      hostTime() { return router.net.hostTime(); },
      players() {
        const n = router.net;
        return [...n.players.keys()].filter((p) => p > 0).sort((a, b) => (a === n.hostId ? -1 : b === n.hostId ? 1 : a - b));
      },
    };
  }

  /** `MachineNet.requestRelease`: the host grants at once, a client asks the host. */
  requestRelease(mid: InstanceId, seat: number): void {
    const n = this.net;
    const m = this.host.slot(mid)?.machine;
    if (!m || m.seats[seat] !== n.selfId) return;
    if (n.isHost) {
      n.send({ t: 'mrelOk', mid, seat, pid: n.selfId }, 'others');
      this.applyRelease(mid, seat, n.selfId);
    } else n.send({ t: 'mrel', mid, seat }, 'host');
  }

  private onMev(env: MachineEnvelope, from: PlayerId): void {
    const m = this.host.slot(env.mid)?.machine;
    if (!m) return;
    const n = this.net;
    if (n.isHost) {
      // solo machines: only the occupant may speak for them; tables emit on the host alone
      if (m.def.shared || env.pid !== from || !m.seats.includes(from)) { log.warn('world', `dropped mev for ${env.mid} from ${from}`); return; }
      m._receive(env);
      for (const pid of n.players.keys()) if (pid !== from && pid !== n.selfId) n.send({ t: 'mev', e: env }, pid);
    } else m._receive(env);
  }

  private onMpriv(mid: InstanceId, to: PlayerId, seq: number, ev: MachineEnvelope['ev']): void {
    const m = this.host.slot(mid)?.machine;
    if (!m || to !== this.net.selfId) return;
    m._receive({ mid, seq, pid: this.net.hostId, ev, to, t: this.net.hostTime() });
  }

  private onTact(mid: InstanceId, seat: number, rid: number, a: Json, from: PlayerId): void {
    if (!this.net.isHost) return;
    const m = this.host.slot(mid)?.machine;
    if (m instanceof TableBase) m._receiveAction(from, seat, rid, a);
  }

  private onTnak(reason: string): void {
    app.ui.toast(has(reason) ? t(reason) : t('world.unavailable'), 'warn');
  }

  private onMsnap(mid: InstanceId, snap: MachineSnap, from: PlayerId): void {
    this.host.slot(mid)?.machine?._restore(snap, from);
  }

  private onMbot(mid: InstanceId, seat: number, name: string | null, level?: number): void {
    const m = this.host.slot(mid)?.machine;
    if (m instanceof TableBase) m._setBot(seat, name, level);
  }

  // ── late join, drops, teardown ───────────────────────────────────────────────────────────────
  /** `[mid, seat, pid]` for every human seat (the `welcome.occ` list). */
  occupancy(): Array<[InstanceId, number, PlayerId]> {
    const out: Array<[InstanceId, number, PlayerId]> = [];
    for (const [pid, s] of this.seatOf) out.push([s.mid, s.seat, pid]);
    return out;
  }

  /** Late join: mirror the host's occupancy without running any local seating. */
  applyOccupancy(list: ReadonlyArray<readonly [InstanceId, number, PlayerId]>): void {
    for (const [mid, seat, pid] of list) {
      const m = this.host.slot(mid)?.machine;
      if (!m || m.seats[seat] === pid || pid === this.net.selfId) continue;
      this.seatOf.set(pid, { mid, seat });
      m._occupy(pid, seat, 0, false);
    }
  }

  /** Bots sitting at tables (`[mid, seat, name, level]`) for the late joiner. */
  bots(): Array<[InstanceId, number, string, number]> {
    const out: Array<[InstanceId, number, string, number]> = [];
    for (const slot of this.host.all()) {
      const m = slot.machine;
      if (m instanceof TableBase) for (const b of m.bots) out.push([slot.id, b.seat, b.name, b.level]);
    }
    return out;
  }

  snapshotOf(mid: InstanceId, forPid?: PlayerId): MachineSnap | null {
    const m = this.host.slot(mid)?.machine;
    if (!m) return null;
    const s = m._snapshot(forPid);
    return s.s === null && s.r === 0 && s.q === 0 ? null : s;
  }

  applySnapshot(mid: InstanceId, snap: MachineSnap, from?: PlayerId): void {
    this.host.slot(mid)?.machine?._restore(snap, from);
  }

  /** A player left: free their seat for everyone. */
  dropPlayer(pid: PlayerId): void {
    const s = this.seatOf.get(pid);
    if (!s) return;
    if (this.net.isHost) this.net.send({ t: 'mrelOk', mid: s.mid, seat: s.seat, pid }, 'others');
    this.applyRelease(s.mid, s.seat, pid);
  }

  /** The machine is going away (removed, locked, disposed): everyone stands up. */
  releaseAll(mid: InstanceId): void {
    const m = this.host.slot(mid)?.machine;
    if (!m) return;
    m.seats.forEach((pid, seat) => {
      if (pid === null) return;
      if (isBot(pid)) { if (m instanceof TableBase) m.removeBot(seat); return; }
      if (this.net.isHost) this.net.send({ t: 'mrelOk', mid, seat, pid }, 'others');
      this.applyRelease(mid, seat, pid);
    });
  }

  dispose(): void {
    for (const o of this.offs.splice(0)) o();
    this.cancelTimeout?.();
    if (this.phase_ !== 'free') {
      this.token++;
      this.phase_ = 'free';
      this.seat_ = null;
      app.input.setMachineSink(null);
      app.ui.machineHud(null);
    }
    this.seatOf.clear();
  }
}
