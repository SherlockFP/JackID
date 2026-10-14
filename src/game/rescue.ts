/**
 * THE RESCUE CALL (wave 13): the pocket hit 0 with Watches left and the quota unmet, so the phone rings with ONE guaranteed
 * deal, the Collector's loan: `coins` now, and `quota` more owed tonight (1.5 x the loan, see `economy.rescueLoan`).
 *
 * It rides the hotline's wire format (a `PhoneCallState` whose option is `hotline.deal.rescue|c=..|q=..`, the same
 * `phone:ring` / `phone:length` / `hotline:result` / `phone:end` events), so the hotline booth shows it with no change. The run
 * merges the two lines: `run.phone()` is the rescue call when one is live, else the hotline's, and `run.answerPhone()` routes to
 * whichever is live. Rescue call ids start at 1e6 so they never collide with the hotline's (which count up from 1).
 *
 * The module owns the call only. The run decides WHEN to ring (`DebtRun.checkRescue`) and applies the loan (`host.take`).
 */
import { bus } from '@/core/events';
import type { PlayerId } from '@/core/types';
import type { PhoneCallState } from '@/net/protocol';
import { ANSWER_SECONDS, RING_SECONDS, dealKey, encodeOption } from '@/game/hotline';
import type { RescueLoan } from '@/game/economy';

export const RESCUE_DEAL = 'rescue';
export const RESCUE_SCRIPT = 'hotline.call.rescue';
const ID_BASE = 1_000_000;

export interface RescueHost {
  selfId: PlayerId;
  /** Host ms clock (the booth measures the ring against it). */
  now(): number;
  /** Ring length in seconds (base 10 s plus `x.phone.ringTime`). */
  ringSeconds(): number;
  /** The loan was taken: pay `loan.coins` now and add `loan.quota` to tonight's quota. */
  take(loan: RescueLoan): void;
}

export interface RescueLine {
  phone(): PhoneCallState | null;
  /** True while a rescue call is live (ringing or picked up). */
  active(): boolean;
  /** Ring the phone with this loan. False when a rescue call is already live. */
  ring(loan: RescueLoan): boolean;
  /** -1 picks up, 0 takes the loan. Returns true when a rescue call was live (the run must not forward the answer). */
  answer(choice: number): boolean;
  tick(dt: number): void;
  /** Hang up (the Watch ended, the run ended). */
  hangUp(): void;
  dispose(): void;
}

/** The rescue call rings at least this long (s): a broke player is usually seated far from the booth. */
const RESCUE_RING_MIN = 30;
interface Call { id: number; ringingSince: number; answeredBy: number | null; loan: RescueLoan; ringLeft: number; answerLeft: number }

export function createRescue(host: RescueHost): RescueLine {
  let seq = 0;
  let call: Call | null = null;
  let view: PhoneCallState | null = null;

  const rebuild = (): void => {
    const c = call;
    view = c ? {
      id: c.id, script: RESCUE_SCRIPT, target: 0, ringingSince: c.ringingSince, answeredBy: c.answeredBy,
      step: c.answeredBy === null ? 0 : 1,
      options: [encodeOption({ id: RESCUE_DEAL, v: { c: c.loan.coins, q: c.loan.quota } })],
    } : null;
  };

  const end = (kind: 'deal' | 'missed' | 'declined', ok: boolean): void => {
    const c = call;
    if (!c) return;
    call = null;
    rebuild();
    bus.emit('hotline:result', {
      callId: c.id, kind, deal: kind === 'deal' ? RESCUE_DEAL : '', ok,
      note: kind === 'deal' ? 'hotline.note.struck' : kind === 'missed' ? 'hotline.note.missed' : 'hotline.note.declined',
      vars: kind === 'deal' ? { name: `@${dealKey(RESCUE_DEAL)}.name` } : {},
    });
    bus.emit('phone:end', { callId: c.id });
  };

  return {
    phone: () => view,
    active: () => call !== null,
    ring(loan) {
      if (call) return false;
      const secs = Math.max(RESCUE_RING_MIN, host.ringSeconds() || RING_SECONDS);   // the lifeline rings long: the player may be 25 m from the booth
      call = { id: ID_BASE + (++seq), ringingSince: host.now(), answeredBy: null, loan, ringLeft: secs, answerLeft: 0 };
      rebuild();
      bus.emit('phone:ring', { callId: call.id });
      bus.emit('phone:length', { callId: call.id, seconds: secs });
      return true;
    },
    answer(choice) {
      const c = call;
      if (!c) return false;
      if (choice === -1) {
        if (c.answeredBy === null) { c.answeredBy = host.selfId; c.answerLeft = ANSWER_SECONDS; rebuild(); }
        return true;
      }
      if (c.answeredBy === null || choice !== 0) return true;
      host.take(c.loan);
      end('deal', true);
      return true;
    },
    tick(dt) {
      const c = call;
      if (!c || !(dt > 0)) return;
      if (c.answeredBy === null) {
        c.ringLeft -= dt;
        if (c.ringLeft <= 0) end('missed', false);
      } else {
        c.answerLeft -= dt;
        if (c.answerLeft <= 0) end('declined', false);
      }
    },
    hangUp: () => { end('missed', false); },
    dispose: () => { call = null; rebuild(); },
  };
}
