/** Lobby-side run settings and host-form defaults. Pure data: no DOM, no three. */
import type { GameMode } from '@/core/types';
import type { RunConfig } from '@/net/protocol';
import { BASE_RUN_NIGHTS, START } from '@/game/data/schedule';

/** Modes a multiplayer room can run (solo Debt Run is not hosted). */
export const MP_MODES: readonly GameMode[] = ['coop', 'versus', 'free'];
export const MP_MAX_MIN = 2;
export const MP_MAX_MAX = 8;
export const ROOM_NAME_MAX = 24;
export const CHAT_MAX = 120;
export const CHAT_LINES = 40;

/** A fresh run config for a room. The host may tune it later; the start message carries the final one. */
export function defaultRunConfig(mode: GameMode): RunConfig {
  return {
    startWallet: START.pocket,
    deadlines: BASE_RUN_NIGHTS,
    difficulty: 'normal',
    friendlyGive: true,
    realtimeShift: true,
    shiftSeconds: 360,
    sharedBank: mode === 'coop',
    botFill: true,
  };
}

/** Deterministic seed for a room's run. The host derives it, so no Math.random is involved. */
export function roomSeed(roomId: string, stamp: number, salt: string): number {
  let h = 0x811c9dc5;
  const s = `${roomId}|${stamp}|${salt}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
