/**
 * Player pose flags — the `f` field of the `pt` / `pts` transform messages (protocol.ts) and the `flags`
 * argument of `AvatarManager.sample`. 16 bits are plenty; unknown bits must be ignored by readers.
 * NET-SESSION builds the outgoing value with {@link playerFlags}.
 */
import type { LocalPlayer } from './types';

export const PF = {
  CROUCH: 1 << 0,
  SPRINT: 1 << 1,
  /** Seated at / standing at a machine (the avatar plays a machine pose instead of locomotion). */
  SEATED: 1 << 2,
  /** With SEATED: the seat is a stool/chair (Sitting_* clips) rather than a standing position. */
  SIT: 1 << 3,
  GHOST: 1 << 4,
  /** Legs lost: crawling. */
  CRAWL: 1 << 5,
  /** Being carried by a teammate. */
  CARRIED: 1 << 6,
  FALLING: 1 << 7,
  /** Proximity voice active — the nameplate shows the speaking marker. */
  TALK: 1 << 8,
  /** Cutscene / cinematic: the body is hidden for others too. */
  HIDDEN: 1 << 9,
} as const;

/** Optional extras `LocalPlayerHost` exposes beyond the frozen `LocalPlayer`. */
export interface FlagSource { readonly flags?: number }

/** Flags of any `LocalPlayer`; falls back to what the frozen interface reveals when the host extras are absent. */
export function playerFlags(p: LocalPlayer & FlagSource): number {
  if (typeof p.flags === 'number') return p.flags;
  let f = 0;
  if (p.mode === 'seated' || p.mode === 'gliding') f |= PF.SEATED;
  if (p.mode === 'ghost') f |= PF.GHOST;
  if (p.mode === 'crawling') f |= PF.CRAWL;
  if (p.mode === 'carried') f |= PF.CARRIED;
  if (p.mode === 'falling') f |= PF.FALLING;
  if (p.mode === 'cinematic') f |= PF.HIDDEN;
  return f;
}
