/**
 * Logging (TD-owned). The only place `console.*` may be used (TECH_SPEC §9.2).
 * `log.debug` compiles away in production builds. Recent lines are kept in a ring buffer for the F3 overlay.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogLine { level: LogLevel; tag: string; msg: string; t: number }

const DEV = !!import.meta.env?.DEV;
const RING = 200;
const ring: LogLine[] = [];
const once = new Set<string>();

function fmt(args: unknown[]): string {
  return args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : safeJson(a))).join(' ');
}
function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
function push(level: LogLevel, tag: string, args: unknown[]): void {
  ring.push({ level, tag, msg: fmt(args), t: performance.now() });
  if (ring.length > RING) ring.shift();
}

export const log = {
  /** Dev-only; stripped from production. */
  debug(tag: string, ...args: unknown[]): void {
    if (!DEV) return;
    push('debug', tag, args);
    console.debug(`[${tag}]`, ...args);
  },
  info(tag: string, ...args: unknown[]): void {
    push('info', tag, args);
    console.info(`[${tag}]`, ...args);
  },
  warn(tag: string, ...args: unknown[]): void {
    push('warn', tag, args);
    console.warn(`[${tag}]`, ...args);
  },
  error(tag: string, ...args: unknown[]): void {
    push('error', tag, args);
    console.error(`[${tag}]`, ...args);
  },
  /** Warn at most once per `key` (missing translations, deprecated calls). */
  warnOnce(key: string, tag: string, ...args: unknown[]): void {
    if (once.has(key)) return;
    once.add(key);
    log.warn(tag, ...args);
  },
  /** Most recent lines, oldest first. */
  recent(): readonly LogLine[] { return ring; },
};
