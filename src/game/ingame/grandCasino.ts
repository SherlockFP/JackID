/**
 * THE GRAND CASINO (wave 75): the props that show this run. The jackpot wall lists the four biggest wins (machine and coins), and
 * it flashes on a big win and up. The light show runs at each Night's start and on a jackpot. The prize case shows the Ticket
 * prizes; there is no prize shop yet, so it shows three labelled placeholders.
 *
 * Every prop is optional (bench rooms have none), so each call is guarded and a missing prop does nothing.
 */
import { bus } from '@/core/events';
import { fmtCoins, t } from '@/core/i18n';
import type { Unsub } from '@/core/types';
import { machineName } from '@/game/progression';
import type { DebtRun, GrandWin } from '@/game/run';
import { WIN_TIERS, type WinTier } from '@/game/types';
import type { JackpotWallProp, LightShowProp, PrizeCaseProp, World } from '@/world/types';

/** The first tier that flashes the jackpot wall. */
export const GRAND_FLASH_TIER: WinTier = 'big';

/** Placeholder prize labels until a prize shop exists (`grand.prize.placeholder.<n>`). */
export const PLACEHOLDER_PRIZE_IDS = [1, 2, 3] as const;

/** The prize case labels: the placeholders, translated. */
export function prizeLabels(): string[] {
  return PLACEHOLDER_PRIZE_IDS.map((n) => t(`grand.prize.placeholder.${n}`));
}

/** The jackpot wall lines: one per win, the machine name and the coins, largest first. */
export function wallLines(wins: readonly GrandWin[]): string[] {
  return wins.map((w) => `${machineName(w.machineId)}  ${fmtCoins(w.amount)}`);
}

/** Wires the grand casino props to the run. Returns the unsubscribe. */
export function startGrandCasino(run: DebtRun, world: World): Unsub {
  const wall = world.prop<JackpotWallProp>('jackpotWall');
  const cases = world.prop<PrizeCaseProp>('prizeCase');
  const show = world.prop<LightShowProp>('lightShow');
  const refreshWall = (): void => { wall?.setLines(wallLines(run.grandWins())); };
  refreshWall();
  cases?.setPrizes(prizeLabels());
  const offs: Unsub[] = [
    bus.on('machine:result', (e) => {
      if (!(e.credited > e.bet)) return;   // only a win can change the four biggest
      refreshWall();
      if (WIN_TIERS.indexOf(e.tier) < WIN_TIERS.indexOf(GRAND_FLASH_TIER)) return;
      void wall?.flash();
      if (e.tier === 'jackpot') show?.lightShow();
    }),
    bus.on('night:begin', () => { show?.lightShow(); }),
  ];
  return () => { for (const off of offs) off(); };
}
