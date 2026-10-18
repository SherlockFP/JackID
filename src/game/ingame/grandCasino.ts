/**
 * THE GRAND CASINO (wave 75): the props that show this run. The jackpot wall lists the four biggest wins (machine and coins), and
 * it flashes on a big win and up. The light show runs at each Night's start and on a jackpot. The prize case shows the Ticket
 * prizes; there is no prize shop yet, so it shows three labelled placeholders.
 *
 * Every prop is optional (bench rooms have none), so each call is guarded and a missing prop does nothing.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { fmtCoins, t } from '@/core/i18n';
import type { Unsub } from '@/core/types';
import { machineName } from '@/game/progression';
import { singleLightLit } from '@/game/watchEvents';
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

/** SINGLE LIGHT: how dark the floor goes (1 = normal). Calm Mode dims less. */
export const DIM_LEVEL = 0.22;
export const DIM_LEVEL_CALM = 0.5;
const DIM_S = 1.2;

/**
 * SINGLE LIGHT (wave 75): while the event runs the floor lights fall to a low level, except the lit machine's own lights, and
 * they come back when it ends. One call per event edge; Calm Mode dims less and skips the flicker on the way down.
 */
function startSingleLightDim(world: World): Unsub {
  let dimmed = false;
  const dim = (): void => {
    const lit = singleLightLit();
    if (!lit) return;
    const s = app.save?.data?.settings;
    const calm = !!s?.calm;
    dimmed = true;
    world.lights.setLevel('all', calm ? DIM_LEVEL_CALM : DIM_LEVEL, DIM_S);
    for (const m of world.machines()) if (m.def.id === lit) world.lights.setLevel(m.id, 1, DIM_S);
    if (!calm && !s?.reduceFlashing) world.lights.flicker('all', 0.4, 1.6);
  };
  const restore = (): void => {
    if (!dimmed) return;
    dimmed = false;
    world.lights.setLevel('all', 1, DIM_S);
  };
  dim();   // a reload mid-event: the event is already live
  const offs: Unsub[] = [
    bus.on('event:start', ({ id }) => { if (id === 'watch.single_light') dim(); }),
    bus.on('event:end', ({ id }) => { if (id === 'watch.single_light') restore(); }),
  ];
  return () => { for (const off of offs) off(); restore(); };
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
    startSingleLightDim(world),
  ];
  return () => { for (const off of offs) off(); };
}
