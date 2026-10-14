/**
 * Late-bound link between the run (game layer) and the presentation layer (Wave 25 integrator). The run must not import
 * UI modules, so the one thing it needs from them, "is a duel presentation (cut-in, dialogue, reveal) still on screen?",
 * is a probe the boot code installs. Without a probe (tests, headless runs) the presentation counts as idle.
 */
let probe: () => boolean = () => true

/** Boot: `setPresentationProbe(() => !mangaBusy())`. Returns a disposer. */
export function setPresentationProbe(fn: () => boolean): () => void {
  probe = fn
  return () => { if (probe === fn) probe = () => true }
}

/** True when no duel presentation is on screen. */
export function presentationIdle(): boolean {
  try { return probe() } catch { return true }
}
