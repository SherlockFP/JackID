/**
 * Bench "force" registry (QA harness, DEV only in practice). A machine module can register its debug-force handler
 * here at import time, so the bench (`window.jackid.bench.force('<machineId>:<state>')`, driven by
 * `scripts/qa/bench.mjs --force`) can put a seated machine into a state where a new decision is offered
 * (e.g. Big One after a win → CHASE). No MachineBase change is needed.
 *
 *   import { registerDebugForce } from '@/core/debugForce';
 *   registerDebugForce('bigone', (state) => { ...; return true; });
 *
 * A machine that already implements the optional `debugForce(state)` method (MachineBase, bench panel) also works;
 * the registry wins when both exist. Handlers return `true` when they accepted the state, `false` otherwise.
 */

export type DebugForceFn = (state: string) => boolean;

const handlers = new Map<string, DebugForceFn>();

/** Registers (or replaces) the debug-force handler for machine `machineId`. */
export function registerDebugForce(machineId: string, fn: DebugForceFn): void {
  handlers.set(machineId, fn);
}

/** The registered handler for `machineId`, if any. */
export function debugForceFor(machineId: string): DebugForceFn | undefined {
  return handlers.get(machineId);
}
