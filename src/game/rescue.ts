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
import { RESCUE_LOAN_FRAC, RESCUE_MIN, type RescueLoan } from '@/game/economy';

export const RESCUE_DEAL = 'rescue';
export const RESCUE_SCRIPT = 'hotline.call.rescue';
const ID_BASE = 1_000_000;

/**
 * The loan the Collector offers (wave 23, flow-fixes). `coins` now is the share of tonight's quota the economy grants (25 %, at
 * least RESCUE_MIN). The quota penalty `quota` is capped at RESCUE_PENALTY_MAX x the cash given, so the player can plausibly
 * repay it: 49 coins used to add +74 quota (1.5x), now +63. Use this instead of `economy.rescueLoan` (WIRING in the work report).
 */
export const RESCUE_PENALTY_MAX = 1.3;
export function rescueTerms(due: number): RescueLoan {
  const coins = Math.max(RESCUE_MIN, Math.round(Math.max(0, due) * RESCUE_LOAN_FRAC));
  return { coins, quota: Math.floor(coins * RESCUE_PENALTY_MAX) };
}

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

// ── the broke-start help (wave 27, bank-econ): what to do when the pocket cannot cover the cheapest bet ───────────────
export type BrokeId = 'bell' | 'bank' | 'phone' | 'cashier' | 'loan';
/** One way out. `coins` is what it puts in the pocket (0 for the phone itself); `quota` is the loan's price. */
export interface BrokeStep { id: BrokeId; coins: number; quota?: number }
export interface BrokeHelp { pocket: number; minBet: number; pullsLeft: number; steps: BrokeStep[] }
export interface BrokeInput {
  /** Coins a WITHDRAW can take now (0 = none, or the window is shut). */
  bank: number;
  tickets: number;
  /** Coins one Ticket sells for at the cashier. */
  ticketCoins: number;
  /** A phone line is ringing (rescue or hotline). */
  phoneRinging: boolean;
  loan?: RescueLoan;
  /** The Watch is playing (pulls left, play or Last Call): the Bell at the Debt Terminal can end it. */
  bell?: boolean;
}

/**
 * The ordered ways out of an empty pocket, only the ones that exist: 0 ring the Bell (end this Watch, the bank keeps growing; always
 * first while playing, decision 4), 1 withdraw from the bank, 2 answer the phone (P), 3 the cashier (sell Tickets), 4 take the House
 * loan (the Collector's rescue call, answered on the phone). The prompt prints them in this order.
 */
export function brokeSteps(i: BrokeInput): BrokeStep[] {
  const out: BrokeStep[] = [];
  if (i.bell) out.push({ id: 'bell', coins: 0 });
  if (i.bank > 0) out.push({ id: 'bank', coins: Math.floor(i.bank) });
  if (i.phoneRinging) out.push({ id: 'phone', coins: 0 });
  if (i.tickets > 0 && i.ticketCoins > 0) out.push({ id: 'cashier', coins: Math.floor(i.tickets) * Math.floor(i.ticketCoins) });
  if (i.loan) out.push({ id: 'loan', coins: i.loan.coins, quota: i.loan.quota });
  return out;
}
