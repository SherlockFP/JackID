/**
 * The run's Hollow Door, as machines see it. The world registers a getter when the door module loads, so a machine
 * (lordstable) reads and picks the Lord without importing `@/world/hollow` as a value (TECH_SPEC §1.1).
 * Null when no run door exists (bench rooms, or before a world is built).
 */
import type { LordId } from '@/game/hollow/rules';

export interface HollowDoorLink {
  readonly lord: LordId | null;
  choose(lord: LordId): unknown;
}

let getLink: (() => HollowDoorLink | null) | null = null;

/** Registers the live door getter. The world calls this once, at module load. */
export function bindHollowDoorLink(get: () => HollowDoorLink | null): void {
  getLink = get;
}

/** The live door for this run, or null. */
export function hollowDoorLink(): HollowDoorLink | null {
  return getLink ? getLink() : null;
}
