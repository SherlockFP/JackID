// Helpers for the lobby server: ids, hashing, sanitizers, rate limiting.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

// TECH alphabet (DECISIONS Q8): no I/O/0/1.
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MODES = new Set(['debt', 'coop', 'versus', 'free']);

export function roomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return s;
}

export function peerId() {
  return randomBytes(8).toString('hex');
}

export function hostToken() {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export function sha256hex(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// 1..max printable chars, trimmed. Anything else becomes the fallback.
export function cleanText(v, max = 24, fallback = '') {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, '').trim();
  if (!s) return fallback;
  return Array.from(s).slice(0, max).join('');
}

export function cleanInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function cleanHex(v, len) {
  if (typeof v !== 'string' || v.length !== len || !/^[0-9a-f]+$/i.test(v)) return null;
  return v.toLowerCase();
}

// Fixed-window counter: allow `limit` events per `windowMs`.
export class WindowLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.start = 0;
    this.count = 0;
  }
  // Returns true when the event is allowed.
  take(now = Date.now()) {
    if (now - this.start >= this.windowMs) {
      this.start = now;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.limit;
  }
}

// Per-socket message limiter. Excess messages are dropped; if violations last
// `sustainMs` continuously the caller should close the socket (1008).
export class MessageLimiter {
  constructor(perSecond = 120, sustainMs = 5000) {
    this.win = new WindowLimiter(perSecond, 1000);
    this.sustainMs = sustainMs;
    this.violatingSince = 0;
  }
  // Returns 'ok' | 'drop' | 'kick'
  check(now = Date.now()) {
    if (this.win.take(now)) {
      this.violatingSince = 0;
      return 'ok';
    }
    if (!this.violatingSince) this.violatingSince = now;
    return now - this.violatingSince >= this.sustainMs ? 'kick' : 'drop';
  }
}
