/**
 * THE GHOST SEAT (pillar 3 and 6: the House keeps a faint copy of you, and the copy's luck spills over).
 *
 * From Night 2 on, a faint copy of the player sits at the machine kind where the player lost the most the Night before. The copy
 * lost there: every round the player WON on that machine is a round the copy lost. The copy won there: every round the player
 * LOST is a round the copy won. Each time the player sits at that machine and matches one of those rounds (a win while the copy
 * still owes a loss, or a loss while the copy still owes a win), the player gets +1 ŞANS star. The copy's pools are capped at
 * GHOST_POOL per side, and the stars from the copy are capped at GHOST_NIGHT_MAX per Night.
 *
 * "Sits next to it" reads as: any seat of the same machine kind. Pure state only: the run feeds it every settled round
 * (`round`) and calls `beginNight` when a Night starts. Saved under `resume.ext.ghost`.
 */

declare module '@/core/events' {
  interface GameEvents {
    /** A round matched the copy: `star` ŞANS for the luck meter. `side` 'lost': the copy lost it. 'won': the copy won it. */
    'ghost:match': { side: 'lost' | 'won'; machineId: string; mid: string; star: number };
    /** A Night began: the copy's machine and seat (all null when there is no copy tonight). */
    'ghost:seat': { night: number; machineId: string | null; mid: string | null };
  }
}

/** The first Night with a copy at the table. */
export const GHOST_FIRST_NIGHT = 2;
/** The most rounds of each kind the copy can match in a Night (the pool size). */
export const GHOST_POOL = 3;
/** The most ŞANS stars the copy can give in one Night. */
export const GHOST_NIGHT_MAX = 3;

/** One machine kind's record for a Night: rounds the player won and lost there, and the coins lost. */
export interface GhostTally { mid: string; w: number; l: number; lossSum: number }

/** The copy's seat for a Night: the machine kind, the seat of the last loss there, and the pools it still owes. */
export interface GhostSeatInfo {
  night: number;
  machineId: string;
  mid: string;
  /** Rounds the copy still has to lose (matched by a player win). */
  lost: number;
  /** Rounds the copy still has to win (matched by a player loss). */
  won: number;
  /** Stars given so far this Night. */
  stars: number;
}

/** A matched round: the star it gives, and which side of the copy it took. */
export interface GhostMatch { star: number; side: 'lost' | 'won'; machineId: string; mid: string }

export interface GhostSave {
  v: 1;
  night: number;
  /** Tonight's tally (it becomes the next Night's seat), keyed by machine kind. */
  tally: Record<string, GhostTally>;
  seat: GhostSeatInfo | null;
}

export interface GhostSeat {
  /** A Night starts: the last Night's tally picks the copy's machine and pools. Returns the seat (null before Night 2 or with no losses). */
  beginNight(night: number): GhostSeatInfo | null;
  /** The copy's seat for this Night, or null. */
  seat(): GhostSeatInfo | null;
  /** A round settled at `machineId`. `win` is the round's result. Returns the match it made, or null. Always feeds the tally. */
  round(night: number, machineId: string, mid: string, bet: number, credited: number): GhostMatch | null;
  snapshot(): GhostSave;
  restore(s: unknown): void;
}

const toCount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** Picks the copy's machine: the most coins lost there. Ties go to the machine id that sorts first (a fixed order). */
function pickSeat(tally: Record<string, GhostTally>, night: number): GhostSeatInfo | null {
  let best: { machineId: string; t: GhostTally } | null = null;
  for (const machineId of Object.keys(tally).sort()) {
    const t = tally[machineId];
    if (t.l <= 0) continue;
    if (!best || t.lossSum > best.t.lossSum) best = { machineId, t };
  }
  if (!best) return null;
  const lost = Math.min(GHOST_POOL, best.t.w);
  const won = Math.min(GHOST_POOL, best.t.l);
  if (lost <= 0 && won <= 0) return null;
  return { night, machineId: best.machineId, mid: best.t.mid, lost, won, stars: 0 };
}

export function createGhostSeat(): GhostSeat {
  let tally: Record<string, GhostTally> = {};
  let night = 0;
  let seat: GhostSeatInfo | null = null;

  return {
    beginNight(n: number): GhostSeatInfo | null {
      night = n;
      seat = n >= GHOST_FIRST_NIGHT ? pickSeat(tally, n) : null;
      tally = {};
      return seat ? { ...seat } : null;
    },
    seat: (): GhostSeatInfo | null => (seat ? { ...seat } : null),
    round(n, machineId, mid, bet, credited): GhostMatch | null {
      const won = credited > bet;
      let match: GhostMatch | null = null;
      if (seat && seat.night === n && seat.machineId === machineId && seat.stars < GHOST_NIGHT_MAX) {
        if (won && seat.lost > 0) {
          seat.lost -= 1;
          seat.stars += 1;
          match = { star: 1, side: 'lost', machineId, mid };
        } else if (!won && seat.won > 0) {
          seat.won -= 1;
          seat.stars += 1;
          match = { star: 1, side: 'won', machineId, mid };
        }
      }
      const t = tally[machineId] ?? { mid, w: 0, l: 0, lossSum: 0 };
      if (won) t.w += 1;
      else {
        t.l += 1;
        t.lossSum += Math.max(0, bet - credited);
        t.mid = mid;
      }
      tally[machineId] = t;
      return match;
    },
    snapshot(): GhostSave {
      const t: Record<string, GhostTally> = {};
      for (const k of Object.keys(tally)) t[k] = { ...tally[k] };
      return { v: 1, night, tally: t, seat: seat ? { ...seat } : null };
    },
    restore(s: unknown): void {
      const e = s && typeof s === 'object' ? (s as Partial<GhostSave>) : {};
      night = toCount(e.night);
      tally = {};
      const src = e.tally && typeof e.tally === 'object' ? e.tally : {};
      for (const k of Object.keys(src)) {
        const v = (src as Record<string, Partial<GhostTally>>)[k];
        if (!v || typeof v.mid !== 'string') continue;
        tally[k] = { mid: v.mid, w: toCount(v.w), l: toCount(v.l), lossSum: toCount(v.lossSum) };
      }
      const s2 = e.seat && typeof e.seat === 'object' ? (e.seat as Partial<GhostSeatInfo>) : null;
      seat = s2 && typeof s2.machineId === 'string' && typeof s2.mid === 'string'
        ? {
          night: toCount(s2.night), machineId: s2.machineId, mid: s2.mid,
          lost: Math.min(GHOST_POOL, toCount(s2.lost)), won: Math.min(GHOST_POOL, toCount(s2.won)),
          stars: Math.min(GHOST_NIGHT_MAX, toCount(s2.stars)),
        }
        : null;
    },
  };
}
