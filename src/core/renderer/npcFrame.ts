/**
 * Per-frame uniforms shared by every dark NPC material (kit `patchNpc`, w72 npc lane). Lives in core so the renderer can
 * drive it and the kit can read it (core must not import kit). One object per uniform: a single write reaches every program.
 *  - `uNpcT`: integer shimmer step, floor(simTime × rate). Sim time, so a paused game does not shimmer.
 *  - `uNpcShimmer`: shimmer amount. 0 in Calm Mode; a quarter with reduced flashing (steps at 2 Hz, not 8).
 */
export const npcFrame = { uNpcT: { value: 0 }, uNpcShimmer: { value: 0 } };

export function setNpcFrame(simTime: number, o: { calm: boolean; reduced: boolean }): void {
  npcFrame.uNpcShimmer.value = o.calm ? 0 : o.reduced ? 0.35 : 1;
  npcFrame.uNpcT.value = Math.floor(simTime * (o.reduced ? 2 : 8));
}
