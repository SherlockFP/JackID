/** Joining rooms: one target, or a typed room code tried over server → same browser → global (3 s each, DECISIONS C5). */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import type { JoinTarget } from '@/net/types';

/** `answered`: the room itself refused (full, password, version, started, kicked), so other transports would refuse too. */
export interface JoinResult { ok: boolean; reason: string; answered: boolean }

/** Room codes use the TECH alphabet: no I, O, 0 or 1 (DECISIONS Q8). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const DENY_RE: ReadonlyArray<[RegExp, string]> = [
  [/full/i, 'mp.deny.full'],
  [/password/i, 'mp.deny.password'],
  [/version/i, 'mp.deny.version'],
  [/started/i, 'mp.deny.started'],
  [/kick/i, 'mp.deny.kicked'],
];

export function normaliseCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}
export const isRoomCode = (code: string): boolean => CODE_RE.test(code);

/** Join one listed room. Resolves after the host's `welcome`; the caller then moves to the lobby. */
export async function joinTarget(target: JoinTarget, password?: string): Promise<JoinResult> {
  try {
    await app.net.join(target, password ? { password } : {});
    return { ok: true, reason: '', answered: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hit = DENY_RE.find(([re]) => re.test(msg));
    return { ok: false, reason: t(hit ? hit[1] : 'mp.deny.none'), answered: hit !== undefined };
  }
}

/** Join by typed code: the lobby server first, then same-browser tabs, then the global transport. */
export async function joinByCode(rawCode: string, password?: string): Promise<JoinResult> {
  const code = normaliseCode(rawCode);
  if (!isRoomCode(code)) return { ok: false, reason: t('mp.join.failed', { code: rawCode.trim() || '?' }), answered: false };
  let last: JoinResult = { ok: false, reason: t('mp.join.failed', { code }), answered: false };
  for (const via of ['server', 'tab', 'p2p'] as const) {
    const r = await joinTarget({ via, roomId: code }, password);
    if (r.ok || r.answered) return r;
    last = r;
  }
  return last;
}
