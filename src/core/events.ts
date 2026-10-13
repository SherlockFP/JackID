/**
 * Typed event bus + the `GameEvents` map (TD-owned). Contract: TECH_SPEC §2.7.
 *
 * Event names are `domain:verb`; machine-private events `m.<id>:<verb>`. Feature folders may add events
 * by declaration merging in their own files (no shared edit):
 *   declare module '@/core/events' { interface GameEvents { 'hotline:choice': { callId: number; choice: number } } }
 * Handlers run synchronously; a throwing handler is caught + logged and never breaks the emitter.
 */
import type { InstanceId, MachineId, PlayerId } from './types';
import type { AppStateId } from './states';
import type { Lang } from './types';
import type { Settings } from './settings';
import type { CutsceneId, CutsceneResult } from './cutscene/types';
import type {
  ActiveEvent, BodyPart, BuffOwnerKey, BuffState, PartStatus, QuotaState, RunWindow, ShiftPhase, WinTier,
} from '@/game/types';
import type { RunSummary } from '@/net/protocol';
import { log } from './log';

type Handler<T> = (p: T) => void;

export class EventBus<M extends object> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  /** Subscribe. Returns the unsubscribe function. */
  on<K extends keyof M>(type: K, fn: (p: M[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) { set = new Set(); this.map.set(type, set); }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }
  once<K extends keyof M>(type: K, fn: (p: M[K]) => void): () => void {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off<K extends keyof M>(type: K, fn: (p: M[K]) => void): void {
    this.map.get(type)?.delete(fn as Handler<never>);
  }
  /** Synchronous. Handlers added during emit run next time; removed ones are skipped. */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.map.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      if (!set.has(fn)) continue;
      try { (fn as Handler<M[K]>)(payload); } catch (e) { log.error('events', String(type), e); }
    }
  }
  clear(): void { this.map.clear(); }
}

export interface GameEvents {
  // ── app / settings ──
  'app:state': { from: AppStateId; to: AppStateId };
  'app:pause': { paused: boolean };
  'settings:changed': { key: keyof Settings };
  'lang:changed': { lang: Lang };
  'input:lock': { locked: boolean };
  // ── players ──
  'player:seat': { pid: PlayerId; mid: InstanceId; seat: number; on: boolean };
  'player:fall': { pid: PlayerId };                 // trapdoor
  'player:ghost': { pid: PlayerId };
  // ── machines / economy ──
  'machine:round': { mid: InstanceId; machineId: MachineId; pid: PlayerId; bet: number };
  'machine:result': { mid: InstanceId; machineId: MachineId; pid: PlayerId; bet: number; gross: number; credited: number; tier: WinTier; tags: string[] };
  'machine:jackpot': { mid: InstanceId; machineId: MachineId; pid: PlayerId; amount: number; pool: string };
  'eco:wallet': { pid: PlayerId; wallet: number; delta: number; reason: string };
  // ── run / shift / quota ──
  'run:window': { window: RunWindow; night: number };   // Watch ↔ Dawn (replaces run:phase, C17)
  'pulls:change': { pid: PlayerId; pulls: number };      // C18
  'run:deadline': { index: number; due: number; seconds: number };
  'run:deposit': { pid: PlayerId; amount: number; paid: number; due: number };
  'run:clock': { remaining: number };               // 1 Hz
  'run:end': { summary: RunSummary };
  'shift:phase': { phase: ShiftPhase; index: number };
  'quota:update': { quota: Readonly<QuotaState> };
  'quota:met': { index: number; ratio: number };
  'quota:failed': { index: number };
  'quota:overshoot': { tier: string; pid: PlayerId };
  'dread:change': { value: number };
  // ── charms / buffs / totems / collateral ──
  'charm:add': { pid: PlayerId; charmId: string };
  'charm:remove': { pid: PlayerId; charmId: string };
  // a charm triggered (HUD flash, tick, pop). tier: 0-based proc strength (tick pitch 1 + 0.06·tier); label: pop text, e.g. '×1.48'
  'charm:proc': { pid: PlayerId; charmId: string; tier?: number; label?: string };
  'buff:add': { owner: BuffOwnerKey; buff: BuffState };
  'buff:remove': { owner: BuffOwnerKey; id: string };
  'totem:place': { uid: string; def: string; owner: PlayerId };
  'totem:pickup': { uid: string; pid: PlayerId };
  'totem:proc': { uid: string; proc: string };
  'collateral:change': { pid: PlayerId; part: BodyPart; status: PartStatus };
  // ── tycoon ──
  'tycoon:buy': { pid: PlayerId; upgrade: string; from: number; to: number; cost: number };
  'tycoon:milestone': { upgrade: string; level: number; feature?: string };
  'tycoon:machine': { pid: PlayerId; instance: InstanceId; machineId: MachineId | null };
  'tycoon:staff': { uid: string; kind: string; instance: InstanceId | null; hired: boolean };
  'tycoon:prestige': { obols: number };
  // ── events / contracts / jackpot ──
  'event:start': { id: string };
  'event:end': { id: string };
  'contract:progress': { uid: string; progress: number; target: number };
  'contract:done': { uid: string };
  'jackpot:change': { pool: string; value: number };
  'jackpot:win': { pool: string; pid: PlayerId; amount: number; mid: InstanceId; machineId: MachineId };
  // ── story ──
  'cutscene:start': { id: CutsceneId };
  'cutscene:end': { id: CutsceneId; result: CutsceneResult };
  /** A local skip request; the net layer turns it into a vote online and calls `forceSkip` when it passes. */
  'cutscene:skip': { id: CutsceneId };
  'jukebox:play': { track: string | null };
  // ── hotline ──
  'phone:ring': { callId: number };
  'phone:end': { callId: number };
  // ── net ──
  'net:status': { status: 'offline' | 'connecting' | 'host' | 'client' | 'lost' };
  'net:peer': { pid: PlayerId; joined: boolean; name: string };
  'chat:msg': { from: PlayerId; text: string; sys: boolean };
}

/** The single bus instance; `app.events` is this same object. */
export const bus = new EventBus<GameEvents>();
