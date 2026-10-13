/**
 * Buff system assembly (BRIEF ADDENDUM 3). The run builds it once and calls `tick` every frame and `onBell` at each
 * Bell. It registers the buff and event providers on the shared modifier pipeline, registers the catalogue and
 * the condition metrics, and listens to the bus for rounds, results and shift end.
 *
 * Wiring the run owns (not this folder): `run.buffs = sys.buffs`, `run.nightEvents = sys.nightEvents`, a call to
 * `sys.tick(dt)` from the run loop, `sys.onBell()` where the Bell rolls, and `sys.onShiftEnd()` if the run does not
 * already fire the bus `shift:phase` 'settle' event.
 */
import type { PlayerId, Unsub } from '@/core/types';
import type { ModProvider } from '@/game/types';
import type { Rng } from '@/core/rng';
import { bus } from '@/core/events';
import { registerStrings } from '@/core/i18n';
import { BUFF_DATA, NIGHT_EVENT_DATA } from '@/game/data/buffs';
import { Buffs, type BuffHost } from './engine';
import { NightEvents } from './events';
import { Streaks } from './streaks';
import { bridgeEventBanners, type EventBannerShow } from './banner';

export { Buffs } from './engine';
export { NightEvents } from './events';
export { Streaks } from './streaks';

/** Co-op radius (metres) that counts a teammate as "near" for friend auras. */
const AURA_RADIUS_M = 3;

export interface BuffSystemHost extends BuffHost {
  readonly rng: Rng;
  /** Teammates within `radius` metres of `pid` (co-op auras). Optional: solo returns 0. */
  nearAllies?(pid: PlayerId, radius: number): number;
}

export interface BuffSystem {
  readonly buffs: Buffs;
  readonly nightEvents: NightEvents;
  readonly streaks: Streaks;
  /** Once per frame, real seconds. */
  tick(dt: number): void;
  /** Host, at each Bell: rolls the nightly event. Returns its id or null. */
  onBell(): string | null;
  /** Shift end: `shift` buffs expire, streaks reset. */
  onShiftEnd(): void;
  dispose(): void;
}

/**
 * Builds the buff, streak and nightly-event systems on the given modifier registry (`run.mods`).
 * `host.run` is only read lazily, so the system can be created before the run is fully constructed.
 */
export function createBuffSystem(
  host: BuffSystemHost,
  mods: { register(p: ModProvider): () => void },
  opts: { banner?: EventBannerShow } = {},
): BuffSystem {
  const buffs = new Buffs(host);
  const nightEvents = new NightEvents(host);
  const streaks = new Streaks(host, buffs);
  const unsubs: Unsub[] = [];

  // catalogue: definitions and their i18n names (buff.<id>.name|desc, event.<id>.name|desc|announce)
  for (const def of BUFF_DATA) {
    unsubs.push(buffs.register(def));
    registerStrings(`buff.${def.id}.`, { en: def.strings.en, tr: def.strings.tr });
  }
  for (const def of NIGHT_EVENT_DATA) {
    unsubs.push(nightEvents.register(def));
    registerStrings(`event.${def.id}.`, { en: def.strings.en, tr: def.strings.tr });
  }

  // condition metrics (BuffCondition.metric) and the aura metric
  unsubs.push(buffs.registerMetric('heat', (_pid, mid) => (mid ? streaks.heat(mid) : 0)));
  unsubs.push(buffs.registerMetric('streak.win', (_pid, mid) => (mid ? streaks.winStreak(mid) : 0)));
  unsubs.push(buffs.registerMetric('streak.loss', (_pid, mid) => (mid ? streaks.lossStreak(mid) : 0)));
  unsubs.push(buffs.registerMetric('ally.near', (pid) => host.nearAllies?.(pid, AURA_RADIUS_M) ?? 0));

  unsubs.push(mods.register(buffs));
  unsubs.push(mods.register(nightEvents));

  // round + result wiring: plays/wins durations, streaks, fire risk
  unsubs.push(bus.on('machine:round', ({ mid, machineId, pid }) => {
    buffs.onRound(pid, mid);
    streaks.onRound(pid, mid, machineId);
  }));
  unsubs.push(bus.on('machine:result', ({ mid, machineId, pid, bet, gross }) => {
    buffs.onResult(pid, mid, gross > 0);
    streaks.onResult(pid, mid, machineId, gross, bet);
  }));
  unsubs.push(bus.on('shift:phase', ({ phase }) => {
    if (phase === 'settle') onShiftEnd();
  }));

  if (opts.banner) unsubs.push(bridgeEventBanners((id) => nightEvents.def(id), opts.banner));

  function onShiftEnd(): void {
    buffs.onShiftEnd();
    nightEvents.onShiftEnd();
    streaks.onShiftEnd();
  }

  return {
    buffs,
    nightEvents,
    streaks,
    tick(dt: number): void {
      buffs.tick(dt);
      streaks.tick(dt);
      nightEvents.tick();
    },
    onBell(): string | null {
      return nightEvents.roll();
    },
    onShiftEnd,
    dispose(): void {
      for (const u of unsubs.splice(0)) u();
    },
  };
}

