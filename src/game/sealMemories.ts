/**
 * THE NAME SEALS (docs/BLESSINGS.md §1): the price of a lost seal is a memory from the quiet life before Night 0. The run keeps the
 * ids it has taken (most recent last); the lines live in `run.strings.ts` as `run.mem.<id>.lost` / `run.mem.<id>.back`.
 */
import { hashSeed } from '@/core/rng';

export const SEAL_MEMORIES = ['street', 'song', 'door', 'hello', 'coin', 'wall', 'phone', 'mother'] as const;
export type SealMemory = (typeof SEAL_MEMORIES)[number];

export const isSealMemory = (id: unknown): id is SealMemory => (SEAL_MEMORIES as readonly unknown[]).includes(id);

/** The memory the next lost seal takes: seeded by run seed, Night and what is already gone; never one that is already gone. */
export function nextMemory(lost: readonly string[], seed: number, index: number): SealMemory {
  const left = SEAL_MEMORIES.filter((m) => !lost.includes(m));
  const pool = left.length > 0 ? left : SEAL_MEMORIES;   // all eight gone cannot happen (a run holds three seals); never throw
  return pool[hashSeed('memory', seed, index, lost.length) % pool.length]!;
}
