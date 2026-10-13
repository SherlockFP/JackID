/**
 * Frame codec (NET-SESSION). JSON text, one message per frame. Reliable frames over 15 000 chars are split into
 * `frag` parts of 8 000 chars; the receiver reassembles them per peer. Unreliable messages (`pt`, `pts`) are never split.
 * Decoding is defensive: oversize, malformed or half-received frames are dropped, never thrown.
 */
import { UNRELIABLE, type Msg } from './protocol';

export const FRAG_THRESHOLD = 15000;
export const FRAG_SIZE = 8000;
/** Hard cap on one raw frame (the lobby server also refuses 64 KB). */
export const MAX_FRAME = 64 * 1024;
const MAX_PARTIAL = 16;
const PARTIAL_TTL_MS = 10000;

let fragSeq = 1;

/** Encodes one message into one or more raw frames. */
export function encodeMsg(msg: Msg): string[] {
  const s = JSON.stringify(msg);
  if (s.length <= FRAG_THRESHOLD || UNRELIABLE.has(msg.t)) return [s];
  const id = fragSeq;
  fragSeq = (fragSeq % 0x7fffffff) + 1;
  const n = Math.ceil(s.length / FRAG_SIZE);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(JSON.stringify({ t: 'frag', id, i, n, d: s.slice(i * FRAG_SIZE, (i + 1) * FRAG_SIZE) }));
  }
  return out;
}

interface Partial { n: number; got: number; parts: string[]; at: number }

/** Per-peer reassembly state. */
export class Reassembler {
  private readonly partial = new Map<number, Partial>();

  /** Returns a complete message, or null while still waiting for parts (or on a bad frame). */
  push(raw: string, now: number): Msg | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FRAME) return null;
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch { return null; }
    if (!isRecord(obj) || typeof obj.t !== 'string') return null;
    if (obj.t !== 'frag') return obj as unknown as Msg;
    return this.part(obj, now);
  }

  private part(o: Record<string, unknown>, now: number): Msg | null {
    const id = o.id, i = o.i, n = o.n, d = o.d;
    if (!Number.isInteger(id) || !Number.isInteger(i) || !Number.isInteger(n) || typeof d !== 'string') return null;
    const idN = id as number, iN = i as number, nN = n as number;
    if (nN < 2 || nN > 64 || iN < 0 || iN >= nN) return null;
    this.expire(now);
    let e = this.partial.get(idN);
    if (!e) {
      if (this.partial.size >= MAX_PARTIAL) return null;
      e = { n: nN, got: 0, parts: new Array<string>(nN), at: now };
      this.partial.set(idN, e);
    }
    if (e.n !== nN || e.parts[iN] !== undefined) return null;
    e.parts[iN] = d;
    e.got++;
    if (e.got < e.n) return null;
    this.partial.delete(idN);
    const text = e.parts.join('');
    if (text.length > MAX_FRAME * 4) return null;
    try {
      const full: unknown = JSON.parse(text);
      if (!isRecord(full) || typeof full.t !== 'string' || full.t === 'frag') return null;
      return full as unknown as Msg;
    } catch {
      return null;
    }
  }

  private expire(now: number): void {
    for (const [id, e] of this.partial) if (now - e.at > PARTIAL_TTL_MS) this.partial.delete(id);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
