/**
 * "Is tonight already paid?" for the Debt Terminal, the Intermission hint and the stale-quota fixes.
 *
 * After Dawn the run keeps the OLD Night's `quota.due` (and a small carry-over in `deposited`) until OPEN THE FLOOR, so
 * `quota.met` reads false and every "SHORT n" line is stale. The run knows (`nightDone`); when it exposes a boolean
 * `nightPaid` getter (see the WIRING note) that wins. Otherwise the answer is tracked here from the phase stream: a
 * Night is paid when Dawn (`collection`) ends in `intermission` having seen the quota met. Poll it every frame/tick.
 * Pure logic over `RunApi`: no DOM, no three.
 */
import type { RunApi } from '@/game/types';

interface Track { phase: string; night: number; met: boolean; paid: boolean }
const tracks = new WeakMap<object, Track>();

/** True from the moment Dawn pays the Night until OPEN THE FLOOR starts the next one. */
export function nightPaid(run: RunApi): boolean {
  const flag = (run as { nightPaid?: unknown }).nightPaid;
  if (typeof flag === 'boolean') return flag;
  const phase = run.shift?.phase;
  if (!phase) return false;
  const night = run.night();
  let tr = tracks.get(run);
  if (!tr) { tr = { phase, night, met: false, paid: false }; tracks.set(run, tr); }
  if (phase === 'collection') tr.met = !!run.shift.quota()?.met;
  if (night !== tr.night) tr.paid = false;                     // OPEN THE FLOOR: a new Night, a new quota
  else if (phase !== tr.phase) tr.paid = phase === 'intermission' && tr.phase === 'collection' && tr.met;
  tr.phase = phase;
  tr.night = night;
  return tr.paid;
}
