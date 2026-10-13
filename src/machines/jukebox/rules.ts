/**
 * Jukebox (`jukebox`, system) — pure rules, no three, kit or DOM (devices-lobby lane). GDD §6.9, BRIEF ADDENDUM 4.
 *
 * The song list is the music engine's catalogue (`audio.music.catalog()`); this file only decides what a play costs,
 * whether a song is open, and which buff it leaves behind. Coins never move here. Tickets and buffs go through
 * `RunApi` (`spend`, `buffs.add`, `addDread`), so the same code runs offline and as the online host.
 *
 * Rules: one song at a time (a new song replaces the old one's buff) · 1 Ticket per play · a song you already hear
 * costs nothing to stop · locked songs (cassette / win unlocks) show a padlock and refuse.
 */
import type { PlayerId } from '@/core/types';
import type { JukeboxTrack } from '@/core/audio/types';
import type { RunApi } from '@/game/types';

/** Tickets per play (GDD §6.9). */
export const SONG_PRICE = 1;
/** Buff prefix: the buff id of song `x` is `song.x` (GDD §3.8.2). */
export const SONG_BUFF_PREFIX = 'song.';
/** Songs on the list (GDD 6.9: twelve). The grid is 3 × 4. */
export const SONG_COLS = 3;

/** Extra per-song effects that the buff itself does not carry (applied once, on play). Unlisted songs have none. */
export const SONG_ON_PLAY: Readonly<Record<string, { dread?: number }>> = {
  carnival_of_teeth: { dread: 5 },
  lullaby_for_mannequins: { dread: -10 },
};

export interface SongRow {
  track: JukeboxTrack;
  index: number;
  /** Cassette / win unlock not earned yet. */
  locked: boolean;
  /** This is the song the house is playing right now. */
  playing: boolean;
}

export const songBuffId = (trackId: string): string => `${SONG_BUFF_PREFIX}${trackId}`;

/** Stat key the game raises when an unlock is earned (`run.stat('unlock.<key>', 1)`). Cassettes: `cassette:<trackId>`. */
export const unlockStat = (unlock: string): string => `unlock.${unlock}`;

/** A track is open when it has no unlock or the run has earned it. */
export function isOpen(track: JukeboxTrack, run: RunApi): boolean {
  return !track.unlock || run.stat(unlockStat(track.unlock)) > 0;
}

/** Full song list with lock and playing flags, in catalogue order. */
export function songRows(catalog: readonly JukeboxTrack[], run: RunApi, current: string | null): SongRow[] {
  return catalog.map((track, index) => ({ track, index, locked: !isOpen(track, run), playing: track.id === current }));
}

/** Cursor step over `n` songs in a grid of `SONG_COLS` columns. Wraps horizontally, clamps vertically. */
export function moveCursor(i: number, n: number, dx: number, dy: number): number {
  if (n <= 0) return 0;
  if (dx !== 0) return (i + dx + n) % n;
  const next = i + dy * SONG_COLS;
  return next < 0 || next >= n ? i : next;
}

export type PlayCheck = 'ok' | 'stop' | 'locked' | 'funds' | 'none';

/**
 * What pressing a song does. `stop` = the same song is already playing: free, it just turns the box off.
 * The caller checks this first, then applies `playEffects` in the credit step.
 */
export function playCheck(row: SongRow | null, run: RunApi, pid: PlayerId): PlayCheck {
  if (!row) return 'none';
  if (row.playing) return 'stop';
  if (row.locked) return 'locked';
  if (run.balance('ticket', pid) < SONG_PRICE) return 'funds';
  return 'ok';
}

/**
 * Applies a play: charges the Ticket, swaps the song buff (drops every other `song.*` buff this player holds) and
 * adds the new one for the rest of the Watch. Returns false when the Ticket spend is refused.
 */
export function applyPlay(run: RunApi, pid: PlayerId, track: JukeboxTrack): boolean {
  if (!run.spend('ticket', SONG_PRICE, 'jukebox', pid)) return false;
  for (const s of run.buffs.list({ pid })) {
    if (s.id.startsWith(SONG_BUFF_PREFIX) && s.id !== songBuffId(track.id)) run.buffs.remove(s.id, { pid });
  }
  run.buffs.add(songBuffId(track.id), { pid, source: { kind: 'machine', id: 'jukebox' } });
  const fx = SONG_ON_PLAY[track.id];
  if (fx?.dread) run.addDread(fx.dread, `jukebox:${track.id}`);
  return true;
}

/** Turns the buff off (the box is stopped, or the Watch is over). */
export function clearSong(run: RunApi, pid: PlayerId): void {
  for (const s of run.buffs.list({ pid })) if (s.id.startsWith(SONG_BUFF_PREFIX)) run.buffs.remove(s.id, { pid });
}

/** The song id this player currently has on (buff), or null. */
export function activeSong(run: RunApi, pid: PlayerId): string | null {
  const s = run.buffs.list({ pid }).find((b) => b.id.startsWith(SONG_BUFF_PREFIX));
  return s ? s.id.slice(SONG_BUFF_PREFIX.length) : null;
}
