/**
 * Stamp levels for visuals. The run's StampBook (game/stamps.ts) registers a reader here; machines and the world read the
 * levels from this core module because a machine may not import game code as a value (TECH_SPEC §1.1).
 * `gild[SYMBOL]` is 0..3 (Gild: the symbol pays more), `shift[SYMBOL]` 0..3 (the symbol lands more often), `etch[PATTERN]` 0..4
 * (the pattern multiplier is higher). Without a book every map is empty: read with `?? 0`.
 */
export interface StampLevelsView {
  gild: Record<string, number>;
  shift: Record<string, number>;
  etch: Record<string, number>;
  /** Stamps owned (levels summed) and the cap. */
  total: number;
  cap: number;
}

let source: (() => StampLevelsView) | null = null;

/** The run registers (or clears with null) the function that reads its book. */
export function setStampLevelsSource(fn: (() => StampLevelsView) | null): void {
  source = fn;
}

/** The levels of the active book, or an empty view when there is none. Cheap: read once per frame or paint pass, never per cell. */
export function getStampLevels(): StampLevelsView {
  return source ? source() : { gild: {}, shift: {}, etch: {}, total: 0, cap: 0 };
}
