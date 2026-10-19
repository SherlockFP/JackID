/**
 * Stake tiers of a duel (Wave 25 TALLY, lane A): Coins (S ~ 6 % of the Night quota), Pledge (3 Tickets or 1 Obol) and
 * Soul Mark (3 per run). The rival always puts up its Pledge (a themed Rare charm plus 2 Obols).
 *
 * Pure maths + the optional run hooks the integrator provides (`run.duel`, see `DuelRunHooks`). The Soul Mark counter
 * lives in the run (save, HUD seals), so the engine only talks to it through the hooks. A duel stakes a seal only while 2+ remain.
 */
import type { StakeTier } from './types'

export const STAKE_PCT = 0.06
export const MIN_STAKE = 5
export const PLEDGE_TICKETS = 3
export const PLEDGE_OBOLS = 1
/** The rival's Pledge always includes these Obols (the themed Rare charm comes from `DuelRunHooks.grantPledge`). */
export const RIVAL_PLEDGE_OBOLS = 2
/** Dread added per lost Soul Mark (spec: "Losing a Mark"). The engine adds it itself; hooks must NOT. */
export const MARK_DREAD = 0.1
export const SOUL_MARKS_PER_RUN = 3

/** A coin stake unit S for a Night: ~6 % of the quota, rounded to a friendly figure, never below the minimum. */
export function stakeUnit(quota: number): number {
  const raw = Math.max(MIN_STAKE, quota * STAKE_PCT)
  const step = raw >= 500 ? 50 : raw >= 100 ? 10 : 5
  return Math.max(MIN_STAKE, Math.round(raw / step) * step)
}

/** What the player has to spend on a Pledge: 3 Tickets, else 1 Obol, else nothing (tier unavailable). */
export function pledgeCost(tickets: number, obols: number): { cur: 'ticket' | 'obol'; amount: number } | null {
  if (tickets >= PLEDGE_TICKETS) return { cur: 'ticket', amount: PLEDGE_TICKETS }
  if (obols >= PLEDGE_OBOLS) return { cur: 'obol', amount: PLEDGE_OBOLS }
  return null
}

/** The integrator's run-side counters. Optional: a run without `run.duel` offers Coins and Pledge only. */
export interface DuelRunHooks {
  /** Soul Marks left (0..3). */
  soulMarks(pid?: number): number
  /** Put one Mark on the table. False when it would be the last one (the card keeps one). The Mark leaves the counter until returned or lost. */
  stakeSoulMark(pid?: number): boolean
  /** The duel was won or drawn: the escrowed Mark goes back on the card. */
  returnSoulMark(pid?: number): void
  /** The duel was lost: the Mark is gone. Update the save and the HUD seals. Dread is added by the engine. */
  loseSoulMark(pid?: number): void
  /** The winner takes the rival's Pledge: a themed Rare charm (the 2 Obols are paid by the engine). */
  grantPledge?(rivalId: string, pid?: number): void
  /** Calm or Free mode: only the Coins tier is allowed. */
  coinsOnly?(): boolean
  /** Which rival this table seats (Night spawn, boss flag). Null / absent: the engine picks one from the Night. */
  encounter?(instanceId: string): { rivalId: string; night?: number; boss?: boolean } | null
  /** A duel opens (first sitting of the Night): the machine waits for the returned promise before it reads the terms (the rival's intro scene). */
  onDuelStart?(e: { rivalId: string; night: number; boss: boolean }): Promise<void> | void
  /** Called when a duel is fully settled (boss reward, Wing Key, Audit tax). */
  onDuelEnd?(r: DuelEndReport): void
}

export interface DuelEndReport {
  rivalId: string
  gameId: string
  night: number
  boss: boolean
  tier: StakeTier
  S: number
  won: boolean
  drew: boolean
  net: number
  calledCorrect: boolean | null
}

/** What `settleStake` tells the machine to do with the wallet and the counters. */
export interface StakeSettlement {
  /** Coins paid back to the seat (stake + net winnings, floored at 0). Coins tier only. */
  coinsGross: number
  /** Coins still owed beyond the escrowed stake (a fine on top of a lost stake). Coins tier only. */
  coinsOwed: number
  /** Pledge escrow goes back to the player. */
  refundPledge: boolean
  /** A Soul Mark comes back (won or drawn). */
  returnMark: boolean
  /** A Soul Mark is lost. */
  loseMark: boolean
  /** The rival's Pledge goes to the player (a win at the Pledge or Soul Mark tier). */
  takePledge: boolean
  /** Dread to add. */
  dread: number
}

/** Pure mapping of a duel result (`playerNet`, in coins of S) onto the tier that was staked. */
export function settleStake(tier: StakeTier, S: number, playerNet: number): StakeSettlement {
  const net = Math.round(playerNet)
  const out: StakeSettlement = {
    coinsGross: 0, coinsOwed: 0, refundPledge: false, returnMark: false, loseMark: false, takePledge: false, dread: 0,
  }
  if (tier === 'coins') {
    const gross = S + net
    out.coinsGross = Math.max(0, gross)
    out.coinsOwed = Math.max(0, -gross)
    return out
  }
  if (net > 0) {
    out.takePledge = true
    if (tier === 'pledge') out.refundPledge = true
    else out.returnMark = true
  } else if (net === 0) {
    if (tier === 'pledge') out.refundPledge = true
    else out.returnMark = true
  } else if (tier === 'soul') {
    out.loseMark = true
    out.dread = MARK_DREAD
  }
  return out
}
