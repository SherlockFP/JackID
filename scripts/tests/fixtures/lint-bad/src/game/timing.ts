/** Fixture: gameplay code using real timers and the wall clock. */
export function later(fn: () => void): number {
  setTimeout(fn, 10);
  return Date.now();
}
