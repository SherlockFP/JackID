/**
 * ACHIEVEMENTS, Xbox style: 31 of them (THE LAST GAME joined in wave 106) worth 1000 gamerscore in all. The rules listen to the bus (they never touch the run) and write
 * the profile save (`save.data.achievements`, a list of ids), not the run. An unlock emits `achievement:unlock`; the toast and the page
 * are DOM (src/game/achievements.ui.ts). Names and texts: `ach.<id>.name` / `ach.<id>.desc` in achievements.strings.ts.
 *
 * Only a Debt Run earns them, and a CHEATED run earns none (src/game/cheats.ts: the KONSOL mark). Secret ones show as ??? until unlocked.
 *
 * shortcut: the per-run counters (Loki touched, the seal to win back) live in memory, so a reload mid-run forgets them. The no-Loki
 * check also asks the run for Ink 0; upgrade by saving them in the run's ext when run.ts is free to take a slice.
 */
import { bus } from '@/core/events';
import type { SaveStore } from '@/core/save';
import { BOND_IDS } from '@/game/bonds';
import { clearCheated, isCheated } from '@/game/cheats';
import { CORE_MACHINES } from '@/game/progression';
import { OWNERS, type GodId } from '@/game/pantheon';

declare module '@/core/events' {
  interface GameEvents {
    /** An achievement unlocked (`g` is its gamerscore). The toast listens. */
    'achievement:unlock': { id: string; g: number };
    /** Open the ACHIEVEMENTS page (the settings screen's button; the page listens). */
    'achievements:open': Record<string, never>;
  }
}

/** Pixel icons the page and the toast draw (a subset of widgets.IconName). */
export type AchIcon = 'coin' | 'ticket' | 'check' | 'bell' | 'star' | 'curse';
export interface AchDef { id: string; g: number; icon: AchIcon; secret?: true }

const ENDINGS = ['kept_pair', 'cold_kitchen', 'alone', 'chair', 'kept', 'paid_in_full', 'he_came_home', 'descend', 'fall', 'last_game'] as const;
const ENDING_G: Readonly<Record<(typeof ENDINGS)[number], number>> = {
  kept_pair: 100, cold_kitchen: 60, alone: 10, chair: 25, kept: 25, paid_in_full: 25, he_came_home: 30, descend: 30, fall: 10, last_game: 50,
};

export const ACHIEVEMENTS: readonly AchDef[] = [
  { id: 'first_win', g: 5, icon: 'coin' },
  { id: 'first_jackpot', g: 20, icon: 'coin' },
  { id: 'night1', g: 10, icon: 'bell' },
  { id: 'night5', g: 25, icon: 'bell' },
  { id: 'night8', g: 65, icon: 'bell' },
  ...ENDINGS.map((e): AchDef => ({ id: `end_${e}`, g: ENDING_G[e], icon: 'star' })),
  { id: 'loki_lie', g: 15, icon: 'curse' },
  { id: 'no_loki', g: 75, icon: 'curse' },
  ...BOND_IDS.map((b): AchDef => ({ id: `bond_${b}`, g: 20, icon: 'check' })),
  { id: 'all_machines', g: 75, icon: 'ticket' },
  { id: 'seal_back', g: 40, icon: 'star' },
  { id: 'four_gods', g: 75, icon: 'star' },
  { id: 'five_boons', g: 30, icon: 'star' },
  { id: 'broke', g: 10, icon: 'coin', secret: true },
  { id: 'wrong_call', g: 10, icon: 'curse', secret: true },
  { id: 'hollow', g: 40, icon: 'curse', secret: true },
];
const BY_ID: ReadonlyMap<string, AchDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const GAMERSCORE_TOTAL = ACHIEVEMENTS.reduce((n, a) => n + a.g, 0);
export const achievementDef = (id: string): AchDef | undefined => BY_ID.get(id);
/** Gamerscore of a list of unlocked ids (unknown ids count for nothing). */
export const gamerscore = (ids: Iterable<string>): number => { let n = 0; for (const id of new Set(ids)) n += BY_ID.get(id)?.g ?? 0; return n; };

/** The run side the rules read (the DebtRun fits). */
export interface AchRun {
  readonly seed: number;
  readonly mode: string;
  readonly selfId: number;
  wallet(): number;
  boons?(): readonly string[];
  boonFavour?(god: GodId): number;
  jokerInk?(): number;
}
export interface AchHost {
  save: Pick<SaveStore, 'data' | 'update'>;
  run(): AchRun | null;
}

const NIGHT_NO_LOKI = 6;
const BOONS_GOAL = 5;
const FAVOUR_GOAL = 3;
const BOND_GOAL = 3;

export function mountAchievements(host: AchHost): () => void {
  const { save } = host;
  let lokiTouched = false;
  let sealTarget = 0;   // seals the card had before the first loss it has not won back yet

  /** The run that may earn: a Debt Run that has not taken a cheat. */
  const live = (): AchRun | null => {
    const r = host.run();
    return r && r.mode === 'debt' && !isCheated(save, r.seed) ? r : null;
  };
  const grant = (id: string): void => {
    const def = BY_ID.get(id);
    if (!def || !live() || save.data.achievements.includes(id)) return;
    save.update((d) => { d.achievements.push(id); });
    bus.emit('achievement:unlock', { id, g: def.g });
  };
  const mine = (pid: number): AchRun | null => { const r = live(); return r && pid === r.selfId ? r : null; };
  const reset = (): void => { lokiTouched = false; sealTarget = 0; };
  const gods = (): void => {
    const r = live();
    if (r && OWNERS.every((g) => (r.boonFavour?.(g) ?? 0) >= FAVOUR_GOAL)) grant('four_gods');
  };

  const offs = [
    bus.on('machine:round', (e) => {
      if (!mine(e.pid)) return;
      const key = `machine:${e.machineId}`;
      save.update((d) => { d.codex[key] = (d.codex[key] ?? 0) + 1; });   // the bestiary's own count
      if (CORE_MACHINES.every((m) => (save.data.codex[`machine:${m}`] ?? 0) > 0)) grant('all_machines');
    }),
    bus.on('machine:result', (e) => {
      const r = mine(e.pid);
      if (!r) return;
      if (e.tier !== 'none' && e.tier !== 'push') grant('first_win');
      if (e.tier === 'jackpot') grant('first_jackpot');
      if (e.credited <= 0 && r.wallet() <= 0) grant('broke');
    }),
    bus.on('jackpot:win', (e) => { if (mine(e.pid)) grant('first_jackpot'); }),
    bus.on('quota:met', (e) => { if (e.index === 0) grant('night1'); }),
    bus.on('night:begin', (e) => {
      if (e.night <= 1) reset();
      if (e.night >= 5) grant('night5');
      if (e.night >= 8) grant('night8');
      const r = live();
      if (r && e.night >= NIGHT_NO_LOKI && !lokiTouched && (r.jokerInk?.() ?? 0) === 0) grant('no_loki');
      gods();
    }),
    bus.on('joker:ink', (e) => { if (e.delta > 0) lokiTouched = true; }),
    bus.on('joker:takeover', () => { lokiTouched = true; }),
    bus.on('joker:call', (e) => {
      lokiTouched = true;
      grant(e.right ? 'loki_lie' : 'wrong_call');
    }),
    bus.on('bond:change', (e) => { if (e.to >= BOND_GOAL) grant(`bond_${e.who}`); }),
    bus.on('run:boon', (e) => {
      if (e.state !== 'picked' && e.state !== 'auto') return;
      if ((live()?.boons?.().length ?? 0) >= BOONS_GOAL) grant('five_boons');
      gods();
    }),
    bus.on('shrine:favour', gods),
    bus.on('omen:fire', (e) => { if (e.kind === 'weeping') gods(); }),
    bus.on('quota:overshoot', gods),
    // a seal lost at a short Dawn or at a duel, then the card is whole again
    bus.on('quota:sealed', (e) => { sealTarget = Math.max(sealTarget, e.left + 1); }),
    bus.on('duel:marks', (e) => {
      if (e.lost) sealTarget = Math.max(sealTarget, e.left + 1);
      else if (sealTarget > 0 && e.left >= sealTarget) { sealTarget = 0; grant('seal_back'); }
    }),
    bus.on('hollow:enter', () => grant('hollow')),
    bus.on('run:end', ({ summary }) => {
      if (summary.endingId && (ENDINGS as readonly string[]).includes(summary.endingId)) grant(`end_${summary.endingId}`);
      reset();
      clearCheated(save);   // after the grants above: the mark belongs to this run alone
    }),
  ];
  return () => { for (const o of offs) o(); };
}
