/**
 * Debt Terminal — pure rules (devices-core). No three, kit or DOM: shared by `index.ts` and any sim.
 * GDD §2.6: deposit keypad (10 % · 25 % · 50 % · ALL · REST · custom digits + Enter), quota breakdown, overpay tiers.
 * Money math lives in the game (`run.deposit`, `run.shift.quota()`); this file only shapes what the player types.
 */

/**
 * Keypad cells in cursor order (3 rows × 3 columns on the panel). Row 0 is the three BIG ACTIONS (wave 27): DEPOSIT and WITHDRAW
 * pick what the amount keys below do, QUOTA shows tonight's quota status (and settles it when it is met). Rows 1-2 are the amount
 * keys: 10 / 25 / 50 % and ALL of the coins the current action can move, REST (deposit: what the quota still needs; withdraw: enough to
 * play on) and ENTER (the typed amount).
 */
export const KEYS = ['dep', 'wd', 'quota', 'p10', 'p25', 'p50', 'all', 'rest', 'enter'] as const;
export type KeyId = (typeof KEYS)[number];
export const KEY_COLS = 3;
export const KEY_ROWS = 3;

/** The terminal's three screens. */
export const MODES = ['dep', 'wd', 'quota'] as const;
export type Mode = (typeof MODES)[number];
/** The mode a cell selects (null for an amount key). */
export function modeOfKey(k: KeyId): Mode | null { return k === 'dep' || k === 'wd' || k === 'quota' ? k : null; }
/** Next / previous mode (wraps). */
export function cycleMode(m: Mode, dir: 1 | -1 = 1): Mode { return MODES[(MODES.indexOf(m) + dir + MODES.length) % MODES.length]; }

/** Coins an armed WITHDRAW "PLAY" key takes: enough for the pulls left at two cheapest bets a pull, minus what the pocket holds. */
export function playNeed(pullsLeft: number, minBet: number, pocket: number): number {
  const pulls = Math.max(3, Math.floor(pullsLeft));
  return Math.max(0, pulls * 2 * Math.max(1, Math.floor(minBet)) - Math.max(0, Math.floor(pocket)));
}

/** Largest custom amount typed on the keypad (12 digits keeps it well inside a safe integer). */
export const MAX_DIGITS = 12;

/** Quota still owed this Night (never negative). */
export function quotaLeft(due: number, deposited: number): number {
  return Math.max(0, Math.floor(due) - Math.floor(deposited));
}

/**
 * Amount a keypad cell deposits from `wallet`. `rest` pays exactly the remaining quota (or the wallet when it is
 * smaller). `enter` is not an amount cell and returns 0 (the caller uses `customAmount`).
 */
export function amountFor(key: KeyId, wallet: number, left: number): number {
  const w = Math.max(0, Math.floor(wallet));
  switch (key) {
    case 'p10': return Math.floor(w * 0.10);
    case 'p25': return Math.floor(w * 0.25);
    case 'p50': return Math.floor(w * 0.50);
    case 'all': return w;
    case 'rest': return Math.min(w, left);
    default: return 0;                       // dep / wd / quota / enter are not amount cells
  }
}

/** Appends one digit to the keypad buffer (no leading zeros, capped at `MAX_DIGITS`). */
export function appendDigit(buf: string, d: number): string {
  if (d < 0 || d > 9 || !Number.isInteger(d)) return buf;
  if (buf.length >= MAX_DIGITS) return buf;
  if (buf === '' && d === 0) return buf;
  return buf + String(d);
}

/** Removes the last digit of the keypad buffer. */
export function backspace(buf: string): string {
  return buf.slice(0, -1);
}

/** Buffer → whole coins, 0 when empty. */
export function customAmount(buf: string): number {
  return buf === '' ? 0 : Number(buf);
}

/**
 * Clamps a requested deposit to what the player can pay. Returns 0 for anything unusable so the caller can
 * refuse with one sound instead of branching.
 */
export function clampDeposit(amount: number, wallet: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(Math.floor(amount), Math.max(0, Math.floor(wallet)));
}

/** Deposit ÷ quota, 0 when no quota is due. */
export function ratioOf(deposited: number, due: number): number {
  return due > 0 ? deposited / due : 0;
}

/** Next overpay tier the player has not reached yet (GDD §2.6.5), or null. */
export function nextTier<T extends { ratio: number }>(tiers: readonly T[], ratio: number): T | null {
  for (const t of [...tiers].sort((a, b) => a.ratio - b.ratio)) if (ratio < t.ratio) return t;
  return null;
}

/** Percent label for a ratio, e.g. 1.25 → "125%". */
export function pct(ratio: number): string {
  return `${Math.floor(ratio * 100)}%`;
}

/** Count-up duration (sim seconds) for a roll of `diff` coins at 60 digits per second, clamped for feel. */
export function rollSeconds(diff: number): number {
  return Math.min(2.2, Math.max(0.25, Math.abs(diff) / 60));
}

/** Shows the coin-stream animation length for a deposit (GDD §2.6.1: 0.6 s). */
export const COIN_STREAM_S = 0.6;

/** Seconds an armed ALL stays armed: the second press within this window confirms the float breach (see `game/float.ts`). */
export const ALL_CONFIRM_SEC = 6;

/** The amount a quick key withdraws from the withdrawable coins (10 / 25 / 50 % / all); REST takes what the pocket needs to play on. */
export function withdrawAmountFor(key: KeyId, room: number, need: number): number {
  const r = Math.max(0, Math.floor(room));
  switch (key) {
    case 'p10': return Math.floor(r * 0.10);
    case 'p25': return Math.floor(r * 0.25);
    case 'p50': return Math.floor(r * 0.50);
    case 'all': return r;
    case 'rest': return Math.min(r, Math.max(0, Math.floor(need)));
    default: return 0;
  }
}
