/**
 * Hotline booth — pure rules (devices-core). No three, kit or DOM. GDD §5.1 (ring 20 s): 1.0 s on / 0.7 s off,
 * answer with the handset, choose 1 / 2 / 3 within 8 s, otherwise the call is declined. Whether a call exists, what
 * it says and what each choice does are the game's (game-hotline). This file only times the booth.
 */
import type { PlayerId } from '@/core/types';

export const RING_ON_S = 1.0;
export const RING_OFF_S = 0.7;
export const RING_TOTAL_S = 20;
/** The Collector rescue call (empty pocket) rings this long: mirrors `RESCUE_RING_MIN` in `game/rescue.ts` (a machine may not import game code). */
export const RESCUE_RING_S = 30;
export const ANSWER_S = 15;
export const MAX_CHOICES = 3;

const CYCLE_S = RING_ON_S + RING_OFF_S;

/** Seconds the phone rings: the 20 s base plus `x.phone.ringTime` (Tin Whistle, Bell upgrades), kept sane. */
export function ringTotal(folded: number): number {
  return Number.isFinite(folded) ? Math.min(40, Math.max(4, folded)) : RING_TOTAL_S;
}

/** Ringing state `elapsed` seconds after `ringingSince`: lamp on/off, and whether the phone still rings at all. */
export function ringState(elapsed: number, total = RING_TOTAL_S): { ringing: boolean; on: boolean } {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= total) return { ringing: false, on: false };
  return { ringing: true, on: (elapsed % CYCLE_S) < RING_ON_S };
}

/** One offer of the call: `PhoneCallState.options[i]` is "<i18n key>|k=v|k=v" (the game's deal key and its numbers). */
export interface ParsedOption { key: string; vars: Record<string, string | number> }
export function parseOption(opt: string): ParsedOption {
  const [key = '', ...rest] = opt.split('|');
  const vars: Record<string, string | number> = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 1) continue;
    const raw = p.slice(i + 1);
    vars[p.slice(0, i)] = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return { key, vars };
}

/** Resolves vars whose value is written '@key' (an i18n key) with `tr`, so a deal can name a charm in the viewer's language. */
export function resolveVars(vars: Record<string, string | number>, tr: (k: string) => string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === 'string' && v.startsWith('@') ? tr(v.slice(1)) : v;
  return out;
}

/** The three lines of one offer, as i18n keys: title, boon (what you get) and price (what it costs). */
export function offerKeys(key: string): { name: string; boon: string; cost: string } {
  return { name: `${key}.name`, boon: `${key}.boon`, cost: `${key}.cost` };
}

/** Index of the ring cycle that just started (0 = first ring). Used to fire the bell once per ring. */
export function ringIndex(elapsed: number): number {
  return Math.floor(Math.max(0, elapsed) / CYCLE_S);
}

/** Maps a choice key to its 0-based option index, or -1 when the key is not a choice. */
export function choiceFromAction(action: string): number {
  switch (action) {
    case 'n1': return 0;
    case 'n2': return 1;
    case 'n3': return 2;
    default: return -1;
  }
}

/** How many choices the player actually gets: the first three options of the call. */
export function choiceCount(options: readonly string[]): number {
  return Math.min(MAX_CHOICES, options.length);
}

/** A call addressed to `target` (0 = anyone on the line) can be answered by `selfId`. */
export function canAnswer(target: PlayerId, selfId: PlayerId): boolean {
  return target === 0 || target === selfId;
}

/** Seconds left to choose, from the host time the answer started. */
export function choiceSecondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/** Nixie target text: `all` (the localised ALL) for the whole line, "P<n>" for one player. */
export function targetLabel(target: PlayerId, all: string): string {
  return target === 0 ? all : `P${Math.abs(target) % 100}`;
}
