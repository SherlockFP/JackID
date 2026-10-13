/**
 * App state machine types (TD-owned). Contract: TECH_SPEC §1.5.
 *
 *           ┌──────────── quit / error ────────────┐
 * Boot ──▶ Menu ──(Play SP / Free SP)──▶ InGame ──(run end)──▶ Results ──▶ Menu
 *           │ ▲                            ▲  │                    │
 *   host/join│ │leave                 start│  │quit               │ back to lobby (MP)
 *           ▼ │                            │  ▼                    ▼
 *           Lobby ────────────(host Start)─┘ Menu                Lobby
 *
 * `app.go(to, params)` awaits `current.exit(to)` then `next.enter(params, from)`; emits `'app:state'`.
 * Transitions are serialized (a `go()` during a `go()` is queued). Paused is an overlay flag, not a state.
 */
import type { GameMode, MachineId } from './types';
import type { RunConfig, RunSnapshot, RunSummary } from '@/net/protocol';

export type AppStateId = 'boot' | 'menu' | 'lobby' | 'ingame' | 'results';

export interface InGameParams {
  mode: GameMode; seed: number; online: boolean;
  bench?: MachineId;                     // ?bench mode: single slot test room
  resume?: RunSnapshot;                  // SP continue
  config?: Partial<RunConfig>;           // from lobby (MP), or the SP start kit
}

export interface StateParams {
  boot: undefined;
  menu: { toast?: string } | undefined;
  lobby: { role: 'host' | 'client' };
  ingame: InGameParams;
  results: { summary: RunSummary };
}

export interface AppStateHandler<K extends AppStateId = AppStateId> {
  enter(params: StateParams[K], from: AppStateId): Promise<void> | void;
  exit(to: AppStateId): Promise<void> | void;
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;      // must call app.renderer.render(...)
}
